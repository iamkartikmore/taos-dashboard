/* ─── PERIOD COMPARISON ANALYTICS ─────────────────────────────────────── */
// Compares current period vs prior period across Meta ads + Shopify orders.
//
// Meta "prior 7D" is derived by subtracting insights7d from insights14d per ad.
// Shopify comparison is date-filtered from the loaded orders array.

import { safeNum, safeDivide } from './analytics';

/* ── numeric fields aggregated per ad ──────────────────────────────────── */
const NUM_FIELDS = [
  'spend', 'impressions', 'reach', 'outboundClicks', 'clicks',
  'lpv', 'atc', 'ic', 'purchases', 'revenue', 'threeSec', 'thruplays',
];

function indexByAdId(rows) {
  const map = {};
  for (const r of (rows || [])) {
    const id = r.adId || 'unknown';
    if (!map[id]) {
      map[id] = {
        adId: id,
        adName:       r.adName       || id,
        campaignId:   r.campaignId   || '',
        campaignName: r.campaignName || '',
        adSetId:      r.adSetId      || '',
        adSetName:    r.adSetName    || '',
        accountKey:   r.accountKey   || '',
      };
      for (const f of NUM_FIELDS) map[id][f] = 0;
    }
    for (const f of NUM_FIELDS) map[id][f] += safeNum(r[f]);
  }
  return map;
}

function withDerived(row) {
  const s   = safeNum(row.spend);
  const imp = safeNum(row.impressions);
  const oc  = safeNum(row.outboundClicks);
  const l   = safeNum(row.lpv);
  const a   = safeNum(row.atc);
  const ic  = safeNum(row.ic);
  const p   = safeNum(row.purchases);
  const rev = safeNum(row.revenue);
  return {
    ...row,
    roas:        safeDivide(rev, s),
    cpm:         safeDivide(s, imp) * 1000,
    ctr:         safeDivide(oc, imp) * 100,
    cpr:         safeDivide(s, p),
    aov:         safeDivide(rev, p),
    lpvRate:     safeDivide(l, oc) * 100,
    atcRate:     safeDivide(a, l) * 100,
    icRate:      safeDivide(ic, a) * 100,
    purchaseRate: safeDivide(p, ic) * 100,
    convRate:    safeDivide(p, oc) * 100,
  };
}

/* ─── Aggregate rows → totals ──────────────────────────────────────────── */
export function aggregateInsightRows(rows) {
  const totals = Object.fromEntries(NUM_FIELDS.map(f => [f, 0]));
  const adIds = new Set();
  const campIds = new Set();
  for (const r of (rows || [])) {
    for (const f of NUM_FIELDS) totals[f] += safeNum(r[f]);
    if (r.adId)       adIds.add(r.adId);
    if (r.campaignId) campIds.add(r.campaignId);
  }
  return withDerived({ ...totals, adCount: adIds.size, campaignCount: campIds.size });
}

/* ─── Per-ad comparison (current 7D vs prior 7D via 14D subtraction) ──── */
export function buildAdComparison(rows7d, rows14d) {
  const map7  = indexByAdId(rows7d);
  const map14 = indexByAdId(rows14d);
  const allIds = new Set([...Object.keys(map7), ...Object.keys(map14)]);
  const result = [];

  for (const id of allIds) {
    const raw7  = map7[id];
    const raw14 = map14[id];

    const cur = raw7 ? withDerived(raw7) : null;

    let prior = null;
    if (raw14) {
      const p = {
        adId: id, adName: raw14.adName,
        campaignId: raw14.campaignId, campaignName: raw14.campaignName,
        adSetId: raw14.adSetId, adSetName: raw14.adSetName,
        accountKey: raw14.accountKey,
      };
      for (const f of NUM_FIELDS) {
        p[f] = Math.max(0, safeNum(raw14[f]) - safeNum(raw7?.[f] || 0));
      }
      prior = withDerived(p);
    }

    if (!cur && !prior) continue;

    const c = cur   || { spend:0, purchases:0, revenue:0, roas:0, cpm:0, ctr:0, lpvRate:0, atcRate:0, impressions:0 };
    const p2 = prior || { spend:0, purchases:0, revenue:0, roas:0, cpm:0, ctr:0, lpvRate:0, atcRate:0, impressions:0 };

    const delta = (cv, pv) => pv > 0 ? (cv - pv) / pv * 100 : (cv > 0 ? 100 : 0);
    const spendDelta    = delta(c.spend, p2.spend);
    const purchaseDelta = delta(c.purchases, p2.purchases);
    const roasDelta     = delta(c.roas, p2.roas);

    let status = 'stable';
    if (!raw14 && raw7?.spend > 0)                 status = 'new';
    else if (raw14 && (!raw7 || !raw7.spend))      status = 'stopped';
    else if (purchaseDelta >=  20 || roasDelta >= 15) status = 'improving';
    else if (purchaseDelta <= -20 || roasDelta <= -15) status = 'declining';

    const meta = cur || prior;
    result.push({
      adId: id, adName: meta.adName,
      campaignName: meta.campaignName, adSetName: meta.adSetName,
      cur, prior, spendDelta, purchaseDelta, roasDelta, status,
    });
  }

  const rank = { stopped:0, declining:1, new:2, improving:3, stable:4 };
  return result.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return Math.abs(b.purchaseDelta) - Math.abs(a.purchaseDelta);
  });
}

