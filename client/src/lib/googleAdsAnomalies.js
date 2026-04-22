/**
 * Google Ads anomaly detection.
 *
 * Input: campaignsDaily rows (one row per campaign per date). We aggregate
 * to per-day totals, then flag days whose metrics deviate materially from
 * their *weekday-adjusted* baseline — because CPA on a Sunday is not
 * comparable to CPA on a Wednesday, and a naive 7d-rolling mean will
 * mask the weekly cycle.
 *
 * For each metric we produce:
 *   - weekday baseline (mean + std of the same weekday over the look-back window)
 *   - z-score for each day vs its weekday baseline
 *   - a severity tag (normal | warn | alert) and a direction (good/bad)
 *
 * We also surface cross-metric patterns ("spend up, conversions flat →
 * CPA breakout", "CTR collapsed but impressions stable → creative fatigue
 * or audience drift"). Those composite flags are what actually matter to
 * an operator — a single-metric z is easy to noise-trip.
 *
 * Bad = the direction an advertiser doesn't want (CPA up, ROAS down,
 * CTR down, conv rate down). Good z-scores still flag for context but
 * don't raise severity.
 *
 * The caller supplies the daily rows; we don't fetch here — all detection
 * is pure so the same lib can run in tests, in a scheduled job, or in
 * the UI.
 */

const DAY = 86_400_000;

/* ─── DAILY ROLL-UP ────────────────────────────────────────────────── */

/**
 * Aggregate campaignsDaily into {date, metrics} rows, sorted ascending by date.
 * Optionally filter to a single campaignId.
 */
export function rollDaily(rows = [], { campaignId = null } = {}) {
  const by = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    if (campaignId && r.campaignId !== campaignId) continue;
    const e = by.get(r.date) || {
      date: r.date,
      impressions: 0, clicks: 0, cost: 0,
      conversions: 0, conversionValue: 0,
    };
    e.impressions     += r.impressions     || 0;
    e.clicks          += r.clicks          || 0;
    e.cost            += r.cost            || 0;
    e.conversions     += r.conversions     || 0;
    e.conversionValue += r.conversionValue || 0;
    by.set(r.date, e);
  }
  return Array.from(by.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      ctr:      d.impressions > 0 ? d.clicks / d.impressions : 0,
      cpc:      d.clicks      > 0 ? d.cost   / d.clicks      : 0,
      cpa:      d.conversions > 0 ? d.cost   / d.conversions : 0,
      roas:     d.cost        > 0 ? d.conversionValue / d.cost : 0,
      convRate: d.clicks      > 0 ? d.conversions / d.clicks : 0,
      aov:      d.conversions > 0 ? d.conversionValue / d.conversions : 0,
    }));
}

/* ─── WEEKDAY BASELINE ─────────────────────────────────────────────── */

function dowOf(dateStr) {
  // 'YYYY-MM-DD' → 0..6 (Sun..Sat) UTC
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function statsFor(values) {
  if (!values.length) return { mean: 0, std: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance), n: values.length };
}

/**
 * For each metric, compute weekday-bucketed mean/std over baseline days.
 * Return { [metric]: { [dow]: {mean, std, n} } }.
 */
export function weekdayBaseline(baselineRows, metrics) {
  const out = {};
  for (const m of metrics) {
    out[m] = {};
    const bucket = {};
    for (const r of baselineRows) {
      const d = dowOf(r.date);
      (bucket[d] ||= []).push(r[m] ?? 0);
    }
    for (const d of Object.keys(bucket)) out[m][d] = statsFor(bucket[d]);
  }
  return out;
}

/* ─── METRIC DIRECTION & SEVERITY ──────────────────────────────────── */

// direction = +1 means higher-is-better; -1 means lower-is-better.
export const METRIC_DIRECTION = {
  impressions:      +1,
  clicks:           +1,
  cost:              0, // neutral on its own — only meaningful vs. return
  conversions:      +1,
  conversionValue:  +1,
  ctr:              +1,
  cpc:              -1,
  cpa:              -1,
  roas:             +1,
  convRate:         +1,
  aov:              +1,
};

export const METRIC_LABEL = {
  impressions: 'Impressions', clicks: 'Clicks', cost: 'Spend',
  conversions: 'Conversions', conversionValue: 'Revenue',
  ctr: 'CTR', cpc: 'CPC', cpa: 'CPA', roas: 'ROAS',
  convRate: 'Conv. Rate', aov: 'AOV',
};

// Thresholds on |z|. Keep them loose — weekday buckets get small fast and
// a 1.5σ move on a 4-sample bucket is just noise.
const Z_WARN  = 1.5;
const Z_ALERT = 2.5;

