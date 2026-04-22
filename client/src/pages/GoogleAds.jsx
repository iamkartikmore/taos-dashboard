import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import {
  Search, TrendingUp, Monitor, Clock, Users, ShoppingBag,
  Target, RefreshCw, Zap, ChevronRight, Download, Brain,
} from 'lucide-react';
import { useStore } from '../store';
import { totalsFromNormalized } from '../lib/googleAdsAnalytics';
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
