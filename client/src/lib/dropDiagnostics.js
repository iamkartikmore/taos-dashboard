/**
 * Drop-diagnostics engine — answers the operator question:
 *   "My ROAS dropped. WHY? Which SKU went OOS, which campaign was carrying it,
 *    which ad group/ad/search term was driving the spend, and did Shopify
 *    organic + Meta corroborate the drop or is it Google-isolated?"
 *
 * Google Ads data alone gives you symptoms (campaign X is down). The cause
 * lives at the intersection of four systems:
 *   - Inventory    → a SKU went out of stock
 *   - Feed         → Google disapproved/demoted the item
 *   - Ad machinery → campaign → ad group → ad → search term
 *   - Organic      → Shopify sales of that SKU, Meta campaign spend
 *
 * This library is pure joins + heuristics on already-normalized data. No
 * fetching. The UI layer composes the narrative.
 *
 * The chain we're reconstructing:
 *
 *     SKU outage / feed disapproval
 *       → which CAMPAIGNS had this SKU in their item mix
 *         → which AD GROUPS were spending under those campaigns
 *           → which ADS / KEYWORDS / SEARCH TERMS ran under those groups
 *             → Shopify WoW / Meta WoW — is the drop channel-isolated?
 */

const U   = v => (v == null ? '' : String(v).trim().toUpperCase());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ─── DATE HELPERS ───────────────────────────────────────────────── */

const dayMs = 86_400_000;
const toDateStr = d => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const daysAgo   = n => toDateStr(new Date(Date.now() - n * dayMs));

/* ─── 1. SKU OUTAGE DETECTION ────────────────────────────────────────
   Infer when each SKU went OOS from three signals:
     - inventoryMap: current stock level (live)
     - merchantBySku: feed availability (what Google sees)
     - orders: last order date per SKU (trailing signal — if nothing sold in
       N days and inventory says 0, the outage likely started around that
       last sale date)
   Output per SKU:
     { sku, stock, feedAvail, lastOrderDate, outageDate, severity, daysOut } */
export function detectSkuOutages({
  orders = [],
  inventoryMap = {},
  merchantBySku = null,
  daysBack = 30,
} = {}) {
  const lastOrderBySku = new Map(); // SKU → last order ts
  for (const o of orders) {
    const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
    for (const li of o.line_items || []) {
      const sku = U(li.sku);
      if (!sku || !ts) continue;
      const prev = lastOrderBySku.get(sku) || 0;
      if (ts > prev) lastOrderBySku.set(sku, ts);
    }
  }

  const outages = [];
  const universe = new Set([
    ...Object.keys(inventoryMap || {}).map(U),
    ...(merchantBySku ? [...merchantBySku.keys()] : []),
  ]);

  for (const sku of universe) {
    const invKey = Object.keys(inventoryMap || {}).find(k => U(k) === sku) || sku;
    const inv    = inventoryMap[invKey] || inventoryMap[sku] || null;
    const feed   = merchantBySku?.get(sku) || null;
    const stock  = inv?.stock ?? null;
    const reorder = inv?.reorderPoint ?? 0;
    const feedAvail = feed?.availability || null;

    const stockOut  = stock != null && stock <= 0;
    const feedOut   = feedAvail === 'out of stock';
    const critical  = stock != null && stock > 0 && stock <= reorder;

    if (!stockOut && !feedOut && !critical) continue;

    const lastOrder = lastOrderBySku.get(sku) || null;
    const lastOrderDate = lastOrder ? toDateStr(lastOrder) : null;

    // Outage date: if stock=0 and we have last-order, assume outage began the
    // day after last order. If no order in window, use window start.
    const windowStart = Date.now() - daysBack * dayMs;
    let outageTs = null;
    if (stockOut || feedOut) {
      if (lastOrder && lastOrder > windowStart) outageTs = lastOrder + dayMs;
      else outageTs = windowStart;
    } else if (critical) {
      outageTs = lastOrder || windowStart;
    }

    const outageDate = outageTs ? toDateStr(outageTs) : null;
    const daysOut = outageTs ? Math.max(0, Math.round((Date.now() - outageTs) / dayMs)) : null;

    outages.push({
      sku,
      stock,
      reorderPoint: reorder,
      feedAvail,
      feedStatus: feed?.status?.primaryStatus || null,
      title: feed?.title || inv?.title || sku,
      lastOrderDate,
      outageDate,
      daysOut,
      severity: stockOut && feedOut ? 'critical' : stockOut || feedOut ? 'oos' : 'low',
    });
  }

  outages.sort((a, b) => (b.daysOut || 0) - (a.daysOut || 0));
  return outages;
}

