import { safeNum, safeDivide, median } from './analytics.js';

/* ─── QUALITY RANK SCORES ─────────────────────────────────────────── */

const RANK_SCORE = {
  ABOVE_AVERAGE: 2,
  AVERAGE: 1,
  BELOW_AVERAGE: 0,
};

const rankScore = v => RANK_SCORE[String(v).toUpperCase()] ?? 1;

/* ─── FATIGUE SCORE: 0–100 (100 = imminent death) ─────────────────── */
// Weights: freq growth 25% | quality rank 30% | CTR decay 20% | ROAS decay 25%

export function calcFatigueScore(r7, r30) {
  if (!r7) return 0;

  let score = 0;

  // 1. Frequency growth pressure (0–25)
  const freq7  = safeNum(r7.frequency);
  const freq30 = r30 ? safeNum(r30.frequency) : 0;
  let freqScore = 0;
  if (freq7 >= 5) freqScore = 25;
  else if (freq7 >= 4) freqScore = 20;
  else if (freq7 >= 3) freqScore = 14;
  else if (freq7 >= 2.5) freqScore = 9;
  else if (freq7 >= 2) freqScore = 5;
  if (r30 && freq30 > 0 && freq7 > freq30) {
    freqScore = Math.min(25, freqScore + (freq7 - freq30) * 4);
  }
  score += Math.min(25, freqScore);

  // 2. Quality rank decay (0–30)
  const qualNow  = rankScore(r7.qualityRanking);
  const qualPrev = r30 ? rankScore(r30.qualityRanking) : qualNow;
  const engNow   = rankScore(r7.engagementRanking);
  const convNow  = rankScore(r7.conversionRanking);
  const avgRankNow = (qualNow + engNow + convNow) / 3;
  let qualScore = (2 - avgRankNow) * 10; // 0 if above avg, 20 if below_avg
  if (qualNow < qualPrev) qualScore += 10; // rank dropped
  score += Math.min(30, Math.max(0, qualScore));

  // 3. CTR decay (0–20)
  let ctrScore = 0;
  if (r30 && safeNum(r30.ctrAll) > 0) {
    const ctrDelta = (safeNum(r7.ctrAll) - safeNum(r30.ctrAll)) / safeNum(r30.ctrAll);
    if (ctrDelta <= -0.4) ctrScore = 20;
    else if (ctrDelta <= -0.25) ctrScore = 15;
    else if (ctrDelta <= -0.15) ctrScore = 10;
    else if (ctrDelta <= -0.05) ctrScore = 5;
  } else {
    // No baseline — use absolute CTR
    const ctr = safeNum(r7.ctrAll);
    if (ctr > 0 && ctr < 0.5) ctrScore = 15;
    else if (ctr < 1) ctrScore = 7;
  }
  score += ctrScore;

  // 4. ROAS decay (0–25)
  let roasScore = 0;
  if (r30 && safeNum(r30.metaRoas) > 0) {
    const roasDelta = (safeNum(r7.metaRoas) - safeNum(r30.metaRoas)) / safeNum(r30.metaRoas);
    if (roasDelta <= -0.4) roasScore = 25;
    else if (roasDelta <= -0.25) roasScore = 18;
    else if (roasDelta <= -0.15) roasScore = 12;
    else if (roasDelta <= -0.05) roasScore = 6;
  } else {
    const roas = safeNum(r7.metaRoas);
    if (roas > 0 && roas < 2) roasScore = 20;
    else if (roas < 3) roasScore = 10;
  }
  score += roasScore;

  return Math.round(Math.min(100, Math.max(0, score)));
}

/* ─── DAYS UNTIL FATIGUE ─────────────────────────────────────────── */
// Simple regression: project how many days until fatigue score hits 70

export function calcDaysUntilFatigue(r7, r30) {
  const fs = calcFatigueScore(r7, r30);
  if (fs >= 70) return 0;
  if (!r30 || safeNum(r30.spend) <= 0) return null;

  // Rough linear projection from 30D baseline
  const freq7  = safeNum(r7.frequency);
  const freq30 = safeNum(r30.frequency);
  const freqGrowthPerDay = freq30 > 0 && freq7 > freq30
    ? (freq7 - freq30) / 7
    : freq7 > 0 ? 0.05 : 0;

  if (freqGrowthPerDay <= 0) return null;

  // Project days until freq hits 5 (fatigue zone)
  const daysToFreq5 = freq7 < 5 ? (5 - freq7) / freqGrowthPerDay : 0;
  const projected = Math.round(Math.min(90, Math.max(0, daysToFreq5)));
  return projected > 0 ? projected : null;
}

/* ─── MOMENTUM SCORE: -100 to +100 ──────────────────────────────── */
// Weights: ROAS 30% | CPR 25% | Spend 20% | CTR 15% | CPM 10%

export function calcMomentumScore(r7, r30) {
  if (!r30 || safeNum(r30.spend) <= 0) return 0;

  const delta = (now, prev) => {
    prev = safeNum(prev);
    if (prev <= 0) return 0;
    return (safeNum(now) - prev) / prev;
  };

  const roasDelta  = delta(r7.metaRoas, r30.metaRoas);
  const cprDelta   = delta(r7.metaCpr, r30.metaCpr);
  const spendDelta = delta(r7.spend, r30.spend);
  const ctrDelta   = delta(r7.ctrAll, r30.ctrAll);
  const cpmDelta   = delta(r7.cpm, r30.cpm);

  // Normalize to -1..1 range (cap at ±60% movement)
  const norm = v => Math.max(-1, Math.min(1, v / 0.6));

  // CPR and CPM: negative delta is good
  const score =
    norm(roasDelta)   *  30 +
    norm(-cprDelta)   *  25 +
    norm(spendDelta)  *  20 +
    norm(ctrDelta)    *  15 +
    norm(-cpmDelta)   *  10;

  return Math.round(Math.min(100, Math.max(-100, score)));
}

