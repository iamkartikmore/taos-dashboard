/**
 * Cross-system Google Ads intelligence — the moat.
 *
 * What Google Ads can't tell you on its own:
 *   • True margin (Google reports revenue; we have SKU costs from Shopify)
 *   • True CAC-to-LTV (Google sees a first-order conversion; we see the
 *     customer's 90-day revenue)
 *   • Inventory reality (Google keeps spending on out-of-stock products)
 *   • Meta × Google overlap (if the same user converts, whose credit?)
 *   • Pacing (Ads UI tells you "limited by budget" but not "you're
 *     22% ahead of monthly burn")
 *   • Brand cannibalisation (paid branded keywords cost you ₹X to
 *     acquire a user who would have come via organic anyway)
 *
 * Each helper is a pure function that takes already-normalised Google
 * Ads data plus Shopify orders / inventory / Meta ad rows. Anything
 * missing just degrades gracefully — callers can invoke any subset.
 */

/* ─── HELPERS ─────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const p = v => parseFloat(v || 0);

function parseUtm(landingSite, noteAttributes) {
  const notes = {};
  (noteAttributes || []).forEach(({ name, value }) => {
    if (name && String(name).toLowerCase().startsWith('utm_')) notes[String(name).toLowerCase()] = value;
  });
  if (notes.utm_source) return {
    source: notes.utm_source, medium: notes.utm_medium || '', campaign: notes.utm_campaign || '',
  };
  if (!landingSite) return null;
  try {
    const url = String(landingSite).startsWith('http') ? landingSite : `https://x.com${landingSite}`;
    const q = new URL(url).searchParams;
    const source = q.get('utm_source');
    if (!source) return null;
    return { source, medium: q.get('utm_medium') || '', campaign: q.get('utm_campaign') || '' };
  } catch { return null; }
}

function normSrc(s) { return String(s || '').toLowerCase().replace(/[_-]/g, ''); }
function isGoogle(utm) {
  const src = normSrc(utm?.source), med = normSrc(utm?.medium);
  return src.includes('google') || med.includes('cpc') || med.includes('ppc') || src === 'g' || src === 'googleads';
}
function isMeta(utm) {
  const src = normSrc(utm?.source), med = normSrc(utm?.medium);
  return src.includes('facebook') || src.includes('meta') || src.includes('ig') || src.includes('instagram')
      || src === 'fb' || med.includes('paidsocial');
}

function orderRevenue(o) {
  return p(o.total_price) - p(o.total_refunded || 0);
}

function orderEmailKey(o) {
  return (o.email || o.customer?.email || '').toLowerCase().trim() || null;
}

/* ─── MARGIN-WEIGHTED ROAS ─────────────────────────────────────────── */
/**
 * Build per-SKU gross margin from Shopify orders (price × qty - cost × qty).
 * If `cost_price` isn't in the order lines (Shopify doesn't return it by
 * default from the Admin API), caller can pass a SKU→margin% map instead.
 *
 * @param orders    Shopify orders
 * @param skuMargin optional { [sku]: 0..1 } override
 * @returns { [sku]: { units, revenue, cost, margin, marginPct } }
 */
export function skuMarginFromOrders(orders, skuMargin = null) {
  const out = {};
  for (const o of orders || []) {
    if (o.cancelled_at) continue;
    for (const li of o.line_items || []) {
      const sku = (li.sku || '').trim();
      if (!sku) continue;
      const qty = p(li.quantity);
      const rev = p(li.price) * qty;
      // Prefer explicit cost_price when the admin scope provided it
      const unitCost = p(li.cost_price ?? li.unit_cost ?? 0);
      const cost = (unitCost > 0) ? unitCost * qty
                 : (skuMargin?.[sku] != null) ? rev * (1 - skuMargin[sku])
                 : 0;
      const e = out[sku] || { sku, units: 0, revenue: 0, cost: 0 };
      e.units    += qty;
      e.revenue  += rev;
      e.cost     += cost;
      out[sku] = e;
    }
  }
  for (const e of Object.values(out)) {
    e.margin     = e.revenue - e.cost;
    e.marginPct  = e.revenue > 0 ? e.margin / e.revenue : 0;
  }
  return out;
}