/* ─── 2. CAMPAIGN DELTAS ─────────────────────────────────────────────
   Week-over-week deltas on campaignsDaily. Answers "which campaigns are
   actually down?" Not every campaign is down — we only want to diagnose
   the ones that dropped. */
export function campaignDeltas(campaignsDaily = [], windowDays = 7) {
  if (!campaignsDaily.length) return [];
  const cutRecent = daysAgo(windowDays);
  const cutPrior  = daysAgo(windowDays * 2);

  const byCamp = new Map(); // id → { name, recent: {…}, prior: {…} }

  for (const row of campaignsDaily) {
    if (!row.date || !row.campaignId) continue;
    const bucket = row.date >= cutRecent ? 'recent'
                 : row.date >= cutPrior  ? 'prior'
                 : null;
    if (!bucket) continue;
    const e = byCamp.get(row.campaignId) || {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      recent: { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 },
      prior:  { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 },
    };
    e[bucket].cost            += num(row.cost);
    e[bucket].clicks          += num(row.clicks);
    e[bucket].impressions     += num(row.impressions);
    e[bucket].conversions     += num(row.conversions);
    e[bucket].conversionValue += num(row.conversionValue);
    byCamp.set(row.campaignId, e);
  }

  const out = [];
  for (const e of byCamp.values()) {
    const r = e.recent, p = e.prior;
    const d = {
      campaignId:   e.campaignId,
      campaignName: e.campaignName,
      recentCost:   r.cost,
      priorCost:    p.cost,
      deltaCost:    r.cost - p.cost,
      deltaCostPct: p.cost > 0 ? (r.cost - p.cost) / p.cost : null,
      recentRoas:   r.cost > 0 ? r.conversionValue / r.cost : 0,
      priorRoas:    p.cost > 0 ? p.conversionValue / p.cost : 0,
      deltaImpr:    r.impressions - p.impressions,
      deltaImprPct: p.impressions > 0 ? (r.impressions - p.impressions) / p.impressions : null,
      recentRev:    r.conversionValue,
      priorRev:     p.conversionValue,
      deltaRev:     r.conversionValue - p.conversionValue,
      deltaRevPct:  p.conversionValue > 0 ? (r.conversionValue - p.conversionValue) / p.conversionValue : null,
    };
    d.deltaRoas = d.recentRoas - d.priorRoas;
    // "dropping" = revenue down >10% OR ROAS down >0.5 with prior cost >0
    d.dropping = (p.conversionValue > 0 && d.deltaRevPct != null && d.deltaRevPct < -0.1) ||
                 (p.cost > 100 && d.deltaRoas < -0.5);
    out.push(d);
  }
  return out.sort((a, b) => (a.deltaRev || 0) - (b.deltaRev || 0)); // biggest rev drops first
}

/* ─── 3. META DELTA (cross-channel corroboration) ────────────────────
   If Meta is also down WoW, the demand is softer globally — not a Google
   feed issue. If Meta is flat/up, the Google drop is channel-isolated. */
export function metaDelta({ insights7d = [], insights30d = [] } = {}) {
  const sum = rows => rows.reduce((a, r) => {
    a.spend   += num(r.spend);
    a.revenue += num(r.purchase_value ?? r.conversion_values);
    a.clicks  += num(r.clicks);
    a.impressions += num(r.impressions);
    return a;
  }, { spend: 0, revenue: 0, clicks: 0, impressions: 0 });

  const r = sum(insights7d);
  const a30 = sum(insights30d);
  // Prior week = 30d - 7d, averaged to weekly scale
  const prior = {
    spend:       (a30.spend       - r.spend) / 3.286,
    revenue:     (a30.revenue     - r.revenue) / 3.286,
    clicks:      (a30.clicks      - r.clicks) / 3.286,
    impressions: (a30.impressions - r.impressions) / 3.286,
  };
  return {
    recent: r, prior,
    deltaSpend:    r.spend - prior.spend,
    deltaSpendPct: prior.spend > 0 ? (r.spend - prior.spend) / prior.spend : null,
    deltaRev:      r.revenue - prior.revenue,
    deltaRevPct:   prior.revenue > 0 ? (r.revenue - prior.revenue) / prior.revenue : null,
    recentRoas:    r.spend > 0 ? r.revenue / r.spend : 0,
    priorRoas:     prior.spend > 0 ? prior.revenue / prior.spend : 0,
  };
}

