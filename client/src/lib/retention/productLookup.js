/**
 * Resolve SKU → product metadata (name, URL, image, price) using the
 * brand's persisted Shopify inventory map. The map is already pulled by
 * ShopifyOps (/api/shopify/inventory) and persisted in brandData.
 *
 * Returned record: { sku, name, url, handle, image, price, product_type,
 *                    collection, tags, stock }
 */

function shopDomainOf(brand) {
  const shop = (brand?.shopify?.shop || '').replace(/\.myshopify\.com$/, '').trim();
  return shop ? `${shop}.myshopify.com` : '';
}

export function buildProductLookup(brand, inventoryMap) {
  if (!inventoryMap) return {};
  const domain = shopDomainOf(brand);
  const lookup = {};
  for (const [sku, rec] of Object.entries(inventoryMap)) {
    if (!sku || !rec) continue;
    const handle = rec.handle || '';
    lookup[sku.toUpperCase()] = {
      sku,
      name:        rec.title || '',
      handle,
      url:         domain && handle ? `https://${domain}/products/${handle}` : '',
      image:       rec.image || '',
      price:       rec.price || 0,
      product_type: rec.productType || '',
      collection:  rec.collectionLabel || '',
      tags:        rec.tags || '',
      stock:       rec.stock || 0,
    };
  }
  return lookup;
}

/** Safe getter — returns an empty-ish record if missing. */
export function productFor(sku, lookup) {
  if (!sku) return { sku: '', name: '', url: '' };
  return lookup[String(sku).toUpperCase()] || { sku, name: '', url: '' };
}

/** Produce a human-readable "SKU (Name)" label. */
export function skuLabel(sku, lookup) {
  const p = productFor(sku, lookup);
  return p.name ? `${sku} — ${p.name}` : sku;
}

/* ─── INVENTORY GUARDRAIL ────────────────────────────────────────
   Filter out candidate SKUs that are out-of-stock or below a threshold,
   so the planner never recommends something the customer can't buy.
   If stock info is missing (threshold-unknown SKUs), we assume in-stock
   rather than blocking — erring on the side of letting the send go out.
   ─────────────────────────────────────────────────────────────── */

export function inStock(sku, lookup, threshold = 1) {
  if (!sku) return false;
  const rec = lookup?.[String(sku).toUpperCase()];
  if (!rec) return true;                 // unknown SKU → don't block
  if (rec.stock == null) return true;    // unknown stock → don't block
  return Number(rec.stock) >= threshold;
}

/** Filter a list of SKUs (or objects with `.sku`) down to in-stock only. */
export function filterInStock(skus, lookup, threshold = 1) {
  if (!skus?.length) return [];
  return skus.filter(s => inStock(typeof s === 'string' ? s : s?.sku, lookup, threshold));
}

/** Return just the set of SKUs flagged OOS (diagnostics / ops dashboard). */
export function oosSkus(lookup, threshold = 1) {
  const out = [];
  for (const [sku, rec] of Object.entries(lookup || {})) {
    if (rec?.stock != null && Number(rec.stock) < threshold) out.push({ sku, stock: Number(rec.stock) });
  }
  return out.sort((a, b) => a.stock - b.stock);
}
