/**
 * Star Products enrichment pipeline — bolts the advanced-stats
 * toolkit onto the base buildStarProducts output.
 *
 * Per-SKU additions:
 *   velocityEWMA             — exponentially-smoothed daily velocity
 *   trend                    — { slope, pValue, significant, direction }
 *   forecast                 — { level, trend, seasonal, forecast: [14d] }
 *   stockoutProb             — probability of stockout over lead time
 *   dosCI                    — days-of-stock with 95% CI
 *   changepoint              — { date, magnitude, direction, significant }
 *   seasonalIndex            — [7] weekly multipliers
 *   anomalies                — daily z-score / IQR outliers
 *   elasticity               — { elasticity, rSquared, n } from log-log
 *   archetype                — cluster label (0..k-1) and human name
 *   velocityCI               — bootstrap 90% CI on daily velocity
 *
 * Dataset-level additions:
 *   archetypes               — centroids + cluster names
 *   bundles                  — FP-growth pairs AND triplets
 *   clv                      — BG/NBD + Gamma-Gamma customer projections
 *   diagnostics              — date-span, coverage, data-health summary
 */

import {
  dailyBucket, ewma, holtLinear, holtWinters,
  mannKendall, seasonalIndex,
  stockoutProbability, daysOfStockCI,
  kmeans,
  detectChangepoint,
  fpGrowthLite,
  kaplanMeier, kmMedian,
  bgNbdMomentFit, bgNbdPredict, gammaGammaPredict,
  logLogElasticity,
  zScoreAnomalies, iqrOutliers,
  bootstrapCI,
  _utils,
} from './advancedStats';

const { mean } = _utils;
const DAY_MS = 86_400_000;

/* ─── PER-SKU DAILY SERIES BUILDER ───────────────────────────────
   Walk orders once, build {sku → [dates, unitsByDay]} covering the
   widest date span we have. */
function buildPerSkuDaily(orders = []) {
  if (!orders?.length) return { map: new Map(), minTs: 0, maxTs: 0 };
  let minTs = Infinity, maxTs = -Infinity;
  const pts = new Map(); // sku → {dates: [], units: []}
  for (const o of orders) {
    const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (!ts) continue;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
    for (const li of o.line_items || []) {
      const sku = (li.sku || '').trim().toUpperCase();
      if (!sku) continue;
      const qty = Number(li.quantity) || 1;
      const price = Number(li.price) || 0;
      let rec = pts.get(sku);
      if (!rec) { rec = { dates: [], units: [], prices: [], ts: [] }; pts.set(sku, rec); }
      rec.dates.push(o.created_at);
      rec.units.push(qty);
      rec.prices.push(price);
      rec.ts.push(ts);
    }
  }
  return { map: pts, minTs, maxTs };
}

