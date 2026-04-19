import { useMemo } from 'react';
import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, Zap, Target, ShieldCheck,
  Activity, DollarSign, Package, BarChart3, ArrowUpRight, ArrowDownRight,
  Minus, Flame, Skull, Trophy, Info, ShoppingCart, Users, Heart,
  Megaphone, Crown, UserPlus, Calendar, Layers, Gauge,
} from 'lucide-react';
import clsx from 'clsx';
import { safeNum, fmt, aggregateMetrics, buildPatternSummary } from '../lib/analytics';
import {
  buildAlerts, buildHookHoldMatrix,
  buildFunnelLeakDiagnosis,
} from '../lib/metaIntelligence';
import {
  buildPlanVsActual, buildWeeklyBreakdown,
  DEFAULT_PLAN, GENERIC_PLAN,
} from '../lib/businessPlanAnalytics';
import { computeRfm } from '../lib/shopifyAnalytics';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';

/* ─── HELPERS ───────────────────────────────────────────────────── */

const DECISION_COLORS = {
  'Scale Hard': '#22c55e', 'Scale Carefully': '#86efac',
  'Defend': '#a78bfa', 'Fix': '#f59e0b',
  'Watch': '#60a5fa', 'Kill': '#f87171', 'Pause': '#94a3b8',
};

const CHANNEL_COLORS = { Meta: '#60a5fa', 'Google Ads': '#f59e0b', Organic: '#22c55e' };

const SEVERITY_STYLES = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-400',
  high:     'bg-amber-500/10 border-amber-500/30 text-amber-400',
  medium:   'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
};

const SEVERITY_ICON = { critical: Skull, high: AlertTriangle, medium: Activity };

const ALERT_ROUTES = {
  fatigue:     '/creative-intel',
  opportunity: '/scale',
  stockout:    '/sku',
  waste:       '/kill',
  worsening:   '/fix',
  goal_miss:   '/business-plan',
  revenue_risk:'/sku',
};

const deltaColor = v => v > 5 ? 'text-emerald-400' : v < -5 ? 'text-red-400' : 'text-slate-400';
const deltaIcon  = v => v > 5 ? ArrowUpRight : v < -5 ? ArrowDownRight : Minus;

const MOMENTUM_BAND = score => {
  if (score >= 60)  return { label: 'Surging',   color: '#22c55e' };
  if (score >= 30)  return { label: 'Improving', color: '#86efac' };
  if (score >= -15) return { label: 'Stable',    color: '#60a5fa' };
  if (score >= -40) return { label: 'Softening', color: '#f59e0b' };
  return               { label: 'Declining',  color: '#f87171' };
};

/* ─── PLAN LOADER (reads the same localStorage the BusinessPlan page writes) ── */

const lsPlanKey = id => `taos_bplan_v7_${id || 'default'}`;
function readPlan(brandId, brandName) {
  let stored = null;
  try { const r = localStorage.getItem(lsPlanKey(brandId)); stored = r ? JSON.parse(r) : null; } catch {}
  const isTaos = !brandName || brandName.toLowerCase().includes('taos');
  const seed = isTaos ? DEFAULT_PLAN : GENERIC_PLAN;
  if (!stored) return { ...seed };
  return {
    ...seed,
    ...stored,
    months: seed.months.map((dm, i) => ({ ...dm, ...(stored.months?.[i] || {}) })),
  };
}

/* ─── DATE HELPERS ─────────────────────────────────────────────── */

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* ─── PERIOD LABEL ───────────────────────────────────────────────── */

function usePeriodLabel(rows) {
  return useMemo(() => {
    if (!rows?.length) return null;
    const starts = rows.map(r => r.dateStart).filter(Boolean).sort();
    const stops  = rows.map(r => r.dateStop).filter(Boolean).sort();
    if (!starts.length) return { label: '7D' };
    const fmtDate = d => {
      try { return new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }); }
      catch { return d; }
    };
    return { label: '7D', start: fmtDate(starts[0]), stop: fmtDate(stops[stops.length - 1]) };
  }, [rows]);
}

function PeriodBadge({ period }) {
  if (!period) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-gray-800/80 border border-gray-700/60 px-2 py-0.5 rounded-md">
      <Activity size={9} />
      {period.start && period.stop ? `${period.start} – ${period.stop}` : 'Last 7 Days'}
    </span>
  );
}

/* ─── KPI CARD ───────────────────────────────────────────────────── */

