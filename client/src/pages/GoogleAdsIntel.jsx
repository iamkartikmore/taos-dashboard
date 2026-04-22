/**
 * Google Ads Intelligence — the 5-layer stack that distinguishes us from
 * the raw Ads UI:
 *   1. Anomaly-flagged daily grid (weekday z-scores + composite flags)
 *   2. Dimensional decomposition (what drove the move?)
 *   3. Change-event correlation (who/what changed?)
 *   4. Recommendation queue (concrete actions with impact estimates)
 *   5. Cross-system moat (margin ROAS, LTV-CAC, OOS, Meta×Google overlap)
 *
 * All heavy lifting lives in pure libs under client/src/lib/. This file
 * is orchestration + presentation only.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, TrendingUp, TrendingDown, Activity, Sparkles,
  Target, GitBranch, ShieldCheck, Brain, BarChart3, Calendar,
  ChevronRight, Download, X,
} from 'lucide-react';
import {
  LineChart, Line, Bar, BarChart, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceDot,
} from 'recharts';
import {
  rollDaily, scoreDailyAnomalies, compositeFlags,
  windowSummary, trend, METRIC_LABEL,
} from '../lib/googleAdsAnomalies';
import {
  decompose, splitContributors, partitionDaily,
  bucketSlices, DIMENSIONS,
} from '../lib/googleAdsDecomposition';
import { correlateAnomaly, changeTimeline, budgetCapped } from '../lib/googleAdsCorrelate';
import { generateRecommendations } from '../lib/googleAdsRecommendations';
import { runCrossSystem } from '../lib/googleAdsCrossSystem';

const cur  = v => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;
const num  = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct  = v => `${(Number(v || 0) * 100).toFixed(1)}%`;
const pct2 = v => `${(Number(v || 0) * 100).toFixed(2)}%`;
const dec  = (v, d = 2) => Number(v || 0).toFixed(d);

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10); }

/* ─── DATE PRESETS ─────────────────────────────────────────────────── */
const PRESETS = [
  { id: 'yesterday', label: 'Yesterday',  start: () => addDays(todayIso(), -1), end: () => addDays(todayIso(), -1) },
  { id: 'last_7d',   label: 'Last 7d',    start: () => addDays(todayIso(), -7), end: () => addDays(todayIso(), -1) },
  { id: 'last_14d',  label: 'Last 14d',   start: () => addDays(todayIso(), -14), end: () => addDays(todayIso(), -1) },
  { id: 'last_30d',  label: 'Last 30d',   start: () => addDays(todayIso(), -30), end: () => addDays(todayIso(), -1) },
  { id: 'mtd',       label: 'Month to date', start: () => todayIso().slice(0, 8) + '01', end: () => todayIso() },
  { id: 'last_month', label: 'Last month', start: () => { const d = new Date(); d.setUTCDate(0); return d.toISOString().slice(0, 8) + '01'; },
                                           end: () => { const d = new Date(); d.setUTCDate(0); return d.toISOString().slice(0, 10); } },
];

/* ─── SMALL PRIMITIVES ─────────────────────────────────────────────── */

function Card({ title, icon: Icon, children, right }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={14} className="text-amber-400" />}
            <h3 className="text-sm font-semibold text-white">{title}</h3>
          </div>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function KPI({ label, value, sub, color = '#f59e0b', trend: tr }) {
  const isPos = (tr ?? 0) > 0;
  const trendIcon = (tr == null || tr === 0) ? null
                  : isPos ? <TrendingUp size={10} className="text-emerald-400" />
                          : <TrendingDown size={10} className="text-rose-400" />;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
        {trendIcon} {sub}
      </div>
    </div>
  );
}

const SEV_COLOR = {
  alert: 'bg-rose-900/40 border-rose-600/40 text-rose-300',
  warn:  'bg-amber-900/30 border-amber-600/40 text-amber-200',
  normal: 'bg-gray-800 border-gray-700 text-slate-400',
  good:   'bg-emerald-900/30 border-emerald-600/40 text-emerald-200',
};

