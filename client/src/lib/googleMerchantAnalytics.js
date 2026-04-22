/**
 * Google Merchant Center normalization.
 *
 * The Content API returns two parallel collections:
 *
 *   products[]         — the feed: what you uploaded (title, price, image,
 *                        availability, productType, GTIN, condition).
 *   productStatuses[]  — what Google *did* with the feed: approval,
 *                        per-destination status, and an itemLevelIssues
 *                        array that is the single most useful field in
 *                        the entire API.
 *
 * We pre-join them by product id, flatten the noisy API shape, and surface
 * a compact per-product record the rest of the app can query cheaply.
 */

const normStr = v => (v == null ? '' : String(v).trim());
const normSku = v => normStr(v).toUpperCase();

/* The product.id is like "online:en:IN:SKU123"; offerId is the raw SKU. */
function splitProductId(id = '') {
  const parts = String(id).split(':');
  return {
    channel:  parts[0] || '',
    language: parts[1] || '',
    country:  parts[2] || '',
    offerId:  parts.slice(3).join(':') || '',
  };
}

/* ─── PRODUCT FEED ───────────────────────────────────────────────── */
export function normalizeProducts(raw = []) {
  return raw.map(p => {
    const { channel, language, country, offerId } = splitProductId(p.id);
    const price = parseFloat(p.price?.value || 0);
    const salePrice = parseFloat(p.salePrice?.value || 0);
    const title = normStr(p.title);
    return {
      productId:   p.id,
      offerId:     offerId || p.offerId || '',
      channel, language, country,
      sku:         normSku(offerId || p.offerId),
      title,
      description: normStr(p.description),
      link:        normStr(p.link),
      mobileLink:  normStr(p.mobileLink),
      imageLink:   normStr(p.imageLink),
      additionalImages: p.additionalImageLinks || [],
      brand:       normStr(p.brand),
      gtin:        normStr(p.gtin),
      mpn:         normStr(p.mpn),
      condition:   normStr(p.condition),
      availability: normStr(p.availability),    // 'in stock' | 'out of stock' | 'preorder'
      price,
      salePrice:   salePrice || null,
      currency:    p.price?.currency || 'INR',
      productType:        p.productTypes?.[0] || '',
      googleCategory:     normStr(p.googleProductCategory),
      customLabels: [0, 1, 2, 3, 4].map(i => normStr(p[`customLabel${i}`])),
      ageGroup:    normStr(p.ageGroup),
      gender:      normStr(p.gender),
      material:    normStr(p.material),
      color:       normStr(p.color),
      size:        normStr(p.sizes?.[0]),
      shipping:    p.shipping || [],
      inclusions:  p.includedDestinations || [],
      exclusions:  p.excludedDestinations || [],
      updatedAt:   normStr(p.contentLanguage), // no explicit updatedAt in the feed body
    };
  });
}

/* ─── PRODUCT STATUSES ──────────────────────────────────────────────
   The status blob is deeply nested. We collapse to:
     { offerId, approvedFor: string[], disapprovedFor: string[],
       pendingFor: string[], itemIssues: [{code, severity, description,
       applicableDestinations, ...}] }                                 */
export function normalizeStatuses(raw = []) {
  return raw.map(s => {
    const { offerId } = splitProductId(s.productId);
    const sku = normSku(offerId || s.productId);
    const destStatuses = s.destinationStatuses || [];
    const approvedFor     = destStatuses.filter(d => d.status === 'approved').map(d => d.destination);
    const disapprovedFor  = destStatuses.filter(d => d.status === 'disapproved').map(d => d.destination);
    const pendingFor      = destStatuses.filter(d => d.status === 'pending').map(d => d.destination);
    const itemIssues      = (s.itemLevelIssues || []).map(i => ({
      code:         i.code,
      servability:  i.servability,        // 'unaffected' | 'disapproved' | 'demoted'
      resolution:   i.resolution,         // 'merchant_action' | 'pending_processing'
      attribute:    i.attributeName,
      destination:  i.destination,
      description:  i.description,
      detail:       i.detail,
      documentation:i.documentation,
      applicable:   i.applicableCountries || [],
    }));

    const primaryStatus =
      disapprovedFor.length ? 'disapproved'
      : pendingFor.length   ? 'pending'
      : approvedFor.length  ? 'approved'
      : 'unknown';

    const demoted = itemIssues.some(i => i.servability === 'demoted');
    const disapproved = itemIssues.some(i => i.servability === 'disapproved');

    return {
      productId: s.productId,
      offerId,
      sku,
      primaryStatus,
      approvedFor, disapprovedFor, pendingFor,
      itemIssues,
      hasIssues: itemIssues.length > 0,
      demoted, disapproved,
      lastUpdated: s.lastUpdateDate,
      creationDate: s.creationDate,
      googleExpirationDate: s.googleExpirationDate,
    };
  });
}

