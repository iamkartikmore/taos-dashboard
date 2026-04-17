/**
 * AOV Analysis v2 — Supreme precision: OOS forensics · collection matrix · drop autopsy · product vitals
 * Tabs: Command Center · OOS Forensics · Collection Matrix · Drop Autopsy · Product Vitals
 */
import { useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell, ComposedChart,
} from 'recharts';
import {
  TrendingDown, AlertTriangle, Info,
  Layers, Activity, ArrowDown, ArrowUp, Minus,
  Search, Package, AlertCircle, CheckCircle, Clock,
} from 'lucide-react';
import { useStore } from '../store';
import { NeedsShopify } from '../components/ui/DataRequired';
import {
  buildAovTimeline, detectOosSignals, buildCollectionRevenue,
  buildMetaCollectionSpend, buildDropAutopsy, buildProductVitals,
  detectDropEvents, blendGaWithAov,
} from '../lib/aovAnalytics';

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const fmtRs  = n => { const v = parseFloat(n) || 0; if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1) + 'L'; if (v >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'K'; return '₹' + Math.round(v); };
const fmtN   = n => { const v = parseFloat(n) || 0; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(Math.round(v)); };
const fmtPct = n => (parseFloat(n) || 0).toFixed(1) + '%';
const fmtDate = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${d}/${m}`; };
const delta   = (a, b) => b > 0 ? ((a - b) / b * 100).toFixed(1) : null;
const dateOffset = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

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

function KpiCard({ label, value, sub, d, inverse = false, cls = '', warn = false }) {
  return (
    <div className={`bg-gray-900/60 rounded-xl border px-4 py-3 ${warn ? 'border-red-800/40' : 'border-gray-800/50'}`}>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${cls || 'text-white'}`}>{value}</div>
      {(sub || d != null) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
          {d != null && <DeltaBadge value={d} inverse={inverse} />}
        </div>
      )}
    </div>
  );
}

const CONF_STYLES = {
  confirmed: { pill: 'bg-red-900/40 text-red-300 border-red-700/50',    dot: 'bg-red-400',    label: 'CONFIRMED OOS' },
  high:      { pill: 'bg-orange-900/40 text-orange-300 border-orange-700/50', dot: 'bg-orange-400', label: 'HIGH RISK' },
  medium:    { pill: 'bg-amber-900/30 text-amber-300 border-amber-700/40',    dot: 'bg-amber-400',  label: 'MEDIUM' },
  low:       { pill: 'bg-gray-800/60 text-slate-400 border-gray-700/40',      dot: 'bg-slate-500',  label: 'LOW' },
};

const STATUS_STYLES = {
  oos:      'bg-red-900/40 text-red-300 border-red-700/50',
  critical: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  low:      'bg-amber-900/30 text-amber-300 border-amber-700/40',
  paused:   'bg-slate-900/60 text-slate-400 border-slate-700/40',
  ok:       'bg-emerald-900/20 text-emerald-400 border-emerald-800/30',
};

const STATUS_ICONS = {
  oos:      <AlertCircle size={10} />,
  critical: <AlertTriangle size={10} />,
  low:      <TrendingDown size={10} />,
  paused:   <Clock size={10} />,
  ok:       <CheckCircle size={10} />,
};

const SEV_COLORS = {
  critical: 'border-red-700/50 bg-red-950/30 text-red-300',
  high:     'border-orange-700/50 bg-orange-950/30 text-orange-300',
  medium:   'border-amber-700/40 bg-amber-950/20 text-amber-300',
};

const CH_COLORS = ['#22c55e','#3b82f6','#a78bfa','#f59e0b','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80'];

/* ─── SPARKLINE ──────────────────────────────────────────────────── */
function SparkLine({ data, dataKey = 'rev', color = '#22c55e', height = 32 }) {
  if (!data?.length) return <span className="text-slate-600 text-xs">—</span>;
  const vals = data.map(d => d[dataKey] || 0);
  const max  = Math.max(...vals, 1);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {vals.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm min-w-[2px]"
          style={{ height: `${Math.max(2, (v / max) * height)}px`, background: color, opacity: v > 0 ? 0.75 : 0.2 }} />
      ))}
    </div>
  );
}

/* ─── TOOLTIP ────────────────────────────────────────────────────── */
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
   TAB 1 — COMMAND CENTER
