/**
 * Multi-touch journey sequencer.
 *
 * A single "pick" from the send planner is the Day-0 touch. For opportunities
 * that warrant a follow-up (REPLENISH, WINBACK, VIP_PROTECT), we also schedule
 * a Day-3 nudge and a Day-7 last-call — both stored as pending journey steps
 * in IndexedDB. On every planner run we tick the journey queue:
 *
 *   - steps whose fire_at is still in the future    → left alone
 *   - steps where the customer has already ordered  → dropped (converted)
 *   - steps where the customer got suppressed       → dropped
 *   - steps where the customer has already received fatigueMax sends within
 *     the window                                    → dropped
 *   - remaining steps whose fire_at ≤ now           → promoted into the
 *                                                     opportunity pool for
 *                                                     the current plan run
 *
 * Each journey step is a full, self-contained pick so the planner's existing
 * governance (uplift kill, bandit weight, caps, holdout) still applies when
 * it's promoted. The variant and subject are chosen per step so Day-3 doesn't
 * repeat Day-0's copy.
 *
 * Record shape (stored in IDB):
 *   {
 *     id:            `${brand_id}|${email}|${campaign_id}|${step}`,
 *     brand_id, email, campaign_id,
 *     step:          0 | 1 | 2,            // 0=Day-0, 1=Day-3, 2=Day-7
 *     opportunity:   'REPLENISH' | ...,
 *     variant:       'default' | 'urgent' | 'soft',
 *     score, expected_rev,
 *     recommended_skus: string[],
 *     reason: string,
 *     fire_at:       ms epoch,
 *     status:        'scheduled' | 'promoted' | 'dropped',
 *     drop_reason?:  string,
 *     created_at:    ms epoch,
 *   }
 */

const DAY = 86_400_000;
const DB_NAME = 'taos_journey';
const STORE   = 'steps';
const VERSION = 1;

/* Per-opportunity cadence (ms offsets from Day 0) + variant per step.
   Keep this table tight — 3 steps is a soft ceiling so we don't burn fatigue. */
export const JOURNEY_CADENCE = {
  REPLENISH:   [{ step: 0, offset: 0,          variant: 'default' },
                { step: 1, offset: 3 * DAY,    variant: 'nudge'   },
                { step: 2, offset: 7 * DAY,    variant: 'last_call' }],
  WINBACK:     [{ step: 0, offset: 0,          variant: 'default' },
                { step: 1, offset: 5 * DAY,    variant: 'offer'   },
                { step: 2, offset: 12 * DAY,   variant: 'last_call' }],
  VIP_PROTECT: [{ step: 0, offset: 0,          variant: 'default' },
                { step: 1, offset: 4 * DAY,    variant: 'concierge' }],
  COMPLEMENT:  [{ step: 0, offset: 0,          variant: 'default' }],
  NEW_LAUNCH:  [{ step: 0, offset: 0,          variant: 'default' }],
  UPSELL:      [{ step: 0, offset: 0,          variant: 'default' }],
};

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
        os.createIndex('byBrandEmail', ['brand_id', 'email'], { unique: false });
        os.createIndex('byFireAt',     'fire_at',              { unique: false });
        os.createIndex('byStatus',     'status',               { unique: false });
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

/* ─── SCHEDULE STEPS FOR A CONFIRMED PLAN ─────────────────────── */

/** From a single Day-0 pick, materialise the follow-up steps as 'scheduled' rows. */
export function stepsForPick(pick, campaignId, now = Date.now()) {
  const cadence = JOURNEY_CADENCE[pick.opportunity] || JOURNEY_CADENCE.COMPLEMENT;
  return cadence.map(c => ({
    id: `${pick.brand_id}|${pick.email}|${campaignId}|${c.step}`,
    brand_id:   pick.brand_id,
    email:      pick.email,
    campaign_id: campaignId,
    step:       c.step,
    opportunity: pick.opportunity,
    variant:    c.variant,
    channel:    pick.channel || 'email',
    score:      pick.score,
    expected_rev: pick.expected_incremental_revenue,
    recommended_skus: pick.recommended_skus || [],
    reason:     pick.reason,
    fire_at:    now + c.offset,
    status:     c.step === 0 ? 'promoted' : 'scheduled',  // Day 0 already going out
    created_at: now,
  }));
}

