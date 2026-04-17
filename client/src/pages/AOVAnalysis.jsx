/**
 * AOV Analysis — supreme lens across Shopify + Meta + GA
 * Tabs: Timeline · Products · Drop Diagnosis · Channels · Mix
 */
import { useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell, Legend,
} from 'recharts';
import {
  TrendingDown, TrendingUp, AlertTriangle, Info,
  ShoppingBag, Layers, Activity, GitMerge, BarChart2,
  ArrowDown, ArrowUp, Minus, Search,
} from 'lucide-react';
import { useStore } from '../store';
import { NeedsShopify } from '../components/ui/DataRequired';
import {
  buildAovTimeline, buildProductContrib, buildDropDiagnosis,
  buildChannelAov, buildMixAnalysis, detectDropEvents, blendGaWithAov,
} from '../lib/aovAnalytics';

/* ─── FORMATTERS ──────────────────────────────────────────────────── */
const fmtRs = n => { const v = parseFloat(n) || 0; if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1) + 'L'; if (v >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'K'; return '₹' + Math.round(v); };
const fmtN  = n => { const v = parseFloat(n) || 0; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(Math.round(v)); };
const fmtPct = n => (parseFloat(n) || 0).toFixed(1) + '%';
const fmtDate = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${d}/${m}`; };
const delta = (a, b) => b > 0 ? ((a - b) / b * 100).toFixed(1) : null;

function DeltaBadge({ value, inverse = false }) {
  const n = parseFloat(value) || 0;
  const good = inverse ? n < 0 : n > 0;
  const cls  = n === 0 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400';
  const Icon = n === 0 ? Minus : n > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${cls}`}>
      <Icon size={10} />{Math.abs(n).toFixed(1)}%
    </span>
  );
}

