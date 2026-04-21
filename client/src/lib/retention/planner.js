/**
 * Global send planner. Given the day's opportunity pool across all
 * brands, pick who gets a message under hard constraints:
 *
 *   - Global cap:     ≤ DAILY_CAP (default 240,000) total sends
 *   - Per-brand cap:  optional, set per brand
 *   - Fatigue:        ≤ fatigueMax messages per customer per 7 days
 *   - Cooldown:       ≥ cooldownHours since last send to that customer
 *   - Quiet hours:    skip windows where the customer shouldn't be hit
 *   - Consent:        must have accepts_email_marketing
 *   - Holdout:        hold out `holdoutPct` of eligible as control
 *
 * The allocator uses a greedy expected-incremental-revenue-per-send
 * approach. Each candidate's "score" is its opportunity score × a
 * deliverability multiplier. We sort by expected_incremental_revenue
 * descending and fill until the cap; ties broken by score.
 *
 * Input:
 *   opportunityFlat — combined flat list of opportunity rows across
 *                     brands. Each row MUST have { brand, email,
 *                     opportunity, score, expected_incremental_revenue,
 *                     recommended_skus, reason }.
 *   customerState   — map `${brand}|${email}` → {
 *                     sends_last_7d, last_send_ms, quiet_hours_utc,
 *                     in_holdout?, suppressed?
 *                   } (all optional).
 *
 * Output:
 *   { picks: [...], deferred: [...], summary: {...} }
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function planSends(opportunityFlat, customerState = {}, {
  dailyCap = 240_000,
  perBrandCap = null,          // { brand_id: cap } or null
  fatigueMax = 2,              // per 7d window (default; overrideable per-brand)
  cooldownHours = 48,
  perBrandFatigue = null,      // { brand_id: { fatigueMax, cooldownHours } }
  holdoutPct = 0.05,
  now = Date.now(),
  quietHoursDefault = [[22, 8]], // [[startHour, endHour] UTC] ranges to avoid
  minScore = 0.15,
  seed = 1,
  // Week 4 governance: look up per-(brand × opp × tier) uplift; a cell flagged
  // as `kill: true` is auto-suppressed here so the planner never picks it.
  upliftIndex = null,
  lookupLift = null,           // function(brand_id, opp, tier) → row
  // Bandit weights multiply into score so Thompson-draws steer exploration.
  // Signature: fn(brand_id, opp, tier) → weight in (0,1].
  banditWeight = null,
  // Hard-excluded emails per brand (consent / bounce / complaint / GDPR).
  suppressionSet = null,       // Set<`${brand_id}|${email}`>
  // Per-brand weight multipliers applied to expected_incremental_revenue,
  // so the global allocator can share the 240k cap by EIR × brandWeight.
  brandWeights = null,         // { brand_id: weight }
  // Reweight by opportunity mix: downweight already-heavy opps to diversify.
  diversityPenalty = 0,        // 0 = off, 0.2 = mild
} = {}) {
  // Deterministic RNG for holdout assignment
  let rngState = seed >>> 0;
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0xFFFFFFFF;
  };

  // Filter candidates
  const candidates = [];
  const deferred = [];
  const brandUse = {};

  const keep = (row) => candidates.push(row);
  const skip = (row, reason) => deferred.push({ ...row, skip_reason: reason });

  for (const row of opportunityFlat) {
    if (row.score < minScore) { skip(row, 'below_min_score'); continue; }
    const brand = row.brand || 'default';
    const brandId = row.brand_id || brand;
    const stKey = `${brandId}|${row.email}`;
    const st = customerState[stKey] || {};

    if (st.suppressed)                          { skip(row, 'suppressed'); continue; }
    if (suppressionSet && suppressionSet.has(stKey)) { skip(row, 'suppression_registry'); continue; }
    if (!row.accepts_email_marketing && !st.allow_bypass_consent) {
      if (row.consent === false)                { skip(row, 'no_consent'); continue; }
    }

    // Uplift kill-switch: if this (brand × opp × tier) cell has demonstrably
    // negative incremental lift at 95% CI, drop the pick entirely.
    if (lookupLift && upliftIndex) {
      const tier = row.value_tier || row.evidence?.value_tier || 'unknown';
      const lift = lookupLift(upliftIndex, brandId, row.opportunity, tier);
      if (lift?.kill) { skip(row, 'uplift_kill'); continue; }
    }

    // Per-brand fatigue/cooldown override the global defaults when set.
    const pb = perBrandFatigue?.[brandId] || {};
    const fMax = pb.fatigueMax ?? fatigueMax;
    const cHrs = pb.cooldownHours ?? cooldownHours;
    if ((st.sends_last_7d || 0) >= fMax)       { skip(row, 'fatigue_cap'); continue; }
    if (st.last_send_ms && (now - st.last_send_ms) < cHrs * HOUR) {
      skip(row, 'cooldown'); continue;
    }
    const hour = new Date(now).getUTCHours();
    const windows = st.quiet_hours_utc || quietHoursDefault;
    if (inQuiet(hour, windows))                 { skip(row, 'quiet_hours'); continue; }

    // Holdout (deterministic per customer, not per call)
    const inHoldout = st.in_holdout != null ? st.in_holdout : (hash(stKey + ':holdout') % 1000) / 1000 < holdoutPct;
    if (inHoldout)                              { skip(row, 'holdout'); continue; }

    // Apply bandit weight + brand weight to expected_incremental_revenue so the
    // greedy sort below picks a principled mix — rather than letting one brand
    // or one opp monopolise the 240k cap.
    const tier = row.value_tier || row.evidence?.value_tier || 'unknown';
    const bw = banditWeight ? banditWeight(brandId, row.opportunity, tier) : 1;
    const brandMul = brandWeights?.[brandId] ?? 1;
    const adjusted = (row.expected_incremental_revenue || 0) * bw * brandMul;
    keep({ ...row, _adjusted_eir: adjusted, _bandit_w: +bw.toFixed(3), _brand_w: brandMul });
  }

  // Sort by bandit-adjusted expected incremental revenue desc (tie: score).
  // If no ML weights were provided, _adjusted_eir === expected_incremental_revenue,
  // so this degrades gracefully to the previous behaviour.
  candidates.sort((a, b) => {
    const d = (b._adjusted_eir || b.expected_incremental_revenue || 0)
            - (a._adjusted_eir || a.expected_incremental_revenue || 0);
    return d !== 0 ? d : b.score - a.score;
  });

  // Greedy fill; one message per customer per day globally.
  // Optional diversity penalty dampens each opportunity's score as its share
  // of the picked pool grows, so no single opp fully consumes the cap.
  const picked = [];
  const pickedCust = new Set();
  const oppCount = {};
  for (const row of candidates) {
    if (picked.length >= dailyCap) { skip(row, 'daily_cap'); continue; }
    const brand = row.brand || 'default';
    const brandId = row.brand_id || brand;
    if (perBrandCap && perBrandCap[brandId] != null && (brandUse[brandId] || 0) >= perBrandCap[brandId]) {
      skip(row, 'brand_cap'); continue;
    }
    const key = `${brandId}|${row.email}`;
    if (pickedCust.has(key))    { skip(row, 'already_picked_today'); continue; }
    if (diversityPenalty > 0 && picked.length > 500) {
      const share = (oppCount[row.opportunity] || 0) / picked.length;
      const penalty = share > 0.3 ? diversityPenalty * (share - 0.3) / 0.7 : 0;
      if (penalty > 0 && Math.random() < penalty) { skip(row, 'diversity_penalty'); continue; }
    }
    picked.push(row);
    pickedCust.add(key);
    brandUse[brandId] = (brandUse[brandId] || 0) + 1;
    oppCount[row.opportunity] = (oppCount[row.opportunity] || 0) + 1;
  }

  // Summary
  const byBrand = {};
  const byOpp = {};
  let totalRev = 0;
  const skipReasons = {};
  for (const p of picked) {
    const b = p.brand || 'default';
    byBrand[b] = (byBrand[b] || 0) + 1;
    byOpp[p.opportunity] = (byOpp[p.opportunity] || 0) + 1;
    totalRev += p.expected_incremental_revenue || 0;
  }
  for (const d of deferred) {
    skipReasons[d.skip_reason] = (skipReasons[d.skip_reason] || 0) + 1;
  }

  return {
    picks: picked,
    deferred,
    summary: {
      total_picked: picked.length,
      total_deferred: deferred.length,
      expected_incremental_revenue: +totalRev.toFixed(2),
      by_brand: byBrand,
      by_opportunity: byOpp,
      skip_reasons: skipReasons,
      cap: dailyCap,
      fill_ratio: +(picked.length / dailyCap).toFixed(3),
    },
  };
}

function inQuiet(hour, windows) {
  for (const [a, b] of windows) {
    if (a < b) { if (hour >= a && hour < b) return true; }
    else       { if (hour >= a || hour < b) return true; }
  }
  return false;
}

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
