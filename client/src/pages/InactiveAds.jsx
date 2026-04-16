import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import {
  PauseCircle, RefreshCw, Zap, AlertTriangle,
  ChevronDown, ChevronRight, Download, TrendingDown,
} from 'lucide-react';
import clsx from 'clsx';
import { safeNum, fmt, normalizeInsight } from '../lib/analytics';
import { fetchInsightsCustom } from '../lib/api';

/* ─── STATUS META ────────────────────────────────────────────────── */

const STATUS_META = {
  PAUSED:   { label: 'Paused',   color: 'text-amber-400', bg: 'bg-amber-500/10 ring-1 ring-amber-500/30' },
  DELETED:  { label: 'Deleted',  color: 'text-red-400',   bg: 'bg-red-500/10 ring-1 ring-red-500/30'     },
  ARCHIVED: { label: 'Archived', color: 'text-slate-400', bg: 'bg-gray-700/40'                            },
  UNKNOWN:  { label: 'Inactive', color: 'text-slate-400', bg: 'bg-gray-700/40'                            },
};

const sm = status => STATUS_META[(status || '').toUpperCase()] || STATUS_META.UNKNOWN;

/* ─── REACTIVATION SCORING ───────────────────────────────────────── */

function computeReactivation(r) {
  const roas  = safeNum(r.metaRoas);
  const spend = safeNum(r.spend);
  const freq  = safeNum(r.frequency);

  let score = 0;
  if (roas >= 5)       score += 50;
  else if (roas >= 4)  score += 40;
  else if (roas >= 3)  score += 25;
  else if (roas >= 2)  score += 10;

  if (spend >= 10000)  score += 30;
  else if (spend >= 5000) score += 20;
  else if (spend >= 2000) score += 15;
  else if (spend >= 1000) score += 10;
  else if (spend >= 500)  score += 5;

  const priority = score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low';

  let pauseGuess = 'Unknown reason';
  if (freq >= 4)                        pauseGuess = 'Audience fatigue (high frequency)';
  else if (roas < 2)                    pauseGuess = 'Low ROAS underperformance';
  else if (roas >= 3 && spend > 2000)   pauseGuess = 'Strategic pause / budget reallocation';

  const actions = [];
  if (roas >= 4) {
    actions.push('High-potential relaunch: identical creative + offer, 50% of prior budget');
    actions.push(freq >= 3 ? 'Audience reset — fresh lookalike from 60-day purchasers' : 'Widen targeting slightly (age range or 1 new interest)');
    actions.push('Scale 20%/day if ROAS holds for 3 consecutive days');
  } else if (roas >= 3) {
    actions.push('Creative refresh — same product, new hook or different format');
    actions.push('A/B test a different offer type (bundle → discount, or add freebie)');
    if (freq >= 3) actions.push('Audience reset required — current segment is saturated');
  } else if (roas >= 2) {
    actions.push('Major creative overhaul needed — new UGC or testimonial format');
    actions.push('Test a significantly different offer (pricing, bundle structure)');
    actions.push('Narrow to highest-LTV segment before scaling');
  } else {
    actions.push('Low reactivation potential — only test if product or offer has fundamentally changed');
    actions.push('Consider retiring this concept and testing a fresh angle for the same product');
  }

  return { score: Math.min(100, score), priority, pauseGuess, actions };
}

/* ─── SCORE BAR ─────────────────────────────────────────────────── */

function ScoreBar({ score, priority }) {
  const color = priority === 'High' ? '#22c55e' : priority === 'Medium' ? '#f59e0b' : '#64748b';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[10px] font-bold w-8 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

/* ─── PRIORITY BADGE ─────────────────────────────────────────────── */

function PriorityBadge({ priority }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold text-center',
      priority === 'High'   ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30'  :
      priority === 'Medium' ? 'bg-amber-500/10   text-amber-400   ring-1 ring-amber-500/30'    :
                              'bg-gray-700/40    text-slate-500')}>
      {priority}
    </span>
  );
}

/* ─── REACTIVATION CARD ──────────────────────────────────────────── */

