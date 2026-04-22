/* ─── Suppression / consent registry (IndexedDB) ─────────────────────
   Records emails that must NEVER receive marketing sends, regardless of
   what the planner would otherwise choose. Reasons we currently track:
     - unsubscribed     (user hit unsubscribe link)
     - bounce_hard      (deliverability — invalid mailbox)
     - bounce_soft_3x   (three consecutive soft bounces)
     - complaint        (spam-button / list-unsubscribe-post / FBL)
     - manual           (ops-added; e.g. VIP who only wants whatsapp)
     - gdpr_erase       (right-to-be-forgotten)

   Record shape:
     {
       id:         `${brand_id}|${email}`,
       brand_id:   string,
       email:      string (lowercased),
       reason:     string,
       notes:      string (optional),
       added_at:   ms epoch,
       added_by:   string (user email or 'system'),
       channel:    'email' | 'sms' | 'all',
     }

   The planner reads this registry via `buildSuppressionSet(brandId)` and
   filters candidates before the global allocator runs. Suppression is
   one-way: add is cheap, remove requires ops action (rare).
   ──────────────────────────────────────────────────────────────────── */

const DB_NAME = 'taos_suppression';
const STORE   = 'suppression';
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
        os.createIndex('byBrand', 'brand_id', { unique: false });
        os.createIndex('byEmail', 'email',    { unique: false });
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

function normEmail(e) { return String(e || '').toLowerCase().trim(); }

export async function addSuppression({ brand_id, email, reason = 'manual', notes = '', added_by = 'system', channel = 'email' }) {
  const e = normEmail(email);
  if (!brand_id || !e) return { ok: false, error: 'missing brand_id/email' };
  const rec = {
    id: `${brand_id}|${e}`,
    brand_id, email: e, reason, notes, added_by, channel,
    added_at: Date.now(),
  };
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(rec);
      req.onsuccess = () => resolve({ ok: true, rec });
      req.onerror   = () => reject(req.error);
    });
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function addSuppressionBulk(records) {
  if (!records?.length) return { added: 0 };
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      let done = 0;
      for (const r of records) {
        const e = normEmail(r.email);
        if (!r.brand_id || !e) { if (++done === records.length) resolve({ added: done }); continue; }
        const rec = {
          id: `${r.brand_id}|${e}`,
          brand_id: r.brand_id, email: e,
          reason: r.reason || 'manual',
          notes: r.notes || '',
          added_by: r.added_by || 'system',
          channel: r.channel || 'email',
          added_at: r.added_at || Date.now(),
        };
        const req = store.put(rec);
        req.onsuccess = () => { if (++done === records.length) resolve({ added: done }); };
        req.onerror   = () => reject(req.error);
      }
    });
  } catch (e) {
    return { added: 0, error: e?.message };
  }
}

export async function removeSuppression(brandId, email) {
  const e = normEmail(email);
  if (!brandId || !e) return { ok: false };
  try {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(`${brandId}|${e}`);
      req.onsuccess = () => resolve({ ok: true });
      req.onerror   = () => reject(req.error);
    });
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function loadBrandSuppression(brandId) {
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

export async function loadAllSuppression() {
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

/**
 * Return a Set<string> of `${brand_id}|${email}` that the planner must
 * exclude from candidate picks. Builds per-brand or all-brand.
 */
export async function buildSuppressionSet(brandId = null) {
  const rows = brandId ? await loadBrandSuppression(brandId) : await loadAllSuppression();
  const set = new Set();
  for (const r of rows) set.add(`${r.brand_id}|${r.email}`);
  return set;
}

export function isSuppressed(set, brandId, email) {
  if (!set || !brandId || !email) return false;
  return set.has(`${brandId}|${normEmail(email)}`);
}

/* ─── SERVER SYNC ────────────────────────────────────────────────
   Listmonk webhook writes bounce/complaint/unsub events into a
   server-side NDJSON store. We pull those down on each planner run
   and merge into local IDB so the kill set stays current without
   requiring a manual re-import. Failures are soft — if the server is
   unreachable the planner falls back to the local registry only.
   ─────────────────────────────────────────────────────────────── */

export async function syncSuppressionFromServer(brandId = null) {
  try {
    const qs = brandId ? `?brand_id=${encodeURIComponent(brandId)}` : '';
    const res = await fetch(`/api/retention/suppression${qs}`, { method: 'GET' });
    if (!res.ok) return { ok: false, synced: 0 };
    const { rows } = await res.json();
    if (!rows?.length) return { ok: true, synced: 0 };
    const { added } = await addSuppressionBulk(rows);
    return { ok: true, synced: added };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

export async function pushSuppressionToServer(records) {
  if (!records?.length) return { ok: true, added: 0 };
  try {
    const res = await fetch('/api/retention/suppression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}
