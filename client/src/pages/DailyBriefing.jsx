import { useState, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, Info,
  ShoppingCart, DollarSign, Eye, MousePointer, Activity, RefreshCw, Zap,
  ChevronDown, ChevronUp, Calendar, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { fetchInsightsCustom } from '../lib/api';
import { normalizeInsight } from '../lib/analytics';
import { buildDayOverDayAnalysis } from '../lib/metaIntelligence';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';

/* ─── helpers ─── */
const fmtN = n => Math.round(n).toLocaleString('en-IN');
const fmtC = n => `₹${fmtN(n)}`;
const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtDec = n => n.toFixed(2);

function fmtVal(v, fmt) {
  if (fmt === 'currency') return fmtC(v);
  if (fmt === 'pct2')     return `${v.toFixed(2)}%`;
  if (fmt === 'decimal')  return fmtDec(v);
  return fmtN(v);
}

const FACTOR_ICONS = {
  spend: DollarSign, efficiency: TrendingUp, impressions: Eye,
  ctr: MousePointer, cpm: Activity, convRate: ShoppingCart, frequency: RefreshCw,
};

const PRIORITY_STYLES = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-300',
  high:     'bg-orange-500/10 border-orange-500/30 text-orange-300',
  medium:   'bg-amber-500/10 border-amber-500/30 text-amber-300',
  info:     'bg-sky-500/10 border-sky-500/30 text-sky-300',
};

const PRIORITY_ICONS = {
  critical: AlertCircle, high: AlertCircle, medium: Info, info: Info,
};

