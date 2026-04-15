import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Truck, MapPin, Building2, Hash, ChevronDown, ChevronRight,
  Package, Clock, AlertTriangle, CheckCircle, Download, RefreshCw,
} from 'lucide-react';
import { useStore } from '../store';

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const p   = v => parseFloat(v || 0);
const cur = v => `₹${p(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const num = v => p(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct = v => `${p(v).toFixed(1)}%`;
const dec = (v, d = 1) => p(v).toFixed(d);
const hrs = h => h < 24 ? `${dec(h)}h` : `${dec(h / 24, 1)}d`;

/* ─── CSV EXPORT ─────────────────────────────────────────────────── */
function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = c.fn ? c.fn(r) : (r[c.key] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const csv = [header, ...lines].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── CORE GEO BUILDER ───────────────────────────────────────────── */
// Builds warehouse → state → city → pincode breakdown directly from raw orders.
// Kept deliberately simple (no O(n²) ops) — works on any time window.
function buildOpsGeo(orders, selectedTags = []) {
  if (!orders?.length) return { warehouses: [], tagList: [], geoByTag: {} };

  // Collect all tags
  const tagSet = new Set();
  orders.forEach(o => {
    if (!o.cancelled_at)
      String(o.tags || '').split(',').forEach(t => { const c = t.trim(); if (c) tagSet.add(c); });
  });
  const tagList = [...tagSet].sort();

  // Decide which tags to include
  const activeTags = selectedTags.length === 0 ? tagList : selectedTags;
  const activeSet  = new Set(activeTags);

  // Build geo map per tag
  // geoByTag[tag][state][city][pincode] = { orders, revenue, fulfillMs[] }
  const geoByTag = {};

  orders.filter(o => !o.cancelled_at).forEach(o => {
    const orderTags = String(o.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const matchTags = orderTags.length ? orderTags.filter(t => activeSet.has(t)) : [];
    // Also show orders without any tag if we are showing "all"
    if (matchTags.length === 0) {
      if (selectedTags.length === 0) matchTags.push('(untagged)');
      else return;
    }

    const state   = (o.shipping_address?.province || o.billing_address?.province || 'Unknown').trim();
    const city    = (o.shipping_address?.city     || o.billing_address?.city     || 'Unknown').trim();
    const pin     = (o.shipping_address?.zip      || o.billing_address?.zip      || '—').trim();
    const rev     = p(o.total_price);

    // Fulfillment time
    let fulfillMs = null;
    if (o.fulfillments?.length && o.fulfillments[0].created_at && o.created_at) {
      const ms = new Date(o.fulfillments[0].created_at) - new Date(o.created_at);
      if (ms >= 0 && ms < 30 * 24 * 3600000) fulfillMs = ms;
    }

    const fulfillStatus = o.fulfillment_status || 'unfulfilled';

    matchTags.forEach(tag => {
      if (!geoByTag[tag]) geoByTag[tag] = {};
      const T = geoByTag[tag];
      if (!T[state]) T[state] = { state, orders: 0, revenue: 0, fulfillMs: [], cities: {} };
      T[state].orders++;
      T[state].revenue += rev;
      if (fulfillMs !== null) T[state].fulfillMs.push(fulfillMs);

      const C = T[state].cities;
      if (!C[city]) C[city] = { city, orders: 0, revenue: 0, fulfillMs: [], pincodes: {} };
      C[city].orders++;
      C[city].revenue += rev;
      if (fulfillMs !== null) C[city].fulfillMs.push(fulfillMs);

      const P = C[city].pincodes;
      if (!P[pin]) P[pin] = { pincode: pin, orders: 0, revenue: 0, fulfillMs: [], statuses: {} };
      P[pin].orders++;
      P[pin].revenue += rev;
      if (fulfillMs !== null) P[pin].fulfillMs.push(fulfillMs);
      P[pin].statuses[fulfillStatus] = (P[pin].statuses[fulfillStatus] || 0) + 1;
    });
  });

  // Post-process: sort and compute stats
  const statsOf = arr => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const under24 = arr.filter(v => v < 86400000).length;
    return { avg: avg / 3600000, median: p50 / 3600000, sla24: under24 / arr.length * 100 };
  };

  const warehouses = activeTags.filter(t => geoByTag[t]).map(tag => {
    const stateMap = geoByTag[tag] || {};
    let totalOrders = 0, totalRev = 0, allMs = [];
    const states = Object.values(stateMap).map(s => {
      totalOrders += s.orders;
      totalRev    += s.revenue;
      allMs.push(...s.fulfillMs);
      const cities = Object.values(s.cities).map(c => {
        const pincodes = Object.values(c.pincodes)
          .map(pp => ({ ...pp, fulfillStats: statsOf(pp.fulfillMs), aov: pp.orders ? pp.revenue / pp.orders : 0 }))
          .sort((a, b) => b.orders - a.orders);
        return { ...c, fulfillStats: statsOf(c.fulfillMs), aov: c.orders ? c.revenue / c.orders : 0, pincodes };
      }).sort((a, b) => b.orders - a.orders);
      return { ...s, fulfillStats: statsOf(s.fulfillMs), aov: s.orders ? s.revenue / s.orders : 0, cities };
    }).sort((a, b) => b.orders - a.orders);

    return { tag, orders: totalOrders, revenue: totalRev, fulfillStats: statsOf(allMs), states };
  });

  return { warehouses, tagList, geoByTag };
}

/* ─── STAT PILL ─────────────────────────────────────────────────── */
function SLA({ stats }) {
  if (!stats) return <span className="text-slate-600 text-xs">—</span>;
  const color = stats.sla24 >= 80 ? '#22c55e' : stats.sla24 >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="text-xs">
      <span className="font-semibold" style={{ color }}>{dec(stats.sla24)}%</span>
      <span className="text-slate-600 ml-1">&lt;24h · avg {hrs(stats.avg)}</span>
    </div>
  );
}

/* ─── GEO TABLE ─────────────────────────────────────────────────── */
function GeoTable({ states, totalOrders }) {
  const [openStates, setOpenStates] = useState({});
  const [openCities, setOpenCities] = useState({});

  const toggleState = useCallback(s => setOpenStates(p => ({ ...p, [s]: !p[s] })), []);
  const toggleCity  = useCallback(k => setOpenCities(p => ({ ...p, [k]: !p[k] })), []);

  if (!states?.length) return (
    <div className="py-8 text-center text-slate-600 text-sm">No geo data — orders need shipping addresses.</div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[600px]">
        <thead>
          <tr className="border-b border-gray-700">
            {['Location','Orders','Share','Revenue','AOV','Avg Ship','SLA <24h'].map(h => (
              <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {states.map(s => {
            const sOpen = openStates[s.state];
            const sharePct = totalOrders > 0 ? s.orders / totalOrders * 100 : 0;
            return (
              <>
                {/* State row */}
                <tr key={s.state}
                  className="border-b border-gray-800/40 cursor-pointer hover:bg-gray-800/30 transition-colors"
                  onClick={() => toggleState(s.state)}>
                  <td className="px-0 py-2 font-semibold text-slate-200">
                    <div className="flex items-center gap-1.5">
                      {sOpen ? <ChevronDown size={12} className="text-brand-400 shrink-0"/> : <ChevronRight size={12} className="text-slate-600 shrink-0"/>}
                      <MapPin size={11} className="text-slate-500 shrink-0"/>
                      {s.state}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-14 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500/70" style={{ width: `${sharePct}%` }}/>
                      </div>
                      <span className="font-semibold text-slate-200 tabular-nums">{num(s.orders)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-slate-400">{dec(sharePct)}%</td>
                  <td className="px-2 py-2 tabular-nums text-emerald-400 font-semibold">{cur(s.revenue)}</td>
                  <td className="px-2 py-2 tabular-nums text-slate-400">{cur(s.aov)}</td>
                  <td className="px-2 py-2 text-slate-400">{s.fulfillStats ? hrs(s.fulfillStats.avg) : '—'}</td>
                  <td className="px-2 py-2"><SLA stats={s.fulfillStats}/></td>
                </tr>

                {/* City rows */}
                {sOpen && s.cities.map(c => {
                  const cKey  = `${s.state}|${c.city}`;
                  const cOpen = openCities[cKey];
                  const cShare = s.orders > 0 ? c.orders / s.orders * 100 : 0;
                  return (
                    <>
                      <tr key={cKey}
                        className="border-b border-gray-800/20 cursor-pointer hover:bg-gray-800/20 transition-colors bg-gray-900/30"
                        onClick={() => toggleCity(cKey)}>
                        <td className="py-1.5 pl-6 font-medium text-slate-300">
                          <div className="flex items-center gap-1.5">
                            {cOpen ? <ChevronDown size={11} className="text-slate-500 shrink-0"/> : <ChevronRight size={11} className="text-slate-700 shrink-0"/>}
                            <Building2 size={10} className="text-slate-600 shrink-0"/>
                            {c.city}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-10 h-0.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${cShare}%` }}/>
                            </div>
                            <span className="text-slate-300 tabular-nums">{num(c.orders)}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{dec(cShare)}%</td>
                        <td className="px-2 py-1.5 tabular-nums text-emerald-400/80">{cur(c.revenue)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{cur(c.aov)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{c.fulfillStats ? hrs(c.fulfillStats.avg) : '—'}</td>
                        <td className="px-2 py-1.5"><SLA stats={c.fulfillStats}/></td>
                      </tr>

                      {/* Pincode rows */}
                      {cOpen && c.pincodes.slice(0, 30).map(pp => (
                        <tr key={pp.pincode} className="border-b border-gray-800/10 bg-gray-950/40">
                          <td className="py-1 pl-12 text-slate-500">
                            <div className="flex items-center gap-1.5">
                              <Hash size={9} className="text-slate-700 shrink-0"/>
                              <span className="font-mono text-[10px]">{pp.pincode}</span>
                              {/* fulfillment status badges */}
                              <div className="flex gap-1 ml-1">
                                {Object.entries(pp.statuses).slice(0, 3).map(([st, cnt]) => (
                                  <span key={st} className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                                    style={{
                                      background: st === 'fulfilled' ? '#05230f' : st === 'unfulfilled' ? '#220f05' : '#1c1c2e',
                                      color: st === 'fulfilled' ? '#22c55e' : st === 'unfulfilled' ? '#f59e0b' : '#94a3b8',
                                    }}>
                                    {st} ×{cnt}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1 tabular-nums text-slate-500 text-[10px]">{num(pp.orders)}</td>
                          <td className="px-2 py-1 tabular-nums text-slate-600 text-[10px]">{dec(pp.orders / (s.orders || 1) * 100, 1)}%</td>
                          <td className="px-2 py-1 tabular-nums text-emerald-400/60 text-[10px]">{cur(pp.revenue)}</td>
                          <td className="px-2 py-1 tabular-nums text-slate-600 text-[10px]">{cur(pp.aov)}</td>
                          <td className="px-2 py-1 text-slate-600 text-[10px]">{pp.fulfillStats ? hrs(pp.fulfillStats.avg) : '—'}</td>
                          <td className="px-2 py-1"><SLA stats={pp.fulfillStats}/></td>
                        </tr>
                      ))}
                      {cOpen && c.pincodes.length > 30 && (
                        <tr className="bg-gray-950/40">
                          <td colSpan={7} className="pl-12 py-1 text-[10px] text-slate-600">+{c.pincodes.length - 30} more pincodes</td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── MAIN PAGE ─────────────────────────────────────────────────── */
export default function ShopifyOps() {
  const { brands, shopifyOrders, brandData } = useStore();

  const shopifyBrands = (brands || []).filter(b => b.shopify?.shop);
  const [viewBrandId, setViewBrandId] = useState('all');
  const [selectedTags, setSelectedTags]    = useState([]);
  const [activeWh, setActiveWh]            = useState(null); // null = combined view
  const [chartMetric, setChartMetric]      = useState('orders');

  // Orders to analyze: filter by brand if selected
  const rawOrders = useMemo(() => {
    if (!shopifyOrders.length) return [];
    if (viewBrandId === 'all') return shopifyOrders;
    return shopifyOrders.filter(o => o._brandId === viewBrandId);
  }, [shopifyOrders, viewBrandId]);

  // Build ops geo data
  const ops = useMemo(() => buildOpsGeo(rawOrders, selectedTags), [rawOrders, selectedTags]);

  const { warehouses, tagList } = ops;

  // The "active" warehouse: if user clicked one, show its states; else show all combined
  const viewWh = activeWh ? warehouses.find(w => w.tag === activeWh) : null;

  // Combined states across all (or just the selected) warehouses
  const combinedStates = useMemo(() => {
    const source = viewWh ? [viewWh] : warehouses;
    const stateMap = {};
    source.forEach(wh => {
      (wh.states || []).forEach(s => {
        if (!stateMap[s.state]) stateMap[s.state] = { ...s, cities: {} };
        else {
          stateMap[s.state].orders   += s.orders;
          stateMap[s.state].revenue  += s.revenue;
        }
        // merge cities
        s.cities.forEach(c => {
          const ck = c.city;
          if (!stateMap[s.state].cities[ck]) {
            stateMap[s.state].cities[ck] = { ...c, pincodes: {} };
          } else {
            stateMap[s.state].cities[ck].orders  += c.orders;
            stateMap[s.state].cities[ck].revenue += c.revenue;
          }
          c.pincodes.forEach(pp => {
            const pk = pp.pincode;
            const target = stateMap[s.state].cities[ck].pincodes;
            if (!target[pk]) target[pk] = { ...pp };
            else {
              target[pk].orders  += pp.orders;
              target[pk].revenue += pp.revenue;
            }
          });
        });
      });
    });
    return Object.values(stateMap).map(s => ({
      ...s,
      aov: s.orders ? s.revenue / s.orders : 0,
      cities: Object.values(s.cities).map(c => ({
        ...c,
        aov: c.orders ? c.revenue / c.orders : 0,
        pincodes: Object.values(c.pincodes || {}).map(pp => ({
          ...pp,
          aov: pp.orders ? pp.revenue / pp.orders : 0,
        })).sort((a, b) => b.orders - a.orders),
      })).sort((a, b) => b.orders - a.orders),
    })).sort((a, b) => b.orders - a.orders);
  }, [viewWh, warehouses]);

  const totalOrders  = combinedStates.reduce((s, st) => s + st.orders, 0);
  const totalRevenue = combinedStates.reduce((s, st) => s + st.revenue, 0);

  // KPIs from raw active orders (fast)
  const totalActive = rawOrders.filter(o => !o.cancelled_at).length;
  const uniqueStates = new Set(
    rawOrders.filter(o => !o.cancelled_at).map(o => o.shipping_address?.province || o.billing_address?.province || 'Unknown')
  ).size;
  const uniquePins = new Set(
    rawOrders.filter(o => !o.cancelled_at).map(o => o.shipping_address?.zip || o.billing_address?.zip || '').filter(Boolean)
  ).size;

  // Chart data: top 15 states
  const chartData = combinedStates.slice(0, 15).map(s => ({
    state: s.state.length > 12 ? s.state.slice(0, 12) + '…' : s.state,
    orders: s.orders,
    revenue: s.revenue,
  }));

  // Tag toggle
  const toggleTag = tag => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    setActiveWh(null);
  };

  const hasData = rawOrders.length > 0;

  if (!shopifyBrands.length) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <Truck size={36} className="opacity-30" />
      <p className="text-sm">No Shopify brands configured — add credentials in Study Manual.</p>
    </div>
  );

  if (!hasData) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <Package size={36} className="opacity-30" />
      <p className="text-sm">No order data — fetch orders in Shopify Orders first.</p>
      <p className="text-xs text-slate-600">Orders are shared across both pages.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2.5 rounded-xl bg-emerald-500/20">
            <Truck size={18} className="text-emerald-400"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Shopify Ops</h1>
            <p className="text-[11px] text-slate-500">
              {num(totalActive)} active orders · {uniqueStates} states · {num(uniquePins)} pincodes
              {viewWh && <span className="ml-2 text-brand-400 font-semibold">→ {activeWh}</span>}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {shopifyBrands.length > 1 && (
            <select value={viewBrandId} onChange={e => setViewBrandId(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500">
              <option value="all">All brands</option>
              {shopifyBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button
            onClick={() => exportCSV('shopify-ops-geo.csv', combinedStates.flatMap(s =>
              s.cities.flatMap(c => c.pincodes.map(pp => ({
                state: s.state, city: c.city, pincode: pp.pincode,
                orders: pp.orders, revenue: pp.revenue, aov: pp.aov,
              })))
            ), [
              { key: 'state',   label: 'State' },
              { key: 'city',    label: 'City' },
              { key: 'pincode', label: 'Pincode' },
              { key: 'orders',  label: 'Orders' },
              { key: 'revenue', label: 'Revenue', fn: r => dec(r.revenue, 0) },
              { key: 'aov',     label: 'AOV',     fn: r => dec(r.aov, 0) },
            ])}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-colors">
            <Download size={11}/> Export Geo CSV
          </button>
        </div>
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Orders',    value: num(totalOrders),      icon: Package,      color: '#3b82f6' },
          { label: 'Total Revenue',    value: cur(totalRevenue),     icon: CheckCircle,  color: '#22c55e' },
          { label: 'States Reached',   value: num(uniqueStates),     icon: MapPin,       color: '#a78bfa' },
          { label: 'Unique Pincodes',  value: num(uniquePins),       icon: Hash,         color: '#f59e0b' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon size={13} style={{ color }}/>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{label}</span>
            </div>
            <div className="text-lg font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* ── Warehouse filter pills ──────────────────────────────────── */}
      {tagList.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Truck size={13} className="text-slate-400"/>
            <span className="text-xs font-semibold text-slate-300">Warehouse / Tag Filter</span>
            <span className="text-[10px] text-slate-600 ml-1">— select one to drill in, or view all combined</span>
            {selectedTags.length > 0 && (
              <button onClick={() => { setSelectedTags([]); setActiveWh(null); }}
                className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 underline">
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tagList.map(tag => {
              const wh  = warehouses.find(w => w.tag === tag);
              const sel = selectedTags.includes(tag);
              const act = activeWh === tag;
              return (
                <button key={tag}
                  onClick={() => toggleTag(tag)}
                  onDoubleClick={() => setActiveWh(prev => prev === tag ? null : tag)}
                  title={`Click to filter · Double-click to drill into "${tag}"`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                    act
                      ? 'bg-brand-600/30 border-brand-500/60 text-brand-200'
                      : sel
                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200'
                  }`}>
                  <Truck size={9}/>
                  {tag}
                  {wh && <span className="text-[9px] opacity-60 ml-0.5">·{num(wh.orders)}</span>}
                </button>
              );
            })}
          </div>
          {warehouses.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-600">Drill into:</span>
              {warehouses.slice(0, 10).map(wh => (
                <button key={wh.tag}
                  onClick={() => setActiveWh(prev => prev === wh.tag ? null : wh.tag)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all border ${
                    activeWh === wh.tag
                      ? 'bg-brand-600/30 border-brand-500/50 text-brand-300'
                      : 'border-gray-700 text-slate-500 hover:text-slate-300'
                  }`}>
                  {wh.tag} ({num(wh.orders)})
                </button>
              ))}
              {warehouses.length > 10 && <span className="text-[10px] text-slate-600">+{warehouses.length - 10} more</span>}
            </div>
          )}
        </div>
      )}

      {/* ── Warehouse summary table ─────────────────────────────────── */}
      {warehouses.length > 0 && !activeWh && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-xs font-semibold text-slate-300 mb-3">Warehouse Summary</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-700">
                  {['Warehouse / Tag','Orders','Revenue','AOV','Avg Fulfillment','SLA <24h'].map(h => (
                    <th key={h} className="px-2 py-2 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {warehouses.map(wh => {
                  const totalWh = warehouses.reduce((s, w) => s + w.orders, 0) || 1;
                  return (
                    <tr key={wh.tag}
                      className="border-b border-gray-800/40 cursor-pointer hover:bg-gray-800/30 transition-colors"
                      onClick={() => setActiveWh(prev => prev === wh.tag ? null : wh.tag)}>
                      <td className="px-0 py-2 font-semibold text-slate-200 flex items-center gap-1.5">
                        <Truck size={11} className="text-slate-500 shrink-0"/>
                        {wh.tag}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-brand-500/70" style={{ width: `${wh.orders / totalWh * 100}%` }}/>
                          </div>
                          <span className="font-semibold text-slate-200 tabular-nums">{num(wh.orders)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 tabular-nums text-emerald-400 font-semibold">{cur(wh.revenue)}</td>
                      <td className="px-2 py-2 tabular-nums text-slate-400">{cur(wh.revenue / (wh.orders || 1))}</td>
                      <td className="px-2 py-2 text-slate-400">{wh.fulfillStats ? hrs(wh.fulfillStats.avg) : '—'}</td>
                      <td className="px-2 py-2"><SLA stats={wh.fulfillStats}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Geo bar chart ───────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-300">
              Orders by State{activeWh ? ` — ${activeWh}` : ''}
            </h2>
            <div className="flex gap-1">
              {[['orders','Orders'],['revenue','Revenue']].map(([k,l]) => (
                <button key={k} onClick={() => setChartMetric(k)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                    chartMetric === k ? 'bg-brand-600/30 text-brand-300' : 'text-slate-500 hover:text-slate-300'
                  }`}>{l}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={chartMetric === 'revenue' ? v => `₹${(v/1000).toFixed(0)}k` : undefined}/>
              <YAxis type="category" dataKey="state" width={90} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip
                formatter={(v, n) => [chartMetric === 'revenue' ? cur(v) : num(v), n]}
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
              />
              <Bar dataKey={chartMetric} name={chartMetric === 'orders' ? 'Orders' : 'Revenue'} radius={[0, 3, 3, 0]} maxBarSize={18}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={`hsl(${210 + i * 8}, 70%, ${55 - i * 1.5}%)`}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── State → City → Pincode drill-down table ────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-xs font-semibold text-slate-300">
            {activeWh
              ? `State → City → Pincode — ${activeWh}`
              : selectedTags.length
                ? `State → City → Pincode — ${selectedTags.join(', ')}`
                : 'State → City → Pincode — All Warehouses Combined'}
          </h2>
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <span>Click state to expand cities · click city to expand pincodes</span>
          </div>
        </div>
        <GeoTable states={combinedStates} totalOrders={totalOrders}/>
      </div>
    </div>
  );
}