function KpiCard({ label, value, sub, delta: d, inverse = false, cls = '' }) {
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 px-4 py-3">
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${cls || 'text-white'}`}>{value}</div>
      {(sub || d != null) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub  && <span className="text-[10px] text-slate-600">{sub}</span>}
          {d != null && <DeltaBadge value={d} inverse={inverse} />}
        </div>
      )}
    </div>
  );
}

const CAUSE_COLORS = { neg: '#ef4444', pos: '#22c55e', neutral: '#64748b' };
const SEV_COLORS   = { critical: 'border-red-700/50 bg-red-950/30 text-red-300', high: 'border-orange-700/50 bg-orange-950/30 text-orange-300', medium: 'border-amber-700/40 bg-amber-950/20 text-amber-300' };
const STATUS_PILL  = { disappeared: 'bg-red-900/30 text-red-400', dropped: 'bg-orange-900/30 text-orange-400', surged: 'bg-emerald-900/30 text-emerald-400', new: 'bg-blue-900/30 text-blue-400', stable: 'bg-gray-800 text-slate-400' };
const CH_COLORS    = ['#22c55e','#3b82f6','#a78bfa','#f59e0b','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80'];

/* ─── CUSTOM TOOLTIP ──────────────────────────────────────────────── */
function AovTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-gray-900 border border-gray-700/60 rounded-xl px-3 py-2 text-xs shadow-xl min-w-[160px]">
      <div className="font-semibold text-slate-300 mb-2">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex justify-between gap-4 py-0.5">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-white">{p.dataKey === 'orders' ? fmtN(p.value) : fmtRs(p.value)}</span>
        </div>
      ))}
      {d?.itemsPerOrder && <div className="mt-1 pt-1 border-t border-gray-700/50 text-slate-500">{d.itemsPerOrder} items/order · {fmtPct(d.discountRate)} disc</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 1 — TIMELINE
══════════════════════════════════════════════════════════════════ */
function TabTimeline({ timeline, drops, gaBlended }) {
  const [showGa, setShowGa] = useState(false);
  const hasGa = gaBlended.some(d => d.sessions > 0);
  const data  = showGa && hasGa ? gaBlended : timeline;

  const recent7  = timeline.slice(-7);
  const prev7    = timeline.slice(-14, -7);
  const avgAov7  = recent7.reduce((s, d) => s + d.aov, 0)  / (recent7.length  || 1);
  const avgAov7p = prev7.reduce((s, d)  => s + d.aov, 0)   / (prev7.length   || 1);
  const avgOrd7  = recent7.reduce((s, d) => s + d.orders, 0) / (recent7.length || 1);
  const avgOrd7p = prev7.reduce((s, d)  => s + d.orders, 0)  / (prev7.length  || 1);
  const peakDay  = [...timeline].sort((a, b) => b.aov - a.aov)[0];
  const lowDay   = [...timeline].filter(d => d.orders > 2).sort((a, b) => a.aov - b.aov)[0];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="7D Avg AOV"    value={fmtRs(avgAov7)}  d={delta(avgAov7, avgAov7p)} cls="text-white" />
        <KpiCard label="7D Avg Orders" value={fmtN(avgOrd7)}   d={delta(avgOrd7, avgOrd7p)} cls="text-gray-200" />
        <KpiCard label="Peak AOV"      value={fmtRs(peakDay?.aov)}  sub={peakDay?.date} cls="text-emerald-400" />
        <KpiCard label="Lowest AOV"    value={fmtRs(lowDay?.aov)}   sub={lowDay?.date}  cls="text-red-400" />
      </div>

      {/* Drop alerts */}
      {drops.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Auto-detected AOV drops (vs 7-day average)</div>
          <div className="flex flex-wrap gap-2">
            {drops.slice(0, 6).map(d => (
              <div key={d.date} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${SEV_COLORS[d.severity]}`}>
                <AlertTriangle size={11} />
                <span className="font-semibold">{d.date}</span>
                <span>AOV {fmtRs(d.aov)} vs avg {fmtRs(d.avgAov)} (↓{d.dropPct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chart controls */}
      {hasGa && (
        <div className="flex gap-2">
          {['AOV', 'AOV + GA'].map(l => (
            <button key={l} onClick={() => setShowGa(l !== 'AOV')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${(l === 'AOV + GA') === showGa ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300 bg-gray-800/50'}`}>
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Main AOV area chart */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3">Daily AOV + 7-Day Moving Average</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="aovGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={v => fmtRs(v)} />
            <Tooltip content={<AovTooltip />} />
            {drops.map(d => (
              <ReferenceLine key={d.date} x={d.date} stroke={d.severity === 'critical' ? '#ef4444' : '#f59e0b'} strokeDasharray="3 3" strokeOpacity={0.6} />
            ))}
            <Area type="monotone" dataKey="aov" name="AOV" stroke="#22c55e" fill="url(#aovGrad)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="ma7" name="7D MA" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Daily orders + items/order */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Daily Orders</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={data} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => [fmtN(v), 'Orders']} labelFormatter={fmtDate} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="orders" fill="#3b82f6" radius={[2, 2, 0, 0]} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Items per Order & Discount Rate</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={data} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Line yAxisId="l" type="monotone" dataKey="itemsPerOrder" name="Items/Order" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="discountRate"  name="Disc %" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* GA overlay if available */}
      {showGa && hasGa && (
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">GA Sessions & Conversion Rate</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={gaBlended.filter(d => d.sessions > 0)} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtN} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="sessions"  name="Sessions"  fill="#6366f1" opacity={0.5} radius={[1,1,0,0]} />
              <Line yAxisId="r" type="monotone" dataKey="convRate" name="Conv%" stroke="#f472b6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 2 — PRODUCT LENS
══════════════════════════════════════════════════════════════════ */
function SparkBar({ byDay, color = '#22c55e', height = 24 }) {
  const vals = Object.values(byDay);
  if (!vals.length) return <span className="text-slate-600 text-xs">—</span>;
  const max  = Math.max(...vals, 1);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {vals.slice(-14).map((v, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(2, (v / max) * height)}px`, background: color, opacity: 0.7 }} />
      ))}
    </div>
  );
}

function TabProducts({ contrib }) {
  const { products, gainers, losers, disappeared } = contrib;

  return (
    <div className="space-y-5">
      {/* Gainers / Losers / Disappeared */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 mb-3 flex items-center gap-1.5"><TrendingUp size={11} /> Revenue Gainers</div>
          {gainers.length === 0 && <div className="text-xs text-slate-600 py-4 text-center">No significant gainers</div>}
          <div className="space-y-2">
            {gainers.map(g => (
              <div key={g.sku} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{g.name}</div>
                  <div className="text-[10px] text-slate-500">{fmtRs(g.rev)} total</div>
                </div>
                <span className="text-xs text-emerald-400 font-semibold shrink-0">+{g.trend.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-red-600 mb-3 flex items-center gap-1.5"><TrendingDown size={11} /> Revenue Losers</div>
          {losers.length === 0 && <div className="text-xs text-slate-600 py-4 text-center">No significant losers</div>}
          <div className="space-y-2">
            {losers.map(g => (
              <div key={g.sku} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{g.name}</div>
                  <div className="text-[10px] text-slate-500">{fmtRs(g.rev)} total</div>
                </div>
                <span className="text-xs text-red-400 font-semibold shrink-0">{g.trend.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-orange-600 mb-3 flex items-center gap-1.5"><AlertTriangle size={11} /> Disappeared (had sales, stopped)</div>
          {disappeared.length === 0 && <div className="text-xs text-slate-600 py-4 text-center">No products dropped out</div>}
          <div className="space-y-2">
            {disappeared.slice(0, 6).map(g => (
              <div key={g.sku} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{g.name}</div>
                  <div className="text-[10px] text-slate-500">{fmtRs(g.revFirst)} in first half</div>
                </div>
                <span className="text-[10px] bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded font-semibold shrink-0">GONE</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full product table */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">Product Revenue Contribution (30D)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/40">
                {['Product','Revenue','Share %','Avg Price','Orders','AOV','Disc%','Trend (1H vs 2H)','14-Day Spark'].map((h, i) => (
                  <th key={h} className={`py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap ${i > 0 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(pr => (
                <tr key={pr.sku} className="border-b border-gray-800/30 hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-slate-200 max-w-[180px]"><div className="truncate">{pr.name}</div><div className="text-[9px] text-slate-600">{pr.sku}</div></td>
                  <td className="py-2 px-3 text-right font-mono text-white">{fmtRs(pr.rev)}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1 bg-gray-700/50 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(pr.sharePct, 100)}%` }} />
                      </div>
                      <span className="text-slate-300 font-mono">{pr.sharePct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtRs(pr.avgPrice)}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{fmtN(pr.orders)}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtRs(pr.aov)}</td>
                  <td className="py-2 px-3 text-right"><span className={pr.discRate > 15 ? 'text-orange-400' : 'text-slate-400'}>{pr.discRate.toFixed(1)}%</span></td>
                  <td className="py-2 px-3 text-right"><DeltaBadge value={pr.trend} /></td>
                  <td className="py-2 px-3 text-right"><SparkBar byDay={pr.byDay} color={pr.trend >= 0 ? '#22c55e' : '#ef4444'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 3 — DROP DIAGNOSIS
══════════════════════════════════════════════════════════════════ */
function WaterfallBar({ label, value, max }) {
  const w   = max > 0 ? Math.abs(value) / max * 100 : 0;
  const pos = value >= 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-slate-400 w-32 shrink-0">{label}</div>
      <div className="flex-1 flex items-center gap-2">
        {!pos && <div className="w-1/2 flex justify-end"><div className="h-5 rounded-l-sm" style={{ width: `${w / 2}%`, background: '#ef4444', opacity: 0.8 }} /></div>}
        {pos  && <div className="w-1/2" />}
        <div className={`text-xs font-mono font-bold w-16 text-right shrink-0 ${pos ? 'text-emerald-400' : 'text-red-400'}`}>{pos ? '+' : ''}{fmtRs(value)}</div>
        {pos  && <div className="w-1/2"><div className="h-5 rounded-r-sm" style={{ width: `${w / 2}%`, background: '#22c55e', opacity: 0.8 }} /></div>}
        {!pos && <div className="w-1/2" />}
      </div>
    </div>
  );
}

function TabDiagnosis({ timeline, drops, orders }) {
  const [dropDate, setDropDate]   = useState(drops[0]?.date || '');
  const [baseline, setBaseline]   = useState(7);

  const diagnosis = useMemo(() => {
    if (!dropDate) return null;
    return buildDropDiagnosis(orders, dropDate, baseline);
  }, [orders, dropDate, baseline]);

  const maxMag = diagnosis ? Math.max(...diagnosis.causes.map(c => c.magnitude), 1) : 1;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end bg-gray-900/40 rounded-2xl border border-gray-800/50 px-4 py-4">
        <div>
          <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Drop Date to Analyse</div>
          <input type="date" value={dropDate} onChange={e => setDropDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-brand-500 outline-none" />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Baseline Window</div>
          <div className="flex gap-1.5">
            {[3, 7, 14].map(n => (
              <button key={n} onClick={() => setBaseline(n)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${baseline === n ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300 bg-gray-800/50'}`}>
                {n} days prior
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Quick-pick from detected drops</div>
          <div className="flex flex-wrap gap-1.5">
            {drops.slice(0, 5).map(d => (
              <button key={d.date} onClick={() => setDropDate(d.date)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${d.date === dropDate ? 'border-brand-500/50 bg-brand-900/20 text-brand-300' : 'border-gray-700/50 text-slate-500 hover:border-gray-600'}`}>
                {d.date} ↓{d.dropPct}%
              </button>
            ))}
            {!drops.length && <span className="text-[10px] text-slate-600">No auto-detected drops — choose any date</span>}
          </div>
        </div>
      </div>

      {!diagnosis && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 border border-gray-800/40 rounded-2xl">
          <Search size={32} className="mb-3 opacity-30" />
          <div className="text-sm">Select a drop date above to diagnose</div>
        </div>
      )}

      {diagnosis && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="AOV on Drop Day" value={fmtRs(diagnosis.drop.aov)} cls={diagnosis.Δaov < 0 ? 'text-red-400' : 'text-emerald-400'} />
            <KpiCard label={`Baseline (${baseline}d avg)`} value={fmtRs(diagnosis.base.aov)} cls="text-white" />
            <KpiCard label="AOV Δ" value={(diagnosis.Δaov > 0 ? '+' : '') + fmtRs(diagnosis.Δaov)} cls={diagnosis.Δaov >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <KpiCard label="Orders that day" value={fmtN(diagnosis.drop.orders)} sub={`vs avg ${fmtN(diagnosis.base.orders.toFixed(0))}`} cls="text-white" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Causes */}
            <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4 space-y-4">
              <div className="text-xs font-semibold text-slate-400">Root Cause Ranking (₹ impact on AOV)</div>
              {/* Waterfall */}
              <div className="space-y-2">
                {diagnosis.causes.map(c => (
                  <WaterfallBar key={c.id} label={c.label} value={c.impact} max={maxMag} />
                ))}
                {Math.abs(diagnosis.unexplained) > 5 && (
                  <WaterfallBar label="Unexplained" value={diagnosis.unexplained} max={maxMag} />
                )}
              </div>
              <div className="border-t border-gray-800/50 pt-3 space-y-3">
                {diagnosis.causes.map(c => (
                  <div key={c.id} className={`rounded-xl border p-3 ${c.direction === 'neg' ? 'border-red-800/30 bg-red-950/20' : 'border-emerald-800/30 bg-emerald-950/20'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-xs font-semibold text-white">{c.label}</div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c.confidence === 'high' ? 'bg-emerald-900/40 text-emerald-400' : c.confidence === 'medium' ? 'bg-amber-900/30 text-amber-400' : 'bg-gray-800 text-slate-500'}`}>{c.confidence}</span>
                        <span className={`text-xs font-bold ${c.direction === 'neg' ? 'text-red-400' : 'text-emerald-400'}`}>{c.impact > 0 ? '+' : ''}{fmtRs(c.impact)}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 mb-1.5">{c.desc}</div>
                    <div className={`text-[10px] flex items-start gap-1 ${c.direction === 'neg' ? 'text-red-300' : 'text-emerald-300'}`}>
                      <Info size={9} className="shrink-0 mt-px" />{c.action}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Product changes + Channel changes */}
            <div className="space-y-4">
              <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">Product Revenue vs Baseline</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-800/30">
                      {['Product','Baseline','Drop Day','Δ Revenue','Status'].map((h, i) => (
                        <th key={h} className={`py-2 px-3 text-[10px] uppercase tracking-wider text-slate-500 ${i > 0 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {diagnosis.productChanges.slice(0, 12).map(pc => (
                        <tr key={pc.sku} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                          <td className="py-1.5 px-3 text-slate-200 max-w-[140px]"><div className="truncate">{pc.name}</div></td>
                          <td className="py-1.5 px-3 text-right font-mono text-slate-400">{fmtRs(pc.baseRev)}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-slate-300">{fmtRs(pc.dropRev)}</td>
                          <td className="py-1.5 px-3 text-right font-mono"><span className={pc.revChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pc.revChange > 0 ? '+' : ''}{fmtRs(pc.revChange)}</span></td>
                          <td className="py-1.5 px-3 text-right"><span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_PILL[pc.status]}`}>{pc.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
                <div className="text-xs font-semibold text-slate-400 mb-3">Channel Mix Shift</div>
                <div className="space-y-2">
                  {diagnosis.channelChanges.slice(0, 8).map((c, i) => (
                    <div key={c.channel} className="flex items-center gap-2 text-xs">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: CH_COLORS[i % CH_COLORS.length] }} />
                      <span className="flex-1 text-slate-300 truncate">{c.channel}</span>
                      <span className="text-slate-500 font-mono">{c.basePct}%</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-slate-300 font-mono">{c.dropPct}%</span>
                      <span className={`font-semibold ${c.delta > 0 ? 'text-blue-400' : c.delta < 0 ? 'text-orange-400' : 'text-slate-500'}`}>{c.delta > 0 ? '+' : ''}{c.delta}pp</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 4 — CHANNELS
══════════════════════════════════════════════════════════════════ */
function TabChannels({ channelData }) {
  return (
    <div className="space-y-5">
      {/* Channel KPI bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {channelData.slice(0, 5).map((c, i) => (
          <div key={c.channel} className="bg-gray-900/60 rounded-xl border border-gray-800/50 px-3 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: CH_COLORS[i] }} />
              <div className="text-[10px] text-slate-400 truncate font-medium">{c.channel}</div>
            </div>
            <div className="text-lg font-bold text-white">{fmtRs(c.aov)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{fmtN(c.orders)} orders · {c.revenueShare}%</div>
            <div className="text-[10px] text-slate-600">{c.newPct}% new · {c.discRate}% disc</div>
          </div>
        ))}
      </div>

      {/* AOV by channel bar */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3">AOV by Channel</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={channelData} layout="vertical" margin={{ left: 10, right: 40, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
            <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={110} />
            <Tooltip formatter={v => [fmtRs(v), 'AOV']} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
            <Bar dataKey="aov" radius={[0, 4, 4, 0]}>
              {channelData.map((_, i) => <Cell key={i} fill={CH_COLORS[i % CH_COLORS.length]} opacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue share stacked */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3">Revenue by Channel</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={channelData} layout="vertical" margin={{ left: 10, right: 60, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
            <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={110} />
            <Tooltip formatter={v => [fmtRs(v), 'Revenue']} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
              {channelData.map((_, i) => <Cell key={i} fill={CH_COLORS[i % CH_COLORS.length]} opacity={0.7} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* AOV trend per channel (top 4) */}
      {channelData.slice(0, 4).filter(c => c.dayTrend?.length > 3).map((c, ci) => (
        <div key={c.channel} className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold mb-3" style={{ color: CH_COLORS[ci] }}>{c.channel} — Daily AOV Trend</div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={c.dayTrend} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`cg${ci}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={CH_COLORS[ci]} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={CH_COLORS[ci]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
              <Tooltip formatter={v => [fmtRs(v), 'AOV']} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="aov" stroke={CH_COLORS[ci]} fill={`url(#cg${ci})`} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ))}

      {/* Full table */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">All Channels</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40">
              {['Channel','Revenue','Orders','AOV','Rev Share','New%','Disc%'].map((h, i) => (
                <th key={h} className={`py-2 px-3 text-[10px] uppercase tracking-wider text-slate-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {channelData.map((c, i) => (
                <tr key={c.channel} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: CH_COLORS[i % CH_COLORS.length] }} />
                      <span className="text-slate-200">{c.channel}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-white">{fmtRs(c.revenue)}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtN(c.orders)}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-white">{fmtRs(c.aov)}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{c.revenueShare}%</td>
                  <td className="py-2 px-3 text-right text-slate-400">{c.newPct}%</td>
                  <td className="py-2 px-3 text-right"><span className={c.discRate > 10 ? 'text-orange-400' : 'text-slate-400'}>{c.discRate}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 5 — MIX ANALYSIS
══════════════════════════════════════════════════════════════════ */
function TabMix({ mix }) {
  const { byItemCount, weeklyTrend } = mix;
  const maxAov = Math.max(...byItemCount.map(r => r.aov), 1);

  return (
    <div className="space-y-5">
      {/* Item count AOV */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">AOV by Items per Order</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byItemCount} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
              <Tooltip formatter={v => [fmtRs(v), 'AOV']} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="aov" radius={[4, 4, 0, 0]}>
                {byItemCount.map((r, i) => <Cell key={i} fill={`hsl(${140 + i * 30}, 60%, 50%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Order Distribution by Item Count</div>
          <div className="space-y-3 mt-2">
            {byItemCount.map((r, i) => (
              <div key={r.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">{r.label}</span>
                  <span className="text-slate-500 font-mono">{fmtN(r.orders)} orders · {r.sharePct}% · AOV {fmtRs(r.aov)}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${r.sharePct}%`, background: `hsl(${140 + i * 30}, 60%, 50%)`, opacity: 0.8 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly AOV + items per order trend */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3">Weekly AOV + Items per Order Trend</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={weeklyTrend} margin={{ top: 5, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} tickFormatter={fmtDate} />
            <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="l" type="monotone" dataKey="aov" name="AOV" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="itemsPerOrder" name="Items/Order" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Multi-item % trend */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-1">Multi-Item Order % (higher = better basket size → higher AOV)</div>
        <div className="text-[10px] text-slate-600 mb-3">When this % rises, customers are buying bundles or multiple products, driving AOV up.</div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={weeklyTrend} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="multiGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="week" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
            <Tooltip formatter={v => [v + '%', 'Multi-item orders']} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
            <Area type="monotone" dataKey="multiItemPct" name="Multi-item %" stroke="#a78bfa" fill="url(#multiGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Item count table */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">Breakdown by Item Count</div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800/40">
            {['Item Count','Orders','Share','Revenue','AOV','Disc Rate','AOV vs 1-item'].map((h, i) => (
              <th key={h} className={`py-2 px-3 text-[10px] uppercase tracking-wider text-slate-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byItemCount.map((r, i) => {
              const oneItemAov = byItemCount[0]?.aov || 0;
              const uplift = oneItemAov > 0 ? ((r.aov - oneItemAov) / oneItemAov * 100) : 0;
              return (
                <tr key={r.label} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-slate-200">{r.label}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtN(r.orders)}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{r.sharePct}%</td>
                  <td className="py-2 px-3 text-right font-mono text-white">{fmtRs(r.revenue)}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold">
                    <span style={{ color: `hsl(${140 + i * 30}, 60%, 60%)` }}>{fmtRs(r.aov)}</span>
                  </td>
                  <td className="py-2 px-3 text-right"><span className={r.discRate > 10 ? 'text-orange-400' : 'text-slate-400'}>{r.discRate}%</span></td>
                  <td className="py-2 px-3 text-right"><span className={uplift > 0 ? 'text-emerald-400' : 'text-slate-500'}>{i === 0 ? 'baseline' : `+${uplift.toFixed(0)}%`}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════ */
const TABS = [
  { id: 'timeline',  label: 'Timeline',   Icon: Activity },
  { id: 'products',  label: 'Products',   Icon: Layers },
  { id: 'diagnosis', label: 'Drop Diagnosis', Icon: Search },
  { id: 'channels',  label: 'Channels',   Icon: GitMerge },
  { id: 'mix',       label: 'Mix Analysis', Icon: BarChart2 },
];

export default function AOVAnalysis() {
  const { shopifyOrders, brands, activeBrandIds, brandData } = useStore();
  const [tab, setTab] = useState('timeline');

  // Merge GA data from active brands
  const gaData = useMemo(() => {
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    for (const b of active) {
      const d = brandData[b.id]?.gaData;
      if (d?.dailyTrend?.length) return d;
    }
    return null;
  }, [brands, activeBrandIds, brandData]);

  const timeline = useMemo(() => buildAovTimeline(shopifyOrders || []), [shopifyOrders]);
  const gaBlended = useMemo(() => blendGaWithAov(timeline, gaData), [timeline, gaData]);
  const drops     = useMemo(() => detectDropEvents(timeline), [timeline]);
  const contrib   = useMemo(() => buildProductContrib(shopifyOrders || []), [shopifyOrders]);
  const channels  = useMemo(() => buildChannelAov(shopifyOrders || []), [shopifyOrders]);
  const mix       = useMemo(() => buildMixAnalysis(shopifyOrders || []), [shopifyOrders]);

  const T = timeline[timeline.length - 1];
  const avgAov = timeline.length ? timeline.reduce((s, d) => s + d.aov, 0) / timeline.length : 0;

  return (
    <NeedsShopify checkOrders>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ShoppingBag size={20} className="text-brand-400" />
              AOV Analysis
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Supreme precision lens — Shopify × Meta × GA · product, channel and basket decomposition</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {drops.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-1.5">
                <AlertTriangle size={11} />
                {drops.length} AOV drop{drops.length > 1 ? 's' : ''} detected
              </div>
            )}
            {gaData && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-900/20 border border-blue-800/30 rounded-lg px-3 py-1.5">
                <Activity size={11} />
                GA data blended
              </div>
            )}
          </div>
        </div>

        {/* Global KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <KpiCard label="Period AOV (avg)" value={fmtRs(avgAov)} cls="text-white" />
          <KpiCard label="Latest Day AOV"   value={fmtRs(T?.aov)} sub={T?.date} cls={T && T.aov < avgAov * 0.9 ? 'text-red-400' : 'text-emerald-400'} />
          <KpiCard label="Avg Items/Order"  value={(timeline.reduce((s, d) => s + d.itemsPerOrder, 0) / (timeline.length || 1)).toFixed(2)} cls="text-white" />
          <KpiCard label="Avg Discount Rate" value={fmtPct(timeline.reduce((s, d) => s + d.discountRate, 0) / (timeline.length || 1))} inverse cls={timeline.reduce((s, d) => s + d.discountRate, 0) / (timeline.length || 1) > 10 ? 'text-orange-400' : 'text-slate-300'} />
          <KpiCard label="Total Days" value={String(timeline.length)} sub={`${timeline[0]?.date || ''} – ${timeline[timeline.length - 1]?.date || ''}`} cls="text-slate-300" />
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 border-b border-gray-800/60 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.Icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                  ${tab === t.id ? 'text-white border-brand-500 bg-brand-900/10' : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-gray-800/30'}`}>
                <Icon size={12} />{t.label}
                {t.id === 'diagnosis' && drops.length > 0 && (
                  <span className="text-[9px] bg-red-500/20 text-red-400 px-1 rounded">{drops.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div>
          {tab === 'timeline'  && <TabTimeline timeline={timeline} drops={drops} gaBlended={gaBlended} />}
          {tab === 'products'  && <TabProducts contrib={contrib} />}
          {tab === 'diagnosis' && <TabDiagnosis timeline={timeline} drops={drops} orders={shopifyOrders || []} />}
          {tab === 'channels'  && <TabChannels channelData={channels} />}
          {tab === 'mix'       && <TabMix mix={mix} />}
        </div>
      </div>
    </NeedsShopify>
  );
}