/* ─── Shopify helpers ──────────────────────────────────────────────────── */
function aggOrders(orders) {
  if (!orders?.length) return { count:0, revenue:0, aov:0, newCount:0, repeatCount:0, skuMap:{} };
  let count=0, revenue=0, newCount=0, repeatCount=0;
  const skuMap = {};
  const seen = new Set();

  for (const o of orders) {
    count++;
    revenue += safeNum(o.total_price || o.subtotal_price || 0);
    const email = (o.email || '').toLowerCase().trim();
    if (email) {
      if (seen.has(email)) repeatCount++; else { newCount++; seen.add(email); }
    }
    for (const li of (o.line_items || [])) {
      const sku = (li.sku || li.title || '').trim().toUpperCase() || 'UNKNOWN';
      if (!skuMap[sku]) skuMap[sku] = { sku, qty:0, revenue:0 };
      const qty = safeNum(li.quantity) || 1;
      skuMap[sku].qty     += qty;
      skuMap[sku].revenue += safeNum(li.price || 0) * qty;
    }
  }

  return { count, revenue, aov: count > 0 ? revenue / count : 0, newCount, repeatCount, skuMap };
}

export function buildShopifyComparison(orders, daysBack) {
  const now = Date.now();
  const curStart   = now - daysBack * 86400000;
  const priorStart = curStart - daysBack * 86400000;
  const current = [], prior = [];

  for (const o of (orders || [])) {
    const t = new Date(o.created_at || o.processed_at || 0).getTime();
    if (isNaN(t)) continue;
    if (t >= curStart)        current.push(o);
    else if (t >= priorStart) prior.push(o);
  }

  return {
    current: aggOrders(current), prior: aggOrders(prior),
    currentOrders: current, priorOrders: prior, daysBack,
  };
}

export function buildProductComparison(curOrders, priorOrders) {
  const cAgg = aggOrders(curOrders);
  const pAgg = aggOrders(priorOrders);
  const allSkus = new Set([...Object.keys(cAgg.skuMap), ...Object.keys(pAgg.skuMap)]);

  return Array.from(allSkus).map(sku => {
    const c = cAgg.skuMap[sku]  || { qty:0, revenue:0 };
    const p = pAgg.skuMap[sku]  || { qty:0, revenue:0 };
    const qtyDelta = p.qty     > 0 ? (c.qty - p.qty) / p.qty * 100         : (c.qty > 0 ? 100 : -100);
    const revDelta = p.revenue > 0 ? (c.revenue - p.revenue) / p.revenue * 100 : (c.revenue > 0 ? 100 : -100);
    return { sku, curQty:c.qty, priorQty:p.qty, curRev:c.revenue, priorRev:p.revenue, qtyDelta, revDelta };
  }).sort((a, b) => b.curQty - a.curQty).slice(0, 50);
}

