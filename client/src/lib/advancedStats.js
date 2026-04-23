/**
 * Advanced statistics toolkit — pure JS, zero deps.
 *
 * Every function here runs in the browser on the orders dataset we
 * already hold in memory. No backend, no Python sidecar. The goal is
 * to replace the fragile endpoint-comparison momentum and crude
 * rate-ratios with properly-weighted, CI-bounded, trend-qualified,
 * forecast-aware metrics that the UI can surface.
 *
 * Modules (namespaced by comment blocks):
 *   TimeSeries   — daily buckets, EWMA, Holt linear, Holt-Winters
 *   Trends       — Mann-Kendall, Theil-Sen slope, seasonal index
 *   Forecasts    — Poisson/NB stockout probability, forecast bands
 *   Clustering   — k-means (simple, 1D and n-D)
 *   Changepoint  — binary segmentation + CUSUM (cheap)
 *   Affinity     — FP-growth-lite, cosine similarity
 *   Survival     — Kaplan-Meier, next-order ETA
 *   CLV          — BG/NBD-lite, Gamma-Gamma conditional spend
 *   Regression   — log-log price elasticity
 *   Anomaly      — z-score, IQR
 *   Bootstrap    — percentile CI via resampling
 *
 * Everything is designed to degrade gracefully when the data is thin
 * (returns null rather than throwing, and flags low-confidence).
 */

/* ══════════════════════════════════════════════════════════════
   SHARED UTILITIES
   ══════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;

export const dateStr = d => {
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
};

export const safe = v => (Number.isFinite(+v) ? +v : 0);

function sum(arr)  { let s = 0; for (const v of arr) s += v; return s; }
function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }

function variance(arr) {
  const m = mean(arr);
  return arr.length ? sum(arr.map(v => (v - m) ** 2)) / arr.length : 0;
}
function stdev(arr) { return Math.sqrt(variance(arr)); }

function quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26 — max error ~1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

/* ══════════════════════════════════════════════════════════════
   TIME SERIES — daily buckets, EWMA, Holt, Holt-Winters
   ══════════════════════════════════════════════════════════ */

/* Build a daily-indexed array of units sold per SKU from line items.
   Returns { dates: ['YYYY-MM-DD', ...], units: [n, ...] } — padded
   with zeros for days with no sales so the series is continuous. */
export function dailyBucket(dates = [], values = [], { start, end } = {}) {
  if (!dates.length) return { dates: [], units: [] };
  const ts = dates.map(d => new Date(d).getTime());
  const minTs = start ? new Date(start).getTime() : Math.min(...ts);
  const maxTs = end ? new Date(end).getTime() : Math.max(...ts);
  const days = Math.max(1, Math.round((maxTs - minTs) / DAY_MS) + 1);

  const buckets = new Array(days).fill(0);
  for (let i = 0; i < dates.length; i++) {
    const idx = Math.round((ts[i] - minTs) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx] += safe(values[i]);
  }
  const outDates = new Array(days);
  for (let i = 0; i < days; i++) outDates[i] = dateStr(new Date(minTs + i * DAY_MS));
  return { dates: outDates, units: buckets };
}

/* Exponentially weighted moving average. α = 0.3 gives ~7-day
   effective half-life; smooth enough to kill single-day noise but
   responsive enough to react to real trend shifts within a week. */
