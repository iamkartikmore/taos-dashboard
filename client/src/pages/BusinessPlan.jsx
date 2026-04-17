import { useMemo, useState, useCallback, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import {
  Zap, TrendingUp, Target, Package, Building2, Wallet, Map,
  Plus, Trash2, Edit2, Check, X, AlertTriangle, CheckCircle,
  ArrowUp, ArrowDown, Minus, RefreshCw, ChevronRight, ChevronDown,
  Download, Users, Star, ShoppingCart, Flame, BarChart3, BookOpen,
  Calendar, Truck, ClipboardList, Upload, Play, Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders } from '../lib/api';
import {
  DEFAULT_PLAN, STAGES, detectGrowthStage,
  buildPlanVsActual, buildWeeklyBreakdown, buildMarketingNeeds,
  buildInventoryNeeds, buildWorkingCapital, buildPredictions,
  buildAdvancedPredictions, buildSeasonality, buildCohortMetrics,
  buildCreativeStrategy, buildProcurementPlan, buildStageRoadmap,
  buildCollectionsFromMeta, filterOrdersByPeriod, parseOrdersCsv,
  downloadCsv, fmtRs, fmtK,
} from '../lib/businessPlanAnalytics';

const LS_KEY = 'taos_bplan_v2';
const ls = {
  get:  fb  => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : fb; } catch { return fb; } },
  set:  v   => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {} },
};

const fmtPct = n => `${(parseFloat(n) || 0).toFixed(1)}%`;
const fmtN   = n => { const v = parseFloat(n) || 0; return v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(Math.round(v)); };

/* ─── SHARED COMPONENTS ──────────────────────────────────────────────── */
function DeltaBadge({ value, inverse = false }) {
  const n = parseFloat(value) || 0;
  const good = inverse ? n < 0 : n > 0;
  const cls  = n === 0 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400';
  const Icon = n === 0 ? Minus : n > 0 ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${cls}`}><Icon size={10}/>{Math.abs(n).toFixed(1)}%</span>;
}

function KpiCard({ label, value, sub, delta, inverse, cls = '', warn, accent }) {
  return (
    <div className={clsx('bg-gray-900/60 rounded-xl border px-4 py-3', warn ? 'border-red-800/40' : accent ? 'border-brand-700/40' : 'border-gray-800/50')}>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className={clsx('text-xl font-bold', cls || 'text-white')}>{value}</div>
      {(sub || delta != null) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub  && <span className="text-[10px] text-slate-600">{sub}</span>}
          {delta != null && <DeltaBadge value={delta} inverse={inverse}/>}
        </div>
      )}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[130px]">
      <div className="text-slate-400 mb-1.5 font-medium">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-semibold">
            {typeof p.value === 'number' && p.value > 10000 ? fmtRs(p.value) : fmtK(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StageBadge({ stage, size = 'md' }) {
  if (!stage) return null;
  const sm = size === 'sm';
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-bold border',
      sm ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs')}
      style={{ background: stage.color + '20', borderColor: stage.color + '50', color: stage.color }}>
      {stage.badge} {stage.name}
    </span>
  );
}

const STATUS_STYLE = {
  'on-track': { pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30', dot: 'bg-emerald-400', label: 'On Track' },
  behind:     { pill: 'bg-amber-500/15  text-amber-400  border-amber-800/30',     dot: 'bg-amber-400',   label: 'Behind' },
  critical:   { pill: 'bg-red-500/15    text-red-400    border-red-800/30',        dot: 'bg-red-400',     label: 'Critical' },
  missed:     { pill: 'bg-red-900/30    text-red-300    border-red-800/30',        dot: 'bg-red-400',     label: 'Missed' },
  future:     { pill: 'bg-gray-800      text-slate-400  border-gray-700/40',       dot: 'bg-gray-600',    label: 'Upcoming' },
};

const INV_STATUS = {
  oos:      { pill: 'bg-red-900/30    text-red-300    border-red-800/40',     label: 'OOS',      color: '#ef4444' },
  critical: { pill: 'bg-red-500/15    text-red-400    border-red-800/30',     label: 'Critical', color: '#f87171' },
  low:      { pill: 'bg-amber-500/15  text-amber-400  border-amber-800/30',   label: 'Low',      color: '#f59e0b' },
  watch:    { pill: 'bg-yellow-500/10 text-yellow-400 border-yellow-800/30',  label: 'Watch',    color: '#eab308' },
  ok:       { pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-800/30', label: 'OK',     color: '#22c55e' },
};

const COLL_COLORS = { plants: '#22c55e', seeds: '#f59e0b', allMix: '#818cf8' };
const PRIORITY_STYLE = {
  URGENT: 'bg-red-900/30 text-red-300 border-red-800/40',
  HIGH:   'bg-amber-500/15 text-amber-400 border-amber-800/30',
  MEDIUM: 'bg-yellow-500/10 text-yellow-400 border-yellow-800/20',
  LOW:    'bg-gray-800 text-slate-500 border-gray-700/30',
};

/* ─── TABS ────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'command',     label: 'Command',         icon: Zap },
  { id: 'predictions', label: 'Predictions',     icon: TrendingUp },
  { id: 'roadmap',     label: 'Stage Roadmap',   icon: Map },
  { id: 'revenue',     label: 'Revenue Plan',    icon: BarChart3 },
  { id: 'marketing',   label: 'Creative Intel',  icon: Flame },
  { id: 'procurement', label: 'Procurement',     icon: ShoppingCart },
  { id: 'warehouse',   label: 'Warehouses',      icon: Building2 },
  { id: 'capital',     label: 'Working Capital', icon: Wallet },
  { id: 'export',      label: 'Export & Notes',  icon: Download },
];

/* ─── TAB: COMMAND CENTER ─────────────────────────────────────────────── */
function TabCommand({ plan, pva, predictions, shopifyOrders, stage }) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const current = pva.find(m => m.key === currentKey);

  const chartData = pva.map(m => ({
    label: m.label.slice(0, 3),
    Plan:      Math.round(m.planRevenue),
    Actual:    m.isPast      ? Math.round(m.actualRevenue)    : null,
    Projected: m.isCurrentMonth ? Math.round(m.projectedRevenue) : null,
  }));

  const alerts = [];
  pva.forEach(m => {
    if (m.status === 'critical' || m.status === 'missed')
      alerts.push({ type: 'error', msg: `${m.label}: ${m.status === 'missed' ? 'missed target' : 'critical — ' + fmtPct(m.projPct) + ' of plan'}`, key: m.key });
    else if (m.status === 'behind')
      alerts.push({ type: 'warn',  msg: `${m.label}: behind at ${fmtPct(m.projPct)} of target`, key: m.key });
  });

  return (
    <div className="space-y-6">
      {/* Stage + priorities */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center gap-3 mb-3">
          <StageBadge stage={stage}/>
          <span className="text-xs text-slate-400">{stage?.description}</span>
        </div>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Top Priorities for This Stage</div>
        <div className="space-y-1.5">
          {(stage?.priorities || []).slice(0, 5).map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
              <span className="w-4 h-4 rounded-full bg-brand-600/30 text-brand-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
              {p}
            </div>
          ))}
        </div>
      </div>

      {/* Current month KPIs */}
      {current ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-300">{current.label} — Live Progress</span>
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', STATUS_STYLE[current.status]?.pill)}>
              <span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1', STATUS_STYLE[current.status]?.dot)}/>
              {STATUS_STYLE[current.status]?.label}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Orders/Day (Actual)" value={current.actualOrdPerDay.toFixed(0)} sub={`Target: ${current.ordersPerDay}/day`} delta={current.actualOrdPerDay > 0 ? ((current.actualOrdPerDay - current.ordersPerDay) / current.ordersPerDay * 100) : null}/>
            <KpiCard label="Revenue To Date" value={fmtRs(current.actualRevenue)} sub={`Plan: ${fmtRs(current.planRevenue)}`}/>
            <KpiCard label="EOM Projection" value={fmtRs(current.projectedRevenue)} sub={`Gap: ${fmtRs(Math.abs(current.gap))}`} cls={current.gap <= 0 ? 'text-emerald-400' : 'text-amber-400'}/>
            <KpiCard label="Days Remaining" value={`${current.daysRemaining}d`} sub={`${current.daysElapsed}d elapsed of ${current.days}`}/>
          </div>
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-400">Month Completion</span>
              <span className="text-xs font-bold text-white">{fmtPct(current.projPct)}</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all', current.projPct >= 95 ? 'bg-emerald-500' : current.projPct >= 75 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${Math.min(current.projPct, 100)}%` }}/>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-600">{fmtRs(current.projectedRevenue)} projected</span>
              <span className="text-[10px] text-slate-600">{fmtRs(current.planRevenue)} target</span>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-6 text-center text-slate-500 text-sm">No plan data for current month.</div>
      )}

      {/* Trend engine */}
      {predictions.avg7 > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Trend Engine</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="text-center"><div className="text-[10px] text-slate-500 mb-0.5">7-Day Avg</div><div className="text-lg font-bold text-white">{predictions.avg7}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-500 mb-0.5">Trend</div><div className="text-sm font-bold" style={{ color: predictions.trendColor }}>{predictions.trendLabel}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-500 mb-0.5">EOM Projection</div><div className="text-lg font-bold text-white">{fmtK(predictions.eomOrders)}</div><div className="text-[10px] text-slate-500">{fmtRs(predictions.eomRevenue)}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-500 mb-0.5">vs Plan</div><div className={clsx('text-lg font-bold', predictions.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{predictions.gapPct >= 0 ? '+' : ''}{predictions.gapPct}%</div></div>
          </div>
          {predictions.recentDays.length > 0 && (
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={predictions.recentDays}>
                <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#818cf8" stopOpacity={0.3}/><stop offset="100%" stopColor="#818cf8" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Area dataKey="orders" stroke="#818cf8" fill="url(#tg)" strokeWidth={1.5} dot={false} animationDuration={400}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Plan vs actual bar */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Annual Plan vs Actual</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<ChartTip/>}/>
            <Bar dataKey="Plan" fill="#334155" radius={[3,3,0,0]}/>
            <Bar dataKey="Actual" fill="#22c55e" radius={[3,3,0,0]}/>
            <Bar dataKey="Projected" fill="#818cf8" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2">{[['Plan','#334155'],['Actual','#22c55e'],['Projected','#818cf8']].map(([l,c]) => (
          <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2 h-2 rounded-sm" style={{background:c}}/>{l}</span>
        ))}</div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-400">Alerts</div>
          {alerts.map(a => (
            <div key={a.key} className={clsx('flex items-start gap-2 px-3 py-2 rounded-lg text-xs border', a.type === 'error' ? 'bg-red-900/20 border-red-800/40 text-red-300' : 'bg-amber-900/20 border-amber-800/40 text-amber-300')}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0"/>{a.msg}
            </div>
          ))}
        </div>
      )}

      {shopifyOrders.length === 0 && (
        <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4 text-xs text-amber-300">
          <AlertTriangle size={13} className="inline mr-1.5"/>No Shopify orders loaded. Fetch from Setup page first.
        </div>
      )}
    </div>
  );
}

