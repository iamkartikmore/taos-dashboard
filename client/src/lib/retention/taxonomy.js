/**
 * Auto-derive product taxonomy from Shopify line-item data.
 *
 * No hardcoded category rules. Source of truth:
 *   1. product_type         (Shopify's top-level bucket)
 *   2. tags[]               (Shopify's flexible labels)
 *   3. vendor               (brand/manufacturer)
 *   4. title keyword tokens (fallback: common terms across titles)
 *
 * Output: a map { sku → collection_label } and a list of detected
 * collections. The label is stamped onto line_items._collection so
 * downstream feature/affinity code can use it uniformly regardless
 * of how the data was imported.
 */

const sku = v => String(v || '').trim().toUpperCase();
const norm = v => String(v || '').trim();

const STOP = new Set([
  'the','a','an','of','for','with','and','or','in','to','on','by','from',
  'pack','set','kit','combo','box','bag','bottle','pouch','ml','gm','g','kg','l','pcs','piece','pieces','pkt','pkts',
  'new','premium','organic','natural','pure','fresh','home','indoor','outdoor','plant','plants',
]);

/* ─── TOKENIZE TITLE ─────────────────────────────────────────────── */
function tokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
}

/* ─── BUILD TAXONOMY FROM ORDERS ─────────────────────────────────
   Passes:
     1. Collect per-SKU best-effort metadata across orders (majority
        product_type / vendor / union of tags). product_type wins if
        present; else majority tag; else vendor; else title token.
     2. Emit sku → label map.
   ─────────────────────────────────────────────────────────────── */
export function buildTaxonomy(orders, { fallbackToVendor = true, fallbackToTitle = true } = {}) {
  const bySku = new Map(); // sku → { productTypes:Map, tags:Map, vendors:Map, titles:[], n }
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    for (const li of (o.line_items || [])) {
      const s = sku(li.sku);
      if (!s) continue;
      if (!bySku.has(s)) bySku.set(s, { productTypes: new Map(), tags: new Map(), vendors: new Map(), titles: [], n: 0 });
      const b = bySku.get(s);
      b.n++;
      const pt = norm(li.product_type || li._product_type);
      if (pt) b.productTypes.set(pt, (b.productTypes.get(pt) || 0) + 1);
      const vendor = norm(li.vendor || li._vendor);
      if (vendor) b.vendors.set(vendor, (b.vendors.get(vendor) || 0) + 1);
      const rawTags = li.tags || li._tags;
      const tagList = Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(',').map(t => t.trim()).filter(Boolean);
      for (const t of tagList) {
        // Skip operational/metadata tags: "status:shipped", "warehouse:1",
        // payment methods, pure numbers, tracking-ish tokens.
        if (!t || t.includes(':')) continue;
        if (/^\d+$/.test(t)) continue;
        if (/^(paid|shipped|pending|fulfilled|unfulfilled|cancelled|refunded|credit|debit|card|fastrr|cod|cash|online)$/i.test(t)) continue;
        b.tags.set(t, (b.tags.get(t) || 0) + 1);
      }
      if (li.title && b.titles.length < 5) b.titles.push(String(li.title));
    }
  }

  const topKey = m => {
    let best = ''; let bestN = 0;
    for (const [k, n] of m) { if (n > bestN) { best = k; bestN = n; } }
    return best;
  };

  // First pass: product_type preferred
  const skuLabel = {};
  const titleTokenCount = new Map(); // for fallback: global token → n
  for (const [s, b] of bySku) {
    const pt = topKey(b.productTypes);
    if (pt) { skuLabel[s] = pt; continue; }
    const tag = topKey(b.tags);
    if (tag) { skuLabel[s] = tag; continue; }
    if (fallbackToVendor) {
      const v = topKey(b.vendors);
      // Skip junk vendor values pulled from generic columns
      if (v && !/^(fastrr|credit|debit|card|cod|cash|online)$/i.test(v)) {
        skuLabel[s] = v; continue;
      }
    }
    if (fallbackToTitle) {
      for (const t of b.titles) for (const tok of tokens(t)) {
        titleTokenCount.set(tok, (titleTokenCount.get(tok) || 0) + 1);
      }
    }
  }

  if (fallbackToTitle) {
    // Use most-common title token per SKU as a last-resort label
    for (const [s, b] of bySku) {
      if (skuLabel[s]) continue;
      const toks = new Map();
      for (const t of b.titles) for (const tok of tokens(t)) toks.set(tok, (toks.get(tok) || 0) + 1);
      const best = topKey(toks);
      if (best) skuLabel[s] = capitalize(best);
    }
  }

  // Collection list with counts
  const colCount = {};
  for (const lbl of Object.values(skuLabel)) {
    if (!lbl) continue;
    colCount[lbl] = (colCount[lbl] || 0) + 1;
  }
  const collections = Object.entries(colCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, sku_count]) => ({ name, sku_count }));

  return { skuLabel, collections };
}

/* ─── STAMP COLLECTION LABELS ON ORDERS ──────────────────────────
   Mutates orders in place, setting line_items[].​_collection so the
   rest of the retention pipeline can use a uniform field regardless
   of where the taxonomy came from. Safe to call repeatedly.
   ─────────────────────────────────────────────────────────────── */
export function applyTaxonomy(orders, skuLabel) {
  for (const o of orders) {
    for (const li of (o.line_items || [])) {
      const s = sku(li.sku);
      if (!s) continue;
      const lbl = skuLabel[s];
      if (lbl && !li._collection) li._collection = lbl;
    }
  }
  return orders;
}

function capitalize(s) {
  return s.split(/\s+/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}