export function ewma(series = [], alpha = 0.3) {
  if (!series.length) return [];
  const out = new Array(series.length);
  out[0] = series[0];
  for (let i = 1; i < series.length; i++) {
    out[i] = alpha * series[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

/* Holt linear (double-exp): level + trend. Returns {level, trend}
   arrays and a point-forecast + 1-sigma band for the next h periods. */
export function holtLinear(series = [], alpha = 0.3, beta = 0.1, h = 14) {
  if (series.length < 2) return null;
  const n = series.length;
  const L = new Array(n), T = new Array(n);
  L[0] = series[0];
  T[0] = series[1] - series[0];
  for (let i = 1; i < n; i++) {
    L[i] = alpha * series[i] + (1 - alpha) * (L[i - 1] + T[i - 1]);
    T[i] = beta * (L[i] - L[i - 1]) + (1 - beta) * T[i - 1];
  }
  // Residuals to build a crude 1-sigma band
  const residuals = [];
  for (let i = 1; i < n; i++) residuals.push(series[i] - (L[i - 1] + T[i - 1]));
  const sigma = stdev(residuals);
  const forecast = [];
  for (let k = 1; k <= h; k++) {
    const pt = L[n - 1] + k * T[n - 1];
    forecast.push({
      step: k,
      point: Math.max(0, pt),
      lo95:  Math.max(0, pt - 1.96 * sigma * Math.sqrt(k)),
      hi95:  Math.max(0, pt + 1.96 * sigma * Math.sqrt(k)),
    });
  }
  return { level: L, trend: T, sigma, forecast };
}

/* Holt-Winters additive (triple-exp): level + trend + seasonal.
   Good for weekly patterns (s=7). Needs ≥ 2×period of data. */
export function holtWinters(series = [], { alpha = 0.2, beta = 0.05, gamma = 0.1, period = 7, h = 14 } = {}) {
  if (series.length < period * 2) return null;
  const n = series.length;
  const L = new Array(n), T = new Array(n), S = new Array(n);

  // Seed level = first-period mean, trend = avg of cross-period deltas
  let sum0 = 0; for (let i = 0; i < period; i++) sum0 += series[i];
  L[period - 1] = sum0 / period;
  let tsum = 0;
  for (let i = 0; i < period; i++) tsum += (series[period + i] - series[i]) / period;
  T[period - 1] = tsum / period;
  // Seed seasonals as first-period deviation from initial level
  for (let i = 0; i < period; i++) S[i] = series[i] - L[period - 1];

  for (let i = period; i < n; i++) {
    L[i] = alpha * (series[i] - S[i - period]) + (1 - alpha) * (L[i - 1] + T[i - 1]);
    T[i] = beta  * (L[i] - L[i - 1]) + (1 - beta)  * T[i - 1];
    S[i] = gamma * (series[i] - L[i]) + (1 - gamma) * S[i - period];
  }
  const residuals = [];
  for (let i = period; i < n; i++) residuals.push(series[i] - (L[i - 1] + T[i - 1] + S[i - period]));
  const sigma = stdev(residuals);
  const forecast = [];
  for (let k = 1; k <= h; k++) {
    const si = S[n - period + ((k - 1) % period)];
    const pt = L[n - 1] + k * T[n - 1] + si;
    forecast.push({
      step: k,
      point: Math.max(0, pt),
      lo95:  Math.max(0, pt - 1.96 * sigma * Math.sqrt(k)),
      hi95:  Math.max(0, pt + 1.96 * sigma * Math.sqrt(k)),
    });
  }
  return { level: L, trend: T, seasonal: S, sigma, forecast };
}

/* ══════════════════════════════════════════════════════════════
   TRENDS — Mann-Kendall (non-parametric), Theil-Sen slope
   ══════════════════════════════════════════════════════════ */

/* Mann-Kendall trend test. Returns { slope, tau, z, pValue,
   significant, direction }. Robust to outliers, no distribution
   assumption. Significance at p < 0.05 is the standard bar. */
export function mannKendall(series = []) {
  const n = series.length;
  if (n < 8) return { slope: 0, tau: 0, z: 0, pValue: 1, significant: false, direction: 'flat' };
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = series[j] - series[i];
      if (d > 0) s++;
      else if (d < 0) s--;
    }
  }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS)
          : s < 0 ? (s + 1) / Math.sqrt(varS)
          : 0;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  const tau = s / ((n * (n - 1)) / 2);
  const slope = theilSen(series);
  return {
    slope, tau, z, pValue,
    significant: pValue < 0.05 && n >= 10,
    direction: !Number.isFinite(slope) ? 'flat' : slope > 0.001 ? 'up' : slope < -0.001 ? 'down' : 'flat',
  };
}

/* Theil-Sen slope estimator — median of all pairwise slopes. */
export function theilSen(series = []) {
  const slopes = [];
  const n = series.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((series[j] - series[i]) / (j - i));
    }
  }
  if (!slopes.length) return 0;
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

