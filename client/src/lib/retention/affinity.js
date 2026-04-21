/**
 * Product affinity graph from order line-items.
 *
 * Two structures derived in one pass over orders:
 *   1. Co-purchase pairs    — lift, confidence, support for (sku_a, sku_b)
 *   2. Category transitions — P(next_collection | last_collection) over
 *                             successive orders by the same customer.
 *
 * Both are pure functions. They expect Shopify REST-shape orders with
 * line_items[] each containing { sku, _collection } (the collection tag
 * is populated by shopifyCsvImport or by a taxonomy pass).
 */

const DAY = 86_400_000;
const sku = li => String(li?.sku || '').trim().toUpperCase();
const email = o => (o?.email || o?.customer?.email || '').toLowerCase().trim();
const col  = li => String(li?._collection || '').trim();

/* ─── CO-PURCHASE GRAPH ──────────────────────────────────────────
   For every order, enumerate unordered SKU pairs within the basket
   AND across successive orders by the same customer (within 60d) —
   the second kind captures "usually bought with, just not together".
   Support = # orders (or customers) the pair co-occurred in.
   Confidence(A→B) = P(B | A) = support(A,B) / support(A).
   Lift = P(A,B) / (P(A) * P(B)) — values >1 indicate affinity.
   Returned as { pairs: [], byAnchor: { [sku]: top-N partners } }.
   ─────────────────────────────────────────────────────────────── */
export function buildCopurchaseGraph(orders, { minSupport = 3, topN = 20, windowDays = 60 } = {}) {
  const skuSupport = new Map();  // sku → # baskets it appears in
  const pairSupport = new Map(); // `${a}|${b}` → count (a<b)
  let totalBaskets = 0;

  const bump = (k, m) => m.set(k, (m.get(k) || 0) + 1);
  const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

  // Index orders per customer sorted by time for cross-order pairs
  const byCust = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = email(o);
    if (!e) continue;
    if (!byCust.has(e)) byCust.set(e, []);
    byCust.get(e).push(o);
  }

  // Within-basket pairs
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const skus = [...new Set((o.line_items || []).map(sku).filter(Boolean))];
    if (!skus.length) continue;
    totalBaskets++;
    for (const s of skus) bump(s, skuSupport);
    for (let i = 0; i < skus.length; i++) {
      for (let j = i + 1; j < skus.length; j++) {
        bump(pairKey(skus[i], skus[j]), pairSupport);
      }
    }
  }

  // Cross-order pairs within window (same customer)
  for (const [, list] of byCust) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (let i = 0; i < list.length; i++) {
      const skusI = [...new Set((list[i].line_items || []).map(sku).filter(Boolean))];
      if (!skusI.length) continue;
      const tI = Date.parse(list[i].created_at);
      for (let j = i + 1; j < list.length; j++) {
        const tJ = Date.parse(list[j].created_at);
        if ((tJ - tI) / DAY > windowDays) break;
        const skusJ = [...new Set((list[j].line_items || []).map(sku).filter(Boolean))];
        for (const a of skusI) for (const b of skusJ) {
          if (a === b) continue;
          bump(pairKey(a, b), pairSupport);
        }
      }
    }
  }

  // Score pairs
  const pairs = [];
  for (const [k, count] of pairSupport) {
    if (count < minSupport) continue;
    const [a, b] = k.split('|');
    const supA = skuSupport.get(a) || 0;
    const supB = skuSupport.get(b) || 0;
    if (!supA || !supB) continue;
    const pA = supA / totalBaskets;
    const pB = supB / totalBaskets;
    const pAB = count / totalBaskets;
    const lift = pAB / (pA * pB);
    pairs.push({
      a, b,
      support: count,
      conf_a_to_b: +(count / supA).toFixed(3),
      conf_b_to_a: +(count / supB).toFixed(3),
      lift: +lift.toFixed(2),
    });
  }
  pairs.sort((x, y) => y.lift - x.lift);

  // Top partners per SKU — keyed by anchor, with directional confidence
  const byAnchor = {};
  const pushPartner = (anchor, partner, support, conf, lift) => {
    if (!byAnchor[anchor]) byAnchor[anchor] = [];
    byAnchor[anchor].push({ sku: partner, support, confidence: conf, lift });
  };
  for (const p of pairs) {
    pushPartner(p.a, p.b, p.support, p.conf_a_to_b, p.lift);
    pushPartner(p.b, p.a, p.support, p.conf_b_to_a, p.lift);
  }
  for (const k of Object.keys(byAnchor)) {
    byAnchor[k].sort((x, y) => y.lift - x.lift);
    byAnchor[k] = byAnchor[k].slice(0, topN);
  }

  return { pairs, byAnchor, totalBaskets };
}