/**
 * severity: normal | warn | alert
 * direction: 'good' | 'bad' | 'neutral'
 */
function classify(metric, z) {
  if (!isFinite(z) || Math.abs(z) < Z_WARN) return { severity: 'normal', direction: 'neutral' };
  const dir = METRIC_DIRECTION[metric] || 0;
  const isUp = z > 0;
  const isGood = (dir > 0 && isUp) || (dir < 0 && !isUp);
  const direction = dir === 0 ? 'neutral' : (isGood ? 'good' : 'bad');
  const severity  = Math.abs(z) >= Z_ALERT ? 'alert' : 'warn';
  return { severity, direction };
}

/* ─── PER-DAY ANOMALY SCORE ────────────────────────────────────────── */

const DEFAULT_METRICS = [
  'cost', 'clicks', 'impressions', 'conversions', 'conversionValue',
  'ctr', 'cpc', 'cpa', 'roas', 'convRate', 'aov',
];

/**
 * Score each row's metrics against the weekday baseline.
 *
 * @param rows          daily rows in chronological order.
 * @param baselineDays  how many trailing days to use for the baseline
 *                      (excluding the day being scored). Default 28.
 * @param metrics       which metrics to score.
 */
export function scoreDailyAnomalies(rows = [], { baselineDays = 28, metrics = DEFAULT_METRICS } = {}) {
  if (!rows.length) return [];
  // Pre-compute index to date for window slicing
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((row, i) => {
    const start = Math.max(0, i - baselineDays);
    const baseline = sorted.slice(start, i); // EXCLUDES the day being scored
    const bk = weekdayBaseline(baseline, metrics);
    const dow = dowOf(row.date);
    const scores = {};
    for (const m of metrics) {
      const s = bk[m]?.[dow];
      const v = row[m] ?? 0;
      if (!s || s.n < 2 || s.std === 0) {
        scores[m] = { value: v, expected: s?.mean ?? null, z: 0, severity: 'normal', direction: 'neutral', n: s?.n || 0 };
        continue;
      }
      const z = (v - s.mean) / s.std;
      const cls = classify(m, z);
      scores[m] = { value: v, expected: s.mean, z, n: s.n, ...cls };
    }
    return { date: row.date, dow, metrics: scores, raw: row };
  });
}

/* ─── COMPOSITE FLAGS ──────────────────────────────────────────────── */
/**
 * Single-metric z-scores generate noise. These composite rules are what an
 * analyst would actually say in a debrief. Each rule fires only when the
 * evidence is cross-metric and the magnitude is material.
 */
export function compositeFlags(scoredDay) {
  if (!scoredDay) return [];
  const m = scoredDay.metrics;
  const flags = [];

  // CPA breakout: spend up OR flat, conversions down, CPA up
  if ((m.cost?.z > 0 || Math.abs(m.cost?.z || 0) < 0.5) &&
      m.conversions?.z < -Z_WARN && m.cpa?.z > Z_WARN) {
    flags.push({
      id: 'cpa_breakout',
      severity: m.cpa.z >= Z_ALERT ? 'alert' : 'warn',
      title: 'CPA breakout',
      detail: `Spend held/rose while conversions fell — CPA blew out ${m.cpa.z.toFixed(1)}σ above its usual ${dowLabel(scoredDay.dow)}.`,
    });
  }

  // ROAS collapse
  if (m.roas?.z < -Z_WARN && m.cost?.value > 0) {
    flags.push({
      id: 'roas_collapse',
      severity: m.roas.z <= -Z_ALERT ? 'alert' : 'warn',
      title: 'ROAS collapse',
      detail: `ROAS is ${m.roas.z.toFixed(1)}σ below the usual ${dowLabel(scoredDay.dow)} — check conversions, tracking, and whether a top ad paused.`,
    });
  }

  // Creative fatigue: impressions stable, CTR down
  if (Math.abs(m.impressions?.z || 0) < 1 && m.ctr?.z < -Z_WARN) {
    flags.push({
      id: 'ctr_drop',
      severity: m.ctr.z <= -Z_ALERT ? 'alert' : 'warn',
      title: 'CTR drop with stable reach',
      detail: `Impressions steady but CTR fell ${Math.abs(m.ctr.z).toFixed(1)}σ — creative fatigue, audience drift, or a new competitor bidding up position.`,
    });
  }

  // Reach collapse: impressions way down (budget caps, policy, ad pause)
  if (m.impressions?.z < -Z_ALERT) {
    flags.push({
      id: 'reach_collapse',
      severity: 'alert',
      title: 'Reach collapsed',
      detail: `Impressions are ${Math.abs(m.impressions.z).toFixed(1)}σ below baseline — campaign limited by budget, disapproved ad, or policy hit?`,
    });
  }

  // Conversion tracking likely broken: clicks normal, conversions zero
  if ((m.clicks?.value || 0) > 50 && (m.conversions?.value || 0) === 0 &&
      (m.conversions?.expected ?? 0) > 0) {
    flags.push({
      id: 'tracking_gap',
      severity: 'alert',
      title: 'Possible tracking gap',
      detail: `Clicks are healthy (${Math.round(m.clicks.value)}) but conversions = 0 against an expected ${(m.conversions.expected).toFixed(1)}. Check GTM / conversion tag / attribution window.`,
    });
  }

  // Spend overshoot: cost way up with flat conversions
  if (m.cost?.z > Z_ALERT && Math.abs(m.conversions?.z || 0) < 1) {
    flags.push({
      id: 'spend_overshoot',
      severity: 'warn',
      title: 'Spend up without conversion lift',
      detail: `Spend ${m.cost.z.toFixed(1)}σ above baseline with flat conversions — budget reallocation, auction heat, or smart-bidding ramp?`,
    });
  }

  // AOV shock (price mix shifted)
  if (Math.abs(m.aov?.z || 0) > Z_WARN && (m.conversions?.value || 0) > 0) {
    flags.push({
      id: 'aov_shift',
      severity: Math.abs(m.aov.z) >= Z_ALERT ? 'warn' : 'normal', // informational
      title: m.aov.z > 0 ? 'AOV jumped' : 'AOV dropped',
      detail: `Basket size moved ${m.aov.z.toFixed(1)}σ vs usual ${dowLabel(scoredDay.dow)} — product-mix shift or promo stacking.`,
    });
  }

  return flags;
}

