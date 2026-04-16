import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import {
  PauseCircle, RefreshCw, TrendingUp, TrendingDown, Zap,
  AlertTriangle, ChevronDown, ChevronRight, BarChart3, Target,
} from 'lucide-react';
import clsx from 'clsx';
import { safeNum, fmt, safeDivide } from '../lib/analytics';

/* ─── HELPERS ───────────────────────────────────────────────────── */

const STATUS_META = {
  PAUSED:   { label: 'Paused',   color: 'text-amber-400', bg: 'bg-amber-500/10 ring-1 ring-amber-500/30' },
  DELETED:  { label: 'Deleted',  color: 'text-red-400',   bg: 'bg-red-500/10 ring-1 ring-red-500/30' },
  ARCHIVED: { label: 'Archived', color: 'text-slate-400', bg: 'bg-gray-700/40' },
  UNKNOWN:  { label: 'Inactive', color: 'text-slate-400', bg: 'bg-gray-700/40' },
};

function statusMeta(status) {
  return STATUS_META[status?.toUpperCase()] || STATUS_META.UNKNOWN;
}

/* ─── REACTIVATION LOGIC ─────────────────────────────────────────── */

function computeReactivation(r) {
  const roas  = safeNum(r.metaRoas);
  const spend = safeNum(r.spend);
  const freq  = safeNum(r.frequency);

  let score = 0;
  const actions = [];
  let priority = 'Low';

  // Score from ROAS
  if (roas >= 5)      score += 50;
  else if (roas >= 4) score += 40;
  else if (roas >= 3) score += 25;
  else if (roas >= 2) score += 10;

  // Score from proven spend volume
  if (spend >= 10000) score += 30;
  else if (spend >= 5000) score += 20;
  else if (spend >= 2000) score += 15;
  else if (spend >= 1000) score += 10;
  else if (spend >= 500) score += 5;

  // Priority bucket
  if (score >= 60)      priority = 'High';
  else if (score >= 35) priority = 'Medium';
  else                  priority = 'Low';

  // Pause reason (guessed from metrics)
  let pauseGuess = '';
  if (freq >= 4)                    pauseGuess = 'Audience fatigue (high frequency)';
  else if (roas < 2)                pauseGuess = 'Low ROAS underperformance';
  else if (roas >= 3 && spend > 2000) pauseGuess = 'Strategic pause or budget reallocation';
  else                              pauseGuess = 'Unknown';

  // Tailored actions
  if (roas >= 4) {
    actions.push('High-potential relaunch: use identical creative + offer at 50% of prior budget');
    if (freq >= 3) actions.push('Reset audience — build fresh lookalike from last 60-day purchasers');
    else actions.push('Widen targeting slightly (expand age range or add 1 similar interest)');
    actions.push('Scale 20%/day if ROAS holds for 3 consecutive days');
  } else if (roas >= 3) {
    actions.push('Creative refresh needed — same product, new hook angle or different format');
    actions.push('A/B test a different offer type (e.g., bundle → discount, or add freebie)');
    if (freq >= 3) actions.push('Audience reset required — current audience is saturated');
  } else if (roas >= 2) {
    actions.push('Major creative overhaul needed before relaunch — consider new UGC or testimonial format');
    actions.push('Test a significantly different offer (pricing, bundle structure, incentive)');
    actions.push('Narrow targeting to highest-LTV segment before scaling');
  } else {
    actions.push('Low reactivation potential — only test if product or offer has fundamentally changed');
    actions.push('Consider retiring this ad concept and testing a fresh angle for the same product');
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

/* ─── REACTIVATION CARD ──────────────────────────────────────────── */

function ReactivationCard({ r }) {
  const [open, setOpen] = useState(false);
  const react = useMemo(() => computeReactivation(r), [r]);
  const sm = statusMeta(r.effectiveStatus);

  return (
    <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-800/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {/* Status + priority */}
        <div className="flex flex-col gap-1.5 shrink-0 w-20">
          <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold text-center', sm.bg, sm.color)}>
            {sm.label}
          </span>
          <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold text-center',
            react.priority === 'High'   ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30' :
            react.priority === 'Medium' ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30' :
                                          'bg-gray-700/40 text-slate-500'
          )}>
            {react.priority}
          </span>
        </div>

        {/* Ad info */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-200 truncate">{r.adName}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {r.collection || 'No collection'} · {r.campaignName}
          </div>
          <div className="mt-2">
            <ScoreBar score={react.score} priority={react.priority} />
          </div>
          <div className="text-[10px] text-slate-600 mt-1">Reactivation score: {react.score}/100 · {react.pauseGuess}</div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3 shrink-0 text-right text-[11px]">
          <div>
            <div className="text-slate-500">30D ROAS</div>
            <div className={clsx('text-[14px] font-bold mt-0.5',
              safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' :
              safeNum(r.metaRoas) >= 2 ? 'text-amber-400' : 'text-red-400')}>
              {fmt.roas(r.metaRoas)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">30D Spend</div>
            <div className="text-[14px] font-bold text-slate-200 mt-0.5">{fmt.currency(r.spend)}</div>
          </div>
          <div>
            <div className="text-slate-500">30D Revenue</div>
            <div className="text-[14px] font-bold text-slate-200 mt-0.5">{fmt.currency(r.revenue)}</div>
          </div>
        </div>

        <div className="shrink-0 text-slate-600">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </div>

      {/* Expanded panel */}
      {open && (
        <div className="border-t border-gray-800/60 p-4 bg-gray-900/60">
          <div className="grid grid-cols-2 gap-6">
            {/* Actions */}
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                Recommended Test Actions
              </div>
              <ol className="space-y-2">
                {react.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-slate-300">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-brand-600/30 text-brand-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    {a}
                  </li>
                ))}
              </ol>
            </div>

            {/* Key metrics */}
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                Last Active Metrics
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'CPR',         value: fmt.currency(r.metaCpr) },
                  { label: 'Purchases',   value: fmt.number(r.purchases) },
                  { label: 'Impressions', value: fmt.number(r.impressions) },
                  { label: 'Frequency',   value: fmt.decimal(r.frequency) },
                  { label: 'CPM',         value: fmt.currency(r.cpm) },
                  { label: 'CTR',         value: fmt.pct(r.ctrAll) },
                  { label: 'Hook Rate',   value: `${safeNum(r.lpvRate).toFixed(1)}%` },
                  { label: 'ATC Rate',    value: `${safeNum(r.atcRate).toFixed(1)}%` },
                ].map(m => (
                  <div key={m.label} className="flex justify-between text-[11px]">
                    <span className="text-slate-500">{m.label}</span>
                    <span className="text-slate-300 font-medium">{m.value}</span>
                  </div>
                ))}
              </div>
              {safeNum(r.spend) > 0 && safeNum(r.metaRoas) >= 3 && (
                <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-[11px] text-emerald-400 font-medium">
                    Est. monthly revenue if relaunched at same ROAS:
                  </div>
                  <div className="text-[14px] font-bold text-emerald-400 mt-0.5">
                    {fmt.currency((safeNum(r.spend) / 7 * 30) * safeNum(r.metaRoas))}
                  </div>
                  <div className="text-[10px] text-slate-500">Based on {fmt.currency(safeNum(r.spend) / 7 * 30)}/mo spend at {fmt.roas(r.metaRoas)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────────── */

export default function InactiveAds() {
  const navigate = useNavigate();
  const { brandData, activeBrandIds, brands, adMap, manualMap } = useStore();
  const [activeTab, setActiveTab] = useState('all');

  // Build inactive rows from 30D insights
  const inactiveRows = useMemo(() => {
    const hasAdMap = Object.keys(adMap).length > 0;
    const all30 = [];
    brands.filter(b => activeBrandIds.includes(b.id)).forEach(b => {
      const d = brandData[b.id];
      if (!d) return;
      (d.insights30d || []).forEach(r => all30.push(r));
    });

    if (!hasAdMap) return [];

    return all30
      .filter(r => {
        const ad = adMap[r.adId];
        if (!ad) return false;
        return ad.effective_status !== 'ACTIVE';
      })
      .map(r => {
        const ad     = adMap[r.adId] || {};
        const manual = manualMap?.[r.adId] || {};
        return {
          ...r,
          effectiveStatus: ad.effective_status || 'UNKNOWN',
          collection:  manual['Collection'] || '',
          creator:     manual['Creator'] || '',
          sku:         manual['SKU'] || '',
          offerType:   manual['Offer Type'] || '',
          campaignType: manual['Campaign Type'] || '',
        };
      })
      .sort((a, b) => safeNum(b.metaRoas) - safeNum(a.metaRoas));
  }, [brandData, activeBrandIds, brands, adMap, manualMap]);

  const hasAdMap = Object.keys(adMap).length > 0;

  // Segmented views
  const highPotential = useMemo(() =>
    inactiveRows.filter(r => safeNum(r.metaRoas) >= 3 && safeNum(r.spend) >= 500),
    [inactiveRows]);

  const writeOffs = useMemo(() =>
    inactiveRows.filter(r => safeNum(r.metaRoas) < 2 || safeNum(r.spend) < 200),
    [inactiveRows]);

  const totalFormerSpend = inactiveRows.reduce((s, r) => s + safeNum(r.spend), 0);
  const avgFormerRoas    = inactiveRows.length
    ? inactiveRows.reduce((s, r) => s + safeNum(r.metaRoas), 0) / inactiveRows.length : 0;

  if (!hasAdMap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <PauseCircle size={40} className="text-slate-600" />
        <div>
          <div className="text-xl font-bold text-white mb-2">Ad status data not loaded</div>
          <div className="text-sm text-slate-500 max-w-sm mb-4">
            Pull Meta data from Study Manual to load ad statuses. The inactive ads module needs both insights and ad-level status.
          </div>
          <button
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors"
            onClick={() => navigate('/setup')}
          >
            Go to Study Manual
          </button>
        </div>
      </div>
    );
  }

  if (inactiveRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <Zap size={40} className="text-emerald-500" />
        <div>
          <div className="text-xl font-bold text-white mb-2">All ads are currently active</div>
          <div className="text-sm text-slate-500">No paused or deleted ads found in the last 30-day window.</div>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: 'all',       label: `All Inactive (${inactiveRows.length})` },
    { id: 'revival',   label: `Revival Candidates (${highPotential.length})` },
    { id: 'writeoffs', label: `Write-offs (${writeOffs.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <PauseCircle size={22} className="text-amber-400" />
            Inactive Ads
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Paused &amp; deleted ads from last 30 days — analyse peak performance and reactivation potential
          </p>
        </div>
        <button
          className="px-3 py-1.5 text-[11px] bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 rounded-lg transition-colors"
          onClick={() => navigate('/decisions')}
        >
          Active Ads →
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Inactive</div>
          <div className="text-2xl font-bold text-white">{inactiveRows.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">{highPotential.length} revival candidates</div>
        </div>
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">30D Spend (when active)</div>
          <div className="text-2xl font-bold text-white">{fmt.currency(totalFormerSpend)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Across all inactive ads</div>
        </div>
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Avg ROAS at Pause</div>
          <div className={clsx('text-2xl font-bold', avgFormerRoas >= 3 ? 'text-emerald-400' : avgFormerRoas >= 2 ? 'text-amber-400' : 'text-red-400')}>
            {avgFormerRoas.toFixed(2)}x
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Simple average (30D data)</div>
        </div>
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Est. Revival Revenue</div>
          <div className="text-2xl font-bold text-emerald-400">
            {fmt.currency(highPotential.reduce((s, r) => s + (safeNum(r.spend) / 7 * 30) * safeNum(r.metaRoas), 0))}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">If top candidates relaunch at same ROAS</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/60 p-1 rounded-lg border border-gray-800/60 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              activeTab === t.id
                ? 'bg-brand-600 text-white'
                : 'text-slate-400 hover:text-slate-200',
            )}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab: All Inactive */}
      <div style={{ display: activeTab === 'all' ? undefined : 'none' }}>
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60 bg-gray-900">
                  <th className="py-2.5 px-4 text-left">Ad</th>
                  <th className="py-2.5 px-3 text-left">Status</th>
                  <th className="py-2.5 px-3 text-left">Collection</th>
                  <th className="py-2.5 px-3 text-right">30D ROAS</th>
                  <th className="py-2.5 px-3 text-right">30D Spend</th>
                  <th className="py-2.5 px-3 text-right">30D Revenue</th>
                  <th className="py-2.5 px-3 text-right">30D CPR</th>
                  <th className="py-2.5 px-3 text-right">Frequency</th>
                  <th className="py-2.5 px-3 text-right">Purchases</th>
                  <th className="py-2.5 px-3 text-center">Revival?</th>
                </tr>
              </thead>
              <tbody>
                {inactiveRows.map(r => {
                  const sm    = statusMeta(r.effectiveStatus);
                  const react = computeReactivation(r);
                  return (
                    <tr key={r.adId} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="text-slate-200 font-medium truncate max-w-[200px]">{r.adName}</div>
                        <div className="text-[10px] text-slate-500 truncate">{r.campaignName}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', sm.bg, sm.color)}>
                          {sm.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{r.collection || '—'}</td>
                      <td className={clsx('py-2.5 px-3 text-right font-bold',
                        safeNum(r.metaRoas) >= 4 ? 'text-emerald-400' :
                        safeNum(r.metaRoas) >= 2 ? 'text-amber-400' : 'text-red-400')}>
                        {fmt.roas(r.metaRoas)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">{fmt.currency(r.spend)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-300">{fmt.currency(r.revenue)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-300">{fmt.currency(r.metaCpr)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">{fmt.decimal(r.frequency)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">{fmt.number(r.purchases)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold',
                          react.priority === 'High'   ? 'bg-emerald-500/10 text-emerald-400' :
                          react.priority === 'Medium' ? 'bg-amber-500/10 text-amber-400' :
                                                        'bg-gray-700/40 text-slate-500')}>
                          {react.priority}
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

      {/* Tab: Revival Candidates */}
      <div style={{ display: activeTab === 'revival' ? undefined : 'none' }}>
        {highPotential.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-12 text-center text-slate-500">
            No inactive ads met the revival criteria (≥3x ROAS + ≥₹500 spend in last 30 days).
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <RefreshCw size={12} />
              <span>{highPotential.length} ads with strong historical ROAS that could be relaunched — click to expand reactivation plan</span>
            </div>
            {highPotential.map(r => (
              <ReactivationCard key={r.adId} r={r} />
            ))}
          </div>
        )}
      </div>

      {/* Tab: Write-offs */}
      <div style={{ display: activeTab === 'writeoffs' ? undefined : 'none' }}>
        <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
          <AlertTriangle size={12} className="text-red-400" />
          <span>These ads had consistently poor performance — not recommended for reactivation without major changes.</span>
        </div>
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                  <th className="py-2.5 px-4 text-left">Ad</th>
                  <th className="py-2.5 px-3 text-left">Status</th>
                  <th className="py-2.5 px-3 text-right">30D ROAS</th>
                  <th className="py-2.5 px-3 text-right">30D Spend</th>
                  <th className="py-2.5 px-3 text-right">Purchases</th>
                  <th className="py-2.5 px-4 text-left">Why Low</th>
                </tr>
              </thead>
              <tbody>
                {writeOffs.map(r => {
                  const sm   = statusMeta(r.effectiveStatus);
                  const roas = safeNum(r.metaRoas);
                  let why = '';
                  if (roas < 1)     why = 'Never broke even — below 1x ROAS';
                  else if (roas < 2) why = 'Weak ROAS — unable to sustain profitability';
                  else               why = 'Insufficient spend to evaluate performance';
                  return (
                    <tr key={r.adId} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="text-slate-300 font-medium truncate max-w-[200px]">{r.adName}</div>
                        <div className="text-[10px] text-slate-500 truncate">{r.campaignName}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', sm.bg, sm.color)}>
                          {sm.label}
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
      </div>

    </div>
  );
}
