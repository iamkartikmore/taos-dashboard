import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  ShoppingBag, TrendingUp, Users, Tag, RefreshCw,
  AlertTriangle, ChevronDown, ChevronUp, Package,
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
  { id: 'last_month', label: 'Last Month' },
  { id: 'custom',     label: 'Custom' },
];

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'skus',       label: 'SKU Deep Dive' },
  { id: 'customers',  label: 'Customers / RFM' },
  { id: 'discounts',  label: 'Discounts' },
  { id: 'geo',        label: 'Geo' },
  { id: 'crosssell',  label: 'Cross-sell' },
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

const C = ['#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa'];

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const cur  = n => `₹${parseFloat(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
const num  = n => parseFloat(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const pct  = n => `${parseFloat(n||0).toFixed(1)}%`;
const dec  = (n,d=1) => parseFloat(n||0).toFixed(d);

/* ─── SMALL COMPONENTS ───────────────────────────────────────────── */

function KPI({ label, value, sub, color = '#2d7cf6' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="text-sm font-semibold text-white mb-3">{children}</h2>;
}

function CT({ active, payload }) {
  if (!active||!payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl">
      {payload.map((p,i) => <div key={i} className="text-slate-300">{p.name}: <strong className="text-white">{
        p.name?.includes('Revenue') || p.name?.includes('AOV') || p.name?.includes('Discount') ? cur(p.value) : num(p.value)
      }</strong></div>)}
      {d?.date && <div className="text-slate-500">{d.date}</div>}
    </div>
  );
}

/* ─── PAGE ───────────────────────────────────────────────────────── */

export default function ShopifyOrders() {
  const { config, shopifyOrders, shopifyOrdersStatus, shopifyOrdersWindow, setShopifyOrders, setShopifyOrdersStatus, inventoryMap } = useStore();

  const [window, setWindow]       = useState(shopifyOrdersWindow || '7d');
  const [customSince, setCSince]  = useState('');
  const [customUntil, setCUntil]  = useState('');
  const [tab, setTab]             = useState('overview');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [skuSort, setSkuSort]     = useState('revenue');
  const [skuSearch, setSkuSearch] = useState('');
  const [showAllCust, setShowAllCust] = useState(false);

  const canFetch = config.shopifyShop && config.shopifyClientId && config.shopifyClientSecret;

  const handleFetch = async () => {
    if (!canFetch) return;
    setLoading(true); setError(null);
    setShopifyOrdersStatus('loading');
    try {
      const { since, until } = getWindowDates(window, customSince, customUntil);
      const orders = await fetchShopifyOrders(
        config.shopifyShop, config.shopifyClientId, config.shopifyClientSecret,
        since, until,
      );
      setShopifyOrders(orders, window);
    } catch (e) {
      setError(e.message);
      setShopifyOrdersStatus('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const data = useMemo(
    () => shopifyOrders.length ? processShopifyOrders(shopifyOrders, inventoryMap) : null,
    [shopifyOrders, inventoryMap],
  );

  const filteredSkus = useMemo(() => {
    if (!data?.skuList) return [];
    const list = skuSearch
      ? data.skuList.filter(s => s.sku.includes(skuSearch.toUpperCase()) || s.name.toLowerCase().includes(skuSearch.toLowerCase()))
      : data.skuList;
    return [...list].sort((a, b) => {
      const fields = { revenue: 'revenue', units: 'units', aov: 'aov', discountRate: 'discountRate', refundRate: 'refundRate', daysRunway: 'daysRunway', newPct: 'newPct', dailyUnits: 'dailyUnits' };
      const f = fields[skuSort] || 'revenue';
      if (skuSort === 'daysRunway') {
        if (a[f] === null) return 1; if (b[f] === null) return -1;
        return a[f] - b[f]; // ascending for runway (lower = more urgent)
      }
      return (b[f]||0) - (a[f]||0);
    });
  }, [data, skuSort, skuSearch]);

  /* ── Empty / not configured ─────────────────────────────────── */
  if (!canFetch) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <ShoppingBag size={36} className="opacity-30" />
      <p className="text-sm">Add Shopify credentials in Study Manual → API Credentials first.</p>
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Header + fetch controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-emerald-500/20">
            <ShoppingBag size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Shopify Analytics</h1>
            {data && <p className="text-[11px] text-slate-500">{num(data.overview.orders)} orders · {shopifyOrdersWindow?.toUpperCase()} window</p>}
          </div>
        </div>

        {/* Window selector */}
        <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl ml-auto flex-wrap">
          {WINDOWS.map(w => (
            <button key={w.id} onClick={() => setWindow(w.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                window === w.id ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}>{w.label}</button>
          ))}
        </div>

        {window === 'custom' && (
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
      </div>

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
          {/* Tab nav */}
          <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit flex-wrap">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}>{t.label}</button>
            ))}
          </div>

          {/* ── OVERVIEW ─────────────────────────────────────────── */}
          {tab === 'overview' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                <KPI label="Orders"          value={num(data.overview.orders)}              sub={`${dec(data.overview.dailyOrders)}/day`} />
                <KPI label="Revenue"         value={cur(data.overview.revenue)}             sub={`${cur(data.overview.dailyRevenue)}/day`} />
                <KPI label="AOV"             value={cur(data.overview.aov)}                 />
                <KPI label="Unique Customers" value={num(data.overview.uniqueCustomers)}    sub={`${pct(data.overview.newCustomerPct)} new`} />
                <KPI label="Repeat Rev %"    value={pct(data.overview.repeatRevenuePct)}    sub="revenue from returning customers" />
                <KPI label="Discount Rate"   value={pct(data.overview.discountRate)}        sub={`${pct(data.overview.discountedOrderPct)} orders discounted`} />
                <KPI label="Refund Rate"     value={pct(data.overview.refundRate)}          sub={`${num(data.overview.refundedOrders)} orders`} />
                <KPI label="Items/Order"     value={dec(data.overview.avgItemsPerOrder)}    />
              </div>

              {/* Daily trend */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <SectionTitle>Daily Revenue + Orders</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.dailyTrend}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                    <Tooltip content={<CT />} />
                    <Legend wrapperStyle={{ fontSize:11, color:'#94a3b8' }} />
                    <Line yAxisId="l" type="monotone" dataKey="revenue" name="Revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="orders"  name="Orders"  stroke="#2d7cf6" strokeWidth={2} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="newOrders" name="New Cust Orders" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* Hourly */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>Orders by Hour of Day</SectionTitle>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data.hourlyData} barSize={10}>
                      <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:9 }} tickLine={false} interval={2} />
                      <YAxis tick={{ fill:'#64748b', fontSize:10 }} tickLine={false} />
                      <Tooltip content={<CT />} />
                      <Bar dataKey="orders" name="Orders" fill="#2d7cf6" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Source */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>Revenue by Source</SectionTitle>
                  <div className="space-y-2 mt-2">
                    {data.srcList.slice(0,8).map((s,i) => {
                      const max = data.srcList[0]?.revenue || 1;
                      return (
                        <div key={s.source} className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400 w-20 truncate capitalize">{s.source}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${s.revenue/max*100}%`, background: C[i%C.length] }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-20 text-right tabular-nums">{cur(s.revenue)}</span>
                          <span className="text-[10px] text-slate-600 w-8 text-right tabular-nums">{s.orders}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── SKU DEEP DIVE ─────────────────────────────────────── */}
          {tab === 'skus' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <input type="text" value={skuSearch} onChange={e => setSkuSearch(e.target.value)}
                  placeholder="Search SKU / name..."
                  className="w-52 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
                  {[
                    { id:'revenue',    label:'Revenue' },
                    { id:'units',      label:'Units' },
                    { id:'aov',        label:'AOV' },
                    { id:'dailyUnits', label:'Velocity' },
                    { id:'daysRunway', label:'Runway↑' },
                    { id:'discountRate', label:'Disc%' },
                    { id:'refundRate', label:'Refund%' },
                    { id:'newPct',     label:'New%' },
                  ].map(s => (
                    <button key={s.id} onClick={() => setSkuSort(s.id)}
                      className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${skuSort===s.id ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-600">{filteredSkus.length} SKUs</span>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['SKU','Product','Stock','Runway','Vel/Day','Revenue','Units','Orders','AOV','Disc%','Refund%','New%','Repeat%'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSkus.map((s, i) => (
                        <tr key={s.sku} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                          <td className="px-3 py-2 font-mono text-[10px] text-slate-400 whitespace-nowrap">{s.sku}</td>
                          <td className="px-3 py-2 text-slate-200 max-w-[160px] truncate" title={s.productName}>{s.productName}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {s.stock === null ? <span className="text-slate-700">—</span>
                              : s.stock <= 0 ? <span className="text-red-400 font-bold">Out</span>
                              : <span className={s.stock < 20 ? 'text-amber-400' : 'text-emerald-400'}>{s.stock}</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {s.daysRunway === null ? <span className="text-slate-700">—</span>
                              : s.daysRunway <= 3 ? <span className="text-red-400 font-bold">{s.daysRunway}d</span>
                              : s.daysRunway <= 14 ? <span className="text-amber-400">{s.daysRunway}d</span>
                              : <span className="text-slate-400">{s.daysRunway}d</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-300">{dec(s.dailyUnits,2)}</td>
                          <td className="px-3 py-2 tabular-nums font-semibold text-white">{cur(s.revenue)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-300">{num(s.units)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{s.orders}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-300">{cur(s.aov)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            <span className={s.discountRate > 15 ? 'text-red-400' : s.discountRate > 8 ? 'text-amber-400' : 'text-slate-400'}>
                              {pct(s.discountRate)}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            <span className={s.refundRate > 5 ? 'text-red-400' : 'text-slate-400'}>{pct(s.refundRate)}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{pct(s.newPct)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{pct(100 - s.newPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── CUSTOMERS / RFM ──────────────────────────────────── */}
          {tab === 'customers' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-5">

              {/* RFM segments */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>RFM Segments</SectionTitle>
                  <div className="space-y-2">
                    {data.segments.map(s => {
                      const max = data.segments[0]?.count || 1;
                      const color = SEG_COLORS[s.segment] || '#64748b';
                      return (
                        <div key={s.segment}>
                          <div className="flex items-center justify-between text-[11px] mb-0.5">
                            <span className="font-semibold" style={{ color }}>{s.segment}</span>
                            <div className="flex gap-3 text-slate-500">
                              <span>{num(s.count)} cust</span>
                              <span>{cur(s.avgLTV)} avg LTV</span>
                            </div>
                          </div>
                          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${s.count/max*100}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>Segment Revenue Split</SectionTitle>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.segments} layout="vertical" margin={{ right:60 }}>
                      <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="segment" width={110} tick={{ fill:'#94a3b8', fontSize:10 }} />
                      <Tooltip formatter={(v,n) => n==='Avg LTV' ? cur(v) : cur(v)} />
                      <Bar dataKey="revenue" name="Total LTV" radius={[0,4,4,0]}>
                        {data.segments.map(s => <Cell key={s.segment} fill={SEG_COLORS[s.segment]||'#64748b'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top customers table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Top Customers (by window revenue)</h2>
                  <button onClick={() => setShowAllCust(s => !s)} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
                    {showAllCust ? <ChevronUp size={12}/> : <ChevronDown size={12}/>} {showAllCust ? 'Show less' : 'Show all 50'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Customer','Segment','R','F','M','Orders (window)','Rev (window)','Lifetime Orders','Lifetime Rev','Last Order'].map(h=>(
                          <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllCust ? data.topCustomers : data.topCustomers.slice(0,20)).map((c,i) => (
                        <tr key={c.id} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                          <td className="px-3 py-2">
                            <div className="text-slate-200 font-medium">{c.firstName} {c.lastName}</div>
                            <div className="text-[9px] text-slate-600">{c.email}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background:(SEG_COLORS[c.segment]||'#64748b')+'22', color: SEG_COLORS[c.segment]||'#64748b' }}>
                              {c.segment}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-bold text-center" style={{ color: ['#ef4444','#f97316','#f59e0b','#34d399','#22c55e'][c.rScore-1]||'#94a3b8' }}>{c.rScore}</td>
                          <td className="px-3 py-2 font-bold text-center" style={{ color: ['#ef4444','#f97316','#f59e0b','#34d399','#22c55e'][c.fScore-1]||'#94a3b8' }}>{c.fScore}</td>
                          <td className="px-3 py-2 font-bold text-center" style={{ color: ['#ef4444','#f97316','#f59e0b','#34d399','#22c55e'][c.mScore-1]||'#94a3b8' }}>{c.mScore}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-300">{c.ordersInWindow}</td>
                          <td className="px-3 py-2 tabular-nums font-semibold text-white">{cur(c.revenueInWindow)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{c.lifetimeOrders}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{cur(c.lifetimeRevenue)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-500">{c.lastOrderDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── DISCOUNTS ─────────────────────────────────────────── */}
          {tab === 'discounts' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KPI label="Total Discount Given"  value={cur(data.overview.discount)} />
                <KPI label="Discount Rate"         value={pct(data.overview.discountRate)} sub="of gross revenue" />
                <KPI label="Orders with Discount"  value={pct(data.overview.discountedOrderPct)} />
                <KPI label="Unique Codes Used"     value={data.discList.length} />
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800">
                  <h2 className="text-sm font-semibold text-white">Discount Code Performance</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Code','Uses','Gross Revenue','Discount Given','Disc Rate','Avg Disc/Order','Unique Orders'].map(h=>(
                          <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.discList.map((d,i) => (
                        <tr key={d.code} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-200">{d.code}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{d.uses}</td>
                          <td className="px-3 py-2 tabular-nums text-white font-semibold">{cur(d.grossRevenue)}</td>
                          <td className="px-3 py-2 tabular-nums text-red-400">{cur(d.discountTotal)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            <span className={d.discountRate>20?'text-red-400':d.discountRate>10?'text-amber-400':'text-slate-400'}>{pct(d.discountRate)}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{cur(d.avgDisc)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-400">{d.uniqueOrders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── GEO ───────────────────────────────────────────────── */}
          {tab === 'geo' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-5">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* State */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>Revenue by State</SectionTitle>
                  <div className="space-y-2">
                    {data.geoList.map((g,i) => {
                      const max = data.geoList[0]?.revenue || 1;
                      return (
                        <div key={g.province}>
                          <div className="flex justify-between text-[11px] mb-0.5">
                            <span className="text-slate-300 font-medium">{g.province}</span>
                            <div className="flex gap-3 text-slate-500">
                              <span>{g.orders} orders</span>
                              <span>{g.customers} cust</span>
                              <span className="text-slate-300 font-semibold">{cur(g.revenue)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width:`${g.revenue/max*100}%`, background: C[i%C.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* City */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <SectionTitle>Top Cities by Revenue</SectionTitle>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.cityList} layout="vertical" margin={{ right:60 }}>
                      <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="city" width={100} tick={{ fill:'#94a3b8', fontSize:10 }} />
                      <Tooltip formatter={v => cur(v)} />
                      <Bar dataKey="revenue" name="Revenue" radius={[0,4,4,0]}>
                        {data.cityList.map((_,i) => <Cell key={i} fill={C[i%C.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── CROSS-SELL ────────────────────────────────────────── */}
          {tab === 'crosssell' && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} className="space-y-4">
              <p className="text-xs text-slate-500">SKU pairs most frequently bought in the same order — bundle/upsell opportunities.</p>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['SKU 1','SKU 2','Co-orders','Strength'].map(h=>(
                          <th key={h} className="px-4 py-2.5 text-left text-slate-500 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.crossSellList.map((r,i) => {
                        const max = data.crossSellList[0]?.count || 1;
                        return (
                          <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                            <td className="px-4 py-2.5 font-mono text-slate-300">{r.sku1}</td>
                            <td className="px-4 py-2.5 font-mono text-slate-300">{r.sku2}</td>
                            <td className="px-4 py-2.5 tabular-nums font-semibold text-white">{r.count}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 rounded-full" style={{ width:`${r.count/max*100}%` }} />
                                </div>
                                <span className="text-[10px] text-slate-500">{pct(r.count/max*100)}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
