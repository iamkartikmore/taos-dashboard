/* ─── Daily auto-pull at 7am IST ────────────────────────────────────
   On app mount, check if we're past today's 7am IST and the last
   auto-pull is stale. If so, kick off a background 90d orders pull
   for every Shopify-configured brand. Runs once per IST day.
   ──────────────────────────────────────────────────────────────────── */

import { fetchShopifyOrders } from './api';
import { useStore } from '../store';

const LS_LAST_PULL = 'taos_last_auto_pull';   // unix ms
const AUTO_PULL_HOUR_IST = 7;                 // 7am IST
const AUTO_PULL_WINDOW_DAYS = 90;

function todayIstSevenAmMs() {
  // IST is UTC+5:30. "Today's 7am IST" in UTC:
  //   Take the current UTC instant, shift to IST, floor to 00:00 IST, add 7h.
  const nowUtcMs = Date.now();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(nowUtcMs + istOffsetMs);
  // Floor to IST midnight (as if it were UTC)
  const istMidnightUtc = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
  );
  // Convert that IST-midnight back to real UTC ms, then add 7h
  return istMidnightUtc - istOffsetMs + AUTO_PULL_HOUR_IST * 3600 * 1000;
}

export function shouldAutoPull() {
  const trigger = todayIstSevenAmMs();
  const now = Date.now();
  if (now < trigger) return false;  // still before 7am IST today
  const last = parseInt(localStorage.getItem(LS_LAST_PULL) || '0', 10);
  return last < trigger;
}

export function markAutoPullDone() {
  try { localStorage.setItem(LS_LAST_PULL, String(Date.now())); } catch {}
}

export function lastAutoPullAt() {
  const v = parseInt(localStorage.getItem(LS_LAST_PULL) || '0', 10);
  return v > 0 ? v : null;
}

/* ─── pull 90d orders for a single brand ─────────────────────────── */
export async function pullBrandOrders90d(brand, setBrandOrders, setBrandOrdersStatus) {
  const { shop, clientId, clientSecret } = brand.shopify || {};
  if (!shop || !clientId || !clientSecret) return { ok: false, reason: 'no-config' };

  const { startPullJob, updatePullJob, finishPullJob } = useStore.getState();
  const jobId = `shopify-orders:${brand.id}:90d:${Date.now()}`;
  startPullJob(jobId, `Shopify Orders — ${brand.name}`, `last ${AUTO_PULL_WINDOW_DAYS}d`);

  const untilDate = new Date();
  const sinceDate = new Date(untilDate.getTime() - AUTO_PULL_WINDOW_DAYS * 86400000);

  setBrandOrdersStatus?.(brand.id, 'loading');

  // Chunked (30d chunks) to avoid timeouts / memory spikes
  const chunkMs = 30 * 86400000;
  const chunks = [];
  let start = sinceDate.getTime();
  while (start < untilDate.getTime()) {
    const end = Math.min(start + chunkMs, untilDate.getTime());
    chunks.push([new Date(start).toISOString(), new Date(end).toISOString()]);
    start = end + 1000;
  }

  try {
    const all = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      const [cStart, cEnd] = chunks[ci];
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 4000 * attempt));
        updatePullJob(jobId, {
          pct: (ci / chunks.length) * 100,
          detail: `chunk ${ci + 1}/${chunks.length}${attempt > 0 ? ` · retry ${attempt}` : ''} · ${all.length} orders so far`,
        });
        try {
          const res = await fetchShopifyOrders(shop, clientId, clientSecret, cStart, cEnd);
          all.push(...(res.orders || []));
          done = true;
        } catch (e) {
          if (attempt >= 2) throw e;
        }
      }
    }
    setBrandOrders(brand.id, all, `${AUTO_PULL_WINDOW_DAYS}d`);
    finishPullJob(jobId, true, `${all.length} orders`);
    return { ok: true, count: all.length };
  } catch (e) {
    setBrandOrdersStatus?.(brand.id, 'error', e.message);
    finishPullJob(jobId, false, e.message || 'Orders failed');
    return { ok: false, reason: 'fetch-failed', error: e.message };
  }
}

/* ─── run auto-pull for all configured brands ─────────────────────── */
export async function runDailyAutoPull(brands, setBrandOrders, setBrandOrdersStatus) {
  const configured = (brands || []).filter(b =>
    b.shopify?.shop && b.shopify?.clientId && b.shopify?.clientSecret
  );
  if (!configured.length) return;

  // Fire sequentially to avoid overwhelming the API
  for (const b of configured) {
    await pullBrandOrders90d(b, setBrandOrders, setBrandOrdersStatus);
  }
  markAutoPullDone();
}