function KpiCard({ label, value, sub, delta, icon: Icon, iconColor = 'text-brand-400', onClick, deltaSuffix }) {
  const DIcon = deltaIcon(delta ?? 0);
  return (
    <div
      className={clsx('bg-gray-900 border border-gray-800/60 rounded-xl p-4 flex flex-col gap-2', onClick && 'cursor-pointer hover:border-gray-700 transition-colors')}
      onClick={onClick}
    >
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
              {Math.abs(delta).toFixed(1)}%{deltaSuffix ? ` ${deltaSuffix}` : ' vs 30D'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── PROGRESS BAR (for Plan vs Actual) ─────────────────────────── */

function ProgressBar({ pct, status }) {
  const cap = Math.min(120, Math.max(0, pct));
  const color = status === 'on-track' ? '#22c55e'
              : status === 'behind'    ? '#f59e0b'
              : status === 'missed'    ? '#ef4444'
              : status === 'critical'  ? '#f87171'
              : '#64748b';
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${(cap / 120) * 100}%`, background: color }} />
    </div>
  );
}

/* ─── ALERT STRIP ────────────────────────────────────────────────── */

function AlertStrip({ alerts, navigate }) {
  if (!alerts?.length) return null;
  return (
    <div className="flex flex-col gap-2 mb-6">
      {alerts.slice(0, 6).map((a, i) => {
        const SevIcon = SEVERITY_ICON[a.severity] || AlertTriangle;
        const route   = a.route || ALERT_ROUTES[a.type];
        return (
          <div
            key={i}
            className={clsx(
              'flex items-start gap-3 px-4 py-3 rounded-lg border text-sm transition-opacity',
              SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.medium,
              route && 'cursor-pointer hover:opacity-80',
            )}
            onClick={() => route && navigate(route)}
          >
            <SevIcon size={15} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{a.title}</span>
              {a.detail && <span className="ml-2 opacity-70 truncate">{a.detail}</span>}
            </div>
            <span className="text-[10px] uppercase tracking-wider opacity-60 shrink-0">{a.severity}</span>
            {route && <ArrowUpRight size={13} className="mt-0.5 shrink-0 opacity-40" />}
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

/* ─── FUNNEL BAR ─────────────────────────────────────────────────── */
// Note: Meta's action attribution window (7d-click + 1d-view) means view-through
// conversions are counted. Rates > 100% are correct — they reflect Meta's attribution.

function FunnelBar({ label, rate, color, isLeak }) {
  const raw = safeNum(rate);
  const pct = Math.min(100, raw);
  const isOver100 = raw > 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <span className="text-[11px] text-slate-400">{label}</span>
        {isOver100 && (
          <span className="ml-1 text-[9px] text-slate-600" title="View-through attribution.">(attr.)</span>
        )}
      </div>
      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', isLeak && 'opacity-60')} style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="w-16 text-right shrink-0">
        <span className={clsx('text-[11px] font-semibold', isLeak ? 'text-red-400' : isOver100 ? 'text-sky-400' : 'text-slate-300')}>
          {raw.toFixed(1)}%
        </span>
        {isLeak && <span className="text-red-400 ml-0.5">⚠</span>}
      </div>
    </div>
  );
}

/* ─── SECTION TITLE ──────────────────────────────────────────────── */

function SectionTitle({ icon: Icon, title, sub, color = 'text-brand-400' }) {
  return (
    <div className="flex items-end gap-2 mb-3">
      <Icon size={14} className={color} />
      <span className="text-[13px] font-semibold text-white uppercase tracking-wider">{title}</span>
      {sub && <span className="text-[11px] text-slate-500 mb-[1px]">· {sub}</span>}
    </div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────────── */

export default function Overview() {
  const navigate = useNavigate();
  const {
    enrichedRows, shopifyOrders, inventoryMap,
    brandData, activeBrandIds, brands, customerCache,
  } = useStore();

  const period7d = usePeriodLabel(enrichedRows);

  /* ── Meta aggregates ── */
  const agg7d = useMemo(() => aggregateMetrics(enrichedRows), [enrichedRows]);

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

  /* ── Meta spend today (from insightsToday across active brands) ── */
  const metaToday = useMemo(() => {
    let spend = 0, revenue = 0, purchases = 0;
    brands.filter(b => activeBrandIds.includes(b.id)).forEach(b => {
      const d = brandData[b.id];
      if (!d?.insightsToday) return;
      d.insightsToday.forEach(r => {
        spend     += safeNum(r.spend);
        revenue   += safeNum(r.revenue);
        purchases += safeNum(r.purchases);
      });
    });
    return { spend, revenue, purchases, roas: spend > 0 ? revenue / spend : 0 };
  }, [brandData, activeBrandIds, brands]);

  /* ── Google Ads totals (from normalized data, usually last-pull window) ── */
  const gadsTotals = useMemo(() => {
    const active = brands.filter(b => activeBrandIds.includes(b.id));
    return active.reduce((acc, b) => {
      const d = brandData[b.id]?.googleAdsData;
      if (!d) return acc;
      const t = totalsFromNormalized(d);
      acc.spend       += t.spend;
      acc.revenue     += t.conversionValue;
      acc.conversions += t.conversions;
      acc.clicks      += t.clicks;
      return acc;
    }, { spend: 0, revenue: 0, conversions: 0, clicks: 0 });
  }, [brandData, activeBrandIds, brands]);

  /* ── Shopify order slices ── */
  const today = todayISO();
  const d7    = daysAgoISO(7);
  const d30   = daysAgoISO(30);
  const d14   = daysAgoISO(14);

  const shopifyTodayOrders = useMemo(() =>
    shopifyOrders.filter(o => (o.created_at || '').slice(0, 10) === today && !o.cancelled_at),
    [shopifyOrders, today]);

  const shopify7dOrders = useMemo(() =>
    shopifyOrders.filter(o => (o.created_at || '').slice(0, 10) >= d7 && !o.cancelled_at),
    [shopifyOrders, d7]);

  const shopify14dOrders = useMemo(() =>
    shopifyOrders.filter(o => {
      const d = (o.created_at || '').slice(0, 10);
      return d >= d14 && d < d7 && !o.cancelled_at;
    }),
    [shopifyOrders, d14, d7]);

  const shopify30dOrders = useMemo(() =>
    shopifyOrders.filter(o => (o.created_at || '').slice(0, 10) >= d30 && !o.cancelled_at),
    [shopifyOrders, d30]);

  const sumRev = orders => orders.reduce((s, o) => s + safeNum(o.total_price), 0);
  const shopifyTodayRev = sumRev(shopifyTodayOrders);
  const shopify7dRev    = sumRev(shopify7dOrders);
  const shopifyPrev7dRev = sumRev(shopify14dOrders);
  const shopify30dRev   = sumRev(shopify30dOrders);
  const aov7d = shopify7dOrders.length ? shopify7dRev / shopify7dOrders.length : 0;

  /* ── Blended (7d) ── */
  const totalAdSpend7d = safeNum(agg7d?.spend) + safeNum(gadsTotals.spend);
  const blendedRoas    = totalAdSpend7d > 0 ? shopify7dRev / totalAdSpend7d : 0;

  const newCustomers7d = useMemo(() => {
    const firstSeen = new Set();
    const pre = new Set();
    shopifyOrders.forEach(o => {
      const email = (o.email || o.customer?.email || '').toLowerCase().trim();
      if (!email) return;
      const d = (o.created_at || '').slice(0, 10);
      if (d < d7) pre.add(email);
      else firstSeen.add(email);
    });
    let count = 0;
    firstSeen.forEach(e => { if (!pre.has(e)) count++; });
    return count;
  }, [shopifyOrders, d7]);

  const blendedCac = newCustomers7d > 0 ? totalAdSpend7d / newCustomers7d : 0;

  /* ── Channel mix (Meta + GAds attributed vs Organic) ── */
  const metaAttribRev = safeNum(agg7d?.revenue);
  const gadsAttribRev = safeNum(gadsTotals.revenue);
  const attribRev = metaAttribRev + gadsAttribRev;
  const organicRev = Math.max(0, shopify7dRev - attribRev);

  const channelMix = [
    { name: 'Meta',       value: metaAttribRev },
    { name: 'Google Ads', value: gadsAttribRev },
    { name: 'Organic',    value: organicRev    },
  ].filter(c => c.value > 0);

  /* ── Business Plan context (use first active brand) ── */
  const primaryBrand = useMemo(() => {
    const id = activeBrandIds[0];
    return brands.find(b => b.id === id) || null;
  }, [brands, activeBrandIds]);

  const plan = useMemo(() =>
    primaryBrand ? readPlan(primaryBrand.id, primaryBrand.name) : readPlan(null, null),
    [primaryBrand]);

  const pva = useMemo(() => buildPlanVsActual(plan, shopifyOrders), [plan, shopifyOrders]);

  const currentMonthPva = useMemo(() =>
    pva.find(m => m.isCurrentMonth) || null, [pva]);

  const weekly = useMemo(() =>
    currentMonthPva ? buildWeeklyBreakdown(currentMonthPva, shopifyOrders) : [],
    [currentMonthPva, shopifyOrders]);

  const currentWeek = useMemo(() => {
    if (!weekly.length) return null;
    const dayOfMonth = new Date().getDate();
    return weekly.find(w => {
      const [s, e] = w.dateRange.split('–').map(Number);
      return dayOfMonth >= s && dayOfMonth <= e;
    }) || weekly[weekly.length - 1];
  }, [weekly]);

  /* ── Customer Health (RFM) ── */
  const rfmSegments = useMemo(() => {
    const rfm = computeRfm(shopify30dOrders.length ? shopifyOrders : [], customerCache || {});
    const counts = {};
    rfm.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    const totalCustomers = rfm.length;
    const champions = counts['Champions'] || 0;
    const loyal     = counts['Loyal'] || 0;
    const atRisk    = counts['At Risk'] || 0;
    const cantLose  = counts["Can't Lose"] || 0;
    const newCust   = counts['New'] || 0;
    const dormant   = counts['Dormant'] || 0;
    // Repeat rate from 30d orders
    const emails30d = {};
    shopify30dOrders.forEach(o => {
      const e = (o.email || o.customer?.email || '').toLowerCase().trim();
      if (!e) return;
      emails30d[e] = (emails30d[e] || 0) + 1;
    });
    const buyers30 = Object.keys(emails30d).length;
    const repeat30 = Object.values(emails30d).filter(n => n > 1).length;
    const repeatRate = buyers30 > 0 ? (repeat30 / buyers30) * 100 : 0;
    return { counts, totalCustomers, champions, loyal, atRisk, cantLose, newCust, dormant, repeatRate };
  }, [shopifyOrders, shopify30dOrders, customerCache]);

  /* ── Intelligence & alerts ── */
  const metaAlerts  = useMemo(() => buildAlerts(enrichedRows, inventoryMap, shopifyOrders), [enrichedRows, inventoryMap, shopifyOrders]);

  const alerts = useMemo(() => {
    const out = [...metaAlerts];
    // Goal-miss alert: current month on-track projection vs plan
    if (currentMonthPva && currentMonthPva.projPct < 80 && currentMonthPva.daysElapsed >= 5) {
      out.unshift({
        type: 'goal_miss',
        severity: currentMonthPva.projPct < 60 ? 'critical' : 'high',
        title: `${currentMonthPva.label}: on pace for ${currentMonthPva.projPct.toFixed(0)}% of plan`,
        detail: `${fmt.currency(currentMonthPva.projectedRevenue)} projected vs ${fmt.currency(currentMonthPva.planRevenue)} target · review Business Plan`,
      });
    }
    // Revenue-at-risk from stockouts (top velocity SKUs with OOS)
    const oosVelocity = Object.values(inventoryMap || {}).filter(inv =>
      (inv._totalStock || 0) === 0
    );
    if (oosVelocity.length > 0) {
      // cheap check: if more than 3 OOS, flag
      const oosCount = oosVelocity.length;
      if (oosCount >= 3 && !out.some(a => a.type === 'stockout')) {
        out.push({
          type: 'revenue_risk',
          severity: 'high',
          title: `${oosCount} SKUs out of stock`,
          detail: 'Active revenue risk — review SKU Intelligence',
        });
      }
    }
    return out;
  }, [metaAlerts, currentMonthPva, inventoryMap]);

  const hookHold    = useMemo(() => buildHookHoldMatrix(enrichedRows), [enrichedRows]);
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
  const revDelta   = agg7d && agg30d ? pctDelta(agg7d.revenue,  agg30d.revenue) : null;
  const shopifyWoWDelta = shopifyPrev7dRev > 0 ? ((shopify7dRev - shopifyPrev7dRev) / shopifyPrev7dRev) * 100 : null;

  const atcToIcRate = agg7d && agg7d.atc > 0 ? (safeNum(agg7d.ic) / safeNum(agg7d.atc)) * 100 : 0;

  const hasMetaData    = enrichedRows.length > 0;
  const hasShopifyData = shopifyOrders.length > 0;
  const hasAnyData     = hasMetaData || hasShopifyData;

  if (!hasAnyData) {
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

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Overview</h1>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {activeBrandIds.length} brand{activeBrandIds.length === 1 ? '' : 's'} · Shopify + Meta + Plan context
            {primaryBrand && <span className="ml-1">· Plan: {primaryBrand.name}</span>}
          </div>
        </div>
        <PeriodBadge period={period7d} />
      </div>

      {/* Alert Strip */}
      <AlertStrip alerts={alerts} navigate={navigate} />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 1 — TODAY'S PULSE                                         */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {(hasShopifyData || hasMetaData) && (
        <div>
          <SectionTitle icon={Gauge} title="Today's Pulse" sub={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} color="text-emerald-400" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard
              label="Orders Today"
              value={fmt.number(shopifyTodayOrders.length)}
              sub={shopifyTodayRev > 0 ? fmt.currency(shopifyTodayRev) : 'No orders yet'}
              icon={ShoppingCart}
              iconColor="text-emerald-400"
              onClick={() => navigate('/shopify-insights')}
            />
            <KpiCard
              label="Revenue Today"
              value={fmt.currency(shopifyTodayRev)}
              sub={currentMonthPva ? `${fmt.currency((currentMonthPva.planRevenue || 0) / currentMonthPva.days)} daily target` : undefined}
              icon={DollarSign}
              iconColor="text-emerald-400"
              onClick={() => navigate('/breakdowns')}
            />
            <KpiCard
              label="Meta Spend Today"
              value={fmt.currency(metaToday.spend)}
              sub={metaToday.roas > 0 ? `${fmt.roas(metaToday.roas)} Meta ROAS` : '—'}
              icon={Megaphone}
              iconColor="text-blue-400"
              onClick={() => navigate('/decisions')}
            />
            <KpiCard
              label="Blended ROAS (7D)"
              value={blendedRoas > 0 ? fmt.roas(blendedRoas) : '—'}
              sub={totalAdSpend7d > 0 ? `Spend ${fmt.currency(totalAdSpend7d)}` : 'No ad spend'}
              icon={TrendingUp}
              iconColor={blendedRoas >= 3 ? 'text-emerald-400' : blendedRoas >= 2 ? 'text-amber-400' : 'text-red-400'}
              onClick={() => navigate('/scorecard')}
            />
            <KpiCard
              label="7D Revenue"
              value={fmt.currency(shopify7dRev)}
              sub={`${fmt.number(shopify7dOrders.length)} orders · AOV ${fmt.currency(aov7d)}`}
              delta={shopifyWoWDelta}
              deltaSuffix="WoW"
              icon={BarChart3}
              iconColor="text-purple-400"
              onClick={() => navigate('/shopify-insights')}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 2 — PLAN vs ACTUAL                                        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {currentMonthPva && (
        <div>
          <SectionTitle
            icon={Target}
            title="Plan vs Actual"
            sub={`${currentMonthPva.label} · ${currentMonthPva.daysElapsed}/${currentMonthPva.days} days elapsed`}
            color="text-amber-400"
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Monthly revenue progress */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/business-plan')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Monthly Revenue</span>
                <Calendar size={13} className="text-amber-400" />
              </div>
              <div className="text-xl font-bold text-white">{fmt.currency(currentMonthPva.actualRevenue)}</div>
              <div className="text-[10px] text-slate-500 mb-1.5">of {fmt.currency(currentMonthPva.planRevenue)} · {currentMonthPva.pct.toFixed(0)}%</div>
              <ProgressBar pct={currentMonthPva.pct} status={currentMonthPva.status} />
              <div className="text-[10px] text-slate-500 mt-2">
                Projected: {fmt.currency(currentMonthPva.projectedRevenue)} ({currentMonthPva.projPct.toFixed(0)}%)
              </div>
            </div>

            {/* Weekly orders progress */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/business-plan')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">This Week Orders</span>
                <Layers size={13} className="text-sky-400" />
              </div>
              <div className="text-xl font-bold text-white">{fmt.number(currentWeek?.actualOrders || 0)}</div>
              <div className="text-[10px] text-slate-500 mb-1.5">
                of {fmt.number(currentWeek?.targetOrders || 0)} target · {(currentWeek?.pct || 0).toFixed(0)}%
              </div>
              <ProgressBar pct={currentWeek?.pct || 0} status={(currentWeek?.pct || 0) >= 95 ? 'on-track' : (currentWeek?.pct || 0) >= 75 ? 'behind' : 'critical'} />
              <div className="text-[10px] text-slate-500 mt-2">
                Week rev {fmt.currency(currentWeek?.actualRevenue || 0)} of {fmt.currency(currentWeek?.targetRevenue || 0)}
              </div>
            </div>

            {/* AOV vs target */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/shopify-insights')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">AOV vs Plan</span>
                <DollarSign size={13} className="text-purple-400" />
              </div>
              <div className={clsx('text-xl font-bold', aov7d >= currentMonthPva.aov ? 'text-emerald-400' : 'text-amber-400')}>
                {fmt.currency(aov7d)}
              </div>
              <div className="text-[10px] text-slate-500 mb-1.5">target {fmt.currency(currentMonthPva.aov)}</div>
              <ProgressBar pct={currentMonthPva.aov > 0 ? (aov7d / currentMonthPva.aov) * 100 : 0} status={aov7d >= currentMonthPva.aov ? 'on-track' : 'behind'} />
              <div className="text-[10px] text-slate-500 mt-2">
                Gap: {aov7d >= currentMonthPva.aov ? '+' : ''}{fmt.currency(aov7d - currentMonthPva.aov)}
              </div>
            </div>

            {/* Ad budget burn */}
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/decisions')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Ad Budget (Week)</span>
                <Megaphone size={13} className="text-blue-400" />
              </div>
              {(() => {
                const weekSpend7d = safeNum(agg7d?.spend) + safeNum(gadsTotals.spend);
                const targetBudget = currentWeek?.targetBudget || 0;
                const pct = targetBudget > 0 ? (weekSpend7d / targetBudget) * 100 : 0;
                return (
                  <>
                    <div className="text-xl font-bold text-white">{fmt.currency(weekSpend7d)}</div>
                    <div className="text-[10px] text-slate-500 mb-1.5">of {fmt.currency(targetBudget)} · {pct.toFixed(0)}%</div>
                    <ProgressBar pct={pct} status={pct >= 85 && pct <= 115 ? 'on-track' : pct < 70 ? 'critical' : 'behind'} />
                    <div className="text-[10px] text-slate-500 mt-2">
                      Meta {fmt.currency(agg7d?.spend || 0)} · GAds {fmt.currency(gadsTotals.spend)}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 3 — BLENDED PERFORMANCE (Meta + Shopify + GAds)            */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {(hasMetaData || hasShopifyData) && (
        <div>
          <SectionTitle icon={TrendingUp} title="Blended Performance" sub="Last 7 days · all channels" color="text-brand-400" />
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <KpiCard label="Total Revenue"  value={fmt.currency(shopify7dRev)} sub={`${fmt.number(shopify7dOrders.length)} orders`} delta={shopifyWoWDelta} deltaSuffix="WoW" icon={BarChart3} iconColor="text-purple-400" onClick={() => navigate('/shopify-insights')} />
            <KpiCard label="Meta Spend"     value={fmt.currency(agg7d?.spend)} delta={spendDelta} icon={DollarSign} iconColor="text-amber-400" onClick={() => navigate('/decisions')} />
            <KpiCard label="Meta ROAS"      value={agg7d?.roas ? fmt.roas(agg7d.roas) : '—'} delta={roasDelta} icon={TrendingUp} iconColor="text-emerald-400" onClick={() => navigate('/scorecard')} />
            <KpiCard label="Meta Revenue"   value={fmt.currency(agg7d?.revenue)} delta={revDelta} icon={Megaphone} iconColor="text-blue-400" onClick={() => navigate('/breakdowns')} />
            <KpiCard label="GAds Spend"     value={gadsTotals.spend > 0 ? fmt.currency(gadsTotals.spend) : '—'} sub={gadsTotals.spend > 0 ? `${fmt.number(gadsTotals.conversions)} conv` : 'not pulled'} icon={Target} iconColor="text-amber-400" onClick={() => navigate('/google-ads')} />
            <KpiCard label="GAds ROAS"      value={gadsTotals.spend > 0 ? fmt.roas(gadsTotals.revenue / gadsTotals.spend) : '—'} sub={gadsTotals.revenue > 0 ? fmt.currency(gadsTotals.revenue) : undefined} icon={TrendingUp} iconColor="text-emerald-400" onClick={() => navigate('/google-ads')} />
            <KpiCard label="Blended CAC"    value={blendedCac > 0 ? fmt.currency(blendedCac) : '—'} sub={`${fmt.number(newCustomers7d)} new customers`} icon={UserPlus} iconColor="text-sky-400" onClick={() => navigate('/segments')} />
            <KpiCard label="Organic Rev"    value={fmt.currency(organicRev)} sub={shopify7dRev > 0 ? `${((organicRev / shopify7dRev) * 100).toFixed(0)}% of rev` : undefined} icon={ShieldCheck} iconColor="text-emerald-400" onClick={() => navigate('/shopify-insights')} />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 4 — CUSTOMER HEALTH (RFM)                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {hasShopifyData && rfmSegments.totalCustomers > 0 && (
        <div>
          <SectionTitle
            icon={Heart}
            title="Customer Health"
            sub={`${fmt.number(rfmSegments.totalCustomers)} customers · RFM segmentation`}
            color="text-pink-400"
          />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/segments')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Champions</span>
                <Crown size={13} className="text-yellow-400" />
              </div>
              <div className="text-xl font-bold text-yellow-400">{fmt.number(rfmSegments.champions)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                + {fmt.number(rfmSegments.loyal)} Loyal · high LTV
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/segments')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">At Risk</span>
                <AlertTriangle size={13} className="text-red-400" />
              </div>
              <div className="text-xl font-bold text-red-400">{fmt.number(rfmSegments.atRisk + rfmSegments.cantLose)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                {fmt.number(rfmSegments.cantLose)} Can't Lose · win back now
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/segments')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">New (30D)</span>
                <UserPlus size={13} className="text-sky-400" />
              </div>
              <div className="text-xl font-bold text-sky-400">{fmt.number(rfmSegments.newCust)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                {fmt.number(newCustomers7d)} joined in last 7d
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/segments')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Repeat Rate (30D)</span>
                <Users size={13} className="text-emerald-400" />
              </div>
              <div className={clsx('text-xl font-bold', rfmSegments.repeatRate >= 25 ? 'text-emerald-400' : rfmSegments.repeatRate >= 15 ? 'text-amber-400' : 'text-red-400')}>
                {rfmSegments.repeatRate.toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                of 30d buyers returned
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/segments')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Dormant</span>
                <Minus size={13} className="text-slate-500" />
              </div>
              <div className="text-xl font-bold text-slate-400">{fmt.number(rfmSegments.dormant)}</div>
              <div className="text-[10px] text-slate-500 mt-1">
                reactivation list · email now
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 5 — CREATIVE INTELLIGENCE (Meta)                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {intel && (
        <div>
          <SectionTitle icon={Zap} title="Creative Intelligence" sub="7-day Meta portfolio health" color="text-brand-400" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/momentum')}>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Portfolio Momentum</div>
              <div className="text-xl font-bold text-white mb-2">{intel.avgMomentum > 0 ? '+' : ''}{intel.avgMomentum}</div>
              <MomentumBar score={intel.avgMomentum} />
            </div>
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/creative-intel')}>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Avg Fatigue</div>
              <div className={clsx('text-xl font-bold mb-1', intel.avgFatigue >= 60 ? 'text-red-400' : intel.avgFatigue >= 40 ? 'text-amber-400' : 'text-emerald-400')}>
                {intel.avgFatigue}/100
              </div>
              <div className="text-[11px] text-slate-500">{intel.highFatigue} ads in danger zone (&gt;70)</div>
            </div>
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/scale')}>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Surging Ads</div>
              <div className="text-xl font-bold text-emerald-400 mb-1">{intel.surging}</div>
              <div className="text-[11px] text-slate-500">Momentum ≥ 60 · tap to scale</div>
            </div>
            <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/decisions')}>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Primary Funnel Leak</div>
              <div className={clsx('text-xl font-bold mb-1', funnelDiag?.topStage !== 'None' ? 'text-amber-400' : 'text-emerald-400')}>
                {funnelDiag?.topStage || 'None'}
              </div>
              <div className="text-[11px] text-slate-500">
                {funnelDiag?.breakdown?.find(b => b.stage === funnelDiag.topStage)?.pct || 0}% of ads leaking here
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 6 — TOP ADS + DECISION MIX                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {hasMetaData && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={15} className="text-amber-400" />
              <span className="text-sm font-semibold text-white">Top 6 Ads by ROAS</span>
              <span className="text-[10px] text-slate-500 ml-auto">Min ₹500 spend</span>
              <PeriodBadge period={period7d} />
            </div>
            <div className="space-y-2">
              {topAds.length === 0
                ? <div className="text-sm text-slate-500 py-4 text-center">No ads with ≥₹500 spend</div>
                : topAds.map((r, i) => {
                  const momBand = MOMENTUM_BAND(r.momentumScore || 0);
                  return (
                    <div
                      key={r.adId}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/40 hover:bg-gray-800/80 transition-colors cursor-pointer"
                      onClick={() => navigate('/scale')}
                    >
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
            <div className="mt-3 pt-2 border-t border-gray-800/40">
              <button className="text-[11px] text-brand-400 hover:text-brand-300 transition-colors" onClick={() => navigate('/decisions')}>
                View all ads in Decision Queue →
              </button>
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
                <div
                  key={name}
                  className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:opacity-80"
                  onClick={() => {
                    const routes = { 'Scale Hard': '/scale', 'Scale Carefully': '/scale', 'Fix': '/fix', 'Defend': '/defend', 'Kill': '/kill' };
                    const r = routes[name];
                    if (r) navigate(r);
                  }}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: DECISION_COLORS[name] || '#64748b' }} />
                  <span className="text-slate-400 truncate">{name}</span>
                  <span className="text-slate-500 ml-auto">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 7 — FUNNEL + COLLECTION ROAS                              */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {hasMetaData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target size={14} className="text-blue-400" />
              <span className="text-sm font-semibold text-white">Conversion Funnel</span>
              <PeriodBadge period={period7d} />
              {funnelDiag?.topStage !== 'None' && (
                <span className="ml-auto text-[10px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={11} />Leak: {funnelDiag?.topStage}
                </span>
              )}
            </div>
            <div className="flex items-start gap-1.5 text-[10px] text-slate-600 mb-3 mt-1">
              <Info size={10} className="mt-0.5 shrink-0" />
              <span>Rates marked <span className="text-sky-700">(attr.)</span> may exceed 100% — Meta's view-through window attributes LPV/ATC to ad viewers.</span>
            </div>
            <div className="space-y-3">
              <FunnelBar label="Hook Rate"      rate={agg7d?.lpvRate}   color="#60a5fa" isLeak={funnelDiag?.topStage === 'LPV'} />
              <FunnelBar label="LPV → ATC"     rate={agg7d?.atcRate}   color="#a78bfa" isLeak={funnelDiag?.topStage === 'ATC'} />
              <FunnelBar label="ATC → Checkout" rate={atcToIcRate}      color="#f59e0b" />
              <FunnelBar label="IC → Purchase"  rate={agg7d?.purchaseRate} color="#22c55e" isLeak={funnelDiag?.topStage === 'Purchase'} />
              <FunnelBar label="Overall Conv"   rate={agg7d?.convRate}  color="#06b6d4" />
            </div>
            {funnelDiag && (
              <div className="mt-4 pt-3 border-t border-gray-800/60">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Leak Distribution</div>
                <div className="grid grid-cols-3 gap-2">
                  {funnelDiag.breakdown.filter(b => b.stage !== 'None').map(b => (
                    <div key={b.stage} className="text-center cursor-pointer hover:opacity-80" onClick={() => navigate('/decisions')}>
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
              <PeriodBadge period={period7d} />
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={collectionData.slice(0, 7)} margin={{ left: -20, right: 8 }}
                onClick={({ activePayload }) => activePayload?.length && navigate('/patterns')}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={v => [`${safeNum(v).toFixed(2)}x`, 'ROAS']} />
                <Bar dataKey="roas" radius={[4, 4, 0, 0]} cursor="pointer">
                  {collectionData.slice(0, 7).map((entry, i) => (
                    <Cell key={i} fill={entry.roas >= 4 ? '#22c55e' : entry.roas >= 3 ? '#60a5fa' : entry.roas >= 2 ? '#f59e0b' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 text-center">
              <button className="text-[11px] text-brand-400 hover:text-brand-300 transition-colors" onClick={() => navigate('/patterns')}>
                Full pattern analysis →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 8 — HOOK × HOLD SCATTER                                   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {hookHold.length > 2 && (
        <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors" onClick={() => navigate('/creative-intel')}>
          <div className="flex items-center gap-2 mb-1">
            <Flame size={14} className="text-orange-400" />
            <span className="text-sm font-semibold text-white">Hook × Hold Creative Map</span>
            <span className="text-[10px] text-slate-500 ml-auto">Top-right quadrant = best creatives · tap for full analysis</span>
          </div>
          <div className="text-[10px] text-slate-500 mb-3">Hook Rate (X) vs Hold Rate (Y) — both capped at 100% on chart</div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ left: -10, right: 20, top: 10, bottom: 10 }}>
              <XAxis type="number" dataKey="hookRate" name="Hook Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 100]} />
              <YAxis type="number" dataKey="holdRate" name="Hold Rate" unit="%" tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 100]} />
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
              <Scatter data={hookHold.slice(0, 60).map(h => ({ ...h, hookRate: Math.min(h.hookRate, 100) }))}>
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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ROW 9 — WORST ADS + CHANNEL MIX                               */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {hasMetaData && worstAds.length > 0 && (
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Skull size={15} className="text-red-400" />
              <span className="text-sm font-semibold text-white">Lowest ROAS (Active Spend)</span>
              <PeriodBadge period={period7d} />
            </div>
            <div className="space-y-2">
              {worstAds.map(r => (
                <div
                  key={r.adId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/40 hover:bg-gray-800/60 transition-colors cursor-pointer"
                  onClick={() => navigate(r.decision === 'Kill' ? '/kill' : r.decision === 'Fix' ? '/fix' : '/decisions')}
                >
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
            <div className="mt-3 pt-2 border-t border-gray-800/40">
              <button className="text-[11px] text-red-400 hover:text-red-300 transition-colors" onClick={() => navigate('/kill')}>
                View Kill Board →
              </button>
            </div>
          </div>
        )}

        {channelMix.length > 0 && (
          <div className="bg-gray-900 border border-gray-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Package size={15} className="text-teal-400" />
              <span className="text-sm font-semibold text-white">Revenue Channel Mix (7D)</span>
              <PeriodBadge period={period7d} />
            </div>
            <div className="grid grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={channelMix} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={2} dataKey="value">
                    {channelMix.map(c => <Cell key={c.name} fill={CHANNEL_COLORS[c.name] || '#64748b'} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} formatter={v => fmt.currency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2.5">
                {channelMix.map(c => {
                  const pct = shopify7dRev > 0 ? (c.value / shopify7dRev) * 100 : 0;
                  return (
                    <div key={c.name} className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: CHANNEL_COLORS[c.name] }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] font-semibold text-white">{c.name}</span>
                          <span className="text-[10px] text-slate-500">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="text-[11px] text-slate-400">{fmt.currency(c.value)}</div>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2 border-t border-gray-800/60 text-[10px] text-slate-500">
                  Total: {fmt.currency(shopify7dRev)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