/* ─── PREDICTED 7D ROAS ─────────────────────────────────────────── */

export function predictRoas7d(r7, r30) {
  const roas7  = safeNum(r7?.metaRoas);
  const roas30 = safeNum(r30?.metaRoas);
  if (roas7 <= 0) return null;
  if (roas30 <= 0) return roas7;

  const trend = (roas7 - roas30) / roas30;
  // Apply 50% of trend as projected momentum (regression to mean)
  const predicted = roas7 * (1 + trend * 0.5);
  return Math.max(0, Math.round(predicted * 100) / 100);
}

/* ─── FUNNEL LEAK DIAGNOSIS ──────────────────────────────────────── */
// Identifies which stage is most below account median

export function calcFunnelLeak(r, medians) {
  if (!r || !medians) return { stage: 'None', gap: 0 };

  const stages = [
    { stage: 'LPV',      value: r.lpvRate,      median: medians.lpvRate      },
    { stage: 'ATC',      value: r.atcRate,       median: medians.atcRate      },
    { stage: 'Purchase', value: r.purchaseRate,  median: medians.purchaseRate },
  ];

  let worstStage = 'None';
  let worstGap   = 0;

  stages.forEach(({ stage, value, median: med }) => {
    if (!med || med <= 0) return;
    const gap = (med - safeNum(value)) / med; // % below median
    if (gap > worstGap && gap > 0.15) {
      worstGap   = gap;
      worstStage = stage;
    }
  });

  return {
    stage: worstStage,
    gap:   Math.round(worstGap * 100),
  };
}

/* ─── HOOK × HOLD MATRIX ─────────────────────────────────────────── */
// Returns scatter data: hookRate (x) × holdRate (y), sized by spend

export function buildHookHoldMatrix(enrichedRows) {
  return enrichedRows
    .filter(r => safeNum(r.spend) > 0 && safeNum(r.impressions) > 0)
    .map(r => {
      const hookRate = safeDivide(safeNum(r.lpv), safeNum(r.outboundClicks)) * 100;
      const holdRate = safeDivide(safeNum(r.thruplays), safeNum(r.impressions)) * 100;
      return {
        adId:      r.adId,
        adName:    r.adName,
        campaign:  r.campaignName,
        collection: r.collection || 'Unknown',
        creator:   r.creator || 'Unknown',
        hookRate:  Math.round(hookRate * 10) / 10,
        holdRate:  Math.round(holdRate * 10) / 10,
        spend:     Math.round(safeNum(r.spend)),
        roas:      safeNum(r.metaRoas),
        cpr:       safeNum(r.metaCpr),
        decision:  r.decision,
      };
    })
    .filter(r => r.hookRate > 0 || r.holdRate > 0);
}

/* ─── OFFER LIFT MATRIX (Collection × Offer Type ROAS heatmap) ───── */

export function buildOfferLiftMatrix(enrichedRows) {
  const matrix = {};
  enrichedRows.forEach(r => {
    const col   = r.collection  || 'Unknown';
    const offer = r.offerType   || 'Unknown';
    const key   = `${col}||${offer}`;
    if (!matrix[key]) matrix[key] = { collection: col, offerType: offer, spend: 0, revenue: 0, purchases: 0, count: 0 };
    matrix[key].spend     += safeNum(r.spend);
    matrix[key].revenue   += safeNum(r.revenue);
    matrix[key].purchases += safeNum(r.purchases);
    matrix[key].count     += 1;
  });

  return Object.values(matrix)
    .filter(m => m.spend > 0)
    .map(m => ({
      ...m,
      roas: safeDivide(m.revenue, m.spend),
      cpr:  safeDivide(m.spend, m.purchases),
    }))
    .sort((a, b) => b.roas - a.roas);
}

/* ─── CREATOR PERFORMANCE MATRIX ────────────────────────────────── */

export function buildCreatorMatrix(enrichedRows) {
  const matrix = {};
  enrichedRows.forEach(r => {
    const creator = r.creator || 'Unknown';
    const col     = r.collection || 'Unknown';
    const key     = `${creator}||${col}`;
    if (!matrix[key]) matrix[key] = { creator, collection: col, spend: 0, revenue: 0, purchases: 0, count: 0, roas: 0 };
    matrix[key].spend     += safeNum(r.spend);
    matrix[key].revenue   += safeNum(r.revenue);
    matrix[key].purchases += safeNum(r.purchases);
    matrix[key].count     += 1;
  });

  return Object.values(matrix)
    .filter(m => m.spend > 0)
    .map(m => ({
      ...m,
      roas: safeDivide(m.revenue, m.spend),
      cpr:  safeDivide(m.spend, m.purchases),
    }))
    .sort((a, b) => b.roas - a.roas);
}

/* ─── FREQUENCY TOLERANCE ANALYSIS ──────────────────────────────── */
// For each audience family, compute median ROAS by frequency bucket