/* ─── MAIN ENRICH ───────────────────────────────────────────────── */
export function enrichStarProducts({ skus = [], orders = [], now = Date.now(), archetypeK = 6 } = {}) {
  const { map: perSku, minTs, maxTs } = buildPerSkuDaily(orders);
  const spanDays = Math.max(1, Math.round((maxTs - minTs) / DAY_MS) + 1);

  /* Cluster feature matrix collector — we'll k-means at the end once
     every SKU has its enriched metrics. */
  const clusterInput = [];

  /* Pass 1: per-SKU deep stats */
  const enriched = skus.map(s => {
    const rec = perSku.get(s.sku);
    const out = { ...s };

    if (!rec || rec.dates.length < 3) {
      // Too few data points for anything meaningful
      out.advanced = { insufficient: true };
      return out;
    }

    // Daily bucket across the shared min/max so calendars align
    const { dates, units } = dailyBucket(rec.dates, rec.units, { start: minTs, end: maxTs });
    const nonZeroDays = units.filter(u => u > 0).length;

    // EWMA velocity
    const ew = ewma(units, 0.3);
    const velocityEWMA = ew.length ? ew[ew.length - 1] : 0;

    // Mann-Kendall trend
    const trend = mannKendall(ew);

    // Forecast: Holt-Winters if we have ≥14 days, else Holt linear
    let forecast = null;
    if (dates.length >= 14) {
      forecast = holtWinters(units, { period: 7, h: 14 }) || holtLinear(units, 0.3, 0.1, 14);
    } else if (dates.length >= 5) {
      forecast = holtLinear(units, 0.3, 0.1, 14);
    }

    // Stockout probability + DOS CI
    const stock = s.stock ?? null;
    const leadDays = s.leadTimeDays || 14;
    const stockoutProb = stockoutProbability({ velocity: velocityEWMA, leadDays, stock: stock || 0 });
    const dosCI = forecast && stock != null
      ? daysOfStockCI({ stock, forecast: forecast.forecast })
      : null;

    // Changepoint detection
    const changepoint = detectChangepoint(ew);
    if (changepoint) {
      changepoint.date = dates[changepoint.index];
    }

    // Seasonal index (weekly)
    const seasonal = seasonalIndex(units, 7);

    // Anomalies
    const anomZ = zScoreAnomalies(units, 3);
    const anomIQR = iqrOutliers(units);
    const anomalies = anomZ.map(a => ({ date: dates[a.index], value: a.value, z: a.z }));

    // Price elasticity (requires ≥3 distinct prices with sales)
    const pricePoints = rec.prices.map((p, i) => ({ price: Math.round(p), qty: rec.units[i] }));
    // Group by price bucket, sum qty
    const byBucket = new Map();
    for (const p of pricePoints) {
      const cur = byBucket.get(p.price) || { price: p.price, qty: 0 };
      cur.qty += p.qty;
      byBucket.set(p.price, cur);
    }
    const elasticityPts = [...byBucket.values()];
    const elasticity = logLogElasticity(elasticityPts);

    // Bootstrap CI on daily velocity (only nonzero days for meaningful CI)
    const velocityCI = nonZeroDays >= 5 ? bootstrapCI(units, mean) : null;

    out.advanced = {
      velocityEWMA,
      velocityCI,
      trend,
      forecast,
      stockoutProb,
      dosCI,
      changepoint,
      seasonal,
      anomalies,
      elasticity,
      spanDays: dates.length,
      nonZeroDays,
      coverage: dates.length > 0 ? nonZeroDays / dates.length : 0,
    };

    // Feature vector for clustering: only include playable SKUs with data
    if (!s.thinData && units.length >= 7) {
      clusterInput.push({
        id: s.sku,
        features: [
          velocityEWMA,                                          // absolute velocity
          trend.slope,                                           // directional
          s.gatewayRate ?? 0,                                    // acquisition lean
          s.repeatRate ?? 0,                                     // retention lean
          s.bundleRate ?? 0,                                     // basket attach
          Math.log1p(s.revenueWindow || 0),                      // scale (log-damped)
          seasonal ? _utils.stdev(seasonal) : 0,                 // seasonality strength
          out.advanced.coverage,                                 // how often it sells
          elasticity.elasticity ?? 0,                            // price sensitivity
        ],
      });
    }
    return out;
  });

  /* Pass 2: k-means on feature matrix → archetype per SKU */
  let archetypeMap = new Map();
  let archetypes = [];
  if (clusterInput.length >= archetypeK * 3) {
    const { clusters, centroids } = kmeans(clusterInput, archetypeK);
    for (const c of clusters) archetypeMap.set(c.id, c.cluster);
    archetypes = centroids.map((centroid, i) => ({
      id: i,
      centroid,
      name: nameArchetype(centroid, i),
      size: clusters.filter(c => c.cluster === i).length,
    }));
  }
  for (const e of enriched) {
    const c = archetypeMap.get(e.sku);
    if (c != null) {
      e.archetype = c;
      e.archetypeName = archetypes[c]?.name || `Cluster ${c}`;
    } else {
      e.archetype = null;
      e.archetypeName = null;
    }
  }

  /* Pass 3: bundle mining across orders */
  const baskets = [];
  for (const o of orders) {
    const skusInOrder = new Set();
    for (const li of o.line_items || []) {
      const sku = (li.sku || '').trim().toUpperCase();
      if (sku) skusInOrder.add(sku);
    }
    if (skusInOrder.size >= 2) baskets.push([...skusInOrder]);
  }
  const bundles = fpGrowthLite(baskets, { minCount: 3, minLift: 1.2 });

  /* Pass 4: CLV via BG/NBD + Gamma-Gamma on customer-level aggregates */
  const clv = computeClv(orders);

  /* Pass 5: dataset-level diagnostics */
  const diagnostics = {
    orderCount: orders.length,
    oldestOrder: minTs ? new Date(minTs).toISOString().slice(0, 10) : null,
    newestOrder: maxTs ? new Date(maxTs).toISOString().slice(0, 10) : null,
    spanDays,
    last14dOrders: orders.filter(o => new Date(o.created_at).getTime() > now - 14 * DAY_MS).length,
    last30dOrders: orders.filter(o => new Date(o.created_at).getTime() > now - 30 * DAY_MS).length,
    skusWithData:   enriched.filter(s => !s.advanced?.insufficient).length,
    skusWithTrend:  enriched.filter(s => s.advanced?.trend?.significant).length,
    archetypeCount: archetypes.length,
  };

  return { skus: enriched, archetypes, bundles, clv, diagnostics };
}

