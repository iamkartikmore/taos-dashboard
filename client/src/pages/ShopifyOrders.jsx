import { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  ShoppingBag, TrendingUp, Users, Tag, RefreshCw,
  AlertTriangle, Package, Download, ChevronDown, ChevronUp,
  Terminal, Zap, ArrowRight, BarChart2, Globe, Truck,
} from 'lucide-react';
import { useStore } from '../store';
import { fetchShopifyOrders } from '../lib/api';
import { getWindowDates, processShopifyOrders } from '../lib/shopifyAnalytics';
import Spinner from '../components/ui/Spinner';

/* ─── CONSTANTS ──────────────────────────────────────────────────── */

const WINDOWS = [
  { id: 'today',      label: 'Today' },
  { id: 'yesterday',  label: 'Yesterday' },
  { id: '7d',         label: '7D' },
  { id: '14d',        label: '14D' },
  { id: '30d',        label: '30D' },
  { id: 'last_month', label: 'Last Mo' },
  { id: 'custom',     label: 'Custom' },
];

const TABS = [
  { id: 'overview',  label: 'Overview',      icon: BarChart2 },
  { id: 'skus',      label: 'SKU Intel',     icon: Package },
  { id: 'combos',    label: 'Combos',        icon: Zap },
  { id: 'customers', label: 'Customers',     icon: Users },
  { id: 'discounts', label: 'Discounts',     icon: Tag },
  { id: 'geo',       label: 'Geo',           icon: Globe },
  { id: 'ops',       label: 'Operations',    icon: Truck },
];

const SEG_COLORS = {
  'Champions':      '#22c55e',
  'Loyal':          '#34d399',
  'Potential Loyal':'#38bdf8',
  'New':            '#a78bfa',
  'Promising':      '#60a5fa',
  'At Risk':        '#f59e0b',
  "Can't Lose":     '#f97316',
  'Dormant':        '#ef4444',
  'Others':         '#64748b',
};

const C = ['#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80'];

const ROLE_COLORS = { entry: '#a78bfa', retention: '#22c55e', mixed: '#64748b' };
const ROLE_LABELS = { entry: 'Entry', retention: 'Retention', mixed: 'Mixed' };

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const cur  = n => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const num  = n => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct  = n => `${parseFloat(n || 0).toFixed(1)}%`;
const dec  = (n, d = 1) => parseFloat(n || 0).toFixed(d);
const hrs  = h => h < 24 ? `${dec(h)}h` : `${dec(h / 24)}d`;

/* ─── CSV EXPORT ─────────────────────────────────────────────────── */
function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r =>
    cols.map(c => {
      const v = c.fn ? c.fn(r) : (r[c.key] ?? '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [header, ...lines].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function ExportBtn({ onClick }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
      <Download size={11} /> Export CSV
    </button>
  );
}

/* ─── SMALL COMPONENTS ───────────────────────────────────────────── */

function KPI({ label, value, sub, color = '#2d7cf6', highlight }) {
  return (
    <div className={`bg-gray-900 border rounded-xl p-4 ${highlight ? 'border-emerald-500/30' : 'border-gray-800'}`}>
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ST({ children }) {
  return <h2 className="text-sm font-semibold text-slate-200 mb-3">{children}</h2>;
}

function Card({ children, className = '' }) {
  return <div className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ${className}`}>{children}</div>;
}

function CT({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
      {payload.map((p, i) => (
        <div key={i} className="text-slate-300">
          {p.name}: <strong className="text-white">{
            (p.name?.toLowerCase().includes('revenue') || p.name?.toLowerCase().includes('aov'))
              ? cur(p.value) : num(p.value)
          }</strong>
        </div>
      ))}
      {payload[0]?.payload?.date && <div className="text-slate-500">{payload[0].payload.date}</div>}
    </div>
  );
}

function SortBtn({ id, current, onSort, children }) {
  return (
    <button onClick={() => onSort(id)}
      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
        current === id ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
      }`}>{children}</button>
  );
}

function LiftBadge({ lift }) {
  const color = lift >= 5 ? '#22c55e' : lift >= 2 ? '#f59e0b' : '#64748b';
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold"
      style={{ background: `${color}22`, color }}>
      {dec(lift, 2)}x
    </span>
  );
}

/* ─── PAGE ───────────────────────────────────────────────────────── */

