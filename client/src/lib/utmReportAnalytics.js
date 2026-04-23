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
   Map of canonical field name → array of header patterns to match.
   Header is normalized (lowercase, no non-alnum) then substring-
   checked. First match wins. */
const COLUMN_PATTERNS = {
  // Dimensions
  date:         ['date', 'day', 'reportdate', 'reportday'],
  utmSource:    ['utmsource', 'source'],
  utmMedium:    ['utmmedium', 'medium'],
  utmCampaign:  ['utmcampaign', 'campaign'],
  utmContent:   ['utmcontent'],
  utmTerm:      ['utmterm'],
  channel:      ['marketingchannel', 'channelgroup', 'channel', 'defaultchannelgroup'],
  landingPage:  ['landingpage', 'landingpath'],
  referrer:     ['referrer', 'referringsite'],
  country:      ['country', 'countrycode'],
  device:       ['device', 'devicecategory'],
  // Metrics
  sessions:     ['sessions', 'visits', 'onlinestoresessions'],
  users:        ['users', 'uniquesvisitors', 'uniquevisitors'],
  orders:       ['orders', 'purchases', 'transactions'],
  revenue:      ['totalsales', 'netsales', 'grosssales', 'sales', 'revenue', 'purchasevalue'],
  conversions:  ['conversions', 'totalconversions'],
  clicks:       ['clicks'],
  impressions:  ['impressions'],
  cost:         ['cost', 'spend', 'adspend'],
  bounceRate:   ['bouncerate'],
  avgSession:   ['avgsessionduration', 'averagesessionduration'],
};

const normKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function detectColumns(headers = []) {
  const found = {};
  const normHeaders = headers.map(h => ({ raw: h, norm: normKey(h) }));
  for (const [canon, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const h of normHeaders) {
      if (patterns.some(p => h.norm === p || h.norm.includes(p))) {
        found[canon] = h.raw;
        break;
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
  const parsed = parseCsv(text);
  if (!parsed?.rows?.length) return { rows: [], columns: {}, reportDate: fallbackDate || extractReportDate(filename) };
  const cols = detectColumns(parsed.headers);

  const num = v => {
    if (v == null) return 0;
    // Strip currency + thousands separators
    const n = Number(String(v).replace(/[₹,$£€\s,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const str = v => (v == null ? '' : String(v).trim());

  const rows = parsed.rows.map(row => {
    const out = {};
    if (cols.date)        out.date        = str(row[cols.date]);
    if (cols.utmSource)   out.utmSource   = str(row[cols.utmSource]);
    if (cols.utmMedium)   out.utmMedium   = str(row[cols.utmMedium]);
    if (cols.utmCampaign) out.utmCampaign = str(row[cols.utmCampaign]);
    if (cols.utmContent)  out.utmContent  = str(row[cols.utmContent]);
    if (cols.utmTerm)     out.utmTerm     = str(row[cols.utmTerm]);
    if (cols.channel)     out.channel     = str(row[cols.channel]);
    if (cols.landingPage) out.landingPage = str(row[cols.landingPage]);
    if (cols.device)      out.device      = str(row[cols.device]);
    if (cols.country)     out.country     = str(row[cols.country]);

    // Build a synthetic "channel key" when no explicit channel exists —
    // utm_source/utm_medium is the lingua franca. Fallback: "(direct)".
    const channelKey = out.channel
      || [out.utmSource, out.utmMedium].filter(Boolean).join(' / ')
      || '(direct / none)';
    out.channelKey = channelKey;

    if (cols.sessions)    out.sessions    = num(row[cols.sessions]);
    if (cols.users)       out.users       = num(row[cols.users]);
    if (cols.orders)      out.orders      = num(row[cols.orders]);
    if (cols.revenue)     out.revenue     = num(row[cols.revenue]);
    if (cols.conversions) out.conversions = num(row[cols.conversions]);
    if (cols.clicks)      out.clicks      = num(row[cols.clicks]);
    if (cols.impressions) out.impressions = num(row[cols.impressions]);
    if (cols.cost)        out.cost        = num(row[cols.cost]);
    return out;
  }).filter(r => r.channelKey && (r.sessions > 0 || r.orders > 0 || r.revenue > 0 || r.impressions > 0));

  return {
    reportDate: fallbackDate || extractReportDate(filename),
    filename,
    columns: cols,
    headers: parsed.headers,
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
    };
    cur.sessions    += r.sessions || 0;
    cur.orders      += r.orders || 0;
    cur.revenue     += r.revenue || 0;
    cur.cost        += r.cost || 0;
    cur.clicks      += r.clicks || 0;
    cur.impressions += r.impressions || 0;
    map.set(key, cur);
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
    rows.push({
      channel: key,
      utmSource: (c || p)?.utmSource || '',
      utmMedium: (c || p)?.utmMedium || '',
      sessions: cSess, sessionsPrior: pSess, sessionsDelta: cSess - pSess, sessionsDeltaPct: pSess ? (cSess - pSess) / pSess : null,
      orders:   cOrd,  ordersPrior:   pOrd,  ordersDelta:   cOrd - pOrd,  ordersDeltaPct:   pOrd ? (cOrd - pOrd) / pOrd : null,
      revenue:  cRev,  revenuePrior:  pRev,  revenueDelta:  cRev - pRev,  revenueDeltaPct:  pRev ? (cRev - pRev) / pRev : null,
      isNew:      !!(c && !p),
      isGone:     !!(p && !c),
      cvr:        cSess > 0 ? cOrd / cSess : 0,
      cvrPrior:   pSess > 0 ? pOrd / pSess : 0,
      aov:        cOrd > 0 ? cRev / cOrd : 0,
      aovPrior:   pOrd > 0 ? pRev / pOrd : 0,
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
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
export function classifyChannels(compared = [], { minSessions = 50 } = {}) {
  const distressed = [];
  const opportunity = [];
  const emerging = [];
  const fading = [];
  const stable = [];

  for (const r of compared) {
    const hasVolume = (r.sessions >= minSessions || r.sessionsPrior >= minSessions || r.revenue > 500 || r.revenuePrior > 500);
    if (r.isNew && r.sessions >= 10) { emerging.push(r); continue; }
    if (r.isGone && r.sessionsPrior >= 20) { fading.push(r); continue; }
    if (!hasVolume) continue;

    // Distressed: revenue or sessions down >25% with prior volume
    const revDropPct = r.revenueDeltaPct;
    const sessDropPct = r.sessionsDeltaPct;
    if ((revDropPct != null && revDropPct <= -0.25) || (sessDropPct != null && sessDropPct <= -0.30)) {
      r.severity = revDropPct <= -0.5 ? 'critical' : revDropPct <= -0.35 ? 'high' : 'medium';
      r.reason = revDropPct != null && revDropPct <= -0.25
        ? `Revenue ${(revDropPct * 100).toFixed(0)}% DoD`
        : `Sessions ${(sessDropPct * 100).toFixed(0)}% DoD`;
      distressed.push(r);
      continue;
    }
    // Opportunity: revenue up >25% or sessions up >50% with scale
    if ((revDropPct != null && revDropPct >= 0.25) || (sessDropPct != null && sessDropPct >= 0.50)) {
      r.reason = revDropPct != null && revDropPct >= 0.25
        ? `Revenue +${(revDropPct * 100).toFixed(0)}% DoD`
        : `Sessions +${(sessDropPct * 100).toFixed(0)}% DoD`;
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
  const trends = channelTrends(sorted.slice(-14), { metric: 'revenue' });

  // Dataset totals
  const totals = { sessions: 0, orders: 0, revenue: 0 };
  for (const r of latestAgg.values()) {
    totals.sessions += r.sessions || 0;
    totals.orders   += r.orders || 0;
    totals.revenue  += r.revenue || 0;
  }
  const priorTotals = prior ? (() => {
    const p = aggregateByChannel(prior);
    const t = { sessions: 0, orders: 0, revenue: 0 };
    for (const r of p.values()) { t.sessions += r.sessions; t.orders += r.orders; t.revenue += r.revenue; }
    return t;
  })() : null;

  return {
    snapshots: sorted,
    latest,
    prior,
    compared,
    classified,
    trends,
    totals,
    priorTotals,
    totalsDelta: priorTotals ? {
      sessions: totals.sessions - priorTotals.sessions,
      orders:   totals.orders   - priorTotals.orders,
      revenue:  totals.revenue  - priorTotals.revenue,
      sessionsPct: priorTotals.sessions ? (totals.sessions - priorTotals.sessions) / priorTotals.sessions : null,
      ordersPct:   priorTotals.orders   ? (totals.orders   - priorTotals.orders)   / priorTotals.orders   : null,
      revenuePct:  priorTotals.revenue  ? (totals.revenue  - priorTotals.revenue)  / priorTotals.revenue  : null,
    } : null,
  };
}
