import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, CheckCircle, AlertCircle, RefreshCw, Key, Users,
  BookOpen, Upload, ShoppingBag, Zap, ChevronDown, ChevronRight,
  Palette, Activity,
} from 'lucide-react';
import { useStore, makeBrand, BRAND_COLORS } from '../store';
import { pullAccount, verifyToken, fetchShopifyInventory, fetchShopifyOrders, fetchGaData } from '../lib/api';
import { BREAKDOWN_SPECS, pullAllBreakdowns } from '../lib/breakdownApi';
import { parseCsv, csvRowsToManualMap, detectListsFromCsvRows } from '../lib/csvImport';
import Spinner from '../components/ui/Spinner';

/* ─── HELPERS ────────────────────────────────────────────────────── */
const daysToRange = days => {
  const now = new Date();
  if (days === 'all') return { since: null, until: now.toISOString() };
  if (days === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const d = y.toISOString().slice(0, 10);
    return { since: `${d}T00:00:00.000Z`, until: `${d}T23:59:59.999Z` };
  }
  return { since: new Date(now - Number(days) * 86400000).toISOString(), until: now.toISOString() };
};

const ORDER_WINDOWS = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 7,           label: 'Last 7 days' },
  { value: 14,          label: 'Last 14 days' },
  { value: 30,          label: 'Last 30 days' },
  { value: 90,          label: 'Last 90 days' },
  { value: 180,         label: 'Last 180 days' },
  { value: 365,         label: 'Last 365 days' },
  { value: 'all',       label: 'All time' },
];

/* ─── STATUS DOT ─────────────────────────────────────────────────── */
function StatusDot({ status }) {
  if (!status || status === 'idle') return <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />;
  if (status === 'loading')  return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (status === 'success')  return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (status === 'error')    return <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />;
}

