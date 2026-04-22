/**
 * Dimensional decomposition — "where did the delta come from?".
 *
 * When a top-level metric moves (CPA +30%, ROAS -18%), the operator's
 * next question is always "which slice is responsible?". Decomposition
 * ranks every slice of a chosen dimension (campaign, ad group, keyword,
 * search term, device, hour, geo, age, gender, product) by its
 * contribution to the top-line change. The slices that explain the
 * largest share of the movement are what the operator should touch.
 *
 * We use additive-delta attribution for count metrics (spend, clicks,
 * conversions, revenue) because these are literally sums — a slice
 * contributes its own (current - prior) to the total delta. For ratios
 * (CPA, ROAS, CTR, conv rate) we fall back to a "rate delta × current
 * base" approximation: how much of the aggregate ratio move came from
 * each slice, holding the other slices constant. That is a linear
 * decomposition of a non-linear metric — it's approximate, but in
 * practice it lines up with the judgement calls an analyst would make.
 *
 * Caller supplies two daily-row sets (current vs prior period) plus
 * the dimension to slice on. Dimension accessor functions for the
 * common Google Ads buckets are exported so callers don't have to
 * reinvent them.
 *
 * All inputs are pure data — this lib does not fetch.
 */

/* ─── DIMENSION ACCESSORS ──────────────────────────────────────────── */
/** Each returns an array of slice rows: { sliceKey, sliceLabel, date?, impressions, clicks, cost, conversions, conversionValue } */