/* ─── 4. SHOPIFY ORGANIC WoW (cross-channel corroboration) ───────────
   SKU-level WoW revenue from orders. Also rolls up to total-store WoW. */
export function shopifyWoW({ orders = [], windowDays = 7 } = {}) {
  const cutRecent = Date.now() - windowDays * dayMs;
  const cutPrior  = Date.now() - windowDays * 2 * dayMs;
  const bySku = new Map(); // sku → { recentRev, priorRev, recentUnits, priorUnits }
  let recentTotal = 0, priorTotal = 0, recentOrders = 0, priorOrders = 0;

  for (const o of orders) {
    if (!o.created_at) continue;
    const ts = new Date(o.created_at).getTime();
    const bucket = ts >= cutRecent ? 'recent' : ts >= cutPrior ? 'prior' : null;
    if (!bucket) continue;
    if (bucket === 'recent') recentOrders++; else priorOrders++;
    for (const li of o.line_items || []) {
      const sku = U(li.sku);
      if (!sku) continue;
      const price = Number(li.price) || 0;
      const qty   = Number(li.quantity) || 1;
      const rev   = price * qty - (Number(li.total_discount) || 0);
      const cur = bySku.get(sku) || { sku, recentRev: 0, priorRev: 0, recentUnits: 0, priorUnits: 0 };
      cur[`${bucket}Rev`]   += rev;
      cur[`${bucket}Units`] += qty;
      bySku.set(sku, cur);
      if (bucket === 'recent') recentTotal += rev; else priorTotal += rev;
    }
  }

  const bySkuArr = [...bySku.values()].map(r => ({
    ...r,
    deltaRev:    r.recentRev - r.priorRev,
    deltaRevPct: r.priorRev > 0 ? (r.recentRev - r.priorRev) / r.priorRev : null,
    deltaUnits:  r.recentUnits - r.priorUnits,
  }));

  return {
    bySku: new Map(bySkuArr.map(r => [r.sku, r])),
    totals: {
      recentRev: recentTotal, priorRev: priorTotal,
      deltaRev: recentTotal - priorTotal,
      deltaRevPct: priorTotal > 0 ? (recentTotal - priorTotal) / priorTotal : null,
      recentOrders, priorOrders,
    },
  };
}

/* ─── 5. SKU IMPACT CHAIN ────────────────────────────────────────────
   Given a SKU, trace the advertising machinery that served it. Since
   Google Ads doesn't directly expose which search terms triggered which
   shopping listings (shopping & search are different surfaces), we
   traverse via CAMPAIGN → ad group / ad / keyword / search term.
   Share is computed by prior-week cost share of the SKU within its
   campaign. */
