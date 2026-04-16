import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle,
  Search, ChevronDown, ChevronUp, Info, Activity,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { fmt, safeNum } from '../lib/analytics';
import {
  aggregateInsightRows,
  buildAdComparison,
  buildShopifyComparison,
  buildProductComparison,
  buildDailyTrend,
  computeRootCauses,
} from '../lib/periodAnalysis';

/* ─── helpers ──────────────────────────────────────────────────────────── */
const fmtPct = n => {
  const v = safeNum(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const DeltaBadge = ({ value, suffix = '%', invert = false }) => {
  const v = safeNum(value);
  const pos = invert ? v < 0 : v >= 0;
  return (
    <span className={clsx(
      'inline-flex items-center gap-0.5 text-[11px] font-semibold',
      pos ? 'text-emerald-400' : 'text-red-400',
    )}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {v >= 0 ? '+' : ''}{v.toFixed(1)}{suffix}
    </span>
  );
};

const MetricCard = ({ label, cur, prior, format = fmt.number, invert = false, subLabel }) => {
  const pct = prior > 0 ? (cur - prior) / prior * 100 : (cur > 0 ? 100 : 0);
  const pos = invert ? pct < 0 : pct >= 0;
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{format(cur)}</div>
      <div className="mt-1 flex items-center gap-2">
        <DeltaBadge value={pct} invert={invert} />
        <span className="text-[10px] text-slate-600">vs prior {subLabel || '7D'}</span>
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5">Prior: {format(prior)}</div>
    </div>
  );
};

const SevBadge = ({ sev }) => (
  <span className={clsx(
    'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide',
    sev === 'high'   && 'bg-red-500/15 text-red-400',
    sev === 'medium' && 'bg-amber-500/15 text-amber-400',
    sev === 'low'    && 'bg-slate-700 text-slate-400',
  )}>
    {sev}
  </span>
);

const CatBadge = ({ cat }) => {
  const MAP = { meta:'Meta', creative:'Creative', funnel:'Funnel', shopify:'Shopify', structure:'Structure' };
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-slate-400 font-medium">
      {MAP[cat] || cat}
    </span>
  );
};