export const DIMENSIONS = {
  campaign: {
    label: 'Campaign',
    fromDaily: (rows) => rows.map(r => ({
      sliceKey:   r.campaignId,
      sliceLabel: r.campaignName,
      date:       r.date,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  // These use aggregated (no-date) rows since the server doesn't segment
  // them by date in the default pull. We still decompose "current vs
  // prior" when the caller supplies two snapshots, but for now the
  // primary daily decomposition works off campaignsDaily.
  adGroup: {
    label: 'Ad Group',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   r.id,
      sliceLabel: r.name,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  ad: {
    label: 'Ad',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   r.id,
      sliceLabel: r.name || `(${r.type})`,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  keyword: {
    label: 'Keyword',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   `${r.adGroupId}|${r.keyword}|${r.matchType}`,
      sliceLabel: `${r.keyword} [${r.matchType}]`,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
      qualityScore: r.qualityScore,
    })),
  },
  searchTerm: {
    label: 'Search Term',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   r.searchTerm,
      sliceLabel: r.searchTerm,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  device: {
    label: 'Device',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   r.device,
      sliceLabel: r.device,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  hour: {
    label: 'Hour',
    fromFlat: (rows) => (rows || []).map(r => ({
      sliceKey:   String(r.hour),
      sliceLabel: `${String(r.hour).padStart(2, '0')}:00`,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
  product: {
    label: 'Product',
    fromFlat: (rows) => rows.map(r => ({
      sliceKey:   r.productId,
      sliceLabel: r.productTitle || r.productId,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversionValue: r.conversionValue,
    })),
  },
};

/* ─── CURRENT-VS-PRIOR AGGREGATION ─────────────────────────────────── */

/**
 * Split campaignsDaily into {current, prior} slices for a given date range.
 * The prior range is the same length as current, immediately preceding.
 */
export function partitionDaily(rows, startIso, endIso) {
  const start = startIso; const end = endIso;
  const day = 86_400_000;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  const span = Math.max(1, Math.round((e - s) / day) + 1);
  const priorEnd   = new Date(s - day).toISOString().slice(0, 10);
  const priorStart = new Date(s - span * day).toISOString().slice(0, 10);
  const current = [], prior = [];
  for (const r of rows) {
    if (!r.date) continue;
    if (r.date >= start       && r.date <= end)       current.push(r);
    else if (r.date >= priorStart && r.date <= priorEnd) prior.push(r);
  }
  return { current, prior, priorStart, priorEnd };
}

function aggregateBySlice(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.sliceKey;
    if (k == null) continue;
    const e = map.get(k) || {
      sliceKey: k, sliceLabel: r.sliceLabel,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    e.impressions     += r.impressions     || 0;
    e.clicks          += r.clicks          || 0;
    e.cost            += r.cost            || 0;
    e.conversions     += r.conversions     || 0;
    e.conversionValue += r.conversionValue || 0;
    if (!e.sliceLabel && r.sliceLabel) e.sliceLabel = r.sliceLabel;
    map.set(k, e);
  }
  for (const e of map.values()) {
    e.ctr      = e.impressions > 0 ? e.clicks / e.impressions : 0;
    e.cpc      = e.clicks      > 0 ? e.cost   / e.clicks      : 0;
    e.cpa      = e.conversions > 0 ? e.cost   / e.conversions : 0;
    e.roas     = e.cost        > 0 ? e.conversionValue / e.cost : 0;
    e.convRate = e.clicks      > 0 ? e.conversions / e.clicks : 0;
    e.aov      = e.conversions > 0 ? e.conversionValue / e.conversions : 0;
  }
  return Array.from(map.values());
}

function sumMetric(agg, metric) {
  return agg.reduce((a, b) => a + (b[metric] || 0), 0);
}

/* ─── DECOMPOSE A DELTA BY SLICE ───────────────────────────────────── */

const ADDITIVE = new Set(['impressions', 'clicks', 'cost', 'conversions', 'conversionValue']);

/**
 * Given two slice aggregates, rank each slice by its contribution to
 * the top-line delta of `metric`.
 *
 * For additive metrics (sums): contribution = current - prior.
 *
 * For ratios (cpa, roas, ctr, convRate, cpc, aov): we compute
 * contribution as the slice's numerator_delta / prior_total_denominator
 * minus slice's share of (denominator_delta × prior_aggregate_ratio).
 * That is the linear-approximation of a ratio's movement — standard
 * attribution trick. Good enough for "where's the bleed".
 *
 * Returns:
 *   {
 *     totals:   { priorAgg, currentAgg, delta, pct },
 *     slices:   [{ sliceKey, sliceLabel, current, prior, delta, deltaPct, share, direction, ...rates }...]
 *                 sorted by |share| descending.
 *   }
 */
export function decompose(currentSliceRows, priorSliceRows, metric) {
  const curAgg = aggregateBySlice(currentSliceRows);
  const prAgg  = aggregateBySlice(priorSliceRows);
  const prByKey = new Map(prAgg.map(s => [s.sliceKey, s]));
  const keys = new Set([...curAgg.map(s => s.sliceKey), ...prByKey.keys()]);

  // Overall aggregate: this is what the UI will show as the "top-line" move.
  const overall = (arr) => {
    const tot = arr.reduce((a, b) => ({
      impressions: a.impressions + (b.impressions || 0),
      clicks:      a.clicks      + (b.clicks || 0),
      cost:        a.cost        + (b.cost || 0),
      conversions: a.conversions + (b.conversions || 0),
      conversionValue: a.conversionValue + (b.conversionValue || 0),
    }), { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 });
    tot.ctr      = tot.impressions > 0 ? tot.clicks / tot.impressions : 0;
    tot.cpc      = tot.clicks      > 0 ? tot.cost   / tot.clicks      : 0;
    tot.cpa      = tot.conversions > 0 ? tot.cost   / tot.conversions : 0;
    tot.roas     = tot.cost        > 0 ? tot.conversionValue / tot.cost : 0;
    tot.convRate = tot.clicks      > 0 ? tot.conversions / tot.clicks : 0;
    tot.aov      = tot.conversions > 0 ? tot.conversionValue / tot.conversions : 0;
    return tot;
  };
  const priorAgg   = overall(prAgg);
  const currentAgg = overall(curAgg);
  const delta      = currentAgg[metric] - priorAgg[metric];
  const pct        = priorAgg[metric] > 0 ? delta / priorAgg[metric] : (currentAgg[metric] > 0 ? 1 : 0);

  const slices = [];
  for (const k of keys) {
    const c = curAgg.find(s => s.sliceKey === k) || { cost: 0, clicks: 0, conversions: 0, conversionValue: 0, impressions: 0 };
    const p = prByKey.get(k) || { cost: 0, clicks: 0, conversions: 0, conversionValue: 0, impressions: 0 };
    const label = (c.sliceLabel ?? p.sliceLabel) || String(k);

    let contribution;
    if (ADDITIVE.has(metric)) {
      contribution = (c[metric] || 0) - (p[metric] || 0);
    } else {
      // Ratio-approximation. Pick numerator / denominator fields per metric.
      const NUM = {
        cpa: 'cost', cpc: 'cost',
        roas: 'conversionValue', aov: 'conversionValue',
        ctr: 'clicks', convRate: 'conversions',
      }[metric];
      const DEN = {
        cpa: 'conversions', cpc: 'clicks',
        roas: 'cost',       aov: 'conversions',
        ctr: 'impressions', convRate: 'clicks',
      }[metric];
      const priorDen = priorAgg[DEN] || 0;
      if (priorDen > 0) {
        const priorRate = priorAgg[metric] || 0;
        const numDelta  = (c[NUM] || 0) - (p[NUM] || 0);
        const denDelta  = (c[DEN] || 0) - (p[DEN] || 0);
        contribution = (numDelta - priorRate * denDelta) / priorDen;
      } else {
        contribution = 0;
      }
    }

    const share = delta !== 0 ? contribution / delta : 0;
    slices.push({
      sliceKey: k, sliceLabel: label,
      current: c[metric] || 0,
      prior:   p[metric] || 0,
      delta:   contribution,
      // Direction for non-additive: share > 0 means it pushed the agg in the
      // same direction as the overall move. For additive, same story but
      // signed on raw contribution.
      share,
      shareAbs: Math.abs(share),
      // Per-slice rates for tooltips
      curCost: c.cost || 0, prCost: p.cost || 0,
      curClicks: c.clicks || 0, prClicks: p.clicks || 0,
      curConv: c.conversions || 0, prConv: p.conversions || 0,
      curRev: c.conversionValue || 0, prRev: p.conversionValue || 0,
      curMetricRate: c[metric] || 0,
      prMetricRate:  p[metric] || 0,
    });
  }

  slices.sort((a, b) => b.shareAbs - a.shareAbs);
  return {
    totals: { priorAgg, currentAgg, delta, pct },
    slices,
  };
}

/**
 * Split slices into the ones pushing the top-line in the "bad" direction
 * vs the "good" direction (for the chosen metric). Useful when the UI
 * wants two lists ("worst contributors" vs "best contributors").
 */
export function splitContributors(decomposed, metric) {
  const badIsUp   = ['cpa', 'cpc'].includes(metric);          // higher = worse
  const badIsDown = ['roas', 'ctr', 'convRate', 'conversions', 'conversionValue', 'clicks', 'impressions', 'aov'].includes(metric);

  const bad = [];
  const good = [];
  for (const s of decomposed.slices) {
    if (!isFinite(s.delta) || s.delta === 0) continue;
    const movedUp = s.delta > 0;
    const isBad = (badIsUp && movedUp) || (badIsDown && !movedUp);
    if (isBad) bad.push(s); else good.push(s);
  }
  return { bad, good };
}

/* ─── WASTE VS VALUE ───────────────────────────────────────────────── */
/**
 * For a slice aggregate, split slices into buckets by efficiency:
 *   - winners: cost > threshold AND roas above account median
 *   - wasters: cost > threshold AND (0 conversions OR roas below floor)
 *   - flat:    too small to judge
 *
 * Used to power the recommendation queue.
 */
export function bucketSlices(sliceAgg, { minCost = 100, roasFloor = 0.8 } = {}) {
  const withCost = sliceAgg.filter(s => s.cost >= minCost);
  // Median ROAS of slices with conversions
  const withConv = withCost.filter(s => s.conversions > 0);
  const sortedRoas = withConv.map(s => s.roas).sort((a, b) => a - b);
  const median = sortedRoas.length ? sortedRoas[Math.floor(sortedRoas.length / 2)] : 0;

  const winners = [];
  const wasters = [];
  const flat    = [];
  for (const s of sliceAgg) {
    if (s.cost < minCost) { flat.push(s); continue; }
    if (s.conversions === 0 || s.roas < roasFloor) wasters.push(s);
    else if (s.roas > median && median > 0) winners.push(s);
    else flat.push(s);
  }
  wasters.sort((a, b) => b.cost - a.cost);
  winners.sort((a, b) => b.roas - a.roas);
  return { winners, wasters, flat, medianRoas: median };
}
