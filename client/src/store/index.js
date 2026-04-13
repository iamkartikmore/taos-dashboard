import { create } from 'zustand';
import { buildEnrichedRows } from '../lib/analytics';
import { normalizeBreakdownRow } from '../lib/breakdownAnalytics';

/* ─── PLAIN LOCALSTORAGE HELPERS ─────────────────────────────────── */
// We use localStorage directly so persistence never silently fails
// regardless of which Zustand version npm resolved.

const LS_CONFIG    = 'taos_config';
const LS_MANUAL    = 'taos_manual';
const LS_LISTS     = 'taos_lists';
const LS_INVENTORY = 'taos_inventory';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   // storage quota exceeded – fail silently
  }
}

/* ─── DEFAULTS ───────────────────────────────────────────────────── */

const DEFAULT_CONFIG = {
  token:              '',
  apiVersion:         'v21.0',
  accounts:           [],   // [{ key: string, id: string }]
  shopifyShop:        '',   // e.g. "txk12s-ny"
  shopifyClientId:    '',   // Shopify Custom App client_id
  shopifyClientSecret:'',   // Shopify Custom App client_secret (shpss_...)
};

const DEFAULT_LISTS = {
  Collection:        ['All Mix','Plants','Seeds','Succulent','Miniature','Building Block','Diamond Painting','3D Puzzle','Sustainable & Stationary','Other'],
  'Campaign Type':   ['none','IndivProduct','MultiProduct','Catalog','Flexible','Influe','Inhouse','Static','Other'],
  'Offer Type':      ['none','No Offer','Coupon','Bundle','Freebie','Free Shipping','Sale','Other'],
  'Status Override': ['none','Scale Hard','Scale Carefully','Defend','Creative Fix','Offer Fix','Targeting Fix','Watch','Pause','Kill'],
  Geography:         ['none','India','Maharashtra','Karnataka','Tamil Nadu','Telangana','Uttar Pradesh','NCT of Delhi','West Bengal','Kerala','Gujarat','Haryana','Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Kolkata','Pune','Ahmedabad','Gurugram','Noida','Other'],
};

/* ─── STORE ──────────────────────────────────────────────────────── */

