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
  DEFAULT_PLAN, GENERIC_PLAN, buildPlanVsActual, buildWeeklyBreakdown,
  buildMarketingNeeds, buildInventoryNeeds, buildWorkingCapital,
  buildPredictions, parseOrdersCsv, fmtRs, fmtK,
  buildCurrentConstraint, buildBreakingPoints, buildRTOModel,
  buildContributionStack, buildBCGMatrix, buildGrowthAdjustedInventory,
  buildWeeklyMarketingTracker, buildMonthlyMarketingActuals,
  buildCreativeHealth, buildLTVCAC, buildMcKinseyDecomp,
  parseWarehouseTags,
} from '../lib/businessPlanAnalytics';

/* ─── BRAND-AWARE STORAGE ────────────────────────────────────────────── */
const lsKey = id => `taos_bplan_v7_${id || 'default'}`;
const lsGet = id => { try { const r = localStorage.getItem(lsKey(id)); return r ? JSON.parse(r) : null; } catch { return null; } };
const lsSet = (id, v) => { try { localStorage.setItem(lsKey(id), JSON.stringify(v)); } catch {} };

const TAOS_COLL_KEYS = new Set(['plants', 'seeds', 'allMix']);

function hydrate(stored, brandName) {
  const isTaos = !brandName || brandName.toLowerCase().includes('taos');
  const seed   = isTaos ? DEFAULT_PLAN : GENERIC_PLAN;
  if (!stored) return { ...seed };
  // If a non-TAOS brand has TAOS collection keys saved (stale data), wipe them
  const storedCollKeys = Object.keys(stored.collectionAlloc || {});
  const staleCollections = !isTaos && storedCollKeys.length > 0 &&
    storedCollKeys.every(k => TAOS_COLL_KEYS.has(k));
  return {
    ...seed,
    ...stored,
    months: seed.months.map((dm, i) => ({ ...dm, ...(stored.months?.[i] || {}) })),
    warehouses: stored.warehouses?.length ? stored.warehouses : seed.warehouses,
    collectionAlloc: staleCollections ? seed.collectionAlloc : (stored.collectionAlloc || seed.collectionAlloc),
    collectionRoas:  staleCollections ? seed.collectionRoas  : (stored.collectionRoas  || seed.collectionRoas),
  };
}

/* Period → since Date */
const PERIOD_OPTIONS = [
  { id: '7d',   label: '7 Days' },
  { id: '14d',  label: '14 Days' },
  { id: '30d',  label: '30 Days' },
  { id: 'last-month', label: 'Last Month' },
  { id: '90d',  label: '90 Days' },
  { id: '180d', label: '6 Months' },
  { id: '365d', label: '1 Year' },
];

function periodToSince(period) {
  const now = new Date();
  if (period === '7d')   return new Date(now - 7   * 86400000);
  if (period === '14d')  return new Date(now - 14  * 86400000);
  if (period === '30d')  return new Date(now - 30  * 86400000);
  if (period === '90d')  return new Date(now - 90  * 86400000);
  if (period === '180d') return new Date(now - 180 * 86400000);
  if (period === '365d') return new Date(now - 365 * 86400000);
  if (period === 'last-month') {
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }
  return new Date(now - 90 * 86400000); // default 90d
}

function chunkDateRange(sinceMs, nowMs, chunkMs = 30 * 86400000) {
  const chunks = [];
  let start = sinceMs;
  while (start < nowMs) {
    const end = Math.min(start + chunkMs, nowMs);
    chunks.push([new Date(start).toISOString(), new Date(end).toISOString()]);
    start = end + 1000;
  }
  return chunks;
}

/* ─── HELPERS ────────────────────────────────────────────────────────── */
const fmtPct = n => `${(parseFloat(n) || 0).toFixed(1)}%`;

