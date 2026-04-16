import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  ScatterChart, Scatter, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { Flame, Eye, Video, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { fmt, safeNum, aggregateMetrics } from '../lib/analytics';
import {
  buildHookHoldMatrix, buildCreatorMatrix, buildRetentionComparison,
  buildOfferLiftMatrix,
} from '../lib/metaIntelligence';

const TABS = ['Hook × Hold', 'Fatigue Ranking', 'Creator Matrix', 'Offer Lift', 'Video Retention'];

export default function CreativeIntel() {
  const { enrichedRows } = useStore();
  const [tab, setTab] = useState(0);

  const hookHold    = useMemo(() => buildHookHoldMatrix(enrichedRows), [enrichedRows]);
  const creatorMatrix = useMemo(() => buildCreatorMatrix(enrichedRows), [enrichedRows]);
  const retention   = useMemo(() => buildRetentionComparison(enrichedRows), [enrichedRows]);
  const offerMatrix = useMemo(() => buildOfferLiftMatrix(enrichedRows), [enrichedRows]);

  const fatigueRanked = useMemo(() =>
    [...enrichedRows]
      .filter(r => safeNum(r.spend) > 0)
      .sort((a, b) => safeNum(b.fatigueScore) - safeNum(a.fatigueScore))
      .slice(0, 50),
    [enrichedRows]);

  const hasData = enrichedRows.length > 0;

  if (!hasData) return (
    <div className="flex items-center justify-center min-h-[50vh] text-slate-500 text-sm">
      Pull data first from Study Manual.
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Flame size={22} className="text-orange-400" />Creative Intelligence</h1>
        <p className="text-sm text-slate-500 mt-1">Deep creative analytics — what's working, what's dying, why</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/60 p-1 rounded-xl border border-gray-800 w-fit">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={clsx('px-4 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === i ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
            )}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Hook × Hold Matrix ─────────────────────────────────────── */}
      {tab === 0 && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <Eye size={14} className="text-blue-400" />
              Hook Rate × Hold Rate Scatter
            </h2>
            <p className="text-[11px] text-slate-500 mb-4">
              Hook = % of clicks that view landing page. Hold = % of impressions that watch through.
              Top-right quadrant = creatives with high scroll-stop AND retention. Those are your winners.
            </p>
            <ResponsiveContainer width="100%" height={340}>
              <ScatterChart margin={{ left: 0, right: 20, top: 10, bottom: 20 }}>
                <XAxis type="number" dataKey="hookRate" name="Hook Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }}
                  label={{ value: 'Hook Rate % (LPV/Clicks)', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#475569' }} />
                <YAxis type="number" dataKey="holdRate" name="Hold Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }}
                  label={{ value: 'Hold %', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#475569' }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs max-w-[220px] shadow-xl">
                      <div className="font-semibold text-white mb-2 truncate">{d.adName}</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400">
                        <span>Hook Rate</span><span className="text-white text-right">{d.hookRate}%</span>
                        <span>Hold Rate</span><span className="text-white text-right">{d.holdRate}%</span>
                        <span>ROAS</span><span className="text-emerald-400 font-bold text-right">{fmt.roas(d.roas)}</span>
                        <span>Spend</span><span className="text-white text-right">{fmt.currency(d.spend)}</span>
                      </div>
                      <div className="mt-2 text-[10px] text-slate-500 truncate">{d.collection}</div>
                    </div>
                  );
                }} />
                <Scatter data={hookHold.slice(0, 80)}>
                  {hookHold.slice(0, 80).map((entry, i) => (
                    <Cell key={i}
                      fill={entry.roas >= 4 ? '#22c55e' : entry.roas >= 2.5 ? '#60a5fa' : '#f87171'}
                      opacity={0.85}
                      r={Math.max(4, Math.min(14, Math.sqrt(entry.spend / 50)))}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> ROAS ≥4x</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" /> 2.5–4x</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" /> &lt;2.5x</span>
              <span className="ml-auto">Bubble size = spend</span>
            </div>
          </div>

          {/* Hook × Hold table */}
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-3">Top Hook × Hold Performers</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                    {['Ad', 'Collection', 'Hook%', 'Hold%', 'ROAS', 'CPR', 'Spend', 'Decision'].map(h => (
                      <th key={h} className={clsx('py-2 px-3', h === 'Ad' ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...hookHold]
                    .filter(r => r.hookRate > 0 && r.holdRate > 0)
                    .sort((a, b) => b.roas - a.roas)
                    .slice(0, 20)
                    .map((r, i) => (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                        <td className="py-2 px-3 text-slate-200 font-medium max-w-[200px] truncate">{r.adName}</td>
                        <td className="py-2 px-3 text-right text-slate-400">{r.collection}</td>
                        <td className="py-2 px-3 text-right text-blue-400 font-semibold">{r.hookRate}%</td>
                        <td className="py-2 px-3 text-right text-purple-400 font-semibold">{r.holdRate}%</td>
                        <td className={clsx('py-2 px-3 text-right font-bold', r.roas >= 4 ? 'text-emerald-400' : r.roas >= 2.5 ? 'text-amber-400' : 'text-red-400')}>{fmt.roas(r.roas)}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(r.cpr)}</td>
                        <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{r.decision}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Fatigue Ranking ────────────────────────────────────────── */}
      {tab === 1 && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              Creative Fatigue Ranking
            </h2>
            <p className="text-[11px] text-slate-500 mb-4">
              Fatigue score 0–100. Factors: frequency growth (25%), quality rank decay (30%), CTR decay (20%), ROAS decay (25%).
              Score ≥70 means creative death is near. Act before ROAS drops.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                    {['Ad', 'Collection', 'Fatigue', 'Days Left', 'Freq', 'ROAS', 'Spend', 'Decision'].map(h => (
                      <th key={h} className={clsx('py-2 px-3', h === 'Ad' ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fatigueRanked.map((r, i) => {
                    const fs = safeNum(r.fatigueScore);
                    return (
                      <tr key={r.adId} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                        <td className="py-2 px-3 text-slate-200 font-medium max-w-[200px] truncate">{r.adName}</td>
                        <td className="py-2 px-3 text-right text-slate-400">{r.collection || '—'}</td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${fs}%`, background: fs >= 70 ? '#f87171' : fs >= 50 ? '#f59e0b' : '#22c55e' }} />
                            </div>
                            <span className={clsx('font-bold', fs >= 70 ? 'text-red-400' : fs >= 50 ? 'text-amber-400' : 'text-emerald-400')}>
                              {fs}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {r.daysUntilFatigue != null ? `${r.daysUntilFatigue}d` : '—'}
                        </td>
                        <td className={clsx('py-2 px-3 text-right', safeNum(r.frequency) >= 3 ? 'text-red-400 font-bold' : 'text-slate-300')}>
                          {safeNum(r.frequency).toFixed(1)}
                        </td>
                        <td className={clsx('py-2 px-3 text-right font-bold', safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' : safeNum(r.metaRoas) >= 2.5 ? 'text-amber-400' : 'text-red-400')}>
                          {fmt.roas(r.metaRoas)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{r.decision}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Creator Matrix ─────────────────────────────────────────── */}
      {tab === 2 && (
        <div className="space-y-4">
          {creatorMatrix.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-8 text-center text-slate-500 text-sm">
              Tag creators in Study Manual to see this analysis.
            </div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Users size={14} className="text-purple-400" />
                  Creator Performance by Collection
                </h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={creatorMatrix.slice(0, 12)} layout="vertical" margin={{ left: 60, right: 30 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="creator" tick={{ fontSize: 10, fill: '#94a3b8' }} width={60} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      formatter={v => [`${safeNum(v).toFixed(2)}x`, 'ROAS']} />
                    <Bar dataKey="roas" radius={[0, 4, 4, 0]}>
                      {creatorMatrix.slice(0, 12).map((e, i) => (
                        <Cell key={i} fill={e.roas >= 4 ? '#22c55e' : e.roas >= 3 ? '#60a5fa' : e.roas >= 2 ? '#f59e0b' : '#f87171'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                        {['Creator', 'Collection', 'ROAS', 'CPR', 'Spend', 'Revenue', 'Ads'].map(h => (
                          <th key={h} className={clsx('py-2 px-3', h === 'Creator' ? 'text-left' : 'text-right')}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {creatorMatrix.map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                          <td className="py-2 px-3 text-slate-200 font-medium">{r.creator}</td>
                          <td className="py-2 px-3 text-right text-slate-400">{r.collection}</td>
                          <td className={clsx('py-2 px-3 text-right font-bold', r.roas >= 4 ? 'text-emerald-400' : r.roas >= 2.5 ? 'text-amber-400' : 'text-red-400')}>
                            {safeNum(r.roas).toFixed(2)}x
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(r.cpr)}</td>
                          <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                          <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(r.revenue)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Offer Lift ─────────────────────────────────────────────── */}
      {tab === 3 && (
        <div className="space-y-4">
          {offerMatrix.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-8 text-center text-slate-500 text-sm">
              Tag offer types in Study Manual to see this analysis.
            </div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-4">Collection × Offer Type ROAS Matrix</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={offerMatrix.slice(0, 14)} margin={{ left: -10, right: 20, bottom: 40 }}>
                    <XAxis dataKey="offerType" tick={{ fontSize: 9, fill: '#64748b' }} angle={-30} textAnchor="end" />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      formatter={v => [`${safeNum(v).toFixed(2)}x`, 'ROAS']} />
                    <Bar dataKey="roas" radius={[4, 4, 0, 0]}>
                      {offerMatrix.slice(0, 14).map((e, i) => (
                        <Cell key={i} fill={e.roas >= 4 ? '#22c55e' : e.roas >= 3 ? '#60a5fa' : e.roas >= 2 ? '#f59e0b' : '#f87171'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                        {['Collection', 'Offer Type', 'ROAS', 'CPR', 'Spend', 'Purchases', 'Ads'].map(h => (
                          <th key={h} className={clsx('py-2 px-3', h === 'Collection' ? 'text-left' : 'text-right')}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {offerMatrix.map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                          <td className="py-2 px-3 text-slate-200 font-medium">{r.collection}</td>
                          <td className="py-2 px-3 text-right text-slate-400">{r.offerType}</td>
                          <td className={clsx('py-2 px-3 text-right font-bold', r.roas >= 4 ? 'text-emerald-400' : r.roas >= 3 ? 'text-blue-400' : r.roas >= 2 ? 'text-amber-400' : 'text-red-400')}>
                            {safeNum(r.roas).toFixed(2)}x
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(r.cpr)}</td>
                          <td className="py-2 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                          <td className="py-2 px-3 text-right text-slate-300">{fmt.number(r.purchases)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Video Retention ────────────────────────────────────────── */}
      {tab === 4 && (
        <div className="space-y-4">
          {!retention ? (
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-8 text-center text-slate-500 text-sm">
              Not enough video data (need ≥4 ads with &gt;100 plays).
            </div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                  <Video size={14} className="text-purple-400" />
                  Top vs Bottom Performer Retention Curves
                </h2>
                <p className="text-[11px] text-slate-500 mb-4">
                  Top 25% ads by ROAS vs Bottom 25%. Where the curves diverge = your drop-off point.
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={[
                      { label: '25%',  top: retention.top.p25,  bottom: retention.bottom.p25  },
                      { label: '50%',  top: retention.top.p50,  bottom: retention.bottom.p50  },
                      { label: '75%',  top: retention.top.p75,  bottom: retention.bottom.p75  },
                      { label: '95%',  top: retention.top.p95,  bottom: retention.bottom.p95  },
                      { label: '100%', top: retention.top.p100, bottom: retention.bottom.p100 },
                    ]}
                    margin={{ left: -10, right: 20 }}
                  >
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                      formatter={v => [`${safeNum(v).toFixed(1)}%`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="top" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4 }} name={`Top ${retention.top.count} ads`} />
                    <Line type="monotone" dataKey="bottom" stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" name={`Bottom ${retention.bottom.count} ads`} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                  <div className="text-xs font-semibold text-emerald-400 mb-3">Top Performers</div>
                  {retention.topAds.map(r => (
                    <div key={r.adId} className="flex items-center justify-between py-1.5 border-b border-gray-800/40 text-[12px]">
                      <span className="text-slate-300 truncate max-w-[180px]">{r.adName}</span>
                      <span className="text-emerald-400 font-bold ml-2">{fmt.roas(r.roas)}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
                  <div className="text-xs font-semibold text-white mb-3">Retention Metrics</div>
                  <div className="space-y-2 text-[12px]">
                    {[
                      { label: '25% completion', top: retention.top.p25, bot: retention.bottom.p25 },
                      { label: '50% completion', top: retention.top.p50, bot: retention.bottom.p50 },
                      { label: '75% completion', top: retention.top.p75, bot: retention.bottom.p75 },
                      { label: '100% completion', top: retention.top.p100, bot: retention.bottom.p100 },
                      { label: 'ThruPlay Rate', top: retention.top.holdRate, bot: retention.bottom.holdRate },
                    ].map(m => (
                      <div key={m.label} className="flex items-center justify-between">
                        <span className="text-slate-500">{m.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-emerald-400 font-semibold">{safeNum(m.top).toFixed(1)}%</span>
                          <span className="text-slate-600">vs</span>
                          <span className="text-red-400">{safeNum(m.bot).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
