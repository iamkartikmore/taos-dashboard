/* ─── PERIOD COMPARISON ANALYTICS ─────────────────────────────────────── */
// Deep analysis engine for order change root-cause diagnosis.
// Covers: date windowing, hourly breakdown, SKU, traffic, discounts,
// geo, payment, customer, and Meta funnel comparisons.

import { safeNum, safeDivide } from './analytics';

/* ══════════════════════════════════════════════════════════════════════════
   DATE UTILITIES
══════════════════════════════════════════════════════════════════════════ */

function iso(d) { return d.toISOString().slice(0, 10); }
function shiftDay(dateOrStr, days) {
  const d = new Date(typeof dateOrStr === 'string' ? dateOrStr + 'T12:00:00' : dateOrStr);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Compute current + prior date windows.
 * @param period  'yesterday'|'today'|'7d'|'14d'|'30d'|'custom'
 * @param compMode  'same_day_lw'|'day_before'|'prior_period'
 */
export function getPeriodDates(period, compMode = 'same_day_lw', customSince, customUntil) {
  const now = new Date();
  let curSince, curUntil, label, isSingleDay = false;

  if (period === 'today') {
    curSince = curUntil = iso(now);
    isSingleDay = true;
    label = 'Today';
  } else if (period === 'yesterday') {
    curSince = curUntil = iso(shiftDay(now, -1));
    isSingleDay = true;
    label = 'Yesterday';
  } else if (period === 'custom') {
    curSince = customSince || iso(shiftDay(now, -7));
    curUntil = customUntil || iso(now);
    isSingleDay = curSince === curUntil;
    label = curSince === curUntil ? curSince : `${curSince} → ${curUntil}`;
  } else {
    const days = period === '7d' ? 7 : period === '14d' ? 14 : 30;
    curSince = iso(shiftDay(now, -days));
    curUntil = iso(now);
    label = `Last ${days}D`;
    isSingleDay = false;
  }

  // Prior window
  let priorSince, priorUntil, compLabel;
  if (isSingleDay) {
    if (compMode === 'same_day_lw') {
      priorSince = priorUntil = iso(shiftDay(new Date(curSince + 'T12:00:00'), -7));
      compLabel = 'Same Day Last Week';
    } else {
      priorSince = priorUntil = iso(shiftDay(new Date(curSince + 'T12:00:00'), -1));
      compLabel = 'Day Before';
    }
  } else {
    const start = new Date(curSince + 'T12:00:00');
    const end   = new Date(curUntil + 'T12:00:00');
    const days  = Math.round((end - start) / 86400000) + 1;
    priorUntil  = iso(shiftDay(start, -1));
    priorSince  = iso(shiftDay(start, -days));
    compLabel   = `Prior ${days}D`;
  }

  return { curSince, curUntil, priorSince, priorUntil, label, compLabel, isSingleDay };
}

/** Filter orders by inclusive date range (YYYY-MM-DD strings). */
export function filterByDate(orders, since, until) {
  return (orders || []).filter(o => {
    const d = (o.created_at || '').slice(0, 10);
    return d >= since && d <= until;
  });
}

/** What date range is covered by loaded orders. */
export function getDataCoverage(orders) {
  if (!orders?.length) return null;
  const dates = orders.map(o => (o.created_at || '').slice(0, 10)).filter(Boolean).sort();
  return { earliest: dates[0], latest: dates[dates.length - 1], count: orders.length };
}

/* ══════════════════════════════════════════════════════════════════════════
   SHOPIFY ORDER AGGREGATION
══════════════════════════════════════════════════════════════════════════ */

const p = v => parseFloat(v || 0);

export function aggregateOrdersFull(orders) {
  if (!orders?.length) return emptyAgg();
  let count=0, revenue=0, discountedCount=0, totalDiscount=0,
      cancelledCount=0, totalItems=0, newCount=0, repeatCount=0;
  const seen = new Set();

  for (const o of (orders || [])) {
    if (o.cancelled_at) { cancelledCount++; }
    count++;
    const rev  = p(o.total_price);
    const disc = p(o.total_discounts);
    revenue += rev;
    if (disc > 0) { discountedCount++; totalDiscount += disc; }

    const email = (o.email || o.customer?.email || '').toLowerCase().trim();
    const cid   = o.customer?.id;
    const key   = email || (cid ? `cid_${cid}` : null);
    const ltOrders = o.customer?.orders_count;
    const isRepeat = ltOrders != null ? ltOrders > 1 : (key && seen.has(key));
    if (isRepeat) repeatCount++; else newCount++;
    if (key) seen.add(key);

    totalItems += (o.line_items || []).reduce((s, li) => s + (parseInt(li.quantity) || 1), 0);
  }

  return {
    count, revenue, aov: safeDivide(revenue, count),
    newCount, repeatCount,
    newPct:          safeDivide(newCount, count) * 100,
    discountedCount, totalDiscount,
    discountedPct:   safeDivide(discountedCount, count) * 100,
    avgDiscount:     safeDivide(totalDiscount, discountedCount),
    cancelledCount,
    cancelRate:      safeDivide(cancelledCount, count) * 100,
    totalItems,
    avgItems:        safeDivide(totalItems, count),
  };
}

function emptyAgg() {
  return {
    count:0, revenue:0, aov:0, newCount:0, repeatCount:0, newPct:0,
    discountedCount:0, totalDiscount:0, discountedPct:0, avgDiscount:0,
    cancelledCount:0, cancelRate:0, totalItems:0, avgItems:0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   HOURLY BREAKDOWN
══════════════════════════════════════════════════════════════════════════ */

export function buildHourlyBreakdown(curOrders, priorOrders) {
  const build = (orders) => {
    const h = Array.from({length:24}, (_, i) => ({ hour:i, orders:0, revenue:0 }));
    for (const o of (orders || [])) {
      const hr = o.created_at ? new Date(o.created_at).getHours() : null;
      if (hr !== null) {
        h[hr].orders++;
        h[hr].revenue += p(o.total_price);
      }
    }
    return h;
  };

  const cur   = build(curOrders);
  const prior = build(priorOrders);
  const FMT   = h => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;

  return cur.map((c, i) => ({
    label:       FMT(i),
    hour:        i,
    orders:      c.orders,
    priorOrders: prior[i].orders,
    revenue:     c.revenue,
    priorRev:    prior[i].revenue,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   DAILY TREND (for multi-day views)
══════════════════════════════════════════════════════════════════════════ */

export function buildDailyTrend(curOrders, priorOrders, curSince, curUntil, priorSince, priorUntil) {
  // Build day arrays for both windows
  const buildDays = (since, until) => {
    const days = {}, d = new Date(since + 'T12:00:00');
    const end  = new Date(until + 'T12:00:00');
    while (d <= end) {
      const key = iso(d);
      days[key] = { date: key, orders: 0, revenue: 0 };
      d.setDate(d.getDate() + 1);
    }
    return days;
  };

  const curDays   = buildDays(curSince,   curUntil);
  const priorDays = buildDays(priorSince, priorUntil);

  for (const o of (curOrders   || [])) { const k=(o.created_at||'').slice(0,10); if(curDays[k])   { curDays[k].orders++;   curDays[k].revenue   += p(o.total_price); } }
  for (const o of (priorOrders || [])) { const k=(o.created_at||'').slice(0,10); if(priorDays[k]) { priorDays[k].orders++; priorDays[k].revenue += p(o.total_price); } }

  const curArr   = Object.values(curDays).sort((a,b) => a.date.localeCompare(b.date));
  const priorArr = Object.values(priorDays).sort((a,b) => a.date.localeCompare(b.date));
  const len = Math.max(curArr.length, priorArr.length);

  return Array.from({length:len}, (_, i) => {
    const c = curArr[i];
    const pr = priorArr[i];
    return {
      idx:         i + 1,
      label:       c ? c.date.slice(5) : `D${i+1}`,
      orders:      c?.orders     || 0,
      priorOrders: pr?.orders    || 0,
      revenue:     c?.revenue    || 0,
      priorRev:    pr?.revenue   || 0,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SKU DEEP DIVE (with stockout detection)
══════════════════════════════════════════════════════════════════════════ */

export function buildSkuDeepDive(curOrders, priorOrders, inventoryMap = {}) {
  const agg = orders => {
    const m = {};
    for (const o of (orders||[])) {
      for (const li of (o.line_items||[])) {
        const sku   = (li.sku||li.title||'').trim().toUpperCase() || 'UNKNOWN';
        const title = li.title || li.name || sku;
        if (!m[sku]) m[sku] = { sku, title, qty:0, revenue:0, orders:new Set() };
        m[sku].qty     += parseInt(li.quantity) || 1;
        m[sku].revenue += p(li.price) * (parseInt(li.quantity)||1);
        m[sku].orders.add(o.id || o.order_number);
      }
    }
    // convert Set to count
    return Object.fromEntries(Object.entries(m).map(([k,v]) => [k, {...v, orderCount: v.orders.size, orders: undefined}]));
  };

  const cur   = agg(curOrders);
  const prior = agg(priorOrders);
  const all   = new Set([...Object.keys(cur), ...Object.keys(prior)]);

  return Array.from(all).map(sku => {
    const c   = cur[sku]   || { qty:0, revenue:0, orderCount:0, title: sku };
    const pr  = prior[sku] || { qty:0, revenue:0, orderCount:0, title: sku };
    const inv = inventoryMap[sku];
    const stock = inv?.stock ?? null;
    const qtyDelta = pr.qty > 0 ? (c.qty - pr.qty) / pr.qty * 100 : (c.qty > 0 ? 100 : -100);
    const revDelta = pr.revenue > 0 ? (c.revenue - pr.revenue) / pr.revenue * 100 : (c.revenue > 0 ? 100 : -100);
    const isStockedOut = stock !== null && stock <= 0;
    const isLowStock   = stock !== null && stock > 0 && stock <= 5;

    return {
      sku, title: c.title || pr.title,
      curQty: c.qty, priorQty: pr.qty,
      curRev: c.revenue, priorRev: pr.revenue,
      curOrders: c.orderCount, priorOrders: pr.orderCount,
      qtyDelta, revDelta, stock, isStockedOut, isLowStock,
    };
  }).sort((a,b) => b.curQty - a.curQty);
}

/* ══════════════════════════════════════════════════════════════════════════
   TRAFFIC SOURCE COMPARISON (UTM + referrer)
══════════════════════════════════════════════════════════════════════════ */

function parseSource(o) {
  const site = o.landing_site || '';
  const ref  = o.referring_site || '';
  const sn   = o.source_name || '';

  // Try UTM
  try {
    const url = site.startsWith('http') ? site : `https://x.com${site}`;
    const params = new URL(url).searchParams;
    const utm = params.get('utm_source');
    if (utm) return utm.toLowerCase();
  } catch {}

  // Try referring site
  if (ref.includes('facebook') || ref.includes('fb.com')) return 'facebook';
  if (ref.includes('instagram'))  return 'instagram';
  if (ref.includes('google'))     return 'google';
  if (ref.includes('youtube'))    return 'youtube';
  if (ref.includes('pinterest'))  return 'pinterest';
  if (ref.includes('twitter') || ref.includes('t.co')) return 'twitter';
  if (sn && sn !== 'web') return sn;
  if (ref) return 'other_referral';
  return 'direct';
}

export function buildTrafficComparison(curOrders, priorOrders) {
  const agg = orders => {
    const m = {};
    for (const o of (orders||[])) {
      const src = parseSource(o);
      if (!m[src]) m[src] = { source:src, orders:0, revenue:0, newOrders:0 };
      m[src].orders++;
      m[src].revenue += p(o.total_price);
      if (!o.customer?.orders_count || o.customer.orders_count <= 1) m[src].newOrders++;
    }
    return m;
  };
  const c = agg(curOrders), pr = agg(priorOrders);
  const all = new Set([...Object.keys(c), ...Object.keys(pr)]);
  return Array.from(all).map(src => {
    const cv = c[src]  || { orders:0, revenue:0, newOrders:0 };
    const pv = pr[src] || { orders:0, revenue:0, newOrders:0 };
    const d  = pv.orders > 0 ? (cv.orders - pv.orders) / pv.orders * 100 : (cv.orders > 0 ? 100 : -100);
    return { source:src, curOrders:cv.orders, priorOrders:pv.orders, curRev:cv.revenue, priorRev:pv.revenue, delta:d, newCur:cv.newOrders };
  }).sort((a,b) => (b.curOrders + b.priorOrders) - (a.curOrders + a.priorOrders));
}

/* ══════════════════════════════════════════════════════════════════════════
   DISCOUNT ANALYSIS
══════════════════════════════════════════════════════════════════════════ */

export function buildDiscountAnalysis(curOrders, priorOrders) {
  const agg = orders => {
    const byCode = {};
    let discounted=0, notDiscounted=0;
    for (const o of (orders||[])) {
      const d = p(o.total_discounts);
      if (d > 0) discounted++; else notDiscounted++;
      for (const dc of (o.discount_codes||[])) {
        const code = (dc.code||'unknown').toUpperCase();
        if (!byCode[code]) byCode[code] = { code, orders:0, amount:0, revenue:0 };
        byCode[code].orders++;
        byCode[code].amount  += p(dc.amount);
        byCode[code].revenue += p(o.total_price);
      }
    }
    const total = discounted + notDiscounted;
    return { total, discounted, notDiscounted, pct: safeDivide(discounted, total)*100, byCode };
  };
  const cur   = agg(curOrders);
  const prior = agg(priorOrders);

  // Which codes are new / gone
  const allCodes  = new Set([...Object.keys(cur.byCode), ...Object.keys(prior.byCode)]);
  const codeDiff  = Array.from(allCodes).map(code => {
    const c = cur.byCode[code]   || { orders:0, amount:0, revenue:0 };
    const p2 = prior.byCode[code] || { orders:0, amount:0, revenue:0 };
    const d  = p2.orders > 0 ? (c.orders - p2.orders) / p2.orders * 100 : (c.orders > 0 ? 100 : -100);
    return { code, curOrders:c.orders, priorOrders:p2.orders, curAmount:c.amount, priorAmount:p2.amount, delta:d };
  }).sort((a,b) => b.curOrders - a.curOrders);

  return { cur, prior, codeDiff };
}

/* ══════════════════════════════════════════════════════════════════════════
   GEOGRAPHIC COMPARISON
══════════════════════════════════════════════════════════════════════════ */

export function buildGeoComparison(curOrders, priorOrders) {
  const agg = orders => {
    const states = {}, cities = {};
    for (const o of (orders||[])) {
      const state = o.shipping_address?.province || o.billing_address?.province || 'Unknown';
      const city  = o.shipping_address?.city     || o.billing_address?.city     || 'Unknown';
      if (!states[state]) states[state] = { geo:state, orders:0, revenue:0 };
      states[state].orders++;
      states[state].revenue += p(o.total_price);
      if (city !== 'Unknown') {
        if (!cities[city]) cities[city] = { geo:city, orders:0, revenue:0 };
        cities[city].orders++;
        cities[city].revenue += p(o.total_price);
      }
    }
    return { states, cities };
  };
  const c = agg(curOrders), pr = agg(priorOrders);

  const mapDiff = (cMap, pMap) => {
    const all = new Set([...Object.keys(cMap), ...Object.keys(pMap)]);
    return Array.from(all).map(g => {
      const cv = cMap[g]  || { orders:0, revenue:0 };
      const pv = pMap[g]  || { orders:0, revenue:0 };
      const d  = pv.orders > 0 ? (cv.orders - pv.orders) / pv.orders * 100 : (cv.orders > 0 ? 100 : -100);
      return { geo:g, curOrders:cv.orders, priorOrders:pv.orders, curRev:cv.revenue, priorRev:pv.revenue, delta:d };
    }).sort((a,b) => b.curOrders - a.curOrders).slice(0, 20);
  };

  return { states: mapDiff(c.states, pr.states), cities: mapDiff(c.cities, pr.cities) };
}

/* ══════════════════════════════════════════════════════════════════════════
   PAYMENT GATEWAY COMPARISON
══════════════════════════════════════════════════════════════════════════ */

export function buildPaymentComparison(curOrders, priorOrders) {
  const agg = orders => {
    const m = {};
    for (const o of (orders||[])) {
      const gw = o.payment_gateway || 'unknown';
      if (!m[gw]) m[gw] = { gateway:gw, orders:0, revenue:0 };
      m[gw].orders++;
      m[gw].revenue += p(o.total_price);
    }
    return m;
  };
  const c = agg(curOrders), pr = agg(priorOrders);
  const all = new Set([...Object.keys(c), ...Object.keys(pr)]);
  return Array.from(all).map(gw => {
    const cv = c[gw]  || { orders:0, revenue:0 };
    const pv = pr[gw] || { orders:0, revenue:0 };
    const d  = pv.orders > 0 ? (cv.orders - pv.orders) / pv.orders * 100 : (cv.orders > 0 ? 100 : -100);
    return { gateway:gw, curOrders:cv.orders, priorOrders:pv.orders, curRev:cv.revenue, priorRev:pv.revenue, delta:d };
  }).sort((a,b) => b.curOrders - a.curOrders);
}

/* ══════════════════════════════════════════════════════════════════════════
   ORDER VALUE DISTRIBUTION
══════════════════════════════════════════════════════════════════════════ */

export function buildOrderValueDistribution(curOrders, priorOrders) {
  const BUCKETS = [
    { label: '<₹500',       min:0,    max:499 },
    { label: '₹500–1K',    min:500,  max:999 },
    { label: '₹1K–2K',    min:1000, max:1999 },
    { label: '₹2K–5K',    min:2000, max:4999 },
    { label: '>₹5K',       min:5000, max:Infinity },
  ];

  const agg = orders => {
    const m = Object.fromEntries(BUCKETS.map(b => [b.label, 0]));
    for (const o of (orders||[])) {
      const v = p(o.total_price);
      for (const b of BUCKETS) {
        if (v >= b.min && v <= b.max) { m[b.label]++; break; }
      }
    }
    return m;
  };

  const c = agg(curOrders), pr = agg(priorOrders);
  return BUCKETS.map(b => {
    const cv = c[b.label]  || 0;
    const pv = pr[b.label] || 0;
    const d  = pv > 0 ? (cv - pv) / pv * 100 : (cv > 0 ? 100 : 0);
    return { label:b.label, cur:cv, prior:pv, delta:d };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   META INSIGHT AGGREGATION (kept from original)
══════════════════════════════════════════════════════════════════════════ */

const NUM_FIELDS = [
  'spend','impressions','reach','outboundClicks','clicks',
  'lpv','atc','ic','purchases','revenue','threeSec','thruplays',
];

function indexByAdId(rows) {
  const map = {};
  for (const r of (rows||[])) {
    const id = r.adId || 'unknown';
    if (!map[id]) {
      map[id] = { adId:id, adName:r.adName||id, campaignId:r.campaignId, campaignName:r.campaignName, adSetId:r.adSetId, adSetName:r.adSetName, accountKey:r.accountKey };
      for (const f of NUM_FIELDS) map[id][f] = 0;
    }
    for (const f of NUM_FIELDS) map[id][f] += safeNum(r[f]);
  }
  return map;
}

function withDerived(row) {
  const s=safeNum(row.spend), imp=safeNum(row.impressions), oc=safeNum(row.outboundClicks),
        l=safeNum(row.lpv), a=safeNum(row.atc), ic=safeNum(row.ic), pur=safeNum(row.purchases), rev=safeNum(row.revenue);
  return {
    ...row,
    roas:safeDivide(rev,s), cpm:safeDivide(s,imp)*1000, ctr:safeDivide(oc,imp)*100,
    cpr:safeDivide(s,pur), aov:safeDivide(rev,pur),
    lpvRate:safeDivide(l,oc)*100, atcRate:safeDivide(a,l)*100,
    icRate:safeDivide(ic,a)*100, purchaseRate:safeDivide(pur,ic)*100,
    convRate:safeDivide(pur,oc)*100,
  };
}

export function aggregateInsightRows(rows) {
  const t = Object.fromEntries(NUM_FIELDS.map(f=>[f,0]));
  const adIds=new Set(), campIds=new Set();
  for (const r of (rows||[])) {
    for (const f of NUM_FIELDS) t[f]+=safeNum(r[f]);
    if(r.adId) adIds.add(r.adId);
    if(r.campaignId) campIds.add(r.campaignId);
  }
  return withDerived({...t, adCount:adIds.size, campaignCount:campIds.size});
}

export function buildAdComparison(rows7d, rows14d) {
  const map7=indexByAdId(rows7d), map14=indexByAdId(rows14d);
  const all=new Set([...Object.keys(map7),...Object.keys(map14)]);
  const result=[];
  for (const id of all) {
    const raw7=map7[id], raw14=map14[id];
    const cur = raw7 ? withDerived(raw7) : null;
    let prior=null;
    if (raw14) {
      const pr={adId:id, adName:raw14.adName, campaignId:raw14.campaignId, campaignName:raw14.campaignName, adSetId:raw14.adSetId, adSetName:raw14.adSetName, accountKey:raw14.accountKey};
      for (const f of NUM_FIELDS) pr[f]=Math.max(0,safeNum(raw14[f])-safeNum(raw7?.[f]||0));
      prior=withDerived(pr);
    }
    if (!cur && !prior) continue;
    const c=cur||{spend:0,purchases:0,revenue:0,roas:0,cpm:0,ctr:0,lpvRate:0,atcRate:0,impressions:0};
    const pr2=prior||{spend:0,purchases:0,revenue:0,roas:0,cpm:0,ctr:0,lpvRate:0,atcRate:0,impressions:0};
    const d=(cv,pv)=>pv>0?(cv-pv)/pv*100:(cv>0?100:0);
    const spendDelta=d(c.spend,pr2.spend), purchaseDelta=d(c.purchases,pr2.purchases), roasDelta=d(c.roas,pr2.roas);
    let status='stable';
    if (!raw14&&raw7?.spend>0) status='new';
    else if (raw14&&(!raw7||!raw7.spend)) status='stopped';
    else if (purchaseDelta>=20||roasDelta>=15) status='improving';
    else if (purchaseDelta<=-20||roasDelta<=-15) status='declining';
    const meta=cur||prior;
    result.push({adId:id, adName:meta.adName, campaignName:meta.campaignName, adSetName:meta.adSetName, cur, prior, spendDelta, purchaseDelta, roasDelta, status});
  }
  const rank={stopped:0,declining:1,new:2,improving:3,stable:4};
  return result.sort((a,b)=>rank[a.status]!==rank[b.status]?rank[a.status]-rank[b.status]:Math.abs(b.purchaseDelta)-Math.abs(a.purchaseDelta));
}

/* ══════════════════════════════════════════════════════════════════════════
   DEEP ROOT CAUSE ENGINE
══════════════════════════════════════════════════════════════════════════ */

export function computeDeepRootCauses({
  curAgg, priorAgg,
  skuData, trafficData, discountData, geoData, paymentData,
  metaCur, metaPrior,
  newAdsCount = 0, stoppedAdsCount = 0,
  gaAnalysis = null, collectionData = [], adStockoutData = [],
}) {
  const causes = [];
  const totalOrderDelta = priorAgg?.count > 0 ? (curAgg.count - priorAgg.count) / priorAgg.count * 100 : 0;
  const d = (c, pv) => pv > 0 ? (c - pv) / pv * 100 : (c > 0 ? 100 : 0);

  const push = (factor, impactPct, direction, detail, severity, category, action, evidence) =>
    causes.push({ factor, impactPct, direction, detail, severity, category, action, evidence: evidence || [] });

  // ── 1. Overall order volume
  // ── 2. Revenue per order (AOV)
  const aovChg = d(curAgg.aov, priorAgg?.aov);
  if (Math.abs(aovChg) >= 8 && priorAgg?.count > 0)
    push('Average Order Value', aovChg, aovChg>0?'up':'down',
      aovChg>0 ? `AOV up ${aovChg.toFixed(0)}% — customers spending more per order`
               : `AOV down ${Math.abs(aovChg).toFixed(0)}% — customers spending less per order`,
      Math.abs(aovChg)>20?'high':'medium', 'shopify',
      aovChg<0 ? 'Check if high-value SKUs lost traction. Test bundle offers or minimum order thresholds.' : null,
    );

  // ── 3. New vs repeat customer shift
  if (priorAgg?.count > 5) {
    const newPctChg = d(curAgg.newPct, priorAgg.newPct);
    if (Math.abs(newPctChg) >= 15)
      push('New Customer Acquisition', newPctChg, newPctChg>0?'up':'down',
        newPctChg>0
          ? `New customer % up ${newPctChg.toFixed(0)}pts — ads driving more first-time buyers`
          : `New customer % down ${Math.abs(newPctChg).toFixed(0)}pts — acquisition weakening, more repeat`,
        'medium', 'shopify',
        newPctChg<0 ? 'Ensure prospecting/TOF campaigns are active. Check if retargeting is cannibalising budget.' : null,
      );
  }

  // ── 4. Discount rate change (significant promo shift)
  if (priorAgg?.count > 5) {
    const discChg = d(curAgg.discountedPct, priorAgg.discountedPct);
    if (Math.abs(discChg) >= 20)
      push('Discount & Promo Usage', discChg, discChg>0?'up':'down',
        discChg>0
          ? `Discounted order rate up ${discChg.toFixed(0)}pts — higher promo dependency`
          : `Discounted order rate down ${Math.abs(discChg).toFixed(0)}pts — fewer promo orders (promo expired?)`,
        Math.abs(discChg)>35?'high':'medium', 'shopify',
        discChg<0 ? 'Check if a discount code expired or campaign ended. Run limited-time offer to recover.' : null,
      );
  }

  // ── 5. Cancellation rate spike
  if (priorAgg?.count > 3) {
    const cancelChg = d(curAgg.cancelRate, priorAgg.cancelRate);
    if (curAgg.cancelRate > 5 || cancelChg > 50)
      push('Cancellation Rate', -Math.abs(cancelChg), 'down',
        `Cancellation rate: ${curAgg.cancelRate.toFixed(1)}% (prior: ${priorAgg.cancelRate?.toFixed(1)||'0'}%) — elevated cancellations`,
        curAgg.cancelRate>15?'high':'medium', 'shopify',
        'Review cancel reasons. Check for payment failures, fulfilment delays, or incorrect product listings.',
      );
  }

  // ── 6. Traffic source drops (most impactful)
  if (trafficData?.length) {
    const bigDrops = trafficData.filter(s => s.priorOrders >= 2 && s.delta <= -40);
    for (const src of bigDrops.slice(0, 3)) {
      const lostOrders = src.priorOrders - src.curOrders;
      push(
        `Traffic Drop — ${src.source.charAt(0).toUpperCase()+src.source.slice(1)}`,
        src.delta, 'down',
        `${src.source} orders dropped ${Math.abs(src.delta).toFixed(0)}% — lost ${lostOrders} order${lostOrders>1?'s':''} vs prior`,
        Math.abs(src.delta)>70?'high':'medium', 'traffic',
        src.source === 'facebook' || src.source === 'instagram'
          ? 'Check Meta ad delivery, budget caps, and campaign status. Look for rejected creatives or audience fatigue.'
          : src.source === 'google'
            ? 'Check Google Ads campaigns and SEO rankings for key terms.'
            : 'Check this channel\'s campaign status and budget.',
        [`${src.curOrders} orders vs ${src.priorOrders} prior`],
      );
    }

    const bigGains = trafficData.filter(s => s.priorOrders >= 2 && s.delta >= 50);
    for (const src of bigGains.slice(0, 2)) {
      push(
        `Traffic Surge — ${src.source.charAt(0).toUpperCase()+src.source.slice(1)}`,
        src.delta, 'up',
        `${src.source} orders up ${src.delta.toFixed(0)}% — strong channel performance`,
        'low', 'traffic',
        `Scale investment in ${src.source} while it\'s performing.`,
        [`${src.curOrders} orders vs ${src.priorOrders} prior`],
      );
    }
  }

  // ── 7. SKU stockouts contributing to drop
  if (skuData?.length) {
    const stockouts = skuData.filter(s => s.isStockedOut && s.priorQty >= 2);
    if (stockouts.length) {
      const lostEstimate = stockouts.reduce((s, x) => s + x.priorQty, 0);
      push(
        'SKU Stockouts',
        -(lostEstimate / Math.max(priorAgg?.count||1, 1)) * 100,
        'down',
        `${stockouts.length} SKU${stockouts.length>1?'s':''} stocked out: ${stockouts.slice(0,3).map(s=>s.sku).join(', ')}`,
        stockouts.length>=3?'high':'medium', 'inventory',
        'Replenish stock immediately. Create back-in-stock waitlists. Redirect ads to in-stock SKUs.',
        stockouts.slice(0,3).map(s=>`${s.sku}: ${s.priorQty} units/period while in stock`),
      );
    }

    const bigDropSkus = skuData.filter(s => !s.isStockedOut && s.priorQty >= 3 && s.qtyDelta <= -40);
    if (bigDropSkus.length >= 2) {
      push(
        'Key SKUs Underperforming',
        bigDropSkus[0].qtyDelta, 'down',
        `${bigDropSkus.length} top SKUs saw >40% order drop: ${bigDropSkus.slice(0,3).map(s=>s.sku).join(', ')}`,
        'medium', 'inventory',
        'Check if ads are still running for these products. Review landing page and product descriptions.',
        bigDropSkus.slice(0,3).map(s=>`${s.sku}: ${s.priorQty}→${s.curQty} units`),
      );
    }
  }

  // ── 8. Meta spend change (if Meta data available)
  if (metaCur && metaPrior && metaPrior.spend > 0) {
    const spendChg = d(metaCur.spend, metaPrior.spend);
    const roasChg  = d(metaCur.roas,  metaPrior.roas);
    const cpmChg   = d(metaCur.cpm,   metaPrior.cpm);
    const ctrChg   = d(metaCur.ctr,   metaPrior.ctr);
    const lpvChg   = d(metaCur.lpvRate, metaPrior.lpvRate);
    const atcChg   = d(metaCur.atcRate, metaPrior.atcRate);

    if (Math.abs(spendChg) >= 20)
      push('Meta Ad Spend', spendChg, spendChg>0?'up':'down',
        spendChg>0 ? `Ad spend up ${spendChg.toFixed(0)}% — more budget deployed`
                   : `Ad spend down ${Math.abs(spendChg).toFixed(0)}% — budget reduced or campaigns paused`,
        Math.abs(spendChg)>40?'high':'medium', 'meta',
        spendChg<0 ? 'Restore budget on top-performing campaigns. Check for paused ads or exhausted budgets.' : 'Monitor ROAS closely — higher spend can dilute efficiency.',
      );

    if (Math.abs(roasChg) >= 15)
      push('Meta ROAS Efficiency', roasChg, roasChg>0?'up':'down',
        roasChg>0 ? `ROAS up ${roasChg.toFixed(0)}% — better conversion per rupee`
                  : `ROAS down ${Math.abs(roasChg).toFixed(0)}% — ads converting less efficiently`,
        Math.abs(roasChg)>30?'high':'medium', 'meta',
        roasChg<0 ? 'Review creative freshness and audience saturation. Check landing page conversion rate.' : null,
      );

    if (cpmChg >= 20)
      push('Ad Auction Costs (CPM)', -cpmChg, 'down',
        `CPM rose ${cpmChg.toFixed(0)}% — more expensive to reach audience`,
        cpmChg>40?'high':'medium', 'meta',
        'Broaden targeting to find cheaper audiences. Test new interest clusters.',
      );

    if (Math.abs(ctrChg) >= 20)
      push('Creative Engagement (CTR)', ctrChg, ctrChg>0?'up':'down',
        ctrChg>0 ? `CTR up ${ctrChg.toFixed(0)}% — creatives resonating better`
                 : `CTR down ${Math.abs(ctrChg).toFixed(0)}% — creative fatigue`,
        Math.abs(ctrChg)>35?'high':'medium', 'creative',
        ctrChg<0 ? 'Refresh creatives — test new hooks, thumbnails, and opening frames.' : null,
      );

    if (Math.abs(lpvChg) >= 15)
      push('Landing Page (LPV Rate)', lpvChg, lpvChg>0?'up':'down',
        lpvChg>0 ? `LPV Rate up ${lpvChg.toFixed(0)}% — more clickers engaging with the page`
                 : `LPV Rate down ${Math.abs(lpvChg).toFixed(0)}% — higher bounce, possible page load or tracking issue`,
        Math.abs(lpvChg)>30?'high':'medium', 'funnel',
        lpvChg<0 ? 'Check page speed (GTmetrix). Verify Meta pixel is firing. Look for checkout page errors.' : null,
      );

    if (Math.abs(atcChg) >= 20)
      push('Add-to-Cart Rate', atcChg, atcChg>0?'up':'down',
        atcChg>0 ? `ATC Rate up ${atcChg.toFixed(0)}% — offer / product appeal stronger`
                 : `ATC Rate down ${Math.abs(atcChg).toFixed(0)}% — weaker offer or seasonal intent drop`,
        Math.abs(atcChg)>35?'high':'medium', 'funnel',
        atcChg<0 ? 'Review product pricing vs competitors. Consider limited-time offer to restore ATC momentum.' : null,
      );

    if (stoppedAdsCount >= 2)
      push('Ads Stopped/Paused', -(stoppedAdsCount*10), 'down',
        `${stoppedAdsCount} ads that were running stopped this period — delivery surface reduced`,
        stoppedAdsCount>=5?'high':'medium', 'meta',
        'Identify which ads paused. Relaunch winners with fresh creatives or duplicate to new ad sets.',
      );
  }

  // ── 9. GA cross-analysis (traffic vs conversion diagnosis)
  if (gaAnalysis?.hasCurData) {
    for (const diag of (gaAnalysis.diagnosis || [])) {
      push(
        diag.label,
        diag.type === 'traffic' ? gaAnalysis.sessionDelta : gaAnalysis.convRateDelta,
        'down', diag.detail, diag.severity, 'ga', diag.action,
      );
    }
    // GA revenue delta if significant and no other GA cause yet
    if (Math.abs(gaAnalysis.gaRevDelta) >= 15 && gaAnalysis.priorRevenue > 0 && !gaAnalysis.diagnosis.length) {
      push(
        'GA Revenue Delta',
        gaAnalysis.gaRevDelta,
        gaAnalysis.gaRevDelta > 0 ? 'up' : 'down',
        `GA reports revenue ${gaAnalysis.gaRevDelta > 0 ? 'up' : 'down'} ${Math.abs(gaAnalysis.gaRevDelta).toFixed(0)}% — cross-checking with Shopify data`,
        Math.abs(gaAnalysis.gaRevDelta) > 30 ? 'medium' : 'low', 'ga', null,
      );
    }
  }

  // ── 10. Collection-level drops (top declining collection)
  if (collectionData?.length) {
    const decliners = collectionData
      .filter(c => c.priorRev >= 500 && c.revDelta <= -25)
      .sort((a, b) => a.revDelta - b.revDelta);
    for (const col of decliners.slice(0, 2)) {
      const stockNote = col.oosSkusNow?.length ? ` ${col.oosSkusNow.length} SKU(s) currently OOS.` : '';
      push(
        `Collection Drop: ${col.collection}`,
        col.revDelta, 'down',
        `"${col.collection}" revenue down ${Math.abs(col.revDelta).toFixed(0)}% (₹${Math.round(col.priorRev)} → ₹${Math.round(col.curRev)}).${stockNote}`,
        Math.abs(col.revDelta) > 50 ? 'high' : 'medium', 'collection',
        col.oosSkusNow?.length
          ? 'Replenish OOS SKUs or pause ads for this collection until stock is restored.'
          : 'Check if ads are still active for this collection. Review pricing and offer.',
        col.oosSkusNow?.slice(0, 3).map(s => `OOS: ${s}`) || [],
      );
    }
  }

  // ── 11. Ad stockout impact (ads wasting spend on OOS collections)
  if (adStockoutData?.length) {
    const highImpact = adStockoutData.filter(a => a.severity === 'high' || a.wastedEst > 500);
    if (highImpact.length) {
      const totalWasted = highImpact.reduce((s, a) => s + a.wastedEst, 0);
      push(
        'Ads Running on OOS Collections',
        -Math.min(highImpact.length * 20, 80), 'down',
        `${highImpact.length} ad${highImpact.length > 1 ? 's' : ''} spending on collections with zero-stock SKUs. ~₹${Math.round(totalWasted)} estimated wasted this period.`,
        totalWasted > 2000 ? 'high' : 'medium', 'inventory',
        'Pause ads for OOS collections immediately. Redirect budget to in-stock collections or use catalog ads with inventory filter.',
        highImpact.slice(0, 3).map(a => `${a.adName}: ₹${a.spend7d.toFixed(0)} spend, ${a.oosCount} OOS SKUs`),
      );
    }
  }

  // Sort by severity then magnitude
  const sevR = {high:2, medium:1, low:0};
  return causes.sort((a,b) =>
    sevR[b.severity] !== sevR[a.severity] ? sevR[b.severity] - sevR[a.severity]
    : Math.abs(b.impactPct) - Math.abs(a.impactPct)
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   COLLECTION BREAKDOWN (group by productType from inventoryMap)
══════════════════════════════════════════════════════════════════════════ */

export function buildCollectionBreakdown(curOrders, priorOrders, inventoryMap = {}) {
  const agg = (orders) => {
    const m = {};
    for (const o of (orders || [])) {
      for (const li of (o.line_items || [])) {
        const sku = (li.sku || '').trim().toUpperCase();
        const col = (sku && inventoryMap[sku]?.productType) || li.vendor || 'Uncategorized';
        const qty = parseInt(li.quantity) || 1;
        const rev = p(li.price) * qty;
        if (!m[col]) m[col] = { collection: col, units: 0, revenue: 0, orders: new Set(), oosSkus: new Set() };
        m[col].units   += qty;
        m[col].revenue += rev;
        m[col].orders.add(o.id || o.order_number);
        if (sku && inventoryMap[sku]?.stock === 0) m[col].oosSkus.add(sku);
      }
    }
    return Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, { ...v, orderCount: v.orders.size, oosCount: v.oosSkus.size, orders: undefined, oosSkus: undefined }])
    );
  };

  const cur   = agg(curOrders);
  const prior = agg(priorOrders);
  const allCols = new Set([...Object.keys(cur), ...Object.keys(prior)]);

  return Array.from(allCols).map(col => {
    const c = cur[col]   || { units: 0, revenue: 0, orderCount: 0, oosCount: 0 };
    const pv = prior[col] || { units: 0, revenue: 0, orderCount: 0, oosCount: 0 };
    const revDelta  = pv.revenue > 0 ? (c.revenue - pv.revenue) / pv.revenue * 100 : (c.revenue > 0 ? 100 : -100);
    const unitDelta = pv.units > 0   ? (c.units - pv.units)     / pv.units * 100   : (c.units > 0   ? 100 : -100);
    // compute OOS skus for this collection right now
    const oosSkusNow = Object.entries(inventoryMap)
      .filter(([, inv]) => (inv.productType || '') === col && inv.stock === 0)
      .map(([sku]) => sku);
    const lowSkusNow = Object.entries(inventoryMap)
      .filter(([, inv]) => (inv.productType || '') === col && inv.stock > 0 && inv.stock <= 5)
      .map(([sku]) => sku);
    return {
      collection: col,
      curRev: c.revenue, priorRev: pv.revenue,
      curUnits: c.units, priorUnits: pv.units,
      curOrders: c.orderCount, priorOrders: pv.orderCount,
      revDelta, unitDelta,
      oosSkusNow, lowSkusNow,
      hasStockIssue: oosSkusNow.length > 0 || lowSkusNow.length > 0,
    };
  }).sort((a, b) => (b.curRev + b.priorRev) - (a.curRev + a.priorRev));
}

/* ══════════════════════════════════════════════════════════════════════════
   GA CROSS-ANALYSIS (compare GA sessions + conv rate to order changes)
══════════════════════════════════════════════════════════════════════════ */

export function buildGaCrossAnalysis(gaData, curSince, curUntil, priorSince, priorUntil) {
  if (!gaData?.dailyTrend?.length) return null;

  // GA dates: 'YYYYMMDD' → 'YYYY-MM-DD'
  const gaIso = s => s?.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : (s || '');
  const n = v => parseFloat(v || 0);

  const filterDays = (since, until) => gaData.dailyTrend.filter(d => {
    const iso = gaIso(d.date);
    return iso >= since && iso <= until;
  });

  const sumDays = (days) => days.reduce((acc, d) => {
    acc.sessions    += n(d.sessions);
    acc.users       += n(d.totalUsers);
    acc.newUsers    += n(d.newUsers);
    acc.conversions += n(d.conversions);
    acc.revenue     += n(d.purchaseRevenue);
    acc.bounceSum   += n(d.bounceRate);
    acc.count++;
    return acc;
  }, { sessions:0, users:0, newUsers:0, conversions:0, revenue:0, bounceSum:0, count:0 });

  const curDays   = filterDays(curSince,   curUntil);
  const priorDays = filterDays(priorSince, priorUntil);

  if (!curDays.length && !priorDays.length) return null;

  const cs = sumDays(curDays);
  const ps = sumDays(priorDays);

  const curConvRate   = cs.sessions > 0 ? cs.conversions / cs.sessions * 100 : 0;
  const priorConvRate = ps.sessions > 0 ? ps.conversions / ps.sessions * 100 : 0;
  const curBounce     = cs.count > 0 ? cs.bounceSum / cs.count * 100 : 0;
  const priorBounce   = ps.count > 0 ? ps.bounceSum / ps.count * 100 : 0;

  const dPct = (c, pv) => pv > 0 ? (c - pv) / pv * 100 : (c > 0 ? 100 : 0);

  const sessionDelta  = dPct(cs.sessions, ps.sessions);
  const convRateDelta = dPct(curConvRate, priorConvRate);
  const bounceDelta   = dPct(curBounce, priorBounce);
  const gaRevDelta    = dPct(cs.revenue, ps.revenue);

  // Diagnose: traffic vs conversion problem
  const diagnosis = [];
  if (ps.sessions > 0) {
    if (sessionDelta < -15 && Math.abs(convRateDelta) < 10)
      diagnosis.push({ type:'traffic', label:'Traffic Drop (not conversion)', severity:'high',
        detail:`GA sessions down ${Math.abs(sessionDelta).toFixed(0)}% but conversion rate is stable — the problem is upstream: less ad delivery, lower CTR, or reduced organic traffic.`,
        action:'Check Meta spend/CTR and organic traffic. Paused campaigns are the most common cause.' });

    if (Math.abs(sessionDelta) < 10 && convRateDelta < -15)
      diagnosis.push({ type:'conversion', label:'Conversion Drop (not traffic)', severity:'high',
        detail:`GA sessions stable but conversion rate dropped ${Math.abs(convRateDelta).toFixed(0)}% — the funnel is leaking. Likely cause: landing page issue, OOS products, offer change, or checkout friction.`,
        action:'Check landing page speed, OOS products, and checkout errors. Verify pixel firing.' });

    if (sessionDelta < -15 && convRateDelta < -15)
      diagnosis.push({ type:'both', label:'Traffic + Conversion Both Dropped', severity:'high',
        detail:`Both GA sessions and conversion rate declining simultaneously — structural issue: campaign cuts, audience exhaustion, or seasonal pullback compounded by funnel problems.`,
        action:'Restore ad budget + fix the funnel. Check creative freshness and landing page.' });

    if (bounceDelta > 25 && priorBounce > 0)
      diagnosis.push({ type:'bounce', label:'Bounce Rate Spike', severity:'medium',
        detail:`Bounce rate up ${bounceDelta.toFixed(0)}% — visitors arriving and leaving immediately. Possible page load issues, creative-page mismatch, or mobile UX problem.`,
        action:'Run GTmetrix on landing page. Ensure ad creative matches LP messaging.' });
  }

  return {
    curSessions: cs.sessions,   priorSessions: ps.sessions,   sessionDelta,
    curConvRate,                 priorConvRate,                convRateDelta,
    curBounce,                   priorBounce,                  bounceDelta,
    curRevenue: cs.revenue,      priorRevenue: ps.revenue,     gaRevDelta,
    curUsers: cs.users,          priorUsers: ps.users,
    diagnosis,
    hasCurData:   curDays.length > 0,
    hasPriorData: priorDays.length > 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   AD STOCKOUT IMPACT (ads running on zero-stock collections)
══════════════════════════════════════════════════════════════════════════ */

export function buildAdStockoutImpact(adComp, manualMap = {}, inventoryMap = {}) {
  // Build collection → OOS/low SKUs map
  const colToOos = {};
  for (const [sku, inv] of Object.entries(inventoryMap)) {
    const col = (inv.productType || '').toUpperCase();
    if (!col) continue;
    if (!colToOos[col]) colToOos[col] = { oos: [], low: [] };
    if (inv.stock === 0)                   colToOos[col].oos.push({ sku, title: inv.title });
    else if (inv.stock > 0 && inv.stock <= 5) colToOos[col].low.push({ sku, title: inv.title, stock: inv.stock });
  }

  const result = [];
  for (const ad of (adComp || [])) {
    if (!ad.cur?.spend || ad.cur.spend < 50) continue; // skip tiny spend
    const manual = manualMap[ad.adId] || {};
    const adColRaw = manual.Collection || '';
    if (!adColRaw || adColRaw === 'none' || adColRaw === 'All Mix') continue;
    const adCol = adColRaw.toUpperCase();

    const colData = colToOos[adCol];
    if (!colData || (colData.oos.length === 0 && colData.low.length === 0)) continue;

    const oosCount = colData.oos.length;
    const lowCount = colData.low.length;
    const totalInCol = Object.values(inventoryMap).filter(inv => (inv.productType||'').toUpperCase() === adCol).length;
    const oosPct = totalInCol > 0 ? oosCount / totalInCol : 0;
    const wastedEst = safeNum(ad.cur.spend) * Math.min(oosPct * 1.5, 1);

    result.push({
      adId: ad.adId, adName: ad.adName, campaignName: ad.campaignName,
      collection: adColRaw,
      spend7d: safeNum(ad.cur.spend),
      roas7d:  safeNum(ad.cur.roas),
      oosSkus: colData.oos.slice(0, 5),
      lowSkus: colData.low.slice(0, 3),
      oosCount, lowCount, totalInCol, oosPct,
      severity: oosPct > 0.5 ? 'high' : oosCount > 0 ? 'medium' : 'low',
      wastedEst: Math.round(wastedEst),
    });
  }

  return result.sort((a, b) => b.wastedEst - a.wastedEst);
}

/* ══════════════════════════════════════════════════════════════════════════
   LEGACY EXPORTS (kept for backward compat)
══════════════════════════════════════════════════════════════════════════ */

export function buildShopifyComparison(orders, daysBack) {
  const now = Date.now();
  const curStart = now - daysBack * 86400000, priorStart = curStart - daysBack * 86400000;
  const current = [], prior = [];
  for (const o of (orders||[])) {
    const t = new Date(o.created_at||o.processed_at||0).getTime();
    if (isNaN(t)) continue;
    if (t >= curStart) current.push(o); else if (t >= priorStart) prior.push(o);
  }
  const agg = list => {
    const out = { count:0, revenue:0, aov:0, newCount:0, repeatCount:0, skuMap:{} };
    const seen = new Set();
    for (const o of list) {
      out.count++; out.revenue += p(o.total_price||0);
      const key = (o.email||'').toLowerCase();
      if (key && seen.has(key)) out.repeatCount++; else { out.newCount++; if(key) seen.add(key); }
      for (const li of (o.line_items||[])) {
        const sku = (li.sku||li.title||'').trim().toUpperCase()||'UNKNOWN';
        if (!out.skuMap[sku]) out.skuMap[sku]={sku,qty:0,revenue:0};
        out.skuMap[sku].qty+=parseInt(li.quantity)||1;
        out.skuMap[sku].revenue+=p(li.price||0)*(parseInt(li.quantity)||1);
      }
    }
    out.aov = out.count > 0 ? out.revenue / out.count : 0;
    return out;
  };
  return { current:agg(current), prior:agg(prior), currentOrders:current, priorOrders:prior, daysBack };
}

export function buildProductComparison(curOrders, priorOrders) {
  return buildSkuDeepDive(curOrders, priorOrders);
}

export function computeRootCauses(args) {
  return computeDeepRootCauses(args);
}
