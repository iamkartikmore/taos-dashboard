/**
 * Microsoft Clarity analytics — normalizes the Data Export API response
 * into actionable behavioral insights and cross-joins against Google
 * Ads landing pages + Shopify product handles.
 *
 * The API returns an array of "metric blocks" per call; each block is:
 *   { metricName: 'Traffic' | 'ScrollDepth' | 'DeadClickCount' | ...,
 *     information: [{ <dim1>, <dim2>, <dim3>, value }, ...] }
 *
 * We pivot these into row-per-dimension-combination with all metrics
 * columnized (one row per URL, one per device, etc.).
 *
 * Comparative analysis: since the API only exposes the last 3 days, we
 * cache every pull and compute WoW deltas across stored snapshots.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ─── PIVOT ─────────────────────────────────────────────────────────
   Clarity's real response shape (verified against official docs):
     [ { metricName: 'Traffic',
         information: [ { totalSessionCount: '9554',
                          totalBotSessionCount: '8369',
                          distantUserCount: '189733',
                          PagesPerSessionPercentage: 1.0931,
                          URL: '/products/x' } ] } ]

   Metric fields are embedded directly in each information[] row
   (NOT under a `value` key) and vary per metricName. We map known
   field names to friendly keys and fall back to preserving any
   numeric field under a namespaced name so nothing gets silently
   dropped if Clarity adds new metric fields.
*/

// Per-metric field extractors. Each returns { friendlyKey: number } based on
// the actual raw fields Clarity emits. The mapping covers the official docs;
// unknown fields still survive via the defensive fallback at the bottom.
function extractMetricFields(metricName, info) {
  const out = {};
  switch (metricName) {
    case 'Traffic':
      if (info.totalSessionCount != null)         out.sessions       = num(info.totalSessionCount);
      if (info.totalBotSessionCount != null)      out.botSessions    = num(info.totalBotSessionCount);
      if (info.distantUserCount != null)          out.distinctUsers  = num(info.distantUserCount);
      if (info.PagesPerSessionPercentage != null) out.pagesPerSession = num(info.PagesPerSessionPercentage);
      break;
    case 'ScrollDepth':
      // Could be averageScrollDepth or similar; take whichever numeric field exists
      if (info.averageScrollDepth != null)   out.scrollDepth = num(info.averageScrollDepth);
      else if (info.scrollDepthAverage != null) out.scrollDepth = num(info.scrollDepthAverage);
      else if (info.averageScrollDepthPercentage != null) out.scrollDepth = num(info.averageScrollDepthPercentage) / 100;
      break;
    case 'EngagementTime':
    case 'EngagingTime':
      if (info.averageEngagementTime != null) out.engagementSeconds = num(info.averageEngagementTime);
      else if (info.averageEngagingTime != null) out.engagementSeconds = num(info.averageEngagingTime);
      else if (info.totalTime != null) out.engagementSeconds = num(info.totalTime);
      break;
    case 'DeadClickCount':
      out.deadClicks = num(info.subTotal ?? info.deadClickCount ?? info.totalDeadClickCount);
      break;
    case 'RageClickCount':
      out.rageClicks = num(info.subTotal ?? info.rageClickCount ?? info.totalRageClickCount);
      break;
    case 'QuickbackClick':
      out.quickBacks = num(info.subTotal ?? info.quickbackClickCount ?? info.totalQuickbackClickCount);
      break;
    case 'ExcessiveScroll':
      out.excessiveScroll = num(info.subTotal ?? info.excessiveScrollCount ?? info.totalExcessiveScrollCount);
      break;
    case 'ScriptErrorCount':
      out.jsErrors = num(info.subTotal ?? info.scriptErrorCount ?? info.totalScriptErrorCount);
      break;
    case 'ErrorClickCount':
      out.errorClicks = num(info.subTotal ?? info.errorClickCount ?? info.totalErrorClickCount);
      break;
    case 'PopularPages':
    case 'PageViews':
      out.pageViews = num(info.sessionsCount ?? info.subTotal ?? info.totalPageViews ?? info.pageViewsCount);
      break;
    default:
      break;
  }
  return out;
}

// Well-known dimension keys Clarity returns inside information[] rows
const DIMENSION_KEYS = new Set(['URL', 'Device', 'Browser', 'OS', 'Country', 'CountryRegion', 'Country/Region', 'Channel', 'Source', 'Medium', 'Campaign', 'PageTitle', 'ReferrerUrl']);

