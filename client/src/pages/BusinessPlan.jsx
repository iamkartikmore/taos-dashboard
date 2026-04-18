import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
  Zap, TrendingUp, Target, Package, Building2, Wallet,
  Plus, Trash2, Edit2, Check, X, AlertTriangle, CheckCircle,
  ArrowUp, ArrowDown, Minus, RefreshCw, ChevronRight, Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders } from '../lib/api';
import {
  DEFAULT_PLAN, buildPlanVsActual, buildWeeklyBreakdown,
  buildMarketingNeeds, buildInventoryNeeds, buildWorkingCapital,
  buildPredictions, parseOrdersCsv, fmtRs, fmtK,
} from '../lib/businessPlanAnalytics';

/* ─── BRAND-AWARE STORAGE ────────────────────────────────────────────── */
const lsKey = id => `taos_bplan_v7_${id || 'default'}`;
const lsGet = id => { try { const r = localStorage.getItem(lsKey(id)); return r ? JSON.parse(r) : null; } catch { return null; } };
const lsSet = (id, v) => { try { localStorage.setItem(lsKey(id), JSON.stringify(v)); } catch {} };

function hydrate(stored) {
  if (!stored) return DEFAULT_PLAN;
  return {
    ...DEFAULT_PLAN,
    ...stored,
    months: DEFAULT_PLAN.months.map((dm, i) => ({ ...dm, ...(stored.months?.[i] || {}) })),
    warehouses: stored.warehouses?.length ? stored.warehouses : DEFAULT_PLAN.warehouses,
    collectionAlloc: stored.collectionAlloc || DEFAULT_PLAN.collectionAlloc,
    collectionRoas:  stored.collectionRoas  || DEFAULT_PLAN.collectionRoas,
  };
}

/* ─── HELPERS ────────────────────────────────────────────────────────── */
const fmtPct = n => `${(parseFloat(n) || 0).toFixed(1)}%`;

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
          {delta != null && <DeltaBadge value={delta} inverse={inverse}/>}
        </div>
      )}
    </div>
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
  oos:      { pill: 'bg-red-900/30    text-red-300   border-red-800/40',      label: 'OOS',      color: '#ef4444' },
  critical: { pill: 'bg-red-500/15    text-red-400   border-red-800/30',      label: 'Critical', color: '#f87171' },
  low:      { pill: 'bg-amber-500/15  text-amber-400 border-amber-800/30',    label: 'Low',      color: '#f59e0b' },
  watch:    { pill: 'bg-yellow-500/10 text-yellow-400 border-yellow-800/30',  label: 'Watch',    color: '#eab308' },
  ok:       { pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-800/30', label: 'OK',     color: '#22c55e' },
};

const COLL_COLORS = { plants: '#22c55e', seeds: '#f59e0b', allMix: '#818cf8' };
const COLL_LABEL  = { plants: 'Plants', seeds: 'Seeds', allMix: 'All Mix' };

const TABS = [
  { id: 'command',   label: 'Command Center', icon: Zap },
  { id: 'revenue',   label: 'Revenue Plan',   icon: TrendingUp },
  { id: 'marketing', label: 'Marketing',      icon: Target },
  { id: 'inventory', label: 'Inventory Intel',icon: Package },
  { id: 'warehouse', label: 'Warehouses',     icon: Building2 },
  { id: 'capital',   label: 'Working Capital',icon: Wallet },
];

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[130px]">
      <div className="text-slate-400 mb-1.5 font-medium">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-semibold">{typeof p.value === 'number' && p.value > 10000 ? fmtRs(p.value) : typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── TAB: COMMAND CENTER ─────────────────────────────────────────────── */