/**
 * Re-score each Shopping product row with its margin — so a ₹10k revenue
 * campaign on a 10%-margin sugar bag is clearly worse than a ₹5k revenue
 * campaign on a 60%-margin cosmetic.
 */
export function marginWeightShopping(shopping, skuMarginLookup, defaultMarginPct = 0.25) {
  return (shopping || []).map(s => {
    const sku = s.productId;
    const m = skuMarginLookup?.[sku];
    const marginPct = m?.marginPct ?? defaultMarginPct;
    const grossMargin = (s.conversionValue || 0) * marginPct;
    const netProfit   = grossMargin - (s.cost || 0);
    return {
      ...s,
      marginPct,
      grossMargin,
      netProfit,
      marginRoas: s.cost > 0 ? grossMargin / s.cost : 0,
      payback:    netProfit, // net contribution after ad cost
    };
  }).sort((a, b) => b.netProfit - a.netProfit);
}

/**
 * Campaign-level margin ROAS. Without per-order SKU mix this uses the
 * account-wide margin% as a fallback. If the caller pre-computes a
 * per-campaign margin% (via campaign-tag → SKU attribution), pass it in.
 */
export function marginWeightCampaigns(campaigns, { defaultMarginPct = 0.25, perCampaignMarginPct = null } = {}) {
  return (campaigns || []).map(c => {
    const marginPct = perCampaignMarginPct?.[c.id] ?? defaultMarginPct;
    const grossMargin = (c.conversionValue || 0) * marginPct;
    const netProfit   = grossMargin - (c.cost || 0);
    return {
      ...c,
      marginPct,
      grossMargin,
      netProfit,
      marginRoas: c.cost > 0 ? grossMargin / c.cost : 0,
    };
  });
}

/* ─── LTV-ADJUSTED CAC ─────────────────────────────────────────────── */
/**
 * For each Google-attributed acquisition (first order with UTM source =
 * google), sum revenue over the next `horizonDays`. Compare to Ads spend
 * over the same cohort window → "true CAC" vs "90-day customer value".
 *
 * Heuristic — we can't tie an individual click to an individual email
 * from the Ads API, but UTM attribution from Shopify landing_site gets
 * us close.
 */
export function ltvForGoogleAcquired(orders, { horizonDays = 90 } = {}) {
  const byEmail = new Map();
  for (const o of orders || []) {
    if (o.cancelled_at) continue;
    const email = orderEmailKey(o);
    if (!email) continue;
    const utm = parseUtm(o.landing_site, o.note_attributes);
    const ts = new Date(o.created_at).getTime();
    if (!isFinite(ts)) continue;
    const e = byEmail.get(email) || { email, firstOrderTs: Infinity, firstUtm: null, orders: [] };
    e.orders.push({ ts, revenue: orderRevenue(o), utm });
    if (ts < e.firstOrderTs) { e.firstOrderTs = ts; e.firstUtm = utm; }
    byEmail.set(email, e);
  }

  const googleCohort = [];
  for (const c of byEmail.values()) {
    if (!isGoogle(c.firstUtm)) continue;
    const horizon = c.firstOrderTs + horizonDays * DAY;
    const revH = c.orders.filter(o => o.ts <= horizon).reduce((a, b) => a + b.revenue, 0);
    const ordersH = c.orders.filter(o => o.ts <= horizon).length;
    googleCohort.push({ email: c.email, firstOrderTs: c.firstOrderTs, revenueHorizon: revH, ordersHorizon: ordersH });
  }

  const n = googleCohort.length;
  const totalRev = googleCohort.reduce((a, b) => a + b.revenueHorizon, 0);
  const avgLtv = n > 0 ? totalRev / n : 0;
  const avgOrders = n > 0 ? googleCohort.reduce((a, b) => a + b.ordersHorizon, 0) / n : 0;
  return {
    customers: n,
    horizonDays,
    avgLtv,
    avgOrdersPerCustomer: avgOrders,
    totalRevenueHorizon: totalRev,
    cohort: googleCohort,
  };
}

/**
 * Compare Google spend over a window to the LTV of customers acquired.
 */
