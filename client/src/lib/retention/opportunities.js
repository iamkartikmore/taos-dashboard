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

import { inStock } from './productLookup';

const DAY = 86_400_000;
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/* Optional-call helper: if `fn` is set, use its output; else return `fallback`. */
const pick = (fn, fallback, ...args) => (typeof fn === 'function' ? fn(...args) : fallback);

/* Filter a candidate SKU list down to in-stock only. If lookup is null/empty,
   leaves the list unchanged — the guardrail only kicks in with real stock. */
function filterStock(skus, lookup, threshold = 1) {
  if (!skus?.length || !lookup) return skus || [];
  return skus.filter(s => inStock(s, lookup, threshold));
}

/* ─── 1. REPLENISH ────────────────────────────────────────────────
   Customer bought a consumable SKU; the typical gap for that SKU
   is known (replenish clock); we're within the ±window of that gap.
   Score ↑ as we approach and pass the median gap, then decays after
   2x median (they've probably moved on).
   ─────────────────────────────────────────────────────────────── */
export function scoreReplenish(features, replenishClock, orders, { now = Date.now(), skuHazard = null, lookup = null, horizon = 7 } = {}) {
  const lastSkuDate = buildLastSkuPurchase(orders);
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    let bestSku = null, bestScore = 0, bestGap = null, bestHazardP = null;
    for (const { sku: s } of (f.top_skus || [])) {
      if (lookup && !inStock(s, lookup)) continue;
      const clk = replenishClock[s];
      if (!clk || !clk.is_consumable) continue;
      const last = lastSkuDate.get(`${e}|${s}`);
      if (!last) continue;
      const daysSince = (now - last) / DAY;

      // Primary signal: Weibull SKU hazard — P(repurchase in next horizon).
      // Falls back to heuristic ratio window if we don't have a fit.
      let score = 0, hazardP = null;
      if (skuHazard) {
        hazardP = skuHazard(s, daysSince, horizon);
        score = clip(hazardP * 1.3);   // stretch so prime-window lands near 1.0
      } else {
        const ratio = daysSince / clk.median_gap_days;
        if (ratio >= 0.8 && ratio <= 1.3)      score = 1.0;
        else if (ratio > 1.3 && ratio <= 2.0)  score = 1.0 - (ratio - 1.3) / 0.7;
        else if (ratio >= 0.5 && ratio < 0.8)  score = (ratio - 0.5) / 0.3 * 0.6;
      }
      if (score > bestScore) { bestScore = score; bestSku = s; bestGap = clk; bestHazardP = hazardP; }
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
        hazard_p: bestHazardP != null ? +bestHazardP.toFixed(3) : null,
      },
      reason: bestHazardP != null
        ? `P(repurchase in ${horizon}d) ≈ ${Math.round(bestHazardP * 100)}% — you're due for ${bestSku}.`
        : `Typical ${bestSku} gap ${bestGap.median_gap_days}d — you're in the replenish window.`,
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
export function scoreComplement(features, copurchase, orders, { now = Date.now(), recommender = null, lookup = null } = {}) {
  const owned = buildOwnedSkus(orders);
  const lastSkuDate = buildLastSkuPurchase(orders);
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    const mySkus = owned.get(e) || new Set();

    // Preferred path: hybrid recommender blends co-purchase + content similarity.
    // Falls back to raw copurchase.byAnchor lift when no recommender is built.
    if (recommender) {
      const anchors = (f.top_skus || []).slice(0, 8).map(x => x.sku);
      const recs = recommenderPicks(recommender, anchors, 12);
      let bestScore = 0, bestPartner = null, bestAnchor = null, bestSim = 0;
      for (const r of recs) {
        if (mySkus.has(r.sku)) continue;
        if (lookup && !inStock(r.sku, lookup)) continue;
        const anchor = r.anchor || anchors[0];
        const lastT = lastSkuDate.get(`${e}|${anchor}`) || 0;
        const recency = lastT ? clip(1 - (now - lastT) / (DAY * 180)) : 0.3;
        const score = clip(r.score) * (0.5 + 0.5 * recency);
        if (score > bestScore) {
          bestScore = score; bestPartner = r.sku; bestAnchor = anchor; bestSim = r.score;
        }
      }
      if (bestPartner && bestScore >= 0.1) {
        out.push({
          email: e,
          opportunity: 'COMPLEMENT',
          score: +bestScore.toFixed(3),
          expected_incremental_revenue: +(f.aov_lifetime * 0.6 * bestScore).toFixed(2),
          recommended_skus: [bestPartner],
          evidence: { anchor: bestAnchor, partner: bestPartner, sim: +bestSim.toFixed(3) },
          reason: `People who bought ${bestAnchor} also buy ${bestPartner}.`,
        });
        continue;
      }
    }

    let bestScore = 0, bestPartner = null, bestAnchor = null, bestLift = 0;
    for (const { sku: anchor } of (f.top_skus || []).slice(0, 5)) {
      const partners = copurchase.byAnchor?.[anchor] || [];
      for (const p of partners) {
        if (mySkus.has(p.sku)) continue;
        if (lookup && !inStock(p.sku, lookup)) continue;
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

/* Run recommender over a set of anchors, tracking which anchor drove each pick. */
function recommenderPicks(rec, anchors, topK) {
  const seen = new Set(anchors.map(s => String(s).toUpperCase()));
  const scores = new Map();
  const bestAnchor = new Map();
  for (const anchor of seen) {
    for (const n of (rec.collabNeighbors?.[anchor] || [])) {
      if (seen.has(n.sku)) continue;
      const v = 0.65 * n.sim;
      if (v > (scores.get(n.sku) || 0)) bestAnchor.set(n.sku, anchor);
      scores.set(n.sku, (scores.get(n.sku) || 0) + v);
    }
    for (const n of (rec.contentNeighbors?.[anchor] || [])) {
      if (seen.has(n.sku)) continue;
      const v = 0.35 * n.sim;
      if (v > (scores.get(n.sku) || 0) && !bestAnchor.has(n.sku)) bestAnchor.set(n.sku, anchor);
      scores.set(n.sku, (scores.get(n.sku) || 0) + v);
    }
  }
  return Array.from(scores.entries())
    .map(([sku, score]) => ({ sku, score, anchor: bestAnchor.get(sku) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/* ─── 3. WINBACK ─────────────────────────────────────────────────
   Dormant customer (last order well past typical gap) with proven
   value (orders_lifetime ≥ 2 OR spend ≥ median). Score ↑ with value,
   gated by not-too-far-gone (no point after 540d).
   ─────────────────────────────────────────────────────────────── */
export function scoreWinback(features, { now = Date.now(), lookup = null } = {}) {
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
    const recommended = filterStock((f.top_skus || []).map(x => x.sku), lookup).slice(0, 3);
    if (!recommended.length) continue;
    out.push({
      email: e,
      opportunity: 'WINBACK',
      score: +score.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 0.4 * score).toFixed(2),
      recommended_skus: recommended,
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
export function scoreNewLaunch(features, newLaunches, taxonomy, orders, { recommender = null, lookup = null } = {}) {
  const owned = buildOwnedSkus(orders);
  const launchToCol = {};
  for (const nl of newLaunches) {
    launchToCol[nl.sku] = taxonomy.skuLabel?.[nl.sku] || '';
  }
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    const mySkus = owned.get(e) || new Set();
    // Content similarity between a launch SKU and the customer's seen SKUs:
    // captures "this new launch is similar to what you already buy" which
    // beats collection-only affinity for cross-collection launches.
    const seen = (f.top_skus || []).slice(0, 6).map(x => String(x.sku).toUpperCase());
    let bestScore = 0, bestSku = null, bestCol = null;
    for (const nl of newLaunches) {
      if (mySkus.has(nl.sku)) continue;
      if (lookup && !inStock(nl.sku, lookup)) continue;
      const lbl = launchToCol[nl.sku];
      const aff = lbl ? (f.collection_affinity?.[lbl] || 0) : 0;
      const novelty = f.novelty_ratio || 0;
      const recency = f.days_since_last_order != null ? clip(1 - f.days_since_last_order / 180) : 0.2;
      let simBoost = 0;
      if (recommender?.contentNeighbors) {
        const sk = String(nl.sku).toUpperCase();
        for (const anchor of seen) {
          const match = (recommender.contentNeighbors[anchor] || []).find(n => n.sku === sk);
          if (match && match.sim > simBoost) simBoost = match.sim;
        }
      }
      const score = 0.4 * aff + 0.15 * novelty + 0.25 * recency + 0.2 * simBoost;
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
export function scoreUpsell(features, orders, { lookup = null } = {}) {
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
      if (lookup && !inStock(s, lookup)) continue;
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
export function scoreVipProtect(features, { customerHazard = null, lookup = null, horizon = 14 } = {}) {
  const out = [];
  for (const [e, f] of Object.entries(features)) {
    if (!f.orders_lifetime || !f.accepts_email_marketing) continue;
    if (f.value_tier !== 'VIP') continue;
    const d = f.days_since_last_order;
    if (d == null) continue;

    // Prefer customer-level Weibull hazard: urgency = 1 - P(they'd order on
    // their own in next `horizon` days). When the fit says they're unlikely
    // to come back soon, we want to reach out *now*. Fall back to ratio-band
    // when no fit exists.
    let score = 0;
    if (customerHazard) {
      const pOrder = customerHazard(e, d, horizon);
      score = clip(1 - pOrder);                      // higher churn-risk → higher score
      // Clip floor: only flag if the customer is already past their usual cadence
      if (f.gap_median && d < 0.9 * f.gap_median) score = 0;
    } else {
      const gap = f.gap_median;
      if (!gap) continue;
      const ratio = d / gap;
      if (ratio < 0.9 || ratio > 2.5) continue;
      score = ratio <= 1.4 ? clip((ratio - 0.9) / 0.5) : clip(1 - (ratio - 1.4) / 1.1);
    }
    if (score < 0.2) continue;
    const skusTop = (f.top_skus || []).slice(0, 5).map(x => x.sku);
    const skus = filterStock(skusTop, lookup).slice(0, 2);
    if (!skus.length) continue;
    out.push({
      email: e,
      opportunity: 'VIP_PROTECT',
      score: +score.toFixed(3),
      expected_incremental_revenue: +(f.aov_lifetime * 1.1 * score).toFixed(2),
      recommended_skus: skus,
      evidence: { days_since_last: d, typical_gap: f.gap_median, lifetime_spend: f.true_spend_lifetime },
      reason: `VIP — ${d}d since last order, catch before they churn.`,
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
export function rankAllOpportunities({
  features, replenishClock, copurchase, taxonomy, newLaunches, orders,
  now = Date.now(),
  // ML primitives (all optional — scorers fall back to heuristics if absent)
  skuHazard = null, customerHazard = null,
  recommender = null,
  lookup = null,
}) {
  const lists = [
    scoreReplenish(features, replenishClock || {}, orders, { now, skuHazard, lookup }),
    scoreComplement(features, copurchase || { byAnchor: {} }, orders, { now, recommender, lookup }),
    scoreWinback(features, { now, lookup }),
    scoreNewLaunch(features, newLaunches || [], taxonomy || { skuLabel: {} }, orders, { recommender, lookup }),
    scoreUpsell(features, orders, { lookup }),
    scoreVipProtect(features, { customerHazard, lookup }),
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