export async function scheduleJourneyForPlan(picks, campaignId, now = Date.now()) {
  if (!picks?.length) return { added: 0 };
  const rows = [];
  for (const p of picks) rows.push(...stepsForPick(p, campaignId, now));
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    let done = 0;
    for (const r of rows) {
      const req = store.put(r);
      req.onsuccess = () => { if (++done === rows.length) resolve({ added: done }); };
      req.onerror   = () => reject(req.error);
    }
  });
}

/* ─── TICK THE JOURNEY QUEUE ─────────────────────────────────── */

export async function loadScheduledSteps(now = Date.now()) {
  try {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.index('byStatus').getAll('scheduled');
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter(r => r.fire_at <= now));
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

async function writeStep(r) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(r);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Evaluate pending steps against live state:
 *   - drop those whose customer converted since scheduling
 *   - drop those whose customer got suppressed
 *   - drop those over fatigueMax in the last 7d
 *   - promote the rest — returned as pick-shaped rows for planner injection
 *
 * @param orders          the full order stream (across all brands) so we can
 *                        detect "converted since scheduling".
 * @param suppressionSet  Set<`${brand_id}|${email}`>
 * @param customerState   same shape the planner consumes.
 * @param now             clock.
 */
export async function tickJourneys({ orders, suppressionSet, customerState, fatigueMax = 2, now = Date.now() }) {
  const pending = await loadScheduledSteps(now);
  if (!pending.length) return { promoted: [], dropped: 0 };

  // Build a (brand_id, email) → latest_order_ms lookup for "converted since".
  const latestOrder = new Map();
  for (const o of orders || []) {
    if (o?.cancelled_at) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    const bid = o._brandId || o.brand_id || 'default';
    const k = `${bid}|${e}`;
    if (!latestOrder.has(k) || latestOrder.get(k) < t) latestOrder.set(k, t);
  }

  const promoted = [];
  let dropped = 0;

  for (const s of pending) {
    const key = `${s.brand_id}|${s.email}`;

    if (suppressionSet?.has(key)) {
      s.status = 'dropped'; s.drop_reason = 'suppressed'; await writeStep(s); dropped++; continue;
    }
    // Converted since scheduling? Any order after created_at drops the step.
    const lastOrd = latestOrder.get(key);
    if (lastOrd && lastOrd > s.created_at) {
      s.status = 'dropped'; s.drop_reason = 'converted'; await writeStep(s); dropped++; continue;
    }
    const st = customerState?.[key] || {};
    if ((st.sends_last_7d || 0) >= fatigueMax) {
      s.status = 'dropped'; s.drop_reason = 'fatigue'; await writeStep(s); dropped++; continue;
    }

    s.status = 'promoted';
    await writeStep(s);
    promoted.push({
      brand_id: s.brand_id,
      email: s.email,
      opportunity: s.opportunity,
      score: s.score,
      expected_incremental_revenue: s.expected_rev,
      recommended_skus: s.recommended_skus,
      reason: s.reason,
      journey_step: s.step,
      variant: s.variant,
      channel: s.channel || 'email',
      campaign_id: s.campaign_id,
    });
  }
  return { promoted, dropped };
}

/* ─── DIAGNOSTICS ──────────────────────────────────────────────── */

export async function loadAllSteps() {
  try {
    const store = await tx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch { return []; }
}

export async function summarizeJourneys() {
  const all = await loadAllSteps();
  const by = { scheduled: 0, promoted: 0, dropped: 0 };
  const dropReasons = {};
  for (const r of all) {
    by[r.status] = (by[r.status] || 0) + 1;
    if (r.status === 'dropped' && r.drop_reason) {
      dropReasons[r.drop_reason] = (dropReasons[r.drop_reason] || 0) + 1;
    }
  }
  return { total: all.length, ...by, drop_reasons: dropReasons };
}
