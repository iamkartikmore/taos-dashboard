import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wrench, Shield, Skull } from 'lucide-react';
import { useParams, useLocation } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useStore } from '../store';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import AdDetailDrawer from '../components/ui/AdDetailDrawer';
import MetricCard from '../components/ui/MetricCard';
import { aggregateMetrics, fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';

const BOARD_CONFIG = {
  '/scale':  {
    title: 'Scale Board',
    icon: TrendingUp,
    decisions: ['Scale Hard', 'Scale Carefully'],
    color: 'green',
    description: 'Ads performing well and ready to scale — increase budget or duplicate.',
    accentColor: '#22c55e',
    emptyMsg: 'No ads qualify for scaling right now.',
  },
  '/fix':    {
    title: 'Fix Board',
    icon: Wrench,
    decisions: ['Fix'],
    color: 'amber',
    description: 'Ads with potential but needing creative, offer, or targeting fixes.',
    accentColor: '#f59e0b',
    emptyMsg: 'No ads need fixing right now.',
  },
  '/defend': {
    title: 'Defend Board',
    icon: Shield,
    decisions: ['Defend'],
    color: 'teal',
    description: 'Performing ads showing fatigue or worsening trend — defend before they break.',
    accentColor: '#0ea5e9',
    emptyMsg: 'No ads need defending right now.',
  },
  '/kill':   {
    title: 'Kill Board',
    icon: Skull,
    decisions: ['Kill'],
    color: 'red',
    description: 'Poor performers draining budget with no path to recovery — kill or pause.',
    accentColor: '#ef4444',
    emptyMsg: 'Nothing needs killing. 🎉',
  },
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs">
      <div className="font-semibold text-slate-300 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-slate-300">{p.name}: <strong>{
          p.name === 'ROAS' ? fmt.roas(p.value) :
          p.name === 'Spend' ? fmt.currency(p.value) :
          fmt.number(p.value)
        }</strong></div>
      ))}
    </div>
  );
};

export default function Board() {
  const { pathname } = useLocation();
  const cfg = BOARD_CONFIG[pathname] || BOARD_CONFIG['/scale'];
  const Icon = cfg.icon;

  const { enrichedRows, fetchStatus } = useStore();
  const [viewRow, setViewRow] = useState(null);

  const rows = useMemo(() =>
    enrichedRows
      .filter(r => cfg.decisions.includes(r.decision))
      .sort((a, b) => safeNum(b.spend) - safeNum(a.spend)),
  [enrichedRows, cfg.decisions]);

  const agg = useMemo(() => aggregateMetrics(rows), [rows]);

  // Top 10 by spend for chart
  const top10 = rows.slice(0, 10);
  const chartData = top10.map(r => ({
    name: r.adName?.slice(0, 20) || r.adId,
    Spend: safeNum(r.spend),
    ROAS:  safeNum(r.metaRoas),
  }));

  if (fetchStatus === 'loading') return <FullPageSpinner />;

  const columns = [
    { key: 'decision',     label: 'Action',    width: 130, render: v => <Badge label={v} /> },
    { key: 'adName',       label: 'Ad',         width: 200, render: v => <span className="text-slate-200 font-medium">{v}</span> },
    { key: 'campaignName', label: 'Campaign',   width: 170, render: v => <span className="text-slate-400 text-xs">{v}</span> },
    { key: 'accountKey',   label: 'Account',    width: 80  },
    { key: 'spend',        label: 'Spend',      align: 'right', width: 90,  render: v => <span className="font-semibold">{fmt.currency(v)}</span> },
    { key: 'metaRoas',     label: 'ROAS',       align: 'right', width: 70,
      render: v => <span className={safeNum(v) >= 4 ? 'text-emerald-400 font-bold' : safeNum(v) >= 2.5 ? 'text-amber-400' : 'text-red-400'}>{fmt.roas(v)}</span> },
    { key: 'metaCpr',      label: 'CPR',        align: 'right', width: 80,  render: v => fmt.currency(v) },
    { key: 'purchases',    label: 'Purchases',  align: 'right', width: 80,  render: v => fmt.number(v) },
    { key: 'revenue',      label: 'Revenue',    align: 'right', width: 90,  render: v => fmt.currency(v) },
    { key: 'frequency',    label: 'Freq',       align: 'right', width: 60,  render: v => fmt.decimal(v) },
    { key: 'trendSignal',  label: 'Trend',      width: 150, render: v => <Badge label={v} size="xs" /> },
    { key: 'currentQuality', label: 'Quality',  width: 90,  render: v => <Badge label={v} size="xs" /> },
    { key: 'audienceFamily', label: 'Audience', width: 110, render: v => v ? <Badge label={v} size="xs" /> : '—' },
    { key: 'collection',   label: 'Collection', width: 100 },
    { key: 'creativeDominance', label: 'Creative', width: 120 },
    { key: 'ctrAll',       label: 'CTR',        align: 'right', width: 65,  render: v => fmt.pct(v) },
    { key: 'outboundCtr',  label: 'Outbound CTR', align: 'right', width: 100, render: v => fmt.pct(v) },
    { key: 'lpvRate',      label: 'LPV Rate',   align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'atcRate',      label: 'ATC Rate',   align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'convRate',     label: 'Conv Rate',  align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'roasDelta',    label: 'ROAS Δ 30D', align: 'right', width: 90,
      render: v => {
        const n = safeNum(v);
        return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>;
      }
    },
    { key: 'spendDelta',   label: 'Spend Δ 30D', align: 'right', width: 90,
      render: v => {
        const n = safeNum(v);
        return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>;
      }
    },
    { key: 'notes', label: 'Notes', width: 140 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl" style={{ background: cfg.accentColor + '20' }}>
          <Icon size={20} style={{ color: cfg.accentColor }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{cfg.title}</h1>
          <p className="text-sm text-slate-500 mt-1">{cfg.description}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-12 text-center text-slate-500">
          {cfg.emptyMsg}
        </div>
      ) : (
        <>
          {/* Aggregate metrics */}
          {agg && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MetricCard label="Ads"       value={fmt.number(rows.length)} color={cfg.color} />
              <MetricCard label="Spend"     value={fmt.currency(agg.spend)}    color={cfg.color} />
              <MetricCard label="Revenue"   value={fmt.currency(agg.revenue)}  color={cfg.color} />
              <MetricCard label="ROAS"      value={fmt.roas(agg.roas)}         color={cfg.color} />
              <MetricCard label="Purchases" value={fmt.number(agg.purchases)}  color={cfg.color} />
            </div>
          )}

          {/* Top 10 chart */}
          {chartData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="bg-gray-900 rounded-xl border border-gray-800 p-5"
            >
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Top 10 by Spend</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="left"  tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar yAxisId="left"  dataKey="Spend" fill={cfg.accentColor} opacity={0.7} radius={[4,4,0,0]} />
                  <Bar yAxisId="right" dataKey="ROAS"  fill="#a78bfa" opacity={0.8} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          )}

          {/* Table */}
          <DataTable columns={columns} data={rows} onViewRow={setViewRow} />
          {viewRow && <AdDetailDrawer row={viewRow} onClose={() => setViewRow(null)} />}
        </>
      )}
    </div>
  );
}
