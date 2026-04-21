/* ─── Send log (IndexedDB) ──────────────────────────────────────────
   One record per (brand, email, sent_at). Tracks what was dispatched,
   why (opportunity), and whether the customer was in holdout. Read by
   the planner to compute fatigue/cooldown and by Campaign Performance
   to measure uplift vs holdout.

   Record shape:
     {
       id:            `${brand_id}|${email}|${sent_at}`,
       brand_id:      string,
       email:         string,
       opportunity:   'REPLENISH' | 'COMPLEMENT' | ...,
       score:         number,
       expected_rev:  number,
       skus:          string[],
       reason:        string,
       sent_at:       ms epoch,
       was_holdout:   boolean,       // set true for control pickets we logged-but-didn't-send
       channel:       'email' | 'sms' | 'none',
       campaign_id:   string,         // groups picks from a single plan run
       converted:     boolean | null, // set later by performance evaluator
       converted_at:  ms epoch | null,
       attributed_rev: number | null,
     }
   ──────────────────────────────────────────────────────────────── */

const DB_NAME = 'taos_send_log';
const STORE   = 'sends';
const VERSION = 1;

let _dbPromise = null;
function db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE)) {
        const os = idb.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('byBrand',       'brand_id',    { unique: false });
        os.createIndex('byEmail',       'email',       { unique: false });
        os.createIndex('byBrandEmail', ['brand_id', 'email'], { unique: false });
        os.createIndex('byCampaign',    'campaign_id', { unique: false });
        os.createIndex('bySentAt',      'sent_at',     { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return db().then(idb => idb.transaction(STORE, mode).objectStore(STORE));
}

export async function appendSends(records) {
  if (!records?.length) return { added: 0 };
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      let done = 0, err = null;
      for (const r of records) {
        const req = store.put(r);
        req.onsuccess = () => { done++; if (done === records.length) resolve({ added: done }); };
        req.onerror   = () => { err = req.error; if (++done === records.length) err ? reject(err) : resolve({ added: records.length }); };
      }
    });
  } catch (e) {
    console.warn('[sendLog] append failed', e);
    return { added: 0, error: e?.message };
  }
}

export async function loadAllSends() {
  try {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function loadBrandSends(brandId) {
  try {
    const store = await tx('readonly');
    const idx = store.index('byBrand');
    return new Promise((resolve, reject) => {
      const req = idx.getAll(brandId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearSends({ brandId, olderThanMs } = {}) {
  try {
    const store = await tx('readwrite');
    if (!brandId && !olderThanMs) {
      return new Promise((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      });
    }
    const idx = brandId ? store.index('byBrand') : store.index('bySentAt');
    const range = brandId ? IDBKeyRange.only(brandId) : IDBKeyRange.upperBound(olderThanMs);
    return new Promise((resolve, reject) => {
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (!brandId || (olderThanMs ? cur.value.sent_at < olderThanMs : true)) cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[sendLog] clear failed', e);
  }
}

/* ─── DERIVED STATE FOR PLANNER ──────────────────────────────────
   Build a `${brand_id}|${email}` → { sends_last_7d, last_send_ms }
   map the planner consumes for fatigue + cooldown enforcement.
   ─────────────────────────────────────────────────────────────── */
export function buildCustomerStateFromSends(sends, now = Date.now()) {
  const weekMs = 7 * 86_400_000;
  const state = {};
  for (const s of sends) {
    const key = `${s.brand_id}|${s.email}`;
    if (!state[key]) state[key] = { sends_last_7d: 0, last_send_ms: 0 };
    if (now - s.sent_at <= weekMs) state[key].sends_last_7d++;
    if (s.sent_at > state[key].last_send_ms) state[key].last_send_ms = s.sent_at;
  }
  return state;
}