export function buildFrequencyTolerance(enrichedRows) {
  const buckets = { '1-1.5': 0, '1.5-2': 1, '2-2.5': 2, '2.5-3': 3, '3-4': 4, '4+': 5 };
  const getBucket = f => {
    if (f < 1.5) return '1-1.5';
    if (f < 2)   return '1.5-2';
    if (f < 2.5) return '2-2.5';
    if (f < 3)   return '2.5-3';
    if (f < 4)   return '3-4';
    return '4+';
  };

  const families = ['Acquisition', 'Retargeting', 'Retention', 'Other'];
  const result = {};

  families.forEach(fam => {
    const rows = enrichedRows.filter(r => r.audienceFamily === fam && safeNum(r.spend) > 0 && safeNum(r.frequency) > 0);
    const byBucket = {};
    rows.forEach(r => {
      const b = getBucket(safeNum(r.frequency));
      if (!byBucket[b]) byBucket[b] = [];
      byBucket[b].push(safeNum(r.metaRoas));
    });

    result[fam] = Object.entries(buckets)
      .map(([label]) => ({
        bucket: label,
        medianRoas: median(byBucket[label] || []),
        count: (byBucket[label] || []).length,
      }))
      .filter(x => x.count > 0);
  });

  return result;
}

/* ─── BUDGET OPPORTUNITY MAP ────────────────────────────────────── */
// Underfunded high-ROAS ads + overfunded low-ROAS ads

export function buildBudgetOpportunity(enrichedRows) {
  const valid = enrichedRows.filter(r => safeNum(r.spend) > 100);
  if (!valid.length) return { scale: [], cut: [] };

  const medRoas = median(valid.map(r => safeNum(r.metaRoas)).filter(v => v > 0));
  const medSpend = median(valid.map(r => safeNum(r.spend)).filter(v => v > 0));

  const scale = valid
    .filter(r => safeNum(r.metaRoas) >= medRoas * 1.3 && safeNum(r.spend) < medSpend * 0.7)
    .sort((a, b) => b.metaRoas - a.metaRoas)
    .slice(0, 10)
    .map(r => ({
      adId: r.adId, adName: r.adName, collection: r.collection,
      roas: safeNum(r.metaRoas), spend: safeNum(r.spend),
      budget: r.budget, opportunity: 'Scale Up',
      suggestedBudget: Math.round(r.budget * 1.5 || medSpend * 0.7),
    }));

  const cut = valid
    .filter(r => safeNum(r.metaRoas) < medRoas * 0.6 && safeNum(r.spend) > medSpend * 1.3)
    .sort((a, b) => a.metaRoas - b.metaRoas)
    .slice(0, 10)
    .map(r => ({
      adId: r.adId, adName: r.adName, collection: r.collection,
      roas: safeNum(r.metaRoas), spend: safeNum(r.spend),
      budget: r.budget, opportunity: 'Cut Budget',
      suggestedBudget: Math.round(r.budget * 0.5 || 0),
    }));

  return { scale, cut };
}

/* ─── FUNNEL LEAK AGGREGATE DIAGNOSIS ──────────────────────────── */
// Returns which funnel stage is most commonly leaking across all ads

export function buildFunnelLeakDiagnosis(enrichedRows) {
  const stages = { LPV: 0, ATC: 0, IC: 0, Purchase: 0, None: 0 };
  const stageSums = { LPV: 0, ATC: 0, IC: 0, Purchase: 0 };
  const stageCounts = { LPV: 0, ATC: 0, IC: 0, Purchase: 0 };
  let total = 0;

  enrichedRows.forEach(r => {
    const leak = r.funnelLeak;
    if (!leak) return;
    stages[leak.stage] = (stages[leak.stage] || 0) + 1;
    total++;
    if (leak.stage !== 'None') {
      stageSums[leak.stage]   = (stageSums[leak.stage]   || 0) + leak.gap;
      stageCounts[leak.stage] = (stageCounts[leak.stage] || 0) + 1;
    }
  });

  const topStage = Object.entries(stages)
    .filter(([s]) => s !== 'None')
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';

  return {
    topStage,
    breakdown: Object.entries(stages).map(([stage, count]) => ({
      stage,
      count,
      pct:     total > 0 ? Math.round(count / total * 100) : 0,
      avgGap:  stageCounts[stage] > 0 ? Math.round(stageSums[stage] / stageCounts[stage]) : 0,
    })).sort((a, b) => b.count - a.count),
  };
}

/* ─── VIDEO RETENTION COMPARISON ─────────────────────────────────── */
// Compares P25-P100 retention curves of top vs bottom performers

export function buildRetentionComparison(enrichedRows) {
  const withVideo = enrichedRows.filter(r =>
    safeNum(r.videoPlays) > 100 && safeNum(r.spend) > 0
  );
  if (withVideo.length < 4) return null;

  const sorted = [...withVideo].sort((a, b) => safeNum(b.metaRoas) - safeNum(a.metaRoas));
  const topN   = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.25)));
  const botN   = sorted.slice(-Math.max(1, Math.floor(sorted.length * 0.25)));

  const avgRetention = (rows, field) => {
    const vals = rows.map(r => safeNum(r[field])).filter(v => v > 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };

  const curve = (rows) => ({
    p25:  avgRetention(rows, 'videoP25Rate'),
    p50:  avgRetention(rows, 'videoP50Rate'),
    p75:  avgRetention(rows, 'videoP75Rate'),
    p95:  avgRetention(rows, 'videoP95Rate'),
    p100: avgRetention(rows, 'videoP100Rate'),
    holdRate: avgRetention(rows, 'holdRate'),
    count: rows.length,
  });

  return {
    top:    curve(topN),
    bottom: curve(botN),
    topAds: topN.slice(0, 5).map(r => ({
      adId: r.adId, adName: r.adName, roas: r.metaRoas, spend: r.spend,
    })),
  };
}