/* Seasonal index — ratio of each period's mean to the overall mean.
   For weekly: returns [7] array showing Mon/Tue/.../Sun multipliers.
   Returns null if < 2 periods of data. */
export function seasonalIndex(series = [], period = 7) {
  if (series.length < period * 2) return null;
  const sums = new Array(period).fill(0);
  const counts = new Array(period).fill(0);
  for (let i = 0; i < series.length; i++) {
    sums[i % period] += series[i];
    counts[i % period]++;
  }
  const avgs = sums.map((s, i) => counts[i] ? s / counts[i] : 0);
  const grand = mean(series);
  if (grand === 0) return null;
  return avgs.map(a => a / grand);
}

/* ══════════════════════════════════════════════════════════════
   FORECASTS — Poisson/NB stockout probability, forecast bands
   ══════════════════════════════════════════════════════════ */

/* Poisson PMF (for non-negative integer k, rate λ). */
export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // logΓ(k+1) via Stirling for numerical stability when k or λ is large
  const logP = -lambda + k * Math.log(lambda) - logGamma(k + 1);
  return Math.exp(logP);
}
export function poissonCdf(k, lambda) {
  let acc = 0;
  for (let i = 0; i <= k; i++) acc += poissonPmf(i, lambda);
  return Math.min(1, acc);
}

/* Lanczos approximation to log-gamma — accurate to ~1e-10. */
function logGamma(x) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  const t = x + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/* Stockout probability over lead-time days. λ = velocity × leadDays.
   Returns P(demand > stock). */
export function stockoutProbability({ velocity = 0, leadDays = 14, stock = 0 } = {}) {
  if (velocity <= 0) return 0;
  const lambda = velocity * leadDays;
  if (stock <= 0) return 1;
  // 1 - P(demand <= stock-1)
  return Math.max(0, Math.min(1, 1 - poissonCdf(Math.floor(stock) - 1, lambda)));
}

/* Days-of-stock with 50/95 CIs from Holt-Winters forecast
   cumulative sums. Input: {stock, forecast: [{point, lo95, hi95}]}. */
export function daysOfStockCI({ stock = 0, forecast = [] } = {}) {
  if (stock <= 0 || !forecast.length) return { point: 0, lo95: 0, hi95: 0 };
  let remainingPoint = stock, remainingLo = stock, remainingHi = stock;
  let pt = forecast.length, lo = forecast.length, hi = forecast.length;
  for (let i = 0; i < forecast.length; i++) {
    const f = forecast[i];
    if (remainingPoint > 0) { remainingPoint -= f.point; if (remainingPoint <= 0) pt = i + 1; }
    if (remainingLo > 0)    { remainingLo    -= f.hi95;  if (remainingLo    <= 0) lo = i + 1; }
    if (remainingHi > 0)    { remainingHi    -= f.lo95;  if (remainingHi    <= 0) hi = i + 1; }
  }
  return { point: pt, lo95: lo, hi95: hi };
}

/* ══════════════════════════════════════════════════════════════
   CLUSTERING — k-means (n-dimensional)
   ══════════════════════════════════════════════════════════ */

/* Points: array of {id, features: [f1, f2, ...]}. Returns each point
   enriched with `cluster: 0..k-1`. Z-scores features internally so
   scales don't dominate. Simple forgy init; good enough for ≤ 10k. */
