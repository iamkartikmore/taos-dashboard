/**
 * Email segmentation engine — computes the 8 dimensions every modern
 * D2C email program should cut its list on:
 *   1. engagement  (Hot / Warm / Cool / Cold)
 *   2. recency     (0-30d / 31-90d / 91-180d / 180+)
 *   3. frequency   (1x / 2-3x / 4-9x / 10+)
 *   4. category affinity  (dominant product category bucket)
 *   5. AOV tier    (Low / Mid / High / Premium)
 *   6. LTV tier    (Low / Mid / High / VIP, via BG-NBD in advancedStats)
 *   7. acquisition channel (Meta / Google / Organic / Referral / Direct)
 *   8. geography   (Metro / Tier-2 / Tier-3 / International)
 *
 * Every subscriber gets a tagged record; downstream list builders
 * filter by any combination to produce the highly-targeted segments
 * top brands use (e.g. "Hot + Plants + Metro + Mid-AOV = 4k subs").
 *
 * Runs entirely client-side on data already in the store. Zero extra
 * API calls to Shopify.
 */

import { bgNbdMomentFit, bgNbdPredict, gammaGammaPredict } from './advancedStats';

const DAY_MS = 86_400_000;
const nowMs  = () => Date.now();
const num    = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ══════════════════════════════════════════════════════════════
   CATEGORY AFFINITY — buckets product titles into brand-relevant
   categories. Tuned for Dawbu + TAOS product mix (plants, seeds,
   succulents, building blocks, diamond painting, 3D puzzles, etc).
   Override CATEGORY_RULES if you rebrand or expand.
   ══════════════════════════════════════════════════════════ */

const CATEGORY_RULES = [
  { key: 'building_blocks', label: 'Building Blocks', patterns: [/\b(block|lego|brick|mini\s*shop|mini\s*store)\b/i] },
  { key: 'diamond_art',     label: 'Diamond Painting', patterns: [/\bdiamond|painting\b/i] },
  { key: '3d_puzzle',       label: '3D Puzzle',        patterns: [/\b3d\s*puzzle|puzzle\b/i] },
  { key: 'plants',          label: 'Plants',           patterns: [/\b(plant|flower|orchid|monstera|money\s*tree)\b/i] },
  { key: 'seeds',           label: 'Seeds',            patterns: [/\b(seed|germinat|grow\s*kit)\b/i] },
  { key: 'succulent',       label: 'Succulents',       patterns: [/\bsucculent|cact/i] },
  { key: 'miniature',       label: 'Miniature',        patterns: [/\bmini(ature)?\b/i] },
  { key: 'stationery',      label: 'Stationery',       patterns: [/\b(notebook|diary|pen|sticker|journal)\b/i] },
  { key: 'decor',           label: 'Home Decor',       patterns: [/\b(decor|vase|planter|candle|frame)\b/i] },
];

function categoryOf(title = '') {
  const t = String(title).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(p => p.test(t))) return { key: rule.key, label: rule.label };
  }
  return { key: 'other', label: 'Other' };
}

/* ══════════════════════════════════════════════════════════════
   ENGAGEMENT TIERS — computed from Listmonk open history.
   When no Listmonk data yet, we fall back to Shopify order recency
   as a proxy so segmentation still works on day 0.
   ══════════════════════════════════════════════════════════ */

export function engagementTier({ lastOpenAt, lastClickAt, lastOrderAt }) {
  const anchor = Math.max(
    lastOpenAt  ? new Date(lastOpenAt ).getTime() : 0,
    lastClickAt ? new Date(lastClickAt).getTime() : 0,
    lastOrderAt ? new Date(lastOrderAt).getTime() : 0,
  );
  if (!anchor) return { key: 'cold', label: 'Cold' };
  const daysAgo = (nowMs() - anchor) / DAY_MS;
  if (daysAgo <= 30)  return { key: 'hot',  label: 'Hot' };
  if (daysAgo <= 60)  return { key: 'warm', label: 'Warm' };
  if (daysAgo <= 90)  return { key: 'cool', label: 'Cool' };
  return { key: 'cold', label: 'Cold' };
}

export function recencyTier(lastOrderAt) {
  if (!lastOrderAt) return { key: 'never', label: 'Never ordered' };
  const daysAgo = (nowMs() - new Date(lastOrderAt).getTime()) / DAY_MS;
  if (daysAgo <= 30)  return { key: '0_30',    label: '0–30 days' };
  if (daysAgo <= 90)  return { key: '31_90',   label: '31–90 days' };
  if (daysAgo <= 180) return { key: '91_180',  label: '91–180 days' };
  return { key: '180_plus', label: '180+ days' };
}