══════════════════════════════════════════════════════════════════ */
function TabCommandCenter({ timeline, drops, gaBlended, oosSignals }) {
  const [showGa, setShowGa] = useState(false);
  const hasGa = gaBlended.some(d => d.sessions > 0);
  const data  = showGa && hasGa ? gaBlended : timeline;

  const recent7  = timeline.slice(-7);
  const prev7    = timeline.slice(-14, -7);
  const avgAov7  = recent7.reduce((s, d) => s + d.aov,    0) / (recent7.length || 1);
  const avgAov7p = prev7.reduce((s, d)   => s + d.aov,    0) / (prev7.length   || 1);
  const avgOrd7  = recent7.reduce((s, d) => s + d.orders, 0) / (recent7.length || 1);
  const avgOrd7p = prev7.reduce((s, d)   => s + d.orders, 0) / (prev7.length   || 1);
  const peakDay  = [...timeline].sort((a, b) => b.aov - a.aov)[0];
  const lowDay   = [...timeline].filter(d => d.orders > 2).sort((a, b) => a.aov - b.aov)[0];
  const oosHighConf = oosSignals.filter(s => ['confirmed', 'high'].includes(s.confidence));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="7D Avg AOV"    value={fmtRs(avgAov7)}  d={delta(avgAov7, avgAov7p)} />
        <KpiCard label="7D Avg Orders" value={fmtN(avgOrd7)}   d={delta(avgOrd7, avgOrd7p)} />
        <KpiCard label="Peak AOV"      value={fmtRs(peakDay?.aov)} sub={peakDay?.date} cls="text-emerald-400" />
        <KpiCard label="Lowest AOV"    value={fmtRs(lowDay?.aov)}  sub={lowDay?.date}  cls="text-red-400" />
      </div>

      {(drops.length > 0 || oosHighConf.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drops.length > 0 && (
            <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-amber-400" /> Auto-detected AOV drops
              </div>
              <div className="space-y-2">
                {drops.slice(0, 5).map(d => (
                  <div key={d.date} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs ${SEV_COLORS[d.severity]}`}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={10} />
                      <span className="font-semibold">{d.date}</span>
                    </div>
                    <span>AOV {fmtRs(d.aov)} vs {fmtRs(d.avgAov)} (↓{d.dropPct}%)</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${d.severity === 'critical' ? 'bg-red-900/50' : 'bg-orange-900/50'}`}>{d.severity.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {oosHighConf.length > 0 && (
            <div className="bg-gray-900/40 rounded-2xl border border-red-900/30 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-red-500 mb-3 flex items-center gap-1.5">
                <AlertCircle size={11} /> OOS Revenue Alert
              </div>
              <div className="space-y-2">
                {oosHighConf.slice(0, 4).map(s => {
                  const cs = CONF_STYLES[s.confidence];
                  return (
                    <div key={s.sku} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cs.dot}`} />
                        <span className="text-slate-300 truncate">{s.name}</span>
                        <span className="text-slate-600 text-[9px] shrink-0">{s.collection}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-red-400 font-mono">{fmtRs(s.revLost)}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${cs.pill}`}>{s.daysSilent}d</span>
                      </div>
                    </div>
                  );
                })}
                <div className="text-[10px] text-slate-600 pt-1 border-t border-gray-800/40">
                  Total at-risk: {fmtRs(oosHighConf.reduce((s, x) => s + x.revLost, 0))} · {oosHighConf.length} products
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {hasGa && (
        <div className="flex gap-2">
          {['AOV Only', 'AOV + GA Sessions'].map(l => (
            <button key={l} onClick={() => setShowGa(l !== 'AOV Only')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${(l !== 'AOV Only') === showGa ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300 bg-gray-800/50'}`}>
              {l}
            </button>
          ))}
        </div>
      )}

      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-400">Daily AOV + 7-Day MA</div>
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            {oosHighConf.length > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> OOS last sale</span>}
            {drops.length > 0 && <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-amber-500" /> Drop</span>}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
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
            {oosHighConf.map(s => (
              <ReferenceLine key={s.sku} x={s.lastSaleDate}
                stroke={s.confidence === 'confirmed' ? '#ef4444' : '#f97316'}
                strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.7}
              />
            ))}
            {drops.map(d => (
              <ReferenceLine key={d.date} x={d.date}
                stroke={d.severity === 'critical' ? '#ef4444' : '#f59e0b'}
                strokeDasharray="4 3" strokeOpacity={0.5} />
            ))}
            <Area type="monotone" dataKey="aov" name="AOV" stroke="#22c55e" fill="url(#aovGrad)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="ma7" name="7D MA" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Daily Orders & Revenue</div>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={data} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="orders" fill="#3b82f6" radius={[2, 2, 0, 0]} opacity={0.7} name="Orders" />
              <Line yAxisId="r" type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Revenue" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Items/Order & Discount Rate</div>
          <ResponsiveContainer width="100%" height={150}>
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

      {showGa && hasGa && (
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">GA Sessions & Conversion Rate</div>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={gaBlended.filter(d => d.sessions > 0)} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtN} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="sessions" name="Sessions" fill="#6366f1" opacity={0.5} radius={[1,1,0,0]} />
              <Line yAxisId="r" type="monotone" dataKey="convRate" name="Conv%" stroke="#f472b6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 2 — OOS FORENSICS
══════════════════════════════════════════════════════════════════ */
function TabOosForensics({ oosSignals }) {
  const [filter, setFilter] = useState('all');
  const visible = oosSignals.filter(s => filter === 'all' || s.confidence === filter);
  const confirmed = oosSignals.filter(s => s.confidence === 'confirmed');
  const high      = oosSignals.filter(s => s.confidence === 'high');
  const medium    = oosSignals.filter(s => s.confidence === 'medium');
  const low       = oosSignals.filter(s => s.confidence === 'low');
  const totalRevRisk = [...confirmed, ...high].reduce((s, x) => s + x.revLost, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Confirmed OOS"     value={String(confirmed.length)} sub="Stock = 0 verified"           cls="text-red-400"    warn={confirmed.length > 0} />
        <KpiCard label="High Risk OOS"     value={String(high.length)}      sub="Near-OOS or long silence"      cls="text-orange-400" />
        <KpiCard label="Medium Risk"       value={String(medium.length)}    sub="Possible OOS"                  cls="text-amber-400" />
        <KpiCard label="Total Rev at Risk" value={fmtRs(totalRevRisk)}      sub="Confirmed + High confidence"   cls="text-red-400"    warn={totalRevRisk > 10000} />
      </div>

      <div className="flex gap-1.5">
        {[['all','All',oosSignals.length], ['confirmed','Confirmed',confirmed.length], ['high','High',high.length], ['medium','Medium',medium.length], ['low','Low',low.length]].map(([val, lbl, cnt]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${filter === val ? 'bg-brand-600/20 text-brand-300 border-brand-500/30' : 'text-slate-500 hover:text-slate-300 bg-gray-800/50 border-gray-700/30'}`}>
            {lbl} <span className="opacity-60">{cnt}</span>
          </button>
        ))}
      </div>

      {!visible.length && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 border border-gray-800/40 rounded-2xl">
          <CheckCircle size={32} className="mb-3 opacity-30 text-emerald-500" />
          <div className="text-sm">No OOS signals detected — all products selling normally</div>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(s => {
          const cs = CONF_STYLES[s.confidence] || CONF_STYLES.low;
          return (
            <div key={s.sku} className={`rounded-2xl border p-4 ${s.confidence === 'confirmed' ? 'border-red-800/40 bg-red-950/10' : s.confidence === 'high' ? 'border-orange-800/30 bg-orange-950/10' : 'border-gray-800/50 bg-gray-900/30'}`}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cs.pill}`}>{cs.label}</span>
                    <span className="text-sm font-semibold text-white">{s.name}</span>
                    <span className="text-[10px] text-slate-500 bg-gray-800/60 px-1.5 py-0.5 rounded">{s.collection}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-3">{s.reason}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-600 mb-0.5">Current Stock</div>
                      <div className={`font-mono font-bold ${s.currentStock === 0 ? 'text-red-400' : s.currentStock === null ? 'text-slate-500' : s.currentStock < 10 ? 'text-orange-400' : 'text-white'}`}>
                        {s.currentStock === null ? 'Unknown' : `${s.currentStock} units`}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-600 mb-0.5">Days Silent</div>
                      <div className="font-mono font-bold text-white">{s.daysSilent}d</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-600 mb-0.5">Velocity</div>
                      <div className="font-mono text-slate-300">{s.velocity} units/day</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-600 mb-0.5">Revenue at Risk</div>
                      <div className="font-mono font-bold text-red-400">{fmtRs(s.revLost)}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-600">
                    Last sale: {s.lastSaleDate} · {fmtRs(s.avgRevPerDay)}/day avg · Avg price: {fmtRs(s.avgPrice)}
                    {s.collections?.length > 1 && ` · Also in: ${s.collections.slice(1, 3).join(', ')}`}
                  </div>
                </div>
                <div className="shrink-0 w-28">
                  <div className="text-[9px] text-slate-600 mb-1 text-right">14-day rev</div>
                  <SparkLine data={s.dailyHistory} dataKey="rev"
                    color={s.confidence === 'confirmed' ? '#ef4444' : s.confidence === 'high' ? '#f97316' : '#f59e0b'}
                    height={44} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TAB 3 — COLLECTION MATRIX
══════════════════════════════════════════════════════════════════ */
function TabCollectionMatrix({ collRevenue, metaSpend }) {
  const merged = useMemo(() => {
    const metaByName = {};
    metaSpend.forEach(m => { metaByName[m.name.toLowerCase()] = m; });
    return collRevenue.map(c => {
      const key   = c.name.toLowerCase();
      let meta    = metaByName[key];
      if (!meta) {
        const match = Object.keys(metaByName).find(k => k.includes(key) || key.includes(k));
        if (match) meta = metaByName[match];
      }
      const metaSpendAmt = meta?.spend || 0;
      const impliedRoas  = metaSpendAmt > 0 && c.rev7 > 0 ? +(c.rev7 / metaSpendAmt).toFixed(2) : null;
      return { ...c, meta, metaSpendAmt, impliedRoas };
    });
  }, [collRevenue, metaSpend]);

  const chartData = merged.slice(0, 10).map(c => ({
    name: c.name.length > 14 ? c.name.slice(0, 12) + '…' : c.name,
    shopifyRev7: Math.round(c.rev7),
    metaSpend: Math.round(c.metaSpendAmt),
  }));

  const topByRev  = [...merged].sort((a, b) => b.rev30 - a.rev30)[0];
  const topByRoas = merged.filter(c => c.impliedRoas).sort((a, b) => b.impliedRoas - a.impliedRoas)[0];
  const topSpend  = [...merged].sort((a, b) => b.metaSpendAmt - a.metaSpendAmt)[0];
  const unmatched = metaSpend.filter(m => !merged.find(c => c.meta?.name === m.name));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Top Collection (30D)"     value={topByRev?.name  || '—'} sub={fmtRs(topByRev?.rev30)}          cls="text-emerald-400" />
        <KpiCard label="Top Implied ROAS"         value={topByRoas?.name || '—'} sub={`${topByRoas?.impliedRoas}x`}    cls="text-brand-400" />
        <KpiCard label="Top Meta Spend"           value={topSpend?.name  || '—'} sub={fmtRs(topSpend?.metaSpendAmt)}   cls="text-purple-400" />
      </div>

      {chartData.length > 0 && (
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Shopify 7D Revenue vs Meta Spend — per Collection</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 45 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={fmtRs} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} formatter={v => fmtRs(v)} />
              <Bar dataKey="shopifyRev7" name="Shopify 7D Rev" fill="#22c55e" opacity={0.75} radius={[2,2,0,0]} />
              <Bar dataKey="metaSpend"   name="Meta Spend"     fill="#a78bfa" opacity={0.75} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">Collection Revenue × Meta Spend Cross-Reference</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40">
              {['Collection','7D Rev','7D Trend','30D Rev','Meta Spend','Implied ROAS','Meta ROAS','SKUs'].map((h, i) => (
                <th key={h} className={`py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {merged.map((c, i) => (
                <tr key={c.name} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: CH_COLORS[i % CH_COLORS.length] }} />
                      <span className="text-slate-200 max-w-[130px] truncate">{c.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-white">{fmtRs(c.rev7)}</td>
                  <td className="py-2 px-3 text-right">
                    {c.revTrend7vs14 !== null
                      ? <span className={`font-semibold ${c.revTrend7vs14 > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.revTrend7vs14 > 0 ? '+' : ''}{c.revTrend7vs14}%</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtRs(c.rev30)}</td>
                  <td className="py-2 px-3 text-right font-mono text-purple-300">{c.metaSpendAmt > 0 ? fmtRs(c.metaSpendAmt) : <span className="text-slate-600">—</span>}</td>
                  <td className="py-2 px-3 text-right">
                    {c.impliedRoas !== null
                      ? <span className={`font-bold font-mono ${c.impliedRoas >= 3 ? 'text-emerald-400' : c.impliedRoas >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>{c.impliedRoas}x</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{c.meta?.metaRoas > 0 ? c.meta.metaRoas.toFixed(2) + 'x' : <span className="text-slate-600">—</span>}</td>
                  <td className="py-2 px-3 text-right text-slate-500">{c.skuCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-500">Meta-only collections (no Shopify revenue match)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40">
                {['Collection','Meta Spend','Meta Revenue','ROAS','Purchases','Ads'].map((h, i) => (
                  <th key={h} className={`py-2 px-3 text-[10px] uppercase tracking-wider text-slate-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {unmatched.map(m => (
                  <tr key={m.name} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                    <td className="py-2 px-3 text-slate-300">{m.name}</td>
                    <td className="py-2 px-3 text-right font-mono text-purple-300">{fmtRs(m.spend)}</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtRs(m.metaRevenue)}</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-300">{m.metaRoas > 0 ? m.metaRoas.toFixed(2) + 'x' : '—'}</td>
                    <td className="py-2 px-3 text-right text-slate-400">{fmtN(m.purchases)}</td>
                    <td className="py-2 px-3 text-right text-slate-500">{m.ads}</td>
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

/* ══════════════════════════════════════════════════════════════════
   TAB 4 — DROP AUTOPSY
══════════════════════════════════════════════════════════════════ */
function WaterfallBar({ label, value, max }) {
  const w   = max > 0 ? (Math.abs(value) / max) * 50 : 0;
  const pos = value >= 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="text-xs text-slate-400 w-36 shrink-0 truncate">{label}</div>
      <div className="flex-1 relative h-5 flex items-center">
        <div className="absolute left-1/2 w-px h-5 bg-gray-700/50" />
        <div className="absolute h-4 rounded"
          style={{
            width: `${Math.max(1, w)}%`,
            background: pos ? '#22c55e' : '#ef4444',
            opacity: 0.8,
            left: pos ? '50%' : undefined,
            right: pos ? undefined : '50%',
          }} />
      </div>
      <div className={`text-xs font-mono font-bold w-20 text-right shrink-0 ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
        {pos ? '+' : ''}{fmtRs(value)}
      </div>
    </div>
  );
}

function TabDropAutopsy({ orders, inventoryMap, enrichedRows, drops }) {
  const [dropStart, setDropStart] = useState(dateOffset(-14));
  const [dropEnd,   setDropEnd]   = useState(dateOffset(-8));
  const [baseStart, setBaseStart] = useState(dateOffset(-28));
  const [baseEnd,   setBaseEnd]   = useState(dateOffset(-15));
  const [expanded,  setExpanded]  = useState(null);

  const autopsy = useMemo(() => {
    try { return buildDropAutopsy(orders, inventoryMap, enrichedRows, dropStart, dropEnd, baseStart, baseEnd); }
    catch { return null; }
  }, [orders, inventoryMap, enrichedRows, dropStart, dropEnd, baseStart, baseEnd]);

  const maxMag = autopsy ? Math.max(...autopsy.causes.map(c => c.magnitude), 1) : 1;

  const prefill = drop => {
    setDropStart(drop.date);
    setDropEnd(drop.date);
    const bs = new Date(drop.date); bs.setDate(bs.getDate() - 7);
    const be = new Date(drop.date); be.setDate(be.getDate() - 1);
    setBaseStart(bs.toISOString().slice(0, 10));
    setBaseEnd(be.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-5">
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2"><Search size={12} /> Configure Analysis Windows</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[['Drop Period Start', dropStart, setDropStart], ['Drop Period End', dropEnd, setDropEnd], ['Baseline Start', baseStart, setBaseStart], ['Baseline End', baseEnd, setBaseEnd]].map(([label, val, set]) => (
            <div key={label}>
              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">{label}</div>
              <input type="date" value={val} onChange={e => set(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-brand-500 outline-none w-full" />
            </div>
          ))}
        </div>
        {drops.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-600 mb-2">Quick-fill from detected drops:</div>
            <div className="flex flex-wrap gap-1.5">
              {drops.slice(0, 6).map(d => (
                <button key={d.date} onClick={() => prefill(d)}
                  className="px-2 py-1 rounded-lg text-[10px] font-medium border border-gray-700/50 text-slate-500 hover:border-gray-600 hover:text-slate-300 transition-colors">
                  {d.date} ↓{d.dropPct}% <span className={d.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>{d.severity}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!autopsy && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 border border-gray-800/40 rounded-2xl">
          <Search size={32} className="mb-3 opacity-30" />
          <div className="text-sm">Adjust date ranges above — need orders in both drop and baseline periods</div>
        </div>
      )}

      {autopsy && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Drop Period AOV" value={fmtRs(autopsy.drop.aov)} cls={autopsy.Δaov < 0 ? 'text-red-400' : 'text-emerald-400'} sub={`${autopsy.drop.N} orders`} />
            <KpiCard label="Baseline AOV"    value={fmtRs(autopsy.base.aov)} cls="text-white"                                               sub={`${autopsy.base.N} orders`} />
            <KpiCard label="AOV Delta"       value={(autopsy.Δaov > 0 ? '+' : '') + fmtRs(autopsy.Δaov)} cls={autopsy.Δaov >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <KpiCard label="Explained"       value={fmtRs(Math.abs(autopsy.totalExplained))} sub={`${autopsy.Δaov !== 0 ? Math.abs(autopsy.totalExplained / autopsy.Δaov * 100).toFixed(0) : 0}% of delta`} cls="text-slate-300" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4 space-y-4">
              <div className="text-xs font-semibold text-slate-400">Root Cause Ranking — ₹ Impact on AOV</div>
              {autopsy.causes.length === 0 && <div className="text-xs text-slate-600 py-8 text-center">No significant causes identified in this window</div>}
              <div className="space-y-1">
                {autopsy.causes.map(c => <WaterfallBar key={c.type} label={c.label} value={c.impact} max={maxMag} />)}
                {Math.abs(autopsy.unexplained) > 20 && <WaterfallBar label="Unexplained" value={autopsy.unexplained} max={maxMag} />}
              </div>
              <div className="space-y-3 pt-2 border-t border-gray-800/40">
                {autopsy.causes.map(c => (
                  <div key={c.type}
                    className={`rounded-xl border p-3 cursor-pointer transition-all ${c.impact < 0 ? 'border-red-800/30 bg-red-950/10 hover:bg-red-950/20' : 'border-emerald-800/30 bg-emerald-950/10 hover:bg-emerald-950/20'}`}
                    onClick={() => setExpanded(expanded === c.type ? null : c.type)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{c.icon}</span>
                        <div>
                          <div className="text-xs font-semibold text-white">{c.label}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{c.detail}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c.confidence === 'confirmed' ? 'bg-red-900/40 text-red-400' : c.confidence === 'high' ? 'bg-orange-900/40 text-orange-400' : c.confidence === 'medium' ? 'bg-amber-900/30 text-amber-400' : 'bg-gray-800 text-slate-500'}`}>{c.confidence}</span>
                        <span className={`text-sm font-bold ${c.impact < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{c.impact > 0 ? '+' : ''}{fmtRs(c.impact)}</span>
                      </div>
                    </div>
                    {expanded === c.type && (
                      <div className="mt-3 pt-3 border-t border-gray-800/40 space-y-2">
                        <div className="text-[10px] text-blue-300 flex items-start gap-1"><Info size={9} className="shrink-0 mt-px" />{c.action}</div>
                        {c.type === 'oos' && c.items?.slice(0, 5).map(s => (
                          <div key={s.sku} className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="truncate flex-1">{s.name}</span>
                            <span className="text-slate-600 ml-2">{s.collection}</span>
                            <span className="ml-2 text-red-400 font-mono">{fmtRs(s.revLost)}</span>
                            <span className={`ml-2 px-1 rounded border text-[9px] ${CONF_STYLES[s.confidence]?.pill}`}>{s.daysSilent}d silent{s.currentStock === 0 ? ' ·stock=0' : ''}</span>
                          </div>
                        ))}
                        {c.type === 'discount' && c.items?.slice(0, 5).map(dc => (
                          <div key={dc.code} className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono text-amber-400">{dc.code}</span>
                            <span>{dc.uses}x used</span>
                            <span className="text-red-400 font-mono">avg {fmtRs(dc.totalDisc / dc.uses)} off</span>
                          </div>
                        ))}
                        {c.type === 'channel' && c.items?.slice(0, 5).map(ch => (
                          <div key={ch.channel} className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{ch.channel}</span>
                            <span>{ch.basePct}% → {ch.dropPct}%</span>
                            <span className={ch.delta > 0 ? 'text-blue-400' : 'text-orange-400'}>{ch.delta > 0 ? '+' : ''}{ch.delta}pp</span>
                          </div>
                        ))}
                        {c.type === 'price_mix' && c.items?.filter(s => s.status !== 'stable').slice(0, 6).map(s => (
                          <div key={s.sku} className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="truncate flex-1">{s.name}</span>
                            <span className="mx-2 text-slate-600">₹{s.price}</span>
                            <span>{fmtRs(s.bRev)} → {fmtRs(s.dRev)}</span>
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${s.status === 'disappeared' ? 'bg-red-900/30 text-red-400' : s.status === 'crashed' ? 'bg-orange-900/30 text-orange-400' : s.status === 'surged' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-gray-800 text-slate-400'}`}>{s.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800/50 text-xs font-semibold text-slate-400">Product Revenue Changes</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-800/30">
                      {['Product','Base/Day','Drop/Day','Δ','Status'].map((h, i) => (
                        <th key={h} className={`py-2 px-2 text-[10px] uppercase tracking-wider text-slate-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {autopsy.skuChanges.filter(s => s.status !== 'stable' || s.bRev > 200).slice(0, 15).map(s => (
                        <tr key={s.sku} className="border-b border-gray-800/20 hover:bg-white/[0.02]">
                          <td className="py-1.5 px-2 max-w-[120px]">
                            <div className="truncate text-slate-200">{s.name}</div>
                            {s.isOos && <span className={`text-[9px] px-1 py-0.5 rounded border ${CONF_STYLES[s.oosConf]?.pill || ''}`}>OOS</span>}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-slate-400">{fmtRs(s.bRev)}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtRs(s.dRev)}</td>
                          <td className={`py-1.5 px-2 text-right font-mono font-bold ${s.revChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.revChange > 0 ? '+' : ''}{fmtRs(s.revChange)}</td>
                          <td className="py-1.5 px-2 text-right">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${s.status === 'disappeared' ? 'bg-red-900/30 text-red-400' : s.status === 'crashed' ? 'bg-orange-900/30 text-orange-400' : s.status === 'surged' ? 'bg-emerald-900/30 text-emerald-400' : s.status === 'new' ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-800 text-slate-400'}`}>{s.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 p-4">
                <div className="text-xs font-semibold text-slate-400 mb-3">Period Comparison</div>
                <div className="space-y-2 text-xs">
                  {[
                    ['Orders/Day',     autopsy.base.ordersPerDay.toFixed(1),  autopsy.drop.ordersPerDay.toFixed(1)],
                    ['Items/Order',    autopsy.base.itemsPerOrder.toFixed(2),  autopsy.drop.itemsPerOrder.toFixed(2)],
                    ['Avg Item Price', fmtRs(autopsy.base.avgItemPrice),       fmtRs(autopsy.drop.avgItemPrice)],
                    ['Discount Rate',  autopsy.base.discRate.toFixed(1) + '%', autopsy.drop.discRate.toFixed(1) + '%'],
                    ['Avg Discount',   fmtRs(autopsy.base.avgDiscount),        fmtRs(autopsy.drop.avgDiscount)],
                    ['New Customer %', autopsy.base.newPct.toFixed(0) + '%',   autopsy.drop.newPct.toFixed(0) + '%'],
                  ].map(([label, bVal, dVal]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-slate-600">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono">{bVal}</span>
                        <span className="text-slate-700">→</span>
                        <span className="text-slate-300 font-mono">{dVal}</span>
                      </div>
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
   TAB 5 — PRODUCT VITALS
══════════════════════════════════════════════════════════════════ */
function TabProductVitals({ vitals }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort]                 = useState('rev30');

  const counts = useMemo(() => {
    const c = { oos: 0, critical: 0, low: 0, paused: 0, ok: 0 };
    vitals.forEach(v => { c[v.stockStatus] = (c[v.stockStatus] || 0) + 1; });
    return c;
  }, [vitals]);

  const visible = useMemo(() => {
    let v = statusFilter === 'all' ? vitals : vitals.filter(p => p.stockStatus === statusFilter);
    return [...v].sort((a, b) => {
      if (sort === 'rev30')     return b.rev30 - a.rev30;
      if (sort === 'velocity')  return b.velocity7d - a.velocity7d;
      if (sort === 'runway')    return (a.runway ?? 9999) - (b.runway ?? 9999);
      if (sort === 'daysSilent') return b.daysSilent - a.daysSilent;
      return b.rev30 - a.rev30;
    });
  }, [vitals, statusFilter, sort]);

  const oosRisk = vitals.filter(v => v.stockStatus === 'oos' || v.stockStatus === 'critical').reduce((s, v) => s + v.rev7, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Total Products"   value={String(vitals.length)} cls="text-white" />
        <KpiCard label="OOS (Stock = 0)"  value={String(counts.oos)}      cls={counts.oos > 0 ? 'text-red-400' : 'text-slate-400'}    warn={counts.oos > 0} />
        <KpiCard label="Critical (<7d)"   value={String(counts.critical)}  cls={counts.critical > 0 ? 'text-orange-400' : 'text-slate-400'} />
        <KpiCard label="Low Stock (<14d)" value={String(counts.low)}       cls={counts.low > 0 ? 'text-amber-400' : 'text-slate-400'} />
        <KpiCard label="OOS Rev Risk (7D)" value={fmtRs(oosRisk)}         sub="OOS + Critical products" cls="text-red-400" warn={oosRisk > 5000} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[['all','All',vitals.length], ['oos','OOS',counts.oos], ['critical','Critical',counts.critical], ['low','Low Stock',counts.low], ['paused','Paused',counts.paused], ['ok','Healthy',counts.ok]].map(([val, lbl, cnt]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${statusFilter === val ? 'bg-brand-600/20 text-brand-300 border-brand-500/30' : 'text-slate-500 hover:text-slate-300 bg-gray-800/50 border-gray-700/30'}`}>
              {lbl} <span className="opacity-60">{cnt}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 items-center">
          <span className="text-[10px] text-slate-600">Sort:</span>
          {[['rev30','30D Rev'], ['velocity','Velocity'], ['runway','Runway ↑'], ['daysSilent','Silent ↓']].map(([val, lbl]) => (
            <button key={val} onClick={() => setSort(val)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${sort === val ? 'bg-gray-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40 bg-gray-900/60">
              {['Product','Status','Collection','7D Rev','30D Rev','Velocity','Stock','Runway','Last Sale','14D Spark'].map((h, i) => (
                <th key={h} className={`py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {visible.map(p => (
                <tr key={p.sku} className={`border-b border-gray-800/20 hover:bg-white/[0.02] ${p.stockStatus === 'oos' ? 'bg-red-950/5' : p.stockStatus === 'critical' ? 'bg-orange-950/5' : ''}`}>
                  <td className="py-2 px-3">
                    <div className="text-slate-200 max-w-[160px] truncate font-medium">{p.name}</div>
                    <div className="text-[9px] text-slate-600">{p.sku}</div>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLES[p.stockStatus]}`}>
                      {STATUS_ICONS[p.stockStatus]}{p.stockStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className="text-[10px] text-slate-500 bg-gray-800/60 px-1.5 py-0.5 rounded max-w-[80px] truncate inline-block">{p.collection}</span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-white">{fmtRs(p.rev7)}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtRs(p.rev30)}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-mono ${p.velocity7d > 0.5 ? 'text-white' : p.velocity7d > 0.1 ? 'text-slate-400' : 'text-slate-600'}`}>{p.velocity7d.toFixed(2)}/d</span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-mono ${p.stock === 0 ? 'text-red-400 font-bold' : p.stock === null ? 'text-slate-600' : p.stock < 10 ? 'text-orange-400' : 'text-slate-300'}`}>
                      {p.stock === null ? '—' : p.stock}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    {p.runway === null
                      ? <span className="text-slate-600">—</span>
                      : <span className={`font-mono ${p.runway < 7 ? 'text-red-400 font-bold' : p.runway < 14 ? 'text-orange-400' : p.runway < 30 ? 'text-amber-400' : 'text-slate-300'}`}>{p.runway}d</span>
                    }
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-[10px] ${p.daysSilent > 7 ? 'text-red-400' : p.daysSilent > 3 ? 'text-amber-400' : 'text-slate-400'}`}>
                      {p.lastSaleDate || '—'}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex justify-end">
                      <SparkLine data={p.sparkline} dataKey="rev"
                        color={p.stockStatus === 'oos' ? '#ef4444' : p.stockStatus === 'critical' ? '#f97316' : p.stockStatus === 'ok' ? '#22c55e' : '#64748b'}
                        height={28} />
                    </div>
                  </td>
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
   MAIN PAGE
══════════════════════════════════════════════════════════════════ */
const TABS = [
  { id: 'command',     label: 'Command Center',    Icon: Activity },
  { id: 'oos',         label: 'OOS Forensics',     Icon: AlertCircle },
  { id: 'collections', label: 'Collection Matrix', Icon: Layers },
  { id: 'autopsy',     label: 'Drop Autopsy',      Icon: Search },
  { id: 'vitals',      label: 'Product Vitals',    Icon: Package },
];

export default function AOVAnalysis() {
  const { shopifyOrders, inventoryMap, enrichedRows, brands, activeBrandIds, brandData } = useStore();
  const [tab, setTab] = useState('command');

  const orders = shopifyOrders || [];
  const invMap = inventoryMap || {};

  const gaData = useMemo(() => {
    for (const b of (brands || []).filter(b => (activeBrandIds || []).includes(b.id))) {
      const d = brandData?.[b.id]?.gaData;
      if (d?.dailyTrend?.length) return d;
    }
    return null;
  }, [brands, activeBrandIds, brandData]);

  const timeline   = useMemo(() => buildAovTimeline(orders), [orders]);
  const gaBlended  = useMemo(() => blendGaWithAov(timeline, gaData), [timeline, gaData]);
  const drops      = useMemo(() => detectDropEvents(timeline), [timeline]);
  const oosSignals = useMemo(() => detectOosSignals(orders, invMap), [orders, invMap]);
  const collRev    = useMemo(() => buildCollectionRevenue(orders, invMap), [orders, invMap]);
  const metaSpend  = useMemo(() => buildMetaCollectionSpend(enrichedRows || []), [enrichedRows]);
  const vitals     = useMemo(() => buildProductVitals(orders, invMap), [orders, invMap]);

  const avgAov     = timeline.length ? timeline.reduce((s, d) => s + d.aov, 0) / timeline.length : 0;
  const lastDay    = timeline[timeline.length - 1];
  const oosHigh    = oosSignals.filter(s => ['confirmed', 'high'].includes(s.confidence));
  const oosRevRisk = oosHigh.reduce((s, x) => s + x.revLost, 0);

  return (
    <NeedsShopify checkOrders>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <TrendingDown size={20} className="text-brand-400" />
              AOV Analysis
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">OOS forensics · collection matrix · drop autopsy · product vitals · Shopify × Meta × GA</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {oosHigh.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-1.5">
                <AlertCircle size={11} /> {oosHigh.length} OOS · {fmtRs(oosRevRisk)} at risk
              </div>
            )}
            {drops.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-1.5">
                <AlertTriangle size={11} /> {drops.length} drops detected
              </div>
            )}
            {gaData && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-900/20 border border-blue-800/30 rounded-lg px-3 py-1.5">
                <Activity size={11} /> GA blended
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <KpiCard label="Period AOV (avg)"   value={fmtRs(avgAov)} />
          <KpiCard label="Latest Day AOV"     value={fmtRs(lastDay?.aov)} sub={lastDay?.date} cls={lastDay && lastDay.aov < avgAov * 0.9 ? 'text-red-400' : 'text-emerald-400'} />
          <KpiCard label="Avg Items/Order"    value={(timeline.reduce((s, d) => s + d.itemsPerOrder, 0) / (timeline.length || 1)).toFixed(2)} />
          <KpiCard label="Avg Discount Rate"  value={fmtPct(timeline.reduce((s, d) => s + d.discountRate, 0) / (timeline.length || 1))} inverse />
          <KpiCard label="Data Range"         value={`${timeline.length}d`} sub={`${timeline[0]?.date || ''} – ${lastDay?.date || ''}`} cls="text-slate-300" />
        </div>

        <div className="flex gap-0.5 border-b border-gray-800/60 overflow-x-auto">
          {TABS.map(t => {
            const Icon  = t.Icon;
            const badge = t.id === 'oos' ? oosHigh.length : t.id === 'autopsy' ? drops.length : 0;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                  ${tab === t.id ? 'text-white border-brand-500 bg-brand-900/10' : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-gray-800/30'}`}>
                <Icon size={12} />{t.label}
                {badge > 0 && <span className={`text-[9px] px-1.5 rounded font-bold ${t.id === 'oos' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>{badge}</span>}
              </button>
            );
          })}
        </div>

        <div>
          {tab === 'command'     && <TabCommandCenter timeline={timeline} drops={drops} gaBlended={gaBlended} oosSignals={oosSignals} />}
          {tab === 'oos'         && <TabOosForensics oosSignals={oosSignals} />}
          {tab === 'collections' && <TabCollectionMatrix collRevenue={collRev} metaSpend={metaSpend} />}
          {tab === 'autopsy'     && <TabDropAutopsy orders={orders} inventoryMap={invMap} enrichedRows={enrichedRows || []} drops={drops} />}
          {tab === 'vitals'      && <TabProductVitals vitals={vitals} />}
        </div>
      </div>
    </NeedsShopify>
  );
}
