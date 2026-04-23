/**
 * UTM / channel-performance report parser + analytics.
 *
 * Built to be tolerant of schema variation — Shopify's scheduled
 * UTM reports come in a few shapes depending on the template chosen.
 * We auto-detect the columns by substring-match against header names
 * and extract whatever metric+dimension pairs are present.
 *
 * Input:  CSV text (from Drive pull or drag-drop)
 * Output: { reportDate, rows: [{dims, metrics}], columns: {...} }
 *
 * Snapshot store = Map<reportDate, {rows, metadata}>
 * Analytics: DoD / WoW / MoM deltas per channel, distress / opportunity
 * / emerging classification.
 */

import { parseCsv } from './csvImport';

/* ─── COLUMN DETECTION ─────────────────────────────────────────────
   Substring-match header names (normalized lowercase-alphanumeric)
   against canonical field patterns. First match wins per canonical. */
const COLUMN_PATTERNS = {
  // Dimensions — order matters: more specific first
  date:         ['reportdate', 'reportday', 'day', 'date'],
  utmSource:    ['utmsource', 'marketingsource'],
  utmMedium:    ['utmmedium', 'marketingmedium'],
  utmCampaign:  ['utmcampaign', 'marketingcampaign'],
  utmContent:   ['utmcontent'],
  utmTerm:      ['utmterm'],
  channel:      ['marketingchannel', 'channelgroup', 'defaultchannelgroup', 'channelgrouping', 'channel'],
  source:       ['source'],            // fallback when utm_source not explicit
  medium:       ['medium'],            // fallback when utm_medium not explicit
  campaign:     ['campaign'],          // fallback when utm_campaign not explicit
  referrer:     ['referrer', 'referringsite', 'referringurl'],
  landingPage:  ['landingpage', 'landingpath', 'entrancepage'],
  country:      ['country', 'countrycode'],
  device:       ['device', 'devicecategory'],
  // Metrics — also order-sensitive; prefer explicit column names
  sessions:        ['onlinestoresessions', 'sessions', 'visits', 'sessioncount'],
  users:           ['uniquevisitors', 'uniquesvisitors', 'users', 'uniqueusers'],
  orders:          ['orderplaced', 'orderscompleted', 'orderstotal', 'totalorders', 'ordercount', 'purchases', 'transactions', 'orders'],
  revenue:         ['totalsales', 'netsales', 'grosssales', 'purchasevalue', 'revenue', 'sales', 'totalrevenue'],
  checkoutInitiated: ['checkoutinitiated', 'initiatecheckout', 'checkoutstarted', 'addtocart', 'atc', 'addedtocart'],
  conversionRate:  ['conversionrate', 'cvr', 'conversion', 'conversions', 'totalconversions'],
  clicks:          ['clicks', 'totalclicks'],
  impressions:     ['impressions', 'totalimpressions'],
  cost:            ['adspend', 'spend', 'cost'],
};

const normKey = s => String(s || '').toLowerCase().replace(/^﻿/, '').replace(/[^a-z0-9]/g, '');

function detectColumns(headers = []) {
  const found = {};
  const taken = new Set(); // each header maps to at most one canonical
  const normHeaders = headers.map(h => ({ raw: h, norm: normKey(h) }));
  // Two-pass: first prefer exact matches (most confident), then substring
  for (const [canon, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const h of normHeaders) {
      if (taken.has(h.raw)) continue;
      if (patterns.some(p => h.norm === p)) {
        found[canon] = h.raw; taken.add(h.raw); break;
      }
    }
  }
  for (const [canon, patterns] of Object.entries(COLUMN_PATTERNS)) {
    if (found[canon]) continue;
    for (const h of normHeaders) {
      if (taken.has(h.raw)) continue;
      if (patterns.some(p => h.norm.includes(p))) {
        found[canon] = h.raw; taken.add(h.raw); break;
      }
    }
  }
  return found;
}

/* ─── FILENAME DATE EXTRACT ────────────────────────────────────────
   Filenames like "Dawbu Report_2026-04-23T07_01_13.463...+05_30.csv"
   — pull the yyyy-mm-dd from the first ISO-looking token. */
export function extractReportDate(filename = '') {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // Fallback: today
  return new Date().toISOString().slice(0, 10);
}

/* ─── FILENAME BRAND EXTRACT ───────────────────────────────────────
   Match the first token before " Report" against configured brand
   names. Returns best match (case-insensitive substring). */
