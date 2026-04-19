import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, Cell, CartesianGrid,
} from 'recharts';
import { Trophy } from 'lucide-react';
import { useStore } from '../store';
import Badge from '../components/ui/Badge';
import { aggregateMetrics, groupBy, fmt, safeNum, median } from '../lib/analytics';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';
import { FullPageSpinner } from '../components/ui/Spinner';

const COLORS = ['#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c'];

function scoreAd(r, medians) {
  let score = 0;
  const roas = safeNum(r.metaRoas);
  const cpr  = safeNum(r.metaCpr);
  const freq = safeNum(r.frequency);

  if (roas >= 6) score += 30;
  else if (roas >= 4) score += 20;
  else if (roas >= 2.5) score += 10;
  else score -= 10;

  if (medians.cpr > 0 && cpr > 0 && cpr < medians.cpr * 0.8) score += 15;
  else if (medians.cpr > 0 && cpr > medians.cpr * 1.3) score -= 10;

  if (medians.roas > 0 && roas > medians.roas * 1.2) score += 10;

  if (r.trendSignal?.includes('Improving')) score += 15;
  if (r.trendSignal?.includes('Worsening') || r.trendSignal?.includes('Fatigue')) score -= 10;

  if (freq > 3.5) score -= 10;
  if (freq < 1.8 && safeNum(r.spend) > 200) score += 5;

  return Math.max(0, Math.min(100, score + 50));
}