function pivotClarityResponse(metricBlocks = [], dimensionKeys = []) {
  if (!Array.isArray(metricBlocks)) return [];
  const rowsByKey = new Map();

  for (const block of metricBlocks) {
    const metric = block.metricName;
    for (const info of (block.information || [])) {
      const keyParts = dimensionKeys.map(d => info[d] ?? '');
      const key = keyParts.join('|');
      const row = rowsByKey.get(key) || { ...Object.fromEntries(dimensionKeys.map(d => [d, info[d] || ''])) };

      // 1. Extract known metric fields into friendly columns
      const extracted = extractMetricFields(metric, info);
      Object.assign(row, extracted);

      // 2. Defensive fallback: preserve any numeric field we didn't map
      //    (protects against Clarity adding new metric fields without us
      //    noticing). Namespaced under the metric name to avoid collisions.
      for (const [k, v] of Object.entries(info)) {
        if (DIMENSION_KEYS.has(k)) continue;
        if (dimensionKeys.includes(k)) continue;
        if (k in extracted) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const nsKey = `_raw_${metric}_${k}`;
        if (!(nsKey in row)) row[nsKey] = n;
      }

      rowsByKey.set(key, row);
    }
  }
  return [...rowsByKey.values()];
}

/* ─── NORMALIZE SNAPSHOT ────────────────────────────────────────────
   Accepts the server response (with 5 dimension slices) and returns a
   unified shape with per-slice rows. ALSO preserves the raw response
   under `_raw` so that if our normalizer logic changes later, we can
   re-pivot historical snapshots without spending more API calls. */
export function normalizeClaritySnapshot(raw) {
  if (!raw) return null;
  return {
    pulledAt: raw.pulledAt || Date.now(),
    period:   raw.period || 'current',
    numOfDays: raw.numOfDays || 3,
    errors:   raw.errors || {},
    byUrl:          pivotClarityResponse(raw.url || [],           ['URL']),
    byUrlDevice:    pivotClarityResponse(raw.urlDevice || [],     ['URL', 'Device']),
    byChannel:      pivotClarityResponse(raw.channel || [],       ['Channel']),
    byCountry:      pivotClarityResponse(raw.country || [],       ['Country']),
    byDeviceBrowser: pivotClarityResponse(raw.deviceBrowser || [], ['Device', 'Browser']),
    // Stash raw responses — re-normalize cheaply if the library updates
    _raw: {
      url:            raw.url || [],
      urlDevice:      raw.urlDevice || [],
      channel:        raw.channel || [],
      country:        raw.country || [],
      deviceBrowser:  raw.deviceBrowser || [],
    },
  };
}

/* Re-run the pivot on a stored snapshot's preserved raw response —
   no API call, uses only local data. Useful after library upgrades. */
export function reanalyzeSnapshot(snapshot) {
  if (!snapshot?._raw) return snapshot; // nothing to re-process
  return normalizeClaritySnapshot({
    pulledAt:  snapshot.pulledAt,
    period:    snapshot.period,
    numOfDays: snapshot.numOfDays,
    errors:    snapshot.errors,
    ...snapshot._raw,
  });
}

/* ─── TOTALS (for KPI strip) ────────────────────────────────────── */
export function claritySummary(snapshot) {
  if (!snapshot) return null;
  const byUrl = snapshot.byUrl || [];
  const totals = byUrl.reduce((a, r) => ({
    sessions:         a.sessions + (r.sessions || 0),
    pageViews:        a.pageViews + (r.pageViews || 0),
    deadClicks:       a.deadClicks + (r.deadClicks || 0),
    rageClicks:       a.rageClicks + (r.rageClicks || 0),
    quickBacks:       a.quickBacks + (r.quickBacks || 0),
    jsErrors:         a.jsErrors + (r.jsErrors || 0),
    excessiveScroll:  a.excessiveScroll + (r.excessiveScroll || 0),
  }), { sessions: 0, pageViews: 0, deadClicks: 0, rageClicks: 0, quickBacks: 0, jsErrors: 0, excessiveScroll: 0 });
  return {
    ...totals,
    urlCount:  byUrl.length,
    rageRate:  totals.sessions ? totals.rageClicks / totals.sessions : 0,
    deadRate:  totals.sessions ? totals.deadClicks / totals.sessions : 0,
    qbRate:    totals.sessions ? totals.quickBacks / totals.sessions : 0,
  };
}