export function extractBrandFromName(filename = '', brands = []) {
  const prefix = filename.split(/report/i)[0].trim().toLowerCase();
  if (!prefix) return null;
  const exact = brands.find(b => b.name.toLowerCase() === prefix);
  if (exact) return exact.id;
  // Substring either way
  const sub = brands.find(b =>
    prefix.includes(b.name.toLowerCase()) ||
    b.name.toLowerCase().includes(prefix)
  );
  return sub?.id || null;
}

/* ─── PARSE ONE CSV ────────────────────────────────────────────────
   Returns a normalized snapshot:
     { reportDate, columns, rows: [{date?, utmSource?, ..., sessions, orders, revenue, ...}] } */
export function parseUtmReport(text, { filename = '', fallbackDate = null } = {}) {
  // parseCsv returns an array of row-objects keyed by header string.
  // Headers are therefore the keys of the first row.
  const parsedRows = parseCsv(text);
  if (!parsedRows?.length) return { rows: [], columns: {}, reportDate: fallbackDate || extractReportDate(filename), headers: [], rawRowCount: 0, warnings: ['CSV parsed but contained zero data rows.'] };
  const headers = Object.keys(parsedRows[0] || {});
  const cols = detectColumns(headers);

  const num = v => {
    if (v == null) return 0;
    // Strip currency + thousands separators
    const n = Number(String(v).replace(/[₹,$£€\s,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const str = v => (v == null ? '' : String(v).trim());

  // Source/medium/campaign fallbacks: if no explicit utm_* column was
  // found, use the plain source/medium/campaign columns.
  const srcCol = cols.utmSource   || cols.source;
  const medCol = cols.utmMedium   || cols.medium;
  const campCol = cols.utmCampaign || cols.campaign;

  const rows = parsedRows.map(row => {
    const out = {};
    if (cols.date)        out.date        = str(row[cols.date]);
    if (srcCol)           out.utmSource   = str(row[srcCol]);
    if (medCol)           out.utmMedium   = str(row[medCol]);
    if (campCol)          out.utmCampaign = str(row[campCol]);
    if (cols.utmContent)  out.utmContent  = str(row[cols.utmContent]);
    if (cols.utmTerm)     out.utmTerm     = str(row[cols.utmTerm]);
    if (cols.channel)     out.channel     = str(row[cols.channel]);
    if (cols.landingPage) out.landingPage = str(row[cols.landingPage]);
    if (cols.device)      out.device      = str(row[cols.device]);
    if (cols.country)     out.country     = str(row[cols.country]);
    if (cols.referrer)    out.referrer    = str(row[cols.referrer]);

    const channelKey = out.channel
      || [out.utmSource, out.utmMedium].filter(Boolean).join(' / ')
      || out.referrer
      || '(direct / none)';
    out.channelKey = channelKey;

    if (cols.sessions)          out.sessions          = num(row[cols.sessions]);
    if (cols.users)             out.users             = num(row[cols.users]);
    if (cols.orders)            out.orders            = num(row[cols.orders]);
    if (cols.revenue)           out.revenue           = num(row[cols.revenue]);
    if (cols.checkoutInitiated) out.checkoutInitiated = num(row[cols.checkoutInitiated]);
    if (cols.conversionRate)    out.conversionRate    = num(row[cols.conversionRate]);
    if (cols.clicks)            out.clicks            = num(row[cols.clicks]);
    if (cols.impressions)       out.impressions       = num(row[cols.impressions]);
    if (cols.cost)              out.cost              = num(row[cols.cost]);
    return out;
  }).filter(r => {
    // Keep rows with ANY signal — dimension OR metric.
    if (r.sessions > 0 || r.orders > 0 || r.revenue > 0 || r.clicks > 0 || r.impressions > 0 || r.checkoutInitiated > 0) return true;
    if (r.channelKey && r.channelKey !== '(direct / none)') return true;
    return false;
  });

  // Detect parse problems so the UI can flag them
  const hasAnyMetric = !!(cols.sessions || cols.orders || cols.revenue || cols.clicks || cols.impressions || cols.checkoutInitiated);
  const hasAnyDim    = !!(cols.channel || srcCol || medCol || campCol || cols.referrer);
  const warnings = [];
  if (!hasAnyMetric) warnings.push('No metric columns detected (sessions/orders/revenue/clicks/impressions).');
  if (!hasAnyDim)    warnings.push('No dimension columns detected (channel/utm_source/utm_medium/utm_campaign).');
  if (rows.length === 0 && parsedRows.length > 0) warnings.push(`${parsedRows.length} CSV rows parsed but all filtered out — check column mapping below.`);

  return {
    reportDate: fallbackDate || extractReportDate(filename),
    filename,
    columns: cols,
    headers,
    rawRowCount: parsedRows.length,
    sampleRow: parsedRows[0] || null,
    warnings,
    rows,
  };
}

/* ─── AGGREGATE A SNAPSHOT TO A CHANNEL MAP ────────────────────
   Channel key → { sessions, orders, revenue, cost, ... } */
export function aggregateByChannel(snapshot) {
  const map = new Map();
  for (const r of snapshot?.rows || []) {
    const key = r.channelKey || '(direct / none)';
    const cur = map.get(key) || {
      channel: key,
      utmSource: r.utmSource || '',
      utmMedium: r.utmMedium || '',
      sessions: 0, orders: 0, revenue: 0, cost: 0, clicks: 0, impressions: 0,
      checkoutInitiated: 0,
    };
    cur.sessions          += r.sessions || 0;
    cur.orders            += r.orders || 0;
    cur.revenue           += r.revenue || 0;
    cur.cost              += r.cost || 0;
    cur.clicks            += r.clicks || 0;
    cur.impressions       += r.impressions || 0;
    cur.checkoutInitiated += r.checkoutInitiated || 0;
    map.set(key, cur);
  }
  // Derive per-channel CVR now (after all rows aggregated)
  for (const v of map.values()) {
    v.cvr = v.checkoutInitiated > 0 ? v.orders / v.checkoutInitiated
          : v.sessions > 0          ? v.orders / v.sessions
          : 0;
  }
  return map;
}

/* ─── COMPARE TWO SNAPSHOTS (DoD or any period) ────────────────
   Returns array of channel-rows with current + prior + delta. */
export function compareSnapshots(current, prior) {
  const cur = aggregateByChannel(current);
  const pri = aggregateByChannel(prior);
  const allKeys = new Set([...cur.keys(), ...pri.keys()]);
  const rows = [];
  for (const key of allKeys) {
    const c = cur.get(key) || null;
    const p = pri.get(key) || null;
    const cRev = c?.revenue || 0;
    const pRev = p?.revenue || 0;
    const cSess = c?.sessions || 0;
    const pSess = p?.sessions || 0;
    const cOrd = c?.orders || 0;
    const pOrd = p?.orders || 0;
    const cCi  = c?.checkoutInitiated || 0;
    const pCi  = p?.checkoutInitiated || 0;
    rows.push({
      channel: key,
      utmSource: (c || p)?.utmSource || '',
      utmMedium: (c || p)?.utmMedium || '',
      sessions: cSess, sessionsPrior: pSess, sessionsDelta: cSess - pSess, sessionsDeltaPct: pSess ? (cSess - pSess) / pSess : null,
      orders:   cOrd,  ordersPrior:   pOrd,  ordersDelta:   cOrd - pOrd,  ordersDeltaPct:   pOrd ? (cOrd - pOrd) / pOrd : null,
      revenue:  cRev,  revenuePrior:  pRev,  revenueDelta:  cRev - pRev,  revenueDeltaPct:  pRev ? (cRev - pRev) / pRev : null,
      checkoutInitiated:      cCi,
      checkoutInitiatedPrior: pCi,
      checkoutInitiatedDelta: cCi - pCi,
      checkoutInitiatedDeltaPct: pCi ? (cCi - pCi) / pCi : null,
      isNew:      !!(c && !p),
      isGone:     !!(p && !c),
      cvr:        cCi > 0 ? cOrd / cCi : cSess > 0 ? cOrd / cSess : 0,
      cvrPrior:   pCi > 0 ? pOrd / pCi : pSess > 0 ? pOrd / pSess : 0,
      aov:        cOrd > 0 ? cRev / cOrd : 0,
      aovPrior:   pOrd > 0 ? pRev / pOrd : 0,
    });
  }
  // Rank by best-available volume metric (revenue when present, else orders, else checkouts)
  return rows.sort((a, b) => (b.revenue - a.revenue) || (b.orders - a.orders) || (b.checkoutInitiated - a.checkoutInitiated));
}

/* ─── CLASSIFY CHANNELS ────────────────────────────────────────
   Inputs: comparison rows + classification thresholds. Output:
   {
     distressed: channels dropping fast with real volume,
     opportunity: recent momentum gainers,
     emerging:    brand-new channels (appeared today),
     fading:      channels disappearing,
     stable:      flat within ±10%,
   } */
export function classifyChannels(compared = [], { minSessions = 50, minOrders = 1, minCheckouts = 3 } = {}) {
  const distressed = [];
  const opportunity = [];
  const emerging = [];
  const fading = [];
  const stable = [];

  for (const r of compared) {
    const maxVol      = Math.max(r.sessions, r.sessionsPrior, r.checkoutInitiated, r.checkoutInitiatedPrior, r.orders * 10, r.ordersPrior * 10);
    const hasVolume =
      r.sessions >= minSessions || r.sessionsPrior >= minSessions ||
      r.revenue > 500            || r.revenuePrior > 500 ||
      r.checkoutInitiated >= minCheckouts || r.checkoutInitiatedPrior >= minCheckouts ||
      r.orders >= minOrders      || r.ordersPrior >= minOrders;
    if (r.isNew && (r.sessions >= 10 || r.checkoutInitiated >= 1 || r.orders >= 1)) { emerging.push(r); continue; }
    if (r.isGone && (r.sessionsPrior >= 20 || r.checkoutInitiatedPrior >= 2 || r.ordersPrior >= 1)) { fading.push(r); continue; }
    if (!hasVolume) continue;

    // Pick the best-available delta to evaluate: revenue > orders > checkouts > sessions
    const revPct = r.revenueDeltaPct;
    const ordPct = r.ordersDeltaPct;
    const ciPct  = r.checkoutInitiatedDeltaPct;
    const sessPct = r.sessionsDeltaPct;
    const primary = revPct ?? ordPct ?? ciPct ?? sessPct;
    const primaryMetric = revPct != null ? 'Revenue' : ordPct != null ? 'Orders' : ciPct != null ? 'Checkouts' : 'Sessions';

    if (primary != null && primary <= -0.25) {
      r.severity = primary <= -0.5 ? 'critical' : primary <= -0.35 ? 'high' : 'medium';
      r.reason = `${primaryMetric} ${(primary * 100).toFixed(0)}% DoD`;
      distressed.push(r);
      continue;
    }
    if (primary != null && primary >= 0.25) {
      r.reason = `${primaryMetric} +${(primary * 100).toFixed(0)}% DoD`;
      opportunity.push(r);
      continue;
    }
    stable.push(r);
  }

  return {
    distressed: distressed.sort((a, b) => Math.abs(b.revenuePrior) - Math.abs(a.revenuePrior)),
    opportunity: opportunity.sort((a, b) => b.revenue - a.revenue),
    emerging: emerging.sort((a, b) => b.revenue - a.revenue),
    fading: fading.sort((a, b) => b.revenuePrior - a.revenuePrior),
    stable,
  };
}

/* ─── TREND ACROSS N SNAPSHOTS ─────────────────────────────────
   Input: array of snapshots (newest last). Returns per-channel
   time series + 7-day trend slope using Mann-Kendall. */
import { mannKendall } from './advancedStats';

export function channelTrends(snapshots = [], { metric = 'revenue' } = {}) {
  if (!snapshots?.length) return [];
  const byChannel = new Map();
  snapshots.forEach((snap, idx) => {
    const agg = aggregateByChannel(snap);
    for (const [k, v] of agg.entries()) {
      let series = byChannel.get(k);
      if (!series) { series = { channel: k, series: new Array(snapshots.length).fill(0) }; byChannel.set(k, series); }
      series.series[idx] = v[metric] || 0;
    }
  });
  const result = [];
  for (const ch of byChannel.values()) {
    const mk = mannKendall(ch.series);
    const total = ch.series.reduce((s, v) => s + v, 0);
    const latest = ch.series[ch.series.length - 1];
    const first = ch.series[0];
    result.push({
      channel: ch.channel,
      series: ch.series,
      slope: mk.slope,
      pValue: mk.pValue,
      direction: mk.direction,
      significant: mk.significant,
      latest,
      first,
      total,
      avg: total / snapshots.length,
    });
  }
  return result.sort((a, b) => b.total - a.total);
}

/* ─── BREAKDOWNS — group by any dimension, rank + rollup "Other" ─
   Used by the UI for pie/bar/matrix visualizations. Returns top N
   plus a synthetic "Other" row aggregating the tail, plus totals
   so the pie chart can show percentages. */
export function breakdownBy(snapshot, dimension = 'utmSource', { topN = 8 } = {}) {
  if (!snapshot?.rows?.length) return { items: [], other: null, totals: {} };
  const map = new Map();
  for (const r of snapshot.rows) {
    const key = r[dimension] || '(unknown)';
    const cur = map.get(key) || { name: key, orders: 0, revenue: 0, checkoutInitiated: 0, sessions: 0, rows: 0 };
    cur.orders            += r.orders || 0;
    cur.revenue           += r.revenue || 0;
    cur.checkoutInitiated += r.checkoutInitiated || 0;
    cur.sessions          += r.sessions || 0;
    cur.rows++;
    map.set(key, cur);
  }
  const all = [...map.values()].map(x => ({
    ...x,
    cvr: x.checkoutInitiated > 0 ? x.orders / x.checkoutInitiated : (x.sessions > 0 ? x.orders / x.sessions : 0),
  }));
  // Sort by whichever primary metric has volume
  const hasRevenue = all.some(x => x.revenue > 0);
  const primary = hasRevenue ? 'revenue' : 'orders';
  all.sort((a, b) => b[primary] - a[primary]);

  const head = all.slice(0, topN);
  const tail = all.slice(topN);
  let other = null;
  if (tail.length) {
    other = tail.reduce((acc, x) => ({
      name: `Other (${tail.length})`,
      orders:            acc.orders + x.orders,
      revenue:           acc.revenue + x.revenue,
      checkoutInitiated: acc.checkoutInitiated + x.checkoutInitiated,
      sessions:          acc.sessions + x.sessions,
      rows:              acc.rows + x.rows,
    }), { name: '', orders: 0, revenue: 0, checkoutInitiated: 0, sessions: 0, rows: 0 });
    other.cvr = other.checkoutInitiated > 0 ? other.orders / other.checkoutInitiated : 0;
  }

  const totals = all.reduce((t, x) => ({
    orders:            t.orders + x.orders,
    revenue:           t.revenue + x.revenue,
    checkoutInitiated: t.checkoutInitiated + x.checkoutInitiated,
    sessions:          t.sessions + x.sessions,
  }), { orders: 0, revenue: 0, checkoutInitiated: 0, sessions: 0 });

  // Attach % share of primary metric for the UI
  const total = totals[primary] || 1;
  head.forEach(x => { x.share = x[primary] / total; });
  if (other) other.share = other[primary] / total;

  return { items: head, other, totals, dimension, primary };
}

/* Source × Medium matrix — two-dim grid for heatmap visuals */
export function crossBreakdown(snapshot, rowDim = 'utmSource', colDim = 'utmMedium') {
  if (!snapshot?.rows?.length) return { rows: [], cols: [], matrix: {} };
  const rowKeys = new Map();   // rowKey → total orders
  const colKeys = new Map();
  const matrix = {};           // `${rowKey}|${colKey}` → aggregates
  for (const r of snapshot.rows) {
    const rk = r[rowDim] || '(unknown)';
    const ck = r[colDim] || '(unknown)';
    rowKeys.set(rk, (rowKeys.get(rk) || 0) + (r.orders || 0) + (r.checkoutInitiated || 0));
    colKeys.set(ck, (colKeys.get(ck) || 0) + (r.orders || 0) + (r.checkoutInitiated || 0));
    const key = `${rk}|${ck}`;
    const cur = matrix[key] || { orders: 0, revenue: 0, checkoutInitiated: 0 };
    cur.orders            += r.orders || 0;
    cur.revenue           += r.revenue || 0;
    cur.checkoutInitiated += r.checkoutInitiated || 0;
    matrix[key] = cur;
  }
  const rowList = [...rowKeys.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 10);
  const colList = [...colKeys.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 10);
  return { rows: rowList, cols: colList, matrix };
}

/* Per-source (or any dim) daily time series — one line per key */
export function trendByDimension(snapshots = [], dimension = 'utmSource', { topN = 6, metric = null } = {}) {
  if (!snapshots.length) return { data: [], keys: [] };
  // Pick metric based on data
  const probe = snapshots.reduce((t, s) => {
    for (const r of (s.rows || [])) {
      t.revenue           += r.revenue || 0;
      t.orders            += r.orders || 0;
      t.checkoutInitiated += r.checkoutInitiated || 0;
    }
    return t;
  }, { revenue: 0, orders: 0, checkoutInitiated: 0 });
  const m = metric || (probe.revenue > 0 ? 'revenue' : probe.orders > 0 ? 'orders' : 'checkoutInitiated');

  // First: rank dimension values by total metric across history
  const totals = new Map();
  for (const s of snapshots) {
    for (const r of (s.rows || [])) {
      const k = r[dimension] || '(unknown)';
      totals.set(k, (totals.get(k) || 0) + (r[m] || 0));
    }
  }
  const topKeys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);

  // Build one data row per snapshot with each top-key as a field
  const data = snapshots.map(s => {
    const row = { date: s.reportDate.slice(5) };
    for (const k of topKeys) row[k] = 0;
    for (const r of (s.rows || [])) {
      const k = r[dimension] || '(unknown)';
      if (topKeys.includes(k)) row[k] += r[m] || 0;
    }
    return row;
  });
  return { data, keys: topKeys, metric: m };
}

/* ─── TOP-LEVEL ANALYZE ───────────────────────────────────────
   Runs classification vs the prior day and trend across the
   stored history. Returns the composite summary the UI renders. */
export function analyzeReports(snapshots = []) {
  if (!snapshots?.length) return null;
  const sorted = [...snapshots].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const latest = sorted[sorted.length - 1];
  const prior  = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  const latestAgg = aggregateByChannel(latest);
  const compared = prior ? compareSnapshots(latest, prior) : [...latestAgg.values()].map(r => ({ ...r, sessionsPrior: 0, ordersPrior: 0, revenuePrior: 0, isNew: false, isGone: false }));
  const classified = classifyChannels(compared);
  // Pick whichever metric has real volume for trending
  const totalsProbe = { revenue: 0, orders: 0, checkoutInitiated: 0 };
  for (const snap of sorted) {
    for (const r of (snap.rows || [])) {
      totalsProbe.revenue           += r.revenue || 0;
      totalsProbe.orders            += r.orders || 0;
      totalsProbe.checkoutInitiated += r.checkoutInitiated || 0;
    }
  }
  const trendMetric = totalsProbe.revenue > 0 ? 'revenue'
                    : totalsProbe.orders  > 0 ? 'orders'
                    : totalsProbe.checkoutInitiated > 0 ? 'checkoutInitiated'
                    : 'sessions';
  const trends = channelTrends(sorted.slice(-14), { metric: trendMetric });

  // Dataset totals
  const totals = { sessions: 0, orders: 0, revenue: 0, checkoutInitiated: 0 };
  for (const r of latestAgg.values()) {
    totals.sessions          += r.sessions || 0;
    totals.orders            += r.orders || 0;
    totals.revenue           += r.revenue || 0;
    totals.checkoutInitiated += r.checkoutInitiated || 0;
  }
  const priorTotals = prior ? (() => {
    const p = aggregateByChannel(prior);
    const t = { sessions: 0, orders: 0, revenue: 0, checkoutInitiated: 0 };
    for (const r of p.values()) {
      t.sessions += r.sessions;
      t.orders += r.orders;
      t.revenue += r.revenue;
      t.checkoutInitiated += r.checkoutInitiated || 0;
    }
    return t;
  })() : null;

  return {
    snapshots: sorted,
    latest,
    prior,
    compared,
    classified,
    trends,
    trendMetric,
    totals,
    priorTotals,
    totalsDelta: priorTotals ? {
      sessions: totals.sessions - priorTotals.sessions,
      orders:   totals.orders   - priorTotals.orders,
      revenue:  totals.revenue  - priorTotals.revenue,
      checkoutInitiated: totals.checkoutInitiated - priorTotals.checkoutInitiated,
      sessionsPct:          priorTotals.sessions          ? (totals.sessions - priorTotals.sessions) / priorTotals.sessions : null,
      ordersPct:            priorTotals.orders            ? (totals.orders   - priorTotals.orders)   / priorTotals.orders   : null,
      revenuePct:           priorTotals.revenue           ? (totals.revenue  - priorTotals.revenue)  / priorTotals.revenue  : null,
      checkoutInitiatedPct: priorTotals.checkoutInitiated ? (totals.checkoutInitiated - priorTotals.checkoutInitiated) / priorTotals.checkoutInitiated : null,
    } : null,
  };
}
