import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts';
import {
  Star, TrendingUp, Package, AlertTriangle, Award, Target,
  Layers, GitMerge, ChevronRight, Search, RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { fmt } from '../lib/analytics';
import { buildStarProducts, PRESETS, ACTION_STYLES } from '../lib/starProducts';
import { pullBrandOrders90d } from '../lib/autoPull';
import MetricCard from '../components/ui/MetricCard';

/* ─── persisted plan margin (mirrors BusinessPlan storage key) ─── */
const lsBplanKey = id => `taos_bplan_v7_${id || 'default'}`;
function loadPlanMargin(brandId) {
  try {
    const r = localStorage.getItem(lsBplanKey(brandId));
    if (!r) return 0.50;
    const plan = JSON.parse(r);
    return plan?.grossMarginPct ?? 0.50;
  } catch { return 0.50; }
}

function BrandPicker({ brands, selected, onChange }) {
  if (!brands?.length) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500">Brand:</span>
      {brands.map(b => (
        <button
          key={b.id}
          onClick={() => onChange(b.id)}
          className={clsx(
            'px-3 py-1 rounded-lg text-xs font-medium border transition-all',
            selected === b.id
              ? 'border-amber-500 text-amber-300 bg-amber-900/20'
              : 'border-gray-700 text-slate-400 hover:border-gray-600',
          )}
        >
          {b.name}
        </button>
      ))}
    </div>
  );
}

function PresetToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500">Weighting:</span>
      {Object.entries(PRESETS).map(([id, p]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={p.desc}
          className={clsx(
            'px-3 py-1 rounded-lg text-xs font-medium border transition-all',
            value === id
              ? 'border-amber-500 text-amber-300 bg-amber-900/20'
              : 'border-gray-700 text-slate-400 hover:border-gray-600',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function WindowToggle({ value, onChange }) {
  const opts = [
    { id: 7,   label: '7d' },
    { id: 14,  label: '14d' },
    { id: 30,  label: '30d' },
    { id: 60,  label: '60d' },
    { id: 90,  label: '90d' },
    { id: 180, label: '180d' },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500">Window:</span>
      <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {opts.map(o => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={clsx(
              'px-2.5 py-1 text-[11px] font-medium transition-colors',
              value === o.id ? 'bg-amber-900/40 text-amber-300' : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Concentration ribbon ─────────────────────────────────────── */
function ConcentrationRibbon({ concentration, summary }) {
  const hhiLabel = concentration.hhi < 1500 ? 'Healthy'
                 : concentration.hhi < 2500 ? 'Moderate'
                 : 'Concentrated';
  const hhiColor = concentration.hhi < 1500 ? 'green'
                 : concentration.hhi < 2500 ? 'amber'
                 : 'red';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        label="HHI (Revenue)" value={Math.round(concentration.hhi).toLocaleString()}
        sub={hhiLabel} icon={Target} color={hhiColor}
      />
      <MetricCard
        label="Top 5 SKU Share" value={fmt.pct(concentration.top5Share * 100)}
        sub={`Top 10: ${fmt.pct(concentration.top10Share * 100)}`}
        icon={Layers} color="blue"
      />
      <MetricCard
        label="Gateway Top 3" value={fmt.pct(concentration.gatewayTop3Share * 100)}
        sub="Of new-customer orders" icon={Award} color="purple"
      />
      <MetricCard
        label="Basket Depth" value={fmt.pct(summary.multiItemRate * 100)}
        sub={`${summary.multiItemOrders} multi-item orders`}
        icon={GitMerge} color="teal"
      />
    </div>
  );
}

/* ─── Action distribution bar ──────────────────────────────────── */
function ActionBar({ counts, total }) {
  const order = ['DOUBLE DOWN', 'MILK', 'BET', 'BUNDLE', 'EXIT', 'INVESTIGATE'];
  const keyMap = { 'DOUBLE DOWN': 'doubleDown', MILK: 'milk', BET: 'bet', BUNDLE: 'bundle', EXIT: 'exit', INVESTIGATE: 'investigate' };
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
      <div className="text-xs text-slate-500 mb-3 uppercase tracking-wide font-semibold">Portfolio Mix · {total} SKUs</div>
      <div className="flex h-6 rounded-lg overflow-hidden">
        {order.map(action => {
          const c = counts[keyMap[action]] || 0;
          const pct = total > 0 ? (c / total) * 100 : 0;
          if (!c) return null;
          const style = ACTION_STYLES[action];
          return (
            <div
              key={action}
              style={{ width: `${pct}%`, background: style.color }}
              title={`${action}: ${c} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px]">
        {order.map(action => {
          const c = counts[keyMap[action]] || 0;
          if (!c) return null;
          const style = ACTION_STYLES[action];
          return (
            <div key={action} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: style.color }} />
              <span className={clsx('font-semibold', style.text)}>{action}</span>
              <span className="text-slate-500">{c}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Opportunity Map (scatter) ─────────────────────────────────── */
function OpportunityMap({ skus, medians }) {
  const data = skus
    .filter(s => s.action !== 'INVESTIGATE')
    .map(s => ({
      x: s.econRank * 100,
      y: s.stratRank * 100,
      z: Math.max(1, s.revenueWindow),
      name: s.name, sku: s.sku,
      action: s.action,
      revenue: s.revenueWindow,
      momentum: s.momentum,
      gatewayRate: s.gatewayRate,
      repeatRate: s.repeatRate,
      starScore: s.starScore,
    }));

  const groups = {};
  data.forEach(d => { (groups[d.action] = groups[d.action] || []).push(d); });

  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-200">Opportunity Map</div>
        <div className="text-[10px] text-slate-500">Economic Value × Strategic Value · bubble = revenue</div>
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 0 }}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis
            type="number" dataKey="x" domain={[0, 100]}
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'Economic Value →', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            type="number" dataKey="y" domain={[0, 100]}
            tick={{ fill: '#64748b', fontSize: 11 }}
            label={{ value: 'Strategic Value →', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="z" range={[40, 400]} />
          <ReferenceLine x={medians.econ * 100} stroke="#475569" strokeDasharray="4 4" />
          <ReferenceLine y={medians.strat * 100} stroke="#475569" strokeDasharray="4 4" />
          <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
          {Object.entries(groups).map(([action, points]) => (
            <Scatter
              key={action} name={action} data={points}
              fill={ACTION_STYLES[action]?.color || '#64748b'}
              fillOpacity={0.7}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-4 gap-2 mt-2 text-[10px] text-slate-500">
        <div className="text-left">EXIT (low/low)</div>
        <div className="text-left">MILK (high econ)</div>
        <div className="text-right">BET / BUNDLE (high strat)</div>
        <div className="text-right">DOUBLE DOWN (high/high)</div>
      </div>
    </div>
  );
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const style = ACTION_STYLES[d.action];
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs space-y-1 min-w-[220px]">
      <div className="font-semibold text-slate-200 truncate">{d.name}</div>
      <div className="text-[10px] text-slate-500 font-mono">{d.sku}</div>
      <div className={clsx('inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold', style?.bg, style?.text)}>{d.action}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1.5">
        <span className="text-slate-400">Star Score</span>  <span className="text-white font-semibold text-right">{d.starScore.toFixed(1)}</span>
        <span className="text-slate-400">Revenue</span>     <span className="text-white font-semibold text-right">{fmt.currency(d.revenue)}</span>
        <span className="text-slate-400">Momentum</span>    <span className={clsx('font-semibold text-right', d.momentum >= 0 ? 'text-emerald-400' : 'text-red-400')}>{(d.momentum * 100).toFixed(1)}%</span>
        <span className="text-slate-400">Gateway</span>     <span className="text-white text-right">{fmt.pct(d.gatewayRate * 100)}</span>
        <span className="text-slate-400">Repeat</span>      <span className="text-white text-right">{fmt.pct(d.repeatRate * 100)}</span>
      </div>
    </div>
  );
}

/* ─── Bundle Radar ─────────────────────────────────────────────── */
function BundleRadar({ bundles }) {
  if (!bundles.length) {
    return (
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-6 text-center text-sm text-slate-500">
        No qualifying co-purchase pairs (need 3+ co-occurrences with lift &gt; 1.2).
      </div>
    );
  }
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-200">Bundle Radar</div>
        <div className="text-[10px] text-slate-500">Top co-purchase pairs by lift × volume</div>
      </div>
      <div className="space-y-1.5">
        {bundles.slice(0, 10).map(b => (
          <div key={`${b.a}|${b.b}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2 bg-gray-800/40 rounded-lg text-xs">
            <div className="truncate">
              <span className="text-slate-200 font-medium">{b.nameA}</span>
              <span className="text-slate-600 mx-1.5">+</span>
              <span className="text-slate-200 font-medium">{b.nameB}</span>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Lift</div>
              <div className="text-amber-300 font-bold tabular-nums">{b.lift.toFixed(2)}×</div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Conf</div>
              <div className="text-sky-300 tabular-nums">{(b.confidence * 100).toFixed(0)}%</div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Orders</div>
              <div className="text-white font-semibold tabular-nums">{b.count}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Decision Table ───────────────────────────────────────────── */
function DecisionTable({ skus, search, actionFilter }) {
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skus.filter(s => {
      if (actionFilter !== 'all' && s.action !== actionFilter) return false;
      if (!q) return true;
      return s.sku.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q);
    });
  }, [skus, search, actionFilter]);

  if (!rows.length) {
    return (
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-8 text-center text-sm text-slate-500">
        No SKUs match the current filter.
      </div>
    );
  }

  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 overflow-hidden">
      <div className="overflow-x-auto max-h-[560px]">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/90 sticky top-0 z-10">
            <tr className="text-left text-slate-500 font-semibold">
              <th className="px-3 py-2.5">SKU</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5 text-right">Star</th>
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">Share</th>
              <th className="px-3 py-2.5 text-right">Momentum</th>
              <th className="px-3 py-2.5 text-right">Gateway</th>
              <th className="px-3 py-2.5 text-right">Repeat</th>
              <th className="px-3 py-2.5 text-right">Bundle</th>
              <th className="px-3 py-2.5 text-right">DoS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const style = ACTION_STYLES[s.action];
              return (
                <tr key={s.sku} className={clsx('border-t border-gray-800/50', i % 2 === 0 ? 'bg-gray-950/40' : '')}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-200 truncate max-w-[220px]">{s.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{s.sku}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx('inline-block px-2 py-0.5 rounded text-[10px] font-bold border', style.bg, style.text, style.border)}>
                      {s.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-white">{s.starScore.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmt.currency(s.revenueWindow)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{fmt.pct(s.revenueShare * 100)}</td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums font-semibold', s.momentum >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.momentum >= 0 ? '+' : ''}{(s.momentum * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmt.pct(s.gatewayRate * 100)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmt.pct(s.repeatRate * 100)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmt.pct(s.bundleRate * 100)}</td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums', s.daysOfStock == null ? 'text-slate-600' : s.daysOfStock < 14 ? 'text-red-400' : s.daysOfStock < 30 ? 'text-amber-400' : 'text-slate-400')}>
                    {s.daysOfStock == null ? '—' : `${Math.round(s.daysOfStock)}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── "X minutes ago" ──────────────────────────────────────────── */
function timeAgo(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/* ─── MAIN PAGE ────────────────────────────────────────────────── */
export default function StarProducts() {
  const { brands, activeBrandIds, brandData, setBrandOrders, setBrandOrdersStatus } = useStore();

  const defaultViewId = brands.find(b => activeBrandIds.includes(b.id))?.id || activeBrandIds[0] || brands[0]?.id;
  const [viewingBrandId, setViewingBrandId] = useState(defaultViewId);
  const [preset, setPreset]         = useState('balanced');
  const [windowDays, setWindowDays] = useState(90);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch]         = useState('');
  const [fetching, setFetching]     = useState(false);
  const [fetchErr, setFetchErr]     = useState(null);

  useEffect(() => {
    if (viewingBrandId && !brands.some(b => b.id === viewingBrandId)) {
      setViewingBrandId(brands[0]?.id);
    }
  }, [brands, viewingBrandId]);

  const bData = brandData?.[viewingBrandId] || {};
  const orders       = bData.orders || [];
  const inventoryMap = bData.inventoryMap || {};
  const ordersFetchedAt = bData.ordersFetchedAt;
  const ordersStatus    = bData.ordersStatus;

  const selectedBrandObj = brands.find(b => b.id === viewingBrandId);

  const handleFetch = useCallback(async () => {
    if (!selectedBrandObj) return;
    setFetching(true); setFetchErr(null);
    const res = await pullBrandOrders90d(selectedBrandObj, setBrandOrders, setBrandOrdersStatus);
    setFetching(false);
    if (!res.ok) setFetchErr(res.error || res.reason || 'Fetch failed');
  }, [selectedBrandObj, setBrandOrders, setBrandOrdersStatus]);

  const plan = useMemo(() => ({ grossMarginPct: loadPlanMargin(viewingBrandId) }), [viewingBrandId]);

  const analysis = useMemo(
    () => buildStarProducts({ orders, inventoryMap, plan, preset, windowDays }),
    [orders, inventoryMap, plan, preset, windowDays],
  );

  const { skus, summary, concentration, bundles, medians } = analysis;

  const hasShopifyConfig = selectedBrandObj?.shopify?.shop && selectedBrandObj?.shopify?.clientId;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Star size={18} className="text-amber-400" /> Star Products
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Per-brand portfolio decisions · Economic Value × Strategic Value · {summary.totalSkus} SKUs · {windowDays}d window
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={handleFetch}
              disabled={fetching || !hasShopifyConfig}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all',
                fetching
                  ? 'border-amber-700 text-amber-400 bg-amber-900/20'
                  : 'border-amber-700/60 text-amber-300 bg-amber-900/10 hover:bg-amber-900/30 disabled:opacity-40',
              )}
            >
              <RefreshCw size={11} className={fetching ? 'animate-spin' : ''} />
              {fetching ? 'Fetching 90d…' : 'Fetch 90 days'}
            </button>
            {ordersFetchedAt && !fetching && (
              <span className="text-[10px] text-slate-500">Last fetched {timeAgo(ordersFetchedAt)} · {orders.length.toLocaleString()} orders</span>
            )}
            {fetchErr && <span className="text-[10px] text-red-400">{fetchErr}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <BrandPicker brands={brands} selected={viewingBrandId} onChange={setViewingBrandId} />
          <div className="flex items-center gap-4">
            <PresetToggle value={preset} onChange={setPreset} />
            <WindowToggle value={windowDays} onChange={setWindowDays} />
          </div>
        </div>
      </div>

      {/* Empty states */}
      {!hasShopifyConfig ? (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-8 text-center text-sm text-slate-400">
          <Package size={28} className="mx-auto text-slate-600 mb-3" />
          Shopify isn't configured for this brand. Add credentials in Study Manual.
        </div>
      ) : !orders.length ? (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-8 text-center text-sm text-slate-400">
          <Package size={28} className="mx-auto text-slate-600 mb-3" />
          No Shopify orders loaded for this brand yet. Pull from Study Manual or Shopify Orders.
        </div>
      ) : !skus.length ? (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-8 text-center text-sm text-slate-400">
          <AlertTriangle size={28} className="mx-auto text-amber-500/80 mb-3" />
          No SKUs in the last {windowDays}d window. Try widening the window.
        </div>
      ) : (
        <>
          <ConcentrationRibbon concentration={concentration} summary={summary} />

          <ActionBar counts={summary.counts} total={summary.totalSkus} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <OpportunityMap skus={skus} medians={medians} />
            </div>
            <div>
              <BundleRadar bundles={bundles} />
            </div>
          </div>

          {/* Notes */}
          <div className="bg-gray-900/40 rounded-xl border border-gray-800/40 p-3 text-[11px] text-slate-500 flex items-start gap-2">
            <AlertTriangle size={13} className="text-amber-500/80 shrink-0 mt-0.5" />
            <div>
              Margin proxy: <span className="text-slate-300 font-semibold">{(summary.marginPctUsed * 100).toFixed(0)}%</span> (from Business Plan). For per-SKU COGS precision, enter cost per SKU in the plan later.
              Thin-data SKUs (&lt; {Math.min(60, Math.max(3, Math.round(windowDays * 0.4)))} days of history or &lt; 5 orders) are flagged INVESTIGATE — excluded from quadrant placement but shown in the table.
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search SKU or name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-slate-500 mr-1">Filter:</span>
              {['all', 'DOUBLE DOWN', 'MILK', 'BET', 'BUNDLE', 'EXIT', 'INVESTIGATE'].map(a => (
                <button
                  key={a}
                  onClick={() => setActionFilter(a)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                    actionFilter === a
                      ? 'border-amber-500 text-amber-300 bg-amber-900/20'
                      : 'border-gray-800 text-slate-500 hover:text-slate-300',
                  )}
                >
                  {a === 'all' ? 'All' : a}
                </button>
              ))}
            </div>
          </div>

          <DecisionTable skus={skus} search={search} actionFilter={actionFilter} />
        </>
      )}
    </div>
  );
}
