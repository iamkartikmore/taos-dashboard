/**
 * Business Plan — Live plan vs actual · predictions · inventory intel · warehouses · working capital
 * Seeded from Taos Business Plan Excel (Mar–Dec 2026)
 * Tabs: Command Center · Revenue Plan · Marketing · Inventory Intel · Warehouses · Working Capital
 */
import { useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine,
} from 'recharts';
import {
  Zap, TrendingUp, Target, Package, Building2, Wallet,
  Plus, Trash2, Edit2, Check, X, AlertTriangle, CheckCircle,
  ArrowUp, ArrowDown, Minus, RefreshCw, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import {
  DEFAULT_PLAN, buildPlanVsActual, buildWeeklyBreakdown,
  buildMarketingNeeds, buildInventoryNeeds, buildWorkingCapital,
  buildPredictions, fmtRs, fmtK,
} from '../lib/businessPlanAnalytics';

/* ─── LOCALSTORAGE ───────────────────────────────────────────────────── */
const LS_KEY = 'taos_bplan_v1';
const ls = {
  get: (fb) => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : fb; } catch { return fb; } },
  set: (v)  => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {} },
};

/* ─── HELPERS ────────────────────────────────────────────────────────── */
const fmtPct = n => `${(parseFloat(n) || 0).toFixed(1)}%`;
const fmtN   = n => { const v = parseFloat(n) || 0; return v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(Math.round(v)); };