/* ─── RANKED LISTS (the "what's broken" surfaces) ───────────────── */

export function rageClickHotspots(snapshot, minSessions = 50) {
  if (!snapshot?.byUrl) return [];
  return snapshot.byUrl
    .filter(r => r.sessions >= minSessions && r.rageClicks > 0)
    .map(r => ({
      url: r.URL,
      sessions: r.sessions,
      rageClicks: r.rageClicks,
      rageRate: r.sessions ? r.rageClicks / r.sessions : 0,
      severity: r.rageClicks / r.sessions > 0.05 ? 'critical' : r.rageClicks / r.sessions > 0.02 ? 'high' : 'medium',
    }))
    .sort((a, b) => b.rageRate - a.rageRate);
}

export function deadClickHotspots(snapshot, minSessions = 50) {
  if (!snapshot?.byUrl) return [];
  return snapshot.byUrl
    .filter(r => r.sessions >= minSessions && r.deadClicks > 0)
    .map(r => ({
      url: r.URL,
      sessions: r.sessions,
      deadClicks: r.deadClicks,
      deadRate: r.sessions ? r.deadClicks / r.sessions : 0,
      severity: r.deadClicks / r.sessions > 0.10 ? 'critical' : r.deadClicks / r.sessions > 0.05 ? 'high' : 'medium',
    }))
    .sort((a, b) => b.deadRate - a.deadRate);
}

export function quickBackHotspots(snapshot, minSessions = 50) {
  if (!snapshot?.byUrl) return [];
  return snapshot.byUrl
    .filter(r => r.sessions >= minSessions && r.quickBacks > 0)
    .map(r => ({
      url: r.URL,
      sessions: r.sessions,
      quickBacks: r.quickBacks,
      qbRate: r.sessions ? r.quickBacks / r.sessions : 0,
      severity: r.quickBacks / r.sessions > 0.20 ? 'critical' : r.quickBacks / r.sessions > 0.12 ? 'high' : 'medium',
    }))
    .sort((a, b) => b.qbRate - a.qbRate);
}

export function jsErrorHotspots(snapshot, minSessions = 20) {
  if (!snapshot?.byUrl) return [];
  return snapshot.byUrl
    .filter(r => r.sessions >= minSessions && r.jsErrors > 0)
    .map(r => ({
      url: r.URL,
      sessions: r.sessions,
      jsErrors: r.jsErrors,
      errorRate: r.sessions ? r.jsErrors / r.sessions : 0,
    }))
    .sort((a, b) => b.errorRate - a.errorRate);
}

export function shallowScrollPages(snapshot, minSessions = 50, depthThreshold = 0.3) {
  if (!snapshot?.byUrl) return [];
  return snapshot.byUrl
    .filter(r => r.sessions >= minSessions && r.scrollDepth > 0 && r.scrollDepth < depthThreshold)
    .map(r => ({
      url: r.URL,
      sessions: r.sessions,
      scrollDepth: r.scrollDepth,
      action: `Avg scroll depth ${(r.scrollDepth * 100).toFixed(0)}% — above-fold content isn't holding visitors. Audit hero image, headline, price visibility.`,
    }))
    .sort((a, b) => a.scrollDepth - b.scrollDepth);
}

/* ─── DEVICE / BROWSER CRO splits ───────────────────────────────── */
export function deviceComparison(snapshot) {
  const rows = snapshot?.byDeviceBrowser || [];
  const byDevice = new Map();
  for (const r of rows) {
    const d = r.Device || 'Unknown';
    const cur = byDevice.get(d) || { device: d, sessions: 0, rageClicks: 0, deadClicks: 0, quickBacks: 0, jsErrors: 0, scrollDepthSum: 0, scrollDepthWeight: 0 };
    cur.sessions        += r.sessions || 0;
    cur.rageClicks      += r.rageClicks || 0;
    cur.deadClicks      += r.deadClicks || 0;
    cur.quickBacks      += r.quickBacks || 0;
    cur.jsErrors        += r.jsErrors || 0;
    cur.scrollDepthSum    += (r.scrollDepth || 0) * (r.sessions || 0);
    cur.scrollDepthWeight += r.sessions || 0;
    byDevice.set(d, cur);
  }
  return [...byDevice.values()].map(d => ({
    ...d,
    rageRate:    d.sessions ? d.rageClicks / d.sessions : 0,
    deadRate:    d.sessions ? d.deadClicks / d.sessions : 0,
    qbRate:      d.sessions ? d.quickBacks / d.sessions : 0,
    errorRate:   d.sessions ? d.jsErrors / d.sessions : 0,
    avgScrollDepth: d.scrollDepthWeight ? d.scrollDepthSum / d.scrollDepthWeight : 0,
  })).sort((a, b) => b.sessions - a.sessions);
}

