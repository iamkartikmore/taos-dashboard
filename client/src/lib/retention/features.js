/**
 * Per-customer feature engineering from Shopify-shape orders + customers.
 *
 * Pure functions. All inputs are already normalized to Shopify REST shape
 * (see shopifyCsvImport.js / fetchShopifyOrders). Nothing here hits the
 * network. Consumes arrays; returns keyed maps.
 */

const DAY = 86_400_000;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const email = o => (o?.email || o?.customer?.email || '').toLowerCase().trim();
const sku = li => String(li?.sku || '').trim().toUpperCase();

/* ─── PER-SKU REPLENISH CLOCK ────────────────────────────────────
   For every (customer, sku) pair, collect successive purchase gaps.
   Then for each SKU, estimate a replenish interval = median of all
   same-customer repeat gaps. SKUs with fewer than 5 repeat gaps get
   no clock (null) — not enough signal.
   ──────────────────────────────────────────────────────────────── */
export function buildSkuReplenishClock(orders) {
  const byCustSku = new Map();           // `${email}|${sku}` → [dateMs]
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = email(o);
    if (!e) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    for (const li of (o.line_items || [])) {
      const s = sku(li);
      if (!s) continue;
      const k = `${e}|${s}`;
      if (!byCustSku.has(k)) byCustSku.set(k, []);
      byCustSku.get(k).push(t);
    }
  }

  const gaps = new Map(); // sku → number[]
  for (const [k, times] of byCustSku) {
    if (times.length < 2) continue;
    const s = k.split('|')[1];
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const days = (times[i] - times[i - 1]) / DAY;
      if (days < 1 || days > 365) continue; // drop same-day and ancient gaps
      if (!gaps.has(s)) gaps.set(s, []);
      gaps.get(s).push(days);
    }
  }

  const clock = {};
  for (const [s, arr] of gaps) {
    if (arr.length < 5) continue;
    arr.sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    clock[s] = {
      sku: s,
      median_gap_days: Math.round(median),
      p25:             Math.round(arr[Math.floor(arr.length * 0.25)]),
      p75:             Math.round(arr[Math.floor(arr.length * 0.75)]),
      sample_size:     arr.length,
      is_consumable:   median <= 120,  // anything with typical < 4 month repeat
    };
  }
  return clock;
}

