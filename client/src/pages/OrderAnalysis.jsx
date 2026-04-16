import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, ComposedChart, Area,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle,
  Info, Activity, Calendar, Clock, MapPin, Tag,
  ShoppingCart, CreditCard, Users, Package, Zap, ChevronDown,
  ChevronUp, ArrowDownRight, ArrowUpRight, Layers, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { fmt, safeNum } from '../lib/analytics';
import {
  getPeriodDates, filterByDate, getDataCoverage,
  aggregateOrdersFull, buildHourlyBreakdown, buildDailyTrend,
  buildSkuDeepDive, buildTrafficComparison, buildDiscountAnalysis,
  buildGeoComparison, buildPaymentComparison, buildOrderValueDistribution,
  aggregateInsightRows, buildAdComparison, computeDeepRootCauses,
  buildCollectionBreakdown, buildGaCrossAnalysis, buildAdStockoutImpact,
} from '../lib/periodAnalysis';

/* ─── constants ──────────────────────────────────────────────────────────── */
const PERIODS = [
  { id:'yesterday', label:'Yesterday' },
  { id:'today',     label:'Today' },
  { id:'7d',        label:'Last 7D' },
  { id:'14d',       label:'Last 14D' },
  { id:'30d',       label:'Last 30D' },
  { id:'custom',    label:'Custom' },
];

const COMP_MODES = [
  { id:'same_day_lw',    label:'vs Same Day Last Week' },
  { id:'day_before',     label:'vs Day Before' },
  { id:'prior_period',   label:'vs Prior Period' },
];

const TABS = [
  { id:'overview',     label:'Overview',       icon: Activity },
  { id:'time',         label:'Time',           icon: Clock },
  { id:'collections',  label:'Collections',    icon: Layers },
  { id:'products',     label:'Products',       icon: Package },
  { id:'traffic',      label:'Traffic',        icon: Zap },
  { id:'customers',    label:'Customers',      icon: Users },
  { id:'orders',       label:'Orders',         icon: ShoppingCart },
  { id:'ga',           label:'GA Insights',    icon: BarChart3 },
  { id:'diagnosis',    label:'Root Cause',     icon: AlertTriangle },
];

const SEV_COLORS = { high:'text-red-400', medium:'text-amber-400', low:'text-slate-400' };
const CAT_LABEL  = { meta:'Meta', creative:'Creative', funnel:'Funnel', shopify:'Shopify', traffic:'Traffic', inventory:'Inventory', structure:'Structure', ga:'GA4', collection:'Collection', 'collection':'Collection' };

/* ─── tiny helpers ───────────────────────────────────────────────────────── */
const p      = v => parseFloat(v || 0);
const fmtCur = n => `₹${Math.round(p(n)).toLocaleString('en-IN')}`;
const fmtNum = n => Math.round(p(n)).toLocaleString('en-IN');
const fmtPct = (n, sign=true) => `${sign&&n>=0?'+':''}${p(n).toFixed(1)}%`;
const fmtRoas= n => `${p(n).toFixed(2)}x`;

function deltaColor(v, invert=false) {
  const pos = invert ? v < 0 : v >= 0;
  return pos ? 'text-emerald-400' : 'text-red-400';
}

const Chip = ({ value, invert=false, suffix='%', size='sm' }) => {
  const v = p(value);
  const pos = invert ? v < 0 : v >= 0;
  return (
    <span className={clsx(
      'inline-flex items-center gap-0.5 font-semibold',
      size === 'lg' ? 'text-sm' : 'text-[11px]',
      pos ? 'text-emerald-400' : 'text-red-400',
    )}>
      {pos ? <ArrowUpRight size={size==='lg'?14:11}/> : <ArrowDownRight size={size==='lg'?14:11}/>}
      {v >= 0 ? '+' : ''}{v.toFixed(1)}{suffix}
    </span>
  );
};

const RTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[140px]">
      <div className="font-semibold text-slate-300 mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{background:p.color}} />
            <span className="text-slate-400">{p.name}</span>
          </span>
          <span className="text-white font-medium">
            {p.name.toLowerCase().includes('rev') ? fmtCur(p.value) : fmtNum(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ─── KPI card ───────────────────────────────────────────────────────────── */
const KPICard = ({ label, cur, prior, format=fmtNum, invert=false, subLabel, icon:Icon }) => {
  const v = p(cur), pv = p(prior);
  const pct = pv > 0 ? (v - pv) / pv * 100 : (v > 0 ? 100 : 0);
  const pos = invert ? pct < 0 : pct >= 0;
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-500">{label}</span>
        {Icon && <Icon size={13} className="text-slate-700" />}
      </div>
      <div className="text-2xl font-bold text-white leading-none">{format(cur)}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={clsx('text-[11px] font-semibold flex items-center gap-0.5', pos?'text-emerald-400':'text-red-400')}>
          {pos ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
          {pct>=0?'+':''}{pct.toFixed(1)}%
        </span>
        <span className="text-[10px] text-slate-600">vs {subLabel||'prior'}</span>
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5">Prior: {format(prior)}</div>
    </div>
  );
};

/* ─── Root cause card ────────────────────────────────────────────────────── */
const CauseCard = ({ cause, rank }) => {
  const [open, setOpen] = useState(false);
  const pos = cause.direction === 'up';
  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-all',
      cause.severity==='high'   ? 'bg-red-950/20 border-red-800/40'
      : cause.severity==='medium' ? 'bg-amber-950/20 border-amber-800/40'
      : 'bg-gray-900 border-gray-800',
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5',
          pos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
        )}>
          {pos ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-200">{cause.factor}</span>
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase',
              cause.severity==='high'?'bg-red-500/15 text-red-400':cause.severity==='medium'?'bg-amber-500/15 text-amber-400':'bg-gray-700 text-slate-500'
            )}>{cause.severity}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-slate-500">
              {CAT_LABEL[cause.category]||cause.category}
            </span>
            <span className={clsx('text-xs font-bold ml-auto', pos?'text-emerald-400':'text-red-400')}>
              {p(cause.impactPct)>=0?'+':''}{p(cause.impactPct).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">{cause.detail}</p>

          {(cause.action || cause.evidence?.length > 0) && (
            <button onClick={() => setOpen(!open)} className="text-[10px] text-slate-600 hover:text-slate-400 mt-1 flex items-center gap-0.5">
              {open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
              {open ? 'less' : 'action + evidence'}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-2">
              {cause.evidence?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {cause.evidence.map((e,i) => (
                    <span key={i} className="text-[10px] bg-gray-800 text-slate-400 px-2 py-0.5 rounded-full">{e}</span>
                  ))}
                </div>
              )}
              {cause.action && (
                <div className="flex items-start gap-2 p-2.5 bg-gray-800/60 rounded-lg">
                  <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0 mt-0.5">Action</span>
                  <p className="text-[11px] text-slate-300">{cause.action}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
export default function OrderAnalysis() {
  const { rawAccounts, shopifyOrders, inventoryMap, manualMap, brandData, brands, activeBrandIds } = useStore();

  const [period,     setPeriod]     = useState('yesterday');
  const [compMode,   setCompMode]   = useState('same_day_lw');
  const [customSince,setCustomSince]= useState('');
  const [customUntil,setCustomUntil]= useState('');
  const [tab,        setTab]        = useState('overview');
  const [adFilter,   setAdFilter]   = useState('all');
  const [geoView,    setGeoView]    = useState('states');
  const [expanded,   setExpanded]   = useState(null);

  /* date windows */
  const dates = useMemo(
    () => getPeriodDates(period, compMode, customSince || undefined, customUntil || undefined),
    [period, compMode, customSince, customUntil],
  );

  /* data coverage */
  const coverage = useMemo(() => getDataCoverage(shopifyOrders), [shopifyOrders]);

  /* filtered order sets */
  const curOrders   = useMemo(() => filterByDate(shopifyOrders, dates.curSince,   dates.curUntil),   [shopifyOrders, dates]);
  const priorOrders = useMemo(() => filterByDate(shopifyOrders, dates.priorSince, dates.priorUntil), [shopifyOrders, dates]);

  /* aggregates */
  const curAgg   = useMemo(() => aggregateOrdersFull(curOrders),   [curOrders]);
  const priorAgg = useMemo(() => aggregateOrdersFull(priorOrders), [priorOrders]);

  /* derived comparisons */
  const hourlyData  = useMemo(() => buildHourlyBreakdown(curOrders, priorOrders), [curOrders, priorOrders]);
  const dailyData   = useMemo(() => buildDailyTrend(curOrders, priorOrders, dates.curSince, dates.curUntil, dates.priorSince, dates.priorUntil), [curOrders, priorOrders, dates]);
  const skuData     = useMemo(() => buildSkuDeepDive(curOrders, priorOrders, inventoryMap), [curOrders, priorOrders, inventoryMap]);
  const trafficData = useMemo(() => buildTrafficComparison(curOrders, priorOrders), [curOrders, priorOrders]);
  const discData    = useMemo(() => buildDiscountAnalysis(curOrders, priorOrders), [curOrders, priorOrders]);
  const geoData     = useMemo(() => buildGeoComparison(curOrders, priorOrders), [curOrders, priorOrders]);
  const payData     = useMemo(() => buildPaymentComparison(curOrders, priorOrders), [curOrders, priorOrders]);
  const valueDist   = useMemo(() => buildOrderValueDistribution(curOrders, priorOrders), [curOrders, priorOrders]);

  /* Meta data (7D) */
  const rows7d  = useMemo(() => rawAccounts.flatMap(a => a.insights7d  || []), [rawAccounts]);
  const rows14d = useMemo(() => rawAccounts.flatMap(a => a.insights14d || []), [rawAccounts]);
  const metaCur = useMemo(() => aggregateInsightRows(rows7d), [rows7d]);
  const adComp  = useMemo(() => buildAdComparison(rows7d, rows14d), [rows7d, rows14d]);
  const priorRows = useMemo(() => adComp.filter(a => a.prior?.spend > 0).map(a => a.prior), [adComp]);
  const metaPrior = useMemo(() => aggregateInsightRows(priorRows), [priorRows]);

  const newAdsCount     = useMemo(() => adComp.filter(a=>a.status==='new').length,     [adComp]);
  const stoppedAdsCount = useMemo(() => adComp.filter(a=>a.status==='stopped').length, [adComp]);

  /* collection breakdown */
  const collectionData = useMemo(
    () => buildCollectionBreakdown(curOrders, priorOrders, inventoryMap),
    [curOrders, priorOrders, inventoryMap],
  );

  /* ad stockout impact */
  const adStockoutData = useMemo(
    () => buildAdStockoutImpact(adComp, manualMap, inventoryMap),
    [adComp, manualMap, inventoryMap],
  );

  /* GA data — aggregate across active brands */
  const gaData = useMemo(() => {
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    for (const b of active) {
      const d = brandData?.[b.id];
      if (d?.gaData?.dailyTrend?.length) return d.gaData;
    }
    return null;
  }, [brands, activeBrandIds, brandData]);

  const gaAnalysis = useMemo(
    () => gaData ? buildGaCrossAnalysis(gaData, dates.curSince, dates.curUntil, dates.priorSince, dates.priorUntil) : null,
    [gaData, dates],
  );

  /* root causes */
  const causes = useMemo(() => computeDeepRootCauses({
    curAgg, priorAgg, skuData, trafficData,
    discountData: discData, geoData, paymentData: payData,
    metaCur, metaPrior, newAdsCount, stoppedAdsCount,
    gaAnalysis, collectionData, adStockoutData,
  }), [curAgg, priorAgg, skuData, trafficData, discData, geoData, payData, metaCur, metaPrior, newAdsCount, stoppedAdsCount, gaAnalysis, collectionData, adStockoutData]);

  const highCauses = causes.filter(c => c.severity === 'high');

  /* top-level deltas */
  const orderDelta   = priorAgg.count > 0 ? (curAgg.count - priorAgg.count) / priorAgg.count * 100 : 0;
  const revenueDelta = priorAgg.revenue > 0 ? (curAgg.revenue - priorAgg.revenue) / priorAgg.revenue * 100 : 0;

  const hasShopData = shopifyOrders.length > 0;
  const hasCoverage = coverage && dates.curSince >= coverage.earliest;

  /* filtered ads */
  const filteredAds = useMemo(() => {
    const list = adFilter === 'all' ? adComp : adComp.filter(a => a.status === adFilter);
    return list.slice(0, 50);
  }, [adComp, adFilter]);

  if (!hasShopData && rows7d.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 p-8">
        <Activity size={40} className="text-slate-700" />
        <p className="text-slate-400 text-sm text-center">Fetch Shopify orders or Meta data from Setup to use Order Analysis.</p>
      </div>
    );
  }

  /* ── helpers for compact tables ──────────────────────────────────── */
  const DeltaCell = ({ v, invert=false }) => {
    const vv = p(v);
    const pos = invert ? vv < 0 : vv >= 0;
    return <span className={clsx('text-xs font-semibold', pos?'text-emerald-400':'text-red-400')}>{vv>=0?'+':''}{vv.toFixed(0)}%</span>;
  };

  /* ════════════════════════════════════════════════════════════════════
     OVERVIEW TAB
  ════════════════════════════════════════════════════════════════════ */
  const OverviewTab = () => (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard label="Orders"          cur={curAgg.count}          prior={priorAgg.count}          format={fmtNum}  subLabel={dates.compLabel} icon={ShoppingCart}/>
        <KPICard label="Revenue"         cur={curAgg.revenue}        prior={priorAgg.revenue}        format={fmtCur}  subLabel={dates.compLabel} icon={Activity}/>
        <KPICard label="Avg Order Value" cur={curAgg.aov}            prior={priorAgg.aov}            format={fmtCur}  subLabel={dates.compLabel} icon={Tag}/>
        <KPICard label="New Customers"   cur={curAgg.newCount}       prior={priorAgg.newCount}       format={fmtNum}  subLabel={dates.compLabel} icon={Users}/>
        <KPICard label="Discount Rate"   cur={curAgg.discountedPct}  prior={priorAgg.discountedPct}  format={v=>`${p(v).toFixed(1)}%`} invert subLabel={dates.compLabel} icon={Tag}/>
        <KPICard label="Cancel Rate"     cur={curAgg.cancelRate}     prior={priorAgg.cancelRate}     format={v=>`${p(v).toFixed(1)}%`} invert subLabel={dates.compLabel} icon={AlertTriangle}/>
      </div>

      {/* Verdict banner */}
      {priorAgg.count > 0 && (
        <div className={clsx(
          'rounded-xl border p-5',
          orderDelta < -15 ? 'bg-red-950/30 border-red-800/50' :
          orderDelta >  15 ? 'bg-emerald-950/30 border-emerald-800/50' :
          'bg-gray-900 border-gray-800',
        )}>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-[10px] text-slate-500 mb-0.5">Order change vs {dates.compLabel.toLowerCase()}</div>
              <div className="flex items-baseline gap-2">
                <span className={clsx('text-4xl font-black', orderDelta>=0?'text-emerald-400':'text-red-400')}>
                  {orderDelta>=0?'+':''}{orderDelta.toFixed(1)}%
                </span>
                <span className="text-lg text-slate-500">
                  ({curAgg.count - priorAgg.count >= 0 ? '+' : ''}{curAgg.count - priorAgg.count} orders)
                </span>
              </div>
            </div>
            <div className="h-10 w-px bg-gray-700 hidden lg:block" />
            <div>
              <div className="text-[10px] text-slate-500 mb-0.5">Revenue</div>
              <div className={clsx('text-xl font-bold', revenueDelta>=0?'text-emerald-400':'text-red-400')}>
                {revenueDelta>=0?'+':''}{revenueDelta.toFixed(1)}%
                <span className="text-sm text-slate-500 font-normal ml-1">({fmtCur(curAgg.revenue - priorAgg.revenue)})</span>
              </div>
            </div>
            {highCauses.length > 0 && (
              <>
                <div className="h-10 w-px bg-gray-700 hidden lg:block" />
                <div className="flex-1">
                  <div className="text-[10px] text-slate-500 mb-1">{highCauses.length} HIGH severity factor{highCauses.length>1?'s':''}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {highCauses.slice(0,3).map((c,i) => (
                      <button key={i} onClick={()=>setTab('diagnosis')}
                        className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 border border-red-800/40 rounded-full text-[10px] text-red-300 hover:bg-red-500/20 transition-all">
                        <TrendingDown size={9}/> {c.factor}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Diagnosis chips */}
      {causes.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-[11px] font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-amber-400"/>
            {causes.length} factor{causes.length>1?'s':''} detected
          </div>
          <div className="flex flex-wrap gap-2">
            {causes.slice(0,10).map((c,i) => (
              <button key={i} onClick={()=>setTab('diagnosis')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border cursor-pointer transition-all',
                  c.severity==='high'   ? 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20'
                  : c.severity==='medium' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                  : 'bg-gray-800 border-gray-700 text-slate-400 hover:bg-gray-700',
                )}>
                {c.direction==='up' ? <TrendingUp size={10}/> : c.direction==='down' ? <TrendingDown size={10}/> : <Minus size={10}/>}
                {c.factor}
                <span className="opacity-60 text-[10px]">{p(c.impactPct)>=0?'+':''}{p(c.impactPct).toFixed(0)}%</span>
              </button>
            ))}
            {causes.length > 10 && (
              <button onClick={()=>setTab('diagnosis')} className="px-3 py-1.5 rounded-full text-[11px] bg-gray-800 border border-gray-700 text-slate-500 hover:text-slate-300">
                +{causes.length-10} more →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick metrics vs Meta */}
      {rows7d.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <div className="text-xs font-semibold text-slate-400 mb-3">Meta 7D vs Prior 7D</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label:'ROAS',     cur:metaCur.roas,     prior:metaPrior.roas,     fmt:fmtRoas },
              { label:'Spend',    cur:metaCur.spend,    prior:metaPrior.spend,    fmt:fmtCur, inv:true },
              { label:'Purchases',cur:metaCur.purchases,prior:metaPrior.purchases,fmt:fmtNum },
              { label:'CPM',      cur:metaCur.cpm,      prior:metaPrior.cpm,      fmt:v=>`₹${p(v).toFixed(0)}`, inv:true },
              { label:'CTR',      cur:metaCur.ctr,      prior:metaPrior.ctr,      fmt:v=>`${p(v).toFixed(2)}%` },
              { label:'ATC Rate', cur:metaCur.atcRate,  prior:metaPrior.atcRate,  fmt:v=>`${p(v).toFixed(1)}%` },
            ].map(m => {
              const pct2 = p(m.prior) > 0 ? (p(m.cur) - p(m.prior)) / p(m.prior) * 100 : 0;
              const pos = m.inv ? pct2 < 0 : pct2 >= 0;
              return (
                <div key={m.label} className="bg-gray-800/60 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-600">{m.label}</div>
                  <div className="text-sm font-bold text-white">{m.fmt(m.cur)}</div>
                  <div className={clsx('text-[10px] font-medium', pos?'text-emerald-400':'text-red-400')}>
                    {pct2>=0?'+':''}{pct2.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  /* ════════════════════════════════════════════════════════════════════
     TIME TAB (hourly for single-day, daily for ranges)
  ════════════════════════════════════════════════════════════════════ */
  const TimeTab = () => {
    const chartData = dates.isSingleDay ? hourlyData : dailyData;
    const title = dates.isSingleDay ? 'Orders by Hour' : 'Orders by Day';
    const xKey  = dates.isSingleDay ? 'label' : 'label';

    // Find the biggest gap hour/day
    let worstLabel = null, worstDiff = 0;
    for (const d of chartData) {
      const diff = (d.priorOrders||0) - (d.orders||0);
      if (diff > worstDiff) { worstDiff = diff; worstLabel = d.label; }
    }

    return (
      <div className="space-y-4">
        {worstLabel && priorAgg.count > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-900/20 border border-amber-800/30 rounded-lg text-xs text-amber-300">
            <AlertTriangle size={12}/> Biggest drop at <strong>{worstLabel}</strong> — {worstDiff} fewer order{worstDiff>1?'s':''} vs {dates.compLabel.toLowerCase()}
          </div>
        )}

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-semibold text-slate-400">{title}</div>
            <div className="flex items-center gap-3 text-[10px] text-slate-600">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block"/>Current</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-600 inline-block"/>Prior</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barGap={1} margin={{top:0,right:4,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false}/>
              <XAxis dataKey={xKey} tick={{fontSize:9, fill:'#64748b'}} axisLine={false} tickLine={false} interval={dates.isSingleDay ? 1 : 0}/>
              <YAxis tick={{fontSize:9, fill:'#64748b'}} axisLine={false} tickLine={false} width={24}/>
              <Tooltip content={<RTooltip/>}/>
              <Bar dataKey="orders"      name="Current" fill="#3b82f6" radius={[3,3,0,0]}/>
              <Bar dataKey="priorOrders" name="Prior"   fill="#374151" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="text-xs font-semibold text-slate-400 mb-4">Revenue</div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{top:0,right:4,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false}/>
              <XAxis dataKey={xKey} tick={{fontSize:9, fill:'#64748b'}} axisLine={false} tickLine={false} interval={dates.isSingleDay ? 1 : 0}/>
              <YAxis tick={{fontSize:9, fill:'#64748b'}} axisLine={false} tickLine={false} width={40}
                tickFormatter={v => v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${v}`}/>
              <Tooltip content={<RTooltip/>}/>
              <Area type="monotone" dataKey="priorRev" name="Prior Rev" fill="#1f2937" stroke="#374151" strokeWidth={1.5}/>
              <Line  type="monotone" dataKey="revenue"  name="Revenue"   stroke="#22c55e" strokeWidth={2} dot={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* hourly breakdown table for single day */}
        {dates.isSingleDay && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-4 gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase text-slate-600">
              <div>Hour</div><div className="text-right">Current</div><div className="text-right">Prior</div><div className="text-right">Δ</div>
            </div>
            {hourlyData.filter(h => h.orders > 0 || h.priorOrders > 0).map(h => {
              const diff = h.orders - h.priorOrders;
              return (
                <div key={h.hour} className="grid grid-cols-4 gap-2 px-4 py-1.5 border-b border-gray-800/40 hover:bg-gray-800/20">
                  <div className="text-xs text-slate-400">{h.label}</div>
                  <div className="text-right text-xs text-slate-200">{h.orders}</div>
                  <div className="text-right text-xs text-slate-500">{h.priorOrders}</div>
                  <div className={clsx('text-right text-xs font-semibold', diff>=0?'text-emerald-400':'text-red-400')}>
                    {diff>=0?'+':''}{diff}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     PRODUCTS TAB
  ════════════════════════════════════════════════════════════════════ */
  const ProductsTab = () => {
    if (!hasShopData) return <p className="text-slate-500 text-sm py-8 text-center">No Shopify orders loaded.</p>;

    const stockedOut = skuData.filter(s => s.isStockedOut);
    const lowStock   = skuData.filter(s => s.isLowStock);

    return (
      <div className="space-y-4">
        {(stockedOut.length > 0 || lowStock.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {stockedOut.length > 0 && (
              <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
                <div className="text-xs font-semibold text-red-400 mb-1">{stockedOut.length} SKU{stockedOut.length>1?'s':''} Stocked Out</div>
                <div className="text-[11px] text-red-300/80">{stockedOut.slice(0,5).map(s=>s.sku).join(', ')}{stockedOut.length>5?` +${stockedOut.length-5} more`:''}</div>
              </div>
            )}
            {lowStock.length > 0 && (
              <div className="p-3 bg-amber-900/20 border border-amber-800/40 rounded-lg">
                <div className="text-xs font-semibold text-amber-400 mb-1">{lowStock.length} SKU{lowStock.length>1?'s':''} Low Stock (≤5 units)</div>
                <div className="text-[11px] text-amber-300/80">{lowStock.slice(0,5).map(s=>`${s.sku} (${s.stock})`).join(', ')}</div>
              </div>
            )}
          </div>
        )}

        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[2fr_70px_70px_90px_90px_70px_60px] gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase text-slate-600">
            <div>SKU / Product</div>
            <div className="text-right">Cur Qty</div>
            <div className="text-right">Prior</div>
            <div className="text-right">Cur Rev</div>
            <div className="text-right">Prior Rev</div>
            <div className="text-right">Qty Δ</div>
            <div className="text-right">Stock</div>
          </div>
          {skuData.length === 0 && <p className="text-slate-600 text-xs text-center py-8">No product data for this window</p>}
          <div className="divide-y divide-gray-800/40">
            {skuData.slice(0,40).map(s => (
              <div key={s.sku} className={clsx('grid grid-cols-[2fr_70px_70px_90px_90px_70px_60px] gap-2 px-4 py-2 items-center hover:bg-gray-800/20', s.isStockedOut && 'bg-red-900/10')}>
                <div>
                  <div className="text-xs text-slate-200 font-medium truncate">{s.title !== s.sku ? s.title : s.sku}</div>
                  {s.title !== s.sku && <div className="text-[9px] text-slate-600">{s.sku}</div>}
                </div>
                <div className="text-right text-xs text-slate-200">{fmtNum(s.curQty)}</div>
                <div className="text-right text-xs text-slate-500">{fmtNum(s.priorQty)}</div>
                <div className="text-right text-xs text-slate-300">{fmtCur(s.curRev)}</div>
                <div className="text-right text-xs text-slate-500">{fmtCur(s.priorRev)}</div>
                <DeltaCell v={s.qtyDelta}/>
                <div className="text-right text-xs">
                  {s.stock === null ? <span className="text-slate-700">—</span>
                   : s.isStockedOut  ? <span className="text-red-400 font-bold">OUT</span>
                   : s.isLowStock    ? <span className="text-amber-400">{s.stock}</span>
                   : <span className="text-slate-400">{s.stock}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     TRAFFIC TAB
  ════════════════════════════════════════════════════════════════════ */
  const TrafficTab = () => {
    if (!hasShopData) return <p className="text-slate-500 text-sm py-8 text-center">No Shopify orders loaded.</p>;
    const noTrafficData = trafficData.every(s => !s.curOrders && !s.priorOrders);
    if (noTrafficData) return <p className="text-slate-500 text-sm py-8 text-center">No traffic source data available (requires landing_site on orders).</p>;

    const SRC_COLORS = { facebook:'#3b82f6', instagram:'#a78bfa', google:'#22c55e', direct:'#64748b', youtube:'#ef4444', other_referral:'#f59e0b' };
    const getColor = src => SRC_COLORS[src] || '#94a3b8';

    return (
      <div className="space-y-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="text-xs font-semibold text-slate-400 mb-4">Orders by Source</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trafficData.slice(0,8)} layout="vertical" margin={{top:0,right:60,bottom:0,left:0}}>
              <XAxis type="number" tick={{fontSize:9, fill:'#64748b'}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="source" tick={{fontSize:10, fill:'#94a3b8'}} axisLine={false} tickLine={false} width={80}/>
              <Tooltip content={<RTooltip/>}/>
              <Bar dataKey="curOrders"   name="Current" radius={[0,3,3,0]}>
                {trafficData.slice(0,8).map((s,i) => <Cell key={i} fill={getColor(s.source)}/>)}
              </Bar>
              <Bar dataKey="priorOrders" name="Prior" fill="#374151" radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[2fr_70px_70px_90px_70px] gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase text-slate-600">
            <div>Source</div><div className="text-right">Cur</div><div className="text-right">Prior</div><div className="text-right">Revenue</div><div className="text-right">Δ</div>
          </div>
          <div className="divide-y divide-gray-800/40">
            {trafficData.map(s => (
              <div key={s.source} className="grid grid-cols-[2fr_70px_70px_90px_70px] gap-2 px-4 py-2 items-center hover:bg-gray-800/20">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:getColor(s.source)}}/>
                  <span className="text-xs text-slate-300 capitalize">{s.source.replace(/_/g,' ')}</span>
                </div>
                <div className="text-right text-xs text-slate-200">{fmtNum(s.curOrders)}</div>
                <div className="text-right text-xs text-slate-500">{fmtNum(s.priorOrders)}</div>
                <div className="text-right text-xs text-slate-300">{fmtCur(s.curRev)}</div>
                <DeltaCell v={s.delta}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     CUSTOMERS TAB
  ════════════════════════════════════════════════════════════════════ */
  const CustomersTab = () => {
    if (!hasShopData) return <p className="text-slate-500 text-sm py-8 text-center">No Shopify orders loaded.</p>;
    const curNewPct   = curAgg.count > 0 ? curAgg.newCount / curAgg.count * 100 : 0;
    const priorNewPct = priorAgg.count > 0 ? priorAgg.newCount / priorAgg.count * 100 : 0;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="New Customers"    cur={curAgg.newCount}    prior={priorAgg.newCount}    format={fmtNum}  subLabel={dates.compLabel} icon={Users}/>
          <KPICard label="Repeat Customers" cur={curAgg.repeatCount} prior={priorAgg.repeatCount} format={fmtNum}  subLabel={dates.compLabel} icon={Users}/>
          <KPICard label="Avg Order Value"  cur={curAgg.aov}         prior={priorAgg.aov}         format={fmtCur}  subLabel={dates.compLabel} icon={Tag}/>
          <KPICard label="Avg Items/Order"  cur={curAgg.avgItems}    prior={priorAgg.avgItems}    format={v=>p(v).toFixed(1)} subLabel={dates.compLabel} icon={Package}/>
        </div>

        {/* New vs Repeat mix */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[
            { label:'Current', count:curAgg.count, newP:curNewPct, newC:curAgg.newCount, repC:curAgg.repeatCount },
            { label:`Prior (${dates.compLabel})`, count:priorAgg.count, newP:priorNewPct, newC:priorAgg.newCount, repC:priorAgg.repeatCount },
          ].map(w => (
            <div key={w.label}>
              <div className="text-xs font-semibold text-slate-400 mb-3">{w.label} — {fmtNum(w.count)} orders</div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-blue-400">New ({fmtNum(w.newC)})</span>
                    <span className="text-slate-500">{w.newP.toFixed(0)}%</span>
                  </div>
                  <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{width:`${Math.min(100,w.newP)}%`}}/>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-violet-400">Repeat ({fmtNum(w.repC)})</span>
                    <span className="text-slate-500">{(100-w.newP).toFixed(0)}%</span>
                  </div>
                  <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{width:`${Math.min(100,100-w.newP)}%`}}/>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     ORDERS TAB (discounts, payment, value dist, geo)
  ════════════════════════════════════════════════════════════════════ */
  const OrdersTab = () => {
    if (!hasShopData) return <p className="text-slate-500 text-sm py-8 text-center">No Shopify orders loaded.</p>;

    return (
      <div className="space-y-5">
        {/* Order value distribution */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="text-xs font-semibold text-slate-400 mb-4">Order Value Distribution</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={valueDist} margin={{top:0,right:4,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:9,fill:'#64748b'}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:9,fill:'#64748b'}} axisLine={false} tickLine={false} width={24}/>
              <Tooltip content={<RTooltip/>}/>
              <Bar dataKey="cur"   name="Current" fill="#3b82f6" radius={[3,3,0,0]}/>
              <Bar dataKey="prior" name="Prior"   fill="#374151" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Payment gateways */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <CreditCard size={12}/> Payment Gateways
            </div>
            <div className="divide-y divide-gray-800/40">
              {payData.map(g => (
                <div key={g.gateway} className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/20">
                  <span className="text-xs text-slate-300 capitalize">{g.gateway.replace(/_/g,' ')}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-200">{fmtNum(g.curOrders)}</span>
                    <span className="text-slate-600">vs {fmtNum(g.priorOrders)}</span>
                    <DeltaCell v={g.delta}/>
                  </div>
                </div>
              ))}
              {payData.length === 0 && <p className="text-slate-600 text-xs text-center py-6">No payment data</p>}
            </div>
          </div>

          {/* Discounts */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Tag size={12}/> Discount Codes
            </div>
            <div className="px-4 py-3 grid grid-cols-2 gap-3 border-b border-gray-800/40">
              {[
                {label:'Disc. rate (cur)', v:`${discData.cur.pct.toFixed(0)}%`},
                {label:'Disc. rate (prior)', v:`${discData.prior.pct.toFixed(0)}%`},
              ].map(m => (
                <div key={m.label}>
                  <div className="text-[10px] text-slate-600">{m.label}</div>
                  <div className="text-sm font-bold text-white">{m.v}</div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-gray-800/40">
              {discData.codeDiff.slice(0,8).map(c => (
                <div key={c.code} className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/20">
                  <span className="text-xs font-mono text-slate-300">{c.code}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-200">{fmtNum(c.curOrders)}</span>
                    <span className="text-slate-600">vs {fmtNum(c.priorOrders)}</span>
                    <DeltaCell v={c.delta}/>
                  </div>
                </div>
              ))}
              {discData.codeDiff.length === 0 && <p className="text-slate-600 text-xs text-center py-6">No discount codes used</p>}
            </div>
          </div>
        </div>

        {/* Geography */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5"><MapPin size={12}/> Geography</div>
            <div className="flex gap-1">
              {['states','cities'].map(v => (
                <button key={v} onClick={()=>setGeoView(v)}
                  className={clsx('px-2.5 py-1 rounded text-[10px] font-medium transition-all',
                    geoView===v ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300')}>
                  {v.charAt(0).toUpperCase()+v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[2fr_70px_70px_70px] gap-2 px-4 py-2 border-b border-gray-800 text-[10px] font-bold uppercase text-slate-600">
            <div>{geoView==='states'?'State':'City'}</div><div className="text-right">Cur</div><div className="text-right">Prior</div><div className="text-right">Δ</div>
          </div>
          <div className="divide-y divide-gray-800/40">
            {(geoView==='states' ? geoData.states : geoData.cities).slice(0,12).map(g => (
              <div key={g.geo} className="grid grid-cols-[2fr_70px_70px_70px] gap-2 px-4 py-2 items-center hover:bg-gray-800/20">
                <span className="text-xs text-slate-300">{g.geo}</span>
                <span className="text-right text-xs text-slate-200">{fmtNum(g.curOrders)}</span>
                <span className="text-right text-xs text-slate-500">{fmtNum(g.priorOrders)}</span>
                <DeltaCell v={g.delta}/>
              </div>
            ))}
            {(geoView==='states' ? geoData.states : geoData.cities).length === 0 && (
              <p className="text-slate-600 text-xs text-center py-6">No address data available</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     DIAGNOSIS TAB
  ════════════════════════════════════════════════════════════════════ */
  const DiagnosisTab = () => {
    if (causes.length === 0) return (
      <div className="flex flex-col items-center gap-3 py-12">
        <CheckCircle size={36} className="text-emerald-500/40"/>
        <p className="text-slate-500 text-sm">No significant changes detected — metrics are relatively stable.</p>
      </div>
    );

    return (
      <div className="space-y-3">
        <div className="text-xs text-slate-500">
          {causes.length} factor{causes.length>1?'s':''} identified. {highCauses.length > 0 && `${highCauses.length} HIGH severity.`} Click any card to expand action items.
        </div>
        {causes.map((c, i) => <CauseCard key={i} cause={c} rank={i+1}/>)}
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     COLLECTIONS TAB
  ════════════════════════════════════════════════════════════════════ */
  const CollectionsTab = () => {
    if (!hasShopData) return <p className="text-slate-500 text-sm py-8 text-center">No Shopify orders loaded.</p>;
    const noInv = !Object.keys(inventoryMap).length;

    return (
      <div className="space-y-4">
        {noInv && (
          <div className="flex items-center gap-2 p-3 bg-amber-900/20 border border-amber-800/30 rounded-lg text-xs text-amber-300">
            <AlertTriangle size={13}/>
            Inventory not loaded — collections derived from vendor field. Load inventory from Setup for accurate product-type grouping.
          </div>
        )}

        {/* stockout alerts */}
        {adStockoutData.length > 0 && (
          <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
            <div className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12}/> {adStockoutData.length} Ad{adStockoutData.length>1?'s':''} Running on Zero-Stock Collections
            </div>
            <div className="space-y-1.5">
              {adStockoutData.slice(0, 4).map(a => (
                <div key={a.adId} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 truncate max-w-[55%]">{a.adName}</span>
                  <span className="text-slate-500">{a.collection}</span>
                  <span className="text-red-400 font-semibold">~₹{a.wastedEst} wasted</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* collection table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[2fr_80px_80px_90px_90px_70px_80px] gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase text-slate-600">
            <div>Collection</div>
            <div className="text-right">Cur Units</div>
            <div className="text-right">Prior</div>
            <div className="text-right">Cur Rev</div>
            <div className="text-right">Prior Rev</div>
            <div className="text-right">Rev Δ</div>
            <div className="text-right">Stock</div>
          </div>
          {collectionData.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-8">No collection data for this window</p>
          )}
          <div className="divide-y divide-gray-800/40">
            {collectionData.map(c => (
              <div key={c.collection} className={clsx(
                'grid grid-cols-[2fr_80px_80px_90px_90px_70px_80px] gap-2 px-4 py-2 items-center hover:bg-gray-800/20',
                c.oosSkusNow?.length > 0 && 'bg-red-900/5',
              )}>
                <div>
                  <div className="text-xs text-slate-200 font-medium truncate">{c.collection}</div>
                  {c.oosSkusNow?.length > 0 && (
                    <div className="text-[9px] text-red-400">{c.oosSkusNow.length} OOS · {c.lowSkusNow?.length||0} low stock</div>
                  )}
                </div>
                <div className="text-right text-xs text-slate-200">{fmtNum(c.curUnits)}</div>
                <div className="text-right text-xs text-slate-500">{fmtNum(c.priorUnits)}</div>
                <div className="text-right text-xs text-slate-300">{fmtCur(c.curRev)}</div>
                <div className="text-right text-xs text-slate-500">{fmtCur(c.priorRev)}</div>
                <DeltaCell v={c.revDelta}/>
                <div className="text-right text-[10px]">
                  {c.oosSkusNow?.length > 0
                    ? <span className="text-red-400 font-bold">{c.oosSkusNow.length} OOS</span>
                    : c.lowSkusNow?.length > 0
                      ? <span className="text-amber-400">{c.lowSkusNow.length} low</span>
                      : <span className="text-emerald-500/60">ok</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!noInv && (
          <p className="text-[10px] text-slate-600 flex items-center gap-1">
            <Info size={10}/>
            Collections = Shopify product_type. Stock shown from last inventory fetch.
          </p>
        )}
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     GA INSIGHTS TAB
  ════════════════════════════════════════════════════════════════════ */
  const GaTab = () => {
    if (!gaData) return (
      <div className="flex flex-col items-center gap-3 py-12">
        <BarChart3 size={36} className="text-slate-700"/>
        <p className="text-slate-500 text-sm">No GA4 data loaded — connect Google Analytics from Setup.</p>
      </div>
    );
    if (!gaAnalysis) return <p className="text-slate-500 text-sm py-8 text-center">GA data loaded but no matching dates in the selected window.</p>;

    const gaMetrics = [
      { label:'Sessions',        cur: gaAnalysis.curSessions,  prior: gaAnalysis.priorSessions,  fmt: fmtNum },
      { label:'Users',           cur: gaAnalysis.curUsers,     prior: gaAnalysis.priorUsers,     fmt: fmtNum },
      { label:'Conv Rate',       cur: gaAnalysis.curConvRate,  prior: gaAnalysis.priorConvRate,  fmt: v => `${p(v).toFixed(2)}%` },
      { label:'Bounce Rate',     cur: gaAnalysis.curBounce,    prior: gaAnalysis.priorBounce,    fmt: v => `${p(v).toFixed(1)}%`, invert: true },
      { label:'GA Revenue',      cur: gaAnalysis.curRevenue,   prior: gaAnalysis.priorRevenue,   fmt: fmtCur },
    ];

    return (
      <div className="space-y-4">
        {/* diagnosis banners */}
        {gaAnalysis.diagnosis.map((d, i) => (
          <div key={i} className={clsx(
            'p-3 rounded-lg border text-xs',
            d.severity === 'high' ? 'bg-red-900/20 border-red-800/40 text-red-200' : 'bg-amber-900/20 border-amber-800/40 text-amber-200',
          )}>
            <div className="font-semibold mb-1 flex items-center gap-1.5">
              <AlertTriangle size={12}/> {d.label}
            </div>
            <p className="text-[11px] opacity-80 mb-1.5">{d.detail}</p>
            {d.action && <p className="text-[10px] opacity-60"><strong>Action:</strong> {d.action}</p>}
          </div>
        ))}

        {gaAnalysis.diagnosis.length === 0 && (
          <div className="flex items-center gap-2 p-3 bg-emerald-900/10 border border-emerald-800/30 rounded-lg text-xs text-emerald-400">
            <CheckCircle size={12}/> No significant GA anomalies detected for this period.
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {gaMetrics.map(m => {
            const pct = m.prior > 0 ? (m.cur - m.prior) / m.prior * 100 : 0;
            const pos = m.invert ? pct < 0 : pct >= 0;
            return (
              <div key={m.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="text-[11px] text-slate-500 mb-1">{m.label}</div>
                <div className="text-xl font-bold text-white">{m.fmt(m.cur)}</div>
                <div className={clsx('text-[11px] font-semibold mt-1 flex items-center gap-0.5', pos?'text-emerald-400':'text-red-400')}>
                  {pos ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-600">Prior: {m.fmt(m.prior)}</div>
              </div>
            );
          })}
        </div>

        {/* GA cross vs Meta note */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800 text-[11px] text-slate-600 flex items-start gap-2">
          <Info size={11} className="mt-0.5 shrink-0"/>
          GA data compares daily sessions/conversions for the selected date window. Meta data always reflects 7D vs prior 7D. Use both together for a complete picture.
        </div>
      </div>
    );
  };

  const TAB_CONTENT = {
    overview:    <OverviewTab/>,
    time:        <TimeTab/>,
    collections: <CollectionsTab/>,
    products:    <ProductsTab/>,
    traffic:     <TrafficTab/>,
    customers:   <CustomersTab/>,
    orders:      <OrdersTab/>,
    ga:          <GaTab/>,
    diagnosis:   <DiagnosisTab/>,
  };

  /* ════════════════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-gray-950 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity size={18} className="text-brand-400"/>
            Order Change Analysis
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Deep root-cause diagnosis for any date — shopify + meta combined
          </p>
        </div>
      </div>

      {/* Period selector row */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-900 rounded-xl border border-gray-800">
        <Calendar size={13} className="text-slate-600 shrink-0"/>
        <div className="flex gap-1">
          {PERIODS.map(p2 => (
            <button key={p2.id} onClick={()=>setPeriod(p2.id)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                period===p2.id ? 'bg-brand-600/20 border-brand-500/40 text-brand-300' : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
              {p2.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customSince} onChange={e=>setCustomSince(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-brand-500/50"/>
            <span className="text-slate-600 text-xs">→</span>
            <input type="date" value={customUntil} onChange={e=>setCustomUntil(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-brand-500/50"/>
          </div>
        )}

        <div className="h-4 w-px bg-gray-700 mx-1"/>

        {COMP_MODES.filter(m => dates.isSingleDay || m.id==='prior_period').map(m => (
          <button key={m.id} onClick={()=>setCompMode(m.id)}
            className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
              compMode===m.id ? 'bg-violet-600/20 border-violet-500/40 text-violet-300' : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
            {m.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-600">
          {coverage ? (
            <>
              <Info size={10}/>
              Loaded: {coverage.earliest} → {coverage.latest} ({fmtNum(coverage.count)} orders)
            </>
          ) : (
            <span className="text-amber-500/70">No orders loaded</span>
          )}
        </div>
      </div>

      {/* Period label */}
      <div className="flex items-center gap-2 mb-4 text-[11px] text-slate-500">
        <span className="px-2.5 py-1 bg-gray-900 border border-gray-800 rounded-full font-medium text-slate-400">
          {dates.label}
        </span>
        <span>vs</span>
        <span className="px-2.5 py-1 bg-gray-900 border border-gray-800 rounded-full font-medium text-slate-500">
          {dates.compLabel} ({dates.priorSince}{dates.priorSince!==dates.priorUntil?` → ${dates.priorUntil}`:''})
        </span>
        {!hasCoverage && coverage && (
          <span className="text-amber-500/70 flex items-center gap-1">
            <AlertTriangle size={10}/> Selected date may be outside loaded range ({coverage.earliest})
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 border-b border-gray-800 mb-5 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const hasBadge = t.id==='diagnosis' && causes.length > 0;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={clsx('flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-all',
                tab===t.id ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-300')}>
              <Icon size={12}/>
              {t.label}
              {hasBadge && (
                <span className={clsx('ml-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full',
                  highCauses.length>0?'bg-red-500/20 text-red-400':'bg-amber-500/20 text-amber-400')}>
                  {causes.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {TAB_CONTENT[tab]}
    </div>
  );
}
