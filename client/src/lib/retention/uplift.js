/**
 * Historical uplift lookup — shrinks raw `sent_cr - holdout_cr` toward the
 * brand-wide mean using an empirical-Bayes prior. Raw lift can be wildly
 * noisy at small sample sizes (one converting holdout flips the sign),
 * so we blend toward the prior with weight inversely proportional to n.
 *
 * Output per (brand × opportunity × value_tier):
 *   { sent_cr, holdout_cr, raw_lift, shrunk_lift, n_sent, n_holdout,
 *     rev_per_sent, rev_per_holdout, incr_rev_per_sent,
 *     kill: true|false }
 *
 * `kill = true` when shrunk_lift < 0 at 95% CI — i.e. the cell has
 * demonstrably NEGATIVE incremental effect. The planner reads this to
 * auto-pause that (opp × tier) cohort. `kill` requires n_holdout ≥
 * `minHoldoutForKill` (default 100) so we don't auto-pause on a single
 * unlucky week.
 *
 * Prior shrinkage: shrunk_lift = (n · raw + k · prior) / (n + k), with
 * k = `priorStrength` (default 50). A cell with 50 obs weighs the prior
 * equally with the data; with 500 obs the data dominates 10×.
 */

const OPPS = ['REPLENISH', 'COMPLEMENT', 'WINBACK', 'NEW_LAUNCH', 'UPSELL', 'VIP_PROTECT'];

function tierOf(send) {
  return String(send?.value_tier || send?.vt || 'unknown').toUpperCase();
}

function normOpp(s) {
  const o = String(s?.opportunity || 'UNKNOWN').toUpperCase();
  return OPPS.includes(o) ? o : 'UNKNOWN';
}

/** Wilson lower bound on (successes / n) at z=1.96 (~95%). */
function wilsonLower(succ, n) {
  if (!n) return 0;
  const p = succ / n;
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (c - r) / d;
}
/** Wilson upper bound on (successes / n) at z=1.96. */
function wilsonUpper(succ, n) {
  if (!n) return 0;
  const p = succ / n;
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (c + r) / d;
}

export function buildUpliftTable(attributedSends, {
  priorStrength = 50,
  minHoldoutForKill = 100,
} = {}) {
  // Step 1: per-brand priors (average across opps / tiers)
  const brandAgg = {};
  for (const s of attributedSends || []) {
    const b = s.brand_id || 'default';
    if (!brandAgg[b]) brandAgg[b] = { sent: 0, sent_conv: 0, holdout: 0, holdout_conv: 0 };
    const a = brandAgg[b];
    if (s.was_holdout) { a.holdout++; if (s.converted) a.holdout_conv++; }
    else               { a.sent++;    if (s.converted) a.sent_conv++; }
  }
  const brandPrior = {};
  for (const [b, a] of Object.entries(brandAgg)) {
    const sent_cr    = a.sent    ? a.sent_conv    / a.sent    : 0;
    const holdout_cr = a.holdout ? a.holdout_conv / a.holdout : 0;
    brandPrior[b] = sent_cr - holdout_cr;
  }

  // Step 2: bucket by (brand, opp, tier)
  const buckets = {};
  for (const s of attributedSends || []) {
    const b = s.brand_id || 'default';
    const opp = normOpp(s);
    const t = tierOf(s);
    const key = `${b}|${opp}|${t}`;
    if (!buckets[key]) buckets[key] = {
      brand_id: b, opportunity: opp, value_tier: t,
      n_sent: 0, n_holdout: 0,
      sent_conv: 0, holdout_conv: 0,
      sent_rev: 0, holdout_rev: 0,
    };
    const x = buckets[key];
    if (s.was_holdout) {
      x.n_holdout++;
      if (s.converted) { x.holdout_conv++; x.holdout_rev += s.attributed_rev || 0; }
    } else {
      x.n_sent++;
      if (s.converted) { x.sent_conv++; x.sent_rev += s.attributed_rev || 0; }
    }
  }

  // Step 3: rates, shrinkage, kill decision
  const rows = Object.values(buckets).map(x => {
    const sent_cr    = x.n_sent    ? x.sent_conv    / x.n_sent    : 0;
    const holdout_cr = x.n_holdout ? x.holdout_conv / x.n_holdout : 0;
    const raw_lift   = sent_cr - holdout_cr;
    const prior      = brandPrior[x.brand_id] ?? 0;
    const n_eff      = x.n_sent + x.n_holdout;
    const shrunk     = n_eff ? (n_eff * raw_lift + priorStrength * prior) / (n_eff + priorStrength) : prior;

    // 95% CI on raw lift via Wilson on each arm (rough but directionally right)
    const sent_lo    = wilsonLower(x.sent_conv,    x.n_sent);
    const sent_hi    = wilsonUpper(x.sent_conv,    x.n_sent);
    const hold_lo    = wilsonLower(x.holdout_conv, x.n_holdout);
    const hold_hi    = wilsonUpper(x.holdout_conv, x.n_holdout);
    const lift_lo    = sent_lo - hold_hi;
    const lift_hi    = sent_hi - hold_lo;

    const rev_per_sent    = x.n_sent    ? x.sent_rev    / x.n_sent    : 0;
    const rev_per_holdout = x.n_holdout ? x.holdout_rev / x.n_holdout : 0;

    const kill = x.n_holdout >= minHoldoutForKill && lift_hi < 0;

    return {
      ...x,
      sent_cr:    +sent_cr.toFixed(4),
      holdout_cr: +holdout_cr.toFixed(4),
      raw_lift:   +raw_lift.toFixed(4),
      shrunk_lift: +shrunk.toFixed(4),
      lift_ci_lo: +lift_lo.toFixed(4),
      lift_ci_hi: +lift_hi.toFixed(4),
      rev_per_sent:    +rev_per_sent.toFixed(2),
      rev_per_holdout: +rev_per_holdout.toFixed(2),
      incr_rev_per_sent: +(rev_per_sent - rev_per_holdout).toFixed(2),
      kill,
    };
  });

  return { rows, brandPrior };
}

/**
 * Build a nested lookup `{ brand → opp → tier → row }` for O(1) planner reads.
 * Callers typically use `lookupLift(table, brand, opp, tier)` — falls back
 * to opp-level aggregate, then brand-level, then a neutral zero-lift row.
 */
export function indexUplift(rows) {
  const byBrand = {};
  for (const r of rows) {
    ((byBrand[r.brand_id] ||= {})[r.opportunity] ||= {})[r.value_tier] = r;
  }
  return byBrand;
}

export function lookupLift(index, brand, opp, tier) {
  const b = index?.[brand] || index?.default || {};
  const o = b[String(opp || '').toUpperCase()] || {};
  return o[String(tier || '').toUpperCase()]
      || Object.values(o)[0]
      || { shrunk_lift: 0, kill: false, n_sent: 0, n_holdout: 0 };
}