/* ─── Delta badge ─── */
function DeltaBadge({ value, invert = false }) {
  const isPositive = invert ? value < 0 : value > 0;
  const isNeg      = !isPositive && value !== 0;
  return (
    <span className={clsx(
      'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
      value === 0 ? 'bg-gray-700 text-slate-400'
        : isPositive ? 'bg-emerald-500/15 text-emerald-400'
        : 'bg-red-500/15 text-red-400',
    )}>
      {value === 0 ? <Minus size={10} /> : isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {fmtPct(value)}
    </span>
  );
}

/* ─── Factor card ─── */
function FactorCard({ factor, orderDirection }) {
  const Icon = FACTOR_ICONS[factor.id] || BarChart3;
  const helping = factor.positive;
  const big = Math.abs(factor.delta) >= 10;
  const neutral = Math.abs(factor.delta) < 3;

  return (
    <div className={clsx(
      'rounded-xl border p-4 flex flex-col gap-2',
      neutral ? 'border-gray-800 bg-gray-900/40'
        : helping ? 'border-emerald-700/40 bg-emerald-900/10'
        : 'border-red-700/40 bg-red-900/10',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1.5 rounded-lg', neutral ? 'bg-gray-800' : helping ? 'bg-emerald-900/40' : 'bg-red-900/40')}>
            <Icon size={13} className={neutral ? 'text-slate-400' : helping ? 'text-emerald-400' : 'text-red-400'} />
          </div>
          <span className="text-xs font-semibold text-slate-300">{factor.label}</span>
        </div>
        {big && (
          <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded',
            helping ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300')}>
            KEY DRIVER
          </span>
        )}
      </div>

      <div className="flex items-end gap-3">
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">Yesterday</div>
          <div className="text-sm font-bold text-white">{fmtVal(factor.yd, factor.format)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">Day Before</div>
          <div className="text-sm font-bold text-slate-400">{fmtVal(factor.db, factor.format)}</div>
        </div>
        <div className="ml-auto">
          <DeltaBadge value={factor.delta} invert={['cpm', 'frequency'].includes(factor.id)} />
        </div>
      </div>

      {factor.id === 'efficiency' && factor.roasYd != null && (
        <div className="text-[10px] text-slate-400">
          ROAS: {factor.roasDb?.toFixed(2)}x → {factor.roasYd?.toFixed(2)}x
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">{factor.detail}</p>
    </div>
  );
}

/* ─── Funnel row ─── */
function FunnelRow({ stage, yd, db, delta, change, format }) {
  const isUp = delta > 3;
  const isDn = delta < -3;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800/60 last:border-0">
      <div className="w-36 text-xs text-slate-400 shrink-0">{stage}</div>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all', isUp ? 'bg-emerald-500' : isDn ? 'bg-red-500' : 'bg-gray-600')}
          style={{ width: `${Math.min(100, (yd / (Math.max(yd, db) || 1)) * 100)}%` }}
        />
      </div>
      <div className="w-20 text-xs text-right font-mono text-white">{fmtN(yd)}</div>
      <div className="w-20 text-xs text-right font-mono text-slate-500">{fmtN(db)}</div>
      <div className="w-16 text-xs text-right">
        <DeltaBadge value={delta} />
      </div>
    </div>
  );
}

/* ─── Ad driver row ─── */
function AdDriverRow({ d }) {
  const typeColor = {
    new: 'bg-sky-500/20 text-sky-300',
    started: 'bg-emerald-500/20 text-emerald-300',
    stopped: 'bg-red-500/20 text-red-300',
    efficiency: 'bg-amber-500/20 text-amber-300',
    changed: 'bg-gray-700 text-slate-400',
  };
  return (
    <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
      <td className="py-2 pr-3 text-xs text-slate-300 max-w-[220px] truncate">{d.adName}</td>
      <td className="py-2 pr-3">
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', typeColor[d.type] || typeColor.changed)}>
          {d.label}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs text-right font-mono text-white">{fmtC(d.spendYd)}</td>
      <td className="py-2 pr-3 text-xs text-right font-mono text-slate-400">{fmtC(d.spendDb)}</td>
      <td className="py-2 pr-3 text-xs text-right font-mono text-white">{d.purchYd.toFixed(1)}</td>
      <td className="py-2 pr-3 text-xs text-right font-mono text-slate-400">{d.purchDb.toFixed(1)}</td>
      <td className="py-2 pr-3 text-xs text-right font-mono text-white">{d.roasYd.toFixed(2)}x</td>
      <td className="py-2 text-xs text-right">
        <span className={clsx('font-bold', d.impact > 0 ? 'text-emerald-400' : d.impact < 0 ? 'text-red-400' : 'text-slate-500')}>
          {d.impact > 0 ? '+' : ''}{d.impact.toFixed(1)}
        </span>
      </td>
    </tr>
  );
}

/* ─── Main page ─── */
export default function DailyBriefing() {
  const { brands, brandData, shopifyOrders, activeBrandIds } = useStore();

  // Last-30d cross-channel spend context (from the auto-pulled Google Ads data)
  const channelContext = useMemo(() => {
    const activeIds = activeBrandIds || [];
    const google = activeIds.reduce((acc, bid) => {
      const d = brandData?.[bid]?.googleAdsData;
      if (!d) return acc;
      const t = totalsFromNormalized(d);
      acc.spend   += t.spend;
      acc.revenue += t.conversionValue;
      return acc;
    }, { spend: 0, revenue: 0 });
    return google.spend > 0 ? google : null;
  }, [brandData, activeBrandIds]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [logs, setLogs] = useState([]);
  const [analyses, setAnalyses] = useState([]); // one per brand
  const [showAdDrivers, setShowAdDrivers] = useState({});

  const ydDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const dbDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  }, []);

  const fmtLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  const handlePull = async () => {
    setStatus('loading');
    setLogs([]);
    setAnalyses([]);
    const log = msg => setLogs(prev => [...prev, msg]);

    try {
      const configs = brands.flatMap(b =>
        (b.accounts || []).map(acc => ({ brand: b, acc }))
      );

      const results = [];

      for (const { brand: b, acc } of configs) {
        const ver   = b.apiVersion || 'v21.0';
        const token = b.accessToken;

        log(`[${acc.key}] Fetching ${ydDate} (yesterday)...`);
        const rawYd = await fetchInsightsCustom(ver, token, acc.id, ydDate, ydDate, msg => log(`  ${msg}`));
        const ydRows = rawYd.map(r => normalizeInsight(r, acc.key, 'YD'));

        log(`[${acc.key}] Fetching ${dbDate} (day before)...`);
        const rawDb = await fetchInsightsCustom(ver, token, acc.id, dbDate, dbDate, msg => log(`  ${msg}`));
        const dbRows = rawDb.map(r => normalizeInsight(r, acc.key, 'DB'));

        log(`[${acc.key}] ✓ YD:${ydRows.length} ads · DB:${dbRows.length} ads`);

        const analysis = buildDayOverDayAnalysis(ydRows, dbRows, shopifyOrders, { yd: ydDate, db: dbDate });
        results.push({ brandName: b.name || acc.key, accKey: acc.key, analysis });
      }

      setAnalyses(results);
      setStatus('done');
    } catch (e) {
      log(`ERROR: ${e.message}`);
      setStatus('error');
    }
  };

  const combined = useMemo(() => {
    if (!analyses.length) return null;
    const valid = analyses.filter(a => !a.analysis.error);
    if (!valid.length) return null;

    // If single brand, just return it; otherwise combine
    if (valid.length === 1) return valid[0].analysis;

    // Aggregate across brands
    const agg = (key) => valid.reduce((s, a) => s + (a.analysis[key] || 0), 0);
    const orderDelta = agg('orderDelta');
    return {
      ...valid[0].analysis,
      orderDelta,
      orderDeltaPct: valid[0].analysis.db.purchases > 0 ? (orderDelta / valid[0].analysis.db.purchases) * 100 : 0,
      direction: orderDelta > 0.5 ? 'up' : orderDelta < -0.5 ? 'down' : 'flat',
      _multi: true,
    };
  }, [analyses]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar size={20} className="text-brand-400" />
            Daily Order Analysis
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Why did orders go up or down? Full factor breakdown for{' '}
            <span className="text-white font-medium">{fmtLabel(ydDate)}</span>{' '}
            vs{' '}
            <span className="text-white font-medium">{fmtLabel(dbDate)}</span>
          </p>
        </div>
        {channelContext && (
          <div className="text-[10px] text-slate-500 text-right leading-relaxed">
            <div className="font-semibold text-slate-400 mb-0.5">Google Ads 30d context</div>
            <div>{fmtC(channelContext.spend)} spend · {fmtC(channelContext.revenue)} value</div>
            <div>ROAS {channelContext.spend > 0 ? fmtDec(channelContext.revenue / channelContext.spend) : '—'}</div>
          </div>
        )}
        <button
          onClick={handlePull}
          disabled={status === 'loading' || !brands.length}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
            status === 'loading'
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-brand-600 hover:bg-brand-500 text-white',
          )}
        >
          <Zap size={14} />
          {status === 'loading' ? 'Analysing...' : 'Pull & Analyse'}
        </button>
      </div>

      {/* Logs */}
      {logs.length > 0 && status === 'loading' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 max-h-36 overflow-y-auto">
          {logs.map((l, i) => (
            <div key={i} className="text-[11px] font-mono text-slate-400">{l}</div>
          ))}
        </div>
      )}

      {/* Idle state */}
      {status === 'idle' && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-10 text-center">
          <Calendar size={40} className="mx-auto text-slate-600 mb-3" />
          <div className="text-slate-400 font-medium">Click "Pull & Analyse" to run the day-over-day diagnosis</div>
          <div className="text-xs text-slate-600 mt-1">Fetches yesterday + day-before from Meta · runs multi-factor analysis · explains exactly why orders moved</div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
          Fetch failed — check logs above. Make sure API tokens are configured in Study Manual.
        </div>
      )}

      {/* Per-brand analyses */}
      {status === 'done' && analyses.map(({ brandName, accKey, analysis }) => {
        if (analysis.error) return (
          <div key={accKey} className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
            {brandName}: {analysis.error}
          </div>
        );

        const { direction, orderDelta, orderDeltaPct, primaryReason, factors, decomposition, funnelDeltas, adDrivers, shopify, recommendations, yd, db, dayName, isWeekend } = analysis;

        const showAds = showAdDrivers[accKey];

        return (
          <div key={accKey} className="space-y-5">
            {/* Brand label if multi-brand */}
            {analyses.length > 1 && (
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 px-1">{brandName}</div>
            )}

            {/* Hero: Order delta */}
            <div className={clsx(
              'rounded-2xl border p-6',
              direction === 'up'   ? 'bg-emerald-900/15 border-emerald-700/40'
              : direction === 'down' ? 'bg-red-900/15 border-red-700/40'
              : 'bg-gray-900/50 border-gray-700/40',
            )}>
              <div className="flex items-start gap-4">
                <div className={clsx(
                  'p-3 rounded-xl',
                  direction === 'up' ? 'bg-emerald-500/20' : direction === 'down' ? 'bg-red-500/20' : 'bg-gray-700',
                )}>
                  {direction === 'up' ? <TrendingUp size={24} className="text-emerald-400" />
                    : direction === 'down' ? <TrendingDown size={24} className="text-red-400" />
                    : <Minus size={24} className="text-slate-400" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className={clsx(
                      'text-4xl font-black',
                      direction === 'up' ? 'text-emerald-400' : direction === 'down' ? 'text-red-400' : 'text-slate-400',
                    )}>
                      {orderDelta > 0 ? '+' : ''}{orderDelta.toFixed(1)} orders
                    </span>
                    <span className={clsx(
                      'text-lg font-bold',
                      direction === 'up' ? 'text-emerald-500' : direction === 'down' ? 'text-red-500' : 'text-slate-500',
                    )}>
                      {fmtPct(orderDeltaPct)}
                    </span>
                  </div>
                  <div className="text-sm text-slate-300 mt-1 font-medium">{primaryReason}</div>

                  <div className="flex gap-6 mt-3 flex-wrap text-xs text-slate-500">
                    <span>Yesterday: <span className="text-white font-semibold">{yd.purchases.toFixed(1)} orders · ₹{fmtN(yd.spend)} spend · {yd.roas.toFixed(2)}x ROAS</span></span>
                    <span>Day Before: <span className="text-slate-300 font-semibold">{db.purchases.toFixed(1)} orders · ₹{fmtN(db.spend)} spend · {db.roas.toFixed(2)}x ROAS</span></span>
                    {isWeekend && <span className="text-amber-400 font-medium">⚠ {dayName} — weekend data</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Factor grid */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Factor Analysis (ranked by impact)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {factors.map(f => <FactorCard key={f.id} factor={f} orderDirection={direction} />)}
              </div>
            </div>

            {/* Decomposition + Funnel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Mathematical decomposition */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Order Change Decomposition</h3>
                <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
                  Δorders = <span className="text-white">spend contribution</span> + <span className="text-white">efficiency contribution</span> + unexplained
                </p>
                {[
                  { label: 'Spend contribution', value: decomposition.spendContrib, detail: 'Orders from budget change at prev. efficiency' },
                  { label: 'Efficiency contribution', value: decomposition.efficiencyContrib, detail: 'Orders from ROAS/CPR shift on yesterday\'s budget' },
                  { label: 'Unexplained / attribution lag', value: decomposition.unexplained, detail: 'Residual — day-of seasonality, attribution window' },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0">
                    <div className="flex-1">
                      <div className="text-xs text-slate-300 font-medium">{row.label}</div>
                      <div className="text-[10px] text-slate-600">{row.detail}</div>
                    </div>
                    <span className={clsx('text-sm font-bold', row.value > 0 ? 'text-emerald-400' : row.value < 0 ? 'text-red-400' : 'text-slate-500')}>
                      {row.value > 0 ? '+' : ''}{row.value.toFixed(1)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 mt-1">
                  <span className="text-xs font-bold text-slate-400">Total explained</span>
                  <span className={clsx('text-sm font-black', decomposition.total > 0 ? 'text-emerald-400' : decomposition.total < 0 ? 'text-red-400' : 'text-slate-500')}>
                    {decomposition.total > 0 ? '+' : ''}{decomposition.total.toFixed(1)} orders
                  </span>
                </div>
              </div>

              {/* Funnel deltas */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Funnel Stage Shifts</h3>
                <div className="flex text-[10px] text-slate-600 mb-2 gap-3">
                  <div className="w-36">Stage</div>
                  <div className="flex-1" />
                  <div className="w-20 text-right">Yesterday</div>
                  <div className="w-20 text-right">Day Before</div>
                  <div className="w-16 text-right">Δ</div>
                </div>
                {funnelDeltas.map(f => <FunnelRow key={f.stage} {...f} />)}
              </div>
            </div>

            {/* Shopify confirmation */}
            {shopify && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Shopify Order Confirmation</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Shopify Orders (YD)',    value: shopify.yd.orders,                               fmt: 'n' },
                    { label: 'Shopify Revenue (YD)',   value: shopify.yd.revenue,                              fmt: 'c' },
                    { label: 'Shopify Orders (DB)',    value: shopify.db.orders,                               fmt: 'n' },
                    { label: 'Δ Orders (Shopify)',     value: shopify.yd.orders - shopify.db.orders,           fmt: 'delta' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-900 rounded-lg p-3">
                      <div className="text-[10px] text-slate-500 mb-1">{k.label}</div>
                      <div className={clsx('text-lg font-bold',
                        k.fmt === 'delta' && k.value > 0 ? 'text-emerald-400' : k.fmt === 'delta' && k.value < 0 ? 'text-red-400' : 'text-white',
                      )}>
                        {k.fmt === 'c' ? fmtC(k.value) : k.fmt === 'delta' ? `${k.value > 0 ? '+' : ''}${k.value}` : fmtN(k.value)}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-3">
                  Meta attribution includes view-through conversions. Shopify shows actual placed orders. Expect Meta to report ~10-40% more than Shopify.
                </p>
              </div>
            )}

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Action Plan</h2>
                <div className="space-y-2">
                  {recommendations.map((r, i) => {
                    const Icon = PRIORITY_ICONS[r.priority] || Info;
                    return (
                      <div key={i} className={clsx('flex items-start gap-3 rounded-xl border p-3', PRIORITY_STYLES[r.priority])}>
                        <Icon size={14} className="mt-0.5 shrink-0" />
                        <div>
                          <div className="text-xs font-semibold">{r.action}</div>
                          <div className="text-[11px] opacity-80 mt-0.5 leading-relaxed">{r.detail}</div>
                        </div>
                        <div className="ml-auto shrink-0">
                          <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">{r.priority}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ad-level drivers */}
            {adDrivers.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/30 transition-colors"
                  onClick={() => setShowAdDrivers(s => ({ ...s, [accKey]: !s[accKey] }))}
                >
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Ad-Level Drivers ({adDrivers.length} ads moved)
                  </h3>
                  {showAds ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                </button>
                {showAds && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['Ad Name','Type','Spend YD','Spend DB','Orders YD','Orders DB','ROAS YD','Δ Orders'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] text-slate-500 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {adDrivers.map(d => <AdDriverRow key={d.adId} d={d} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
