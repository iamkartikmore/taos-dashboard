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