const FunnelRow = ({ label, cur, prior, isRate = false }) => {
  const pct = prior > 0 ? (cur - prior) / prior * 100 : 0;
  const pos = pct >= 0;
  return (
    <div className="grid grid-cols-4 gap-3 items-center py-2.5 border-b border-gray-800/50">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-right text-sm font-semibold text-white">
        {isRate ? `${cur.toFixed(1)}%` : fmt.number(cur)}
      </div>
      <div className="text-right text-sm text-slate-500">
        {isRate ? `${prior.toFixed(1)}%` : fmt.number(prior)}
      </div>
      <div className={clsx('text-right text-xs font-semibold', pos ? 'text-emerald-400' : 'text-red-400')}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const MAP = {
    new:       { label: 'NEW',      cls: 'bg-blue-500/15 text-blue-400' },
    stopped:   { label: 'STOPPED',  cls: 'bg-red-500/15 text-red-400' },
    improving: { label: 'RISING',   cls: 'bg-emerald-500/15 text-emerald-400' },
    declining: { label: 'FALLING',  cls: 'bg-amber-500/15 text-amber-400' },
    stable:    { label: 'STABLE',   cls: 'bg-gray-700 text-slate-500' },
  };
  const m = MAP[status] || MAP.stable;
  return <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase', m.cls)}>{m.label}</span>;
};

const TABS = ['Overview', 'Ad Changes', 'Funnel', 'Products', 'Customers', 'Root Cause'];

/* ─── CUSTOM TOOLTIP for Recharts ─────────────────────────────────────── */
const OrderTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs">
      <div className="font-semibold text-slate-300 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-medium">{p.name === 'Revenue' ? fmt.currency(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── MAIN PAGE ────────────────────────────────────────────────────────── */
export default function OrderAnalysis() {
  const { rawAccounts, shopifyOrders, fetchStatus } = useStore();

  const [tab,       setTab]       = useState(0);
  const [shopDays,  setShopDays]  = useState(7);
  const [adFilter,  setAdFilter]  = useState('all');
  const [adSearch,  setAdSearch]  = useState('');
  const [expanded,  setExpanded]  = useState(null);

  /* aggregate Meta insights7d + insights14d across all accounts */
  const { rows7d, rows14d } = useMemo(() => ({
    rows7d:  rawAccounts.flatMap(a => a.insights7d  || []),
    rows14d: rawAccounts.flatMap(a => a.insights14d || []),
  }), [rawAccounts]);

  const metaCur   = useMemo(() => aggregateInsightRows(rows7d),  [rows7d]);
  const metaPrior = useMemo(() => aggregateInsightRows(
    (() => {
      const { safeNum: sn } = { safeNum };
      // prior 7D rows = per-ad subtraction (handled in buildAdComparison)
      // for aggregate we build synthetic aggregated prior via the comparison
      return rows14d; // over-counts, but close enough for totals
    })()
  ), [rows14d]);

  /* Proper prior-7D aggregate via the per-ad subtraction */
  const adComparison = useMemo(() => buildAdComparison(rows7d, rows14d), [rows7d, rows14d]);
  const priorRows    = useMemo(() =>
    adComparison.filter(a => a.prior && a.prior.spend > 0).map(a => a.prior),
  [adComparison]);
  const metaPriorAgg = useMemo(() => aggregateInsightRows(priorRows), [priorRows]);

  /* Shopify period comparison */
  const shopComp = useMemo(() => buildShopifyComparison(shopifyOrders, shopDays), [shopifyOrders, shopDays]);
  const { current: shopCur, prior: shopPrior, currentOrders, priorOrders } = shopComp;

  /* Product comparison */
  const products = useMemo(() => buildProductComparison(currentOrders, priorOrders), [currentOrders, priorOrders]);

  /* Daily trend chart */
  const trendData = useMemo(() => buildDailyTrend(shopifyOrders, shopDays), [shopifyOrders, shopDays]);

  /* Root causes */
  const newAdsCount     = useMemo(() => adComparison.filter(a => a.status === 'new').length,     [adComparison]);
  const stoppedAdsCount = useMemo(() => adComparison.filter(a => a.status === 'stopped').length, [adComparison]);
  const causes = useMemo(() => computeRootCauses({
    metaCur, metaPrior: metaPriorAgg,
    shopifyCur: shopCur, shopifyPrior: shopPrior,
    newAdsCount, stoppedAdsCount,
  }), [metaCur, metaPriorAgg, shopCur, shopPrior, newAdsCount, stoppedAdsCount]);

  /* Filtered ad list */
  const filteredAds = useMemo(() => {
    let list = adFilter === 'all' ? adComparison : adComparison.filter(a => a.status === adFilter);
    if (adSearch) {
      const q = adSearch.toLowerCase();
      list = list.filter(a =>
        a.adName?.toLowerCase().includes(q) || a.campaignName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [adComparison, adFilter, adSearch]);

  const hasMetaData   = rows7d.length > 0;
  const hasShopData   = shopifyOrders.length > 0;

  /* ── empty guard ──────────────────────────────────────────────────────── */
  if (!hasMetaData && !hasShopData) {
    return (
      <div className="min-h-screen bg-gray-950 p-8 flex flex-col items-center justify-center gap-4">
        <Activity size={40} className="text-slate-700" />
        <p className="text-slate-400 text-sm text-center">
          No data loaded yet — fetch Meta data (or Shopify orders) from Setup to use Order Analysis.
        </p>
      </div>
    );
  }

  /* ─── sub-pages ─────────────────────────────────────────────────────── */

  /* ── OVERVIEW TAB ─────────────────────────────────────────────────── */
  const OverviewTab = () => {
    const orderDelta  = shopPrior.count > 0 ? (shopCur.count - shopPrior.count) / shopPrior.count * 100 : 0;
    const revenueDelta = shopPrior.revenue > 0 ? (shopCur.revenue - shopPrior.revenue) / shopPrior.revenue * 100 : 0;

    return (
      <div className="space-y-5">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {hasShopData && <>
            <MetricCard label="Shopify Orders"  cur={shopCur.count}   prior={shopPrior.count}   format={fmt.number}   subLabel={`${shopDays}D`} />
            <MetricCard label="Shopify Revenue" cur={shopCur.revenue} prior={shopPrior.revenue} format={fmt.currency}  subLabel={`${shopDays}D`} />
            <MetricCard label="Avg Order Value" cur={shopCur.aov}     prior={shopPrior.aov}     format={fmt.currency}  subLabel={`${shopDays}D`} />
          </>}
          {hasMetaData && <>
            <MetricCard label="Meta ROAS"  cur={metaCur.roas}     prior={metaPriorAgg.roas}     format={v => fmt.roas(v)} subLabel="7D" />
            <MetricCard label="Ad Spend"   cur={metaCur.spend}    prior={metaPriorAgg.spend}    format={fmt.currency} invert subLabel="7D" />
            <MetricCard label="Purchases"  cur={metaCur.purchases} prior={metaPriorAgg.purchases} format={fmt.number}  subLabel="7D" />
          </>}
        </div>

        {/* Diagnosis chips */}
        {causes.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
              <AlertTriangle size={13} className="text-amber-400" />
              Key Drivers Detected ({causes.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {causes.slice(0, 8).map((c, i) => (
                <button
                  key={i}
                  onClick={() => setTab(5)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer',
                    c.severity === 'high'
                      ? 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20'
                      : c.severity === 'medium'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                        : 'bg-gray-800 border-gray-700 text-slate-400 hover:bg-gray-700',
                  )}
                >
                  {c.direction === 'up'
                    ? <TrendingUp size={11} />
                    : c.direction === 'down'
                      ? <TrendingDown size={11} />
                      : <Minus size={11} />
                  }
                  {c.factor}
                  <span className="opacity-60">{fmtPct(c.impactPct)}</span>
                </button>
              ))}
              {causes.length > 8 && (
                <button onClick={() => setTab(5)} className="px-3 py-1.5 rounded-full text-xs bg-gray-800 border border-gray-700 text-slate-500 hover:text-slate-300">
                  +{causes.length - 8} more
                </button>
              )}
            </div>
          </div>
        )}

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasShopData && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="text-xs font-semibold text-slate-400 mb-4">
                Daily Orders — {shopDays}D current vs {shopDays}D prior
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trendData} margin={{ top:0, right:4, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:9, fill:'#64748b' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<OrderTooltip />} />
                  <Bar dataKey="orders" name="Orders" radius={[3,3,0,0]}>
                    {trendData.map((entry, i) => (
                      <Cell key={i} fill={entry.isPrior ? '#374151' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-600">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />Current {shopDays}D</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-700 inline-block" />Prior {shopDays}D</span>
              </div>
            </div>
          )}

          {hasShopData && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="text-xs font-semibold text-slate-400 mb-4">Daily Revenue</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData} margin={{ top:0, right:4, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize:9, fill:'#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:9, fill:'#64748b' }} axisLine={false} tickLine={false} width={40}
                    tickFormatter={v => `₹${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                  <Tooltip content={<OrderTooltip />} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#22c55e"
                    dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Meta vs Shopify note */}
        <div className="flex items-start gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800/50">
          <Info size={13} className="text-slate-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-600">
            Meta metrics show <strong className="text-slate-500">7D vs prior 7D</strong> (derived from 14D − 7D subtraction).
            Shopify metrics show the last <strong className="text-slate-500">{shopDays} days</strong> vs the {shopDays} days before that, filtered from loaded orders.
          </p>
        </div>
      </div>
    );
  };

  /* ── AD CHANGES TAB ──────────────────────────────────────────────── */
  const AdChangesTab = () => {
    if (!hasMetaData) return (
      <p className="text-slate-500 text-sm py-10 text-center">No Meta data loaded.</p>
    );

    const FILTERS = [
      { id:'all',       label:'All Ads' },
      { id:'stopped',   label:`Stopped (${adComparison.filter(a=>a.status==='stopped').length})` },
      { id:'declining', label:`Declining (${adComparison.filter(a=>a.status==='declining').length})` },
      { id:'improving', label:`Rising (${adComparison.filter(a=>a.status==='improving').length})` },
      { id:'new',       label:`New (${adComparison.filter(a=>a.status==='new').length})` },
      { id:'stable',    label:`Stable (${adComparison.filter(a=>a.status==='stable').length})` },
    ];

    return (
      <div className="space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setAdFilter(f.id)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                adFilter === f.id
                  ? 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                  : 'bg-gray-900 border-gray-800 text-slate-400 hover:text-slate-200',
              )}>
              {f.label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              value={adSearch} onChange={e => setAdSearch(e.target.value)}
              placeholder="Search ads..."
              className="bg-gray-900 border border-gray-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-brand-500/50 w-48"
            />
          </div>
        </div>

        {/* Table header */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_90px_90px_90px_80px_80px] gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <div>Ad / Campaign</div>
            <div className="text-right">Status</div>
            <div className="text-right">Spend (cur)</div>
            <div className="text-right">Spend (prior)</div>
            <div className="text-right">ROAS (cur)</div>
            <div className="text-right">Purchases</div>
            <div className="text-right">Δ Orders</div>
          </div>

          {filteredAds.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-8">No ads match the filter</p>
          )}

          <div className="divide-y divide-gray-800/50">
            {filteredAds.slice(0, 60).map(a => (
              <div key={a.adId}>
                <div
                  onClick={() => setExpanded(expanded === a.adId ? null : a.adId)}
                  className="grid grid-cols-[2fr_1fr_90px_90px_90px_80px_80px] gap-2 px-4 py-2.5 items-center hover:bg-gray-800/30 cursor-pointer transition-colors"
                >
                  <div>
                    <div className="text-xs font-medium text-slate-200 truncate">{a.adName}</div>
                    <div className="text-[10px] text-slate-600 truncate">{a.campaignName}</div>
                  </div>
                  <div className="text-right"><StatusBadge status={a.status} /></div>
                  <div className="text-right text-xs text-slate-300">{fmt.currency(a.cur?.spend || 0)}</div>
                  <div className="text-right text-xs text-slate-500">{fmt.currency(a.prior?.spend || 0)}</div>
                  <div className="text-right text-xs text-slate-300">{a.cur ? `${safeNum(a.cur.roas).toFixed(2)}x` : '—'}</div>
                  <div className="text-right text-xs text-slate-300">{a.cur ? fmt.number(a.cur.purchases) : '—'}</div>
                  <div className={clsx('text-right text-xs font-semibold',
                    a.purchaseDelta > 0 ? 'text-emerald-400' : a.purchaseDelta < 0 ? 'text-red-400' : 'text-slate-600')}>
                    {a.status === 'new'     ? 'NEW' :
                     a.status === 'stopped' ? 'STOP' :
                     `${a.purchaseDelta >= 0 ? '+' : ''}${a.purchaseDelta.toFixed(0)}%`}
                  </div>
                </div>

                {/* Expanded detail row */}
                {expanded === a.adId && (
                  <div className="px-4 pb-3 bg-gray-800/20">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                      {[
                        { label:'CPM', cur: a.cur?.cpm, prior: a.prior?.cpm, fmt: v => `₹${safeNum(v).toFixed(0)}`, invert:true },
                        { label:'CTR', cur: a.cur?.ctr, prior: a.prior?.ctr, fmt: v => `${safeNum(v).toFixed(2)}%`, invert:false },
                        { label:'LPV Rate', cur: a.cur?.lpvRate, prior: a.prior?.lpvRate, fmt: v => `${safeNum(v).toFixed(1)}%`, invert:false },
                        { label:'ATC Rate', cur: a.cur?.atcRate, prior: a.prior?.atcRate, fmt: v => `${safeNum(v).toFixed(1)}%`, invert:false },
                      ].map(m => {
                        const pct = m.prior > 0 ? (m.cur - m.prior) / m.prior * 100 : 0;
                        const pos = m.invert ? pct < 0 : pct >= 0;
                        return (
                          <div key={m.label} className="bg-gray-900 rounded-lg p-2.5 border border-gray-800">
                            <div className="text-[10px] text-slate-600">{m.label}</div>
                            <div className="text-sm font-semibold text-white">{m.fmt(m.cur || 0)}</div>
                            <div className={clsx('text-[10px] font-medium', pos ? 'text-emerald-400' : 'text-red-400')}>
                              {m.prior > 0 ? fmtPct(pct) : '—'} vs {m.fmt(m.prior || 0)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredAds.length > 60 && (
            <div className="px-4 py-3 text-[10px] text-slate-600 border-t border-gray-800">
              Showing 60 of {filteredAds.length} ads
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── FUNNEL TAB ──────────────────────────────────────────────────── */
  const FunnelTab = () => {
    if (!hasMetaData) return (
      <p className="text-slate-500 text-sm py-10 text-center">No Meta data loaded.</p>
    );

    const cur = metaCur;
    const pri = metaPriorAgg;

    const steps = [
      { label:'Impressions',        cur: cur.impressions,  prior: pri.impressions,  isRate:false },
      { label:'Outbound Clicks',    cur: cur.outboundClicks, prior: pri.outboundClicks, isRate:false },
      { label:'CTR (outbound)',     cur: cur.ctr,          prior: pri.ctr,          isRate:true },
      { label:'Landing Page Views', cur: cur.lpv,          prior: pri.lpv,          isRate:false },
      { label:'LPV Rate',           cur: cur.lpvRate,      prior: pri.lpvRate,      isRate:true },
      { label:'Add to Cart',        cur: cur.atc,          prior: pri.atc,          isRate:false },
      { label:'ATC Rate',           cur: cur.atcRate,      prior: pri.atcRate,      isRate:true },
      { label:'Initiated Checkout', cur: cur.ic,           prior: pri.ic,           isRate:false },
      { label:'IC Rate',            cur: cur.icRate,       prior: pri.icRate,       isRate:true },
      { label:'Purchases',          cur: cur.purchases,    prior: pri.purchases,    isRate:false },
      { label:'Purchase Rate',      cur: cur.purchaseRate, prior: pri.purchaseRate, isRate:true },
      { label:'ROAS',               cur: cur.roas,         prior: pri.roas,         isRate:true, suffix:'x' },
      { label:'CPM',                cur: cur.cpm,          prior: pri.cpm,          isRate:true, invert:true },
    ];

    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-gray-800 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          <div>Metric</div>
          <div className="text-right">Current 7D</div>
          <div className="text-right">Prior 7D</div>
          <div className="text-right">Change</div>
        </div>
        <div className="px-5 divide-y divide-gray-800/30">
          {steps.map(s => (
            <FunnelRow
              key={s.label}
              label={s.label}
              cur={safeNum(s.cur)}
              prior={safeNum(s.prior)}
              isRate={s.isRate}
            />
          ))}
        </div>
        <div className="px-5 py-3 text-[10px] text-slate-600 border-t border-gray-800">
          Prior 7D derived from 14D − 7D subtraction per ad, then re-aggregated.
        </div>
      </div>
    );
  };

  /* ── PRODUCTS TAB ────────────────────────────────────────────────── */
  const ProductsTab = () => {
    if (!hasShopData) return (
      <p className="text-slate-500 text-sm py-10 text-center">No Shopify orders loaded — fetch from Setup.</p>
    );

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Info size={12} />
          Comparing last {shopDays} days vs prior {shopDays} days. Only loaded orders included.
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[2fr_80px_80px_90px_90px_80px] gap-2 px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <div>SKU</div>
            <div className="text-right">Cur Qty</div>
            <div className="text-right">Prior Qty</div>
            <div className="text-right">Cur Rev</div>
            <div className="text-right">Prior Rev</div>
            <div className="text-right">Qty Δ</div>
          </div>
          {products.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-8">No product data available for this window</p>
          )}
          <div className="divide-y divide-gray-800/50">
            {products.map(p => (
              <div key={p.sku} className="grid grid-cols-[2fr_80px_80px_90px_90px_80px] gap-2 px-4 py-2 items-center hover:bg-gray-800/20">
                <div className="text-xs text-slate-300 font-medium truncate">{p.sku}</div>
                <div className="text-right text-xs text-slate-200">{fmt.number(p.curQty)}</div>
                <div className="text-right text-xs text-slate-500">{fmt.number(p.priorQty)}</div>
                <div className="text-right text-xs text-slate-300">{fmt.currency(p.curRev)}</div>
                <div className="text-right text-xs text-slate-500">{fmt.currency(p.priorRev)}</div>
                <div className={clsx('text-right text-xs font-semibold',
                  p.qtyDelta > 10 ? 'text-emerald-400' : p.qtyDelta < -10 ? 'text-red-400' : 'text-slate-500')}>
                  {p.qtyDelta >= 0 ? '+' : ''}{p.qtyDelta.toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /* ── CUSTOMERS TAB ───────────────────────────────────────────────── */
  const CustomersTab = () => {
    if (!hasShopData) return (
      <p className="text-slate-500 text-sm py-10 text-center">No Shopify orders loaded.</p>
    );

    const curNewPct   = shopCur.count   > 0 ? (shopCur.newCount   / shopCur.count)   * 100 : 0;
    const priorNewPct = shopPrior.count > 0 ? (shopPrior.newCount / shopPrior.count) * 100 : 0;
    const newPctDelta = priorNewPct > 0 ? (curNewPct - priorNewPct) / priorNewPct * 100 : 0;

    const metrics = [
      { label:'Total Orders',     cur: shopCur.count,      prior: shopPrior.count,     fmt: fmt.number   },
      { label:'Avg Order Value',  cur: shopCur.aov,        prior: shopPrior.aov,       fmt: fmt.currency },
      { label:'Total Revenue',    cur: shopCur.revenue,    prior: shopPrior.revenue,   fmt: fmt.currency },
      { label:'New Customers',    cur: shopCur.newCount,   prior: shopPrior.newCount,  fmt: fmt.number   },
      { label:'Repeat Customers', cur: shopCur.repeatCount,prior: shopPrior.repeatCount, fmt: fmt.number },
      { label:'New Customer %',   cur: curNewPct,          prior: priorNewPct,         fmt: v => `${safeNum(v).toFixed(1)}%` },
    ];

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {metrics.map(m => (
            <MetricCard key={m.label} label={m.label} cur={m.cur} prior={m.prior} format={m.fmt} subLabel={`${shopDays}D`} />
          ))}
        </div>

        {/* New vs Repeat donut-style summary */}
        {shopCur.count > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="text-xs font-semibold text-slate-400 mb-4">Customer Mix — Current {shopDays}D</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">New Customers</div>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-white">{fmt.number(shopCur.newCount)}</span>
                  <span className="text-sm text-slate-400 pb-0.5">{curNewPct.toFixed(0)}%</span>
                </div>
                <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${curNewPct}%` }} />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Repeat Customers</div>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-white">{fmt.number(shopCur.repeatCount)}</span>
                  <span className="text-sm text-slate-400 pb-0.5">{(100 - curNewPct).toFixed(0)}%</span>
                </div>
                <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${100 - curNewPct}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-slate-600 flex items-center gap-1">
              <Info size={11} />
              "New" = unique email not seen earlier in the loaded orders. Excludes orders without email.
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ── ROOT CAUSE TAB ──────────────────────────────────────────────── */
  const RootCauseTab = () => {
    if (causes.length === 0) return (
      <div className="flex flex-col items-center gap-3 py-12">
        <CheckCircle size={36} className="text-emerald-500/40" />
        <p className="text-slate-500 text-sm">No significant changes detected — metrics are relatively stable.</p>
        <p className="text-slate-600 text-xs">Thresholds: spend/ROAS ≥10%, CPM/CTR ≥12%, LPV/ATC ≥10%, AOV ≥8%</p>
      </div>
    );

    return (
      <div className="space-y-3">
        <div className="text-xs text-slate-500">
          {causes.length} factor{causes.length !== 1 ? 's' : ''} identified across Meta performance and Shopify data.
          Sorted by severity + impact magnitude.
        </div>

        {causes.map((c, i) => (
          <div key={i} className={clsx(
            'bg-gray-900 rounded-xl border p-4',
            c.severity === 'high'   ? 'border-red-800/40'   : c.severity === 'medium' ? 'border-amber-800/40' : 'border-gray-800',
          )}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  c.direction === 'up'   ? 'bg-emerald-500/20 text-emerald-400' :
                  c.direction === 'down' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-slate-400',
                )}>
                  {c.direction === 'up' ? <TrendingUp size={12} /> : c.direction === 'down' ? <TrendingDown size={12} /> : <Minus size={12} />}
                </span>
                <span className="text-sm font-semibold text-slate-200">{c.factor}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <SevBadge sev={c.severity} />
                <CatBadge cat={c.category} />
                <span className={clsx(
                  'text-xs font-bold',
                  c.direction === 'up' ? 'text-emerald-400' : 'text-red-400',
                )}>
                  {fmtPct(c.impactPct)}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-2">{c.detail}</p>

            {c.action && (
              <div className="flex items-start gap-2 p-2.5 bg-gray-800/60 rounded-lg border border-gray-700/50">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mt-0.5 shrink-0">Action</span>
                <p className="text-[11px] text-slate-300">{c.action}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  /* ─── RENDER ────────────────────────────────────────────────────── */
  const tabContent = [<OverviewTab />, <AdChangesTab />, <FunnelTab />, <ProductsTab />, <CustomersTab />, <RootCauseTab />];

  return (
    <div className="min-h-screen bg-gray-950 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity size={18} className="text-brand-400" />
            Order Change Analysis
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Diagnose why orders increased or decreased — Meta + Shopify cross-analysis
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Shopify window:</span>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setShopDays(d)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                shopDays === d
                  ? 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                  : 'bg-gray-900 border-gray-800 text-slate-400 hover:text-slate-200',
              )}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={clsx(
              'px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-all border-b-2 -mb-px',
              tab === i
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-300',
            )}>
            {t}
            {t === 'Root Cause' && causes.length > 0 && (
              <span className={clsx(
                'ml-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full',
                causes.some(c => c.severity === 'high') ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400',
              )}>
                {causes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>{tabContent[tab]}</div>
    </div>
  );
}