function DeltaBadge({ value, inverse = false }) {
  const n = parseFloat(value) || 0;
  const good = inverse ? n < 0 : n > 0;
  const cls = n === 0 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400';
  const Icon = n === 0 ? Minus : n > 0 ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${cls}`}><Icon size={10}/>{Math.abs(n).toFixed(1)}%</span>;
}

function KpiCard({ label, value, sub, delta, inverse, cls = '', warn }) {
  return (
    <div className={clsx('bg-gray-900/60 rounded-xl border px-4 py-3', warn ? 'border-red-800/40' : 'border-gray-800/50')}>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className={clsx('text-xl font-bold', cls || 'text-white')}>{value}</div>
      {(sub || delta != null) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
          {delta != null && <DeltaBadge value={delta} inverse={inverse} />}
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE = {
  'on-track': { pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30', dot: 'bg-emerald-400', label: 'On Track' },
  behind:     { pill: 'bg-amber-500/15  text-amber-400  border-amber-800/30',   dot: 'bg-amber-400',   label: 'Behind' },
  critical:   { pill: 'bg-red-500/15    text-red-400    border-red-800/30',      dot: 'bg-red-400',     label: 'Critical' },
  missed:     { pill: 'bg-red-900/30    text-red-300    border-red-800/30',      dot: 'bg-red-400',     label: 'Missed' },
  future:     { pill: 'bg-gray-800      text-slate-400  border-gray-700/40',     dot: 'bg-gray-600',    label: 'Upcoming' },
};

const INV_STATUS = {
  oos:      { pill: 'bg-red-900/30   text-red-300   border-red-800/40',     label: 'OOS',      color: '#ef4444' },
  critical: { pill: 'bg-red-500/15   text-red-400   border-red-800/30',     label: 'Critical', color: '#f87171' },
  low:      { pill: 'bg-amber-500/15 text-amber-400 border-amber-800/30',   label: 'Low',      color: '#f59e0b' },
  watch:    { pill: 'bg-yellow-500/10 text-yellow-400 border-yellow-800/30',label: 'Watch',    color: '#eab308' },
  ok:       { pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-800/30', label: 'OK',   color: '#22c55e' },
};

const COLLECTION_COLORS = { plants: '#22c55e', seeds: '#f59e0b', allMix: '#818cf8' };

/* ─── TABS ────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'command',   label: 'Command Center', icon: Zap },
  { id: 'revenue',   label: 'Revenue Plan',   icon: TrendingUp },
  { id: 'marketing', label: 'Marketing',      icon: Target },
  { id: 'inventory', label: 'Inventory Intel',icon: Package },
  { id: 'warehouse', label: 'Warehouses',     icon: Building2 },
  { id: 'capital',   label: 'Working Capital',icon: Wallet },
];

/* ─── CUSTOM TOOLTIP ─────────────────────────────────────────────────── */
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[130px]">
      <div className="text-slate-400 mb-1.5 font-medium">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-semibold">{typeof p.value === 'number' && p.value > 10000 ? fmtRs(p.value) : fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── TAB: COMMAND CENTER ─────────────────────────────────────────────── */
function TabCommand({ plan, pva, predictions, shopifyOrders }) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const current = pva.find(m => m.key === currentKey);

  const chartData = pva.map(m => ({
    label: m.label.slice(0, 3),
    Plan:  Math.round(m.planRevenue),
    Actual: m.isPast ? Math.round(m.actualRevenue) : null,
    Projected: m.isCurrentMonth ? Math.round(m.projectedRevenue) : null,
  }));

  const alerts = [];
  pva.forEach(m => {
    if (m.status === 'critical' || m.status === 'missed') {
      alerts.push({ type: 'error',   msg: `${m.label}: ${m.status === 'missed' ? 'missed target' : 'critical — only ' + fmtPct(m.projPct) + ' of target'}`, key: m.key });
    } else if (m.status === 'behind') {
      alerts.push({ type: 'warn', msg: `${m.label}: behind at ${fmtPct(m.projPct)} of target`, key: m.key });
    }
  });

  return (
    <div className="space-y-6">
      {/* KPI Row — Current Month */}
      {current ? (
        <>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-slate-300">{current.label} — Live Progress</span>
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', STATUS_STYLE[current.status]?.pill)}>
              <span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1.5', STATUS_STYLE[current.status]?.dot)} />
              {STATUS_STYLE[current.status]?.label}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Orders/Day (Actual)" value={current.actualOrdPerDay.toFixed(0)} sub={`Target: ${current.ordersPerDay}/day`} delta={current.actualOrdPerDay > 0 ? ((current.actualOrdPerDay - current.ordersPerDay) / current.ordersPerDay * 100) : null} />
            <KpiCard label="Revenue To Date" value={fmtRs(current.actualRevenue)} sub={`Target: ${fmtRs(current.planRevenue)}`} />
            <KpiCard label="Projected EOM Revenue" value={fmtRs(current.projectedRevenue)} sub={`Gap: ${fmtRs(current.gap)}`} cls={current.gap > 0 ? 'text-amber-400' : 'text-emerald-400'} />
            <KpiCard label="Days Remaining" value={`${current.daysRemaining}d`} sub={`${current.daysElapsed}d elapsed of ${current.days}`} />
          </div>
          {/* Progress bar */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-400">Month Completion</span>
              <span className="text-xs font-bold text-white">{fmtPct(current.projPct)}</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all', current.projPct >= 95 ? 'bg-emerald-500' : current.projPct >= 75 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${Math.min(current.projPct, 100)}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-600">{fmtRs(current.projectedRevenue)} projected</span>
              <span className="text-[10px] text-slate-600">{fmtRs(current.planRevenue)} target</span>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-6 text-center text-slate-500 text-sm">
          No plan data for current month (Apr 2026). Plan starts Mar 2026.
        </div>
      )}

      {/* Prediction panel */}
      {predictions.avg7 > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">AI Trend Engine</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">7-Day Avg Orders</div>
              <div className="text-lg font-bold text-white">{predictions.avg7}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">Trend</div>
              <div className="text-sm font-bold" style={{ color: predictions.trendColor }}>{predictions.trendLabel}</div>
              <div className="text-[10px] text-slate-500">{predictions.trend > 0 ? '+' : ''}{predictions.trend}% wow</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">EOM Projection</div>
              <div className="text-lg font-bold text-white">{fmtK(predictions.eomOrders)} orders</div>
              <div className="text-[10px] text-slate-500">{fmtRs(predictions.eomRevenue)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">vs Plan</div>
              <div className={clsx('text-lg font-bold', predictions.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {predictions.gapPct >= 0 ? '+' : ''}{predictions.gapPct}%
              </div>
            </div>
          </div>
          {/* 30-day trend sparkline */}
          {predictions.recentDays.length > 0 && (
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={predictions.recentDays}>
                <defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3}/>
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Area dataKey="orders" stroke="#818cf8" fill="url(#trendGrad)" strokeWidth={1.5} dot={false} animationDuration={400}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Plan vs Actual chart */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Annual Plan vs Actual</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<ChartTip />}/>
            <Bar dataKey="Plan"      fill="#334155" radius={[3,3,0,0]}/>
            <Bar dataKey="Actual"    fill="#22c55e" radius={[3,3,0,0]}/>
            <Bar dataKey="Projected" fill="#818cf8" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2">
          {[['Plan','#334155'],['Actual','#22c55e'],['Projected','#818cf8']].map(([l,c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="w-2 h-2 rounded-sm" style={{ background: c }}/>{l}
            </span>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-400">Alerts</div>
          {alerts.map(a => (
            <div key={a.key} className={clsx('flex items-start gap-2 px-3 py-2 rounded-lg text-xs border', a.type === 'error' ? 'bg-red-900/20 border-red-800/40 text-red-300' : 'bg-amber-900/20 border-amber-800/40 text-amber-300')}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0"/>
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {shopifyOrders.length === 0 && (
        <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4 text-xs text-amber-300">
          <AlertTriangle size={13} className="inline mr-1.5"/>
          No Shopify orders loaded — actual data will appear once orders are fetched from Setup page.
        </div>
      )}
    </div>
  );
}

/* ─── TAB: REVENUE PLAN ──────────────────────────────────────────────── */
function TabRevenue({ plan, pva, savePlan, shopifyOrders }) {
  const [editing, setEditing] = useState(null); // { idx, field, value }
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

  const totalPlanRev = pva.reduce((s, m) => s + m.planRevenue, 0);
  const totalActualRev = pva.reduce((s, m) => s + m.actualRevenue, 0);

  const weeklyData = useMemo(() => {
    if (expanded === null) return [];
    return buildWeeklyBreakdown(plan.months[expanded], shopifyOrders);
  }, [expanded, plan.months, shopifyOrders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Annual Revenue Plan</div>
          <div className="text-[10px] text-slate-500">Click any cell to edit targets. Data from Taos Business Plan.</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500">Year Target</div>
          <div className="text-sm font-bold text-white">{fmtRs(totalPlanRev)}</div>
          {totalActualRev > 0 && <div className="text-[10px] text-emerald-400">{fmtRs(totalActualRev)} actual</div>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800/50">
              {['Month','Orders/Day','AOV (₹)','Budget/Day','Plan Revenue','Actual','Status',''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pva.map((m, idx) => {
              const isExp = expanded === idx;
              return (
                <>
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors', m.isCurrentMonth && 'bg-brand-600/5')}>
                    <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                      {m.isCurrentMonth && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block mr-1.5"/>}
                      {m.label}
                    </td>
                    {/* Editable: ordersPerDay */}
                    <td className="px-3 py-2.5">
                      {editing?.idx === idx && editing?.field === 'ordersPerDay' ? (
                        <div className="flex items-center gap-1">
                          <input autoFocus className="w-20 bg-gray-800 border border-brand-500 rounded px-1.5 py-0.5 text-white text-xs" value={editing.value} onChange={e => setEditing(p => ({ ...p, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}/>
                          <button onClick={commitEdit}><Check size={12} className="text-emerald-400"/></button>
                          <button onClick={() => setEditing(null)}><X size={12} className="text-slate-500"/></button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(idx, 'ordersPerDay', m.ordersPerDay)} className="text-white hover:text-brand-300 transition-colors flex items-center gap-1 group">
                          {m.ordersPerDay.toLocaleString()}<Edit2 size={10} className="text-slate-600 opacity-0 group-hover:opacity-100"/>
                        </button>
                      )}
                    </td>
                    {/* Editable: aov */}
                    <td className="px-3 py-2.5">
                      {editing?.idx === idx && editing?.field === 'aov' ? (
                        <div className="flex items-center gap-1">
                          <input autoFocus className="w-20 bg-gray-800 border border-brand-500 rounded px-1.5 py-0.5 text-white text-xs" value={editing.value} onChange={e => setEditing(p => ({ ...p, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}/>
                          <button onClick={commitEdit}><Check size={12} className="text-emerald-400"/></button>
                          <button onClick={() => setEditing(null)}><X size={12} className="text-slate-500"/></button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(idx, 'aov', m.aov)} className="text-white hover:text-brand-300 transition-colors flex items-center gap-1 group">
                          ₹{m.aov}<Edit2 size={10} className="text-slate-600 opacity-0 group-hover:opacity-100"/>
                        </button>
                      )}
                    </td>
                    {/* Editable: adBudgetPerDay */}
                    <td className="px-3 py-2.5">
                      {editing?.idx === idx && editing?.field === 'adBudgetPerDay' ? (
                        <div className="flex items-center gap-1">
                          <input autoFocus className="w-24 bg-gray-800 border border-brand-500 rounded px-1.5 py-0.5 text-white text-xs" value={editing.value} onChange={e => setEditing(p => ({ ...p, value: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}/>
                          <button onClick={commitEdit}><Check size={12} className="text-emerald-400"/></button>
                          <button onClick={() => setEditing(null)}><X size={12} className="text-slate-500"/></button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(idx, 'adBudgetPerDay', m.adBudgetPerDay)} className="text-white hover:text-brand-300 transition-colors flex items-center gap-1 group">
                          {fmtRs(m.adBudgetPerDay)}<Edit2 size={10} className="text-slate-600 opacity-0 group-hover:opacity-100"/>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{fmtRs(m.planRevenue)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.actualRevenue > 0 ? (
                        <span className="text-emerald-400">{fmtRs(m.actualRevenue)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', STATUS_STYLE[m.status]?.pill)}>
                        {STATUS_STYLE[m.status]?.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setExpanded(isExp ? null : idx)} className="text-slate-500 hover:text-slate-300 transition-colors">
                        <ChevronRight size={14} className={clsx('transition-transform', isExp && 'rotate-90')}/>
                      </button>
                    </td>
                  </tr>
                  {isExp && (
                    <tr key={`${m.key}-weeks`}>
                      <td colSpan={8} className="px-3 py-4 bg-gray-900/40 border-b border-gray-800/30">
                        <div className="text-[10px] font-bold text-slate-400 mb-3">Weekly Breakdown — {m.label}</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-gray-700/40">
                                {['Week','Days','Target Orders','Target Rev','Budget','Actual Orders','%'].map(h => (
                                  <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {weeklyData.map(wk => (
                                  <tr key={wk.week} className="border-b border-gray-800/20">
                                    <td className="px-2 py-1.5 text-slate-400">{wk.label}<span className="text-slate-600 ml-1">({wk.dateRange})</span></td>
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
                              <Tooltip content={<ChartTip />}/>
                              <Bar dataKey="targetOrders" name="Target" fill="#334155" radius={[2,2,0,0]}/>
                              <Bar dataKey="actualOrders" name="Actual" fill="#22c55e" radius={[2,2,0,0]}/>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700/50 bg-gray-900/40">
              <td className="px-3 py-2.5 font-bold text-slate-300 text-xs">TOTAL 2026</td>
              <td colSpan={3}/>
              <td className="px-3 py-2.5 font-bold text-white text-xs">{fmtRs(totalPlanRev)}</td>
              <td className="px-3 py-2.5 font-bold text-emerald-400 text-xs">{totalActualRev > 0 ? fmtRs(totalActualRev) : '—'}</td>
              <td colSpan={2}/>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ─── TAB: MARKETING ─────────────────────────────────────────────────── */
function TabMarketing({ plan, pva, savePlan }) {
  const [editAlloc, setEditAlloc] = useState(false);
  const [allocDraft, setAllocDraft] = useState({ ...plan.collectionAlloc });
  const [editGlobals, setEditGlobals] = useState(false);
  const [globalsDraft, setGlobalsDraft] = useState({ cpr: plan.cpr, avgBudgetPerCampaign: plan.avgBudgetPerCampaign, avgCreativesPerCampaign: plan.avgCreativesPerCampaign });

  const mktData = useMemo(() => pva.map(m => buildMarketingNeeds(m, plan)), [pva, plan]);

  const saveAlloc = () => {
    const total = Object.values(allocDraft).reduce((s, v) => s + parseFloat(v), 0);
    if (Math.abs(total - 1) > 0.01) { alert('Allocations must sum to 100%'); return; }
    savePlan({ collectionAlloc: Object.fromEntries(Object.entries(allocDraft).map(([k, v]) => [k, parseFloat(v)])) });
    setEditAlloc(false);
  };

  const saveGlobals = () => {
    savePlan({
      cpr: parseFloat(globalsDraft.cpr) || plan.cpr,
      avgBudgetPerCampaign: parseFloat(globalsDraft.avgBudgetPerCampaign) || plan.avgBudgetPerCampaign,
      avgCreativesPerCampaign: parseFloat(globalsDraft.avgCreativesPerCampaign) || plan.avgCreativesPerCampaign,
    });
    setEditGlobals(false);
  };

  return (
    <div className="space-y-5">
      {/* Global settings */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Global Marketing Settings</div>
          <button onClick={() => setEditGlobals(v => !v)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
            <Edit2 size={11}/>{editGlobals ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {editGlobals ? (
          <div className="grid grid-cols-3 gap-3">
            {[['cpr','Avg CPR (₹)'],['avgBudgetPerCampaign','Avg Budget/Campaign (₹/day)'],['avgCreativesPerCampaign','Creatives/Campaign']].map(([field, label]) => (
              <div key={field}>
                <div className="text-[9px] text-slate-500 mb-1">{label}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={globalsDraft[field]} onChange={e => setGlobalsDraft(p => ({ ...p, [field]: e.target.value }))}/>
              </div>
            ))}
            <div className="col-span-3"><button onClick={saveGlobals} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500">Save</button></div>
          </div>
        ) : (
          <div className="flex gap-6 text-xs">
            <div><span className="text-slate-500">CPR:</span> <span className="text-white font-semibold">₹{plan.cpr}</span></div>
            <div><span className="text-slate-500">Budget/Campaign:</span> <span className="text-white font-semibold">₹{plan.avgBudgetPerCampaign.toLocaleString()}/day</span></div>
            <div><span className="text-slate-500">Creatives/Campaign:</span> <span className="text-white font-semibold">{plan.avgCreativesPerCampaign}</span></div>
          </div>
        )}
      </div>

      {/* Collection allocation */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Collection Allocation & ROAS</div>
          <button onClick={() => setEditAlloc(v => !v)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
            <Edit2 size={11}/>{editAlloc ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {editAlloc ? (
          <div className="space-y-3">
            {Object.entries(allocDraft).map(([key, val]) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-20 text-xs text-slate-300">{key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1)}</div>
                <input type="range" min="0" max="1" step="0.01" value={val} onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))} className="flex-1 accent-brand-500"/>
                <input className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center" value={(val * 100).toFixed(0)} onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) / 100 || 0 }))}/>
                <span className="text-[10px] text-slate-500">%</span>
                <div className="w-20 text-xs text-slate-400">ROAS: <span className="text-white">{plan.collectionRoas[key]?.toFixed(2)}</span></div>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-1 border-t border-gray-800/40">
              <div className="text-[10px] text-slate-500">Total: {(Object.values(allocDraft).reduce((s, v) => s + parseFloat(v), 0) * 100).toFixed(0)}%</div>
              <button onClick={saveAlloc} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500">Save Allocation</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            {Object.entries(plan.collectionAlloc).map(([key, pct]) => (
              <div key={key} className="flex-1 bg-gray-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLLECTION_COLORS[key] }}/>
                  <span className="text-xs font-semibold text-white">{key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1)}</span>
                </div>
                <div className="text-lg font-bold text-white">{Math.round(pct * 100)}%</div>
                <div className="text-[10px] text-slate-500">ROAS: {plan.collectionRoas[key]?.toFixed(2)}</div>
                <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: COLLECTION_COLORS[key] }}/>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly marketing table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800/50">
              {['Month','Budget/Day','Month Budget','Campaigns','Creatives','Blended ROAS','Exp. Results/Day','Exp. Revenue'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mktData.map((mk, i) => (
              <tr key={pva[i].key} className={clsx('border-b border-gray-800/30', pva[i].isCurrentMonth && 'bg-brand-600/5')}>
                <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{pva[i].label}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.adBudgetPerDay)}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                <td className="px-3 py-2.5 text-white font-semibold">{mk.campaigns}</td>
                <td className="px-3 py-2.5 text-white font-semibold">{mk.creatives}</td>
                <td className="px-3 py-2.5">
                  <span className="text-emerald-400 font-semibold">{mk.blendedRoas.toFixed(2)}x</span>
                </td>
                <td className="px-3 py-2.5 text-slate-300">{mk.expectedResults.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalExpectedRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── TAB: INVENTORY INTEL ───────────────────────────────────────────── */
function TabInventory({ plan, inventoryMap, shopifyOrders }) {
  const [filter, setFilter] = useState('all');
  const needs = useMemo(() => buildInventoryNeeds(inventoryMap, shopifyOrders), [inventoryMap, shopifyOrders]);

  const counts = useMemo(() => {
    const c = { oos: 0, critical: 0, low: 0, watch: 0, ok: 0 };
    needs.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [needs]);

  const filtered = filter === 'all' ? needs : needs.filter(r => r.status === filter);

  if (Object.keys(inventoryMap || {}).length === 0) {
    return (
      <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-10 text-center">
        <Package size={32} className="text-slate-600 mx-auto mb-3"/>
        <div className="text-sm text-slate-400 font-medium mb-1">No inventory data loaded</div>
        <div className="text-xs text-slate-600">Shopify inventory loads automatically from Setup page.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(INV_STATUS).map(([st, style]) => (
          <button key={st} onClick={() => setFilter(filter === st ? 'all' : st)}
            className={clsx('rounded-lg border p-3 text-center transition-all', filter === st ? style.pill : 'bg-gray-900/60 border-gray-800/50 text-slate-400 hover:border-gray-700')}>
            <div className="text-lg font-bold">{counts[st] || 0}</div>
            <div className="text-[10px] uppercase font-bold">{style.label}</div>
          </button>
        ))}
      </div>

      {needs.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-xs">No SKUs with velocity data yet. Place some orders!</div>
      )}

      {/* SKU Table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/50">
                {['SKU / Product','Status','Current Stock','Daily Velocity','Days of Stock','30d Demand','60d Demand','Reorder Qty','Action'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const st = INV_STATUS[r.status];
                return (
                  <tr key={r.sku} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-white truncate max-w-[160px]" title={r.name}>{r.name}</div>
                      <div className="text-[10px] text-slate-600 font-mono">{r.sku}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-bold', st.pill)}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-white font-semibold">{r.current.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.vel}/day</td>
                    <td className="px-3 py-2.5">
                      <span className={r.daysOfStock < 14 ? 'text-red-400 font-bold' : r.daysOfStock < 30 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>
                        {r.daysOfStock > 500 ? '∞' : `${r.daysOfStock}d`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{r.demandNext30.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.demandNext60.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      {r.reorderQty > 0
                        ? <span className="text-amber-400 font-bold">{r.reorderQty.toLocaleString()}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.status === 'oos' || r.status === 'critical' ? (
                        <span className="flex items-center gap-1 text-red-400 font-bold text-[10px]"><AlertTriangle size={10}/>REORDER NOW</span>
                      ) : r.status === 'low' ? (
                        <span className="flex items-center gap-1 text-amber-400 font-semibold text-[10px]"><AlertTriangle size={10}/>Plan Restock</span>
                      ) : r.status === 'watch' ? (
                        <span className="text-yellow-400 text-[10px]">Monitor</span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle size={10}/>Good</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── TAB: WAREHOUSES ────────────────────────────────────────────────── */
function TabWarehouses({ plan, savePlan }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({});

  const openNew = () => {
    const id = `wh_${Date.now()}`;
    setForm({ id, name: '', location: '', capacity: '', active: true, notes: '', skuCategories: '' });
    setEditing('new');
  };
  const openEdit = wh => { setForm({ ...wh }); setEditing(wh.id); };

  const save = () => {
    if (!form.name?.trim()) return;
    const wh = { ...form, capacity: parseInt(form.capacity) || 0 };
    const warehouses = editing === 'new'
      ? [...plan.warehouses, wh]
      : plan.warehouses.map(w => w.id === editing ? wh : w);
    savePlan({ warehouses });
    setEditing(null);
  };

  const remove = id => {
    if (!confirm('Remove this warehouse?')) return;
    savePlan({ warehouses: plan.warehouses.filter(w => w.id !== id) });
  };

  const toggle = id => {
    savePlan({ warehouses: plan.warehouses.map(w => w.id === id ? { ...w, active: !w.active } : w) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Warehouse Network</div>
          <div className="text-[10px] text-slate-500">{plan.warehouses.filter(w => w.active).length} active warehouses</div>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-500">
          <Plus size={13}/>Add Warehouse
        </button>
      </div>

      {editing && (
        <div className="bg-gray-900/80 rounded-xl border border-brand-500/30 p-4 space-y-3">
          <div className="text-xs font-bold text-slate-300 mb-2">{editing === 'new' ? 'New Warehouse' : 'Edit Warehouse'}</div>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Name *'],['location','Location'],['capacity','Capacity (units)'],['skuCategories','SKU Categories']].map(([field, label]) => (
              <div key={field}>
                <div className="text-[9px] text-slate-500 mb-1">{label}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={form[field] || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}/>
              </div>
            ))}
            <div className="col-span-2">
              <div className="text-[9px] text-slate-500 mb-1">Notes</div>
              <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}/>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="px-4 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-1.5 bg-gray-800 text-slate-300 rounded text-xs hover:bg-gray-700">Cancel</button>
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
            <div className="space-y-2">
              {wh.capacity > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Capacity</span>
                  <span className="text-white font-semibold">{wh.capacity.toLocaleString()} units</span>
                </div>
              )}
              {wh.skuCategories && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Categories</span>
                  <span className="text-slate-300 text-right max-w-[140px]">{wh.skuCategories}</span>
                </div>
              )}
              {wh.notes && (
                <div className="text-[10px] text-slate-500 bg-gray-800/40 rounded px-2 py-1.5 mt-2">{wh.notes}</div>
              )}
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

  const totalInvNeeded = wc.reduce((s, m) => s + m.inventoryInvestment, 0);
  const totalMktSpend  = wc.reduce((s, m) => s + m.marketingSpend, 0);
  const totalNetProfit = wc.reduce((s, m) => s + m.netProfit, 0);

  const chartData = wc.map(m => ({
    label:     m.label.slice(0, 3),
    Revenue:   Math.round(m.planRevenue),
    Marketing: Math.round(m.marketingSpend),
    Inventory: Math.round(m.inventoryInvestment),
    Ops:       Math.round(m.opsCost),
    Profit:    Math.round(m.netProfit),
  }));

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Inventory Investment" value={fmtRs(totalInvNeeded)} sub="20% of revenue" />
        <KpiCard label="Total Marketing Spend" value={fmtRs(totalMktSpend)} sub="Mar–Dec 2026" />
        <KpiCard label="Gross Profit (50% margin)" value={fmtRs(wc.reduce((s,m) => s + m.grossMargin, 0))} cls="text-emerald-400" />
        <KpiCard label="Net Profit (after all costs)" value={fmtRs(totalNetProfit)} cls={totalNetProfit > 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      {/* Scenario selector */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Working Capital Scenario</div>
          <div className="flex gap-2">
            {[20, 40, 60].map(p => (
              <button key={p} onClick={() => setScenario(p)} className={clsx('px-3 py-1 rounded-lg text-xs font-semibold border', scenario === p ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-gray-800 text-slate-400 border-gray-700 hover:border-gray-600')}>
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 mb-3">Showing scenario where {scenario}% of monthly revenue is available as working capital. Funding gap = upfront inventory + 30% of marketing — available capital.</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Total Capital Available</div>
            <div className="text-lg font-bold text-white">{fmtRs(wc.reduce((s, m) => s + m.scenarios.find(sc => sc.pct === scenario)?.capital || 0, 0))}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Total Funding Gap</div>
            <div className={clsx('text-lg font-bold', wc.reduce((s, m) => s + (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0), 0) > 0 ? 'text-red-400' : 'text-emerald-400')}>
              {fmtRs(wc.reduce((s, m) => s + (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0), 0))}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Months with Gap</div>
            <div className={clsx('text-lg font-bold', wc.filter(m => (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0) > 0).length > 0 ? 'text-amber-400' : 'text-emerald-400')}>
              {wc.filter(m => (m.scenarios.find(sc => sc.pct === scenario)?.gap || 0) > 0).length}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue flow chart */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Revenue Waterfall</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} stackOffset="sign">
            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<ChartTip />}/>
            <Bar dataKey="Revenue"   stackId="a" fill="#334155" radius={[0,0,0,0]}/>
            <Bar dataKey="Marketing" stackId="b" fill="#f59e0b" radius={[0,0,0,0]}/>
            <Bar dataKey="Inventory" stackId="b" fill="#818cf8" radius={[0,0,0,0]}/>
            <Bar dataKey="Ops"       stackId="b" fill="#64748b" radius={[0,0,0,0]}/>
            <Bar dataKey="Profit"    fill="#22c55e" radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2">
          {[['Revenue','#334155'],['Marketing','#f59e0b'],['Inventory','#818cf8'],['Ops','#64748b'],['Net Profit','#22c55e']].map(([l,c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="w-2 h-2 rounded-sm" style={{ background: c }}/>{l}
            </span>
          ))}
        </div>
      </div>

      {/* Monthly detail table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800/50">
              {['Month','Plan Revenue','Gross Margin','Mkt Spend','Inv Investment','Ops Cost','Net Profit',`Gap @${scenario}%`].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
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
                  <td className="px-3 py-2.5">
                    {sc?.gap > 0
                      ? <span className="text-red-400 font-bold">{fmtRs(sc.gap)}</span>
                      : <span className="text-emerald-400">Funded</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
export default function BusinessPlan() {
  const { shopifyOrders, inventoryMap } = useStore();
  const [tab, setTab] = useState('command');

  const [plan, setPlan] = useState(() => {
    const stored = ls.get(null);
    if (!stored) return DEFAULT_PLAN;
    return {
      ...DEFAULT_PLAN,
      ...stored,
      months: DEFAULT_PLAN.months.map((dm, i) => ({ ...dm, ...(stored.months?.[i] || {}) })),
      warehouses: stored.warehouses?.length ? stored.warehouses : DEFAULT_PLAN.warehouses,
      collectionAlloc: stored.collectionAlloc || DEFAULT_PLAN.collectionAlloc,
      collectionRoas:  stored.collectionRoas  || DEFAULT_PLAN.collectionRoas,
    };
  });

  const savePlan = useCallback(updates => {
    setPlan(prev => {
      const next = { ...prev, ...updates };
      ls.set(next);
      return next;
    });
  }, []);

  const resetPlan = () => { if (confirm('Reset plan to default Excel targets?')) { ls.set(DEFAULT_PLAN); setPlan(DEFAULT_PLAN); } };

  const pva         = useMemo(() => buildPlanVsActual(plan, shopifyOrders), [plan, shopifyOrders]);
  const predictions = useMemo(() => buildPredictions(plan, shopifyOrders), [plan, shopifyOrders]);
  const wc          = useMemo(() => buildWorkingCapital(plan, pva), [plan, pva]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Business Plan</h1>
          <p className="text-xs text-slate-500 mt-0.5">Live plan vs actual · Predictions · Inventory intel · Warehouses · Working capital</p>
        </div>
        <button onClick={resetPlan} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-slate-400 rounded-lg text-xs hover:bg-gray-700 hover:text-slate-300 border border-gray-700">
          <RefreshCw size={12}/>Reset to Defaults
        </button>
      </div>

      {/* Year summary strip */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Year Revenue Target" value={fmtRs(pva.reduce((s,m) => s + m.planRevenue, 0))} sub="Mar–Dec 2026" />
        <KpiCard label="Actual Revenue" value={fmtRs(pva.reduce((s,m) => s + m.actualRevenue, 0))} sub="All loaded months" cls="text-emerald-400"/>
        <KpiCard label="Peak Month Target" value={fmtRs(Math.max(...pva.map(m => m.planRevenue)))} sub="Dec 2026 — 4,128 orders/day" />
        <KpiCard label="Avg Daily Orders Target" value={Math.round(pva.reduce((s,m) => s + m.ordersPerDay, 0) / pva.length).toLocaleString()} sub="Mar–Dec avg" />
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
      {tab === 'command'   && <TabCommand   plan={plan} pva={pva} predictions={predictions} shopifyOrders={shopifyOrders}/>}
      {tab === 'revenue'   && <TabRevenue   plan={plan} pva={pva} savePlan={savePlan} shopifyOrders={shopifyOrders}/>}
      {tab === 'marketing' && <TabMarketing plan={plan} pva={pva} savePlan={savePlan}/>}
      {tab === 'inventory' && <TabInventory plan={plan} inventoryMap={inventoryMap} shopifyOrders={shopifyOrders}/>}
      {tab === 'warehouse' && <TabWarehouses plan={plan} savePlan={savePlan}/>}
      {tab === 'capital'   && <TabCapital   plan={plan} wc={wc}/>}
    </div>
  );
}