export function trueCacVsLtv({ googleSpend, cohort }) {
  const customers = cohort?.customers || 0;
  const avgLtv    = cohort?.avgLtv    || 0;
  const cac = customers > 0 ? googleSpend / customers : 0;
  const ltvCacRatio = cac > 0 ? avgLtv / cac : 0;
  return {
    customers, googleSpend, cac, avgLtv, ltvCacRatio,
    verdict:
      ltvCacRatio >= 3   ? 'healthy'   :
      ltvCacRatio >= 1.5 ? 'acceptable':
      ltvCacRatio >= 1   ? 'thin'      :
                           'unprofitable',
  };
}

/* ─── OUT-OF-STOCK KILL SWITCH ─────────────────────────────────────── */
/**
 * Flag shopping products that are getting spend while inventory is zero
 * or dangerously low. Inventory lookup is a { [sku]: qty } map the caller
 * builds from Shopify products/variants.
 */
export function oosKillSwitch(shopping, inventoryBySku, { lowStockThreshold = 5 } = {}) {
  if (!shopping?.length || !inventoryBySku) return [];
  const flags = [];
  for (const s of shopping) {
    const sku = s.productId;
    const qty = inventoryBySku[sku];
    if (qty == null) continue; // no inventory data → can't judge
    if (qty > lowStockThreshold) continue;
    flags.push({
      productId: sku,
      productTitle: s.productTitle,
      spend: s.cost || 0,
      clicks: s.clicks || 0,
      conversions: s.conversions || 0,
      inventory: qty,
      severity: qty === 0 ? 'critical' : 'warn',
      action: qty === 0
        ? `Pause product "${s.productTitle}" in the Merchant Center feed — 0 in stock, ₹${Math.round(s.cost || 0).toLocaleString()} spent.`
        : `Reduce bids on "${s.productTitle}" — ${qty} units left, will sell out before the ad spend pays back.`,
      impactRs: Math.round(s.cost || 0),
    });
  }
  return flags.sort((a, b) => b.spend - a.spend);
}

/* ─── META × GOOGLE OVERLAP ────────────────────────────────────────── */
/**
 * Estimate overlap between Google and Meta attribution using Shopify
 * orders. We can't see a true multi-touch journey, but we can at least
 * count customers whose first orders were Google-attributed vs
 * Meta-attributed vs both (via later orders).
 */
export function metaGoogleOverlap(orders) {
  const byEmail = new Map();
  for (const o of orders || []) {
    if (o.cancelled_at) continue;
    const email = orderEmailKey(o);
    if (!email) continue;
    const utm = parseUtm(o.landing_site, o.note_attributes);
    const e = byEmail.get(email) || { email, google: false, meta: false, other: false, orders: 0, revenue: 0 };
    e.orders   += 1;
    e.revenue  += orderRevenue(o);
    if (isGoogle(utm)) e.google = true;
    else if (isMeta(utm)) e.meta = true;
    else e.other = true;
    byEmail.set(email, e);
  }
  let googleOnly = 0, metaOnly = 0, both = 0, otherOnly = 0;
  let googleOnlyRev = 0, metaOnlyRev = 0, bothRev = 0;
  for (const e of byEmail.values()) {
    if (e.google && e.meta) { both++; bothRev += e.revenue; }
    else if (e.google) { googleOnly++; googleOnlyRev += e.revenue; }
    else if (e.meta)   { metaOnly++;   metaOnlyRev   += e.revenue; }
    else if (e.other)  otherOnly++;
  }
  const totalTouched = googleOnly + metaOnly + both;
  return {
    customers: byEmail.size,
    googleOnly, metaOnly, both, otherOnly,
    googleOnlyRev, metaOnlyRev, bothRev,
    overlapPct:  totalTouched > 0 ? both / totalTouched : 0,
    incrementality: {
      // If `both` is large, the two channels are overlapping → total
      // attributed spend exceeds true incremental spend.
      verdict: totalTouched === 0 ? 'insufficient_data'
             : (both / totalTouched) >= 0.3 ? 'high_overlap — likely double-counting'
             : (both / totalTouched) >= 0.15 ? 'moderate_overlap'
             : 'low_overlap — channels are additive',
    },
  };
}

/* ─── BRAND-KEYWORD CANNIBALISATION ────────────────────────────────── */
/**
 * Flag branded-keyword spend — customers searching your brand would
 * usually arrive via organic for free. If the rec engine sees an
 * expensive branded campaign with high CTR/ROAS, don't *kill* it
 * (competitors can squat), but size the opportunity.
 */
