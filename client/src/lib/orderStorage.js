/* ─── IndexedDB order cache ─────────────────────────────────────────
   Orders are too large for localStorage (90d can be 5-20MB per brand).
   Stored as whole-brand blobs keyed by brandId — fine-grained queries
   live in-memory on the store after hydration.

   Shape per record: { brandId, orders, fetchedAt, window }
   ──────────────────────────────────────────────────────────────────── */

const DB_NAME    = 'taos_orders';
const STORE_NAME = 'orders';
const VERSION    = 1;

let _dbPromise = null;
function db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: 'brandId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return db().then(idb => idb.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
}

export async function saveOrders(brandId, orders, window) {
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ brandId, orders, window, fetchedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[orderStorage] save failed', e);
  }
}

export async function loadOrders(brandId) {
  try {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(brandId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

export async function loadAllOrders() {
  try {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

export async function clearOrders(brandId) {
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = brandId ? store.delete(brandId) : store.clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[orderStorage] clear failed', e);
  }
}
