/**
 * Six opportunity scorers, one per intent. Each returns a list of
 * per-customer rows { email, score, expected_incremental_revenue,
 * evidence, recommended_skus, reason } sorted by score desc.
 *
 *   1. Replenish      — consumable nearing run-out
 *   2. Complement     — cross-sell from co-purchase graph
 *   3. Winback        — dormant but historically valuable
 *   4. NewLaunch      — try-this-new-thing targeted at affinity match
 *   5. Upsell         — step up basket size / tier
 *   6. VIPProtect     — active VIPs slipping toward at-risk
 *
 * Scores are on the same 0-1 scale across opportunities so the global
 * allocator can compare them in a single heap. Expected incremental
 * revenue is scored in the brand's currency using features.aov_lifetime
 * as the baseline with opportunity-specific multipliers.
 */

const DAY = 86_400_000;
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/* ─── 1. REPLENISH ────────────────────────────────────────────────
   Customer bought a consumable SKU; the typical gap for that SKU
   is known (replenish clock); we're within the ±window of that gap.
   Score ↑ as we approach and pass the median gap, then decays after
   2x median (they've probably moved on).
   ─────────────────────────────────────────────────────────────── */
export function scoreReplenish(features, replenishClock, orders, { now = Date.now() } = {}) {
  const lastSkuDate = buildLastSkuPurchase(orders);
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    let bestSku = null, bestScore = 0, bestGap = null;
    for (const { sku: s } of (f.top_skus || [])) {
      const clk = replenishClock[s];
      if (!clk || !clk.is_consumable) continue;
      const last = lastSkuDate.get(`${e}|${s}`);
      if (!last) continue;
      const daysSince = (now - last) / DAY;
      const ratio = daysSince / clk.median_gap_days;
      let score = 0;
      if (ratio >= 0.8 && ratio <= 1.3)      score = 1.0;          // prime window
      else if (ratio > 1.3 && ratio <= 2.0)  score = 1.0 - (ratio - 1.3) / 0.7;
      else if (ratio >= 0.5 && ratio < 0.8)  score = (ratio - 0.5) / 0.3 * 0.6;
      if (score > bestScore) { bestScore = score; bestSku = s; bestGap = clk; }
    }
    if (!bestSku) continue;
    out.push({
      email: e,
      opportunity: 'REPLENISH',
      score: +bestScore.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 0.9 * bestScore).toFixed(2),
      recommended_skus: [bestSku],
      evidence: {
        sku: bestSku,
        median_gap_days: bestGap.median_gap_days,
        days_since_last: Math.round((now - lastSkuDate.get(`${e}|${bestSku}`)) / DAY),
      },
      reason: `Typical ${bestSku} gap ${bestGap.median_gap_days}d — you're in the replenish window.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── 2. COMPLEMENT ──────────────────────────────────────────────
   From the customer's recent SKUs, look up top co-purchase partners
   they haven't already bought. Score = top partner's lift capped
   with recency of the anchor purchase.
   ─────────────────────────────────────────────────────────────── */
export function scoreComplement(features, copurchase, orders, { now = Date.now() } = {}) {
  const owned = buildOwnedSkus(orders);
  const lastSkuDate = buildLastSkuPurchase(orders);
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    const mySkus = owned.get(e) || new Set();
    let bestScore = 0, bestPartner = null, bestAnchor = null, bestLift = 0;
    for (const { sku: anchor } of (f.top_skus || []).slice(0, 5)) {
      const partners = copurchase.byAnchor?.[anchor] || [];
      for (const p of partners) {
        if (mySkus.has(p.sku)) continue;
        const lastT = lastSkuDate.get(`${e}|${anchor}`) || 0;
        const recency = lastT ? clip(1 - (now - lastT) / (DAY * 180)) : 0.3;
        const score = clip((p.lift - 1) / 4) * clip(p.confidence / 0.3) * recency;
        if (score > bestScore) {
          bestScore = score; bestPartner = p.sku; bestAnchor = anchor; bestLift = p.lift;
        }
      }
    }
    if (!bestPartner || bestScore < 0.1) continue;
    out.push({
      email: e,
      opportunity: 'COMPLEMENT',
      score: +bestScore.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 0.6 * bestScore).toFixed(2),
      recommended_skus: [bestPartner],
      evidence: { anchor: bestAnchor, partner: bestPartner, lift: bestLift },
      reason: `People who bought ${bestAnchor} also buy ${bestPartner} (lift ${bestLift.toFixed(1)}x).`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── 3. WINBACK ─────────────────────────────────────────────────
   Dormant customer (last order well past typical gap) with proven
   value (orders_lifetime ≥ 2 OR spend ≥ median). Score ↑ with value,
   gated by not-too-far-gone (no point after 540d).
   ─────────────────────────────────────────────────────────────── */
export function scoreWinback(features, { now = Date.now() } = {}) {
  const buyers = Object.values(features).filter(f => f.orders_lifetime > 0);
  if (!buyers.length) return [];
  const medianSpend = percentile(buyers.map(f => f.true_spend_lifetime), 0.5);
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    const d = f.days_since_last_order;
    if (d == null || d < 60 || d > 540) continue;
    const valueOk = f.true_orders_lifetime >= 2 || f.true_spend_lifetime >= medianSpend;
    if (!valueOk) continue;
    const cadenceOverdue = f.gap_median ? clip((d / f.gap_median - 1.5) / 1.5) : clip((d - 90) / 180);
    const valueScore = clip(f.true_spend_lifetime / (medianSpend * 4));
    const decay = clip(1 - (d - 60) / 480);
    const score = 0.5 * cadenceOverdue + 0.3 * valueScore + 0.2 * decay;
    if (score < 0.15) continue;
    out.push({
      email: e,
      opportunity: 'WINBACK',
      score: +score.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 0.4 * score).toFixed(2),
      recommended_skus: (f.top_skus || []).slice(0, 3).map(x => x.sku),
      evidence: {
        days_since_last: d,
        typical_gap: f.gap_median,
        spend_lifetime: f.true_spend_lifetime,
      },
      reason: `${d}d since last order vs typical ${f.gap_median || '?'}d — high-value lapser.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── 4. NEW LAUNCH ──────────────────────────────────────────────
   Target customers whose primary_collection or top category matches
   the launch, who accept marketing, and who haven't bought the SKU.
   Score ↑ with collection affinity and novelty_ratio (they like new).
   ─────────────────────────────────────────────────────────────── */
export function scoreNewLaunch(features, newLaunches, taxonomy, orders) {
  const owned = buildOwnedSkus(orders);
  const launchToCol = {};
  for (const nl of newLaunches) {
    launchToCol[nl.sku] = taxonomy.skuLabel?.[nl.sku] || '';
  }
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    const mySkus = owned.get(e) || new Set();
    let bestScore = 0, bestSku = null, bestCol = null;
    for (const nl of newLaunches) {
      if (mySkus.has(nl.sku)) continue;
      const lbl = launchToCol[nl.sku];
      const aff = lbl ? (f.collection_affinity?.[lbl] || 0) : 0;
      const novelty = f.novelty_ratio || 0;
      const recency = f.days_since_last_order != null ? clip(1 - f.days_since_last_order / 180) : 0.2;
      const score = 0.5 * aff + 0.2 * novelty + 0.3 * recency;
      if (score > bestScore) { bestScore = score; bestSku = nl.sku; bestCol = lbl; }
    }
    if (!bestSku || bestScore < 0.12) continue;
    out.push({
      email: e,
      opportunity: 'NEW_LAUNCH',
      score: +bestScore.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 0.45 * bestScore).toFixed(2),
      recommended_skus: [bestSku],
      evidence: { sku: bestSku, collection: bestCol, affinity: f.collection_affinity?.[bestCol] || 0, novelty: f.novelty_ratio },
      reason: `New ${bestCol || 'launch'} matches your collection preference.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── 5. UPSELL ──────────────────────────────────────────────────
   Customers with low AOV relative to segment, but frequency signals
   loyalty. Pitch a larger pack or a premium-tier SKU from their top
   collection. Score ↑ with headroom to segment AOV and frequency.
   ─────────────────────────────────────────────────────────────── */
export function scoreUpsell(features, orders) {
  const buyers = Object.values(features).filter(f => f.orders_lifetime > 0);
  if (!buyers.length) return [];
  const aovP75 = percentile(buyers.map(f => f.aov_lifetime), 0.75);
  const skuStats = buildSkuStats(orders); // sku → { avg_price, col }
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    if (f.orders_lifetime < 2) continue;
    if (f.aov_lifetime >= aovP75) continue;
    const headroom = clip((aovP75 - f.aov_lifetime) / (aovP75 || 1));
    const frequency = clip(f.orders_lifetime / 6);
    const score = 0.6 * headroom + 0.4 * frequency;
    if (score < 0.15) continue;
    // Pick a premium SKU from the customer's primary collection
    const primary = f.primary_collection;
    let premiumSku = null, premiumPrice = 0;
    for (const [s, st] of Object.entries(skuStats)) {
      if (primary && st.col !== primary) continue;
      if (st.avg_price > f.aov_lifetime && st.avg_price > premiumPrice) {
        premiumPrice = st.avg_price; premiumSku = s;
      }
    }
    out.push({
      email: e,
      opportunity: 'UPSELL',
      score: +score.toFixed(3),
      expected_incremental_revenue: +((aovP75 - f.aov_lifetime) * 0.5 * score).toFixed(2),
      recommended_skus: premiumSku ? [premiumSku] : (f.top_skus || []).slice(0, 1).map(x => x.sku),
      evidence: { current_aov: f.aov_lifetime, segment_aov_p75: aovP75, orders: f.orders_lifetime },
      reason: `AOV ₹${Math.round(f.aov_lifetime)} vs top-quartile ₹${Math.round(aovP75)} — room to grow.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── 6. VIP PROTECT ─────────────────────────────────────────────
   Active VIPs whose days_since_last is creeping up toward 2x their
   usual gap. Catch before they churn. Score is sharpest in the
   1.0–1.8 overdue band (early enough to save).
   ─────────────────────────────────────────────────────────────── */
export function scoreVipProtect(features) {
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    if (f.value_tier !== 'VIP') continue;
    const d = f.days_since_last_order;
    const gap = f.gap_median;
    if (d == null || !gap) continue;
    const ratio = d / gap;
    if (ratio < 0.9 || ratio > 2.5) continue;
    const score = ratio <= 1.4 ? clip((ratio - 0.9) / 0.5) : clip(1 - (ratio - 1.4) / 1.1);
    if (score < 0.2) continue;
    out.push({
      email: e,
      opportunity: 'VIP_PROTECT',
      score: +score.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 1.1 * score).toFixed(2),
      recommended_skus: (f.top_skus || []).slice(0, 2).map(x => x.sku),
      evidence: { days_since_last: d, typical_gap: gap, lifetime_spend: f.true_spend_lifetime },
      reason: `VIP — ${d}d vs typical ${gap}d, catch before they churn.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ─── MASTER RANKER ──────────────────────────────────────────────
   Runs all 6, returns a per-customer top-k list with the best
   opportunity across categories + a flat sorted list for the
   global allocator.
   ─────────────────────────────────────────────────────────────── */
export function rankAllOpportunities({ features, replenishClock, copurchase, taxonomy, newLaunches, orders, now = Date.now() }) {
  const lists = [
    scoreReplenish(features, replenishClock || {}, orders, { now }),
    scoreComplement(features, copurchase || { byAnchor: {} }, orders, { now }),
    scoreWinback(features, { now }),
    scoreNewLaunch(features, newLaunches || [], taxonomy || { skuLabel: {} }, orders),
    scoreUpsell(features, orders),
    scoreVipProtect(features),
  ];
  const flat = lists.flat();

  const byCustomer = {};
  for (const row of flat) {
    if (!byCustomer[row.email]) byCustomer[row.email] = [];
    byCustomer[row.email].push(row);
  }
  for (const e of Object.keys(byCustomer)) byCustomer[e].sort((a, b) => b.score - a.score);
  flat.sort((a, b) => b.score - a.score);

  return { flat, byCustomer };
}

/* ─── HELPERS ───────────────────────────────────────────────────── */
function buildLastSkuPurchase(orders) {
  const m = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    for (const li of (o.line_items || [])) {
      const s = String(li.sku || '').trim().toUpperCase();
      if (!s) continue;
      const k = `${e}|${s}`;
      if (!m.has(k) || m.get(k) < t) m.set(k, t);
    }
  }
  return m;
}

function buildOwnedSkus(orders) {
  const m = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    if (!m.has(e)) m.set(e, new Set());
    const set = m.get(e);
    for (const li of (o.line_items || [])) {
      const s = String(li.sku || '').trim().toUpperCase();
      if (s) set.add(s);
    }
  }
  return m;
}

function buildSkuStats(orders) {
  const stats = {};
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    for (const li of (o.line_items || [])) {
      const s = String(li.sku || '').trim().toUpperCase();
      if (!s) continue;
      if (!stats[s]) stats[s] = { sum: 0, n: 0, col: String(li._collection || '').trim() };
      stats[s].sum += num(li.price);
      stats[s].n++;
      if (!stats[s].col && li._collection) stats[s].col = String(li._collection).trim();
    }
  }
  const out = {};
  for (const [s, v] of Object.entries(stats)) {
    out[s] = { avg_price: v.n ? v.sum / v.n : 0, col: v.col };
  }
  return out;
}

function percentile(arr, p) {
  const a = arr.filter(x => isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.floor(a.length * p));
  return a[i];
}
