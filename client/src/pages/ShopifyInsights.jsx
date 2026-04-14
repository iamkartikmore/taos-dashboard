import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  ShoppingBag, Users, TrendingUp, DollarSign, RefreshCw,
  Package, MapPin, Clock, Tag, AlertTriangle, Download,
} from 'lucide-react';
import { useStore } from '../store';
import {
  buildOrderSummary, buildSkuSalesAnalytics, computeRfm, buildCohortData,
  buildDiscountAnalysis, buildAovAnalysis, buildGeoAnalysis, buildTimingAnalysis,
  buildRevenueTrend, RFM_SEGMENT_COLORS,
} from '../lib/shopifyAnalytics';
import { fmt as metaFmt } from '../lib/analytics';
import MetricCard from '../components/ui/MetricCard';

/* ─── FORMAT HELPERS ────────────────────────────────────────────── */
const fmt = {
  currency: n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  number:   n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
  pct:      n => `${Number(n || 0).toFixed(1)}%`,
  decimal:  n => Number(n || 0).toFixed(1),
  days:     n => n === null ? '—' : n > 365 ? '365+d' : `${n}d`,
};

const roasColor = v => {
  v = Number(v||0);
  if (v >= 5) return '#22c55e';
  if (v >= 3) return '#f59e0b';
  if (v >= 1.5) return '#fb923c';
  return '#ef4444';
};

const COLORS = ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80','#c084fc','#38bdf8'];

