/**
 * Correlate anomaly days with change events + budget limits.
 *
 * Most "CPA broke out" moments have a prosaic cause that's sitting in
 * the change_event log: someone flipped a bidding strategy, paused a
 * winning ad, or tightened an audience. The API already exposes these.
 * We pull them, bucket by day, and join to our anomaly days so the
 * "Why did this happen?" panel has a short list of candidate causes
 * instead of the operator having to rummage through the change log by
 * hand.
 *
 * Correlation is heuristic — not every change caused every anomaly.
 * We score by:
 *   1. same day or 1-day-lag (for bidding changes, lag is real)
 *   2. resource-type relevance (bidding changes are high-prior,
 *      asset-image swaps are low-prior)
 *   3. whether the changed campaign matches an anomalous slice (if
 *      the caller has already decomposed the day, pass the slice list)
 *
 * Pure function — no fetching.
 */

const DAY = 86_400_000;

const HIGH_PRIOR_RESOURCES = new Set([
  'CAMPAIGN', 'CAMPAIGN_BUDGET', 'BIDDING_STRATEGY',
  'CAMPAIGN_BIDDING_STRATEGY',
]);
const MED_PRIOR_RESOURCES = new Set([
  'AD_GROUP', 'AD_GROUP_AD', 'AD_GROUP_CRITERION',
  'CAMPAIGN_CRITERION', 'SHARED_CRITERION',
]);
const LOW_PRIOR_RESOURCES = new Set([
  'ASSET', 'ASSET_GROUP', 'ASSET_GROUP_ASSET',
  'CAMPAIGN_ASSET', 'CUSTOMER_EXTENSION_SETTING',
]);

function priorOf(resourceType) {
  if (HIGH_PRIOR_RESOURCES.has(resourceType)) return 3;
  if (MED_PRIOR_RESOURCES.has(resourceType))  return 2;
  if (LOW_PRIOR_RESOURCES.has(resourceType))  return 1;
  return 1;
}

function isoDay(ts) {
  if (!ts) return null;
  // Google returns 'YYYY-MM-DD HH:MM:SS' in account timezone. Best-effort.
  return String(ts).slice(0, 10);
}

function bucketByDay(events) {
  const by = new Map();
  for (const e of events || []) {
    const d = isoDay(e.ts);
    if (!d) continue;
    (by.get(d) || by.set(d, []).get(d)).push(e);
  }
  return by;
}

/* ─── PER-DAY CORRELATION ──────────────────────────────────────────── */

export function correlateAnomaly({ day, events, decomposed = null }) {
  const byDay = bucketByDay(events);
  // Look at same-day + 1-day prior (budget changes often kick in next day)
  const same = byDay.get(day) || [];
  const prior1 = byDay.get(new Date(new Date(`${day}T00:00:00Z`).getTime() - DAY).toISOString().slice(0, 10)) || [];

  // Identify "key slices" responsible for >20% of the day's delta (if caller
  // provided decomposition).
  const keySliceIds = new Set();
  const keySliceLabels = new Map();
  if (decomposed?.slices?.length) {
    for (const s of decomposed.slices) {
      if (s.shareAbs >= 0.2) {
        keySliceIds.add(String(s.sliceKey));
        keySliceLabels.set(String(s.sliceKey), s.sliceLabel);
      }
    }
  }

  const candidates = [];
  for (const bucket of [{ events: same, lag: 0 }, { events: prior1, lag: 1 }]) {
    for (const ev of bucket.events) {
      let score = priorOf(ev.resourceType);
      // Bump when the event names a campaign that appears in the key slices.
      const campaignMatch = ev.campaign && (keySliceIds.has(String(ev.campaign)) || keySliceIds.has(String(ev.campaign).split('/').pop()));
      if (campaignMatch) score += 2;
      if (bucket.lag === 0) score += 1;
      candidates.push({
        ts: ev.ts,
        lag: bucket.lag,
        resourceType: ev.resourceType,
        operation:    ev.operation,
        changedFields: ev.changedFields,
        userEmail:    ev.userEmail,
        clientType:   ev.clientType,
        campaign:     ev.campaign,
        adGroup:      ev.adGroup,
        score,
        campaignMatch,
        label: labelFor(ev, keySliceLabels),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function labelFor(ev, labelMap) {
  const op = (ev.operation || '').replace('RESOURCE_CHANGE_OPERATION_', '');
  const rt = (ev.resourceType || '').replace('CHANGE_CLIENT_TYPE_', '');
  const who = ev.userEmail || ev.clientType || 'unknown actor';
  const fields = ev.changedFields || '';
  const camp = ev.campaign ? (labelMap.get(String(ev.campaign).split('/').pop()) || ev.campaign) : '';
  const parts = [op, rt];
  if (camp) parts.push(`on ${camp}`);
  if (fields) parts.push(`(${fields})`);
  parts.push(`by ${who}`);
  return parts.filter(Boolean).join(' ');
}

/* ─── BUDGET-LIMITED EXPLANATION ───────────────────────────────────── */
/**
 * If reach collapsed but all change events look benign, it's usually a
 * budget cap. This tags any campaign whose daily spend ≥ 95% of its
 * budget — suggesting the account hit the ceiling.
 */
export function budgetCapped(campaignsDaily, budgets) {
  if (!campaignsDaily?.length || !budgets?.length) return [];
  // Latest-day campaign spend, joined to budget by campaignId via
  // campaign→budget reference. We don't have that join in the pull,
  // so we fall back to budget.refCount — budgets with refCount > 0 and
  // recent spend near the amount are the candidates.
  const tot = new Map();
  for (const r of campaignsDaily) {
    if (!r.campaignId) continue;
    const e = tot.get(r.campaignId) || { campaignName: r.campaignName, totalCost: 0, maxDayCost: 0, lastDate: r.date };
    e.totalCost += r.cost || 0;
    if ((r.cost || 0) > e.maxDayCost) { e.maxDayCost = r.cost || 0; e.lastDate = r.date; }
    tot.set(r.campaignId, e);
  }
  // Heuristic match — flag budgets where refCount > 0 AND the average
  // active campaign's max daily cost is near the budget amount.
  const capped = [];
  for (const b of budgets) {
    if (!b.amount || b.amount <= 0) continue;
    if (b.hasRecommended && b.recommended > b.amount * 1.3) {
      capped.push({
        budgetId: b.id, budgetName: b.name,
        amount: b.amount, recommended: b.recommended,
        refCount: b.refCount,
        reason: `Google recommends raising this budget to ₹${Math.round(b.recommended).toLocaleString()} (currently ₹${Math.round(b.amount).toLocaleString()}) — likely capping reach.`,
      });
    }
  }
  return capped;
}

/* ─── CHANGE-EVENT TIMELINE ────────────────────────────────────────── */
/**
 * Flatten events into a simple timeline the UI can render alongside
 * the daily metric grid.
 */
export function changeTimeline(events = []) {
  return [...events]
    .filter(e => e.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .map(e => ({
      ts: e.ts,
      day: isoDay(e.ts),
      hour: (e.ts || '').slice(11, 16),
      resourceType: e.resourceType,
      operation: (e.operation || '').replace('RESOURCE_CHANGE_OPERATION_', ''),
      who: e.userEmail || e.clientType || '—',
      fields: e.changedFields || '',
      campaign: e.campaign,
      adGroup: e.adGroup,
    }));
}
