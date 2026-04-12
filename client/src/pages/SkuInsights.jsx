import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, TrendingUp, ShoppingBag, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useStore } from '../store';
import MetricCard from '../components/ui/MetricCard';
import DataTable from '../components/ui/DataTable';
import ManualEditDrawer from '../components/ui/ManualEditDrawer';
import AdDetailDrawer from '../components/ui/AdDetailDrawer';
import Spinner from '../components/ui/Spinner';
import { buildPatternSummary, aggregateMetrics, fmt, safeNum } from '../lib/analytics';

/* ─── HELPERS ────────────────────────────────────────────────────── */

const COLORS = [
  '#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399',
  '#fb923c','#60a5fa','#e879f9','#4ade80','#c084fc','#38bdf8',
  '#fde68a','#d946ef','#84cc16',
];

const DECISION_COLORS = {
  'Scale Hard':      '#22c55e',
  'Scale Carefully': '#34d399',
  'Defend':          '#38bdf8',
  'Fix':             '#fbbf24',
  'Watch':           '#94a3b8',
  'Kill':            '#ef4444',
};

const roasColor = v => {
  const n = safeNum(v);
  if (n >= 5) return '#22c55e';
  if (n >= 3) return '#f59e0b';
  if (n >= 1.5) return '#f97316';
  return '#ef4444';
};

const SkuTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs space-y-1 min-w-[180px]">
      <div className="font-semibold text-slate-200">{d.label}</div>
      <div className="text-slate-400">Ads: <span className="text-white">{d.count}</span></div>
      <div className="text-slate-400">Spend: <span className="text-white">{fmt.currency(d.spend)}</span></div>
      <div className="text-slate-400">ROAS: <span style={{ color: roasColor(d.roas) }} className="font-bold">{fmt.roas(d.roas)}</span></div>
      <div className="text-slate-400">CPR: <span className="text-white">{fmt.currency(d.cpr)}</span></div>
      <div className="text-slate-400">Purchases: <span className="text-white">{fmt.number(d.purchases)}</span></div>
      <div className="text-slate-400">Revenue: <span className="text-white">{fmt.currency(d.revenue)}</span></div>
    </div>
  );
};

/* ─── SUB-COMPONENTS ─────────────────────────────────────────────── */

