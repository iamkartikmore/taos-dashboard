/**
 * Hybrid product recommender.
 *
 * Combines two signals, both cheap to build client-side:
 *
 *   1. **Collaborative (user→item)** — implicit-feedback item-item cosine
 *      on a binary customer×SKU matrix (row = customer, col = SKU, cell = 1
 *      if that customer ever bought that SKU). Similarity(a, b) = cos(col_a,
 *      col_b) in customer-space. This is the classic "users who bought X
 *      also bought Y" signal, robust on sparse data as long as popular SKUs
 *      aren't allowed to dominate (we divide by sqrt-degree, i.e. cosine
 *      rather than raw co-count, which already does that).
 *
 *   2. **Content (item→item)** — Jaccard over each SKU's content tokens
 *      (collection, product_type, vendor, price-band bucket). Handles the
 *      cold-start case for new SKUs with zero purchase history — as long
 *      as we know their taxonomy, we can still recommend them.
 *
 * `recommendForCustomer(skusSeen, {topK, alpha})`:
 *   blended = α · collab + (1-α) · content, aggregated over the seen set,
 *   then seen SKUs filtered out. Default α = 0.65 — collaborative usually
 *   beats content once we have >200 customers, but content is what keeps
 *   new launches discoverable.
 *
 * All structures are plain objects so they survive JSON round-trip into
 * IndexedDB.
 */

const sku = li => String(li?.sku || '').trim().toUpperCase();
const email = o => (o?.email || o?.customer?.email || '').toLowerCase().trim();

/* ─── CONTENT INDEX ───────────────────────────────────────────── */

function priceBand(p) {
  const n = parseFloat(p);
  if (!isFinite(n) || n <= 0) return 'price_unknown';
  if (n < 250)  return 'price_lt_250';
  if (n < 500)  return 'price_250_500';
  if (n < 1000) return 'price_500_1k';
  if (n < 2000) return 'price_1k_2k';
  if (n < 5000) return 'price_2k_5k';
  return 'price_gte_5k';
}

/**
 * Build a content token set per SKU from line_items. Later tokens override
 * earlier ones only for price-band; taxonomy tokens accumulate. Empty tokens
 * are skipped. Returns { [sku]: Set<string> }.
 */
export function buildContentIndex(orders) {
  const tokens = {};  // sku → Set
  const lastPrice = {};
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    for (const li of (o.line_items || [])) {
      const s = sku(li);
      if (!s) continue;
      if (!tokens[s]) tokens[s] = new Set();
      const add = t => { if (t) tokens[s].add(String(t).toLowerCase()); };
      add(li._collection ? `col:${li._collection}` : '');
      add(li.product_type ? `type:${li.product_type}` : '');
      add(li.vendor ? `vendor:${li.vendor}` : '');
      // Price-band: keep the most recent non-zero price seen.
      const p = parseFloat(li.price);
      if (isFinite(p) && p > 0) lastPrice[s] = p;
    }
  }
  for (const [s, price] of Object.entries(lastPrice)) {
    tokens[s].add(priceBand(price));
  }
  return tokens;
}

function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Precompute content-similar neighbors per SKU. O(N²) but capped by topN per
 * anchor; for <1500 SKUs per brand this finishes in ~80ms. Returns
 * { [sku]: [{sku, sim}, …] }.
 */
export function buildContentNeighbors(contentIndex, { topN = 30, minSim = 0.05 } = {}) {
  const keys = Object.keys(contentIndex);
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    const row = [];
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      const b = keys[j];
      const s = jaccard(contentIndex[a], contentIndex[b]);
      if (s >= minSim) row.push({ sku: b, sim: +s.toFixed(3) });
    }
    row.sort((x, y) => y.sim - x.sim);
    out[a] = row.slice(0, topN);
  }
  return out;
}

/* ─── COLLABORATIVE INDEX ─────────────────────────────────────── */

/**
 * Item-item cosine on the binary customer×SKU matrix. For each SKU `a`
 * we store its top-N cosine-similar partners. The trick to keeping this
 * cheap: we only materialise similarities for pairs that share at least
 * one customer (via the inverted index cust→SKUs), which is O(Σ |basket|²)
 * rather than O(|SKU|²).
 *
 * Returns { [sku]: [{sku, sim, co}, …] }.
 */
