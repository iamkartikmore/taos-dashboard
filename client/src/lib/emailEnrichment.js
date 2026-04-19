/**
 * Picks products + collection for an email template by RFM segment.
 *
 * Signals used (all from data already in the store):
 *   - shopifyOrders → velocity (30d), recent hits (14d), customer's own history
 *   - inventoryMap  → in-stock only, handle, image, price, collections
 *   - segmentKey    → weights the selection (e.g. New → bestsellers, Dormant → what's new)
 *
 * Nothing here talks to Shopify directly — it's pure composition over what Setup pulled.
 */

const DAY = 86400000;

function fallbackImage(shopUrl, handle) {
  // Shopify product pages render an OG image; as a safe inline fallback, null and let the
  // template render a neutral placeholder. Real image arrives from inventoryMap.image.
  return null;
}

function productUrl(shopUrl, handle) {
  if (!shopUrl || !handle) return shopUrl || '#';
  return `${shopUrl.replace(/\/$/, '')}/products/${handle}`;
}

function collectionUrl(shopUrl, handle) {
  if (!shopUrl || !handle) return shopUrl || '#';
  return `${shopUrl.replace(/\/$/, '')}/collections/${handle}`;
}

/**
 * SKU → { velocity30d, velocity14d, totalUnits30d, lastOrderedAt } velocity map.
 */
function buildVelocity(orders) {
  const now = Date.now();
  const map = {};
  (orders || []).forEach(o => {
    if (!o.created_at || o.cancelled_at) return;
    const t = new Date(o.created_at).getTime();
    const ageDays = (now - t) / DAY;
    if (ageDays > 30) return;
    (o.line_items || []).forEach(it => {
      const sku = (it.sku || '').trim().toUpperCase();
      if (!sku) return;
      if (!map[sku]) map[sku] = { velocity30d: 0, velocity14d: 0, totalUnits30d: 0, lastOrderedAt: 0 };
      const qty = Number(it.quantity || 1);
      map[sku].totalUnits30d += qty;
      map[sku].velocity30d   += qty / 30;
      if (ageDays <= 14) map[sku].velocity14d += qty / 14;
      if (t > map[sku].lastOrderedAt) map[sku].lastOrderedAt = t;
    });
  });
  return map;
}

/**
 * Build product candidates from inventoryMap, enriched with velocity + trend.
 */
function buildCandidates(inventoryMap, velocity, shopUrl) {
  return Object.entries(inventoryMap || {})
    .filter(([, inv]) => inv && (inv.stock ?? inv._totalStock ?? 0) > 0 && inv.title)
    .map(([sku, inv]) => {
      const v = velocity[sku] || { velocity30d: 0, velocity14d: 0, totalUnits30d: 0, lastOrderedAt: 0 };
      const trend = v.velocity30d > 0 ? (v.velocity14d - v.velocity30d) / v.velocity30d : 0;
      return {
        sku,
        title: inv.title,
        handle: inv.handle || '',
        price: Number(inv.price || 0),
        image: inv.image || fallbackImage(shopUrl, inv.handle),
        url: productUrl(shopUrl, inv.handle),
        collections: inv.collections || [],
        velocity30d: v.velocity30d,
        velocity14d: v.velocity14d,
        totalUnits30d: v.totalUnits30d,
        lastOrderedAt: v.lastOrderedAt,
        trend, // positive = accelerating
      };
    })
    .filter(c => c.handle); // need handle to build a link
}

/**
 * Pick a primary collection relevant to the segment, from inventoryMap collections list.
 */
function pickCollection(segmentKey, inventoryCollections, shopUrl) {
  if (!inventoryCollections?.length) return null;
  // Priority: a 'new' or 'bestseller' collection if one exists, else the first listed
  const lower = s => (s || '').toLowerCase();
  const match = (needles) => inventoryCollections.find(c =>
    needles.some(n => lower(c.title).includes(n) || lower(c.handle).includes(n)));

  const preferred =
    segmentKey === 'New'              ? match(['bestseller', 'popular', 'starter', 'new-customer'])
    : segmentKey === 'Dormant'        ? match(['new', 'latest', 'arriv'])
    : segmentKey === 'Potential Loyal'? match(['bundle', 'combo', 'set'])
    : segmentKey === 'Champions'      ? match(['premium', 'vip', 'exclusive', 'rare'])
    : null;

  const c = preferred || inventoryCollections[0];
  if (!c) return null;
  return {
    title: c.title,
    handle: c.handle,
    url: collectionUrl(shopUrl, c.handle),
  };
}

/**
 * Top-level: pick 4 products tailored to the segment.
 */
export function pickProductsForSegment({ segmentKey, orders, inventoryMap, shopUrl }) {
  const velocity = buildVelocity(orders);
  const candidates = buildCandidates(inventoryMap, velocity, shopUrl);
  if (!candidates.length) return [];

  let scorer;
  switch (segmentKey) {
    // New customers → pure bestsellers
    case 'New':
      scorer = c => c.totalUnits30d;
      break;

    // Dormant → brand-new (low history) + high in-stock
    case 'Dormant':
      scorer = c => (c.velocity14d > 0 ? c.velocity14d : 0) * 2 + (c.totalUnits30d < 5 ? 5 : 0);
      break;

    // Champions & Loyal → trending (high trend + steady volume)
    case 'Champions':
    case 'Loyal':
      scorer = c => c.velocity14d * 2 + Math.max(0, c.trend) * 3;
      break;

    // At Risk, Can't Lose → bestsellers (known winners)
    case 'At Risk':
    case "Can't Lose":
      scorer = c => c.totalUnits30d + Math.max(0, c.trend);
      break;

    // Potential Loyal, Promising → blend of accelerating + volume
    case 'Potential Loyal':
    case 'Promising':
    default:
      scorer = c => c.velocity14d * 1.5 + c.totalUnits30d * 0.5;
  }

  return candidates
    .map(c => ({ ...c, _score: scorer(c) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 4);
}

/**
 * Full enrichment context for renderTemplate().
 */
export function buildEnrichmentCtx({
  segmentKey,
  brand,
  shopifyOrders,
  inventoryMap,
  inventoryCollections,
  couponCode = null,
}) {
  const shopUrl = brand?.shopify?.shop
    ? `https://${brand.shopify.shop.replace(/^https?:\/\//, '').replace(/\.myshopify\.com$/, '')}.myshopify.com`
    : (brand?.listmonk?.shopUrl || '');

  const products = pickProductsForSegment({ segmentKey, orders: shopifyOrders, inventoryMap, shopUrl });
  const collection = pickCollection(segmentKey, inventoryCollections, shopUrl);

  return {
    brand: {
      name: brand?.name || 'Your Shop',
      shopUrl,
      fromEmail: brand?.listmonk?.fromEmail || '',
    },
    segment: { key: segmentKey },
    products,
    collection,
    couponCode,
  };
}