function Pill({ severity = 'normal', children }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${SEV_COLOR[severity]}`}>{children}</span>;
}

/* ─── MAIN ─────────────────────────────────────────────────────────── */

export default function GoogleAdsIntel({ data, brand, orders, inventoryBySku, monthlyTarget, skuMargin, defaultMarginPct }) {
  const [presetId, setPresetId] = useState('last_14d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [dimension, setDimension] = useState('campaign');
  const [focusMetric, setFocusMetric] = useState('cpa');
  const [selectedDay, setSelectedDay] = useState(null);
  const [dismissedRecs, setDismissedRecs] = useState(new Set());
  const [recFilter, setRecFilter] = useState('all');

  const preset = PRESETS.find(p => p.id === presetId);
  const dateRange = useMemo(() => {
    if (presetId === 'custom') return { start: customStart || addDays(todayIso(), -14), end: customEnd || addDays(todayIso(), -1) };
    return { start: preset.start(), end: preset.end() };
  }, [presetId, preset, customStart, customEnd]);

  if (!data?.campaignsDaily?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
        <Brain size={40} className="opacity-30" />
        <p className="text-sm">No daily data yet — pull the last 30 days to unlock intelligence.</p>
      </div>
    );
  }

  /* ── Layer 1: anomalies ─────────────────────────────────────────── */
  const daily = useMemo(() => rollDaily(data.campaignsDaily), [data]);
  const scored = useMemo(() => scoreDailyAnomalies(daily, { baselineDays: 28 }), [daily]);

  /* Scoped to selected date range */
  const inRange = useMemo(
    () => scored.filter(s => s.date >= dateRange.start && s.date <= dateRange.end),
    [scored, dateRange]);

  const windowStats = useMemo(() => windowSummary(daily, dateRange.start, dateRange.end), [daily, dateRange]);

  /* ── Layer 2: decomposition for selected day (or whole window) ─── */
  const dimSpec = DIMENSIONS[dimension];

  const decompSource = useMemo(() => {
    if (selectedDay) {
      // Compare the selected day to the average of the preceding 7 days
      const idx = daily.findIndex(d => d.date === selectedDay);
      if (idx < 0) return null;
      const priorWindow = daily.slice(Math.max(0, idx - 7), idx);
      const curRows = data.campaignsDaily.filter(r => r.date === selectedDay);
      const prDates = new Set(priorWindow.map(d => d.date));
      const prRows  = data.campaignsDaily.filter(r => prDates.has(r.date));
      return { cur: dimSpec.fromDaily ? dimSpec.fromDaily(curRows) : [], prior: dimSpec.fromDaily ? dimSpec.fromDaily(prRows) : [] };
    }
    // Whole window vs prior window
    const { current, prior } = partitionDaily(data.campaignsDaily, dateRange.start, dateRange.end);
    if (dimSpec.fromDaily) {
      return { cur: dimSpec.fromDaily(current), prior: dimSpec.fromDaily(prior) };
    }
    // Non-date-segmented dimensions: we only have aggregate for the window.
    // Decomp degenerates to "show current slices sorted by size".
    const flat = dimension === 'adGroup'   ? data.adGroups
              : dimension === 'ad'         ? data.ads
              : dimension === 'keyword'    ? data.keywords
              : dimension === 'searchTerm' ? data.searchTerms
              : dimension === 'device'     ? data.devices
              : dimension === 'hour'       ? data.hours?.byHour
              : dimension === 'product'    ? data.shopping
              : [];
    return { cur: dimSpec.fromFlat ? dimSpec.fromFlat(flat || []) : [], prior: [] };
  }, [data, dimension, dimSpec, selectedDay, daily, dateRange]);

  const decomposed = useMemo(() => {
    if (!decompSource) return null;
    return decompose(decompSource.cur, decompSource.prior, focusMetric);
  }, [decompSource, focusMetric]);

  const contributors = useMemo(() => decomposed ? splitContributors(decomposed, focusMetric) : null, [decomposed, focusMetric]);

  /* ── Layer 3: change-event correlation ──────────────────────────── */
  const timeline = useMemo(() => changeTimeline(data.changeEvents || []), [data]);
  const correlation = useMemo(() => {
    if (!selectedDay) return null;
    return correlateAnomaly({ day: selectedDay, events: data.changeEvents, decomposed });
  }, [selectedDay, data, decomposed]);
  const budgetCaps = useMemo(
    () => budgetCapped(data.campaignsDaily, data.budgets),
    [data]);

  /* ── Layer 4: recommendations ───────────────────────────────────── */
  const recs = useMemo(() => generateRecommendations(data), [data]);
  const visibleRecs = useMemo(
    () => recs.all.filter(r => !dismissedRecs.has(r.id))
               .filter(r => recFilter === 'all' || r.type === recFilter),
    [recs, dismissedRecs, recFilter]);

  /* ── Layer 5: cross-system ──────────────────────────────────────── */
  const cross = useMemo(
    () => runCrossSystem({
      googleAds: data, orders, inventoryBySku,
      brandName: brand?.name, monthlyTarget, skuMargin, defaultMarginPct,
    }),
    [data, orders, inventoryBySku, brand, monthlyTarget, skuMargin, defaultMarginPct]);

  /* ── Derived totals for the summary card ───────────────────────── */
  const anomalyDays = inRange.filter(d => {
    const flags = compositeFlags(d);
    return flags.some(f => f.severity === 'alert' || f.severity === 'warn');
  });

  /* ─── RENDER ─────────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Date range selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <Calendar size={14} className="text-slate-500 ml-2" />
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPresetId(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${presetId === p.id ? 'bg-amber-600/30 text-amber-300 ring-1 ring-amber-500/40' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800'}`}>
            {p.label}
          </button>
        ))}
        <button onClick={() => setPresetId('custom')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${presetId === 'custom' ? 'bg-amber-600/30 text-amber-300 ring-1 ring-amber-500/40' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800'}`}>
          Custom
        </button>
        {presetId === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200" />
            <span className="text-slate-500 text-xs">→</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200" />
          </div>
        )}
        <span className="text-xs text-slate-500 ml-auto mr-2">
          {dateRange.start} → {dateRange.end} · {windowStats.spanDays}d
        </span>
      </div>

      {/* Window summary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <KPI label="Spend"      value={cur(windowStats.current.cost)}      sub={`vs ${cur(windowStats.prior.cost)} prior`}      trend={windowStats.delta.cost?.pct} />
        <KPI label="Conv"       value={dec(windowStats.current.conversions, 1)} sub={`${pct(windowStats.delta.conversions?.pct ?? 0)} WoW`}  trend={windowStats.delta.conversions?.pct} />
        <KPI label="Revenue"    value={cur(windowStats.current.conversionValue)} sub={`${pct(windowStats.delta.conversionValue?.pct ?? 0)} WoW`} trend={windowStats.delta.conversionValue?.pct} color="#22c55e" />
        <KPI label="ROAS"       value={dec(windowStats.current.roas, 2)}   sub={`prior ${dec(windowStats.prior.roas, 2)}`}      trend={windowStats.delta.roas?.pct} color="#22c55e" />
        <KPI label="CPA"        value={cur(windowStats.current.cpa)}       sub={`prior ${cur(windowStats.prior.cpa)}`}          trend={-(windowStats.delta.cpa?.pct ?? 0)} color="#f472b6" />
        <KPI label="Anomalies"  value={anomalyDays.length}                 sub={`days flagged in window`} color="#fb923c" />
      </div>

      {/* ── LAYER 1: Daily grid ──────────────────────────────────── */}
      <Card title="Daily Grid · anomalies flagged vs weekday baseline" icon={Activity}>
        <DailyGrid scored={inRange} selectedDay={selectedDay} onSelect={setSelectedDay} />
      </Card>

      {/* Selected day inspector */}
      {selectedDay && (
        <SelectedDayPanel
          day={selectedDay} onClose={() => setSelectedDay(null)}
          scored={inRange.find(d => d.date === selectedDay)}
          decomposed={decomposed} contributors={contributors}
          correlation={correlation} budgetCaps={budgetCaps}
          dimension={dimension} setDimension={setDimension}
          focusMetric={focusMetric} setFocusMetric={setFocusMetric}
        />
      )}

      {/* ── LAYER 2: window-scope decomposition (when no day selected) ─ */}
      {!selectedDay && decomposed && (
        <Card
          title={`Where did the ${METRIC_LABEL[focusMetric] || focusMetric} move come from?`}
          icon={GitBranch}
          right={
            <div className="flex items-center gap-2">
              <select value={dimension} onChange={e => setDimension(e.target.value)}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200">
                {Object.entries(DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={focusMetric} onChange={e => setFocusMetric(e.target.value)}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200">
                {['cost', 'conversions', 'conversionValue', 'cpa', 'roas', 'ctr', 'convRate', 'aov'].map(m =>
                  <option key={m} value={m}>{METRIC_LABEL[m] || m}</option>)}
              </select>
            </div>
          }
        >
          <DecompositionPanel decomposed={decomposed} contributors={contributors} metric={focusMetric} />
        </Card>
      )}

      {/* ── LAYER 3: recent change events ────────────────────────── */}
      {timeline.length > 0 && (
        <Card title={`Recent setting changes · ${timeline.length}`} icon={Calendar}>
          <ChangeTimeline events={timeline.slice(0, 50)} />
        </Card>
      )}

      {/* ── LAYER 4: recommendation queue ───────────────────────── */}
      <Card
        title="Recommended actions"
        icon={Sparkles}
        right={
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Save</span>
            <span className="text-emerald-300 font-bold">{cur(recs.summary?.savings)}</span>
            <span className="text-slate-500">· Gain</span>
            <span className="text-amber-300 font-bold">{cur(recs.summary?.upside)}</span>
            <select value={recFilter} onChange={e => setRecFilter(e.target.value)}
              className="ml-3 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-[11px]">
              <option value="all">All types</option>
              {Object.keys(recs.byType || {}).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        }
      >
        <RecommendationList recs={visibleRecs} onDismiss={id => setDismissedRecs(prev => new Set([...prev, id]))} />
      </Card>

      {/* ── LAYER 5: cross-system moat ──────────────────────────── */}
      <CrossSystemPanel cross={cross} brand={brand} />
    </div>
  );
}

/* ─── DAILY GRID ───────────────────────────────────────────────────── */

function DailyGrid({ scored, selectedDay, onSelect }) {
  if (!scored?.length) return <div className="text-xs text-slate-500">No days in range.</div>;
  // Compact grid: one row per day with mini heatmap of metric z-scores
  const METRICS = ['cost', 'clicks', 'conversions', 'conversionValue', 'ctr', 'cpa', 'roas'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-gray-800 text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Flags</th>
            {METRICS.map(m => <th key={m} className="px-2 py-2 text-right">{METRIC_LABEL[m]}</th>)}
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {scored.map(d => {
            const flags = compositeFlags(d);
            const hasAlert = flags.some(f => f.severity === 'alert');
            const hasWarn  = flags.some(f => f.severity === 'warn');
            const tone = hasAlert ? 'bg-rose-950/30'
                       : hasWarn  ? 'bg-amber-950/20'
                       : '';
            const isSel = d.date === selectedDay;
            return (
              <tr key={d.date}
                  onClick={() => onSelect(d.date === selectedDay ? null : d.date)}
                  className={`cursor-pointer hover:bg-gray-800/60 ${tone} ${isSel ? 'outline outline-1 outline-amber-500/50' : ''}`}>
                <td className="px-3 py-2 text-slate-300 font-mono">{d.date}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {flags.length === 0 && <span className="text-slate-600 italic text-[10px]">normal</span>}
                    {flags.map(f => (
                      <Pill key={f.id} severity={f.severity === 'alert' ? 'alert' : f.severity === 'warn' ? 'warn' : 'normal'}>
                        {f.title}
                      </Pill>
                    ))}
                  </div>
                </td>
                {METRICS.map(m => {
                  const ms = d.metrics[m];
                  if (!ms) return <td key={m} className="px-2 py-2 text-right text-slate-600">—</td>;
                  const z = ms.z || 0;
                  const color = ms.severity === 'normal' ? 'text-slate-400'
                              : ms.direction === 'bad'   ? 'text-rose-400 font-bold'
                              : ms.direction === 'good'  ? 'text-emerald-400 font-semibold'
                              : 'text-slate-300';
                  const val = m === 'cost' || m === 'conversionValue' ? cur(ms.value)
                            : m === 'ctr' || m === 'convRate'         ? pct2(ms.value)
                            : m === 'roas'                             ? dec(ms.value, 2)
                            : m === 'cpa'                              ? cur(ms.value)
                            : num(ms.value);
                  return (
                    <td key={m} className={`px-2 py-2 text-right font-mono ${color}`} title={`z=${dec(z, 2)}σ · expected ${ms.expected != null ? dec(ms.expected, 2) : '—'}`}>
                      {val}
                      {Math.abs(z) >= 1.5 && (
                        <span className="text-[9px] ml-1 opacity-80">
                          {z > 0 ? '↑' : '↓'}{dec(Math.abs(z), 1)}σ
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2"><ChevronRight size={12} className="text-slate-600" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── SELECTED-DAY PANEL ───────────────────────────────────────────── */

function SelectedDayPanel({ day, onClose, scored, decomposed, contributors, correlation, budgetCaps, dimension, setDimension, focusMetric, setFocusMetric }) {
  const flags = scored ? compositeFlags(scored) : [];
  return (
    <Card
      title={`Inspect · ${day}`}
      icon={AlertTriangle}
      right={<button onClick={onClose} className="text-slate-500 hover:text-white"><X size={14} /></button>}
    >
      {flags.length > 0 && (
        <div className="mb-4 space-y-2">
          {flags.map(f => (
            <div key={f.id} className={`px-3 py-2 rounded-lg border flex items-start gap-2 ${SEV_COLOR[f.severity] || SEV_COLOR.normal}`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="text-xs">
                <div className="font-semibold mb-0.5">{f.title}</div>
                <div className="opacity-90 leading-relaxed">{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-slate-500">Decompose by</span>
        <select value={dimension} onChange={e => setDimension(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200">
          {Object.entries(DIMENSIONS).filter(([k, v]) => v.fromDaily).map(([k, v]) =>
            <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 ml-2">Metric</span>
        <select value={focusMetric} onChange={e => setFocusMetric(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200">
          {['cost', 'conversions', 'conversionValue', 'cpa', 'roas', 'ctr'].map(m =>
            <option key={m} value={m}>{METRIC_LABEL[m] || m}</option>)}
        </select>
      </div>

      {decomposed && <DecompositionPanel decomposed={decomposed} contributors={contributors} metric={focusMetric} compact />}

      {correlation && correlation.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Likely causes (change events)</div>
          <div className="space-y-1.5">
            {correlation.slice(0, 6).map((c, i) => (
              <div key={i} className="px-3 py-2 bg-gray-800/60 rounded text-xs flex items-center gap-2 border border-gray-800">
                <GitBranch size={12} className="text-amber-400 shrink-0" />
                <div className="flex-1">
                  <div className="text-slate-200">{c.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {c.ts} · lag {c.lag}d · score {c.score}{c.campaignMatch ? ' · matches key slice' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {budgetCaps?.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Budget-capped candidates</div>
          <div className="space-y-1.5">
            {budgetCaps.slice(0, 5).map(b => (
              <div key={b.budgetId} className="px-3 py-2 bg-amber-950/20 border border-amber-700/30 rounded text-xs">
                <div className="font-semibold text-amber-200">{b.budgetName}</div>
                <div className="text-slate-400 mt-0.5">{b.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─── DECOMPOSITION PANEL ──────────────────────────────────────────── */

function DecompositionPanel({ decomposed, contributors, metric, compact }) {
  const top = contributors?.bad?.slice(0, compact ? 5 : 10) || [];
  const win = contributors?.good?.slice(0, compact ? 5 : 10) || [];
  const fmt = (v) => {
    if (['cost', 'conversionValue', 'cpa', 'aov', 'cpc'].includes(metric)) return cur(v);
    if (['ctr', 'convRate'].includes(metric)) return pct2(v);
    if (metric === 'roas') return dec(v, 2);
    return num(v);
  };
  const d = decomposed?.totals?.delta ?? 0;
  const p = decomposed?.totals?.pct ?? 0;
  const dirText = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';

  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-3">
        Overall {METRIC_LABEL[metric] || metric} moved <b className={d > 0 ? 'text-rose-300' : 'text-emerald-300'}>{dirText} {fmt(Math.abs(d))}</b>
        {' '}({pct(p)}) · prior {fmt(decomposed?.totals?.priorAgg?.[metric])} → current {fmt(decomposed?.totals?.currentAgg?.[metric])}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] text-rose-400 font-semibold mb-2">Hurt most</div>
          <ContribTable slices={top} metric={metric} fmt={fmt} tone="bad" />
        </div>
        <div>
          <div className="text-[11px] text-emerald-400 font-semibold mb-2">Helped most</div>
          <ContribTable slices={win} metric={metric} fmt={fmt} tone="good" />
        </div>
      </div>
    </div>
  );
}

function ContribTable({ slices, metric, fmt, tone }) {
  if (!slices.length) return <div className="text-xs text-slate-600 italic">No meaningful contributors.</div>;
  const maxShare = Math.max(...slices.map(s => s.shareAbs), 0.001);
  return (
    <div className="space-y-1.5">
      {slices.map(s => (
        <div key={s.sliceKey} className="px-3 py-2 bg-gray-800/50 border border-gray-800 rounded">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="truncate flex-1 text-slate-200" title={s.sliceLabel}>{s.sliceLabel || '—'}</div>
            <div className={`font-mono font-bold ${tone === 'bad' ? 'text-rose-300' : 'text-emerald-300'}`}>
              {pct(s.shareAbs)} of move
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
            <div className="flex-1 h-1 bg-gray-800 rounded overflow-hidden">
              <div className={tone === 'bad' ? 'bg-rose-500' : 'bg-emerald-500'} style={{ width: `${(s.shareAbs / maxShare) * 100}%`, height: '100%' }} />
            </div>
            <span>{fmt(s.prior)} → {fmt(s.current)}</span>
            <span className="text-slate-600">·</span>
            <span>cost {cur(s.curCost)} / conv {dec(s.curConv, 1)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── CHANGE TIMELINE ──────────────────────────────────────────────── */

function ChangeTimeline({ events }) {
  if (!events?.length) return <div className="text-xs text-slate-500">No events in window.</div>;
  return (
    <div className="max-h-[320px] overflow-y-auto divide-y divide-gray-800">
      {events.map((e, i) => (
        <div key={i} className="py-2 flex items-center gap-3 text-xs">
          <span className="font-mono text-slate-500 w-[120px] shrink-0">{e.day} {e.hour}</span>
          <span className="text-slate-400 shrink-0 w-[180px] truncate">{(e.resourceType || '').replace(/_/g, ' ')}</span>
          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${
            e.operation === 'CREATE' ? 'bg-emerald-900/40 text-emerald-300' :
            e.operation === 'REMOVE' ? 'bg-rose-900/40 text-rose-300' :
                                        'bg-amber-900/30 text-amber-300'}`}>
            {e.operation}
          </span>
          <span className="text-slate-600 shrink-0 w-[180px] truncate">{e.fields}</span>
          <span className="text-slate-500 truncate">{e.who}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── RECOMMENDATION LIST ──────────────────────────────────────────── */

function RecommendationList({ recs, onDismiss }) {
  if (!recs?.length) return <div className="text-xs text-slate-500 italic py-4 text-center">Nothing actionable — or you've dismissed everything.</div>;
  return (
    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
      {recs.map(r => <RecRow key={r.id} rec={r} onDismiss={onDismiss} />)}
    </div>
  );
}

function RecRow({ rec, onDismiss }) {
  const [open, setOpen] = useState(false);
  const sevBadge =
    rec.severity === 'high'   ? <Pill severity="alert">high impact</Pill> :
    rec.severity === 'medium' ? <Pill severity="warn">medium</Pill> :
                                 <Pill severity="normal">low</Pill>;
  const typeColor =
    rec.type.startsWith('pause') || rec.type === 'negative_keyword' || rec.type === 'bid_down' ? 'text-rose-400' :
    rec.type === 'bid_up' || rec.type === 'expand_keyword' || rec.type === 'budget_shift' ? 'text-emerald-400' :
    'text-amber-400';
  return (
    <div className="bg-gray-800/40 border border-gray-800 rounded-lg">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`shrink-0 text-[10px] font-bold uppercase ${typeColor}`}>{rec.type.replace(/_/g, ' ')}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {sevBadge}
            <div className="text-xs font-semibold text-white truncate">{rec.title}</div>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{rec.explanation}</div>
          {open && (
            <div className="mt-2 p-2 bg-gray-900/60 rounded text-[11px] text-slate-300 leading-relaxed border border-gray-800">
              <div className="text-amber-300 mb-1 font-semibold">Action</div>
              {rec.action}
              <pre className="mt-2 text-[10px] text-slate-500 whitespace-pre-wrap">{JSON.stringify(rec.evidence, null, 2)}</pre>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-bold text-emerald-300">{cur(rec.impactRs)}</div>
          <div className="text-[10px] text-slate-500">est. /{['bid_up', 'expand_keyword', 'budget_shift'].includes(rec.type) ? 'mo gain' : 'mo save'}</div>
          <div className="flex gap-1 mt-1">
            <button onClick={() => setOpen(o => !o)} className="text-[10px] text-slate-400 hover:text-white">{open ? 'hide' : 'details'}</button>
            <button onClick={() => onDismiss(rec.id)} className="text-[10px] text-slate-500 hover:text-rose-300">dismiss</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── CROSS-SYSTEM PANEL ───────────────────────────────────────────── */

function CrossSystemPanel({ cross, brand }) {
  if (!cross) return null;
  const has = (k) => cross[k] != null;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-white mt-6">
        <ShieldCheck size={16} className="text-amber-400" />
        Cross-system intelligence
      </div>

      {has('cacVsLtv') && cross.cacVsLtv.customers > 0 && (
        <Card title={`True CAC vs LTV · ${cross.ltvCohort.horizonDays}d horizon`} icon={Target}>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <KPI label="Google-acquired" value={num(cross.cacVsLtv.customers)} sub="customers" />
            <KPI label="True CAC"   value={cur(cross.cacVsLtv.cac)} sub="spend / acquisitions" color="#f472b6" />
            <KPI label="Avg LTV"    value={cur(cross.cacVsLtv.avgLtv)} sub={`${cross.ltvCohort.horizonDays}d revenue`} color="#22c55e" />
            <KPI label="LTV / CAC"  value={dec(cross.cacVsLtv.ltvCacRatio, 2)} sub={cross.cacVsLtv.verdict} color={cross.cacVsLtv.ltvCacRatio >= 3 ? '#22c55e' : cross.cacVsLtv.ltvCacRatio >= 1 ? '#f59e0b' : '#f43f5e'} />
            <KPI label="Repeat rate" value={dec(cross.ltvCohort.avgOrdersPerCustomer, 2)} sub="orders / customer" />
          </div>
        </Card>
      )}

      {has('marginCampaigns') && cross.marginCampaigns?.length > 0 && (
        <Card title="Margin-weighted ROAS · top vs bottom" icon={BarChart3}
          right={<span className="text-[10px] text-slate-500">assumes {pct(cross.marginCampaigns[0]?.marginPct ?? 0.25)} blended margin</span>}>
          <div className="grid grid-cols-2 gap-4">
            <MarginTable rows={[...cross.marginCampaigns].filter(c => c.cost > 0).sort((a, b) => b.netProfit - a.netProfit).slice(0, 6)} tone="good" />
            <MarginTable rows={[...cross.marginCampaigns].filter(c => c.cost > 0).sort((a, b) => a.netProfit - b.netProfit).slice(0, 6)} tone="bad" />
          </div>
        </Card>
      )}

      {has('oosFlags') && cross.oosFlags?.length > 0 && (
        <Card title={`Out-of-stock kill-switch · ${cross.oosFlags.length} flagged`} icon={AlertTriangle}>
          <div className="space-y-2">
            {cross.oosFlags.slice(0, 10).map(f => (
              <div key={f.productId} className={`px-4 py-3 border rounded flex items-center gap-3 ${f.severity === 'critical' ? 'bg-rose-950/30 border-rose-600/40' : 'bg-amber-950/20 border-amber-600/40'}`}>
                <AlertTriangle size={14} className={f.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{f.productTitle}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{f.action}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-300">{cur(f.spend)}</div>
                  <div className="text-[10px] text-slate-500">stock {f.inventory}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {has('overlap') && cross.overlap.customers > 0 && (
        <Card title="Meta × Google overlap" icon={GitBranch}>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <KPI label="Customers touched" value={num(cross.overlap.googleOnly + cross.overlap.metaOnly + cross.overlap.both)} sub={`of ${num(cross.overlap.customers)} total`} />
            <KPI label="Google only" value={num(cross.overlap.googleOnly)} sub={cur(cross.overlap.googleOnlyRev)} color="#3b82f6" />
            <KPI label="Meta only"   value={num(cross.overlap.metaOnly)}   sub={cur(cross.overlap.metaOnlyRev)}   color="#f472b6" />
            <KPI label="Both"        value={num(cross.overlap.both)}       sub={cur(cross.overlap.bothRev)}       color="#a78bfa" />
            <KPI label="Overlap"     value={pct(cross.overlap.overlapPct)} sub={cross.overlap.incrementality.verdict} color="#f59e0b" />
          </div>
        </Card>
      )}

      {has('brandCannibal') && cross.brandCannibal && (
        <Card title="Brand-keyword cannibalisation" icon={Target}>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KPI label="Branded spend"    value={cur(cross.brandCannibal.spend)}               sub={`${cross.brandCannibal.keywordCount} keywords`} />
            <KPI label="Branded revenue"  value={cur(cross.brandCannibal.revenue)}             sub={`${dec(cross.brandCannibal.conversions, 0)} conv`} color="#22c55e" />
            <KPI label="Cannibalised (est)" value={cur(cross.brandCannibal.estimatedCannibalised)} sub="saveable via organic" color="#f472b6" />
            <KPI label="Verdict"          value={cross.brandCannibal.verdict.split('—')[0]}    sub={cross.brandCannibal.verdict.split('—')[1] || ''} color="#f59e0b" />
          </div>
        </Card>
      )}

      {has('pacing') && cross.pacing && (
        <Card title="Spend pacing" icon={Activity}>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <KPI label="MTD spend"   value={cur(cross.pacing.mtdSpend)}  sub={`day ${cross.pacing.dayOfMonth}/${cross.pacing.daysInMonth}`} />
            <KPI label="Avg daily"   value={cur(cross.pacing.avgDaily)}  sub="MTD" />
            <KPI label="Projected EOM" value={cur(cross.pacing.projected)} sub="linear extrapolation" color="#f59e0b" />
            <KPI label="Monthly target" value={cross.pacing.monthlyTarget ? cur(cross.pacing.monthlyTarget) : '—'} sub={cross.pacing.verdict || 'no target set'} color="#22c55e" />
            <KPI label="Pace delta"  value={cross.pacing.pacePct == null ? '—' : pct(cross.pacing.pacePct)} sub="vs target" color={(cross.pacing.pacePct ?? 0) > 0 ? '#f43f5e' : '#22c55e'} />
          </div>
        </Card>
      )}
    </div>
  );
}

function MarginTable({ rows, tone }) {
  if (!rows?.length) return <div className="text-xs text-slate-600 italic">No rows.</div>;
  return (
    <div className="space-y-1.5">
      <div className={`text-[11px] font-semibold ${tone === 'good' ? 'text-emerald-400' : 'text-rose-400'}`}>
        {tone === 'good' ? 'Most profitable' : 'Bleeding profit'}
      </div>
      {rows.map(r => (
        <div key={r.id} className="px-3 py-2 bg-gray-800/50 border border-gray-800 rounded">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="truncate flex-1 text-slate-200" title={r.name}>{r.name}</div>
            <div className={`font-mono font-bold ${r.netProfit > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{cur(r.netProfit)}</div>
          </div>
          <div className="mt-1 text-[10px] text-slate-500 flex gap-2">
            <span>spend {cur(r.cost)}</span>
            <span>·</span>
            <span>rev {cur(r.conversionValue)}</span>
            <span>·</span>
            <span>margin-ROAS {dec(r.marginRoas, 2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