export function skuImpactChain({
  sku,
  shoppingByCampaign = [],
  adGroups = [],
  ads = [],
  keywords = [],
  searchTerms = [],
  campaignDeltaMap = null, // Map campaignId → campaignDeltas row
} = {}) {
  const target = U(sku);
  if (!target) return null;

  // Campaigns that served this SKU, ranked by spend on it.
  const campaignRows = shoppingByCampaign
    .filter(r => U(r.productItemId || r.productId) === target)
    .map(r => ({
      campaignId:   String(r.campaignId || ''),
      campaignName: r.campaignName || '',
      skuCost:      num(r.cost),
      skuRev:       num(r.conversionValue ?? r.conversionsValue),
      skuImpr:      num(r.impressions),
      skuClicks:    num(r.clicks),
    }))
    .filter(r => r.campaignId)
    .sort((a, b) => b.skuCost - a.skuCost);

  if (!campaignRows.length) return { sku: target, campaigns: [] };

  // Per campaign, attach ad groups, ads, keywords, search terms AND the
  // SKU's share of that campaign's total shopping spend (so the reader
  // can tell whether the SKU was a top driver or a rounding error).
  const campaignTotals = new Map(); // campaignId → total shopping cost
  for (const r of shoppingByCampaign) {
    const cid = String(r.campaignId || '');
    if (!cid) continue;
    campaignTotals.set(cid, (campaignTotals.get(cid) || 0) + num(r.cost));
  }

  const campaigns = campaignRows.map(row => {
    const cid = row.campaignId;
    const campTotal = campaignTotals.get(cid) || 0;
    const costShare = campTotal > 0 ? row.skuCost / campTotal : 0;

    const campAdGroups = adGroups.filter(a => String(a.campaignId) === cid);
    const campAds      = ads.filter(a => String(a.campaignId) === cid);
    const campKeywords = keywords.filter(k => String(k.campaignId) === cid);
    const campTerms    = searchTerms.filter(s => String(s.campaignId) === cid);

    // Top-N each, sorted by cost
    const topN = (arr, n) => [...arr].sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, n);

    return {
      campaignId:   cid,
      campaignName: row.campaignName,
      skuCost:      row.skuCost,
      skuRev:       row.skuRev,
      skuImpr:      row.skuImpr,
      skuClicks:    row.skuClicks,
      costShareInCampaign: costShare,
      campaignTotalCost:   campTotal,
      campaignDelta:       campaignDeltaMap?.get(cid) || null,
      topAdGroups: topN(campAdGroups, 3).map(a => ({ id: a.id, name: a.name, cost: a.cost, roas: a.roas })),
      topAds:      topN(campAds, 3).map(a => ({ id: a.id, name: a.name || `(${a.type})`, type: a.type, cost: a.cost, clicks: a.clicks })),
      topKeywords: topN(campKeywords.filter(k => k.cost > 0), 5).map(k => ({ keyword: k.keyword, matchType: k.matchType, cost: k.cost, clicks: k.clicks })),
      topSearchTerms: topN(campTerms.filter(s => s.cost > 0), 5).map(s => ({ searchTerm: s.searchTerm, cost: s.cost, clicks: s.clicks, conversions: s.conversions })),
    };
  });

  return {
    sku: target,
    totalSkuCost: campaigns.reduce((a, c) => a + c.skuCost, 0),
    totalSkuRev:  campaigns.reduce((a, c) => a + c.skuRev, 0),
    campaigns,
  };
}

/* ─── 6. ROOT CAUSE RANKING FOR A CAMPAIGN ───────────────────────────
   Given a dropping campaign, score likely causes and return ranked list.
   Causes considered:
     1. OOS SKU that had high cost share in this campaign
     2. Disapproved SKU in campaign mix
     3. Change event on the campaign during prior/recent window
     4. Budget constraint (recent cost == budget × 7)
   Returns [{ cause, severity, narrative, evidence }, …] */