export function brandCannibalisation(keywords, brandName) {
  if (!keywords?.length || !brandName) return null;
  const brand = String(brandName).toLowerCase();
  const tokens = brand.split(/\s+/).filter(t => t.length >= 3);
  const match = (kw) => {
    const k = (kw || '').toLowerCase();
    return tokens.some(t => k.includes(t));
  };
  const branded = keywords.filter(k => match(k.keyword));
  if (!branded.length) return null;
  const spend = branded.reduce((a, b) => a + (b.cost || 0), 0);
  const conv  = branded.reduce((a, b) => a + (b.conversions || 0), 0);
  const rev   = branded.reduce((a, b) => a + (b.conversionValue || 0), 0);
  // Rule of thumb: ~60% of branded clicks would convert via organic/direct.
  const wastedPct = 0.6;
  return {
    keywordCount: branded.length,
    spend, conversions: conv, revenue: rev,
    estimatedCannibalised: Math.round(spend * wastedPct),
    verdict: spend > 2000 ? 'sizeable — test reducing brand bids' : 'small — probably leave alone',
  };
}

/* ─── SPEND PACING / FORECAST ──────────────────────────────────────── */
/**
 * Month-to-date spend vs simple linear projection to month end.
 * Caller supplies `monthlyTarget` (optional). If omitted, we just return
 * the projection with no delta.
 */
export function spendPacing(campaignsDaily, { monthlyTarget = null, now = Date.now() } = {}) {
  if (!campaignsDaily?.length) return null;
  const n = new Date(now);
  const yr = n.getUTCFullYear(), mo = n.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
  const monthStart = new Date(Date.UTC(yr, mo, 1)).toISOString().slice(0, 10);
  const today = n.toISOString().slice(0, 10);

  let mtdSpend = 0;
  for (const r of campaignsDaily) {
    if (r.date >= monthStart && r.date <= today) mtdSpend += r.cost || 0;
  }
  const dayOfMonth = Number(today.slice(8, 10));
  const avgDaily = dayOfMonth > 0 ? mtdSpend / dayOfMonth : 0;
  const projected = avgDaily * daysInMonth;
  const pacePct = monthlyTarget ? (mtdSpend / monthlyTarget) - (dayOfMonth / daysInMonth) : null;
  return {
    mtdSpend, projected, dayOfMonth, daysInMonth, avgDaily,
    monthlyTarget,
    pacePct,
    verdict: pacePct == null ? null
           : pacePct >  0.1  ? 'over-pacing — consider tapering'
           : pacePct < -0.1  ? 'under-pacing — catch up or redeploy'
           :                    'on-pace',
  };
}

/* ─── ORCHESTRATOR ─────────────────────────────────────────────────── */
/**
 * One-call wrapper that runs every cross-system calculation for which
 * the caller provided the required inputs, gracefully skipping the rest.
 */
export function runCrossSystem({ googleAds, orders, inventoryBySku, brandName, monthlyTarget, skuMargin, defaultMarginPct = 0.25, horizonDays = 90 }) {
  const out = {};
  if (orders?.length) {
    const skuMarginLookup = skuMarginFromOrders(orders, skuMargin);
    out.skuMargin = skuMarginLookup;
    if (googleAds?.shopping?.length) {
      out.marginShopping = marginWeightShopping(googleAds.shopping, skuMarginLookup, defaultMarginPct);
    }
    const cohort = ltvForGoogleAcquired(orders, { horizonDays });
    out.ltvCohort = cohort;
    if (googleAds?.campaigns?.length) {
      const googleSpend = googleAds.campaigns.reduce((a, b) => a + (b.cost || 0), 0);
      out.cacVsLtv = trueCacVsLtv({ googleSpend, cohort });
      out.marginCampaigns = marginWeightCampaigns(googleAds.campaigns, { defaultMarginPct });
    }
    out.overlap = metaGoogleOverlap(orders);
  }
  if (googleAds?.shopping?.length && inventoryBySku) {
    out.oosFlags = oosKillSwitch(googleAds.shopping, inventoryBySku);
  }
  if (googleAds?.keywords?.length && brandName) {
    out.brandCannibal = brandCannibalisation(googleAds.keywords, brandName);
  }
  if (googleAds?.campaignsDaily?.length) {
    out.pacing = spendPacing(googleAds.campaignsDaily, { monthlyTarget });
  }
  return out;
}
