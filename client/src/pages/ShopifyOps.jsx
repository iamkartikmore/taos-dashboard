import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie,
} from 'recharts';
import {
  Truck, Package, Users, RotateCcw, Sun, Sunset, Moon,
  ChevronDown, ChevronRight, Download, RefreshCw, Search,
  AlertTriangle, CheckCircle, Clock, Edit2, Check, X,
  Plus, Trash2, Hash, MapPin, ArrowUpRight, Filter,
  Clipboard, Tag, DollarSign, TrendingUp, TrendingDown,
  Zap, Activity, Globe2, Warehouse as WarehouseIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';

/* ─── CONSTANTS ─────────────────────────────────────────────────── */
const LS_OVERRIDES = 'taos_ops_overrides_v2';
const LS_TICKETS   = 'taos_ops_tickets_v2';

const SHIFTS = [
  { id: 'morning',   label: 'Morning',   range: '6AM–2PM',  icon: Sun,    color: '#f59e0b' },
  { id: 'afternoon', label: 'Afternoon', range: '2PM–10PM', icon: Sunset, color: '#f97316' },
  { id: 'night',     label: 'Night',     range: '10PM–6AM', icon: Moon,   color: '#818cf8' },
];

const PRIORITY_OPTIONS = ['Normal','Urgent','Watch','Done'];
const PRIORITY_COLORS  = { Urgent: '#ef4444', Normal: '#3b82f6', Watch: '#f59e0b', Done: '#22c55e' };

const TICKET_TYPES    = ['Wrong Item','Damaged','Not Delivered','Refund Request','Exchange','Other'];
const TICKET_STATUSES = ['Open','In Progress','Escalated','Resolved','Closed'];
const TICKET_STATUS_COLORS = {
  Open: '#3b82f6', 'In Progress': '#f59e0b', Escalated: '#ef4444',
  Resolved: '#22c55e', Closed: '#64748b',
};

const RETURN_STATUSES = ['Pending','Pickup Scheduled','Received','Refund Initiated','Refund Done','Rejected'];
const RETURN_STATUS_COLORS = {
  Pending: '#f59e0b', 'Pickup Scheduled': '#3b82f6', Received: '#a78bfa',
  'Refund Initiated': '#fb923c', 'Refund Done': '#22c55e', Rejected: '#ef4444',
};

/* ─── UTILS ──────────────────────────────────────────────────────── */
const p   = v => parseFloat(v || 0);
const cur = v => `₹${p(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const num = v => p(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const dec = (v, d = 1) => p(v).toFixed(d);
const hrs = h => h < 24 ? `${dec(h)}h` : `${dec(h / 24, 1)}d`;
const ago = dt => {
  if (!dt) return '—';
  const ms = Date.now() - new Date(dt).getTime();
  const h  = ms / 3600000;
  if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function lsGet(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function lsSet(k, v)   { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6  && h < 14) return 'morning';
  if (h >= 14 && h < 22) return 'afternoon';
  return 'night';
}

function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = c.fn ? c.fn(r) : (r[c.key] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── INLINE EDIT CELL ───────────────────────────────────────────── */
function InlineEdit({ value, onSave, placeholder = '—', multiline = false, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const ref = useRef(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value || ''); setEditing(false); };
  if (editing) return (
    <div className="flex items-center gap-1">
      {multiline
        ? <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
            rows={2}
            className="text-xs bg-gray-800 border border-brand-500/50 rounded px-1.5 py-1 text-slate-200 focus:outline-none resize-none w-40"
            onKeyDown={e => { if (e.key === 'Escape') cancel(); }}/>
        : <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
            className="text-xs bg-gray-800 border border-brand-500/50 rounded px-1.5 py-0.5 text-slate-200 focus:outline-none w-32"
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}/>
      }
      <button onClick={commit}  className="p-0.5 text-emerald-400 hover:text-emerald-300"><Check size={12}/></button>
      <button onClick={cancel}  className="p-0.5 text-red-400 hover:text-red-300"><X size={12}/></button>
    </div>
  );
  return (
    <button onClick={() => { setDraft(value || ''); setEditing(true); }}
      className={clsx('flex items-center gap-1 group text-left', className)}>
      <span className={value ? 'text-slate-300' : 'text-slate-600 italic'}>{value || placeholder}</span>
      <Edit2 size={10} className="opacity-0 group-hover:opacity-60 text-slate-500 shrink-0"/>
    </button>
  );
}

/* ─── PILL SELECT ─────────────────────────────────────────────────── */
function PillSelect({ value, options, colorMap, onSave }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const color = colorMap?.[value] || '#64748b';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all"
        style={{ background: color + '18', borderColor: color + '50', color }}>
        {value}
        <ChevronDown size={9}/>
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-gray-900 border border-gray-700 rounded-lg py-1 shadow-2xl min-w-[140px]">
          {options.map(opt => (
            <button key={opt} onClick={() => { onSave(opt); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 flex items-center gap-2"
              style={{ color: colorMap?.[opt] || '#94a3b8' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colorMap?.[opt] || '#64748b' }}/>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── KPI CARD ───────────────────────────────────────────────────── */
function KPI({ label, value, sub, color, icon: Icon, trend }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{label}</span>
        {Icon && <Icon size={14} style={{ color: color || '#64748b' }}/>}
      </div>
      <div className="text-xl font-bold" style={{ color: color || '#fff' }}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ─── SEARCH BAR ─────────────────────────────────────────────────── */
function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="pl-7 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 w-56 placeholder-slate-600"/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 1 — DISPATCH
═══════════════════════════════════════════════════════════════════ */
function DispatchTab({ orders, overrides, setOverrides }) {
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [sortBy, setSortBy]     = useState('created');
  const [pageSize, setPageSize] = useState(50);

  const saveOverride = useCallback((orderId, patch) => {
    const updated = { ...overrides, [orderId]: { ...(overrides[orderId] || {}), ...patch } };
    lsSet(LS_OVERRIDES, updated);
    setOverrides(updated);
  }, [overrides, setOverrides]);

  const activeOrders = useMemo(() => orders.filter(o => !o.cancelled_at), [orders]);

  // KPIs
  const pending      = activeOrders.filter(o => o.fulfillment_status === 'unfulfilled' || !o.fulfillment_status).length;
  const dispatched   = activeOrders.filter(o => o.fulfillment_status === 'fulfilled').length;
  const partial      = activeOrders.filter(o => o.fulfillment_status === 'partial').length;
  const withTracking = activeOrders.filter(o => o.fulfillments?.some(f => f.tracking_number)).length;

  // Overdue: unfulfilled for >24h
  const overdue = activeOrders.filter(o => {
    if (o.fulfillment_status !== 'unfulfilled' && o.fulfillment_status) return false;
    const ageH = (Date.now() - new Date(o.created_at).getTime()) / 3600000;
    return ageH > 24;
  }).length;

  // Hourly dispatch chart (last 12h)
  const hourlyData = useMemo(() => {
    const now = Date.now();
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const h = new Date(now - (11 - i) * 3600000);
      return { hour: `${h.getHours()}:00`, dispatched: 0, received: 0 };
    });
    activeOrders.forEach(o => {
      // received
      const createdH = Math.floor((now - new Date(o.created_at).getTime()) / 3600000);
      if (createdH < 12) buckets[11 - createdH].received++;
      // dispatched
      if (o.fulfillments?.length) {
        const fH = Math.floor((now - new Date(o.fulfillments[0].created_at).getTime()) / 3600000);
        if (fH < 12) buckets[11 - fH].dispatched++;
      }
    });
    return buckets;
  }, [activeOrders]);

  // Carrier breakdown
  const carrierData = useMemo(() => {
    const map = {};
    activeOrders.forEach(o => {
      o.fulfillments?.forEach(f => {
        const c = f.tracking_company || 'Unknown';
        map[c] = (map[c] || 0) + 1;
      });
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [activeOrders]);

  // Filtered + sorted table
  const rows = useMemo(() => {
    let list = [...activeOrders];
    if (filter === 'pending')    list = list.filter(o => o.fulfillment_status === 'unfulfilled' || !o.fulfillment_status);
    if (filter === 'dispatched') list = list.filter(o => o.fulfillment_status === 'fulfilled');
    if (filter === 'partial')    list = list.filter(o => o.fulfillment_status === 'partial');
    if (filter === 'overdue')    list = list.filter(o => {
      if (o.fulfillment_status !== 'unfulfilled' && o.fulfillment_status) return false;
      return (Date.now() - new Date(o.created_at).getTime()) / 3600000 > 24;
    });
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.email || '').toLowerCase().includes(q) ||
        o.fulfillments?.some(f => (f.tracking_number || '').toLowerCase().includes(q))
      );
    }
    if (sortBy === 'amount')    list.sort((a, b) => p(b.total_price) - p(a.total_price));
    if (sortBy === 'created')   list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === 'priority')  list.sort((a, b) => {
      const order = { Urgent: 0, Watch: 1, Normal: 2, Done: 3 };
      return (order[overrides[a.id]?.priority] ?? 2) - (order[overrides[b.id]?.priority] ?? 2);
    });
    return list.slice(0, pageSize);
  }, [activeOrders, filter, search, sortBy, overrides, pageSize]);

  const CARRIERS_COLORS = ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399'];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KPI label="Pending Dispatch" value={num(pending)}    color="#f59e0b" icon={Clock}       sub="unfulfilled orders"/>
        <KPI label="Dispatched"       value={num(dispatched)} color="#22c55e" icon={CheckCircle} sub="fulfilled"/>
        <KPI label="Partial"          value={num(partial)}    color="#3b82f6" icon={Package}     sub="partial fulfillment"/>
        <KPI label="Overdue >24h"     value={num(overdue)}    color="#ef4444" icon={AlertTriangle} sub="needs action"/>
        <KPI label="With Tracking #"  value={num(withTracking)} color="#a78bfa" icon={Hash}      sub="trackable orders"/>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hourly dispatch */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-300 mb-3">Hourly Activity (Last 12h)</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hourlyData} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
              <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} width={24}/>
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }}/>
              <Bar dataKey="received"   name="Orders In"  fill="#3b82f6" opacity={0.5} radius={[2,2,0,0]} maxBarSize={16}/>
              <Bar dataKey="dispatched" name="Dispatched" fill="#22c55e"             radius={[2,2,0,0]} maxBarSize={16}/>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="w-2 h-2 rounded-sm bg-blue-500/50 shrink-0"/>Orders In</div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="w-2 h-2 rounded-sm bg-emerald-500 shrink-0"/>Dispatched</div>
          </div>
        </div>

        {/* Carrier breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-300 mb-3">Carrier Split</h3>
          {carrierData.length === 0
            ? <div className="text-xs text-slate-600 py-6 text-center">No fulfilled orders yet</div>
            : <div className="space-y-2">
                {carrierData.map((c, i) => {
                  const total = carrierData.reduce((s, x) => s + x.value, 0);
                  return (
                    <div key={c.name}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300 truncate max-w-[110px]">{c.name}</span>
                        <span className="text-slate-500 tabular-nums">{c.value} · {dec(c.value / total * 100)}%</span>
                      </div>
                      <div className="h-1 bg-gray-800 rounded-full">
                        <div className="h-full rounded-full" style={{ width: `${c.value / total * 100}%`, background: CARRIERS_COLORS[i] }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>

      {/* Order table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h3 className="text-xs font-semibold text-slate-300">Order Tracker</h3>
          <div className="flex gap-1 ml-2 flex-wrap">
            {[['all','All'],['pending','Pending'],['dispatched','Dispatched'],['partial','Partial'],['overdue','Overdue']].map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
                  filter === k ? 'bg-brand-600/30 text-brand-300' : 'text-slate-500 hover:text-slate-300')}>
                {l}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <SearchBar value={search} onChange={setSearch} placeholder="Order # / email / tracking…"/>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-300 focus:outline-none">
              <option value="created">Sort: Newest</option>
              <option value="amount">Sort: Amount</option>
              <option value="priority">Sort: Priority</option>
            </select>
            <button onClick={() => exportCSV('dispatch.csv', rows, [
              { key: 'name', label: 'Order' },
              { key: 'email', label: 'Email' },
              { key: 'total_price', label: 'Amount' },
              { key: 'fulfillment_status', label: 'Status' },
              { fn: r => r.fulfillments?.[0]?.tracking_number || '', label: 'Tracking #' },
              { fn: r => r.fulfillments?.[0]?.tracking_company || '', label: 'Carrier' },
              { fn: r => overrides[r.id]?.priority || 'Normal', label: 'Priority' },
              { fn: r => overrides[r.id]?.notes || '', label: 'Notes' },
            ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download size={11}/> Export
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-700">
                {['Order #','Created','Customer','Amount','Fulfillment','Tracking #','Carrier','Priority','Notes'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const tracking = o.fulfillments?.[0]?.tracking_number;
                const trackUrl = o.fulfillments?.[0]?.tracking_url;
                const carrier  = o.fulfillments?.[0]?.tracking_company;
                const ov       = overrides[o.id] || {};
                const priority = ov.priority || 'Normal';
                const ageH     = (Date.now() - new Date(o.created_at).getTime()) / 3600000;
                const isOverdue = (o.fulfillment_status === 'unfulfilled' || !o.fulfillment_status) && ageH > 24;
                return (
                  <tr key={o.id} className={clsx(
                    'border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors',
                    isOverdue && 'bg-red-950/10',
                  )}>
                    <td className="px-0 py-2 font-mono font-semibold text-slate-200">{o.name}</td>
                    <td className="px-2 py-2 text-slate-400 tabular-nums whitespace-nowrap">{ago(o.created_at)}</td>
                    <td className="px-2 py-2 text-slate-300 max-w-[120px] truncate">{o.email}</td>
                    <td className="px-2 py-2 text-emerald-400 font-semibold tabular-nums">{cur(o.total_price)}</td>
                    <td className="px-2 py-2">
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-semibold', {
                        'bg-emerald-500/15 text-emerald-400': o.fulfillment_status === 'fulfilled',
                        'bg-amber-500/15 text-amber-400':    !o.fulfillment_status || o.fulfillment_status === 'unfulfilled',
                        'bg-blue-500/15 text-blue-400':      o.fulfillment_status === 'partial',
                      })}>
                        {o.fulfillment_status || 'unfulfilled'}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {tracking
                        ? trackUrl
                          ? <a href={trackUrl} target="_blank" rel="noreferrer"
                              className="font-mono text-[10px] text-brand-400 hover:underline flex items-center gap-0.5">
                              {tracking} <ArrowUpRight size={9}/>
                            </a>
                          : <span className="font-mono text-[10px] text-slate-300">{tracking}</span>
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-2 py-2 text-slate-400 text-[10px]">{carrier || '—'}</td>
                    <td className="px-2 py-2">
                      <PillSelect value={priority} options={PRIORITY_OPTIONS} colorMap={PRIORITY_COLORS}
                        onSave={v => saveOverride(o.id, { priority: v })}/>
                    </td>
                    <td className="px-2 py-2 max-w-[160px]">
                      <InlineEdit value={ov.notes} placeholder="Add note…"
                        onSave={v => saveOverride(o.id, { notes: v })}/>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-slate-600 text-xs">No orders match the current filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {activeOrders.length > pageSize && (
          <button onClick={() => setPageSize(n => n + 50)}
            className="mt-3 text-xs text-slate-500 hover:text-slate-300 underline">
            Load more ({activeOrders.length - pageSize} remaining)
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 2 — WAREHOUSE (INVENTORY)
═══════════════════════════════════════════════════════════════════ */
function WarehouseTab({ brandData, activeBrandId, overrides, setOverrides }) {
  const [search, setSearch]  = useState('');
  const [filter, setFilter]  = useState('all');

  const saveOverride = useCallback((sku, patch) => {
    const key = `wh_${sku}`;
    const updated = { ...overrides, [key]: { ...(overrides[key] || {}), ...patch } };
    lsSet(LS_OVERRIDES, updated);
    setOverrides(updated);
  }, [overrides, setOverrides]);

  // Flatten inventory across all active brand data
  const inventoryItems = useMemo(() => {
    const items = [];
    Object.entries(brandData || {}).forEach(([, d]) => {
      if (!d?.inventoryMap) return;
      Object.entries(d.inventoryMap).forEach(([sku, info]) => {
        items.push({ sku, ...info });
      });
    });
    return items;
  }, [brandData]);

  const totalSKUs    = inventoryItems.length;
  const lowStock     = inventoryItems.filter(i => (i.available ?? i.quantity ?? 0) > 0 && (i.available ?? i.quantity ?? 0) <= 10).length;
  const outOfStock   = inventoryItems.filter(i => (i.available ?? i.quantity ?? 0) <= 0).length;
  const totalUnits   = inventoryItems.reduce((s, i) => s + (i.available ?? i.quantity ?? 0), 0);

  const rows = useMemo(() => {
    let list = [...inventoryItems];
    if (filter === 'low')  list = list.filter(i => (i.available ?? i.quantity ?? 0) > 0 && (i.available ?? i.quantity ?? 0) <= 10);
    if (filter === 'out')  list = list.filter(i => (i.available ?? i.quantity ?? 0) <= 0);
    if (filter === 'ok')   list = list.filter(i => (i.available ?? i.quantity ?? 0) > 10);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => (i.sku || '').toLowerCase().includes(q) || (i.title || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.available ?? a.quantity ?? 0) - (b.available ?? b.quantity ?? 0));
  }, [inventoryItems, filter, search]);

  if (!inventoryItems.length) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-500">
      <Package size={32} className="opacity-30"/>
      <p className="text-sm">No inventory data — fetch inventory in Shopify Orders first.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total SKUs"   value={num(totalSKUs)}  color="#3b82f6" icon={Package}/>
        <KPI label="Total Units"  value={num(totalUnits)} color="#a78bfa" icon={Activity}/>
        <KPI label="Low Stock"    value={num(lowStock)}   color="#f59e0b" icon={AlertTriangle} sub="≤10 units"/>
        <KPI label="Out of Stock" value={num(outOfStock)} color="#ef4444" icon={TrendingDown}/>
      </div>

      {/* Summary alert */}
      {(lowStock + outOfStock) > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-400 shrink-0"/>
          <span className="text-xs text-amber-300">
            <strong>{outOfStock}</strong> SKUs out of stock · <strong>{lowStock}</strong> running low — review and restock
          </span>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h3 className="text-xs font-semibold text-slate-300">Inventory Levels</h3>
          <div className="flex gap-1 ml-2">
            {[['all','All'],['out','Out of Stock'],['low','Low Stock'],['ok','In Stock']].map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
                  filter === k ? 'bg-brand-600/30 text-brand-300' : 'text-slate-500 hover:text-slate-300')}>
                {l}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <SearchBar value={search} onChange={setSearch} placeholder="SKU or product name…"/>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-700">
                {['SKU','Product','Available','Committed','On Hand','Safety Stock','Status','Notes'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(item => {
                const avail  = item.available ?? item.quantity ?? 0;
                const commit = item.committed ?? 0;
                const onHand = item.on_hand ?? (avail + commit);
                const ov     = overrides[`wh_${item.sku}`] || {};
                const safety = parseInt(ov.safetyStock) || 5;
                const statusColor = avail <= 0 ? '#ef4444' : avail <= safety ? '#f59e0b' : '#22c55e';
                const statusLabel = avail <= 0 ? 'Out' : avail <= safety ? 'Low' : 'OK';
                return (
                  <tr key={item.sku} className={clsx(
                    'border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors',
                    avail <= 0 && 'bg-red-950/10',
                  )}>
                    <td className="px-0 py-2 font-mono text-[10px] text-slate-300">{item.sku}</td>
                    <td className="px-2 py-2 text-slate-200 max-w-[160px] truncate">{item.title || item.variant_title || '—'}</td>
                    <td className="px-2 py-2 font-semibold tabular-nums" style={{ color: statusColor }}>{num(avail)}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-400">{num(commit)}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-400">{num(onHand)}</td>
                    <td className="px-2 py-2">
                      <InlineEdit value={String(safety)}
                        onSave={v => saveOverride(item.sku, { safetyStock: v })}
                        className="font-mono text-amber-400"/>
                    </td>
                    <td className="px-2 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{ background: statusColor + '20', color: statusColor }}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2 max-w-[140px]">
                      <InlineEdit value={ov.notes} placeholder="Add note…"
                        onSave={v => saveOverride(item.sku, { notes: v })}/>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-600 text-xs">No inventory matches filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 3 — SUPPORT (CUSTOMER CARE)
═══════════════════════════════════════════════════════════════════ */
const BLANK_TICKET = { orderId: '', type: 'Other', status: 'Open', description: '', assignedTo: '' };

function SupportTab({ orders, tickets, setTickets }) {
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(BLANK_TICKET);
  const [search, setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const saveTickets = useCallback(t => { lsSet(LS_TICKETS, t); setTickets(t); }, [setTickets]);

  const addTicket = () => {
    if (!form.description.trim()) return;
    const t = { ...form, id: `T${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    saveTickets([t, ...tickets]);
    setForm(BLANK_TICKET);
    setShowForm(false);
  };

  const updateTicket = useCallback((id, patch) => {
    saveTickets(tickets.map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
  }, [tickets, saveTickets]);

  const deleteTicket = useCallback(id => {
    if (window.confirm('Delete this ticket?')) saveTickets(tickets.filter(t => t.id !== id));
  }, [tickets, saveTickets]);

  const openCount      = tickets.filter(t => t.status === 'Open').length;
  const escalatedCount = tickets.filter(t => t.status === 'Escalated').length;
  const resolvedToday  = tickets.filter(t => {
    if (t.status !== 'Resolved' && t.status !== 'Closed') return false;
    return (Date.now() - new Date(t.updatedAt).getTime()) < 86400000;
  }).length;
  const avgResH = (() => {
    const resolved = tickets.filter(t => (t.status === 'Resolved' || t.status === 'Closed') && t.createdAt && t.updatedAt);
    if (!resolved.length) return null;
    return resolved.reduce((s, t) => s + (new Date(t.updatedAt) - new Date(t.createdAt)), 0) / resolved.length / 3600000;
  })();

  const filteredTickets = useMemo(() => {
    let list = [...tickets];
    if (filterStatus !== 'all') list = list.filter(t => t.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.orderId || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.assignedTo || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [tickets, filterStatus, search]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Open Tickets"    value={num(openCount)}     color="#3b82f6" icon={Clipboard}/>
        <KPI label="Escalated"       value={num(escalatedCount)} color="#ef4444" icon={AlertTriangle}/>
        <KPI label="Resolved Today"  value={num(resolvedToday)} color="#22c55e" icon={CheckCircle}/>
        <KPI label="Avg Resolution"  value={avgResH != null ? hrs(avgResH) : '—'} color="#a78bfa" icon={Clock}/>
      </div>

      {escalatedCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0"/>
          <span className="text-xs text-red-300"><strong>{escalatedCount}</strong> escalated ticket{escalatedCount > 1 ? 's' : ''} need immediate attention</span>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h3 className="text-xs font-semibold text-slate-300">Support Tickets</h3>
          <div className="flex gap-1 ml-2 flex-wrap">
            {['all', ...TICKET_STATUSES].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
                  filterStatus === s ? 'bg-brand-600/30 text-brand-300' : 'text-slate-500 hover:text-slate-300')}>
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Order # / description…"/>
            <button onClick={() => setShowForm(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/20 border border-brand-500/40 rounded-lg text-xs text-brand-300 hover:bg-brand-600/30 transition-colors">
              <Plus size={12}/> New Ticket
            </button>
          </div>
        </div>

        {/* New ticket form */}
        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden">
              <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Order #</label>
                  <input value={form.orderId} onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))}
                    placeholder="#1234" className="mt-1 w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"/>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none">
                    {TICKET_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Assigned To</label>
                  <input value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                    placeholder="Agent name" className="mt-1 w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"/>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none">
                    {TICKET_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Description *</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2} placeholder="Describe the issue…"
                    className="mt-1 w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"/>
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={addTicket}
                    className="flex-1 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-xs text-white font-semibold transition-colors">
                    Create
                  </button>
                  <button onClick={() => setShowForm(false)}
                    className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-slate-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-700">
                {['Ticket ID','Order #','Type','Description','Status','Assigned To','Created','Actions'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(t => (
                <tr key={t.id} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                  <td className="px-0 py-2 font-mono text-[10px] text-slate-400">{t.id}</td>
                  <td className="px-2 py-2 font-mono text-slate-300">
                    <InlineEdit value={t.orderId} placeholder="—" onSave={v => updateTicket(t.id, { orderId: v })}/>
                  </td>
                  <td className="px-2 py-2 text-slate-400">{t.type}</td>
                  <td className="px-2 py-2 max-w-[200px]">
                    <InlineEdit value={t.description} placeholder="—" multiline
                      onSave={v => updateTicket(t.id, { description: v })}
                      className="text-slate-300"/>
                  </td>
                  <td className="px-2 py-2">
                    <PillSelect value={t.status} options={TICKET_STATUSES} colorMap={TICKET_STATUS_COLORS}
                      onSave={v => updateTicket(t.id, { status: v })}/>
                  </td>
                  <td className="px-2 py-2 max-w-[100px]">
                    <InlineEdit value={t.assignedTo} placeholder="Assign…"
                      onSave={v => updateTicket(t.id, { assignedTo: v })}/>
                  </td>
                  <td className="px-2 py-2 text-slate-500 whitespace-nowrap tabular-nums">{ago(t.createdAt)}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => deleteTicket(t.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 size={12}/>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredTickets.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-600 text-xs">
                  {tickets.length === 0 ? 'No tickets yet — create one above' : 'No tickets match filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TAB 4 — RETURNS
═══════════════════════════════════════════════════════════════════ */
function ReturnsTab({ orders, overrides, setOverrides }) {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('all');

  const saveOverride = useCallback((orderId, patch) => {
    const key = `ret_${orderId}`;
    const updated = { ...overrides, [key]: { ...(overrides[key] || {}), ...patch } };
    lsSet(LS_OVERRIDES, updated);
    setOverrides(updated);
  }, [overrides, setOverrides]);

  // Orders with refunds or return tags
  const returnOrders = useMemo(() => orders.filter(o => {
    if (o.cancelled_at) return false;
    const hasRefund = o.refunds?.length > 0;
    const hasReturnTag = String(o.tags || '').toLowerCase().includes('return');
    return hasRefund || hasReturnTag;
  }), [orders]);

  const totalRefundAmt   = returnOrders.reduce((s, o) => {
    const r = o.refunds?.reduce((rs, ref) => rs + p(ref.transactions?.reduce((ts, t) => ts + p(t.amount), 0) || 0), 0) || 0;
    return s + r;
  }, 0);
  const refundPending    = returnOrders.filter(o => {
    const ov = overrides[`ret_${o.id}`];
    return !ov?.returnStatus || ov.returnStatus === 'Pending' || ov.returnStatus === 'Pickup Scheduled' || ov.returnStatus === 'Received';
  }).length;
  const refundDone       = returnOrders.filter(o => overrides[`ret_${o.id}`]?.returnStatus === 'Refund Done').length;

  // Returns by type (tag-based)
  const typeData = useMemo(() => {
    const map = {};
    returnOrders.forEach(o => {
      const tags = String(o.tags || '').split(',').map(t => t.trim()).filter(t => t.toLowerCase().includes('return') || t.toLowerCase().includes('exchange'));
      if (!tags.length) { map['Untagged Return'] = (map['Untagged Return'] || 0) + 1; }
      else tags.forEach(t => { map[t] = (map[t] || 0) + 1; });
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [returnOrders]);

  const rows = useMemo(() => {
    let list = [...returnOrders];
    if (filter !== 'all') {
      list = list.filter(o => {
        const ov = overrides[`ret_${o.id}`];
        return (ov?.returnStatus || 'Pending') === filter;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.email || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [returnOrders, filter, search, overrides]);

  const RETURN_COLORS = ['#ef4444','#f59e0b','#a78bfa','#3b82f6','#22c55e','#34d399','#f472b6','#64748b'];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Return / Refund Orders" value={num(returnOrders.length)} color="#f59e0b" icon={RotateCcw}/>
        <KPI label="Total Refund Amount"    value={cur(totalRefundAmt)}      color="#ef4444" icon={DollarSign}/>
        <KPI label="Pending Resolution"     value={num(refundPending)}       color="#3b82f6" icon={Clock}/>
        <KPI label="Refunds Completed"      value={num(refundDone)}          color="#22c55e" icon={CheckCircle}/>
      </div>

      {/* Return type chart */}
      {typeData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-300 mb-3">Returns by Tag / Type</h3>
          <div className="space-y-2">
            {typeData.map((t, i) => {
              const max = typeData[0].value;
              return (
                <div key={t.name}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-slate-300 truncate max-w-[200px]">{t.name}</span>
                    <span className="text-slate-500 tabular-nums">{t.value}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full">
                    <div className="h-full rounded-full" style={{ width: `${t.value / max * 100}%`, background: RETURN_COLORS[i % RETURN_COLORS.length] }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Returns table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h3 className="text-xs font-semibold text-slate-300">Return Tracker</h3>
          <div className="flex gap-1 ml-2 flex-wrap">
            {[['all','All'], ...RETURN_STATUSES.map(s => [s, s])].map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
                  filter === k ? 'bg-brand-600/30 text-brand-300' : 'text-slate-500 hover:text-slate-300')}>
                {l}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Order # / email…"/>
            <button onClick={() => exportCSV('returns.csv', rows, [
              { key: 'name', label: 'Order' },
              { key: 'email', label: 'Email' },
              { key: 'total_price', label: 'Amount' },
              { fn: r => overrides[`ret_${r.id}`]?.returnStatus || 'Pending', label: 'Return Status' },
              { fn: r => overrides[`ret_${r.id}`]?.notes || '', label: 'Notes' },
            ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download size={11}/> Export
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-700">
                {['Order #','Date','Customer','Amount','Order Tags','Refund Amt','Return Status','Notes'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const ov = overrides[`ret_${o.id}`] || {};
                const returnStatus = ov.returnStatus || 'Pending';
                const refundTotal  = o.refunds?.reduce((s, r) => s + p(r.transactions?.reduce((ts, t) => ts + p(t.amount), 0) || 0), 0) || 0;
                return (
                  <tr key={o.id} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                    <td className="px-0 py-2 font-mono font-semibold text-slate-200">{o.name}</td>
                    <td className="px-2 py-2 text-slate-400 tabular-nums whitespace-nowrap">{ago(o.created_at)}</td>
                    <td className="px-2 py-2 text-slate-300 max-w-[120px] truncate">{o.email}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-300 font-semibold">{cur(o.total_price)}</td>
                    <td className="px-2 py-2 max-w-[120px]">
                      <div className="flex flex-wrap gap-1">
                        {String(o.tags || '').split(',').filter(Boolean).slice(0, 3).map(t => (
                          <span key={t} className="px-1 py-0.5 bg-gray-800 rounded text-[9px] text-slate-500">{t.trim()}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums font-semibold" style={{ color: refundTotal > 0 ? '#ef4444' : '#475569' }}>
                      {refundTotal > 0 ? cur(refundTotal) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <PillSelect value={returnStatus} options={RETURN_STATUSES} colorMap={RETURN_STATUS_COLORS}
                        onSave={v => saveOverride(o.id, { returnStatus: v })}/>
                    </td>
                    <td className="px-2 py-2 max-w-[160px]">
                      <InlineEdit value={ov.notes} placeholder="Add note…"
                        onSave={v => saveOverride(o.id, { notes: v })}/>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-600 text-xs">
                  {returnOrders.length === 0 ? 'No return / refund orders found' : 'No orders match filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGISTICS TAB — pincode + warehouse breakdown of refunds / reshipped
   ────────────────────────────────────────────────────────────────────
   Tags we recognise on Shopify orders:
     status:reshipped   → order was reshipped (you pass this tag)
     warehouse:<name>   → fulfilled from that warehouse
     wh:<name>          → alternate prefix (tolerated)
   Any tag format the operator wants can be added to extractOrderMeta.
═══════════════════════════════════════════════════════════════════ */

function extractOrderMeta(order) {
  const raw = String(order?.tags || '');
  const tags = raw.split(',').map(t => t.trim()).filter(Boolean);
  const lower = tags.map(t => t.toLowerCase());
  const reshipped = lower.some(t => t === 'status:reshipped' || t === 'reshipped' || t.endsWith(':reshipped'));
  let warehouse = null;
  for (const t of lower) {
    if (t.startsWith('warehouse:')) { warehouse = t.slice('warehouse:'.length); break; }
    if (t.startsWith('wh:'))        { warehouse = t.slice('wh:'.length);        break; }
    if (t.startsWith('fulfilled:')) { warehouse = t.slice('fulfilled:'.length); break; }
  }
  const hasRefund = (order?.refunds?.length || 0) > 0;
  const refundAmount = (order?.refunds || []).reduce((s, r) =>
    s + (r.transactions || []).reduce((ts, t) => ts + p(t.amount), 0), 0);

  const ship = order?.shipping_address || {};
  const bill = order?.billing_address  || {};
  const zip   = String(ship.zip   || bill.zip   || '').trim();
  const city  = ship.city     || bill.city     || '';
  const state = ship.province || bill.province || '';

  // Customer identity — prefer Shopify customer_id, fall back to email, then phone
  const cust  = order?.customer || {};
  const firstName = ship.first_name || cust.first_name || '';
  const lastName  = ship.last_name  || cust.last_name  || '';
  const customerName  = [firstName, lastName].filter(Boolean).join(' ').trim() || '—';
  const customerEmail = String(cust.email || order?.email || '').trim().toLowerCase();
  const customerPhone = String(ship.phone || bill.phone || cust.phone || order?.phone || '').replace(/\s+/g, '');
  const customerKey   = String(cust.id || customerEmail || customerPhone || '').trim();

  const orderId    = String(order?.id || order?.order_id || '').trim();
  const orderName  = order?.name || (orderId ? `#${orderId}` : '');
  const totalPrice = p(order?.total_price || order?.current_total_price || 0);
  const createdAt  = order?.created_at || order?.processed_at || '';

  return {
    tags, reshipped, warehouse, hasRefund, refundAmount,
    zip, city, state,
    orderId, orderName, totalPrice, createdAt,
    customerKey, customerName, customerEmail, customerPhone,
  };
}

/* Aggregate orders by any key (pincode, warehouse, state…) and also
   track per-key customer rollups + full order rows so the UI can
   drill in to see who's driving the refunds. Without this the op team
   can't tell "bad pincode" from "one serial-refund customer". */
function aggregateBy(orders, keyFn, { minOrders = 5 } = {}) {
  const map = new Map();
  for (const o of orders) {
    if (o.cancelled_at) continue;
    const meta = extractOrderMeta(o);
    const key = keyFn(o, meta);
    if (!key) continue;
    let cur = map.get(key);
    if (!cur) {
      cur = {
        key, orders: 0, refunds: 0, reshipped: 0, refundAmt: 0,
        cities: new Set(), states: new Set(), warehouses: new Set(),
        _orders: [], _customers: new Map(),
      };
      map.set(key, cur);
    }
    cur.orders++;
    if (meta.hasRefund) { cur.refunds++; cur.refundAmt += meta.refundAmount; }
    if (meta.reshipped)   cur.reshipped++;
    if (meta.city)  cur.cities.add(meta.city);
    if (meta.state) cur.states.add(meta.state);
    if (meta.warehouse) cur.warehouses.add(meta.warehouse);

    cur._orders.push({
      orderId: meta.orderId, orderName: meta.orderName,
      createdAt: meta.createdAt, totalPrice: meta.totalPrice,
      refundAmount: meta.refundAmount, refunded: meta.hasRefund,
      reshipped: meta.reshipped, warehouse: meta.warehouse || '',
      customerName: meta.customerName, customerEmail: meta.customerEmail,
      customerPhone: meta.customerPhone, customerKey: meta.customerKey,
      zip: meta.zip, city: meta.city, state: meta.state,
    });

    // Customer-level rollup within this key
    const ckey = meta.customerKey || `order:${meta.orderId}`; // unknown customers stay distinct
    let c = cur._customers.get(ckey);
    if (!c) {
      c = {
        key: ckey, name: meta.customerName, email: meta.customerEmail, phone: meta.customerPhone,
        orders: 0, refunds: 0, reshipped: 0, refundAmt: 0, totalSpend: 0,
      };
      cur._customers.set(ckey, c);
    }
    c.orders++;
    c.totalSpend += meta.totalPrice;
    if (meta.hasRefund) { c.refunds++; c.refundAmt += meta.refundAmount; }
    if (meta.reshipped) c.reshipped++;
  }

  return [...map.values()].map(v => {
    const customers = [...v._customers.values()].sort((a, b) =>
      (b.refunds - a.refunds) ||
      (b.refundAmt - a.refundAmt) ||
      (b.orders - a.orders)
    );
    const topCustomer = customers[0] || null;
    const topRefundShare = v.refunds > 0 && topCustomer ? topCustomer.refunds / v.refunds : 0;
    const repeatRefunders = customers.filter(c => c.refunds >= 2).length;
    return {
      key: v.key,
      orders: v.orders, refunds: v.refunds, reshipped: v.reshipped, refundAmt: v.refundAmt,
      cities: [...v.cities].slice(0, 3),
      states: [...v.states].slice(0, 3),
      warehouses: [...v.warehouses],
      refundRate:    v.orders > 0 ? v.refunds / v.orders : 0,
      reshippedRate: v.orders > 0 ? v.reshipped / v.orders : 0,
      uniqueCustomers: v._customers.size,
      topCustomer, topRefundShare, repeatRefunders,
      _orders: v._orders, _customers: customers,
    };
  }).filter(v => v.orders >= minOrders);
}

/* ─── CSV helpers ────────────────────────────────────────────────── */
function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map(r =>
    r.map(v => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function flattenOrdersForCsv(pincodeRows) {
  const rows = [[
    'Pincode','Cities','State','Order ID','Order Name','Created At',
    'Customer','Email','Phone','Warehouse',
    'Order Total','Refund Amount','Refunded','Reshipped',
  ]];
  for (const p of pincodeRows) {
    for (const o of p._orders) {
      rows.push([
        p.key, p.cities.join('|'), p.states.join('|'),
        o.orderId, o.orderName, o.createdAt,
        o.customerName, o.customerEmail, o.customerPhone, o.warehouse,
        o.totalPrice.toFixed(2), o.refundAmount.toFixed(2),
        o.refunded ? 'Y' : '', o.reshipped ? 'Y' : '',
      ]);
    }
  }
  return rows;
}

/* Per-pincode drill-in: customer rollup on the left, order list on the
   right. Order list defaults to refunded/reshipped rows so the op team
   lands on the actionable rows first; toggle to see all. */
function PincodeDetail({ pincode, onExportOrders, onExportCustomers }) {
  const [onlyIssues, setOnlyIssues] = useState(true);
  const orders = useMemo(() => {
    const list = pincode._orders;
    const sorted = [...list].sort((a, b) =>
      (Number(b.refunded) - Number(a.refunded)) ||
      (Number(b.reshipped) - Number(a.reshipped)) ||
      String(b.createdAt).localeCompare(String(a.createdAt))
    );
    return onlyIssues ? sorted.filter(o => o.refunded || o.reshipped) : sorted;
  }, [pincode, onlyIssues]);

  const topCustomers = pincode._customers.slice(0, 25);

  return (
    <div className="border-y border-gray-800/80 bg-gray-950 p-3">
      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4">
        {/* Customers panel */}
        <div className="2xl:col-span-2">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Users size={12} className="text-slate-400"/>
            <div className="text-[11px] font-semibold text-slate-200">
              Customers in {pincode.key} · {pincode.uniqueCustomers} unique
            </div>
            <button onClick={onExportCustomers} className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-slate-300 border border-gray-700">
              <Download size={10}/> CSV
            </button>
          </div>
          {pincode.refunds > 0 && pincode.topRefundShare >= 0.5 && (
            <div className="mb-2 px-2 py-1.5 rounded bg-amber-900/20 border border-amber-800/40 text-[10px] text-amber-200 flex items-start gap-1.5">
              <AlertTriangle size={11} className="text-amber-400 mt-0.5 flex-shrink-0"/>
              <span>
                <strong>{pincode.topCustomer?.name || 'Top customer'}</strong> drives{' '}
                <strong>{(pincode.topRefundShare * 100).toFixed(0)}%</strong> of this pincode's refunds —
                likely a customer issue, not a pincode issue.
              </span>
            </div>
          )}
          <div className="overflow-auto rounded border border-gray-800" style={{ maxHeight: '320px' }}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Customer</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Orders</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Refunds</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Reship</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Refund ₹</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => (
                  <tr key={c.key} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-2 py-1.5">
                      <div className="text-slate-200 font-medium truncate max-w-[200px]">{c.name}</div>
                      <div className="text-[9px] text-slate-500 truncate max-w-[200px]">
                        {c.email || c.phone || <span className="italic">no contact</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{num(c.orders)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold" style={{ color: c.refunds >= 2 ? '#ef4444' : c.refunds > 0 ? '#f59e0b' : '#64748b' }}>
                      {c.refunds || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">{c.reshipped || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-400">{c.refundAmt > 0 ? cur(c.refundAmt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pincode._customers.length > topCustomers.length && (
              <div className="px-2 py-1 text-[10px] text-slate-600 italic bg-gray-950 border-t border-gray-800">
                …{pincode._customers.length - topCustomers.length} more customers in CSV
              </div>
            )}
          </div>
        </div>

        {/* Orders panel */}
        <div className="2xl:col-span-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Hash size={12} className="text-slate-400"/>
            <div className="text-[11px] font-semibold text-slate-200">
              Orders in {pincode.key} · {pincode.orders} total · {pincode.refunds} refunded · {pincode.reshipped} reshipped
            </div>
            <label className="ml-auto flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={e => setOnlyIssues(e.target.checked)}
                className="w-3 h-3 accent-amber-500"
              />
              Refunded/reshipped only
            </label>
            <button onClick={onExportOrders} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-slate-300 border border-gray-700">
              <Download size={10}/> CSV
            </button>
          </div>
          <div className="overflow-auto rounded border border-gray-800" style={{ maxHeight: '320px' }}>
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Order</th>
                  <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Date</th>
                  <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Customer</th>
                  <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Warehouse</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Total ₹</th>
                  <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Refund ₹</th>
                  <th className="px-2 py-1.5 text-center text-slate-500 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-600 italic">
                    {onlyIssues ? 'No refunded or reshipped orders in this pincode.' : 'No orders.'}
                  </td></tr>
                )}
                {orders.slice(0, 200).map((o, i) => (
                  <tr key={`${o.orderId}-${i}`} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-2 py-1.5 font-mono text-slate-200">{o.orderName || o.orderId}</td>
                    <td className="px-2 py-1.5 text-slate-400 font-mono text-[10px]">{o.createdAt ? o.createdAt.slice(0, 10) : '—'}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-slate-300 truncate max-w-[160px]">{o.customerName}</div>
                      <div className="text-[9px] text-slate-500 truncate max-w-[160px]">{o.customerEmail || o.customerPhone}</div>
                    </td>
                    <td className="px-2 py-1.5 text-slate-400">{o.warehouse || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{o.totalPrice > 0 ? cur(o.totalPrice) : '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-400">{o.refundAmount > 0 ? cur(o.refundAmount) : '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      <div className="inline-flex gap-1">
                        {o.refunded  && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-900/40 text-red-300">REF</span>}
                        {o.reshipped && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-900/40 text-amber-300">RE-S</span>}
                        {!o.refunded && !o.reshipped && <span className="text-slate-700">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.length > 200 && (
              <div className="px-2 py-1 text-[10px] text-slate-600 italic bg-gray-950 border-t border-gray-800">
                Showing 200 of {orders.length} — full list in CSV
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogisticsTab({ rawOrders }) {
  const [minOrders, setMinOrders] = useState(5);
  const [sortBy, setSortBy]       = useState('refundRate');
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState(() => new Set());

  const orders = useMemo(() => rawOrders.filter(o => !o.cancelled_at), [rawOrders]);

  const metaStats = useMemo(() => {
    let total = 0, refunded = 0, reshipped = 0, refundAmt = 0;
    let warehouseOrders = 0;
    for (const o of orders) {
      total++;
      const m = extractOrderMeta(o);
      if (m.hasRefund)  { refunded++; refundAmt += m.refundAmount; }
      if (m.reshipped)  reshipped++;
      if (m.warehouse)  warehouseOrders++;
    }
    return { total, refunded, reshipped, refundAmt, warehouseOrders };
  }, [orders]);

  const byPincode = useMemo(() =>
    aggregateBy(orders, (o, m) => m.zip || null, { minOrders })
      .sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0)),
    [orders, minOrders, sortBy]);

  const byWarehouse = useMemo(() =>
    aggregateBy(orders, (o, m) => m.warehouse || null, { minOrders: 1 })
      .sort((a, b) => b.orders - a.orders),
    [orders]);

  const byState = useMemo(() =>
    aggregateBy(orders, (o, m) => m.state || null, { minOrders: 5 })
      .sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0)),
    [orders, sortBy]);

  /* Filter pincodes by free-text search (pincode / city / customer name/email/phone). */
  const filteredPincodes = useMemo(() => {
    if (!search.trim()) return byPincode;
    const q = search.trim().toLowerCase();
    return byPincode.filter(p => {
      if (String(p.key).includes(q)) return true;
      if (p.cities.some(c => c.toLowerCase().includes(q))) return true;
      if (p.states.some(s => s.toLowerCase().includes(q))) return true;
      if (p.topCustomer && (
        (p.topCustomer.name || '').toLowerCase().includes(q) ||
        (p.topCustomer.email || '').toLowerCase().includes(q) ||
        (p.topCustomer.phone || '').includes(q)
      )) return true;
      // Also look deeper into customers for a match
      return p._customers.some(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      );
    });
  }, [byPincode, search]);

  /* Global customer rollup — spot serial refunders across every pincode.
     Keyed by customer_id / email / phone fallback order. */
  const globalCustomers = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const m = extractOrderMeta(o);
      const ckey = m.customerKey || `order:${m.orderId}`;
      let c = map.get(ckey);
      if (!c) {
        c = {
          key: ckey, name: m.customerName, email: m.customerEmail, phone: m.customerPhone,
          orders: 0, refunds: 0, reshipped: 0, refundAmt: 0, totalSpend: 0,
          pincodes: new Set(), orderIds: [],
        };
        map.set(ckey, c);
      }
      c.orders++;
      c.totalSpend += m.totalPrice;
      if (m.hasRefund) { c.refunds++; c.refundAmt += m.refundAmount; }
      if (m.reshipped) c.reshipped++;
      if (m.zip) c.pincodes.add(m.zip);
      if (m.orderId) c.orderIds.push(m.orderId);
    }
    return [...map.values()]
      .map(c => ({ ...c, pincodes: [...c.pincodes], refundRate: c.orders > 0 ? c.refunds / c.orders : 0 }))
      .filter(c => c.refunds >= 2) // repeat refunders only
      .sort((a, b) => (b.refunds - a.refunds) || (b.refundAmt - a.refundAmt));
  }, [orders]);

  const today = new Date().toISOString().slice(0, 10);

  const exportPincodeCsv = () => {
    const rows = [[
      'Pincode','Cities','State','Orders','Refunds','Refund Rate %',
      'Reshipped','Reshipped Rate %','Refund Amount',
      'Unique Customers','Repeat Refunders',
      'Top Customer','Top Customer Email','Top Customer Refunds','Top Customer Share %',
    ]];
    for (const r of filteredPincodes) {
      const tc = r.topCustomer || {};
      rows.push([
        r.key, r.cities.join('|'), r.states.join('|'),
        r.orders, r.refunds, (r.refundRate * 100).toFixed(1),
        r.reshipped, (r.reshippedRate * 100).toFixed(1), r.refundAmt.toFixed(2),
        r.uniqueCustomers, r.repeatRefunders,
        tc.name || '', tc.email || '', tc.refunds || 0,
        (r.topRefundShare * 100).toFixed(1),
      ]);
    }
    downloadCsv(`logistics-pincode-${today}.csv`, rows);
  };

  const exportAllOrdersCsv = () => {
    downloadCsv(`logistics-orders-${today}.csv`, flattenOrdersForCsv(filteredPincodes));
  };

  const exportPincodeOrders = pincode => {
    downloadCsv(`logistics-orders-${pincode.key}-${today}.csv`, flattenOrdersForCsv([pincode]));
  };

  const exportPincodeCustomers = pincode => {
    const rows = [['Customer','Email','Phone','Orders','Refunds','Refund %','Reshipped','Refund ₹','Total Spend ₹']];
    for (const c of pincode._customers) {
      rows.push([
        c.name, c.email, c.phone,
        c.orders, c.refunds,
        c.orders > 0 ? ((c.refunds / c.orders) * 100).toFixed(1) : '0.0',
        c.reshipped, c.refundAmt.toFixed(2), c.totalSpend.toFixed(2),
      ]);
    }
    downloadCsv(`logistics-customers-${pincode.key}-${today}.csv`, rows);
  };

  const exportRepeatRefundersCsv = () => {
    const rows = [['Customer','Email','Phone','Orders','Refunds','Refund %','Reshipped','Refund ₹','Total Spend ₹','Pincodes','Order IDs']];
    for (const c of globalCustomers) {
      rows.push([
        c.name, c.email, c.phone,
        c.orders, c.refunds, (c.refundRate * 100).toFixed(1),
        c.reshipped, c.refundAmt.toFixed(2), c.totalSpend.toFixed(2),
        c.pincodes.join('|'), c.orderIds.join('|'),
      ]);
    }
    downloadCsv(`logistics-repeat-refunders-${today}.csv`, rows);
  };

  const toggleExpanded = key => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <KPI label="Orders (not cancelled)" value={num(metaStats.total)} color="#06b6d4" icon={Package}/>
        <KPI label="Refunded"               value={num(metaStats.refunded)} color="#ef4444" icon={RotateCcw}/>
        <KPI label="Refund rate"            value={`${metaStats.total > 0 ? ((metaStats.refunded / metaStats.total) * 100).toFixed(2) : '0.00'}%`} color="#ef4444"/>
        <KPI label="Reshipped"              value={num(metaStats.reshipped)} color="#f59e0b" icon={ArrowUpRight}/>
        <KPI label="Reshipped rate"         value={`${metaStats.total > 0 ? ((metaStats.reshipped / metaStats.total) * 100).toFixed(2) : '0.00'}%`} color="#f59e0b"/>
      </div>

      {/* BY WAREHOUSE */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
          <WarehouseIcon size={14} className="text-slate-400"/>
          <h3 className="text-xs font-semibold text-white">By warehouse · {byWarehouse.length} detected from <code className="text-[10px] text-slate-500">warehouse:*</code> or <code className="text-[10px] text-slate-500">wh:*</code> tags</h3>
        </div>
        {byWarehouse.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 italic">
            No warehouse tags found on any order. Expected format: <code className="text-slate-300">warehouse:mumbai</code>, <code className="text-slate-300">wh:delhi</code>, etc. on each Shopify order.
          </div>
        ) : (
          <div className="overflow-auto" style={{ maxHeight: '340px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Warehouse</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refunds</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund %</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped %</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund ₹</th>
                </tr>
              </thead>
              <tbody>
                {byWarehouse.map((r, i) => (
                  <tr key={r.key} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-200 font-medium">{r.key}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.orders)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.refunds)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: r.refundRate > 0.1 ? '#ef4444' : r.refundRate > 0.05 ? '#f59e0b' : '#64748b' }}>
                      {(r.refundRate * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.reshipped)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: r.reshippedRate > 0.05 ? '#f59e0b' : '#64748b' }}>
                      {(r.reshippedRate * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">{cur(r.refundAmt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* BY PINCODE */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2 flex-wrap">
          <Globe2 size={14} className="text-slate-400"/>
          <h3 className="text-xs font-semibold text-white">By pincode · {filteredPincodes.length} shown (min {minOrders}+ orders)</h3>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1">
              <Search size={11} className="text-slate-500"/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Pincode, city, customer…"
                className="bg-transparent text-[11px] text-slate-200 w-48 outline-none placeholder:text-slate-600"
              />
            </div>
            <label className="text-[10px] text-slate-500">Min orders</label>
            <select value={minOrders} onChange={e => setMinOrders(Number(e.target.value))} className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
              {[1, 3, 5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <label className="text-[10px] text-slate-500 ml-2">Sort by</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
              <option value="refundRate">Refund rate</option>
              <option value="reshippedRate">Reshipped rate</option>
              <option value="orders">Order volume</option>
              <option value="refunds">Refund count</option>
              <option value="refundAmt">Refund ₹</option>
              <option value="topRefundShare">Top customer concentration</option>
              <option value="repeatRefunders">Repeat refunders</option>
            </select>
            <button onClick={exportPincodeCsv} className="ml-2 flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-slate-300 border border-gray-700" title="Summary CSV — one row per pincode with customer concentration columns">
              <Download size={11}/> Pincode CSV
            </button>
            <button onClick={exportAllOrdersCsv} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-violet-900/30 hover:bg-violet-900/50 text-violet-200 border border-violet-800/50" title="Flat orders CSV — every order row with pincode, customer, order ID, refund flag">
              <Download size={11}/> All orders
            </button>
          </div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: '640px' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
              <tr>
                <th className="px-2 py-2 w-6"></th>
                <th className="px-3 py-2 text-left text-slate-400 font-semibold">Pincode</th>
                <th className="px-3 py-2 text-left text-slate-400 font-semibold">Cities</th>
                <th className="px-3 py-2 text-left text-slate-400 font-semibold">State</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refunds</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund %</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped %</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund ₹</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold" title="Unique customers in this pincode">Customers</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold" title="% of this pincode's refunds driven by its single top-refund customer. >50% = customer issue, not pincode.">Top cust %</th>
                <th className="px-3 py-2 text-right text-slate-400 font-semibold" title="Customers with 2+ refunds in this pincode">Repeat</th>
              </tr>
            </thead>
            <tbody>
              {filteredPincodes.length === 0 && (
                <tr><td colSpan={13} className="py-10 text-center text-slate-600 text-xs italic">No pincodes meet the filter. Try lowering Min orders or clearing the search.</td></tr>
              )}
              {filteredPincodes.slice(0, 500).map((r, i) => {
                const isOpen = expanded.has(r.key);
                const concentrationColor = r.topRefundShare >= 0.5 ? '#f59e0b' : r.topRefundShare >= 0.3 ? '#eab308' : '#64748b';
                return (
                  <Fragment key={r.key}>
                    <tr
                      className={clsx(i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40', 'hover:bg-gray-800/60 cursor-pointer')}
                      onClick={() => toggleExpanded(r.key)}
                    >
                      <td className="px-2 py-2 text-slate-500">
                        {isOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-200">{r.key}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 truncate max-w-[160px]">{r.cities.join(', ')}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 truncate max-w-[140px]">{r.states.join(', ')}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.orders)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.refunds)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: r.refundRate > 0.15 ? '#ef4444' : r.refundRate > 0.08 ? '#f59e0b' : '#64748b' }}>
                        {(r.refundRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.reshipped)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: r.reshippedRate > 0.10 ? '#f59e0b' : '#64748b' }}>
                        {(r.reshippedRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">{cur(r.refundAmt)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.uniqueCustomers)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: concentrationColor }}>
                        {r.refunds > 0 ? `${(r.topRefundShare * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: r.repeatRefunders > 0 ? '#f59e0b' : '#64748b' }}>
                        {r.repeatRefunders > 0 ? num(r.repeatRefunders) : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-950">
                        <td colSpan={13} className="p-0">
                          <PincodeDetail
                            pincode={r}
                            onExportOrders={() => exportPincodeOrders(r)}
                            onExportCustomers={() => exportPincodeCustomers(r)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* REPEAT REFUNDERS — global view */}
      {globalCustomers.length > 0 && (
        <div className="rounded-xl border border-amber-800/40 bg-amber-900/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-800/30 flex items-center gap-2 flex-wrap">
            <AlertTriangle size={14} className="text-amber-400"/>
            <h3 className="text-xs font-semibold text-amber-200">
              Repeat refunders · {num(globalCustomers.length)} customers with 2+ refunds across all pincodes
            </h3>
            <button onClick={exportRepeatRefundersCsv} className="ml-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-900/60 text-amber-200 border border-amber-800/60">
              <Download size={11}/> CSV (incl. order IDs)
            </button>
          </div>
          <div className="overflow-auto" style={{ maxHeight: '360px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Customer</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Contact</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refunds</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund %</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund ₹</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Total spend ₹</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Pincodes</th>
                </tr>
              </thead>
              <tbody>
                {globalCustomers.slice(0, 200).map((c, i) => (
                  <tr key={c.key} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-200 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {c.email && <div className="truncate max-w-[220px]">{c.email}</div>}
                      {c.phone && <div className="font-mono">{c.phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(c.orders)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400 font-semibold">{num(c.refunds)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: c.refundRate > 0.5 ? '#ef4444' : c.refundRate > 0.25 ? '#f59e0b' : '#64748b' }}>
                      {(c.refundRate * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(c.reshipped)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">{cur(c.refundAmt)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(c.totalSpend)}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 font-mono truncate max-w-[160px]">{c.pincodes.slice(0, 4).join(', ')}{c.pincodes.length > 4 ? `…+${c.pincodes.length - 4}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BY STATE — broader zoom */}
      {byState.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
            <MapPin size={14} className="text-slate-400"/>
            <h3 className="text-xs font-semibold text-white">By state · {byState.length} states</h3>
          </div>
          <div className="overflow-auto" style={{ maxHeight: '340px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">State</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refunds</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund %</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Reshipped %</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Refund ₹</th>
                </tr>
              </thead>
              <tbody>
                {byState.map((r, i) => (
                  <tr key={r.key} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-200 font-medium">{r.key}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.orders)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.refunds)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: r.refundRate > 0.1 ? '#ef4444' : r.refundRate > 0.05 ? '#f59e0b' : '#64748b' }}>
                      {(r.refundRate * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.reshipped)}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: r.reshippedRate > 0.05 ? '#f59e0b' : '#64748b' }}>
                      {(r.reshippedRate * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">{cur(r.refundAmt)}</td>
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

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════════ */
const DEPT_TABS = [
  { id: 'dispatch',  label: 'Dispatch',      icon: Truck    },
  { id: 'warehouse', label: 'Warehouse',      icon: Package  },
  { id: 'support',   label: 'Customer Care',  icon: Users    },
  { id: 'returns',   label: 'Returns',        icon: RotateCcw },
  { id: 'logistics', label: 'Logistics',      icon: Globe2    },
];

export default function ShopifyOps() {
  const { brands, shopifyOrders, brandData, activeBrandIds } = useStore();

  const shopifyBrands = (brands || []).filter(b => b.shopify?.shop);
  const [viewBrandId, setViewBrandId] = useState('all');
  const [activeTab, setActiveTab]     = useState('dispatch');
  const [shift, setShift]             = useState(getCurrentShift());
  const [now, setNow]                 = useState(new Date());

  const [overrides, setOverrides] = useState(() => lsGet(LS_OVERRIDES, {}));
  const [tickets, setTickets]     = useState(() => lsGet(LS_TICKETS, []));

  // Tick clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // Filter orders by brand
  const rawOrders = useMemo(() => {
    if (!shopifyOrders.length) return [];
    if (viewBrandId === 'all') return shopifyOrders;
    return shopifyOrders.filter(o => o._brandId === viewBrandId);
  }, [shopifyOrders, viewBrandId]);

  // Active brand name for title
  const activeBrand = viewBrandId === 'all'
    ? (brands?.length > 1 ? null : brands?.[0])
    : brands?.find(b => b.id === viewBrandId);

  const brandName = activeBrand?.name || (viewBrandId === 'all' ? 'All Brands' : '—');
  const shiftInfo = SHIFTS.find(s => s.id === shift) || SHIFTS[0];
  const ShiftIcon = shiftInfo.icon;

  // Tab badge counts
  const badgeCounts = useMemo(() => {
    const active = rawOrders.filter(o => !o.cancelled_at);
    return {
      dispatch:  active.filter(o => o.fulfillment_status === 'unfulfilled' || !o.fulfillment_status).length,
      warehouse: 0,
      support:   tickets.filter(t => t.status === 'Open' || t.status === 'Escalated').length,
      returns:   active.filter(o => o.refunds?.length > 0 || String(o.tags || '').toLowerCase().includes('return')).length,
      logistics: active.filter(o => String(o.tags || '').toLowerCase().includes('status:reshipped') || String(o.tags || '').toLowerCase() === 'reshipped').length,
    };
  }, [rawOrders, tickets]);

  if (!shopifyBrands.length) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <Truck size={36} className="opacity-30"/>
      <p className="text-sm">No Shopify brands configured — add credentials in Study Manual.</p>
    </div>
  );

  if (!shopifyOrders.length) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <Package size={36} className="opacity-30"/>
      <p className="text-sm">No order data — fetch orders in Shopify Orders first.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl" style={{ background: shiftInfo.color + '20' }}>
            <ShiftIcon size={20} style={{ color: shiftInfo.color }}/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">
                {activeBrand ? `${brandName} Ops` : 'Operations'}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{ background: shiftInfo.color + '15', borderColor: shiftInfo.color + '40', color: shiftInfo.color }}>
                {shiftInfo.label} Shift · {shiftInfo.range}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
              &nbsp;·&nbsp;{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              &nbsp;·&nbsp;{num(rawOrders.filter(o => !o.cancelled_at).length)} active orders
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Shift selector */}
          <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
            {SHIFTS.map(s => {
              const SIcon = s.icon;
              return (
                <button key={s.id} onClick={() => setShift(s.id)}
                  className={clsx('flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-all',
                    shift === s.id
                      ? 'text-white'
                      : 'text-slate-500 hover:text-slate-300')}
                  style={shift === s.id ? { background: s.color + '25', color: s.color } : {}}>
                  <SIcon size={11}/> {s.label}
                </button>
              );
            })}
          </div>

          {/* Brand selector */}
          {shopifyBrands.length > 1 && (
            <select value={viewBrandId} onChange={e => setViewBrandId(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="all">All Brands</option>
              {shopifyBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── DEPARTMENT TABS ────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-800">
        {DEPT_TABS.map(tab => {
          const Icon  = tab.icon;
          const badge = badgeCounts[tab.id];
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
                active
                  ? 'text-brand-300 border-brand-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300 hover:border-gray-600'
              )}>
              <Icon size={14}/>
              {tab.label}
              {badge > 0 && (
                <span className={clsx(
                  'flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold',
                  tab.id === 'support' && badgeCounts.support > 0
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-brand-600/20 text-brand-400'
                )}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── TAB CONTENT ────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}>
          {activeTab === 'dispatch'  && <DispatchTab  orders={rawOrders} overrides={overrides} setOverrides={setOverrides}/>}
          {activeTab === 'warehouse' && <WarehouseTab brandData={brandData} activeBrandId={viewBrandId} overrides={overrides} setOverrides={setOverrides}/>}
          {activeTab === 'support'   && <SupportTab   orders={rawOrders} tickets={tickets} setTickets={setTickets}/>}
          {activeTab === 'returns'   && <ReturnsTab   orders={rawOrders} overrides={overrides} setOverrides={setOverrides}/>}
          {activeTab === 'logistics' && <LogisticsTab rawOrders={rawOrders}/>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
