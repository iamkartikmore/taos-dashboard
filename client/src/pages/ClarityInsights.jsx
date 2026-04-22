import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MousePointerClick, AlertTriangle, Zap, Eye, Users, Globe2,
  TrendingUp as TrendingUpIcon, TrendingDown, RefreshCw, ExternalLink,
  Flame, Bug, ArrowRight, Download, Package,
} from 'lucide-react';
import { useStore } from '../store';
import { fetchClarity } from '../lib/api';
import {
  normalizeClaritySnapshot, claritySummary,
  rageClickHotspots, deadClickHotspots, quickBackHotspots, jsErrorHotspots,
  shallowScrollPages, deviceComparison, channelComparison,
  compareSnapshots, joinAdsClarity, joinShopifyClarity,
} from '../lib/clarityAnalytics';

const num = v => (Number(v) || 0).toLocaleString('en-IN');
const pct = v => `${((Number(v) || 0) * 100).toFixed(1)}%`;
const dec = (v, d = 2) => (Number(v) || 0).toFixed(d);
const cur = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;

function KPI({ label, value, sub, color = '#06b6d4', delta }) {
  const deltaColor = delta == null ? 'text-slate-500'
                    : delta > 0 ? 'text-red-400'
                    : 'text-emerald-400';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      {delta != null && (
        <div className={`text-[11px] mt-0.5 ${deltaColor}`}>
          {delta > 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}% vs last pull
        </div>
      )}
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function severityPill(s) {
  return s === 'critical' ? 'bg-red-900/40 text-red-300'
       : s === 'high'     ? 'bg-orange-900/40 text-orange-300'
       : 'bg-amber-900/40 text-amber-300';
}

function shortUrl(u) {
  try { const x = new URL(u); return x.pathname + (x.search ? x.search.slice(0, 20) + '…' : ''); }
  catch { return u; }
}

export default function ClarityInsights() {
  const { brands, activeBrandIds, brandData, setBrandClarityData, setBrandClarityStatus } = useStore();
  const cBrands = (brands || []).filter(b => activeBrandIds.includes(b.id) && b.clarity?.apiToken);
  const [selectedBrandId, setSelectedBrandId] = useState(() => cBrands[0]?.id || '');
  const [pulling, setPulling] = useState(false);
  const [tab, setTab] = useState('overview');

  const brand     = brands.find(b => b.id === selectedBrandId);
  const bd        = brandData?.[selectedBrandId] || {};
  const snapshot  = bd.clarityData || null;
  const history   = bd.clarityHistory || [];
  const priorSnap = history.length >= 2 ? history[history.length - 2].snapshot : null;
  const orders    = bd.orders || [];
  const gAdsData  = bd.googleAdsData || null;
  const status    = bd.clarityStatus || 'idle';

  const summary = useMemo(() => claritySummary(snapshot), [snapshot]);
  const priorSummary = useMemo(() => claritySummary(priorSnap), [priorSnap]);
  const comparison = useMemo(() => compareSnapshots(snapshot, priorSnap), [snapshot, priorSnap]);

  const rage    = useMemo(() => rageClickHotspots(snapshot), [snapshot]);
  const dead    = useMemo(() => deadClickHotspots(snapshot), [snapshot]);
  const qb      = useMemo(() => quickBackHotspots(snapshot), [snapshot]);
  const errors  = useMemo(() => jsErrorHotspots(snapshot), [snapshot]);
  const shallow = useMemo(() => shallowScrollPages(snapshot), [snapshot]);
  const devices = useMemo(() => deviceComparison(snapshot), [snapshot]);
  const channels = useMemo(() => channelComparison(snapshot), [snapshot]);
  const adsJoin = useMemo(() => joinAdsClarity({ landingPages: gAdsData?.landingPages || [], snapshot }), [snapshot, gAdsData]);
  const shopifyJoin = useMemo(() => joinShopifyClarity({ orders, snapshot }), [orders, snapshot]);

  const handlePull = async () => {
    if (!brand?.clarity?.apiToken) return;
    setPulling(true);
    try {
      setBrandClarityStatus(brand.id, 'loading');
      const raw = await fetchClarity(brand.clarity.apiToken, 'current');
      const snap = normalizeClaritySnapshot(raw);
      setBrandClarityData(brand.id, snap);
    } catch (e) {
      setBrandClarityStatus(brand.id, 'error', e.message);
    } finally {
      setPulling(false);
    }
  };

  if (!cBrands.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <MousePointerClick size={40} className="opacity-30" />
        <p className="text-sm">No Clarity projects connected.</p>
        <p className="text-xs text-slate-600">Add your Clarity API token in Study Manual → brand → Clarity section.</p>
      </div>
    );
  }

  if (!snapshot && status !== 'loading') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/20"><MousePointerClick size={18} className="text-cyan-400" /></div>
          <div>
            <h1 className="text-xl font-bold text-white">Clarity Behavior</h1>
            <p className="text-[11px] text-slate-500">Microsoft Clarity rage clicks, dead clicks, scroll depth, quick-backs — joined to Google Ads + Shopify.</p>
          </div>
          {cBrands.length > 1 && (
            <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 ml-4">
              {cBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={handlePull} disabled={pulling}
            className="ml-auto px-3 py-1.5 rounded-lg bg-cyan-700/30 border border-cyan-800/40 text-cyan-300 text-xs flex items-center gap-1.5 hover:bg-cyan-700/50 disabled:opacity-40">
            {pulling ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
            {pulling ? 'Pulling (5 API calls)…' : 'Pull Clarity now'}
          </button>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <MousePointerClick size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No Clarity data pulled yet.</p>
          <p className="text-[11px] text-slate-600 mt-1">Click "Pull Clarity now" to fetch the last 3 days across 5 dimensions.</p>
        </div>
      </div>
    );
  }

  const lastPullAge = snapshot ? Math.round((Date.now() - snapshot.pulledAt) / 3600000) : null;

  const TABS = [
    { id: 'overview',   icon: Eye,              label: 'Overview' },
    { id: 'problems',   icon: AlertTriangle,    label: 'What\'s broken' },
    { id: 'ads',        icon: TrendingUpIcon,   label: 'Ads × Clarity' },
    { id: 'pdps',       icon: Package,          label: 'Top PDPs' },
    { id: 'compare',    icon: TrendingDown,     label: 'Device / Channel' },
    { id: 'trend',      icon: RefreshCw,        label: 'WoW trend' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-500/20"><MousePointerClick size={18} className="text-cyan-400" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">Clarity Behavior</h1>
          <p className="text-[11px] text-slate-500">
            {snapshot.numOfDays}-day snapshot · pulled {lastPullAge != null && lastPullAge < 24 ? `${lastPullAge}h ago` : new Date(snapshot.pulledAt).toLocaleString()}
            {history.length > 0 && ` · ${history.length} snapshots in history`}
          </p>
        </div>
        {cBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200">
            {cBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button onClick={handlePull} disabled={pulling}
          className="ml-auto px-3 py-1.5 rounded-lg bg-cyan-700/30 border border-cyan-800/40 text-cyan-300 text-xs flex items-center gap-1.5 hover:bg-cyan-700/50 disabled:opacity-40">
          {pulling ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {pulling ? 'Pulling…' : 'Pull fresh (5/10 daily calls)'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit overflow-x-auto">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="Sessions" value={num(summary?.sessions || 0)} sub={`${num(summary?.pageViews)} page views`} />
            <KPI label="Rage-click rate" value={pct(summary?.rageRate)} sub={`${num(summary?.rageClicks)} rage clicks`} color="#ef4444"
              delta={priorSummary ? (summary?.rageRate - priorSummary.rageRate) : null} />
            <KPI label="Dead-click rate" value={pct(summary?.deadRate)} sub={`${num(summary?.deadClicks)} dead clicks`} color="#fb923c"
              delta={priorSummary ? (summary?.deadRate - priorSummary.deadRate) : null} />
            <KPI label="Quick-back rate" value={pct(summary?.qbRate)} sub={`${num(summary?.quickBacks)} quick backs`} color="#f59e0b"
              delta={priorSummary ? (summary?.qbRate - priorSummary.qbRate) : null} />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="URLs tracked" value={num(summary?.urlCount)} color="#06b6d4" />
            <KPI label="JS errors" value={num(summary?.jsErrors)} sub="script-level failures" color="#a78bfa" />
            <KPI label="Excessive scroll" value={num(summary?.excessiveScroll)} sub="visitors hunting content" color="#fbbf24" />
            <KPI label="API calls used" value={`5 / 10`} sub="today · resets midnight UTC" color="#64748b" />
          </div>

          {/* Verdict strip */}
          <div className="px-5 py-4 rounded-xl border border-cyan-800/40 bg-cyan-900/20 text-cyan-200">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">Verdict</div>
            <div className="text-sm leading-relaxed">
              {summary?.rageRate > 0.03
                ? <>Your rage-click rate is <span className="font-semibold text-red-300">{(summary.rageRate * 100).toFixed(1)}%</span> — above the 2% health threshold. Users are clicking things expecting a result and not getting one. Start with the "What's broken" tab.</>
                : summary?.qbRate > 0.15
                ? <>Quick-back rate at <span className="font-semibold text-amber-300">{(summary.qbRate * 100).toFixed(1)}%</span> — visitors hit a page and bounce fast. Usually pricing, OOS, or above-the-fold content fails to hold attention. Check "Ads × Clarity".</>
                : <>Site health looks within normal range. The real opportunities are in the <span className="text-cyan-200 font-semibold">Ads × Clarity</span> join — find specific PDPs where Google-driven traffic converts poorly due to behavioral issues.</>}
            </div>
          </div>

          {/* Quick access cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <button onClick={() => setTab('problems')} className="p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-red-800/40 text-left transition-all">
              <AlertTriangle size={16} className="text-red-400 mb-2" />
              <div className="text-sm font-semibold text-white">{rage.length} rage-click URLs</div>
              <div className="text-[11px] text-slate-500 mt-1">Pages where users repeatedly click and nothing happens</div>
            </button>
            <button onClick={() => setTab('problems')} className="p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-orange-800/40 text-left transition-all">
              <Bug size={16} className="text-orange-400 mb-2" />
              <div className="text-sm font-semibold text-white">{dead.length} dead-click URLs</div>
              <div className="text-[11px] text-slate-500 mt-1">Elements that look clickable but aren't</div>
            </button>
            <button onClick={() => setTab('ads')} className="p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-amber-800/40 text-left transition-all">
              <Zap size={16} className="text-amber-400 mb-2" />
              <div className="text-sm font-semibold text-white">{adsJoin.length} ad-driven problem PDPs</div>
              <div className="text-[11px] text-slate-500 mt-1">Google clicks landing on pages with behavioral red flags</div>
            </button>
            <button onClick={() => setTab('pdps')} className="p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-cyan-800/40 text-left transition-all">
              <Package size={16} className="text-cyan-400 mb-2" />
              <div className="text-sm font-semibold text-white">{shopifyJoin.length} selling PDPs with issues</div>
              <div className="text-[11px] text-slate-500 mt-1">Products that sell but whose PDP could convert more</div>
            </button>
          </div>
        </motion.div>
      )}

      {/* PROBLEMS */}
      {tab === 'problems' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {rage.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Flame size={14} className="text-red-400" /> Rage-click hotspots — users frustrated ({rage.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">Rage clicks = a visitor clicked the same element 3+ times in quick succession, signalling frustration. Usually broken buttons, laggy interactions, or conflicting UI.</p>
              <div className="overflow-auto" style={{ maxHeight: '400px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rage clicks</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rate</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rage.slice(0, 50).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2">
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[360px] inline-block">{shortUrl(r.url)}</a>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-300">{num(r.rageClicks)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400 font-bold">{pct(r.rageRate)}</td>
                        <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${severityPill(r.severity)}`}>{r.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {dead.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Bug size={14} className="text-orange-400" /> Dead-click hotspots ({dead.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">Dead clicks = visitor clicked something that didn't respond. Often misleading UI (text that looks like a link), broken scripts, or images that visitors expect to zoom.</p>
              <div className="overflow-auto" style={{ maxHeight: '400px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Dead clicks</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rate</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dead.slice(0, 50).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[360px] inline-block">{shortUrl(r.url)}</a></td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-300">{num(r.deadClicks)}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-400 font-bold">{pct(r.deadRate)}</td>
                        <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${severityPill(r.severity)}`}>{r.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {qb.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><ArrowRight size={14} className="text-amber-400 rotate-180" /> Quick-back pages — instant bounce ({qb.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">Quick backs = visitor landed, then hit the browser's Back button within a few seconds. Signals a hard mismatch between what they expected and what they saw.</p>
              <div className="overflow-auto" style={{ maxHeight: '360px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">QB rate</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qb.slice(0, 40).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[360px] inline-block">{shortUrl(r.url)}</a></td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-400 font-bold">{pct(r.qbRate)}</td>
                        <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${severityPill(r.severity)}`}>{r.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {shallow.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><TrendingDown size={14} className="text-yellow-400" /> Shallow scroll pages — above-fold failures ({shallow.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">Visitors don't scroll past 30% of the page. Your hero, headline, or above-fold isn't doing its job.</p>
              <div className="overflow-auto" style={{ maxHeight: '300px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Avg scroll</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shallow.slice(0, 30).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[260px] inline-block">{shortUrl(r.url)}</a></td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2 text-right font-mono text-yellow-400 font-bold">{pct(r.scrollDepth)}</td>
                        <td className="px-3 py-2 text-[11px] text-amber-300/80 truncate max-w-[400px]">{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {errors.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Bug size={14} className="text-red-400" /> JavaScript errors by page ({errors.length})</span>}>
              <div className="overflow-auto" style={{ maxHeight: '300px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Errors</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.slice(0, 20).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2"><a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[360px] inline-block">{shortUrl(r.url)}</a></td>
                        <td className="px-3 py-2 text-right font-mono text-red-300 font-bold">{num(r.jsErrors)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{pct(r.errorRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </motion.div>
      )}

      {/* ADS × CLARITY */}
      {tab === 'ads' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {!gAdsData && (
            <div className="px-4 py-3 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs text-amber-200">
              <div className="font-semibold mb-1">Google Ads not connected</div>
              <div className="text-amber-200/70">Connect Google Ads to join ad-driven landing pages with Clarity behavior data.</div>
            </div>
          )}
          {gAdsData && adsJoin.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
              No ad-driven landing pages match Clarity data yet. Either traffic is too low for the click floor (30 clicks) or URLs don't overlap.
            </div>
          )}
          {adsJoin.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Zap size={14} className="text-amber-400" /> Google Ads landing pages ranked by behavioral problems ({adsJoin.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">Each row: a URL that Google Ads is driving traffic to, with Clarity's behavioral signals attached. Problem score combines rage / dead / quick-back / shallow-scroll — ranked high to low.</p>
              <div className="overflow-auto" style={{ maxHeight: '600px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">URL</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Ad clicks</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Ad CVR</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Ad cost</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Clarity sess</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Behavioral red flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adsJoin.slice(0, 50).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2">
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[280px] inline-block">{shortUrl(r.url)}</a>
                          <ExternalLink size={9} className="inline ml-1 opacity-50" />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.clicks)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{pct(r.convRate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(r.adCost)}</td>
                        <td className="px-3 py-2 text-right font-mono text-cyan-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2">
                          {r.reasons.length === 0 ? <span className="text-slate-600 italic text-[11px]">none</span> : (
                            <div className="flex flex-wrap gap-1">
                              {r.reasons.map((x, j) => <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300">{x}</span>)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </motion.div>
      )}

      {/* TOP PDPS (SHOPIFY JOIN) */}
      {tab === 'pdps' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {!orders.length && (
            <div className="px-4 py-3 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs text-amber-200">
              <div className="font-semibold mb-1">No Shopify orders loaded</div>
              <div className="text-amber-200/70">Pull Shopify orders to join best-selling PDPs against Clarity behavior data.</div>
            </div>
          )}
          {shopifyJoin.length === 0 && orders.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
              No PDPs from your Shopify sales have behavioral red flags in Clarity. Great news.
            </div>
          )}
          {shopifyJoin.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Package size={14} className="text-emerald-400" /> Selling PDPs with fixable behavior issues ({shopifyJoin.length})</span>}>
              <p className="text-[11px] text-slate-500 mb-3">These products are selling organically but the PDPs have rage clicks, quick backs, shallow scrolls, or JS errors. Fix the page and the same traffic converts more — typical CRO lift 10-20% on a broken PDP.</p>
              <div className="overflow-auto" style={{ maxHeight: '600px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Product</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Revenue</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Units</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rage rate</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">QB rate</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Scroll</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Est. uplift if fixed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopifyJoin.slice(0, 50).map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2">
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate max-w-[220px] inline-block">{r.title || r.handle}</a>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-400 font-bold">{cur(r.revenue)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.units)}</td>
                        <td className="px-3 py-2 text-right font-mono text-cyan-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{pct(r.rageRate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-400">{pct(r.qbRate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-yellow-400">{pct(r.scrollDepth)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-300 font-bold">+{cur(r.potentialUplift)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </motion.div>
      )}

      {/* DEVICE / CHANNEL */}
      {tab === 'compare' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Card title={<span className="flex items-center gap-2"><Users size={14} /> Device split</span>}>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-400 font-semibold">Device</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rage %</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Dead %</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">QB %</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Scroll %</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                      <td className="px-3 py-2 text-slate-200 font-medium">{d.device}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(d.sessions)}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">{pct(d.rageRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-orange-400">{pct(d.deadRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-400">{pct(d.qbRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-yellow-400">{pct(d.avgScrollDepth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Globe2 size={14} /> Traffic source split</span>}>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-400 font-semibold">Channel</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Rage %</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">QB %</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Scroll %</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                      <td className="px-3 py-2 text-slate-200 font-medium truncate max-w-[200px]">{c.channel}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(c.sessions)}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">{pct(c.rageRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-400">{pct(c.qbRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-yellow-400">{pct(c.scrollDepth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}

      {/* WoW TREND */}
      {tab === 'trend' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {!comparison && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
              Comparative trend needs at least 2 snapshots. Pull Clarity again tomorrow and we'll compute deltas here.
            </div>
          )}
          {comparison && (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {Object.entries(comparison.summary).map(([key, v]) => {
                  const isPct = /Rate$/.test(key);
                  const isCount = key === 'sessions' || key === 'jsErrors';
                  const delta = v.delta;
                  const deltaBad = (key.match(/Rate|Errors/) && delta > 0) || (key === 'sessions' && delta < 0);
                  return (
                    <KPI key={key} label={key.replace(/([A-Z])/g, ' $1').trim()}
                      value={isPct ? pct(v.cur) : num(v.cur)}
                      sub={isPct ? `was ${pct(v.prior)}` : `was ${num(v.prior)}`}
                      color={deltaBad ? '#ef4444' : '#22c55e'}
                      delta={delta != null && isCount ? delta : null} />
                  );
                })}
              </div>
              {comparison.regressions?.length > 0 && (
                <Card title={<span className="flex items-center gap-2"><TrendingDown size={14} className="text-red-400" /> Regressions — URLs getting worse ({comparison.regressions.length})</span>}>
                  <div className="space-y-1.5">
                    {comparison.regressions.slice(0, 30).map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-[11px]">
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate flex-1">{shortUrl(r.url)}</a>
                        {r.rageRateDelta > 0 && <span className="text-red-400">Rage +{pct(r.rageRateDelta)}</span>}
                        {r.scrollDepthDelta < 0 && <span className="text-yellow-400">Scroll {pct(r.scrollDepthDelta)}</span>}
                        {r.sessionsDelta != null && r.sessionsDelta < 0 && <span className="text-slate-500">Sess {pct(r.sessionsDelta)}</span>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {comparison.improvements?.length > 0 && (
                <Card title={<span className="flex items-center gap-2"><TrendingUpIcon size={14} className="text-emerald-400" /> Improvements — URLs getting better ({comparison.improvements.length})</span>}>
                  <div className="space-y-1.5">
                    {comparison.improvements.slice(0, 20).map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-900/10 border border-emerald-800/30 text-[11px]">
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 truncate flex-1">{shortUrl(r.url)}</a>
                        {r.rageRateDelta < 0 && <span className="text-emerald-400">Rage {pct(r.rageRateDelta)}</span>}
                        {r.scrollDepthDelta > 0 && <span className="text-emerald-400">Scroll +{pct(r.scrollDepthDelta)}</span>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