function SkuCollectionMatrix({ rows }) {
  const skus        = useMemo(() => [...new Set(rows.map(r => r.sku).filter(Boolean))].sort(), [rows]);
  const collections = useMemo(() => [...new Set(rows.map(r => r.collection || '').filter(Boolean))].sort(), [rows]);

  const cellMap = useMemo(() => {
    const map = {};
    rows.forEach(r => {
      const k = `${r.sku}||${r.collection || ''}`;
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return map;
  }, [rows]);

  if (!skus.length || !collections.length) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        No SKU × Collection data — fill the Collection column in your CSV.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-3 py-2.5 text-left text-slate-400 font-semibold whitespace-nowrap sticky left-0 bg-gray-900 z-10 border-b border-gray-800">
              SKU
            </th>
            {collections.map(col => (
              <th key={col} className="px-3 py-2.5 text-center text-slate-400 font-semibold whitespace-nowrap border-b border-gray-800">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {skus.map((sku, i) => (
            <tr key={sku} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
              <td className="px-3 py-2 font-semibold text-slate-200 sticky left-0 bg-inherit z-10 whitespace-nowrap border-r border-gray-800/50">
                {sku}
              </td>
              {collections.map(col => {
                const cellRows = cellMap[`${sku}||${col}`];
                const agg      = cellRows ? aggregateMetrics(cellRows) : null;
                return (
                  <td key={col} className="px-3 py-2 text-center whitespace-nowrap">
                    {agg && safeNum(agg.spend) > 0 ? (
                      <div>
                        <div className="font-bold" style={{ color: roasColor(agg.roas) }}>
                          {fmt.roas(agg.roas)}
                        </div>
                        <div className="text-slate-500 text-[10px]">{fmt.currency(agg.spend)}</div>
                        <div className="text-slate-600 text-[10px]">{fmt.number(agg.purchases)} conv</div>
                      </div>
                    ) : (
                      <span className="text-gray-800">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-600 mt-3">
        Each cell: ROAS / Spend / Purchases for that SKU × Collection combination.
      </p>
    </div>
  );
}

function DecisionBreakdown({ skuSummary, skuDecisions }) {
  const DECISIONS = ['Scale Hard', 'Scale Carefully', 'Defend', 'Fix', 'Watch', 'Kill'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="px-2 py-2 text-left text-slate-500 font-semibold">SKU</th>
            <th className="px-2 py-2 text-right text-slate-500 font-semibold">Ads</th>
            <th className="px-2 py-2 text-right text-slate-500 font-semibold">Spend</th>
            <th className="px-2 py-2 text-right text-slate-500 font-semibold">ROAS</th>
            {DECISIONS.map(d => (
              <th key={d} className="px-3 py-2 text-center text-slate-500 font-semibold whitespace-nowrap">
                <span style={{ color: DECISION_COLORS[d] }}>{d}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {skuSummary.map((s, i) => {
            const decs = skuDecisions[s.label] || {};
            const total = Object.values(decs).reduce((a, b) => a + b, 0);
            return (
              <tr key={s.label} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
                <td className="px-2 py-2.5 font-semibold text-slate-200 whitespace-nowrap">{s.label}</td>
                <td className="px-2 py-2.5 text-right text-slate-400">{s.count}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt.currency(s.spend)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums font-semibold" style={{ color: roasColor(s.roas) }}>
                  {fmt.roas(s.roas)}
                </td>
                {DECISIONS.map(d => {
                  const n = decs[d] || 0;
                  return (
                    <td key={d} className="px-3 py-2.5 text-center tabular-nums">
                      {n > 0 ? (
                        <div>
                          <span style={{ color: DECISION_COLORS[d] }} className="font-semibold">{n}</span>
                          {total > 0 && (
                            <span className="text-slate-600 text-[10px] ml-1">
                              {((n / total) * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-800">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── PAGE ───────────────────────────────────────────────────────── */

/* ─── STOCK BADGE ────────────────────────────────────────────────── */

function StockBadge({ stock }) {
  if (stock == null) return <span className="text-slate-700">—</span>;
  const n = safeNum(stock);
  if (n <= 0)  return <span className="text-red-400 font-semibold">Out</span>;
  if (n < 10)  return <span className="text-amber-400 font-semibold">{n} ⚠</span>;
  return <span className="text-emerald-400">{n}</span>;
}

export default function SkuInsights() {
  const { enrichedRows, fetchStatus, inventoryMap } = useStore();
  const [tab, setTab]     = useState('overview');
  const [editRow, setEditRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);

  const hasInventory = Object.keys(inventoryMap).length > 0;

  const skuRows = useMemo(
    () => enrichedRows.filter(r => r.sku && r.sku !== ''),
    [enrichedRows],
  );

  const skuSummary = useMemo(
    () => buildPatternSummary(skuRows, 'sku').filter(s => s.label && s.label !== 'Unknown'),
    [skuRows],
  );

  const skuDecisions = useMemo(() => {
    const map = {};
    skuRows.forEach(r => {
      const sku = r.sku;
      if (!sku) return;
      if (!map[sku]) map[sku] = {};
      const dec = r.decision || 'Watch';
      map[sku][dec] = (map[sku][dec] || 0) + 1;
    });
    return map;
  }, [skuRows]);

  const skuCollections = useMemo(() => {
    const map = {};
    skuRows.forEach(r => {
      if (!r.sku) return;
      if (!map[r.sku]) map[r.sku] = new Set();
      if (r.collection) map[r.sku].add(r.collection);
    });
    return map;
  }, [skuRows]);

  const kpis = useMemo(() => {
    if (!skuSummary.length) return null;
    const topByRoas      = skuSummary[0];
    const topByRevenue   = [...skuSummary].sort((a, b) => safeNum(b.revenue)   - safeNum(a.revenue))[0];
    const topByPurchases = [...skuSummary].sort((a, b) => safeNum(b.purchases) - safeNum(a.purchases))[0];
    return { totalSkus: skuSummary.length, topByRoas, topByRevenue, topByPurchases };
  }, [skuSummary]);

  const roasChartData    = useMemo(() => skuSummary.slice(0, 15), [skuSummary]);
  const revenueChartData = useMemo(() => [...skuSummary].sort((a, b) => safeNum(b.revenue) - safeNum(a.revenue)).slice(0, 15), [skuSummary]);
  const spendChartData   = useMemo(() => [...skuSummary].sort((a, b) => safeNum(b.spend)   - safeNum(a.spend)).slice(0, 15), [skuSummary]);

  const tableColumns = [
    { key: 'sku',          label: 'SKU',         width: 120,
      render: (v) => {
        const inv = v ? inventoryMap[v.toUpperCase()] : null;
        return (
          <div>
            <span className="font-semibold text-slate-200">{v || '—'}</span>
            {inv && <div className="text-[10px] text-slate-500 truncate" title={inv.title}>{inv.title}</div>}
          </div>
        );
      }},
    { key: 'skuStock',     label: 'Stock',       width: 70,   sortable: false,
      render: (_v, row) => <StockBadge stock={row.sku ? inventoryMap[row.sku.toUpperCase()]?.stock : null} /> },
    { key: 'collection',   label: 'Collection',  width: 110 },
    { key: 'adName',       label: 'Ad Name',     width: 220,
      render: v => <span className="break-words whitespace-normal leading-snug text-slate-200" title={v}>{v || '—'}</span> },
    { key: 'accountKey',   label: 'Account',     width: 90 },
    { key: 'decision',     label: 'Decision',    width: 120,
      render: v => <span style={{ color: DECISION_COLORS[v] || '#94a3b8' }} className="font-semibold">{v}</span> },
    { key: 'spend',        label: 'Spend',       width: 90,  align: 'right', render: v => fmt.currency(v) },
    { key: 'metaRoas',     label: 'ROAS',        width: 75,  align: 'right',
      render: v => <span style={{ color: roasColor(v) }} className="font-bold">{fmt.roas(v)}</span> },
    { key: 'metaCpr',      label: 'CPR',         width: 80,  align: 'right', render: v => fmt.currency(v) },
    { key: 'purchases',    label: 'Purchases',   width: 90,  align: 'right', render: v => fmt.number(v) },
    { key: 'revenue',      label: 'Revenue',     width: 100, align: 'right', render: v => fmt.currency(v) },
    { key: 'spend30d',     label: 'Spend 30D',   width: 95,  align: 'right', render: v => fmt.currency(v) },
    { key: 'metaRoas30d',  label: 'ROAS 30D',    width: 85,  align: 'right', render: v => fmt.roas(v) },
    { key: 'trendSignal',  label: 'Trend',       width: 150,
      render: v => <span className="text-slate-400 text-[11px]">{v || '—'}</span> },
    { key: 'creator',      label: 'Creator',     width: 100 },
    { key: 'campaignType', label: 'Camp. Type',  width: 100 },
  ];

  /* ── Empty / loading states ─────────────────────────────────── */

  if (fetchStatus === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Package size={40} className="opacity-30" />
        <p className="text-sm">Pull Meta data first to see SKU insights.</p>
        <p className="text-xs text-slate-600">Then import your CSV with the SKU column filled in.</p>
      </div>
    );
  }

  if (fetchStatus === 'loading') {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  if (!skuRows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Package size={40} className="opacity-30" />
        <p className="text-sm font-medium">No SKU data found.</p>
        <p className="text-xs text-slate-600 max-w-sm text-center">
          Fill the <strong className="text-slate-400">SKU</strong> column in your manual CSV,
          import it on the Study Manual page, then re-fetch or rebuild.
        </p>
      </div>
    );
  }

  const TABS = [
    { id: 'overview',  label: 'Performance' },
    { id: 'stock',     label: hasInventory ? 'Stock Risk ⚠' : 'Stock Risk' },
    { id: 'matrix',    label: 'SKU × Collection' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'table',     label: 'Ad-level Table' },
  ];

  // Stock risk: join inventory with spend data
  const stockRiskRows = useMemo(() => {
    const totalSpend = skuSummary.reduce((t, x) => t + safeNum(x.spend), 0);
    return skuSummary.map(s => {
      const inv = inventoryMap[s.label.toUpperCase()] || {};
      const stock = inv.stock ?? null;
      const price = safeNum(inv.price);
      const dailyPurchases = s.purchases / 7; // 7D purchases ÷ 7 days
      const daysRunway = (stock != null && dailyPurchases > 0) ? Math.round(stock / dailyPurchases) : null;
      const weeksOfSupply = (stock != null && dailyPurchases > 0) ? +(stock / (dailyPurchases * 7)).toFixed(1) : null;
      const spendShare = totalSpend > 0 ? safeNum(s.spend) / totalSpend * 100 : 0;

      // Reorder point: flag when ≤ 14 days of supply remain
      const reorderPoint = dailyPurchases > 0 ? Math.ceil(dailyPurchases * 14) : null;
      const needsReorder = stock !== null && reorderPoint !== null && stock <= reorderPoint && stock > 0;

      // Lost revenue: out-of-stock SKUs × daily demand × price × 14 days (forward estimate)
      const lostRevenue = (stock !== null && stock <= 0 && dailyPurchases > 0 && price > 0)
        ? dailyPurchases * price * 14
        : 0;

      // Risk score: high spend + low stock = critical
      let riskLevel = 'ok';
      if (stock === null)                                             riskLevel = 'unknown';
      else if (stock <= 0)                                           riskLevel = 'out';
      else if (spendShare >= 5 && stock < 10)                        riskLevel = 'critical';
      else if (spendShare >= 2 && stock < 20)                        riskLevel = 'high';
      else if (stock < 30 || (daysRunway !== null && daysRunway < 7)) riskLevel = 'medium';

      return {
        sku: s.label,
        productName: inv.title || '—',
        price,
        stock,
        spend: s.spend,
        spendShare,
        roas: s.roas,
        cpr: s.cpr,
        purchases: s.purchases,
        revenue: s.revenue,
        dailyPurchases,
        daysRunway,
        weeksOfSupply,
        reorderPoint,
        needsReorder,
        lostRevenue,
        riskLevel,
      };
    }).sort((a, b) => {
      const order = { out: 0, critical: 1, high: 2, medium: 3, unknown: 4, ok: 5 };
      const byRisk = (order[a.riskLevel] ?? 5) - (order[b.riskLevel] ?? 5);
      return byRisk !== 0 ? byRisk : b.spend - a.spend;
    });
  }, [skuSummary, inventoryMap]);

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/20">
          <Package size={20} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">SKU Intelligence</h1>
          <p className="text-sm text-slate-500 mt-1">
            {skuSummary.length} SKUs tracked across {skuRows.length} ads
          </p>
        </div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard label="SKUs Tracked" value={kpis.totalSkus} icon={Package} color="blue" />
          <MetricCard
            label="Top SKU — ROAS"
            value={fmt.roas(kpis.topByRoas.roas)}
            sub={kpis.topByRoas.label}
            icon={TrendingUp}
            color="green"
          />
          <MetricCard
            label="Top SKU — Revenue"
            value={fmt.currency(kpis.topByRevenue.revenue)}
            sub={kpis.topByRevenue.label}
            icon={DollarSign}
            color="purple"
          />
          <MetricCard
            label="Top SKU — Purchases"
            value={fmt.number(kpis.topByPurchases.purchases)}
            sub={kpis.topByPurchases.label}
            icon={ShoppingBag}
            color="amber"
          />
        </div>
      )}

      {/* ── Tab Nav ──────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === t.id
                ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Performance Overview ─────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* ROAS by SKU */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">ROAS by SKU (top 15)</h2>
              <ResponsiveContainer width="100%" height={Math.max(240, roasChartData.length * 28)}>
                <BarChart data={roasChartData} layout="vertical" margin={{ right: 48, left: 0 }}>
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }}
                    tickFormatter={v => v.toFixed(1) + 'x'} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={120}
                    tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SkuTooltip />} />
                  <Bar dataKey="roas" name="ROAS" radius={[0, 4, 4, 0]} label={{ position: 'right', formatter: v => v.toFixed(1)+'x', fill: '#64748b', fontSize: 10 }}>
                    {roasChartData.map((d, i) => <Cell key={i} fill={roasColor(d.roas)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Revenue by SKU */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Revenue by SKU (top 15)</h2>
              <ResponsiveContainer width="100%" height={Math.max(240, revenueChartData.length * 28)}>
                <BarChart data={revenueChartData} layout="vertical" margin={{ right: 48, left: 0 }}>
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }}
                    tickFormatter={v => '₹' + (v / 1000).toFixed(0) + 'k'} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={120}
                    tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SkuTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]}>
                    {revenueChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* Spend by SKU */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Spend by SKU (top 15)</h2>
            <ResponsiveContainer width="100%" height={Math.max(240, spendChartData.length * 28)}>
              <BarChart data={spendChartData} layout="vertical" margin={{ right: 48, left: 0 }}>
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={v => '₹' + (v / 1000).toFixed(0) + 'k'} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={120}
                  tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<SkuTooltip />} />
                <Bar dataKey="spend" name="Spend" radius={[0, 4, 4, 0]}>
                  {spendChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Summary Table */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-gray-900 border border-gray-800 rounded-xl p-5 overflow-x-auto">
            <h2 className="text-sm font-semibold text-white mb-4">Full SKU Summary</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['SKU','Product Name','Stock','Ads','Spend','Revenue','ROAS','CPR','Purchases','AOV','Conv%','Collections'].map(h => (
                    <th key={h} className="px-2 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skuSummary.map((d, i) => {
                  const inv = inventoryMap[d.label.toUpperCase()];
                  return (
                    <tr key={d.label} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
                      <td className="px-2 py-2 font-semibold text-slate-200 whitespace-nowrap">{d.label}</td>
                      <td className="px-2 py-2 text-slate-400 max-w-[180px]" title={inv?.title}>
                        {inv?.title || '—'}
                      </td>
                      <td className="px-2 py-2"><StockBadge stock={inv?.stock} /></td>
                      <td className="px-2 py-2 text-slate-400">{d.count}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt.currency(d.spend)}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt.currency(d.revenue)}</td>
                      <td className="px-2 py-2 tabular-nums font-semibold" style={{ color: roasColor(d.roas) }}>
                        {fmt.roas(d.roas)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{fmt.currency(d.cpr)}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt.number(d.purchases)}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt.currency(d.aov)}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt.pct(d.convRate)}</td>
                      <td className="px-2 py-2 text-slate-400 text-[11px]">
                        {[...(skuCollections[d.label] || [])].join(', ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        </div>
      )}

      {/* ── Stock Risk ──────────────────────────────────────────── */}
      {tab === 'stock' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="space-y-5">

          {!hasInventory && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-300">
              <AlertTriangle size={14} />
              No Shopify inventory loaded — go to Setup → Shopify and click "Fetch Inventory Stock" to see stock levels.
            </div>
          )}

          {/* Risk summary */}
          {hasInventory && (() => {
            const out         = stockRiskRows.filter(r => r.riskLevel === 'out');
            const critical    = stockRiskRows.filter(r => r.riskLevel === 'critical');
            const high        = stockRiskRows.filter(r => r.riskLevel === 'high');
            const reorders    = stockRiskRows.filter(r => r.needsReorder);
            const spendAtRisk = [...out, ...critical, ...high].reduce((s, r) => s + r.spend, 0);
            const totalLostRev = stockRiskRows.reduce((s, r) => s + r.lostRevenue, 0);
            return (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                <MetricCard label="Out of Stock" value={out.length} sub={`${critical.length} critical · ${high.length} high risk`} icon={AlertTriangle} color="red" />
                <MetricCard label="Need Reorder Now" value={reorders.length} sub="≤ 14 days supply left" icon={ShoppingBag} color="amber" />
                <MetricCard label="Spend at Risk" value={fmt.currency(spendAtRisk)} sub={totalLostRev > 0 ? `~${fmt.currency(totalLostRev)} est. lost rev (14d)` : undefined} icon={DollarSign} color="amber" />
              </div>
            );
          })()}

          {/* Restock alert panel */}
          {hasInventory && (() => {
            const urgentReorders = stockRiskRows.filter(r => r.needsReorder || r.riskLevel === 'out' || r.riskLevel === 'critical');
            if (!urgentReorders.length) return null;
            return (
              <div className="bg-amber-950/20 border border-amber-800/40 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-amber-300">Restock Alert — {urgentReorders.length} SKU{urgentReorders.length > 1 ? 's' : ''} need attention</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {urgentReorders.slice(0, 9).map(r => (
                    <div key={r.sku} className="flex items-start gap-2 bg-gray-900/60 rounded-lg px-3 py-2">
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0"
                        style={{ background: r.riskLevel === 'out' ? '#ef4444' : r.riskLevel === 'critical' ? '#f87171' : '#fbbf24' }} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200 truncate">{r.sku}</div>
                        <div className="text-[10px] text-slate-500 truncate">{r.productName}</div>
                        <div className="text-[10px] mt-0.5 flex gap-2 flex-wrap">
                          <span className="text-slate-400">Stock: <span className={r.stock <= 0 ? 'text-red-400 font-bold' : 'text-amber-400'}>{r.stock <= 0 ? 'OUT' : r.stock}</span></span>
                          {r.reorderPoint && <span className="text-slate-400">Reorder: <span className="text-white">{r.reorderPoint} units</span></span>}
                          {r.daysRunway !== null && r.daysRunway > 0 && <span className="text-slate-400">{r.daysRunway}d left</span>}
                          {r.lostRevenue > 0 && <span className="text-red-400">{fmt.currency(r.lostRevenue)} est. lost</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Stock risk table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">SKU Stock Risk — Spend Weighted</h2>
              <span className="text-[10px] text-slate-500">Sorted: highest risk first, then spend</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900">
                    {['Risk','SKU','Product','Stock','Days Left','Weeks Supply','Reorder Qty','Lost Rev (14d)','Spend','Spend %','ROAS','CPR','Daily Conv'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockRiskRows.map((r, i) => {
                    const RISK = {
                      out:      { label: 'Out',      bg: 'bg-red-950/60',     dot: '#ef4444' },
                      critical: { label: 'Critical', bg: 'bg-red-950/40',     dot: '#f87171' },
                      high:     { label: 'High',     bg: 'bg-amber-950/40',   dot: '#fbbf24' },
                      medium:   { label: 'Medium',   bg: 'bg-yellow-950/20',  dot: '#eab308' },
                      unknown:  { label: 'No Data',  bg: '',                  dot: '#475569' },
                      ok:       { label: 'OK',       bg: '',                  dot: '#34d399' },
                    };
                    const risk = RISK[r.riskLevel] || RISK.ok;
                    return (
                      <tr key={r.sku} className={`border-t border-gray-800/40 ${risk.bg} ${i % 2 === 0 && !risk.bg ? 'bg-gray-950/40' : ''}`}>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: risk.dot + '22', color: risk.dot }}>
                            {risk.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-200 whitespace-nowrap">
                          {r.sku}
                          {r.needsReorder && <span className="ml-1.5 text-[9px] px-1 py-0.5 bg-amber-500/20 text-amber-400 rounded font-bold">REORDER</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-400 max-w-[150px] truncate" title={r.productName}>{r.productName}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {r.stock === null ? <span className="text-slate-600">—</span>
                            : r.stock <= 0 ? <span className="text-red-400 font-bold">0 ✗</span>
                            : <span className={r.stock < 20 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>{r.stock}</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {r.daysRunway === null ? <span className="text-slate-600">—</span>
                            : r.daysRunway <= 3 ? <span className="text-red-400 font-bold">{r.daysRunway}d !</span>
                            : r.daysRunway <= 7 ? <span className="text-amber-400 font-semibold">{r.daysRunway}d</span>
                            : <span className="text-slate-400">{r.daysRunway}d</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500 text-[10px]">
                          {r.weeksOfSupply === null ? '—'
                            : r.weeksOfSupply < 1 ? <span className="text-red-400 font-semibold">{r.weeksOfSupply}w</span>
                            : r.weeksOfSupply < 2 ? <span className="text-amber-400">{r.weeksOfSupply}w</span>
                            : <span className="text-slate-400">{r.weeksOfSupply}w</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-500 text-[10px]">
                          {r.reorderPoint !== null ? r.reorderPoint : '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-[11px]">
                          {r.lostRevenue > 0
                            ? <span className="text-red-400 font-semibold">{fmt.currency(r.lostRevenue)}</span>
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-300">{fmt.currency(r.spend)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500 rounded-full"
                                style={{ width: `${Math.min(r.spendShare * 4, 100)}%` }} />
                            </div>
                            <span className="text-slate-400">{r.spendShare.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold" style={{ color: roasColor(r.roas) }}>
                          {fmt.roas(r.roas)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{fmt.currency(r.cpr)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">{r.dailyPurchases.toFixed(1)}/day</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Spend vs Stock scatter (CSS-based bubble table) */}
          {hasInventory && stockRiskRows.filter(r => r.stock !== null).length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-1">Spend Proportion vs Stock Level</h2>
              <p className="text-xs text-slate-500 mb-5">Each row: bar = spend share (larger = more budget), dot = stock risk. Watch for high spend share + low stock.</p>
              <div className="space-y-3">
                {stockRiskRows.filter(r => r.stock !== null && r.spend > 0).slice(0, 20).map(r => {
                  const RISK_COLOR = { out: '#ef4444', critical: '#f87171', high: '#fbbf24', medium: '#eab308', ok: '#34d399', unknown: '#475569' };
                  const dotColor = RISK_COLOR[r.riskLevel] || '#475569';
                  const maxShare = Math.max(...stockRiskRows.map(x => x.spendShare));
                  return (
                    <div key={r.sku} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-400 font-medium w-24 shrink-0 truncate" title={r.sku}>{r.sku}</span>
                      <div className="flex-1 relative h-4 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${(r.spendShare / maxShare) * 100}%`, background: roasColor(r.roas) }} />
                      </div>
                      <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">{r.spendShare.toFixed(0)}%</span>
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: dotColor }} title={`Stock: ${r.stock}`} />
                      <span className="text-[10px] tabular-nums w-8 text-right" style={{ color: dotColor }}>
                        {r.stock <= 0 ? 'Out' : r.stock}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-[9px] text-slate-600">
                <span>Bar width = spend share</span>
                <span>Bar colour = ROAS</span>
                <span>Dot = stock risk</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── SKU × Collection Matrix ─────────────────────────────── */}
      {tab === 'matrix' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">SKU × Collection Cross-tab</h2>
          <p className="text-xs text-slate-500 mb-5">
            Each cell shows ROAS / Spend / Purchases for that SKU–Collection combination.
          </p>
          <SkuCollectionMatrix rows={skuRows} />
        </motion.div>
      )}

      {/* ── Decision Breakdown ──────────────────────────────────── */}
      {tab === 'decisions' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Decision Breakdown by SKU</h2>
          <p className="text-xs text-slate-500 mb-5">
            How many ads per SKU are in each decision bucket. Percentages are within each SKU.
          </p>
          <DecisionBreakdown skuSummary={skuSummary} skuDecisions={skuDecisions} />
        </motion.div>
      )}

      {/* ── Ad-level Table ──────────────────────────────────────── */}
      {tab === 'table' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">
            Ad-Level SKU Table — {skuRows.length} ads
          </h2>
          <DataTable columns={tableColumns} data={skuRows} rowKey="adId" onEditRow={setEditRow} onViewRow={setViewRow} />
        </motion.div>
      )}

      {editRow && <ManualEditDrawer row={editRow} onClose={() => setEditRow(null)} />}
      {viewRow && <AdDetailDrawer row={viewRow} onClose={() => setViewRow(null)} />}

    </div>
  );
}
