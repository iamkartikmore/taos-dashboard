import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingUp, TrendingDown, Minus, RefreshCw,
  Video, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, Calendar, BarChart3,
} from 'lucide-react';
import { useStore } from '../../store';
import { normalizeInsight, fmt, safeNum } from '../../lib/analytics';
import { buildDimSummary } from '../../lib/breakdownAnalytics';
import Badge from './Badge';

const META_BASE = 'https://graph.facebook.com';

const INSIGHT_FIELDS = [
  'account_id','account_name','campaign_id','campaign_name',
  'adset_id','adset_name','ad_id','ad_name',
  'date_start','date_stop',
  'spend','impressions','reach','frequency',
  'clicks','unique_clicks','ctr','unique_ctr','cpc','cpm','cpp',
  'outbound_clicks','inline_link_clicks',
  'actions','action_values','cost_per_action_type','purchase_roas',
  'video_play_actions','video_p25_watched_actions','video_p50_watched_actions',
  'video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions',
  'video_avg_time_watched_actions','video_thruplay_watched_actions',
  'quality_ranking','engagement_rate_ranking','conversion_rate_ranking',
].join(',');

async function fetchAdWindow(adId, token, ver, actId, preset, since, until) {
  const params = {
    access_token: token,
    level: 'ad',
    filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [adId] }]),
    fields: INSIGHT_FIELDS,
    limit: 1,
    action_report_time: 'mixed',
    action_attribution_windows: "['7d_click','1d_view']",
  };
  if (since && until) {
    params.time_range = JSON.stringify({ since, until });
  } else {
    params.date_preset = preset;
  }
  const res = await fetch('/api/meta/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${META_BASE}/${ver}/${actId}/insights`, params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Meta API error');
  return (json.data || [])[0] || null;
}

/* ─── COLOUR HELPERS ─────────────────────────────────────────────── */
function roasColor(v) {
  v = safeNum(v);
  if (v >= 6) return '#34d399';
  if (v >= 4) return '#a3e635';
  if (v >= 2.5) return '#f59e0b';
  if (v >= 1) return '#fb923c';
  return '#ef4444';
}
function deltaColor(v, higher = true) {
  v = safeNum(v);
  if (v === 0) return 'text-slate-500';
  return (higher ? v > 0 : v < 0) ? 'text-emerald-400' : 'text-red-400';
}

/* ─── QUALITY RANKING BADGE ──────────────────────────────────────── */
const RANK_COLORS = {
  'ABOVE_AVERAGE':    { bg: '#052e16', text: '#4ade80' },
  'AVERAGE':          { bg: '#1e293b', text: '#94a3b8' },
  'BELOW_AVERAGE_10': { bg: '#422006', text: '#fbbf24' },
  'BELOW_AVERAGE_20': { bg: '#450a0a', text: '#f87171' },
  'BELOW_AVERAGE_35': { bg: '#450a0a', text: '#f87171' },
};
function RankBadge({ value, label }) {
  if (!value) return <span className="text-slate-600 text-xs">—</span>;
  const c = RANK_COLORS[value] || RANK_COLORS['AVERAGE'];
  const short = value
    .replace('ABOVE_AVERAGE', 'Above avg')
    .replace('AVERAGE', 'Average')
    .replace('BELOW_AVERAGE_10', 'Below <10%')
    .replace('BELOW_AVERAGE_20', 'Below <20%')
    .replace('BELOW_AVERAGE_35', 'Below <35%');
  return (
    <div className="text-center">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: c.bg, color: c.text }}>{short}</span>
    </div>
  );
}

/* ─── WINDOW KPI CARD ─────────────────────────────────────────────── */
const WINDOWS = ['Today', '7D', '14D', '30D'];
const PRESETS = { Today: 'today', '7D': 'last_7d', '14D': 'last_14d', '30D': 'last_30d' };