/* ─── TRIPLE RECONCILIATION ─────────────────────────────────────── */
// Meta reported vs GA conversions vs Shopify actual orders

export function tripleReconciliation(enrichedRows, gaData, shopifyOrders, daysBack = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  // Meta total purchases in window
  const metaPurchases = enrichedRows.reduce((s, r) => s + safeNum(r.purchases), 0);
  const metaRevenue   = enrichedRows.reduce((s, r) => s + safeNum(r.revenue), 0);
  const metaSpend     = enrichedRows.reduce((s, r) => s + safeNum(r.spend), 0);

  // Shopify orders in window
  const recentOrders = (shopifyOrders || []).filter(o => {
    const d = new Date(o.created_at || o.createdAt);
    return d >= cutoff;
  });
  const shopifyRevenue = recentOrders.reduce((s, o) => {
    return s + safeNum(o.total_price || o.totalPrice || 0);
  }, 0);
  const shopifyOrders7d = recentOrders.length;

  // GA conversions (if available)
  const gaConversions = gaData?.totals?.conversions || 0;
  const gaRevenue     = gaData?.totals?.revenue || 0;

  const attributionGap = metaPurchases > 0
    ? ((metaPurchases - shopifyOrders7d) / metaPurchases) * 100
    : 0;

  return {
    meta: {
      purchases: Math.round(metaPurchases),
      revenue:   Math.round(metaRevenue),
      spend:     Math.round(metaSpend),
      roas:      safeDivide(metaRevenue, metaSpend),
    },
    shopify: {
      orders:  shopifyOrders7d,
      revenue: Math.round(shopifyRevenue),
    },
    ga: {
      conversions: Math.round(gaConversions),
      revenue:     Math.round(gaRevenue),
    },
    attributionGap: Math.round(attributionGap),
    gapRevenue:     Math.round(metaRevenue - shopifyRevenue),
    revenueMatchRate: metaRevenue > 0
      ? Math.round((shopifyRevenue / metaRevenue) * 100)
      : 0,
  };
}

/* ─── AD ↔ SKU COLLISION ALERTS ────────────────────────────────── */
// Which running ads will cause stockouts based on current velocity

export function buildAdSkuCollision(enrichedRows, inventoryMap, shopifyOrders) {
  if (!inventoryMap || !shopifyOrders?.length) return [];

  const cutoff30 = new Date();
  cutoff30.setDate(cutoff30.getDate() - 30);

  // Compute daily sell velocity per SKU from Shopify orders (last 30 days)
  const skuVelocity = {};
  shopifyOrders.forEach(order => {
    const d = new Date(order.created_at || order.createdAt);
    if (d < cutoff30) return;
    (order.line_items || order.lineItems || []).forEach(item => {
      const sku = item.sku || item.SKU || 'UNKNOWN';
      skuVelocity[sku] = (skuVelocity[sku] || 0) + safeNum(item.quantity || 1);
    });
  });
  Object.keys(skuVelocity).forEach(k => { skuVelocity[k] /= 30; });

  const collisions = [];
  const adSkuMap = {}; // adId → sku from manual tags

  enrichedRows.forEach(r => {
    const sku = r.sku;
    if (!sku) return;
    const inv = inventoryMap[sku];
    if (!inv) return;

    const stock    = safeNum(inv.available ?? inv.quantity ?? inv.inventory_quantity);
    const velocity = skuVelocity[sku] || 0;
    const doi      = velocity > 0 ? stock / velocity : 999;

    if (doi < 21 && safeNum(r.spend) > 0) { // less than 3 weeks of stock + actively spending
      collisions.push({
        adId:       r.adId,
        adName:     r.adName,
        sku,
        stock,
        velocity:   Math.round(velocity * 10) / 10,
        doi:        Math.round(doi),
        spend7d:    safeNum(r.spend),
        roas:       safeNum(r.metaRoas),
        urgency:    doi < 7 ? 'critical' : doi < 14 ? 'high' : 'medium',
      });
    }
  });

  return collisions.sort((a, b) => a.doi - b.doi);
}

/* ─── CUSTOMER LTV BY SEGMENT ───────────────────────────────────── */
// Groups customers by campaign type, computes AOV + order frequency

