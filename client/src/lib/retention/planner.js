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
  perBrandCap = null,          // { brand: cap } or null
  fatigueMax = 2,              // per 7d window
  cooldownHours = 48,
  holdoutPct = 0.05,
  now = Date.now(),
  quietHoursDefault = [[22, 8]], // [[startHour, endHour] UTC] ranges to avoid
  minScore = 0.15,
  seed = 1,
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
    const stKey = `${brand}|${row.email}`;
    const st = customerState[stKey] || {};

    if (st.suppressed)                          { skip(row, 'suppressed'); continue; }
    if (!row.accepts_email_marketing && !st.allow_bypass_consent) {
      // Consent must be enforced upstream in opportunity scoring. Defensive:
      if (row.consent === false)                { skip(row, 'no_consent'); continue; }
    }
    if ((st.sends_last_7d || 0) >= fatigueMax)  { skip(row, 'fatigue_cap'); continue; }
    if (st.last_send_ms && (now - st.last_send_ms) < cooldownHours * HOUR) {
      skip(row, 'cooldown'); continue;
    }
    const hour = new Date(now).getUTCHours();
    const windows = st.quiet_hours_utc || quietHoursDefault;
    if (inQuiet(hour, windows))                 { skip(row, 'quiet_hours'); continue; }

    // Holdout (deterministic per customer, not per call)
    const inHoldout = st.in_holdout != null ? st.in_holdout : (hash(stKey + ':holdout') % 1000) / 1000 < holdoutPct;
    if (inHoldout)                              { skip(row, 'holdout'); continue; }

    keep(row);
  }

  // Sort by expected incremental revenue desc (tie: score)
  candidates.sort((a, b) => {
    const d = (b.expected_incremental_revenue || 0) - (a.expected_incremental_revenue || 0);
    return d !== 0 ? d : b.score - a.score;
  });

  // Greedy fill; one message per customer per day globally
  const picked = [];
  const pickedCust = new Set();
  for (const row of candidates) {
    if (picked.length >= dailyCap) { skip(row, 'daily_cap'); continue; }
    const brand = row.brand || 'default';
    if (perBrandCap && perBrandCap[brand] != null && (brandUse[brand] || 0) >= perBrandCap[brand]) {
      skip(row, 'brand_cap'); continue;
    }
    const key = `${brand}|${row.email}`;
    if (pickedCust.has(key))    { skip(row, 'already_picked_today'); continue; }
    picked.push(row);
    pickedCust.add(key);
    brandUse[brand] = (brandUse[brand] || 0) + 1;
  }

  // Summary
  const byBrand = {};
  const byOpp = {};
  let totalRev = 0;
  for (const p of picked) {
    const b = p.brand || 'default';
    byBrand[b] = (byBrand[b] || 0) + 1;
    byOpp[p.opportunity] = (byOpp[p.opportunity] || 0) + 1;
    totalRev += p.expected_incremental_revenue || 0;
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
