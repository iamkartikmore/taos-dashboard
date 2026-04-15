import { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  ShoppingBag, Users, Tag, RefreshCw,
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
  { id: 'overview',   label: 'Overview',     icon: BarChart2 },
  { id: 'skus',       label: 'SKU Intel',    icon: Package },
  { id: 'combos',     label: 'Combos',       icon: Zap },
  { id: 'customers',  label: 'Customers',    icon: Users },
  { id: 'discounts',  label: 'Discounts',    icon: Tag },
  { id: 'geo',        label: 'Geo',          icon: Globe },
  { id: 'warehouse',  label: 'Warehouses',   icon: Truck },
  { id: 'tags',       label: 'Tag Analytics',icon: Tag },
  { id: 'ops',        label: 'Operations',   icon: BarChart2 },
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

function KPI({ label, value, sub, color, highlight }) {
  return (
    <div className={`bg-gray-900 border rounded-xl p-4 ${highlight ? 'border-emerald-500/30' : 'border-gray-800'}`}>
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color: color || '#fff' }}>{value}</div>
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

/* ─── UTM ATTRIBUTION TREE ───────────────────────────────────────── */
function UtmTree({ list }) {
  const [expanded, setExpanded] = useState({});
  const [expandedMed, setExpandedMed] = useState({});
  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleMed = key => setExpandedMed(prev => ({ ...prev, [key]: !prev[key] }));
  const maxRev = list[0]?.revenue || 1;

  return (
    <div className="space-y-1 text-xs">
      {list.slice(0,12).map(src => (
        <div key={src.source}>
          {/* Source row */}
          <div className="flex items-center gap-1.5 py-1 hover:bg-gray-800/40 rounded px-1 cursor-pointer group"
            onClick={() => toggle(src.source)}>
            <span className="text-slate-500 text-[9px] w-3">{src.mediums?.length > 0 ? (expanded[src.source] ? '▾' : '▸') : ' '}</span>
            <span className="font-semibold text-slate-200 w-28 truncate">{src.source}</span>
            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden mx-1">
              <div className="h-full bg-blue-500/70 rounded-full" style={{ width:`${src.revenue/maxRev*100}%` }} />
            </div>
            <span className="text-slate-300 w-20 text-right tabular-nums">{cur(src.revenue)}</span>
            <span className="text-slate-600 w-10 text-right tabular-nums">{src.orders} ord</span>
            <span className="text-[9px] text-slate-600 w-14 text-right">{pct(src.newPct)} new</span>
          </div>

          {/* Medium rows */}
          {expanded[src.source] && src.mediums?.map(med => (
            <div key={med.medium} className="ml-4">
              <div className="flex items-center gap-1.5 py-0.5 hover:bg-gray-800/30 rounded px-1 cursor-pointer"
                onClick={() => toggleMed(`${src.source}|${med.medium}`)}>
                <span className="text-slate-600 text-[9px] w-3">{med.campaigns?.length > 0 ? (expandedMed[`${src.source}|${med.medium}`] ? '▾' : '▸') : ' '}</span>
                <span className="text-slate-400 w-24 truncate italic">{med.medium}</span>
                <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden mx-1">
                  <div className="h-full bg-violet-500/60 rounded-full" style={{ width:`${med.revenue/maxRev*100}%` }} />
                </div>
                <span className="text-slate-400 w-20 text-right tabular-nums">{cur(med.revenue)}</span>
                <span className="text-slate-600 w-10 text-right tabular-nums">{med.orders} ord</span>
              </div>

              {/* Campaign rows */}
              {expandedMed[`${src.source}|${med.medium}`] && med.campaigns?.slice(0,10).map(camp => (
                <div key={camp.campaign}
                  className="ml-4 flex items-center gap-1.5 py-0.5 px-1 text-[10px]">
                  <span className="w-3" />
                  <span className="text-slate-500 w-40 truncate">{camp.campaign}</span>
                  <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden mx-1">
                    <div className="h-full bg-emerald-500/50 rounded-full" style={{ width:`${camp.revenue/maxRev*100}%` }} />
                  </div>
                  <span className="text-slate-500 w-20 text-right tabular-nums">{cur(camp.revenue)}</span>
                  <span className="text-slate-600 w-10 text-right tabular-nums">{camp.orders} ord</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── PAGE ───────────────────────────────────────────────────────── */

export default function ShopifyOrders() {
  const {
    brands, shopifyOrders, shopifyOrdersWindow,
    setShopifyOrders, setShopifyOrdersStatus, inventoryMap, brandData, activeBrandIds,
  } = useStore();

  // Use first brand with Shopify configured, or let user pick
  const shopifyBrands = (brands || []).filter(b => b.shopify?.shop && b.shopify?.clientId && b.shopify?.clientSecret);
  const [selectedBrandId, setSelectedBrandId] = useState(() => shopifyBrands[0]?.id || '');
  const activeBrand = shopifyBrands.find(b => b.id === selectedBrandId) || shopifyBrands[0];
  const shopify = activeBrand?.shopify || {};

  // Location / per-warehouse inventory from store
  const activeBrandData = brandData?.[activeBrand?.id] || {};
  const locations          = activeBrandData.locations           || [];
  const inventoryByLocation = activeBrandData.inventoryByLocation || {};
  const skuToItemId         = activeBrandData.skuToItemId         || {};

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

  // Warehouse tab
  const [whSelectedTags, setWhSelectedTags] = useState(null); // null = not yet initialized
  const [whDrillTag, setWhDrillTag]         = useState(null); // clicked row drill-down
  const [whFilter, setWhFilter]             = useState(null); // single-tag filter in ops section

  // Tags tab
  const [tagSearch, setTagSearch]           = useState('');
  const [selectedTags, setSelectedTags]     = useState([]); // multi-select for comparison

  // Customers tab
  const [custSearch, setCustSearch] = useState('');
  const [custSort, setCustSort]     = useState('revenueInWindow');

  // Combos tab
  const [comboView, setComboView] = useState('pairs');

  const canFetch = shopifyBrands.length > 0;

  const addLog = msg => setFetchLog(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);

  const handleFetch = async () => {
    if (!canFetch) return;
    setLoading(true); setError(null);
    setFetchLog([]);
    setShowLog(true);
    setShopifyOrdersStatus('loading');
    try {
      const { since, until } = getWindowDates(win, customSince, customUntil);
      addLog(`Window: ${since.slice(0,10)} → ${(until||'').slice(0,10)}`);
      // fetchShopifyOrders now uses SSE — each server log line calls addLog in real-time
      const result = await fetchShopifyOrders(
        shopify.shop, shopify.clientId, shopify.clientSecret,
        since, until,
        msg => addLog(msg),   // ← SSE real-time callback
      );
      addLog(`Processing ${result.count.toLocaleString()} orders through analytics engine...`);
      setShopifyOrders(result.orders, win);
    } catch (e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`);
      setShopifyOrdersStatus('error', e.message);
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

  // Analytics summary appended once data is processed
  useEffect(() => {
    if (data && fetchLog.some(l => l.includes('analytics engine'))) {
      setFetchLog(prev => [...prev,
        `✓ Analytics complete`,
        `  ${data.skuList.length} SKUs · ${data.overview.uniqueCustomers.toLocaleString()} customers · ${data.crossSellList.length} SKU pairs`,
        `  Triplets: ${data.tripletList.length} · Sequences: ${data.sequenceList.length} · CAC reducers scored`,
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
      <p className="text-sm">Add Shopify credentials in Study Manual → Brands first.</p>
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

        {shopifyBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            {shopifyBrands.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

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

              {/* ── Daily performance pattern ──────────────────────── */}
              {(() => {
                // 7-day moving average + colour bars by vs-avg performance
                const trend = data.dailyTrend;
                const avgRev = trend.length ? trend.reduce((s,d)=>s+d.revenue,0)/trend.length : 1;
                const enriched = trend.map((d, i) => {
                  const windowSlice = trend.slice(Math.max(0,i-3), Math.min(trend.length,i+4));
                  const ma7 = windowSlice.reduce((s,x)=>s+x.revenue,0)/windowSlice.length;
                  const discRate = d.revenue > 0 ? (d.discount||0)/d.revenue*100 : 0;
                  return { ...d, ma7: Math.round(ma7), discRate: +discRate.toFixed(1), vsAvg: d.revenue - avgRev };
                });
                return (
                  <Card>
                    <div className="flex items-center justify-between mb-3">
                      <ST>Daily Revenue — Pattern vs Average</ST>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70 inline-block" /> Above avg</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" /> Below avg</span>
                        <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-amber-400 inline-block" /> 7d MA</span>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={enriched} barSize={Math.max(4, Math.min(18, 600/Math.max(enriched.length,1)))}>
                        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill:'#475569', fontSize:9 }} tickLine={false}
                          tickFormatter={v => v?.slice(5)} interval={Math.max(0,Math.floor(enriched.length/12)-1)} />
                        <YAxis yAxisId="l" tick={{ fill:'#475569', fontSize:10 }} tickLine={false}
                          tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} axisLine={false} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fill:'#475569', fontSize:9 }}
                          tickLine={false} axisLine={false} tickFormatter={v=>`${v.toFixed(0)}%`} />
                        <Tooltip content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          return (
                            <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl min-w-[180px]">
                              <div className="font-semibold text-slate-200 mb-1">{label}</div>
                              <div className="text-emerald-400">Revenue: <strong>{cur(d?.revenue)}</strong></div>
                              <div className="text-amber-400">7d MA: <strong>{cur(d?.ma7)}</strong></div>
                              <div className="text-slate-400">Orders: <strong>{d?.orders}</strong> · New: <strong>{d?.newOrders}</strong></div>
                              <div className="text-slate-400">Disc Rate: <strong>{d?.discRate}%</strong></div>
                              <div className={d?.vsAvg >= 0 ? 'text-emerald-400' : 'text-red-400'}>vs Avg: <strong>{d?.vsAvg >= 0 ? '+' : ''}{cur(d?.vsAvg)}</strong></div>
                            </div>
                          );
                        }} />
                        <Bar yAxisId="l" dataKey="revenue" name="Revenue" radius={[2,2,0,0]}>
                          {enriched.map((d, i) => <Cell key={i} fill={d.vsAvg >= 0 ? '#22c55e99' : '#ef444499'} />)}
                        </Bar>
                        <Line yAxisId="l" type="monotone" dataKey="ma7" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="7d MA" />
                        <Line yAxisId="r" type="monotone" dataKey="discRate" stroke="#a78bfa" strokeWidth={1} dot={false} strokeDasharray="3 2" name="Disc%" />
                      </BarChart>
                    </ResponsiveContainer>
                    {/* New vs repeat mini bar */}
                    <div className="mt-3 border-t border-gray-800 pt-3">
                      <div className="text-[10px] text-slate-500 mb-2 font-semibold uppercase tracking-wider">New vs Repeat orders per day</div>
                      <ResponsiveContainer width="100%" height={60}>
                        <BarChart data={enriched} barSize={Math.max(3, Math.min(14, 600/Math.max(enriched.length,1)))}>
                          <XAxis dataKey="date" hide />
                          <Tooltip content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0]?.payload;
                            return <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs"><div className="text-slate-400">{d?.date}: <span className="text-blue-400">{d?.newOrders} new</span> · <span className="text-emerald-400">{(d?.orders||0)-(d?.newOrders||0)} repeat</span></div></div>;
                          }} />
                          <Bar dataKey="newOrders" stackId="a" fill="#3b82f6aa" radius={[0,0,0,0]} name="New" />
                          <Bar dataKey="orders" stackId="a" fill="#22c55e33" radius={[1,1,0,0]} name="Repeat base" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                );
              })()}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* Orders by hour */}
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

                {/* UTM / Traffic attribution */}
                <Card>
                  <div className="flex items-center justify-between mb-3">
                    <ST>{data.utmList?.length > 0 ? 'UTM Attribution' : 'Traffic Source'}</ST>
                    {data.utmList?.length === 0 && (
                      <span className="text-[9px] text-amber-500/70 bg-amber-500/10 px-2 py-0.5 rounded-full">
                        No UTM params found in orders
                      </span>
                    )}
                  </div>

                  {data.utmList?.length > 0 ? (
                    <UtmTree list={data.utmList} />
                  ) : (
                    // Fallback: referrer breakdown
                    <div className="space-y-1.5">
                      {[...data.referList, ...data.srcList.filter(s => !data.referList.some(r=>r.source===s.source))]
                        .slice(0,10).map((s, i) => {
                          const max = data.referList[0]?.revenue || data.srcList[0]?.revenue || 1;
                          return (
                            <div key={s.source} className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 w-24 truncate">{s.source || 'direct'}</span>
                              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width:`${s.revenue/max*100}%`, background: C[i%C.length] }} />
                              </div>
                              <span className="text-[10px] text-slate-400 w-20 text-right tabular-nums">{cur(s.revenue)}</span>
                              <span className="text-[10px] text-slate-600 w-8 text-right">{s.orders}</span>
                            </div>
                          );
                        })}
                      <p className="text-[9px] text-slate-600 mt-2">Tip: add UTM params to your ad URLs to see source/medium/campaign breakdown here.</p>
                    </div>
                  )}
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
                    { id:'cac',       label:'CAC Reducers' },
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
                {comboView === 'cac' && (
                  <ExportBtn onClick={() => exportCSV('cac-reducers.csv', data.cacReducers, [
                    { key:'sku', label:'SKU' },
                    { key:'productName', label:'Product' },
                    { key:'cacScore', label:'CAC Score' },
                    { key:'cacLabel', label:'Label' },
                    { key:'cacAcqScore', label:'Acquisition pts' },
                    { key:'cacDiscScore', label:'Discount Efficiency pts' },
                    { key:'cacLtvScore', label:'LTV Unlock pts' },
                    { key:'cacVolScore', label:'Volume pts' },
                    { key:'newPct', label:'New Cust %', fn: r => dec(r.newPct,1) },
                    { key:'discountRate', label:'Discount %', fn: r => dec(r.discountRate,1) },
                    { key:'cacFromCount', label:'Sequence Lead Count' },
                    { key:'orders', label:'Orders' },
                    { key:'revenue', label:'Revenue', fn: r => dec(r.revenue,0) },
                    { key:'aov', label:'AOV', fn: r => dec(r.aov,0) },
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

              {/* ── CAC REDUCERS ─────────────────────────────────────── */}
              {comboView === 'cac' && (
                <div className="space-y-4">
                  {/* Score explanation */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
                    <div className="text-sm font-semibold text-white">How the CAC Reducer Score works</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                      {[
                        { label: 'Acquisition Power', pts: '0–35', color: '#a78bfa',
                          desc: '% of this SKU\'s buyers who are new customers. High = this SKU actively brings in first-time buyers.' },
                        { label: 'Discount Efficiency', pts: '0–25', color: '#22c55e',
                          desc: 'Inverse of discount rate. High = converts without needing a coupon. Low discount rate = CAC isn\'t inflated by promos.' },
                        { label: 'LTV Unlock', pts: '0–25', color: '#f59e0b',
                          desc: 'How often this SKU appears as the starting point in repeat-purchase sequences. Buying it leads customers to reorder — so fixed CAC is spread across more orders.' },
                        { label: 'Volume Reliability', pts: '0–15', color: '#38bdf8',
                          desc: 'Enough orders to trust the signal. Scores ramp from 0→15 as the SKU reaches 20+ orders in this window.' },
                      ].map(c => (
                        <div key={c.label} className="bg-gray-800/50 rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold" style={{ color: c.color }}>{c.label}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{c.pts} pts</span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed">{c.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-600">
                      Score 75–100 = Top Reducer · 55–74 = Strong · 35–54 = Moderate · &lt;35 = Weak.
                      <span className="ml-2">CAC = ad spend ÷ new customers acquired. SKUs that bring in more new customers, convert without discounts, and trigger repeat orders reduce blended CAC.</span>
                    </p>
                  </div>

                  {/* Top reducers visual */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <Card>
                      <ST>Top 12 — CAC Reducer Score</ST>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data.cacReducers.slice(0,12)} layout="vertical" barSize={14}>
                          <XAxis type="number" domain={[0,100]} tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                          <YAxis type="category" dataKey="sku" tick={{ fill:'#94a3b8', fontSize:10 }} tickLine={false} width={90} />
                          <Tooltip content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const s = payload[0]?.payload;
                            return (
                              <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
                                <div className="text-white font-semibold">{s.sku}</div>
                                <div className="text-slate-400 max-w-[200px] truncate">{s.productName}</div>
                                <div className="flex gap-3 mt-1">
                                  <span style={{ color:'#a78bfa' }}>Acq: {s.cacAcqScore}</span>
                                  <span style={{ color:'#22c55e' }}>Disc: {s.cacDiscScore}</span>
                                  <span style={{ color:'#f59e0b' }}>LTV: {s.cacLtvScore}</span>
                                  <span style={{ color:'#38bdf8' }}>Vol: {s.cacVolScore}</span>
                                </div>
                                <div className="text-slate-400">New cust: {dec(s.newPct,1)}% · Disc rate: {dec(s.discountRate,1)}%</div>
                                <div className="text-slate-400">Leads to {s.cacFromCount} repeat transitions</div>
                              </div>
                            );
                          }} />
                          <Bar dataKey="cacScore" radius={[0,4,4,0]}>
                            {data.cacReducers.slice(0,12).map((s, i) => (
                              <Cell key={i} fill={
                                s.cacScore >= 75 ? '#22c55e' :
                                s.cacScore >= 55 ? '#f59e0b' :
                                s.cacScore >= 35 ? '#2d7cf6' : '#374151'
                              } />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>

                    <Card>
                      <ST>Score Breakdown — Top 8</ST>
                      <div className="space-y-4">
                        {data.cacReducers.slice(0,8).map(s => (
                          <div key={s.sku}>
                            <div className="flex items-center justify-between mb-1">
                              <div>
                                <span className="font-mono text-[10px] text-slate-300">{s.sku}</span>
                                <span className="ml-2 text-[10px] text-slate-500 truncate">{s.productName.slice(0,30)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                  style={{
                                    background: s.cacScore >= 75 ? '#22c55e22' : s.cacScore >= 55 ? '#f59e0b22' : '#2d7cf622',
                                    color:      s.cacScore >= 75 ? '#22c55e'   : s.cacScore >= 55 ? '#f59e0b'   : '#2d7cf6',
                                  }}>
                                  {s.cacScore} — {s.cacLabel}
                                </span>
                              </div>
                            </div>
                            {/* Stacked score bar */}
                            <div className="flex h-2 rounded-full overflow-hidden gap-px">
                              <div style={{ width:`${s.cacAcqScore/100*100}%`, background:'#a78bfa' }} title={`Acquisition: ${s.cacAcqScore}`} />
                              <div style={{ width:`${s.cacDiscScore/100*100}%`, background:'#22c55e' }} title={`Disc Efficiency: ${s.cacDiscScore}`} />
                              <div style={{ width:`${s.cacLtvScore/100*100}%`, background:'#f59e0b' }} title={`LTV Unlock: ${s.cacLtvScore}`} />
                              <div style={{ width:`${s.cacVolScore/100*100}%`, background:'#38bdf8' }} title={`Volume: ${s.cacVolScore}`} />
                              <div className="flex-1 bg-gray-800" />
                            </div>
                            <div className="flex gap-3 mt-0.5 text-[9px] text-slate-600">
                              <span style={{ color:'#a78bfa88' }}>Acq {s.cacAcqScore}</span>
                              <span style={{ color:'#22c55e88' }}>Disc {s.cacDiscScore}</span>
                              <span style={{ color:'#f59e0b88' }}>LTV {s.cacLtvScore}</span>
                              <span style={{ color:'#38bdf888' }}>Vol {s.cacVolScore}</span>
                              <span className="ml-auto">{dec(s.newPct,0)}% new · {dec(s.discountRate,0)}% disc · {s.cacFromCount} seq</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>

                  {/* Full table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['#','SKU','Product','Score','Label','Acq','Disc','LTV','Vol','New%','Disc%','Seq Leads','Orders','Revenue','AOV'].map(h => (
                            <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.cacReducers.map((s, i) => (
                          <tr key={s.sku} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                            <td className="px-2 py-1.5 text-slate-600 tabular-nums">{i+1}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{s.sku}</td>
                            <td className="px-2 py-1.5 text-slate-400 max-w-[160px] truncate">{s.productName}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-bold text-white">{s.cacScore}</td>
                            <td className="px-2 py-1.5">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                                style={{
                                  background: s.cacScore >= 75 ? '#22c55e22' : s.cacScore >= 55 ? '#f59e0b22' : s.cacScore >= 35 ? '#2d7cf622' : '#37415122',
                                  color:      s.cacScore >= 75 ? '#22c55e'   : s.cacScore >= 55 ? '#f59e0b'   : s.cacScore >= 35 ? '#2d7cf6'   : '#64748b',
                                }}>{s.cacLabel}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color:'#a78bfa' }}>{s.cacAcqScore}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color:'#22c55e' }}>{s.cacDiscScore}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color:'#f59e0b' }}>{s.cacLtvScore}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color:'#38bdf8' }}>{s.cacVolScore}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.newPct,1)}%</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{dec(s.discountRate,1)}%</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(s.cacFromCount)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(s.orders)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-400">{cur(s.revenue)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{cur(s.aov)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                    {data.discList.map((d) => (
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
                    {data.geoList.map((g) => (
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
              WAREHOUSE TAB
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'warehouse' && (() => {
            const wd = data.warehouseData;
            if (!wd?.hasTagData) return (
              <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}>
                <Card>
                  <div className="text-slate-500 text-sm text-center py-6">
                    No order tags found — warehouse analytics requires orders to have Shopify tags.<br/>
                    <span className="text-slate-600 text-xs">Re-fetch orders after tags have been assigned in Shopify.</span>
                  </div>
                </Card>
              </motion.div>
            );

            // Filter to warehouse tags (contain "warehouse", "wh", "hub", "fc", "fulfil") or show all
            const warehouseTags = wd.warehouses.filter(w =>
              /warehouse|wh[\s_-]|hub|fulfil|fulfillment|\bfc\b|center|centre/i.test(w.tag)
            );
            const allWhs = wd.warehouses;
            // Initialise default selection to warehouse-like tags, or all if none
            const displayWhs = (whSelectedTags === null)
              ? allWhs
              : allWhs.filter(w => whSelectedTags.length === 0 || whSelectedTags.includes(w.tag));

            const selectedWh = whDrillTag ? allWhs.find(w => w.tag === whDrillTag) : null;
            const maxOrders  = allWhs[0]?.orders || 1;
            const effColor   = s => s >= 80 ? '#22c55e' : s >= 60 ? '#3b82f6' : s >= 40 ? '#f59e0b' : '#ef4444';

            return (
              <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-5">

                {/* Header + multi-select */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-200">Warehouse Intelligence</h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {allWhs.length} tag{allWhs.length !== 1 ? 's' : ''} · {wd.tagList.length} unique tags detected
                      {warehouseTags.length > 0 && ` · ${warehouseTags.length} warehouse-like`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-w-xl">
                    {/* Quick filter pills */}
                    <button onClick={() => setWhSelectedTags([])}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border ${(whSelectedTags || []).length === 0 ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40' : 'border-gray-700 text-slate-500 hover:text-slate-300'}`}>
                      All ({allWhs.length})
                    </button>
                    {warehouseTags.length > 0 && (
                      <button onClick={() => setWhSelectedTags(warehouseTags.map(w => w.tag))}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border ${JSON.stringify(whSelectedTags) === JSON.stringify(warehouseTags.map(w=>w.tag)) ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'border-gray-700 text-slate-500 hover:text-slate-300'}`}>
                        Warehouses ({warehouseTags.length})
                      </button>
                    )}
                    {allWhs.map(w => (
                      <button key={w.tag}
                        onClick={() => {
                          const cur = whSelectedTags || [];
                          setWhSelectedTags(cur.includes(w.tag) ? cur.filter(t=>t!==w.tag) : [...cur, w.tag]);
                        }}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border ${(whSelectedTags||[]).includes(w.tag) ? 'bg-violet-600/30 text-violet-300 border-violet-500/40' : 'border-gray-700 text-slate-500 hover:text-slate-300'}`}>
                        {w.tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary KPIs for selected tags */}
                {(() => {
                  const shown = displayWhs;
                  const totOrders  = shown.reduce((s,w)=>s+w.orders,0);
                  const totRev     = shown.reduce((s,w)=>s+w.revenue,0);
                  const avgEff     = shown.length ? Math.round(shown.reduce((s,w)=>s+w.effScore,0)/shown.length) : 0;
                  const avgSla     = shown.filter(w=>w.fulfillStats).length
                    ? +(shown.filter(w=>w.fulfillStats).reduce((s,w)=>s+w.fulfillStats.sla24hPct,0)/shown.filter(w=>w.fulfillStats).length).toFixed(1)
                    : null;
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <KPI label="Total Orders"   value={num(totOrders)}  sub={`${shown.length} warehouses`} />
                      <KPI label="Total Revenue"  value={cur(totRev)}     color="#22c55e" />
                      <KPI label="Avg Eff Score"  value={`${avgEff}/100`} color={effColor(avgEff)} />
                      <KPI label="Avg SLA <24h"   value={avgSla !== null ? `${avgSla}%` : '—'} color={avgSla>=80?'#22c55e':avgSla>=50?'#f59e0b':'#ef4444'} />
                    </div>
                  );
                })()}

                {/* Comparison table */}
                <Card className="overflow-x-auto">
                  <div className="flex items-center justify-between mb-3">
                    <ST>Performance Comparison</ST>
                    <ExportBtn onClick={() => exportCSV('warehouse-analytics.csv', displayWhs, [
                      { key:'tag', label:'Warehouse/Tag' },
                      { key:'orders', label:'Orders' },
                      { key:'revenue', label:'Revenue', fn: r => dec(r.revenue,0) },
                      { key:'aov', label:'AOV', fn: r => dec(r.aov,0) },
                      { key:'effScore', label:'Eff Score' },
                      { key:'cancelPct', label:'Cancel%' },
                      { key:'refundPct', label:'Refund%' },
                      { key:'newPct', label:'New Cust%' },
                      { key:'fulfillStats', label:'Avg Ship (h)', fn: r => r.fulfillStats?.avg ?? '' },
                      { key:'fulfillStats', label:'SLA <24h%', fn: r => r.fulfillStats?.sla24hPct ?? '' },
                    ])} />
                  </div>
                  <table className="w-full text-xs min-w-[760px]">
                    <thead>
                      <tr className="border-b border-gray-700">
                        {['Warehouse / Tag','Orders','Revenue','AOV','Eff Score','Avg Ship','SLA <24h','Cancel%','Refund%','New%','SKUs'].map(h => (
                          <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayWhs.map(w => (
                        <tr key={w.tag}
                          onClick={() => setWhDrillTag(whDrillTag === w.tag ? null : w.tag)}
                          className={`border-b border-gray-800/40 cursor-pointer transition-colors ${whDrillTag === w.tag ? 'bg-brand-600/10' : 'hover:bg-gray-800/30'}`}>
                          <td className="px-0 py-2 font-semibold text-slate-200 max-w-[140px] truncate">{w.tag}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500/70 rounded-full" style={{ width:`${w.orders/maxOrders*100}%` }} />
                              </div>
                              <span className="tabular-nums text-slate-300 font-semibold">{num(w.orders)}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 tabular-nums text-emerald-400 font-semibold">{cur(w.revenue)}</td>
                          <td className="px-2 py-2 tabular-nums text-slate-400">{cur(w.aov)}</td>
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                              style={{ background:`${effColor(w.effScore)}22`, color:effColor(w.effScore) }}>
                              {w.effScore}/100 · {w.effLabel}
                            </span>
                          </td>
                          <td className="px-2 py-2 tabular-nums text-slate-400">{w.fulfillStats ? hrs(w.fulfillStats.avg) : '—'}</td>
                          <td className="px-2 py-2">
                            {w.fulfillStats ? (
                              <span className={`tabular-nums font-semibold ${w.fulfillStats.sla24hPct >= 80 ? 'text-emerald-400' : w.fulfillStats.sla24hPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                {w.fulfillStats.sla24hPct}%
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`tabular-nums ${w.cancelPct > 10 ? 'text-red-400' : w.cancelPct > 5 ? 'text-amber-400' : 'text-slate-400'}`}>{w.cancelPct}%</span>
                          </td>
                          <td className="px-2 py-2">
                            <span className={`tabular-nums ${w.refundPct > 10 ? 'text-red-400' : w.refundPct > 5 ? 'text-amber-400' : 'text-slate-400'}`}>{w.refundPct}%</span>
                          </td>
                          <td className="px-2 py-2 tabular-nums text-slate-400">{w.newPct}%</td>
                          <td className="px-2 py-2 tabular-nums text-slate-500">{w.uniqueSkus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                {/* Charts row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card>
                    <ST>Order Volume by Warehouse</ST>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={displayWhs.slice(0,10)} layout="vertical" barSize={14}>
                        <XAxis type="number" tick={{ fill:'#64748b',fontSize:10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="tag" width={110} tick={{ fill:'#94a3b8',fontSize:10 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CT/>} />
                        <Bar dataKey="orders" name="Orders" radius={[0,3,3,0]}>
                          {displayWhs.slice(0,10).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card>
                    <ST>Revenue by Warehouse</ST>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={displayWhs.slice(0,10)} layout="vertical" barSize={14}>
                        <XAxis type="number" tick={{ fill:'#64748b',fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="tag" width={110} tick={{ fill:'#94a3b8',fontSize:10 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CT/>} />
                        <Bar dataKey="revenue" name="Revenue" radius={[0,3,3,0]}>
                          {displayWhs.slice(0,10).map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card>
                    <ST>Efficiency Score</ST>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={displayWhs.slice(0,10)} layout="vertical" barSize={14}>
                        <XAxis type="number" domain={[0,100]} tick={{ fill:'#64748b',fontSize:10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="tag" width={110} tick={{ fill:'#94a3b8',fontSize:10 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CT/>} />
                        <Bar dataKey="effScore" name="Eff Score" radius={[0,3,3,0]}>
                          {displayWhs.slice(0,10).map((w,i)=><Cell key={i} fill={effColor(w.effScore)}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                {/* SKU Consumption + Stock-out Risk per Warehouse */}
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <ST>SKU Consumption & Stock-Out Risk</ST>
                      <p className="text-[10px] text-slate-500 -mt-2">
                        Units sold per warehouse tag · cross-referenced with current inventory
                        {Object.keys(inventoryMap).length === 0 && <span className="text-amber-500 ml-2">⚠ Pull inventory for stock data</span>}
                      </p>
                    </div>
                    <select value={whDrillTag || ''} onChange={e => setWhDrillTag(e.target.value || null)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none">
                      <option value="">All warehouses</option>
                      {displayWhs.map(w => <option key={w.tag} value={w.tag}>{w.tag}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const whs = whDrillTag ? displayWhs.filter(w=>w.tag===whDrillTag) : displayWhs;
                    // Merge SKU quantities across selected warehouses
                    const skuMap = {};
                    whs.forEach(w => {
                      (w.skuList || []).forEach(s => {
                        if (!skuMap[s.sku]) skuMap[s.sku] = { sku: s.sku, name: s.name, qty: 0, revenue: 0, warehouses: [] };
                        skuMap[s.sku].qty     += s.qty;
                        skuMap[s.sku].revenue += s.revenue;
                        skuMap[s.sku].warehouses.push(w.tag);
                      });
                    });
                    const mergedSkus = Object.values(skuMap)
                      .map(s => {
                        const inv = inventoryMap[s.sku];
                        const stock = inv?.stock ?? null;
                        const dailyVel = s.qty / Math.max(data.overview.days || 7, 1);
                        const daysLeft = stock !== null && dailyVel > 0 ? Math.floor(stock / dailyVel) : null;
                        const risk = daysLeft === null ? 'unknown'
                          : daysLeft <= 0 ? 'out'
                          : daysLeft <= 7 ? 'critical'
                          : daysLeft <= 14 ? 'low'
                          : daysLeft <= 30 ? 'watch'
                          : 'ok';
                        return { ...s, stock, dailyVel: +dailyVel.toFixed(1), daysLeft, risk };
                      })
                      .sort((a, b) => {
                        const rOrder = { out:0, critical:1, low:2, watch:3, ok:4, unknown:5 };
                        return (rOrder[a.risk]||5) - (rOrder[b.risk]||5) || b.qty - a.qty;
                      });

                    const riskStyle = {
                      out:      { bg:'#ef444422', color:'#ef4444', label:'OUT OF STOCK' },
                      critical: { bg:'#f9731622', color:'#f97316', label:'CRITICAL' },
                      low:      { bg:'#f59e0b22', color:'#f59e0b', label:'LOW' },
                      watch:    { bg:'#3b82f622', color:'#3b82f6', label:'WATCH' },
                      ok:       { bg:'#22c55e22', color:'#22c55e', label:'OK' },
                      unknown:  { bg:'#64748b22', color:'#64748b', label:'NO INV' },
                    };

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-700">
                              {['SKU','Product','Units Sold','Daily Vel.','Revenue','Stock','Days Left','Risk'].map(h => (
                                <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {mergedSkus.slice(0, 60).map((s, i) => {
                              const rs = riskStyle[s.risk];
                              return (
                                <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                                  <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{s.sku}</td>
                                  <td className="px-2 py-1.5 text-slate-400 max-w-[180px] truncate">{s.name}</td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-300 font-semibold">{num(s.qty)}</td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-400">{s.dailyVel}/day</td>
                                  <td className="px-2 py-1.5 tabular-nums text-emerald-400">{cur(s.revenue)}</td>
                                  <td className="px-2 py-1.5 tabular-nums">
                                    {s.stock === null
                                      ? <span className="text-slate-600">—</span>
                                      : s.stock <= 0
                                        ? <span className="text-red-400 font-bold">0</span>
                                        : <span className={s.stock < 20 ? 'text-amber-400' : 'text-emerald-400'}>{num(s.stock)}</span>
                                    }
                                  </td>
                                  <td className="px-2 py-1.5 tabular-nums">
                                    {s.daysLeft === null
                                      ? <span className="text-slate-600">—</span>
                                      : <span className={s.daysLeft <= 7 ? 'text-red-400 font-bold' : s.daysLeft <= 14 ? 'text-amber-400' : 'text-slate-400'}>
                                          {s.daysLeft}d
                                        </span>
                                    }
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                                      style={{ background: rs.bg, color: rs.color }}>
                                      {rs.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </Card>

                {/* Drill-down: selected warehouse detail */}
                {selectedWh && (
                  <Card>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-white">
                        <span className="text-brand-400">{selectedWh.tag}</span> — Deep Dive
                      </h2>
                      <button onClick={() => setWhDrillTag(null)} className="text-xs text-slate-500 hover:text-slate-300">✕ Close</button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                      <KPI label="Orders"       value={num(selectedWh.orders)}        sub={`${selectedWh.newPct}% new`} />
                      <KPI label="Revenue"      value={cur(selectedWh.revenue)}       sub={`AOV ${cur(selectedWh.aov)}`} color="#22c55e" />
                      <KPI label="Eff Score"    value={`${selectedWh.effScore}/100`}  sub={selectedWh.effLabel} color={effColor(selectedWh.effScore)} />
                      <KPI label="Unique SKUs"  value={num(selectedWh.uniqueSkus)}    sub={`${selectedWh.avgItemsPerOrder} items/order avg`} />
                    </div>
                    {selectedWh.fulfillStats && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                        <KPI label="Avg Ship Time" value={hrs(selectedWh.fulfillStats.avg)}       sub={`p90: ${hrs(selectedWh.fulfillStats.p90)}`} />
                        <KPI label="SLA &lt;24h"   value={`${selectedWh.fulfillStats.sla24hPct}%`} sub={`${num(selectedWh.fulfillStats.under24h)} orders`} color="#22c55e" />
                        <KPI label="Slow &gt;72h"  value={`${selectedWh.fulfillStats.slowPct}%`}   sub={`${num(selectedWh.fulfillStats.over72h)} orders`} color="#ef4444" />
                        <KPI label="Fulfilled"     value={num(selectedWh.fulfillStats.count)}      sub="with timestamps" />
                      </div>
                    )}

                    {selectedWh.byDay.length > 1 && (
                      <div className="mb-5">
                        <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Daily Order Trend</div>
                        <ResponsiveContainer width="100%" height={100}>
                          <LineChart data={selectedWh.byDay}>
                            <XAxis dataKey="date" hide />
                            <Tooltip formatter={(v,n) => [n === 'revenue' ? cur(v) : num(v), n]}
                              contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                            <Line type="monotone" dataKey="orders" stroke="#3b82f6" dot={false} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div className="mb-5">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">
                        Peak Hour: {String(selectedWh.peakHour).padStart(2,'0')}:00
                      </div>
                      <div className="flex items-end gap-0.5 h-12">
                        {selectedWh.hourCounts.map(({ hour, count }) => {
                          const max = Math.max(...selectedWh.hourCounts.map(h => h.count), 1);
                          return (
                            <div key={hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                              <div className="w-full rounded-t-sm transition-all"
                                style={{ height:`${(count/max*100)}%`, minHeight: count > 0 ? 2 : 0,
                                  background: hour === selectedWh.peakHour ? '#3b82f6' : '#374151' }} />
                              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 whitespace-nowrap z-10">
                                {String(hour).padStart(2,'0')}:00 — {num(count)} orders
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-700 mt-1">
                        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Fulfillment Status</div>
                        <div className="space-y-1">
                          {selectedWh.fulfillStatuses.map(({ status, count: c }) => (
                            <div key={status} className="flex items-center gap-2 text-xs">
                              <span className="w-24 truncate capitalize text-slate-400">{status.replace(/_/g,' ')}</span>
                              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-blue-500/60" style={{ width:`${c/selectedWh.orders*100}%` }} />
                              </div>
                              <span className="w-8 text-right tabular-nums text-slate-500">{num(c)}</span>
                              <span className="w-10 text-right tabular-nums text-slate-600">{dec(c/selectedWh.orders*100,1)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Top SKUs from this Warehouse</div>
                        <div className="space-y-1">
                          {(selectedWh.skuList || []).slice(0, 8).map((s, i) => {
                            const maxQ = selectedWh.skuList[0]?.qty || 1;
                            return (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-[10px] text-slate-400 w-20 truncate">{s.sku}</span>
                                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-violet-500/60" style={{ width:`${s.qty/maxQ*100}%` }} />
                                </div>
                                <span className="w-10 text-right tabular-nums text-slate-500">{num(s.qty)} u</span>
                                <span className="w-16 text-right tabular-nums text-emerald-400">{cur(s.revenue)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

              </motion.div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════════
              TAGS TAB
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'tags' && (() => {
            const wd = data.warehouseData;
            if (!wd?.hasTagData) return (
              <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}>
                <Card>
                  <div className="text-slate-500 text-sm text-center py-6">
                    No order tags found. Tags are set in Shopify per-order and are used here for segmentation.
                  </div>
                </Card>
              </motion.div>
            );

            const allTags = wd.warehouses; // each "warehouse" is a tag segment
            const filteredTagList = tagSearch
              ? allTags.filter(t => t.tag.toLowerCase().includes(tagSearch.toLowerCase()))
              : allTags;
            const compTags = selectedTags.length > 0
              ? allTags.filter(t => selectedTags.includes(t.tag))
              : allTags.slice(0, 8);

            const maxTagOrders = allTags[0]?.orders || 1;

            return (
              <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-5">

                {/* Tag multiselect */}
                <Card>
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <ST>Tag Selector</ST>
                    <input value={tagSearch} onChange={e => setTagSearch(e.target.value)}
                      placeholder="Search tags..."
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none w-48" />
                    <button onClick={() => setSelectedTags([])} className="text-[10px] text-slate-500 hover:text-slate-300">Clear</button>
                    <span className="text-[10px] text-slate-600">{selectedTags.length > 0 ? `${selectedTags.length} selected` : 'Showing top 8 (select to compare)'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredTagList.map(t => (
                      <button key={t.tag}
                        onClick={() => setSelectedTags(prev => prev.includes(t.tag) ? prev.filter(x=>x!==t.tag) : [...prev, t.tag])}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border ${selectedTags.includes(t.tag) ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40' : 'border-gray-700 text-slate-500 hover:text-slate-300 hover:border-gray-500'}`}>
                        {t.tag}
                        <span className="text-[9px] opacity-60">{t.orders}</span>
                      </button>
                    ))}
                  </div>
                </Card>

                {/* KPI summary of selected tags */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(() => {
                    const sel = compTags;
                    return [
                      { label:'Tags Compared', value: num(sel.length) },
                      { label:'Total Orders',  value: num(sel.reduce((s,t)=>s+t.orders,0)) },
                      { label:'Total Revenue', value: cur(sel.reduce((s,t)=>s+t.revenue,0)), color:'#22c55e' },
                      { label:'Avg AOV',       value: cur(sel.length ? sel.reduce((s,t)=>s+t.aov,0)/sel.length : 0) },
                    ].map(k => <KPI key={k.label} {...k} />);
                  })()}
                </div>

                {/* Comparison bar chart — orders */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <Card>
                    <ST>Orders by Tag</ST>
                    <ResponsiveContainer width="100%" height={Math.max(180, compTags.length * 28)}>
                      <BarChart data={compTags} layout="vertical" barSize={14}>
                        <XAxis type="number" tick={{ fill:'#64748b',fontSize:10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="tag" width={120} tick={{ fill:'#94a3b8',fontSize:9 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CT/>} />
                        <Bar dataKey="orders" name="Orders" radius={[0,3,3,0]}>
                          {compTags.map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card>
                    <ST>Revenue by Tag</ST>
                    <ResponsiveContainer width="100%" height={Math.max(180, compTags.length * 28)}>
                      <BarChart data={compTags} layout="vertical" barSize={14}>
                        <XAxis type="number" tick={{ fill:'#64748b',fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="tag" width={120} tick={{ fill:'#94a3b8',fontSize:9 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<CT/>} />
                        <Bar dataKey="revenue" name="Revenue" radius={[0,3,3,0]}>
                          {compTags.map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>

                {/* Multi-metric comparison bars */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <Card>
                    <ST>Cancel Rate by Tag</ST>
                    <div className="space-y-2">
                      {compTags.sort((a,b)=>b.cancelPct-a.cancelPct).map((t,i)=>(
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-24 truncate text-slate-400">{t.tag}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${Math.min(t.cancelPct,30)/30*100}%`, background: t.cancelPct>10?'#ef4444':t.cancelPct>5?'#f59e0b':'#22c55e' }} />
                          </div>
                          <span className="w-10 text-right tabular-nums text-slate-400">{t.cancelPct}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card>
                    <ST>Refund Rate by Tag</ST>
                    <div className="space-y-2">
                      {compTags.sort((a,b)=>b.refundPct-a.refundPct).map((t,i)=>(
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-24 truncate text-slate-400">{t.tag}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${Math.min(t.refundPct,20)/20*100}%`, background: t.refundPct>10?'#ef4444':t.refundPct>5?'#f59e0b':'#22c55e' }} />
                          </div>
                          <span className="w-10 text-right tabular-nums text-slate-400">{t.refundPct}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card>
                    <ST>New Customer % by Tag</ST>
                    <div className="space-y-2">
                      {compTags.sort((a,b)=>b.newPct-a.newPct).map((t,i)=>(
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-24 truncate text-slate-400">{t.tag}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500/70" style={{ width:`${t.newPct}%` }} />
                          </div>
                          <span className="w-10 text-right tabular-nums text-blue-400">{t.newPct}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Tag-level detail table */}
                <Card className="overflow-x-auto">
                  <div className="flex items-center justify-between mb-3">
                    <ST>Full Tag Analytics</ST>
                    <ExportBtn onClick={() => exportCSV('tag-analytics.csv', compTags, [
                      { key:'tag', label:'Tag' },
                      { key:'orders', label:'Orders' },
                      { key:'revenue', label:'Revenue', fn: r => dec(r.revenue,0) },
                      { key:'aov', label:'AOV', fn: r => dec(r.aov,0) },
                      { key:'newPct', label:'New Cust%' },
                      { key:'cancelPct', label:'Cancel%' },
                      { key:'refundPct', label:'Refund%' },
                      { key:'discountPct', label:'Discount%' },
                      { key:'effScore', label:'Eff Score' },
                    ])} />
                  </div>
                  <table className="w-full text-xs min-w-[700px]">
                    <thead>
                      <tr className="border-b border-gray-700">
                        {['Tag','Orders','Revenue','AOV','New%','Cancel%','Refund%','Disc%','Avg Disc','Multi-item%'].map(h => (
                          <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTagList.map((t, i) => (
                        <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-shrink-0 w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500/60 rounded-full" style={{ width:`${t.orders/maxTagOrders*100}%` }} />
                              </div>
                              <span className="font-semibold text-slate-200 truncate max-w-[120px]">{t.tag}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-300 font-semibold">{num(t.orders)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-emerald-400">{cur(t.revenue)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-400">{cur(t.aov)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-blue-400">{t.newPct}%</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            <span className={t.cancelPct>10?'text-red-400':t.cancelPct>5?'text-amber-400':'text-slate-400'}>{t.cancelPct}%</span>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            <span className={t.refundPct>10?'text-red-400':t.refundPct>5?'text-amber-400':'text-slate-400'}>{t.refundPct}%</span>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-400">{t.discountPct}%</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-400">{cur(t.avgDiscount)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-400">{t.multiItemPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

              </motion.div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════════
              OPERATIONS
          ═══════════════════════════════════════════════════════════ */}
          {tab === 'ops' && (
            <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} className="space-y-6">

              {/* ── Global fulfillment KPIs ── */}
              {data.fulfillStats && (
                <div>
                  <ST>Overall Fulfillment Velocity</ST>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KPI label="Avg Time to Ship"  value={hrs(data.fulfillStats.avg)}    sub={`median ${hrs(data.fulfillStats.median)}`} />
                    <KPI label="p90 Time to Ship"  value={hrs(data.fulfillStats.p90)}    sub="90th percentile" />
                    <KPI label="Shipped &lt;24h"  value={pct(data.fulfillStats.under24h / data.fulfillStats.count * 100)} sub={`${num(data.fulfillStats.under24h)} orders`} color="#22c55e" />
                    <KPI label="Shipped &gt;72h"  value={num(data.fulfillStats.over72h)} sub="slow orders" color="#ef4444" />
                  </div>
                </div>
              )}

              {/* ── Warehouse Intelligence ── */}
              {(() => {
                const wd = data.warehouseData;
                if (!wd?.hasTagData) return (
                  <Card>
                    <div className="text-slate-500 text-sm text-center py-6">
                      No order tags found — warehouse analytics requires orders to have Shopify tags.<br/>
                      <span className="text-slate-600 text-xs">Re-fetch orders after tags have been assigned in Shopify.</span>
                    </div>
                  </Card>
                );

                const whs = wd.warehouses;
                const selectedWh = whFilter ? whs.find(w => w.tag === whFilter) : null;
                const maxOrders  = whs[0]?.orders || 1;

                const effColor = s => s >= 80 ? '#22c55e' : s >= 60 ? '#3b82f6' : s >= 40 ? '#f59e0b' : '#ef4444';

                return (
                  <>
                    {/* Header + filter */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-200">Warehouse Intelligence</h2>
                        <p className="text-[10px] text-slate-500 mt-0.5">{whs.length} tag{whs.length !== 1 ? 's' : ''} detected across {num(data.overview.orders + data.overview.cancelledCount)} orders</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <ExportBtn onClick={() => exportCSV('warehouse-analytics.csv', whs, [
                          { key:'tag', label:'Warehouse/Tag' },
                          { key:'orders', label:'Orders' },
                          { key:'revenue', label:'Revenue', fn: r => dec(r.revenue,0) },
                          { key:'aov', label:'AOV', fn: r => dec(r.aov,0) },
                          { key:'cancelPct', label:'Cancel%' },
                          { key:'refundPct', label:'Refund%' },
                          { key:'newPct', label:'New Cust%' },
                          { key:'effScore', label:'Eff Score' },
                          { key:'fulfillStats', label:'Avg Ship (h)', fn: r => r.fulfillStats?.avg ?? '' },
                          { key:'fulfillStats', label:'SLA <24h%', fn: r => r.fulfillStats?.sla24hPct ?? '' },
                        ])} />
                        <select value={whFilter || ''} onChange={e => setWhFilter(e.target.value || null)}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-brand-500">
                          <option value="">All warehouses</option>
                          {whs.map(w => <option key={w.tag} value={w.tag}>{w.tag}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Performance comparison table */}
                    <Card className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[700px]">
                        <thead>
                          <tr className="border-b border-gray-700">
                            {['Warehouse / Tag','Orders','Revenue','AOV','Eff Score','Avg Ship','SLA <24h','Cancel%','Refund%','New%'].map(h => (
                              <th key={h} className="text-left px-2 py-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(whFilter ? [selectedWh].filter(Boolean) : whs).map(w => (
                            <tr key={w.tag}
                              onClick={() => setWhFilter(whFilter === w.tag ? null : w.tag)}
                              className={`border-b border-gray-800/40 cursor-pointer transition-colors ${whFilter === w.tag ? 'bg-brand-600/10' : 'hover:bg-gray-800/30'}`}>
                              <td className="px-0 py-2 font-semibold text-slate-200 max-w-[140px] truncate">{w.tag}</td>
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500/70 rounded-full" style={{ width:`${w.orders/maxOrders*100}%` }} />
                                  </div>
                                  <span className="tabular-nums text-slate-300 font-semibold">{num(w.orders)}</span>
                                </div>
                              </td>
                              <td className="px-2 py-2 tabular-nums text-emerald-400 font-semibold">{cur(w.revenue)}</td>
                              <td className="px-2 py-2 tabular-nums text-slate-400">{cur(w.aov)}</td>
                              <td className="px-2 py-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                                  style={{ background:`${effColor(w.effScore)}22`, color:effColor(w.effScore) }}>
                                  {w.effScore}/100 · {w.effLabel}
                                </span>
                              </td>
                              <td className="px-2 py-2 tabular-nums text-slate-400">{w.fulfillStats ? hrs(w.fulfillStats.avg) : '—'}</td>
                              <td className="px-2 py-2">
                                {w.fulfillStats ? (
                                  <span className={`tabular-nums font-semibold ${w.fulfillStats.sla24hPct >= 80 ? 'text-emerald-400' : w.fulfillStats.sla24hPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {w.fulfillStats.sla24hPct}%
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-2 py-2">
                                <span className={`tabular-nums ${w.cancelPct > 10 ? 'text-red-400' : w.cancelPct > 5 ? 'text-amber-400' : 'text-slate-400'}`}>{w.cancelPct}%</span>
                              </td>
                              <td className="px-2 py-2">
                                <span className={`tabular-nums ${w.refundPct > 10 ? 'text-red-400' : w.refundPct > 5 ? 'text-amber-400' : 'text-slate-400'}`}>{w.refundPct}%</span>
                              </td>
                              <td className="px-2 py-2 tabular-nums text-slate-400">{w.newPct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>

                    {/* Charts row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                      {/* Avg fulfillment time per warehouse */}
                      <Card>
                        <ST>Avg Time to Ship by Warehouse (hours)</ST>
                        {whs.some(w => w.fulfillStats) ? (
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={whs.filter(w => w.fulfillStats).slice(0,12)}
                              layout="vertical" margin={{ left:8, right:24, top:4, bottom:4 }}>
                              <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} />
                              <YAxis type="category" dataKey="tag" width={90} tick={{ fill:'#94a3b8', fontSize:10 }} />
                              <Tooltip formatter={(v) => [`${dec(v,1)}h`, 'Avg Ship']}
                                contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                              <Bar dataKey="fulfillStats.avg" name="Avg Ship (h)" radius={[0,4,4,0]}>
                                {whs.filter(w => w.fulfillStats).slice(0,12).map((w) => (
                                  <Cell key={w.tag} fill={w.fulfillStats.avg <= 24 ? '#22c55e' : w.fulfillStats.avg <= 48 ? '#f59e0b' : '#ef4444'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="text-slate-600 text-xs py-8 text-center">No fulfillment timestamps available</div>}
                      </Card>

                      {/* SLA compliance (% shipped <24h) */}
                      <Card>
                        <ST>SLA Compliance — Shipped &lt;24h (%)</ST>
                        {whs.some(w => w.fulfillStats) ? (
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={whs.filter(w => w.fulfillStats).slice(0,12)}
                              layout="vertical" margin={{ left:8, right:24, top:4, bottom:4 }}>
                              <XAxis type="number" domain={[0,100]} tick={{ fill:'#64748b', fontSize:10 }} />
                              <YAxis type="category" dataKey="tag" width={90} tick={{ fill:'#94a3b8', fontSize:10 }} />
                              <Tooltip formatter={(v) => [`${v}%`, 'SLA <24h']}
                                contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                              <Bar dataKey="fulfillStats.sla24hPct" name="SLA <24h%" radius={[0,4,4,0]}>
                                {whs.filter(w => w.fulfillStats).slice(0,12).map(w => (
                                  <Cell key={w.tag} fill={w.fulfillStats.sla24hPct >= 80 ? '#22c55e' : w.fulfillStats.sla24hPct >= 50 ? '#f59e0b' : '#ef4444'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="text-slate-600 text-xs py-8 text-center">No fulfillment timestamps available</div>}
                      </Card>

                      {/* Order volume by warehouse */}
                      <Card>
                        <ST>Order Volume by Warehouse</ST>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={whs.slice(0,12)} layout="vertical" margin={{ left:8, right:24, top:4, bottom:4 }}>
                            <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} />
                            <YAxis type="category" dataKey="tag" width={90} tick={{ fill:'#94a3b8', fontSize:10 }} />
                            <Tooltip contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                            <Bar dataKey="orders" name="Orders" radius={[0,4,4,0]}>
                              {whs.slice(0,12).map((w,i) => <Cell key={w.tag} fill={C[i%C.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>

                      {/* Revenue by warehouse */}
                      <Card>
                        <ST>Revenue by Warehouse</ST>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={whs.slice(0,12)} layout="vertical" margin={{ left:8, right:24, top:4, bottom:4 }}>
                            <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                            <YAxis type="category" dataKey="tag" width={90} tick={{ fill:'#94a3b8', fontSize:10 }} />
                            <Tooltip formatter={v => [cur(v), 'Revenue']}
                              contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                            <Bar dataKey="revenue" name="Revenue" radius={[0,4,4,0]}>
                              {whs.slice(0,12).map((w,i) => <Cell key={w.tag} fill={C[i%C.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>
                    </div>

                    {/* Drill-down: selected warehouse detail */}
                    {selectedWh && (
                      <Card>
                        <div className="flex items-center justify-between mb-4">
                          <h2 className="text-sm font-semibold text-white">
                            <span className="text-brand-400">{selectedWh.tag}</span> — Deep Dive
                          </h2>
                          <button onClick={() => setWhFilter(null)} className="text-xs text-slate-500 hover:text-slate-300">✕ Close</button>
                        </div>

                        {/* KPI row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                          <KPI label="Orders"       value={num(selectedWh.orders)}        sub={`${selectedWh.newPct}% new customers`} />
                          <KPI label="Revenue"      value={cur(selectedWh.revenue)}       sub={`AOV ${cur(selectedWh.aov)}`} color="#22c55e" />
                          <KPI label="Eff Score"    value={`${selectedWh.effScore}/100`}  sub={selectedWh.effLabel} color={effColor(selectedWh.effScore)} />
                          <KPI label="Unique SKUs"  value={num(selectedWh.uniqueSkus)}    sub={`${selectedWh.avgItemsPerOrder} items/order avg`} />
                        </div>
                        {selectedWh.fulfillStats && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                            <KPI label="Avg Ship Time" value={hrs(selectedWh.fulfillStats.avg)}       sub={`p90: ${hrs(selectedWh.fulfillStats.p90)}`} />
                            <KPI label="SLA &lt;24h"   value={`${selectedWh.fulfillStats.sla24hPct}%`} sub={`${num(selectedWh.fulfillStats.under24h)} orders`} color="#22c55e" />
                            <KPI label="Slow &gt;72h"  value={`${selectedWh.fulfillStats.slowPct}%`}   sub={`${num(selectedWh.fulfillStats.over72h)} orders`} color="#ef4444" />
                            <KPI label="Fulfilled"     value={num(selectedWh.fulfillStats.count)}      sub="with timestamps" />
                          </div>
                        )}

                        {/* Daily trend */}
                        {selectedWh.byDay.length > 1 && (
                          <div className="mb-5">
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Daily Order Trend</div>
                            <ResponsiveContainer width="100%" height={100}>
                              <LineChart data={selectedWh.byDay}>
                                <XAxis dataKey="date" hide />
                                <Tooltip formatter={(v,n) => [n === 'revenue' ? cur(v) : num(v), n]}
                                  contentStyle={{ background:'#111827', border:'1px solid #374151', borderRadius:8, fontSize:11 }} />
                                <Line type="monotone" dataKey="orders" stroke="#3b82f6" dot={false} strokeWidth={2} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Hourly pattern */}
                        <div className="mb-5">
                          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">
                            Order Pattern by Hour (peak: {String(selectedWh.peakHour).padStart(2,'0')}:00)
                          </div>
                          <div className="flex items-end gap-0.5 h-12">
                            {selectedWh.hourCounts.map(({ hour, count }) => {
                              const max = Math.max(...selectedWh.hourCounts.map(h => h.count), 1);
                              return (
                                <div key={hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                                  <div className="w-full rounded-t-sm transition-all"
                                    style={{ height:`${(count/max*100)}%`, minHeight: count > 0 ? 2 : 0,
                                      background: hour === selectedWh.peakHour ? '#3b82f6' : '#374151' }} />
                                  <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 whitespace-nowrap z-10">
                                    {String(hour).padStart(2,'0')}:00 — {num(count)} orders
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-700 mt-1">
                            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                          </div>
                        </div>

                        {/* Status breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Fulfillment Status</div>
                            <div className="space-y-1">
                              {selectedWh.fulfillStatuses.map(({ status, count: c }) => (
                                <div key={status} className="flex items-center gap-2 text-xs">
                                  <span className="w-24 truncate capitalize text-slate-400">{status.replace(/_/g,' ')}</span>
                                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-blue-500/60" style={{ width:`${c/selectedWh.orders*100}%` }} />
                                  </div>
                                  <span className="w-8 text-right tabular-nums text-slate-500">{num(c)}</span>
                                  <span className="w-10 text-right tabular-nums text-slate-600">{dec(c/selectedWh.orders*100,1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Financial Status</div>
                            <div className="space-y-1">
                              {selectedWh.financialStatuses.map(({ status, count: c }) => (
                                <div key={status} className="flex items-center gap-2 text-xs">
                                  <span className="w-24 truncate capitalize text-slate-400">{status.replace(/_/g,' ')}</span>
                                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width:`${c/selectedWh.orders*100}%` }} />
                                  </div>
                                  <span className="w-8 text-right tabular-nums text-slate-500">{num(c)}</span>
                                  <span className="w-10 text-right tabular-nums text-slate-600">{dec(c/selectedWh.orders*100,1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* All tags pill list */}
                    {!whFilter && wd.tagList.length > 0 && (
                      <div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">All Tags Detected ({wd.tagList.length})</div>
                        <div className="flex flex-wrap gap-1.5">
                          {wd.tagList.map(t => (
                            <button key={t} onClick={() => setWhFilter(t)}
                              className="px-2 py-0.5 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-[10px] text-slate-400 hover:text-slate-200 transition-all">
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

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