/* ─── ARCHETYPE NAMING ─────────────────────────────────────────────
   Simple heuristic: inspect the z-scored centroid and pick the most
   salient feature to name the cluster. Feature order (from
   clusterInput above):
     [0] velocity, [1] trend slope, [2] gatewayRate, [3] repeatRate,
     [4] bundleRate, [5] log(revenue), [6] seasonality, [7] coverage,
     [8] elasticity */
function nameArchetype(centroid, idx) {
  const [v, slope, gw, rep, bnd, rev, seas, cov, elast] = centroid;
  const hi = (x) => x > 0.7;
  const lo = (x) => x < -0.7;
  if (hi(rev) && hi(v) && hi(gw)) return 'Hero Acquirer';
  if (hi(rev) && hi(v) && hi(rep)) return 'Hero Retainer';
  if (hi(rev) && hi(v)) return 'Scaling Hero';
  if (hi(bnd)) return 'Basket Filler';
  if (hi(gw) && !hi(rep)) return 'Gateway SKU';
  if (hi(rep) && !hi(gw)) return 'Repeat Driver';
  if (hi(slope)) return 'Rising Star';
  if (lo(slope)) return 'Fading';
  if (hi(seas)) return 'Seasonal';
  if (lo(cov)) return 'Intermittent';
  if (lo(elast)) return 'Price-Sensitive';
  if (lo(v) && lo(rev)) return 'Long Tail';
  return `Archetype ${idx + 1}`;
}

/* ─── CLV computation via BG/NBD + Gamma-Gamma ────────────────── */
function computeClv(orders = []) {
  // Build per-customer aggregates. Use email (or customer_id) as key.
  const byCust = new Map();
  for (const o of orders) {
    const key = (o.customer?.email || o.email || o.customer?.id || '').toLowerCase();
    if (!key) continue;
    const ts = new Date(o.created_at).getTime();
    if (!ts) continue;
    const total = Number(o.total_price) || 0;
    const cur = byCust.get(key) || { key, count: 0, firstTs: ts, lastTs: ts, totalSpend: 0 };
    cur.count++;
    cur.totalSpend += total;
    if (ts < cur.firstTs) cur.firstTs = ts;
    if (ts > cur.lastTs)  cur.lastTs  = ts;
    byCust.set(key, cur);
  }
  if (byCust.size < 20) return null;

  const now = Date.now();
  const customers = [...byCust.values()].map(c => ({
    id: c.key,
    x: Math.max(0, c.count - 1),                    // repeat transactions
    T: Math.max(1, (now - c.firstTs) / DAY_MS),     // age (days)
    t_x: Math.max(0, (c.lastTs - c.firstTs) / DAY_MS),
    mValue: c.count > 0 ? c.totalSpend / c.count : 0,
  }));

  const params = bgNbdMomentFit(customers);
  if (!params) return null;

  const popMean = mean(customers.filter(c => c.x > 0).map(c => c.mValue));

  // Predict 60-day expected transactions + 180-day CLV for each customer
  const predictions = customers.map(c => {
    const bg = bgNbdPredict(c, params, 60);
    const avgSpend = gammaGammaPredict(c, { popMean });
    return {
      id: c.id,
      x: c.x,
      T: c.T,
      pAlive: bg?.pAlive ?? 0,
      expected60d: bg?.expected ?? 0,
      avgSpend,
      clv60d: (bg?.expected ?? 0) * avgSpend,
    };
  }).sort((a, b) => b.clv60d - a.clv60d);

  // Survival (Kaplan-Meier) on time-to-next-order
  const kmRecords = customers
    .filter(c => c.x > 0)
    .map(c => ({ duration: c.t_x / Math.max(1, c.x), observed: 1 }));
  const kmCurve = kaplanMeier(kmRecords);
  const medianNextOrderDays = kmMedian(kmCurve);

  return {
    params,
    popMean,
    topCustomers: predictions.slice(0, 50),
    summary: {
      customersModeled: customers.length,
      atRiskCount: predictions.filter(p => p.pAlive < 0.3).length,
      activeCount:  predictions.filter(p => p.pAlive > 0.7).length,
      expected60dTotal: predictions.reduce((s, p) => s + (p.expected60d || 0), 0),
      clv60dTotal:      predictions.reduce((s, p) => s + (p.clv60d || 0), 0),
      medianNextOrderDays,
    },
    kmCurve,
  };
}