function WindowCard({ label, data, refData, isLoading }) {
  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-center min-w-[145px] flex-1">
        <RefreshCw size={14} className="text-slate-500 animate-spin" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl p-4 flex items-center justify-center min-w-[145px] flex-1">
        <span className="text-xs text-slate-600">No data</span>
      </div>
    );
  }

  const roasVsRef = refData && safeNum(refData.metaRoas) > 0
    ? (safeNum(data.metaRoas) - safeNum(refData.metaRoas)) / safeNum(refData.metaRoas) * 100
    : null;
  const cprVsRef = refData && safeNum(refData.metaCpr) > 0
    ? (safeNum(data.metaCpr) - safeNum(refData.metaCpr)) / safeNum(refData.metaCpr) * 100
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 min-w-[145px] flex-1">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">{label}</div>
      <div className="space-y-1.5">
        <div>
          <div className="text-[9px] text-slate-600">Spend</div>
          <div className="text-sm font-semibold text-white">{fmt.currency(data.spend)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600">ROAS</div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold" style={{ color: roasColor(data.metaRoas) }}>{fmt.roas(data.metaRoas)}</span>
            {roasVsRef !== null && (
              <span className={`text-[10px] font-medium ${deltaColor(roasVsRef)}`}>
                {roasVsRef >= 0 ? '+' : ''}{roasVsRef.toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600">CPR</div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-white">{fmt.currency(data.metaCpr)}</span>
            {cprVsRef !== null && (
              <span className={`text-[10px] font-medium ${deltaColor(cprVsRef, false)}`}>
                {cprVsRef >= 0 ? '+' : ''}{cprVsRef.toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-600">Purchases / Revenue</div>
          <div className="text-xs font-semibold text-white">
            {fmt.number(data.purchases)} / {fmt.currency(data.revenue)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── METRIC COMPARISON TABLE ─────────────────────────────────────── */
function MetricRow({ label, field, fmtFn, windows, higherBetter = true }) {
  const ref7 = windows['7D'];
  return (
    <tr className="border-b border-gray-800/40">
      <td className="py-2 pr-4 text-xs text-slate-400 font-medium whitespace-nowrap pl-4">{label}</td>
      {WINDOWS.map(w => {
        const d = windows[w];
        const v = d ? safeNum(d[field]) : null;
        const refV = ref7 ? safeNum(ref7[field]) : null;
        const delta = (v !== null && refV !== null && refV !== 0 && w !== '7D')
          ? (v - refV) / refV * 100 : null;
        return (
          <td key={w} className="py-2 px-2 text-right text-xs tabular-nums">
            {v !== null ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-slate-200">{fmtFn(v)}</span>
                {delta !== null && (
                  <span className={`text-[9px] ${deltaColor(delta, higherBetter)}`}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
                  </span>
                )}
              </div>
            ) : <span className="text-slate-700">—</span>}
          </td>
        );
      })}
    </tr>
  );
}

/* ─── SPEND × ROAS × CPR BREAKDOWN ROW ────────────────────────────── */
function MiniDimChart({ title, data }) {
  const rows = (data || []).filter(d => d.spend > 0);
  if (!rows.length) return null;
  const maxSpend = Math.max(...rows.map(d => d.spend));
  return (
    <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map(d => {
          const pct = maxSpend > 0 ? (d.spend / maxSpend) * 100 : 0;
          return (
            <div key={d.label}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-slate-300 font-medium truncate max-w-[100px]" title={d.label}>{d.label}</span>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="font-bold tabular-nums" style={{ color: roasColor(d.roas) }}>{fmt.roas(d.roas)}</span>
                  <span className="text-slate-400 tabular-nums">CPR {fmt.currency(d.cpr)}</span>
                  <span className="text-slate-500 tabular-nums">{fmt.currency(d.spend)}</span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: roasColor(d.roas) }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-slate-700 mt-2">Bar = spend share · colour = ROAS</div>
    </div>
  );
}

function VideoBar({ label, pct: value, color }) {
  const v = Math.min(Math.max(safeNum(value), 0), 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-medium">{v.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

/* ─── MAIN DRAWER ────────────────────────────────────────────────── */
export default function AdDetailDrawer({ row, onClose }) {
  const { rawAccounts, config, enrichedRows, breakdownRows } = useStore();
  const [windows, setWindows] = useState({});
  const [loadingWindows, setLoadingWindows] = useState({});
  const [fetchErrors, setFetchErrors] = useState({});
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [showVideo, setShowVideo] = useState(false);
  const [showBreakdowns, setShowBreakdowns] = useState(true);
  const [showCustom, setShowCustom] = useState(false);

  // Pre-populate from store — all 4 windows come from rawAccounts after main fetch
  useEffect(() => {
    if (!row) return;
    const w = {};

    rawAccounts.forEach(acct => {
      const find = arr => (arr || []).find(r => r.adId === row.adId);
      if (!w['Today'] && find(acct.insightsToday)) w['Today'] = find(acct.insightsToday);
      if (!w['7D']    && find(acct.insights7d))    w['7D']    = find(acct.insights7d);
      if (!w['14D']   && find(acct.insights14d))   w['14D']   = find(acct.insights14d);
      if (!w['30D']   && find(acct.insights30d))   w['30D']   = find(acct.insights30d);
    });

    // Fallback: 7D can come from enrichedRows
    if (!w['7D']) {
      const r = enrichedRows.find(r => r.adId === row.adId);
      if (r) w['7D'] = r;
    }

    setWindows(w);
  }, [row, enrichedRows, rawAccounts]);

  // ESC to close
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Manual fetch for custom range or if a window is missing
  const doFetch = useCallback(async (windowKey, preset = null, since = null, until = null) => {
    if (!config.token || !row) return;
    setLoadingWindows(s => ({ ...s, [windowKey]: true }));
    setFetchErrors(s => ({ ...s, [windowKey]: null }));

    const account = config.accounts.find(a => a.key === row.accountKey);
    if (!account) {
      setFetchErrors(s => ({ ...s, [windowKey]: 'Account not found in config' }));
      setLoadingWindows(s => ({ ...s, [windowKey]: false }));
      return;
    }

    const aId = String(account.id).startsWith('act_') ? account.id : `act_${account.id}`;

    try {
      const raw = await fetchAdWindow(
        row.adId, config.token, config.apiVersion || 'v21.0',
        aId, preset, since, until,
      );
      const normalized = raw ? normalizeInsight(raw, row.accountKey, windowKey) : null;
      setWindows(s => ({ ...s, [windowKey]: normalized }));
    } catch (e) {
      setFetchErrors(s => ({ ...s, [windowKey]: e.message }));
    }
    setLoadingWindows(s => ({ ...s, [windowKey]: false }));
  }, [config, row]);

  // Breakdown data filtered to this ad
  const adBreakdowns = useMemo(() => {
    if (!row || !breakdownRows) return {};
    const out = {};
    Object.entries(breakdownRows).forEach(([key, rows]) => {
      out[key] = (rows || []).filter(r => r.adId === row.adId);
    });
    return out;
  }, [row, breakdownRows]);

  const ageSummary    = useMemo(() => buildDimSummary(adBreakdowns.age      || [], 'bdAge'),      [adBreakdowns.age]);
  const genderSummary = useMemo(() => buildDimSummary(adBreakdowns.gender   || [], 'bdGender'),   [adBreakdowns.gender]);
  const platSummary   = useMemo(() => buildDimSummary(adBreakdowns.platform || [], 'bdPlatform'), [adBreakdowns.platform]);
  const devSummary    = useMemo(() => buildDimSummary(adBreakdowns.device   || [], 'bdDevice'),   [adBreakdowns.device]);

  const hasAdBreakdowns = ageSummary.length > 0 || genderSummary.length > 0 || platSummary.length > 0;

  if (!row) return null;

  const d7  = windows['7D'];
  const d30 = windows['30D'];
  const refData = d30; // compare against 30D baseline
  const hasVideo = d7 && safeNum(d7.videoPlays) > 0;

  const metricRows = [
    { label: 'Spend',        field: 'spend',        fmtFn: fmt.currency, higher: false },
    { label: 'ROAS',         field: 'metaRoas',      fmtFn: fmt.roas,     higher: true  },
    { label: 'CPR',          field: 'metaCpr',       fmtFn: fmt.currency, higher: false },
    { label: 'Purchases',    field: 'purchases',     fmtFn: fmt.number,   higher: true  },
    { label: 'Revenue',      field: 'revenue',       fmtFn: fmt.currency, higher: true  },
    { label: 'AOV',          field: 'aov',           fmtFn: fmt.currency, higher: true  },
    { label: 'Impressions',  field: 'impressions',   fmtFn: fmt.number,   higher: true  },
    { label: 'CPM',          field: 'cpm',           fmtFn: fmt.currency, higher: false },
    { label: 'CTR (All)',    field: 'ctrAll',        fmtFn: fmt.pct,      higher: true  },
    { label: 'Outbound CTR', field: 'outboundCtr',   fmtFn: fmt.pct,      higher: true  },
    { label: 'Frequency',    field: 'frequency',     fmtFn: v => safeNum(v).toFixed(2), higher: false },
    { label: 'LPV Rate',     field: 'lpvRate',       fmtFn: fmt.pct,      higher: true  },
    { label: 'ATC Rate',     field: 'atcRate',       fmtFn: fmt.pct,      higher: true  },
    { label: 'IC Rate',      field: 'icRate',        fmtFn: fmt.pct,      higher: true  },
    { label: 'Conv Rate',    field: 'convRate',      fmtFn: fmt.pct,      higher: true  },
    { label: 'Cost/LPV',     field: 'costPerLpv',    fmtFn: fmt.currency, higher: false },
    { label: 'Cost/ATC',     field: 'costPerAtc',    fmtFn: fmt.currency, higher: false },
    { label: 'Cost/IC',      field: 'costPerIc',     fmtFn: fmt.currency, higher: false },
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="relative w-full max-w-4xl bg-gray-950 border-l border-gray-800 h-screen flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-800 flex items-start gap-4 shrink-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge label={row.decision} />
                <Badge label={row.currentQuality} size="xs" />
                <span className="text-[10px] text-slate-500">{row.accountKey}</span>
              </div>
              <h2 className="text-base font-bold text-white leading-snug break-words">{row.adName}</h2>
              <div className="text-[11px] text-slate-500 mt-1">
                {row.campaignName} <span className="text-slate-700">›</span> {row.adSetName}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1 mt-0.5 shrink-0">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── WINDOW CARDS ─────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Performance Windows</h3>
                <button
                  onClick={() => setShowCustom(s => !s)}
                  className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
                >
                  <Calendar size={11} /> Custom
                  {showCustom ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
              </div>

              {showCustom && (
                <div className="mb-3 flex items-center gap-2 bg-gray-900 rounded-lg p-3 border border-gray-800 flex-wrap">
                  <input type="date" value={customSince} onChange={e => setCustomSince(e.target.value)}
                    className="text-xs bg-gray-800 text-slate-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-brand-500" />
                  <span className="text-[10px] text-slate-400">→</span>
                  <input type="date" value={customUntil} onChange={e => setCustomUntil(e.target.value)}
                    className="text-xs bg-gray-800 text-slate-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-brand-500" />
                  <button
                    onClick={() => { if (customSince && customUntil) doFetch('Custom', null, customSince, customUntil); }}
                    disabled={!customSince || !customUntil}
                    className="text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white px-3 py-1 rounded-lg font-medium"
                  >
                    Fetch
                  </button>
                </div>
              )}

              <div className="flex gap-3 overflow-x-auto pb-1">
                {WINDOWS.map(w => (
                  <WindowCard
                    key={w}
                    label={w}
                    data={windows[w]}
                    refData={w !== '30D' ? refData : null}
                    isLoading={loadingWindows[w]}
                  />
                ))}
                {windows['Custom'] && (
                  <WindowCard
                    label={`${customSince}–${customUntil}`}
                    data={windows['Custom']}
                    refData={refData}
                    isLoading={false}
                  />
                )}
              </div>

              {/* Missing window fetch buttons */}
              {WINDOWS.some(w => !windows[w] && !loadingWindows[w]) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {WINDOWS.filter(w => !windows[w] && !loadingWindows[w]).map(w => (
                    <button
                      key={w}
                      onClick={() => doFetch(w, PRESETS[w])}
                      className="text-[10px] bg-gray-800 hover:bg-gray-700 text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw size={9} /> Fetch {w}
                    </button>
                  ))}
                </div>
              )}

              {Object.entries(fetchErrors).map(([w, err]) => err && (
                <div key={w} className="mt-2 text-[10px] text-red-400 bg-red-950/30 px-3 py-1.5 rounded-lg">
                  {w}: {err}
                </div>
              ))}
            </section>

            {/* ── TREND SIGNAL ──────────────────────────────────────── */}
            {d7 && (
              <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Trend (7D vs 30D)</div>
                    <Badge label={d7.trendSignal || 'Unknown'} />
                  </div>
                  {d7.trendSignal?.includes('Fatigue') && (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs bg-amber-950/30 px-3 py-1.5 rounded-lg">
                      <AlertTriangle size={12} /> Frequency {fmt.decimal(d7.frequency)} — refresh creative
                    </div>
                  )}
                  {d7.trendSignal?.includes('Improving') && (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs bg-emerald-950/30 px-3 py-1.5 rounded-lg">
                      <CheckCircle size={12} /> Momentum building — good time to scale
                    </div>
                  )}
                  <div className="ml-auto flex gap-4 text-center">
                    {[
                      ['ROAS Δ', d7.roasDelta, true],
                      ['CPR Δ',  d7.cprDelta,  false],
                      ['Freq',   null,          false],
                    ].map(([l, v, hi]) => (
                      <div key={l}>
                        <div className="text-[9px] text-slate-500">{l}</div>
                        <div className={`text-sm font-bold ${l === 'Freq'
                          ? (safeNum(d7.frequency) >= 3 ? 'text-amber-400' : 'text-slate-200')
                          : deltaColor(v, hi)}`}>
                          {l === 'Freq'
                            ? safeNum(d7.frequency).toFixed(2)
                            : `${safeNum(v) >= 0 ? '+' : ''}${safeNum(v).toFixed(1)}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── METRIC TABLE ───────────────────────────────────────── */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Full Metric Comparison</h3>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-2.5 pr-4 text-left text-slate-500 font-medium pl-4">Metric</th>
                      {WINDOWS.map(w => (
                        <th key={w} className="py-2.5 px-2 text-right text-slate-500 font-medium">{w}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map(({ label, field, fmtFn, higher }) => (
                      <MetricRow key={field + label} label={label} field={field}
                        fmtFn={fmtFn} windows={windows} higherBetter={higher} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── QUALITY RANKINGS ──────────────────────────────────── */}
            {d7 && (d7.qualityRanking || d7.engagementRanking || d7.conversionRanking) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Meta Quality Rankings (7D)</h3>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex gap-6 justify-around">
                  <RankBadge value={d7.qualityRanking}      label="Quality" />
                  <RankBadge value={d7.engagementRanking}   label="Engagement" />
                  <RankBadge value={d7.conversionRanking}   label="Conversion" />
                </div>
              </section>
            )}

            {/* ── VIDEO FUNNEL ───────────────────────────────────────── */}
            {hasVideo && (
              <section>
                <button
                  onClick={() => setShowVideo(s => !s)}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 w-full hover:text-slate-300 transition-colors"
                >
                  <Video size={13} /> Video Funnel (7D)
                  {showVideo ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showVideo && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                      <div>
                        <div className="text-[9px] text-slate-500">Total Plays</div>
                        <div className="text-sm font-bold text-white">{fmt.number(d7.videoPlays)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-500">Avg Watch</div>
                        <div className="text-sm font-bold text-white">{safeNum(d7.videoAvgWatch).toFixed(1)}s</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-500">Thruplays</div>
                        <div className="text-sm font-bold text-white">{fmt.number(d7.thruplays)}</div>
                      </div>
                    </div>
                    <VideoBar label="25% watched"  pct={d7.videoP25Rate}  color="#60a5fa" />
                    <VideoBar label="50% watched"  pct={d7.videoP50Rate}  color="#818cf8" />
                    <VideoBar label="75% watched"  pct={d7.videoP75Rate}  color="#a78bfa" />
                    <VideoBar label="95% watched"  pct={d7.videoP95Rate}  color="#c084fc" />
                    <VideoBar label="100% watched" pct={d7.videoP100Rate} color="#e879f9" />
                    <VideoBar label="Hold rate"    pct={d7.holdRate}      color="#34d399" />
                  </div>
                )}
              </section>
            )}

            {/* ── PER-AD BREAKDOWN CHARTS ───────────────────────────── */}
            {hasAdBreakdowns && (
              <section>
                <button
                  onClick={() => setShowBreakdowns(s => !s)}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 w-full hover:text-slate-300 transition-colors"
                >
                  <BarChart3 size={13} /> Breakdown Performance (this ad)
                  {showBreakdowns ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showBreakdowns && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <MiniDimChart title="ROAS by Age"      data={ageSummary} />
                    <MiniDimChart title="ROAS by Gender"   data={genderSummary} />
                    <MiniDimChart title="ROAS by Platform" data={platSummary} />
                    <MiniDimChart title="ROAS by Device"   data={devSummary} />
                  </div>
                )}
              </section>
            )}

            {/* ── MANUAL LABELS ──────────────────────────────────────── */}
            {(row.collection || row.campaignType || row.offerType || row.geography || row.customerState) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Labels & Targeting</h3>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap gap-x-6 gap-y-3">
                  {[
                    ['Collection',     row.collection],
                    ['Campaign Type',  row.campaignType],
                    ['Offer Type',     row.offerType],
                    ['Geography',      row.geography],
                    ['Customer State', row.customerState],
                    ['Audience',       row.audienceFamily],
                    ['Creative',       row.creativeDominance],
                    ['SKU',            row.sku],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">{k}</div>
                      <div className="text-xs text-slate-200 font-medium">{v}</div>
                    </div>
                  ))}
                </div>
                {row.notes && (
                  <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Notes</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{row.notes}</p>
                  </div>
                )}
              </section>
            )}

            <div className="text-[10px] text-slate-700 font-mono pb-2">Ad ID: {row.adId}</div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
