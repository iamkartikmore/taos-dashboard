import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import {
  IndianRupee, ShoppingCart, TrendingUp, Target, Activity, Eye, MousePointer2,
} from 'lucide-react';
import { useStore } from '../store';
import MetricCard from '../components/ui/MetricCard';
import Badge from '../components/ui/Badge';
import { aggregateMetrics, buildPatternSummary, fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';

const COLORS = ['#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs">
      <div className="font-semibold text-slate-300 mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-medium">{
            p.name?.toLowerCase().includes('roas') ? fmt.roas(p.value) :
            p.name?.toLowerCase().includes('spend') || p.name?.toLowerCase().includes('₹') ? fmt.currency(p.value) :
            p.name?.toLowerCase().includes('%') || p.name?.toLowerCase().includes('rate') || p.name?.toLowerCase().includes('ctr') ? fmt.pct(p.value) :
            fmt.number(p.value)
          }</span>
        </div>
      ))}
    </div>
  );
};

export default function Overview() {
  const { enrichedRows, fetchStatus, rawAccounts } = useStore();

  const agg = useMemo(() => aggregateMetrics(enrichedRows), [enrichedRows]);

  const byDecision = useMemo(() => {
    const counts = {};
    enrichedRows.forEach(r => { counts[r.decision] = (counts[r.decision] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [enrichedRows]);

  const byCollection = useMemo(() =>
    buildPatternSummary(enrichedRows, 'collection').slice(0, 8),
  [enrichedRows]);

  const byAudience = useMemo(() =>
    buildPatternSummary(enrichedRows, 'audienceFamily'),
  [enrichedRows]);

  const topAccounts = useMemo(() => {
    if (!rawAccounts.length) return [];
    return rawAccounts.map(a => {
      const rows = enrichedRows.filter(r => r.accountKey === a.accountKey);
      const m = aggregateMetrics(rows);
      return { key: a.accountKey, id: a.accountId, ...m, adCount: rows.length };
    }).sort((a, b) => safeNum(b.spend) - safeNum(a.spend));
  }, [enrichedRows, rawAccounts]);

  const funnelData = agg ? [
    { stage: 'Impressions', value: agg.impressions },
    { stage: 'Outbound Clicks', value: agg.impressions * safeNum(agg.outboundCtr) / 100 },
    { stage: 'Landing Page Views', value: agg.lpv },
    { stage: 'Add to Cart', value: agg.atc },
    { stage: 'Checkout', value: agg.ic },
    { stage: 'Purchases', value: agg.purchases },
  ] : [];

  if (fetchStatus === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-slate-400">
        <Activity size={48} className="text-brand-500 opacity-50" />
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-300">No data yet</div>
          <div className="text-sm mt-1">Go to <strong className="text-brand-400">Study Manual</strong> → enter credentials → Pull Meta + Refresh</div>
        </div>
      </div>
    );
  }

  if (fetchStatus === 'loading') return <FullPageSpinner message="Fetching Meta data..." />;

  if (!agg) return <FullPageSpinner message="Processing..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Overview Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">{enrichedRows.length} ads · 7-day window</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Spend"    value={fmt.currency(agg.spend)}     icon={IndianRupee} color="blue"   size="lg" />
        <MetricCard label="Revenue"        value={fmt.currency(agg.revenue)}   icon={TrendingUp}  color="green"  size="lg" />
        <MetricCard label="ROAS"           value={fmt.roas(agg.roas)}          icon={Target}      color="purple" size="lg" />
        <MetricCard label="Purchases"      value={fmt.number(agg.purchases)}   icon={ShoppingCart} color="teal"  size="lg" />
        <MetricCard label="Cost per Purchase" value={fmt.currency(agg.cpr)}   icon={IndianRupee} color="amber" />
        <MetricCard label="CTR (all)"      value={fmt.pct(agg.ctr)}            icon={MousePointer2} color="blue" />
        <MetricCard label="Outbound CTR"   value={fmt.pct(agg.outboundCtr)}    icon={Eye}         color="teal" />
        <MetricCard label="CPM"            value={fmt.currency(agg.cpm)}       icon={Activity}    color="amber" />
      </div>

      {/* Funnel + Decision pie row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion funnel */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5"
        >
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Conversion Funnel</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" width={130} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={4} fill="#2d7cf6" label={{ position: 'right', fill: '#64748b', fontSize: 10,
                formatter: v => fmt.number(v) }} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Decision distribution */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5"
        >
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Decision Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byDecision} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                dataKey="value" nameKey="name" paddingAngle={3}
              >
                {byDecision.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>} />
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Collection + Audience performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By collection */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5"
        >
          <h2 className="text-sm font-semibold text-slate-300 mb-4">ROAS by Collection</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCollection}>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="roas" name="ROAS" fill="#a78bfa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Audience family */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5"
        >
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Performance by Audience Family</h2>
          {byAudience.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={byAudience.map(a => ({
                family: a.label,
                ROAS: +safeNum(a.roas).toFixed(2),
                'Conv%': +safeNum(a.convRate).toFixed(2),
                'ATC%': +safeNum(a.atcRate).toFixed(2),
              }))}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis dataKey="family" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Radar name="ROAS" dataKey="ROAS" stroke="#2d7cf6" fill="#2d7cf6" fillOpacity={0.3} />
                <Radar name="Conv%" dataKey="Conv%" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} />
                <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#94a3b8', fontSize: 10 }}>{v}</span>} />
                <Tooltip content={<CustomTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-sm text-slate-600">
              Apply manual labels to see audience data
            </div>
          )}
        </motion.div>
      </div>

      {/* Account breakdown */}
      {topAccounts.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5"
        >
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Account Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Account','Ads','Spend','Revenue','ROAS','CPR','CTR','LPV Rate','ATC Rate'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topAccounts.map((a, i) => (
                  <tr key={a.key} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
                    <td className="px-3 py-2.5 font-medium text-brand-300">{a.key}</td>
                    <td className="px-3 py-2.5 text-slate-400">{a.adCount}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.currency(a.spend)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.currency(a.revenue)}</td>
                    <td className="px-3 py-2.5 tabular-nums font-semibold text-violet-300">{fmt.roas(a.roas)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.currency(a.cpr)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.pct(a.ctr)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.pct(a.lpvRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt.pct(a.atcRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Rate metrics */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gray-900 rounded-xl border border-gray-800 p-5"
      >
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Funnel Rates</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'LPV Rate',       value: fmt.pct(agg.lpvRate),      sub: 'of outbound clicks' },
            { label: 'ATC Rate',       value: fmt.pct(agg.atcRate),      sub: 'of LPVs' },
            { label: 'IC Rate',        value: fmt.pct(safeNum(agg.ic) > 0 ? safeNum(agg.atc) > 0 ? (safeNum(agg.ic)/safeNum(agg.atc))*100 : 0 : 0), sub: 'of ATCs' },
            { label: 'Purchase Rate',  value: fmt.pct(agg.purchaseRate),  sub: 'of ICs' },
            { label: 'Conv Rate',      value: fmt.pct(agg.convRate),      sub: 'click → purchase' },
          ].map(m => (
            <div key={m.label} className="bg-gray-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-white">{m.value}</div>
              <div className="text-xs font-medium text-slate-300 mt-1">{m.label}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{m.sub}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