export const useStore = create((set, get) => ({

  /* ── Persisted state (loaded from localStorage on first render) ── */
  config:       lsGet(LS_CONFIG, DEFAULT_CONFIG),
  manualMap:    lsGet(LS_MANUAL, {}),  // adId → { Collection, SKU, ... }
  dynamicLists: lsGet(LS_LISTS, DEFAULT_LISTS),

  /* ── Config actions ─────────────────────────────────────────────── */
  setConfig: config => {
    lsSet(LS_CONFIG, config);
    set({ config });
  },

  updateConfig: patch => {
    const config = { ...get().config, ...patch };
    lsSet(LS_CONFIG, config);
    set({ config });
  },

  updateAccount: (idx, updates) => {
    const accounts = [...get().config.accounts];
    accounts[idx] = { ...accounts[idx], ...updates };
    const config = { ...get().config, accounts };
    lsSet(LS_CONFIG, config);
    set({ config });
  },

  addAccount: () => {
    const config = {
      ...get().config,
      accounts: [...get().config.accounts, { key: '', id: '' }],
    };
    lsSet(LS_CONFIG, config);
    set({ config });
  },

  removeAccount: idx => {
    const config = {
      ...get().config,
      accounts: get().config.accounts.filter((_, i) => i !== idx),
    };
    lsSet(LS_CONFIG, config);
    set({ config });
  },

  /* ── Manual label actions ────────────────────────────────────────── */
  setManualMap: m => {
    lsSet(LS_MANUAL, m);
    set({ manualMap: m });
  },

  setManualRow: (adId, fields) => {
    const manualMap = {
      ...get().manualMap,
      [adId]: { ...(get().manualMap[adId] || {}), ...fields },
    };
    lsSet(LS_MANUAL, manualMap);
    set({ manualMap });
  },

  /* ── Dynamic list actions ────────────────────────────────────────── */
  mergeDynamicLists: additions => {
    const current = get().dynamicLists;
    const merged = { ...current };
    Object.entries(additions).forEach(([listKey, newValues]) => {
      if (!Array.isArray(newValues)) return;
      const existing = merged[listKey] || [];
      const existingSet = new Set(existing);
      const appended = newValues.filter(v => !existingSet.has(v));
      merged[listKey] = [...existing, ...appended];
    });
    lsSet(LS_LISTS, merged);
    set({ dynamicLists: merged });
  },

  resetDynamicLists: () => {
    lsSet(LS_LISTS, DEFAULT_LISTS);
    set({ dynamicLists: DEFAULT_LISTS });
  },

  /* ── Session-only: fetched Meta data ────────────────────────────── */
  rawAccounts:  [],
  enrichedRows: [],
  adsetMap:     {},   // adsetId → adset object (for budget lookup)
  campaignMap:  {},   // campaignId → campaign object (for budget lookup)
  fetchStatus:  'idle',   // idle | loading | success | error
  fetchLog:     [],
  fetchError:   null,
  lastFetchAt:  null,

  /* ── Persisted: Shopify inventory ────────────────────────────────── */
  // SKU (uppercase) → { title, stock, price, productType }
  inventoryMap: lsGet(LS_INVENTORY, {}),
  inventoryStatus: Object.keys(lsGet(LS_INVENTORY, {})).length > 0 ? 'success' : 'idle',
  setInventoryMap: map => { lsSet(LS_INVENTORY, map); set({ inventoryMap: map, inventoryStatus: 'success' }); },
  setInventoryStatus: s => set({ inventoryStatus: s }),

  setRawAccounts: accounts => {
    const all7d  = accounts.flatMap(a => a.insights7d   || []);
    const all30d = accounts.flatMap(a => a.insights30d  || []);
    const adsetMap    = {};
    const campaignMap = {};
    accounts.forEach(a => {
      (a.adsets    || []).forEach(s => { adsetMap[s.id]    = s; });
      (a.campaigns || []).forEach(c => { campaignMap[c.id] = c; });
    });
    const enriched = buildEnrichedRows(all7d, all30d, get().manualMap, adsetMap, campaignMap);
    set({ rawAccounts: accounts, enrichedRows: enriched, adsetMap, campaignMap, lastFetchAt: Date.now() });
  },

  rebuildEnriched: () => {
    const s = get();
    const enrichedRows = buildEnrichedRows(
      s.rawAccounts.flatMap(a => a.insights7d   || []),
      s.rawAccounts.flatMap(a => a.insights30d  || []),
      s.manualMap,
      s.adsetMap    || {},
      s.campaignMap || {},
    );
    set({ enrichedRows });
  },

  setFetchStatus: (fetchStatus, fetchError = null) => set({ fetchStatus, fetchError }),
  appendLog: msg => set(s => ({ fetchLog: [...s.fetchLog.slice(-199), msg] })),
  clearLog:  ()  => set({ fetchLog: [] }),

  /* ── Session-only: Shopify orders ───────────────────────────────── */
  shopifyOrders:       [],
  shopifyOrdersStatus: 'idle',   // idle | loading | success | error
  shopifyOrdersWindow: '7d',
  shopifyOrdersError:  null,
  setShopifyOrders: (orders, window) => set({ shopifyOrders: orders, shopifyOrdersStatus: 'success', shopifyOrdersWindow: window }),
  setShopifyOrdersStatus: (s, err = null) => set({ shopifyOrdersStatus: s, shopifyOrdersError: err }),

  /* ── Session-only: breakdown data ───────────────────────────────── */
  breakdownRows:   {},    // { base:[], age:[], gender:[], ... } — normalized
  breakdownStatus: 'idle', // idle | loading | success | error
  lastBreakdownAt: null,

  setBreakdownData: rawByKey => {
    const normalized = {};
    Object.entries(rawByKey).forEach(([bdKey, rows]) => {
      normalized[bdKey] = rows.map(r => normalizeBreakdownRow(r));
    });
    set({ breakdownRows: normalized, lastBreakdownAt: Date.now(), breakdownStatus: 'success' });
  },
  setBreakdownStatus: s => set({ breakdownStatus: s }),
}));
