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

function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
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

/* ─── STORE ─────────────────────────────────────────────────────── */
export const useStore = create((set, get) => {
  const initialBrands  = loadBrands();
  const storedActive   = lsGet(LS_ACTIVE, null);
  const initialActive  = storedActive?.length ? storedActive : initialBrands.map(b => b.id);

  // Restore persisted per-brand inventory
  const storedInv = lsGet(LS_INV, {});
  const customerCache = lsGet(LS_CUST, {});
  const initialBrandData = {};
  // Also migrate old single-store taos_inventory
  const oldInv = lsGet('taos_inventory', null);
  initialBrands.forEach((b, i) => {
    const inv = storedInv[b.id] || (i === 0 && oldInv ? oldInv : null);
    if (inv) initialBrandData[b.id] = { inventoryMap: inv, inventoryStatus: 'success' };
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

    updateBrand: (id, patch) => {
      const brands = _saveBrands(get().brands.map(b => {
        if (b.id !== id) return b;
        const u = { ...b, ...patch };
        if (patch.meta)      u.meta      = { ...b.meta,      ...patch.meta };
        if (patch.shopify)   u.shopify   = { ...b.shopify,   ...patch.shopify };
        if (patch.ga)        u.ga        = { ...b.ga,        ...patch.ga };
        if (patch.googleAds) u.googleAds = { ...b.googleAds, ...patch.googleAds };
        if (patch.listmonk)  u.listmonk  = { ...(b.listmonk || {}), ...patch.listmonk };
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
      const tagged = (orders || []).map(o => ({ ...o, _brandId: brandId }));
      const brandData = { ...get().brandData, [brandId]: { ...(get().brandData[brandId] || {}), orders: tagged, ordersWindow: window, ordersStatus: 'success', ordersFetchedAt: Date.now() } };
      // Merge customer data into persistent cache
      const existingCache  = lsGet(LS_CUST, {});
      const brandCache     = existingCache[brandId] || {};
      const updatedBrandCache = mergeCustomerCache(brandCache, orders || []);
      const newCache = { ...existingCache, [brandId]: updatedBrandCache };
      lsSet(LS_CUST, newCache);
      // Persist full orders to IndexedDB (fire-and-forget)
      saveOrders(brandId, tagged, window);
      set({ brandData, customerCache: newCache });
      _rebuild({ brandData });
    },

    // Called by the boot hydration hook once IDB data is read
    hydrateOrders: (records) => {
      if (!records?.length) return;
      const cur = get().brandData;
      const next = { ...cur };
      for (const r of records) {
        if (!r?.brandId) continue;
        // Don't overwrite fresher in-memory orders
        if (next[r.brandId]?.ordersFetchedAt && next[r.brandId].ordersFetchedAt >= (r.fetchedAt || 0)) continue;
        next[r.brandId] = {
          ...(next[r.brandId] || {}),
          orders: r.orders || [],
          ordersWindow: r.window,
          ordersFetchedAt: r.fetchedAt,
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
        if (next[r.brandId]?.customersFetchedAt && next[r.brandId].customersFetchedAt >= (r.fetchedAt || 0)) continue;
        next[r.brandId] = {
          ...(next[r.brandId] || {}),
          customers: r.customers || [],
          customersFetchedAt: r.fetchedAt,
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

    /* ── Manual labels ───────────────────────────────────────────── */
    manualMap: lsGet(LS_MANUAL, {}),
    manualLog: lsGet(LS_MANUAL_LOG, []),
    setManualMap: m => { lsSet(LS_MANUAL, m); set({ manualMap: m }); },
    setManualRow: (adId, fields) => {
      const manualMap = { ...get().manualMap, [adId]: { ...(get().manualMap[adId] || {}), ...fields } };
      lsSet(LS_MANUAL, manualMap);
      set({ manualMap });
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
    },
    clearManualLog: () => { lsSet(LS_MANUAL_LOG, []); set({ manualLog: [] }); },

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