/* ─── PER-CUSTOMER FEATURES ─────────────────────────────────────── */
export function buildCustomerFeatures(orders, customers = [], now = Date.now()) {
  // Index Shopify customer records by email (lifetime totals beat derived)
  const custByEmail = {};
  for (const c of customers) {
    const e = (c.email || '').toLowerCase().trim();
    if (e) custByEmail[e] = c;
  }

  // Group orders by email
  const byEmail = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = email(o);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(o);
  }

  const feats = {};
  for (const [e, list] of byEmail) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const firstT = Date.parse(list[0].created_at);
    const lastT  = Date.parse(list[list.length - 1].created_at);
    const daysSinceFirst = Math.round((now - firstT) / DAY);
    const daysSinceLast  = Math.round((now - lastT)  / DAY);
    const orders_lifetime = list.length;
    const spend_lifetime  = list.reduce((s, o) => s + num(o.total_price), 0);
    const aov_lifetime    = orders_lifetime ? spend_lifetime / orders_lifetime : 0;

    // Inter-order gaps
    const gaps = [];
    for (let i = 1; i < list.length; i++) {
      const g = (Date.parse(list[i].created_at) - Date.parse(list[i - 1].created_at)) / DAY;
      if (g >= 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const gap_mean   = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
    const gap_median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const gap_std    = gaps.length >= 2
      ? Math.sqrt(gaps.reduce((s, g) => s + (g - gap_mean) ** 2, 0) / gaps.length)
      : null;
    const last_gap   = gaps.length ? gaps[gaps.length - 1] : null;

    // Predicted next-order date (cadence-based; overridden by survival model later)
    const next_order_eta_ms = gap_median != null ? lastT + gap_median * DAY : null;
    const overdue_ratio     = gap_median ? daysSinceLast / gap_median : null;

    // Collection / SKU preferences — recency-weighted (halved every 180d)
    const colSpend = {}; const skuSpend = {};
    let totalWeighted = 0;
    for (const o of list) {
      const oT = Date.parse(o.created_at);
      const ageD = Math.max(0, (now - oT) / DAY);
      const w = Math.pow(0.5, ageD / 180);     // half-life 180d
      for (const li of (o.line_items || [])) {
        const s = sku(li);
        const rev = num(li.price) * num(li.quantity || 1) * w;
        if (s) skuSpend[s] = (skuSpend[s] || 0) + rev;
        const tag = String(li._collection || '').trim();
        if (tag) colSpend[tag] = (colSpend[tag] || 0) + rev;
        totalWeighted += rev;
      }
    }
    const topSkus = Object.entries(skuSpend).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([s, r]) => ({ sku: s, weighted_rev: +r.toFixed(2) }));
    const collection_affinity = {};
    for (const [c, r] of Object.entries(colSpend)) {
      collection_affinity[c] = totalWeighted > 0 ? +(r / totalWeighted).toFixed(3) : 0;
    }
    const primary_collection = Object.entries(collection_affinity).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Basket & discount behavior
    const basketSizes = list.map(o => (o.line_items || []).reduce((s, li) => s + num(li.quantity || 1), 0));
    const avg_basket  = basketSizes.length ? basketSizes.reduce((s, n) => s + n, 0) / basketSizes.length : 0;
    const multi_item_orders = list.filter(o => (o.line_items || []).length > 1).length;
    const multi_item_ratio  = orders_lifetime ? multi_item_orders / orders_lifetime : 0;

    const discountOrders = list.filter(o => num(o.total_discounts) > 0 || (o.discount_codes || []).length > 0).length;
    const discount_ratio = orders_lifetime ? discountOrders / orders_lifetime : 0;

    // Novelty: fraction of orders introducing a never-before-bought SKU
    const seenSkus = new Set();
    let noveltyCount = 0;
    for (const o of list) {
      const orderSkus = (o.line_items || []).map(sku).filter(Boolean);
      const hasNew = orderSkus.some(s => !seenSkus.has(s));
      if (hasNew) noveltyCount++;
      for (const s of orderSkus) seenSkus.add(s);
    }
    const novelty_ratio = orders_lifetime ? noveltyCount / orders_lifetime : 0;

    // Send-hour preference (mode of order hours in local time, IST assumed)
    const hours = list.map(o => new Date(o.created_at).getUTCHours()).filter(h => h >= 0 && h < 24);
    const hourBuckets = {};
    for (const h of hours) hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    const preferred_hour_utc = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Seasonality (month-of-year)
    const monthBuckets = Array(12).fill(0);
    for (const o of list) {
      const m = new Date(o.created_at).getUTCMonth();
      if (m >= 0) monthBuckets[m]++;
    }

    // Merge with Shopify customer record if present (lifetime totals include pre-window orders)
    const custRec = custByEmail[e] || {};
    const lifetime_shopify = {
      orders: num(custRec.total_orders || custRec.orders_count),
      spent:  num(custRec.total_spent),
    };

    feats[e] = {
      email: e,
      customer_id:  custRec.customer_id || '',
      first_name:   custRec.first_name || '',
      last_name:    custRec.last_name  || '',
      accepts_email_marketing: !!custRec.accepts_email_marketing,
      accepts_sms_marketing:   !!custRec.accepts_sms_marketing,
      city:         custRec.city || list[0]?.billing_address?.city || '',
      province:     custRec.province || list[0]?.billing_address?.province || '',

      // Core RFM inputs
      orders_lifetime,
      spend_lifetime: +spend_lifetime.toFixed(2),
      aov_lifetime:   +aov_lifetime.toFixed(2),
      days_since_first_order: daysSinceFirst,
      days_since_last_order:  daysSinceLast,

      // Cadence
      gap_mean:     gap_mean   != null ? Math.round(gap_mean)   : null,
      gap_median:   gap_median != null ? Math.round(gap_median) : null,
      gap_std:      gap_std    != null ? Math.round(gap_std)    : null,
      last_gap:     last_gap   != null ? Math.round(last_gap)   : null,
      next_order_eta_ms,
      next_order_eta_days: next_order_eta_ms != null ? Math.round((next_order_eta_ms - now) / DAY) : null,
      overdue_ratio: overdue_ratio != null ? +overdue_ratio.toFixed(2) : null,

      // Preferences
      top_skus: topSkus,
      collection_affinity,
      primary_collection,

      // Behavior
      avg_basket_size:      +avg_basket.toFixed(2),
      multi_item_ratio:     +multi_item_ratio.toFixed(3),
      discount_order_ratio: +discount_ratio.toFixed(3),
      novelty_ratio:        +novelty_ratio.toFixed(3),
      preferred_hour_utc:   preferred_hour_utc != null ? parseInt(preferred_hour_utc, 10) : null,
      month_distribution:   monthBuckets,

      // Shopify lifetime totals (overrides when larger — captures orders outside window)
      lifetime_shopify,
      true_orders_lifetime: Math.max(orders_lifetime, lifetime_shopify.orders || 0),
      true_spend_lifetime:  Math.max(spend_lifetime,  lifetime_shopify.spent  || 0),
    };
  }

  // Orphaned customers (no orders but in customer export) — include for segmentation
  for (const c of customers) {
    const e = (c.email || '').toLowerCase().trim();
    if (!e || feats[e]) continue;
    feats[e] = {
      email: e,
      customer_id: c.customer_id || '',
      first_name:  c.first_name  || '',
      last_name:   c.last_name   || '',
      accepts_email_marketing: !!c.accepts_email_marketing,
      accepts_sms_marketing:   !!c.accepts_sms_marketing,
      city:         c.city     || '',
      province:     c.province || '',
      orders_lifetime: 0,
      spend_lifetime:  num(c.total_spent),
      aov_lifetime:    0,
      days_since_first_order: null,
      days_since_last_order:  null,
      gap_mean: null, gap_median: null, gap_std: null, last_gap: null,
      next_order_eta_ms: null, next_order_eta_days: null, overdue_ratio: null,
      top_skus: [], collection_affinity: {}, primary_collection: '',
      avg_basket_size: 0, multi_item_ratio: 0, discount_order_ratio: 0, novelty_ratio: 0,
      preferred_hour_utc: null, month_distribution: Array(12).fill(0),
      lifetime_shopify: { orders: num(c.total_orders), spent: num(c.total_spent) },
      true_orders_lifetime: num(c.total_orders),
      true_spend_lifetime:  num(c.total_spent),
    };
  }

  return feats;
}

