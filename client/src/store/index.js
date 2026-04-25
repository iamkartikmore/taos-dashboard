import { create } from 'zustand';
import { buildEnrichedRows } from '../lib/analytics';
import { normalizeBreakdownRow } from '../lib/breakdownAnalytics';
import { mergeCustomerCache } from '../lib/shopifyAnalytics';
import { saveOrders, loadAllOrders, clearOrders as idbClearOrders } from '../lib/orderStorage';
import { saveCustomers, clearCustomers as idbClearCustomers } from '../lib/customerStorage';
import { mergeOrders as mergeOrdersById, mergeCustomers as mergeCustomersByKey } from '../lib/shopifyCsvImport';

/* ─── LOCALSTORAGE ──────────────────────────────────────────────── */
const LS_BRANDS  = 'taos_brands_v2';
const LS_ACTIVE  = 'taos_active_brands';
const LS_MANUAL  = 'taos_manual';
const LS_MANUAL_LOG = 'taos_manual_log';
const LS_LISTS   = 'taos_lists';
const LS_INV     = 'taos_inventory_v2';      // { [brandId]: inventoryMap }
const LS_CUST    = 'taos_customers';          // { [brandId]: { [email]: CustomerRecord } }
const LS_PROCURE = 'taos_procurement';        // { suppliers: {[sku]:...}, purchaseOrders: [...] }
const LS_SOCIAL  = 'taos_social_posts_v1';    // { [brandId]: { posts, baseline, lastPullAt } }

function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}

// Eviction order — when a critical key (LS_BRANDS, LS_MANUAL) fails to
// save because LS quota is full, we drop these big-but-rebuildable
// caches in this order and retry. Brand config + manual labels MUST
// survive — everything else is rebuildable from a server pull.
const EVICTABLE_KEYS = [
  'taos_social_posts_v1',          // can re-pull
  'taos_clarity_history_v1',       // can re-pull
  'taos_utm_snapshots_v1',         // can re-pull
  'taos_inventory_v2',             // can re-pull
  'taos_customers',                // big — rebuilt on next orders pull
];

function _evictAndRetry(key, valStr) {
  // Try to free space by dropping the largest evictable bucket first
  const sizes = EVICTABLE_KEYS.map(k => {
    try { return [k, (localStorage.getItem(k) || '').length]; } catch { return [k, 0]; }
  }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  for (const [evictKey] of sizes) {
    try {
      localStorage.removeItem(evictKey);
      console.warn(`[storage] LS quota exceeded saving ${key}; evicted ${evictKey}`);
      localStorage.setItem(key, valStr);
      return true;
    } catch (_) { /* still full, try next */ }
  }
  return false;
}

function lsSet(key, val) {
  let serialized;
  try { serialized = JSON.stringify(val); }
  catch (e) { console.error(`[storage] failed to stringify ${key}:`, e); return false; }
  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch (err) {
    // QuotaExceededError on every browser — code 22 (DOMException) on
    // most, code 1014 on Firefox, name 'QuotaExceededError' everywhere.
    const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22 || err?.code === 1014
                 || /quota/i.test(err?.message || '');
    if (isQuota && _evictAndRetry(key, serialized)) {
      return true;
    }
    console.error(`[storage] failed to save ${key}:`, err);
    // Surface to the user via a global notice if it's a critical key
    if (key === 'taos_brands_v2' || key === 'taos_manual') {
      try {
        window.dispatchEvent(new CustomEvent('taos-storage-error', {
          detail: { key, error: err?.message || String(err), isQuota },
        }));
      } catch (_) {}
    }
    return false;
  }
}

/* ─── BRAND FACTORY ─────────────────────────────────────────────── */
export const BRAND_COLORS = [
  '#22c55e','#3b82f6','#a78bfa','#f59e0b',
  '#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80',
];

export function makeBrand(name = 'New Brand', idx = 0) {
  return {
    id:      `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    color:   BRAND_COLORS[idx % BRAND_COLORS.length],
    meta:    { token: '', apiVersion: 'v21.0', accounts: [] },
    shopify: { shop: '', clientId: '', clientSecret: '' },
    ga:      { propertyId: '', serviceAccountJson: '' },
    googleAds: { devToken: '', loginCustomerId: '', customerId: '', clientId: '', clientSecret: '', refreshToken: '', merchantId: '' },
    listmonk: { url: '', username: '', password: '', defaultListId: '', fromEmail: '' },
    clarity: { apiToken: '', projectId: '' },
    drive:   { folderUrl: '' },
    // Social (IG + FB organic posts). Token reuses meta.token; pageAccessToken
    // is a Page-scoped token discovered by /api/social/verify.
    social:  { igBusinessId: '', igUsername: '', fbPageId: '', fbPageName: '', pageAccessToken: '', competitorHandles: [] },
  };
}

/* ─── DEFAULT LISTS ─────────────────────────────────────────────── */
const DEFAULT_LISTS = {
  Collection:        ['All Mix','Plants','Seeds','Succulent','Miniature','Building Block','Diamond Painting','3D Puzzle','Sustainable & Stationary','Other'],
  'Campaign Type':   ['none','IndivProduct','MultiProduct','Catalog','Flexible','Influe','Inhouse','Static','Other'],
  'Offer Type':      ['none','No Offer','Coupon','Bundle','Freebie','Free Shipping','Sale','Other'],
  'Status Override': ['none','Scale Hard','Scale Carefully','Defend','Creative Fix','Offer Fix','Targeting Fix','Watch','Pause','Kill'],
  Geography:         ['none','India','Maharashtra','Karnataka','Tamil Nadu','Telangana','Uttar Pradesh','NCT of Delhi','West Bengal','Kerala','Gujarat','Haryana','Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Kolkata','Pune','Ahmedabad','Gurugram','Noida','Other'],
};

/* ─── MIGRATION from old single-brand config ────────────────────── */
function loadBrands() {
  const stored = lsGet(LS_BRANDS, null);
  if (stored?.length) {
    // Backfill missing googleAds / listmonk fields on existing brands
    return stored.map(b => {
      const u = { ...b };
      if (!u.googleAds) u.googleAds = { devToken: '', loginCustomerId: '', customerId: '', clientId: '', clientSecret: '', refreshToken: '', merchantId: '' };
      else if (u.googleAds.merchantId === undefined) u.googleAds.merchantId = '';
      if (!u.listmonk)  u.listmonk  = { url: '', username: '', password: '', defaultListId: '', fromEmail: '' };
      if (!u.clarity)   u.clarity   = { apiToken: '', projectId: '' };
      if (!u.drive)     u.drive     = { folderUrl: '' };
      else if (u.drive.folderUrl === undefined) u.drive = { ...u.drive, folderUrl: u.drive.folderId ? `https://drive.google.com/drive/folders/${u.drive.folderId}` : '' };
      if (!u.social)    u.social    = { igBusinessId: '', igUsername: '', fbPageId: '', fbPageName: '', pageAccessToken: '', competitorHandles: [] };
      return u;
    });
  }

  const old = lsGet('taos_config', null);
  if (old) {
    const brand      = makeBrand('Brand 1', 0);
    brand.meta       = { token: old.token || '', apiVersion: old.apiVersion || 'v21.0', accounts: old.accounts || [] };
    brand.shopify    = { shop: old.shopifyShop || '', clientId: old.shopifyClientId || '', clientSecret: old.shopifyClientSecret || '' };
    const brands     = [brand];
    lsSet(LS_BRANDS, brands);
    return brands;
  }

  const brands = [makeBrand('Brand 1', 0)];
  lsSet(LS_BRANDS, brands);
  return brands;
}

