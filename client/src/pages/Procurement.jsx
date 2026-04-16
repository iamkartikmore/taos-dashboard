import { useMemo, useState, useCallback } from 'react';
import {
  AlertTriangle, Package, TrendingDown, BarChart3, ShoppingCart,
  Settings, RefreshCw, Download, Search, ChevronUp, ChevronDown,
  Truck, DollarSign, Clock, Star, Archive, Plus, Trash2, Save, CheckCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { useStore } from '../store';
import {
  buildProcurementTable, calcProcurementSummary, calcAbcAnalysis,
  getTopMovers, getSlowMovers, HEALTH_META,
} from '../lib/procurementAnalytics';

/* ─── FORMATTERS ──────────────────────────────────────────────────── */
const fmtCur = v => `₹${(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtNum = v => (v || 0).toLocaleString('en-IN');
const fmtVel = v => v >= 1 ? `${v.toFixed(1)}/d` : `${(v * 30).toFixed(1)}/mo`;
const fmtDoi = v => v >= 999 ? '∞' : v === 0 ? '0d' : `${v}d`;

/* ─── METRIC CARD ─────────────────────────────────────────────────── */
function MetricCard({ label, value, sub, icon: Icon, color = 'brand', danger = false, warn = false }) {
  const colorCls = danger ? 'from-red-900/40 to-red-900/20 border-red-700/30'
    : warn ? 'from-amber-900/40 to-amber-900/20 border-amber-700/30'
    : color === 'green' ? 'from-emerald-900/40 to-emerald-900/20 border-emerald-700/30'
    : color === 'violet' ? 'from-violet-900/40 to-violet-900/20 border-violet-700/30'
    : 'from-brand-900/40 to-brand-900/20 border-brand-700/30';
  const iconCls = danger ? 'text-red-400' : warn ? 'text-amber-400'
    : color === 'green' ? 'text-emerald-400' : color === 'violet' ? 'text-violet-400' : 'text-brand-400';
  return (
    <div className={`bg-gradient-to-br ${colorCls} border rounded-xl p-4 space-y-1`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        {Icon && <Icon size={14} className={iconCls} />}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

/* ─── HEALTH BADGE ────────────────────────────────────────────────── */
function HealthBadge({ health }) {
  const m = HEALTH_META[health] || HEALTH_META.healthy;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${m.bg} ${m.text} ${m.ring}`}>
      {m.label}
    </span>
  );
}

