import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wrench, Shield, Skull, AlertTriangle, Flame, TrendingDown } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useStore } from '../store';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import AdDetailDrawer from '../components/ui/AdDetailDrawer';
import MetricCard from '../components/ui/MetricCard';
import { aggregateMetrics, fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';
import clsx from 'clsx';

/* ─── KILL REASON LOGIC ──────────────────────────────────────────── */

function killReason(r) {
  const roas  = safeNum(r.metaRoas);
  const cpr   = safeNum(r.metaCpr);
  const spend = safeNum(r.spend);
  const freq  = safeNum(r.frequency);
  const trend = r.trendSignal || '';

  if (roas < 1.5 && spend > 300)           return `ROAS ${roas.toFixed(1)}x — burning below break-even`;
  if (cpr > 200 && spend > 300)            return `CPR ₹${Math.round(cpr)} — each purchase unacceptably costly`;
  if (roas < 2 && spend > 200)             return `ROAS ${roas.toFixed(1)}x with ₹${Math.round(spend)} burn — no recovery signal`;
  if (freq > 3 && roas < 2.5)             return `Freq ${freq.toFixed(1)}x + ROAS ${roas.toFixed(1)}x — audience exhausted`;
  if (trend.includes('Worsening') && roas < 2.5) return `Worsening trend + low ROAS — accelerating decline`;
  if (roas < 2.5 && spend > 200)          return `ROAS ${roas.toFixed(1)}x — sustained underperformance`;
  return 'Performance below minimum thresholds';
}

function monthlyWaste(r) {
  // Spend is 7D. Scale to monthly, then apply "waste" concept:
  // waste = spend that generated no positive ROI (where ROAS < 2x target = 50% is wasted)
  const daily = safeNum(r.spend) / 7;
  const roas  = safeNum(r.metaRoas);
  // Everything spent below a 2x ROAS target = wasted portion
  const wasteRate = roas < 2 ? 1 : (2 - roas) / 2;
  return Math.round(daily * 30 * Math.max(0, wasteRate));
}

/* ─── BOARD CONFIG ───────────────────────────────────────────────── */

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
    description: 'Poor performers draining budget with no path to recovery — pause or delete immediately.',
    accentColor: '#ef4444',
    emptyMsg: 'Nothing needs killing. 🎉',
  },
};

