import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, CheckCircle, AlertCircle, RefreshCw, Key,
  BookOpen, Upload, ShoppingBag, Zap, ChevronDown, ChevronRight,
  Package, BarChart3, Calendar, Search, Mail,
} from 'lucide-react';
import { useStore, BRAND_COLORS } from '../store';
import { pullAccount, verifyToken, fetchShopifyInventory, fetchShopifyOrders, fetchGaData, fetchGoogleAds, verifyGoogleAds, fetchMerchant, verifyMerchant, pullAccountWithCustomRange, verifyListmonk, fetchListmonkCampaigns } from '../lib/api';
import { normalizeMerchantResponse } from '../lib/googleMerchantAnalytics';
import { normalizeGoogleAdsResponse } from '../lib/googleAdsAnalytics';
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
  { value: 7,           label: 'Last 7d' },
  { value: 14,          label: 'Last 14d' },
  { value: 30,          label: 'Last 30d' },
  { value: 60,          label: 'Last 60d' },
  { value: 90,          label: 'Last 90d' },
  { value: 180,         label: 'Last 180d' },
  { value: 365,         label: 'Last 365d' },
  { value: 730,         label: 'Last 2 years' },
  { value: 1095,        label: 'Last 3 years' },
  { value: 'all',       label: 'All time' },
];

const GA_WINDOWS = [
  { value: '7daysAgo',    label: 'Last 7d' },
  { value: '14daysAgo',   label: 'Last 14d' },
  { value: '30daysAgo',   label: 'Last 30d' },
  { value: '60daysAgo',   label: 'Last 60d' },
  { value: '90daysAgo',   label: 'Last 90d' },
  { value: '180daysAgo',  label: 'Last 180d' },
  { value: '365daysAgo',  label: 'Last 1 year' },
  { value: '730daysAgo',  label: 'Last 2 years' },
];

/* ─── STATUS DOT ─────────────────────────────────────────────────── */
function StatusDot({ status }) {
  if (!status || status === 'idle') return <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />;
  if (status === 'loading')  return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (status === 'success')  return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (status === 'error')    return <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />;
}