/* ─── CATEGORY TRANSITION MATRIX ─────────────────────────────────
   P(next_collection | last_collection) over successive orders.
   Uses each order's dominant collection (most-revenue line_item).
   Good for "what's the next collection this buyer is likely to try".
   ─────────────────────────────────────────────────────────────── */
export function buildCategoryTransitions(orders, { minSupport = 3 } = {}) {
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const dominantCol = o => {
    const tally = {};
    for (const li of (o.line_items || [])) {
      const c = col(li);
      if (!c) continue;
      tally[c] = (tally[c] || 0) + num(li.price) * num(li.quantity || 1);
    }
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };

  const byCust = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = email(o);
    if (!e) continue;
    if (!byCust.has(e)) byCust.set(e, []);
    byCust.get(e).push(o);
  }

  const counts = {};          // from → to → n
  const totals = {};          // from → n (total out-transitions)
  for (const [, list] of byCust) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (let i = 1; i < list.length; i++) {
      const from = dominantCol(list[i - 1]);
      const to   = dominantCol(list[i]);
      if (!from || !to) continue;
      if (!counts[from]) counts[from] = {};
      counts[from][to] = (counts[from][to] || 0) + 1;
      totals[from] = (totals[from] || 0) + 1;
    }
  }

  const transitions = {};
  for (const from of Object.keys(counts)) {
    const row = [];
    for (const to of Object.keys(counts[from])) {
      const n = counts[from][to];
      if (n < minSupport) continue;
      row.push({ to, prob: +(n / totals[from]).toFixed(3), support: n });
    }
    row.sort((a, b) => b.prob - a.prob);
    transitions[from] = row;
  }
  return transitions;
}

/* ─── NEW-LAUNCH CANDIDATES ──────────────────────────────────────
   Return SKUs that first appeared within `daysNew` and have some
   sales traction (≥minOrders distinct orders). These are the
   "try this new thing" candidates for New-Launch opportunities.
   ─────────────────────────────────────────────────────────────── */
export function findNewLaunchSkus(orders, { daysNew = 60, minOrders = 3, now = Date.now() } = {}) {
  const firstSeen = new Map();   // sku → earliest ms
  const orderCount = new Map();  // sku → # distinct orders
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const t = Date.parse(o.created_at);
    if (!isFinite(t)) continue;
    const seenHere = new Set();
    for (const li of (o.line_items || [])) {
      const s = sku(li);
      if (!s || seenHere.has(s)) continue;
      seenHere.add(s);
      if (!firstSeen.has(s) || firstSeen.get(s) > t) firstSeen.set(s, t);
      orderCount.set(s, (orderCount.get(s) || 0) + 1);
    }
  }
  const launches = [];
  for (const [s, t0] of firstSeen) {
    const ageDays = (now - t0) / DAY;
    if (ageDays > daysNew) continue;
    const n = orderCount.get(s) || 0;
    if (n < minOrders) continue;
    launches.push({ sku: s, first_seen_ms: t0, age_days: Math.round(ageDays), order_count: n });
  }
  launches.sort((a, b) => b.order_count - a.order_count);
  return launches;
}

/* ─── CONVENIENCE ────────────────────────────────────────────────── */
export function buildAffinity(orders, opts = {}) {
  return {
    copurchase: buildCopurchaseGraph(orders, opts.copurchase),
    transitions: buildCategoryTransitions(orders, opts.transitions),
    newLaunches: findNewLaunchSkus(orders, opts.newLaunches),
  };
}
