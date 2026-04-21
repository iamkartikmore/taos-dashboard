/**
 * Price-elasticity (discount → P(buy)) via logistic regression.
 *
 * Fits  P(y=1 | x) = 1 / (1 + e^{-(β₀ + β₁·x)})
 * on samples of the form { discount_pct, converted }, using Newton-Raphson
 * (IRLS). Two parameters, so the Hessian is a 2×2 — closed-form invert.
 *
 * Usage:
 *   const fit = fitLogistic(samples);
 *   fit.predict(15)      // P(buy) at 15% discount
 *   fit.optimalDiscount(grossMargin=0.45)  // discount that maximises
 *                                            expected margin × P(buy)
 *
 * The "optimal discount" helper lets the planner pick an offer intensity
 * per opportunity rather than hard-coding a single % across all sends.
 *
 * Guardrails: if the sample is too small, too unbalanced, or the fit
 * diverges, we return a constant predictor that falls back to the empirical
 * conversion rate.
 */

function sigmoid(z) {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

/**
 * IRLS logistic for y ∈ {0,1} on a single feature x. Returns { b0, b1 }.
 * Stops when ||Δβ|| < 1e-6 or after maxIter iterations.
 */
function irls(xs, ys, { maxIter = 25, ridge = 1e-4 } = {}) {
  let b0 = 0, b1 = 0;
  const n = xs.length;
  for (let it = 0; it < maxIter; it++) {
    let H00 = ridge, H01 = 0, H11 = ridge;  // Hessian + ridge
    let g0 = 0, g1 = 0;                     // Gradient
    for (let i = 0; i < n; i++) {
      const p = sigmoid(b0 + b1 * xs[i]);
      const w = p * (1 - p);
      const r = ys[i] - p;
      g0 += r;
      g1 += r * xs[i];
      H00 += w;
      H01 += w * xs[i];
      H11 += w * xs[i] * xs[i];
    }
    const det = H00 * H11 - H01 * H01;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;
    const db0 = ( H11 * g0 - H01 * g1) / det;
    const db1 = (-H01 * g0 + H00 * g1) / det;
    b0 += db0;
    b1 += db1;
    if (Math.abs(db0) + Math.abs(db1) < 1e-6) break;
  }
  return { b0, b1 };
}

/**
 * Fit logistic on { discount_pct, converted } samples. `discount_pct`
 * should be the nominal percent (e.g. 10 for 10%), not a fraction.
 * Returns an object with `predict`, `optimalDiscount`, fit stats.
 */
export function fitLogistic(samples) {
  const xs = [], ys = [];
  for (const s of samples || []) {
    const x = parseFloat(s.discount_pct);
    if (!isFinite(x) || x < 0 || x > 90) continue;
    xs.push(x);
    ys.push(s.converted ? 1 : 0);
  }
  const n = xs.length;
  const pos = ys.reduce((a, b) => a + b, 0);
  const baseRate = n ? pos / n : 0;
  // Too small or degenerate → flat predictor
  if (n < 20 || pos === 0 || pos === n) {
    return {
      ok: false,
      n,
      pos,
      base_rate: +baseRate.toFixed(4),
      b0: 0, b1: 0,
      predict: () => baseRate,
      optimalDiscount: () => 0,
    };
  }
  const { b0, b1 } = irls(xs, ys);
  // Sanity-check: b1 should be ≥ 0 in most retail cohorts (more discount →
  // more likely to buy). If it's strongly negative, our sample is confounded
  // — fall back to the base rate so we don't produce perverse offers.
  if (!isFinite(b0) || !isFinite(b1) || b1 < -0.05) {
    return {
      ok: false,
      n,
      pos,
      base_rate: +baseRate.toFixed(4),
      b0: 0, b1: 0,
      predict: () => baseRate,
      optimalDiscount: () => 0,
    };
  }
  const predict = d => sigmoid(b0 + b1 * Math.max(0, Math.min(90, d)));
  const optimalDiscount = (grossMargin = 0.45, { maxDiscount = 40, step = 1 } = {}) => {
    // Maximise (margin - d/100) · P(buy | d). Grid search on 0..maxDiscount.
    let best = { d: 0, ev: -Infinity };
    for (let d = 0; d <= maxDiscount; d += step) {
      const m = grossMargin - d / 100;
      if (m <= 0) break;
      const ev = m * predict(d);
      if (ev > best.ev) best = { d, ev };
    }
    return best.d;
  };
  return {
    ok: true,
    n,
    pos,
    base_rate: +baseRate.toFixed(4),
    b0: +b0.toFixed(4),
    b1: +b1.toFixed(4),
    predict,
    optimalDiscount,
  };
}

/**
 * Derive training samples from an attributed send-log. If sends don't
 * carry `discount_pct` explicitly, we infer a coarse value from
 * `opportunity`: Winback/VipProtect 15, Replenish 10, others 5. Good
 * enough to kick-start; replace once sends actually log their discount.
 */
export function samplesFromSendLog(attributedSends) {
  const DEFAULTS = { WINBACK: 15, VIP_PROTECT: 15, REPLENISH: 10, COMPLEMENT: 5, NEW_LAUNCH: 5, UPSELL: 5 };
  const out = [];
  for (const s of attributedSends || []) {
    if (s.was_holdout) continue;
    const d = s.discount_pct != null
      ? parseFloat(s.discount_pct)
      : (DEFAULTS[String(s.opportunity || '').toUpperCase()] ?? 5);
    if (!isFinite(d)) continue;
    out.push({ discount_pct: d, converted: !!s.converted });
  }
  return out;
}

export function fitBrandElasticity(attributedSends) {
  const byBrand = {};
  for (const s of attributedSends || []) {
    const b = s.brand_id || 'default';
    (byBrand[b] ||= []).push(s);
  }
  const fits = {};
  for (const [b, list] of Object.entries(byBrand)) {
    fits[b] = fitLogistic(samplesFromSendLog(list));
  }
  return fits;
}
