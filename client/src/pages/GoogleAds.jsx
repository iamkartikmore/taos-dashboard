import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import {
  Search, TrendingUp, Monitor, Clock, Users, ShoppingBag,
  Target, RefreshCw, Zap, ChevronRight, Download, Brain,
  Package, AlertTriangle, GhostIcon, PackageX, Link2Off,
  Stethoscope, TrendingDown, GitBranch,
  Tag, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';
import { useStore } from '../store';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';
import { blendAdsMerchant, shopifyBySkuFromOrders, aggregateShoppingBySku } from '../lib/googleAdsMerchantBlend';
import { diagnose, skuImpactChain } from '../lib/dropDiagnostics';
import { buildPriceSuggestions } from '../lib/priceSuggestions';
import GoogleAdsIntel from './GoogleAdsIntel';

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const n    = v => parseFloat(v || 0);
const cur  = v => `₹${n(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const num  = v => n(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct  = v => `${(n(v) * 100).toFixed(2)}%`;
const pct1 = v => `${n(v).toFixed(2)}%`; // for CTR already a fraction? google returns fraction so pct() is right
const dec  = (v, d = 2) => n(v).toFixed(d);

const DOW_SHORT = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat',
};

const COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#60a5fa'];

function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c => `"${c.label}"`).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = c.fn ? c.fn(r) : (r[c.key] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ─── SHARED UI ──────────────────────────────────────────────────── */
function CT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl min-w-[160px]">
      {label && <div className="font-semibold text-slate-200 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="text-slate-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          {p.name}: <span className="font-bold text-white ml-auto pl-2">
            {/cost|spend|rev|value/i.test(p.name) ? cur(p.value)
              : /roas|rate|ctr/i.test(p.name) ? dec(p.value, 2)
              : num(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function KPI({ label, value, sub, color = '#f59e0b' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function PmaxHint({ tab, onShopping }) {
  return (
    <div className="px-4 py-4 mb-3 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs text-amber-200">
      <div className="font-semibold mb-1">This is a Performance Max campaign — it doesn't expose {tab}.</div>
      <div className="text-amber-200/70 leading-relaxed">
        Pmax uses Google's AI to match queries internally across Search, Shopping, YouTube, and Display. There are no per-ad-group {tab} to inspect — only asset groups and the SKU-level shopping mix.{' '}
        {onShopping && <button onClick={onShopping} className="underline hover:text-amber-100">View the SKU mix instead →</button>}
      </div>
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── SORTABLE TABLE ─────────────────────────────────────────────── */
function SortableTable({ rows, cols, defaultSort, maxHeight = '520px', onRowClick }) {
  const [sort, setSort] = useState(defaultSort || { key: cols[0]?.key, dir: 'desc' });
  const sorted = useMemo(() => {
    const arr = [...rows];
    if (!sort?.key) return arr;
    arr.sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'desc' ? bv - av : av - bv;
      return sort.dir === 'desc' ? String(bv || '').localeCompare(String(av || '')) : String(av || '').localeCompare(String(bv || ''));
    });
    return arr;
  }, [rows, sort]);

  const toggleSort = k => setSort(s => s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' });

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
          <tr>
            {cols.map(c => (
              <th key={c.key} onClick={() => toggleSort(c.key)}
                className={`px-3 py-2.5 text-slate-400 font-semibold cursor-pointer hover:text-white transition-colors ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r._key || r.id || i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`${i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'} ${onRowClick ? 'cursor-pointer hover:bg-amber-900/10' : ''}`}>
              {cols.map(c => (
                <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right font-mono' : 'text-slate-300'} ${c.className || ''}`}>
                  {c.fn ? c.fn(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-600 text-xs italic">No rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── TABS ───────────────────────────────────────────────────────── */
const TABS = [
  { id: 'overview',    label: 'Overview',     icon: Zap },
  { id: 'intel',       label: 'Intelligence', icon: Brain },
  { id: 'rootcause',   label: 'Root Cause',   icon: Stethoscope },
  { id: 'pricing',     label: 'Pricing',      icon: Tag },
  { id: 'feed',        label: 'Feed Health',  icon: Package },
  { id: 'campaigns',   label: 'Campaigns',    icon: Target },
  { id: 'adgroups',    label: 'Ad Groups',    icon: Target },
  { id: 'ads',         label: 'Ads',          icon: Target },
  { id: 'keywords',    label: 'Keywords',     icon: Search },
  { id: 'searchterms', label: 'Search Terms', icon: Search },
  { id: 'devices',     label: 'Devices',      icon: Monitor },
  { id: 'hours',       label: 'Hours & Days', icon: Clock },
  { id: 'demo',        label: 'Demographics', icon: Users },
  { id: 'shopping',    label: 'Shopping',     icon: ShoppingBag },
];

/* ─── ROOT CAUSE TAB ──────────────────────────────────────────────
   For every dropping campaign, show ranked causes with auto-generated
   narrative + drill-down to the exact SKU → ad group → ad → keyword →
   search term chain. Cross-referenced against Shopify organic WoW and
   Meta WoW so the operator can see whether the drop is Google-specific
   or a demand-wide softening.
   ─────────────────────────────────────────────────────────────────── */
function RootCauseTab({ diag, data, onDrillCampaign }) {
  const [open, setOpen] = useState({}); // { [campaignId]: 'evidence' | 'chain' | null }

  if (!diag) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <Stethoscope size={36} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No Google Ads daily data to diagnose.</p>
      </div>
    );
  }

  const { droppingCampaigns, meta, shop, totals } = diag;

  /* ── ONE-LINE VERDICT ──────────────────────────────────────────── */
  const verdict = (() => {
    const gAdsNeg = totals.totalRevDelta < 0;
    const shopPct = shop?.totals?.deltaRevPct;
    const metaPct = meta?.deltaRevPct;
    if (!gAdsNeg) return { tone: 'good', text: 'Google Ads revenue is flat or up week-over-week. No systemic drop.' };
    if (shopPct != null && shopPct < -0.05 && metaPct != null && metaPct < -0.05)
      return { tone: 'warn', text: 'All channels are down — this is a demand-side issue, not a Google problem.' };
    if ((shopPct == null || shopPct >= -0.05) && (metaPct == null || metaPct >= -0.05))
      return { tone: 'bad', text: 'Drop is Google-only. Shopify + Meta are holding, so fix the feed, check change events, or look for OOS SKUs.' };
    return { tone: 'warn', text: 'Partial channel drop. Check SKU overlap between dropping campaigns and stockouts.' };
  })();

  const toneColors = {
    good: 'border-emerald-800/40 bg-emerald-900/20 text-emerald-200',
    warn: 'border-amber-800/40  bg-amber-900/20  text-amber-200',
    bad:  'border-red-800/40    bg-red-900/20    text-red-200',
  };

  const causeLabel = c => ({
    sku_outage:          'Out of stock',
    feed_disapproval:    'Feed disapproved',
    change_event:        'Someone edited settings',
    impression_collapse: 'Lost auctions',
    conversion_collapse: 'Landing page / offer',
  })[c] || c;

  const causeIcon = c =>
    c === 'sku_outage'          ? <PackageX       size={14} className="text-orange-400" /> :
    c === 'feed_disapproval'    ? <AlertTriangle  size={14} className="text-red-400"    /> :
    c === 'change_event'        ? <GitBranch      size={14} className="text-blue-400"   /> :
    c === 'impression_collapse' ? <TrendingDown   size={14} className="text-amber-400"  /> :
    c === 'conversion_collapse' ? <TrendingDown   size={14} className="text-amber-400"  /> :
                                  <Stethoscope    size={14} />;

  const sevPill = s =>
    s === 'critical' ? 'bg-red-900/50 text-red-200'     :
    s === 'high'     ? 'bg-orange-900/50 text-orange-200' :
    s === 'medium'   ? 'bg-amber-900/40 text-amber-300'   :
                       'bg-slate-800 text-slate-400';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* ── VERDICT STRIP ─────────────────────────────────────────── */}
      <div className={`px-5 py-4 rounded-xl border ${toneColors[verdict.tone]}`}>
        <div className="flex items-center gap-3">
          <Stethoscope size={18} />
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Verdict</div>
            <div className="text-sm font-medium mt-0.5">{verdict.text}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] opacity-70 uppercase tracking-wider">WoW Rev Δ</div>
            <div className="text-lg font-bold font-mono">{cur(totals.totalRevDelta)}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-current/10 text-[11px]">
          <div><span className="opacity-60">Dropping campaigns:</span> <span className="font-semibold">{num(totals.droppingCount)}</span></div>
          <div><span className="opacity-60">Shopify WoW:</span> <span className="font-semibold">{shop?.totals?.deltaRevPct != null ? `${shop.totals.deltaRevPct > 0 ? '+' : ''}${(shop.totals.deltaRevPct * 100).toFixed(0)}%` : '—'}</span></div>
          <div><span className="opacity-60">Meta WoW:</span> <span className="font-semibold">{meta?.deltaRevPct != null ? `${meta.deltaRevPct > 0 ? '+' : ''}${(meta.deltaRevPct * 100).toFixed(0)}%` : '—'}</span></div>
        </div>
      </div>

      {/* ── PER-CAMPAIGN ACTION CARDS ─────────────────────────────── */}
      {droppingCampaigns.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-400">
          No campaigns materially down week-over-week. Nothing to fix today.
        </div>
      ) : (
        <div className="space-y-3">
          {droppingCampaigns.map(c => {
            const top = c.causes[0];
            const openMode = open[c.campaignId];
            const showEvidence = openMode === 'evidence';
            const showChain    = openMode === 'chain';
            const chain = showChain ? skuImpactChain({
              sku: c.causes.find(x => x.cause === 'sku_outage')?.evidence?.[0]?.sku,
              shoppingByCampaign: data?.shoppingByCampaign || [],
              adGroups: data?.adGroups || [],
              ads: data?.ads || [],
              keywords: data?.keywords || [],
              searchTerms: data?.searchTerms || [],
            }) : null;

            return (
              <div key={c.campaignId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {/* Headline row */}
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-sm font-semibold text-white truncate mb-1">{c.campaignName || c.campaignId}</div>
                      <div className="text-[11px] text-slate-500">
                        Revenue <span className="text-red-400 font-semibold">{cur(c.recentRev)}</span>
                        <span className="text-slate-600"> (was {cur(c.priorRev)}, </span>
                        <span className="text-red-400">{c.deltaRevPct != null ? `${(c.deltaRevPct * 100).toFixed(0)}%` : '—'}</span>
                        <span className="text-slate-600">)</span>
                        <span className="mx-2 text-slate-700">·</span>
                        ROAS <span className="text-slate-300">{dec(c.recentRoas, 2)}</span>
                        <span className="text-slate-600"> was {dec(c.priorRoas, 2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* THE headline cause (top one only) */}
                  {!top ? (
                    <div className="mt-3 px-3 py-3 rounded-lg bg-gray-950 border border-gray-800 text-[12px] text-slate-400">
                      No specific signal. Likely auction noise or seasonality — monitor another week.
                    </div>
                  ) : (
                    <div className="mt-3 px-3 py-3 rounded-lg bg-gray-950 border border-gray-800">
                      <div className="flex items-center gap-2 mb-1.5">
                        {causeIcon(top.cause)}
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{causeLabel(top.cause)}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider ${sevPill(top.severity)}`}>{top.severity}</span>
                        {c.causes.length > 1 && <span className="text-[10px] text-slate-600">+{c.causes.length - 1} more</span>}
                      </div>
                      <div className="text-[13px] text-slate-200 font-semibold">{top.headline}</div>
                      <div className="text-[12px] text-amber-300 mt-1.5 flex items-start gap-1.5">
                        <span className="text-amber-500">→</span>
                        <span>{top.action}</span>
                      </div>
                    </div>
                  )}

                  {/* Collapsed action buttons */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {c.causes.length > 0 && (
                      <button onClick={() => setOpen(o => ({ ...o, [c.campaignId]: showEvidence ? null : 'evidence' }))}
                        className="text-[10px] px-2.5 py-1.5 rounded bg-gray-800 text-slate-300 hover:bg-gray-700">
                        {showEvidence ? 'Hide' : 'Show'} evidence {c.causes.length > 1 ? `& ${c.causes.length - 1} other cause${c.causes.length > 2 ? 's' : ''}` : ''}
                      </button>
                    )}
                    {c.causes.some(x => x.cause === 'sku_outage') && (
                      <button onClick={() => setOpen(o => ({ ...o, [c.campaignId]: showChain ? null : 'chain' }))}
                        className="text-[10px] px-2.5 py-1.5 rounded bg-gray-800 text-slate-300 hover:bg-gray-700">
                        {showChain ? 'Hide' : 'Trace'} SKU → ad → search term
                      </button>
                    )}
                    <button onClick={() => onDrillCampaign({ id: c.campaignId, name: c.campaignName })}
                      className="text-[10px] px-2.5 py-1.5 rounded bg-amber-900/30 text-amber-300 border border-amber-800/40 hover:bg-amber-900/50 ml-auto">
                      Open search terms →
                    </button>
                  </div>
                </div>

                {/* Evidence panel (collapsed by default) */}
                {showEvidence && (
                  <div className="border-t border-gray-800 bg-gray-950/60 px-5 py-4 space-y-3">
                    {c.causes.map((cs, i) => (
                      <div key={i} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          {causeIcon(cs.cause)}
                          <span className="text-[11px] font-bold text-slate-300">{causeLabel(cs.cause)}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider ${sevPill(cs.severity)}`}>{cs.severity}</span>
                          {cs.impactSpend > 0 && <span className="text-[10px] text-slate-500">{cur(cs.impactSpend)} affected</span>}
                        </div>
                        <div className="text-[12px] text-slate-300 pl-5">{cs.headline}</div>
                        <div className="text-[11px] text-amber-300/80 pl-5">→ {cs.action}</div>
                        {cs.evidence?.length > 0 && (
                          <ul className="pl-5 mt-1 text-[11px] text-slate-400 space-y-0.5">
                            {cs.evidence.slice(0, 3).map((ev, j) => (
                              <li key={j} className="truncate">
                                {ev.sku ? (
                                  <>
                                    <span className="text-slate-200">{ev.title || ev.sku}</span>
                                    <span className="text-slate-600"> · </span>
                                    {ev.costShare != null && <span>{(ev.costShare * 100).toFixed(0)}% of spend · </span>}
                                    {ev.daysOut != null && <span className="text-orange-400">{ev.daysOut}d out</span>}
                                    {ev.issue && <span className="text-red-400">{ev.issue}</span>}
                                  </>
                                ) : ev.operation ? (
                                  <span>{ev.ts?.slice(0, 10)} · {ev.user || 'unknown'} · {ev.operation} on {ev.resourceType}</span>
                                ) : null}
                              </li>
                            ))}
                            {cs.evidence.length > 3 && (
                              <li className="text-slate-600 italic">+ {cs.evidence.length - 3} more</li>
                            )}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Chain trace */}
                {showChain && chain?.campaigns?.length > 0 && (() => {
                  const cc = chain.campaigns.find(x => x.campaignId === c.campaignId);
                  if (!cc) return null;
                  return (
                    <div className="border-t border-gray-800 bg-gray-950/60 px-5 py-4 text-[11px] space-y-3">
                      <div className="text-slate-400">
                        SKU <span className="font-mono text-white">{chain.sku}</span> accounted for{' '}
                        <span className="text-amber-300 font-semibold">{(cc.costShareInCampaign * 100).toFixed(0)}%</span> of this campaign's shopping spend.
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
                        <div>
                          <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top ad groups</div>
                          {cc.topAdGroups.length === 0 ? <div className="text-slate-600 italic">—</div> :
                            cc.topAdGroups.map(ag => (
                              <div key={ag.id} className="text-slate-300 truncate">{ag.name} · {cur(ag.cost)}</div>
                            ))}
                        </div>
                        <div>
                          <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top search terms</div>
                          {cc.topSearchTerms.length === 0 ? <div className="text-slate-600 italic">—</div> :
                            cc.topSearchTerms.map((st, si) => (
                              <div key={si} className="text-slate-300 truncate">"{st.searchTerm}" · {cur(st.cost)}</div>
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

/* ─── PRICING TAB ─────────────────────────────────────────────────
   Google Merchant Center-style sale-price suggestions, reconstructed
   from 90d Shopify orders + Google Ads per-SKU metrics + feed peer
   benchmarks. See priceSuggestions.js for the algorithm.
   ─────────────────────────────────────────────────────────────────── */
function PricingTab({ pricing }) {
  const [filter, setFilter] = useState('all'); // all | lower | raise

  if (!pricing || !pricing.suggestions.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <Tag size={36} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No price suggestions yet.</p>
        <p className="text-[11px] text-slate-600 mt-1">We need Shopify orders + Google Ads shopping data (and ideally a merchant feed) to benchmark prices.</p>
      </div>
    );
  }

  const { suggestions, totals } = pricing;
  const filtered = filter === 'lower' ? suggestions.filter(s => s.deltaPct < 0)
                : filter === 'raise'  ? suggestions.filter(s => s.deltaPct > 0)
                : suggestions;

  const methodLabel = m => ({
    historical:             'historical A/B',
    discount_response:      'discount tested',
    peer_benchmark:         'peer benchmark',
    peer_benchmark_raise:   'peer benchmark',
  })[m] || m;

  const effPill = e =>
    e === 'high'   ? 'bg-emerald-900/40 text-emerald-300' :
    e === 'medium' ? 'bg-amber-900/40 text-amber-300'     :
                     'bg-slate-800 text-slate-500';

  const confDot = c =>
    c === 'high'   ? '●●●' :
    c === 'medium' ? '●●○' :
                     '●○○';

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Verdict strip */}
      <div className="px-5 py-4 rounded-xl border border-amber-800/40 bg-amber-900/20 text-amber-200">
        <div className="flex items-center gap-3">
          <Tag size={18} />
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Pricing review</div>
            <div className="text-sm font-medium mt-0.5">
              {totals.count} SKU{totals.count > 1 ? 's' : ''} flagged from the last {totals.windowDays} days of orders.
              {totals.estRevUplift > 0 && <> Estimated upside if all applied: <span className="font-semibold">{cur(totals.estRevUplift)}</span>.</>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-amber-800/30 text-[11px]">
          <div><span className="opacity-60">Total:</span> <span className="font-semibold">{num(totals.count)}</span></div>
          <div><span className="opacity-60">Lower price:</span> <span className="font-semibold text-orange-300">{num(totals.toLower)}</span></div>
          <div><span className="opacity-60">Raise price:</span> <span className="font-semibold text-emerald-300">{num(totals.toRaise)}</span></div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5">
        {[
          { id: 'all',   label: `All (${totals.count})` },
          { id: 'lower', label: `Lower (${totals.toLower})`, icon: ArrowDownCircle },
          { id: 'raise', label: `Raise (${totals.toRaise})`, icon: ArrowUpCircle  },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ${filter === f.id ? 'bg-amber-900/30 text-amber-300 border border-amber-800/40' : 'bg-gray-900 text-slate-400 border border-gray-800 hover:text-slate-200'}`}>
            {f.icon && <f.icon size={12} />} {f.label}
          </button>
        ))}
      </div>

      {/* Suggestions table */}
      <Card title={`${filtered.length} SKUs`} action={
        <button onClick={() => exportCSV('price-suggestions.csv', filtered, [
          { key: 'sku',             label: 'SKU' },
          { key: 'title',           label: 'Title' },
          { key: 'currentPrice',    label: 'Current Price' },
          { key: 'suggestedPrice',  label: 'Suggested Price' },
          { key: 'deltaPct',        label: 'Δ%', fn: r => (r.deltaPct * 100).toFixed(1) + '%' },
          { key: 'method',          label: 'Method' },
          { key: 'confidence',      label: 'Confidence' },
          { key: 'evidence',        label: 'Evidence' },
          { key: 'clickUplift',     label: 'Click Uplift', fn: r => r.clickUplift != null ? (r.clickUplift * 100).toFixed(1) + '%' : '' },
          { key: 'conversionUplift', label: 'Conv Uplift', fn: r => r.conversionUplift != null ? (r.conversionUplift * 100).toFixed(1) + '%' : '' },
          { key: 'effectiveness',   label: 'Effectiveness' },
          { key: 'units90d',        label: 'Units 90d' },
          { key: 'rev90d',          label: 'Revenue 90d' },
          { key: 'adSpend',         label: 'Ad Spend' },
        ])} className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"><Download size={10} /> CSV</button>
      }>
        <div className="overflow-auto" style={{ maxHeight: '640px' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Product</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Current</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Suggested</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Δ</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Click ↑</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Conv ↑</th>
                <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Effect</th>
                <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Evidence</th>
                <th className="px-3 py-2.5 text-right text-slate-400 font-semibold">Units 90d</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.sku} className={`${i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'} hover:bg-amber-900/10`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {s.image && <img src={s.image} alt="" className="w-8 h-8 rounded object-cover bg-gray-800" onError={e => { e.target.style.display = 'none'; }} />}
                      <div className="min-w-0">
                        {s.link ? (
                          <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300 truncate max-w-[220px] inline-block">{s.title}</a>
                        ) : (
                          <span className="text-slate-200 truncate max-w-[220px] inline-block">{s.title}</span>
                        )}
                        <div className="text-[10px] text-slate-600 font-mono truncate max-w-[220px]">{s.sku}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(s.currentPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-white">{cur(s.suggestedPrice)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${s.deltaPct < 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                    {s.deltaPct > 0 ? '+' : ''}{(s.deltaPct * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {s.clickUplift != null ? <span className="text-emerald-400">+{(s.clickUplift * 100).toFixed(1)}%</span> : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {s.conversionUplift != null ? <span className="text-emerald-400">+{(s.conversionUplift * 100).toFixed(1)}%</span> : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${effPill(s.effectiveness)}`}>{s.effectiveness}</span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">
                    <span className="text-slate-400">{methodLabel(s.method)}</span>{' '}
                    <span className="text-slate-600 font-mono" title={`confidence: ${s.confidence}`}>{confDot(s.confidence)}</span>
                    <div className="text-[10px] text-slate-600 truncate max-w-[260px]">{s.evidence}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{num(s.units90d)}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-600 text-xs italic">No suggestions match this filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* How it works — tiny footnote so the user trusts the numbers */}
      <div className="px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-[11px] text-slate-500 leading-relaxed">
        <div className="font-semibold text-slate-400 mb-1">How we compute this:</div>
        <div><span className="text-slate-300">Historical A/B (●●●):</span> SKUs that sold at ≥2 price points in 90d — we pick the revenue-maximizing point. Strongest signal because it was tested in your store.</div>
        <div><span className="text-slate-300">Discount tested (●●○):</span> Full-price vs discounted-order velocity from your Shopify line items.</div>
        <div><span className="text-slate-300">Peer benchmark (●○○):</span> SKUs priced &gt;15% above same-category median with CTR/CVR trailing peers.</div>
      </div>
    </motion.div>
  );
}

/* ─── FEED HEALTH TAB ─────────────────────────────────────────────
   Answers three questions an operator can't get from Google Ads alone:
     1. Is my feed the reason my ROAS is soft? (leaks, OOS burn, orphans)
     2. Which products are ACTUALLY carrying each campaign? (per-camp mix)
     3. Which categories are my real drivers? (product-type rollup)
   ─────────────────────────────────────────────────────────────────── */
function FeedHealthTab({ blend, merchantData, campaignsById }) {
  if (!blend) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <Package size={36} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No merchant feed or shopping data loaded.</p>
        <p className="text-[11px] text-slate-600 mt-1">Pull Google Merchant Center in Study Manual, or confirm this account runs Shopping.</p>
      </div>
    );
  }

  const { bySku, byCampaign, byProductType, orphans, leaks, oosBurn, ghosts, totals } = blend;
  const summary = merchantData?.summary;
  const hasFeed = !!merchantData;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Top row: feed health KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {hasFeed ? (
          <>
            <KPI label="Feed SKUs"
              value={num(summary?.total || 0)}
              sub={`${pct(summary?.approvalRate || 0)} approved`} color="#f59e0b" />
            <KPI label="Disapproved"
              value={num(summary?.disapproved || 0)}
              sub={summary?.demoted ? `${num(summary.demoted)} demoted` : 'items Google won\'t serve'} color="#ef4444" />
            <KPI label="Out of Stock"
              value={num(summary?.oos || 0)} sub="in feed" color="#fb923c" />
            <KPI label="Wasted Spend"
              value={cur(totals.wastedSpend)}
              sub="on disapproved SKUs" color={totals.wastedSpend > 0 ? '#ef4444' : '#22c55e'} />
          </>
        ) : (
          <>
            <KPI label="SKUs in Shopping" value={num(totals.skuCount)} sub="from shopping_performance_view" color="#f59e0b" />
            <KPI label="Ad Spend" value={cur(totals.adSpend)} sub={`${dec(totals.adSpend > 0 ? totals.adRev / totals.adSpend : 0, 2)} ROAS`} />
            <KPI label="Shopify Rev" value={cur(totals.shopRev)} sub={`${num(bySku.filter(r => r.shopRevenue > 0).length)} SKUs sold`} color="#22c55e" />
            <KPI label="Orphans" value={num(orphans.length)} sub={`${cur(totals.orphanRev)} unadvertised`} color="#a78bfa" />
          </>
        )}
      </div>

      {!hasFeed && (
        <div className="px-4 py-3 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs text-amber-200">
          <div className="font-semibold mb-1">Merchant feed not connected.</div>
          <div className="text-amber-200/70">Connect Google Merchant Center in Study Manual to see feed approval, disapprovals, and per-SKU ad economics.</div>
        </div>
      )}

      {/* Top issues from feed */}
      {hasFeed && summary?.topIssues?.length > 0 && (
        <Card title={`Top Feed Issues (${summary.topIssues.length})`}>
          <div className="overflow-auto" style={{ maxHeight: '280px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Issue</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Attribute</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Severity</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">SKUs Affected</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Example</th>
                </tr>
              </thead>
              <tbody>
                {summary.topIssues.slice(0, 20).map((i, idx) => (
                  <tr key={i.code} className={idx % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 text-slate-300">{i.description || i.code}</td>
                    <td className="px-3 py-2 text-slate-400 text-[11px]">{i.attribute || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        i.servability === 'disapproved' ? 'bg-red-900/40 text-red-300' :
                        i.servability === 'demoted' ? 'bg-amber-900/40 text-amber-300' :
                        'bg-slate-800 text-slate-400'}`}>
                        {i.servability || 'info'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-white">{num(i.count)}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{i.exampleSku}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Leaks: ad spend on disapproved SKUs */}
      {leaks.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><AlertTriangle size={14} className="text-red-400" /> Wasted Spend — Disapproved in Feed ({leaks.length})</span>}>
          <p className="text-[11px] text-slate-500 mb-3">Ads ran on SKUs that Google's feed marks as disapproved. Spend, zero serving. Fix the feed, don't pause the ads.</p>
          <SortableTable rows={leaks.slice(0, 50)} maxHeight="360px" cols={[
            { key: 'sku', label: 'SKU', fn: r => <span className="font-mono text-[11px]">{r.sku}</span> },
            { key: 'title', label: 'Title', fn: r => <span className="truncate max-w-[220px] inline-block">{r.title}</span> },
            { key: 'feedStatus', label: 'Feed', fn: r => <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">{r.feedStatus}</span> },
            { key: 'adSpend', label: 'Spend', align: 'right', fn: r => cur(r.adSpend) },
            { key: 'adImpr', label: 'Impr', align: 'right', fn: r => num(r.adImpr) },
            { key: 'feedIssues', label: 'Top Issue', fn: r => <span className="text-[10px] text-slate-500 truncate max-w-[220px] inline-block">{r.feedIssues[0]?.description || '—'}</span> },
          ]} defaultSort={{ key: 'adSpend', dir: 'desc' }} />
        </Card>
      )}

      {/* OOS Burn: ad spend on out-of-stock SKUs */}
      {oosBurn.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><PackageX size={14} className="text-orange-400" /> OOS Burn — Serving While Out of Stock ({oosBurn.length})</span>}>
          <p className="text-[11px] text-slate-500 mb-3">Ads driving traffic to pages where the product isn't available. Bad experience + wasted budget.</p>
          <SortableTable rows={oosBurn.slice(0, 50)} maxHeight="320px" cols={[
            { key: 'sku', label: 'SKU', fn: r => <span className="font-mono text-[11px]">{r.sku}</span> },
            { key: 'title', label: 'Title', fn: r => <span className="truncate max-w-[220px] inline-block">{r.title}</span> },
            { key: 'feedAvail', label: 'Feed Avail', fn: r => <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300">{r.feedAvail || r.inventoryPosture}</span> },
            { key: 'adSpend', label: 'Spend', align: 'right', fn: r => cur(r.adSpend) },
            { key: 'adClicks', label: 'Clicks', align: 'right', fn: r => num(r.adClicks) },
            { key: 'adRev', label: 'Value', align: 'right', fn: r => cur(r.adRev) },
          ]} defaultSort={{ key: 'adSpend', dir: 'desc' }} />
        </Card>
      )}

      {/* Orphans: Shopify revenue but not in feed */}
      {orphans.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Link2Off size={14} className="text-purple-400" /> Orphan SKUs — Selling, Not in Feed ({orphans.length})</span>}>
          <p className="text-[11px] text-slate-500 mb-3">These SKUs earn Shopify revenue but aren't in the merchant feed. You can't advertise what Google doesn't know exists.</p>
          <SortableTable rows={orphans.slice(0, 50)} maxHeight="320px" cols={[
            { key: 'sku', label: 'SKU', fn: r => <span className="font-mono text-[11px]">{r.sku}</span> },
            { key: 'title', label: 'Title', fn: r => <span className="truncate max-w-[220px] inline-block">{r.title}</span> },
            { key: 'shopRevenue', label: 'Shopify Rev', align: 'right', fn: r => cur(r.shopRevenue) },
            { key: 'shopUnits', label: 'Units', align: 'right', fn: r => num(r.shopUnits) },
          ]} defaultSort={{ key: 'shopRevenue', dir: 'desc' }} />
        </Card>
      )}

      {/* Ghosts: approved + selling but 0 impressions */}
      {ghosts.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><GhostIcon size={14} className="text-blue-400" /> Ghost SKUs — Approved but Not Serving ({ghosts.length})</span>}>
          <p className="text-[11px] text-slate-500 mb-3">In feed, approved, earning Shopify revenue — but 0 ad impressions. Something's suppressing them (campaign filters, negative keywords, bid floors).</p>
          <SortableTable rows={ghosts.slice(0, 50)} maxHeight="320px" cols={[
            { key: 'sku', label: 'SKU', fn: r => <span className="font-mono text-[11px]">{r.sku}</span> },
            { key: 'title', label: 'Title', fn: r => <span className="truncate max-w-[220px] inline-block">{r.title}</span> },
            { key: 'shopRevenue', label: 'Shopify Rev', align: 'right', fn: r => cur(r.shopRevenue) },
            { key: 'starAction', label: 'Action', fn: r => <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">{r.starAction || '—'}</span> },
          ]} defaultSort={{ key: 'shopRevenue', dir: 'desc' }} />
        </Card>
      )}

      {/* Per-campaign item mix with feed-status roll-up */}
      {byCampaign.length > 0 && (
        <Card title={`Per-Campaign Item Mix — Feed Status Roll-up (${byCampaign.length})`}>
          <p className="text-[11px] text-slate-500 mb-3">Each campaign's spend split by feed approval status. High "disapproved share" = fixing the feed will unlock ROAS on that campaign without touching bids.</p>
          <div className="overflow-auto" style={{ maxHeight: '440px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Campaign</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Spend</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">ROAS</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Approved $</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Disapproved $</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">OOS $</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">SKUs</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Top Item</th>
                </tr>
              </thead>
              <tbody>
                {byCampaign.map((c, i) => {
                  const campName = c.campaignName || campaignsById.get(c.campaignId)?.name || c.campaignId;
                  const top = c.items?.[0];
                  return (
                    <tr key={c.campaignId} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                      <td className="px-3 py-2 text-slate-200 truncate max-w-[220px]">{campName}</td>
                      <td className="px-3 py-2 text-right font-mono">{cur(c.cost)}</td>
                      <td className="px-3 py-2 text-right font-mono">{dec(c.roas, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">{cur(c.feedRoll?.approvedSpend || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">
                        {cur(c.feedRoll?.disapprovedSpend || 0)}
                        {c.feedRoll?.disapprovedShare > 0.05 && <span className="text-[10px] text-red-400 ml-1">({pct(c.feedRoll.disapprovedShare)})</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-orange-400">{cur(c.feedRoll?.oosSpend || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{num(c.items?.length || 0)}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 truncate max-w-[180px]">
                        {top ? `${top.title || top.sku} (${pct(top.costShare)})` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Per product-type ROAS */}
      {byProductType.length > 0 && (
        <Card title={`Product-Type ROAS Breakdown (${byProductType.length})`}>
          <SortableTable rows={byProductType.slice(0, 30)} maxHeight="360px" cols={[
            { key: 'productType', label: 'Product Type', fn: r => <span className="truncate max-w-[240px] inline-block">{r.productType}</span> },
            { key: 'skus', label: 'SKUs', align: 'right', fn: r => num(r.skus) },
            { key: 'approvalRate', label: 'Approval', align: 'right', fn: r => pct(r.approvalRate) },
            { key: 'adSpend', label: 'Ad Spend', align: 'right', fn: r => cur(r.adSpend) },
            { key: 'adRev', label: 'Ad Rev', align: 'right', fn: r => cur(r.adRev) },
            { key: 'adRoas', label: 'Ad ROAS', align: 'right', fn: r => dec(r.adRoas, 2) },
            { key: 'shopRev', label: 'Shopify Rev', align: 'right', fn: r => cur(r.shopRev) },
            { key: 'shopToAd', label: 'Shop÷Ad', align: 'right', fn: r => r.adSpend > 0 ? dec(r.shopToAd, 2) : '—' },
            { key: 'oosCount', label: 'OOS', align: 'right', fn: r => r.oosCount > 0 ? <span className="text-orange-400">{num(r.oosCount)}</span> : '—' },
          ]} defaultSort={{ key: 'adSpend', dir: 'desc' }} />
        </Card>
      )}

      {/* Full joined SKU list */}
      {bySku.length > 0 && (
        <Card title={`All SKUs — Feed × Ads × Shopify (${bySku.length})`}>
          <SortableTable rows={bySku.slice(0, 200)} maxHeight="480px" cols={[
            { key: 'sku', label: 'SKU', fn: r => <span className="font-mono text-[11px]">{r.sku}</span> },
            { key: 'title', label: 'Title', fn: r => <span className="truncate max-w-[200px] inline-block">{r.title}</span> },
            { key: 'feedStatus', label: 'Feed', fn: r => {
              const s = r.feedStatus;
              const cls = s === 'approved' ? 'bg-emerald-900/40 text-emerald-300'
                : s === 'disapproved' ? 'bg-red-900/40 text-red-300'
                : s === 'pending'     ? 'bg-amber-900/40 text-amber-300'
                : s === 'absent'      ? 'bg-purple-900/40 text-purple-300'
                : 'bg-slate-800 text-slate-400';
              return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{s}</span>;
            }},
            { key: 'feedAvail', label: 'Avail', fn: r => <span className="text-[10px] text-slate-500">{r.feedAvail || '—'}</span> },
            { key: 'adSpend', label: 'Ad Spend', align: 'right', fn: r => cur(r.adSpend) },
            { key: 'adRoas', label: 'Ad ROAS', align: 'right', fn: r => r.adSpend > 0 ? dec(r.adRoas, 2) : '—' },
            { key: 'shopRevenue', label: 'Shop Rev', align: 'right', fn: r => cur(r.shopRevenue) },
            { key: 'shopUnits', label: 'Units', align: 'right', fn: r => num(r.shopUnits) },
          ]} defaultSort={{ key: 'adSpend', dir: 'desc' }} />
        </Card>
      )}
    </motion.div>
  );
}

/* ─── PAGE ───────────────────────────────────────────────────────── */
export default function GoogleAds() {
  const { brands, activeBrandIds, brandData } = useStore();
  const [tab, setTab] = useState('overview');
  const [selectedBrandId, setSelectedBrandId] = useState(() =>
    (brands || []).find(b => (activeBrandIds || []).includes(b.id) && brandData?.[b.id]?.googleAdsData)?.id ||
    (brands || [])[0]?.id || ''
  );
  const [drillCampaign, setDrillCampaign] = useState(null); // filter adGroups/ads/keywords by campaignId

  const gBrands   = (brands || []).filter(b => brandData?.[b.id]?.googleAdsData);
  const active    = brands?.find(b => b.id === selectedBrandId);
  const data      = brandData?.[selectedBrandId]?.googleAdsData;
  const status    = brandData?.[selectedBrandId]?.googleAdsStatus || 'idle';
  const fetchAt   = brandData?.[selectedBrandId]?.googleAdsFetchAt;

  const totals    = useMemo(() => data ? totalsFromNormalized(data) : null, [data]);

  /* Merchant blend — joins shopping × merchant feed × shopify orders */
  const merchantData = brandData?.[selectedBrandId]?.merchantData;
  const orders       = brandData?.[selectedBrandId]?.orders || [];
  const inventoryMap = brandData?.[selectedBrandId]?.inventoryMap || {};
  const insights7d   = brandData?.[selectedBrandId]?.insights7d;
  const insights30d  = brandData?.[selectedBrandId]?.insights30d;
  const blend = useMemo(() => {
    if (!data) return null;
    const shoppingRows = data.shoppingByCampaign?.length ? data.shoppingByCampaign : data.shopping || [];
    if (!merchantData && !shoppingRows.length) return null;
    const shopifyBySku = orders.length ? shopifyBySkuFromOrders(orders) : null;
    return blendAdsMerchant({
      shopping: shoppingRows,
      merchantBySku: merchantData?.bySku || null,
      shopifyBySku,
    });
  }, [data, merchantData, orders]);

  /* Pricing suggestions — reconstructs Merchant Center's sale price
     recommendations from 90d orders + per-SKU ad metrics + peer median. */
  const pricing = useMemo(() => {
    if (!orders.length) return null;
    const shoppingRows = data?.shoppingByCampaign?.length ? data.shoppingByCampaign : data?.shopping || [];
    const adBySku = shoppingRows.length ? aggregateShoppingBySku(shoppingRows) : null;
    return buildPriceSuggestions({
      orders,
      merchantBySku: merchantData?.bySku || null,
      adBySku,
    });
  }, [orders, data, merchantData]);

  /* Drop diagnostics — SKU outages → campaign drops → ad/keyword/search-term chain */
  const diag = useMemo(() => {
    if (!data) return null;
    return diagnose({
      googleAdsData: data,
      merchantBySku: merchantData?.bySku || null,
      orders,
      inventoryMap,
      metaInsights: (insights7d || insights30d) ? { insights7d: insights7d || [], insights30d: insights30d || [] } : null,
      windowDays: 7,
    });
  }, [data, merchantData, orders, inventoryMap, insights7d, insights30d]);

  // { [sku]: stock } derived from brand's persisted inventoryMap — used by
  // the intelligence tab's OOS kill-switch.
  const inventoryBySku = useMemo(() => {
    const inv = brandData?.[selectedBrandId]?.inventoryMap || {};
    const out = {};
    for (const [sku, rec] of Object.entries(inv)) {
      if (sku && rec) out[sku] = rec.stock ?? 0;
    }
    return out;
  }, [brandData, selectedBrandId]);

  /* Channel of the drilled campaign — used to warn when drilling Pmax
     into tabs it doesn't expose (ads / keywords / search terms). */
  const drillCampaignChannel = useMemo(() => {
    if (!drillCampaign) return null;
    return (data?.campaigns || []).find(c => String(c.id) === String(drillCampaign.id))?.channel || null;
  }, [drillCampaign, data]);

  /* Filtered rows when drilling into a campaign */
  const filteredAdGroups = useMemo(() =>
    drillCampaign ? (data?.adGroups || []).filter(a => a.campaignId === drillCampaign.id) : (data?.adGroups || []),
    [data, drillCampaign]);
  const filteredAds = useMemo(() =>
    drillCampaign ? (data?.ads || []).filter(a => a.campaignId === drillCampaign.id) : (data?.ads || []),
    [data, drillCampaign]);
  const filteredKeywords = useMemo(() =>
    drillCampaign ? (data?.keywords || []).filter(k => k.campaignId === drillCampaign.id) : (data?.keywords || []),
    [data, drillCampaign]);
  const filteredSearchTerms = useMemo(() =>
    drillCampaign ? (data?.searchTerms || []).filter(s => s.campaignId === drillCampaign.id) : (data?.searchTerms || []),
    [data, drillCampaign]);

  /* Daily trend — aggregate all campaigns per date */
  const dailyTrend = useMemo(() => {
    if (!data?.campaignsDaily?.length) return [];
    const map = new Map();
    data.campaignsDaily.forEach(r => {
      if (!r.date) return;
      const e = map.get(r.date) || { date: r.date, cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
      e.cost            += r.cost || 0;
      e.clicks          += r.clicks || 0;
      e.impressions     += r.impressions || 0;
      e.conversions     += r.conversions || 0;
      e.conversionValue += r.conversionValue || 0;
      map.set(r.date, e);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      ...d,
      roas: d.cost > 0 ? d.conversionValue / d.cost : 0,
      ctr:  d.impressions > 0 ? d.clicks / d.impressions : 0,
    }));
  }, [data]);

  /* ── Empty states ─────────────────────────────────────────────── */
  if (!gBrands.length) {
    if (status === 'loading') return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-sm">Fetching Google Ads…</span>
      </div>
    );
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Search size={40} className="opacity-30" />
        <p className="text-sm">No Google Ads data loaded.</p>
        <p className="text-xs text-slate-600">Add Google Ads credentials in Study Manual → brand card → Google Ads, then Pull.</p>
      </div>
    );
  }

  /* ── Column definitions ───────────────────────────────────────── */
  const metricCols = [
    { key: 'impressions',     label: 'Impr',   align: 'right', fn: r => num(r.impressions) },
    { key: 'clicks',          label: 'Clicks', align: 'right', fn: r => num(r.clicks) },
    { key: 'ctr',             label: 'CTR',    align: 'right', fn: r => pct(r.ctr) },
    { key: 'cost',            label: 'Cost',   align: 'right', fn: r => cur(r.cost) },
    { key: 'cpc',             label: 'CPC',    align: 'right', fn: r => cur(r.cpc) },
    { key: 'conversions',     label: 'Conv',   align: 'right', fn: r => dec(r.conversions, 1) },
    { key: 'conversionValue', label: 'Value',  align: 'right', fn: r => cur(r.conversionValue) },
    { key: 'cpa',             label: 'CPA',    align: 'right', fn: r => r.cpa > 0 ? cur(r.cpa) : '—' },
    { key: 'roas',            label: 'ROAS',   align: 'right', fn: r => dec(r.roas, 2) },
  ];

  const campaignCols = [
    { key: 'name', label: 'Campaign', fn: r => (
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'ENABLED' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
        <span className="truncate max-w-[220px]">{r.name}</span>
        <span className="text-[9px] text-slate-600 px-1 rounded bg-gray-800">{r.channel}</span>
      </div>
    )},
    ...metricCols,
    { key: '_drill', label: '', align: 'right', fn: () => <ChevronRight size={12} className="text-slate-600 ml-auto" /> },
  ];
  const adGroupCols = [
    { key: 'name',         label: 'Ad Group',   fn: r => <span className="truncate max-w-[200px] inline-block">{r.name}</span> },
    { key: 'campaignName', label: 'Campaign',   fn: r => <span className="text-slate-500 truncate max-w-[160px] inline-block">{r.campaignName}</span> },
    ...metricCols,
  ];
  const adCols = [
    { key: 'name', label: 'Ad', fn: r => <span className="truncate max-w-[200px] inline-block">{r.name || `(${r.type})`}</span> },
    { key: 'type', label: 'Type', fn: r => <span className="text-[10px] text-slate-500">{r.type}</span> },
    { key: 'adGroupName', label: 'Ad Group', fn: r => <span className="text-slate-500 truncate max-w-[140px] inline-block">{r.adGroupName}</span> },
    ...metricCols,
  ];
  const kwCols = [
    { key: 'keyword', label: 'Keyword', fn: r => <span className="font-medium">{r.keyword}</span> },
    { key: 'matchType', label: 'Match', fn: r => <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-slate-400">{r.matchType}</span> },
    { key: 'qualityScore', label: 'QS', align: 'right', fn: r => r.qualityScore ?? '—' },
    { key: 'adGroupName', label: 'Ad Group', fn: r => <span className="text-slate-500 truncate max-w-[140px] inline-block">{r.adGroupName}</span> },
    ...metricCols,
  ];
  const stCols = [
    { key: 'searchTerm', label: 'Search Term', fn: r => <span className="font-medium">{r.searchTerm}</span> },
    ...metricCols,
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2.5 rounded-xl bg-amber-500/20">
            <Search size={18} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Google Ads</h1>
            {totals && <p className="text-[11px] text-slate-500">{cur(totals.spend)} spend · {num(totals.clicks)} clicks · {dec(totals.conversions, 1)} conv</p>}
          </div>
        </div>

        {gBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e => { setSelectedBrandId(e.target.value); setDrillCampaign(null); }}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none">
            {gBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        {active && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-2 h-2 rounded-full" style={{ background: active.color }} />
            <span className="text-xs text-slate-400">{active.name}</span>
            {fetchAt && <span className="text-[10px] text-slate-600 ml-2">Last pull: {new Date(fetchAt).toLocaleTimeString()}</span>}
          </div>
        )}
      </div>

      {/* Drill breadcrumb */}
      {drillCampaign && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs">
          <span className="text-slate-400">Filtering by campaign:</span>
          <span className="font-semibold text-amber-300">{drillCampaign.name}</span>
          <button onClick={() => setDrillCampaign(null)} className="ml-auto text-[10px] text-slate-400 hover:text-white">Clear ✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-amber-600/30 text-amber-300 ring-1 ring-amber-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────── */}
      {tab === 'overview' && totals && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="Spend"        value={cur(totals.spend)}           sub={`${data.campaigns.length} campaigns`} />
            <KPI label="Impressions"  value={num(totals.impressions)}     sub={`${num(totals.clicks)} clicks`} />
            <KPI label="Conversions"  value={dec(totals.conversions, 1)}  sub={`${cur(totals.conversionValue)} value`} />
            <KPI label="ROAS"         value={dec(totals.spend > 0 ? totals.conversionValue / totals.spend : 0, 2)} sub={`CPA ${totals.conversions > 0 ? cur(totals.spend / totals.conversions) : '—'}`} />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="CTR"          value={pct(totals.impressions > 0 ? totals.clicks / totals.impressions : 0)} sub="click-through rate" color="#3b82f6" />
            <KPI label="Avg CPC"      value={cur(totals.clicks > 0 ? totals.spend / totals.clicks : 0)} sub="cost per click" color="#3b82f6" />
            <KPI label="Conv Rate"    value={pct(totals.clicks > 0 ? totals.conversions / totals.clicks : 0)} sub="conversions / clicks" color="#22c55e" />
            <KPI label="AOV"          value={cur(totals.conversions > 0 ? totals.conversionValue / totals.conversions : 0)} sub="per conversion" color="#22c55e" />
          </div>

          {dailyTrend.length > 0 && (
            <Card title="Daily Trend">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyTrend}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip content={<CT />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area yAxisId="left"  name="Cost"            dataKey="cost"            stroke="#f59e0b" fill="#f59e0b22" />
                  <Area yAxisId="right" name="Conversion Value" dataKey="conversionValue" stroke="#22c55e" fill="#22c55e22" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card title="Top 10 Campaigns by Spend">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={[...data.campaigns].sort((a,b)=>b.cost-a.cost).slice(0,10)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={150} />
                  <Tooltip content={<CT />} />
                  <Bar name="Cost" dataKey="cost" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Top 10 Campaigns by ROAS">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={[...data.campaigns].filter(c=>c.cost>0).sort((a,b)=>b.roas-a.roas).slice(0,10)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={150} />
                  <Tooltip content={<CT />} />
                  <Bar name="ROAS" dataKey="roas" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </motion.div>
      )}

      {/* ── INTELLIGENCE ─────────────────────────────────────────── */}
      {tab === 'intel' && data && (
        <GoogleAdsIntel
          data={data}
          brand={active}
          orders={brandData?.[selectedBrandId]?.orders || []}
          inventoryBySku={inventoryBySku}
          monthlyTarget={active?.googleAdsMonthlyTarget}
          skuMargin={active?.skuMargin}
          defaultMarginPct={active?.defaultMarginPct || 0.25}
        />
      )}

      {/* ── ROOT CAUSE ────────────────────────────────────────────── */}
      {tab === 'rootcause' && (
        <RootCauseTab
          diag={diag}
          data={data}
          onDrillCampaign={c => {
            setDrillCampaign(c);
            // Pmax/Shopping campaigns don't expose search terms — route to
            // shopping SKU mix instead, which is what actually matters.
            const ch = (data?.campaigns || []).find(x => String(x.id) === String(c.id))?.channel || '';
            const noSearch = ch === 'PERFORMANCE_MAX' || ch === 'SHOPPING';
            setTab(noSearch ? 'shopping' : 'searchterms');
          }}
        />
      )}

      {/* ── PRICING ──────────────────────────────────────────────── */}
      {tab === 'pricing' && (
        <PricingTab pricing={pricing} />
      )}

      {/* ── FEED HEALTH ──────────────────────────────────────────── */}
      {tab === 'feed' && (
        <FeedHealthTab
          blend={blend}
          merchantData={merchantData}
          campaignsById={new Map((data?.campaigns || []).map(c => [String(c.id), c]))}
        />
      )}

      {/* ── CAMPAIGNS ────────────────────────────────────────────── */}
      {tab === 'campaigns' && data && (
        <Card title={`${data.campaigns.length} campaigns`} action={
          <button onClick={() => exportCSV('google-ads-campaigns.csv', data.campaigns, [
            { key: 'name', label: 'Campaign' }, { key: 'status', label: 'Status' }, { key: 'channel', label: 'Channel' },
            { key: 'impressions', label: 'Impressions' }, { key: 'clicks', label: 'Clicks' }, { key: 'cost', label: 'Cost' },
            { key: 'conversions', label: 'Conversions' }, { key: 'conversionValue', label: 'Value' }, { key: 'roas', label: 'ROAS' },
          ])} className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"><Download size={10} /> CSV</button>
        }>
          <SortableTable rows={data.campaigns} cols={campaignCols} defaultSort={{ key: 'cost', dir: 'desc' }}
            onRowClick={r => { setDrillCampaign(r); setTab('adgroups'); }} />
        </Card>
      )}

      {/* ── AD GROUPS ────────────────────────────────────────────── */}
      {tab === 'adgroups' && data && (
        <Card title={`${filteredAdGroups.length} ad groups${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          {drillCampaignChannel === 'PERFORMANCE_MAX' && filteredAdGroups.length === 0 && <PmaxHint tab="ad groups" onShopping={() => setTab('shopping')} />}
          <SortableTable rows={filteredAdGroups} cols={adGroupCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── ADS ──────────────────────────────────────────────────── */}
      {tab === 'ads' && data && (
        <Card title={`${filteredAds.length} ads${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          {drillCampaignChannel === 'PERFORMANCE_MAX' && filteredAds.length === 0 && <PmaxHint tab="individual ads" onShopping={() => setTab('shopping')} />}
          <SortableTable rows={filteredAds} cols={adCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── KEYWORDS ─────────────────────────────────────────────── */}
      {tab === 'keywords' && data && (
        <Card title={`${filteredKeywords.length} keywords${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          {drillCampaignChannel === 'PERFORMANCE_MAX' && filteredKeywords.length === 0 && <PmaxHint tab="keywords" onShopping={() => setTab('shopping')} />}
          <SortableTable rows={filteredKeywords.map((k,i)=>({...k,_key:`${k.adGroupId}|${k.keyword}|${k.matchType}|${i}`}))} cols={kwCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── SEARCH TERMS ─────────────────────────────────────────── */}
      {tab === 'searchterms' && data && (
        <Card title={`${filteredSearchTerms.length} search terms${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          {drillCampaignChannel === 'PERFORMANCE_MAX' && filteredSearchTerms.length === 0 && <PmaxHint tab="search terms" onShopping={() => setTab('shopping')} />}
          <SortableTable rows={filteredSearchTerms.map((s,i)=>({...s,_key:`${s.adGroupId}|${s.searchTerm}|${i}`}))} cols={stCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── DEVICES ──────────────────────────────────────────────── */}
      {tab === 'devices' && data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card title="Device Split — Spend">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.devices}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="device" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CT />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Cost" dataKey="cost" fill="#f59e0b" />
                <Bar name="Conversion Value" dataKey="conversionValue" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Device Performance">
            <SortableTable rows={data.devices} maxHeight="320px" cols={[
              { key: 'device', label: 'Device' },
              ...metricCols,
            ]} defaultSort={{ key: 'cost', dir: 'desc' }} />
          </Card>
        </div>
      )}

      {/* ── HOURS & DAYS ─────────────────────────────────────────── */}
      {tab === 'hours' && data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card title="By Hour of Day">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.hours?.byHour || []}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CT />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left"  name="Cost" dataKey="cost" fill="#f59e0b" />
                <Bar yAxisId="right" name="Conversions" dataKey="conversions" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="By Day of Week">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data.hours?.byDow || []).map(d => ({ ...d, label: DOW_SHORT[d.day] || d.day }))}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CT />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Cost" dataKey="cost" fill="#f59e0b" />
                <Bar name="Conversion Value" dataKey="conversionValue" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── DEMOGRAPHICS ─────────────────────────────────────────── */}
      {tab === 'demo' && data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card title="Age">
            <SortableTable rows={data.age || []} maxHeight="360px" cols={[
              { key: 'ageRange', label: 'Age' },
              ...metricCols,
            ]} defaultSort={{ key: 'cost', dir: 'desc' }} />
          </Card>
          <Card title="Gender">
            <SortableTable rows={data.gender || []} maxHeight="360px" cols={[
              { key: 'gender', label: 'Gender' },
              ...metricCols,
            ]} defaultSort={{ key: 'cost', dir: 'desc' }} />
          </Card>
        </div>
      )}

      {/* ── SHOPPING ─────────────────────────────────────────────── */}
      {tab === 'shopping' && data && (() => {
        // When drilled into a campaign, filter shopping rows to that campaign
        const shoppingRows = drillCampaign
          ? (data.shoppingByCampaign || []).filter(p => String(p.campaignId) === String(drillCampaign.id))
          : (data.shopping || []);
        return (
          <Card title={`${shoppingRows.length} products${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
            {!shoppingRows.length ? (
              <div className="text-center text-slate-500 py-8 text-xs italic">No shopping data for this {drillCampaign ? 'campaign' : 'account'}</div>
            ) : (
              <SortableTable rows={shoppingRows.map((p,i)=>({...p,_key:`${p.productId || p.productItemId}|${i}`}))} cols={[
                { key: 'productTitle', label: 'Product', fn: r => <span className="truncate max-w-[260px] inline-block">{r.productTitle || r.productId || r.productItemId}</span> },
                { key: 'productId', label: 'Item ID', fn: r => <span className="text-[10px] text-slate-500">{r.productId || r.productItemId}</span> },
                { key: 'productBrand', label: 'Brand', fn: r => <span className="text-[10px] text-slate-500">{r.productBrand || '—'}</span> },
                ...metricCols,
              ]} defaultSort={{ key: 'cost', dir: 'desc' }} />
            )}
          </Card>
        );
      })()}
    </div>
  );
}