function TabCommand({ plan, pva, predictions, allOrders }) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const current = pva.find(m => m.key === currentKey);

  const chartData = pva.map(m => ({
    label:     m.label.slice(0, 3),
    Plan:      Math.round(m.planRevenue),
    Actual:    m.isPast ? Math.round(m.actualRevenue) : null,
    Projected: m.isCurrentMonth ? Math.round(m.projectedRevenue) : null,
  }));

  const alerts = [];
  pva.forEach(m => {
    if (m.status === 'critical' || m.status === 'missed')
      alerts.push({ type: 'error', msg: `${m.label}: ${m.status === 'missed' ? 'missed target' : 'critical — only ' + fmtPct(m.projPct) + ' of target'}`, key: m.key });
    else if (m.status === 'behind')
      alerts.push({ type: 'warn', msg: `${m.label}: behind at ${fmtPct(m.projPct)} of target`, key: m.key });
  });

  return (
    <div className="space-y-5">
      {current ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-300">{current.label} — Live Progress</span>
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-medium', STATUS_STYLE[current.status]?.pill)}>
              <span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1.5', STATUS_STYLE[current.status]?.dot)}/>
              {STATUS_STYLE[current.status]?.label}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Orders/Day (Actual)" value={current.actualOrdPerDay.toFixed(0)}
              sub={`Target: ${current.ordersPerDay}/day`}
              delta={current.actualOrdPerDay > 0 ? ((current.actualOrdPerDay - current.ordersPerDay) / current.ordersPerDay * 100) : null}/>
            <KpiCard label="Revenue To Date" value={fmtRs(current.actualRevenue)} sub={`Target: ${fmtRs(current.planRevenue)}`}/>
            <KpiCard label="Projected EOM Revenue" value={fmtRs(current.projectedRevenue)}
              sub={`Gap: ${fmtRs(Math.abs(current.gap))}`}
              cls={current.gap > 0 ? 'text-amber-400' : 'text-emerald-400'}/>
            <KpiCard label="Days Remaining" value={`${current.daysRemaining}d`} sub={`${current.daysElapsed}d elapsed of ${current.days}`}/>
          </div>
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-400">Month Completion</span>
              <span className="text-xs font-bold text-white">{fmtPct(current.projPct)}</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all',
                current.projPct >= 95 ? 'bg-emerald-500' : current.projPct >= 75 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${Math.min(current.projPct, 100)}%` }}/>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-600">{fmtRs(current.projectedRevenue)} projected</span>
              <span className="text-[10px] text-slate-600">{fmtRs(current.planRevenue)} target</span>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-6 text-center text-slate-500 text-sm">
          Current month not in plan range. Plan covers {plan.months[0]?.label} – {plan.months[plan.months.length-1]?.label}.
        </div>
      )}

      {/* AI Trend Engine */}
      {predictions.avg7 > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-xs font-bold text-slate-300 mb-3">Trend Engine</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">7-Day Avg</div>
              <div className="text-xl font-bold text-white">{predictions.avg7}</div>
              <div className="text-[10px] text-slate-600">orders/day</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">Trend</div>
              <div className="text-sm font-bold" style={{ color: predictions.trendColor }}>{predictions.trendLabel}</div>
              <div className="text-[10px] text-slate-500">{predictions.trend > 0 ? '+' : ''}{predictions.trend}% wow</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">EOM Projection</div>
              <div className="text-lg font-bold text-white">{predictions.eomOrders?.toLocaleString()} orders</div>
              <div className="text-[10px] text-slate-500">{fmtRs(predictions.eomRevenue)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">vs Plan</div>
              <div className={clsx('text-xl font-bold', predictions.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {predictions.gapPct >= 0 ? '+' : ''}{predictions.gapPct}%
              </div>
            </div>
          </div>
          {predictions.recentDays?.length > 0 && (
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={predictions.recentDays}>
                <defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3}/>
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Area dataKey="orders" stroke="#818cf8" fill="url(#trendGrad)" strokeWidth={1.5} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
          {/* 4-month forecast */}
          {predictions.forecast?.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
              {predictions.forecast.map(f => (
                <div key={f.label} className="bg-gray-800/50 rounded-lg p-2.5 text-center">
                  <div className="text-[9px] text-slate-500 mb-1">{f.label}</div>
                  <div className="text-sm font-bold text-white">{f.forecastOrders?.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-500">{fmtRs(f.forecastRevenue)}</div>
                  <div className={clsx('text-[9px] font-semibold mt-0.5', f.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {f.gapPct >= 0 ? '+' : ''}{f.gapPct.toFixed(1)}% vs plan
                  </div>
                </div>
              ))}
            </div>
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
            <Tooltip content={<ChartTip/>}/>
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

      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-400">Alerts</div>
          {alerts.map(a => (
            <div key={a.key} className={clsx('flex items-start gap-2 px-3 py-2 rounded-lg text-xs border',
              a.type === 'error' ? 'bg-red-900/20 border-red-800/40 text-red-300' : 'bg-amber-900/20 border-amber-800/40 text-amber-300')}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0"/>{a.msg}
            </div>
          ))}
        </div>
      )}

      {allOrders.length === 0 && (
        <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4 text-xs text-amber-300">
          <AlertTriangle size={13} className="inline mr-1.5"/>
          No Shopify orders loaded — pull live data above or fetch orders from Setup page.
        </div>
      )}
    </div>
  );
}

/* ─── TAB: REVENUE PLAN ──────────────────────────────────────────────── */
function TabRevenue({ plan, pva, savePlan, allOrders }) {
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

  const totalPlanRev   = pva.reduce((s, m) => s + m.planRevenue, 0);
  const totalActualRev = pva.reduce((s, m) => s + m.actualRevenue, 0);

  const weeklyData = useMemo(() => {
    if (expanded === null) return [];
    return buildWeeklyBreakdown(plan.months[expanded], allOrders);
  }, [expanded, plan.months, allOrders]);

  function EditCell({ idx, field, value, display }) {
    if (editing?.idx === idx && editing?.field === field) {
      return (
        <div className="flex items-center gap-1">
          <input autoFocus className="w-20 bg-gray-800 border border-brand-500 rounded px-1.5 py-0.5 text-white text-xs"
            value={editing.value} onChange={e => setEditing(p => ({ ...p, value: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}/>
          <button onClick={commitEdit}><Check size={12} className="text-emerald-400"/></button>
          <button onClick={() => setEditing(null)}><X size={12} className="text-slate-500"/></button>
        </div>
      );
    }
    return (
      <button onClick={() => startEdit(idx, field, value)}
        className="text-white hover:text-brand-300 transition-colors flex items-center gap-1 group">
        {display}<Edit2 size={10} className="text-slate-600 opacity-0 group-hover:opacity-100"/>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">Annual Revenue Plan</div>
          <div className="text-[10px] text-slate-500">Click any cell to edit targets inline.</div>
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
              {['Month','Orders/Day','AOV (₹)','Budget/Day','Plan Revenue','Actual Revenue','Status',''].map(h => (
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
                    <td className="px-3 py-2.5">
                      <EditCell idx={idx} field="ordersPerDay" value={m.ordersPerDay} display={m.ordersPerDay.toLocaleString()}/>
                    </td>
                    <td className="px-3 py-2.5">
                      <EditCell idx={idx} field="aov" value={m.aov} display={`₹${m.aov}`}/>
                    </td>
                    <td className="px-3 py-2.5">
                      <EditCell idx={idx} field="adBudgetPerDay" value={m.adBudgetPerDay} display={fmtRs(m.adBudgetPerDay)}/>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{fmtRs(m.planRevenue)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.actualRevenue > 0 ? <span className="text-emerald-400">{fmtRs(m.actualRevenue)}</span> : <span className="text-slate-600">—</span>}
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
                                {['Week','Target Orders','Target Rev','Budget','Actual Ord','%'].map(h => (
                                  <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {weeklyData.map(wk => (
                                  <tr key={wk.week} className="border-b border-gray-800/20">
                                    <td className="px-2 py-1.5 text-slate-400">{wk.label} <span className="text-slate-600">({wk.dateRange})</span></td>
                                    <td className="px-2 py-1.5 text-white">{wk.targetOrders?.toLocaleString()}</td>
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
                              <YAxis tickFormatter={v => fmtK(v)} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} width={35}/>
                              <Tooltip content={<ChartTip/>}/>
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
              <td className="px-3 py-2.5 font-bold text-slate-300 text-xs">TOTAL</td>
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
  const [editAlloc, setEditAlloc]       = useState(false);
  const [allocDraft, setAllocDraft]     = useState({ ...plan.collectionAlloc });
  const [editGlobals, setEditGlobals]   = useState(false);
  const [globalsDraft, setGlobalsDraft] = useState({
    cpr: plan.cpr, avgBudgetPerCampaign: plan.avgBudgetPerCampaign, avgCreativesPerCampaign: plan.avgCreativesPerCampaign,
  });

  useEffect(() => { setAllocDraft({ ...plan.collectionAlloc }); }, [plan.collectionAlloc]);

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
      avgBudgetPerCampaign:    parseFloat(globalsDraft.avgBudgetPerCampaign)    || plan.avgBudgetPerCampaign,
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
            {[['cpr','Avg CPR (₹)'],['avgBudgetPerCampaign','Budget/Campaign (₹/day)'],['avgCreativesPerCampaign','Creatives/Campaign']].map(([field, label]) => (
              <div key={field}>
                <div className="text-[9px] text-slate-500 mb-1">{label}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs"
                  value={globalsDraft[field]} onChange={e => setGlobalsDraft(p => ({ ...p, [field]: e.target.value }))}/>
              </div>
            ))}
            <div className="col-span-3 flex gap-2 pt-1">
              <button onClick={saveGlobals} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500">Save</button>
              <button onClick={() => setEditGlobals(false)} className="px-3 py-1.5 bg-gray-700 text-slate-300 rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-6 text-xs">
            <div><span className="text-slate-500">CPR:</span> <span className="text-white font-semibold">₹{plan.cpr}</span></div>
            <div><span className="text-slate-500">Budget/Campaign:</span> <span className="text-white font-semibold">₹{(plan.avgBudgetPerCampaign||0).toLocaleString()}/day</span></div>
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
                <div className="w-16 text-xs text-slate-300">{COLL_LABEL[key] || key}</div>
                <input type="range" min="0" max="1" step="0.01" value={val}
                  onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                  className="flex-1 accent-brand-500"/>
                <input className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center"
                  value={(val * 100).toFixed(0)}
                  onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) / 100 || 0 }))}/>
                <span className="text-[10px] text-slate-500">%</span>
                <div className="w-24 text-xs text-slate-400">ROAS: <span className="text-white">{plan.collectionRoas?.[key]?.toFixed(2) || '—'}</span></div>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-800/40">
              <div className="text-[10px] text-slate-500">
                Total: {(Object.values(allocDraft).reduce((s, v) => s + parseFloat(v), 0) * 100).toFixed(0)}%
              </div>
              <button onClick={saveAlloc} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-500">Save</button>
              <button onClick={() => setEditAlloc(false)} className="px-3 py-1.5 bg-gray-700 text-slate-300 rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            {Object.entries(plan.collectionAlloc || {}).map(([key, pct]) => (
              <div key={key} className="flex-1 bg-gray-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLL_COLORS[key] || '#64748b' }}/>
                  <span className="text-xs font-semibold text-white">{COLL_LABEL[key] || key}</span>
                </div>
                <div className="text-xl font-bold text-white">{Math.round(pct * 100)}%</div>
                <div className="text-[10px] text-slate-500 mt-0.5">ROAS: {plan.collectionRoas?.[key]?.toFixed(2) || '—'}</div>
                <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: COLL_COLORS[key] || '#64748b' }}/>
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
              {['Month','Budget/Day','Month Budget','Campaigns','Creatives','Blended ROAS','Exp Orders/Day','Exp Revenue'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mktData.map((mk, i) => (
              <tr key={pva[i]?.key || i} className={clsx('border-b border-gray-800/30', pva[i]?.isCurrentMonth && 'bg-brand-600/5')}>
                <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{pva[i]?.label}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.adBudgetPerDay)}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                <td className="px-3 py-2.5 text-white font-semibold">{mk.campaigns}</td>
                <td className="px-3 py-2.5 text-white font-semibold">{mk.creatives}</td>
                <td className="px-3 py-2.5"><span className="text-emerald-400 font-semibold">{mk.blendedRoas?.toFixed(2)}x</span></td>
                <td className="px-3 py-2.5 text-slate-300">{mk.expectedResults?.toLocaleString()}</td>
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
function TabInventory({ inventoryMap, allOrders }) {
  const [filter, setFilter] = useState('all');
  const needs = useMemo(() => buildInventoryNeeds(inventoryMap, allOrders), [inventoryMap, allOrders]);

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
        <div className="text-xs text-slate-600">Pull live data from the panel above to load Shopify inventory.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(INV_STATUS).map(([st, style]) => (
          <button key={st} onClick={() => setFilter(filter === st ? 'all' : st)}
            className={clsx('rounded-lg border p-3 text-center transition-all',
              filter === st ? style.pill : 'bg-gray-900/60 border-gray-800/50 text-slate-400 hover:border-gray-700')}>
            <div className="text-lg font-bold">{counts[st] || 0}</div>
            <div className="text-[10px] uppercase font-bold">{style.label}</div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-xs">No SKUs matching this filter.</div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/50">
                {['SKU / Product','Status','Stock','Vel/Day','Days Left','30d Demand','60d Demand','Reorder Qty','Action'].map(h => (
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
                    <td className="px-3 py-2.5 text-white font-semibold">{r.current?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.vel}/day</td>
                    <td className="px-3 py-2.5">
                      <span className={r.daysOfStock < 14 ? 'text-red-400 font-bold' : r.daysOfStock < 30 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>
                        {r.daysOfStock > 500 ? '∞' : `${r.daysOfStock}d`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{r.demandNext30?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.demandNext60?.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      {r.reorderQty > 0 ? <span className="text-amber-400 font-bold">{r.reorderQty?.toLocaleString()}</span> : <span className="text-slate-600">—</span>}
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

  const openNew  = () => { setForm({ id: `wh_${Date.now()}`, name: '', location: '', capacity: '', active: true, notes: '', skuCategories: '' }); setEditing('new'); };
  const openEdit = wh => { setForm({ ...wh }); setEditing(wh.id); };
  const save = () => {
    if (!form.name?.trim()) return;
    const wh = { ...form, capacity: parseInt(form.capacity) || 0 };
    savePlan({ warehouses: editing === 'new' ? [...plan.warehouses, wh] : plan.warehouses.map(w => w.id === editing ? wh : w) });
    setEditing(null);
  };
  const remove = id => { if (!confirm('Remove this warehouse?')) return; savePlan({ warehouses: plan.warehouses.filter(w => w.id !== id) }); };
  const toggle = id => savePlan({ warehouses: plan.warehouses.map(w => w.id === id ? { ...w, active: !w.active } : w) });

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
          <div className="text-xs font-bold text-slate-300">{editing === 'new' ? 'New Warehouse' : 'Edit Warehouse'}</div>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Name *'],['location','Location'],['capacity','Capacity (units)'],['skuCategories','SKU Categories']].map(([field, label]) => (
              <div key={field}>
                <div className="text-[9px] text-slate-500 mb-1">{label}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs"
                  value={form[field] || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}/>
              </div>
            ))}
            <div className="col-span-2">
              <div className="text-[9px] text-slate-500 mb-1">Notes</div>
              <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs"
                value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}/>
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
                <button onClick={() => toggle(wh.id)} className={clsx('text-[9px] px-2 py-0.5 rounded-full font-bold border',
                  wh.active ? 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30' : 'bg-gray-800 text-slate-500 border-gray-700')}>
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
                  <span className="text-slate-300 text-right">{wh.skuCategories}</span>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Inventory Investment" value={fmtRs(totalInvNeeded)} sub={`${Math.round((plan.inventoryCostPct||0.2)*100)}% of revenue`}/>
        <KpiCard label="Total Marketing Spend" value={fmtRs(totalMktSpend)}/>
        <KpiCard label={`Gross Profit (${Math.round((plan.grossMarginPct||0.5)*100)}% margin)`} value={fmtRs(wc.reduce((s,m) => s + m.grossMargin, 0))} cls="text-emerald-400"/>
        <KpiCard label="Net Profit" value={fmtRs(totalNetProfit)} cls={totalNetProfit > 0 ? 'text-emerald-400' : 'text-red-400'}/>
      </div>

      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300">Working Capital Scenario</div>
          <div className="flex gap-2">
            {[20, 40, 60].map(p => (
              <button key={p} onClick={() => setScenario(p)}
                className={clsx('px-3 py-1 rounded-lg text-xs font-semibold border',
                  scenario === p ? 'bg-brand-600/20 text-brand-300 border-brand-500/40' : 'bg-gray-800 text-slate-400 border-gray-700 hover:border-gray-600')}>
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 mb-3">
          {scenario}% of monthly revenue available as working capital. Funding gap = upfront inventory + 30% marketing — available capital.
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Total Capital Available</div>
            <div className="text-lg font-bold text-white">{fmtRs(wc.reduce((s, m) => s + (m.scenarios?.find(sc => sc.pct === scenario)?.capital || 0), 0))}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Total Funding Gap</div>
            <div className={clsx('text-lg font-bold', wc.reduce((s, m) => s + (m.scenarios?.find(sc => sc.pct === scenario)?.gap || 0), 0) > 0 ? 'text-red-400' : 'text-emerald-400')}>
              {fmtRs(wc.reduce((s, m) => s + (m.scenarios?.find(sc => sc.pct === scenario)?.gap || 0), 0))}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 mb-1">Months with Gap</div>
            <div className={clsx('text-lg font-bold', wc.filter(m => (m.scenarios?.find(sc => sc.pct === scenario)?.gap || 0) > 0).length > 0 ? 'text-amber-400' : 'text-emerald-400')}>
              {wc.filter(m => (m.scenarios?.find(sc => sc.pct === scenario)?.gap || 0) > 0).length}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">Revenue Waterfall</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} stackOffset="sign">
            <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<ChartTip/>}/>
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

      <div className="overflow-x-auto rounded-xl border border-gray-800/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800/50">
              {['Month','Plan Revenue','Gross Margin','Mkt Spend','Inv Invest','Ops Cost','Net Profit',`Gap @${scenario}%`].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {wc.map(m => {
              const sc = m.scenarios?.find(s => s.pct === scenario);
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
                    {sc?.gap > 0 ? <span className="text-red-400 font-bold">{fmtRs(sc.gap)}</span> : <span className="text-emerald-400">Funded</span>}
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

/* ─── LIVE PULL PANEL ────────────────────────────────────────────────── */
function PullPanel({ isPulling, pullLog, pullProgress, onPull, lastPullAt, stats, onUpload }) {
  const fileRef = useRef();
  const hasData = stats.orders > 0 || stats.skus > 0;
  return (
    <div className={clsx('rounded-xl border p-3.5',
      isPulling ? 'border-brand-700/60 bg-brand-950/30' : hasData ? 'border-gray-800/50 bg-gray-900/40' : 'border-gray-800/40 bg-gray-900/30')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-bold text-white shrink-0">Live Data</span>
          {hasData && !isPulling && (
            <div className="flex items-center gap-2 text-[10px]">
              {stats.orders > 0 && <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.orders.toLocaleString()} orders</span>}
              {stats.skus > 0  && <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.skus} SKUs</span>}
              {stats.ads > 0   && <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.ads.toLocaleString()} ads</span>}
              {lastPullAt && <span className="text-slate-600">· {new Date(lastPullAt).toLocaleTimeString()}</span>}
            </div>
          )}
          {!hasData && !isPulling && <span className="text-[10px] text-slate-500">Pull to load live orders & inventory</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 border border-gray-700/60 text-slate-400 rounded-lg text-[10px] hover:bg-gray-700 hover:text-slate-200 transition-colors">
            <Upload size={10}/>CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = new FileReader(); r.onload = ev => onUpload(ev.target.result); r.readAsText(f); e.target.value = '';
          }}/>
          <button onClick={onPull} disabled={isPulling}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              isPulling ? 'bg-brand-800/50 text-brand-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40')}>
            <RefreshCw size={12} className={isPulling ? 'animate-spin' : ''}/>
            {isPulling ? 'Pulling…' : 'Pull Live Data'}
          </button>
        </div>
      </div>
      {isPulling && (
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>Fetching…</span><span className="text-brand-400 font-semibold">{pullProgress}%</span></div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500" style={{ width: `${pullProgress}%` }}/>
          </div>
        </div>
      )}
      {pullLog.length > 0 && (
        <div className="mt-3 space-y-0.5 max-h-28 overflow-y-auto">
          {pullLog.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                e.status === 'done' ? 'bg-emerald-400' : e.status === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse')}/>
              <span className={e.status === 'error' ? 'text-red-400' : e.status === 'done' ? 'text-slate-300' : 'text-slate-500'}>{e.msg}</span>
              {e.count != null && e.count > 0 && <span className="text-slate-600">· {e.count.toLocaleString()}</span>}
              <span className="text-slate-700 ml-auto shrink-0">{e.ts}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
export default function BusinessPlan() {
  const { shopifyOrders, inventoryMap, enrichedRows, brands, activeBrandIds,
    setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders } = useStore();

  const primaryBrandId = activeBrandIds[0] || 'default';
  const prevBrandId    = useRef(primaryBrandId);

  const [tab, setTab]                      = useState('command');
  const [isPulling, setIsPulling]          = useState(false);
  const [pullLog, setPullLog]              = useState([]);
  const [pullProgress, setPullProgress]    = useState(0);
  const [lastPullAt, setLastPullAt]        = useState(null);
  const [uploadedOrders, setUploadedOrders]= useState([]);

  const [plan, setPlan] = useState(() => hydrate(lsGet(primaryBrandId)));

  useEffect(() => {
    if (primaryBrandId !== prevBrandId.current) {
      prevBrandId.current = primaryBrandId;
      setPlan(hydrate(lsGet(primaryBrandId)));
      setUploadedOrders([]);
    }
  }, [primaryBrandId]);

  const savePlan = useCallback(updates => {
    setPlan(prev => {
      const next = { ...prev, ...updates };
      lsSet(primaryBrandId, next);
      return next;
    });
  }, [primaryBrandId]);

  const handlePull = useCallback(async () => {
    const active = brands.filter(b => activeBrandIds.includes(b.id));
    if (!active.length) return;
    setIsPulling(true); setPullLog([]); setPullProgress(0);
    const totalSteps = active.reduce((s, b) => s + (b.meta?.accounts?.filter(a => a.id && a.key).length || 0) + 2, 0);
    let done = 0;
    const tick = () => { done++; setPullProgress(Math.round((done / Math.max(totalSteps, 1)) * 100)); };

    for (const brand of active) {
      const { token, apiVersion: ver, accounts = [] } = brand.meta || {};
      const valid = accounts.filter(a => a.id && a.key);
      if (token && valid.length) {
        setBrandMetaStatus(brand.id, 'loading');
        const results = [];
        for (const acc of valid) {
          setPullLog(prev => [...prev, { msg: `Meta ${acc.key}…`, status: 'loading', ts: new Date().toLocaleTimeString() }]);
          try {
            const r = await pullAccount({ ver: ver || 'v21.0', token, accountKey: acc.key, accountId: acc.id });
            results.push(r);
            setPullLog(prev => [...prev.slice(0, -1), { msg: `${acc.key}: ${r.ads?.length || 0} ads`, count: r.ads?.length, status: 'done', ts: new Date().toLocaleTimeString() }]);
          } catch (e) {
            setPullLog(prev => [...prev.slice(0, -1), { msg: `${acc.key} failed: ${e.message}`, status: 'error', ts: new Date().toLocaleTimeString() }]);
          }
          tick();
        }
        if (results.length) {
          setBrandMetaData(brand.id, { campaigns: results.flatMap(r => r.campaigns), adsets: results.flatMap(r => r.adsets), ads: results.flatMap(r => r.ads), insightsToday: results.flatMap(r => r.insightsToday), insights7d: results.flatMap(r => r.insights7d), insights14d: results.flatMap(r => r.insights14d), insights30d: results.flatMap(r => r.insights30d) });
          setBrandMetaStatus(brand.id, 'success');
        }
      }
      const { shop, clientId, clientSecret } = brand.shopify || {};
      if (shop && clientId && clientSecret) {
        setPullLog(prev => [...prev, { msg: `Shopify inventory…`, status: 'loading', ts: new Date().toLocaleTimeString() }]);
        try {
          const { map, locations, skuToItemId, collections } = await fetchShopifyInventory(shop, clientId, clientSecret);
          setBrandInventory(brand.id, map, locations, null, skuToItemId, collections);
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Inventory: ${Object.keys(map).length} SKUs`, count: Object.keys(map).length, status: 'done', ts: new Date().toLocaleTimeString() }]);
        } catch (e) {
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Inventory failed: ${e.message}`, status: 'error', ts: new Date().toLocaleTimeString() }]);
        }
        tick();
        setPullLog(prev => [...prev, { msg: `Orders 180d…`, status: 'loading', ts: new Date().toLocaleTimeString() }]);
        try {
          const now = new Date(), since = new Date(now - 180 * 86400000).toISOString();
          const res = await fetchShopifyOrders(shop, clientId, clientSecret, since, now.toISOString());
          setBrandOrders(brand.id, res.orders, '180d');
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Orders: ${res.orders?.length || 0} (180d)`, count: res.orders?.length, status: 'done', ts: new Date().toLocaleTimeString() }]);
        } catch (e) {
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Orders failed: ${e.message}`, status: 'error', ts: new Date().toLocaleTimeString() }]);
        }
        tick();
      }
    }
    setPullProgress(100); setIsPulling(false); setLastPullAt(Date.now());
  }, [brands, activeBrandIds, setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders]);

  const handleUpload = useCallback(text => setUploadedOrders(prev => [...prev, ...parseOrdersCsv(text)]), []);

  const allOrders  = useMemo(() => [...(shopifyOrders || []), ...uploadedOrders], [shopifyOrders, uploadedOrders]);
  const pva        = useMemo(() => buildPlanVsActual(plan, allOrders), [plan, allOrders]);
  const predictions= useMemo(() => buildPredictions(plan, allOrders), [plan, allOrders]);
  const wc         = useMemo(() => buildWorkingCapital(plan, pva), [plan, pva]);

  const brand = brands.find(b => b.id === primaryBrandId);
  const stats = { orders: allOrders.length, skus: Object.keys(inventoryMap || {}).length, ads: enrichedRows?.length || 0 };

  const totalPlanRev = pva.reduce((s, m) => s + m.planRevenue, 0);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {brand?.name || 'TAOS'} — Business Plan
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {plan.months[0]?.label} – {plan.months[plan.months.length - 1]?.label} · Live plan vs actual · Predictions · Inventory · Working capital
          </p>
        </div>
        <button onClick={() => { if (confirm('Reset plan to defaults?')) { lsSet(primaryBrandId, DEFAULT_PLAN); setPlan(DEFAULT_PLAN); } }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-slate-400 rounded-lg text-xs hover:bg-gray-700 hover:text-slate-300 border border-gray-700">
          <RefreshCw size={12}/>Reset
        </button>
      </div>

      {/* Year summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Year Revenue Target" value={fmtRs(totalPlanRev)} sub={`${plan.months[0]?.label} – ${plan.months[plan.months.length-1]?.label}`}/>
        <KpiCard label="Actual Revenue" value={fmtRs(pva.reduce((s, m) => s + m.actualRevenue, 0))} cls="text-emerald-400" sub="all loaded months"/>
        <KpiCard label="Peak Month Target" value={fmtRs(Math.max(...pva.map(m => m.planRevenue)))} sub={`${plan.months[plan.months.length-1]?.ordersPerDay?.toLocaleString()} orders/day`}/>
        <KpiCard label="7-Day Orders/Day" value={predictions.avg7 > 0 ? predictions.avg7 : '—'} sub={predictions.avg7 > 0 ? predictions.trendLabel : 'pull data to unlock'} cls={predictions.avg7 > 0 ? 'text-white' : 'text-slate-500'}/>
      </div>

      {/* Live pull panel */}
      <PullPanel isPulling={isPulling} pullLog={pullLog} pullProgress={pullProgress}
        onPull={handlePull} lastPullAt={lastPullAt} stats={stats} onUpload={handleUpload}/>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900/60 rounded-xl p-1 border border-gray-800/50 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0',
              tab === t.id ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800/50')}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {tab === 'command'   && <TabCommand   plan={plan} pva={pva} predictions={predictions} allOrders={allOrders}/>}
      {tab === 'revenue'   && <TabRevenue   plan={plan} pva={pva} savePlan={savePlan} allOrders={allOrders}/>}
      {tab === 'marketing' && <TabMarketing plan={plan} pva={pva} savePlan={savePlan}/>}
      {tab === 'inventory' && <TabInventory inventoryMap={inventoryMap} allOrders={allOrders}/>}
      {tab === 'warehouse' && <TabWarehouses plan={plan} savePlan={savePlan}/>}
      {tab === 'capital'   && <TabCapital   plan={plan} wc={wc}/>}
    </div>
  );
}