function ReactivationCard({ r }) {
  const [open, setOpen] = useState(false);
  const react = useMemo(() => computeReactivation(r), [r]);
  const meta  = sm(r.effectiveStatus);

  return (
    <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-800/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex flex-col gap-1.5 shrink-0 w-20">
          <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold text-center', meta.bg, meta.color)}>
            {meta.label}
          </span>
          <PriorityBadge priority={react.priority} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-200 truncate">{r.adName}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {r.collection || 'No collection'} · {r.campaignName || r.campaignId}
          </div>
          <div className="mt-2">
            <ScoreBar score={react.score} priority={react.priority} />
          </div>
          <div className="text-[10px] text-slate-600 mt-1">
            Score {react.score}/100 · {react.pauseGuess}
            {!r.hasInsights && <span className="ml-2 text-slate-700">(no 90D data — pull to see metrics)</span>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 shrink-0 text-right text-[11px]">
          <div>
            <div className="text-slate-500">{r.insightsWindow || '90D'} ROAS</div>
            <div className={clsx('text-[14px] font-bold mt-0.5',
              !r.hasInsights ? 'text-slate-600' :
              safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' :
              safeNum(r.metaRoas) >= 2 ? 'text-amber-400' : 'text-red-400')}>
              {r.hasInsights ? fmt.roas(r.metaRoas) : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Spend</div>
            <div className="text-[14px] font-bold text-slate-200 mt-0.5">
              {r.hasInsights ? fmt.currency(r.spend) : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Revenue</div>
            <div className="text-[14px] font-bold text-slate-200 mt-0.5">
              {r.hasInsights ? fmt.currency(r.revenue) : '—'}
            </div>
          </div>
        </div>

        <div className="shrink-0 text-slate-600">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-800/60 p-4 bg-gray-900/60">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Recommended Test Actions</div>
              <ol className="space-y-2">
                {react.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-slate-300">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-brand-600/30 text-brand-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    {a}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Last Known Metrics</div>
              {r.hasInsights ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'CPR',        value: fmt.currency(r.metaCpr) },
                    { label: 'Purchases',  value: fmt.number(r.purchases) },
                    { label: 'Impressions',value: fmt.number(r.impressions) },
                    { label: 'Frequency',  value: fmt.decimal(r.frequency) },
                    { label: 'CPM',        value: fmt.currency(r.cpm) },
                    { label: 'CTR',        value: fmt.pct(r.ctrAll) },
                    { label: 'Hook Rate',  value: `${safeNum(r.lpvRate).toFixed(1)}%` },
                    { label: 'ATC Rate',   value: `${safeNum(r.atcRate).toFixed(1)}%` },
                  ].map(m => (
                    <div key={m.label} className="flex justify-between text-[11px]">
                      <span className="text-slate-500">{m.label}</span>
                      <span className="text-slate-300 font-medium">{m.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-slate-600">Pull 90-day data to see performance metrics for this ad.</div>
              )}
              {r.hasInsights && safeNum(r.metaRoas) >= 3 && safeNum(r.spend) > 0 && (
                <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-[11px] text-emerald-400 font-medium">Est. monthly revenue if relaunched at same ROAS</div>
                  <div className="text-[14px] font-bold text-emerald-400 mt-0.5">
                    {fmt.currency((safeNum(r.spend) / 365 * 30) * safeNum(r.metaRoas))}
                  </div>
                  <div className="text-[10px] text-slate-500">Based on {fmt.currency(safeNum(r.spend) / 365 * 30)}/mo spend at {fmt.roas(r.metaRoas)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── PULL LOG ───────────────────────────────────────────────────── */

function PullLog({ lines }) {
  if (!lines.length) return null;
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[10px] text-slate-400 space-y-0.5">
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────────── */

export default function InactiveAds() {
  const navigate = useNavigate();
  const {
    brandData, activeBrandIds, brands, adMap, campaignMap, manualMap,
    inactiveInsights, inactiveInsightsStatus, inactiveInsightsLastAt,
    setInactiveInsights, setInactiveInsightsStatus,
  } = useStore();

  const [activeTab, setActiveTab]   = useState('all');
  const [pulling, setPulling]       = useState(false);
  const [pullLog, setPullLog]       = useState([]);
  const [showLog, setShowLog]       = useState(false);

  /* ── Pull handler ────────────────────────────────────────────────── */
  const handlePull = async () => {
    setPulling(true);
    setPullLog([]);
    setShowLog(true);
    setInactiveInsightsStatus('loading');
    const log = msg => setPullLog(l => [...l, msg]);

    try {
      const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
      const until = new Date().toISOString().slice(0, 10);
      const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

      for (const brand of activeBrands) {
        if (!brand.meta?.token || !brand.meta?.accounts?.length) {
          log(`[${brand.name}] skip — no Meta config`);
          continue;
        }
        const ver   = brand.meta.apiVersion || 'v21.0';
        const token = brand.meta.token;
        const rows  = [];

        for (const acc of brand.meta.accounts) {
          if (!acc.id || !acc.key) continue;
          log(`[${brand.name}] ${acc.key} → fetching 365 days (${since} → ${until}), chunked into 90-day windows...`);
          try {
            const raw = await fetchInsightsCustom(ver, token, acc.id, since, until, msg => log(`  ${msg}`));
            const normalized = raw.map(r => normalizeInsight(r, acc.key, '365D'));
            rows.push(...normalized);
            log(`[${brand.name}] ${acc.key} ✓ ${normalized.length} rows`);
          } catch (e) {
            log(`[${brand.name}] ${acc.key} ✗ ${e.message || String(e)}`);
          }
        }

        setInactiveInsights(brand.id, rows);
        log(`[${brand.name}] stored ${rows.length} total rows`);
      }
      log('✓ Pull complete — inactive ads data loaded');
    } catch (e) {
      log(`Error: ${e.message}`);
      setInactiveInsightsStatus('error');
    } finally {
      setPulling(false);
    }
  };

  /* ── Build inactive rows ─────────────────────────────────────────── */
  // Index all inactiveInsights (90d) by adId — prefer higher-spend row if duplicate
  const insight90Index = useMemo(() => {
    const idx = {};
    Object.values(inactiveInsights).forEach(rows =>
      rows.forEach(r => {
        if (!idx[r.adId] || safeNum(r.spend) > safeNum(idx[r.adId].spend))
          idx[r.adId] = r;
      })
    );
    return idx;
  }, [inactiveInsights]);

  // Index 30d insights (fallback for ads not in 90d pull yet)
  const insight30Index = useMemo(() => {
    const idx = {};
    brands.filter(b => activeBrandIds.includes(b.id)).forEach(b => {
      const d = brandData[b.id];
      if (!d) return;
      (d.insights30d || []).forEach(r => { idx[r.adId] = r; });
    });
    return idx;
  }, [brandData, activeBrandIds, brands]);

  const has90d   = Object.keys(inactiveInsights).length > 0;
  const hasAdMap = Object.keys(adMap).length > 0;

  // Build full inactive list from adMap (all ads) filtered to non-ACTIVE
  const inactiveRows = useMemo(() => {
    if (!hasAdMap) return [];

    return Object.entries(adMap)
      .filter(([, ad]) => ad.effective_status !== 'ACTIVE')
      .map(([adId, ad]) => {
        const insights = insight90Index[adId] || insight30Index[adId];
        const manual   = manualMap?.[adId] || {};
        return {
          adId,
          adName:          ad.name || insights?.adName || adId,
          effectiveStatus: ad.effective_status || ad.status || 'UNKNOWN',
          campaignId:      ad.campaign_id     || insights?.campaignId     || '',
          campaignName:    insights?.campaignName || campaignMap[ad.campaign_id]?.name || '',
          adSetId:         ad.adset_id        || insights?.adSetId        || '',
          // Performance (from insights or zeros)
          spend:       insights?.spend       || 0,
          revenue:     insights?.revenue     || 0,
          purchases:   insights?.purchases   || 0,
          metaRoas:    insights?.metaRoas    || 0,
          metaCpr:     insights?.metaCpr     || 0,
          impressions: insights?.impressions || 0,
          frequency:   insights?.frequency   || 0,
          ctrAll:      insights?.ctrAll      || 0,
          cpm:         insights?.cpm         || 0,
          lpvRate:     insights?.lpvRate     || 0,
          atcRate:     insights?.atcRate     || 0,
          convRate:    insights?.convRate    || 0,
          // Manual tags
          collection:  manual['Collection']    || '',
          creator:     manual['Creator']       || '',
          sku:         manual['SKU']           || '',
          offerType:   manual['Offer Type']    || '',
          hasInsights: !!insights,
          insightsWindow: insights?.window || null,
        };
      })
      .sort((a, b) =>
        safeNum(b.metaRoas) - safeNum(a.metaRoas) ||
        safeNum(b.spend)    - safeNum(a.spend)
      );
  }, [adMap, insight90Index, insight30Index, manualMap, campaignMap, hasAdMap]);

  /* ── Segmented views ─────────────────────────────────────────────── */
  const highPotential = useMemo(() =>
    inactiveRows.filter(r => safeNum(r.metaRoas) >= 3 && r.hasInsights && safeNum(r.spend) >= 500),
    [inactiveRows]);

  const writeOffs = useMemo(() =>
    inactiveRows.filter(r => r.hasInsights && (safeNum(r.metaRoas) < 2 || safeNum(r.spend) < 200)),
    [inactiveRows]);

  const noData = useMemo(() =>
    inactiveRows.filter(r => !r.hasInsights),
    [inactiveRows]);

  const totalFormerSpend  = inactiveRows.reduce((s, r) => s + safeNum(r.spend), 0);
  const withInsights      = inactiveRows.filter(r => r.hasInsights);
  const avgFormerRoas     = withInsights.length
    ? withInsights.reduce((s, r) => s + safeNum(r.metaRoas), 0) / withInsights.length : 0;
  const revivalRevPotential = highPotential.reduce(
    (s, r) => s + (safeNum(r.spend) / 365 * 30) * safeNum(r.metaRoas), 0
  );

  /* ── No Meta config guard ────────────────────────────────────────── */
  if (!hasAdMap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <PauseCircle size={40} className="text-slate-600" />
        <div>
          <div className="text-xl font-bold text-white mb-2">No ad data loaded</div>
          <div className="text-sm text-slate-500 max-w-sm mb-4">
            Pull Meta data from Study Manual first. This page needs the ad list from your Meta account to identify which ads are inactive.
          </div>
          <button
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors"
            onClick={() => navigate('/setup')}
          >
            Go to Study Manual →
          </button>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: 'all',       label: `All Inactive (${inactiveRows.length})` },
    { id: 'revival',   label: `Revival Candidates (${highPotential.length})` },
    { id: 'writeoffs', label: `Write-offs (${writeOffs.length})` },
    ...(noData.length > 0 ? [{ id: 'nodata', label: `No 90D Data (${noData.length})` }] : []),
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <PauseCircle size={22} className="text-amber-400" />
            Inactive Ads
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            All paused / deleted ads in your accounts — {inactiveRows.length} total
            {inactiveInsightsLastAt && (
              <span className="ml-2 text-slate-600">
                · 90D data pulled {new Date(inactiveInsightsLastAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        {/* Pull button */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={handlePull}
            disabled={pulling}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={14} className={pulling ? 'animate-spin' : ''} />
            {pulling ? 'Pulling 365D data…' : has90d ? 'Re-pull 365D data' : 'Pull Full Account (365D)'}
          </button>
          {has90d && (
            <div className="text-[10px] text-slate-500">
              {withInsights.length} of {inactiveRows.length} ads have performance data
            </div>
          )}
          {pullLog.length > 0 && (
            <button
              className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
              onClick={() => setShowLog(l => !l)}
            >
              {showLog ? 'Hide log' : 'Show log'}
            </button>
          )}
        </div>
      </div>

      {/* Pull log */}
      {showLog && <PullLog lines={pullLog} />}

      {/* Initial prompt: no 90d data yet */}
      {!has90d && inactiveRows.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-amber-400">Performance data not loaded yet</div>
            <div className="text-[12px] text-slate-400 mt-1">
              The ad list shows {inactiveRows.length} inactive ads from your account, but performance metrics
              (ROAS, spend, purchases) require the <strong>Pull Full Account (365D)</strong> fetch above.
              This fetches the last 365 days of insights (in 90-day chunks) including data from paused ads.
            </div>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      {inactiveRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Inactive</div>
            <div className="text-2xl font-bold text-white">{inactiveRows.length}</div>
            <div className="text-[11px] text-slate-500 mt-1">{highPotential.length} revival candidates</div>
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">90D Spend (when active)</div>
            <div className="text-2xl font-bold text-white">{fmt.currency(totalFormerSpend)}</div>
            <div className="text-[11px] text-slate-500 mt-1">{withInsights.length} ads with data</div>
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Avg ROAS (last active)</div>
            <div className={clsx('text-2xl font-bold',
              !withInsights.length ? 'text-slate-600' :
              avgFormerRoas >= 3 ? 'text-emerald-400' : avgFormerRoas >= 2 ? 'text-amber-400' : 'text-red-400')}>
              {withInsights.length ? `${avgFormerRoas.toFixed(2)}x` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Simple avg across 90D data</div>
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Est. Revival Revenue</div>
            <div className="text-2xl font-bold text-emerald-400">
              {revivalRevPotential > 0 ? fmt.currency(revivalRevPotential) : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">If top candidates relaunch at same ROAS</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {inactiveRows.length > 0 && (
        <>
          <div className="flex gap-1 bg-gray-900/60 p-1 rounded-lg border border-gray-800/60 w-fit flex-wrap">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                  activeTab === t.id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >{t.label}</button>
            ))}
          </div>

          {/* ── Tab: All Inactive ─────────────────────────────────────── */}
          <div style={{ display: activeTab === 'all' ? undefined : 'none' }}>
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60 bg-gray-900/80">
                      <th className="py-2.5 px-4 text-left">Ad</th>
                      <th className="py-2.5 px-3 text-left">Status</th>
                      <th className="py-2.5 px-3 text-left">Collection</th>
                      <th className="py-2.5 px-3 text-right">ROAS</th>
                      <th className="py-2.5 px-3 text-right">Spend</th>
                      <th className="py-2.5 px-3 text-right">Revenue</th>
                      <th className="py-2.5 px-3 text-right">CPR</th>
                      <th className="py-2.5 px-3 text-right">Freq</th>
                      <th className="py-2.5 px-3 text-right">Purchases</th>
                      <th className="py-2.5 px-3 text-center">Revival</th>
                      <th className="py-2.5 px-3 text-center">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactiveRows.map(r => {
                      const meta  = sm(r.effectiveStatus);
                      const react = computeReactivation(r);
                      return (
                        <tr key={r.adId} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                          <td className="py-2.5 px-4">
                            <div className="text-slate-200 font-medium truncate max-w-[200px]">{r.adName}</div>
                            <div className="text-[10px] text-slate-500 truncate">{r.campaignName || r.campaignId}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', meta.bg, meta.color)}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{r.collection || '—'}</td>
                          <td className={clsx('py-2.5 px-3 text-right font-bold',
                            !r.hasInsights ? 'text-slate-600' :
                            safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' :
                            safeNum(r.metaRoas) >= 2 ? 'text-amber-400' : 'text-red-400')}>
                            {r.hasInsights ? fmt.roas(r.metaRoas) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {r.hasInsights ? fmt.currency(r.spend) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {r.hasInsights ? fmt.currency(r.revenue) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            {r.hasInsights ? fmt.currency(r.metaCpr) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            {r.hasInsights ? fmt.decimal(r.frequency) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            {r.hasInsights ? fmt.number(r.purchases) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {r.hasInsights ? <PriorityBadge priority={react.priority} /> : <span className="text-slate-700">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={clsx('text-[10px] font-medium',
                              r.hasInsights ? 'text-emerald-400' : 'text-slate-600')}>
                              {r.hasInsights ? r.insightsWindow || '90D' : 'None'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Tab: Revival Candidates ───────────────────────────────── */}
          <div style={{ display: activeTab === 'revival' ? undefined : 'none' }}>
            {!has90d ? (
              <div className="bg-gray-900 border border-amber-500/20 rounded-xl p-8 text-center">
                <RefreshCw size={28} className="text-amber-400 mx-auto mb-3" />
                <div className="text-sm font-semibold text-amber-400 mb-2">Pull 90D data to see revival candidates</div>
                <div className="text-[12px] text-slate-500">
                  Click "Pull Full Account (365D)" above to load performance data for all paused ads.
                  Revival candidates are paused ads with ROAS ≥3x and significant spend.
                </div>
              </div>
            ) : highPotential.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-12 text-center text-slate-500">
                No inactive ads met the revival criteria (≥3x ROAS + ≥₹500 spend in last 90 days).
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <RefreshCw size={12} />
                  <span>{highPotential.length} ads with strong historical ROAS — click to expand reactivation plan</span>
                </div>
                {highPotential.map(r => <ReactivationCard key={r.adId} r={r} />)}
              </div>
            )}
          </div>

          {/* ── Tab: Write-offs ───────────────────────────────────────── */}
          <div style={{ display: activeTab === 'writeoffs' ? undefined : 'none' }}>
            <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
              <AlertTriangle size={12} className="text-red-400" />
              <span>Consistently poor performance — not recommended for reactivation without major changes.</span>
            </div>
            {writeOffs.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-8 text-center text-slate-500">
                {has90d ? 'No confirmed write-offs found.' : 'Pull 90D data first to identify write-offs.'}
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                        <th className="py-2.5 px-4 text-left">Ad</th>
                        <th className="py-2.5 px-3 text-left">Status</th>
                        <th className="py-2.5 px-3 text-right">ROAS</th>
                        <th className="py-2.5 px-3 text-right">Spend</th>
                        <th className="py-2.5 px-3 text-right">Purchases</th>
                        <th className="py-2.5 px-4 text-left">Assessment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {writeOffs.map(r => {
                        const meta = sm(r.effectiveStatus);
                        const roas = safeNum(r.metaRoas);
                        const why = roas < 1 ? 'Never broke even — below 1x ROAS'
                          : roas < 2 ? 'Weak ROAS — could not sustain profitability'
                          : 'Insufficient spend volume to evaluate properly';
                        return (
                          <tr key={r.adId} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                            <td className="py-2.5 px-4">
                              <div className="text-slate-300 font-medium truncate max-w-[200px]">{r.adName}</div>
                              <div className="text-[10px] text-slate-500 truncate">{r.campaignName}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', meta.bg, meta.color)}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-red-400">{fmt.roas(r.metaRoas)}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{fmt.currency(r.spend)}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{fmt.number(r.purchases)}</td>
                            <td className="py-2.5 px-4 text-slate-500">{why}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Tab: No 90D data ─────────────────────────────────────── */}
          {noData.length > 0 && (
            <div style={{ display: activeTab === 'nodata' ? undefined : 'none' }}>
              <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
                <AlertTriangle size={12} className="text-slate-500" />
                <span>{noData.length} inactive ads with no impressions in the last 365 days — these ran before the 1-year window or never had data.</span>
              </div>
              <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                        <th className="py-2.5 px-4 text-left">Ad Name</th>
                        <th className="py-2.5 px-3 text-left">Status</th>
                        <th className="py-2.5 px-3 text-left">Campaign</th>
                        <th className="py-2.5 px-3 text-left">Collection</th>
                        <th className="py-2.5 px-3 text-left">Ad ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {noData.map(r => {
                        const meta = sm(r.effectiveStatus);
                        return (
                          <tr key={r.adId} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                            <td className="py-2.5 px-4 text-slate-400 font-medium truncate max-w-[220px]">{r.adName}</td>
                            <td className="py-2.5 px-3">
                              <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', meta.bg, meta.color)}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 truncate max-w-[160px]">{r.campaignName || r.campaignId}</td>
                            <td className="py-2.5 px-3 text-slate-500">{r.collection || '—'}</td>
                            <td className="py-2.5 px-3 text-slate-700 font-mono text-[10px]">{r.adId}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {inactiveRows.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-4">
          <Zap size={36} className="text-emerald-500" />
          <div>
            <div className="text-xl font-bold text-white mb-2">All ads are active</div>
            <div className="text-sm text-slate-500">No paused or deleted ads found in this account.</div>
          </div>
        </div>
      )}

    </div>
  );
}