/* ─── JOINED VIEW ────────────────────────────────────────────────────
   Inner-joins products to statuses by productId. Also builds two lookup
   maps so downstream blends can key by SKU or productId directly. */
export function joinFeed({ products = [], statuses = [] }) {
  const byProductId = new Map();
  for (const p of products) byProductId.set(p.productId, { ...p });
  for (const s of statuses) {
    const existing = byProductId.get(s.productId) || { productId: s.productId, sku: s.sku, offerId: s.offerId };
    byProductId.set(s.productId, { ...existing, status: s });
  }
  const joined = [...byProductId.values()];

  const bySku = new Map();       // key: uppercase SKU
  for (const r of joined) {
    if (!r.sku) continue;
    const existing = bySku.get(r.sku);
    if (!existing) { bySku.set(r.sku, r); continue; }
    // Multiple country/language entries per SKU — prefer the one with a
    // disapproval (most actionable) else the first.
    if (r.status?.disapproved && !existing.status?.disapproved) bySku.set(r.sku, r);
  }

  return { joined, byProductId, bySku };
}

/* ─── ROLLUPS ───────────────────────────────────────────────────── */
export function feedSummary(joined = []) {
  const total = joined.length;
  const approved    = joined.filter(r => r.status?.primaryStatus === 'approved').length;
  const disapproved = joined.filter(r => r.status?.primaryStatus === 'disapproved').length;
  const pending     = joined.filter(r => r.status?.primaryStatus === 'pending').length;
  const unknown     = total - approved - disapproved - pending;
  const demoted     = joined.filter(r => r.status?.demoted).length;
  const oos         = joined.filter(r => r.availability === 'out of stock').length;

  // Group issues by code so the operator sees what to fix first.
  const byIssue = new Map();
  for (const r of joined) {
    for (const i of r.status?.itemIssues || []) {
      const key = i.code;
      const cur = byIssue.get(key) || { code: i.code, description: i.description, servability: i.servability, attribute: i.attribute, count: 0, exampleSku: r.sku };
      cur.count++;
      byIssue.set(key, cur);
    }
  }
  const topIssues = [...byIssue.values()].sort((a, b) => b.count - a.count);

  // Google product category rollup — useful for campaign × category blend.
  const byCategory = new Map();
  for (const r of joined) {
    const cat = r.productType || r.googleCategory || 'Uncategorized';
    const cur = byCategory.get(cat) || { category: cat, count: 0, approved: 0, disapproved: 0, oos: 0 };
    cur.count++;
    if (r.status?.primaryStatus === 'approved') cur.approved++;
    if (r.status?.primaryStatus === 'disapproved') cur.disapproved++;
    if (r.availability === 'out of stock') cur.oos++;
    byCategory.set(cat, cur);
  }
  const categories = [...byCategory.values()].sort((a, b) => b.count - a.count);

  return {
    total, approved, disapproved, pending, unknown, demoted, oos,
    approvalRate: total ? approved / total : 0,
    topIssues, categories,
  };
}

/* ─── PUBLIC: normalize the raw server response in one call ─────── */
export function normalizeMerchantResponse(raw = {}) {
  const products = normalizeProducts(raw.products || []);
  const statuses = normalizeStatuses(raw.productStatuses || []);
  const { joined, byProductId, bySku } = joinFeed({ products, statuses });
  return {
    products, statuses, joined, byProductId, bySku,
    summary: feedSummary(joined),
    fetchedAt: Date.now(),
  };
}
