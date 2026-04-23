import { useMemo, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays, FolderDown, Upload, RefreshCw, Zap, TrendingUp,
  TrendingDown, Sparkles, AlertTriangle, Flame, PackageOpen, X,
  CheckCircle2, ExternalLink,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar, LabelList,
} from 'recharts';
import { useStore } from '../store';
import { listPublicDriveFolder, downloadPublicDriveFile } from '../lib/api';
import {
  parseUtmReport, extractBrandFromName, analyzeReports,
  breakdownBy, crossBreakdown, trendByDimension,
  cvrAnomalies, joinMetaByCampaign, funnelLeakage,
} from '../lib/utmReportAnalytics';

const cur = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const num = v => (Number(v) || 0).toLocaleString('en-IN');
const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);

function deltaColor(v) {
  if (v == null) return 'text-slate-400';
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400';
}

function KPI({ label, value, sub, delta, color = '#06b6d4' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      {delta != null && <div className={`text-[11px] mt-0.5 ${deltaColor(delta)}`}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}% DoD</div>}
    </div>
  );
}

function Card({ title, children, icon: Icon, tone = 'neutral' }) {
  const bg = tone === 'bad' ? 'border-red-800/40 bg-red-900/10'
           : tone === 'good' ? 'border-emerald-800/40 bg-emerald-900/10'
           : tone === 'warn' ? 'border-amber-800/40 bg-amber-900/10'
           : 'border-gray-800 bg-gray-900';
  return (
    <div className={`rounded-xl border ${bg} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-slate-400" />}
        <h3 className="text-xs font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ChannelRow({ row, mode }) {
  const badge = row.isNew ? 'NEW' : row.isGone ? 'GONE' : row.severity ? row.severity.toUpperCase() : '';
  const badgeClass = row.isNew ? 'bg-emerald-900/40 text-emerald-300'
                    : row.isGone ? 'bg-gray-800 text-slate-400'
                    : row.severity === 'critical' ? 'bg-red-900/40 text-red-300'
                    : row.severity === 'high' ? 'bg-orange-900/40 text-orange-300'
                    : 'bg-amber-900/40 text-amber-300';
  // Primary metric: revenue if present, else checkouts, else orders
  const primary = row.revenue > 0 ? `${cur(row.revenue)} · ${row.orders} orders`
                 : row.checkoutInitiated > 0 ? `${row.checkoutInitiated} checkouts · ${row.orders} orders`
                 : `${row.orders} orders`;
  const priorDisplay = mode === 'emerging' || mode === 'fading' ? null
                     : row.revenuePrior > 0 ? `was ${cur(row.revenuePrior)}`
                     : row.checkoutInitiatedPrior > 0 ? `was ${row.checkoutInitiatedPrior} checkouts`
                     : row.ordersPrior > 0 ? `was ${row.ordersPrior} orders`
                     : null;
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-950/40 border border-gray-800/30">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 font-medium truncate">{row.channel}</div>
        {row.reason && <div className="text-[11px] text-slate-500 mt-0.5">{row.reason}</div>}
      </div>
      <div className="text-right text-[11px] text-slate-400">
        <div>{primary}</div>
        {priorDisplay && <div className="text-[10px] text-slate-600">{priorDisplay}</div>}
      </div>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${badgeClass}`}>{badge}</span>
      )}
    </div>
  );
}

const PIE_COLORS = ['#22c55e', '#06b6d4', '#a78bfa', '#f59e0b', '#f472b6', '#34d399', '#60a5fa', '#fb923c', '#ef4444', '#eab308'];
const TREND_COLORS = ['#22c55e', '#06b6d4', '#a78bfa', '#f59e0b', '#f472b6', '#fb923c'];

