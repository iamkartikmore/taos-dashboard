/**
 * Thompson-sampling Beta-Bernoulli bandit per (brand × opportunity × tier).
 *
 * Each arm tracks α (successes + 1) and β (failures + 1). On each planner
 * run, we draw P̂ ~ Beta(α, β) per arm and use it as a multiplicative
 * weight on the arm's contribution to the daily send pool. This keeps
 * exploration baked in: a brand-new opportunity starts at Beta(1,1) ≡
 * uniform, so it gets a healthy share of sends until evidence accrues.
 *
 * Updates are incremental — call `updateBandit(state, attributedSends)`
 * with the new batch after each send; it folds converted/non-converted
 * counts into α/β. Old decisions' contribution to posteriors decays by a
 * per-day factor so stale evidence doesn't dominate forever (default 0.01
 * per day = half-life ~70d).
 *
 * Persistence: state is a plain object, safe to JSON.stringify into
 * IndexedDB under a single key (`retention:bandit:v1`).
 */

const DAY = 86_400_000;
const OPPS = ['REPLENISH', 'COMPLEMENT', 'WINBACK', 'NEW_LAUNCH', 'UPSELL', 'VIP_PROTECT'];

function armKey(brand, opp, tier) {
  return `${brand}|${String(opp || 'UNKNOWN').toUpperCase()}|${String(tier || 'unknown').toUpperCase()}`;
}

/* ─── BETA SAMPLING ───────────────────────────────────────────── */

function gammaSample(k) {
  // Marsaglia–Tsang for k ≥ 1. For 0 < k < 1, boost via k+1 then scale.
  if (k < 1) {
    return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Standard normal via Box-Muller
      const u1 = Math.random(), u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function sampleBeta(a, b) {
  const x = gammaSample(a);
  const y = gammaSample(b);
  return x / (x + y);
}

/* ─── STATE MANAGEMENT ────────────────────────────────────────── */

export function initBanditState() {
  return { version: 1, updated_at: Date.now(), arms: {} };
}

function getArm(state, key) {
  if (!state.arms[key]) state.arms[key] = { alpha: 1, beta: 1, n: 0, last_update: Date.now() };
  return state.arms[key];
}

/**
 * Decay an arm's posterior mass toward the prior (1,1) based on days since
 * last update. decayPerDay=0.01 ⇒ ~63% of evidence retained at 30d.
 */
function decayArm(arm, decayPerDay = 0.01) {
  const days = Math.max(0, (Date.now() - (arm.last_update || Date.now())) / DAY);
  const f = Math.exp(-decayPerDay * days);
  arm.alpha = 1 + (arm.alpha - 1) * f;
  arm.beta  = 1 + (arm.beta  - 1) * f;
  arm.last_update = Date.now();
}

/**
 * Fold a batch of attributed sends into arm posteriors. Pass in sends
 * (even non-converted ones) — each contributes 1 to α or β.
 */
export function updateBandit(state, attributedSends, { decayPerDay = 0.01 } = {}) {
  const s = state || initBanditState();
  for (const send of attributedSends || []) {
    if (send.was_holdout) continue;  // bandit only learns from sent arm
    const key = armKey(send.brand_id, send.opportunity, send.value_tier);
    const arm = getArm(s, key);
    decayArm(arm, decayPerDay);
    if (send.converted) arm.alpha += 1; else arm.beta += 1;
    arm.n += 1;
  }
  s.updated_at = Date.now();
  return s;
}

/**
 * Draw a sample from each arm; return weights normalised to the max so the
 * planner can multiply them into scores directly (top arm = 1.0, less
 * promising arms scale down).
 */
export function sampleWeights(state, { arms: requestedArms = null } = {}) {
  const s = state || initBanditState();
  const keys = requestedArms?.length ? requestedArms : Object.keys(s.arms);
  const draws = {};
  let max = 0;
  for (const k of keys) {
    const arm = s.arms[k] || { alpha: 1, beta: 1 };
    const d = sampleBeta(arm.alpha, arm.beta);
    draws[k] = d;
    if (d > max) max = d;
  }
  if (max <= 0) return draws;
  for (const k of Object.keys(draws)) draws[k] = +(draws[k] / max).toFixed(4);
  return draws;
}

/**
 * Convenience: per-(brand × opp × tier) draw, returning a function the
 * planner can call during scoring: `w = weight(brand, opp, tier)`.
 */
export function makeBanditWeight(state) {
  const draws = sampleWeights(state);
  return (brand, opp, tier) => {
    const k = armKey(brand, opp, tier);
    if (k in draws) return draws[k];
    // Unseen arm: draw from prior Beta(1,1) = uniform
    return sampleBeta(1, 1);
  };
}

/**
 * Arm summary for the diagnostics page: posterior mean, 95% credible
 * interval (Beta quantiles via approximation), n.
 */
export function summarizeBandit(state) {
  const rows = [];
  for (const [k, arm] of Object.entries(state?.arms || {})) {
    const [brand, opp, tier] = k.split('|');
    const mean = arm.alpha / (arm.alpha + arm.beta);
    // Normal approx to Beta CI — good for α+β > 10
    const variance = (arm.alpha * arm.beta) / (Math.pow(arm.alpha + arm.beta, 2) * (arm.alpha + arm.beta + 1));
    const sd = Math.sqrt(variance);
    rows.push({
      brand_id: brand,
      opportunity: opp,
      value_tier: tier,
      alpha: +arm.alpha.toFixed(2),
      beta:  +arm.beta.toFixed(2),
      n: arm.n,
      mean: +mean.toFixed(4),
      ci_lo: +Math.max(0, mean - 1.96 * sd).toFixed(4),
      ci_hi: +Math.min(1, mean + 1.96 * sd).toFixed(4),
    });
  }
  rows.sort((a, b) => b.mean - a.mean);
  return rows;
}

export { OPPS, armKey };
