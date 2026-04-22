/**
 * Cross-system blend: Merchant feed × Google Ads Shopping × Shopify × Star Products.
 *
 * The question the operator wants answered is never just "what's my ROAS" —
 * it's "which PRODUCT is carrying my ROAS, and is the feed set up to keep
 * it there?" Campaigns are a lie; PMax hides the item mix behind an asset
 * group. `shopping_performance_view` segments by `product_item_id` so we
 * can reconstruct the per-SKU story — but only if we join against the
 * merchant feed to know *what those item_ids actually are* and whether
 * they're even approved to serve.
 *
 * This library does pure joins. No fetching.
 *
 * Exports:
 *   blendAdsMerchant({ shopping, merchant, shopifyBySku, starBySku })
 *     → { bySku, byCampaign, byProductType, orphans, leaks }
 *   campaignProductMix(shopping, bySku) → per-campaign breakdown
 */

const U = v => (v == null ? '' : String(v).trim().toUpperCase());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ─── AGGREGATE SHOPPING ROWS BY item_id ────────────────────────────
   shopping_performance_view is emitted one row per (item_id × campaign
   × date-range bucket). We roll up to per-SKU totals plus a per-SKU
   list of campaigns that served it. */
export function aggregateShoppingBySku(shopping = []) {
  const bySku = new Map();
  for (const row of shopping) {
    const itemId = U(row.productItemId || row.productId || row.itemId || row.segments?.productItemId);
    if (!itemId) continue;
    const cur = bySku.get(itemId) || {
      sku: itemId,
      title: row.productTitle || row.segments?.productTitle || '',
      brand: row.productBrand || row.segments?.productBrand || '',
      productType: row.productType || row.segments?.productTypeL1 || '',
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0,
      campaigns: new Set(),
      campaignNames: new Map(),
    };
    cur.impressions      += num(row.impressions);
    cur.clicks           += num(row.clicks);
    cur.cost             += num(row.cost);                  // already-rupees in normalize layer; if still micros, caller converts
    cur.conversions      += num(row.conversions);
    cur.conversionsValue += num(row.conversionsValue ?? row.conversionValue);
    if (row.campaignId) {
      cur.campaigns.add(String(row.campaignId));
      if (row.campaignName) cur.campaignNames.set(String(row.campaignId), row.campaignName);
    }
    bySku.set(itemId, cur);
  }
  // Finalize: campaigns → array; derived rates
  for (const v of bySku.values()) {
    v.campaigns = [...v.campaigns];
    v.campaignNames = Object.fromEntries(v.campaignNames);
    v.ctr     = v.impressions ? v.clicks / v.impressions : 0;
    v.cvr     = v.clicks ? v.conversions / v.clicks : 0;
    v.cpa     = v.conversions ? v.cost / v.conversions : 0;
    v.roas    = v.cost ? v.conversionsValue / v.cost : 0;
  }
  return bySku;
}

/* ─── PER-CAMPAIGN PRODUCT MIX ──────────────────────────────────────
   For each campaign, which SKUs served and their share of spend/conv. */
export function aggregateShoppingByCampaign(shopping = []) {
  const byCamp = new Map();
  for (const row of shopping) {
    const campId = String(row.campaignId || '');
    const itemId = U(row.productItemId || row.productId || row.itemId);
    if (!campId || !itemId) continue;
    const convV  = num(row.conversionsValue ?? row.conversionValue);
    const cur = byCamp.get(campId) || {
      campaignId: campId,
      campaignName: row.campaignName || '',
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0,
      items: new Map(),
    };
    cur.impressions      += num(row.impressions);
    cur.clicks           += num(row.clicks);
    cur.cost             += num(row.cost);
    cur.conversions      += num(row.conversions);
    cur.conversionsValue += convV;
    const itm = cur.items.get(itemId) || { sku: itemId, title: row.productTitle || '', cost: 0, conversions: 0, conversionsValue: 0 };
    itm.cost             += num(row.cost);
    itm.conversions      += num(row.conversions);
    itm.conversionsValue += convV;
    cur.items.set(itemId, itm);
    byCamp.set(campId, cur);
  }
  for (const v of byCamp.values()) {
    v.items = [...v.items.values()]
      .map(i => ({ ...i, costShare: v.cost ? i.cost / v.cost : 0, revShare: v.conversionsValue ? i.conversionsValue / v.conversionsValue : 0, roas: i.cost ? i.conversionsValue / i.cost : 0 }))
      .sort((a, b) => b.cost - a.cost);
    v.roas = v.cost ? v.conversionsValue / v.cost : 0;
    v.cpa  = v.conversions ? v.cost / v.conversions : 0;
  }
  return byCamp;
}