const KILL_ACTIONS = [
  { label: 'Pause Ad', desc: 'Stop spend immediately — keep data, easy to reactivate', action: 'PAUSE' },
  { label: 'Duplicate & Fix', desc: 'Clone the ad, fix the creative/offer, kill the original', action: 'DUPLICATE' },
  { label: 'Kill & Replace', desc: 'Delete ad and launch a new concept for this product', action: 'REPLACE' },
];

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
  const isKill = pathname === '/kill';

  const { enrichedRows, fetchStatus } = useStore();
  const [viewRow, setViewRow] = useState(null);

  const rows = useMemo(() =>
    enrichedRows
      .filter(r => cfg.decisions.includes(r.decision))
      .sort((a, b) => isKill
        ? safeNum(b.spend) - safeNum(a.spend)  // Kill: highest spend first (most urgent)
        : safeNum(b.spend) - safeNum(a.spend)),
  [enrichedRows, cfg.decisions, isKill]);

  // Enrich kill rows with reason + waste
  const killRows = useMemo(() =>
    isKill ? rows.map(r => ({
      ...r,
      killReason: killReason(r),
      monthlyWaste: monthlyWaste(r),
    })) : rows,
  [rows, isKill]);

  const agg = useMemo(() => aggregateMetrics(rows), [rows]);

  const totalDailyBurn = useMemo(() =>
    isKill ? rows.reduce((s, r) => s + safeNum(r.spend) / 7, 0) : 0,
  [rows, isKill]);

  const totalMonthlyWaste = useMemo(() =>
    isKill ? killRows.reduce((s, r) => s + (r.monthlyWaste || 0), 0) : 0,
  [killRows, isKill]);

  const top10 = rows.slice(0, 10);
  const chartData = top10.map(r => ({
    name: (r.adName || r.adId)?.slice(0, 20),
    Spend: safeNum(r.spend),
    ROAS:  safeNum(r.metaRoas),
  }));

  if (fetchStatus === 'loading') return <FullPageSpinner />;

  // Standard columns (shared across boards)
  const baseColumns = [
    { key: 'decision',     label: 'Action',    width: 130, render: v => <Badge label={v} /> },
    { key: 'adName',       label: 'Ad',         width: 200, render: v => <span className="text-slate-200 font-medium">{v}</span> },
    { key: 'campaignName', label: 'Campaign',   width: 170, render: v => <span className="text-slate-400 text-xs">{v}</span> },
    { key: 'accountKey',   label: 'Account',    width: 80  },
    { key: 'budget',       label: 'Budget',     align: 'right', width: 110,
      render: (v, row) => v > 0
        ? <span className="tabular-nums"><span className="font-semibold text-slate-200">{fmt.currency(v)}</span><span className="text-[10px] text-slate-500 ml-1">{row.budgetType}/{row.budgetLevel}</span></span>
        : <span className="text-slate-700">—</span>
    },
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
      render: v => { const n = safeNum(v); return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>; }
    },
    { key: 'spendDelta',   label: 'Spend Δ 30D', align: 'right', width: 90,
      render: v => { const n = safeNum(v); return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>; }
    },
    { key: 'notes', label: 'Notes', width: 140 },
  ];

  // Kill-specific columns prepended
  const killColumns = [
    { key: 'killReason',   label: 'Kill Reason',      width: 280,
      render: v => <span className="text-red-300 text-[11px]">{v}</span> },
    { key: 'monthlyWaste', label: 'Est. Monthly Waste', align: 'right', width: 130,
      render: v => <span className="text-red-400 font-semibold tabular-nums">{fmt.currency(v)}</span> },
    { key: 'fatigueScore', label: 'Fatigue', align: 'right', width: 70,
      render: v => {
        const n = safeNum(v);
        return <span className={clsx('font-bold', n >= 70 ? 'text-red-400' : n >= 40 ? 'text-amber-400' : 'text-slate-400')}>{n}</span>;
      }
    },
    ...baseColumns,
  ];

  const columns = isKill ? killColumns : baseColumns;
  const tableData = isKill ? killRows : rows;

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
          {/* Kill-specific: urgency banner */}
          {isKill && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-400" />
                <span className="text-sm font-bold text-red-400">Kill Zone — Immediate Action Required</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{rows.length}</div>
                  <div className="text-[11px] text-slate-500">ads to kill</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{fmt.currency(totalDailyBurn)}</div>
                  <div className="text-[11px] text-slate-500">burning daily</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{fmt.currency(totalMonthlyWaste)}</div>
                  <div className="text-[11px] text-slate-500">est. monthly waste</div>
                </div>
              </div>
              {/* Kill actions guide */}
              <div className="border-t border-red-500/20 pt-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Recommended Actions</div>
                <div className="grid grid-cols-3 gap-2">
                  {KILL_ACTIONS.map(a => (
                    <div key={a.action} className="bg-gray-900/60 rounded-lg p-2.5">
                      <div className="text-[11px] font-semibold text-slate-200 mb-0.5">{a.label}</div>
                      <div className="text-[10px] text-slate-500">{a.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Aggregate metrics */}
          {agg && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <MetricCard label="Ads"       value={fmt.number(rows.length)}    color={cfg.color} />
              <MetricCard label="Budget"    value={agg.budget > 0 ? fmt.currency(agg.budget) : '—'} color={cfg.color} />
              <MetricCard label="Spend"     value={fmt.currency(agg.spend)}    color={cfg.color} />
              <MetricCard label="Revenue"   value={fmt.currency(agg.revenue)}  color={cfg.color} />
              <MetricCard label="ROAS"      value={fmt.roas(agg.roas)}         color={cfg.color} />
              <MetricCard label="Purchases" value={fmt.number(agg.purchases)}  color={cfg.color} />
            </div>
          )}

          {/* Kill-specific: individual kill cards for top offenders */}
          {isKill && killRows.length > 0 && (
            <div className="space-y-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Highest Waste Ads — Kill These First</div>
              {killRows.slice(0, 5).map(r => (
                <div key={r.adId} className="bg-gray-900 border border-red-500/20 rounded-xl p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-slate-200 truncate">{r.adName}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.campaignName} · {r.accountKey}</div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <AlertTriangle size={11} className="text-red-400 shrink-0" />
                        <span className="text-[11px] text-red-300">{r.killReason}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 shrink-0 text-right">
                      <div>
                        <div className="text-[10px] text-slate-500">7D ROAS</div>
                        <div className="text-[14px] font-bold text-red-400">{fmt.roas(r.metaRoas)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">7D Spend</div>
                        <div className="text-[14px] font-bold text-slate-200">{fmt.currency(r.spend)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Est. Monthly Waste</div>
                        <div className="text-[14px] font-bold text-red-400">{fmt.currency(r.monthlyWaste)}</div>
                      </div>
                    </div>
                  </div>
                  {/* Historical context */}
                  {safeNum(r.metaRoas30d) > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800/60 flex items-center gap-4 text-[11px] text-slate-500">
                      <span>30D ROAS: <strong className={safeNum(r.metaRoas30d) > safeNum(r.metaRoas) ? 'text-amber-400' : 'text-slate-400'}>{fmt.roas(r.metaRoas30d)}</strong></span>
                      {safeNum(r.metaRoas30d) > 3 && safeNum(r.metaRoas) < 2 && (
                        <span className="text-amber-400 flex items-center gap-1">
                          <TrendingDown size={11} /> Was {fmt.roas(r.metaRoas30d)} 30D ago — sharp decline
                        </span>
                      )}
                      {r.fatigueScore > 0 && <span>Fatigue: <strong className={r.fatigueScore >= 70 ? 'text-red-400' : 'text-slate-400'}>{r.fatigueScore}/100</strong></span>}
                      {r.collection && <span>Collection: {r.collection}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Chart */}
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

          {/* Full table */}
          <DataTable columns={columns} data={tableData} onViewRow={setViewRow} />
          {viewRow && <AdDetailDrawer row={viewRow} onClose={() => setViewRow(null)} />}
        </>
      )}
    </div>
  );
}
