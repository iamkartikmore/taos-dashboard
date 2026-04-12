import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Eye, TrendingUp, Award } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { useStore } from '../store';
import MetricCard from '../components/ui/MetricCard';
import DataTable from '../components/ui/DataTable';
import Spinner from '../components/ui/Spinner';
import { fmt, safeNum } from '../lib/analytics';

/* ─── HELPERS ────────────────────────────────────────────────────── */

function holdColor(rate) {
  if (rate >= 20) return '#10b981'; // green
  if (rate >= 10) return '#f59e0b'; // amber
  return '#ef4444';                 // red
}

const RANKING_COLORS = {
  ABOVE_AVERAGE: '#10b981',
  AVERAGE:       '#f59e0b',
  BELOW_AVERAGE: '#ef4444',
};

const rankingLabel = v => {
  if (!v) return 'Unknown';
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-300 font-medium mb-1 max-w-[200px] truncate">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>{p.name}:</span>
          <span className="text-white font-mono">{typeof p.value === 'number' ? p.value.toFixed(1) + '%' : p.value}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── PAGE ───────────────────────────────────────────────────────── */

export default function VideoInsights() {
  const { enrichedRows, fetchStatus } = useStore();

  // Filter to rows with video data
  const videoRows = useMemo(
    () => enrichedRows.filter(r => safeNum(r.videoPlays) > 0),
    [enrichedRows],
  );

  // KPIs
  const kpis = useMemo(() => {
    if (!videoRows.length) return null;
    const totalPlays = videoRows.reduce((s, r) => s + safeNum(r.videoPlays), 0);
    const avgHold    = videoRows.reduce((s, r) => s + safeNum(r.holdRate), 0) / videoRows.length;
    const avgP25     = videoRows.reduce((s, r) => s + safeNum(r.videoP25Rate), 0) / videoRows.length;
    const avgP50     = videoRows.reduce((s, r) => s + safeNum(r.videoP50Rate), 0) / videoRows.length;
    const avgP75     = videoRows.reduce((s, r) => s + safeNum(r.videoP75Rate), 0) / videoRows.length;
    return { totalPlays, avgHold, avgP25, avgP50, avgP75 };
  }, [videoRows]);

  // Top 15 by Hold Rate (horizontal bar)
  const holdRateData = useMemo(
    () =>
      [...videoRows]
        .sort((a, b) => safeNum(b.holdRate) - safeNum(a.holdRate))
        .slice(0, 15)
        .map(r => ({
          name: (r.adName || r.adId || '').slice(0, 30),
          holdRate: parseFloat(safeNum(r.holdRate).toFixed(2)),
          adId: r.adId,
        })),
    [videoRows],
  );

  // Top 10 by spend — video funnel
  const funnelData = useMemo(
    () =>
      [...videoRows]
        .sort((a, b) => safeNum(b.spend) - safeNum(a.spend))
        .slice(0, 10)
        .map(r => ({
          name: (r.adName || r.adId || '').slice(0, 20),
          'P25%':  parseFloat(safeNum(r.videoP25Rate).toFixed(1)),
          'P50%':  parseFloat(safeNum(r.videoP50Rate).toFixed(1)),
          'P75%':  parseFloat(safeNum(r.videoP75Rate).toFixed(1)),
          'P95%':  parseFloat(safeNum(r.videoP95Rate).toFixed(1)),
          'P100%': parseFloat(safeNum(r.videoP100Rate).toFixed(1)),
        })),
    [videoRows],
  );

  // Quality ranking distribution (pie)
  const qualityDist = useMemo(() => {
    const counts = {};
    videoRows.forEach(r => {
      const k = r.qualityRanking || 'UNKNOWN';
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [videoRows]);

  // DataTable columns
  const columns = [
    { key: 'adName',           label: 'Ad Name',         width: 200, render: v => <span className="truncate max-w-[180px] block" title={v}>{v || '—'}</span> },
    { key: 'campaignName',     label: 'Campaign',        width: 150, render: v => <span className="truncate max-w-[140px] block text-slate-400" title={v}>{v || '—'}</span> },
    { key: 'accountKey',       label: 'Account',         width: 90  },
    { key: 'spend',            label: 'Spend',           width: 90,  align: 'right', render: v => fmt.currency(v) },
    { key: 'metaRoas',         label: 'ROAS',            width: 70,  align: 'right', render: v => fmt.roas(v) },
    { key: 'videoPlays',       label: 'Video Plays',     width: 100, align: 'right', render: v => fmt.number(v) },
    { key: 'holdRate',         label: 'Hold%',           width: 75,  align: 'right', render: v => <span style={{ color: holdColor(safeNum(v)) }}>{safeNum(v).toFixed(1)}%</span> },
    { key: 'videoP25Rate',     label: 'P25%',            width: 65,  align: 'right', render: v => `${safeNum(v).toFixed(1)}%` },
    { key: 'videoP50Rate',     label: 'P50%',            width: 65,  align: 'right', render: v => `${safeNum(v).toFixed(1)}%` },
    { key: 'videoP75Rate',     label: 'P75%',            width: 65,  align: 'right', render: v => `${safeNum(v).toFixed(1)}%` },
    { key: 'videoP95Rate',     label: 'P95%',            width: 65,  align: 'right', render: v => `${safeNum(v).toFixed(1)}%` },
    { key: 'videoAvgWatch',    label: 'Avg Watch(s)',    width: 100, align: 'right', render: v => safeNum(v).toFixed(1) },
    { key: 'qualityRanking',   label: 'Quality',         width: 120, render: v => v ? <span style={{ color: RANKING_COLORS[v] || '#94a3b8' }}>{rankingLabel(v)}</span> : '—' },
    { key: 'engagementRanking',label: 'Engage Rank',     width: 120, render: v => v ? <span style={{ color: RANKING_COLORS[v] || '#94a3b8' }}>{rankingLabel(v)}</span> : '—' },
    { key: 'conversionRanking',label: 'Conv Rank',       width: 120, render: v => v ? <span style={{ color: RANKING_COLORS[v] || '#94a3b8' }}>{rankingLabel(v)}</span> : '—' },
  ];

  /* ── Empty / loading states ─────────────────────────────────── */
  if (fetchStatus === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Play size={40} className="opacity-30" />
        <p className="text-sm">Pull Meta data first to see video insights.</p>
      </div>
    );
  }

  if (fetchStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (!videoRows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Play size={40} className="opacity-30" />
        <p className="text-sm font-medium">No video data found.</p>
        <p className="text-xs text-slate-600 max-w-sm text-center">
          Video metrics will appear here once Meta returns <code className="bg-gray-800 px-1 rounded">video_play_actions</code> data for your ads.
          Make sure your ads include video creatives.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Video Insights</h1>
        <p className="text-sm text-slate-400 mt-1">
          Video funnel, hold rates and quality rankings for {videoRows.length} ads with video data.
        </p>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Total Video Plays"
          value={fmt.number(kpis.totalPlays)}
          icon={Play}
          color="blue"
        />
        <MetricCard
          label="Avg Hold Rate"
          value={`${kpis.avgHold.toFixed(1)}%`}
          sub="thruplays / impressions"
          icon={Eye}
          color={kpis.avgHold >= 20 ? 'green' : kpis.avgHold >= 10 ? 'amber' : 'red'}
        />
        <MetricCard
          label="Avg P25 Rate"
          value={`${kpis.avgP25.toFixed(1)}%`}
          icon={TrendingUp}
          color="teal"
        />
        <MetricCard
          label="Avg P50 Rate"
          value={`${kpis.avgP50.toFixed(1)}%`}
          icon={TrendingUp}
          color="purple"
        />
        <MetricCard
          label="Avg P75 Rate"
          value={`${kpis.avgP75.toFixed(1)}%`}
          icon={Award}
          color="amber"
        />
      </div>

      {/* ── Charts Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Hold Rate — Top 15 horizontal bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-white mb-4">Top 15 Ads by Hold Rate</h2>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart
              data={holdRateData}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tickFormatter={v => `${v}%`}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="holdRate" name="Hold Rate" radius={[0, 4, 4, 0]}>
                {holdRateData.map((entry, i) => (
                  <Cell key={i} fill={holdColor(entry.holdRate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> &ge;20% Hold</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 10–20%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &lt;10%</span>
          </div>
        </motion.div>

        {/* Quality Ranking Distribution — Pie */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-white mb-4">Quality Ranking Distribution</h2>
          {qualityDist.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
              No quality ranking data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Pie
                  data={qualityDist}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={120}
                  label={({ name, percent }) => `${rankingLabel(name)} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {qualityDist.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={RANKING_COLORS[entry.name] || '#64748b'}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value + ' ads', rankingLabel(name)]}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                />
                <Legend
                  formatter={name => rankingLabel(name)}
                  wrapperStyle={{ fontSize: 12, color: '#94a3b8' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* ── Video Funnel Chart — top 10 by spend ───────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gray-900 border border-gray-800 rounded-xl p-5"
      >
        <h2 className="text-sm font-semibold text-white mb-1">Video Funnel — Top 10 Ads by Spend</h2>
        <p className="text-xs text-slate-500 mb-4">P25 / P50 / P75 / P95 / P100 completion rates</p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={funnelData} margin={{ top: 0, right: 16, left: 0, bottom: 60 }}>
            <XAxis
              dataKey="name"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              angle={-35}
              textAnchor="end"
              interval={0}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={v => `${v}%`}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="P25%"  fill="#6366f1" radius={[2, 2, 0, 0]} />
            <Bar dataKey="P50%"  fill="#8b5cf6" radius={[2, 2, 0, 0]} />
            <Bar dataKey="P75%"  fill="#a855f7" radius={[2, 2, 0, 0]} />
            <Bar dataKey="P95%"  fill="#d946ef" radius={[2, 2, 0, 0]} />
            <Bar dataKey="P100%" fill="#ec4899" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* ── Full DataTable ───────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-gray-900 border border-gray-800 rounded-xl p-5"
      >
        <h2 className="text-sm font-semibold text-white mb-4">All Video Ads</h2>
        <DataTable
          columns={columns}
          data={videoRows}
          rowKey="adId"
        />
      </motion.div>
    </div>
  );
}