export function buildCustomerLtvBySegment(shopifyOrders, enrichedRows) {
  if (!shopifyOrders?.length) return [];

  // Build campaign type lookup from ad names (best-effort matching)
  const campaignTypes = {};
  enrichedRows.forEach(r => {
    if (r.campaignType) campaignTypes[r.campaignId] = r.campaignType;
  });

  // Group orders by source (UTM or referral)
  const segments = {};
  shopifyOrders.forEach(order => {
    const src = (order.referring_site || order.source_name || 'Organic')
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    const segment = src.includes('facebook') || src.includes('meta')
      ? 'Meta'
      : src.includes('google')
        ? 'Google'
        : src === 'web' ? 'Direct'
        : src || 'Other';

    if (!segments[segment]) segments[segment] = { orders: [], customers: new Set() };
    segments[segment].orders.push(order);
    const email = order.email || order.customer?.email;
    if (email) segments[segment].customers.add(email.toLowerCase());
  });

  return Object.entries(segments).map(([segment, { orders, customers }]) => {
    const revenue = orders.reduce((s, o) => s + safeNum(o.total_price || 0), 0);
    const repeatCustomers = customers.size > 0
      ? orders.filter(o => {
          const email = (o.email || o.customer?.email || '').toLowerCase();
          return email && orders.filter(x => (x.email || x.customer?.email || '').toLowerCase() === email).length > 1;
        }).length
      : 0;

    return {
      segment,
      totalOrders:    orders.length,
      uniqueCustomers: customers.size,
      totalRevenue:   Math.round(revenue),
      aov:            Math.round(safeDivide(revenue, orders.length)),
      ltv:            Math.round(safeDivide(revenue, customers.size || 1)),
      repeatRate:     customers.size > 0 ? Math.round(repeatCustomers / customers.size * 100) : 0,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/* ─── DAY-OVER-DAY ORDER ANALYSIS ───────────────────────────────── */
// Compares yesterday vs day-before-yesterday across all Meta factors
// ydRows / dbRows: normalizeInsight() arrays for each single day
// shopifyOrders: raw Shopify orders array (optional)
// dates: { yd: 'YYYY-MM-DD', db: 'YYYY-MM-DD' }

export function buildDayOverDayAnalysis(ydRows, dbRows, shopifyOrders, dates) {
  const agg = (rows) => {
    if (!rows?.length) return null;
    let spend = 0, impressions = 0, outboundClicks = 0;
    let purchases = 0, revenue = 0, lpv = 0, atc = 0, ic = 0, reach = 0;
    rows.forEach(r => {
      spend          += safeNum(r.spend);
      impressions    += safeNum(r.impressions);
      outboundClicks += safeNum(r.outboundClicks);
      purchases      += safeNum(r.purchases);
      revenue        += safeNum(r.revenue);
      lpv            += safeNum(r.lpv);
      atc            += safeNum(r.atc);
      ic             += safeNum(r.ic);
      reach          += safeNum(r.reach);
    });
    const roas         = safeDivide(revenue, spend);
    const cpr          = purchases > 0 ? spend / purchases : 0;
    const cpm          = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const ctr          = impressions > 0 ? (outboundClicks / impressions) * 100 : 0;
    const convRate     = outboundClicks > 0 ? (purchases / outboundClicks) * 100 : 0;
    const lpvRate      = outboundClicks > 0 ? (lpv / outboundClicks) * 100 : 0;
    const atcRate      = lpv > 0 ? (atc / lpv) * 100 : 0;
    const checkoutRate = ic > 0 ? (purchases / ic) * 100 : 0;
    const frequency    = reach > 0 ? impressions / reach : 0;
    return {
      spend, impressions, outboundClicks, purchases, revenue,
      lpv, atc, ic, reach,
      roas, cpr, cpm, ctr, convRate, lpvRate, atcRate, checkoutRate, frequency,
    };
  };

  const yd = agg(ydRows);
  const db = agg(dbRows);
  if (!yd || !db) return { error: 'Insufficient data for comparison' };

  const pctDelta = (now, prev) => prev && prev !== 0 ? ((now - prev) / Math.abs(prev)) * 100 : 0;

  const orderDelta    = yd.purchases - db.purchases;
  const orderDeltaPct = pctDelta(yd.purchases, db.purchases);
  const direction     = orderDelta > 0.5 ? 'up' : orderDelta < -0.5 ? 'down' : 'flat';

  // Mathematical decomposition: Δorders = spendContribution + efficiencyContribution
  const spendContrib      = db.cpr > 0 ? (yd.spend - db.spend) / db.cpr : 0;
  const efficiencyContrib = db.cpr > 0 && yd.cpr > 0 ? yd.spend * (1 / yd.cpr - 1 / db.cpr) : 0;
  const totalContrib      = spendContrib + efficiencyContrib;

  const spendDelta    = pctDelta(yd.spend, db.spend);
  const cprDelta      = pctDelta(yd.cpr, db.cpr);
  const cpmDelta      = pctDelta(yd.cpm, db.cpm);
  const ctrDelta      = pctDelta(yd.ctr, db.ctr);
  const convDelta     = pctDelta(yd.convRate, db.convRate);
  const impDelta      = pctDelta(yd.impressions, db.impressions);
  const freqDelta     = pctDelta(yd.frequency, db.frequency);
  const roasDelta     = pctDelta(yd.roas, db.roas);

  const factors = [
    {
      id: 'spend', label: 'Ad Spend',
      delta: spendDelta,
      impact: spendContrib,
      yd: yd.spend, db: db.spend, format: 'currency',
      direction: spendDelta > 5 ? 'up' : spendDelta < -5 ? 'down' : 'flat',
      positive: spendDelta > 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(spendDelta) > 5
        ? `Budget ${spendDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(spendDelta).toFixed(1)}% → drove ~${spendContrib > 0 ? '+' : ''}${Math.round(spendContrib)} orders at previous efficiency`
        : `Spend stable (${spendDelta > 0 ? '+' : ''}${spendDelta.toFixed(1)}%)`,
    },
    {
      id: 'efficiency', label: 'Ad Efficiency (ROAS/CPR)',
      delta: -cprDelta,
      impact: efficiencyContrib,
      yd: yd.cpr, db: db.cpr, roasYd: yd.roas, roasDb: db.roas, format: 'currency',
      direction: cprDelta < -5 ? 'up' : cprDelta > 5 ? 'down' : 'flat',
      positive: cprDelta < 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(cprDelta) > 8
        ? `CPR ${db.cpr.toFixed(0)} → ${yd.cpr.toFixed(0)} (${cprDelta > 0 ? 'worse' : 'better'} by ${Math.abs(cprDelta).toFixed(1)}%) · ROAS: ${db.roas.toFixed(2)}x → ${yd.roas.toFixed(2)}x`
        : `Efficiency stable · ROAS ${yd.roas.toFixed(2)}x`,
    },
    {
      id: 'impressions', label: 'Impressions & Reach',
      delta: impDelta, impact: null,
      yd: yd.impressions, db: db.impressions, format: 'number',
      direction: impDelta > 5 ? 'up' : impDelta < -5 ? 'down' : 'flat',
      positive: impDelta > 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(impDelta) > 8
        ? `Impressions ${impDelta > 0 ? 'increased' : 'dropped'} ${Math.abs(impDelta).toFixed(1)}% — ${impDelta > 0 ? 'scale-up or audience expansion' : 'budget cut or delivery issue'}`
        : `Reach stable · ${yd.frequency.toFixed(2)}x frequency`,
    },
    {
      id: 'ctr', label: 'Creative (CTR)',
      delta: ctrDelta, impact: null,
      yd: yd.ctr, db: db.ctr, format: 'pct2',
      direction: ctrDelta > 5 ? 'up' : ctrDelta < -5 ? 'down' : 'flat',
      positive: ctrDelta > 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(ctrDelta) > 8
        ? `CTR ${ctrDelta > 0 ? 'improved' : 'dropped'} ${Math.abs(ctrDelta).toFixed(1)}% → ${ctrDelta > 0 ? 'creative resonating better' : 'ad fatigue or audience mismatch'}`
        : `CTR stable at ${yd.ctr.toFixed(2)}%`,
    },
    {
      id: 'cpm', label: 'Auction Cost (CPM)',
      delta: -cpmDelta, impact: null,
      yd: yd.cpm, db: db.cpm, format: 'currency',
      direction: cpmDelta < -5 ? 'up' : cpmDelta > 5 ? 'down' : 'flat',
      positive: cpmDelta < 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(cpmDelta) > 10
        ? `CPM ${cpmDelta > 0 ? 'spiked' : 'dropped'} ${Math.abs(cpmDelta).toFixed(1)}% → ${cpmDelta > 0 ? 'more auction competition, delivery expensive' : 'delivery efficiency improved'}`
        : `Auction pricing stable at ₹${yd.cpm.toFixed(0)} CPM`,
    },
    {
      id: 'convRate', label: 'On-Site Conversion Rate',
      delta: convDelta, impact: null,
      yd: yd.convRate, db: db.convRate, format: 'pct2',
      direction: convDelta > 5 ? 'up' : convDelta < -5 ? 'down' : 'flat',
      positive: convDelta > 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: Math.abs(convDelta) > 10
        ? `Click→Purchase rate ${convDelta > 0 ? 'improved' : 'dropped'} ${Math.abs(convDelta).toFixed(1)}% → ${convDelta > 0 ? 'landing page / offer converting better' : 'check landing page, UX, or stock issues'}`
        : `Conversion rate stable at ${yd.convRate.toFixed(2)}%`,
    },
    {
      id: 'frequency', label: 'Audience Frequency',
      delta: -freqDelta, impact: null,
      yd: yd.frequency, db: db.frequency, format: 'decimal',
      direction: freqDelta < -5 ? 'up' : freqDelta > 5 ? 'down' : 'flat',
      positive: freqDelta < 0 ? orderDelta >= 0 : orderDelta <= 0,
      detail: yd.frequency > 3.5
        ? `High frequency (${yd.frequency.toFixed(2)}x) — audience saturated, likely hurting CTR and conversion`
        : Math.abs(freqDelta) > 15
        ? `Frequency ${freqDelta > 0 ? 'increased' : 'decreased'} ${Math.abs(freqDelta).toFixed(1)}%`
        : `Frequency healthy at ${yd.frequency.toFixed(2)}x`,
    },
  ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const primaryFactor = factors[0];
  const pf = primaryFactor.id;

  const primaryReason = direction === 'up'
    ? pf === 'spend'      ? `Orders up because spend increased ${Math.abs(spendDelta).toFixed(1)}% — more budget drove more reach`
    : pf === 'efficiency' ? `Orders up because ROAS improved ${db.roas.toFixed(2)}x → ${yd.roas.toFixed(2)}x — same budget, better results`
    : pf === 'convRate'   ? `Orders up because on-site conversion rate improved — landing page or offer performing better`
    : pf === 'ctr'        ? `Orders up because creative CTR improved — ads resonating more`
    : pf === 'cpm'        ? `Orders up because delivery costs dropped — more impressions for same budget`
    : `Orders up — ${primaryFactor.label} shifted most`
    : direction === 'down'
    ? pf === 'spend'      ? `Orders down because spend dropped ${Math.abs(spendDelta).toFixed(1)}% — less budget = less reach`
    : pf === 'efficiency' ? `Orders down because ROAS dropped ${db.roas.toFixed(2)}x → ${yd.roas.toFixed(2)}x — same budget, worse results`
    : pf === 'convRate'   ? `Orders down because on-site conversion rate fell — check landing pages, inventory, or checkout`
    : pf === 'ctr'        ? `Orders down because creative CTR fell — ad fatigue or wrong audience`
    : pf === 'cpm'        ? `Orders down because CPM spiked — delivery is more expensive, fewer impressions`
    : `Orders down — ${primaryFactor.label} shifted most`
    : 'Orders flat — no significant change in any single factor';

  // Ad-level drivers
  const adDrivers = [];
  const dbAdIndex = {};
  (dbRows || []).forEach(r => { dbAdIndex[r.adId] = r; });
  const ydAdIndex = {};
  (ydRows || []).forEach(r => { ydAdIndex[r.adId] = r; });

  (ydRows || []).forEach(r => {
    const prev   = dbAdIndex[r.adId];
    const spYd   = safeNum(r.spend);
    const puYd   = safeNum(r.purchases);
    const roasYd = safeNum(r.metaRoas);

    if (!prev) {
      if (spYd > 50 || puYd > 0) {
        adDrivers.push({
          adId: r.adId, adName: r.adName, type: 'new', label: 'New / Reactivated',
          spendYd: spYd, spendDb: 0, purchYd: puYd, purchDb: 0, roasYd, roasDb: 0,
          impact: puYd, cprYd: safeNum(r.metaCpr), cprDb: 0,
        });
      }
      return;
    }

    const spDb  = safeNum(prev.spend);
    const puDb  = safeNum(prev.purchases);
    const roasDb = safeNum(prev.metaRoas);
    const puDelta = puYd - puDb;
    const roasDeltaAbs = Math.abs(roasYd - roasDb);
    const spDeltaAbs = Math.abs(spYd - spDb);

    if (Math.abs(puDelta) >= 0.5 || roasDeltaAbs >= 0.5 || spDeltaAbs >= 100) {
      const type = spYd < 20 && spDb > 150 ? 'stopped'
        : spYd > 150 && spDb < 20 ? 'started'
        : roasDeltaAbs > roasDb * 0.25 ? 'efficiency'
        : 'changed';
      adDrivers.push({
        adId: r.adId, adName: r.adName, type, label: type === 'stopped' ? 'Paused/Stopped' : type === 'started' ? 'Ramped Up' : type === 'efficiency' ? 'Efficiency Shift' : 'Changed',
        spendYd: spYd, spendDb: spDb, purchYd: puYd, purchDb: puDb, roasYd, roasDb,
        impact: puDelta, cprYd: safeNum(r.metaCpr), cprDb: safeNum(prev.metaCpr),
      });
    }
  });

  // Ads that were in db but disappeared in yd
  (dbRows || []).forEach(r => {
    if (!ydAdIndex[r.adId] && safeNum(r.spend) > 150) {
      adDrivers.push({
        adId: r.adId, adName: r.adName, type: 'stopped', label: 'Paused/Stopped',
        spendYd: 0, spendDb: safeNum(r.spend), purchYd: 0, purchDb: safeNum(r.purchases),
        roasYd: 0, roasDb: safeNum(r.metaRoas), impact: -safeNum(r.purchases),
        cprYd: 0, cprDb: safeNum(r.metaCpr),
      });
    }
  });

  adDrivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  // Shopify confirmation
  let shopify = null;
  if (shopifyOrders?.length && dates) {
    const pick = (dateStr) => {
      const orders = shopifyOrders.filter(o => (o.created_at || o.createdAt || '').slice(0, 10) === dateStr);
      return { orders: orders.length, revenue: orders.reduce((s, o) => s + safeNum(o.total_price || o.totalPrice || 0), 0) };
    };
    shopify = { yd: pick(dates.yd), db: pick(dates.db) };
  }

  // Funnel breakdown
  const funnelDeltas = [
    { stage: 'Impressions',         yd: yd.impressions,    db: db.impressions,    format: 'number' },
    { stage: 'Outbound Clicks',     yd: yd.outboundClicks, db: db.outboundClicks, format: 'number' },
    { stage: 'Landing Page Views',  yd: yd.lpv,            db: db.lpv,            format: 'number' },
    { stage: 'Add to Carts',        yd: yd.atc,            db: db.atc,            format: 'number' },
    { stage: 'Initiated Checkouts', yd: yd.ic,             db: db.ic,             format: 'number' },
    { stage: 'Purchases (Meta)',     yd: yd.purchases,      db: db.purchases,      format: 'number' },
  ].map(s => ({ ...s, delta: pctDelta(s.yd, s.db), change: s.yd - s.db }));

  // Day context
  const ydDate = dates?.yd ? new Date(dates.yd + 'T12:00:00') : new Date();
  const dayOfWeek = ydDate.getDay();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Recommendations
  const recs = [];
  if (direction === 'down') {
    if (pf === 'convRate' && convDelta < -15) recs.push({ priority: 'critical', action: 'Check site / checkout immediately', detail: 'On-site conversion rate dropped sharply — look for broken pages, payment failures, out-of-stock items, or checkout bugs' });
    if (pf === 'cpm' && cpmDelta > 20)        recs.push({ priority: 'high', action: 'Adjust bidding strategy', detail: 'CPM spiked — try cost caps, reduce budget temporarily, or switch to less competitive audiences' });
    if (pf === 'ctr' && ctrDelta < -20)       recs.push({ priority: 'high', action: 'Refresh creatives now', detail: 'CTR dropped sharply — launch 2-3 new creative variants immediately' });
    if (yd.frequency > 3.5)                    recs.push({ priority: 'medium', action: 'Expand audiences', detail: `Frequency at ${yd.frequency.toFixed(1)}x — add lookalikes, broad targeting, or new interest groups` });
    if (pf === 'spend' && spendDelta < -20)    recs.push({ priority: 'medium', action: 'Review budget pacing', detail: 'Spend dropped significantly — check for budget caps, campaign end dates, or policy holds' });
  } else if (direction === 'up') {
    if (pf === 'efficiency' && roasDelta > 20) recs.push({ priority: 'high', action: 'Scale top performers', detail: `ROAS jumped to ${yd.roas.toFixed(2)}x — identify which ads are driving this and increase their budgets 20-30%` });
    if (pf === 'spend' && spendDelta > 30 && yd.roas >= 3) recs.push({ priority: 'medium', action: 'Monitor efficiency as you scale', detail: `Good ROAS (${yd.roas.toFixed(2)}x) with increased spend. Watch for CPM creep and frequency build over next 3-5 days` });
    if (yd.cpr < db.cpr * 0.85)               recs.push({ priority: 'medium', action: 'Document what changed', detail: 'CPR improved significantly — identify the creative, audience, or structure shift and replicate it' });
  }
  if (isWeekend) recs.push({ priority: 'info', action: `${dayName} context`, detail: "Weekend purchase patterns differ — don't make large budget changes based on a single weekend day's data" });

  return {
    dates: { yd: dates?.yd, db: dates?.db },
    dayName, isWeekend,
    yd, db,
    meta: { ydAds: ydRows?.length || 0, dbAds: dbRows?.length || 0 },
    orderDelta, orderDeltaPct, direction,
    primaryReason, primaryFactor: pf,
    factors,
    decomposition: {
      spendContrib:      Math.round(spendContrib * 10) / 10,
      efficiencyContrib: Math.round(efficiencyContrib * 10) / 10,
      total:             Math.round(totalContrib * 10) / 10,
      unexplained:       Math.round((orderDelta - totalContrib) * 10) / 10,
    },
    funnelDeltas,
    adDrivers: adDrivers.slice(0, 25),
    shopify,
    recommendations: recs,
  };
}

/* ─── ALERT GENERATION ──────────────────────────────────────────── */
// Generates prioritized alerts for the Overview dashboard

export function buildAlerts(enrichedRows, inventoryMap, shopifyOrders) {
  const alerts = [];

  // High fatigue ads that are still running with big spend
  const fatigued = enrichedRows.filter(r =>
    safeNum(r.fatigueScore) >= 70 && safeNum(r.spend) > 500
  );
  if (fatigued.length) {
    alerts.push({
      type: 'fatigue',
      severity: 'critical',
      title: `${fatigued.length} high-spend ad${fatigued.length > 1 ? 's' : ''} at critical fatigue`,
      detail: fatigued.slice(0, 3).map(r => r.adName).join(', '),
      count: fatigued.length,
    });
  }

  // Strong momentum ads not being scaled
  const scaleMissed = enrichedRows.filter(r =>
    safeNum(r.momentumScore) >= 50 &&
    safeNum(r.metaRoas) >= 4 &&
    r.decision !== 'Scale Hard' &&
    r.decision !== 'Scale Carefully'
  );
  if (scaleMissed.length) {
    alerts.push({
      type: 'opportunity',
      severity: 'high',
      title: `${scaleMissed.length} high-momentum ad${scaleMissed.length > 1 ? 's' : ''} not being scaled`,
      detail: scaleMissed.slice(0, 3).map(r => r.adName).join(', '),
      count: scaleMissed.length,
    });
  }

  // SKU-collision stockout risks
  const collisions = buildAdSkuCollision(enrichedRows, inventoryMap, shopifyOrders);
  const criticalCollisions = collisions.filter(c => c.urgency === 'critical');
  if (criticalCollisions.length) {
    alerts.push({
      type: 'stockout',
      severity: 'critical',
      title: `${criticalCollisions.length} SKU${criticalCollisions.length > 1 ? 's' : ''} at stockout risk with active ad spend`,
      detail: criticalCollisions.slice(0, 3).map(c => `${c.sku} (${c.doi}d)`).join(', '),
      count: criticalCollisions.length,
    });
  }

  // Kill-zone ads still burning money
  const killZone = enrichedRows.filter(r =>
    r.decision === 'Kill' && safeNum(r.spend) > 200
  );
  if (killZone.length) {
    alerts.push({
      type: 'waste',
      severity: 'high',
      title: `${killZone.length} ad${killZone.length > 1 ? 's' : ''} recommended to Kill still spending`,
      detail: `₹${Math.round(killZone.reduce((s, r) => s + safeNum(r.spend), 0)).toLocaleString()} wasted spend`,
      count: killZone.length,
    });
  }

  // Worsening high-spend ads
  const worsening = enrichedRows.filter(r =>
    r.trendSignal?.includes('Worsening') &&
    safeNum(r.spend) > 1000 &&
    safeNum(r.metaRoas) < 3
  );
  if (worsening.length) {
    alerts.push({
      type: 'worsening',
      severity: 'medium',
      title: `${worsening.length} high-spend ad${worsening.length > 1 ? 's' : ''} worsening below ROAS 3x`,
      detail: worsening.slice(0, 3).map(r => r.adName).join(', '),
      count: worsening.length,
    });
  }

  return alerts.sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
  });
}