function DeltaBadge({ value, inverse = false }) {
  const n = parseFloat(value) || 0;
  const good = inverse ? n < 0 : n > 0;
  const cls = n === 0 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400';
  const Icon = n === 0 ? Minus : n > 0 ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${cls}`}><Icon size={11}/>{Math.abs(n).toFixed(1)}%</span>;
}

function KpiCard({ label, value, sub, delta, inverse, cls = '', warn }) {
  return (
    <div className={clsx('bg-gray-900/60 rounded-xl border px-5 py-4', warn ? 'border-red-800/40' : 'border-gray-800/50')}>
      <div className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wide">{label}</div>
      <div className={clsx('text-2xl font-bold leading-tight', cls || 'text-white')}>{value}</div>
      {(sub || delta != null) && (
        <div className="flex items-center gap-2 mt-1">
          {sub && <span className="text-xs text-slate-500">{sub}</span>}
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
function TabCommand({ plan, pva, predictions, allOrders, constraint, breaking, bcgMatrix }) {
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
            <span className="text-sm font-bold text-slate-200">{current.label} — Live Progress</span>
            <span className={clsx('text-xs px-2.5 py-0.5 rounded-full border font-semibold', STATUS_STYLE[current.status]?.pill)}>
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
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
          <div className="text-sm font-semibold text-slate-200 mb-4">Trend Engine</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">7-Day Avg</div>
              <div className="text-2xl font-bold text-white">{predictions.avg7}</div>
              <div className="text-xs text-slate-500">orders/day</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">Trend</div>
              <div className="text-base font-bold" style={{ color: predictions.trendColor }}>{predictions.trendLabel}</div>
              <div className="text-xs text-slate-500">{predictions.trend > 0 ? '+' : ''}{predictions.trend}% wow</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">EOM Projection</div>
              <div className="text-xl font-bold text-white">{predictions.eomOrders?.toLocaleString()}</div>
              <div className="text-xs text-slate-500">{fmtRs(predictions.eomRevenue)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">vs Plan</div>
              <div className={clsx('text-2xl font-bold', predictions.gapPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
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
        <div className="text-sm font-semibold text-slate-200 mb-4">Annual Plan vs Actual</div>
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

      {/* Theory of Constraints — Current Bottleneck */}
      {constraint?.length > 0 && (() => {
        const now = new Date();
        const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const cur = constraint.find(c => c.key === currentKey) || constraint[0];
        const DEPT_COLORS = { marketing: '#f59e0b', ops: '#818cf8', inventory: '#ef4444', capital: '#06b6d4', logistics: '#f97316' };
        return (
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-slate-200">Constraint Analysis — {cur.month}</div>
              <span className="text-xs px-3 py-1 rounded-lg bg-red-500/15 text-red-400 border border-red-800/30 font-bold">
                Bottleneck: {cur.topConstraint.charAt(0).toUpperCase() + cur.topConstraint.slice(1)} · Score {cur.topScore}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-3 mb-5">
              {cur.allScoresSorted.map(([dept, score]) => (
                <div key={dept} className="text-center">
                  <div className="text-xs text-slate-400 capitalize mb-2 font-medium">{dept}</div>
                  <div className="h-20 bg-gray-800/50 rounded-lg flex items-end overflow-hidden">
                    <div className="w-full rounded-b-lg transition-all"
                      style={{ height: `${score}%`, background: DEPT_COLORS[dept] || '#64748b', opacity: dept === cur.topConstraint ? 1 : 0.4 }}/>
                  </div>
                  <div className="text-sm font-bold mt-1.5" style={{ color: DEPT_COLORS[dept] }}>{score}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-800/40 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wide">5 Focusing Steps (Goldratt)</div>
              <div className="space-y-2">
                {cur.focusingSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="text-brand-400 font-bold shrink-0 w-4">{i+1}.</span>
                    <span className="text-slate-300 leading-relaxed">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Breaking Points Timeline */}
      {breaking?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
          <div className="text-sm font-semibold text-slate-200 mb-4">Breaking Points — Action Timeline</div>
          <div className="space-y-2.5">
            {breaking.slice(0, 8).map((bp, i) => (
              <div key={i} className={clsx('flex items-start gap-3 p-4 rounded-xl border',
                bp.severity === 'CRITICAL' ? 'bg-red-900/10 border-red-800/25' : 'bg-amber-900/8 border-amber-800/20')}>
                <div className={clsx('w-2 h-2 rounded-full mt-1.5 shrink-0',
                  bp.severity === 'CRITICAL' ? 'bg-red-400' : 'bg-amber-400')}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={clsx('text-[11px] px-2 py-0.5 rounded-md font-bold border shrink-0',
                      bp.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border-red-700/40' : 'bg-amber-500/20 text-amber-400 border-amber-700/40')}>
                      {bp.severity}
                    </span>
                    <span className="text-[11px] font-bold text-white">{bp.dept}</span>
                    <span className="text-[11px] text-slate-500 ml-auto shrink-0">{bp.breakLabel}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-200 mb-0.5">{bp.title}</div>
                  <div className="text-xs text-slate-400">{bp.detail}</div>
                  <div className="text-xs text-brand-400 font-semibold mt-1.5">Action: {bp.action}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BCG Matrix Mini — Command Center preview */}
      {bcgMatrix?.matrix?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
          <div className="text-sm font-semibold text-slate-200 mb-4">Portfolio Matrix — Collections</div>
          <div className="grid grid-cols-3 gap-3">
            {bcgMatrix.matrix.map(p => (
              <div key={p.collection} className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/30">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }}/>
                  <div>
                    <div className="text-sm font-bold" style={{ color: p.color }}>{p.label}</div>
                    <div className="text-xs text-slate-500">{p.quadrant.name}</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-slate-500">Rev share</span><span className="text-white font-semibold">{p.shareX}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">MoM growth</span><span className="text-emerald-400 font-semibold">+{p.growthY}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">ROAS</span><span className="text-white font-semibold">{p.roas}x</span></div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-gray-700/30 text-xs text-brand-400 font-medium leading-snug">{p.quadrant.action.split('—')[0]}</div>
              </div>
            ))}
          </div>
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
          <div className="text-sm font-semibold text-slate-200">Annual Revenue Plan</div>
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

/* ─── TAB: MARKETING — Phase 2 + 3 ──────────────────────────────────── */
const MKT_SUBTABS = [
  { id: 'weekly',      label: 'Weekly Tracker' },
  { id: 'monthly',     label: 'Monthly Plan' },
  { id: 'collections', label: 'Collections' },
  { id: 'creatives',   label: 'Creatives' },
  { id: 'ltv',         label: 'LTV & McKinsey' },
];

const STATUS_DOT = {
  'on-track': 'bg-emerald-400',
  behind:     'bg-amber-400',
  critical:   'bg-red-400',
  future:     'bg-gray-600',
};
const STATUS_ROW = {
  'on-track': 'bg-emerald-500/5',
  behind:     'bg-amber-500/5',
  critical:   'bg-red-500/8',
  future:     '',
};
const STATUS_PILL = {
  'on-track': 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30',
  behind:     'bg-amber-500/15  text-amber-400  border-amber-800/30',
  critical:   'bg-red-500/15    text-red-400    border-red-800/30',
  future:     'bg-gray-800      text-slate-500  border-gray-700',
};
const STATUS_LABEL = { 'on-track': 'On Track', behind: 'Behind', critical: 'Critical', future: 'Upcoming' };

function StatusPill({ status }) {
  return (
    <span className={clsx('text-[11px] px-2 py-0.5 rounded-md border font-semibold whitespace-nowrap', STATUS_PILL[status] || STATUS_PILL.future)}>
      <span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1.5', STATUS_DOT[status] || 'bg-gray-600')}/>
      {STATUS_LABEL[status] || 'Upcoming'}
    </span>
  );
}

function MktPct({ pct, future }) {
  if (future || !pct) return <span className="text-slate-600">—</span>;
  const col = pct >= 90 ? 'text-emerald-400' : pct >= 65 ? 'text-amber-400' : 'text-red-400';
  return <span className={clsx('font-semibold', col)}>{pct}%</span>;
}

function TabMarketing({ plan, pva, savePlan, bcgMatrix, allOrders, enrichedRows }) {
  const [mktTab,       setMktTab]       = useState('weekly');
  const [editAlloc,    setEditAlloc]    = useState(false);
  const [allocDraft,   setAllocDraft]   = useState({ ...plan.collectionAlloc });
  const [editGlobals,  setEditGlobals]  = useState(false);
  const [globalsDraft, setGlobalsDraft] = useState({ cpr: plan.cpr, avgBudgetPerCampaign: plan.avgBudgetPerCampaign, avgCreativesPerCampaign: plan.avgCreativesPerCampaign });

  useEffect(() => { setAllocDraft({ ...plan.collectionAlloc }); }, [plan.collectionAlloc]);

  const weeklyData  = useMemo(() => buildWeeklyMarketingTracker({ plan, allOrders, enrichedRows }), [plan, allOrders, enrichedRows]);
  const monthlyData = useMemo(() => buildMonthlyMarketingActuals({ plan, allOrders, enrichedRows }), [plan, allOrders, enrichedRows]);
  const creatives   = useMemo(() => buildCreativeHealth({ enrichedRows, plan }), [enrichedRows, plan]);
  const ltvData     = useMemo(() => buildLTVCAC({ plan, allOrders }), [plan, allOrders]);
  const mcKData     = useMemo(() => buildMcKinseyDecomp({ plan, pva }), [plan, pva]);
  const mktData     = useMemo(() => pva.map(m => buildMarketingNeeds(m, plan)), [pva, plan]);

  const curMonth  = monthlyData.find(m => m.isCurrent) || monthlyData.find(m => m.isFuture) || monthlyData[0] || {};
  const curWeeks  = weeklyData.filter(w => w.isCurrent || (w.monthKey === curMonth.key && !w.isFuture));

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

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="This Month Budget" value={fmtRs(curMonth.targetSpend || 0)} sub={curMonth.actualSpend > 0 ? `Actual: ${fmtRs(curMonth.actualSpend)}` : 'No spend data'}/>
        <KpiCard label="Orders Pacing" value={curMonth.hasData ? `${curMonth.ordersPct || 0}%` : '—'}
          cls={curMonth.ordersPct >= 90 ? 'text-emerald-400' : curMonth.ordersPct >= 65 ? 'text-amber-400' : curMonth.hasData ? 'text-red-400' : 'text-slate-500'}
          sub={`${(curMonth.actualOrders||0).toLocaleString()} / ${(curMonth.targetOrders||0).toLocaleString()} orders`}/>
        <KpiCard label="Blended ROAS" value={curMonth.actualROAS > 0 ? `${curMonth.actualROAS}x` : '—'}
          sub={`Target: ${curMonth.targetROAS || 0}x`}
          cls={curMonth.actualROAS >= (curMonth.targetROAS||4) ? 'text-emerald-400' : curMonth.actualROAS > 0 ? 'text-amber-400' : 'text-slate-500'}/>
        <KpiCard label="CAC" value={curMonth.actualCAC > 0 ? `₹${curMonth.actualCAC}` : '—'}
          sub={`Target: ₹${curMonth.targetCAC || plan.cpr || 55}`}
          cls={curMonth.actualCAC > 0 && curMonth.actualCAC <= (curMonth.targetCAC||plan.cpr||55) ? 'text-emerald-400' : curMonth.actualCAC > 0 ? 'text-red-400' : 'text-slate-500'}/>
      </div>

      {/* ── Sub-tab bar ── */}
      <div className="flex gap-1 bg-gray-900/60 rounded-xl p-1 border border-gray-800/50 overflow-x-auto scrollbar-none">
        {MKT_SUBTABS.map(t => (
          <button key={t.id} onClick={() => setMktTab(t.id)}
            className={clsx('px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
              mktTab === t.id ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800/50')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          SUB-TAB: WEEKLY TRACKER
         ══════════════════════════════════════════════════════════ */}
      {mktTab === 'weekly' && (
        <div className="space-y-4">
          {/* Current week highlight */}
          {(() => {
            const cw = weeklyData.find(w => w.isCurrent);
            if (!cw) return null;
            return (
              <div className="bg-brand-600/10 rounded-xl border border-brand-500/30 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Current Week — {cw.dateRange}</div>
                    <div className="text-xs text-slate-500">{cw.monthLabel}</div>
                  </div>
                  <StatusPill status={cw.status}/>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { l: 'Orders', v: cw.actualOrders, t: cw.targetOrders, pct: cw.ordersPct, unit: '' },
                    { l: 'Ad Spend', v: fmtRs(cw.actualSpend), t: fmtRs(cw.targetSpend), pct: cw.spendPct, unit: '' },
                    { l: 'ROAS', v: cw.actualROAS > 0 ? `${cw.actualROAS}x` : '—', t: `${cw.targetROAS}x`, pct: null, unit: '' },
                    { l: 'CAC', v: cw.actualCAC > 0 ? `₹${cw.actualCAC}` : '—', t: `₹${cw.targetCAC}`, pct: null, unit: '' },
                  ].map(item => (
                    <div key={item.l} className="bg-gray-900/60 rounded-lg p-3">
                      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">{item.l}</div>
                      <div className="text-xl font-bold text-white">{item.v}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Target: {item.t}</div>
                      {item.pct != null && (
                        <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className={clsx('h-full rounded-full', item.pct >= 90 ? 'bg-emerald-500' : item.pct >= 65 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${Math.min(item.pct, 100)}%` }}/>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 16-week table */}
          <div className="overflow-x-auto rounded-xl border border-gray-800/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/50 bg-gray-900/40">
                  {['Week','Dates','Month','Status','Orders (A/T)','Pacing','Spend (A/T)','ROAS (A/T)','CAC'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyData.map((w, i) => (
                  <tr key={i} className={clsx('border-b border-gray-800/25 transition-colors',
                    w.isCurrent ? 'bg-brand-600/8 border-brand-800/30' : STATUS_ROW[w.status],
                    'hover:bg-gray-800/20')}>
                    <td className="px-3 py-2.5 font-bold text-white whitespace-nowrap">{w.label}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{w.dateRange}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">{w.monthLabel}</td>
                    <td className="px-3 py-2.5"><StatusPill status={w.status}/></td>
                    <td className="px-3 py-2.5">
                      <span className={w.isFuture ? 'text-slate-600' : 'text-white font-semibold'}>{w.isFuture ? '—' : w.actualOrders}</span>
                      <span className="text-slate-500">/{w.targetOrders}</span>
                    </td>
                    <td className="px-3 py-2.5 min-w-[80px]">
                      {w.isFuture ? <span className="text-slate-600">—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-[48px]">
                            <div className={clsx('h-full rounded-full', w.ordersPct >= 90 ? 'bg-emerald-500' : w.ordersPct >= 65 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${Math.min(w.ordersPct, 100)}%` }}/>
                          </div>
                          <MktPct pct={w.ordersPct} future={w.isFuture}/>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {w.isFuture
                        ? <span className="text-slate-500 text-xs">{fmtRs(w.targetSpend)}</span>
                        : <><span className="text-slate-200">{fmtRs(w.actualSpend)}</span><span className="text-slate-600 text-xs">/{fmtRs(w.targetSpend)}</span></>}
                    </td>
                    <td className="px-3 py-2.5">
                      {w.actualROAS > 0
                        ? <span className={w.actualROAS >= w.targetROAS ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>{w.actualROAS}x</span>
                        : <span className="text-slate-600">{w.targetROAS}x</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {w.actualCAC > 0
                        ? <span className={w.actualCAC <= w.targetCAC ? 'text-emerald-400' : 'text-red-400'}>₹{w.actualCAC}</span>
                        : <span className="text-slate-600">₹{w.targetCAC}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SUB-TAB: MONTHLY PLAN
         ══════════════════════════════════════════════════════════ */}
      {mktTab === 'monthly' && (
        <div className="space-y-4">
          {/* Monthly bar chart — orders pacing */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
            <div className="text-sm font-semibold text-slate-200 mb-4">Orders Plan vs Actual — All Months</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyData.map(m => ({ label: m.label.slice(0,3), Plan: m.targetOrders, Actual: m.hasData ? m.actualOrders : null }))} barGap={3}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}/>
                <Tooltip content={<ChartTip/>}/>
                <Bar dataKey="Plan"   fill="#334155" radius={[3,3,0,0]} name="Plan"/>
                <Bar dataKey="Actual" fill="#22c55e" radius={[3,3,0,0]} name="Actual"/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly detail table */}
          <div className="overflow-x-auto rounded-xl border border-gray-800/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/50 bg-gray-900/40">
                  {['Month','Status','Orders/Day','Orders (A/T)','Pacing','Budget (Plan)','Spend (Actual)','ROAS','CAC','Revenue'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((m, i) => {
                  const mk = mktData[i] || {};
                  return (
                    <tr key={m.key} className={clsx('border-b border-gray-800/25 transition-colors',
                      m.isCurrent ? 'bg-brand-600/8' : STATUS_ROW[m.status], 'hover:bg-gray-800/20')}>
                      <td className="px-3 py-3 font-semibold text-white whitespace-nowrap">{m.label}</td>
                      <td className="px-3 py-3"><StatusPill status={m.status}/></td>
                      <td className="px-3 py-3 text-slate-300">{m.ordersPerDay}/d</td>
                      <td className="px-3 py-3">
                        {m.hasData ? <span className="text-white font-semibold">{m.actualOrders.toLocaleString()}</span> : <span className="text-slate-600">—</span>}
                        <span className="text-slate-500">/{m.targetOrders.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3"><MktPct pct={m.ordersPct} future={m.isFuture && !m.hasData}/></td>
                      <td className="px-3 py-3 text-slate-300">{fmtRs(m.targetSpend)}</td>
                      <td className="px-3 py-3">
                        {m.actualSpend > 0 ? <span className="text-white font-semibold">{fmtRs(m.actualSpend)}</span> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {m.actualROAS > 0
                          ? <span className={m.actualROAS >= m.targetROAS ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>{m.actualROAS}x</span>
                          : <span className="text-slate-500">{m.targetROAS}x</span>}
                      </td>
                      <td className="px-3 py-3">
                        {m.actualCAC > 0
                          ? <span className={m.actualCAC <= m.targetCAC ? 'text-emerald-400' : 'text-red-400'}>₹{m.actualCAC}</span>
                          : <span className="text-slate-500">₹{m.targetCAC}</span>}
                      </td>
                      <td className="px-3 py-3">
                        {m.hasData ? <span className="text-white">{fmtRs(m.actualRevenue)}</span> : <span className="text-slate-500">{fmtRs(m.targetRevenue)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700/50 bg-gray-900/40">
                  <td className="px-3 py-2.5 font-bold text-slate-300 text-xs" colSpan={4}>TOTAL</td>
                  <td colSpan={2}/>
                  <td className="px-3 py-2.5 font-bold text-white text-xs">{fmtRs(monthlyData.reduce((s,m)=>s+m.targetSpend,0))}</td>
                  <td colSpan={3}/>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SUB-TAB: COLLECTIONS
         ══════════════════════════════════════════════════════════ */}
      {mktTab === 'collections' && (
        <div className="space-y-5">
          {/* BCG Matrix */}
          {bcgMatrix?.matrix?.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
              <div className="text-sm font-semibold text-slate-200 mb-1">BCG Portfolio Matrix</div>
              <div className="text-xs text-slate-500 mb-4">Revenue share (X) × MoM growth (Y) · Median split</div>
              <div className="grid grid-cols-2 gap-3 max-w-2xl">
                {['Question Mark','Star','Dog','Cash Cow'].map(qName => {
                  const item = bcgMatrix.matrix.find(m => m.quadrant.name === qName);
                  if (!item) return null;
                  return (
                    <div key={qName} className="rounded-xl border p-4" style={{ borderColor: item.color+'40', background: item.color+'0d' }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-bold" style={{ color: item.color }}>{item.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full border font-semibold"
                          style={{ color: item.color, borderColor: item.color+'50', background: item.color+'18' }}>
                          {item.quadrant.name}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
                        <div className="flex justify-between col-span-2"><span className="text-slate-500">Rev share</span><span className="text-white font-semibold">{item.shareX}%</span></div>
                        <div className="flex justify-between col-span-2"><span className="text-slate-500">MoM growth</span><span className="font-semibold" style={{ color: item.color }}>+{item.growthY}%</span></div>
                        <div className="flex justify-between col-span-2"><span className="text-slate-500">ROAS</span><span className="text-white font-semibold">{item.roas}x</span></div>
                        <div className="flex justify-between col-span-2"><span className="text-slate-500">Allocation</span><span className="text-white font-semibold">{item.alloc}%</span></div>
                      </div>
                      <div className="text-xs font-semibold pt-2.5 border-t leading-snug" style={{ color: item.color, borderColor: item.color+'30' }}>
                        {item.quadrant.action}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex gap-2 flex-wrap">
                {bcgMatrix.recommendations.map(r => (
                  <div key={r.collection} className="bg-gray-800/60 rounded-lg px-3 py-2 flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color||'#64748b' }}/>
                    <span className="font-semibold text-white">{r.collection}</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ background: (r.color||'#64748b')+'20', color: r.color||'#64748b' }}>
                      {r.budgetSignal}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Allocation editor */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-slate-200">Collection Allocation & ROAS</div>
              <button onClick={() => setEditAlloc(v => !v)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1.5">
                <Edit2 size={12}/>{editAlloc ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editAlloc ? (
              <div className="space-y-3">
                {Object.entries(allocDraft).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-20 text-sm text-slate-300">{COLL_LABEL[key] || key}</div>
                    <input type="range" min="0" max="1" step="0.01" value={val}
                      onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                      className="flex-1 accent-brand-500"/>
                    <input className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm text-center"
                      value={(val * 100).toFixed(0)}
                      onChange={e => setAllocDraft(p => ({ ...p, [key]: parseFloat(e.target.value) / 100 || 0 }))}/>
                    <span className="text-xs text-slate-500">%</span>
                    <div className="w-24 text-xs text-slate-400">ROAS: <span className="text-white">{plan.collectionRoas?.[key]?.toFixed(2) || '—'}</span></div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-2 border-t border-gray-800/40">
                  <span className="text-xs text-slate-500">Total: {(Object.values(allocDraft).reduce((s, v) => s + parseFloat(v), 0) * 100).toFixed(0)}%</span>
                  <button onClick={saveAlloc} className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-500">Save</button>
                  <button onClick={() => setEditAlloc(false)} className="px-3 py-1.5 bg-gray-700 text-slate-300 rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 flex-wrap">
                {Object.entries(plan.collectionAlloc || {}).map(([key, pct]) => (
                  <div key={key} className="flex-1 min-w-[120px] bg-gray-800/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLL_COLORS[key] || '#64748b' }}/>
                      <span className="text-sm font-semibold text-white">{COLL_LABEL[key] || key}</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{Math.round(pct * 100)}%</div>
                    <div className="text-xs text-slate-500 mt-1">ROAS: {plan.collectionRoas?.[key]?.toFixed(2) || '—'}x</div>
                    <div className="h-1.5 bg-gray-700 rounded-full mt-3 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: COLL_COLORS[key] || '#64748b' }}/>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Global settings */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-200">Global Settings</div>
              <button onClick={() => setEditGlobals(v => !v)} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1.5">
                <Edit2 size={12}/>{editGlobals ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editGlobals ? (
              <div className="grid grid-cols-3 gap-3">
                {[['cpr','Avg CPR (₹)'],['avgBudgetPerCampaign','Budget/Campaign (₹/day)'],['avgCreativesPerCampaign','Creatives/Campaign']].map(([f, l]) => (
                  <div key={f}>
                    <div className="text-xs text-slate-500 mb-1">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-white text-sm"
                      value={globalsDraft[f]} onChange={e => setGlobalsDraft(p => ({ ...p, [f]: e.target.value }))}/>
                  </div>
                ))}
                <div className="col-span-3 flex gap-2 pt-1">
                  <button onClick={saveGlobals} className="px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-500">Save</button>
                  <button onClick={() => setEditGlobals(false)} className="px-3 py-2 bg-gray-700 text-slate-300 rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-6 text-sm">
                <div><span className="text-slate-500">CPR:</span> <span className="text-white font-semibold ml-1.5">₹{plan.cpr}</span></div>
                <div><span className="text-slate-500">Budget/Campaign:</span> <span className="text-white font-semibold ml-1.5">₹{(plan.avgBudgetPerCampaign||0).toLocaleString()}/d</span></div>
                <div><span className="text-slate-500">Creatives/Campaign:</span> <span className="text-white font-semibold ml-1.5">{plan.avgCreativesPerCampaign}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SUB-TAB: CREATIVES
         ══════════════════════════════════════════════════════════ */}
      {mktTab === 'creatives' && (
        <div className="space-y-4">
          {creatives.length === 0 ? (
            <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-10 text-center">
              <div className="text-sm text-slate-400 mb-1">No Meta creative data loaded</div>
              <div className="text-xs text-slate-600">Pull live Meta data to see creative health scores.</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[['strong','bg-emerald-500/15 text-emerald-400 border-emerald-800/30'],['ok','bg-amber-500/15 text-amber-400 border-amber-800/30'],['weak','bg-red-500/15 text-red-400 border-red-800/30']].map(([h, cls]) => (
                  <div key={h} className={clsx('rounded-xl border p-4 text-center', cls)}>
                    <div className="text-2xl font-bold">{creatives.filter(c=>c.health===h).length}</div>
                    <div className="text-xs font-semibold uppercase mt-1">{h}</div>
                    <div className="text-xs opacity-70 mt-0.5">{fmtRs(creatives.filter(c=>c.health===h).reduce((s,c)=>s+c.spend,0))} spend</div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-800/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800/50 bg-gray-900/40">
                      {['Creative','Health','Spend','ROAS','CTR','CPC','CAC','Impressions','Days Active'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {creatives.map((c, i) => (
                      <tr key={i} className="border-b border-gray-800/25 hover:bg-gray-800/20">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-white truncate max-w-[200px]" title={c.name}>{c.name}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div className={clsx('h-full rounded-full', c.health==='strong'?'bg-emerald-500':c.health==='ok'?'bg-amber-500':'bg-red-500')} style={{ width: `${c.healthScore}%` }}/>
                            </div>
                            <span className={clsx('text-xs font-semibold', c.health==='strong'?'text-emerald-400':c.health==='ok'?'text-amber-400':'text-red-400')}>{c.healthScore}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtRs(c.spend)}</td>
                        <td className="px-3 py-2.5"><span className={c.roas >= 4 ? 'text-emerald-400 font-semibold' : c.roas >= 2.5 ? 'text-amber-400' : 'text-red-400'}>{c.roas}x</span></td>
                        <td className="px-3 py-2.5 text-slate-300">{c.ctr}%</td>
                        <td className="px-3 py-2.5 text-slate-300">₹{c.cpc}</td>
                        <td className="px-3 py-2.5 text-slate-300">{c.cac > 0 ? `₹${c.cac}` : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400">{c.impressions.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-slate-400">{c.activeDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SUB-TAB: LTV & McKINSEY
         ══════════════════════════════════════════════════════════ */}
      {mktTab === 'ltv' && (
        <div className="space-y-5">
          {/* LTV:CAC cards */}
          <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
            <div className="text-sm font-semibold text-slate-200 mb-1">LTV:CAC Analysis — By Collection</div>
            <div className="text-xs text-slate-500 mb-4">Target ratio ≥ 3:1 · LTV = AOV × margin × expected lifetime orders (18-month window)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {ltvData.map(c => (
                <div key={c.coll} className={clsx('rounded-xl border p-5',
                  c.health==='strong' ? 'border-emerald-800/30 bg-emerald-500/5' : c.health==='ok' ? 'border-amber-800/30 bg-amber-500/5' : 'border-red-800/30 bg-red-500/5')}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLL_COLORS[c.coll] || '#64748b' }}/>
                      <span className="text-sm font-bold text-white">{c.label}</span>
                    </div>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-md font-bold border',
                      c.health==='strong'?'bg-emerald-500/15 text-emerald-400 border-emerald-800/30':c.health==='ok'?'bg-amber-500/15 text-amber-400 border-amber-800/30':'bg-red-500/15 text-red-400 border-red-800/30')}>
                      {c.ratio}:1
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">LTV</span><span className="text-white font-semibold">₹{c.ltv}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">CAC</span><span className="text-white font-semibold">₹{c.cac}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Payback</span><span className="text-amber-400 font-semibold">{c.payback}mo</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">ROAS</span><span className="text-white">{c.roas}x</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Alloc</span><span className="text-slate-300">{c.allocPct}%</span></div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700/40">
                    <div className="text-xs text-slate-500 mb-1">LTV:CAC ratio</div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full', c.health==='strong'?'bg-emerald-500':c.health==='ok'?'bg-amber-500':'bg-red-500')}
                        style={{ width: `${Math.min(c.ratio / 5 * 100, 100)}%` }}/>
                    </div>
                    <div className="flex justify-between text-[11px] mt-1 text-slate-600"><span>0</span><span className="text-amber-500">2x</span><span className="text-emerald-500">3x</span><span>5x+</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* McKinsey decomposition */}
          {mcKData.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
              <div className="text-sm font-semibold text-slate-200 mb-1">McKinsey Revenue Decomposition</div>
              <div className="text-xs text-slate-500 mb-4">ΔRevenue = Volume effect + Price (AOV) effect + Mix residual · Month over month</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mcKData.map(m => ({ label: m.label.slice(0,3), Volume: m.volumeEffect, Price: m.priceEffect, Mix: m.mixEffect }))}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1f2937" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={v => fmtK(v)} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={45}/>
                  <Tooltip content={<ChartTip/>}/>
                  <Bar dataKey="Volume" fill="#818cf8" stackId="a" radius={[0,0,0,0]} name="Volume"/>
                  <Bar dataKey="Price"  fill="#f59e0b" stackId="a" radius={[0,0,0,0]} name="Price/AOV"/>
                  <Bar dataKey="Mix"    fill="#22c55e" stackId="a" radius={[3,3,0,0]} name="Mix"/>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                {[['Volume','#818cf8'],['Price/AOV','#f59e0b'],['Mix','#22c55e']].map(([l,c]) => (
                  <span key={l} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="w-2 h-2 rounded-sm" style={{ background: c }}/>{l}
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800/50">
                      {['Month','Total ΔRev','Volume','Price/AOV','Mix','MoM Growth'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mcKData.map(m => (
                      <tr key={m.key} className="border-b border-gray-800/25">
                        <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">{m.label}</td>
                        <td className="px-3 py-2.5 text-emerald-400 font-semibold">{fmtRs(m.totalDelta)}</td>
                        <td className="px-3 py-2.5 text-purple-400">{fmtRs(m.volumeEffect)}</td>
                        <td className="px-3 py-2.5 text-amber-400">{fmtRs(m.priceEffect)}</td>
                        <td className="px-3 py-2.5 text-emerald-400">{fmtRs(m.mixEffect)}</td>
                        <td className="px-3 py-2.5"><span className={m.pct >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>+{m.pct}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/* ─── TAB: INVENTORY INTEL ───────────────────────────────────────────── */
function TabInventory({ inventoryMap, allOrders, growthInv }) {
  const [filter, setFilter] = useState('all');
  const needs = growthInv?.length > 0 ? growthInv : [];

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
                {['SKU / Product','Status','Stock','Vel/Day','Eff. Days ▾','Naive Days','Overstate','Safety Stock','ROP','Stockout Date','Order By','Urgency','Rec. Qty'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const st = INV_STATUS[r.status] || INV_STATUS.ok;
                const urgencyColor = r.urgency === 'OVERDUE' ? 'text-red-400 font-bold' : r.urgency === 'URGENT' ? 'text-red-400 font-semibold' : r.urgency === 'SOON' ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <tr key={r.sku || r.name} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-white truncate max-w-[140px]" title={r.name}>{r.name}</div>
                      <div className="text-[10px] text-slate-600 font-mono">{r.sku}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-bold', st.pill)}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-white font-semibold">{(r.current ?? r.stock)?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{(r.vel ?? r.velocity ?? 0).toFixed(1)}/d</td>
                    <td className="px-3 py-2.5">
                      <span className={r.effectiveDays < 14 ? 'text-red-400 font-bold' : r.effectiveDays < 30 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>
                        {r.effectiveDays > 500 ? '∞' : `${r.effectiveDays}d`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 line-through">{r.naiveDays > 500 ? '∞' : `${r.naiveDays}d`}</td>
                    <td className="px-3 py-2.5">
                      {r.overstatedDays > 0 ? <span className="text-red-400 text-[10px] font-bold">-{r.overstatedDays}d</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{r.safetyStock?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{r.rop?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap text-[10px]">{r.stockoutDate || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[10px]">
                      <span className={r.daysToOrderBy <= 7 ? 'text-red-400 font-bold' : r.daysToOrderBy <= 14 ? 'text-amber-400' : 'text-slate-400'}>
                        {r.orderByDate || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[10px] font-bold', urgencyColor)}>{r.urgency || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {(r.recommendedQty ?? r.reorderQty) > 0
                        ? <span className="text-amber-400 font-bold">{(r.recommendedQty ?? r.reorderQty)?.toLocaleString()}</span>
                        : <span className="text-slate-600">—</span>}
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
function TabWarehouses({ plan, savePlan, warehouseTags, allOrders }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({});

  const openNew  = () => { setForm({ id: `wh_${Date.now()}`, name: '', location: '', capacity: '', active: true, orderTag: '', notes: '', skuCategories: '' }); setEditing('new'); };
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
          <div className="text-sm font-bold text-white">Warehouse Network</div>
          <div className="text-xs text-slate-500 mt-0.5">{plan.warehouses.filter(w => w.active).length} active · {plan.warehouses.length} total</div>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-500">
          <Plus size={14}/>Add Warehouse
        </button>
      </div>

      {editing && (
        <div className="bg-gray-900/80 rounded-xl border border-brand-500/30 p-5 space-y-4">
          <div className="text-sm font-semibold text-slate-200">{editing === 'new' ? 'New Warehouse' : 'Edit Warehouse'}</div>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Name *'],['location','Location'],['capacity','Capacity (units)'],['orderTag','Order Tag # (e.g. 1 for warehouse:1)'],['skuCategories','SKU Categories']].map(([field, label]) => (
              <div key={field}>
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm"
                  value={form[field] || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}/>
              </div>
            ))}
            <div className="col-span-2">
              <div className="text-xs text-slate-500 mb-1">Notes</div>
              <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm"
                value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}/>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-500">Save</button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 bg-gray-800 text-slate-300 rounded-lg text-sm hover:bg-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {/* Tag-based order distribution */}
      {Object.keys(warehouseTags || {}).length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-5">
          <div className="text-sm font-semibold text-slate-200 mb-1">Order Distribution by Warehouse Tag</div>
          <div className="text-xs text-slate-500 mb-4">From Shopify order tags matching <code className="bg-gray-800 px-1 rounded text-slate-400">warehouse:N</code></div>
          {(() => {
            const totalTaggedOrders = Object.values(warehouseTags).reduce((s, v) => s + v.orders, 0);
            const totalTaggedRev    = Object.values(warehouseTags).reduce((s, v) => s + v.revenue, 0);
            return (
              <div className="space-y-3">
                {Object.values(warehouseTags).sort((a,b)=>b.orders-a.orders).map(wt => {
                  const matchedWH = plan.warehouses.find(w => w.orderTag === wt.tagNum);
                  const pct = totalTaggedOrders > 0 ? (wt.orders / totalTaggedOrders * 100) : 0;
                  return (
                    <div key={wt.tagNum} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-gray-800 px-2 py-0.5 rounded font-mono text-slate-400">warehouse:{wt.tagNum}</span>
                          {matchedWH && <span className="text-slate-200 font-semibold">{matchedWH.name}</span>}
                          {!matchedWH && <span className="text-slate-500 italic text-xs">unlinked — set Order Tag # above</span>}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                          <span><strong className="text-white">{wt.orders.toLocaleString()}</strong> orders</span>
                          <span><strong className="text-emerald-400">{fmtRs(wt.revenue)}</strong></span>
                          <span className="text-slate-500">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }}/>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-gray-800/50 flex justify-between text-xs text-slate-500">
                  <span>{totalTaggedOrders.toLocaleString()} tagged orders ({Math.round(totalTaggedOrders / Math.max(allOrders.length, 1) * 100)}% of total)</span>
                  <span>{fmtRs(totalTaggedRev)} total</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {Object.keys(warehouseTags || {}).length === 0 && allOrders.length > 0 && (
        <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-4 text-xs text-slate-500">
          No <code className="bg-gray-800 px-1 rounded">warehouse:N</code> tags found in {allOrders.length.toLocaleString()} orders. Add tags to Shopify orders to see distribution here.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plan.warehouses.map(wh => {
          const tagData = wh.orderTag ? warehouseTags?.[wh.orderTag] : null;
          return (
            <div key={wh.id} className={clsx('bg-gray-900/60 rounded-xl border p-5 transition-all', wh.active ? 'border-gray-800/50' : 'border-gray-800/30 opacity-60')}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-base font-bold text-white">{wh.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{wh.location}</div>
                  {wh.orderTag && <div className="text-xs text-brand-400 mt-1 font-mono">warehouse:{wh.orderTag}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => toggle(wh.id)} className={clsx('text-xs px-2.5 py-0.5 rounded-full font-bold border',
                    wh.active ? 'bg-emerald-500/15 text-emerald-400 border-emerald-800/30' : 'bg-gray-800 text-slate-500 border-gray-700')}>
                    {wh.active ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => openEdit(wh)} className="p-1.5 text-slate-500 hover:text-slate-300"><Edit2 size={13}/></button>
                  <button onClick={() => remove(wh.id)} className="p-1.5 text-slate-600 hover:text-red-400"><Trash2 size={13}/></button>
                </div>
              </div>
              <div className="space-y-2.5">
                {wh.capacity > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Capacity</span>
                    <span className="text-white font-semibold">{wh.capacity.toLocaleString()} units</span>
                  </div>
                )}
                {wh.skuCategories && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Categories</span>
                    <span className="text-slate-300">{wh.skuCategories}</span>
                  </div>
                )}
                {tagData && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Orders (tagged)</span>
                      <span className="text-white font-semibold">{tagData.orders.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Revenue (tagged)</span>
                      <span className="text-emerald-400 font-semibold">{fmtRs(tagData.revenue)}</span>
                    </div>
                  </>
                )}
                {wh.notes && (
                  <div className="text-xs text-slate-500 bg-gray-800/40 rounded-lg px-3 py-2 mt-1">{wh.notes}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── TAB: WORKING CAPITAL ───────────────────────────────────────────── */
function TabCapital({ plan, wc, cmStack, rtoModel }) {
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
          <div className="text-sm font-semibold text-slate-200">Working Capital Scenario</div>
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
        <div className="text-sm font-semibold text-slate-200 mb-4">Revenue Waterfall</div>
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

      {/* CM1 / CM2 / CM3 Waterfall */}
      {cmStack?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-sm font-semibold text-slate-200 mb-1">Contribution Margin Stack — CM1 → CM2 → CM3</div>
          <div className="text-[10px] text-slate-500 mb-4">CM1 = Rev−COGS · CM2 = CM1−Shipping−Gateway−PickPack−Packaging · CM3 = CM2−CAC−RTO</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/50">
                  {['Month','Revenue','CM1','CM1%','Shipping+Ops','Gateway','CM2','CM2%','CAC+RTO','CM3','CM3%'].map(h => (
                    <th key={h} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmStack.map(m => {
                  const tot = m.totals;
                  const shippingOps = m.collections.reduce((s,c)=>s+c.shippingTotal+c.pickPackTotal+c.packagingTotal,0);
                  const gateway    = m.collections.reduce((s,c)=>s+c.gatewayTotal,0);
                  const cacRto     = m.collections.reduce((s,c)=>s+c.cacTotal+c.rtoCost,0);
                  return (
                    <tr key={m.key} className="border-b border-gray-800/30">
                      <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">{m.month}</td>
                      <td className="px-3 py-2 text-slate-300">{fmtRs(m.totalRevenue)}</td>
                      <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtRs(tot.cm1)}</td>
                      <td className="px-3 py-2 text-emerald-400">{tot.cm1Pct}%</td>
                      <td className="px-3 py-2 text-amber-400">−{fmtRs(shippingOps)}</td>
                      <td className="px-3 py-2 text-slate-400">−{fmtRs(gateway)}</td>
                      <td className="px-3 py-2 text-blue-400 font-semibold">{fmtRs(tot.cm2)}</td>
                      <td className="px-3 py-2 text-blue-400">{tot.cm2Pct}%</td>
                      <td className="px-3 py-2 text-red-400">−{fmtRs(cacRto)}</td>
                      <td className={clsx('px-3 py-2 font-bold', tot.cm3 >= 0 ? 'text-purple-400' : 'text-red-400')}>{fmtRs(tot.cm3)}</td>
                      <td className={clsx('px-3 py-2', tot.cm3Pct >= 0 ? 'text-purple-400' : 'text-red-400')}>{tot.cm3Pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RTO Cost Model */}
      {rtoModel?.monthly?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
          <div className="text-sm font-semibold text-slate-200 mb-1">RTO Cost Model — India D2C</div>
          <div className="text-[10px] text-slate-500 mb-3">
            COD {Math.round((plan.codPct||0.6)*100)}% × {Math.round((plan.rtoRateCOD||0.28)*100)}% RTO + Prepaid {Math.round((1-(plan.codPct||0.6))*100)}% × {Math.round((plan.rtoRatePrepaid||0.06)*100)}% RTO · Full cost ₹{rtoModel.summary.rtoFullCostPerOrder}/RTO
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Unmanaged RTO Cost" value={fmtRs(rtoModel.summary.totalCostUnmanaged)} cls="text-red-400" sub="no NDR management"/>
            <KpiCard label="Managed RTO Cost"   value={fmtRs(rtoModel.summary.totalCostManaged)}   cls="text-amber-400" sub="active NDR"/>
            <KpiCard label="NDR Savings (Year)" value={fmtRs(rtoModel.summary.annualSavingsFromNDR)} cls="text-emerald-400" sub={`${rtoModel.summary.ndrRescueRate}% rescue rate`}/>
            <KpiCard label="Blended RTO (Managed)" value={`${rtoModel.summary.blendedRTOManaged}%`} sub={`Unmanaged: ${rtoModel.summary.blendedRTOUnmanaged}%`}/>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/50">
                  {['Month','Orders','COD','Prepaid','RTO (Unman.)','RTO (Managed)','Cost Unman.','Cost Managed','NDR Savings'].map(h => (
                    <th key={h} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rtoModel.monthly.map(m => (
                  <tr key={m.key} className="border-b border-gray-800/30">
                    <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">{m.month}</td>
                    <td className="px-3 py-2 text-slate-300">{m.totalOrders.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400">{m.codOrders.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400">{m.prepOrders.toLocaleString()}</td>
                    <td className="px-3 py-2 text-red-400 font-semibold">{m.rtoUnmanagedOrders.toLocaleString()} <span className="text-[9px] text-red-600">({m.blendedRTOPctUnmanaged}%)</span></td>
                    <td className="px-3 py-2 text-amber-400">{m.rtoManagedOrders.toLocaleString()} <span className="text-[9px] text-amber-700">({m.blendedRTOPctManaged}%)</span></td>
                    <td className="px-3 py-2 text-red-400">{fmtRs(m.costUnmanaged)}</td>
                    <td className="px-3 py-2 text-amber-400">{fmtRs(m.costManaged)}</td>
                    <td className="px-3 py-2 text-emerald-400 font-semibold">{fmtRs(m.savingsFromNDR)}</td>
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

/* ─── LIVE PULL PANEL ────────────────────────────────────────────────── */
function PullPanel({ isPulling, pullLog, pullProgress, onPull, lastPullAt, stats, onUpload, pullPeriod, onPeriodChange }) {
  const fileRef = useRef();
  const hasData = stats.orders > 0 || stats.skus > 0;
  return (
    <div className={clsx('rounded-xl border p-4',
      isPulling ? 'border-brand-700/60 bg-brand-950/30' : hasData ? 'border-gray-800/50 bg-gray-900/40' : 'border-gray-800/40 bg-gray-900/30')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className="text-sm font-semibold text-white shrink-0">Live Data</span>
          {hasData && !isPulling && (
            <div className="flex items-center gap-2 text-xs">
              {stats.orders > 0 && <span className="bg-emerald-500/15 text-emerald-400 px-2.5 py-0.5 rounded-full font-semibold">{stats.orders.toLocaleString()} orders</span>}
              {stats.skus > 0  && <span className="bg-emerald-500/15 text-emerald-400 px-2.5 py-0.5 rounded-full font-semibold">{stats.skus} SKUs</span>}
              {stats.ads > 0   && <span className="bg-emerald-500/15 text-emerald-400 px-2.5 py-0.5 rounded-full font-semibold">{stats.ads.toLocaleString()} ads</span>}
              {lastPullAt && <span className="text-slate-500">· {new Date(lastPullAt).toLocaleTimeString()}</span>}
            </div>
          )}
          {!hasData && !isPulling && <span className="text-xs text-slate-500">Pull to load live orders & inventory</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-gray-800/80 rounded-lg p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.id} onClick={() => onPeriodChange(opt.id)} disabled={isPulling}
                className={clsx('px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap',
                  pullPeriod === opt.id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-gray-700')}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 border border-gray-700/60 text-slate-400 rounded-lg text-xs hover:bg-gray-700 hover:text-slate-200 transition-colors">
            <Upload size={11}/>CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = new FileReader(); r.onload = ev => onUpload(ev.target.result); r.readAsText(f); e.target.value = '';
          }}/>
          <button onClick={onPull} disabled={isPulling}
            className={clsx('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all',
              isPulling ? 'bg-brand-800/50 text-brand-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40')}>
            <RefreshCw size={13} className={isPulling ? 'animate-spin' : ''}/>
            {isPulling ? 'Pulling…' : 'Pull'}
          </button>
        </div>
      </div>
      {isPulling && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5"><span>Fetching {pullPeriod}…</span><span className="text-brand-400 font-semibold">{pullProgress}%</span></div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500" style={{ width: `${pullProgress}%` }}/>
          </div>
        </div>
      )}
      {pullLog.length > 0 && (
        <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
          {pullLog.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                e.status === 'done' ? 'bg-emerald-400' : e.status === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse')}/>
              <span className={e.status === 'error' ? 'text-red-400' : e.status === 'done' ? 'text-slate-300' : 'text-slate-500'}>{e.msg}</span>
              {e.count != null && e.count > 0 && <span className="text-slate-500">· {e.count.toLocaleString()}</span>}
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
  const [pullPeriod, setPullPeriod]        = useState('90d');

  const [plan, setPlan] = useState(() => {
    const b = brands.find(br => br.id === (activeBrandIds[0] || 'default'));
    return hydrate(lsGet(activeBrandIds[0] || 'default'), b?.name);
  });

  useEffect(() => {
    if (primaryBrandId !== prevBrandId.current) {
      prevBrandId.current = primaryBrandId;
      const b = brands.find(br => br.id === primaryBrandId);
      setPlan(hydrate(lsGet(primaryBrandId), b?.name));
      setUploadedOrders([]);
    }
  }, [primaryBrandId, brands]);

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

    const sinceDate = periodToSince(pullPeriod);
    const nowDate   = new Date();
    const chunks    = chunkDateRange(sinceDate.getTime(), nowDate.getTime());
    const isChunked = chunks.length > 1;

    // Estimate total steps: meta accounts + inventory + order chunks per brand
    const totalSteps = active.reduce((s, b) => {
      const metaCount = b.meta?.accounts?.filter(a => a.id && a.key).length || 0;
      const shopCount = b.shopify?.shop ? (1 + chunks.length) : 0;
      return s + metaCount + shopCount;
    }, 0);
    let done = 0;
    const tick = () => { done++; setPullProgress(Math.round((done / Math.max(totalSteps, 1)) * 100)); };
    const ts = () => new Date().toLocaleTimeString();

    for (const brand of active) {
      const { token, apiVersion: ver, accounts = [] } = brand.meta || {};
      const valid = accounts.filter(a => a.id && a.key);
      if (token && valid.length) {
        setBrandMetaStatus(brand.id, 'loading');
        const results = [];
        for (const acc of valid) {
          setPullLog(prev => [...prev, { msg: `Meta ${acc.key}…`, status: 'loading', ts: ts() }]);
          try {
            const r = await pullAccount({ ver: ver || 'v21.0', token, accountKey: acc.key, accountId: acc.id });
            results.push(r);
            setPullLog(prev => [...prev.slice(0, -1), { msg: `${acc.key}: ${r.ads?.length || 0} ads`, count: r.ads?.length, status: 'done', ts: ts() }]);
          } catch (e) {
            setPullLog(prev => [...prev.slice(0, -1), { msg: `${acc.key} failed: ${e.message}`, status: 'error', ts: ts() }]);
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
        // Inventory
        setPullLog(prev => [...prev, { msg: `Shopify inventory…`, status: 'loading', ts: ts() }]);
        try {
          const { map, locations, skuToItemId, collections } = await fetchShopifyInventory(shop, clientId, clientSecret);
          setBrandInventory(brand.id, map, locations, null, skuToItemId, collections);
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Inventory: ${Object.keys(map).length} SKUs`, count: Object.keys(map).length, status: 'done', ts: ts() }]);
        } catch (e) {
          setPullLog(prev => [...prev.slice(0, -1), { msg: `Inventory failed: ${e.message}`, status: 'error', ts: ts() }]);
        }
        tick();

        // Orders — chunked to avoid Shopify timeouts on long periods
        let allFetched = [];
        if (isChunked) {
          setPullLog(prev => [...prev, { msg: `Orders (${pullPeriod}, ${chunks.length} chunks)…`, status: 'loading', ts: ts() }]);
          let chunkErrors = 0;
          for (let ci = 0; ci < chunks.length; ci++) {
            const [cStart, cEnd] = chunks[ci];
            setPullLog(prev => [...prev.slice(0, -1), { msg: `Orders chunk ${ci+1}/${chunks.length}…`, status: 'loading', ts: ts() }]);
            try {
              const res = await fetchShopifyOrders(shop, clientId, clientSecret, cStart, cEnd);
              allFetched = [...allFetched, ...(res.orders || [])];
              tick();
            } catch (e) {
              chunkErrors++;
              setPullLog(prev => [...prev.slice(0, -1), { msg: `Chunk ${ci+1} failed: ${e.message}`, status: 'error', ts: ts() }]);
              tick();
            }
          }
          setPullLog(prev => [...prev.slice(0, -1), {
            msg: `Orders: ${allFetched.length} (${pullPeriod}${chunkErrors ? `, ${chunkErrors} chunk errors` : ''})`,
            count: allFetched.length, status: chunkErrors > 0 ? 'error' : 'done', ts: ts(),
          }]);
        } else {
          // Single chunk (≤ 30d)
          setPullLog(prev => [...prev, { msg: `Orders (${pullPeriod})…`, status: 'loading', ts: ts() }]);
          try {
            const res = await fetchShopifyOrders(shop, clientId, clientSecret, chunks[0][0], chunks[0][1]);
            allFetched = res.orders || [];
            setPullLog(prev => [...prev.slice(0, -1), { msg: `Orders: ${allFetched.length} (${pullPeriod})`, count: allFetched.length, status: 'done', ts: ts() }]);
          } catch (e) {
            setPullLog(prev => [...prev.slice(0, -1), { msg: `Orders failed: ${e.message}`, status: 'error', ts: ts() }]);
          }
          tick();
        }
        if (allFetched.length > 0) setBrandOrders(brand.id, allFetched, pullPeriod);
      }
    }
    setPullProgress(100); setIsPulling(false); setLastPullAt(Date.now());
  }, [brands, activeBrandIds, pullPeriod, setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders]);

  const handleUpload = useCallback(text => setUploadedOrders(prev => [...prev, ...parseOrdersCsv(text)]), []);

  const allOrders  = useMemo(() => [...(shopifyOrders || []), ...uploadedOrders], [shopifyOrders, uploadedOrders]);
  const pva        = useMemo(() => buildPlanVsActual(plan, allOrders), [plan, allOrders]);
  const predictions= useMemo(() => buildPredictions(plan, allOrders), [plan, allOrders]);
  const wc         = useMemo(() => buildWorkingCapital(plan, pva), [plan, pva]);
  const invNeeds   = useMemo(() => buildInventoryNeeds(inventoryMap, allOrders), [inventoryMap, allOrders]);
  const growthInv  = useMemo(() => buildGrowthAdjustedInventory({ inventoryMap: invNeeds, allOrders }), [invNeeds, allOrders]);
  const constraint = useMemo(() => buildCurrentConstraint({ plan, predictions, inventoryNeeds: invNeeds, pva, wc }), [plan, predictions, invNeeds, pva, wc]);
  const breaking   = useMemo(() => buildBreakingPoints({ plan, predictions, inventoryNeeds: invNeeds, pva }), [plan, predictions, invNeeds, pva]);
  const rtoModel   = useMemo(() => buildRTOModel({ plan, predictions }), [plan, predictions]);
  const cmStack    = useMemo(() => buildContributionStack({ plan, pva }), [plan, pva]);
  const bcgMatrix  = useMemo(() => buildBCGMatrix({ plan, allOrders, enrichedRows }), [plan, allOrders, enrichedRows]);

  // Multi-brand combined BCG
  const combinedBCG = useMemo(() => {
    if (activeBrandIds.length <= 1) return bcgMatrix;
    const allPoints = activeBrandIds.flatMap(id => {
      const b = brands.find(br => br.id === id);
      const bp = hydrate(lsGet(id), b?.name);
      const m  = buildBCGMatrix({ plan: bp, allOrders, enrichedRows });
      const prefix = b?.name?.split(' ')[0] || id;
      return m.matrix.map(item => ({
        ...item,
        label: `${prefix} · ${item.label}`,
        collection: `${id}_${item.collection}`,
      }));
    });
    if (!allPoints.length) return bcgMatrix;
    const sorted = (arr) => [...arr].sort((a,b)=>a-b);
    const shares  = sorted(allPoints.map(p=>p.shareX));
    const growths = sorted(allPoints.map(p=>p.growthY));
    const mShare  = shares[Math.floor(shares.length/2)];
    const mGrowth = growths[Math.floor(growths.length/2)];
    const QUAD = { Star:['#22c55e','Invest aggressively'], 'Cash Cow':['#f59e0b','Milk margins'], 'Question Mark':['#818cf8','Test 2x budget'], Dog:['#ef4444','Harvest or drop'] };
    const getQ = p => {
      const hs = p.shareX >= mShare, hg = p.growthY >= mGrowth;
      const name = hs&&hg ? 'Star' : hs&&!hg ? 'Cash Cow' : !hs&&hg ? 'Question Mark' : 'Dog';
      return { name, icon: null, color: QUAD[name][0], action: QUAD[name][1] };
    };
    return {
      matrix: allPoints.map(p=>({...p, quadrant: getQ(p)})),
      medianShare: mShare, medianGrowth: mGrowth, combined: true,
      recommendations: allPoints.map(p=>({ collection: p.label, quadrant: getQ(p).name, color: p.color, budgetSignal: getQ(p).name==='Star'?'+30%':getQ(p).name==='Cash Cow'?'Maintain':getQ(p).name==='Question Mark'?'Test +20%':'-50%' })),
    };
  }, [activeBrandIds, brands, bcgMatrix, allOrders, enrichedRows]);

  const brand = brands.find(b => b.id === primaryBrandId);
  const warehouseTags = useMemo(() => parseWarehouseTags(allOrders), [allOrders]);
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
        <button onClick={() => { if (confirm('Reset plan to defaults?')) { const seed = hydrate(null, brand?.name); lsSet(primaryBrandId, seed); setPlan(seed); } }}
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
        onPull={handlePull} lastPullAt={lastPullAt} stats={stats} onUpload={handleUpload}
        pullPeriod={pullPeriod} onPeriodChange={setPullPeriod}/>

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

      {tab === 'command'   && <TabCommand   plan={plan} pva={pva} predictions={predictions} allOrders={allOrders} constraint={constraint} breaking={breaking} bcgMatrix={combinedBCG}/>}
      {tab === 'revenue'   && <TabRevenue   plan={plan} pva={pva} savePlan={savePlan} allOrders={allOrders}/>}
      {tab === 'marketing' && <TabMarketing plan={plan} pva={pva} savePlan={savePlan} bcgMatrix={combinedBCG} allOrders={allOrders} enrichedRows={enrichedRows}/>}
      {tab === 'inventory' && <TabInventory inventoryMap={inventoryMap} allOrders={allOrders} growthInv={growthInv}/>}
      {tab === 'warehouse' && <TabWarehouses plan={plan} savePlan={savePlan} warehouseTags={warehouseTags} allOrders={allOrders}/>}
      {tab === 'capital'   && <TabCapital   plan={plan} wc={wc} cmStack={cmStack} rtoModel={rtoModel}/>}
    </div>
  );
}