export function channelComparison(snapshot) {
  const rows = snapshot?.byChannel || [];
  return rows.map(r => ({
    channel: r.Channel || 'Unknown',
    sessions: r.sessions || 0,
    rageRate: r.sessions ? (r.rageClicks || 0) / r.sessions : 0,
    deadRate: r.sessions ? (r.deadClicks || 0) / r.sessions : 0,
    qbRate:   r.sessions ? (r.quickBacks || 0) / r.sessions : 0,
    scrollDepth: r.scrollDepth || 0,
  })).sort((a, b) => b.sessions - a.sessions);
}

/* ─── WoW DELTA across snapshot history ─────────────────────────── */
export function compareSnapshots(current, prior) {
  if (!current || !prior) return null;
  const sumCur  = claritySummary(current);
  const sumPri  = claritySummary(prior);
  if (!sumCur || !sumPri) return null;

  const delta = (a, b) => b > 0 ? (a - b) / b : null;

  // Per-URL WoW deltas (biggest regressions + biggest improvements)
  const priorByUrl = new Map(prior.byUrl?.map(r => [r.URL, r]) || []);
  const urlDeltas = (current.byUrl || []).map(cur => {
    const pri = priorByUrl.get(cur.URL);
    if (!pri) return null;
    const curRate = cur.sessions ? cur.rageClicks / cur.sessions : 0;
    const priRate = pri.sessions ? pri.rageClicks / pri.sessions : 0;
    return {
      url: cur.URL,
      sessions: cur.sessions,
      sessionsPrior: pri.sessions,
      sessionsDelta: delta(cur.sessions, pri.sessions),
      rageRate: curRate, rageRatePrior: priRate, rageRateDelta: curRate - priRate,
      scrollDepth: cur.scrollDepth, scrollDepthPrior: pri.scrollDepth, scrollDepthDelta: (cur.scrollDepth || 0) - (pri.scrollDepth || 0),
    };
  }).filter(Boolean);

  const regressions = urlDeltas
    .filter(d => d.sessions >= 50 && (d.rageRateDelta > 0.01 || d.scrollDepthDelta < -0.1 || (d.sessionsDelta != null && d.sessionsDelta < -0.2)))
    .sort((a, b) => b.rageRateDelta - a.rageRateDelta);
  const improvements = urlDeltas
    .filter(d => d.sessions >= 50 && (d.rageRateDelta < -0.01 || d.scrollDepthDelta > 0.1))
    .sort((a, b) => a.rageRateDelta - b.rageRateDelta);

  return {
    summary: {
      sessions:     { cur: sumCur.sessions,     prior: sumPri.sessions,     delta: delta(sumCur.sessions, sumPri.sessions) },
      rageRate:     { cur: sumCur.rageRate,     prior: sumPri.rageRate,     delta: sumCur.rageRate - sumPri.rageRate },
      deadRate:     { cur: sumCur.deadRate,     prior: sumPri.deadRate,     delta: sumCur.deadRate - sumPri.deadRate },
      qbRate:       { cur: sumCur.qbRate,       prior: sumPri.qbRate,       delta: sumCur.qbRate - sumPri.qbRate },
      jsErrors:     { cur: sumCur.jsErrors,     prior: sumPri.jsErrors,     delta: delta(sumCur.jsErrors, sumPri.jsErrors) },
    },
    regressions: regressions.slice(0, 50),
    improvements: improvements.slice(0, 30),
  };
}

/* ─── CROSS-SYSTEM JOINS ────────────────────────────────────────── */

/* Google Ads landing pages × Clarity URLs → "your ad sent traffic to
   a page with a 12% rage-click rate" */