function dowLabel(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d] || '?';
}

/* ─── WINDOW SUMMARY ───────────────────────────────────────────────── */
/**
 * Summarise a date range vs the prior matching range — that is the "how is
 * the account doing this week vs last?" read that most operators want.
 *
 * @param rows        daily rows
 * @param start, end  ISO dates (inclusive)
 * @returns { current, prior, delta }
 */
export function windowSummary(rows, start, end) {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T23:59:59Z`).getTime();
  const spanDays = Math.max(1, Math.round((e - s) / DAY) + 1);
  const priorStart = new Date(s - spanDays * DAY).toISOString().slice(0, 10);
  const priorEnd   = new Date(s - DAY).toISOString().slice(0, 10);

  const sum = (from, to) => {
    const acc = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 };
    for (const r of rows) {
      if (r.date >= from && r.date <= to) {
        acc.impressions     += r.impressions     || 0;
        acc.clicks          += r.clicks          || 0;
        acc.cost            += r.cost            || 0;
        acc.conversions     += r.conversions     || 0;
        acc.conversionValue += r.conversionValue || 0;
      }
    }
    acc.ctr      = acc.impressions > 0 ? acc.clicks / acc.impressions : 0;
    acc.cpc      = acc.clicks      > 0 ? acc.cost   / acc.clicks      : 0;
    acc.cpa      = acc.conversions > 0 ? acc.cost   / acc.conversions : 0;
    acc.roas     = acc.cost        > 0 ? acc.conversionValue / acc.cost : 0;
    acc.convRate = acc.clicks      > 0 ? acc.conversions / acc.clicks : 0;
    acc.aov      = acc.conversions > 0 ? acc.conversionValue / acc.conversions : 0;
    return acc;
  };

  const current = sum(start, end);
  const prior   = sum(priorStart, priorEnd);
  const pct = (a, b) => b > 0 ? (a - b) / b : (a > 0 ? 1 : 0);
  const delta = {};
  for (const k of Object.keys(current)) delta[k] = { abs: current[k] - prior[k], pct: pct(current[k], prior[k]) };
  return { current, prior, delta, spanDays, priorStart, priorEnd };
}

/* ─── SIMPLE TREND (linear slope) ──────────────────────────────────── */
/**
 * Least-squares slope of a metric across a window — lets the UI say
 * "CPA trending +12%/week" without having to eyeball a chart.
 */
export function trend(rows, metric) {
  const vals = rows.map(r => r[metric] ?? 0);
  const n = vals.length;
  if (n < 3) return { slope: 0, slopePctPerDay: 0 };
  const xs = vals.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = vals.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (vals[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const slopePctPerDay = my > 0 ? slope / my : 0;
  return { slope, slopePctPerDay, mean: my };
}