/* ─── MAIN BLEND ─────────────────────────────────────────────────────
   Inputs:
     shopping       — normalized Google Ads shopping rows (per-SKU spend)
     merchantBySku  — Map from googleMerchantAnalytics.joinFeed().bySku
     shopifyBySku   — Map keyed by SKU → { revenue, units, gross }
     starBySku      — Map keyed by SKU → star-products record (quadrant,
                      inventoryPosture, forwardVelocity, etc.)

   Outputs:
     bySku          — enriched per-SKU rows
     byCampaign     — per-campaign with item mix + feed-status roll-up
     byProductType  — per Google product type roll-up
     orphans        — SKUs in Shopify but not in merchant feed (revenue
                      leak — not advertised)
     leaks          — SKUs where ad spend > 0 but feed is disapproved
                      (wasted spend, no serving)
   ────────────────────────────────────────────────────────────────── */
export function blendAdsMerchant({ shopping = [], merchantBySku = null, shopifyBySku = null, starBySku = null } = {}) {
  const adBySku = aggregateShoppingBySku(shopping);
  const byCampaign = aggregateShoppingByCampaign(shopping);

  // Universe of SKUs = union(feed, ads, shopify, stars)
  const universe = new Set();
  if (merchantBySku) for (const k of merchantBySku.keys()) universe.add(k);
  for (const k of adBySku.keys()) universe.add(k);
  if (shopifyBySku) for (const k of shopifyBySku.keys()) universe.add(k);
  if (starBySku) for (const k of starBySku.keys()) universe.add(k);

  const bySku = [];
  for (const sku of universe) {
    const feed   = merchantBySku?.get(sku) || null;
    const ad     = adBySku.get(sku)        || null;
    const shop   = shopifyBySku?.get(sku)  || null;
    const star   = starBySku?.get(sku)     || null;

    const inFeed       = !!feed;
    const feedStatus   = feed?.status?.primaryStatus || (inFeed ? 'unknown' : 'absent');
    const feedIssues   = feed?.status?.itemIssues || [];
    const feedApproved = feedStatus === 'approved';
    const feedAvail    = feed?.availability || null;

    const adSpend   = ad?.cost || 0;
    const adRev     = ad?.conversionsValue || 0;
    const adClicks  = ad?.clicks || 0;
    const adImpr    = ad?.impressions || 0;

    const shopRevenue = shop?.revenue || 0;
    const shopUnits   = shop?.units || 0;

    // A few signal classifications useful for all downstream UIs.
    const wastedSpend = adSpend > 0 && !feedApproved;
    const ghost       = adImpr === 0 && feedApproved && (shopRevenue > 0 || (star && star.action === 'DOUBLE DOWN')); // should be running, isn't
    const outOfStockServing = ad && adImpr > 0 && (feedAvail === 'out of stock' || (star && star.inventoryPosture === 'oos'));
    const orphan      = !inFeed && shopRevenue > 0;            // in Shopify, not in feed
    const exclusive   = shop && !ad;                            // sells organically but not via ads
    const adOnly      = ad && !shop;                            // spent on ads but no Shopify revenue matched

    bySku.push({
      sku,
      // Source-of-truth identifiers
      title: feed?.title || ad?.title || star?.name || shop?.name || sku,
      brand: feed?.brand || ad?.brand || '',
      productType: feed?.productType || ad?.productType || star?.collection || '',
      image: feed?.imageLink || star?.image || '',
      price: feed?.price || star?.price || 0,
      // Feed slice
      inFeed, feedStatus, feedApproved, feedIssues, feedAvail,
      feedLink: feed?.link || null,
      feedDisapprovedFor: feed?.status?.disapprovedFor || [],
      // Ads slice
      adSpend, adRev, adClicks, adImpr,
      adConversions: ad?.conversions || 0,
      adRoas: ad?.roas || 0,
      adCpa:  ad?.cpa  || 0,
      adCtr:  ad?.ctr  || 0,
      adCampaigns: ad?.campaigns || [],
      // Shopify slice
      shopRevenue, shopUnits,
      // Star Products slice
      starAction: star?.action || null,
      composedAction: star?.composedAction || null,
      inventoryPosture: star?.inventoryPosture || (feedAvail === 'out of stock' ? 'oos' : 'unknown'),
      forwardDoS: star?.forwardDoS ?? null,
      starScore: star?.starScore || null,
      // Signals
      signals: {
        wastedSpend, ghost, outOfStockServing, orphan, exclusive, adOnly,
      },
    });
  }

  bySku.sort((a, b) => (b.adSpend + b.shopRevenue) - (a.adSpend + a.shopRevenue));

  // Feed-status rollup per campaign (how much spend is on approved vs disapproved SKUs)
  for (const camp of byCampaign.values()) {
    let approvedSpend = 0, disapprovedSpend = 0, unknownSpend = 0, oosSpend = 0;
    for (const it of camp.items) {
      const feed = merchantBySku?.get(it.sku);
      if (!feed) { unknownSpend += it.cost; continue; }
      if (feed.status?.primaryStatus === 'approved')     approvedSpend    += it.cost;
      else if (feed.status?.primaryStatus === 'disapproved') disapprovedSpend += it.cost;
      else                                                unknownSpend    += it.cost;
      if (feed.availability === 'out of stock')          oosSpend         += it.cost;
    }
    camp.feedRoll = {
      approvedSpend, disapprovedSpend, unknownSpend, oosSpend,
      disapprovedShare: camp.cost ? disapprovedSpend / camp.cost : 0,
      oosShare:         camp.cost ? oosSpend         / camp.cost : 0,
    };
  }

  // Per-product-type roll-up — answers "which categories are our ROAS drivers?"
  const byType = new Map();
  for (const r of bySku) {
    const key = r.productType || 'Uncategorized';
    const cur = byType.get(key) || {
      productType: key,
      skus: 0, inFeed: 0, approved: 0, disapproved: 0,
      adSpend: 0, adRev: 0, shopRev: 0, oosCount: 0,
    };
    cur.skus++;
    if (r.inFeed) cur.inFeed++;
    if (r.feedApproved) cur.approved++;
    if (r.feedStatus === 'disapproved') cur.disapproved++;
    if (r.inventoryPosture === 'oos') cur.oosCount++;
    cur.adSpend += r.adSpend;
    cur.adRev   += r.adRev;
    cur.shopRev += r.shopRevenue;
    byType.set(key, cur);
  }
  const byProductType = [...byType.values()].map(t => ({
    ...t,
    adRoas:  t.adSpend ? t.adRev / t.adSpend : 0,
    shopToAd: t.adSpend ? t.shopRev / t.adSpend : 0,
    approvalRate: t.skus ? t.approved / t.skus : 0,
  })).sort((a, b) => b.adSpend - a.adSpend);

  // Orphans & leaks — the two sharpest action lists
  const orphans = bySku.filter(r => r.signals.orphan).sort((a, b) => b.shopRevenue - a.shopRevenue);
  const leaks   = bySku.filter(r => r.signals.wastedSpend).sort((a, b) => b.adSpend - a.adSpend);
  const oosBurn = bySku.filter(r => r.signals.outOfStockServing).sort((a, b) => b.adSpend - a.adSpend);
  const ghosts  = bySku.filter(r => r.signals.ghost).sort((a, b) => (b.starScore || 0) - (a.starScore || 0));

  return {
    bySku,
    byCampaign: [...byCampaign.values()].sort((a, b) => b.cost - a.cost),
    byProductType,
    orphans, leaks, oosBurn, ghosts,
    totals: {
      skuCount: bySku.length,
      adSpend: bySku.reduce((s, r) => s + r.adSpend, 0),
      adRev:   bySku.reduce((s, r) => s + r.adRev,   0),
      shopRev: bySku.reduce((s, r) => s + r.shopRevenue, 0),
      wastedSpend: leaks.reduce((s, r) => s + r.adSpend, 0),
      oosSpend:    oosBurn.reduce((s, r) => s + r.adSpend, 0),
      orphanRev:   orphans.reduce((s, r) => s + r.shopRevenue, 0),
    },
  };
}

/* ─── helpers for consumers ─────────────────────────────────────── */

/* Build a SKU-indexed Shopify rev/units map from raw orders. */
export function shopifyBySkuFromOrders(orders = []) {
  const map = new Map();
  for (const o of orders) {
    for (const item of o.line_items || []) {
      const sku = U(item.sku);
      if (!sku) continue;
      const cur = map.get(sku) || { sku, name: item.title || '', revenue: 0, units: 0 };
      const price = Number(item.price) || 0;
      const qty   = Number(item.quantity) || 1;
      cur.revenue += price * qty - (Number(item.total_discount) || 0);
      cur.units   += qty;
      map.set(sku, cur);
    }
  }
  return map;
}

/* Wrap a Star Products `skus` list into a Map keyed by SKU. */
export function starBySkuFromAnalysis(skus = []) {
  const map = new Map();
  for (const s of skus) if (s.sku) map.set(U(s.sku), s);
  return map;
}
