import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter,
} from 'recharts';
import { TrendingUp, DollarSign, Clock, Zap, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import clsx from 'clsx';
import { fmt, safeNum, aggregateMetrics } from '../lib/analytics';
import { buildBudgetOpportunity, buildFrequencyTolerance } from '../lib/metaIntelligence';

const MOMENTUM_BAND = score => {
  if (score >= 60)  return { label: 'Surging',   color: '#22c55e', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  if (score >= 30)  return { label: 'Improving', color: '#86efac', bg: 'bg-emerald-500/5 border-emerald-500/10'  };
  if (score >= -15) return { label: 'Stable',    color: '#60a5fa', bg: 'bg-blue-500/10 border-blue-500/20'       };
  if (score >= -40) return { label: 'Softening', color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/20'    };
  return               { label: 'Declining',  color: '#f87171', bg: 'bg-red-500/10 border-red-500/20'       };
};

export default function Momentum() {
  const { enrichedRows } = useStore();
  const [tab, setTab] = useState(0);

  const budgetMap     = useMemo(() => buildBudgetOpportunity(enrichedRows), [enrichedRows]);
  const freqTolerance = useMemo(() => buildFrequencyTolerance(enrichedRows), [enrichedRows]);

  // Momentum ranked
  const momentumRanked = useMemo(() =>
    [...enrichedRows]
      .filter(r => safeNum(r.spend) > 0)
      .sort((a, b) => safeNum(b.momentumScore) - safeNum(a.momentumScore)),
    [enrichedRows]);

  // ROAS forecast data
  const forecastData = useMemo(() =>
    [...enrichedRows]
      .filter(r => safeNum(r.spend) >= 500 && r.predictedRoas7d != null)
      .sort((a, b) => safeNum(b.predictedRoas7d) - safeNum(a.predictedRoas7d))
      .slice(0, 15)
      .map(r => ({
        name:     r.adName?.slice(0, 30),
        current:  safeNum(r.metaRoas),
        predicted: safeNum(r.predictedRoas7d),
        delta:    safeNum(r.predictedRoas7d) - safeNum(r.metaRoas),
      })),
    [enrichedRows]);

  const TABS = ['Momentum Ranking', 'ROAS Forecast', 'Budget Opportunity', 'Frequency Tolerance'];

  const hasData = enrichedRows.length > 0;
  if (!hasData) return (
    <div className="flex items-center justify-center min-h-[50vh] text-slate-500 text-sm">
      Pull data first from Study Manual.
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <TrendingUp size={22} className="text-emerald-400" />
          Momentum Intelligence
        </h1>
        <p className="text-sm text-slate-500 mt-1">Trajectory scoring, ROAS forecasting, budget reallocation opportunities</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Surging Ads',    value: momentumRanked.filter(r => r.momentumScore >= 60).length,  color: 'text-emerald-400', icon: ArrowUpRight },
          { label: 'Improving',      value: momentumRanked.filter(r => r.momentumScore >= 30 && r.momentumScore < 60).length, color: 'text-teal-400', icon: TrendingUp },
          { label: 'Declining',      value: momentumRanked.filter(r => r.momentumScore < -15).length,  color: 'text-red-400',     icon: ArrowDownRight },
          { label: 'Scale Opportunities', value: budgetMap.scale?.length || 0, color: 'text-blue-400', icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <div className={clsx('text-2xl font-bold', color)}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/60 p-1 rounded-xl border border-gray-800 w-fit flex-wrap">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={clsx('px-4 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === i ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
            )}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Momentum Ranking ──────────────────────────────────────── */}
      {tab === 0 && (
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">All Ads by Momentum Score</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                  {['Ad', 'Collection', 'Momentum', 'Band', 'ROAS', 'Spend', 'Fatigue', 'Trend'].map(h => (
                    <th key={h} className={clsx('py-2 px-3', h === 'Ad' ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {momentumRanked.map(r => {
                  const band = MOMENTUM_BAND(r.momentumScore || 0);
                  return (
                    <tr key={r.adId} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                      <td className="py-2 px-3 text-slate-200 font-medium max-w-[200px] truncate">{r.adName}</td>
                      <td className="py-2 px-3 text-right text-slate-400">{r.collection || '—'}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, (r.momentumScore + 100) / 2))}%`, background: band.color }} />
                          </div>
                          <span className="font-bold w-10 text-right" style={{ color: band.color }}>
                            {r.momentumScore > 0 ? '+' : ''}{r.momentumScore || 0}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-[10px] font-semibold" style={{ color: band.color }}>{band.label}</span>
                      </td>
                      <td className={clsx('py-2 px-3 text-right font-bold', safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' : safeNum(r.metaRoas) >= 2.5 ? 'text-amber-400' : 'text-red-400')}>
                        {fmt.roas(r.metaRoas)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                      <td className={clsx('py-2 px-3 text-right', safeNum(r.fatigueScore) >= 70 ? 'text-red-400 font-bold' : 'text-slate-400')}>
                        {r.fatigueScore ?? 0}/100
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500 max-w-[140px] truncate">{r.trendSignal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ROAS Forecast ─────────────────────────────────────────── */}
      {tab === 1 && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-1">7-Day ROAS Forecast</h2>
            <p className="text-[11px] text-slate-500 mb-4">
              Predicted ROAS applies 50% of current trend momentum as linear projection.
              Use as a directional signal, not an exact prediction.
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={forecastData} layout="vertical" margin={{ left: 10, right: 60 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} width={140} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  formatter={(v, n) => [`${safeNum(v).toFixed(2)}x`, n]} />
                <Bar dataKey="current"   name="Current ROAS"   fill="#60a5fa" radius={[0, 4, 4, 0]} opacity={0.7} barSize={8} />
                <Bar dataKey="predicted" name="Predicted ROAS" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={8} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">Forecast Detail Table</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                    {['Ad', 'Current ROAS', 'Predicted 7D', 'Change', 'Spend'].map(h => (
                      <th key={h} className={clsx('py-2 px-3', h === 'Ad' ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...enrichedRows]
                    .filter(r => safeNum(r.spend) >= 500 && r.predictedRoas7d != null)
                    .sort((a, b) => safeNum(b.predictedRoas7d) - safeNum(a.predictedRoas7d))
                    .map(r => {
                      const delta = safeNum(r.predictedRoas7d) - safeNum(r.metaRoas);
                      return (
                        <tr key={r.adId} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                          <td className="py-2 px-3 text-slate-200 font-medium max-w-[220px] truncate">{r.adName}</td>
                          <td className="py-2 px-3 text-right text-slate-300">{fmt.roas(r.metaRoas)}</td>
                          <td className={clsx('py-2 px-3 text-right font-bold', safeNum(r.predictedRoas7d) >= 4 ? 'text-emerald-400' : safeNum(r.predictedRoas7d) >= 2.5 ? 'text-amber-400' : 'text-red-400')}>
                            {fmt.roas(r.predictedRoas7d)}
                          </td>
                          <td className={clsx('py-2 px-3 text-right font-semibold flex items-center justify-end gap-1',
                            delta > 0.1 ? 'text-emerald-400' : delta < -0.1 ? 'text-red-400' : 'text-slate-400')}>
                            {delta > 0 ? <ArrowUpRight size={11} /> : delta < 0 ? <ArrowDownRight size={11} /> : null}
                            {delta > 0 ? '+' : ''}{safeNum(delta).toFixed(2)}x
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Budget Opportunity ────────────────────────────────────── */}
      {tab === 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Scale Up */}
          <div className="bg-gray-900 border border-emerald-500/20 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-emerald-400 mb-1 flex items-center gap-2">
              <ArrowUpRight size={14} />
              Scale Up Opportunities
            </h2>
            <p className="text-[11px] text-slate-500 mb-3">High-ROAS ads currently underfunded vs account median.</p>
            {budgetMap.scale?.length === 0
              ? <div className="text-sm text-slate-500 py-4 text-center">No underfunded high-ROAS ads found.</div>
              : budgetMap.scale?.map((r, i) => (
                <div key={i} className="border-b border-gray-800/40 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-slate-200 truncate">{r.adName}</div>
                      <div className="text-[10px] text-slate-500">{r.collection}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-emerald-400 font-bold text-[13px]">{fmt.roas(r.roas)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                    <span>Current: {fmt.currency(r.budget)}/day</span>
                    <span className="text-emerald-400 font-semibold">→ {fmt.currency(r.suggestedBudget)}/day</span>
                    <span>Spend: {fmt.currency(r.spend)}</span>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Cut Budget */}
          <div className="bg-gray-900 border border-red-500/20 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-red-400 mb-1 flex items-center gap-2">
              <ArrowDownRight size={14} />
              Cut Budget Candidates
            </h2>
            <p className="text-[11px] text-slate-500 mb-3">Low-ROAS ads that are overfunded vs account median.</p>
            {budgetMap.cut?.length === 0
              ? <div className="text-sm text-slate-500 py-4 text-center">No obvious over-budgeted low-ROAS ads.</div>
              : budgetMap.cut?.map((r, i) => (
                <div key={i} className="border-b border-gray-800/40 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-slate-200 truncate">{r.adName}</div>
                      <div className="text-[10px] text-slate-500">{r.collection}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-red-400 font-bold text-[13px]">{fmt.roas(r.roas)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                    <span>Current: {fmt.currency(r.budget)}/day</span>
                    <span className="text-red-400 font-semibold">→ {fmt.currency(r.suggestedBudget)}/day</span>
                    <span>Spend: {fmt.currency(r.spend)}</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── Frequency Tolerance ───────────────────────────────────── */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-1">Frequency Tolerance by Audience Family</h2>
            <p className="text-[11px] text-slate-500 mb-4">
              At what frequency does ROAS start dropping for each audience type?
              This tells you the saturation threshold before you should rotate creatives.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(freqTolerance).map(([family, data]) => {
                if (!data?.length) return null;
                return (
                  <div key={family} className="bg-gray-800/40 rounded-xl p-4">
                    <div className="text-xs font-semibold text-slate-300 mb-3">{family}</div>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={data} margin={{ left: -15 }}>
                        <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#64748b' }} />
                        <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                          formatter={v => [`${safeNum(v).toFixed(2)}x`, 'Median ROAS']}
                          labelFormatter={l => `Freq ${l}`} />
                        <Bar dataKey="medianRoas" radius={[4, 4, 0, 0]}>
                          {data.map((e, i) => (
                            <Cell key={i} fill={e.medianRoas >= 4 ? '#22c55e' : e.medianRoas >= 3 ? '#60a5fa' : e.medianRoas >= 2 ? '#f59e0b' : '#f87171'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      {data.map(d => (
                        <div key={d.bucket} className="text-center text-[10px]">
                          <div className="text-slate-500">Freq {d.bucket}</div>
                          <div className="font-semibold text-slate-300">{safeNum(d.medianRoas).toFixed(2)}x</div>
                          <div className="text-slate-600">n={d.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