/* ─── RFM SCORING (percentile-based, buyers only) ───────────────── */
export function scoreRfm(featsMap) {
  const emails = Object.keys(featsMap);
  const buyers = emails.filter(e => (featsMap[e].orders_lifetime || 0) > 0);
  if (!buyers.length) return featsMap;

  // Ascending rank of each metric among buyers
  const rank = (arr, asc = true) => {
    const sorted = [...arr].sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]);
    const rnk = new Map();
    const n = sorted.length;
    sorted.forEach(([e], i) => rnk.set(e, n === 1 ? 1 : (i + 1) / n));
    return rnk;
  };

  // R: fewer days_since_last → higher rank (more recent = better)
  const rVals = buyers.map(e => [e, -featsMap[e].days_since_last_order]);
  const fVals = buyers.map(e => [e,  featsMap[e].orders_lifetime]);
  const mVals = buyers.map(e => [e,  featsMap[e].spend_lifetime]);
  const rRnk = rank(rVals, true);
  const fRnk = rank(fVals, true);
  const mRnk = rank(mVals, true);

  for (const e of emails) {
    const f = featsMap[e];
    if (!f.orders_lifetime) {
      f.r_score = 0; f.f_score = 0; f.m_score = 0; f.rfm_total = 0;
      f.rfm_segment = 'No Order Yet';
      f.lifecycle_stage = 'SUBSCRIBER_ONLY';
      f.value_tier = 'Emerging';
      continue;
    }
    f.r_score = Math.ceil((rRnk.get(e) || 0) * 5);
    f.f_score = Math.ceil((fRnk.get(e) || 0) * 5);
    f.m_score = Math.ceil((mRnk.get(e) || 0) * 5);
    f.rfm_total = f.r_score + f.f_score + f.m_score;

    // Segment
    const { r_score: r, f_score: fs, m_score: m } = f;
    f.rfm_segment =
      r >= 4 && fs >= 4 && m >= 4 ? 'Champions' :
      r >= 4 && fs >= 4 && m <= 3 ? 'Loyal Repeat' :
      r >= 4 && fs <= 2 && m >= 4 ? 'Recent High Spender' :
      r >= 4 && fs <= 2 && m <= 3 ? 'Recent First Buyer' :
      r === 3 && fs >= 4 && m >= 4 ? 'Warm Loyal VIP' :
      r === 3 && fs >= 4           ? 'Warm Loyal' :
      r === 2 && fs >= 4 && m >= 4 ? 'At Risk VIP' :
      r === 2 && fs >= 4           ? 'At Risk Loyal' :
      r === 1 && fs >= 4 && m >= 4 ? 'Lost VIP' :
      r === 1                      ? 'Dormant' :
      'Repeat Buyer';

    // Lifecycle
    const d = f.days_since_last_order;
    f.lifecycle_stage =
      f.orders_lifetime === 1 && d <= 30 ? 'NEW_BUYER' :
      f.orders_lifetime === 1            ? 'ONE_TIME'  :
      f.orders_lifetime >= 4 && d <= 45  ? 'VIP_ACTIVE' :
      f.orders_lifetime >= 2 && d <= 45  ? 'ACTIVE_REPEAT' :
      d <= 75                            ? 'AT_RISK' :
      'DORMANT';

    // Value tier
    f.value_tier =
      f.true_spend_lifetime >= 3000 || (f.true_orders_lifetime >= 8 && f.aov_lifetime >= 350) ? 'VIP' :
      f.true_spend_lifetime >= 1000 || f.true_orders_lifetime >= 3 ? 'Core' :
      'Emerging';
  }
  return featsMap;
}

/* ─── CONVENIENCE: FULL PIPELINE ────────────────────────────────── */
export function buildAllFeatures(orders, customers = [], now = Date.now()) {
  const feats = buildCustomerFeatures(orders, customers, now);
  scoreRfm(feats);
  const replenish = buildSkuReplenishClock(orders);
  return { features: feats, replenish };
}
