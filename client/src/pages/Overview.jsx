import { useMemo } from 'react';
import { useStore } from '../store';
import {
  BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, TrendingDown, Zap, Target, ShieldCheck,
  Activity, DollarSign, Package, BarChart3, ArrowUpRight, ArrowDownRight,
  Minus, Flame, Skull, Trophy,
} from 'lucide-react';
import clsx from 'clsx';
import { safeNum, fmt, aggregateMetrics, buildPatternSummary } from '../lib/analytics';
import {
  buildAlerts, buildHookHoldMatrix, buildOfferLiftMatrix,
  buildFunnelLeakDiagnosis,
} from '../lib/metaIntelligence';

/* ─── HELPERS ───────────────────────────────────────────────────── */

const DECISION_COLORS = {
  'Scale Hard': '#22c55e', 'Scale Carefully': '#86efac',
  'Defend': '#a78bfa', 'Fix': '#f59e0b',
  'Watch': '#60a5fa', 'Kill': '#f87171', 'Pause': '#94a3b8',
};

const SEVERITY_STYLES = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-400',
  high:     'bg-amber-500/10 border-amber-500/30 text-amber-400',
  medium:   'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
};

const SEVERITY_ICON = { critical: Skull, high: AlertTriangle, medium: Activity };

const deltaColor = v => v > 5 ? 'text-emerald-400' : v < -5 ? 'text-red-400' : 'text-slate-400';
const deltaIcon  = v => v > 5 ? ArrowUpRight : v < -5 ? ArrowDownRight : Minus;

const MOMENTUM_BAND = score => {
  if (score >= 60)  return { label: 'Surging',   color: '#22c55e' };
  if (score >= 30)  return { label: 'Improving', color: '#86efac' };
  if (score >= -15) return { label: 'Stable',    color: '#60a5fa' };
  if (score >= -40) return { label: 'Softening', color: '#f59e0b' };
  return               { label: 'Declining',  color: '#f87171' };
};

/* ─── KPI CARD ───────────────────────────────────────────────────── */