/* ─── MANUAL-MAP SERVER PUSH (debounced, queue-based) ─────────────
   Every local edit enqueues the changed fields. A 700ms trailing
   debounce flushes the queue to POST /api/manual. If multiple tabs
   edit in parallel, last-write-wins per field (same semantics as
   the local store). Failed pushes are retried once after 3s. */
let _pushQueue = {};
let _pushTimer = null;
let _pushRetryAt = 0;

function _queuePush(adId, fields) {
  if (!adId || !fields || !Object.keys(fields).length) return;
  _pushQueue[adId] = { ...(_pushQueue[adId] || {}), ...fields };
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(_flushPush, 700);
}

function _schedulePushAll(fullMap) {
  if (fullMap) { _pushQueue = { ..._pushQueue, ...fullMap }; }
  else {
    // Best-effort: grab the whole current map (import via dynamic ref at flush)
    _pushQueue.__FULL__ = true;
  }
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(_flushPush, 700);
}

async function _flushPush() {
  _pushTimer = null;
  if (!Object.keys(_pushQueue).length) return;
  const payload = _pushQueue;
  _pushQueue = {};
  try {
    const mod = await import('../lib/api');
    let toSend = payload;
    if (payload.__FULL__) {
      // Shouldn't happen often; drop sentinel and no-op (the per-edit
      // path already covers the common case).
      delete payload.__FULL__;
      toSend = payload;
      if (!Object.keys(toSend).length) return;
    }
    await mod.pushManualUpdates(toSend);
    _pushRetryAt = 0;
  } catch (e) {
    console.warn('[manual] push failed, will retry', e.message);
    _pushQueue = { ..._pushQueue, ...payload };
    if (!_pushRetryAt || Date.now() > _pushRetryAt) {
      _pushRetryAt = Date.now() + 3000;
      setTimeout(_flushPush, 3000);
    }
  }
}