export function buildCollabNeighbors(orders, { topN = 30, minCo = 2 } = {}) {
  // Customer → Set<SKU>
  const custSkus = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = email(o);
    if (!e) continue;
    if (!custSkus.has(e)) custSkus.set(e, new Set());
    const set = custSkus.get(e);
    for (const li of (o.line_items || [])) {
      const s = sku(li);
      if (s) set.add(s);
    }
  }
  // SKU → # unique customers (column norm)
  const skuCust = new Map();
  for (const [, set] of custSkus) {
    for (const s of set) skuCust.set(s, (skuCust.get(s) || 0) + 1);
  }
  // Co-customer count per pair
  const co = new Map();
  const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  for (const [, set] of custSkus) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = pairKey(arr[i], arr[j]);
        co.set(k, (co.get(k) || 0) + 1);
      }
    }
  }
  // Per-SKU top-N cosine neighbors
  const byAnchor = {};
  for (const [k, n] of co) {
    if (n < minCo) continue;
    const [a, b] = k.split('|');
    const na = skuCust.get(a) || 0;
    const nb = skuCust.get(b) || 0;
    if (!na || !nb) continue;
    const cos = n / Math.sqrt(na * nb);
    (byAnchor[a] ||= []).push({ sku: b, sim: +cos.toFixed(3), co: n });
    (byAnchor[b] ||= []).push({ sku: a, sim: +cos.toFixed(3), co: n });
  }
  for (const s of Object.keys(byAnchor)) {
    byAnchor[s].sort((x, y) => y.sim - x.sim);
    byAnchor[s] = byAnchor[s].slice(0, topN);
  }
  return byAnchor;
}

/* ─── END-TO-END BUILD + QUERY ────────────────────────────────── */

export function buildRecommender(orders, opts = {}) {
  const contentIndex = buildContentIndex(orders);
  const contentNeighbors = buildContentNeighbors(contentIndex, opts.content);
  const collabNeighbors = buildCollabNeighbors(orders, opts.collab);
  return { contentIndex, contentNeighbors, collabNeighbors };
}

/**
 * Aggregate blended scores across the seen-SKU set and return top-K candidate
 * SKUs (with the seen set filtered out). α weights collaborative vs content.
 */
export function recommendForCustomer(rec, skusSeen, { topK = 10, alpha = 0.65 } = {}) {
  if (!rec || !skusSeen?.length) return [];
  const seen = new Set(skusSeen.map(s => String(s).toUpperCase()));
  const scores = new Map();
  const bump = (s, v) => scores.set(s, (scores.get(s) || 0) + v);
  for (const anchor of seen) {
    for (const n of (rec.collabNeighbors[anchor] || [])) {
      if (!seen.has(n.sku)) bump(n.sku, alpha * n.sim);
    }
    for (const n of (rec.contentNeighbors[anchor] || [])) {
      if (!seen.has(n.sku)) bump(n.sku, (1 - alpha) * n.sim);
    }
  }
  const out = Array.from(scores.entries())
    .map(([sku, score]) => ({ sku, score: +score.toFixed(3) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return out;
}

/**
 * Pick the best **anchor** among seen SKUs to "bundle with" a given candidate
 * SKU — i.e. if we're about to recommend `candidate` to a customer, which
 * of their seen SKUs is the most natural reason? Used by Complement copy
 * ("pairs well with your X").
 */
export function bestAnchorFor(rec, candidate, seen) {
  if (!rec || !candidate || !seen?.length) return null;
  const cand = String(candidate).toUpperCase();
  let best = null;
  for (const s of seen) {
    const anchor = String(s).toUpperCase();
    const colSim = (rec.collabNeighbors[anchor] || []).find(n => n.sku === cand)?.sim || 0;
    const conSim = (rec.contentNeighbors[anchor] || []).find(n => n.sku === cand)?.sim || 0;
    const blended = 0.65 * colSim + 0.35 * conSim;
    if (blended > 0 && (!best || blended > best.sim)) {
      best = { sku: anchor, sim: +blended.toFixed(3) };
    }
  }
  return best;
}