function AccountCard({ accountKey, rows, medians }) {
  const agg = aggregateMetrics(rows);
  if (!agg) return null;

  const scores = rows.map(r => scoreAd(r, medians));
  const avgScore = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;

  const decisionBreakdown = {};
  rows.forEach(r => { decisionBreakdown[r.decision] = (decisionBreakdown[r.decision] || 0) + 1; });

  const radarData = [
    { metric: 'ROAS',     value: Math.min(100, (safeNum(agg.roas) / 8) * 100) },
    { metric: 'Conv%',    value: Math.min(100, safeNum(agg.convRate) * 10) },
    { metric: 'ATC%',     value: Math.min(100, safeNum(agg.atcRate) * 5) },
    { metric: 'CTR',      value: Math.min(100, safeNum(agg.ctr) * 5) },
    { metric: 'LPV%',     value: Math.min(100, safeNum(agg.lpvRate) * 2) },
    { metric: 'CPM eff',  value: Math.max(0, 100 - safeNum(agg.cpm) / 10) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-bold text-white">{accountKey}</div>
          <div className="text-xs text-slate-500">{rows.length} active ads</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold" style={{
            color: avgScore >= 70 ? '#22c55e' : avgScore >= 50 ? '#f59e0b' : '#ef4444'
          }}>{Math.round(avgScore)}</div>
          <div className="text-[10px] text-slate-500">Health Score</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: 'Spend',    v: fmt.currency(agg.spend) },
          { l: 'Revenue',  v: fmt.currency(agg.revenue) },
          { l: 'ROAS',     v: fmt.roas(agg.roas) },
          { l: 'CPR',      v: fmt.currency(agg.cpr) },
          { l: 'Purchases',v: fmt.number(agg.purchases) },
          { l: 'CTR',      v: fmt.pct(agg.ctr) },
        ].map(m => (
          <div key={m.l} className="bg-gray-800/50 rounded-lg p-2">
            <div className="text-sm font-semibold text-white">{m.v}</div>
            <div className="text-[10px] text-slate-500">{m.l}</div>
          </div>
        ))}
      </div>

      {/* Radar */}
      <ResponsiveContainer width="100%" height={160}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={60}>
          <PolarGrid stroke="#374151" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <Radar dataKey="value" stroke="#2d7cf6" fill="#2d7cf6" fillOpacity={0.3} />
          <Tooltip formatter={v => `${v.toFixed(0)}/100`} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Decision breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(decisionBreakdown).map(([d, c]) => (
          <span key={d} className="flex items-center gap-1">
            <Badge label={d} size="xs" />
            <span className="text-xs text-slate-500">×{c}</span>
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export default function Scorecard() {
  const { enrichedRows, fetchStatus, brands, activeBrandIds, brandData } = useStore();

  const accountGroups = useMemo(() => groupBy(enrichedRows, 'accountKey'), [enrichedRows]);

  // Cross-channel totals across active brands
  const crossChannel = useMemo(() => {
    const activeIds = activeBrandIds || [];
    const metaAgg = aggregateMetrics(enrichedRows) || { spend: 0, revenue: 0 };
    const google = activeIds.reduce((acc, bid) => {
      const d = brandData?.[bid]?.googleAdsData;
      if (!d) return acc;
      const t = totalsFromNormalized(d);
      acc.spend   += t.spend;
      acc.revenue += t.conversionValue;
      return acc;
    }, { spend: 0, revenue: 0 });
    const meta = { spend: safeNum(metaAgg.spend), revenue: safeNum(metaAgg.revenue) };
    const total = { spend: meta.spend + google.spend, revenue: meta.revenue + google.revenue };
    return {
      meta,
      google,
      total,
      metaRoas:   meta.spend   > 0 ? meta.revenue   / meta.spend   : 0,
      googleRoas: google.spend > 0 ? google.revenue / google.spend : 0,
      totalRoas:  total.spend  > 0 ? total.revenue  / total.spend  : 0,
      hasGoogle:  google.spend > 0,
    };
  }, [enrichedRows, brandData, activeBrandIds]);

  const globalMedians = useMemo(() => ({
    cpr:  median(enrichedRows.map(r => safeNum(r.metaCpr)).filter(v => v > 0)),
    roas: median(enrichedRows.map(r => safeNum(r.metaRoas)).filter(v => v > 0)),
  }), [enrichedRows]);

  // Collection scorecard
  const collectionData = useMemo(() => {
    const groups = groupBy(
      enrichedRows.filter(r => r.collection && r.collection !== 'Unknown' && safeNum(r.spend) > 0),
      'collection',
    );
    return Object.entries(groups).map(([collection, rows]) => {
      const agg = aggregateMetrics(rows);
      return { collection, ...agg, count: rows.length };
    }).sort((a, b) => safeNum(b.roas) - safeNum(a.roas));
  }, [enrichedRows]);

  if (fetchStatus === 'loading') return <FullPageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-amber-500/20">
          <Trophy size={20} className="text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Scorecard</h1>
          <p className="text-sm text-slate-500 mt-1">Account-level and collection-level performance scoring</p>
        </div>
      </div>

      {/* Cross-channel banner */}
      {crossChannel.hasGoogle && (
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
          className="bg-gradient-to-br from-gray-900 to-gray-900/40 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Cross-Channel · All Active Brands</h2>
            <span className="text-[10px] text-slate-600">Meta + Google Ads</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-950/50 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Spend</div>
              <div className="text-lg font-bold text-white">{fmt.currency(crossChannel.total.spend)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                Meta {fmt.currency(crossChannel.meta.spend)} · Google {fmt.currency(crossChannel.google.spend)}
              </div>
            </div>
            <div className="bg-gray-950/50 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Revenue</div>
              <div className="text-lg font-bold text-emerald-400">{fmt.currency(crossChannel.total.revenue)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                Meta {fmt.currency(crossChannel.meta.revenue)} · Google {fmt.currency(crossChannel.google.revenue)}
              </div>
            </div>
            <div className="bg-gray-950/50 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Blended ROAS</div>
              <div className="text-lg font-bold text-violet-300">{fmt.roas(crossChannel.totalRoas)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                Meta {fmt.roas(crossChannel.metaRoas)} · Google {fmt.roas(crossChannel.googleRoas)}
              </div>
            </div>
            <div className="bg-gray-950/50 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Channel Mix</div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-800 my-2">
                <div style={{ width: `${crossChannel.total.spend > 0 ? (crossChannel.meta.spend   / crossChannel.total.spend) * 100 : 0}%`, background: '#2d7cf6' }} />
                <div style={{ width: `${crossChannel.total.spend > 0 ? (crossChannel.google.spend / crossChannel.total.spend) * 100 : 0}%`, background: '#f59e0b' }} />
              </div>
              <div className="text-[10px] text-slate-500 flex justify-between">
                <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />Meta {fmt.pct(crossChannel.total.spend > 0 ? (crossChannel.meta.spend/crossChannel.total.spend)*100 : 0)}</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Google {fmt.pct(crossChannel.total.spend > 0 ? (crossChannel.google.spend/crossChannel.total.spend)*100 : 0)}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Account scorecards */}
      {Object.keys(accountGroups).length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-12 text-center text-slate-500">
          Pull Meta data first.
        </div>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Account Scorecards</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {Object.entries(accountGroups).map(([key, rows]) => (
              <AccountCard key={key} accountKey={key} rows={rows} medians={globalMedians} />
            ))}
          </div>
        </>
      )}

      {/* Collection scorecard table */}
      {collectionData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-slate-300">Collection Scorecard</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={collectionData}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
              <XAxis dataKey="collection" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis yAxisId="l" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip />
              <Bar yAxisId="l" dataKey="roas"  name="ROAS"  fill="#a78bfa" radius={[4,4,0,0]}>
                {collectionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Collection','Ads','Spend','Revenue','ROAS','CPR','Purchases','Conv%','ATC%'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-slate-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {collectionData.map((d, i) => (
                  <tr key={d.collection} className={i % 2 === 0 ? 'bg-gray-950/30' : ''}>
                    <td className="px-3 py-2 font-medium text-slate-200">{d.collection}</td>
                    <td className="px-3 py-2 text-slate-400">{d.count}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.currency(d.spend)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.currency(d.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-violet-300">{fmt.roas(d.roas)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.currency(d.cpr)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.number(d.purchases)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.pct(d.convRate)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt.pct(d.atcRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
