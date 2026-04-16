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