export function joinAdsClarity({ landingPages = [], snapshot, minClicks = 30 } = {}) {
  if (!landingPages?.length || !snapshot?.byUrl) return [];
  const byUrl = new Map(snapshot.byUrl.map(r => [r.URL, r]));
  // Clarity URLs are sometimes absolute, landing pages are usually absolute too — match on path if needed
  const byPath = new Map();
  for (const [url, r] of byUrl.entries()) {
    try { byPath.set(new URL(url).pathname.replace(/\/$/, ''), r); } catch { /* bad URL, skip */ }
  }

  return landingPages
    .filter(lp => lp.clicks >= minClicks)
    .map(lp => {
      let clarity = byUrl.get(lp.url);
      if (!clarity) {
        try { clarity = byPath.get(new URL(lp.url).pathname.replace(/\/$/, '')); } catch {/* */ }
      }
      if (!clarity) return null;
      return {
        url:         lp.url,
        clicks:      lp.clicks,
        convRate:    lp.convRate,
        adCost:      lp.cost,
        adRev:       lp.conversionValue,
        sessions:    clarity.sessions,
        rageRate:    clarity.sessions ? clarity.rageClicks / clarity.sessions : 0,
        deadRate:    clarity.sessions ? clarity.deadClicks / clarity.sessions : 0,
        qbRate:      clarity.sessions ? clarity.quickBacks / clarity.sessions : 0,
        scrollDepth: clarity.scrollDepth || 0,
        jsErrors:    clarity.jsErrors || 0,
      };
    })
    .filter(Boolean)
    .map(r => {
      // Auto-generated "why" narrative based on which signal is abnormal
      const reasons = [];
      if (r.rageRate > 0.03)  reasons.push(`${(r.rageRate * 100).toFixed(1)}% rage-click rate`);
      if (r.deadRate > 0.07)  reasons.push(`${(r.deadRate * 100).toFixed(1)}% dead-click rate`);
      if (r.qbRate   > 0.15)  reasons.push(`${(r.qbRate * 100).toFixed(1)}% quick-back rate`);
      if (r.scrollDepth > 0 && r.scrollDepth < 0.3) reasons.push(`avg ${(r.scrollDepth * 100).toFixed(0)}% scroll`);
      if (r.jsErrors > 0)     reasons.push(`${r.jsErrors} JS errors`);
      return { ...r, reasons, problemScore: r.rageRate * 3 + r.deadRate * 1.5 + r.qbRate + (0.5 - Math.min(r.scrollDepth, 0.5)) * 0.3 };
    })
    .sort((a, b) => b.problemScore - a.problemScore);
}

/* Shopify best-selling PDPs × Clarity → "this SKU sells well but the
   PDP has behavioral red flags — imagine how much more it'd sell". */
export function joinShopifyClarity({ orders = [], snapshot, domain = '' } = {}) {
  if (!orders?.length || !snapshot?.byUrl) return [];
  const byUrlPath = new Map();
  for (const r of snapshot.byUrl) {
    try {
      const p = new URL(r.URL).pathname.replace(/\/$/, '');
      byUrlPath.set(p, r);
    } catch { /* skip */ }
  }

  // Aggregate Shopify orders by handle
  const byHandle = new Map();
  for (const o of orders) {
    for (const li of o.line_items || []) {
      const handle = li.handle || li.product_handle;
      if (!handle) continue;
      const cur = byHandle.get(handle) || { handle, revenue: 0, units: 0, title: li.title || '' };
      cur.revenue += (Number(li.price) || 0) * (Number(li.quantity) || 1);
      cur.units   += Number(li.quantity) || 1;
      byHandle.set(handle, cur);
    }
  }

  const out = [];
  for (const [handle, row] of byHandle.entries()) {
    const pdpPath = `/products/${handle}`;
    const clarity = byUrlPath.get(pdpPath);
    if (!clarity || (clarity.sessions || 0) < 30) continue;
    const rageRate = clarity.sessions ? (clarity.rageClicks || 0) / clarity.sessions : 0;
    const qbRate   = clarity.sessions ? (clarity.quickBacks || 0) / clarity.sessions : 0;
    if (rageRate > 0.02 || qbRate > 0.12 || (clarity.scrollDepth > 0 && clarity.scrollDepth < 0.3) || (clarity.jsErrors || 0) > 0) {
      out.push({
        handle, title: row.title,
        url: pdpPath,
        revenue: row.revenue, units: row.units,
        sessions: clarity.sessions,
        rageRate, qbRate,
        scrollDepth: clarity.scrollDepth,
        jsErrors: clarity.jsErrors || 0,
        potentialUplift: row.revenue * 0.15, // rough — fixing CRO on a selling PDP often yields 10-20%
      });
    }
  }
  return out.sort((a, b) => b.potentialUplift - a.potentialUplift);
}
