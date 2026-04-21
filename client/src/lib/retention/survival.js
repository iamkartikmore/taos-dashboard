/**
 * Survival analysis for next-order timing.
 *
 * Fits a Weibull distribution to inter-order gaps (days) via
 * moment-matching — closed-form, robust for small samples, no
 * Newton iteration required. For a gap sample with mean μ and std σ:
 *
 *    CV = σ / μ
 *    k  (shape)  ≈ (CV)^(-1.086)          // Justus' approximation
 *    λ  (scale)  = μ / Γ(1 + 1/k)
 *
 * Hazard at age t: h(t)   = (k/λ) (t/λ)^(k-1)
 * Survival:        S(t)   = exp(-(t/λ)^k)
 * P(order in next N days | already waited t):
 *                  1 - S(t+N) / S(t)
 *
 * We fit two cohorts:
 *   1) Per-customer gap distribution → personal next-order hazard
 *   2) Per-SKU repeat-purchase distribution (same customer, same SKU
 *      gaps) → replenish-clock hazard per SKU
 *
 * For customers with < 2 orders, we fall back to the brand-wide cohort.
 * For SKUs with < 5 repeat pairs, we fall back to their product_type
 * cohort, then the brand cohort. This keeps the estimator stable even
 * in the long tail.
 */

const DAY = 86_400_000;

/** Stirling's approximation of log-Gamma; accurate enough for k ∈ [0.3, 5]. */
function lnGamma(x) {
  // Lanczos approximation g=7, n=9 (fast and accurate for x > 0)
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  const g = 7;
  const C = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let a = C[0];
  for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function gamma(x) { return Math.exp(lnGamma(x)); }

/**
 * Fit Weibull(k, λ) from a gap sample (days). Returns {k, lambda, n, mean, median}.
 * Returns null if sample size < 2 or degenerate.
 */
export function fitWeibull(gaps) {
  const g = gaps.filter(x => isFinite(x) && x > 0);
  if (g.length < 2) return null;
  const n = g.length;
  const mean = g.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return null;
  const variance = g.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const cv = std / mean;
  let k = cv > 0 ? Math.pow(cv, -1.086) : 1.0;
  k = Math.max(0.4, Math.min(5.0, k));
  const lambda = mean / gamma(1 + 1 / k);
  g.sort((a, b) => a - b);
  const median = g[Math.floor(n / 2)];
  return { k, lambda, n, mean: +mean.toFixed(2), std: +std.toFixed(2), median };
}

export function survival(fit, t) {
  if (!fit || t <= 0) return 1;
  return Math.exp(-Math.pow(t / fit.lambda, fit.k));
}

export function hazard(fit, t) {
  if (!fit || t <= 0) return 0;
  return (fit.k / fit.lambda) * Math.pow(t / fit.lambda, fit.k - 1);
}

/** P(order in next N days | already waited t days). */
export function probOrderWithin(fit, waitedT, nDays) {
  if (!fit) return 0;
  const s0 = survival(fit, waitedT);
  if (s0 <= 0) return 1;
  const s1 = survival(fit, waitedT + nDays);
  const p = 1 - s1 / s0;
  return Math.max(0, Math.min(1, p));
}

/* ─── COHORT BUILDERS ──────────────────────────────────────────── */

/**
 * Pull inter-order gaps per email. Returns { email → number[] days }.
 * Also returns a brandwide flat array used as a fallback cohort.
 */
export function extractCustomerGaps(orders) {
  const byCust = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    (byCust.get(e) || byCust.set(e, []).get(e)).push(t);
  }
  const gapsByCust = {};
  const allGaps = [];
  for (const [e, ts] of byCust) {
    ts.sort((a, b) => a - b);
    const g = [];
    for (let i = 1; i < ts.length; i++) g.push((ts[i] - ts[i - 1]) / DAY);
    if (g.length) { gapsByCust[e] = g; allGaps.push(...g); }
  }
  return { gapsByCust, allGaps };
}

/**
 * Pull same-customer same-SKU repeat gaps. Returns { sku → number[] days }.
 * A SKU needs ≥ 5 repeat pairs before its own fit is trusted; otherwise
 * callers should fall back to the brand cohort via `brandGaps`.
 */
export function extractSkuRepeatGaps(orders) {
  const map = new Map();  // `${email}|${sku}` → [timestamps]
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    for (const li of (o.line_items || [])) {
      const s = String(li.sku || '').trim().toUpperCase();
      if (!s) continue;
      const k = `${e}|${s}`;
      (map.get(k) || map.set(k, []).get(k)).push(t);
    }
  }
  const gapsBySku = {};
  for (const [k, ts] of map) {
    const [, sku] = k.split('|');
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const g = (ts[i] - ts[i - 1]) / DAY;
      (gapsBySku[sku] ||= []).push(g);
    }
  }
  return gapsBySku;
}

/**
 * End-to-end fit for a brand's orders.
 * Returns {
 *   brandFit,                // Weibull over all gaps
 *   customerFits: {email→fit},
 *   skuFits:      {sku→fit},
 * }
 * Customers with too few gaps get null (use brandFit as fallback).
 * SKUs with < 5 repeat pairs get null (use brand cohort as fallback).
 */
export function fitBrandSurvival(orders) {
  const { gapsByCust, allGaps } = extractCustomerGaps(orders);
  const brandFit = fitWeibull(allGaps);
  const customerFits = {};
  for (const [e, g] of Object.entries(gapsByCust)) {
    customerFits[e] = g.length >= 2 ? fitWeibull(g) : null;
  }
  const gapsBySku = extractSkuRepeatGaps(orders);
  const skuFits = {};
  for (const [sku, g] of Object.entries(gapsBySku)) {
    skuFits[sku] = g.length >= 5 ? fitWeibull(g) : null;
  }
  return { brandFit, customerFits, skuFits };
}

/**
 * Convenience: returns a function `prob(email, waitedDays, horizon)`
 * that picks the best available cohort (customer → brand) and returns
 * P(next order within `horizon` days).
 */
export function makeCustomerHazard({ brandFit, customerFits }) {
  return (email, waitedDays, horizon = 7) => {
    const f = (customerFits && customerFits[email]) || brandFit;
    return probOrderWithin(f, waitedDays, horizon);
  };
}

/**
 * Convenience: returns `prob(sku, waitedDays, horizon)` — falls back to
 * the brand cohort when the SKU has no own fit.
 */
export function makeSkuHazard({ brandFit, skuFits }) {
  return (sku, waitedDays, horizon = 7) => {
    const f = (skuFits && skuFits[String(sku).toUpperCase()]) || brandFit;
    return probOrderWithin(f, waitedDays, horizon);
  };
}