export default function ShopifyOrders() {
  const {
    config, shopifyOrders, shopifyOrdersStatus, shopifyOrdersWindow,
    setShopifyOrders, setShopifyOrdersStatus, inventoryMap,
  } = useStore();

  const [win, setWin]             = useState(shopifyOrdersWindow || '7d');
  const [customSince, setCSince]  = useState('');
  const [customUntil, setCUntil]  = useState('');
  const [tab, setTab]             = useState('overview');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [fetchLog, setFetchLog]   = useState([]);
  const [showLog, setShowLog]     = useState(false);
  const logRef = useRef(null);

  // SKU tab
  const [skuSort, setSkuSort]     = useState('revenue');
  const [skuSearch, setSkuSearch] = useState('');
  const [skuRole, setSkuRole]     = useState('all');

  // Customers tab
  const [custSearch, setCustSearch] = useState('');
  const [custSort, setCustSort]     = useState('revenueInWindow');

  // Combos tab
  const [comboView, setComboView] = useState('pairs');

  const canFetch = config.shopifyShop && config.shopifyClientId && config.shopifyClientSecret;

  const log = msg => setFetchLog(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);

  const handleFetch = async () => {
    if (!canFetch) return;
    setLoading(true); setError(null);
    setFetchLog([]);
    setShopifyOrdersStatus('loading');
    try {
      log(`Authenticating with ${config.shopifyShop}...`);
      const { since, until } = getWindowDates(win, customSince, customUntil);
      log(`Fetching orders from ${since.slice(0, 10)} → ${(until || '').slice(0, 10)}...`);
      const result = await fetchShopifyOrders(
        config.shopifyShop, config.shopifyClientId, config.shopifyClientSecret,
        since, until,
      );
      log(`✓ ${result.count.toLocaleString()} orders · ${result.pages} page(s) · ${(result.fetchMs / 1000).toFixed(1)}s`);
      log(`Processing analytics...`);
      setShopifyOrders(result.orders, win);
      log(`✓ Done`);
      setShowLog(true);
    } catch (e) {
      setError(e.message);
      log(`✗ Error: ${e.message}`);
      setShopifyOrdersStatus('error', e.message);
      setShowLog(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [fetchLog]);

  const data = useMemo(
    () => shopifyOrders.length ? processShopifyOrders(shopifyOrders, inventoryMap) : null,
    [shopifyOrders, inventoryMap],
  );

  // Add analytics summary to log when data is ready
  useEffect(() => {
    if (data && fetchLog.some(l => l.includes('Processing analytics'))) {
      setFetchLog(prev => [...prev,
        `  SKUs: ${data.skuList.length} · Customers: ${data.overview.uniqueCustomers.toLocaleString()} · Pairs: ${data.crossSellList.length}`,
        `  Triplets: ${data.tripletList.length} · Sequences: ${data.sequenceList.length}`,
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filteredSkus = useMemo(() => {
    if (!data?.skuList) return [];
    let list = data.skuList;
    if (skuSearch) list = list.filter(s =>
      s.sku.includes(skuSearch.toUpperCase()) ||
      s.name.toLowerCase().includes(skuSearch.toLowerCase())
    );
    if (skuRole !== 'all') list = list.filter(s => s.skuRole === skuRole);
    return [...list].sort((a, b) => {
      if (skuSort === 'daysRunway') {
        if (a.daysRunway === null) return 1; if (b.daysRunway === null) return -1;
        return a.daysRunway - b.daysRunway;
      }
      if (skuSort === 'discountRate' || skuSort === 'refundRate' || skuSort === 'soloRate') return (b[skuSort] || 0) - (a[skuSort] || 0);
      return (b[skuSort] || 0) - (a[skuSort] || 0);
    });
  }, [data, skuSort, skuSearch, skuRole]);

  const filteredCusts = useMemo(() => {
    if (!data?.topCustomers) return [];
    let list = data.topCustomers;
    if (custSearch) list = list.filter(c =>
      c.email.toLowerCase().includes(custSearch.toLowerCase()) ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(custSearch.toLowerCase())
    );
    return [...list].sort((a, b) => (b[custSort] || 0) - (a[custSort] || 0));
  }, [data, custSearch, custSort]);

  /* ── Not configured ─────────────────────────────────────────────── */
  if (!canFetch) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <ShoppingBag size={36} className="opacity-30" />
      <p className="text-sm">Add Shopify credentials in Study Manual → API Credentials first.</p>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Header + controls ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-emerald-500/20">
            <ShoppingBag size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Shopify Analytics</h1>
            {data && (
              <p className="text-[11px] text-slate-500">
                {num(data.overview.orders)} orders · {cur(data.overview.revenue)} · {win.toUpperCase()}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl ml-auto flex-wrap">
          {WINDOWS.map(w => (
            <button key={w.id} onClick={() => setWin(w.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                win === w.id ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}>{w.label}</button>
          ))}
        </div>

        {win === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" value={customSince} onChange={e => setCSince(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none" />
            <span className="text-slate-600 text-xs">→</span>
            <input type="date" value={customUntil} onChange={e => setCUntil(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none" />
          </div>
        )}

        <button onClick={handleFetch} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-all">
          {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
          {loading ? 'Fetching...' : 'Fetch Orders'}
        </button>

        {fetchLog.length > 0 && (
          <button onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-xs text-slate-400 hover:text-slate-200 transition-all">
            <Terminal size={12} />
            {showLog ? 'Hide Log' : 'Show Log'}
            {showLog ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* ── Fetch log panel ─────────────────────────────────────────── */}
      {showLog && fetchLog.length > 0 && (
        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
          <div ref={logRef} className="font-mono text-[11px] text-emerald-400 space-y-0.5 max-h-32 overflow-y-auto">
            {fetchLog.map((line, i) => (
              <div key={i} className={line.startsWith('  ') ? 'text-slate-500 pl-4' : line.includes('✗') ? 'text-red-400' : line.includes('✓') ? 'text-emerald-400' : 'text-slate-400'}>
                {line}
              </div>
            ))}
            {loading && <div className="text-amber-400 animate-pulse">● running...</div>}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-950/40 border border-red-800/40 rounded-xl text-xs text-red-300">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {!data && !loading && (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-600">
          <ShoppingBag size={32} className="opacity-20" />
          <p className="text-sm">Select a window and click Fetch Orders.</p>
        </div>
      )}

      {data && (
        <>
          {/* ── Tab nav ──────────────────────────────────────────────── */}
          <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit flex-wrap">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}>
                <t.icon size={12} />{t.label}
              </button>
            ))}
          </div>

          {/* ═══════════════════════════════════════════════════════════
              OVERVIEW
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
                <KPI label="Orders"          value={num(data.overview.orders)}            sub={`${dec(data.overview.dailyOrders)}/day`} highlight />
                <KPI label="Revenue"         value={cur(data.overview.revenue)}           sub={`${cur(data.overview.dailyRevenue)}/day`} highlight />
                <KPI label="AOV"             value={cur(data.overview.aov)}               sub={`${dec(data.overview.avgItemsPerOrder)} items/order`} />
                <KPI label="Unique Customers" value={num(data.overview.uniqueCustomers)}  sub={`${pct(data.overview.newCustomerPct)} new`} />
                <KPI label="Repeat Rev"      value={pct(data.overview.repeatRevenuePct)}  sub="from returning customers" />
                <KPI label="Refund Rate"     value={pct(data.overview.refundRate)}        sub={`${num(data.overview.refundedOrders)} orders refunded`} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KPI label="Discount Rate"   value={pct(data.overview.discountRate)}      sub={`${pct(data.overview.discountedOrderPct)} orders discounted`} />
                <KPI label="Multi-Item Orders" value={pct(data.overview.multiItemOrderPct)} sub="orders with 2+ items" />
                <KPI label="Cancelled"       value={num(data.overview.cancelledCount)}    sub={pct(data.overview.cancelRate)} />
                <KPI label="Shipping Rev"    value={cur(data.overview.shipping)}          sub="total shipping collected" />
              </div>

              <Card>
                <ST>Daily Revenue + Orders</ST>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.dailyTrend}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                    <Tooltip content={<CT />} />
                    <Legend wrapperStyle={{ fontSize:11, color:'#94a3b8' }} />
                    <Line yAxisId="l" type="monotone" dataKey="revenue"   name="Revenue"     stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="orders"    name="Orders"      stroke="#2d7cf6" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="newOrders" name="New Cust"    stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <ST>Orders by Hour</ST>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={data.hourlyData} barSize={9}>
                      <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:9 }} tickLine={false} interval={2} />
                      <YAxis tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                      <Tooltip content={<CT />} />
                      <Bar dataKey="orders" name="Orders" radius={[2,2,0,0]}>
                        {data.hourlyData.map((_, i) => <Cell key={i} fill={i >= 9 && i <= 21 ? '#2d7cf6' : '#374151'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <Card>
                  <ST>Traffic Source (source_name)</ST>
                  <div className="space-y-2">
                    {data.srcList.slice(0, 8).map((s, i) => {
                      const max = data.srcList[0]?.revenue || 1;
                      return (
                        <div key={s.source} className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400 w-20 truncate capitalize">{s.source}</span>
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${s.revenue/max*100}%`, background: C[i%C.length] }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-20 text-right tabular-nums">{cur(s.revenue)}</span>
                          <span className="text-[10px] text-slate-600 w-8 text-right">{s.orders}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              SKU INTEL
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'skus' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={skuSearch} onChange={e => setSkuSearch(e.target.value)}
                  placeholder="Search SKU / name..."
                  className="w-48 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg flex-wrap">
                  {[
                    { id:'revenue',     label:'Revenue' },
                    { id:'units',       label:'Units' },
                    { id:'aov',         label:'AOV' },
                    { id:'dailyUnits',  label:'Velocity' },
                    { id:'daysRunway',  label:'Runway↑' },
                    { id:'discountRate',label:'Disc%' },
                    { id:'refundRate',  label:'Refund%' },
                    { id:'newPct',      label:'New%' },
                    { id:'soloRate',    label:'Solo%' },
                  ].map(s => <SortBtn key={s.id} id={s.id} current={skuSort} onSort={setSkuSort}>{s.label}</SortBtn>)}
                </div>
                <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
                  {['all','entry','retention','mixed'].map(r => (
                    <button key={r} onClick={() => setSkuRole(r)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all capitalize ${
                        skuRole === r ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                      }`}>{r}</button>
                  ))}
                </div>
                <ExportBtn onClick={() => exportCSV('sku-intel.csv', filteredSkus, [
                  { key:'sku', label:'SKU' },
                  { key:'productName', label:'Product' },
                  { key:'revenue', label:'Net Revenue', fn: r => dec(r.revenue,0) },
                  { key:'grossRevenue', label:'Gross Revenue', fn: r => dec(r.grossRevenue,0) },
                  { key:'units', label:'Units' },
                  { key:'orders', label:'Orders' },
                  { key:'aov', label:'AOV', fn: r => dec(r.aov,0) },
                  { key:'dailyUnits', label:'Daily Units' },
                  { key:'daysRunway', label:'Days Runway', fn: r => r.daysRunway ?? 'N/A' },
                  { key:'discountRate', label:'Discount%', fn: r => dec(r.discountRate,1) },
                  { key:'refundRate', label:'Refund%', fn: r => dec(r.refundRate,1) },
                  { key:'newPct', label:'New Cust%', fn: r => dec(r.newPct,1) },
                  { key:'soloRate', label:'Solo Order%', fn: r => dec(r.soloRate,1) },
                  { key:'bundleRate', label:'Bundle Order%', fn: r => dec(r.bundleRate,1) },
                  { key:'skuRole', label:'Role' },
                  { key:'stock', label:'Stock', fn: r => r.stock ?? 'N/A' },
                ])} />
                <span className="text-xs text-slate-600">{filteredSkus.length} SKUs</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {[
                        'SKU','Product','Role','Net Rev','Gross','Units','Orders','AOV',
                        'Vel/d','Runway','Disc%','Refund%','New%','Solo%','Bundle%','Stock',
                      ].map(h => (
                        <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSkus.map(s => (
                      <tr key={s.sku} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                        <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300 whitespace-nowrap">{s.sku}</td>
                        <td className="px-2 py-1.5 text-slate-300 max-w-[160px] truncate">{s.productName}</td>
                        <td className="px-2 py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold capitalize"
                            style={{ background: `${ROLE_COLORS[s.skuRole]}22`, color: ROLE_COLORS[s.skuRole] }}>
                            {ROLE_LABELS[s.skuRole]}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400 font-semibold">{cur(s.revenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{cur(s.grossRevenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{num(s.units)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(s.orders)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{cur(s.aov)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.dailyUnits, 1)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {s.daysRunway !== null
                            ? <span className={s.daysRunway < 14 ? 'text-red-400 font-semibold' : s.daysRunway < 30 ? 'text-amber-400' : 'text-slate-400'}>{s.daysRunway}d</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.discountRate, 1)}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={s.refundRate > 10 ? 'text-red-400' : 'text-slate-400'}>{dec(s.refundRate, 1)}%</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.newPct, 1)}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.soloRate, 1)}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.bundleRate, 1)}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {s.stock !== null
                            ? <span className={s.stock === 0 ? 'text-red-400 font-semibold' : s.stock < 20 ? 'text-amber-400' : 'text-slate-400'}>{num(s.stock)}</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              COMBOS + PATTERNS
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'combos' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
                  {[
                    { id:'pairs',     label:'Pairs + Lift' },
                    { id:'triplets',  label:'Triplets' },
                    { id:'sequences', label:'Purchase Sequences' },
                  ].map(v => (
                    <button key={v.id} onClick={() => setComboView(v.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                        comboView === v.id ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
                      }`}>{v.label}</button>
                  ))}
                </div>
                {comboView === 'pairs' && (
                  <ExportBtn onClick={() => exportCSV('sku-pairs.csv', data.crossSellList, [
                    { key:'sku1', label:'SKU 1' },
                    { key:'sku2', label:'SKU 2' },
                    { key:'count', label:'Co-Orders' },
                    { key:'lift', label:'Lift' },
                    { key:'conf1', label:'Conf A→B %' },
                    { key:'conf2', label:'Conf B→A %' },
                    { key:'supportPct', label:'Support %' },
                  ])} />
                )}
                {comboView === 'sequences' && (
                  <ExportBtn onClick={() => exportCSV('purchase-sequences.csv', data.sequenceList, [
                    { key:'from', label:'First SKU' },
                    { key:'fromName', label:'First Product' },
                    { key:'to', label:'Next SKU' },
                    { key:'toName', label:'Next Product' },
                    { key:'count', label:'Customers' },
                  ])} />
                )}
              </div>

              {comboView === 'pairs' && (
                <div className="space-y-3">
                  <div className="flex gap-3 text-[11px] text-slate-500 bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div><span className="text-slate-300 font-semibold">Lift &gt; 5</span> = very strong affinity</div>
                    <div><span className="text-slate-300 font-semibold">Lift 2-5</span> = strong</div>
                    <div><span className="text-slate-300 font-semibold">Lift ~1</span> = random</div>
                    <div><span className="text-slate-300 font-semibold">Conf A→B</span> = % of A buyers who also buy B</div>
                    <div><span className="text-slate-300 font-semibold">Support</span> = % of all orders containing both</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['#','SKU A','SKU B','Co-Orders','Lift','Conf A→B','Conf B→A','Support %'].map(h => (
                            <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.crossSellList.map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-2 py-1.5 text-slate-600 tabular-nums">{i+1}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{r.sku1}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{r.sku2}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-300 font-semibold">{num(r.count)}</td>
                            <td className="px-2 py-1.5 text-right"><LiftBadge lift={r.lift} /></td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(r.conf1, 1)}%</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(r.conf2, 1)}%</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{dec(r.supportPct, 2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.crossSellList.length === 0 && (
                    <div className="text-center text-slate-600 py-12 text-sm">No pairs with 2+ co-orders found in this window.</div>
                  )}
                </div>
              )}

              {comboView === 'triplets' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500">3-SKU combos bought in the same order, sorted by frequency.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['#','SKU A','SKU B','SKU C','Orders','Support %'].map(h => (
                            <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.tripletList.map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-2 py-1.5 text-slate-600">{i+1}</td>
                            {r.skus.map((s, j) => (
                              <td key={j} className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{s}</td>
                            ))}
                            {r.skus.length < 3 && <td />}
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-300 font-semibold">{num(r.count)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{dec(r.supportPct, 2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.tripletList.length === 0 && (
                    <div className="text-center text-slate-600 py-12 text-sm">No triplets found — need multi-item orders.</div>
                  )}
                </div>
              )}

              {comboView === 'sequences' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500">
                    When a customer places a second order in this window, what SKU do they buy next?
                    Shows the most common A → B transitions across repeat customers.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['#','From SKU','Product','→','To SKU','Product','Count'].map(h => (
                            <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.sequenceList.map((r, i) => (
                          <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-2 py-1.5 text-slate-600">{i+1}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{r.from}</td>
                            <td className="px-2 py-1.5 text-slate-400 max-w-[120px] truncate">{r.fromName}</td>
                            <td className="px-2 py-1.5"><ArrowRight size={11} className="text-slate-600" /></td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-emerald-400">{r.to}</td>
                            <td className="px-2 py-1.5 text-slate-400 max-w-[120px] truncate">{r.toName}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-300 font-semibold">{num(r.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.sequenceList.length === 0 && (
                    <div className="text-center text-slate-600 py-12 text-sm">No repeat purchase sequences in this window.</div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              CUSTOMERS
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'customers' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* RFM Segments */}
                <Card className="xl:col-span-2">
                  <ST>RFM Segments</ST>
                  <div className="space-y-2">
                    {data.segments.map(s => {
                      const max = data.segments[0]?.count || 1;
                      return (
                        <div key={s.segment} className="flex items-center gap-3">
                          <span className="w-28 text-[11px] text-slate-400 shrink-0">{s.segment}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width:`${s.count/max*100}%`, background: SEG_COLORS[s.segment] || '#64748b' }} />
                          </div>
                          <span className="text-[11px] font-semibold text-white w-12 text-right tabular-nums">{num(s.count)}</span>
                          <span className="text-[10px] text-slate-500 w-24 text-right tabular-nums">{cur(s.avgLTV)} avg LTV</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* LTV Distribution */}
                <Card>
                  <ST>LTV Distribution</ST>
                  <div className="space-y-2">
                    {data.ltvBuckets.map((b, i) => {
                      const max = Math.max(...data.ltvBuckets.map(x => x.count), 1);
                      return (
                        <div key={b.label} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 w-20 shrink-0">{b.label}</span>
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${b.count/max*100}%`, background: C[i%C.length] }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-10 text-right tabular-nums">{num(b.count)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-800">
                    <ST>Purchase Frequency</ST>
                    <div className="space-y-2">
                      {data.freqBuckets.map((b, i) => {
                        const max = Math.max(...data.freqBuckets.map(x => x.count), 1);
                        return (
                          <div key={b.label} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 w-8 shrink-0">{b.label}</span>
                            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width:`${b.count/max*100}%`, background: C[i%C.length] }} />
                            </div>
                            <span className="text-[10px] text-slate-400 w-10 text-right tabular-nums">{num(b.count)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              </div>

              {/* Top customers table */}
              <div className="flex flex-wrap items-center gap-2">
                <input type="text" value={custSearch} onChange={e => setCustSearch(e.target.value)}
                  placeholder="Search email / name..."
                  className="w-48 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
                  {[
                    { id:'revenueInWindow', label:'Rev (window)' },
                    { id:'lifetimeRevenue', label:'LTV' },
                    { id:'lifetimeOrders',  label:'Orders' },
                    { id:'recencyDays',     label:'Recency' },
                  ].map(s => <SortBtn key={s.id} id={s.id} current={custSort} onSort={setCustSort}>{s.label}</SortBtn>)}
                </div>
                <ExportBtn onClick={() => exportCSV('customers.csv', filteredCusts, [
                  { key:'email', label:'Email' },
                  { key:'firstName', label:'First Name' },
                  { key:'lastName', label:'Last Name' },
                  { key:'segment', label:'RFM Segment' },
                  { key:'rScore', label:'R Score' },
                  { key:'fScore', label:'F Score' },
                  { key:'mScore', label:'M Score' },
                  { key:'ordersInWindow', label:'Orders (window)' },
                  { key:'revenueInWindow', label:'Rev (window)', fn: r => dec(r.revenueInWindow, 0) },
                  { key:'lifetimeOrders', label:'Lifetime Orders' },
                  { key:'lifetimeRevenue', label:'Lifetime Rev', fn: r => dec(r.lifetimeRevenue, 0) },
                  { key:'recencyDays', label:'Recency Days' },
                  { key:'lastOrderDate', label:'Last Order' },
                ])} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Customer','Segment','R','F','M','Orders (win)','Rev (win)','LTV','Lifetime Ord','Last Order'].map(h => (
                        <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCusts.slice(0, 100).map(c => (
                      <tr key={c.id} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-2 py-1.5">
                          <div className="text-slate-300 text-[11px]">{c.firstName} {c.lastName}</div>
                          <div className="text-slate-600 text-[10px] truncate max-w-[160px]">{c.email}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                            style={{ background: `${SEG_COLORS[c.segment] || '#64748b'}22`, color: SEG_COLORS[c.segment] || '#94a3b8' }}>
                            {c.segment}
                          </span>
                        </td>
                        {[c.rScore, c.fScore, c.mScore].map((score, i) => (
                          <td key={i} className="px-2 py-1.5 text-center">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold"
                              style={{ background: `hsl(${score*20+100},60%,30%)`, color: `hsl(${score*20+100},80%,70%)` }}>
                              {score}
                            </span>
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{c.ordersInWindow}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400 font-semibold">{cur(c.revenueInWindow)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{cur(c.lifetimeRevenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(c.lifetimeOrders)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-500">{c.lastOrderDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              DISCOUNTS
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'discounts' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KPI label="Total Discount"  value={cur(data.overview.discount)}  sub={pct(data.overview.discountRate)} />
                <KPI label="Orders w/ Disc"  value={pct(data.overview.discountedOrderPct)} sub="of all orders" />
                <KPI label="Unique Codes"    value={num(data.discList.length)}     />
                <KPI label="Avg Disc/Order"  value={cur(data.overview.orders > 0 ? data.overview.discount / data.overview.orders : 0)} />
              </div>
              <div className="flex items-center gap-2">
                <ExportBtn onClick={() => exportCSV('discounts.csv', data.discList, [
                  { key:'code', label:'Code' },
                  { key:'uses', label:'Uses' },
                  { key:'uniqueOrders', label:'Unique Orders' },
                  { key:'grossRevenue', label:'Gross Revenue', fn: r => dec(r.grossRevenue, 0) },
                  { key:'discountTotal', label:'Discount Total', fn: r => dec(r.discountTotal, 0) },
                  { key:'discountRate', label:'Discount %', fn: r => dec(r.discountRate, 1) },
                  { key:'avgDisc', label:'Avg Disc/Use', fn: r => dec(r.avgDisc, 0) },
                  { key:'newUses', label:'New Cust Uses' },
                  { key:'repeatUses', label:'Repeat Cust Uses' },
                  { key:'newPct', label:'New Cust %', fn: r => dec(r.newPct, 1) },
                ])} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Code','Uses','Gross Rev','Disc Total','Disc %','Avg Disc','New Uses','Repeat Uses','New %'].map(h => (
                        <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.discList.map((d, i) => (
                      <tr key={d.code} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-2 py-1.5 font-mono text-[11px] text-slate-200 font-semibold">{d.code}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{num(d.uses)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400">{cur(d.grossRevenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-red-400">{cur(d.discountTotal)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={d.discountRate > 20 ? 'text-red-400' : d.discountRate > 10 ? 'text-amber-400' : 'text-slate-400'}>{dec(d.discountRate, 1)}%</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{cur(d.avgDisc)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-a78bfa" style={{ color:'#a78bfa' }}>{num(d.newUses)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(d.repeatUses)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(d.newPct, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              GEO
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'geo' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <ExportBtn onClick={() => exportCSV('geo-states.csv', data.geoList, [
                  { key:'province', label:'State' },
                  { key:'orders', label:'Orders' },
                  { key:'revenue', label:'Revenue', fn: r => dec(r.revenue, 0) },
                  { key:'customers', label:'Customers' },
                ])} />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <ST>Revenue by State</ST>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data.geoList.slice(0, 12)} layout="vertical" barSize={12}>
                      <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="province" tick={{ fill:'#94a3b8', fontSize:10 }} tickLine={false} width={120} />
                      <Tooltip content={<CT />} />
                      <Bar dataKey="revenue" name="Revenue" radius={[0,3,3,0]}>
                        {data.geoList.slice(0,12).map((_, i) => <Cell key={i} fill={C[i%C.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <ST>Revenue by City (Top 15)</ST>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data.cityList.slice(0, 12)} layout="vertical" barSize={12}>
                      <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="city" tick={{ fill:'#94a3b8', fontSize:10 }} tickLine={false} width={100} />
                      <Tooltip content={<CT />} />
                      <Bar dataKey="revenue" name="Revenue" fill="#2d7cf6" radius={[0,3,3,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['State','Orders','Revenue','Customers','AOV'].map(h => (
                        <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.geoList.map((g, i) => (
                      <tr key={g.province} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                        <td className="px-2 py-1.5 text-slate-300">{g.province}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(g.orders)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400 font-semibold">{cur(g.revenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(g.customers)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{cur(g.orders > 0 ? g.revenue / g.orders : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              OPERATIONS
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'ops' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-4">

              {/* Fulfillment velocity */}
              <div>
                <ST>Fulfillment Velocity</ST>
                {data.fulfillStats ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KPI label="Avg Time to Ship"    value={hrs(data.fulfillStats.avg)}    sub={`median ${hrs(data.fulfillStats.median)}`} />
                    <KPI label="p90 Time to Ship"    value={hrs(data.fulfillStats.p90)}    sub="90th percentile" />
                    <KPI label="Shipped &lt;24h"    value={pct(data.fulfillStats.under24h / data.fulfillStats.count * 100)} sub={`${num(data.fulfillStats.under24h)} orders`} />
                    <KPI label="Shipped &gt;72h"    value={num(data.fulfillStats.over72h)} sub="orders slow shipped" />
                  </div>
                ) : (
                  <div className="text-slate-600 text-sm py-4">No fulfillment data found — fulfillment data requires fulfilled orders.</div>
                )}
              </div>

              {/* Payment gateways */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <ST>Payment Gateways</ST>
                  <ExportBtn onClick={() => exportCSV('payment-gateways.csv', data.payList, [
                    { key:'gateway', label:'Gateway' },
                    { key:'orders', label:'Orders' },
                    { key:'revenue', label:'Revenue', fn: r => dec(r.revenue, 0) },
                    { key:'newOrders', label:'New Cust Orders' },
                  ])} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Gateway','Orders','Revenue','New Cust','Repeat','Order %'].map(h => (
                          <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.payList.map(g => (
                        <tr key={g.gateway} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                          <td className="px-2 py-1.5 text-slate-200 font-medium capitalize">{g.gateway}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-300 font-semibold">{num(g.orders)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400">{cur(g.revenue)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(g.newOrders)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(g.orders - g.newOrders)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{data.overview.orders > 0 ? dec(g.orders/data.overview.orders*100,1) : '0.0'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Referring sites */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <ST>Referring Sites (Traffic Source)</ST>
                  <ExportBtn onClick={() => exportCSV('referrers.csv', data.referList, [
                    { key:'source', label:'Referrer' },
                    { key:'orders', label:'Orders' },
                    { key:'revenue', label:'Revenue', fn: r => dec(r.revenue, 0) },
                    { key:'newOrders', label:'New Cust Orders' },
                  ])} />
                </div>
                <div className="space-y-2">
                  {data.referList.map((r, i) => {
                    const max = data.referList[0]?.orders || 1;
                    return (
                      <div key={r.source} className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400 w-32 truncate">{r.source}</span>
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width:`${r.orders/max*100}%`, background: C[i%C.length] }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-12 text-right tabular-nums">{num(r.orders)} ord</span>
                        <span className="text-[10px] text-emerald-400 w-20 text-right tabular-nums">{cur(r.revenue)}</span>
                        <span className="text-[10px] text-slate-600 w-14 text-right">{num(r.newOrders)} new</span>
                      </div>
                    );
                  })}
                  {data.referList.length === 0 && (
                    <div className="text-slate-600 text-sm py-4">No referring site data — requires referring_site field from Shopify.</div>
                  )}
                </div>
              </div>

              {/* Cancellations */}
              {data.cancelList.length > 0 && (
                <div>
                  <ST>Cancellation Reasons ({num(data.overview.cancelledCount)} cancelled)</ST>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['Reason','Count','Lost Revenue','% of Cancelled'].map(h => (
                            <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.cancelList.map(c => (
                          <tr key={c.reason} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-2 py-1.5 text-slate-300 capitalize">{c.reason.replace(/_/g, ' ')}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-red-400 font-semibold">{num(c.count)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{cur(c.revenue)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{data.overview.cancelledCount > 0 ? dec(c.count/data.overview.cancelledCount*100,1) : '0.0'}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