export function frequencyTier(orderCount) {
  const n = num(orderCount);
  if (n >= 10) return { key: 'whale',  label: '10+ orders' };
  if (n >= 4)  return { key: 'loyal',  label: '4–9 orders' };
  if (n >= 2)  return { key: 'repeat', label: '2–3 orders' };
  if (n === 1) return { key: 'first',  label: '1 order' };
  return { key: 'none', label: 'No orders' };
}

export function aovTier(aov) {
  const v = num(aov);
  if (v >= 2500) return { key: 'premium', label: 'Premium (≥₹2.5k)' };
  if (v >= 1500) return { key: 'high',    label: 'High (₹1.5k–2.5k)' };
  if (v >= 500)  return { key: 'mid',     label: 'Mid (₹500–1.5k)' };
  if (v > 0)     return { key: 'low',     label: 'Low (<₹500)' };
  return { key: 'none', label: 'None' };
}

/* ══════════════════════════════════════════════════════════════
   ACQUISITION CHANNEL — best-effort from UTM/referrer in order notes
   Shopify order landing_site_ref / referring_site / note_attributes.
   ══════════════════════════════════════════════════════════ */

export function acquisitionChannel(order = {}) {
  const src = String(
    order.landing_site_ref ||
    order.referring_site   ||
    order.source_name      ||
    (Array.isArray(order.note_attributes)
      ? (order.note_attributes.find(n => /utm_source/i.test(n.name))?.value || '')
      : ''),
  ).toLowerCase();
  if (/meta|facebook|instagram|fb/.test(src)) return { key: 'meta',     label: 'Meta' };
  if (/google|adwords|gads/.test(src))        return { key: 'google',   label: 'Google' };
  if (/referral|ref/.test(src))               return { key: 'referral', label: 'Referral' };
  if (/organic|direct|bio|link/.test(src))    return { key: 'organic',  label: 'Organic' };
  if (src && src !== 'web')                   return { key: 'other',    label: src.slice(0, 20) };
  return { key: 'direct', label: 'Direct' };
}

/* ══════════════════════════════════════════════════════════════
   GEOGRAPHY — Metro / Tier-2 / Tier-3 for India, International
   ══════════════════════════════════════════════════════════ */

const METRO_CITIES = new Set([
  'mumbai','bangalore','bengaluru','delhi','new delhi','hyderabad','chennai','kolkata',
  'ahmedabad','pune','gurgaon','gurugram','noida','navi mumbai','thane',
]);
const TIER_2_CITIES = new Set([
  'surat','jaipur','lucknow','kanpur','nagpur','indore','bhopal','coimbatore','patna',
  'vadodara','ludhiana','agra','nashik','faridabad','meerut','rajkot','vizag','visakhapatnam',
  'srinagar','aurangabad','dhanbad','amritsar','jabalpur','allahabad','prayagraj',
  'ranchi','howrah','gwalior','jodhpur','raipur','kota','chandigarh','guwahati','mysore','mysuru',
  'navi mumbai','kochi','ernakulam','thiruvananthapuram','trivandrum',
]);

export function geoTier(address = {}) {
  const country = String(address.country_code || address.country || '').toUpperCase();
  if (country && country !== 'IN' && country !== 'INDIA') return { key: 'intl', label: 'International' };
  const city = String(address.city || '').toLowerCase().trim();
  if (METRO_CITIES.has(city))  return { key: 'metro',  label: 'Metro' };
  if (TIER_2_CITIES.has(city)) return { key: 'tier2', label: 'Tier-2' };
  if (city) return { key: 'tier3', label: 'Tier-3' };
  return { key: 'unknown', label: 'Unknown' };
}

/* ══════════════════════════════════════════════════════════════
   BUILD SUBSCRIBERS — per customer, attach all 8 dimensions.
   Input: Shopify orders (from store.shopifyOrders), optional
   Listmonk engagement map { email → { lastOpenAt, lastClickAt } }.
   ══════════════════════════════════════════════════════════ */

