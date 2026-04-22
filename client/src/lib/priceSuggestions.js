/**
 * Price suggestions engine — reconstructs Google Merchant Center's "sale
 * price suggestions with highest performance impact" from local data.
 *
 * Google does this with proprietary auction + demand signals we can't see.
 * What we DO have is often stronger for a specific store:
 *   - Full Shopify order history (every price point every SKU has sold at,
 *     including discounted vs full-price velocity)
 *   - Per-SKU Google Ads shopping metrics (impressions, CTR, CVR, cost)
 *   - A live merchant feed with productType, which defines peer groups
 *
 * We combine three methods, ranked by evidence quality:
 *
 *   A. HISTORICAL A/B — SKUs that sold at ≥2 distinct unit-price points in
 *      the window give us a real elasticity signal. Pick the point that
 *      maximized revenue. This is the gold-standard — it's actually been
 *      tested in your store.
 *
 *   B. DISCOUNT RESPONSE — Even if price didn't change, `total_discount`
 *      on individual line items tells us how units respond to a % off.
 *      If discounted-order velocity >> full-price velocity, elastic.
 *
 *   C. PEER BENCHMARK — SKUs priced >15% above peer median in same
 *      productType with CTR or CVR <75% of peer median are candidates
 *      for price reduction to match peers. Weakest signal but covers
 *      SKUs with no price variation history.
 *
 * We only emit a suggestion when:
 *   - Suggested price differs from current by ≥3% (avoid rounding noise)
 *   - Underlying volume clears a floor (≥10 units sold OR ≥300 ad impr)
 *
 * Effectiveness: tiered low/medium/high based on absolute revenue the
 * change would affect (current_volume × |Δprice| × expected_uplift).
 */

const num   = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const U     = v => (v == null ? '' : String(v).trim().toUpperCase());
const round = v => Math.round(v * 100) / 100;

const dayMs = 86_400_000;

/* ─── 1. PRICE HISTORY FROM ORDERS ──────────────────────────────────
   For each SKU, bucket line items into distinct price points. Price per
   unit is (unit_price × qty - total_discount) / qty — i.e. what the
   customer actually paid, not the sticker. Rounded to nearest ₹1 to
   form buckets. */
function buildPriceHistory(orders = []) {
  const bySku = new Map();
  let minTs = Infinity, maxTs = 0;

  for (const o of orders) {
    const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (!ts) continue;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
    for (const li of o.line_items || []) {
      const sku = U(li.sku);
      if (!sku) continue;
      const qty     = Number(li.quantity) || 1;
      const sticker = Number(li.price)    || 0;
      const disc    = Number(li.total_discount) || 0;
      if (sticker <= 0 || qty <= 0) continue;
      const paid   = (sticker * qty - disc) / qty;
      const bucket = Math.round(paid); // ₹1 granularity

      const rec = bySku.get(sku) || { sku, byBucket: new Map(), totalUnits: 0, totalRev: 0 };
      const b = rec.byBucket.get(bucket) || { price: bucket, units: 0, revenue: 0, orderCount: 0, discounted: 0, hadDiscount: disc > 0 };
      b.units     += qty;
      b.revenue   += sticker * qty - disc;
      b.orderCount += 1;
      if (disc > 0) b.discounted += qty;
      rec.byBucket.set(bucket, b);
      rec.totalUnits += qty;
      rec.totalRev   += sticker * qty - disc;
      bySku.set(sku, rec);
    }
  }

  const windowDays = Math.max(1, Math.round((maxTs - minTs) / dayMs)) || 1;

  // Finalize: convert bucket map to array, compute units/day
  for (const rec of bySku.values()) {
    rec.points = [...rec.byBucket.values()].map(p => ({
      ...p,
      unitsPerDay: p.units / windowDays,
      avgPaid: p.revenue / p.units,
    })).sort((a, b) => a.price - b.price);
    delete rec.byBucket;
  }
  return { bySku, windowDays };
}