/* ─── BRAND CARD ─────────────────────────────────────────────────── */
function BrandCard({ brand, brandInfo, onOrdersDaysChange, ordersDays }) {
  const {
    updateBrand, removeBrand, addBrandAccount, updateBrandAccount, removeBrandAccount,
    setBrandMetaData, setBrandMetaStatus,
    setBrandInventory, setBrandInventoryStatus,
    setBrandOrders, setBrandOrdersStatus,
    setBrandGaData, setBrandGaStatus,
    appendLog,
  } = useStore();

  const [expanded, setExpanded]   = useState(true);
  const [pulling, setPulling]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyOk, setVerifyOk]   = useState(null);
  const [showPalette, setShowPalette] = useState(false);

  const bd = brandInfo || {};
  const metaStatus      = bd.metaStatus      || 'idle';
  const inventoryStatus = bd.inventoryStatus || 'idle';
  const ordersStatus    = bd.ordersStatus    || 'idle';
  const gaStatus        = bd.gaStatus        || 'idle';
  const hasToken   = !!brand.meta.token;
  const hasAccts   = brand.meta.accounts.filter(a => a.key && a.id).length > 0;
  const hasShopify = brand.shopify.shop && brand.shopify.clientId && brand.shopify.clientSecret;
  const hasGa      = brand.ga?.propertyId && brand.ga?.serviceAccountJson;

  const handleVerify = async () => {
    if (!hasToken) return;
    setVerifying(true); setVerifyOk(null);
    try {
      const me = await verifyToken(brand.meta.token, brand.meta.apiVersion);
      setVerifyOk({ ok: true, name: me.name });
    } catch (e) { setVerifyOk({ ok: false, msg: e.message }); }
    finally { setVerifying(false); }
  };

  const handlePullMeta = async () => {
    const accounts = brand.meta.accounts.filter(a => a.key && a.id);
    if (!hasToken || !accounts.length) return;
    setPulling(true);
    setBrandMetaStatus(brand.id, 'loading');
    appendLog(`[${brand.name}] Starting Meta pull...`);
    try {
      let combined = { campaigns: [], adsets: [], ads: [], insightsToday: [], insights7d: [], insights14d: [], insights30d: [] };
      for (const acc of accounts) {
        const r = await pullAccount(
          { ver: brand.meta.apiVersion, token: brand.meta.token, accountKey: acc.key, accountId: acc.id },
          msg => appendLog(`[${brand.name}] ${msg}`),
        );
        combined.campaigns.push(...r.campaigns);
        combined.adsets.push(...r.adsets);
        combined.ads.push(...r.ads);
        combined.insightsToday.push(...r.insightsToday);
        combined.insights7d.push(...r.insights7d);
        combined.insights14d.push(...r.insights14d);
        combined.insights30d.push(...r.insights30d);
      }
      setBrandMetaData(brand.id, combined);
      appendLog(`[${brand.name}] ✅ Meta done`);
    } catch (e) {
      setBrandMetaStatus(brand.id, 'error', e.message);
      appendLog(`[${brand.name}] ❌ Meta error: ${e.message}`);
    } finally { setPulling(false); }
  };

  const handlePullInventory = async () => {
    if (!hasShopify) return;
    setBrandInventoryStatus(brand.id, 'loading');
    try {
      const result = await fetchShopifyInventory(brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret);
      setBrandInventory(brand.id, result.map, result.locations, result.inventoryByLocation, result.skuToItemId);
      appendLog(`[${brand.name}] ✅ Inventory — ${Object.keys(result.map).length} SKUs · ${result.locations.length} locations`);
    } catch (e) {
      setBrandInventoryStatus(brand.id, 'error');
      appendLog(`[${brand.name}] ❌ Inventory error: ${e.message}`);
    }
  };

  const handlePullOrders = async () => {
    if (!hasShopify) return;
    setBrandOrdersStatus(brand.id, 'loading');
    try {
      const { since, until } = daysToRange(ordersDays);
      const { orders: fetchedOrders, count } = await fetchShopifyOrders(
        brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret,
        since, until, msg => appendLog(`[${brand.name}] ${msg}`),
      );
      setBrandOrders(brand.id, fetchedOrders, ordersDays);
      appendLog(`[${brand.name}] ✅ Orders — ${count} orders`);
    } catch (e) {
      setBrandOrdersStatus(brand.id, 'error', e.message);
      appendLog(`[${brand.name}] ❌ Orders error: ${e.message}`);
    }
  };

  const handlePullGa = async () => {
    if (!brand.ga?.propertyId || !brand.ga?.serviceAccountJson) return;
    setBrandGaStatus(brand.id, 'loading');
    try {
      const data = await fetchGaData(
        brand.ga.serviceAccountJson, brand.ga.propertyId,
        { since: '7daysAgo', until: 'today' },
        msg => appendLog(`[${brand.name}] ${msg}`),
      );
      setBrandGaData(brand.id, data);
      appendLog(`[${brand.name}] ✅ GA — ${data.dailyTrend?.length || 0} days of data`);
    } catch (e) {
      setBrandGaStatus(brand.id, 'error', e.message);
      appendLog(`[${brand.name}] ❌ GA error: ${e.message}`);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
        {/* Color swatch + picker */}
        <div className="relative">
          <button onClick={() => setShowPalette(v => !v)}
            className="w-5 h-5 rounded-full ring-2 ring-gray-700 hover:ring-gray-500 transition-all shrink-0"
            style={{ background: brand.color }} />
          {showPalette && (
            <div className="absolute top-7 left-0 z-20 bg-gray-800 border border-gray-700 rounded-xl p-2 flex flex-wrap gap-1.5 w-28 shadow-xl">
              {BRAND_COLORS.map(c => (
                <button key={c} onClick={() => { updateBrand(brand.id, { color: c }); setShowPalette(false); }}
                  className="w-5 h-5 rounded-full ring-1 ring-gray-700 hover:scale-110 transition-all"
                  style={{ background: c }} />
              ))}
            </div>
          )}
        </div>

        <input
          value={brand.name}
          onChange={e => updateBrand(brand.id, { name: e.target.value })}
          className="flex-1 bg-transparent text-white font-semibold text-sm focus:outline-none placeholder-gray-600"
          placeholder="Brand name"
        />

        {/* Status dots */}
        <div className="flex items-center gap-1.5" title="Meta · Inventory · Orders">
          <StatusDot status={metaStatus} />
          <StatusDot status={inventoryStatus} />
          <StatusDot status={ordersStatus} />
        </div>

        <button onClick={handlePullMeta} disabled={pulling || !hasToken || !hasAccts}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-600/20 hover:bg-brand-600/40 disabled:opacity-30 rounded-lg text-xs font-medium text-brand-300 transition-all border border-brand-700/30">
          {pulling ? <Spinner size="sm" /> : <RefreshCw size={11} />} Pull Meta
        </button>

        <button onClick={() => setExpanded(v => !v)}
          className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <button onClick={() => removeBrand(brand.id)}
          className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
            exit={{ height:0, opacity:0 }} transition={{ duration:0.18 }}
            className="overflow-hidden">
            <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">

              {/* ── META ───────────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <Key size={11} /> Meta Ads
                  <StatusDot status={metaStatus} />
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Access Token</label>
                  <input type="password"
                    value={brand.meta.token}
                    onChange={e => updateBrand(brand.id, { meta: { token: e.target.value } })}
                    placeholder="EAA..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 mb-1 block">API Version</label>
                    <input type="text"
                      value={brand.meta.apiVersion}
                      onChange={e => updateBrand(brand.id, { meta: { apiVersion: e.target.value } })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                  </div>
                  <div className="mt-4">
                    <button onClick={handleVerify} disabled={verifying || !hasToken}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-xs text-slate-300 transition-all border border-gray-700">
                      {verifying ? <Spinner size="sm" /> : <CheckCircle size={11} />} Verify
                    </button>
                  </div>
                </div>

                {verifyOk && (
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${verifyOk.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                    {verifyOk.ok ? <><CheckCircle size={11} /> {verifyOk.name}</> : <><AlertCircle size={11} /> {verifyOk.msg}</>}
                  </div>
                )}

                {/* Accounts */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Ad Accounts</label>
                    <button onClick={() => addBrandAccount(brand.id)}
                      className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 transition-colors">
                      <Plus size={10} /> Add
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {brand.meta.accounts.map((acc, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input type="text" value={acc.key}
                          onChange={e => updateBrandAccount(brand.id, i, { key: e.target.value })}
                          placeholder="Key (MAIN)"
                          className="w-20 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        <input type="text" value={acc.id}
                          onChange={e => updateBrandAccount(brand.id, i, { id: e.target.value })}
                          placeholder="Account ID"
                          className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        <button onClick={() => removeBrandAccount(brand.id, i)}
                          className="p-1 text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    {brand.meta.accounts.length === 0 && (
                      <p className="text-[10px] text-slate-600 italic">No accounts — click Add above</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── SHOPIFY ────────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <ShoppingBag size={11} /> Shopify
                  <StatusDot status={inventoryStatus} />
                  <StatusDot status={ordersStatus} />
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Shop Domain</label>
                  <input type="text"
                    value={brand.shopify.shop}
                    onChange={e => updateBrand(brand.id, { shopify: { shop: e.target.value } })}
                    placeholder="yourshop (no .myshopify.com)"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Client ID</label>
                  <input type="text"
                    value={brand.shopify.clientId}
                    onChange={e => updateBrand(brand.id, { shopify: { clientId: e.target.value } })}
                    placeholder="bc70bfdc..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Client Secret</label>
                  <input type="password"
                    value={brand.shopify.clientSecret}
                    onChange={e => updateBrand(brand.id, { shopify: { clientSecret: e.target.value } })}
                    placeholder="shpss_..."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={handlePullInventory} disabled={!hasShopify || inventoryStatus === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-emerald-300 transition-all border border-emerald-700/30">
                    {inventoryStatus === 'loading' ? <Spinner size="sm" /> : <ShoppingBag size={11} />} Inventory
                  </button>
                  <button onClick={handlePullOrders} disabled={!hasShopify || ordersStatus === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700/30 hover:bg-violet-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-violet-300 transition-all border border-violet-700/30">
                    {ordersStatus === 'loading' ? <Spinner size="sm" /> : <ShoppingBag size={11} />} Orders
                  </button>
                </div>

                {/* Status tags */}
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {bd.inventoryMap && Object.keys(bd.inventoryMap).length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">
                      {Object.keys(bd.inventoryMap).length} SKUs
                    </span>
                  )}
                  {bd.orders && (
                    <span className="px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-400">
                      {bd.orders.length} orders
                    </span>
                  )}
                  {bd.metaFetchAt && (
                    <span className="px-2 py-0.5 rounded-full bg-brand-900/30 text-brand-400">
                      Meta: {new Date(bd.metaFetchAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              {/* ── GOOGLE ANALYTICS ───────────────────────────────── */}
              <div className="space-y-3 xl:col-span-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                  Google Analytics 4
                  <StatusDot status={gaStatus} />
                  {bd.gaFetchAt && <span className="text-[10px] text-slate-600 font-normal ml-1">Last: {new Date(bd.gaFetchAt).toLocaleTimeString()}</span>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">GA4 Property ID</label>
                    <input type="text"
                      value={brand.ga?.propertyId || ''}
                      onChange={e => updateBrand(brand.id, { ga: { ...brand.ga, propertyId: e.target.value } })}
                      placeholder="123456789"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Service Account JSON</label>
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 hover:border-blue-500 rounded-lg text-xs text-slate-400 cursor-pointer transition-colors truncate">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        {brand.ga?.serviceAccountJson ? <span className="text-emerald-400">JSON loaded ✓</span> : 'Upload service-account.json'}
                        <input type="file" accept=".json,application/json" className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await file.text();
                            try { JSON.parse(text); updateBrand(brand.id, { ga: { ...brand.ga, serviceAccountJson: text } }); }
                            catch { appendLog(`[${brand.name}] ❌ Invalid JSON file`); }
                            e.target.value = '';
                          }} />
                      </label>
                      {brand.ga?.serviceAccountJson && (
                        <button onClick={() => updateBrand(brand.id, { ga: { ...brand.ga, serviceAccountJson: '' } })}
                          className="px-2 py-1.5 bg-gray-800 hover:bg-red-900/30 border border-gray-700 rounded-lg text-xs text-slate-500 hover:text-red-400 transition-colors">✕</button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={handlePullGa} disabled={!hasGa || gaStatus === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700/30 hover:bg-blue-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-blue-300 transition-all border border-blue-700/30">
                    {gaStatus === 'loading' ? <Spinner size="sm" /> : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>}
                    Pull GA4 Data
                  </button>
                  {bd.gaData && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 text-[10px]">
                      {bd.gaData.dailyTrend?.length || 0}d trend · {bd.gaData.campaigns?.length || 0} campaigns
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────── */
export default function Setup() {
  const {
    brands, addBrand, brandData,
    manualMap, setManualMap, setManualRow, rebuildEnriched,
    fetchLog, appendLog, clearLog, setFetchStatus,
    enrichedRows, dynamicLists, mergeDynamicLists,
    setBrandMetaData, setBrandMetaStatus,
    setBrandInventory, setBrandInventoryStatus,
    setBrandOrders, setBrandOrdersStatus,
    setBrandGaData, setBrandGaStatus,
    setBreakdownData, setBreakdownStatus,
  } = useStore();

  const LISTS = dynamicLists;

  const [activeTab, setActiveTab]   = useState('brands');
  const [megaFetching, setMegaFetching] = useState(false);
  const [megaStep, setMegaStep]     = useState('');
  const [ordersDays, setOrdersDays] = useState(7);
  const [manualSearch, setManualSearch] = useState('');
  const [csvStatus, setCsvStatus]   = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const csvRef = useRef(null);
  const saveTimer = useRef(null);

  const flashSaved = () => {
    setSavedFlash(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSavedFlash(false), 2000);
  };

  /* ── CSV import ────────────────────────────────────────────────── */
  const handleCsv = async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      setManualMap({ ...manualMap, ...csvRowsToManualMap(rows) });
      mergeDynamicLists(detectListsFromCsvRows(rows));
      rebuildEnriched();
      setCsvStatus({ count: Object.keys(csvRowsToManualMap(rows)).length });
      flashSaved();
    } catch (err) { setCsvStatus({ error: err.message }); }
    e.target.value = '';
  };

  /* ── Pull Everything ───────────────────────────────────────────── */
  const handlePullEverything = async () => {
    setMegaFetching(true);
    clearLog();
    setActiveTab('log');

    for (const brand of brands) {
      const accounts  = brand.meta.accounts.filter(a => a.key && a.id);
      const hasMeta   = !!brand.meta.token && accounts.length > 0;
      const hasShopify = brand.shopify.shop && brand.shopify.clientId && brand.shopify.clientSecret;

      appendLog(`━━━ ${brand.name} ━━━`);

      if (hasMeta) {
        // Meta
        setMegaStep(`${brand.id}:meta`);
        appendLog(`[${brand.name}] Fetching Meta ads...`);
        setBrandMetaStatus(brand.id, 'loading');
        try {
          let combined = { campaigns:[], adsets:[], ads:[], insightsToday:[], insights7d:[], insights14d:[], insights30d:[] };
          for (const acc of accounts) {
            const r = await pullAccount(
              { ver: brand.meta.apiVersion, token: brand.meta.token, accountKey: acc.key, accountId: acc.id },
              msg => appendLog(`[${brand.name}] ${msg}`),
            );
            combined.campaigns.push(...r.campaigns);
            combined.adsets.push(...r.adsets);
            combined.ads.push(...r.ads);
            combined.insightsToday.push(...r.insightsToday);
            combined.insights7d.push(...r.insights7d);
            combined.insights14d.push(...r.insights14d);
            combined.insights30d.push(...r.insights30d);
          }
          setBrandMetaData(brand.id, combined);
          appendLog(`[${brand.name}] ✅ Meta done`);
        } catch (e) {
          setBrandMetaStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ Meta: ${e.message}`);
        }

        // Breakdowns
        setMegaStep(`${brand.id}:breakdowns`);
        appendLog(`[${brand.name}] Fetching 7D breakdowns...`);
        setBreakdownStatus('loading');
        try {
          const bdResult = await pullAllBreakdowns(
            { ver: brand.meta.apiVersion, token: brand.meta.token, accounts, specs: BREAKDOWN_SPECS, window: '7D' },
            msg => appendLog(`[${brand.name}] ${msg}`),
          );
          setBreakdownData(bdResult);
          appendLog(`[${brand.name}] ✅ Breakdowns done`);
        } catch (e) {
          setBreakdownStatus('error');
          appendLog(`[${brand.name}] ❌ Breakdowns: ${e.message}`);
        }
      } else {
        appendLog(`[${brand.name}] ⚠️ Meta not configured — skipped`);
      }

      if (hasShopify) {
        // Inventory
        setMegaStep(`${brand.id}:inventory`);
        appendLog(`[${brand.name}] Fetching Shopify inventory...`);
        setBrandInventoryStatus(brand.id, 'loading');
        try {
          const result = await fetchShopifyInventory(brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret);
          setBrandInventory(brand.id, result.map, result.locations, result.inventoryByLocation, result.skuToItemId);
          appendLog(`[${brand.name}] ✅ Inventory — ${Object.keys(result.map).length} SKUs · ${result.locations.length} locations`);
        } catch (e) {
          setBrandInventoryStatus(brand.id, 'error');
          appendLog(`[${brand.name}] ❌ Inventory: ${e.message}`);
        }

        // Orders
        setMegaStep(`${brand.id}:orders`);
        const label = ordersDays === 'all' ? 'all time' : ordersDays === 'yesterday' ? 'yesterday' : `last ${ordersDays}d`;
        appendLog(`[${brand.name}] Fetching Shopify orders (${label})...`);
        setBrandOrdersStatus(brand.id, 'loading');
        try {
          const { since, until } = daysToRange(ordersDays);
          const { orders: fetched, count } = await fetchShopifyOrders(
            brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret,
            since, until, msg => appendLog(`[${brand.name}] ${msg}`),
          );
          setBrandOrders(brand.id, fetched, ordersDays);
          appendLog(`[${brand.name}] ✅ Orders — ${count} orders`);
        } catch (e) {
          setBrandOrdersStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ Orders: ${e.message}`);
        }
      } else {
        appendLog(`[${brand.name}] ⚠️ Shopify not configured — skipped`);
      }

      // GA
      if (brand.ga?.propertyId && brand.ga?.serviceAccountJson) {
        setMegaStep(`${brand.id}:ga`);
        appendLog(`[${brand.name}] Fetching Google Analytics...`);
        setBrandGaStatus(brand.id, 'loading');
        try {
          const gaResult = await fetchGaData(
            brand.ga.serviceAccountJson, brand.ga.propertyId,
            { since: '7daysAgo', until: 'today' },
            msg => appendLog(`[${brand.name}] ${msg}`),
          );
          setBrandGaData(brand.id, gaResult);
          appendLog(`[${brand.name}] ✅ GA — ${gaResult.dailyTrend?.length || 0}d`);
        } catch (e) {
          setBrandGaStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ GA: ${e.message}`);
        }
      } else {
        appendLog(`[${brand.name}] ⚠️ GA not configured — skipped`);
      }
    }

    appendLog('🎉 Pull Everything complete!');
    setMegaStep('');
    setMegaFetching(false);
  };

  const TABS = [
    { id: 'brands',  label: 'Brands & Connections', icon: Zap },
    { id: 'import',  label: 'Import CSV',            icon: Upload },
    { id: 'manual',  label: 'Manual Labels',         icon: BookOpen },
    { id: 'log',     label: 'Fetch Log',             icon: RefreshCw },
  ];

  const adsForManual = enrichedRows
    .filter(r => !manualSearch
      || r.adName?.toLowerCase().includes(manualSearch.toLowerCase())
      || r.campaignName?.toLowerCase().includes(manualSearch.toLowerCase()))
    .slice(0, 200);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Study Manual</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage brands, connect Meta + Shopify, pull data, and apply manual labels.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* ── BRANDS TAB ────────────────────────────────────────────── */}
      {activeTab === 'brands' && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="space-y-4">

          {/* Brand cards */}
          {brands.map(brand => (
            <BrandCard
              key={brand.id}
              brand={brand}
              brandInfo={brandData[brand.id]}
              ordersDays={ordersDays}
              onOrdersDaysChange={setOrdersDays}
            />
          ))}

          <button onClick={addBrand}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 hover:border-brand-500 rounded-xl text-sm text-slate-400 hover:text-brand-300 transition-all w-full justify-center">
            <Plus size={14} /> Add Brand
          </button>

          {/* Pull Everything */}
          <div className="bg-gradient-to-br from-brand-900/40 to-violet-900/30 rounded-2xl border border-brand-700/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-brand-600/30"><Zap size={16} className="text-brand-300" /></div>
              <div>
                <div className="text-white font-bold text-sm">Pull Everything</div>
                <div className="text-[11px] text-slate-400">{brands.length} brand{brands.length > 1 ? 's' : ''} · Meta ads · 7D breakdowns · Shopify inventory + orders · Google Analytics</div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-slate-400 shrink-0">Shopify orders window</label>
              <select
                value={ordersDays}
                onChange={e => { const v = e.target.value; setOrdersDays(['all','yesterday'].includes(v) ? v : Number(v)); }}
                disabled={megaFetching}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50">
                {ORDER_WINDOWS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>

            <button onClick={handlePullEverything} disabled={megaFetching}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-all">
              {megaFetching ? <Spinner size="sm" /> : <Zap size={16} />}
              {megaFetching ? (megaStep ? `${megaStep.split(':')[1]} — ${brands.find(b=>b.id===megaStep.split(':')[0])?.name || '...'}` : 'Working...') : 'Pull Everything'}
            </button>

            {megaFetching && (
              <div className="flex flex-wrap gap-1 justify-center">
                {brands.map(b => (
                  <span key={b.id} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                    megaStep?.startsWith(b.id) ? 'ring-1 text-white' : 'text-slate-600'
                  }`} style={megaStep?.startsWith(b.id) ? { background: b.color+'33', borderColor: b.color, color: b.color } : {}}>
                    {b.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── IMPORT CSV TAB ─────────────────────────────────────────── */}
      {activeTab === 'import' && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="max-w-lg space-y-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
            <div className="flex items-center gap-2 text-white font-semibold"><Upload size={15} className="text-brand-400" /> Import 02_MANUAL.csv</div>
            <p className="text-sm text-slate-400">Upload your exported <span className="font-mono text-slate-300">02_MANUAL.csv</span>. All columns are loaded automatically.</p>
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-700 hover:border-brand-500 rounded-xl p-8 cursor-pointer transition-colors">
              <Upload size={28} className="text-slate-500" />
              <span className="text-sm text-slate-400">Click to choose file or drag & drop</span>
              <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={handleCsv} className="hidden" />
            </label>
            {csvStatus && !csvStatus.error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-emerald-900/30 text-emerald-300 rounded-lg text-sm">
                <CheckCircle size={15} /> Loaded <strong>{csvStatus.count}</strong> rows.
              </div>
            )}
            {csvStatus?.error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-900/30 text-red-300 rounded-lg text-sm">
                <AlertCircle size={15} /> {csvStatus.error}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── MANUAL LABELS TAB ──────────────────────────────────────── */}
      {activeTab === 'manual' && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="space-y-4">
          {enrichedRows.length === 0 ? (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-slate-500">Pull Meta data first.</div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <input type="text" value={manualSearch} onChange={e => setManualSearch(e.target.value)}
                  placeholder="Search ads / campaigns..."
                  className="w-80 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <span className="text-xs text-slate-500">{adsForManual.length} ads</span>
              </div>
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="border-b border-gray-800">
                    <tr>
                      {['Ad','Campaign','Collection','Campaign Type','Offer','Override','Notes'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-slate-400 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adsForManual.map((row, i) => {
                      const m = manualMap[row.adId] || {};
                      return (
                        <tr key={row.adId} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                          <td className="px-3 py-2 text-slate-300 max-w-[200px] truncate">{row.adName}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate">{row.campaignName}</td>
                          {['Collection','Campaign Type','Offer Type','Status Override'].map(field => (
                            <td key={field} className="px-3 py-1">
                              <select value={m[field] || ''}
                                onChange={e => { setManualRow(row.adId, { [field]: e.target.value }); rebuildEnriched(); flashSaved(); }}
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500">
                                <option value="">—</option>
                                {(LISTS[field] || []).map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </td>
                          ))}
                          <td className="px-3 py-1">
                            <input type="text" value={m['Notes'] || ''}
                              onChange={e => { setManualRow(row.adId, { Notes: e.target.value }); rebuildEnriched(); flashSaved(); }}
                              placeholder="notes..."
                              className="w-32 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* ── LOG TAB ────────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 font-mono text-xs text-slate-300 h-[480px] overflow-y-auto space-y-0.5">
            {fetchLog.length === 0
              ? <span className="text-slate-600">No log entries yet.</span>
              : fetchLog.map((l, i) => (
                <div key={i} className={`leading-relaxed ${l.includes('✅') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : l.includes('⚠️') ? 'text-amber-400' : l.startsWith('━') ? 'text-slate-400 font-bold mt-1' : 'text-slate-400'}`}>{l}</div>
              ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