export function buildSubscribers(orders = [], engagementMap = {}) {
  // Group orders by customer email
  const byEmail = new Map();
  for (const o of orders || []) {
    if (o.cancelled_at) continue;
    const email = String(o.email || o.customer?.email || '').trim().toLowerCase();
    if (!email) continue;
    let rec = byEmail.get(email);
    if (!rec) {
      rec = {
        email,
        customerId: String(o.customer?.id || ''),
        firstName:  o.customer?.first_name || o.shipping_address?.first_name || '',
        lastName:   o.customer?.last_name  || o.shipping_address?.last_name  || '',
        phone:      String(o.customer?.phone || o.phone || ''),
        orders: [],
        categoryHits: {},
        totalSpent: 0,
        firstOrderAt: null,
        lastOrderAt: null,
        lastAddress: null,
        firstChannel: null,
      };
      byEmail.set(email, rec);
    }
    rec.orders.push(o);
    const total = num(o.total_price || o.current_total_price || 0);
    rec.totalSpent += total;
    const createdMs = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (createdMs && (!rec.firstOrderAt || createdMs < new Date(rec.firstOrderAt).getTime())) {
      rec.firstOrderAt = o.created_at;
      rec.firstChannel = acquisitionChannel(o);
    }
    if (createdMs && (!rec.lastOrderAt || createdMs > new Date(rec.lastOrderAt).getTime())) {
      rec.lastOrderAt = o.created_at;
      rec.lastAddress = o.shipping_address || o.billing_address || null;
    }
    // Category tally
    for (const li of (o.line_items || [])) {
      const cat = categoryOf(li.title || li.name || '');
      rec.categoryHits[cat.key] = (rec.categoryHits[cat.key] || 0) + num(li.quantity || 1);
    }
  }

  // LTV model fit across all customers (one-shot)
  const customersForFit = [...byEmail.values()]
    .map(r => {
      const T = r.firstOrderAt ? Math.max(1, (nowMs() - new Date(r.firstOrderAt).getTime()) / DAY_MS) : 1;
      const t_x = r.lastOrderAt && r.firstOrderAt
        ? Math.max(0, (new Date(r.lastOrderAt).getTime() - new Date(r.firstOrderAt).getTime()) / DAY_MS)
        : 0;
      return {
        x: Math.max(0, (r.orders.length - 1)),
        T,
        t_x,
        mValue: r.orders.length ? r.totalSpent / r.orders.length : 0,
      };
    });
  const fit = bgNbdMomentFit(customersForFit);
  const popMean = customersForFit.length
    ? customersForFit.reduce((s, c) => s + c.mValue, 0) / customersForFit.length
    : 0;

  // Enrich every subscriber with dimensions + predictions
  const out = [];
  for (const rec of byEmail.values()) {
    const engagement = engagementMap[rec.email] || {};
    const topCategory = Object.entries(rec.categoryHits).sort((a, b) => b[1] - a[1])[0];
    const catKey = topCategory ? topCategory[0] : 'other';
    const categoryMeta = CATEGORY_RULES.find(r => r.key === catKey) || { key: 'other', label: 'Other' };
    const aov = rec.orders.length ? rec.totalSpent / rec.orders.length : 0;

    // LTV prediction
    let predictedLtv = 0, pAlive = null, predictedOrders90d = 0;
    if (fit) {
      const T = rec.firstOrderAt ? Math.max(1, (nowMs() - new Date(rec.firstOrderAt).getTime()) / DAY_MS) : 1;
      const t_x = rec.lastOrderAt && rec.firstOrderAt
        ? Math.max(0, (new Date(rec.lastOrderAt).getTime() - new Date(rec.firstOrderAt).getTime()) / DAY_MS)
        : 0;
      const pred = bgNbdPredict({ x: Math.max(0, rec.orders.length - 1), T, t_x }, fit, 90);
      if (pred) {
        pAlive = pred.pAlive;
        predictedOrders90d = pred.expected;
        const mv = gammaGammaPredict(
          { x: rec.orders.length, mValue: aov },
          { popMean },
        );
        predictedLtv = mv * (rec.orders.length + pred.expected * 4); // rough 1yr proj
      }
    }
    // LTV tier
    const ltvKey = predictedLtv >= 15000 ? 'vip'
                 : predictedLtv >= 5000  ? 'high'
                 : predictedLtv >= 1500  ? 'mid'
                 : 'low';

    const engagementT = engagementTier({
      lastOpenAt:  engagement.lastOpenAt,
      lastClickAt: engagement.lastClickAt,
      lastOrderAt: rec.lastOrderAt,
    });
    const recencyT   = recencyTier(rec.lastOrderAt);
    const frequencyT = frequencyTier(rec.orders.length);
    const aovT       = aovTier(aov);
    const geoT       = geoTier(rec.lastAddress || {});

    out.push({
      email: rec.email,
      customerId: rec.customerId,
      firstName: rec.firstName,
      lastName:  rec.lastName,
      phone:     rec.phone,
      orderCount: rec.orders.length,
      totalSpent: rec.totalSpent,
      aov,
      firstOrderAt: rec.firstOrderAt,
      lastOrderAt:  rec.lastOrderAt,
      city: rec.lastAddress?.city || '',
      state: rec.lastAddress?.province || rec.lastAddress?.region || '',
      // Dimensions
      engagement: engagementT,
      recency:    recencyT,
      frequency:  frequencyT,
      aovTier:    aovT,
      ltvTier:    { key: ltvKey, label: ltvKey.toUpperCase() },
      category:   { key: categoryMeta.key, label: categoryMeta.label },
      channel:    rec.firstChannel || { key: 'direct', label: 'Direct' },
      geo:        geoT,
      // Predictions
      predictedLtv,
      predictedOrders90d,
      pAlive,
      // Engagement signals
      lastOpenAt:  engagement.lastOpenAt  || null,
      lastClickAt: engagement.lastClickAt || null,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
   SEGMENT BUILDER — filter subscribers by any combination of tags
   Returns the list ready to push into Listmonk as a dedicated list.
   ══════════════════════════════════════════════════════════ */

export function filterSubscribers(subs = [], filters = {}) {
  return subs.filter(s => {
    if (filters.engagement?.length && !filters.engagement.includes(s.engagement.key)) return false;
    if (filters.recency?.length    && !filters.recency.includes(s.recency.key))       return false;
    if (filters.frequency?.length  && !filters.frequency.includes(s.frequency.key))   return false;
    if (filters.aovTier?.length    && !filters.aovTier.includes(s.aovTier.key))       return false;
    if (filters.ltvTier?.length    && !filters.ltvTier.includes(s.ltvTier.key))       return false;
    if (filters.category?.length   && !filters.category.includes(s.category.key))     return false;
    if (filters.channel?.length    && !filters.channel.includes(s.channel.key))       return false;
    if (filters.geo?.length        && !filters.geo.includes(s.geo.key))               return false;
    if (filters.minLtv  && s.predictedLtv < filters.minLtv)   return false;
    if (filters.maxLtv  && s.predictedLtv > filters.maxLtv)   return false;
    if (filters.minOrders && s.orderCount < filters.minOrders) return false;
    return true;
  });
}

/* Produce a summary breakdown of the whole list across each dimension — */
export function summariseList(subs = []) {
  const tally = (key) => {
    const counts = {};
    for (const s of subs) {
      const v = s[key]?.label || '—';
      counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  };
  return {
    total: subs.length,
    engagement: tally('engagement'),
    recency:    tally('recency'),
    frequency:  tally('frequency'),
    aovTier:    tally('aovTier'),
    ltvTier:    tally('ltvTier'),
    category:   tally('category'),
    channel:    tally('channel'),
    geo:        tally('geo'),
    totalLtv:   subs.reduce((s, x) => s + (x.predictedLtv || 0), 0),
    totalSpent: subs.reduce((s, x) => s + (x.totalSpent   || 0), 0),
  };
}

/* Pre-configured segment templates matching the 12-flow playbook. */
export const SEGMENT_TEMPLATES = [
  { id: 'hot_engaged',       name: 'Hot engaged',           filters: { engagement: ['hot'] },
    desc: 'Opened or purchased in last 30 days — ready for 3–4 emails/week' },
  { id: 'warm',              name: 'Warm',                  filters: { engagement: ['warm'] },
    desc: 'Last engagement 30–60 days — 2/week max' },
  { id: 'vip_customers',     name: 'VIP (top LTV)',         filters: { ltvTier: ['vip'], engagement: ['hot', 'warm'] },
    desc: 'Top 20% by predicted LTV — exclusive drops + early access' },
  { id: 'repeat_buyers',     name: 'Repeat buyers',         filters: { frequency: ['repeat', 'loyal', 'whale'] },
    desc: 'Purchased 2+ times — high cross-sell potential' },
  { id: 'lapsed_60_90',      name: 'Lapsed 60–90 days',     filters: { recency: ['31_90'], frequency: ['first', 'repeat', 'loyal'] },
    desc: 'Was active, going cold — win-back flow target' },
  { id: 'dormant_90_180',    name: 'Dormant 90–180',        filters: { recency: ['91_180'] },
    desc: 'Win-back last chance zone' },
  { id: 'metro_premium',     name: 'Metro + Premium',       filters: { geo: ['metro'], aovTier: ['premium', 'high'] },
    desc: 'High-value Metro buyers — premium drops, early access' },
  { id: 'plants_affinity',   name: 'Plants affinity',       filters: { category: ['plants', 'succulent', 'seeds'] },
    desc: 'Category-focused — plant care content + seasonal picks' },
  { id: 'building_blocks_aff', name: 'Building Blocks affinity', filters: { category: ['building_blocks'] },
    desc: 'Dawbu core audience for mini-store drops' },
  { id: 'first_buyers_0_30', name: 'First-time buyers 0–30d', filters: { frequency: ['first'], recency: ['0_30'] },
    desc: 'Onboard to second purchase — post-purchase flow + cross-sell' },
];