/* ─── Daily trend (for chart) ──────────────────────────────────────────── */
export function buildDailyTrend(orders, daysBack) {
  const now = new Date();
  const days = [];

  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, label: `${d.getDate()}/${d.getMonth()+1}`, orders:0, revenue:0, isPrior: false });
  }
  for (let i = daysBack * 2 - 1; i >= daysBack; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.unshift({ date: key, label: `${d.getDate()}/${d.getMonth()+1}`, orders:0, revenue:0, isPrior: true });
  }

  const idx = {};
  for (const d of days) idx[d.date] = d;

  for (const o of (orders || [])) {
    const key = (o.created_at || '').slice(0, 10);
    if (idx[key]) {
      idx[key].orders++;
      idx[key].revenue += safeNum(o.total_price || o.subtotal_price || 0);
    }
  }

  return days;
}

/* ─── Root cause diagnosis ──────────────────────────────────────────────── */
export function computeRootCauses({ metaCur, metaPrior, shopifyCur, shopifyPrior, newAdsCount, stoppedAdsCount }) {
  const causes = [];
  const d = (c, p) => (p > 0 ? (c - p) / p * 100 : (c > 0 ? 100 : 0));

  const spendChg  = d(safeNum(metaCur?.spend),      safeNum(metaPrior?.spend));
  const roasChg   = d(safeNum(metaCur?.roas),        safeNum(metaPrior?.roas));
  const cpmChg    = d(safeNum(metaCur?.cpm),         safeNum(metaPrior?.cpm));
  const ctrChg    = d(safeNum(metaCur?.ctr),         safeNum(metaPrior?.ctr));
  const lpvChg    = d(safeNum(metaCur?.lpvRate),     safeNum(metaPrior?.lpvRate));
  const atcChg    = d(safeNum(metaCur?.atcRate),     safeNum(metaPrior?.atcRate));
  const aovChg    = d(safeNum(shopifyCur?.aov),      safeNum(shopifyPrior?.aov));

  const push = (factor, impactPct, direction, detail, severity, category, action) =>
    causes.push({ factor, impactPct, direction, detail, severity, category, action });

  if (Math.abs(spendChg) >= 15)
    push('Budget & Spend', spendChg, spendChg > 0 ? 'up' : 'down',
      spendChg > 0
        ? `Spend increased ${spendChg.toFixed(0)}% — more budget deployed`
        : `Spend dropped ${Math.abs(spendChg).toFixed(0)}% — budget cuts or paused ads`,
      Math.abs(spendChg) > 35 ? 'high' : 'medium', 'meta',
      spendChg < 0
        ? 'Check for paused campaigns or budget caps — restore budget on top performers.'
        : 'Monitor ROAS carefully as higher spend can dilute efficiency.',
    );

  if (Math.abs(roasChg) >= 10)
    push('ROAS Efficiency', roasChg, roasChg > 0 ? 'up' : 'down',
      roasChg > 0
        ? `ROAS improved ${roasChg.toFixed(0)}% — better revenue per rupee spent`
        : `ROAS dropped ${Math.abs(roasChg).toFixed(0)}% — conversion efficiency falling`,
      Math.abs(roasChg) > 30 ? 'high' : 'medium', 'meta',
      roasChg < 0
        ? 'Review creative performance and audience freshness. Check landing page conversion rate.'
        : 'Identify which ads are driving the improvement and scale them.',
    );

  if (Math.abs(cpmChg) >= 12)
    push('Auction Competition (CPM)', -cpmChg, cpmChg > 0 ? 'down' : 'up',
      cpmChg > 0
        ? `CPM rose ${cpmChg.toFixed(0)}% — more expensive to reach audience (seasonality or competitor activity)`
        : `CPM fell ${Math.abs(cpmChg).toFixed(0)}% — cheaper impressions, better reach per rupee`,
      Math.abs(cpmChg) > 30 ? 'high' : 'medium', 'meta',
      cpmChg > 0
        ? 'Broaden targeting to find cheaper audiences. Test new interest clusters or lookalikes.'
        : 'Capture the opportunity — increase bids or budgets on top audiences.',
    );

  if (Math.abs(ctrChg) >= 10)
    push('Creative Engagement (CTR)', ctrChg, ctrChg > 0 ? 'up' : 'down',
      ctrChg > 0
        ? `CTR up ${ctrChg.toFixed(0)}% — creatives resonating better`
        : `CTR down ${Math.abs(ctrChg).toFixed(0)}% — creative fatigue or weaker hooks`,
      Math.abs(ctrChg) > 25 ? 'high' : 'medium', 'creative',
      ctrChg < 0
        ? 'Refresh creatives — test new hooks, thumbnails, first-3-second frames.'
        : 'Identify top-CTR creatives and iterate/scale them.',
    );

  if (Math.abs(lpvChg) >= 10)
    push('Landing Page (LPV Rate)', lpvChg, lpvChg > 0 ? 'up' : 'down',
      lpvChg > 0
        ? `LPV Rate up ${lpvChg.toFixed(0)}% — more clickers engaging with the page`
        : `LPV Rate down ${Math.abs(lpvChg).toFixed(0)}% — higher bounce or pixel tracking gap`,
      Math.abs(lpvChg) > 25 ? 'high' : 'medium', 'funnel',
      lpvChg < 0
        ? 'Check landing page speed (GTmetrix). Verify Meta pixel is firing correctly post-click.'
        : null,
    );

  if (Math.abs(atcChg) >= 12)
    push('Product & Offer Strength (ATC)', atcChg, atcChg > 0 ? 'up' : 'down',
      atcChg > 0
        ? `ATC Rate up ${atcChg.toFixed(0)}% — offer/product resonance stronger`
        : `ATC Rate down ${Math.abs(atcChg).toFixed(0)}% — weaker offer or seasonal intent dip`,
      Math.abs(atcChg) > 25 ? 'high' : 'medium', 'funnel',
      atcChg < 0
        ? 'Review pricing vs competitors. Consider a limited-time bundle or discount to restore ATC momentum.'
        : 'Lean into what\'s driving ATC — match the offer angle in more creatives.',
    );

  if ((stoppedAdsCount || 0) >= 2)
    push('Ads Stopped / Paused', -Math.min(stoppedAdsCount * 10, 80), 'down',
      `${stoppedAdsCount} ads stopped this period — reduced delivery surface`,
      stoppedAdsCount >= 5 ? 'high' : 'medium', 'structure',
      'Review which ads were paused. Relaunch winners with fresh creatives or duplicate to new ad sets.',
    );

  if ((newAdsCount || 0) >= 2)
    push('New Ads Launched', Math.min(newAdsCount * 8, 60), 'up',
      `${newAdsCount} new ads launched — expanding reach and creative testing`,
      'low', 'structure',
      'Watch new ads closely for 3–5 days before scaling. Kill losers quickly to protect ROAS.',
    );

  if (shopifyPrior?.count > 5 && Math.abs(aovChg) >= 8)
    push('Average Order Value (AOV)', aovChg, aovChg > 0 ? 'up' : 'down',
      aovChg > 0
        ? `AOV up ${aovChg.toFixed(0)}% — customers spending more per order`
        : `AOV down ${Math.abs(aovChg).toFixed(0)}% — customers spending less per order`,
      Math.abs(aovChg) > 20 ? 'high' : 'medium', 'shopify',
      aovChg < 0
        ? 'Check if high-value SKUs lost traffic. Introduce bundle offers or free-shipping threshold.'
        : 'Identify top-revenue SKU combinations and feature them more prominently in ads.',
    );

  if (shopifyCur?.count > 10 && shopifyPrior?.count > 10) {
    const curPct   = safeDivide(shopifyCur.newCount,   shopifyCur.count) * 100;
    const priorPct = safeDivide(shopifyPrior.newCount, shopifyPrior.count) * 100;
    const chg = d(curPct, priorPct);
    if (Math.abs(chg) >= 15)
      push('New Customer Acquisition', chg, chg > 0 ? 'up' : 'down',
        chg > 0
          ? `New customer % up ${chg.toFixed(0)}% — ads driving more first-time buyers`
          : `New customer % down ${Math.abs(chg).toFixed(0)}% — acquisition declining, more repeat buyers`,
        'low', 'shopify',
        chg < 0
          ? 'Ensure prospecting/TOF ads are running and not paused. New customer pipeline may be drying up.'
          : null,
      );
  }

  const sevRank = { high:2, medium:1, low:0 };
  return causes.sort((a, b) =>
    sevRank[b.severity] !== sevRank[a.severity]
      ? sevRank[b.severity] - sevRank[a.severity]
      : Math.abs(b.impactPct) - Math.abs(a.impactPct)
  );
}
