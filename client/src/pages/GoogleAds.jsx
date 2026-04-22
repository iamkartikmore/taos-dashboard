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
} from 'lucide-react';
import { useStore } from '../store';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';
import { blendAdsMerchant, shopifyBySkuFromOrders } from '../lib/googleAdsMerchantBlend';
import { diagnose, skuImpactChain } from '../lib/dropDiagnostics';
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
  const [expanded, setExpanded] = useState(null);

  if (!diag) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
        <Stethoscope size={36} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No Google Ads daily data to diagnose.</p>
        <p className="text-[11px] text-slate-600 mt-1">Pull Google Ads with daily segmentation to enable root-cause analysis.</p>
      </div>
    );
  }

  const { droppingCampaigns, outages, meta, shop, totals } = diag;

  const severityColor = s =>
    s === 'critical' ? 'text-red-400 bg-red-900/30 border-red-800/40' :
    s === 'high'     ? 'text-orange-400 bg-orange-900/30 border-orange-800/40' :
    s === 'medium'   ? 'text-amber-400 bg-amber-900/30 border-amber-800/40' :
                       'text-slate-400 bg-slate-800 border-slate-700';

  const causeIcon = c =>
    c === 'sku_outage'          ? <PackageX size={12} /> :
    c === 'feed_disapproval'    ? <AlertTriangle size={12} /> :
    c === 'change_event'        ? <GitBranch size={12} /> :
    c === 'impression_collapse' ? <TrendingDown size={12} /> :
    c === 'conversion_collapse' ? <TrendingDown size={12} /> :
                                  <Stethoscope size={12} />;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Cross-channel corroboration banner */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <KPI label="Dropping Campaigns"
          value={num(totals.droppingCount)}
          sub={totals.totalRevDelta < 0 ? `${cur(totals.totalRevDelta)} WoW net rev delta` : 'WoW revenue net positive'}
          color={totals.droppingCount > 0 ? '#ef4444' : '#22c55e'} />
        <KPI label="Shopify WoW (all orders)"
          value={shop?.totals?.deltaRevPct != null ? `${shop.totals.deltaRevPct > 0 ? '+' : ''}${(shop.totals.deltaRevPct * 100).toFixed(1)}%` : '—'}
          sub={`${cur(shop?.totals?.recentRev || 0)} vs ${cur(shop?.totals?.priorRev || 0)}`}
          color={(shop?.totals?.deltaRevPct ?? 0) >= 0 ? '#22c55e' : '#ef4444'} />
        <KPI label="Meta WoW Revenue"
          value={meta?.deltaRevPct != null ? `${meta.deltaRevPct > 0 ? '+' : ''}${(meta.deltaRevPct * 100).toFixed(1)}%` : '—'}
          sub={meta ? `ROAS ${dec(meta.recentRoas, 2)} vs ${dec(meta.priorRoas, 2)}` : 'no Meta data'}
          color={(meta?.deltaRevPct ?? 0) >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      {/* Demand context narrative */}
      <div className="px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-xs text-slate-300 leading-relaxed">
        {(() => {
          const shopPct = shop?.totals?.deltaRevPct;
          const metaPct = meta?.deltaRevPct;
          const gAdsNeg = totals.totalRevDelta < 0;
          if (!gAdsNeg) return <>Google Ads revenue is <span className="text-emerald-400 font-semibold">up or flat</span> week-over-week — nothing systemic to diagnose. Review individual dropping campaigns below if any.</>;
          if (shopPct != null && shopPct < -0.05 && metaPct != null && metaPct < -0.05) {
            return <>All three channels are down. Demand-side softening — check <span className="text-amber-400">category trend, seasonality, or a broad stockout across top sellers</span>. Feed/auction issues are secondary.</>;
          }
          if ((shopPct == null || shopPct >= -0.05) && (metaPct == null || metaPct >= -0.05)) {
            return <>Google Ads is down but <span className="text-emerald-400">Shopify + Meta are holding</span> — the drop is channel-isolated. Look for feed disapprovals, change events, auction pressure, or OOS SKUs that Google is feeling but organic isn't yet.</>;
          }
          return <>Partial correlation — Google Ads is down and {shopPct != null && shopPct < 0 ? 'Shopify is soft' : 'Meta is soft'}. Check SKU-level overlap between the dropping campaigns and any stockouts.</>;
        })()}
      </div>

      {/* Top outages, summarized */}
      {outages.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><PackageX size={14} className="text-orange-400" /> Detected SKU Outages ({outages.length})</span>}>
          <p className="text-[11px] text-slate-500 mb-3">These are the out-of-stock or below-reorder SKUs that would hurt campaigns they appear in.</p>
          <div className="overflow-auto" style={{ maxHeight: '280px' }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">SKU</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Title</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Stock</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Feed Avail</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Last Order</th>
                  <th className="px-3 py-2 text-right text-slate-400 font-semibold">Days Out</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody>
                {outages.slice(0, 40).map((o, i) => (
                  <tr key={o.sku} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{o.sku}</td>
                    <td className="px-3 py-2 text-slate-400 truncate max-w-[260px]">{o.title}</td>
                    <td className="px-3 py-2 text-right font-mono text-white">{o.stock ?? '—'}</td>
                    <td className="px-3 py-2"><span className="text-[10px] text-slate-500">{o.feedAvail || '—'}</span></td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{o.lastOrderDate || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-orange-300">{o.daysOut ?? '—'}</td>
                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityColor(o.severity)}`}>{o.severity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dropping campaigns with ranked causes */}
      {droppingCampaigns.length === 0 ? (
        <Card title="Dropping Campaigns">
          <div className="text-center text-slate-500 py-8 text-xs italic">No campaigns materially down week-over-week. Nothing to diagnose.</div>
        </Card>
      ) : (
        <Card title={`Dropping Campaigns — Ranked Causes (${droppingCampaigns.length})`}>
          <p className="text-[11px] text-slate-500 mb-4">Campaigns where revenue fell &gt;10% or ROAS fell &gt;0.5 WoW. Each has an ordered list of likely root causes based on SKU outages, feed disapprovals, change events, and funnel collapse patterns.</p>
          <div className="space-y-3">
            {droppingCampaigns.map(c => {
              const isOpen = expanded === c.campaignId;
              const chain = isOpen ? skuImpactChain({
                sku: c.causes.find(x => x.cause === 'sku_outage')?.evidence?.[0]?.sku,
                shoppingByCampaign: data?.shoppingByCampaign || [],
                adGroups: data?.adGroups || [],
                ads: data?.ads || [],
                keywords: data?.keywords || [],
                searchTerms: data?.searchTerms || [],
              }) : null;
              return (
                <div key={c.campaignId} className="border border-gray-800 rounded-lg bg-gray-950/40 overflow-hidden">
                  {/* Campaign header */}
                  <div className="px-4 py-3 flex flex-wrap items-center gap-3 bg-gray-900/60 border-b border-gray-800">
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-sm font-semibold text-white truncate">{c.campaignName || c.campaignId}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-3">
                        <span>Rev: <span className="text-red-400">{cur(c.recentRev)}</span> <span className="text-slate-600">vs {cur(c.priorRev)}</span></span>
                        <span>ΔRev: <span className="text-red-400">{c.deltaRevPct != null ? `${(c.deltaRevPct * 100).toFixed(0)}%` : '—'}</span></span>
                        <span>ROAS: <span className="text-slate-300">{dec(c.recentRoas, 2)}</span> <span className="text-slate-600">vs {dec(c.priorRoas, 2)}</span></span>
                        <span>Impr Δ: <span className="text-slate-300">{c.deltaImprPct != null ? `${(c.deltaImprPct * 100).toFixed(0)}%` : '—'}</span></span>
                      </div>
                    </div>
                    <button onClick={() => setExpanded(isOpen ? null : c.campaignId)}
                      className="text-[10px] px-2.5 py-1 rounded bg-gray-800 text-slate-300 hover:bg-gray-700">
                      {isOpen ? 'Collapse' : 'Drill chain'}
                    </button>
                    <button onClick={() => onDrillCampaign({ id: c.campaignId, name: c.campaignName })}
                      className="text-[10px] px-2.5 py-1 rounded bg-amber-900/30 text-amber-300 border border-amber-800/40 hover:bg-amber-900/50">
                      Filter to campaign
                    </button>
                  </div>

                  {/* Ranked causes */}
                  <div className="px-4 py-3 space-y-2">
                    {c.causes.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic">No strong signal for a specific cause. Could be auction-side softening, seasonality, or low-volume noise.</div>
                    ) : c.causes.map((cs, i) => (
                      <div key={i} className={`rounded-lg border px-3 py-2 ${severityColor(cs.severity)}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {causeIcon(cs.cause)}
                          <span className="text-[10px] font-bold uppercase tracking-wider">{cs.cause.replace(/_/g, ' ')}</span>
                          <span className="ml-auto text-[10px] uppercase tracking-wider opacity-80">{cs.severity}</span>
                        </div>
                        <div className="text-xs leading-relaxed">{cs.narrative}</div>
                        {cs.evidence?.length > 0 && (
                          <div className="mt-2 pl-5 space-y-1 text-[11px] text-slate-400">
                            {cs.evidence.slice(0, 5).map((ev, j) => (
                              <div key={j} className="font-mono">
                                {ev.sku ? `${ev.sku} — ${ev.title || ''} · ${ev.costShare != null ? `${(ev.costShare * 100).toFixed(0)}% of campaign spend` : ''}${ev.daysOut != null ? ` · ${ev.daysOut}d out` : ''}${ev.issue ? ` · ${ev.issue}` : ''}` :
                                 ev.operation ? `${ev.ts || ''} · ${ev.user || 'unknown'} · ${ev.operation} on ${ev.resourceType}` :
                                 JSON.stringify(ev)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Drill chain: SKU → ad group → ad → keyword → search term */}
                  {isOpen && chain && chain.campaigns?.length > 0 && (
                    <div className="px-4 py-3 border-t border-gray-800 bg-gray-950/60">
                      <div className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider mb-2">Impact chain for SKU: <span className="font-mono text-white">{chain.sku}</span></div>
                      {chain.campaigns.filter(cc => cc.campaignId === c.campaignId).map(cc => (
                        <div key={cc.campaignId} className="space-y-3 text-[11px]">
                          <div className="text-slate-400">
                            This SKU accounted for <span className="text-amber-300 font-semibold">{(cc.costShareInCampaign * 100).toFixed(0)}%</span> of this campaign's shopping spend ({cur(cc.skuCost)} / {cur(cc.campaignTotalCost)}).
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div>
                              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top Ad Groups in campaign</div>
                              {cc.topAdGroups.length === 0 ? <div className="text-slate-600 italic">—</div> :
                                cc.topAdGroups.map(ag => (
                                  <div key={ag.id} className="font-mono text-slate-300 truncate">{ag.name} — {cur(ag.cost)} · ROAS {dec(ag.roas, 2)}</div>
                                ))}
                            </div>
                            <div>
                              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top Ads</div>
                              {cc.topAds.length === 0 ? <div className="text-slate-600 italic">—</div> :
                                cc.topAds.map(ad => (
                                  <div key={ad.id} className="font-mono text-slate-300 truncate">{ad.name} — {cur(ad.cost)} · {num(ad.clicks)} clicks</div>
                                ))}
                            </div>
                            <div>
                              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top Keywords</div>
                              {cc.topKeywords.length === 0 ? <div className="text-slate-600 italic">—</div> :
                                cc.topKeywords.map((kw, ki) => (
                                  <div key={ki} className="font-mono text-slate-300">{kw.keyword} <span className="text-slate-600">[{kw.matchType}]</span> — {cur(kw.cost)}</div>
                                ))}
                            </div>
                            <div>
                              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Top Search Terms</div>
                              {cc.topSearchTerms.length === 0 ? <div className="text-slate-600 italic">—</div> :
                                cc.topSearchTerms.map((st, si) => (
                                  <div key={si} className="font-mono text-slate-300 truncate">"{st.searchTerm}" — {cur(st.cost)} · {dec(st.conversions, 1)} conv</div>
                                ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isOpen && (!chain || !chain.campaigns?.length) && (
                    <div className="px-4 py-3 border-t border-gray-800 bg-gray-950/60 text-[11px] text-slate-500 italic">
                      No SKU outage directly implicates this campaign — inspect the change events or landing-page funnel.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
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
          onDrillCampaign={c => { setDrillCampaign(c); setTab('searchterms'); }}
        />
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
          <SortableTable rows={filteredAdGroups} cols={adGroupCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── ADS ──────────────────────────────────────────────────── */}
      {tab === 'ads' && data && (
        <Card title={`${filteredAds.length} ads${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          <SortableTable rows={filteredAds} cols={adCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── KEYWORDS ─────────────────────────────────────────────── */}
      {tab === 'keywords' && data && (
        <Card title={`${filteredKeywords.length} keywords${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
          <SortableTable rows={filteredKeywords.map((k,i)=>({...k,_key:`${k.adGroupId}|${k.keyword}|${k.matchType}|${i}`}))} cols={kwCols} defaultSort={{ key: 'cost', dir: 'desc' }} />
        </Card>
      )}

      {/* ── SEARCH TERMS ─────────────────────────────────────────── */}
      {tab === 'searchterms' && data && (
        <Card title={`${filteredSearchTerms.length} search terms${drillCampaign ? ` · ${drillCampaign.name}` : ''}`}>
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
      {tab === 'shopping' && data && (
        <Card title={`${(data.shopping || []).length} products`}>
          {!data.shopping?.length ? (
            <div className="text-center text-slate-500 py-8 text-xs italic">No shopping data for this account</div>
          ) : (
            <SortableTable rows={data.shopping.map((p,i)=>({...p,_key:`${p.productId}|${i}`}))} cols={[
              { key: 'productTitle', label: 'Product', fn: r => <span className="truncate max-w-[220px] inline-block">{r.productTitle || r.productId}</span> },
              { key: 'productId', label: 'Item ID', fn: r => <span className="text-[10px] text-slate-500">{r.productId}</span> },
              { key: 'productBrand', label: 'Brand', fn: r => <span className="text-[10px] text-slate-500">{r.productBrand || '—'}</span> },
              ...metricCols,
            ]} defaultSort={{ key: 'cost', dir: 'desc' }} />
          )}
        </Card>
      )}
    </div>
  );
}
