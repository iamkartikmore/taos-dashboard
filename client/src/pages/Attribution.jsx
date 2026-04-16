import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Legend,
} from 'recharts';
import { GitMerge, AlertTriangle, Package, ShoppingBag, Users } from 'lucide-react';
import clsx from 'clsx';
import { fmt, safeNum } from '../lib/analytics';
import {
  tripleReconciliation, buildAdSkuCollision, buildCustomerLtvBySegment,
} from '../lib/metaIntelligence';

const URGENCY_COLORS = { critical: '#f87171', high: '#f59e0b', medium: '#60a5fa' };

export default function Attribution() {
  const { enrichedRows, shopifyOrders, inventoryMap, brandData, activeBrandIds, brands } = useStore();

  const gaData = useMemo(() => {
    let totals = { conversions: 0, revenue: 0 };
    brands.filter(b => activeBrandIds.includes(b.id)).forEach(b => {
      const d = brandData[b.id];
      if (!d?.gaData) return;
      totals.conversions += safeNum(d.gaData.totals?.conversions || 0);
      totals.revenue     += safeNum(d.gaData.totals?.revenue || 0);
    });
    return { totals };
  }, [brandData, activeBrandIds, brands]);

  const reconcile  = useMemo(() => tripleReconciliation(enrichedRows, gaData, shopifyOrders, 7), [enrichedRows, gaData, shopifyOrders]);
  const collisions = useMemo(() => buildAdSkuCollision(enrichedRows, inventoryMap, shopifyOrders), [enrichedRows, inventoryMap, shopifyOrders]);
  const ltv        = useMemo(() => buildCustomerLtvBySegment(shopifyOrders, enrichedRows), [shopifyOrders, enrichedRows]);

  const hasData = enrichedRows.length > 0 || shopifyOrders.length > 0;

  if (!hasData) return (
    <div className="flex items-center justify-center min-h-[50vh] text-slate-500 text-sm">
      Pull data first from Study Manual.
    </div>
  );

  // Attribution waterfall data
  const waterfallData = [
    { name: 'Meta Reported', value: reconcile.meta.purchases, fill: '#60a5fa' },
    { name: 'GA Conversions', value: reconcile.ga.conversions, fill: '#a78bfa' },
    { name: 'Shopify Orders', value: reconcile.shopify.orders, fill: '#22c55e' },
  ];

  const revenueData = [
    { name: 'Meta Revenue', value: reconcile.meta.revenue, fill: '#60a5fa' },
    { name: 'GA Revenue',   value: reconcile.ga.revenue,   fill: '#a78bfa' },
    { name: 'Shopify Rev',  value: reconcile.shopify.revenue, fill: '#22c55e' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><GitMerge size={22} className="text-blue-400" />Attribution Intelligence</h1>
        <p className="text-sm text-slate-500 mt-1">Meta vs GA4 vs Shopify reconciliation, stockout collision alerts, customer LTV by source</p>
      </div>

      {/* Triple Reconciliation */}
      <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1">Triple Attribution Reconciliation — Last 7 Days</h2>
        <p className="text-[11px] text-slate-500 mb-4">
          Meta over-attributes due to view-through attribution. GA4 uses last-click. Shopify is ground truth.
          Gap = revenue Meta claims but Shopify didn't record.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Meta */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
            <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1">Meta Reported</div>
            <div className="text-2xl font-bold text-white">{reconcile.meta.purchases.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">purchases</div>
            <div className="text-[13px] font-semibold text-blue-400 mt-2">{fmt.currency(reconcile.meta.revenue)}</div>
            <div className="text-[10px] text-slate-500">revenue · ROAS {safeNum(reconcile.meta.roas).toFixed(2)}x</div>
          </div>
          {/* GA4 */}
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
            <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">GA4 Conversions</div>
            <div className="text-2xl font-bold text-white">{reconcile.ga.conversions.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">conversions</div>
            <div className="text-[13px] font-semibold text-purple-400 mt-2">{fmt.currency(reconcile.ga.revenue)}</div>
            <div className="text-[10px] text-slate-500">revenue attributed</div>
          </div>
          {/* Shopify */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
            <div className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">Shopify (Truth)</div>
            <div className="text-2xl font-bold text-white">{reconcile.shopify.orders.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-1">actual orders</div>
            <div className="text-[13px] font-semibold text-emerald-400 mt-2">{fmt.currency(reconcile.shopify.revenue)}</div>
            <div className="text-[10px] text-slate-500">actual revenue</div>
          </div>
        </div>

        {/* Gap stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className={clsx('rounded-xl p-3 text-center border', reconcile.attributionGap > 30 ? 'bg-red-500/10 border-red-500/20' : 'bg-gray-800/40 border-gray-700/40')}>
            <div className="text-[10px] text-slate-500 mb-1">Attribution Gap</div>
            <div className={clsx('text-xl font-bold', reconcile.attributionGap > 30 ? 'text-red-400' : 'text-slate-300')}>
              {reconcile.attributionGap}%
            </div>
            <div className="text-[10px] text-slate-500">(Meta − Shopify) / Meta</div>
          </div>
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 text-center">
            <div className="text-[10px] text-slate-500 mb-1">Revenue Match Rate</div>
            <div className={clsx('text-xl font-bold', reconcile.revenueMatchRate >= 80 ? 'text-emerald-400' : reconcile.revenueMatchRate >= 60 ? 'text-amber-400' : 'text-red-400')}>
              {reconcile.revenueMatchRate}%
            </div>
            <div className="text-[10px] text-slate-500">Shopify / Meta</div>
          </div>
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 text-center">
            <div className="text-[10px] text-slate-500 mb-1">Unverified Revenue</div>
            <div className="text-xl font-bold text-amber-400">{fmt.currency(reconcile.gapRevenue)}</div>
            <div className="text-[10px] text-slate-500">Meta claims, Shopify didn't see</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-slate-500 mb-2">Purchase Count Comparison</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={waterfallData} margin={{ left: -15 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {waterfallData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-2">Revenue Comparison</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={revenueData} margin={{ left: -15 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  formatter={v => [fmt.currency(v)]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {revenueData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Ad → SKU Collision Alerts */}
      <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Package size={14} className="text-amber-400" />
          Ad → SKU Stockout Collision Alerts
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          Active ads spending money on SKUs that will stock out soon. Pause these ads before inventory runs out or you'll convert customers you can't fulfill.
        </p>
        {collisions.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">
            {Object.keys(inventoryMap).length === 0
              ? 'Pull Shopify inventory to see stockout collision alerts.'
              : 'No active stockout risks detected. All SKUs have enough runway.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                  {['Urgency', 'Ad', 'SKU', 'Stock', 'Velocity/day', 'Days of Inv', 'Spend 7D', 'ROAS'].map(h => (
                    <th key={h} className={clsx('py-2 px-3', h === 'Ad' || h === 'Urgency' ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {collisions.map((c, i) => (
                  <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                        style={{ background: (URGENCY_COLORS[c.urgency] || '#60a5fa') + '20', color: URGENCY_COLORS[c.urgency] || '#60a5fa' }}>
                        {c.urgency}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-200 font-medium max-w-[180px] truncate">{c.adName}</td>
                    <td className="py-2 px-3 text-right text-slate-400 font-mono">{c.sku}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{c.stock.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-slate-400">{c.velocity}/day</td>
                    <td className={clsx('py-2 px-3 text-right font-bold', c.doi < 7 ? 'text-red-400' : c.doi < 14 ? 'text-amber-400' : 'text-blue-400')}>
                      {c.doi}d
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(c.spend7d)}</td>
                    <td className={clsx('py-2 px-3 text-right font-bold', c.roas >= 4 ? 'text-emerald-400' : 'text-amber-400')}>
                      {fmt.roas(c.roas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer LTV by Segment */}
      <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Users size={14} className="text-purple-400" />
          Customer LTV by Acquisition Source
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          Which channel brings the highest lifetime-value customers. Meta vs Direct vs other sources.
        </p>
        {ltv.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">Pull Shopify orders to see customer LTV analysis.</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ltv} layout="vertical" margin={{ left: 40, right: 30 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis type="category" dataKey="segment" tick={{ fontSize: 10, fill: '#94a3b8' }} width={50} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  formatter={v => [fmt.currency(v), 'LTV']} />
                <Bar dataKey="ltv" fill="#a78bfa" radius={[0, 4, 4, 0]}>
                  {ltv.map((e, i) => (
                    <Cell key={i} fill={e.segment === 'Meta' ? '#60a5fa' : e.segment === 'Google' ? '#f59e0b' : '#a78bfa'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                    {['Source', 'Orders', 'Customers', 'AOV', 'LTV', 'Repeat%'].map(h => (
                      <th key={h} className={clsx('py-2 px-3', h === 'Source' ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ltv.map((r, i) => (
                    <tr key={i} className="border-b border-gray-800/30">
                      <td className="py-2 px-3 text-slate-200 font-medium">{r.segment}</td>
                      <td className="py-2 px-3 text-right text-slate-400">{r.totalOrders}</td>
                      <td className="py-2 px-3 text-right text-slate-400">{r.uniqueCustomers}</td>
                      <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(r.aov)}</td>
                      <td className="py-2 px-3 text-right font-bold text-purple-400">{fmt.currency(r.ltv)}</td>
                      <td className={clsx('py-2 px-3 text-right', r.repeatRate >= 20 ? 'text-emerald-400 font-semibold' : 'text-slate-400')}>
                        {r.repeatRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