/* ─── TAB: PREDICTIONS ───────────────────────────────────────────────── */
function TabPredictions({ plan, adv, seasonality, cohorts }) {
  const [scenarioView, setScenarioView] = useState('orders');

  if (!adv.avg7) return (
    <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-10 text-center text-slate-500 text-sm">
      <TrendingUp size={32} className="mx-auto mb-3 text-slate-600"/>No order data loaded yet. Fetch from Setup page first.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Regression stats */}
      {adv.regStats && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Linear Regression — Last 30 Days</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] text-slate-500 mb-1">Trend Slope</div>
              <div className={clsx('text-lg font-bold', adv.regStats.slope > 0 ? 'text-emerald-400' : 'text-red-400')}>
                {adv.regStats.slope > 0 ? '+' : ''}{adv.regStats.slope} ord/day
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">R² Fit</div>
              <div className={clsx('text-lg font-bold', adv.regStats.r2 > 0.7 ? 'text-emerald-400' : adv.regStats.r2 > 0.4 ? 'text-amber-400' : 'text-slate-400')}>
                {adv.regStats.r2}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">Confidence</div>
              <div className={clsx('text-base font-bold', adv.regStats.confidence === 'High' ? 'text-emerald-400' : adv.regStats.confidence === 'Medium' ? 'text-amber-400' : 'text-slate-400')}>
                {adv.regStats.confidence}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">Std Error</div>
              <div className="text-base font-bold text-slate-300">±{adv.regStats.stderr} ord</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-400 bg-gray-800/40 rounded-lg px-3 py-2">{adv.regStats.interpretation}</div>
        </div>
      )}

      {/* 30-day forecast chart */}
      {adv.forecastArray?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">30-Day Forecast — Base / Bull / Bear</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={adv.forecastArray}>
              <defs>
                <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15}/><stop offset="100%" stopColor="#22c55e" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15}/><stop offset="100%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2}/><stop offset="100%" stopColor="#818cf8" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} interval={4}/>
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} width={35}/>
              <Tooltip content={<ChartTip/>}/>
              <Area dataKey="bear" name="Bear" stroke="#ef4444" fill="url(#bearGrad)" strokeWidth={1} dot={false} strokeDasharray="3 3"/>
              <Area dataKey="base" name="Base" stroke="#818cf8" fill="url(#baseGrad)" strokeWidth={2} dot={false}/>
              <Area dataKey="bull" name="Bull" stroke="#22c55e" fill="url(#bullGrad)" strokeWidth={1} dot={false} strokeDasharray="3 3"/>
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            {[['Bull (1.6x trend)','#22c55e'],['Base (current)','#818cf8'],['Bear (0.5x)','#ef4444']].map(([l,c]) => (
              <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2 h-2 rounded-sm" style={{background:c}}/>{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* Monthly scenario table */}
      {adv.scenarios?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-slate-300">Monthly Scenario Projections</div>
            <div className="flex gap-1">
              {['orders','revenue'].map(v => (
                <button key={v} onClick={() => setScenarioView(v)} className={clsx('px-2 py-1 rounded text-[10px] font-semibold border', scenarioView === v ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-gray-800 text-slate-500 border-gray-700')}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50">
                {['Month','Bear','Base','Bull','Plan','Gap (Base vs Plan)'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {adv.scenarios.map(s => {
                  const bear = scenarioView === 'revenue' ? s.bearRev : s.bear;
                  const base = scenarioView === 'revenue' ? s.baseRev : s.base;
                  const bull = scenarioView === 'revenue' ? s.bullRev : s.bull;
                  const plan = scenarioView === 'revenue' ? s.planRev : s.plan;
                  const fmt  = scenarioView === 'revenue' ? fmtRs : fmtK;
                  return (
                    <tr key={s.label} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                      <td className="px-3 py-2 font-semibold text-white">{s.label}</td>
                      <td className="px-3 py-2 text-red-400">{fmt(bear)}</td>
                      <td className="px-3 py-2 text-indigo-300 font-semibold">{fmt(base)}</td>
                      <td className="px-3 py-2 text-emerald-400">{fmt(bull)}</td>
                      <td className="px-3 py-2 text-slate-400">{fmt(plan)}</td>
                      <td className="px-3 py-2">
                        <span className={clsx('font-semibold', s.baseGap >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {s.baseGap >= 0 ? '+' : ''}{s.baseGap.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day-of-week seasonality */}
      {seasonality?.dowPatterns?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-1">Day-of-Week Seasonality</div>
          <div className="text-[10px] text-slate-500 mb-3">Best: {seasonality.bestDay?.day} ({seasonality.bestDay?.avgOrders} avg) · Worst: {seasonality.worstDay?.day} ({seasonality.worstDay?.avgOrders} avg)</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={seasonality.dowPatterns}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} width={30}/>
              <Tooltip content={<ChartTip/>}/>
              <Bar dataKey="avgOrders" name="Avg Orders" radius={[3,3,0,0]}>
                {seasonality.dowPatterns.map((d, i) => (
                  <Cell key={i} fill={d.indexVsAvg >= 1.1 ? '#22c55e' : d.indexVsAvg <= 0.9 ? '#ef4444' : '#818cf8'}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cohort metrics */}
      {cohorts?.total > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Customer Cohort Metrics</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Total Customers" value={cohorts.total.toLocaleString()} sub="with email"/>
            <KpiCard label="Repeat Rate" value={fmtPct(cohorts.repeatRate)} sub={`${cohorts.repeat} repeat buyers`} cls={cohorts.repeatRate > 25 ? 'text-emerald-400' : 'text-amber-400'}/>
            <KpiCard label="Avg LTV" value={fmtRs(cohorts.avgLtv)} sub="per customer"/>
            <KpiCard label="High-Value (>₹1K)" value={cohorts.highValue.toLocaleString()} sub="customers" cls="text-brand-300"/>
          </div>
          {cohorts.cohortList.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/50">
                  {['Cohort','New Customers','Repeat','Repeat Rate','Avg Revenue'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {cohorts.cohortList.map(c => (
                    <tr key={c.key} className="border-b border-gray-800/30">
                      <td className="px-3 py-2 text-white font-semibold">{c.label}</td>
                      <td className="px-3 py-2 text-slate-300">{c.newCustomers}</td>
                      <td className="px-3 py-2 text-emerald-400">{c.repeatCustomers}</td>
                      <td className="px-3 py-2">
                        <span className={c.repeatRate >= 25 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>{fmtPct(c.repeatRate)}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{fmtRs(c.avgRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── TAB: STAGE ROADMAP ─────────────────────────────────────────────── */
function TabRoadmap({ roadmap }) {
  const { stage, nextStage, gaps, readiness, metCount, totalRequirements, daysToNext, priorities, creativePlaybook, milestones } = roadmap;

  return (
    <div className="space-y-5">
      {/* Stage header */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <StageBadge stage={stage}/>
            {nextStage && (
              <>
                <ChevronRight size={14} className="text-slate-600"/>
                <StageBadge stage={nextStage} size="sm"/>
              </>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs font-bold text-white">{readiness}% Ready</div>
            <div className="text-[10px] text-slate-500">{metCount}/{totalRequirements} requirements met</div>
            {daysToNext > 0 && nextStage && (
              <div className="text-[10px] text-amber-400">~{daysToNext}d to {nextStage.name}</div>
            )}
          </div>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-1">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${readiness}%` }}/>
        </div>
        <div className="text-[10px] text-slate-600">Stage readiness: {readiness}% ({metCount} of {totalRequirements} metrics met)</div>
      </div>

      {/* Gap analysis table */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Requirements Gap Analysis — {stage?.name} Stage</div>
        <div className="space-y-3">
          {gaps.map(g => (
            <div key={g.metric}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {g.met
                    ? <CheckCircle size={13} className="text-emerald-400 shrink-0"/>
                    : <AlertTriangle size={13} className="text-amber-400 shrink-0"/>}
                  <span className="text-xs text-slate-300 font-medium">{g.metric}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-500">Target: <span className="text-slate-300">{fmtK(g.target)}{g.unit}</span></span>
                  <span className={g.met ? 'text-emerald-400 font-bold' : 'text-amber-400 font-semibold'}>
                    {fmtK(g.current)}{g.unit}
                  </span>
                  {!g.met && <span className="text-red-400 text-[10px]">gap: {fmtK(Math.abs(g.gap))}{g.unit}</span>}
                </div>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full transition-all', g.met ? 'bg-emerald-500' : g.pct > 60 ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ width: `${Math.min(g.pct, 100)}%` }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Milestones */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Stage Milestones to Unlock Next Level</div>
        <div className="space-y-2">
          {milestones?.map((m, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs text-slate-300">
              <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-600"/>
              </div>
              {m}
            </div>
          ))}
        </div>
      </div>

      {/* Action plan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Action Plan — Top Priorities</div>
          <div className="space-y-2">
            {priorities?.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                <span className="w-5 h-5 rounded-full bg-brand-600/25 text-brand-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                {p}
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900/60 rounded-xl border border-amber-800/20 p-4">
          <div className="text-xs font-bold text-amber-400 mb-3">Creative Playbook for This Stage</div>
          <div className="space-y-2">
            {creativePlaybook?.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                <Flame size={11} className="text-amber-400 shrink-0 mt-0.5"/>
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* All stages timeline */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Growth Stage Roadmap</div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {STAGES.map((s, i) => {
            const isCurrent = s.id === stage?.id;
            const isPast    = STAGES.indexOf(stage) > i;
            return (
              <div key={s.id} className={clsx('flex-1 min-w-[140px] rounded-xl border p-3 transition-all', isCurrent ? 'border-opacity-60' : 'border-gray-800/40 opacity-60')}
                style={isCurrent ? { borderColor: s.color + '60', background: s.color + '10' } : {}}>
                <div className="text-xs font-bold mb-1" style={{ color: isCurrent ? s.color : '#64748b' }}>
                  {s.badge} {s.name}
                </div>
                <div className="text-[9px] text-slate-500 mb-2">{s.min}–{s.max === Infinity ? '∞' : s.max} ord/day</div>
                <div className="space-y-0.5">
                  {[
                    `${s.requirements.campaigns} campaigns`,
                    `${s.requirements.creatives} creatives`,
                    `${s.requirements.warehouses} warehouse${s.requirements.warehouses > 1 ? 's' : ''}`,
                    fmtRs(s.requirements.workingCapital) + ' WC',
                  ].map((r, j) => (
                    <div key={j} className="text-[9px] text-slate-500">{r}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── TAB: REVENUE PLAN ──────────────────────────────────────────────── */
function TabRevenue({ plan, pva, savePlan, shopifyOrders }) {
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const startEdit = (idx, field, val) => setEditing({ idx, field, value: String(val) });
  const commitEdit = () => {
    if (!editing) return;
    const { idx, field, value } = editing;
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) { setEditing(null); return; }
    const months = plan.months.map((m, i) => i === idx ? { ...m, [field]: Math.round(parsed) } : m);
    savePlan({ months });
    setEditing(null);
  };

  const totalPlan   = pva.reduce((s, m) => s + m.planRevenue, 0);
  const totalActual = pva.reduce((s, m) => s + m.actualRevenue, 0);

  const weeklyData = useMemo(() => {
    if (expanded === null) return [];
    return buildWeeklyBreakdown(plan.months[expanded], shopifyOrders);
  }, [expanded, plan.months, shopifyOrders]);

  const EditCell = ({ idx, field, val, prefix = '' }) => (
    editing?.idx === idx && editing?.field === field ? (
      <div className="flex items-center gap-1">
        <input autoFocus className="w-20 bg-gray-800 border border-brand-500 rounded px-1.5 py-0.5 text-white text-xs"
          value={editing.value}
          onChange={e => setEditing(p => ({ ...p, value: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}/>
        <button onClick={commitEdit}><Check size={12} className="text-emerald-400"/></button>
        <button onClick={() => setEditing(null)}><X size={12} className="text-slate-500"/></button>
      </div>
    ) : (
      <button onClick={() => startEdit(idx, field, val)} className="text-white hover:text-brand-300 transition-colors flex items-center gap-1 group">
        {prefix}{typeof val === 'number' && val > 1000 ? fmtRs(val) : val}<Edit2 size={10} className="text-slate-600 opacity-0 group-hover:opacity-100"/>
      </button>
    )
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Annual Revenue Plan — Click any cell to edit</div>
          <div className="text-[10px] text-slate-500">Seeded from Taos Business Plan Excel (Mar–Dec 2026)</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500">Year Target</div>
          <div className="text-sm font-bold text-white">{fmtRs(totalPlan)}</div>
          {totalActual > 0 && <div className="text-[10px] text-emerald-400">{fmtRs(totalActual)} actual</div>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800/50">
            {['Month','Orders/Day','AOV (₹)','Budget/Day','Plan Revenue','Actual','Status',''].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {pva.map((m, idx) => {
              const isExp = expanded === idx;
              return (
                <>
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20', m.isCurrentMonth && 'bg-brand-600/5')}>
                    <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                      {m.isCurrentMonth && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block mr-1.5"/>}{m.label}
                    </td>
                    <td className="px-3 py-2.5"><EditCell idx={idx} field="ordersPerDay" val={m.ordersPerDay}/></td>
                    <td className="px-3 py-2.5"><EditCell idx={idx} field="aov" val={m.aov} prefix="₹"/></td>
                    <td className="px-3 py-2.5"><EditCell idx={idx} field="adBudgetPerDay" val={m.adBudgetPerDay}/></td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{fmtRs(m.planRevenue)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.actualRevenue > 0 ? <span className="text-emerald-400">{fmtRs(m.actualRevenue)}</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', STATUS_STYLE[m.status]?.pill)}>{STATUS_STYLE[m.status]?.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setExpanded(isExp ? null : idx)} className="text-slate-500 hover:text-slate-300">
                        <ChevronRight size={14} className={clsx('transition-transform', isExp && 'rotate-90')}/>
                      </button>
                    </td>
                  </tr>
                  {isExp && (
                    <tr key={`${m.key}-wk`}><td colSpan={8} className="px-3 py-4 bg-gray-900/40 border-b border-gray-800/30">
                      <div className="text-[10px] font-bold text-slate-400 mb-3">Weekly Breakdown — {m.label}</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-700/40">
                              {['Week','Days','Target Ord','Target Rev','Budget','Actual','%'].map(h => (
                                <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {weeklyData.map(wk => (
                                <tr key={wk.week} className="border-b border-gray-800/20">
                                  <td className="px-2 py-1.5 text-slate-400">{wk.label} <span className="text-slate-600">({wk.dateRange})</span></td>
                                  <td className="px-2 py-1.5 text-slate-300">{wk.days}</td>
                                  <td className="px-2 py-1.5 text-white">{wk.targetOrders.toLocaleString()}</td>
                                  <td className="px-2 py-1.5 text-slate-300">{fmtRs(wk.targetRevenue)}</td>
                                  <td className="px-2 py-1.5 text-slate-300">{fmtRs(wk.targetBudget)}</td>
                                  <td className="px-2 py-1.5">{wk.actualOrders > 0 ? <span className="text-emerald-400">{wk.actualOrders}</span> : <span className="text-slate-600">—</span>}</td>
                                  <td className="px-2 py-1.5">{wk.pct > 0 ? <span className={wk.pct >= 90 ? 'text-emerald-400' : 'text-amber-400'}>{wk.pct.toFixed(0)}%</span> : <span className="text-slate-600">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <ResponsiveContainer width="100%" height={150}>
                          <BarChart data={weeklyData} barGap={2}>
                            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
                            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false}/>
                            <YAxis tickFormatter={fmtK} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} width={35}/>
                            <Tooltip content={<ChartTip/>}/>
                            <Bar dataKey="targetOrders" name="Target" fill="#334155" radius={[2,2,0,0]}/>
                            <Bar dataKey="actualOrders" name="Actual" fill="#22c55e" radius={[2,2,0,0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </td></tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t border-gray-700/50 bg-gray-900/40">
            <td className="px-3 py-2.5 font-bold text-slate-300 text-xs">TOTAL 2026</td>
            <td colSpan={3}/>
            <td className="px-3 py-2.5 font-bold text-white text-xs">{fmtRs(totalPlan)}</td>
            <td className="px-3 py-2.5 font-bold text-emerald-400 text-xs">{totalActual > 0 ? fmtRs(totalActual) : '—'}</td>
            <td colSpan={2}/>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* ─── TAB: CREATIVE INTEL ─────────────────────────────────────────────── */
function TabMarketing({ plan, pva, savePlan, creative, metaCollections }) {
  const [editAlloc, setEditAlloc]     = useState(false);
  const [allocDraft, setAllocDraft]   = useState({ ...plan.collectionAlloc });
  const [editGlobals, setEditGlobals] = useState(false);
  const [globalsDraft, setGlobalsDraft] = useState({ cpr: plan.cpr, avgBudgetPerCampaign: plan.avgBudgetPerCampaign, avgCreativesPerCampaign: plan.avgCreativesPerCampaign });
  const [activeView, setActiveView]   = useState('publish');

  const mktData = useMemo(() => pva.map(m => buildMarketingNeeds(m, plan)), [pva, plan]);

  // Apply Meta collection spends as allocation suggestion
  const applyMetaAlloc = () => {
    if (!metaCollections?.length) return;
    const keys = Object.keys(plan.collectionAlloc);
    const matched = {};
    let matchedTotal = 0;
    metaCollections.forEach(mc => {
      const key = keys.find(k => mc.name.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(mc.name.toLowerCase()));
      if (key) { matched[key] = (matched[key] || 0) + mc.spendShare / 100; matchedTotal += mc.spendShare / 100; }
    });
    if (matchedTotal < 0.1) { alert('Could not match Meta collections to plan collections. Check collection names.'); return; }
    const norm = Object.fromEntries(Object.entries(matched).map(([k, v]) => [k, v / matchedTotal]));
    savePlan({ collectionAlloc: norm });
    setAllocDraft(norm);
  };

  const saveAlloc = () => {
    const total = Object.values(allocDraft).reduce((s, v) => s + parseFloat(v), 0);
    if (Math.abs(total - 1) > 0.01) { alert('Allocations must sum to 100%'); return; }
    savePlan({ collectionAlloc: Object.fromEntries(Object.entries(allocDraft).map(([k, v]) => [k, parseFloat(v)])) });
    setEditAlloc(false);
  };
  const saveGlobals = () => {
    savePlan({ cpr: parseFloat(globalsDraft.cpr)||plan.cpr, avgBudgetPerCampaign: parseFloat(globalsDraft.avgBudgetPerCampaign)||plan.avgBudgetPerCampaign, avgCreativesPerCampaign: parseFloat(globalsDraft.avgCreativesPerCampaign)||plan.avgCreativesPerCampaign });
    setEditGlobals(false);
  };

  return (
    <div className="space-y-5">
      {/* View switcher */}
      <div className="flex gap-1 bg-gray-900/40 rounded-lg p-1 border border-gray-800/40 w-fit">
        {[['publish','What to Publish'],['top','Top Performers'],['fatigue','Fatigue Alerts'],['monthly','Monthly Plan']].map(([v, l]) => (
          <button key={v} onClick={() => setActiveView(v)} className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-all', activeView === v ? 'bg-brand-600/20 text-brand-300' : 'text-slate-400 hover:text-slate-200')}>
            {l}
          </button>
        ))}
      </div>

      {/* What to publish */}
      {activeView === 'publish' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-500">Collection-level recommendations based on current ROAS vs targets. Publish priority and format guidance.</div>
          {creative.whatToPublish.length === 0 && (
            <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-6 text-center text-slate-500 text-sm">No Meta ad data loaded. Fetch from Setup page.</div>
          )}
          {creative.whatToPublish.map(w => (
            <div key={w.key} className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: COLL_COLORS[w.key] }}/>
                  <span className="text-sm font-bold text-white">{w.collection}</span>
                  <span className="text-[10px] text-slate-500">{w.budgetShare}% of budget</span>
                </div>
                <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-bold border', PRIORITY_STYLE[w.urgency])}>
                  {w.urgency}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                <div><span className="text-slate-500">Current ROAS: </span><span className={clsx('font-bold', w.currentRoas >= w.targetRoas ? 'text-emerald-400' : 'text-amber-400')}>{w.currentRoas.toFixed(2)}x</span></div>
                <div><span className="text-slate-500">Target ROAS: </span><span className="text-white font-bold">{w.targetRoas.toFixed(2)}x</span></div>
                <div><span className="text-slate-500">Active Ads: </span><span className="text-white font-bold">{w.activeAds}</span></div>
              </div>
              <div className="bg-brand-600/10 border border-brand-500/20 rounded-lg p-3 text-xs text-brand-300 mb-2">
                <span className="font-bold">Action: </span>{w.recommendation}
              </div>
              <div className="text-[10px] text-slate-500"><span className="text-slate-400 font-semibold">Format: </span>{w.formatRec}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top performers */}
      {activeView === 'top' && (
        <div className="space-y-3">
          {creative.collections.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {creative.collections.map(c => (
                <div key={c.name} className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{c.name}</span>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-bold', c.status === 'excellent' ? 'bg-emerald-500/20 text-emerald-400' : c.status === 'good' ? 'bg-brand-500/20 text-brand-400' : c.status === 'average' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400')}>
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Avg ROAS</span><span className="text-white font-bold">{c.avgRoas}x</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Avg CPR</span><span className="text-white">₹{c.avgCpr}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Active Ads</span><span className="text-white">{c.adCount}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Total Spend</span><span className="text-white">{fmtRs(c.spend)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {creative.topCreatives.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">No winning creatives found. Need ROAS &gt;3x and spend &gt;₹500.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800/50">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/50">
                  {['Creative','Collection','7d ROAS','CPR','Spend','Purchases'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {creative.topCreatives.map((c, i) => (
                    <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                      <td className="px-3 py-2.5"><div className="text-white font-medium max-w-[180px] truncate" title={c.name}>{c.name}</div></td>
                      <td className="px-3 py-2.5 text-slate-400">{c.collection}</td>
                      <td className="px-3 py-2.5 text-emerald-400 font-bold">{c.roas7d?.toFixed(2)}x</td>
                      <td className="px-3 py-2.5 text-slate-300">{c.cpr7d ? `₹${Math.round(c.cpr7d)}` : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-300">{fmtRs(c.spend)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{c.purchases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Fatigue alerts */}
      {activeView === 'fatigue' && (
        <div className="space-y-3">
          {creative.fatigueAlerts.length === 0 ? (
            <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-4 text-xs text-emerald-300">
              <CheckCircle size={13} className="inline mr-1.5"/>No creative fatigue detected. All high-spend ads are maintaining ROAS.
            </div>
          ) : creative.fatigueAlerts.map((a, i) => (
            <div key={i} className="bg-red-900/20 border border-red-800/40 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-red-300 truncate max-w-[200px]">{a.name}</div>
                <span className="text-[10px] text-slate-500">{a.collection}</span>
              </div>
              <div className="flex gap-4 text-xs mb-2">
                <span className="text-slate-500">7d ROAS: <span className="text-red-400 font-bold">{a.roas7d?.toFixed(2)}x</span></span>
                <span className="text-slate-500">30d ROAS: <span className="text-slate-300">{a.roas30d?.toFixed(2)}x</span></span>
                <span className="text-slate-500">Spend: <span className="text-white">{fmtRs(a.spend)}</span></span>
              </div>
              <div className="text-[10px] text-amber-400">{a.action}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly plan */}
      {activeView === 'monthly' && (
        <div className="space-y-4">
          {/* Live Meta collections panel */}
          {metaCollections?.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl border border-brand-800/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-bold text-slate-300">Live Collections from Meta Ads</div>
                  <div className="text-[10px] text-slate-500">Actual spend distribution across your active collections</div>
                </div>
                <button onClick={applyMetaAlloc} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/20 border border-brand-500/30 text-brand-300 rounded-lg text-[10px] font-semibold hover:bg-brand-600/30">
                  <RefreshCw size={10}/>Apply to Plan
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800/50">
                    {['Collection','Spend Share','Avg ROAS','Avg CPR','Active Ads'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {metaCollections.map(mc => (
                      <tr key={mc.name} className="border-b border-gray-800/30">
                        <td className="px-3 py-2 text-white font-medium">{mc.name}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-[60px]">
                              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${mc.spendShare}%` }}/>
                            </div>
                            <span className="text-slate-300 font-semibold">{mc.spendShare}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx('font-bold', mc.avgRoas >= 4 ? 'text-emerald-400' : mc.avgRoas >= 3 ? 'text-amber-400' : 'text-red-400')}>
                            {mc.avgRoas > 0 ? `${mc.avgRoas}x` : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{mc.avgCpr > 0 ? `₹${mc.avgCpr}` : '—'}</td>
                        <td className="px-3 py-2 text-slate-300">{mc.adCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Collection allocation */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-300">Collection Allocation & ROAS</div>
              <button onClick={() => setEditAlloc(v => !v)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={11}/>{editAlloc ? 'Cancel' : 'Edit'}</button>
            </div>
            {editAlloc ? (
              <div className="space-y-3">
                {Object.entries(allocDraft).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-20 text-xs text-slate-300">{key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1)}</div>
                    <input type="range" min="0" max="1" step="0.01" value={val} onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))} className="flex-1 accent-brand-500"/>
                    <input className="w-14 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center" value={(val*100).toFixed(0)} onChange={e => setAllocDraft(p => ({ ...p, [key]: (parseFloat(e.target.value)||0)/100 }))}/>
                    <span className="text-[10px] text-slate-500">%</span>
                    <div className="w-20 text-xs text-slate-400">ROAS: <span className="text-white">{plan.collectionRoas[key]?.toFixed(2)}</span></div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-1 border-t border-gray-800/40">
                  <div className="text-[10px] text-slate-500">Total: {(Object.values(allocDraft).reduce((s,v) => s+parseFloat(v),0)*100).toFixed(0)}%</div>
                  <button onClick={saveAlloc} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                {Object.entries(plan.collectionAlloc).map(([key, pct]) => (
                  <div key={key} className="flex-1 bg-gray-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2"><span className="w-2.5 h-2.5 rounded-full" style={{background:COLL_COLORS[key]}}/><span className="text-xs font-semibold text-white">{key==='allMix'?'All Mix':key.charAt(0).toUpperCase()+key.slice(1)}</span></div>
                    <div className="text-lg font-bold text-white">{Math.round(pct*100)}%</div>
                    <div className="text-[10px] text-slate-500">ROAS: {plan.collectionRoas[key]?.toFixed(2)}</div>
                    <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden"><div className="h-full rounded-full" style={{width:`${pct*100}%`,background:COLL_COLORS[key]}}/></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Global settings */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-300">Global Marketing Settings</div>
              <button onClick={() => setEditGlobals(v => !v)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={11}/>{editGlobals?'Cancel':'Edit'}</button>
            </div>
            {editGlobals ? (
              <div className="grid grid-cols-3 gap-3">
                {[['cpr','Avg CPR (₹)'],['avgBudgetPerCampaign','Budget/Campaign (₹/day)'],['avgCreativesPerCampaign','Creatives/Campaign']].map(([f,l]) => (
                  <div key={f}><div className="text-[9px] text-slate-500 mb-1">{l}</div><input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={globalsDraft[f]} onChange={e => setGlobalsDraft(p => ({...p,[f]:e.target.value}))}/></div>
                ))}
                <div className="col-span-3"><button onClick={saveGlobals} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button></div>
              </div>
            ) : (
              <div className="flex gap-6 text-xs">
                <div><span className="text-slate-500">CPR: </span><span className="text-white font-semibold">₹{plan.cpr}</span></div>
                <div><span className="text-slate-500">Budget/Campaign: </span><span className="text-white font-semibold">₹{plan.avgBudgetPerCampaign.toLocaleString()}/day</span></div>
                <div><span className="text-slate-500">Creatives/Campaign: </span><span className="text-white font-semibold">{plan.avgCreativesPerCampaign}</span></div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-800/50">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50">
                {['Month','Budget/Day','Month Budget','Campaigns','Creatives','Blended ROAS','Exp. Results/Day','Exp. Revenue'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {mktData.map((mk, i) => (
                  <tr key={pva[i].key} className={clsx('border-b border-gray-800/30', pva[i].isCurrentMonth && 'bg-brand-600/5')}>
                    <td className="px-3 py-2.5 font-semibold text-white">{pva[i].label}</td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.adBudgetPerDay)}</td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                    <td className="px-3 py-2.5 text-white font-semibold">{mk.campaigns}</td>
                    <td className="px-3 py-2.5 text-white font-semibold">{mk.creatives}</td>
                    <td className="px-3 py-2.5 text-emerald-400 font-semibold">{mk.blendedRoas.toFixed(2)}x</td>
                    <td className="px-3 py-2.5 text-slate-300">{mk.expectedResults.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalExpectedRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── TAB: PROCUREMENT ───────────────────────────────────────────────── */
function TabProcurement({ plan, savePlan, procurement, shopifyOrders, inventoryMap }) {
  const [view, setView]         = useState('urgent');
  const [editSupplier, setEditSupplier] = useState(null);
  const [supplierForm, setSupplierForm] = useState({});
  const [invFilter, setInvFilter] = useState('all');

  const invNeeds = useMemo(() => buildInventoryNeeds(inventoryMap, shopifyOrders), [inventoryMap, shopifyOrders]);
  const counts = useMemo(() => {
    const c = { oos: 0, critical: 0, low: 0, watch: 0, ok: 0 };
    invNeeds.forEach(r => { c[r.status] = (c[r.status]||0)+1; });
    return c;
  }, [invNeeds]);

  const openSupplier = (sup) => { setSupplierForm(sup ? { ...sup } : { id: `sup_${Date.now()}`, name: '', category: '', leadTimeDays: 5, paymentTerms: 'Advance', moqUnits: 50, notes: '' }); setEditSupplier(sup?.id || 'new'); };
  const saveSupplier = () => {
    if (!supplierForm.name?.trim()) return;
    const s = { ...supplierForm, leadTimeDays: parseInt(supplierForm.leadTimeDays)||5, moqUnits: parseInt(supplierForm.moqUnits)||50 };
    const suppliers = editSupplier === 'new' ? [...(plan.suppliers||[]), s] : (plan.suppliers||[]).map(x => x.id === editSupplier ? s : x);
    savePlan({ suppliers });
    setEditSupplier(null);
  };
  const removeSupplier = id => { if (!confirm('Remove supplier?')) return; savePlan({ suppliers: (plan.suppliers||[]).filter(s => s.id !== id) }); };

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Urgent POs" value={procurement.urgentItems.length} sub="need ordering" cls={procurement.urgentItems.length > 0 ? 'text-red-400' : 'text-emerald-400'} warn={procurement.urgentItems.length > 0}/>
        <KpiCard label="Total PO Value" value={fmtRs(procurement.totalPoValue)} sub="urgent items only"/>
        <KpiCard label="Units Needed" value={fmtK(procurement.totalPoUnits)} sub="urgent reorder qty"/>
        <KpiCard label="SKUs Tracked" value={procurement.items.length} sub="with velocity data"/>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 bg-gray-900/40 rounded-lg p-1 border border-gray-800/40 w-fit">
        {[['urgent','Urgent POs'],['all','All SKUs'],['suppliers','Suppliers']].map(([v,l]) => (
          <button key={v} onClick={() => setView(v)} className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-all', view === v ? 'bg-brand-600/20 text-brand-300' : 'text-slate-400 hover:text-slate-200')}>{l}</button>
        ))}
      </div>

      {/* Urgent POs */}
      {view === 'urgent' && (
        procurement.urgentItems.length === 0 ? (
          <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-6 text-center text-emerald-300 text-sm">
            <CheckCircle size={24} className="mx-auto mb-2"/>All SKUs have sufficient stock. No urgent POs needed.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800/50">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50">
                {['SKU / Product','Priority','Stock','Vel/Day','Days Left','EOQ','Order Qty','PO Date','Delivery','PO Value','Supplier'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {procurement.urgentItems.map(r => (
                  <tr key={r.sku} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="px-3 py-2.5"><div className="text-white font-medium max-w-[140px] truncate" title={r.name}>{r.name}</div><div className="text-[10px] text-slate-600 font-mono">{r.sku}</div></td>
                    <td className="px-3 py-2.5"><span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border font-bold', PRIORITY_STYLE[r.priority])}>{r.priority}</span></td>
                    <td className="px-3 py-2.5 text-white font-semibold">{r.current.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.vel}</td>
                    <td className="px-3 py-2.5"><span className={r.daysOfStock < 14 ? 'text-red-400 font-bold' : 'text-amber-400'}>{r.daysOfStock > 500 ? '∞' : `${r.daysOfStock}d`}</span></td>
                    <td className="px-3 py-2.5 text-slate-300">{r.eoq.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-amber-400 font-bold">{r.suggestedQty.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{r.poDate}</td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{r.deliveryDate}</td>
                    <td className="px-3 py-2.5 text-white">{fmtRs(r.estimatedPoValue)}</td>
                    <td className="px-3 py-2.5 text-slate-400 max-w-[100px] truncate">{r.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* All SKUs */}
      {view === 'all' && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(INV_STATUS).map(([st, style]) => (
              <button key={st} onClick={() => setInvFilter(invFilter === st ? 'all' : st)}
                className={clsx('rounded-lg border p-2 text-center transition-all', invFilter === st ? style.pill : 'bg-gray-900/60 border-gray-800/50 text-slate-400 hover:border-gray-700')}>
                <div className="text-sm font-bold">{counts[st]||0}</div>
                <div className="text-[9px] uppercase font-bold">{style.label}</div>
              </button>
            ))}
          </div>
          {invNeeds.filter(r => invFilter === 'all' || r.status === invFilter).length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">No SKUs in this category.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800/50">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/50">
                  {['SKU','Status','Stock','Vel/Day','Days','30d Demand','60d Demand','Reorder Qty'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {invNeeds.filter(r => invFilter === 'all' || r.status === invFilter).map(r => {
                    const st = INV_STATUS[r.status];
                    return (
                      <tr key={r.sku} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                        <td className="px-3 py-2.5"><div className="text-white font-medium max-w-[150px] truncate" title={r.name}>{r.name}</div><div className="text-[10px] text-slate-600 font-mono">{r.sku}</div></td>
                        <td className="px-3 py-2.5"><span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-bold', st.pill)}>{st.label}</span></td>
                        <td className="px-3 py-2.5 text-white font-semibold">{r.current.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-slate-300">{r.vel}/day</td>
                        <td className="px-3 py-2.5"><span className={r.daysOfStock<14?'text-red-400 font-bold':r.daysOfStock<30?'text-amber-400':'text-emerald-400'}>{r.daysOfStock>500?'∞':`${r.daysOfStock}d`}</span></td>
                        <td className="px-3 py-2.5 text-slate-300">{r.demandNext30.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-slate-300">{r.demandNext60.toLocaleString()}</td>
                        <td className="px-3 py-2.5">{r.reorderQty>0?<span className="text-amber-400 font-bold">{r.reorderQty.toLocaleString()}</span>:<span className="text-slate-600">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Suppliers */}
      {view === 'suppliers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-white">Supplier Directory</div>
            <button onClick={() => openSupplier(null)} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-500"><Plus size={13}/>Add Supplier</button>
          </div>
          {editSupplier && (
            <div className="bg-gray-900/80 rounded-xl border border-brand-500/30 p-4 space-y-3">
              <div className="text-xs font-bold text-slate-300">{editSupplier === 'new' ? 'New Supplier' : 'Edit Supplier'}</div>
              <div className="grid grid-cols-2 gap-3">
                {[['name','Name *'],['category','Category (Plants/Seeds/Mix)'],['leadTimeDays','Lead Time (days)'],['moqUnits','MOQ (units)'],['paymentTerms','Payment Terms'],['notes','Notes']].map(([f,l]) => (
                  <div key={f} className={f==='notes'?'col-span-2':''}>
                    <div className="text-[9px] text-slate-500 mb-1">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={supplierForm[f]||''} onChange={e => setSupplierForm(p => ({...p,[f]:e.target.value}))}/>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={saveSupplier} className="px-4 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
                <button onClick={() => setEditSupplier(null)} className="px-4 py-1.5 bg-gray-800 text-slate-300 rounded text-xs">Cancel</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(plan.suppliers||[]).map(s => (
              <div key={s.id} className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-sm font-bold text-white">{s.name}</div>
                    <div className="text-[10px] text-slate-500">{s.category}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openSupplier(s)} className="p-1 text-slate-500 hover:text-slate-300"><Edit2 size={12}/></button>
                    <button onClick={() => removeSupplier(s.id)} className="p-1 text-slate-600 hover:text-red-400"><Trash2 size={12}/></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-500">Lead Time: </span><span className="text-white">{s.leadTimeDays}d</span></div>
                  <div><span className="text-slate-500">MOQ: </span><span className="text-white">{s.moqUnits} units</span></div>
                  <div><span className="text-slate-500">Terms: </span><span className="text-white">{s.paymentTerms}</span></div>
                </div>
                {s.notes && <div className="text-[10px] text-slate-500 bg-gray-800/40 rounded px-2 py-1.5 mt-2">{s.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── TAB: WAREHOUSES ────────────────────────────────────────────────── */
function TabWarehouses({ plan, savePlan }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({});

  const openNew  = () => { setForm({ id: `wh_${Date.now()}`, name: '', location: '', capacity: '', active: true, notes: '', skuCategories: '' }); setEditing('new'); };
  const openEdit = wh => { setForm({ ...wh }); setEditing(wh.id); };
  const save = () => {
    if (!form.name?.trim()) return;
    const wh = { ...form, capacity: parseInt(form.capacity) || 0 };
    const warehouses = editing === 'new' ? [...plan.warehouses, wh] : plan.warehouses.map(w => w.id === editing ? wh : w);
    savePlan({ warehouses }); setEditing(null);
  };
  const remove = id => { if (!confirm('Remove warehouse?')) return; savePlan({ warehouses: plan.warehouses.filter(w => w.id !== id) }); };
  const toggle = id => savePlan({ warehouses: plan.warehouses.map(w => w.id === id ? { ...w, active: !w.active } : w) });

  const totalCap = plan.warehouses.filter(w => w.active).reduce((s, w) => s + (w.capacity || 0), 0);
  const activeCount = plan.warehouses.filter(w => w.active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Warehouse Network</div>
          <div className="text-[10px] text-slate-500">{activeCount} active · {totalCap.toLocaleString()} total unit capacity</div>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-500"><Plus size={13}/>Add Warehouse</button>
      </div>

      {/* Capacity summary */}
      {plan.warehouses.filter(w => w.active).length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Capacity Distribution</div>
          <div className="space-y-2">
            {plan.warehouses.filter(w => w.active).map(wh => (
              <div key={wh.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">{wh.name} — {wh.location}</span>
                  <span className="text-white font-semibold">{wh.capacity?.toLocaleString()} units ({totalCap > 0 ? Math.round((wh.capacity/totalCap)*100) : 0}%)</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${totalCap > 0 ? (wh.capacity/totalCap)*100 : 0}%` }}/>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-slate-500">Total active capacity: <span className="text-white font-bold">{totalCap.toLocaleString()} units</span></div>
        </div>
      )}

      {editing && (
        <div className="bg-gray-900/80 rounded-xl border border-brand-500/30 p-4 space-y-3">
          <div className="text-xs font-bold text-slate-300">{editing === 'new' ? 'New Warehouse' : 'Edit Warehouse'}</div>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Name *'],['location','Location'],['capacity','Capacity (units)'],['skuCategories','SKU Categories']].map(([f,l]) => (
              <div key={f}><div className="text-[9px] text-slate-500 mb-1">{l}</div><input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={form[f]||''} onChange={e => setForm(p => ({...p,[f]:e.target.value}))}/></div>
            ))}
            <div className="col-span-2"><div className="text-[9px] text-slate-500 mb-1">Notes</div><input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={form.notes||''} onChange={e => setForm(p => ({...p,notes:e.target.value}))}/></div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 bg-gray-800 text-slate-300 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plan.warehouses.map(wh => (
          <div key={wh.id} className={clsx('bg-gray-900/60 rounded-xl border p-4 transition-all', wh.active ? 'border-gray-800/50' : 'border-gray-800/30 opacity-60')}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-white">{wh.name}</div>
                <div className="text-[10px] text-slate-500">{wh.location}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => toggle(wh.id)} className={clsx('text-[9px] px-2 py-0.5 rounded-full font-bold border', wh.active ? 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30' : 'bg-gray-800 text-slate-500 border-gray-700')}>
                  {wh.active ? 'ACTIVE' : 'INACTIVE'}
                </button>
                <button onClick={() => openEdit(wh)} className="p-1 text-slate-500 hover:text-slate-300"><Edit2 size={12}/></button>
                <button onClick={() => remove(wh.id)} className="p-1 text-slate-600 hover:text-red-400"><Trash2 size={12}/></button>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              {wh.capacity > 0 && <div className="flex justify-between"><span className="text-slate-500">Capacity</span><span className="text-white font-semibold">{wh.capacity.toLocaleString()} units</span></div>}
              {wh.skuCategories && <div className="flex justify-between"><span className="text-slate-500">Categories</span><span className="text-slate-300 text-right">{wh.skuCategories}</span></div>}
              {wh.notes && <div className="text-[10px] text-slate-500 bg-gray-800/40 rounded px-2 py-1.5 mt-2">{wh.notes}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── TAB: WORKING CAPITAL ───────────────────────────────────────────── */
function TabCapital({ plan, wc }) {
  const [scenario, setScenario] = useState(40);

  const totals = {
    inv:    wc.reduce((s, m) => s + m.inventoryInvestment, 0),
    mkt:    wc.reduce((s, m) => s + m.marketingSpend, 0),
    gross:  wc.reduce((s, m) => s + m.grossMargin, 0),
    net:    wc.reduce((s, m) => s + m.netProfit, 0),
    cap:    wc.reduce((s, m) => s + (m.scenarios.find(sc => sc.pct === scenario)?.capital || 0), 0),
    gap:    wc.reduce((s, m) => s + (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0), 0),
    monthsWithGap: wc.filter(m => (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0) > 0).length,
  };

  const chartData = wc.map(m => ({
    label: m.label.slice(0, 3),
    Revenue: Math.round(m.planRevenue), Marketing: Math.round(m.marketingSpend),
    Inventory: Math.round(m.inventoryInvestment), Ops: Math.round(m.opsCost), Profit: Math.round(m.netProfit),
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Inventory Investment" value={fmtRs(totals.inv)} sub="20% of revenue"/>
        <KpiCard label="Total Marketing Spend" value={fmtRs(totals.mkt)} sub="Mar–Dec 2026"/>
        <KpiCard label="Gross Profit (50%)" value={fmtRs(totals.gross)} cls="text-emerald-400"/>
        <KpiCard label="Net Profit" value={fmtRs(totals.net)} cls={totals.net > 0 ? 'text-emerald-400' : 'text-red-400'}/>
      </div>

      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Working Capital Scenario</div>
          <div className="flex gap-2">
            {[20,40,60].map(p => (
              <button key={p} onClick={() => setScenario(p)} className={clsx('px-3 py-1 rounded-lg text-xs font-semibold border', scenario===p ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-gray-800 text-slate-400 border-gray-700')}>
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 mb-3">{scenario}% of monthly revenue available as working capital. Gap = inventory + 30% of marketing − capital available.</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Capital Available</div>
            <div className="text-lg font-bold text-white">{fmtRs(totals.cap)}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Total Funding Gap</div>
            <div className={clsx('text-lg font-bold', totals.gap > 0 ? 'text-red-400' : 'text-emerald-400')}>{fmtRs(totals.gap)}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Months with Gap</div>
            <div className={clsx('text-lg font-bold', totals.monthsWithGap > 0 ? 'text-amber-400' : 'text-emerald-400')}>{totals.monthsWithGap}</div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Revenue Waterfall — Mar–Dec 2026</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<ChartTip/>}/>
            <Bar dataKey="Revenue" fill="#334155" radius={[0,0,0,0]}/>
            <Bar dataKey="Marketing" fill="#f59e0b" radius={[0,0,0,0]}/>
            <Bar dataKey="Inventory" fill="#818cf8" radius={[0,0,0,0]}/>
            <Bar dataKey="Ops" fill="#64748b" radius={[0,0,0,0]}/>
            <Bar dataKey="Profit" fill="#22c55e" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2">
          {[['Revenue','#334155'],['Marketing','#f59e0b'],['Inventory','#818cf8'],['Ops','#64748b'],['Net Profit','#22c55e']].map(([l,c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400"><span className="w-2 h-2 rounded-sm" style={{background:c}}/>{l}</span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800/50">
            {['Month','Plan Revenue','Gross Margin','Mkt Spend','Inv Investment','Ops Cost','Net Profit',`Gap @${scenario}%`].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {wc.map(m => {
              const sc = m.scenarios.find(s => s.pct === scenario);
              return (
                <tr key={m.key} className={clsx('border-b border-gray-800/30', m.isCurrentMonth && 'bg-brand-600/5')}>
                  <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{m.label}</td>
                  <td className="px-3 py-2.5 text-slate-300">{fmtRs(m.planRevenue)}</td>
                  <td className="px-3 py-2.5 text-emerald-400">{fmtRs(m.grossMargin)}</td>
                  <td className="px-3 py-2.5 text-amber-400">{fmtRs(m.marketingSpend)}</td>
                  <td className="px-3 py-2.5 text-purple-400">{fmtRs(m.inventoryInvestment)}</td>
                  <td className="px-3 py-2.5 text-slate-400">{fmtRs(m.opsCost)}</td>
                  <td className={clsx('px-3 py-2.5 font-semibold', m.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400')}>{fmtRs(m.netProfit)}</td>
                  <td className="px-3 py-2.5">{sc?.gap > 0 ? <span className="text-red-400 font-bold">{fmtRs(sc.gap)}</span> : <span className="text-emerald-400">Funded</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── TAB: EXPORT & NOTES ─────────────────────────────────────────────── */
function TabExport({ plan, pva, wc, savePlan, procurement, shopifyOrders }) {
  const [notes, setNotes] = useState(plan.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [overrideKey, setOverrideKey]   = useState('');
  const [overrideValue, setOverrideValue] = useState('');

  const saveNotes = () => {
    savePlan({ notes });
    setSavingNotes(true);
    setTimeout(() => setSavingNotes(false), 1000);
  };

  const addOverride = () => {
    if (!overrideKey.trim()) return;
    const manualOverrides = { ...(plan.manualOverrides || {}), [overrideKey.trim()]: overrideValue };
    savePlan({ manualOverrides });
    setOverrideKey(''); setOverrideValue('');
  };

  const removeOverride = key => {
    const { [key]: _, ...rest } = plan.manualOverrides || {};
    savePlan({ manualOverrides: rest });
  };

  const exports = [
    {
      label: 'Revenue Plan CSV',
      desc: 'Monthly targets, actuals, and status',
      fn: () => downloadCsv('revenue_plan.csv', pva, ['label','ordersPerDay','aov','adBudgetPerDay','planRevenue','actualRevenue','projectedRevenue','projPct','status']),
    },
    {
      label: 'Working Capital CSV',
      desc: 'Monthly P&L, margin, funding gaps',
      fn: () => downloadCsv('working_capital.csv', wc, ['label','planRevenue','grossMargin','marketingSpend','inventoryInvestment','opsCost','netProfit','upfrontNeed']),
    },
    {
      label: 'Urgent POs CSV',
      desc: 'SKUs needing immediate procurement action',
      fn: () => downloadCsv('urgent_pos.csv', procurement.urgentItems, ['name','sku','current','vel','daysOfStock','eoq','suggestedQty','poDate','deliveryDate','estimatedPoValue','supplier','priority']),
    },
    {
      label: 'All SKUs CSV',
      desc: 'Full inventory velocity and reorder data',
      fn: () => downloadCsv('inventory_all.csv', procurement.items, ['name','sku','current','vel','daysOfStock','eoq','reorderPoint','suggestedQty','priority']),
    },
    {
      label: 'Order History CSV',
      desc: 'Raw Shopify order data (last 60d)',
      fn: () => downloadCsv('orders.csv', (shopifyOrders||[]).slice(0,5000).map(o => ({ id: o.id, date: o.created_at?.slice(0,10), revenue: o.total_price, email: o.email, items: (o.line_items||[]).length })), ['id','date','revenue','email','items']),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Export buttons */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Export Data</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {exports.map(e => (
            <button key={e.label} onClick={e.fn} className="flex items-center gap-3 px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:border-brand-500/40 hover:bg-gray-800 transition-all text-left">
              <Download size={16} className="text-brand-400 shrink-0"/>
              <div>
                <div className="text-xs font-semibold text-white">{e.label}</div>
                <div className="text-[10px] text-slate-500">{e.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Business Plan Notes</div>
          <button onClick={saveNotes} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all', savingNotes ? 'bg-emerald-600/20 text-emerald-400' : 'bg-brand-600 text-white hover:bg-brand-500')}>
            {savingNotes ? <><Check size={11}/>Saved!</> : <><Check size={11}/>Save Notes</>}
          </button>
        </div>
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-xs resize-none focus:outline-none focus:border-brand-500"
          rows={8}
          placeholder="Strategic notes, decisions, supplier contacts, team responsibilities, milestones... saved to your browser."
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {/* Manual overrides */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Manual Overrides / Custom KPIs</div>
        <div className="text-[10px] text-slate-500 mb-3">Store any key-value data that's not captured elsewhere — team targets, custom benchmarks, notes on specific months, etc.</div>
        <div className="flex gap-2 mb-3">
          <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" placeholder="Key (e.g. 'Mar ROAS target')" value={overrideKey} onChange={e => setOverrideKey(e.target.value)}/>
          <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" placeholder="Value" value={overrideValue} onChange={e => setOverrideValue(e.target.value)}/>
          <button onClick={addOverride} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500"><Plus size={13}/></button>
        </div>
        {Object.keys(plan.manualOverrides || {}).length === 0 ? (
          <div className="text-[10px] text-slate-600 text-center py-4">No custom overrides stored yet.</div>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(plan.manualOverrides || {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg">
                <span className="text-xs text-slate-400 font-semibold flex-1">{k}</span>
                <span className="text-xs text-white">{v}</span>
                <button onClick={() => removeOverride(k)} className="text-slate-600 hover:text-red-400"><X size={12}/></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── DATA PULL HEADER ───────────────────────────────────────────────── */
function DataPullHeader({ period, setPeriod, onPull, pullStatus, lastPullAt, uploadedOrders, onUpload, onClearUploaded }) {
  const fileRef = useRef(null);
  const periods = [7, 14, 30, 60, 90];
  const statusColor = pullStatus === 'loading' ? 'text-amber-400' : pullStatus === 'done' ? 'text-emerald-400' : pullStatus === 'error' ? 'text-red-400' : 'text-slate-500';

  const handleFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onUpload(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Period selector */}
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-slate-500"/>
          <span className="text-[10px] text-slate-500 font-medium">Analysis Period:</span>
          <div className="flex gap-1">
            {periods.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={clsx('px-2 py-1 rounded text-[10px] font-bold border transition-all', period === p ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-gray-800 text-slate-500 border-gray-700 hover:border-gray-600')}>
                {p}d
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-4 bg-gray-700"/>

        {/* Pull button */}
        <button onClick={onPull} disabled={pullStatus === 'loading'}
          className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all', pullStatus === 'loading' ? 'bg-amber-500/10 text-amber-400 border-amber-800/40 cursor-not-allowed' : 'bg-brand-600 text-white border-brand-500 hover:bg-brand-500')}>
          <Play size={11} className={pullStatus === 'loading' ? 'animate-pulse' : ''}/>
          {pullStatus === 'loading' ? 'Pulling...' : 'Pull Live Data'}
        </button>

        {/* Status */}
        {(pullStatus !== 'idle' || lastPullAt) && (
          <span className={clsx('text-[10px] font-medium', statusColor)}>
            {pullStatus === 'loading' ? 'Fetching Meta + Shopify...'
              : pullStatus === 'done'    ? `Pulled ${lastPullAt ? new Date(lastPullAt).toLocaleTimeString() : ''}`
              : pullStatus === 'error'   ? 'Pull failed — check Setup page'
              : lastPullAt ? `Last: ${new Date(lastPullAt).toLocaleTimeString()}` : ''}
          </span>
        )}

        <div className="flex-1"/>

        {/* Upload CSV */}
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile}/>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold border border-gray-700 bg-gray-800 text-slate-400 hover:text-slate-200 hover:border-gray-600 transition-all">
          <Upload size={11}/>Upload Orders CSV
        </button>
        {uploadedOrders.length > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
            <CheckCircle size={11}/>{uploadedOrders.length} orders uploaded
            <button onClick={onClearUploaded} className="text-slate-500 hover:text-red-400"><X size={10}/></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
export default function BusinessPlan() {
  const {
    shopifyOrders, inventoryMap, enrichedRows,
    brands, activeBrandIds,
    setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders,
  } = useStore();
  const [tab,            setTab]            = useState('command');
  const [period,         setPeriod]         = useState(30);
  const [pullStatus,     setPullStatus]     = useState('idle');
  const [lastPullAt,     setLastPullAt]     = useState(null);
  const [uploadedOrders, setUploadedOrders] = useState([]);

  const handleUpload = useCallback((text, filename) => {
    try {
      const parsed = parseOrdersCsv(text);
      setUploadedOrders(parsed);
      alert(`Loaded ${parsed.length} orders from ${filename}`);
    } catch (e) {
      alert('Could not parse CSV: ' + e.message);
    }
  }, []);

  // Pull live data for all active brands
  const handlePull = useCallback(async () => {
    const activeBrands = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    const configured   = activeBrands.filter(b => b.meta?.token && b.meta?.accounts?.some(a => a.id && a.key));
    if (!configured.length) {
      alert('No configured brands found. Please set up at least one brand in Setup → Meta Ads.');
      return;
    }
    setPullStatus('loading');
    try {
      await Promise.all(configured.map(async brand => {
        const { token, apiVersion: ver, accounts } = brand.meta;
        setBrandMetaStatus?.(brand.id, 'loading');

        const acctResults = await Promise.all(
          accounts.filter(a => a.id && a.key).map(acc =>
            pullAccount({ ver: ver || 'v21.0', token, accountKey: acc.key, accountId: acc.id })
              .catch(err => { console.warn('[BusinessPlan] pull failed:', acc.key, err.message); return null; })
          )
        );
        const valid = acctResults.filter(Boolean);
        if (valid.length) {
          setBrandMetaData?.(brand.id, {
            campaigns:     valid.flatMap(r => r.campaigns),
            adsets:        valid.flatMap(r => r.adsets),
            ads:           valid.flatMap(r => r.ads),
            insightsToday: valid.flatMap(r => r.insightsToday),
            insights7d:    valid.flatMap(r => r.insights7d),
            insights14d:   valid.flatMap(r => r.insights14d),
            insights30d:   valid.flatMap(r => r.insights30d),
          });
        }

        const { shop, clientId, clientSecret } = brand.shopify || {};
        if (shop && clientId && clientSecret) {
          try {
            const { map: inv, locations, skuToItemId, collections } = await fetchShopifyInventory(shop, clientId, clientSecret);
            setBrandInventory?.(brand.id, inv, locations, null, skuToItemId, collections);
          } catch (e) { console.warn('[BusinessPlan] inv failed:', e.message); }
          try {
            const since = new Date(Date.now() - 90 * 86400000).toISOString();
            const until = new Date().toISOString();
            const res   = await fetchShopifyOrders(shop, clientId, clientSecret, since, until);
            setBrandOrders?.(brand.id, res.orders, '90d');
          } catch (e) { console.warn('[BusinessPlan] orders failed:', e.message); }
        }
      }));
      setLastPullAt(Date.now());
      setPullStatus('done');
    } catch (err) {
      console.error('[BusinessPlan] pull error:', err);
      setPullStatus('error');
    }
  }, [brands, activeBrandIds, setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders]);

  const [plan, setPlan] = useState(() => {
    const stored = ls.get(null);
    if (!stored) return DEFAULT_PLAN;
    return {
      ...DEFAULT_PLAN, ...stored,
      months:    DEFAULT_PLAN.months.map((dm, i) => ({ ...dm, ...(stored.months?.[i] || {}) })),
      warehouses: stored.warehouses?.length ? stored.warehouses : DEFAULT_PLAN.warehouses,
      suppliers:  stored.suppliers?.length  ? stored.suppliers  : DEFAULT_PLAN.suppliers,
      collectionAlloc: stored.collectionAlloc || DEFAULT_PLAN.collectionAlloc,
      collectionRoas:  stored.collectionRoas  || DEFAULT_PLAN.collectionRoas,
      manualOverrides: stored.manualOverrides || {},
      notes: stored.notes || '',
    };
  });

  const savePlan = useCallback(updates => {
    setPlan(prev => {
      const next = { ...prev, ...updates };
      ls.set(next);
      return next;
    });
  }, []);

  const resetPlan = () => {
    if (confirm('Reset plan to default Excel targets? This cannot be undone.')) {
      ls.set(DEFAULT_PLAN); setPlan(DEFAULT_PLAN);
    }
  };

  // Merge uploaded + live orders; filter by selected period
  const allOrders      = useMemo(() => [...(shopifyOrders || []), ...uploadedOrders], [shopifyOrders, uploadedOrders]);
  const periodOrders   = useMemo(() => filterOrdersByPeriod(allOrders, period),        [allOrders, period]);

  const pva         = useMemo(() => buildPlanVsActual(plan, allOrders),               [plan, allOrders]);
  const predictions = useMemo(() => buildPredictions(plan, periodOrders),             [plan, periodOrders]);
  const adv         = useMemo(() => buildAdvancedPredictions(plan, periodOrders),     [plan, periodOrders]);
  const wc          = useMemo(() => buildWorkingCapital(plan, pva),                   [plan, pva]);
  const seasonality = useMemo(() => buildSeasonality(periodOrders),                   [periodOrders]);
  const cohorts     = useMemo(() => buildCohortMetrics(allOrders),                    [allOrders]);
  const metaCollections = useMemo(() => buildCollectionsFromMeta(enrichedRows),       [enrichedRows]);
  const creative    = useMemo(() => buildCreativeStrategy(plan, enrichedRows),        [plan, enrichedRows]);
  const procurement = useMemo(() => buildProcurementPlan(inventoryMap, allOrders, plan), [inventoryMap, allOrders, plan]);
  const stage       = useMemo(() => detectGrowthStage(predictions.avg7 || 0),         [predictions.avg7]);
  const roadmap     = useMemo(() => buildStageRoadmap(predictions.avg7 || 0, plan, pva, enrichedRows), [predictions.avg7, plan, pva, enrichedRows]);

  const yearTarget  = pva.reduce((s, m) => s + m.planRevenue, 0);
  const yearActual  = pva.reduce((s, m) => s + m.actualRevenue, 0);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-0.5">
            <h1 className="text-xl font-bold text-white">Business Plan</h1>
            <StageBadge stage={stage} size="sm"/>
          </div>
          <p className="text-xs text-slate-500">Deep predictions · Stage roadmap · Creative intel · Procurement · Working capital</p>
        </div>
        <button onClick={resetPlan} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-slate-400 rounded-lg text-xs hover:bg-gray-700 hover:text-slate-300 border border-gray-700">
          <RefreshCw size={12}/>Reset
        </button>
      </div>

      {/* Data pull header */}
      <DataPullHeader
        period={period} setPeriod={setPeriod}
        onPull={handlePull} pullStatus={pullStatus} lastPullAt={lastPullAt}
        uploadedOrders={uploadedOrders}
        onUpload={handleUpload}
        onClearUploaded={() => setUploadedOrders([])}
      />

      {/* Year summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Year Revenue Target" value={fmtRs(yearTarget)} sub="Mar–Dec 2026"/>
        <KpiCard label="Actual Revenue" value={fmtRs(yearActual)} sub="All loaded months" cls="text-emerald-400"/>
        <KpiCard label="Current Stage" value={stage?.name || '—'} sub={`${predictions.avg7||0}/day avg 7d`} cls="text-brand-300"/>
        <KpiCard label="Stage Readiness" value={`${roadmap.readiness}%`} sub={`${roadmap.metCount}/${roadmap.totalRequirements} metrics met`} cls={roadmap.readiness >= 75 ? 'text-emerald-400' : 'text-amber-400'}/>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900/60 rounded-xl p-1 border border-gray-800/50 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0',
                tab === t.id ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800/50')}>
              <Icon size={13}/>{t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'command'     && <TabCommand     plan={plan} pva={pva} predictions={predictions} shopifyOrders={allOrders} stage={stage}/>}
      {tab === 'predictions' && <TabPredictions plan={plan} adv={adv} seasonality={seasonality} cohorts={cohorts}/>}
      {tab === 'roadmap'     && <TabRoadmap     roadmap={roadmap}/>}
      {tab === 'revenue'     && <TabRevenue     plan={plan} pva={pva} savePlan={savePlan} shopifyOrders={shopifyOrders}/>}
      {tab === 'marketing'   && <TabMarketing   plan={plan} pva={pva} savePlan={savePlan} creative={creative} metaCollections={metaCollections}/>}
      {tab === 'procurement' && <TabProcurement plan={plan} savePlan={savePlan} procurement={procurement} shopifyOrders={shopifyOrders} inventoryMap={inventoryMap}/>}
      {tab === 'warehouse'   && <TabWarehouses  plan={plan} savePlan={savePlan}/>}
      {tab === 'capital'     && <TabCapital     plan={plan} wc={wc}/>}
      {tab === 'export'      && <TabExport      plan={plan} pva={pva} wc={wc} savePlan={savePlan} procurement={procurement} shopifyOrders={shopifyOrders}/>}
    </div>
  );
}