function BreakdownVisuals({ breakBySource, breakByMedium, breakByCampaign, matrix, perSourceTrend, perMediumTrend, anomalies, leakage, metaJoin }) {
  if (!breakBySource || !breakByMedium) return null;

  // Show ALL items — no "Other" collapse. Filter out zero-value items so the
  // pie is readable but nothing meaningful is hidden.
  const makePieData = (b) => {
    if (!b) return [];
    return b.items
      .filter(x => (x[b.primary] || 0) > 0)
      .map(x => ({ name: x.name || '(unknown)', value: x[b.primary] || 0, orders: x.orders, checkouts: x.checkoutInitiated, cvr: x.cvr }));
  };
  const pieSrc = makePieData(breakBySource);
  const pieMed = makePieData(breakByMedium);

  const primaryLabel = breakBySource.primary === 'revenue' ? 'Revenue' : 'Orders';

  return (
    <div className="space-y-4">
      {/* Row 1: Two pie charts — all segments */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={`${primaryLabel} by source · all ${breakBySource.items.length} segments`}>
          {pieSrc.length === 0 ? <div className="text-xs italic text-slate-500">No source data.</div> : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={240}>
                <PieChart>
                  <Pie data={pieSrc} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={90} paddingAngle={2}>
                    {pieSrc.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
                    formatter={(v, _n, p) => [primaryLabel === 'Revenue' ? cur(v) : num(v), p.payload.name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1 text-[11px]">
                {pieSrc.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-slate-300 truncate flex-1">{s.name}</span>
                    <span className="text-slate-500 font-mono">{num(s.orders)} ord</span>
                    <span className="text-slate-600 font-mono">{((s.value / pieSrc.reduce((a, x) => a + x.value, 0)) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title={`${primaryLabel} by medium · all ${breakByMedium.items.length} segments`}>
          {pieMed.length === 0 ? <div className="text-xs italic text-slate-500">No medium data.</div> : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={240}>
                <PieChart>
                  <Pie data={pieMed} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={90} paddingAngle={2}>
                    {pieMed.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
                    formatter={(v, _n, p) => [primaryLabel === 'Revenue' ? cur(v) : num(v), p.payload.name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1 text-[11px]">
                {pieMed.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-slate-300 truncate flex-1">{s.name}</span>
                    <span className="text-slate-500 font-mono">{num(s.orders)} ord</span>
                    <span className="text-slate-600 font-mono">{((s.value / pieMed.reduce((a, x) => a + x.value, 0)) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Row 2: All campaigns bar chart — scrolls if long */}
      <Card title={`All ${breakByCampaign?.items.length || 0} campaigns · orders (bars) + CVR (labels)`}>
        {!breakByCampaign?.items.length ? <div className="text-xs italic text-slate-500">No campaign data.</div> : (() => {
          const data = breakByCampaign.items.filter(c => c.orders > 0 || c.checkoutInitiated > 0).map(c => ({ ...c, cvrPct: c.cvr * 100 }));
          const chartHeight = Math.min(2400, Math.max(240, data.length * 24));
          return (
            <div className="overflow-auto" style={{ maxHeight: '640px' }}>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={data} layout="vertical" margin={{ left: 200, right: 80 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={190} interval={0} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
                    formatter={(v, n) => n === 'orders' ? [num(v), 'Orders'] : [`${v.toFixed(1)}%`, 'CVR']} />
                  <Bar dataKey="orders" fill="#22c55e" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="cvrPct" position="right" formatter={v => v > 0 ? `${v.toFixed(0)}%` : ''} fill="#64748b" fontSize={10} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </Card>

      {/* Row 3: Source × Medium matrix heatmap */}
      {matrix?.rows.length > 0 && matrix?.cols.length > 0 && (
        <Card title={`Source × Medium matrix · orders (${matrix.rows.length} × ${matrix.cols.length})`}>
          <div className="overflow-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-slate-500 font-semibold sticky left-0 bg-gray-900 min-w-[120px]">source ↓ / medium →</th>
                  {matrix.cols.map(c => <th key={c} className="px-2 py-1 text-left text-slate-500 font-semibold min-w-[80px]">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(r => {
                  const maxCell = Math.max(...matrix.cols.map(c => (matrix.matrix[`${r}|${c}`]?.orders) || 0), 1);
                  return (
                    <tr key={r}>
                      <td className="px-2 py-1 font-medium text-slate-300 sticky left-0 bg-gray-900">{r}</td>
                      {matrix.cols.map(c => {
                        const cell = matrix.matrix[`${r}|${c}`];
                        const orders = cell?.orders || 0;
                        const intensity = maxCell > 0 ? orders / maxCell : 0;
                        return (
                          <td key={c} className="px-2 py-1 font-mono text-right" style={{ background: `rgba(34,197,94,${(intensity * 0.6).toFixed(2)})`, color: intensity > 0.4 ? '#fff' : '#94a3b8' }}
                              title={`${r} / ${c}: ${orders} orders · ${cell?.checkoutInitiated || 0} checkouts`}>
                            {orders > 0 ? orders : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-slate-500 mt-2">Green intensity = orders relative to the row's max cell. Hover a cell for checkout + order counts.</div>
        </Card>
      )}

      {/* Row 4: Per-source trend lines (needs 2+ snapshots) */}
      {perSourceTrend?.data.length > 1 && perSourceTrend.keys.length > 0 && (
        <Card title={`Top sources · ${perSourceTrend.metric} over last ${perSourceTrend.data.length} days`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={perSourceTrend.data}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {perSourceTrend.keys.map((k, i) => <Line key={k} dataKey={k} stroke={TREND_COLORS[i % TREND_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Row 5: Per-medium trend lines */}
      {perMediumTrend?.data.length > 1 && perMediumTrend.keys.length > 0 && (
        <Card title={`Top mediums · ${perMediumTrend.metric} over last ${perMediumTrend.data.length} days`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={perMediumTrend.data}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {perMediumTrend.keys.map((k, i) => <Line key={k} dataKey={k} stroke={TREND_COLORS[i % TREND_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Row 6: CVR anomalies — overperformers, underperformers, zero-CVR */}
      {anomalies && (anomalies.overperformers.length > 0 || anomalies.underperformers.length > 0 || anomalies.zeroCvr.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title={`CVR Overperformers · ${anomalies.overperformers.length}`} tone="good">
            <p className="text-[10px] text-slate-500 mb-2">Campaigns &gt;1.5σ above peer mean CVR ({(anomalies.mean * 100).toFixed(1)}%). Scale candidates.</p>
            {anomalies.overperformers.length === 0 ? <div className="text-xs italic text-slate-500">None detected.</div> :
              <div className="space-y-1">
                {anomalies.overperformers.map((r, i) => (
                  <div key={i} className="text-[11px] flex items-center gap-2 py-1 border-b border-gray-800/40">
                    <span className="text-slate-200 truncate flex-1">{r.utmCampaign || '(no campaign)'}</span>
                    <span className="text-emerald-300 font-mono">{(r.cvr * 100).toFixed(0)}% CVR</span>
                    <span className="text-slate-500 font-mono">{r.orders}o</span>
                  </div>
                ))}
              </div>
            }
          </Card>
          <Card title={`CVR Underperformers · ${anomalies.underperformers.length}`} tone="warn">
            <p className="text-[10px] text-slate-500 mb-2">Real checkout volume but CVR &gt;1σ below mean. Offer/page/pricing issues.</p>
            {anomalies.underperformers.length === 0 ? <div className="text-xs italic text-slate-500">None detected.</div> :
              <div className="space-y-1">
                {anomalies.underperformers.map((r, i) => (
                  <div key={i} className="text-[11px] flex items-center gap-2 py-1 border-b border-gray-800/40">
                    <span className="text-slate-200 truncate flex-1">{r.utmCampaign || '(no campaign)'}</span>
                    <span className="text-amber-300 font-mono">{(r.cvr * 100).toFixed(0)}%</span>
                    <span className="text-slate-500 font-mono">{r.checkoutInitiated} ci</span>
                  </div>
                ))}
              </div>
            }
          </Card>
          <Card title={`Zero-CVR Bleeders · ${anomalies.zeroCvr.length}`} tone="bad">
            <p className="text-[10px] text-slate-500 mb-2">10+ checkouts, 0 orders. Total conversion leaks.</p>
            {anomalies.zeroCvr.length === 0 ? <div className="text-xs italic text-slate-500">None detected.</div> :
              <div className="space-y-1">
                {anomalies.zeroCvr.map((r, i) => (
                  <div key={i} className="text-[11px] flex items-center gap-2 py-1 border-b border-gray-800/40">
                    <span className="text-slate-200 truncate flex-1">{r.utmCampaign || '(no campaign)'}</span>
                    <span className="text-red-300 font-mono">{r.checkoutInitiated} ci</span>
                  </div>
                ))}
              </div>
            }
          </Card>
        </div>
      )}

      {/* Row 7: Funnel leakage — where are checkouts dying */}
      {leakage && leakage.length > 0 && (
        <Card title={`Funnel leakage · ${leakage.length} campaigns lose ${num(leakage.reduce((s, l) => s + l.leaked, 0))} checkouts before order`} icon={AlertTriangle} tone="warn">
          <div className="overflow-auto" style={{ maxHeight: '360px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Campaign</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Source / Medium</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Checkouts</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Leaked</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">CVR</th>
                </tr>
              </thead>
              <tbody>
                {leakage.slice(0, 60).map((l, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-200 truncate max-w-[240px]">{l.name}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{l.source} / {l.medium}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(l.checkoutInitiated)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(l.orders)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400 font-semibold">{num(l.leaked)}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-400">{(l.cvr * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Row 8: Meta × UTM join — cross-channel attribution */}
      {metaJoin && metaJoin.matched.length > 0 && (
        <Card title={`Meta × UTM join · ${metaJoin.matched.length} matched campaigns · ${num(metaJoin.totals.unmatchedCount)} unmatched`}>
          <p className="text-[11px] text-slate-500 mb-3">
            Fuzzy-matched UTM campaign names against Meta ad/adset/campaign names (Jaccard ≥ 0.35).
            Meta spend: {cur(metaJoin.totals.metaSpendTotal)} · Meta-reported purchases: {num(metaJoin.totals.metaPurchasesTotal)} · UTM-observed orders: {num(metaJoin.totals.utmOrdersTotal)}.
            Attribution delta lets you see where Meta over/under-counts vs ground-truth UTM.
          </p>
          <div className="overflow-auto" style={{ maxHeight: '460px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">UTM Campaign</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Meta match</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Meta spend</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Meta purch.</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">UTM orders</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Δ (Meta − UTM)</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">CPO (Meta/UTM)</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">CVR</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Match</th>
                </tr>
              </thead>
              <tbody>
                {metaJoin.matched.slice(0, 100).map((m, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-200 truncate max-w-[220px]">{m.utmCampaign}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 truncate max-w-[220px]">{m.metaEntity}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(m.metaSpend)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(m.metaPurchases)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{num(m.utmOrders)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${m.attributionDelta > 0 ? 'text-emerald-400' : m.attributionDelta < 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {m.attributionDelta > 0 ? '+' : ''}{m.attributionDelta}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{m.cpoMeta != null ? cur(m.cpoMeta) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{(m.utmCvr * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] text-slate-600">{(m.matchScore * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function DailyReports() {
  const {
    brands, activeBrandIds, brandData, enrichedRows,
    upsertBrandUtmReport, removeBrandUtmSnapshot,
  } = useStore();

  const bBrands = (brands || []).filter(b => activeBrandIds.includes(b.id));
  const [selectedBrandId, setSelectedBrandId] = useState(() => bBrands[0]?.id || '');
  const brand = brands.find(b => b.id === selectedBrandId);
  const bData = brandData?.[selectedBrandId] || {};
  const snapshots = bData.utmSnapshots || [];

  const [pulling, setPulling]   = useState(false);
  const [error, setError]       = useState(null);
  const [log, setLog]           = useState([]);
  const appendLog = msg => setLog(prev => [...prev.slice(-20), { t: Date.now(), msg }]);

  const fileInputRef = useRef(null);

  const handlePullDrive = useCallback(async () => {
    const folderUrl = brand?.drive?.folderUrl;
    if (!folderUrl) {
      setError('Paste this brand\'s Drive folder share link in Study Manual first.');
      return;
    }
    setPulling(true); setError(null); setLog([]);
    try {
      appendLog(`Listing files in folder…`);
      const files = await listPublicDriveFolder(folderUrl);
      const csvs = files.filter(f => /\.csv$/i.test(f.name));
      appendLog(`Found ${csvs.length} CSV file(s) in the folder`);
      const known = new Set(snapshots.map(s => s.filename));
      const newFiles = csvs.filter(f => !known.has(f.name));
      appendLog(`${newFiles.length} new file(s) since last sync`);
      let importedCount = 0;
      for (const f of newFiles.slice(0, 20)) {
        try {
          appendLog(`  → ${f.name}`);
          const csv = await downloadPublicDriveFile(f.id);
          const snap = parseUtmReport(csv, { filename: f.name });
          snap.driveFileId = f.id;
          upsertBrandUtmReport(brand.id, snap);
          importedCount++;
        } catch (e) {
          appendLog(`    ✗ ${e.message}`);
        }
      }
      appendLog(`Done — imported ${importedCount} snapshot(s)`);
    } catch (e) {
      setError(e.message);
      appendLog(`✗ ${e.message}`);
    } finally {
      setPulling(false);
    }
  }, [brand, snapshots, upsertBrandUtmReport]);

  const handleFiles = useCallback(async (files) => {
    if (!brand || !files?.length) return;
    setPulling(true); setError(null); setLog([]);
    try {
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.csv')) continue;
        const text = await f.text();
        const inferredBrandId = extractBrandFromName(f.name, brands);
        const targetBrandId = inferredBrandId || brand.id;
        const snap = parseUtmReport(text, { filename: f.name });
        upsertBrandUtmReport(targetBrandId, snap);
        appendLog(`✓ ${f.name} → ${brands.find(b => b.id === targetBrandId)?.name || 'brand'} · ${snap.rows.length} rows · ${snap.reportDate}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPulling(false);
    }
  }, [brand, brands, upsertBrandUtmReport]);

  const analysis = useMemo(() => analyzeReports(snapshots), [snapshots]);

  /* Trend chart data: newest 14 days, sums per day across all channels */
  const trendData = useMemo(() => {
    if (!snapshots.length) return [];
    return snapshots.slice(-14).map(s => {
      const totals = (s.rows || []).reduce((a, r) => {
        a.revenue            += r.revenue || 0;
        a.sessions           += r.sessions || 0;
        a.orders             += r.orders || 0;
        a.checkoutInitiated  += r.checkoutInitiated || 0;
        return a;
      }, { revenue: 0, sessions: 0, orders: 0, checkoutInitiated: 0 });
      return { date: s.reportDate.slice(5), ...totals };
    });
  }, [snapshots]);
  const trendHasRevenue  = trendData.some(d => d.revenue > 0);
  const trendHasSessions = trendData.some(d => d.sessions > 0);
  const trendHasCheckouts = trendData.some(d => d.checkoutInitiated > 0);

  /* Breakdowns — no topN cap, show ALL segments */
  const breakBySource   = useMemo(() => analysis?.latest ? breakdownBy(analysis.latest, 'utmSource')   : null, [analysis]);
  const breakByMedium   = useMemo(() => analysis?.latest ? breakdownBy(analysis.latest, 'utmMedium')   : null, [analysis]);
  const breakByCampaign = useMemo(() => analysis?.latest ? breakdownBy(analysis.latest, 'utmCampaign') : null, [analysis]);
  const matrix          = useMemo(() => analysis?.latest ? crossBreakdown(analysis.latest, 'utmSource', 'utmMedium') : null, [analysis]);
  const perSourceTrend  = useMemo(() => snapshots.length >= 2 ? trendByDimension(snapshots.slice(-14), 'utmSource', { topN: 10 }) : null, [snapshots]);
  const perMediumTrend  = useMemo(() => snapshots.length >= 2 ? trendByDimension(snapshots.slice(-14), 'utmMedium', { topN: 10 }) : null, [snapshots]);

  /* Advanced patterns */
  const anomalies  = useMemo(() => analysis?.latest ? cvrAnomalies(analysis.latest) : null, [analysis]);
  const leakage    = useMemo(() => analysis?.latest ? funnelLeakage(analysis.latest, 'utmCampaign') : [], [analysis]);
  // Meta rows scoped to the selected brand (enrichedRows tags each row with _brandId / brandId)
  const brandEnriched = useMemo(() => (enrichedRows || []).filter(r => !selectedBrandId || r._brandId === selectedBrandId || r.brandId === selectedBrandId), [enrichedRows, selectedBrandId]);
  const metaJoin   = useMemo(() => analysis?.latest ? joinMetaByCampaign(analysis.latest, brandEnriched) : null, [analysis, brandEnriched]);

  if (!bBrands.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <CalendarDays size={40} className="opacity-30" />
        <p className="text-sm">No active brands.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-500/20"><CalendarDays size={18} className="text-cyan-400" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">Daily Reports</h1>
          <p className="text-[11px] text-slate-500">
            UTM / channel performance pulled from Drive or dropped manually · {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} in history
          </p>
        </div>
        {bBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 ml-4">
            {bBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept=".csv,text/csv" className="hidden"
            onChange={e => { handleFiles([...(e.target.files || [])]); e.target.value = ''; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={pulling}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-slate-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
            <Upload size={12} /> Drop CSVs
          </button>
          <button onClick={handlePullDrive} disabled={pulling || !brand?.drive?.folderUrl}
            className="px-3 py-1.5 rounded-lg bg-cyan-700/30 hover:bg-cyan-700/50 border border-cyan-800/40 text-cyan-300 text-xs flex items-center gap-1.5 disabled:opacity-40"
            title={!brand?.drive?.folderUrl ? 'Paste a Drive folder link in Study Manual' : 'Pull newest reports from Drive folder'}>
            {pulling ? <RefreshCw size={12} className="animate-spin" /> : <FolderDown size={12} />}
            {pulling ? 'Pulling…' : 'Pull from Drive'}
          </button>
        </div>
      </div>

      {/* Error + log */}
      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-800/40 bg-red-900/20 text-red-200 text-xs">
          <div className="font-semibold mb-1">Error</div>
          <div className="text-red-200/80">{error}</div>
        </div>
      )}
      {log.length > 0 && (
        <div className="px-4 py-2.5 rounded-xl border border-gray-800 bg-gray-950 text-[11px] text-slate-400 font-mono max-h-40 overflow-auto">
          {log.map(l => <div key={l.t}>{l.msg}</div>)}
        </div>
      )}

      {/* Empty state */}
      {!snapshots.length && !pulling && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <CalendarDays size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-2">No reports imported yet.</p>
          <p className="text-[11px] text-slate-600 max-w-md mx-auto">
            Either drop CSVs here directly, or paste your Drive folder share link in <span className="text-slate-400">Study Manual → brand → Google Drive</span> and click Pull from Drive. Folder must be shared as "Anyone with the link — Viewer".
          </p>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Parser diagnostics — only when the latest snapshot has warnings */}
          {analysis.latest?.warnings?.length > 0 && (
            <div className="px-4 py-4 rounded-xl border border-amber-800/40 bg-amber-900/20 text-xs text-amber-200 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={14} /> Parser couldn't fully recognize your CSV columns
              </div>
              <ul className="list-disc ml-5 space-y-0.5 text-amber-200/80">
                {analysis.latest.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="text-[10px] text-amber-400 uppercase tracking-wider mb-1">Raw headers in the CSV</div>
                  <div className="flex flex-wrap gap-1">
                    {(analysis.latest.headers || []).map((h, i) => (
                      <code key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900/80 text-slate-300 font-mono">{h}</code>
                    ))}
                    {!analysis.latest.headers?.length && <span className="italic text-amber-200/60">(none)</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-400 uppercase tracking-wider mb-1">Detected column mapping</div>
                  <div className="space-y-0.5 text-[11px]">
                    {Object.entries(analysis.latest.columns || {}).length === 0 && <span className="italic text-amber-200/60">(no patterns matched — parser needs tuning)</span>}
                    {Object.entries(analysis.latest.columns || {}).map(([k, v]) => (
                      <div key={k} className="font-mono"><span className="text-amber-300">{k}</span> <span className="text-slate-500">←</span> <span className="text-slate-300">{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
              {analysis.latest.sampleRow && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-amber-300 hover:text-amber-100">Show first data row (for tuning)</summary>
                  <pre className="mt-2 p-2 rounded bg-gray-900 text-slate-300 overflow-auto max-h-48 text-[10px]">
                    {JSON.stringify(analysis.latest.sampleRow, null, 2)}
                  </pre>
                </details>
              )}
              <div className="text-[11px] text-amber-200/70">
                Paste the headers above into chat and I'll tune the column patterns so your exact CSV format parses correctly.
              </div>
            </div>
          )}

          {/* Totals KPIs — adapt to which metrics the CSV actually has */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {analysis.totals.revenue > 0 ? (
              <KPI label={`Revenue · ${analysis.latest.reportDate}`} value={cur(analysis.totals.revenue)}
                sub={analysis.prior ? `was ${cur(analysis.priorTotals.revenue)}` : '(first snapshot)'}
                delta={analysis.totalsDelta?.revenuePct} color="#22c55e" />
            ) : (
              <KPI label={`Checkouts · ${analysis.latest.reportDate}`} value={num(analysis.totals.checkoutInitiated)}
                sub={analysis.prior ? `was ${num(analysis.priorTotals.checkoutInitiated)}` : '(first snapshot)'}
                delta={analysis.totalsDelta?.checkoutInitiatedPct} color="#22c55e" />
            )}
            <KPI label="Orders" value={num(analysis.totals.orders)}
              sub={analysis.prior ? `was ${num(analysis.priorTotals.orders)}` : ''}
              delta={analysis.totalsDelta?.ordersPct} color="#f59e0b" />
            {analysis.totals.sessions > 0 ? (
              <KPI label="Sessions" value={num(analysis.totals.sessions)}
                sub={analysis.prior ? `was ${num(analysis.priorTotals.sessions)}` : ''}
                delta={analysis.totalsDelta?.sessionsPct} color="#06b6d4" />
            ) : (
              <KPI label="CVR (orders / checkouts)"
                value={analysis.totals.checkoutInitiated > 0 ? `${((analysis.totals.orders / analysis.totals.checkoutInitiated) * 100).toFixed(1)}%` : '—'}
                sub={analysis.prior && analysis.priorTotals.checkoutInitiated > 0
                  ? `was ${((analysis.priorTotals.orders / analysis.priorTotals.checkoutInitiated) * 100).toFixed(1)}%`
                  : ''} color="#06b6d4" />
            )}
            <KPI label="Channels active"
              value={num(analysis.classified.distressed.length + analysis.classified.opportunity.length + analysis.classified.stable.length + analysis.classified.emerging.length)}
              sub={`${analysis.classified.distressed.length} distressed · ${analysis.classified.opportunity.length} surging`} color="#a78bfa" />
          </div>

          {/* Trend line — adapts to what metrics the data has */}
          {trendData.length >= 2 && (
            <Card title={`14-day trend · ${[trendHasRevenue && 'revenue', trendHasSessions && 'sessions', trendHasCheckouts && 'checkouts', 'orders'].filter(Boolean).join(' · ')}`}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trendHasRevenue  && <Line yAxisId="left"  dataKey="revenue"           stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />}
                  {trendHasSessions && <Line yAxisId="right" dataKey="sessions"          stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />}
                  {trendHasCheckouts && <Line yAxisId="right" dataKey="checkoutInitiated" name="checkouts" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />}
                  <Line yAxisId={trendHasRevenue ? 'right' : 'left'} dataKey="orders" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Deep-dive: breakdowns + visuals */}
          <BreakdownVisuals
            breakBySource={breakBySource}
            breakByMedium={breakByMedium}
            breakByCampaign={breakByCampaign}
            matrix={matrix}
            perSourceTrend={perSourceTrend}
            perMediumTrend={perMediumTrend}
            anomalies={anomalies}
            leakage={leakage}
            metaJoin={metaJoin}
          />

          {/* Classified panels */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title={`Distressed channels (${analysis.classified.distressed.length})`} icon={TrendingDown} tone="bad">
              {analysis.classified.distressed.length === 0
                ? <div className="text-xs text-slate-500 italic">No channels dropping &gt;25% with real volume today.</div>
                : <div className="space-y-2">{analysis.classified.distressed.slice(0, 15).map((r, i) => <ChannelRow key={i} row={r} mode="distressed" />)}</div>}
            </Card>
            <Card title={`Opportunity channels (${analysis.classified.opportunity.length})`} icon={TrendingUp} tone="good">
              {analysis.classified.opportunity.length === 0
                ? <div className="text-xs text-slate-500 italic">No channels up &gt;25% vs yesterday.</div>
                : <div className="space-y-2">{analysis.classified.opportunity.slice(0, 15).map((r, i) => <ChannelRow key={i} row={r} mode="opportunity" />)}</div>}
            </Card>
            <Card title={`Emerging channels (${analysis.classified.emerging.length})`} icon={Sparkles} tone="warn">
              {analysis.classified.emerging.length === 0
                ? <div className="text-xs text-slate-500 italic">No new channels today.</div>
                : <div className="space-y-2">{analysis.classified.emerging.slice(0, 10).map((r, i) => <ChannelRow key={i} row={r} mode="emerging" />)}</div>}
            </Card>
            <Card title={`Fading channels (${analysis.classified.fading.length})`} icon={PackageOpen}>
              {analysis.classified.fading.length === 0
                ? <div className="text-xs text-slate-500 italic">No significant channels disappeared today.</div>
                : <div className="space-y-2">{analysis.classified.fading.slice(0, 10).map((r, i) => <ChannelRow key={i} row={r} mode="fading" />)}</div>}
            </Card>
          </div>

          {/* Trend leaderboard (multi-day) */}
          {analysis.trends.length > 0 && snapshots.length >= 3 && (
            <Card title={`Multi-day channel trends · Mann-Kendall (${snapshots.length} days)`} icon={Flame}>
              <div className="overflow-auto" style={{ maxHeight: '440px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Channel</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Total rev ({snapshots.length}d)</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Avg/day</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Slope</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Direction</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">p-value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.trends.slice(0, 40).map((t, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2 text-slate-200 truncate max-w-[260px]">{t.channel}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(t.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(t.avg)}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.slope.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {t.direction === 'up' && <span className="text-emerald-400">↑ up{t.significant ? ' (sig)' : ''}</span>}
                          {t.direction === 'down' && <span className="text-red-400">↓ down{t.significant ? ' (sig)' : ''}</span>}
                          {t.direction === 'flat' && <span className="text-slate-500">flat</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-500">{t.pValue.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Full comparison table — shows only columns with real data */}
          {(() => {
            const hasRev  = analysis.compared.some(r => r.revenue > 0 || r.revenuePrior > 0);
            const hasSess = analysis.compared.some(r => r.sessions > 0 || r.sessionsPrior > 0);
            const hasCI   = analysis.compared.some(r => r.checkoutInitiated > 0 || r.checkoutInitiatedPrior > 0);
            const primaryDeltaKey = hasRev ? 'revenueDeltaPct' : hasCI ? 'checkoutInitiatedDeltaPct' : 'ordersDeltaPct';
            const primaryLabel    = hasRev ? 'Δ Rev' : hasCI ? 'Δ Checkouts' : 'Δ Orders';
            return (
              <Card title={`Full channel comparison · ${analysis.latest.reportDate} vs ${analysis.prior?.reportDate || 'nothing'}`}>
                <div className="overflow-auto" style={{ maxHeight: '500px' }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                      <tr>
                        <th className="px-3 py-2 text-left text-slate-400 font-semibold">Channel</th>
                        {hasSess && <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>}
                        {hasCI   && <th className="px-3 py-2 text-right text-slate-400 font-semibold">Checkouts</th>}
                        <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                        {hasRev  && <th className="px-3 py-2 text-right text-slate-400 font-semibold">Revenue</th>}
                        <th className="px-3 py-2 text-right text-slate-400 font-semibold">CVR</th>
                        {hasRev  && <th className="px-3 py-2 text-right text-slate-400 font-semibold">AOV</th>}
                        <th className="px-3 py-2 text-right text-slate-400 font-semibold">{primaryLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.compared.slice(0, 200).map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                          <td className="px-3 py-2 text-slate-200 truncate max-w-[260px]">{r.channel}</td>
                          {hasSess && <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>}
                          {hasCI   && <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.checkoutInitiated)}</td>}
                          <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.orders)}</td>
                          {hasRev  && <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(r.revenue)}</td>}
                          <td className="px-3 py-2 text-right font-mono text-slate-500">{(r.cvr * 100).toFixed(2)}%</td>
                          {hasRev  && <td className="px-3 py-2 text-right font-mono text-slate-500">{cur(r.aov)}</td>}
                          <td className={`px-3 py-2 text-right font-mono ${deltaColor(r[primaryDeltaKey])}`}>{pct(r[primaryDeltaKey], 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}

          {/* Snapshot history */}
          <Card title={`Snapshots in history (${snapshots.length})`}>
            <div className="flex flex-wrap gap-2">
              {snapshots.slice().reverse().map(s => (
                <div key={s.reportDate} className="px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-[11px] text-slate-300 flex items-center gap-2">
                  <CheckCircle2 size={11} className={s.rows?.length ? 'text-emerald-400' : 'text-amber-400'} />
                  {s.reportDate}
                  <span className={s.rows?.length ? 'text-slate-600' : 'text-amber-400'}>· {s.rows?.length || 0} rows</span>
                  <button onClick={() => removeBrandUtmSnapshot(brand.id, s.reportDate)}
                    className="text-slate-600 hover:text-red-400 ml-1"><X size={11} /></button>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