function KpiCard({ label, value, sub, delta, icon: Icon, iconColor = 'text-brand-400' }) {
  const DIcon = deltaIcon(delta ?? 0);
  return (
    <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</span>
        <Icon size={15} className={iconColor} />
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
      {(sub || delta !== undefined) && (
        <div className="flex items-center gap-2 text-[11px]">
          {sub && <span className="text-slate-500">{sub}</span>}
          {delta !== undefined && delta !== null && (
            <span className={clsx('flex items-center gap-0.5 font-medium', deltaColor(delta))}>
              <DIcon size={11} />
              {Math.abs(delta).toFixed(1)}% vs 30D
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── ALERT STRIP ────────────────────────────────────────────────── */

function AlertStrip({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div className="flex flex-col gap-2 mb-6">
      {alerts.slice(0, 5).map((a, i) => {
        const SevIcon = SEVERITY_ICON[a.severity] || AlertTriangle;
        return (
          <div key={i} className={clsx(
            'flex items-start gap-3 px-4 py-3 rounded-lg border text-sm',
            SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.medium
          )}>
            <SevIcon size={15} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{a.title}</span>
              {a.detail && <span className="ml-2 opacity-70 truncate">{a.detail}</span>}
            </div>
            <span className="text-[10px] uppercase tracking-wider opacity-60 shrink-0">{a.severity}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── MOMENTUM BAR ───────────────────────────────────────────────── */

function MomentumBar({ score }) {
  const band = MOMENTUM_BAND(score);
  const pct  = Math.round(((score + 100) / 200) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: band.color }} />
      </div>
      <span className="text-[10px] font-semibold" style={{ color: band.color }}>{band.label}</span>
    </div>
  );
}

/* ─── FUNNEL ROW ─────────────────────────────────────────────────── */

function FunnelBar({ label, rate, color, isLeak }) {
  const pct = Math.min(100, safeNum(rate));
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-[11px] text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', isLeak && 'opacity-60')} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={clsx('w-12 text-right text-[11px] font-semibold shrink-0', isLeak ? 'text-red-400' : 'text-slate-300')}>
        {safeNum(rate).toFixed(1)}%{isLeak && ' ⚠'}
      </span>
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────────── */

export default function Overview() {
  const { enrichedRows, shopifyOrders, inventoryMap, brandData, activeBrandIds, brands } = useStore();

  const agg7d = useMemo(() => aggregateMetrics(enrichedRows), [enrichedRows]);

  // Simple 30d aggregate from raw brandData (not enriched, just for KPI deltas)
  const agg30d = useMemo(() => {
    const all30 = [];
    brands.filter(b => activeBrandIds.includes(b.id)).forEach(b => {
      const d = brandData[b.id];
      if (!d) return;
      (d.insights30d || []).forEach(r => all30.push({
        spend: r.spend, purchases: r.purchases, revenue: r.revenue,
        impressions: r.impressions, clicksAll: r.clicksAll,
        lpv: r.lpv, atc: r.atc, ic: r.ic, outboundClicks: r.outboundClicks,
        metaRoas: r.metaRoas, metaCpr: r.metaCpr,
        cpm: r.cpm, ctr: r.ctrAll,
        budget: 0, budgetLevel: '', adSetId: '', campaignId: '',
      }));
    });
    return all30.length ? aggregateMetrics(all30) : null;
  }, [brandData, activeBrandIds, brands]);

  const alerts      = useMemo(() => buildAlerts(enrichedRows, inventoryMap, shopifyOrders), [enrichedRows, inventoryMap, shopifyOrders]);
  const hookHold    = useMemo(() => buildHookHoldMatrix(enrichedRows), [enrichedRows]);
  const offerMatrix = useMemo(() => buildOfferLiftMatrix(enrichedRows), [enrichedRows]);
  const funnelDiag  = useMemo(() => buildFunnelLeakDiagnosis(enrichedRows), [enrichedRows]);

  const decisionData = useMemo(() => {
    const counts = {};
    enrichedRows.forEach(r => { const d = r.decision || 'Watch'; counts[d] = (counts[d] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [enrichedRows]);

  const topAds = useMemo(() =>
    [...enrichedRows].filter(r => safeNum(r.spend) >= 500 && safeNum(r.metaRoas) > 0)
      .sort((a, b) => safeNum(b.metaRoas) - safeNum(a.metaRoas)).slice(0, 6),
    [enrichedRows]);

  const worstAds = useMemo(() =>
    [...enrichedRows].filter(r => safeNum(r.spend) >= 500 && safeNum(r.metaRoas) > 0)
      .sort((a, b) => safeNum(a.metaRoas) - safeNum(b.metaRoas)).slice(0, 5),
    [enrichedRows]);

  const collectionData = useMemo(() =>
    buildPatternSummary(enrichedRows.filter(r => safeNum(r.spend) > 0), 'collection').slice(0, 8),
    [enrichedRows]);

  const accountData = useMemo(() =>
    buildPatternSummary(enrichedRows.filter(r => safeNum(r.spend) > 0), 'accountKey'),
    [enrichedRows]);

  const intel = useMemo(() => {
    const valid = enrichedRows.filter(r => safeNum(r.spend) > 0);
    if (!valid.length) return null;
    return {
      avgMomentum: Math.round(valid.reduce((s, r) => s + (r.momentumScore || 0), 0) / valid.length),
      avgFatigue:  Math.round(valid.reduce((s, r) => s + (r.fatigueScore  || 0), 0) / valid.length),
      highFatigue: valid.filter(r => (r.fatigueScore || 0) >= 70).length,
      surging:     valid.filter(r => (r.momentumScore || 0) >= 60).length,
    };
  }, [enrichedRows]);

  const pctDelta = (a, b) => b > 0 ? ((a - b) / b) * 100 : null;
  const spendDelta = agg7d && agg30d ? pctDelta(agg7d.spend,    agg30d.spend)   : null;
  const roasDelta  = agg7d && agg30d ? pctDelta(agg7d.roas,     agg30d.roas)    : null;
  const cprDelta   = agg7d && agg30d ? pctDelta(agg7d.cpr,      agg30d.cpr)     : null;
  const revDelta   = agg7d && agg30d ? pctDelta(agg7d.revenue,  agg30d.revenue) : null;

  const hasData = enrichedRows.length > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-brand-600/20 flex items-center justify-center">
          <Zap size={28} className="text-brand-400" />
        </div>
        <div>
          <div className="text-xl font-bold text-white mb-1">No data loaded yet</div>
          <div className="text-sm text-slate-500 max-w-sm">
            Go to Study Manual to configure brands, then pull your data. The dashboard auto-loads on return visits.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Alert Strip */}
      <AlertStrip alerts={alerts} />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Total Spend"  value={fmt.currency(agg7d?.spend)}                    delta={spendDelta}           icon={DollarSign}  iconColor="text-amber-400" />
        <KpiCard label="ROAS"         value={agg7d?.roas  ? fmt.roas(agg7d.roas)     : '—'} delta={roasDelta}            icon={TrendingUp}  iconColor="text-emerald-400" />
        <KpiCard label="CPR"          value={agg7d?.cpr   ? fmt.currency(agg7d.cpr)  : '—'} delta={cprDelta !== null ? -cprDelta : null} icon={Target} iconColor="text-blue-400" />
        <KpiCard label="Revenue"      value={fmt.currency(agg7d?.revenue)}                   delta={revDelta}             icon={BarChart3}   iconColor="text-purple-400" />
        <KpiCard label="Purchases"    value={fmt.number(agg7d?.purchases)} sub={agg7d?.aov ? `AOV ${fmt.currency(agg7d.aov)}` : undefined} icon={ShieldCheck} iconColor="text-sky-400" />
        <KpiCard label="CPM"          value={agg7d?.cpm ? fmt.currency(agg7d.cpm) : '—'}    icon={Activity}             iconColor="text-pink-400" />
        <KpiCard label="Active Ads"   value={enrichedRows.length} sub={`${decisionData.find(d => d.name === 'Scale Hard')?.value || 0} Scale Hard`} icon={Zap} iconColor="text-brand-400" />
        <KpiCard label="CTR"          value={agg7d?.ctr ? `${safeNum(agg7d.ctr).toFixed(2)}%` : '—'} icon={ArrowUpRight} iconColor="text-teal-400" />
      </div>

      {/* Intelligence Summary */}
      {intel && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Portfolio Momentum</div>
            <div className="text-xl font-bold text-white mb-2">{intel.avgMomentum > 0 ? '+' : ''}{intel.avgMomentum}</div>
            <MomentumBar score={intel.avgMomentum} />
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Avg Fatigue Score</div>
            <div className={clsx('text-xl font-bold mb-1', intel.avgFatigue >= 60 ? 'text-red-400' : intel.avgFatigue >= 40 ? 'text-amber-400' : 'text-emerald-400')}>
              {intel.avgFatigue}/100
            </div>
            <div className="text-[11px] text-slate-500">{intel.highFatigue} ads in danger zone (&gt;70)</div>
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Surging Ads</div>
            <div className="text-xl font-bold text-emerald-400 mb-1">{intel.surging}</div>
            <div className="text-[11px] text-slate-500">Momentum score ≥ 60</div>
          </div>
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Primary Funnel Leak</div>
            <div className={clsx('text-xl font-bold mb-1', funnelDiag?.topStage !== 'None' ? 'text-amber-400' : 'text-emerald-400')}>
              {funnelDiag?.topStage || 'None'}
            </div>
            <div className="text-[11px] text-slate-500">
              {funnelDiag?.breakdown?.find(b => b.stage === funnelDiag.topStage)?.pct || 0}% of ads leaking here
            </div>
          </div>
        </div>
      )}

      {/* Top Ads + Decision Pie */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={15} className="text-amber-400" />
            <span className="text-sm font-semibold text-white">Top 6 Ads by ROAS</span>
            <span className="text-[10px] text-slate-500 ml-auto">Min ₹500 spend · 7D</span>
          </div>
          <div className="space-y-2">
            {topAds.length === 0
              ? <div className="text-sm text-slate-500 py-4 text-center">No ads with ≥₹500 spend</div>
              : topAds.map((r, i) => {
                const momBand = MOMENTUM_BAND(r.momentumScore || 0);
                return (
                  <div key={r.adId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/40 hover:bg-gray-800/80 transition-colors">
                    <span className="text-[11px] font-bold text-slate-500 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-slate-200 truncate">{r.adName}</div>
                      <div className="text-[10px] text-slate-500 truncate">{r.collection || r.campaignName}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-bold text-emerald-400">{fmt.roas(r.metaRoas)}</div>
                      <div className="text-[10px] text-slate-500">{fmt.currency(r.spend)}</div>
                    </div>
                    <div className="w-16 shrink-0">
                      <div className="text-[9px] mb-0.5" style={{ color: momBand.color }}>{momBand.label}</div>
                      <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.momentumScore || 0) + 100) / 2}%`, background: momBand.color }} />
                      </div>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Zap size={14} className="text-brand-400" />
            Decision Mix
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={decisionData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value">
                {decisionData.map(({ name }) => <Cell key={name} fill={DECISION_COLORS[name] || '#64748b'} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-1 mt-2">
            {decisionData.map(({ name, value }) => (
              <div key={name} className="flex items-center gap-1.5 text-[10px]">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: DECISION_COLORS[name] || '#64748b' }} />
                <span className="text-slate-400 truncate">{name}</span>
                <span className="text-slate-500 ml-auto">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel + Collection ROAS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Target size={14} className="text-blue-400" />
            <span className="text-sm font-semibold text-white">Conversion Funnel</span>
            {funnelDiag?.topStage !== 'None' && (
              <span className="ml-auto text-[10px] text-amber-400 flex items-center gap-1">
                <AlertTriangle size={11} />Leak: {funnelDiag?.topStage}
              </span>
            )}
          </div>
          <div className="space-y-3">
            <FunnelBar label="Hook Rate"     rate={agg7d?.lpvRate}      color="#60a5fa" isLeak={funnelDiag?.topStage === 'LPV'} />
            <FunnelBar label="LPV → ATC"    rate={agg7d?.atcRate}      color="#a78bfa" isLeak={funnelDiag?.topStage === 'ATC'} />
            <FunnelBar label="ATC → Checkout" rate={agg7d ? safeNum(agg7d.ic > 0 ? (agg7d.atc > 0 ? agg7d.ic / agg7d.atc * 100 : 0) : 0) : 0} color="#f59e0b" />
            <FunnelBar label="IC → Purchase" rate={agg7d?.purchaseRate} color="#22c55e" isLeak={funnelDiag?.topStage === 'Purchase'} />
            <FunnelBar label="Overall Conv"  rate={agg7d?.convRate}     color="#06b6d4" />
          </div>
          {funnelDiag && (
            <div className="mt-4 pt-3 border-t border-gray-800/60">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Leak Distribution</div>
              <div className="grid grid-cols-3 gap-2">
                {funnelDiag.breakdown.filter(b => b.stage !== 'None').map(b => (
                  <div key={b.stage} className="text-center">
                    <div className="text-[13px] font-bold text-amber-400">{b.pct}%</div>
                    <div className="text-[10px] text-slate-500">{b.stage}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={14} className="text-purple-400" />
            <span className="text-sm font-semibold text-white">Collection ROAS</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={collectionData.slice(0, 7)} margin={{ left: -20, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={v => [`${safeNum(v).toFixed(2)}x`, 'ROAS']} />
              <Bar dataKey="roas" radius={[4, 4, 0, 0]}>
                {collectionData.slice(0, 7).map((entry, i) => (
                  <Cell key={i} fill={entry.roas >= 4 ? '#22c55e' : entry.roas >= 3 ? '#60a5fa' : entry.roas >= 2 ? '#f59e0b' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Hook × Hold Scatter */}
      {hookHold.length > 2 && (
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Flame size={14} className="text-orange-400" />
            <span className="text-sm font-semibold text-white">Hook × Hold Creative Map</span>
            <span className="text-[10px] text-slate-500 ml-auto">Top-right quadrant = best creatives</span>
          </div>
          <div className="text-[10px] text-slate-500 mb-3">Hook Rate (X axis) vs Hold Rate (Y axis) — green = ROAS ≥4x</div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ left: -10, right: 20, top: 10, bottom: 10 }}>
              <XAxis type="number" dataKey="hookRate" name="Hook Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis type="number" dataKey="holdRate" name="Hold Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs max-w-[200px]">
                      <div className="font-semibold text-white mb-1 truncate">{d.adName}</div>
                      <div className="text-slate-400">Hook: {d.hookRate}% · Hold: {d.holdRate}%</div>
                      <div className="text-slate-400">ROAS: {fmt.roas(d.roas)} · {fmt.currency(d.spend)}</div>
                    </div>
                  );
                }}
              />
              <Scatter data={hookHold.slice(0, 60)}>
                {hookHold.slice(0, 60).map((entry, i) => (
                  <Cell key={i} fill={entry.roas >= 4 ? '#22c55e' : entry.roas >= 2.5 ? '#60a5fa' : '#f87171'} opacity={0.8} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> ROAS ≥4x</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" /> 2.5–4x</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" /> &lt;2.5x</span>
          </div>
        </div>
      )}

      {/* Worst Ads + Offer Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Skull size={15} className="text-red-400" />
            <span className="text-sm font-semibold text-white">Lowest ROAS (Active Spend)</span>
          </div>
          <div className="space-y-2">
            {worstAds.map(r => (
              <div key={r.adId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/40">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-slate-300 truncate">{r.adName}</div>
                  <div className="text-[10px] text-slate-500">{r.collection || r.campaignName} · Fatigue {r.fatigueScore ?? 0}/100</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-bold text-red-400">{fmt.roas(r.metaRoas)}</div>
                  <div className="text-[10px] text-slate-500">{fmt.currency(r.spend)}</div>
                </div>
                <div className="w-16 px-2 py-0.5 rounded text-center text-[10px] font-semibold"
                  style={{ background: (DECISION_COLORS[r.decision] || '#64748b') + '20', color: DECISION_COLORS[r.decision] || '#94a3b8' }}>
                  {r.decision}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={15} className="text-teal-400" />
            <span className="text-sm font-semibold text-white">Collection × Offer ROAS</span>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {offerMatrix.length === 0
              ? <div className="text-sm text-slate-500 py-4 text-center">Tag offer types in Study Manual to see this matrix.</div>
              : offerMatrix.slice(0, 10).map((row, i) => (
                <div key={i} className="flex items-center gap-3 text-[12px]">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300 font-medium">{row.collection}</span>
                    <span className="text-slate-500 mx-1.5">×</span>
                    <span className="text-slate-400">{row.offerType}</span>
                  </div>
                  <div className={clsx('px-2 py-0.5 rounded text-[11px] font-bold shrink-0',
                    row.roas >= 4 ? 'bg-emerald-500/20 text-emerald-400'
                    : row.roas >= 3 ? 'bg-blue-500/20 text-blue-400'
                    : row.roas >= 2 ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-red-500/20 text-red-400'
                  )}>
                    {safeNum(row.roas).toFixed(2)}x
                  </div>
                  <span className="text-slate-600 text-[10px] shrink-0">{fmt.currency(row.spend)}</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* Account Breakdown */}
      {accountData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-3">Account Performance</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-gray-800/60">
                  {['Account','Spend','ROAS','CPR','Purchases','Revenue','Ads'].map(h => (
                    <th key={h} className={clsx('py-2 px-3', h === 'Account' ? 'text-left pr-4' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accountData.map(row => (
                  <tr key={row.label} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                    <td className="py-2 pr-4 font-medium text-slate-200">{row.label}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(row.spend)}</td>
                    <td className={clsx('py-2 px-3 text-right font-bold',
                      row.roas >= 4 ? 'text-emerald-400' : row.roas >= 3 ? 'text-blue-400' : row.roas >= 2 ? 'text-amber-400' : 'text-red-400')}>
                      {fmt.roas(row.roas)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(row.cpr)}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{fmt.number(row.purchases)}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{fmt.currency(row.revenue)}</td>
                    <td className="py-2 px-3 text-right text-slate-500">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