export function rootCauseForCampaign({
  campaignDelta,
  shoppingByCampaign = [],
  outages = [],
  merchantBySku = null,
  changeEvents = [],
  budgetsById = null,
} = {}) {
  if (!campaignDelta) return [];
  const cid = String(campaignDelta.campaignId);
  const causes = [];

  // Campaign's prior-week item mix
  const items = shoppingByCampaign
    .filter(r => String(r.campaignId) === cid)
    .map(r => ({
      sku:  U(r.productItemId || r.productId),
      title: r.productTitle || '',
      cost: num(r.cost),
      conv: num(r.conversions),
      rev:  num(r.conversionValue ?? r.conversionsValue),
    }))
    .sort((a, b) => b.cost - a.cost);
  const campaignCost = items.reduce((a, i) => a + i.cost, 0);

  // Cause 1: OOS SKUs that were carrying spend
  const outageSet = new Map(outages.map(o => [U(o.sku), o]));
  const oosItems = items
    .map(i => ({ ...i, outage: outageSet.get(i.sku) }))
    .filter(i => i.outage)
    .map(i => ({ ...i, costShare: campaignCost > 0 ? i.cost / campaignCost : 0 }))
    .sort((a, b) => b.costShare - a.costShare);

  if (oosItems.length) {
    const totalShare = oosItems.reduce((a, i) => a + i.costShare, 0);
    const lostSpend  = oosItems.reduce((a, i) => a + i.cost, 0);
    if (totalShare >= 0.03) {
      const severity = totalShare >= 0.25 ? 'critical' : totalShare >= 0.10 ? 'high' : 'medium';
      const top = oosItems[0];
      causes.push({
        cause: 'sku_outage',
        severity,
        headline: `${oosItems.length} SKU${oosItems.length > 1 ? 's' : ''} out of stock carrying ${(totalShare * 100).toFixed(0)}% of spend`,
        action: totalShare >= 0.25
          ? `Restock or pause this campaign — ${(totalShare * 100).toFixed(0)}% of its budget is going to empty shelves.`
          : `Exclude the OOS SKUs from the feed or restock top offender (${top.title || top.sku}, out ${top.outage.daysOut ?? '?'}d).`,
        impactSpend: lostSpend,
        evidence: oosItems.slice(0, 5).map(i => ({
          sku: i.sku, title: i.title, costShare: i.costShare, cost: i.cost,
          daysOut: i.outage.daysOut, outageDate: i.outage.outageDate, feedAvail: i.outage.feedAvail,
        })),
      });
    }
  }

  // Cause 2: Feed disapprovals in the item mix
  if (merchantBySku) {
    const disapproved = items
      .map(i => ({ ...i, feed: merchantBySku.get(i.sku) }))
      .filter(i => i.feed?.status?.primaryStatus === 'disapproved')
      .map(i => ({ ...i, costShare: campaignCost > 0 ? i.cost / campaignCost : 0 }));
    const totalShare  = disapproved.reduce((a, i) => a + i.costShare, 0);
    const wastedSpend = disapproved.reduce((a, i) => a + i.cost, 0);
    // Group by issue so we can tell the operator ONE thing to fix
    const byIssue = new Map();
    for (const i of disapproved) {
      const iss = i.feed.status?.itemIssues?.[0]?.description || 'disapproved';
      const cur = byIssue.get(iss) || { issue: iss, count: 0, cost: 0 };
      cur.count++; cur.cost += i.cost;
      byIssue.set(iss, cur);
    }
    const topIssue = [...byIssue.values()].sort((a, b) => b.cost - a.cost)[0];
    if (totalShare >= 0.03) {
      const severity = totalShare >= 0.25 ? 'critical' : totalShare >= 0.10 ? 'high' : 'medium';
      causes.push({
        cause: 'feed_disapproval',
        severity,
        headline: `${disapproved.length} disapproved SKUs burning ${(totalShare * 100).toFixed(0)}% of spend`,
        action: topIssue
          ? `Fix feed issue: "${topIssue.issue}" (affects ${topIssue.count} SKUs, ≈₹${Math.round(topIssue.cost).toLocaleString('en-IN')} of wasted spend).`
          : `Open Merchant Center → Diagnostics and resolve the disapprovals.`,
        impactSpend: wastedSpend,
        evidence: disapproved.slice(0, 5).map(i => ({
          sku: i.sku, title: i.title, costShare: i.costShare, cost: i.cost,
          issue: i.feed.status?.itemIssues?.[0]?.description || 'disapproved',
        })),
      });
    }
  }

  // Cause 3: Change events on this campaign or its resources
  // changeEvent.campaign is a resource string like "customers/123/campaigns/456"
  const relatedChanges = changeEvents.filter(ev => {
    const resStr = ev.campaign || ev.resourceName || '';
    return resStr.includes(`/campaigns/${cid}`);
  });
  if (relatedChanges.length) {
    const topUser = relatedChanges[0].userEmail;
    causes.push({
      cause: 'change_event',
      severity: relatedChanges.length >= 3 ? 'high' : 'medium',
      headline: `${relatedChanges.length} recent edit${relatedChanges.length > 1 ? 's' : ''} by ${topUser || 'someone'}`,
      action: `Check the Change History in Google Ads — revert if bids, budgets, or targeting were tightened.`,
      evidence: relatedChanges.slice(0, 5).map(ev => ({
        ts: ev.ts, user: ev.userEmail, operation: ev.operation,
        resourceType: ev.resourceType, fields: ev.changedFields,
      })),
    });
  }

  // Cause 4: Impression drop without cost drop → rank or CPM issue
  if (campaignDelta.priorImpr > 0 && campaignDelta.deltaImprPct != null && campaignDelta.deltaImprPct < -0.3) {
    if (campaignDelta.deltaCostPct == null || Math.abs(campaignDelta.deltaCostPct) < 0.15) {
      causes.push({
        cause: 'impression_collapse',
        severity: 'medium',
        headline: `Impressions down ${Math.abs(campaignDelta.deltaImprPct * 100).toFixed(0)}% with spend flat`,
        action: `Auction got more competitive — raise max-CPC or check Impression Share Lost (Rank) in Google Ads.`,
        evidence: [{ deltaImprPct: campaignDelta.deltaImprPct, deltaCostPct: campaignDelta.deltaCostPct }],
      });
    }
  }

  // Cause 5: Conversion-rate collapse without click drop → landing page / offer
  const priorCvr  = campaignDelta.priorClicks  > 0 ? campaignDelta.priorConv  / campaignDelta.priorClicks  : null;
  const recentCvr = campaignDelta.recentClicks > 0 ? campaignDelta.recentConv / campaignDelta.recentClicks : null;
  if (priorCvr != null && recentCvr != null && priorCvr > 0 && (recentCvr / priorCvr) < 0.65) {
    causes.push({
      cause: 'conversion_collapse',
      severity: 'high',
      headline: `Conversion rate fell to ${((recentCvr / priorCvr) * 100).toFixed(0)}% of prior`,
      action: `Clicks held but conversions didn't — open a top landing page and check stock, price, and PDP load speed.`,
      evidence: [{ priorCvr, recentCvr }],
    });
  }

  // Sort severity critical > high > medium > low
  const sev = { critical: 3, high: 2, medium: 1, low: 0 };
  causes.sort((a, b) => (sev[b.severity] || 0) - (sev[a.severity] || 0));
  return causes;
}