function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = c.fn ? c.fn(r) : (r[c.key] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const csv = [header, ...lines].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── MINI TOOLTIP ──────────────────────────────────────────────── */
const ChartTip = ({ active, payload, label, fields = [] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl space-y-1 min-w-[140px]">
      <div className="font-semibold text-slate-200 mb-1">{label}</div>
      {fields.map(({ key, label: l, fmtFn = fmt.currency }) => {
        const val = payload.find(p => p.dataKey === key)?.value;
        return val !== undefined
          ? <div key={key} className="text-slate-400">{l}: <span className="text-white font-medium">{fmtFn(val)}</span></div>
          : null;
      })}
    </div>
  );
};

/* ─── COHORT CELL COLOR ─────────────────────────────────────────── */
function cohortBg(pct) {
  if (pct === null) return '#111827';
  if (pct >= 30) return '#064e3b';
  if (pct >= 20) return '#065f46';
  if (pct >= 10) return '#164e63';
  if (pct >= 5)  return '#1e3a5f';
  return '#1e293b';
}

/* ─── MAIN PAGE ─────────────────────────────────────────────────── */
const TABS = [
  { id: 'overview',   label: 'Overview',        icon: TrendingUp  },
  { id: 'sku',        label: 'SKU Sales',        icon: Package     },
  { id: 'rfm',        label: 'Customers & RFM',  icon: Users       },
  { id: 'cohorts',    label: 'Cohort Retention', icon: RefreshCw   },
  { id: 'discounts',  label: 'Discounts',        icon: Tag         },
  { id: 'geo',        label: 'Geography',        icon: MapPin      },
  { id: 'timing',     label: 'Timing',           icon: Clock       },
  { id: 'combos',    label: 'Cross-Sell',      icon: DollarSign  },
];

export default function ShopifyInsights() {
  const { shopifyOrders, brands, activeBrandIds, brandData, customerCache, inventoryMap, enrichedRows } = useStore();
  // Merge customer cache across all active brands into one lookup map
  const mergedCache = useMemo(() => {
    if (!customerCache) return {};
    const active = (brands||[]).filter(b => (activeBrandIds||[]).includes(b.id));
    const merged = {};
    active.forEach(b => {
      const bc = customerCache[b.id] || {};
      Object.entries(bc).forEach(([email, rec]) => {
        if (!merged[email]) { merged[email] = { ...rec }; return; }
        // Merge: take max of lifetime stats, earliest firstSeen, latest lastSeen
        const e = merged[email];
        if (rec.firstSeen && (!e.firstSeen || rec.firstSeen < e.firstSeen)) e.firstSeen = rec.firstSeen;
        if (rec.lastSeen  && (!e.lastSeen  || rec.lastSeen  > e.lastSeen))  e.lastSeen  = rec.lastSeen;
        e.orders += rec.orders;
        e.spent  += rec.spent;
        e.lifetimeOrders = Math.max(e.lifetimeOrders||0, rec.lifetimeOrders||0) || null;
        e.lifetimeSpent  = Math.max(e.lifetimeSpent||0,  rec.lifetimeSpent||0)  || null;
        if (!e.name || e.name === e.email?.split('@')[0]) e.name = rec.name;
        if (!e.city) e.city = rec.city;
      });
    });
    return merged;
  }, [customerCache, brands, activeBrandIds]);
  const [tab, setTab]   = useState('overview');
  const [rfmSeg, setRfmSeg] = useState('All');
  const [geoView, setGeoView] = useState('state');

  // Build all analytics from orders
  const summary    = useMemo(() => buildOrderSummary(shopifyOrders),                       [shopifyOrders]);
  const skuSales   = useMemo(() => buildSkuSalesAnalytics(shopifyOrders, inventoryMap),    [shopifyOrders, inventoryMap]);
  const rfmData    = useMemo(() => computeRfm(shopifyOrders, mergedCache),                 [shopifyOrders, mergedCache]);
  const cohorts    = useMemo(() => buildCohortData(shopifyOrders),                         [shopifyOrders]);
  const discounts  = useMemo(() => buildDiscountAnalysis(shopifyOrders),                   [shopifyOrders]);
  const aovData    = useMemo(() => buildAovAnalysis(shopifyOrders),                        [shopifyOrders]);
  const geoData    = useMemo(() => buildGeoAnalysis(shopifyOrders),                        [shopifyOrders]);
  const timing     = useMemo(() => buildTimingAnalysis(shopifyOrders),                     [shopifyOrders]);
  const revTrend   = useMemo(() => buildRevenueTrend(shopifyOrders),                       [shopifyOrders]);

  const combosData = useMemo(() => {
    if (!shopifyOrders?.length) return { pairs:[], triplets:[], sequences:[] };
    const active = shopifyOrders.filter(o => !o.cancelled_at);
    const N = active.length;
    const crossSell = {}, tripMap = {}, seqMap = {}, skuOrd = {}, custOrds = {};
    active.forEach(o => {
      const skus = [...new Set((o.line_items||[]).map(i=>(i.sku||'').trim().toUpperCase()).filter(Boolean))];
      skus.forEach(s => { skuOrd[s] = (skuOrd[s]||0) + 1; });
      for (let i=0;i<skus.length;i++)
        for (let j=i+1;j<skus.length;j++) {
          const k=[skus[i],skus[j]].sort().join('|');
          crossSell[k]=(crossSell[k]||0)+1;
        }
      if (skus.length>=3)
        for (let i=0;i<skus.length;i++)
          for (let j=i+1;j<skus.length;j++)
            for (let k=j+1;k<skus.length;k++) {
              const key=[skus[i],skus[j],skus[k]].sort().join('||');
              tripMap[key]=(tripMap[key]||0)+1;
            }
      const email=(o.email||o.customer?.email||'').toLowerCase().trim();
      const ck = email||(o.customer?.id?`c${o.customer.id}`:null);
      if (ck) { if(!custOrds[ck]) custOrds[ck]=[]; custOrds[ck].push({date:o.created_at||'',skus}); }
    });
    Object.values(custOrds).forEach(ordList => {
      if (ordList.length<2) return;
      ordList.sort((a,b)=>a.date.localeCompare(b.date));
      for (let i=0;i<ordList.length-1;i++)
        ordList[i].skus.forEach(f => ordList[i+1].skus.forEach(t => {
          if (f!==t) { const k=`${f}|||${t}`; seqMap[k]=(seqMap[k]||0)+1; }
        }));
    });
    const skuName = {};
    shopifyOrders.forEach(o=>(o.line_items||[]).forEach(i=>{ const s=(i.sku||'').trim().toUpperCase(); if(s&&!skuName[s]) skuName[s]=i.title||s; }));
    const pairs = Object.entries(crossSell).filter(([,c])=>c>=2)
      .map(([pair,count])=>{ const [s1,s2]=pair.split('|'); const lift=N>0?(count*N)/((skuOrd[s1]||1)*(skuOrd[s2]||1)):0;
        return {sku1:s1,sku2:s2,name1:skuName[s1]||s1,name2:skuName[s2]||s2,count,lift:+lift.toFixed(2),conf1:+(count/(skuOrd[s1]||1)*100).toFixed(1),conf2:+(count/(skuOrd[s2]||1)*100).toFixed(1),supportPct:+(count/N*100).toFixed(2)}; })
      .sort((a,b)=>b.lift-a.lift).slice(0,60);
    const triplets = Object.entries(tripMap).filter(([,c])=>c>=2)
      .map(([combo,count])=>({combo,skus:combo.split('||').map(s=>skuName[s]||s),count,supportPct:+(count/N*100).toFixed(2)}))
      .sort((a,b)=>b.count-a.count).slice(0,30);
    const sequences = Object.entries(seqMap)
      .map(([key,count])=>{ const [from,to]=key.split('|||'); return {from,to,fromName:skuName[from]||from,toName:skuName[to]||to,count}; })
      .filter(s=>s.count>=2).sort((a,b)=>b.count-a.count).slice(0,40);
    return { pairs, triplets, sequences };
  }, [shopifyOrders]);

  // Meta SKU summary for cross-reference
  const metaSkuMap = useMemo(() => {
    const map = {};
    enrichedRows.forEach(r => {
      const sku = (r.sku || '').trim().toUpperCase();
      if (!sku) return;
      if (!map[sku]) map[sku] = { spend: 0, roas: 0, purchases: 0, roasSpend: 0 };
      map[sku].spend      += Number(r.spend || 0);
      map[sku].purchases  += Number(r.purchases || 0);
      map[sku].roasSpend  += Number(r.spend || 0);
      // spend-weighted roas accumulator
      map[sku]._roasAcc = (map[sku]._roasAcc || 0) + Number(r.metaRoas || 0) * Number(r.spend || 0);
    });
    Object.values(map).forEach(m => { m.roas = m.roasSpend > 0 ? m._roasAcc / m.roasSpend : 0; });
    return map;
  }, [enrichedRows]);

  // RFM segment breakdown
  const rfmSegments = useMemo(() => {
    const map = {};
    rfmData.forEach(c => {
      if (!map[c.segment]) map[c.segment] = { segment: c.segment, color: c.segmentColor, count: 0, revenue: 0, aovList: [] };
      map[c.segment].count++;
      map[c.segment].revenue += c.totalSpent;
      map[c.segment].aovList.push(c.aov);
    });
    return Object.values(map).map(s => ({
      ...s,
      aov: s.aovList.length ? s.aovList.reduce((a,b)=>a+b,0)/s.aovList.length : 0,
      pct: rfmData.length > 0 ? s.count / rfmData.length * 100 : 0,
    })).sort((a,b) => b.revenue - a.revenue);
  }, [rfmData]);

  const filteredRfm = useMemo(() =>
    rfmSeg === 'All' ? rfmData : rfmData.filter(c => c.segment === rfmSeg),
  [rfmData, rfmSeg]);

  // Derive loading/empty state from brand data (multi-brand store doesn't use shopifyOrdersStatus)
  const isLoading = (brands||[]).some(b => activeBrandIds?.includes(b.id) && brandData?.[b.id]?.ordersStatus === 'loading');
  const isEmpty   = !shopifyOrders?.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-sm">Fetching Shopify orders…</span>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <ShoppingBag size={40} className="opacity-30" />
        <p className="text-sm">No Shopify data loaded.</p>
        <p className="text-xs text-slate-600">Go to Study Manual → Pull Everything first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-violet-500/20">
          <ShoppingBag size={20} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Shopify Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">
            {fmt.number(shopifyOrders.length)} orders · {fmt.number(summary.uniqueCustomers)} customers in window
            {Object.keys(mergedCache).length > 0 && ` · ${fmt.number(Object.keys(mergedCache).length)} in lifetime cache`}
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              tab === id ? 'bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard label="Total Orders"     value={fmt.number(summary.totalOrders)}     icon={ShoppingBag} color="violet" />
            <MetricCard label="Revenue"          value={fmt.currency(summary.revenue)}        icon={DollarSign}  color="green" />
            <MetricCard label="AOV"              value={fmt.currency(summary.aov)}            icon={TrendingUp}  color="blue" />
            <MetricCard label="Unique Customers" value={fmt.number(summary.uniqueCustomers)}  icon={Users}       color="purple" />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard label="Repeat Rate"      value={fmt.pct(summary.repeatRate)}          icon={RefreshCw}   color="teal"  sub={`${fmt.number(summary.repeatOrders)} repeat orders`} />
            <MetricCard label="Refund Rate"      value={fmt.pct(summary.refundRate)}          icon={AlertTriangle} color="red" sub={`${summary.refundedOrders} refunded`} />
            <MetricCard label="Discount Usage"   value={fmt.pct(summary.discountUsageRate)}   icon={Tag}         color="amber" sub={`${fmt.pct(summary.discountImpact)} of GMV`} />
            <MetricCard label="New Customers"    value={fmt.number(summary.newCustomers)}     icon={Users}       color="blue"  sub={`${fmt.pct(summary.newCustomers / Math.max(summary.totalOrders,1) * 100)} of orders`} />
          </div>

          {/* Revenue trend */}
          {revTrend.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Revenue + AOV Trend by Month</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={revTrend}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis dataKey="month" tick={{ fill:'#64748b', fontSize:10 }} />
                  <YAxis yAxisId="rev" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} />
                  <YAxis yAxisId="aov" orientation="right" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+v.toFixed(0)} />
                  <Tooltip content={<ChartTip fields={[{key:'revenue',label:'Revenue'},{key:'aov',label:'AOV'},{key:'orders',label:'Orders',fmtFn:fmt.number}]} />} />
                  <Legend wrapperStyle={{ fontSize:11, color:'#94a3b8' }} />
                  <Line yAxisId="rev" type="monotone" dataKey="revenue"  stroke="#a78bfa" strokeWidth={2} dot={false} name="Revenue" />
                  <Line yAxisId="aov" type="monotone" dataKey="aov"      stroke="#34d399" strokeWidth={2} dot={false} name="AOV" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* New vs Repeat by month */}
          {revTrend.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">New vs Repeat Orders by Month</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={revTrend}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis dataKey="month" tick={{ fill:'#64748b', fontSize:10 }} />
                  <YAxis tick={{ fill:'#64748b', fontSize:10 }} />
                  <Tooltip content={<ChartTip fields={[{key:'newCustomers',label:'New',fmtFn:fmt.number},{key:'repeatCustomers',label:'Repeat',fmtFn:fmt.number}]} />} />
                  <Legend wrapperStyle={{ fontSize:11, color:'#94a3b8' }} />
                  <Bar dataKey="newCustomers"    fill="#3b82f6" name="New"    radius={[2,2,0,0]} stackId="a" />
                  <Bar dataKey="repeatCustomers" fill="#22c55e" name="Repeat" radius={[2,2,0,0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>
      )}

      {/* ── SKU SALES ────────────────────────────────────────────── */}
      {tab === 'sku' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">SKU Sales Intelligence</h2>
                <span className="text-[10px] text-slate-500">{skuSales.length} SKUs · sorted by 30D revenue</span>
              </div>
              <button onClick={() => exportCSV('sku_sales.csv', skuSales, [
                { key:'sku', label:'SKU' }, { key:'stockTitle', label:'Product' },
                { key:'unitsSold', label:'Units Sold' }, { key:'revenue', label:'Revenue' },
                { key:'revenue30d', label:'30D Revenue' }, { key:'dailyVelocity7d', label:'7D/day' },
                { key:'dailyVelocity30d', label:'30D/day' }, { key:'stock', label:'Stock' },
                { key:'daysOfStock', label:'Days Stock' }, { key:'refundRate', label:'Refund%' },
                { key:'discountRate', label:'Discount%' },
              ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/80">
                    {['SKU','Product','Units Sold','Revenue','30D Rev','7D/day','30D/day','Stock','Days Stock','Refund%','Discount%','Meta Spend','Meta ROAS'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {skuSales.map((s, i) => {
                    const meta = metaSkuMap[s.sku] || {};
                    return (
                      <tr key={s.sku} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                        <td className="px-3 py-2.5 font-semibold text-slate-200 whitespace-nowrap">{s.sku}</td>
                        <td className="px-3 py-2.5 text-slate-400 max-w-[160px] truncate" title={s.stockTitle}>{s.stockTitle}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-300">{fmt.number(s.unitsSold)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-200 font-semibold">{fmt.currency(s.revenue)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-violet-300">{fmt.currency(s.revenue30d)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.decimal(s.dailyVelocity7d)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.decimal(s.dailyVelocity30d)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {s.stock === null ? <span className="text-slate-600">—</span>
                            : s.stock <= 0 ? <span className="text-red-400 font-bold">OUT</span>
                            : <span className={s.stock < 20 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>{s.stock}</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {s.daysOfStock === null ? <span className="text-slate-600">—</span>
                            : s.daysOfStock <= 7 ? <span className="text-red-400 font-bold">{s.daysOfStock}d</span>
                            : s.daysOfStock <= 14 ? <span className="text-amber-400">{s.daysOfStock}d</span>
                            : <span className="text-slate-400">{s.daysOfStock}d</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          <span className={s.refundRate > 10 ? 'text-red-400 font-semibold' : s.refundRate > 5 ? 'text-amber-400' : 'text-slate-400'}>{fmt.pct(s.refundRate)}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.pct(s.discountRate)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{meta.spend > 0 ? fmt.currency(meta.spend) : '—'}</td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold" style={{ color: meta.roas > 0 ? roasColor(meta.roas) : '#475569' }}>
                          {meta.roas > 0 ? `${meta.roas.toFixed(2)}x` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 15 SKUs by revenue bar */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Top 15 SKUs — 30D Revenue</h2>
            <ResponsiveContainer width="100%" height={Math.max(240, Math.min(skuSales.length, 15) * 30)}>
              <BarChart data={skuSales.slice(0,15)} layout="vertical" margin={{ right: 48 }}>
                <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="sku" width={110} tick={{ fill:'#94a3b8', fontSize:11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip fields={[{key:'revenue30d',label:'30D Rev'},{key:'units30d',label:'30D Units',fmtFn:fmt.number}]} />} />
                <Bar dataKey="revenue30d" radius={[0,4,4,0]}>
                  {skuSales.slice(0,15).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* ── CUSTOMERS & RFM ───────────────────────────────────────── */}
      {tab === 'rfm' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">

          {/* Segment cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {rfmSegments.slice(0,8).map(s => (
              <button key={s.segment} onClick={() => setRfmSeg(seg => seg === s.segment ? 'All' : s.segment)}
                className={`text-left p-4 rounded-xl border transition-all ${rfmSeg === s.segment ? 'ring-2 ring-offset-1 ring-offset-gray-950' : ''}`}
                style={{ background: s.color+'15', borderColor: s.color+'40', '--tw-ring-color': s.color }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: s.color }}>{s.segment}</div>
                <div className="text-xl font-bold text-white">{fmt.number(s.count)}</div>
                <div className="text-[10px] text-slate-500 mt-1">{fmt.pct(s.pct)} · AOV {fmt.currency(s.aov)}</div>
                <div className="text-xs text-slate-400 mt-0.5">{fmt.currency(s.revenue)} total</div>
              </button>
            ))}
          </div>

          {/* Segment filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {['All', ...rfmSegments.map(s=>s.segment)].map(seg => (
              <button key={seg} onClick={() => setRfmSeg(seg)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${rfmSeg === seg ? 'bg-violet-600/40 text-violet-300 ring-1 ring-violet-500/40' : 'bg-gray-800 text-slate-400 hover:text-slate-200'}`}>
                {seg}
              </button>
            ))}
          </div>

          {/* Customer table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Customer RFM Table — {filteredRfm.length} customers</h2>
              <button onClick={() => exportCSV('rfm_customers.csv', filteredRfm, [
                { key:'email', label:'Email' }, { key:'name', label:'Name' },
                { key:'segment', label:'Segment' }, { key:'r', label:'R' }, { key:'f', label:'F' }, { key:'m', label:'M' },
                { key:'orderCount', label:'Orders' }, { key:'totalSpent', label:'Total Spent' },
                { key:'aov', label:'AOV' }, { key:'recencyDays', label:'Days Since' },
                { key:'lifespan', label:'Lifespan Days' }, { key:'city', label:'City' },
              ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/80">
                    {['Customer','Segment','R','F','M','Orders','Total Spent','AOV','Days Since','Lifespan','SKUs','City'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRfm.slice(0, 200).map((c, i) => (
                    <tr key={c.id} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                      <td className="px-3 py-2.5 max-w-[160px] truncate" title={c.email}>
                        <div className="font-semibold text-slate-200">{c.name}</div>
                        <div className="text-[10px] text-slate-600 truncate">{c.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: c.segmentColor+'22', color: c.segmentColor }}>{c.segment}</span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-bold text-center" style={{ color: c.r >= 4 ? '#22c55e' : c.r >= 3 ? '#f59e0b' : '#ef4444' }}>{c.r}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold text-center" style={{ color: c.f >= 4 ? '#22c55e' : c.f >= 3 ? '#f59e0b' : '#ef4444' }}>{c.f}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold text-center" style={{ color: c.m >= 4 ? '#22c55e' : c.m >= 3 ? '#f59e0b' : '#ef4444' }}>{c.m}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-300">{c.orderCount}</td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-200">{fmt.currency(c.totalSpent)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.currency(c.aov)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{c.recencyDays}d</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">{c.lifespan > 0 ? `${c.lifespan}d` : '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">{c.uniqueSkus}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{c.city || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── COHORT RETENTION ──────────────────────────────────────── */}
      {tab === 'cohorts' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          {cohorts.length === 0 ? (
            <p className="text-slate-500 text-sm">Not enough data for cohort analysis — need at least 2 months of orders.</p>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">Monthly Cohort Retention</h2>
                <p className="text-xs text-slate-500 mt-0.5">% of cohort that ordered again in each subsequent month</p>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-500 font-semibold whitespace-nowrap sticky left-0 bg-gray-900 z-10">Cohort</th>
                      <th className="px-3 py-2 text-right text-slate-500 font-semibold whitespace-nowrap">Size</th>
                      {Array.from({ length: 12 }, (_, i) => (
                        <th key={i} className="px-3 py-2 text-center text-slate-500 font-semibold whitespace-nowrap">M+{i}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((row, i) => (
                      <tr key={row.month} className={i%2===0?'':'bg-gray-900/30'}>
                        <td className="px-3 py-2 font-semibold text-slate-300 sticky left-0 bg-inherit whitespace-nowrap">{row.month}</td>
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{fmt.number(row.cohortSize)}</td>
                        {Array.from({ length: 12 }, (_, mi) => {
                          const val = row[`m${mi}`];
                          return (
                            <td key={mi} className="px-2 py-2 text-center tabular-nums min-w-[48px]"
                              style={{ background: cohortBg(val) }}>
                              {val !== null
                                ? <span className={`font-semibold ${val >= 20 ? 'text-emerald-300' : val >= 10 ? 'text-blue-300' : 'text-slate-400'}`}>{val}%</span>
                                : <span className="text-slate-800">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── DISCOUNTS ─────────────────────────────────────────────── */}
      {tab === 'discounts' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          {/* AOV comparison: with vs without */}
          {(() => {
            const withDisc = discounts.find(d => d.code !== '(no discount)');
            const noDisc   = discounts.find(d => d.code === '(no discount)');
            if (!withDisc && !noDisc) return null;
            return (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard label="AOV with Discount"    value={withDisc ? fmt.currency(withDisc.aov)       : '—'} icon={Tag}         color="amber" />
                <MetricCard label="AOV without Discount" value={noDisc   ? fmt.currency(noDisc.aov)         : '—'} icon={Tag}         color="green" />
                <MetricCard label="Avg Discount Amount"  value={withDisc ? fmt.currency(withDisc.avgDiscount): '—'} icon={DollarSign}  color="red" />
                <MetricCard label="Discount Usage Rate"  value={fmt.pct(summary.discountUsageRate)}               icon={ShoppingBag} color="blue" />
              </div>
            );
          })()}

          {/* AOV by item count */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">AOV by Items per Order</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={aovData.byItemCount}>
                  <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:11 }} axisLine={false} />
                  <YAxis tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+v.toFixed(0)} axisLine={false} />
                  <Tooltip content={<ChartTip fields={[{key:'aov',label:'AOV'},{key:'orders',label:'Orders',fmtFn:fmt.number}]} />} />
                  <Bar dataKey="aov" radius={4}>
                    {aovData.byItemCount.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Discount code table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-white">Discount Code Performance</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Code','Orders','Revenue','Avg Discount','AOV','Discount%'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.slice(0, 25).map((d, i) => (
                      <tr key={d.code} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                        <td className="px-3 py-2.5 font-mono text-slate-300 whitespace-nowrap">{d.code}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.number(d.orders)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-200">{fmt.currency(d.revenue)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-amber-400">{fmt.currency(d.avgDiscount)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-300">{fmt.currency(d.aov)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          <span className={d.discountRate > 20 ? 'text-red-400 font-semibold' : d.discountRate > 10 ? 'text-amber-400' : 'text-slate-400'}>
                            {fmt.pct(d.discountRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* AOV trend */}
          {aovData.byMonth.length > 1 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">AOV Trend by Month</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={aovData.byMonth}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:10 }} />
                  <YAxis tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+v.toFixed(0)} />
                  <Tooltip content={<ChartTip fields={[{key:'aov',label:'AOV'},{key:'orders',label:'Orders',fmtFn:fmt.number},{key:'discounts',label:'Discounts'}]} />} />
                  <Line type="monotone" dataKey="aov" stroke="#f59e0b" strokeWidth={2} dot={false} name="AOV" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>
      )}

      {/* ── GEOGRAPHY ─────────────────────────────────────────────── */}
      {tab === 'geo' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          <div className="flex gap-2">
            {['state','city'].map(v => (
              <button key={v} onClick={() => setGeoView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${geoView===v?'bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/40':'bg-gray-800 text-slate-400 hover:text-slate-200'}`}>
                By {v}
              </button>
            ))}
          </div>

          {(() => {
            const rows = geoView === 'state' ? geoData.byState : geoData.byCity;
            const maxRev = rows[0]?.revenue || 1;
            return (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-white mb-4">Top {geoView === 'state' ? 'States' : 'Cities'} by Revenue</h2>
                  <ResponsiveContainer width="100%" height={Math.max(200, Math.min(rows.length,15)*28)}>
                    <BarChart data={rows.slice(0,15)} layout="vertical" margin={{ right:48 }}>
                      <XAxis type="number" tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="label" width={120} tick={{ fill:'#94a3b8', fontSize:11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTip fields={[{key:'revenue',label:'Revenue'},{key:'orders',label:'Orders',fmtFn:fmt.number},{key:'aov',label:'AOV'}]} />} />
                      <Bar dataKey="revenue" radius={[0,4,4,0]}>
                        {rows.slice(0,15).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-white">{geoView === 'state' ? 'State' : 'City'} Breakdown</h2>
                  </div>
                  <div className="overflow-y-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-800">
                          {['Location','Orders','Revenue','AOV','Customers','Share'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.label} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                            <td className="px-3 py-2.5 font-semibold text-slate-200 whitespace-nowrap">{r.label}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.number(r.orders)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-200">{fmt.currency(r.revenue)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.currency(r.aov)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.number(r.customers)}</td>
                            <td className="px-3 py-2.5 tabular-nums">
                              <div className="flex items-center gap-1.5">
                                <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-violet-500 rounded-full" style={{ width:`${(r.revenue/maxRev)*100}%` }} />
                                </div>
                                <span className="text-slate-500">{fmt.pct(r.revenueShare)}</span>
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
          })()}
        </motion.div>
      )}

      {/* ── TIMING ────────────────────────────────────────────────── */}
      {tab === 'timing' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* By hour */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Orders by Hour of Day</h2>
              <p className="text-xs text-slate-500 mb-4">Based on order timestamp (store timezone)</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={timing.byHour}>
                  <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:9 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fill:'#64748b', fontSize:10 }} axisLine={false} />
                  <Tooltip content={<ChartTip fields={[{key:'orders',label:'Orders',fmtFn:fmt.number},{key:'revenue',label:'Revenue'},{key:'aov',label:'AOV'}]} />} />
                  <Bar dataKey="orders" radius={[3,3,0,0]}>
                    {timing.byHour.map((d,i) => <Cell key={i} fill={d.orders === Math.max(...timing.byHour.map(h=>h.orders)) ? '#a78bfa' : '#3b4063'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* By day */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Orders by Day of Week</h2>
              <p className="text-xs text-slate-500 mb-4">Revenue and AOV per day</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={timing.byDay}>
                  <XAxis dataKey="label" tick={{ fill:'#64748b', fontSize:11 }} axisLine={false} />
                  <YAxis tick={{ fill:'#64748b', fontSize:10 }} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} />
                  <Tooltip content={<ChartTip fields={[{key:'revenue',label:'Revenue'},{key:'orders',label:'Orders',fmtFn:fmt.number},{key:'aov',label:'AOV'}]} />} />
                  <Bar dataKey="revenue" radius={[3,3,0,0]}>
                    {timing.byDay.map((d,i) => <Cell key={i} fill={d.revenue === Math.max(...timing.byDay.map(h=>h.revenue)) ? '#22c55e' : '#1e4038'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Best/worst hours table */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Peak Hours — Top 5</h2>
              <div className="space-y-2">
                {[...timing.byHour].sort((a,b)=>b.revenue-a.revenue).slice(0,5).map((h,i) => (
                  <div key={h.hour} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-violet-300 w-14 shrink-0">{h.label}</span>
                    <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500/70 rounded-full" style={{ width:`${(h.revenue / timing.byHour[0].revenue * 100) || 50}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-24 text-right tabular-nums">{fmt.currency(h.revenue)}</span>
                    <span className="text-xs text-slate-600 w-12 text-right tabular-nums">{fmt.number(h.orders)} ord</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Best Days — by Revenue</h2>
              <div className="space-y-2">
                {[...timing.byDay].sort((a,b)=>b.revenue-a.revenue).map((d,i) => (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-emerald-300 w-10 shrink-0">{d.label}</span>
                    <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500/70 rounded-full"
                        style={{ width:`${timing.byDay.reduce((m,x)=>Math.max(m,x.revenue),0) > 0 ? d.revenue/timing.byDay.reduce((m,x)=>Math.max(m,x.revenue),0)*100 : 0}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-24 text-right tabular-nums">{fmt.currency(d.revenue)}</span>
                    <span className="text-xs text-slate-500 w-18 text-right tabular-nums">AOV {fmt.currency(d.aov)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── CROSS-SELL ─────────────────────────────────────────────── */}
      {tab === 'combos' && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} className="space-y-5">
          {/* Pairs */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Top Cross-Sell Pairs</h2>
                <p className="text-xs text-slate-500 mt-0.5">Lift {'>'} 1 = bought together more than chance. Confidence = % of SKU-A buyers who also bought SKU-B.</p>
              </div>
              <button onClick={() => exportCSV('cross_sell_pairs.csv', combosData.pairs, [
                {key:'sku1',label:'SKU 1'},{key:'name1',label:'Product 1'},{key:'sku2',label:'SKU 2'},{key:'name2',label:'Product 2'},
                {key:'count',label:'Co-Purchases'},{key:'lift',label:'Lift'},{key:'conf1',label:'Conf A→B%'},{key:'conf2',label:'Conf B→A%'},{key:'supportPct',label:'Support%'},
              ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800 bg-gray-900/80">
                  {['SKU A','Product A','SKU B','Product B','Together','Lift','Conf A→B','Conf B→A','Support'].map(h=>(
                    <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {combosData.pairs.slice(0,50).map((r,i)=>(
                    <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                      <td className="px-3 py-2.5 font-semibold text-slate-200">{r.sku1}</td>
                      <td className="px-3 py-2.5 text-slate-400 max-w-[140px] truncate">{r.name1}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-200">{r.sku2}</td>
                      <td className="px-3 py-2.5 text-slate-400 max-w-[140px] truncate">{r.name2}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-300">{r.count}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold" style={{color:r.lift>=5?'#22c55e':r.lift>=2?'#f59e0b':'#64748b'}}>{r.lift}x</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{r.conf1}%</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{r.conf2}%</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">{r.supportPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 20 pairs chart */}
          {combosData.pairs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Top 20 Pairs — Lift Score</h2>
              <ResponsiveContainer width="100%" height={Math.max(240, Math.min(combosData.pairs.length,20)*28)}>
                <BarChart data={combosData.pairs.slice(0,20).map(r=>({...r,label:`${r.sku1}+${r.sku2}`}))} layout="vertical" margin={{right:48}}>
                  <XAxis type="number" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="label" width={160} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTip fields={[{key:'lift',label:'Lift',fmtFn:v=>`${v}x`},{key:'count',label:'Co-purchases',fmtFn:fmt.number}]}/>}/>
                  <Bar dataKey="lift" radius={[0,4,4,0]}>
                    {combosData.pairs.slice(0,20).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Triplets */}
          {combosData.triplets.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Triplet Combos — 3 SKUs Bought Together</h2>
                <button onClick={() => exportCSV('triplets.csv', combosData.triplets, [
                  {key:'skus',label:'SKUs',fn:r=>r.skus.join(' + ')},{key:'count',label:'Count'},{key:'supportPct',label:'Support%'},
                ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800"><th className="px-3 py-2.5 text-left text-slate-500 font-semibold">Combo</th><th className="px-3 py-2.5 text-left text-slate-500 font-semibold">Orders</th><th className="px-3 py-2.5 text-left text-slate-500 font-semibold">Support%</th></tr></thead>
                  <tbody>
                    {combosData.triplets.map((r,i)=>(
                      <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                        <td className="px-3 py-2.5 text-slate-300">{r.skus.join(' + ')}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{r.count}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500">{r.supportPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Purchase sequences */}
          {combosData.sequences.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Repeat Purchase Sequences</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Customers who bought A then B — shows natural upsell paths</p>
                </div>
                <button onClick={() => exportCSV('sequences.csv', combosData.sequences, [
                  {key:'from',label:'From SKU'},{key:'fromName',label:'From Product'},{key:'to',label:'To SKU'},{key:'toName',label:'To Product'},{key:'count',label:'Count'},
                ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800">
                    {['From SKU','From Product','→','To SKU','To Product','Count'].map(h=><th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {combosData.sequences.slice(0,40).map((r,i)=>(
                      <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/40':''}`}>
                        <td className="px-3 py-2.5 font-semibold text-slate-200">{r.from}</td>
                        <td className="px-3 py-2.5 text-slate-400 max-w-[140px] truncate">{r.fromName}</td>
                        <td className="px-3 py-2.5 text-violet-400">→</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-200">{r.to}</td>
                        <td className="px-3 py-2.5 text-slate-400 max-w-[140px] truncate">{r.toName}</td>
                        <td className="px-3 py-2.5 tabular-nums text-emerald-400 font-semibold">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}

    </div>
  );
}
