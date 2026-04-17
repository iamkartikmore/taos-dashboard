import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, BarChart3, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { useStore } from '../store';
import { fetchInsights } from '../lib/api';
import { normalizeInsight } from '../lib/analytics';

/* ─── PERIODS ────────────────────────────────────────────────────── */
const PERIODS = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: '3d',        label: 'Last 3D',  lazy: true },
  { id: '7d',        label: 'Last 7D' },
  { id: '14d',       label: 'Last 14D' },
];

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
function fmt(n) {
  if (!n) return '—';
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + 'L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}
function fmtN(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtR(revenue, spend) {
  if (!spend || !revenue) return '—';
  const r = revenue / spend;
  return r.toFixed(2) + 'x';
}
function roasColor(revenue, spend) {
  if (!spend) return 'text-slate-500';
  const r = revenue / spend;
  if (r >= 3) return 'text-emerald-400';
  if (r >= 1.5) return 'text-amber-400';
  return 'text-red-400';
}

/* ─── AGGREGATION ────────────────────────────────────────────────── */
function addMetrics(target, row) {
  target.spend       += row.spend       || 0;
  target.impressions += row.impressions || 0;
  target.clicks      += row.outboundClicks || row.clicksAll || 0;
  target.purchases   += row.purchases   || 0;
  target.revenue     += row.revenue     || 0;
}

function groupByCollection(rows, manualMap) {
  const groups = {};

  for (const row of rows) {
    const col = manualMap[row.adId]?.Collection || 'Unmapped';

    if (!groups[col]) {
      groups[col] = {
        collection: col,
        spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0,
        campaigns: {}, adsets: {}, ads: {},
      };
    }
    const g = groups[col];
    addMetrics(g, row);

    // campaigns
    const cid = row.campaignId || '?';
    if (!g.campaigns[cid]) g.campaigns[cid] = { id: cid, name: row.campaignName || cid, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 };
    addMetrics(g.campaigns[cid], row);

    // adsets
    const sid = row.adSetId || '?';
    if (!g.adsets[sid]) g.adsets[sid] = { id: sid, name: row.adSetName || sid, campaignName: row.campaignName || '', spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 };
    addMetrics(g.adsets[sid], row);

    // ads
    const adid = row.adId || '?';
    if (!g.ads[adid]) g.ads[adid] = { id: adid, name: row.adName || adid, adSetName: row.adSetName || '', campaignName: row.campaignName || '', spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 };
    addMetrics(g.ads[adid], row);
  }

  return Object.values(groups)
    .map(g => ({
      ...g,
      campaigns: Object.values(g.campaigns).sort((a, b) => b.spend - a.spend),
      adsets:    Object.values(g.adsets).sort((a, b) => b.spend - a.spend),
      ads:       Object.values(g.ads).sort((a, b) => b.spend - a.spend),
    }))
    .sort((a, b) => b.spend - a.spend);
}

/* ─── ENTITY TABLE ───────────────────────────────────────────────── */
const COL_CONFIGS = {
  campaigns: [
    { key: 'name',        label: 'Campaign',     wide: true },
    { key: 'spend',       label: 'Spend',        num: true, fmt: r => fmt(r.spend) },
    { key: 'impressions', label: 'Impr.',        num: true, fmt: r => fmtN(r.impressions) },
    { key: 'clicks',      label: 'Clicks',       num: true, fmt: r => fmtN(r.clicks) },
    { key: 'purchases',   label: 'Purchases',    num: true, fmt: r => fmtN(r.purchases) },
    { key: 'revenue',     label: 'Revenue',      num: true, fmt: r => fmt(r.revenue), cls: r => 'text-emerald-400' },
    { key: 'roas',        label: 'ROAS',         num: true, fmt: r => fmtR(r.revenue, r.spend), cls: r => roasColor(r.revenue, r.spend) },
  ],
  adsets: [
    { key: 'name',        label: 'Ad Set',       wide: true },
    { key: 'campaignName',label: 'Campaign',     sub: true },
    { key: 'spend',       label: 'Spend',        num: true, fmt: r => fmt(r.spend) },
    { key: 'impressions', label: 'Impr.',        num: true, fmt: r => fmtN(r.impressions) },
    { key: 'clicks',      label: 'Clicks',       num: true, fmt: r => fmtN(r.clicks) },
    { key: 'purchases',   label: 'Purchases',    num: true, fmt: r => fmtN(r.purchases) },
    { key: 'revenue',     label: 'Revenue',      num: true, fmt: r => fmt(r.revenue), cls: r => 'text-emerald-400' },
    { key: 'roas',        label: 'ROAS',         num: true, fmt: r => fmtR(r.revenue, r.spend), cls: r => roasColor(r.revenue, r.spend) },
  ],
  ads: [
    { key: 'name',        label: 'Ad',           wide: true },
    { key: 'adSetName',   label: 'Ad Set',       sub: true },
    { key: 'campaignName',label: 'Campaign',     sub: true },
    { key: 'spend',       label: 'Spend',        num: true, fmt: r => fmt(r.spend) },
    { key: 'impressions', label: 'Impr.',        num: true, fmt: r => fmtN(r.impressions) },
    { key: 'clicks',      label: 'Clicks',       num: true, fmt: r => fmtN(r.clicks) },
    { key: 'purchases',   label: 'Purchases',    num: true, fmt: r => fmtN(r.purchases) },
    { key: 'revenue',     label: 'Revenue',      num: true, fmt: r => fmt(r.revenue), cls: r => 'text-emerald-400' },
    { key: 'roas',        label: 'ROAS',         num: true, fmt: r => fmtR(r.revenue, r.spend), cls: r => roasColor(r.revenue, r.spend) },
  ],
};

function EntityTable({ rows, entityType }) {
  const cols = COL_CONFIGS[entityType] || COL_CONFIGS.ads;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700/40">
            {cols.map(col => (
              <th
                key={col.key}
                className={`py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap
                  ${col.num ? 'text-right' : 'text-left'}
                  ${col.wide ? 'min-w-[180px]' : ''}
                  ${col.sub ? 'min-w-[130px]' : ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-gray-800/30 hover:bg-white/[0.02] transition-colors">
              {cols.map(col => (
                <td
                  key={col.key}
                  className={`py-2 px-3 ${col.num ? 'text-right font-mono' : 'text-left'}
                    ${col.wide ? 'font-medium text-white' : 'text-gray-400'}
                    ${col.cls ? col.cls(row) : ''}
                    ${col.sub ? 'text-slate-500 text-[11px]' : ''}`}
                >
                  {col.fmt ? col.fmt(row) : (row[col.key] || '—')}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="py-6 text-center text-slate-600 text-xs">No data</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── COLLECTION ROW ─────────────────────────────────────────────── */
function CollectionRow({ group, totalSpend }) {
  const [open, setOpen]     = useState(false);
  const [subTab, setSubTab] = useState('campaigns');
  const pct = totalSpend > 0 ? (group.spend / totalSpend) * 100 : 0;

  const subTabs = [
    { id: 'campaigns', label: `Campaigns`, count: group.campaigns.length },
    { id: 'adsets',    label: `Ad Sets`,   count: group.adsets.length },
    { id: 'ads',       label: `Ads`,       count: group.ads.length },
  ];

  return (
    <div className="border border-gray-800/60 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gray-900/50 hover:bg-gray-800/50 transition-colors text-left group"
      >
        <span className="text-slate-500 group-hover:text-slate-300 transition-colors shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Collection name + spend bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white">{group.collection}</span>
            <span className="text-[11px] text-slate-500">{pct.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 max-w-[200px]">
            <div className="flex-1 h-[3px] bg-gray-700/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          {[
            { label: 'Spend',       value: fmt(group.spend),          cls: 'text-white font-semibold' },
            { label: 'Impressions', value: fmtN(group.impressions),   cls: 'text-gray-300' },
            { label: 'Clicks',      value: fmtN(group.clicks),        cls: 'text-gray-300' },
            { label: 'Purchases',   value: fmtN(group.purchases),     cls: 'text-gray-300' },
            { label: 'Revenue',     value: fmt(group.revenue),        cls: 'text-emerald-400 font-medium' },
            { label: 'ROAS',        value: fmtR(group.revenue, group.spend), cls: roasColor(group.revenue, group.spend) + ' font-bold' },
          ].map(m => (
            <div key={m.label} className="text-right min-w-[64px]">
              <div className="text-[10px] text-slate-500 leading-none mb-1">{m.label}</div>
              <div className={`text-sm ${m.cls}`}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Mobile: just spend + ROAS */}
        <div className="flex sm:hidden items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[10px] text-slate-500">Spend</div>
            <div className="text-sm font-semibold text-white">{fmt(group.spend)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500">ROAS</div>
            <div className={`text-sm font-bold ${roasColor(group.revenue, group.spend)}`}>
              {fmtR(group.revenue, group.spend)}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-gray-800/50 bg-gray-950/40">
          {/* Sub-tabs */}
          <div className="flex gap-1 px-4 pt-3 pb-0">
            {subTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors border-b-2
                  ${subTab === t.id
                    ? 'bg-gray-800/60 text-white border-brand-500'
                    : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-gray-800/30'
                  }`}
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full
                  ${subTab === t.id ? 'bg-brand-600/30 text-brand-300' : 'bg-gray-700/50 text-slate-500'}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="border-t border-gray-800/50 px-1 py-1">
            <EntityTable rows={group[subTab]} entityType={subTab} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────── */
export default function CollectionSpend() {
  const { rawAccounts, manualMap, brands, activeBrandIds } = useStore();

  const [period, setPeriod]           = useState('7d');
  const [rows3d, setRows3d]           = useState([]);
  const [fetch3dStatus, setFetch3dStatus] = useState('idle');   // idle | loading | done | error
  const [fetch3dMsg, setFetch3dMsg]   = useState('');

  /* fetch 3d data from Meta */
  const fetchRows3d = useCallback(async () => {
    setFetch3dStatus('loading');
    setFetch3dMsg('Connecting to Meta API...');
    const collected = [];
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    try {
      for (const brand of active) {
        const { token, apiVersion = 'v21.0', accounts = [] } = brand.meta || {};
        if (!token) continue;
        for (const acc of accounts) {
          if (!acc.id || !acc.key) continue;
          setFetch3dMsg(`Fetching ${acc.key}...`);
          const raw = await fetchInsights(apiVersion, token, acc.id, 'last_3d');
          collected.push(...raw.map(r => normalizeInsight(r, acc.key, '3D')));
        }
      }
      setRows3d(collected);
      setFetch3dStatus('done');
      setFetch3dMsg('');
    } catch (e) {
      setFetch3dStatus('error');
      setFetch3dMsg(e.message);
    }
  }, [brands, activeBrandIds]);

  /* period rows */
  const rows = useMemo(() => {
    if (period === '3d')        return rows3d;
    if (period === 'yesterday') return rawAccounts.flatMap(a => a.insightsToday || []);
    if (period === '7d')        return rawAccounts.flatMap(a => a.insights7d    || []);
    if (period === '14d')       return rawAccounts.flatMap(a => a.insights14d   || []);
    return [];
  }, [period, rawAccounts, rows3d]);

  const groups     = useMemo(() => groupByCollection(rows, manualMap), [rows, manualMap]);
  const totalSpend = useMemo(() => groups.reduce((s, g) => s + g.spend, 0), [groups]);
  const totalRev   = useMemo(() => groups.reduce((s, g) => s + g.revenue, 0), [groups]);
  const totalPurch = useMemo(() => groups.reduce((s, g) => s + g.purchases, 0), [groups]);

  const periodName = { yesterday: 'Yesterday', '3d': 'Last 3 Days', '7d': 'Last 7 Days', '14d': 'Last 14 Days' }[period];

  function handlePeriod(id) {
    setPeriod(id);
    if (id === '3d' && fetch3dStatus === 'idle') fetchRows3d();
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp size={20} className="text-brand-400" />
            Collection Spend
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Ad spend, performance, and creative breakdown by collection — {periodName}
          </p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => handlePeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              period === p.id
                ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30'
                : 'bg-gray-800/50 text-slate-400 hover:text-slate-200 hover:bg-gray-800'
            }`}
          >
            {p.label}
            {p.lazy && fetch3dStatus === 'loading' && period === p.id && (
              <Loader2 size={12} className="inline ml-1.5 animate-spin" />
            )}
          </button>
        ))}
        {period === '3d' && fetch3dStatus === 'done' && (
          <button
            onClick={fetchRows3d}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-gray-800 transition-colors"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        )}
      </div>

      {/* 3D status messages */}
      {period === '3d' && fetch3dStatus === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-400 bg-gray-800/40 rounded-xl border border-gray-700/40 px-4 py-3">
          <Loader2 size={14} className="animate-spin text-brand-400 shrink-0" />
          {fetch3dMsg}
        </div>
      )}
      {period === '3d' && fetch3dStatus === 'error' && (
        <div className="flex items-center gap-3 text-sm bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <span className="text-red-400 flex-1">{fetch3dMsg}</span>
          <button onClick={fetchRows3d} className="text-xs text-red-300 hover:text-red-100 underline shrink-0">Retry</button>
        </div>
      )}

      {/* Summary KPIs */}
      {groups.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Spend',    value: fmt(totalSpend),                          sub: periodName },
            { label: 'Total Revenue',  value: fmt(totalRev),    cls: 'text-emerald-400', sub: 'from Meta' },
            { label: 'Overall ROAS',   value: fmtR(totalRev, totalSpend), cls: roasColor(totalRev, totalSpend), sub: `${fmtN(totalPurch)} purchases` },
            { label: 'Collections',    value: String(groups.length),                    sub: 'with spend data' },
          ].map(k => (
            <div key={k.label} className="bg-gray-900/60 rounded-xl border border-gray-800/60 px-4 py-3.5">
              <div className="text-[11px] text-slate-500 mb-1">{k.label}</div>
              <div className={`text-xl font-bold ${k.cls || 'text-white'}`}>{k.value}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {groups.length === 0 && fetch3dStatus !== 'loading' && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 border border-gray-800/40 rounded-2xl bg-gray-900/20">
          <BarChart3 size={40} className="mb-3 opacity-20" />
          <div className="text-sm font-medium">No spend data for {periodName}</div>
          <div className="text-xs mt-1 opacity-60 text-center max-w-xs">
            {period === '3d'
              ? 'Pull failed or no data. Try refreshing.'
              : 'Fetch Meta data from Setup, then assign collections to ads via the manual map.'}
          </div>
        </div>
      )}

      {/* Collection rows */}
      {groups.length > 0 && (
        <div className="space-y-2">
          {groups.map(group => (
            <CollectionRow key={group.collection} group={group} totalSpend={totalSpend} />
          ))}
        </div>
      )}
    </div>
  );
}