/* ─── STORE ─────────────────────────────────────────────────────── */
export const useStore = create((set, get) => {
  const initialBrands  = loadBrands();
  const storedActive   = lsGet(LS_ACTIVE, null);
  const initialActive  = storedActive?.length ? storedActive : initialBrands.map(b => b.id);

  // Restore persisted per-brand inventory
  const storedInv = lsGet(LS_INV, {});
  const customerCache = lsGet(LS_CUST, {});
  const clarityHistoryAll = lsGet('taos_clarity_history_v1', {});
  const utmSnapshotsAll   = lsGet('taos_utm_snapshots_v1', {});
  const storedSocial      = lsGet(LS_SOCIAL, {});
  const initialBrandData = {};
  // Also migrate old single-store taos_inventory
  const oldInv = lsGet('taos_inventory', null);
  initialBrands.forEach((b, i) => {
    const inv = storedInv[b.id] || (i === 0 && oldInv ? oldInv : null);
    const clarityHistory = clarityHistoryAll[b.id] || [];
    const latest = clarityHistory.length ? clarityHistory[clarityHistory.length - 1].snapshot : null;
    const utmSnapshots = utmSnapshotsAll[b.id] || [];
    if (inv || clarityHistory.length || utmSnapshots.length) {
      initialBrandData[b.id] = {
        ...(inv ? { inventoryMap: inv, inventoryStatus: 'success' } : {}),
        ...(clarityHistory.length ? { clarityData: latest, clarityHistory, clarityStatus: 'success' } : {}),
        ...(utmSnapshots.length ? { utmSnapshots } : {}),
      };
    }
  });

  /* ── helpers ──────────────────────────────────────────────────── */
  const _saveBrands = brands => { lsSet(LS_BRANDS, brands); return brands; };
  const _saveActive = ids    => { lsSet(LS_ACTIVE, ids);    return ids;    };

  function _rebuild(overrides = {}) {
    const s              = get();
    const brands         = overrides.brands         ?? s.brands;
    const activeBrandIds = overrides.activeBrandIds ?? s.activeBrandIds;
    const brandData      = overrides.brandData      ?? s.brandData;
    const manualMap      = s.manualMap;

    const active = brands.filter(b => activeBrandIds.includes(b.id));

    // Meta — use concat (returns new array, no spread) to avoid call-stack
    // overflow when insights arrays grow large.
    let all7d = [], all30d = [];
    const adsetMap = {}, campaignMap = {}, adMap = {};
    active.forEach(b => {
      const d = brandData[b.id];
      if (!d) return;
      if (d.insights7d?.length)  all7d  = all7d.concat(d.insights7d);
      if (d.insights30d?.length) all30d = all30d.concat(d.insights30d);
      (d.adsets    || []).forEach(a => { adsetMap[a.id]    = a; });
      (d.campaigns || []).forEach(c => { campaignMap[c.id] = c; });
      (d.ads       || []).forEach(a => { adMap[a.id]       = a; });
    });
    const enrichedRows = buildEnrichedRows(all7d, all30d, manualMap, adsetMap, campaignMap, adMap);

    // Shopify — same safe pattern. With CSV imports these arrays easily
    // exceed 50k rows, and `push(...arr)` would throw "Maximum call stack
    // size exceeded" at the V8 argument limit.
    const inventoryMap = {};
    let shopifyOrders = [];
    active.forEach(b => {
      const d = brandData[b.id];
      if (!d) return;
      Object.assign(inventoryMap, d.inventoryMap || {});
      if (d.orders?.length) shopifyOrders = shopifyOrders.concat(d.orders);
    });

    // Derive overall fetch status from brand statuses
    const statuses = active.map(b => brandData[b.id]?.metaStatus || 'idle');
    const fetchStatus = statuses.some(s => s === 'loading')  ? 'loading'
                      : statuses.every(s => s === 'success') ? 'success'
                      : statuses.some(s => s === 'error')    ? 'error'
                      : 'idle';

    // Synthetic rawAccounts: one entry per active brand, carries insights arrays for AdDetailDrawer
    const rawAccounts = active.flatMap(b => {
      const d = brandData[b.id];
      if (!d) return [];
      // One synthetic "account" per configured Meta account in the brand
      return (b.meta?.accounts || []).filter(a => a.id && a.key).map(a => ({
        accountKey:     a.key,
        accountId:      a.id,
        brandId:        b.id,
        brandName:      b.name,
        insightsToday:  d.insightsToday  || [],
        insights7d:     d.insights7d     || [],
        insights14d:    d.insights14d    || [],
        insights30d:    d.insights30d    || [],
      }));
    });

    set({ enrichedRows, adsetMap, campaignMap, adMap, inventoryMap, shopifyOrders, rawAccounts, fetchStatus, lastFetchAt: Date.now() });
  }

  return {
    /* ── Brands ──────────────────────────────────────────────────── */
    brands:         initialBrands,
    activeBrandIds: initialActive,

    addBrand: () => {
      const newBrand = makeBrand('New Brand', get().brands.length);
      const brands   = _saveBrands([...get().brands, newBrand]);
      const activeBrandIds = _saveActive([...get().activeBrandIds, newBrand.id]);
      set({ brands, activeBrandIds });
    },

    // Deep-merge EVERY nested config object so callers can safely pass
    // partial patches without risking clobber. Previously social/clarity/
    // drive were shallow-replaced, so a patch like { social: { igBusinessId: 'x' } }
    // would wipe fbPageId / pageAccessToken / igUsername — causing
    // "my keys keep resetting" when Discover's async resolve raced with
    // typing keystrokes.
    updateBrand: (id, patch) => {
      const brands = _saveBrands(get().brands.map(b => {
        if (b.id !== id) return b;
        const u = { ...b, ...patch };
        if (patch.meta)      u.meta      = { ...b.meta,      ...patch.meta };
        if (patch.shopify)   u.shopify   = { ...b.shopify,   ...patch.shopify };
        if (patch.ga)        u.ga        = { ...b.ga,        ...patch.ga };
        if (patch.googleAds) u.googleAds = { ...b.googleAds, ...patch.googleAds };
        if (patch.listmonk)  u.listmonk  = { ...(b.listmonk || {}), ...patch.listmonk };
        if (patch.clarity)   u.clarity   = { ...(b.clarity  || {}), ...patch.clarity };
        if (patch.drive)     u.drive     = { ...(b.drive    || {}), ...patch.drive };
        if (patch.social)    u.social    = { ...(b.social   || {}), ...patch.social };
        return u;
      }));
      set({ brands });
    },

    addBrandAccount: brandId => {
      const brands = _saveBrands(get().brands.map(b =>
        b.id !== brandId ? b
          : { ...b, meta: { ...b.meta, accounts: [...b.meta.accounts, { key: '', id: '' }] } }
      ));
      set({ brands });
    },

    updateBrandAccount: (brandId, idx, patch) => {
      const brands = _saveBrands(get().brands.map(b => {
        if (b.id !== brandId) return b;
        const accounts = b.meta.accounts.map((a, i) => i === idx ? { ...a, ...patch } : a);
        return { ...b, meta: { ...b.meta, accounts } };
      }));
      set({ brands });
    },

    removeBrandAccount: (brandId, idx) => {
      const brands = _saveBrands(get().brands.map(b =>
        b.id !== brandId ? b
          : { ...b, meta: { ...b.meta, accounts: b.meta.accounts.filter((_, i) => i !== idx) } }
      ));
      set({ brands });
    },

    removeBrand: id => {
      const brands = _saveBrands(get().brands.filter(b => b.id !== id));
      const activeBrandIds = _saveActive(get().activeBrandIds.filter(x => x !== id));
      const { [id]: _gone, ...brandData } = get().brandData;
      set({ brands, activeBrandIds, brandData });
      _rebuild({ brands, activeBrandIds, brandData });
    },

    toggleBrandActive: id => {
      const activeBrandIds = _saveActive(
        get().activeBrandIds.includes(id)
          ? get().activeBrandIds.filter(x => x !== id)
          : [...get().activeBrandIds, id]
      );
      set({ activeBrandIds });
      _rebuild({ activeBrandIds });
    },

    setAllBrandsActive: () => {
      const activeBrandIds = _saveActive(get().brands.map(b => b.id));
      set({ activeBrandIds });
      _rebuild({ activeBrandIds });
    },

    setNoBrandsActive: () => {
      _saveActive([]);
      set({ activeBrandIds: [], enrichedRows: [], shopifyOrders: [], inventoryMap: {}, adsetMap: {}, campaignMap: {} });
    },

    /* ── Per-brand session data ──────────────────────────────────── */
    brandData: initialBrandData,

    setBrandMetaData: (brandId, data) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), ...data, metaStatus: 'success', metaFetchAt: Date.now() } };
      set({ brandData });
      _rebuild({ brandData });
    },

    setBrandMetaStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), metaStatus: status, metaError: error } };
      set({ brandData });
      if (status !== 'loading') _rebuild({ brandData });
    },

    setBrandInventory: (brandId, inventoryMap, locations, inventoryByLocation, skuToItemId, collections) => {
      const brandData = { ...get().brandData, [brandId]: {
        ...(get().brandData[brandId] || {}),
        inventoryMap, inventoryStatus: 'success',
        locations:           locations           || [],
        inventoryByLocation: inventoryByLocation || {},
        skuToItemId:         skuToItemId         || {},
        collections:         collections         || [],
      }};
      const inv = lsGet(LS_INV, {}); inv[brandId] = inventoryMap; lsSet(LS_INV, inv);
      set({ brandData });
      _rebuild({ brandData });
    },

    setBrandInventoryStatus: (brandId, status) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), inventoryStatus: status } };
      set({ brandData });
    },

    setBrandOrders: (brandId, orders, window) => {
      // MERGE with existing orders instead of replacing. Shopify pulls
      // return only the recent window (typically 60d on auto-pull); CSV
      // imports provide the historical tail (years of data). A pure
      // replace would wipe the CSV history every time auto-pull runs.
      // mergeOrders preserves CSV-only IDs and prefers fresher API data
      // when both sources have the same order.
      const cur = get().brandData[brandId] || {};
      const tagged = (orders || []).map(o => ({ ...o, _brandId: brandId, _source: 'api' }));
      const merged = mergeOrdersById(cur.orders || [], tagged);

      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        orders: merged,
        ordersWindow: window,
        ordersStatus: 'success',
        ordersFetchedAt: Date.now(),
      }};
      // Merge customer data into persistent cache
      const existingCache  = lsGet(LS_CUST, {});
      const brandCache     = existingCache[brandId] || {};
      const updatedBrandCache = mergeCustomerCache(brandCache, merged);
      const newCache = { ...existingCache, [brandId]: updatedBrandCache };
      lsSet(LS_CUST, newCache);
      // Persist the merged superset so IDB survives pull cycles
      saveOrders(brandId, merged, window);
      set({ brandData, customerCache: newCache });
      _rebuild({ brandData });
    },

    // Called by the boot hydration hook once IDB data is read. Merge
    // (not replace) because in-memory might already hold orders from
    // an earlier same-session pull.
    hydrateOrders: (records) => {
      if (!records?.length) return;
      const cur = get().brandData;
      const next = { ...cur };
      for (const r of records) {
        if (!r?.brandId) continue;
        const existing = next[r.brandId] || {};
        const merged = mergeOrdersById(existing.orders || [], r.orders || []);
        next[r.brandId] = {
          ...existing,
          orders: merged,
          ordersWindow:    existing.ordersWindow    || r.window,
          ordersFetchedAt: Math.max(existing.ordersFetchedAt || 0, r.fetchedAt || 0),
          ordersStatus: 'success',
        };
      }
      set({ brandData: next });
      _rebuild({ brandData: next });
    },

    /* ── Bulk CSV ingest: merges with existing orders, persists to IDB ── */
    mergeBrandOrdersFromCsv: (brandId, orders) => {
      const cur = get().brandData[brandId] || {};
      const merged = mergeOrdersById(cur.orders || [], orders.map(o => ({ ...o, _brandId: brandId })));
      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        orders: merged,
        ordersWindow: 'bulk-csv',
        ordersStatus: 'success',
        ordersFetchedAt: Date.now(),
      }};
      // Also refresh light customer cache used for RFM chips
      const existingCache  = lsGet(LS_CUST, {});
      const brandCache     = existingCache[brandId] || {};
      const updatedBrandCache = mergeCustomerCache(brandCache, merged);
      const newCache = { ...existingCache, [brandId]: updatedBrandCache };
      lsSet(LS_CUST, newCache);
      saveOrders(brandId, merged, 'bulk-csv');
      set({ brandData, customerCache: newCache });
      _rebuild({ brandData });
      return { total: merged.length, added: merged.length - (cur.orders?.length || 0) };
    },

    /* Drop all imported orders + customers for a brand (memory + IDB +
       light customer cache in localStorage). Used by Bulk CSV Import's
       "Clear imported data" button so operators can reset before a
       fresh re-import. */
    clearBrandImport: async (brandId) => {
      const cur = get().brandData[brandId] || {};
      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        orders: [],
        customers: [],
        ordersStatus: 'idle',
        ordersFetchedAt: null,
        ordersWindow: null,
        customersStatus: 'idle',
        customersFetchedAt: null,
      }};
      const existingCache = lsGet(LS_CUST, {});
      delete existingCache[brandId];
      lsSet(LS_CUST, existingCache);
      set({ brandData, customerCache: existingCache });
      _rebuild({ brandData });
      await Promise.all([idbClearOrders(brandId), idbClearCustomers(brandId)]);
    },

    mergeBrandCustomersFromCsv: (brandId, customers) => {
      const cur = get().brandData[brandId] || {};
      const merged = mergeCustomersByKey(cur.customers || [], customers);
      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        customers: merged,
        customersStatus: 'success',
        customersFetchedAt: Date.now(),
      }};
      saveCustomers(brandId, merged, 'csv');
      set({ brandData });
      return { total: merged.length, added: merged.length - (cur.customers?.length || 0) };
    },

    hydrateCustomers: (records) => {
      if (!records?.length) return;
      const cur = get().brandData;
      const next = { ...cur };
      for (const r of records) {
        if (!r?.brandId) continue;
        const existing = next[r.brandId] || {};
        const merged = mergeCustomersByKey(existing.customers || [], r.customers || []);
        next[r.brandId] = {
          ...existing,
          customers: merged,
          customersFetchedAt: Math.max(existing.customersFetchedAt || 0, r.fetchedAt || 0),
          customersStatus: 'success',
        };
      }
      set({ brandData: next });
    },

    setBrandOrdersStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), ordersStatus: status, ordersError: error } };
      set({ brandData });
    },

    setBrandGaData: (brandId, data) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), gaData: data, gaStatus: 'success', gaFetchAt: Date.now() } };
      set({ brandData });
    },

    setBrandGaStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), gaStatus: status, gaError: error } };
      set({ brandData });
    },

    setBrandGoogleAdsData: (brandId, data) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), googleAdsData: data, googleAdsStatus: 'success', googleAdsFetchAt: Date.now() } };
      set({ brandData });
    },

    setBrandGoogleAdsStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), googleAdsStatus: status, googleAdsError: error } };
      set({ brandData });
    },

    setBrandMerchantData: (brandId, data) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), merchantData: data, merchantStatus: 'success', merchantFetchAt: Date.now() } };
      set({ brandData });
    },

    setBrandMerchantStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), merchantStatus: status, merchantError: error } };
      set({ brandData });
    },

    /* UTM / daily reports — per-brand snapshot array keyed by date.
       Stored in localStorage so WoW / MoM comparisons survive reloads.
       Latest snapshot overwrites if the same reportDate is re-imported. */
    upsertBrandUtmReport: (brandId, snapshot) => {
      if (!brandId || !snapshot?.reportDate) return;
      const cur = get().brandData[brandId] || {};
      const existing = cur.utmSnapshots || [];
      const filtered = existing.filter(s => s.reportDate !== snapshot.reportDate);
      const next = [...filtered, snapshot].sort((a, b) => a.reportDate.localeCompare(b.reportDate)).slice(-120);
      const brandData = { ...get().brandData, [brandId]: { ...cur, utmSnapshots: next, utmLastImport: Date.now() } };
      set({ brandData });
      try {
        const LS_KEY = 'taos_utm_snapshots_v1';
        const all = lsGet(LS_KEY, {});
        all[brandId] = next;
        lsSet(LS_KEY, all);
      } catch { /* quota */ }
    },

    removeBrandUtmSnapshot: (brandId, reportDate) => {
      const cur = get().brandData[brandId] || {};
      const next = (cur.utmSnapshots || []).filter(s => s.reportDate !== reportDate);
      const brandData = { ...get().brandData, [brandId]: { ...cur, utmSnapshots: next } };
      set({ brandData });
      try {
        const LS_KEY = 'taos_utm_snapshots_v1';
        const all = lsGet(LS_KEY, {});
        all[brandId] = next;
        lsSet(LS_KEY, all);
      } catch { /* quota */ }
    },

    /* Microsoft Clarity — stores current snapshot + rolling history of
       past snapshots so we can compute comparative deltas across pulls
       (API doesn't expose historical data, we build it over time). */
    setBrandClarityData: (brandId, snapshot) => {
      const cur = get().brandData[brandId] || {};
      const history = [...(cur.clarityHistory || []), { at: Date.now(), snapshot }].slice(-30); // keep last 30 snapshots
      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        clarityData:    snapshot,
        clarityHistory: history,
        clarityStatus:  'success',
        clarityFetchAt: Date.now(),
      }};
      set({ brandData });
      // Persist to localStorage so history survives reloads
      try {
        const LS_KEY = 'taos_clarity_history_v1';
        const all = lsGet(LS_KEY, {});
        all[brandId] = history;
        lsSet(LS_KEY, all);
      } catch (e) { /* quota; not fatal */ }
    },

    setBrandClarityStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), clarityStatus: status, clarityError: error } };
      set({ brandData });
    },

    /* Re-run the Clarity normalizer on every stored snapshot without
       hitting the API. Useful after the analytics library updates
       (fixes old snapshots in-place without burning daily quota). */
    reanalyzeBrandClarity: async (brandId) => {
      const cur = get().brandData[brandId] || {};
      if (!cur.clarityHistory?.length) return { updated: 0 };
      const { reanalyzeSnapshot } = await import('../lib/clarityAnalytics');
      const newHistory = cur.clarityHistory.map(h => ({
        at: h.at,
        snapshot: reanalyzeSnapshot(h.snapshot),
      }));
      const latestSnap = newHistory[newHistory.length - 1]?.snapshot;
      const brandData = { ...get().brandData, [brandId]: {
        ...cur,
        clarityHistory: newHistory,
        clarityData:    latestSnap,
      }};
      set({ brandData });
      try {
        const LS_KEY = 'taos_clarity_history_v1';
        const all = lsGet(LS_KEY, {});
        all[brandId] = newHistory;
        lsSet(LS_KEY, all);
      } catch { /* quota */ }
      return { updated: newHistory.length };
    },

    setBrandListmonkData: (brandId, data) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), listmonkData: data, listmonkStatus: 'success', listmonkFetchAt: Date.now() } };
      set({ brandData });
    },

    setBrandListmonkStatus: (brandId, status, error = null) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), listmonkStatus: status, listmonkError: error } };
      set({ brandData });
    },

    setBrandSegmentSync: (brandId, syncResult) => {
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), segmentSync: syncResult } };
      set({ brandData });
    },

    /* ── Global pull progress (persistent panel) ─────────────────── */
    // Keyed by jobId (e.g. `meta:b_123:TAOS_ACCT`, `shopify-orders:b_123`).
    // Each entry: { label, status:'loading'|'success'|'error', pct, detail, startedAt, finishedAt, error }
    pullJobs: {},
    startPullJob: (jobId, label, detail = '') => {
      const pullJobs = { ...get().pullJobs, [jobId]: {
        label, detail,
        status: 'loading', pct: null,
        startedAt: Date.now(), finishedAt: null, error: null,
      }};
      set({ pullJobs });
    },
    updatePullJob: (jobId, patch) => {
      const cur = get().pullJobs[jobId];
      if (!cur) return;
      set({ pullJobs: { ...get().pullJobs, [jobId]: { ...cur, ...patch } } });
    },
    finishPullJob: (jobId, ok, detailOrError = '') => {
      const cur = get().pullJobs[jobId];
      if (!cur) return;
      set({ pullJobs: { ...get().pullJobs, [jobId]: {
        ...cur,
        status: ok ? 'success' : 'error',
        pct: 100,
        detail: ok ? (detailOrError || cur.detail) : cur.detail,
        error: ok ? null : (detailOrError || cur.error || 'Unknown error'),
        finishedAt: Date.now(),
      }}});
    },
    clearFinishedPullJobs: () => {
      const next = {};
      Object.entries(get().pullJobs).forEach(([id, j]) => {
        if (j.status === 'loading') next[id] = j;
      });
      set({ pullJobs: next });
    },

    /* ── Aggregated (derived, rebuilt when active brands / brandData change) */
    enrichedRows:  [],
    rawAccounts:   [],
    adsetMap:      {},
    campaignMap:   {},
    adMap:         {},
    inventoryMap:  {},
    shopifyOrders: [],
    customerCache: customerCache,

    // Inactive ads: separate 90-day insights pulled on demand from InactiveAds page
    // Structure: { [brandId]: normalizedInsightRow[] }
    inactiveInsights: {},
    inactiveInsightsStatus: 'idle',  // 'idle' | 'loading' | 'success' | 'error'
    inactiveInsightsLastAt: null,
    setInactiveInsights: (brandId, rows) => {
      const inactiveInsights = { ...get().inactiveInsights, [brandId]: rows };
      set({ inactiveInsights, inactiveInsightsStatus: 'success', inactiveInsightsLastAt: Date.now() });
    },
    setInactiveInsightsStatus: status => set({ inactiveInsightsStatus: status }),

    // Social posts (IG/FB organic) — pulled on demand from SocialPosts page.
    // Structure: { [brandId]: { posts: normalizedPost[], baseline, lastPullAt } }
    // Persisted in localStorage so the feed survives page reloads; we
    // strip the heavy `_rawComments` field before saving since it's
    // redundant once comments_detail has been populated by the
    // enrichment pipeline (and would blow past the 5MB LS quota fast).
    socialPosts:       storedSocial,
    socialPullStatus:  {},  // { [brandId]: 'idle'|'loading'|'success'|'error' }
    socialPullError:   {},
    setSocialPosts: (brandId, payload) => {
      const slim = {
        ...payload,
        posts: (payload.posts || []).map(p => {
          const { _rawComments, ...rest } = p;
          return rest;
        }),
        lastPullAt: Date.now(),
      };
      const socialPosts = { ...get().socialPosts, [brandId]: slim };
      set({ socialPosts });
      try { lsSet(LS_SOCIAL, socialPosts); }
      catch (e) { console.warn('[socialPosts] failed to persist (probably LS quota)', e); }
    },
    clearSocialPosts: brandId => {
      const next = { ...get().socialPosts };
      if (brandId) delete next[brandId]; else Object.keys(next).forEach(k => delete next[k]);
      set({ socialPosts: next });
      lsSet(LS_SOCIAL, next);
    },
    setSocialPullStatus: (brandId, status, error = null) => {
      set(s => ({
        socialPullStatus: { ...s.socialPullStatus, [brandId]: status },
        socialPullError:  { ...s.socialPullError,  [brandId]: error },
      }));
    },

    rebuildEnriched: () => _rebuild(),

    /* ── Fetch log (shared across all pulls) ─────────────────────── */
    fetchStatus:  'idle',
    fetchError:   null,
    lastFetchAt:  null,
    fetchLog:     [],
    setFetchStatus: (fetchStatus, fetchError = null) => set({ fetchStatus, fetchError }),
    appendLog: msg => set(s => ({ fetchLog: [...s.fetchLog.slice(-299), msg] })),
    clearLog:  ()  => set({ fetchLog: [] }),

    /* ── Breakdown data ──────────────────────────────────────────── */
    breakdownRows:   {},
    breakdownStatus: 'idle',
    lastBreakdownAt: null,
    setBreakdownData: rawByKey => {
      const normalized = {};
      Object.entries(rawByKey).forEach(([k, rows]) => { normalized[k] = rows.map(r => normalizeBreakdownRow(r)); });
      set({ breakdownRows: normalized, lastBreakdownAt: Date.now(), breakdownStatus: 'success' });
    },
    setBreakdownStatus: s => set({ breakdownStatus: s }),

    /* ── Manual labels — server-synced so Notes + Collection + Override
         edits propagate to every operator on reload/focus. ───────── */
    manualMap: lsGet(LS_MANUAL, {}),
    manualLog: lsGet(LS_MANUAL_LOG, []),
    manualSyncedAt: 0,

    setManualMap: m => { lsSet(LS_MANUAL, m); set({ manualMap: m }); _schedulePushAll(); },
    setManualRow: (adId, fields) => {
      const manualMap = { ...get().manualMap, [adId]: { ...(get().manualMap[adId] || {}), ...fields } };
      lsSet(LS_MANUAL, manualMap);
      set({ manualMap });
      _queuePush(adId, fields);
    },
    // Same as setManualRow but records a per-field diff entry to manualLog and
    // triggers enrichedRows rebuild so the change propagates across views.
    setManualRowLogged: (adId, fields, context = {}) => {
      const prev = get().manualMap[adId] || {};
      const ts   = Date.now();
      const entries = [];
      const actual = {};
      for (const [field, next] of Object.entries(fields || {})) {
        const before = prev[field] ?? '';
        if (String(before) === String(next ?? '')) continue;
        actual[field] = next;
        entries.push({ ts, adId, field, oldValue: before, newValue: next ?? '', source: context.source || '', adName: context.adName || '' });
      }
      if (!entries.length) return;
      const manualMap = { ...get().manualMap, [adId]: { ...prev, ...actual } };
      const manualLog = [...get().manualLog, ...entries].slice(-2000);
      lsSet(LS_MANUAL, manualMap);
      lsSet(LS_MANUAL_LOG, manualLog);
      set({ manualMap, manualLog });
      _rebuild();
      _queuePush(adId, actual);
    },
    clearManualLog: () => { lsSet(LS_MANUAL_LOG, []); set({ manualLog: [] }); },

    // Pull the server's manual map and merge. Server wins on conflicts
    // (so edits from another operator propagate here). Local-only adIds
    // that haven't been pushed yet are preserved.
    syncManualFromServer: async () => {
      try {
        const mod = await import('../lib/api');
        const { map: serverMap, updatedAt } = await mod.fetchManualMap();
        const local = get().manualMap || {};
        const merged = { ...local };
        // Server wins for every adId it has a record for
        for (const [adId, fields] of Object.entries(serverMap || {})) {
          merged[adId] = { ...(local[adId] || {}), ...fields };
        }
        lsSet(LS_MANUAL, merged);
        set({ manualMap: merged, manualSyncedAt: updatedAt || Date.now() });
        _rebuild();
        // If we have local-only adIds the server didn't know about, push them
        const localOnly = {};
        for (const [adId, fields] of Object.entries(local)) {
          if (!serverMap?.[adId]) localOnly[adId] = fields;
        }
        if (Object.keys(localOnly).length) _schedulePushAll(localOnly);
      } catch (e) {
        console.warn('[manual] server sync failed', e.message);
      }
    },

    /* ── Dynamic lists ───────────────────────────────────────────── */
    dynamicLists: lsGet(LS_LISTS, DEFAULT_LISTS),
    mergeDynamicLists: additions => {
      const current = get().dynamicLists;
      const merged  = { ...current };
      Object.entries(additions).forEach(([k, vals]) => {
        if (!Array.isArray(vals)) return;
        const ex = merged[k] || [];
        merged[k] = [...ex, ...vals.filter(v => !ex.includes(v))];
      });
      lsSet(LS_LISTS, merged);
      set({ dynamicLists: merged });
    },
    resetDynamicLists: () => { lsSet(LS_LISTS, DEFAULT_LISTS); set({ dynamicLists: DEFAULT_LISTS }); },

    /* ── Legacy compat shims (some pages still use these directly) ─ */
    // shopifyOrdersStatus: derived from brandData in ShopifyOrders page
    shopifyOrdersStatus: 'idle',
    shopifyOrdersWindow: '7d',
    setShopifyOrdersStatus: (s, err = null) => set({ shopifyOrdersStatus: s, shopifyOrdersError: err }),
    // Called by ShopifyOrders.jsx page-level fetch
    setShopifyOrders: (orders, window) => {
      // Without a brandId context, store as a temporary override for the current view
      // (won't be persisted to brandData — only affects the merged shopifyOrders view)
      set({ shopifyOrders: orders, shopifyOrdersStatus: 'success', shopifyOrdersWindow: window });
    },

    /* ── inventoryMap compat (already covered by _rebuild) ────────── */
    setInventoryMap: map => { set({ inventoryMap: map }); },
    inventoryStatus: 'idle',
    setInventoryStatus: s => set({ inventoryStatus: s }),

    /* ── Procurement ─────────────────────────────────────────────── */
    // { suppliers: { [sku]: { supplier, leadTimeDays, moq, costPrice, safetyDays } },
    //   purchaseOrders: [{ id, sku, supplier, quantity, unitCost, orderDate, expectedDelivery, status, notes }] }
    procurement: lsGet(LS_PROCURE, { suppliers: {}, purchaseOrders: [] }),

    setProcurementSupplier: (sku, data) => {
      const proc = get().procurement;
      const updated = {
        ...proc,
        suppliers: { ...proc.suppliers, [sku]: { ...(proc.suppliers[sku] || {}), ...data } },
      };
      lsSet(LS_PROCURE, updated);
      set({ procurement: updated });
    },

    addProcurementPO: po => {
      const proc = get().procurement;
      const updated = { ...proc, purchaseOrders: [...(proc.purchaseOrders || []), po] };
      lsSet(LS_PROCURE, updated);
      set({ procurement: updated });
    },

    updateProcurementPO: (id, patch) => {
      const proc = get().procurement;
      const updated = {
        ...proc,
        purchaseOrders: (proc.purchaseOrders || []).map(po => po.id === id ? { ...po, ...patch } : po),
      };
      lsSet(LS_PROCURE, updated);
      set({ procurement: updated });
    },

    deleteProcurementPO: id => {
      const proc = get().procurement;
      const updated = { ...proc, purchaseOrders: (proc.purchaseOrders || []).filter(po => po.id !== id) };
      lsSet(LS_PROCURE, updated);
      set({ procurement: updated });
    },
  };
});