function WinSelect({ value, onChange, options, disabled, color = 'violet' }) {
  const cls = {
    violet: 'bg-violet-900/20 border-violet-700/30 text-violet-300 focus:ring-violet-500',
    blue:   'bg-blue-900/20 border-blue-700/30 text-blue-300 focus:ring-blue-500',
    brand:  'bg-brand-900/20 border-brand-700/30 text-brand-300 focus:ring-brand-500',
  }[color];
  return (
    <select value={value} onChange={e => {
      const v = e.target.value;
      onChange(['all','yesterday'].includes(v) ? v : isNaN(Number(v)) ? v : Number(v));
    }} disabled={disabled}
      className={`px-2 py-1 rounded-lg text-xs border focus:outline-none focus:ring-1 disabled:opacity-40 ${cls}`}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ─── BRAND CARD ─────────────────────────────────────────────────── */
function BrandCard({ brand, brandInfo }) {
  const {
    updateBrand, removeBrand, addBrandAccount, updateBrandAccount, removeBrandAccount,
    setBrandMetaData, setBrandMetaStatus,
    setBrandInventory, setBrandInventoryStatus,
    setBrandOrders, setBrandOrdersStatus,
    setBrandGaData, setBrandGaStatus,
    setBrandGoogleAdsData, setBrandGoogleAdsStatus,
    setBrandMerchantData, setBrandMerchantStatus,
    setBrandListmonkData, setBrandListmonkStatus,
    appendLog,
    startPullJob, updatePullJob, finishPullJob,
  } = useStore();

  const [expanded, setExpanded]       = useState(true);
  const [verifying, setVerifying]     = useState(false);
  const [verifyOk, setVerifyOk]       = useState(null);
  const [showPalette, setShowPalette] = useState(false);
  const [pullingMeta, setPullingMeta]       = useState(false);
  const [pullingInv, setPullingInv]         = useState(false);
  const [pullingOrders, setPullingOrders]   = useState(false);
  const [pullingGa, setPullingGa]           = useState(false);
  const [pullingGAds, setPullingGAds]       = useState(false);
  const [verifyingGAds, setVerifyingGAds]   = useState(false);
  const [pullingMerchant, setPullingMerchant]   = useState(false);
  const [verifyingMerchant, setVerifyingMerchant] = useState(false);
  const [verifyMerchantOk, setVerifyMerchantOk]   = useState(null);
  const [verifyGAdsOk, setVerifyGAdsOk]     = useState(null);
  const [pullingLmonk, setPullingLmonk]     = useState(false);
  const [verifyingLmonk, setVerifyingLmonk] = useState(false);
  const [verifyLmonkOk, setVerifyLmonkOk]   = useState(null);
  const [pullingAll, setPullingAll]         = useState(false);

  // Per-brand time windows
  const [ordersDays, setOrdersDays] = useState(7);
  const [gaDays, setGaDays]         = useState('7daysAgo');

  const bd = brandInfo || {};
  const metaStatus      = bd.metaStatus      || 'idle';
  const inventoryStatus = bd.inventoryStatus || 'idle';
  const ordersStatus    = bd.ordersStatus    || 'idle';
  const gaStatus        = bd.gaStatus        || 'idle';
  const googleAdsStatus = bd.googleAdsStatus || 'idle';
  const listmonkStatus  = bd.listmonkStatus  || 'idle';
  const hasToken   = !!brand.meta.token;
  const hasAccts   = brand.meta.accounts.filter(a => a.key && a.id).length > 0;
  const hasShopify = !!(brand.shopify.shop && brand.shopify.clientId && brand.shopify.clientSecret);
  const hasGa      = !!(brand.ga?.propertyId && brand.ga?.serviceAccountJson);
  const gAds       = brand.googleAds || {};
  const hasGAds    = !!(gAds.devToken && gAds.customerId && gAds.clientId && gAds.clientSecret && gAds.refreshToken);
  const lmonk      = brand.listmonk || {};
  const hasLmonk   = !!(lmonk.url && lmonk.username && lmonk.password);
  const anyBusy    = pullingMeta || pullingInv || pullingOrders || pullingGa || pullingGAds || pullingMerchant || pullingLmonk || pullingAll;

  /* ── individual pull handlers ───────────────────────────────────── */
  const handleVerify = async () => {
    if (!hasToken) return;
    setVerifying(true); setVerifyOk(null);
    try {
      const me = await verifyToken(brand.meta.token, brand.meta.apiVersion);
      setVerifyOk({ ok: true, name: me.name });
    } catch (e) { setVerifyOk({ ok: false, msg: e.message }); }
    finally { setVerifying(false); }
  };

  const doPullMeta = async () => {
    const accounts = brand.meta.accounts.filter(a => a.key && a.id);
    if (!hasToken || !accounts.length) return;
    setBrandMetaStatus(brand.id, 'loading');
    appendLog(`[${brand.name}] Starting Meta pull...`);
    const jobId = `meta:${brand.id}`;
    startPullJob(jobId, `Meta — ${brand.name}`, `0 / ${accounts.length} accounts`);

    const combined = { campaigns: [], adsets: [], ads: [], insightsToday: [], insightsYesterday: [], insights3d: [], insights7d: [], insights14d: [], insights30d: [] };
    const failures = [];
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (i > 0) {
        updatePullJob(jobId, { detail: `Cooling down 10s before ${acc.key}` });
        appendLog(`[${brand.name}] Cooling down 10s before next account (Meta app rate limit)...`);
        await new Promise(r => setTimeout(r, 10000));
      }
      updatePullJob(jobId, { pct: (i / accounts.length) * 100, detail: `${acc.key}: fetching…` });
      try {
        const r = await pullAccount(
          { ver: brand.meta.apiVersion, token: brand.meta.token, accountKey: acc.key, accountId: acc.id },
          msg => { appendLog(`[${brand.name}] ${msg}`); updatePullJob(jobId, { detail: `${acc.key}: ${msg.replace(/^\[[^\]]+\]\s*/, '')}` }); },
        );
        combined.campaigns.push(...r.campaigns);
        combined.adsets.push(...r.adsets);
        combined.ads.push(...r.ads);
        combined.insightsToday.push(...r.insightsToday);
        combined.insightsYesterday.push(...(r.insightsYesterday || []));
        combined.insights3d.push(...(r.insights3d || []));
        combined.insights7d.push(...r.insights7d);
        combined.insights14d.push(...r.insights14d);
        combined.insights30d.push(...r.insights30d);
      } catch (e) {
        const msg = e.message || 'Meta error';
        failures.push(`${acc.key}: ${msg}`);
        appendLog(`[${brand.name}] ⚠ ${acc.key} failed — continuing with remaining accounts: ${msg}`);
      }
    }
    setBrandMetaData(brand.id, combined);
    const okN = accounts.length - failures.length;
    if (failures.length && okN === 0) {
      finishPullJob(jobId, false, failures.join(' · '));
      throw new Error(failures.join(' · '));
    }
    if (failures.length) {
      finishPullJob(jobId, false, `${okN}/${accounts.length} ok · ${failures.join(' · ')}`);
    } else {
      finishPullJob(jobId, true, `${accounts.length} account(s) · ${combined.insights7d.length} ads (7D)`);
    }
    appendLog(`[${brand.name}] ✅ Meta done — ${okN}/${accounts.length} account(s)`);
  };

  const doPullInventory = async () => {
    setBrandInventoryStatus(brand.id, 'loading');
    const jobId = `inventory:${brand.id}`;
    startPullJob(jobId, `Inventory — ${brand.name}`, 'fetching SKUs');
    try {
      const result = await fetchShopifyInventory(brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret);
      setBrandInventory(brand.id, result.map, result.locations, result.inventoryByLocation, result.skuToItemId, result.collections);
      finishPullJob(jobId, true, `${Object.keys(result.map).length} SKUs · ${result.locations.length} locations`);
      appendLog(`[${brand.name}] ✅ Inventory — ${Object.keys(result.map).length} SKUs · ${result.locations.length} locations`);
    } catch (e) {
      finishPullJob(jobId, false, e.message || 'Inventory failed');
      throw e;
    }
  };

  const doPullOrders = async (days = ordersDays) => {
    setBrandOrdersStatus(brand.id, 'loading');
    const jobId = `orders:${brand.id}`;
    startPullJob(jobId, `Shopify Orders — ${brand.name}`, `last ${days}d`);
    try {
      const { since, until } = daysToRange(days);
      const { orders: fetched, count } = await fetchShopifyOrders(
        brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret,
        since, until,
        msg => {
          appendLog(`[${brand.name}] ${msg}`);
          const m = msg.match(/Page (\d+).*?(\d+) total/);
          if (m) updatePullJob(jobId, { detail: `page ${m[1]} · ${m[2]} orders` });
          else updatePullJob(jobId, { detail: msg });
        },
      );
      setBrandOrders(brand.id, fetched, days);
      finishPullJob(jobId, true, `${count} orders`);
      appendLog(`[${brand.name}] ✅ Orders — ${count} orders`);
    } catch (e) {
      finishPullJob(jobId, false, e.message || 'Orders failed');
      throw e;
    }
  };

  const doPullGa = async (since = gaDays) => {
    setBrandGaStatus(brand.id, 'loading');
    const jobId = `ga:${brand.id}`;
    startPullJob(jobId, `GA4 — ${brand.name}`, 'fetching reports');
    try {
      const data = await fetchGaData(
        brand.ga.serviceAccountJson, brand.ga.propertyId,
        { since, until: 'today' },
        msg => { appendLog(`[${brand.name}] ${msg}`); updatePullJob(jobId, { detail: msg }); },
      );
      setBrandGaData(brand.id, data);
      finishPullJob(jobId, true, `${data.dailyTrend?.length || 0} days`);
      appendLog(`[${brand.name}] ✅ GA — ${data.dailyTrend?.length || 0} days`);
    } catch (e) {
      finishPullJob(jobId, false, e.message || 'GA failed');
      throw e;
    }
  };

  const doPullGoogleAds = async () => {
    setBrandGoogleAdsStatus(brand.id, 'loading');
    appendLog(`[${brand.name}] Starting Google Ads pull...`);
    const jobId = `gads:${brand.id}`;
    startPullJob(jobId, `Google Ads — ${brand.name}`, 'last 30d');
    try {
      const raw = await fetchGoogleAds(
        brand.googleAds,
        'last_30d',
        msg => { appendLog(`[${brand.name}] ${msg}`); updatePullJob(jobId, { detail: msg }); },
      );
      const normalized = normalizeGoogleAdsResponse(raw);
      setBrandGoogleAdsData(brand.id, normalized);
      finishPullJob(jobId, true, `${normalized.campaigns.length} campaigns · ${normalized.ads.length} ads`);
      appendLog(`[${brand.name}] ✅ Google Ads — ${normalized.campaigns.length} campaigns · ${normalized.adGroups.length} ad groups · ${normalized.ads.length} ads`);
    } catch (e) {
      finishPullJob(jobId, false, e.message || 'Google Ads failed');
      throw e;
    }
  };

  const handlePullMeta = async () => {
    setPullingMeta(true);
    try { await doPullMeta(); } catch (e) { setBrandMetaStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ Meta: ${e.message}`); }
    finally { setPullingMeta(false); }
  };

  const handlePullInventory = async () => {
    if (!hasShopify) return;
    setPullingInv(true);
    try { await doPullInventory(); } catch (e) { setBrandInventoryStatus(brand.id, 'error'); appendLog(`[${brand.name}] ❌ Inventory: ${e.message}`); }
    finally { setPullingInv(false); }
  };

  const handlePullOrders = async () => {
    if (!hasShopify) return;
    setPullingOrders(true);
    try { await doPullOrders(); } catch (e) { setBrandOrdersStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ Orders: ${e.message}`); }
    finally { setPullingOrders(false); }
  };

  const handlePullGa = async () => {
    if (!hasGa) return;
    setPullingGa(true);
    try { await doPullGa(); } catch (e) { setBrandGaStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ GA: ${e.message}`); }
    finally { setPullingGa(false); }
  };

  const handleVerifyGAds = async () => {
    if (!hasGAds) return;
    setVerifyingGAds(true); setVerifyGAdsOk(null);
    try {
      const info = await verifyGoogleAds(brand.googleAds);
      setVerifyGAdsOk({ ok: true, name: info.descriptiveName || info.name, currency: info.currencyCode, tz: info.timeZone });
    } catch (e) { setVerifyGAdsOk({ ok: false, msg: e.message }); }
    finally { setVerifyingGAds(false); }
  };

  const handlePullGoogleAds = async () => {
    if (!hasGAds) return;
    setPullingGAds(true);
    try { await doPullGoogleAds(); }
    catch (e) { setBrandGoogleAdsStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ Google Ads: ${e.message}`); }
    finally { setPullingGAds(false); }
  };

  const hasMerchant = !!(gAds.merchantId && gAds.clientId && gAds.clientSecret && gAds.refreshToken);

  const handleVerifyMerchant = async () => {
    if (!hasMerchant) return;
    setVerifyingMerchant(true); setVerifyMerchantOk(null);
    try {
      const info = await verifyMerchant({
        clientId:     gAds.clientId,
        clientSecret: gAds.clientSecret,
        refreshToken: gAds.refreshToken,
        merchantId:   gAds.merchantId,
      });
      setVerifyMerchantOk({ ok: info.hasAccess, name: info.accountName || `Merchant ${gAds.merchantId}`, accessible: info.accountIds });
    } catch (e) { setVerifyMerchantOk({ ok: false, msg: e.message }); }
    finally { setVerifyingMerchant(false); }
  };

  const handlePullMerchant = async () => {
    if (!hasMerchant) return;
    setPullingMerchant(true);
    setBrandMerchantStatus(brand.id, 'loading');
    const jobId = `merchant:${brand.id}`;
    startPullJob(jobId, `Merchant Center — ${brand.name}`, gAds.merchantId);
    try {
      const raw = await fetchMerchant({
        clientId:     gAds.clientId,
        clientSecret: gAds.clientSecret,
        refreshToken: gAds.refreshToken,
        merchantId:   gAds.merchantId,
      }, msg => { appendLog(`[${brand.name}] ${msg}`); updatePullJob(jobId, { detail: msg }); });
      const normalized = normalizeMerchantResponse(raw);
      setBrandMerchantData(brand.id, normalized);
      finishPullJob(jobId, true, `${normalized.summary.total} products · ${normalized.summary.disapproved} disapproved`);
      appendLog(`[${brand.name}] ✅ Merchant — ${normalized.summary.total} products · ${normalized.summary.approved} approved · ${normalized.summary.disapproved} disapproved`);
    } catch (e) {
      setBrandMerchantStatus(brand.id, 'error', e.message);
      finishPullJob(jobId, false, e.message || 'Merchant failed');
      appendLog(`[${brand.name}] ❌ Merchant: ${e.message}`);
    } finally { setPullingMerchant(false); }
  };

  const handleVerifyLmonk = async () => {
    if (!hasLmonk) return;
    setVerifyingLmonk(true); setVerifyLmonkOk(null);
    try {
      const info = await verifyListmonk(brand.listmonk);
      setVerifyLmonkOk({ ok: true, lists: info.lists?.length || 0 });
    } catch (e) { setVerifyLmonkOk({ ok: false, msg: e.message }); }
    finally { setVerifyingLmonk(false); }
  };

  const doPullListmonk = async () => {
    setBrandListmonkStatus(brand.id, 'loading');
    appendLog(`[${brand.name}] Starting Listmonk pull...`);
    const { campaigns } = await fetchListmonkCampaigns(brand.listmonk);
    setBrandListmonkData(brand.id, { campaigns, pulledAt: Date.now() });
    appendLog(`[${brand.name}] ✅ Listmonk — ${campaigns.length} campaigns`);
  };

  const handlePullLmonk = async () => {
    if (!hasLmonk) return;
    setPullingLmonk(true);
    try { await doPullListmonk(); }
    catch (e) { setBrandListmonkStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ Listmonk: ${e.message}`); }
    finally { setPullingLmonk(false); }
  };

  const handlePullAll = async () => {
    setPullingAll(true);
    appendLog(`━━━ ${brand.name} — Pull All ━━━`);
    appendLog(`[${brand.name}] Meta: ${hasToken && hasAccts ? `✓ ${brand.meta.accounts.filter(a=>a.key&&a.id).length} account(s)` : '✗ not configured'}`);
    appendLog(`[${brand.name}] Shopify: ${hasShopify ? `✓ ${brand.shopify.shop}` : '✗ not configured'}`);
    appendLog(`[${brand.name}] GA4: ${hasGa ? `✓ property ${brand.ga?.propertyId}` : '✗ not configured'}`);
    appendLog(`[${brand.name}] Google Ads: ${hasGAds ? `✓ customer ${gAds.customerId}` : '✗ not configured'}`);

    let metaOk = false;
    if (hasToken && hasAccts) {
      try {
        await doPullMeta();
        metaOk = true;
      } catch (e) {
        const msg = e.message || e.toString() || 'Unknown error';
        setBrandMetaStatus(brand.id, 'error', msg);
        appendLog(`[${brand.name}] ❌ Meta: ${msg}`);
      }
    } else {
      appendLog(`[${brand.name}] Meta: skipped`);
    }

    if (hasShopify) {
      await Promise.all([
        doPullInventory().catch(e => {
          setBrandInventoryStatus(brand.id, 'error');
          appendLog(`[${brand.name}] ❌ Inventory: ${e.message || e.toString()}`);
        }),
        doPullOrders().catch(e => {
          setBrandOrdersStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ Orders: ${e.message || e.toString()}`);
        }),
      ]);
    } else {
      appendLog(`[${brand.name}] Shopify: skipped`);
    }

    if (hasGa) {
      try { await doPullGa(); }
      catch (e) { setBrandGaStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ GA4: ${e.message || e.toString()}`); }
    } else {
      appendLog(`[${brand.name}] GA4: skipped`);
    }

    if (hasGAds) {
      try { await doPullGoogleAds(); }
      catch (e) { setBrandGoogleAdsStatus(brand.id, 'error', e.message); appendLog(`[${brand.name}] ❌ Google Ads: ${e.message || e.toString()}`); }
    } else {
      appendLog(`[${brand.name}] Google Ads: skipped`);
    }

    appendLog(`[${brand.name}] ✅ Pull All complete`);
    setPullingAll(false);
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
        <div className="flex items-center gap-1.5" title="Meta · Inventory · Orders · GA · Google Ads · Listmonk">
          <StatusDot status={metaStatus} />
          <StatusDot status={inventoryStatus} />
          <StatusDot status={ordersStatus} />
          <StatusDot status={gaStatus} />
          <StatusDot status={googleAdsStatus} />
          <StatusDot status={listmonkStatus} />
        </div>

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
                  {bd.metaFetchAt && <span className="text-[10px] text-slate-600 font-normal ml-1">{new Date(bd.metaFetchAt).toLocaleTimeString()}</span>}
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

                {/* Meta pull button */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handlePullMeta} disabled={anyBusy || !hasToken || !hasAccts}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600/40 disabled:opacity-30 rounded-lg text-xs font-medium text-brand-300 transition-all border border-brand-700/30">
                    {pullingMeta ? <Spinner size="sm" /> : <RefreshCw size={11} />} Pull Meta
                  </button>
                  {bd.insights7d && (
                    <span className="px-2 py-0.5 rounded-full bg-brand-900/30 text-brand-400 text-[10px]">
                      {bd.insights7d.length} ads · Today/7D/14D/30D
                    </span>
                  )}
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

                {/* Inventory pull */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handlePullInventory} disabled={anyBusy || !hasShopify}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-emerald-300 transition-all border border-emerald-700/30">
                    {pullingInv ? <Spinner size="sm" /> : <Package size={11} />} Pull Inventory
                  </button>
                  {bd.inventoryMap && Object.keys(bd.inventoryMap).length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 text-[10px]">
                      {Object.keys(bd.inventoryMap).length} SKUs
                    </span>
                  )}
                </div>

                {/* Orders pull + window */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-500">Orders window</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <WinSelect value={ordersDays} onChange={setOrdersDays} options={ORDER_WINDOWS} disabled={anyBusy} color="violet" />
                    <button onClick={handlePullOrders} disabled={anyBusy || !hasShopify}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700/30 hover:bg-violet-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-violet-300 transition-all border border-violet-700/30">
                      {pullingOrders ? <Spinner size="sm" /> : <ShoppingBag size={11} />} Pull Orders
                    </button>
                    {bd.orders && (
                      <span className="px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-400 text-[10px]">
                        {bd.orders.length} orders
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── GOOGLE ANALYTICS ───────────────────────────────── */}
              <div className="space-y-3 xl:col-span-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <BarChart3 size={11} /> Google Analytics 4
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

                {/* GA pull + window */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-500">GA date range</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <WinSelect value={gaDays} onChange={setGaDays} options={GA_WINDOWS} disabled={anyBusy} color="blue" />
                    <button onClick={handlePullGa} disabled={anyBusy || !hasGa}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700/30 hover:bg-blue-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-blue-300 transition-all border border-blue-700/30">
                      {pullingGa ? <Spinner size="sm" /> : <BarChart3 size={11} />} Pull GA4
                    </button>
                    {bd.gaData && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 text-[10px]">
                        {bd.gaData.dailyTrend?.length || 0}d trend · {bd.gaData.campaigns?.length || 0} campaigns
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── GOOGLE ADS ─────────────────────────────────────── */}
              <div className="space-y-3 xl:col-span-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <Search size={11} /> Google Ads
                  <StatusDot status={googleAdsStatus} />
                  {bd.googleAdsFetchAt && <span className="text-[10px] text-slate-600 font-normal ml-1">Last: {new Date(bd.googleAdsFetchAt).toLocaleTimeString()}</span>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Developer Token</label>
                    <input type="password"
                      value={gAds.devToken || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, devToken: e.target.value } })}
                      placeholder="iauCQ..."
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Login Customer ID (MCC)</label>
                    <input type="text"
                      value={gAds.loginCustomerId || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, loginCustomerId: e.target.value.replace(/\D/g, '') } })}
                      placeholder="9675029246"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Customer ID (this brand)</label>
                    <input type="text"
                      value={gAds.customerId || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, customerId: e.target.value.replace(/\D/g, '') } })}
                      placeholder="5202936374"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">OAuth Client ID</label>
                    <input type="text"
                      value={gAds.clientId || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, clientId: e.target.value } })}
                      placeholder="123...apps.googleusercontent.com"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">OAuth Client Secret</label>
                    <input type="password"
                      value={gAds.clientSecret || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, clientSecret: e.target.value } })}
                      placeholder="GOCSPX-..."
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Refresh Token</label>
                    <input type="password"
                      value={gAds.refreshToken || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, refreshToken: e.target.value } })}
                      placeholder="1//..."
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Merchant Center ID <span className="text-slate-600 font-normal normal-case">(for Shopping/PMax feed)</span></label>
                    <input type="text"
                      value={gAds.merchantId || ''}
                      onChange={e => updateBrand(brand.id, { googleAds: { ...gAds, merchantId: e.target.value.replace(/\D/g, '') } })}
                      placeholder="123456789"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                  </div>
                </div>

                {verifyMerchantOk && (
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${verifyMerchantOk.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                    {verifyMerchantOk.ok
                      ? <><CheckCircle size={11} /> Merchant OK · {verifyMerchantOk.name}</>
                      : <><AlertCircle size={11} /> {verifyMerchantOk.msg}</>}
                  </div>
                )}

                {verifyGAdsOk && (
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${verifyGAdsOk.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                    {verifyGAdsOk.ok
                      ? <><CheckCircle size={11} /> {verifyGAdsOk.name} · {verifyGAdsOk.currency} · {verifyGAdsOk.tz}</>
                      : <><AlertCircle size={11} /> {verifyGAdsOk.msg}</>}
                  </div>
                )}

                {/* Verify + Pull */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button onClick={handleVerifyGAds} disabled={verifyingGAds || !hasGAds}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-xs text-slate-300 transition-all border border-gray-700">
                    {verifyingGAds ? <Spinner size="sm" /> : <CheckCircle size={11} />} Verify
                  </button>
                  <button onClick={handlePullGoogleAds} disabled={anyBusy || !hasGAds}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700/30 hover:bg-amber-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-amber-300 transition-all border border-amber-700/30">
                    {pullingGAds ? <Spinner size="sm" /> : <Search size={11} />} Pull Google Ads
                  </button>
                  {bd.googleAdsData && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 text-[10px]">
                      {bd.googleAdsData.campaigns?.length || 0} campaigns · {bd.googleAdsData.adGroups?.length || 0} ad groups · {bd.googleAdsData.ads?.length || 0} ads
                    </span>
                  )}
                  <span className="mx-1 text-slate-700">|</span>
                  <button onClick={handleVerifyMerchant} disabled={verifyingMerchant || !hasMerchant}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-xs text-slate-300 transition-all border border-gray-700">
                    {verifyingMerchant ? <Spinner size="sm" /> : <CheckCircle size={11} />} Verify Merchant
                  </button>
                  <button onClick={handlePullMerchant} disabled={anyBusy || !hasMerchant}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-700/30 hover:bg-sky-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-sky-300 transition-all border border-sky-700/30">
                    {pullingMerchant ? <Spinner size="sm" /> : <Package size={11} />} Pull Merchant
                  </button>
                  {bd.merchantData && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-900/30 text-sky-300 text-[10px]">
                      {bd.merchantData.summary?.total || 0} products · {bd.merchantData.summary?.disapproved || 0} disapproved
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 italic pt-1">
                  Note: Merchant Center requires the OAuth refresh token to include the <code className="text-slate-500">content</code> scope. If verify fails with "insufficient scope", re-authorize the app with both <code className="text-slate-500">adwords</code> + <code className="text-slate-500">content</code> scopes.
                </div>
              </div>

              {/* ── LISTMONK (email) ──────────────────────────────── */}
              <div className="space-y-3 xl:col-span-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <Mail size={11} /> Listmonk (Email)
                  <StatusDot status={listmonkStatus} />
                  {bd.listmonkFetchAt && <span className="text-[10px] text-slate-600 font-normal ml-1">Last: {new Date(bd.listmonkFetchAt).toLocaleTimeString()}</span>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-500 mb-1 block">Listmonk URL</label>
                    <input type="text"
                      value={lmonk.url || ''}
                      onChange={e => updateBrand(brand.id, { listmonk: { ...lmonk, url: e.target.value.trim() } })}
                      placeholder="https://listmonk.yourdomain.com"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">API Username</label>
                    <input type="text"
                      value={lmonk.username || ''}
                      onChange={e => updateBrand(brand.id, { listmonk: { ...lmonk, username: e.target.value } })}
                      placeholder="admin-api"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">API Password / Token</label>
                    <input type="password"
                      value={lmonk.password || ''}
                      onChange={e => updateBrand(brand.id, { listmonk: { ...lmonk, password: e.target.value } })}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">From Email</label>
                    <input type="text"
                      value={lmonk.fromEmail || ''}
                      onChange={e => updateBrand(brand.id, { listmonk: { ...lmonk, fromEmail: e.target.value } })}
                      placeholder='"TAOS" <hello@theaffordableorganicstore.com>'
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Default List ID (optional)</label>
                    <input type="text"
                      value={lmonk.defaultListId || ''}
                      onChange={e => updateBrand(brand.id, { listmonk: { ...lmonk, defaultListId: e.target.value.replace(/\D/g, '') } })}
                      placeholder="1"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                </div>

                {verifyLmonkOk && (
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg ${verifyLmonkOk.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                    {verifyLmonkOk.ok
                      ? <><CheckCircle size={11} /> Reachable · {verifyLmonkOk.lists} list(s) configured</>
                      : <><AlertCircle size={11} /> {verifyLmonkOk.msg}</>}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button onClick={handleVerifyLmonk} disabled={verifyingLmonk || !hasLmonk}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-xs text-slate-300 transition-all border border-gray-700">
                    {verifyingLmonk ? <Spinner size="sm" /> : <CheckCircle size={11} />} Verify
                  </button>
                  <button onClick={handlePullLmonk} disabled={anyBusy || !hasLmonk}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-700/30 hover:bg-sky-700/50 disabled:opacity-30 rounded-lg text-xs font-medium text-sky-300 transition-all border border-sky-700/30">
                    {pullingLmonk ? <Spinner size="sm" /> : <Mail size={11} />} Pull Campaigns
                  </button>
                  {bd.listmonkData?.campaigns && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-900/30 text-sky-400 text-[10px]">
                      {bd.listmonkData.campaigns.length} campaigns
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── PULL ALL for this brand ─────────────────────────── */}
            <div className="border-t border-gray-800/60 px-4 py-3 bg-gray-950/40 flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider shrink-0">Pull All — {brand.name}</span>
              <span className="text-[10px] text-slate-600">Orders: {ORDER_WINDOWS.find(w => w.value == ordersDays)?.label}</span>
              <span className="text-[10px] text-slate-600">GA: {GA_WINDOWS.find(w => w.value === gaDays)?.label}</span>
              <div className="flex-1" />
              <button onClick={handlePullAll} disabled={anyBusy}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                style={{ background: brand.color + '22', color: brand.color, border: `1px solid ${brand.color}44` }}>
                {pullingAll ? <Spinner size="sm" /> : <Zap size={11} />}
                {pullingAll ? 'Pulling…' : `Pull All`}
              </button>
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
    manualMap, setManualMap, setManualRow, setManualRowLogged, rebuildEnriched,
    fetchLog, appendLog, clearLog,
    enrichedRows, dynamicLists, mergeDynamicLists,
    setBrandMetaData, setBrandMetaStatus,
    setBrandInventory, setBrandInventoryStatus,
    setBrandOrders, setBrandOrdersStatus,
    setBrandGaData, setBrandGaStatus,
    setBrandGoogleAdsData, setBrandGoogleAdsStatus,
    setBreakdownData, setBreakdownStatus,
  } = useStore();

  const LISTS = dynamicLists;

  const [activeTab, setActiveTab]       = useState('brands');
  const [megaFetching, setMegaFetching] = useState(false);
  const [megaStep, setMegaStep]         = useState('');
  const [globalOrdersDays, setGlobalOrdersDays] = useState(7);
  const [globalGaDays, setGlobalGaDays]         = useState('7daysAgo');
  const [manualSearch, setManualSearch] = useState('');
  const [csvStatus, setCsvStatus]       = useState(null);
  const [savedFlash, setSavedFlash]     = useState(false);
  const csvRef    = useRef(null);
  // Synchronous re-entry guard — state updates are async, so a rapid double-click
  // can fire handlePullEverything twice before megaFetching flips to true.
  const megaRunning = useRef(false);

  // Flash "Saved" indicator when a manual label is updated
  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  /* ── CSV import ────────────────────────────────────────────────── */
  const handleCsv = async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      setManualMap({ ...manualMap, ...csvRowsToManualMap(rows) });
      mergeDynamicLists(detectListsFromCsvRows(rows));
      rebuildEnriched();
      setCsvStatus({ count: Object.keys(csvRowsToManualMap(rows)).length });
         } catch (err) { setCsvStatus({ error: err.message }); }
    e.target.value = '';
  };

  /* ── Pull Everything — pre-flight check then sequential brands ── */
  const handlePullEverything = async () => {
    if (megaRunning.current) return;
    megaRunning.current = true;
    setMegaFetching(true);
    try {
    clearLog();
    setActiveTab('log');

    // ── 1. Pre-flight: inspect config for every brand ──────────────
    appendLog('PRE-FLIGHT CHECK');
    appendLog('─────────────────────────────────────────');

    const plans = brands.map(brand => {
      const accounts   = brand.meta.accounts.filter(a => a.key && a.id);
      const hasMeta    = !!brand.meta.token && accounts.length > 0;
      const hasShopify = !!(brand.shopify.shop && brand.shopify.clientId && brand.shopify.clientSecret);
      const hasGa      = !!(brand.ga?.propertyId && brand.ga?.serviceAccountJson);
      const g          = brand.googleAds || {};
      const hasGAds    = !!(g.devToken && g.customerId && g.clientId && g.clientSecret && g.refreshToken);
      const anything   = hasMeta || hasShopify || hasGa || hasGAds;

      appendLog(`[${brand.name}]`);
      if (!brand.meta.token)       appendLog(`  Meta     : ✗ no token`);
      else if (!accounts.length)   appendLog(`  Meta     : ✗ token present but no accounts added`);
      else                         appendLog(`  Meta     : ✓ ${accounts.length} account(s) — ${accounts.map(a => a.key).join(', ')}`);

      if (!hasShopify)             appendLog(`  Shopify  : ✗ not configured`);
      else                         appendLog(`  Shopify  : ✓ ${brand.shopify.shop}`);

      if (!hasGa)                  appendLog(`  GA4      : ✗ not configured`);
      else                         appendLog(`  GA4      : ✓ property ${brand.ga.propertyId}`);

      if (!hasGAds)                appendLog(`  GoogAds  : ✗ not configured`);
      else                         appendLog(`  GoogAds  : ✓ customer ${g.customerId}`);

      if (!anything)               appendLog(`  → SKIPPING — nothing configured`);

      return { brand, accounts, hasMeta, hasShopify, hasGa, hasGAds, anything };
    });

    const active = plans.filter(p => p.anything);
    if (!active.length) {
      appendLog('─────────────────────────────────────────');
      appendLog('Nothing to fetch. Add credentials in Brands & Connections.');
      return;
    }

    appendLog('─────────────────────────────────────────');
    appendLog(`Starting fetch for ${active.length} brand(s) — sequential order`);

    // ── 2. Fetch brands ONE BY ONE so logs stay clean ─────────────
    for (const { brand, accounts, hasMeta, hasShopify, hasGa, hasGAds } of active) {
      appendLog('');
      appendLog(`━━━ ${brand.name} ━━━`);
      setMegaStep(`${brand.id}:meta`);

      // ── Meta ─────────────────────────────────────────────────────
      let metaOk = false;
      if (hasMeta) {
        appendLog(`[${brand.name}] Meta: pulling ${accounts.length} account(s) sequentially (10s cooldown between)...`);
        setBrandMetaStatus(brand.id, 'loading');
        try {
          const combined = { campaigns:[], adsets:[], ads:[], insightsToday:[], insightsYesterday:[], insights3d:[], insights7d:[], insights14d:[], insights30d:[] };
          for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            if (i > 0) {
              appendLog(`[${brand.name}]   Cooling down 10s before next account...`);
              await new Promise(r => setTimeout(r, 10000));
            }
            const r = await pullAccount(
              { ver: brand.meta.apiVersion, token: brand.meta.token, accountKey: acc.key, accountId: acc.id },
              msg => appendLog(`[${brand.name}]   ${msg}`),
            );
            combined.campaigns.push(...r.campaigns);
            combined.adsets.push(...r.adsets);
            combined.ads.push(...r.ads);
            combined.insightsToday.push(...r.insightsToday);
            combined.insightsYesterday.push(...(r.insightsYesterday || []));
            combined.insights3d.push(...(r.insights3d || []));
            combined.insights7d.push(...r.insights7d);
            combined.insights14d.push(...r.insights14d);
            combined.insights30d.push(...r.insights30d);
          }
          setBrandMetaData(brand.id, combined);
          appendLog(`[${brand.name}] ✅ Meta done — ${combined.insights7d.length} ads (7D)`);
          metaOk = true;
        } catch (e) {
          const msg = e.message || e.toString() || 'Unknown error';
          setBrandMetaStatus(brand.id, 'error', msg);
          appendLog(`[${brand.name}] ❌ Meta failed: ${msg}`);
        }

        // Breakdowns only if Meta succeeded
        if (metaOk) {
          appendLog(`[${brand.name}] Meta: fetching 7D breakdowns...`);
          setBreakdownStatus('loading');
          try {
            const bdResult = await pullAllBreakdowns(
              { ver: brand.meta.apiVersion, token: brand.meta.token, accounts, specs: BREAKDOWN_SPECS, window: '7D' },
              msg => appendLog(`[${brand.name}]   ${msg}`),
            );
            setBreakdownData(bdResult);
            appendLog(`[${brand.name}] ✅ Breakdowns done`);
          } catch (e) {
            setBreakdownStatus('error');
            appendLog(`[${brand.name}] ⚠ Breakdowns: ${e.message || e.toString()}`);
          }
        }
      } else {
        appendLog(`[${brand.name}] Meta: skipped — ${!brand.meta.token ? 'no token' : 'no accounts configured'}`);
      }

      // ── Shopify: inventory then orders (sequential to avoid OOM on free tier) ───
      if (hasShopify) {
        const odLabel = globalOrdersDays === 'all' ? 'all time'
          : globalOrdersDays === 'yesterday' ? 'yesterday'
          : `last ${globalOrdersDays}d`;
        appendLog(`[${brand.name}] Shopify: pulling inventory, then orders (${odLabel})...`);

        setBrandInventoryStatus(brand.id, 'loading');
        try {
          const result = await fetchShopifyInventory(
            brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret
          );
          const invMap = result.inventoryMap || result.map || result;
          setBrandInventory(brand.id, invMap, result.locations, result.inventoryByLocation, result.skuToItemId, result.collections);
          appendLog(`[${brand.name}] ✅ Inventory — ${Object.keys(invMap).length} SKUs`);
        } catch (e) {
          setBrandInventoryStatus(brand.id, 'error');
          appendLog(`[${brand.name}] ❌ Inventory: ${e.message || e.toString()}`);
        }

        setBrandOrdersStatus(brand.id, 'loading');
        try {
          const { since, until } = daysToRange(globalOrdersDays);
          const { orders: fetched, count } = await fetchShopifyOrders(
            brand.shopify.shop, brand.shopify.clientId, brand.shopify.clientSecret,
            since, until, msg => appendLog(`[${brand.name}]   ${msg}`),
          );
          setBrandOrders(brand.id, fetched, globalOrdersDays);
          appendLog(`[${brand.name}] ✅ Orders — ${count} fetched`);
        } catch (e) {
          setBrandOrdersStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ Orders: ${e.message || e.toString()}`);
        }
      } else {
        appendLog(`[${brand.name}] Shopify: skipped — not configured`);
      }

      // ── GA4 ───────────────────────────────────────────────────────
      if (hasGa) {
        appendLog(`[${brand.name}] GA4: pulling ${globalGaDays}...`);
        setBrandGaStatus(brand.id, 'loading');
        try {
          const gaResult = await fetchGaData(
            brand.ga.serviceAccountJson, brand.ga.propertyId,
            { since: globalGaDays, until: 'today' },
            msg => appendLog(`[${brand.name}]   ${msg}`),
          );
          setBrandGaData(brand.id, gaResult);
          appendLog(`[${brand.name}] ✅ GA4 — ${gaResult.dailyTrend?.length || 0} days`);
        } catch (e) {
          setBrandGaStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ GA4: ${e.message || e.toString()}`);
        }
      } else {
        appendLog(`[${brand.name}] GA4: skipped — not configured`);
      }

      // ── Google Ads ────────────────────────────────────────────────
      if (hasGAds) {
        appendLog(`[${brand.name}] Google Ads: pulling last 30d...`);
        setBrandGoogleAdsStatus(brand.id, 'loading');
        try {
          const raw = await fetchGoogleAds(
            brand.googleAds, 'last_30d',
            msg => appendLog(`[${brand.name}]   ${msg}`),
          );
          const normalized = normalizeGoogleAdsResponse(raw);
          setBrandGoogleAdsData(brand.id, normalized);
          appendLog(`[${brand.name}] ✅ Google Ads — ${normalized.campaigns.length} campaigns · ${normalized.ads.length} ads`);
        } catch (e) {
          setBrandGoogleAdsStatus(brand.id, 'error', e.message);
          appendLog(`[${brand.name}] ❌ Google Ads: ${e.message || e.toString()}`);
        }
      } else {
        appendLog(`[${brand.name}] Google Ads: skipped — not configured`);
      }

      appendLog(`[${brand.name}] ✅ Done`);
    }

    appendLog('');
    appendLog('─────────────────────────────────────────');
    appendLog(`✅ All ${active.length} brand(s) fetched`);
    setMegaStep('');
    } finally {
      setMegaFetching(false);
      megaRunning.current = false;
    }
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
          Manage brands, connect data sources, and pull data with full time control.
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

          {/* Brand cards — each is fully self-contained with own time windows */}
          {brands.map(brand => (
            <BrandCard key={brand.id} brand={brand} brandInfo={brandData[brand.id]} />
          ))}

          <button onClick={addBrand}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 hover:border-brand-500 rounded-xl text-sm text-slate-400 hover:text-brand-300 transition-all w-full justify-center">
            <Plus size={14} /> Add Brand
          </button>

          {/* ── Ultimate Pull Everything ──────────────────────────── */}
          <div className="bg-gradient-to-br from-brand-900/40 to-violet-900/30 rounded-2xl border border-brand-700/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-brand-600/30"><Zap size={16} className="text-brand-300" /></div>
              <div>
                <div className="text-white font-bold text-sm">Pull Everything — All Brands</div>
                <div className="text-[11px] text-slate-400">{brands.length} brand{brands.length > 1 ? 's' : ''} · Meta (Today/7D/14D/30D) · 7D Breakdowns · Inventory · Orders · GA</div>
              </div>
            </div>

            {/* Global time windows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium">Shopify Orders window (all brands)</label>
                <WinSelect value={globalOrdersDays} onChange={setGlobalOrdersDays} options={ORDER_WINDOWS} disabled={megaFetching} color="violet" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-medium">GA date range (all brands)</label>
                <WinSelect value={globalGaDays} onChange={setGlobalGaDays} options={GA_WINDOWS} disabled={megaFetching} color="blue" />
              </div>
            </div>

            <button onClick={handlePullEverything} disabled={megaFetching}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-all">
              {megaFetching ? <Spinner size="sm" /> : <Zap size={16} />}
              {megaFetching
                ? (megaStep ? `${megaStep.split(':')[1]} — ${brands.find(b=>b.id===megaStep.split(':')[0])?.name || '...'}` : 'Working...')
                : `Pull Everything — ${brands.length} Brand${brands.length > 1 ? 's' : ''}`}
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
              <span className="text-sm text-slate-400">Click to choose file or drag &amp; drop</span>
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
                {savedFlash && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 animate-pulse">
                    <CheckCircle size={11} /> Saved
                  </span>
                )}
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
                                onChange={e => { setManualRowLogged(row.adId, { [field]: e.target.value }, { source: 'setup', adName: row.adName }); flashSaved(); }}
                                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500">
                                <option value="">—</option>
                                {(LISTS[field] || []).map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </td>
                          ))}
                          <td className="px-3 py-1">
                            <input type="text" value={m['Notes'] || ''}
                              onChange={e => { setManualRowLogged(row.adId, { Notes: e.target.value }, { source: 'setup', adName: row.adName }); flashSaved(); }}
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
          <div className="flex justify-end mb-2">
            <button onClick={clearLog} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded">Clear log</button>
          </div>
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