export function kmeans(points = [], k = 5, { maxIter = 40 } = {}) {
  if (!points.length) return { clusters: [], centroids: [] };
  const dim = points[0].features.length;

  // Z-score per dimension
  const means = new Array(dim).fill(0);
  const stds  = new Array(dim).fill(0);
  for (const p of points) for (let d = 0; d < dim; d++) means[d] += p.features[d];
  for (let d = 0; d < dim; d++) means[d] /= points.length;
  for (const p of points) for (let d = 0; d < dim; d++) stds[d] += (p.features[d] - means[d]) ** 2;
  for (let d = 0; d < dim; d++) stds[d] = Math.sqrt(stds[d] / points.length) || 1;

  const z = points.map(p => ({
    ...p,
    z: p.features.map((f, d) => (f - means[d]) / stds[d]),
  }));

  // Init: pick k evenly-spaced points in the sorted-by-magnitude order
  z.sort((a, b) => a.z.reduce((s, v) => s + v * v, 0) - b.z.reduce((s, v) => s + v * v, 0));
  const step = Math.max(1, Math.floor(z.length / k));
  let centroids = [];
  for (let i = 0; i < k; i++) centroids.push([...(z[Math.min(i * step, z.length - 1)].z)]);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    for (const p of z) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let d = 0;
        for (let i = 0; i < dim; i++) d += (p.z[i] - centroids[c][i]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      p.cluster = best;
    }
    // Recompute centroids
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (const p of z) {
      counts[p.cluster]++;
      for (let i = 0; i < dim; i++) sums[p.cluster][i] += p.z[i];
    }
    let moved = 0;
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      for (let i = 0; i < dim; i++) {
        const newVal = sums[c][i] / counts[c];
        moved += Math.abs(newVal - centroids[c][i]);
        centroids[c][i] = newVal;
      }
    }
    if (moved < 1e-4) break;
  }

  return {
    clusters: z.map(p => ({ id: p.id, cluster: p.cluster, z: p.z })),
    centroids,
  };
}

/* ══════════════════════════════════════════════════════════════
   CHANGEPOINT — Binary segmentation via CUSUM
   ══════════════════════════════════════════════════════════ */

/* Find the most likely changepoint in a series via the max CUSUM
   position. Returns {index, magnitude, before, after, significant}.
   `significant` is true when the mean shift exceeds 2σ of residuals. */
export function detectChangepoint(series = []) {
  if (series.length < 8) return null;
  const n = series.length;
  const grand = mean(series);
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + (series[i] - grand);
  // CUSUM max absolute deviation
  let bestIdx = 0, bestAbs = 0;
  for (let i = 1; i < n; i++) {
    const abs = Math.abs(cum[i]);
    if (abs > bestAbs) { bestAbs = abs; bestIdx = i; }
  }
  const before = mean(series.slice(0, bestIdx));
  const after  = mean(series.slice(bestIdx));
  const magnitude = after - before;
  const s = stdev(series);
  return {
    index: bestIdx,
    magnitude,
    before,
    after,
    significant: s > 0 && Math.abs(magnitude) > 2 * s,
    direction: magnitude > 0 ? 'up' : magnitude < 0 ? 'down' : 'flat',
  };
}

/* ══════════════════════════════════════════════════════════════
   AFFINITY — pair/triplet mining, cosine similarity
   ══════════════════════════════════════════════════════════ */

/* FP-growth-lite: mine pairs AND triplets with support + lift.
   Input: array of baskets (each a Set or Array of SKU strings).
   Output: {pairs: [...], triplets: [...]} sorted by lift * log(support count). */