/* ─── 2. PEER BENCHMARKS ─────────────────────────────────────────────
   Group SKUs by productType (falling back to 'Uncategorized') and
   compute medians for price, CTR, CVR, units/day. Using median (not
   mean) so category outliers don't skew the benchmark. */
const median = arr => {
  const sorted = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function buildPeers({ merchantBySku, adBySku, historyBySku, windowDays }) {
  const byType = new Map();
  if (!merchantBySku) return byType;

  for (const [sku, feed] of merchantBySku.entries()) {
    const type = feed.productType || 'Uncategorized';
    const ad   = adBySku?.get(sku) || null;
    const hist = historyBySku?.get(sku) || null;
    const bucket = byType.get(type) || { prices: [], ctrs: [], cvrs: [], unitsPerDay: [], skus: [] };
    if (feed.price > 0) bucket.prices.push(feed.price);
    if (ad?.impressions > 100) {
      bucket.ctrs.push(ad.clicks / ad.impressions);
      if (ad.clicks > 0) bucket.cvrs.push(ad.conversions / ad.clicks);
    }
    if (hist?.totalUnits > 0) bucket.unitsPerDay.push(hist.totalUnits / windowDays);
    bucket.skus.push(sku);
    byType.set(type, bucket);
  }

  const out = new Map();
  for (const [type, b] of byType.entries()) {
    out.set(type, {
      productType:       type,
      skuCount:          b.skus.length,
      medianPrice:       median(b.prices),
      medianCtr:         median(b.ctrs),
      medianCvr:         median(b.cvrs),
      medianUnitsPerDay: median(b.unitsPerDay),
    });
  }
  return out;
}

/* ─── 3. PICK BEST PRICE POINT FROM HISTORICAL DATA ──────────────────
   From points where the SKU has ≥5 units at each, find the point that
   maximizes (revenue). Weight by order count so one-off outliers don't
   win. Returns null if insufficient variation. */
function pickHistoricalOptimum(points) {
  if (!points || points.length < 2) return null;
  const qualified = points.filter(p => p.units >= 5);
  if (qualified.length < 2) return null;
  // Pick the price bucket with highest total revenue in-window
  const best = qualified.reduce((best, p) => p.revenue > (best?.revenue || 0) ? p : best, null);
  return best;
}

/* ─── 4. DISCOUNT ELASTICITY FROM HISTORY ────────────────────────────
   Split history into "full price" and "discounted" sales. If
   discounted-units-per-day > 1.2× full-price rate, we have elasticity. */
function discountElasticity(points) {
  if (!points || points.length === 0) return null;
  const discounted = points.filter(p => p.discounted > p.units * 0.5);
  const fullPrice  = points.filter(p => p.discounted <= p.units * 0.5);
  if (!discounted.length || !fullPrice.length) return null;
  const dUnitsPerDay = discounted.reduce((a, p) => a + p.unitsPerDay, 0);
  const fUnitsPerDay = fullPrice.reduce((a, p) => a + p.unitsPerDay, 0);
  if (fUnitsPerDay <= 0) return null;
  const liftRatio = dUnitsPerDay / fUnitsPerDay;
  const dAvgPaid  = discounted.reduce((a, p) => a + p.avgPaid * p.units, 0) / discounted.reduce((a, p) => a + p.units, 0);
  const fAvgPaid  = fullPrice.reduce((a, p) => a + p.avgPaid * p.units, 0) / fullPrice.reduce((a, p) => a + p.units, 0);
  return { liftRatio, discountedPrice: dAvgPaid, fullPrice: fAvgPaid };
}

/* ─── 5. MAIN ─────────────────────────────────────────────────────── */
export function buildPriceSuggestions({
  orders = [],
  merchantBySku = null,
  adBySku = null,        // from aggregateShoppingBySku()
  minDeltaPct = 0.03,
  minUnits = 10,
  minImpressions = 300,
} = {}) {
  const { bySku: historyBySku, windowDays } = buildPriceHistory(orders);
  const peers = buildPeers({ merchantBySku, adBySku, historyBySku, windowDays });

  const suggestions = [];

  // Universe of SKUs we'll consider: anything in feed OR with orders OR with ad impressions
  const universe = new Set();
  if (merchantBySku) for (const k of merchantBySku.keys()) universe.add(k);
  for (const k of historyBySku.keys()) universe.add(k);
  if (adBySku) for (const k of adBySku.keys()) universe.add(k);

  for (const sku of universe) {
    const feed = merchantBySku?.get(sku) || null;
    const ad   = adBySku?.get(sku)       || null;
    const hist = historyBySku.get(sku)   || null;

    // Must clear volume floor OR be something we can actually move the needle on
    const hasVolume = (hist?.totalUnits || 0) >= minUnits || (ad?.impressions || 0) >= minImpressions;
    if (!hasVolume) continue;

    // Current price: prefer merchant feed (authoritative current list), fall
    // back to most-recent order's sticker price.
    const currentPrice = feed?.price > 0
      ? feed.price
      : (hist?.points?.[hist.points.length - 1]?.price || null);
    if (!currentPrice) continue;

    const peer = peers.get(feed?.productType || 'Uncategorized') || null;
    const adCtr = ad?.impressions > 0 ? ad.clicks / ad.impressions : null;
    const adCvr = ad?.clicks      > 0 ? ad.conversions / ad.clicks : null;

    const candidates = [];

    /* Method A: Historical A/B */
    const optimum = pickHistoricalOptimum(hist?.points);
    if (optimum && Math.abs(optimum.price - currentPrice) / currentPrice >= minDeltaPct) {
      // Velocity at optimum vs current-price bucket
      const currentBucket = hist.points.find(p => Math.abs(p.price - currentPrice) / currentPrice < 0.02);
      const velocityLift  = currentBucket && currentBucket.unitsPerDay > 0
        ? (optimum.unitsPerDay / currentBucket.unitsPerDay) - 1
        : null;
      candidates.push({
        method: 'historical',
        suggestedPrice: optimum.price,
        confidence: 'high',
        evidence: `${optimum.units}u sold at ₹${optimum.price} vs ${currentBucket?.units || 0}u at current`,
        clickUplift:      null, // historical A/B tells us conversion, not click
        conversionUplift: velocityLift,
        revenueUplift:    velocityLift,
      });
    }

    /* Method B: Discount response */
    const elast = discountElasticity(hist?.points);
    if (elast && elast.liftRatio > 1.2 && Math.abs(elast.discountedPrice - currentPrice) / currentPrice >= minDeltaPct) {
      candidates.push({
        method: 'discount_response',
        suggestedPrice: round(elast.discountedPrice),
        confidence: 'medium',
        evidence: `Discounted units sell ${(elast.liftRatio).toFixed(1)}× faster than full price`,
        clickUplift:      null,
        conversionUplift: elast.liftRatio - 1,
        revenueUplift:    (elast.discountedPrice / elast.fullPrice) * elast.liftRatio - 1,
      });
    }

    /* Method C: Peer benchmark — only if A/B isn't conclusive */
    if (peer?.medianPrice && peer?.medianCtr && peer?.medianCvr) {
      const overpriced = currentPrice > peer.medianPrice * 1.15;
      const ctrGap     = adCtr != null && adCtr < peer.medianCtr * 0.75;
      const cvrGap     = adCvr != null && adCvr < peer.medianCvr * 0.75;
      if (overpriced && (ctrGap || cvrGap)) {
        const ctrLift = adCtr ? peer.medianCtr / adCtr - 1 : null;
        const cvrLift = adCvr ? peer.medianCvr / adCvr - 1 : null;
        candidates.push({
          method: 'peer_benchmark',
          suggestedPrice: round(peer.medianPrice),
          confidence: 'low',
          evidence: `${(currentPrice / peer.medianPrice * 100 - 100).toFixed(0)}% above peer median${ctrGap ? ' · CTR trailing peers' : ''}${cvrGap ? ' · CVR trailing peers' : ''}`,
          clickUplift:      ctrLift,
          conversionUplift: cvrLift,
          revenueUplift:    null,
        });
      }
      // Inverse: underpriced + converting well → raise price
      const underpriced = currentPrice < peer.medianPrice * 0.85;
      const cvrStrong   = adCvr != null && adCvr > peer.medianCvr * 1.3;
      if (underpriced && cvrStrong) {
        candidates.push({
          method: 'peer_benchmark_raise',
          suggestedPrice: round(peer.medianPrice * 0.95),
          confidence: 'low',
          evidence: `${(100 - currentPrice / peer.medianPrice * 100).toFixed(0)}% below peer median · CVR outperforming`,
          clickUplift:      null,
          conversionUplift: null,
          revenueUplift:    (peer.medianPrice * 0.95 / currentPrice) - 1, // pure price lift, assumes CVR holds
        });
      }
    }

    if (!candidates.length) continue;

    // Pick strongest candidate (confidence tier, then magnitude)
    const tier = { high: 3, medium: 2, low: 1 };
    candidates.sort((a, b) => (tier[b.confidence] - tier[a.confidence]) ||
      (Math.abs((b.revenueUplift || b.conversionUplift || 0)) - Math.abs((a.revenueUplift || a.conversionUplift || 0))));
    const best = candidates[0];

    const deltaPct = (best.suggestedPrice - currentPrice) / currentPrice;

    // Effectiveness = volume × expected uplift
    const refVolume = (ad?.cost || 0) + (hist?.totalRev || 0);
    const expectedUplift = Math.abs(best.revenueUplift || best.conversionUplift || best.clickUplift || 0);
    const impact = refVolume * expectedUplift;
    const effectiveness = impact > 10000 ? 'high' : impact > 2000 ? 'medium' : 'low';

    suggestions.push({
      sku,
      title:           feed?.title || hist?.title || sku,
      image:           feed?.imageLink || null,
      link:            feed?.link || null,
      productType:     feed?.productType || 'Uncategorized',
      currentPrice,
      suggestedPrice:  best.suggestedPrice,
      deltaPct,
      deltaAbs:        best.suggestedPrice - currentPrice,
      clickUplift:     best.clickUplift,
      conversionUplift: best.conversionUplift,
      revenueUplift:   best.revenueUplift,
      effectiveness,
      method:          best.method,
      confidence:      best.confidence,
      evidence:        best.evidence,
      units90d:        hist?.totalUnits || 0,
      rev90d:          hist?.totalRev   || 0,
      adSpend:         ad?.cost || 0,
      adImpressions:   ad?.impressions || 0,
      adCtr, adCvr,
      peerMedianPrice: peer?.medianPrice || null,
    });
  }

  // Sort: effectiveness tier, then |deltaPct| × volume
  const effTier = { high: 3, medium: 2, low: 1 };
  suggestions.sort((a, b) => (effTier[b.effectiveness] - effTier[a.effectiveness]) ||
    (Math.abs(b.deltaPct) * (b.rev90d + b.adSpend) - Math.abs(a.deltaPct) * (a.rev90d + a.adSpend)));

  const totals = {
    count:        suggestions.length,
    toLower:      suggestions.filter(s => s.deltaPct < 0).length,
    toRaise:      suggestions.filter(s => s.deltaPct > 0).length,
    estRevUplift: suggestions.reduce((a, s) => a + (s.revenueUplift || 0) * s.rev90d, 0),
    windowDays,
  };

  return { suggestions, peers: [...peers.values()], totals };
}