/* ─── SORTABLE TABLE HEADER ───────────────────────────────────────── */
function Th({ col, label, sortKey, onSort }) {
  const active = sortKey?.key === col;
  return (
    <th onClick={() => onSort(col)}
      className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-200 whitespace-nowrap select-none">
      <span className="flex items-center gap-1">
        {label}
        {active ? (sortKey.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
      </span>
    </th>
  );
}

/* ─── REORDER PLANNER TAB ─────────────────────────────────────────── */
function ReorderPlanner({ rows, suppliers, onUpdateSupplier }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState({ key: 'priority', dir: 'asc' });
  const [expandedSku, setExpandedSku] = useState(null);

  const handleSort = col => setSortKey(prev =>
    prev.key === col ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: col, dir: 'asc' }
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === 'reorder')   r = r.filter(x => x.shouldReorder);
    if (filter === 'critical')  r = r.filter(x => ['critical','stockout'].includes(x.health));
    if (filter === 'low')       r = r.filter(x => x.health === 'low');
    if (filter === 'overstock') r = r.filter(x => x.health === 'overstock');
    if (filter === 'dead')      r = r.filter(x => x.isDead);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(x => x.sku.toLowerCase().includes(q) || x.title.toLowerCase().includes(q) || x.supplier.toLowerCase().includes(q));
    }
    return [...r].sort((a, b) => {
      const av = a[sortKey.key], bv = b[sortKey.key];
      if (av == null) return 1; if (bv == null) return -1;
      return sortKey.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [rows, filter, search, sortKey]);

  const toReorder = rows.filter(r => r.shouldReorder);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU / name..."
            className="pl-7 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500 w-52" />
        </div>
        {[
          { id: 'all',       label: `All (${rows.length})` },
          { id: 'reorder',  label: `Reorder Now (${toReorder.length})`,              cls: 'text-red-400' },
          { id: 'critical', label: `Critical (${rows.filter(r=>['critical','stockout'].includes(r.health)).length})`, cls: 'text-orange-400' },
          { id: 'overstock',label: `Overstock (${rows.filter(r=>r.health==='overstock').length})`, cls: 'text-violet-400' },
          { id: 'dead',     label: `Dead Stock (${rows.filter(r=>r.isDead).length})`, cls: 'text-slate-400' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filter === f.id
                ? 'bg-brand-600/30 text-brand-300 border-brand-500/40'
                : `bg-gray-800/60 border-gray-700 text-slate-500 hover:text-slate-300 ${f.cls || ''}`
            }`}>
            {f.label}
          </button>
        ))}

        {toReorder.length > 0 && (
          <button
            onClick={() => {
              const csv = ['SKU,Name,Stock,DOI,Velocity/day,Reorder Qty,Supplier,Lead Time,Est Cost',
                ...toReorder.map(r => `"${r.sku}","${r.title}",${r.stock},${r.doi},${r.vel30.toFixed(2)},${r.reorderQty},"${r.supplier}",${r.leadTime},${r.estReorderCost.toFixed(0)}`),
              ].join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              a.download = 'reorder_list.csv';
              a.click();
            }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/20 hover:bg-emerald-700/40 border border-emerald-700/30 rounded-lg text-xs font-medium text-emerald-300 transition-all">
            <Download size={11} /> Export Reorder List
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-800 bg-gray-950/60">
              <tr>
                <Th col="sku"          label="SKU"            sortKey={sortKey} onSort={handleSort} />
                <Th col="title"        label="Product"        sortKey={sortKey} onSort={handleSort} />
                <Th col="stock"        label="Stock"          sortKey={sortKey} onSort={handleSort} />
                <Th col="doi"          label="Days Left"      sortKey={sortKey} onSort={handleSort} />
                <Th col="vel30"        label="Vel 30d"        sortKey={sortKey} onSort={handleSort} />
                <Th col="vel7"         label="Vel 7d"         sortKey={sortKey} onSort={handleSort} />
                <Th col="health"       label="Status"         sortKey={sortKey} onSort={handleSort} />
                <Th col="shouldReorder" label="Reorder?"     sortKey={sortKey} onSort={handleSort} />
                <Th col="reorderQty"   label="Qty to Order"  sortKey={sortKey} onSort={handleSort} />
                <Th col="supplier"     label="Supplier"       sortKey={sortKey} onSort={handleSort} />
                <Th col="leadTime"     label="Lead (d)"       sortKey={sortKey} onSort={handleSort} />
                <Th col="inventoryValue" label="Inv Value"   sortKey={sortKey} onSort={handleSort} />
                <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/40">
              {filtered.map((row) => {
                const expanded = expandedSku === row.sku;
                return [
                  <tr key={row.sku}
                    className={`transition-colors hover:bg-gray-800/30 ${row.shouldReorder ? 'bg-red-950/10' : ''}`}>
                    <td className="px-3 py-2 font-mono text-slate-300">{row.sku}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-[180px]">
                      <div className="truncate">{row.title}</div>
                      {row.variantTitle && <div className="text-[10px] text-slate-500 truncate">{row.variantTitle}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmtNum(row.stock)}</td>
                    <td className={`px-3 py-2 font-bold ${row.doi < 14 ? 'text-red-400' : row.doi < 30 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {fmtDoi(row.doi)}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{fmtVel(row.vel30)}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtVel(row.vel7)}</td>
                    <td className="px-3 py-2"><HealthBadge health={row.health} /></td>
                    <td className="px-3 py-2">
                      {row.shouldReorder
                        ? <span className="flex items-center gap-1 text-red-400 font-semibold"><AlertTriangle size={10} /> Yes</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{row.shouldReorder ? fmtNum(row.reorderQty) : '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{row.supplier || <span className="text-slate-700">—</span>}</td>
                    <td className="px-3 py-2 text-slate-400">{row.leadTime}d</td>
                    <td className="px-3 py-2 text-slate-300">{fmtCur(row.inventoryValue)}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => setExpandedSku(expanded ? null : row.sku)}
                        className="p-1 text-slate-600 hover:text-brand-400 transition-colors">
                        <Settings size={11} />
                      </button>
                    </td>
                  </tr>,
                  expanded && (
                    <tr key={`${row.sku}-edit`} className="bg-gray-900/80">
                      <td colSpan={13} className="px-4 py-3">
                        <SupplierEditRow sku={row.sku} current={suppliers[row.sku]} row={row}
                          onSave={data => { onUpdateSupplier(row.sku, data); setExpandedSku(null); }} />
                      </td>
                    </tr>
                  ),
                ];
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-600">No SKUs match the current filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── SUPPLIER EDIT ROW ───────────────────────────────────────────── */
function SupplierEditRow({ sku, current = {}, row, onSave }) {
  const [form, setForm] = useState({
    supplier:    current.supplier    || '',
    leadTimeDays:current.leadTimeDays ?? 14,
    moq:         current.moq         ?? 0,
    costPrice:   current.costPrice   ?? 0,
    safetyDays:  current.safetyDays  ?? 7,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-wrap items-end gap-3 bg-gray-800/60 rounded-lg p-3">
      <span className="text-xs font-bold text-brand-400 shrink-0">Edit: {sku}</span>
      {[
        { key: 'supplier',     label: 'Supplier',       type: 'text',   placeholder: 'Supplier name' },
        { key: 'leadTimeDays', label: 'Lead Time (d)',  type: 'number', placeholder: '14' },
        { key: 'moq',          label: 'MOQ',            type: 'number', placeholder: '0' },
        { key: 'costPrice',    label: 'Cost Price (₹)', type: 'number', placeholder: '0' },
        { key: 'safetyDays',   label: 'Safety Days',   type: 'number', placeholder: '7' },
      ].map(f => (
        <div key={f.key} className="space-y-0.5">
          <label className="text-[10px] text-slate-500">{f.label}</label>
          <input type={f.type} value={form[f.key]}
            onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
            placeholder={f.placeholder}
            className="w-28 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
      ))}
      <button onClick={() => onSave(form)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/30 hover:bg-brand-600/50 border border-brand-500/40 rounded-lg text-xs font-medium text-brand-300 transition-all">
        <Save size={11} /> Save
      </button>
    </div>
  );
}

/* ─── ABC ANALYSIS TAB ────────────────────────────────────────────── */
const ABC_COLORS = { A: '#22c55e', B: '#f59e0b', C: '#6366f1' };
const ABC_TOOLTIP_STYLE = { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 11 };

function AbcAnalysis({ rows }) {
  const abcRows = useMemo(() => calcAbcAnalysis(rows), [rows]);

  const pieData = useMemo(() => {
    const groups = { A: { count: 0, revenue: 0 }, B: { count: 0, revenue: 0 }, C: { count: 0, revenue: 0 } };
    abcRows.forEach(r => { groups[r.abc].count++; groups[r.abc].revenue += r.rev30; });
    return Object.entries(groups).map(([name, d]) => ({ name, ...d }));
  }, [abcRows]);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {pieData.map(g => (
          <div key={g.name} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ background: ABC_COLORS[g.name] }} />
              <span className="text-sm font-bold text-white">Class {g.name}</span>
              {g.name === 'A' && <span className="text-[10px] text-slate-500">Top 80% revenue</span>}
              {g.name === 'B' && <span className="text-[10px] text-slate-500">Next 15%</span>}
              {g.name === 'C' && <span className="text-[10px] text-slate-500">Bottom 5%</span>}
            </div>
            <div className="text-xl font-bold text-white">{g.count} SKUs</div>
            <div className="text-sm text-slate-400">{fmtCur(g.revenue)} / 30d</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Pie */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Revenue Distribution</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                {pieData.map(e => <Cell key={e.name} fill={ABC_COLORS[e.name]} />)}
              </Pie>
              <Tooltip contentStyle={ABC_TOOLTIP_STYLE} formatter={v => fmtCur(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top A SKUs */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Top Class-A SKUs (by 30d revenue)</div>
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {abcRows.filter(r => r.abc === 'A').slice(0, 15).map((r, i) => (
              <div key={r.sku} className="flex items-center gap-2 py-1 border-b border-gray-800/40">
                <span className="text-[10px] text-slate-600 w-4">{i + 1}.</span>
                <span className="font-mono text-[10px] text-slate-400 w-20 truncate">{r.sku}</span>
                <span className="text-xs text-slate-300 flex-1 truncate">{r.title}</span>
                <span className="text-xs text-emerald-400 font-medium">{fmtCur(r.rev30)}</span>
                <HealthBadge health={r.health} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bar chart — top 20 SKUs by revenue */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="text-xs font-semibold text-slate-400 mb-3">Top 20 SKUs by 30d Revenue</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={abcRows.slice(0, 20)} margin={{ left: 0, right: 10, top: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="sku" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-40} textAnchor="end" interval={0} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip contentStyle={ABC_TOOLTIP_STYLE} formatter={v => fmtCur(v)} />
            <Bar dataKey="rev30" radius={[3, 3, 0, 0]}>
              {abcRows.slice(0, 20).map(r => (
                <Cell key={r.sku} fill={ABC_COLORS[r.abc]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── VELOCITY ANALYSIS TAB ───────────────────────────────────────── */
function VelocityAnalysis({ rows }) {
  const topMovers  = useMemo(() => getTopMovers(rows, 15),  [rows]);
  const slowMovers = useMemo(() => getSlowMovers(rows, 10), [rows]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Top movers */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Star size={13} className="text-amber-400" />
            <span className="text-xs font-semibold text-slate-200">Top Movers — 30d velocity</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topMovers} layout="vertical" margin={{ left: 60, right: 10 }}>
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `${v.toFixed(1)}/d`} />
              <YAxis type="category" dataKey="sku" tick={{ fill: '#9ca3af', fontSize: 9 }} width={55} />
              <Tooltip contentStyle={ABC_TOOLTIP_STYLE} formatter={v => `${v.toFixed(2)} units/day`} />
              <Bar dataKey="vel30" fill="#22c55e" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Slow movers */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={13} className="text-red-400" />
            <span className="text-xs font-semibold text-slate-200">Slow Movers (in-stock, low velocity)</span>
          </div>
          <div className="space-y-1">
            {slowMovers.map(r => (
              <div key={r.sku} className="flex items-center gap-2 py-1.5 border-b border-gray-800/40">
                <span className="font-mono text-[10px] text-slate-400 w-20 truncate">{r.sku}</span>
                <span className="text-xs text-slate-300 flex-1 truncate">{r.title}</span>
                <span className="text-xs text-slate-400">{r.stock} in stock</span>
                <span className="text-xs text-red-400 font-medium">{fmtVel(r.vel30)}</span>
                <HealthBadge health={r.health} />
              </div>
            ))}
            {slowMovers.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No slow movers found</p>}
          </div>
        </div>
      </div>

      {/* Velocity comparison table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-slate-300">
          Velocity Comparison — 7d vs 30d vs 90d
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-950/60 border-b border-gray-800">
              <tr>
                {['SKU','Product','Stock','7d vel','30d vel','90d vel','Trend','DOI','Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/40">
              {[...rows].filter(r => r.vel30 > 0 || r.vel7 > 0).sort((a, b) => b.vel30 - a.vel30).slice(0, 50).map(r => {
                const trend = r.vel7 > r.vel30 * 1.2 ? '↑ Accelerating'
                  : r.vel7 < r.vel30 * 0.8 ? '↓ Slowing'
                  : '→ Stable';
                const trendCls = trend.startsWith('↑') ? 'text-emerald-400' : trend.startsWith('↓') ? 'text-red-400' : 'text-slate-400';
                return (
                  <tr key={r.sku} className="hover:bg-gray-800/30">
                    <td className="px-3 py-2 font-mono text-slate-400">{r.sku}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-[160px] truncate">{r.title}</td>
                    <td className="px-3 py-2 text-slate-300">{fmtNum(r.stock)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmtVel(r.vel7)}</td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmtVel(r.vel30)}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtVel(r.vel90)}</td>
                    <td className={`px-3 py-2 font-medium ${trendCls}`}>{trend}</td>
                    <td className={`px-3 py-2 font-bold ${r.doi < 14 ? 'text-red-400' : r.doi < 30 ? 'text-amber-400' : 'text-slate-300'}`}>{fmtDoi(r.doi)}</td>
                    <td className="px-3 py-2"><HealthBadge health={r.health} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── DEAD STOCK TAB ──────────────────────────────────────────────── */
function DeadStock({ rows }) {
  const dead = useMemo(() => rows.filter(r => r.isDead).sort((a, b) => b.inventoryValue - a.inventoryValue), [rows]);
  const totalValue = dead.reduce((s, r) => s + r.inventoryValue, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 p-4 bg-amber-900/20 border border-amber-700/30 rounded-xl">
        <Archive size={20} className="text-amber-400 shrink-0" />
        <div>
          <div className="text-sm font-bold text-white">{dead.length} SKUs with zero sales in 90+ days</div>
          <div className="text-xs text-slate-400">{fmtCur(totalValue)} in inventory value locked up in dead stock</div>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/60">
            <tr>
              {['SKU','Product','Stock','Last Sale','Days No Sale','Inv Value','Cost Value','Action'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/40">
            {dead.map(r => (
              <tr key={r.sku} className="hover:bg-gray-800/30">
                <td className="px-3 py-2 font-mono text-slate-400">{r.sku}</td>
                <td className="px-3 py-2 text-slate-300 max-w-[180px]">
                  <div className="truncate">{r.title}</div>
                  {r.variantTitle && <div className="text-[10px] text-slate-500 truncate">{r.variantTitle}</div>}
                </td>
                <td className="px-3 py-2 text-slate-300">{fmtNum(r.stock)}</td>
                <td className="px-3 py-2 text-slate-400">{r.lastSaleDate ? r.lastSaleDate.toLocaleDateString() : 'Never'}</td>
                <td className="px-3 py-2 text-amber-400 font-semibold">{r.daysSinceSale >= 999 ? 'Never sold' : `${r.daysSinceSale}d`}</td>
                <td className="px-3 py-2 text-slate-300">{fmtCur(r.inventoryValue)}</td>
                <td className="px-3 py-2 text-slate-400">{fmtCur(r.costValue)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-amber-900/30 text-amber-400 rounded text-[9px]">Bundle?</span>
                    <span className="px-1.5 py-0.5 bg-violet-900/30 text-violet-400 rounded text-[9px]">Discount?</span>
                  </div>
                </td>
              </tr>
            ))}
            {dead.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600">No dead stock — all SKUs have recent sales</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── PURCHASE ORDERS TAB ─────────────────────────────────────────── */
function PurchaseOrders({ purchaseOrders, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sku: '', supplier: '', quantity: '', unitCost: '', expectedDelivery: '', status: 'pending', notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = () => {
    if (!form.sku || !form.quantity) return;
    onAdd({
      id: `PO-${Date.now()}`,
      ...form,
      quantity: parseInt(form.quantity) || 0,
      unitCost: parseFloat(form.unitCost) || 0,
      orderDate: new Date().toISOString().slice(0, 10),
    });
    setForm({ sku: '', supplier: '', quantity: '', unitCost: '', expectedDelivery: '', status: 'pending', notes: '' });
    setShowForm(false);
  };

  const STATUS_META = {
    pending:  { label: 'Pending',   cls: 'bg-amber-900/30 text-amber-400' },
    ordered:  { label: 'Ordered',   cls: 'bg-blue-900/30 text-blue-400' },
    shipped:  { label: 'Shipped',   cls: 'bg-violet-900/30 text-violet-400' },
    received: { label: 'Received',  cls: 'bg-emerald-900/30 text-emerald-400' },
    cancelled:{ label: 'Cancelled', cls: 'bg-gray-800 text-slate-500' },
  };

  const totalPending = purchaseOrders.filter(p => ['pending','ordered','shipped'].includes(p.status))
    .reduce((s, p) => s + (p.quantity || 0) * (p.unitCost || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="text-xs text-slate-400">{purchaseOrders.length} orders · {fmtCur(totalPending)} in transit/pending</div>
        <button onClick={() => setShowForm(v => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600/40 border border-brand-500/30 rounded-lg text-xs font-medium text-brand-300 transition-all">
          <Plus size={11} /> New PO
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 border border-brand-700/30 rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold text-brand-300">New Purchase Order</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { key: 'sku',              label: 'SKU',              type: 'text'   },
              { key: 'supplier',         label: 'Supplier',         type: 'text'   },
              { key: 'quantity',         label: 'Quantity',         type: 'number' },
              { key: 'unitCost',         label: 'Unit Cost (₹)',    type: 'number' },
              { key: 'expectedDelivery', label: 'Expected Delivery',type: 'date'   },
              { key: 'notes',            label: 'Notes',            type: 'text'   },
            ].map(f => (
              <div key={f.key} className="space-y-0.5">
                <label className="text-[10px] text-slate-500">{f.label}</label>
                <input type={f.type} value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-xs font-medium text-white transition-all">
              <CheckCircle size={11} /> Create PO
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/60">
            <tr>
              {['PO ID','SKU','Supplier','Qty','Unit Cost','Total','Order Date','Expected','Status',''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/40">
            {purchaseOrders.map(po => {
              const sm = STATUS_META[po.status] || STATUS_META.pending;
              return (
                <tr key={po.id} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 font-mono text-slate-400">{po.id}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{po.sku}</td>
                  <td className="px-3 py-2 text-slate-300">{po.supplier || '—'}</td>
                  <td className="px-3 py-2 text-slate-200">{fmtNum(po.quantity)}</td>
                  <td className="px-3 py-2 text-slate-400">{fmtCur(po.unitCost)}</td>
                  <td className="px-3 py-2 text-slate-200 font-medium">{fmtCur((po.quantity || 0) * (po.unitCost || 0))}</td>
                  <td className="px-3 py-2 text-slate-400">{po.orderDate || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{po.expectedDelivery || '—'}</td>
                  <td className="px-3 py-2">
                    <select value={po.status}
                      onChange={e => onUpdate(po.id, { status: e.target.value })}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border-0 focus:outline-none focus:ring-1 focus:ring-brand-500 ${sm.cls}`}>
                      {Object.entries(STATUS_META).map(([k, v]) => (
                        <option key={k} value={k} className="bg-gray-900 text-slate-300">{v.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => onDelete(po.id)} className="p-1 text-slate-700 hover:text-red-400 transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {purchaseOrders.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-600">No purchase orders yet — create one above</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── OVERVIEW TAB ────────────────────────────────────────────────── */
function OverviewTab({ summary, rows }) {
  const healthDist = useMemo(() => {
    const counts = { stockout: 0, critical: 0, low: 0, healthy: 0, overstock: 0 };
    rows.forEach(r => { counts[r.health] = (counts[r.health] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: HEALTH_META[name]?.label || name, value, color: HEALTH_META[name]?.color }));
  }, [rows]);

  const topByValue = useMemo(() =>
    [...rows].sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 8), [rows]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Stock Health Distribution</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={healthDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''} labelLine={false}>
                {healthDist.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Top 8 SKUs by Inventory Value</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topByValue} layout="vertical" margin={{ left: 60, right: 10 }}>
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="sku" tick={{ fill: '#9ca3af', fontSize: 9 }} width={55} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} formatter={v => fmtCur(v)} />
              <Bar dataKey="inventoryValue" fill="#6366f1" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Quick Stats</div>
          <div className="space-y-2">
            {[
              { label: 'Total SKUs',           value: fmtNum(summary.totalSkus) },
              { label: 'Total Inventory Value', value: fmtCur(summary.totalValue) },
              { label: 'Reorder Alerts',        value: summary.reorderCount,    danger: summary.reorderCount > 0 },
              { label: 'Stockouts',             value: summary.stockoutCount,   danger: summary.stockoutCount > 0 },
              { label: 'Dead Stock Value',      value: fmtCur(summary.deadStockValue), warn: summary.deadStockValue > 0 },
              { label: 'Overstock Value',       value: fmtCur(summary.overstockValue) },
              { label: 'Avg Days of Inventory', value: `${summary.avgDoi}d` },
              { label: '30d Revenue',           value: fmtCur(summary.totalRev30) },
            ].map(s => (
              <div key={s.label} className="flex items-center justify-between py-1 border-b border-gray-800/40">
                <span className="text-xs text-slate-400">{s.label}</span>
                <span className={`text-xs font-semibold ${s.danger ? 'text-red-400' : s.warn ? 'text-amber-400' : 'text-slate-200'}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ───────────────────────────────────────────────────── */
export default function Procurement() {
  const { inventoryMap, shopifyOrders, procurement, setProcurementSupplier, addProcurementPO, updateProcurementPO, deleteProcurementPO } = useStore();

  const suppliers      = procurement?.suppliers      || {};
  const purchaseOrders = procurement?.purchaseOrders || [];

  const rows    = useMemo(() => buildProcurementTable(inventoryMap, shopifyOrders, suppliers), [inventoryMap, shopifyOrders, suppliers]);
  const summary = useMemo(() => calcProcurementSummary(rows), [rows]);

  const [activeTab, setActiveTab] = useState('overview');

  const hasData = Object.keys(inventoryMap).length > 0;

  if (!hasData) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="w-14 h-14 rounded-xl bg-gray-800 flex items-center justify-center mx-auto">
          <Package size={24} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white">No Inventory Data</h2>
        <p className="text-sm text-slate-400">Pull Shopify inventory and orders from the Study Manual to power the procurement dashboard.</p>
      </div>
    );
  }

  const TABS = [
    { id: 'overview',  label: 'Overview',        icon: BarChart3 },
    { id: 'reorder',   label: `Reorder Planner (${summary.reorderCount})`, icon: AlertTriangle },
    { id: 'abc',       label: 'ABC Analysis',     icon: Star },
    { id: 'velocity',  label: 'Velocity',         icon: TrendingDown },
    { id: 'dead',      label: `Dead Stock (${summary.deadStockCount})`, icon: Archive },
    { id: 'po',        label: `Purchase Orders (${purchaseOrders.length})`, icon: ShoppingCart },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Procurement</h1>
        <p className="text-sm text-slate-400 mt-1">
          {summary.totalSkus} SKUs · {fmtCur(summary.totalValue)} inventory value · Powered by Shopify inventory + orders
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricCard label="Inventory Value"   value={fmtCur(summary.totalValue)}    icon={DollarSign} color="violet" />
        <MetricCard label="Reorder Alerts"    value={summary.reorderCount}          icon={AlertTriangle} danger={summary.reorderCount > 0} />
        <MetricCard label="Stockouts"         value={summary.stockoutCount}         icon={Package}  danger={summary.stockoutCount > 0} />
        <MetricCard label="Dead Stock"        value={fmtCur(summary.deadStockValue)} icon={Archive} warn={summary.deadStockValue > 0} />
        <MetricCard label="Avg Days of Stock" value={`${summary.avgDoi}d`}          icon={Clock}   color="green" />
        <MetricCard label="30d Revenue"       value={fmtCur(summary.totalRev30)}    icon={BarChart3} color="green" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === id ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview'  && <OverviewTab summary={summary} rows={rows} />}
      {activeTab === 'reorder'   && (
        <ReorderPlanner
          rows={rows}
          suppliers={suppliers}
          onUpdateSupplier={(sku, data) => setProcurementSupplier(sku, data)}
        />
      )}
      {activeTab === 'abc'       && <AbcAnalysis rows={rows} />}
      {activeTab === 'velocity'  && <VelocityAnalysis rows={rows} />}
      {activeTab === 'dead'      && <DeadStock rows={rows} />}
      {activeTab === 'po'        && (
        <PurchaseOrders
          purchaseOrders={purchaseOrders}
          onAdd={addProcurementPO}
          onUpdate={updateProcurementPO}
          onDelete={deleteProcurementPO}
        />
      )}
    </div>
  );
}