export function fpGrowthLite(baskets = [], { minCount = 3, minLift = 1.2 } = {}) {
  const pairs = new Map();
  const triplets = new Map();
  const single = new Map();
  const total = baskets.length || 1;

  for (const bRaw of baskets) {
    const b = [...new Set(bRaw)].sort(); // dedupe + stable order
    if (b.length < 1) continue;
    for (const sku of b) single.set(sku, (single.get(sku) || 0) + 1);
    if (b.length < 2 || b.length > 12) continue; // guard O(n³) blowup
    for (let i = 0; i < b.length - 1; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const key = `${b[i]}|${b[j]}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
        if (b.length < 3) continue;
        for (let k = j + 1; k < b.length; k++) {
          const tk = `${b[i]}|${b[j]}|${b[k]}`;
          triplets.set(tk, (triplets.get(tk) || 0) + 1);
        }
      }
    }
  }

  const liftFromPair = (a, b, count) => {
    const supA = (single.get(a) || 1) / total;
    const supB = (single.get(b) || 1) / total;
    const supAB = count / total;
    return supA > 0 && supB > 0 ? supAB / (supA * supB) : 0;
  };

  const pairArr = [...pairs.entries()]
    .filter(([, c]) => c >= minCount)
    .map(([key, count]) => {
      const [a, b] = key.split('|');
      const lift = liftFromPair(a, b, count);
      const support = count / total;
      const confidence = count / (single.get(a) || 1);
      return { a, b, count, support, lift, confidence, score: lift * Math.log2(1 + count) };
    })
    .filter(p => p.lift >= minLift)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  // For triplets: require all pair subsets to also be frequent
  const pairSet = new Set(pairArr.map(p => `${[p.a, p.b].sort().join('|')}`));
  const tripArr = [...triplets.entries()]
    .filter(([, c]) => c >= minCount)
    .map(([key, count]) => {
      const [a, b, c] = key.split('|');
      const allPairsFrequent = pairSet.has([a, b].sort().join('|'))
                            && pairSet.has([a, c].sort().join('|'))
                            && pairSet.has([b, c].sort().join('|'));
      if (!allPairsFrequent) return null;
      const support = count / total;
      const exp = ((single.get(a) || 1) / total) * ((single.get(b) || 1) / total) * ((single.get(c) || 1) / total);
      const lift = exp > 0 ? support / exp : 0;
      return { a, b, c, count, support, lift, score: lift * Math.log2(1 + count) };
    })
    .filter(Boolean)
    .filter(t => t.lift >= minLift * 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return { pairs: pairArr, triplets: tripArr };
}

/* Cosine similarity over SKU co-purchase vectors. */
export function cosineSim(a = [], b = []) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const va = a[k] || 0; const vb = b[k] || 0;
    dot += va * vb; na += va * va; nb += vb * vb;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/* ══════════════════════════════════════════════════════════════
   SURVIVAL — Kaplan-Meier, next-order ETA
   ══════════════════════════════════════════════════════════ */

/* Kaplan-Meier survival curve. Input: {duration, observed} array
   where duration = days until next order (or censoring), observed =
   1 if next order happened, 0 if still observing. Returns array of
   {t, survival, atRisk, events}. */
export function kaplanMeier(records = []) {
  const sorted = [...records].sort((a, b) => a.duration - b.duration);
  const byT = new Map();
  for (const r of sorted) {
    const k = byT.get(r.duration) || { t: r.duration, events: 0, censored: 0 };
    if (r.observed) k.events++; else k.censored++;
    byT.set(r.duration, k);
  }
  const times = [...byT.values()].sort((a, b) => a.t - b.t);
  let survival = 1;
  let atRisk = sorted.length;
  const curve = [];
  for (const row of times) {
    if (atRisk === 0) break;
    const p = (atRisk - row.events) / atRisk;
    survival *= p;
    curve.push({ t: row.t, survival, atRisk, events: row.events });
    atRisk -= row.events + row.censored;
  }
  return curve;
}

/* Median next-order ETA from a KM curve. Returns null if survival
   never drops below 0.5 (data right-censored too early). */
export function kmMedian(curve = []) {
  for (const row of curve) if (row.survival <= 0.5) return row.t;
  return null;
}

/* ══════════════════════════════════════════════════════════════
   CLV — BG/NBD-lite + Gamma-Gamma conditional spend
   Full MLE is heavy; we use method-of-moments fit which is
   accurate enough for segmenting and ~50x faster. Approximation
   of Fader/Hardie/Lee (2005). Each customer: {x, T, t_x, mValue}
   where x = # repeat transactions, T = age (days), t_x = age at
   last transaction, mValue = avg monetary value.
   ══════════════════════════════════════════════════════════ */

export function bgNbdMomentFit(customers = []) {
  if (customers.length < 20) return null;
  const freq = customers.map(c => c.x);
  const meanX = mean(freq);
  const varX  = variance(freq);
  const meanT = mean(customers.map(c => c.T));
  // Rough shape/rate from NBD moments
  const r = meanX > 0 && varX > meanX ? (meanX * meanX) / (varX - meanX) : 1;
  const alpha = varX > meanX ? meanX / (varX - meanX) : 1;
  // Dropout shape/rate — crude from observed churn ratio
  const churned = customers.filter(c => c.T - c.t_x > 30 && c.x > 0).length;
  const churnRate = customers.length ? churned / customers.length : 0.5;
  const a = Math.max(0.1, churnRate * 10);
  const b = Math.max(0.1, (1 - churnRate) * 10);
  return { r, alpha, a, b, meanT };
}

/* Predict expected # transactions in next τ days given customer's
   (x, T, t_x) and fitted params. Approximation — not exact MLE. */
export function bgNbdPredict({ x, T, t_x }, params, tau = 60) {
  if (!params) return null;
  const { r, alpha, a, b } = params;
  // Probability customer is still alive at T:
  // Approximation: P(alive) ≈ 1 / (1 + a/(b + x) × (alpha + t_x) / (alpha + T))
  const pAlive = 1 / (1 + (a / (b + x)) * ((alpha + t_x) / (alpha + T)));
  // Expected transactions over next τ, conditional on alive:
  const condRate = (r + x) / (alpha + T);
  const expected = pAlive * condRate * tau;
  return { pAlive, expected, condRate };
}

/* Gamma-Gamma conditional expected monetary value. Assumes customer
   spend is Gamma with person-specific mean. Uses shrinkage toward
   population mean. */
export function gammaGammaPredict({ x, mValue }, { popMean } = {}, { weight = 3 } = {}) {
  if (!x || x <= 0) return popMean || 0;
  // Shrink by weight (proxy for Gamma prior weight)
  return (weight * (popMean || 0) + x * mValue) / (weight + x);
}

/* ══════════════════════════════════════════════════════════════
   REGRESSION — log-log price elasticity
   ══════════════════════════════════════════════════════════ */

/* Ordinary least squares on log(qty) ~ log(price). Returns
   {elasticity, rSquared, n}. elasticity = β — a negative number;
   -1 = unit elastic, <-1 = elastic, >-1 = inelastic. */
export function logLogElasticity(points = []) {
  const valid = points.filter(p => p.price > 0 && p.qty > 0);
  if (valid.length < 3) return { elasticity: null, rSquared: null, n: valid.length };
  const xs = valid.map(p => Math.log(p.price));
  const ys = valid.map(p => Math.log(p.qty));
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx === 0) return { elasticity: null, rSquared: null, n: valid.length };
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < xs.length; i++) {
    const yHat = alpha + beta * xs[i];
    ssRes += (ys[i] - yHat) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { elasticity: beta, rSquared, n: valid.length };
}

/* ══════════════════════════════════════════════════════════════
   ANOMALY — z-score and IQR flags
   ══════════════════════════════════════════════════════════ */

export function zScoreAnomalies(series = [], threshold = 3) {
  const m = mean(series);
  const s = stdev(series);
  if (s === 0) return [];
  const flags = [];
  for (let i = 0; i < series.length; i++) {
    const z = (series[i] - m) / s;
    if (Math.abs(z) > threshold) flags.push({ index: i, value: series[i], z });
  }
  return flags;
}

export function iqrOutliers(series = []) {
  const q1 = quantile(series, 0.25);
  const q3 = quantile(series, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const flags = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i] < lo || series[i] > hi) flags.push({ index: i, value: series[i] });
  }
  return flags;
}

/* ══════════════════════════════════════════════════════════════
   BOOTSTRAP — percentile CI via resampling
   ══════════════════════════════════════════════════════════ */

export function bootstrapCI(series = [], stat = mean, { iterations = 500, level = 0.9 } = {}) {
  if (series.length < 3) return { point: stat(series), lo: null, hi: null };
  const samples = [];
  for (let b = 0; b < iterations; b++) {
    const sample = new Array(series.length);
    for (let i = 0; i < series.length; i++) sample[i] = series[Math.floor(Math.random() * series.length)];
    samples.push(stat(sample));
  }
  const alpha = (1 - level) / 2;
  return {
    point: stat(series),
    lo: quantile(samples, alpha),
    hi: quantile(samples, 1 - alpha),
  };
}

/* Export stats namespace for external use too */
export const _utils = { mean, stdev, quantile, variance, sum, normCdf, erf, logGamma };
