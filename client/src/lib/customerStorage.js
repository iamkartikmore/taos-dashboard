/* ─── IndexedDB customer cache ─────────────────────────────────────
   86k+ customers per brand breaks localStorage's ~5MB budget. Same
   pattern as orderStorage.js: one whole-brand blob keyed by brandId.
   Shape: { brandId, customers, fetchedAt, source }
   ──────────────────────────────────────────────────────────────────── */

const DB_NAME    = 'taos_customers';
const STORE_NAME = 'customers';
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

export async function saveCustomers(brandId, customers, source = 'csv') {
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ brandId, customers, source, fetchedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[customerStorage] save failed', e);
  }
}

export async function loadCustomers(brandId) {
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

export async function loadAllCustomers() {
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

export async function clearCustomers(brandId) {
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = brandId ? store.delete(brandId) : store.clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[customerStorage] clear failed', e);
  }
}