/* ─── 7. TOP-LEVEL DIAGNOSE ──────────────────────────────────────────
   One call; returns everything the UI needs. */
export function diagnose({
  googleAdsData,
  merchantBySku = null,
  orders = [],
  inventoryMap = {},
  metaInsights = null, // { insights7d, insights30d }
  windowDays = 7,
} = {}) {
  if (!googleAdsData) return null;

  const outages = detectSkuOutages({ orders, inventoryMap, merchantBySku, daysBack: windowDays * 4 });
  const deltas  = campaignDeltas(googleAdsData.campaignsDaily || [], windowDays);

  // Attach click/conv totals needed by rootCauseForCampaign's CVR check
  for (const d of deltas) {
    const cutRecent = daysAgo(windowDays);
    const cutPrior  = daysAgo(windowDays * 2);
    let priorClicks = 0, recentClicks = 0, priorConv = 0, recentConv = 0, priorImpr = 0, recentImpr = 0;
    for (const r of googleAdsData.campaignsDaily || []) {
      if (r.campaignId !== d.campaignId || !r.date) continue;
      const b = r.date >= cutRecent ? 'recent' : r.date >= cutPrior ? 'prior' : null;
      if (!b) continue;
      if (b === 'recent') { recentClicks += num(r.clicks); recentConv += num(r.conversions); recentImpr += num(r.impressions); }
      else                { priorClicks  += num(r.clicks); priorConv  += num(r.conversions); priorImpr  += num(r.impressions); }
    }
    d.priorClicks = priorClicks; d.recentClicks = recentClicks;
    d.priorConv   = priorConv;   d.recentConv   = recentConv;
    d.priorImpr   = priorImpr;   d.recentImpr   = recentImpr;
  }

  const deltaMap = new Map(deltas.map(d => [String(d.campaignId), d]));
  const dropping = deltas.filter(d => d.dropping);

  // For each dropping campaign, derive causes
  const diagnosed = dropping.map(d => ({
    ...d,
    causes: rootCauseForCampaign({
      campaignDelta: d,
      shoppingByCampaign: googleAdsData.shoppingByCampaign || [],
      outages,
      merchantBySku,
      changeEvents: googleAdsData.changeEvents || [],
    }),
  }));

  // Cross-channel corroboration
  const meta   = metaInsights ? metaDelta(metaInsights) : null;
  const shop   = shopifyWoW({ orders, windowDays });

  return {
    windowDays,
    outages,
    deltas, droppingCampaigns: diagnosed,
    deltaMap,
    meta, shop,
    totals: {
      droppingCount: dropping.length,
      outageCount:   outages.filter(o => o.severity === 'oos' || o.severity === 'critical').length,
      totalRevDelta: deltas.reduce((a, d) => a + (d.deltaRev || 0), 0),
    },
  };
}
