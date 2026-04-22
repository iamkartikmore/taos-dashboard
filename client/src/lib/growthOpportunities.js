/**
 * Growth opportunities — on-demand fetchers + normalizers for the four
 * heavier features that need fresh API calls each time:
 *
 *   1. keywordGaps     — KeywordPlanIdea on Shopify product titles we
 *                        don't currently advertise. Returns "launch
 *                        this campaign" candidates with projected
 *                        traffic and CPC.
 *
 *   2. priceCompet     — Merchant API PriceCompetitivenessProductView.
 *                        Our price vs benchmark (what competitors
 *                        charge) per SKU.
 *
 *   3. bestSellerGap   — Merchant API BestSellersProductClusterView.
 *                        Google's best-selling items in our categories
 *                        that we don't carry.
 *
 *   4. pmaxThemes      — campaign_search_term_insight per Pmax
 *                        campaign. Shows WHAT categories Pmax is
 *                        converting on so operators can fork winning
 *                        themes into dedicated Search campaigns.
 *
 * Each normalizer takes raw API response + our local data (orders,
 * merchant feed, ad metrics) and produces a ranked action list.
 */

const U   = v => (v == null ? '' : String(v).trim().toUpperCase());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fromMicros = v => (v == null ? 0 : Number(v) / 1e6);

/* ─── 1. KEYWORD GAP ─────────────────────────────────────────────────
   Compare idea-service output against what we currently bid on. Keywords
   with volume that we don't already have a keyword or search term row
   for are launch candidates. */
export function analyzeKeywordGaps({
  ideas = [],              // from /api/google-ads/keyword-ideas
  existingKeywords = [],   // data.keywords
  existingSearchTerms = [], // data.searchTerms
  shopifyBySku = null,
  orders = [],
  minSearchVolume = 100,
} = {}) {
  if (!ideas.length) return { items: [], totals: { count: 0 } };

  // Build a set of lowercased stems we already target via keyword OR have
  // seen as a search term (so we don't re-surface known queries).
  const knownStems = new Set();
  for (const k of existingKeywords) {
    if (k.keyword) knownStems.add(k.keyword.toLowerCase());
  }
  for (const s of existingSearchTerms) {
    if (s.searchTerm) knownStems.add(s.searchTerm.toLowerCase());
  }

  // Title-substring map so we can link ideas back to the Shopify SKU that
  // "matched" them — this converts the idea into a concrete campaign
  // recommendation ("launch for SKU X").
  const skuByTitleWord = new Map(); // lowercase word → [{sku, title, revenue, units}]
  if (shopifyBySku) {
    for (const [sku, shop] of shopifyBySku.entries()) {
      const title = (shop.name || '').toLowerCase();
      for (const word of title.split(/\s+/).filter(w => w.length > 3)) {
        const arr = skuByTitleWord.get(word) || [];
        arr.push({ sku, title: shop.name, revenue: shop.revenue, units: shop.units });
        skuByTitleWord.set(word, arr);
      }
    }
  }

  const candidates = ideas
    .filter(i => i.avgMonthlySearches >= minSearchVolume)
    .filter(i => !knownStems.has(i.keyword.toLowerCase()))
    .map(i => {
      // Which of our SKUs plausibly matches this keyword?
      const kwWords = i.keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matches = new Map();
      for (const w of kwWords) {
        for (const match of (skuByTitleWord.get(w) || [])) {
          if (!matches.has(match.sku) || matches.get(match.sku).revenue < match.revenue) {
            matches.set(match.sku, match);
          }
        }
      }
      const topMatch = [...matches.values()].sort((a, b) => b.revenue - a.revenue)[0] || null;

      // Estimate monthly conversions at a 2% CTR × 2% CVR baseline
      const estClicks      = i.avgMonthlySearches * 0.02;
      const estConversions = estClicks * 0.02;
      const estMonthlyCost = estClicks * (i.highCpc > 0 ? i.highCpc : 20);

      return {
        keyword:            i.keyword,
        avgMonthlySearches: i.avgMonthlySearches,
        competition:        i.competition,
        lowCpc:             i.lowCpc,
        highCpc:            i.highCpc,
        matchedSku:         topMatch?.sku || null,
        matchedTitle:       topMatch?.title || null,
        matchedRevenue:     topMatch?.revenue || 0,
        estMonthlyCost,
        estConversions,
        action: topMatch
          ? `Launch Search campaign for "${topMatch.title}" targeting this keyword (${i.avgMonthlySearches}/mo searches, CPC ₹${i.lowCpc?.toFixed(0)}–${i.highCpc?.toFixed(0)}).`
          : `Untargeted demand (${i.avgMonthlySearches}/mo searches) — consider a responsive ad or asset group.`,
      };
    })
    .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);

  return {
    items: candidates,
    totals: {
      count:              candidates.length,
      totalVolume:        candidates.reduce((a, c) => a + c.avgMonthlySearches, 0),
      matchedToSkus:      candidates.filter(c => c.matchedSku).length,
      totalEstMonthlyCost: candidates.reduce((a, c) => a + c.estMonthlyCost, 0),
    },
  };
}

/* ─── 2. PRICE COMPETITIVENESS ───────────────────────────────────────
   Join our feed's price against the Merchant API's benchmark (the
   median price other sellers of the same product charge). Flag where
   we're >10% over benchmark = likely losing clicks on price. */
export function analyzePriceCompetitiveness({
  rows = [],              // from /api/google-merchant/reports?report=price_competitiveness
  adBySku = null,         // for volume-weighted prioritization
  shopifyBySku = null,
} = {}) {
  if (!rows?.length) return { items: [], totals: { count: 0 } };

  const items = rows.map(r => {
    const view = r.priceCompetitivenessProductView || r;
    const offerId = view.offerId || '';
    const sku     = U(offerId);
    const ourPrice = fromMicros(view.price?.amountMicros);
    const benchmark = fromMicros(view.benchmarkPrice?.amountMicros);
    const delta    = ourPrice - benchmark;
    const deltaPct = benchmark > 0 ? delta / benchmark : 0;

    const ad   = adBySku?.get(sku) || null;
    const shop = shopifyBySku?.get(sku) || null;

    let verdict = 'ok';
    let action  = null;
    if (deltaPct > 0.15) {
      verdict = 'overpriced';
      action = `You're ${(deltaPct * 100).toFixed(0)}% above market (benchmark ₹${benchmark.toFixed(0)}). Drop price to match — expect more clicks on Shopping.`;
    } else if (deltaPct > 0.08) {
      verdict = 'slightly_high';
      action = `Mildly above market (+${(deltaPct * 100).toFixed(0)}%). Consider a ₹${Math.round(delta * 0.5)} reduction if margin allows.`;
    } else if (deltaPct < -0.15) {
      verdict = 'underpriced';
      action = `You're ${Math.abs(deltaPct * 100).toFixed(0)}% below market. Raise price to ₹${Math.round(benchmark * 0.95)} — free margin without losing clicks.`;
    }

    return {
      sku, offerId,
      title: view.title || '',
      brand: view.brand || '',
      category: view.reportCategoryId || '',
      country: view.reportCountryCode || '',
      ourPrice, benchmark, delta, deltaPct,
      verdict, action,
      // Volume attached for prioritization
      adSpend:  ad?.cost || 0,
      adRev:    ad?.conversionsValue || 0,
      shopRev:  shop?.revenue || 0,
      affectedRev: (ad?.cost || 0) + (shop?.revenue || 0),
    };
  })
  .filter(r => r.benchmark > 0 && r.action)
  .sort((a, b) => b.affectedRev - a.affectedRev);

  const overpriced = items.filter(r => r.verdict === 'overpriced' || r.verdict === 'slightly_high');
  const underpriced = items.filter(r => r.verdict === 'underpriced');

  return {
    items,
    overpriced, underpriced,
    totals: {
      count:       items.length,
      overpricedCount:  overpriced.length,
      underpricedCount: underpriced.length,
      potentialSavingsOrUplift: overpriced.reduce((a, r) => a + r.affectedRev * 0.1, 0),
    },
  };
}

/* ─── 3. BEST SELLERS GAP ────────────────────────────────────────────
   Merchant API returns Google's top-selling products in our categories.
   Anything we don't carry (by brand or title substring) is a sourcing /
   catalog-expansion lead. */
export function analyzeBestSellerGap({
  rows = [],              // from /api/google-merchant/reports?report=best_sellers_products
  merchantBySku = null,
  orders = [],
} = {}) {
  if (!rows?.length) return { items: [], totals: { count: 0 } };

  // Index what we currently sell by title + brand for substring matching
  const ourTitles = new Set();
  const ourBrands = new Set();
  if (merchantBySku) {
    for (const [, feed] of merchantBySku.entries()) {
      const t = (feed.title || '').toLowerCase();
      if (t) ourTitles.add(t);
      if (feed.brand) ourBrands.add(feed.brand.toLowerCase());
    }
  }

  const items = rows.map(r => {
    const view = r.bestSellersProductClusterView || r.bestSellersBrandView || r;
    const title = view.title || '';
    const brand = view.brand || '';
    const rank  = Number(view.rank) || 0;
    const prevRank = Number(view.previousRank) || 0;
    const relativeDemand = view.relativeDemand || '';

    const titleLc = title.toLowerCase();
    const haveIt = [...ourTitles].some(t => t.includes(titleLc) || titleLc.includes(t));
    const haveBrand = brand && ourBrands.has(brand.toLowerCase());

    const status = haveIt ? 'carried'
                 : haveBrand ? 'brand_only'
                 : 'missing';

    return {
      rank, prevRank,
      title, brand,
      category: view.categoryL1 || view.reportCategoryId || '',
      subCategory: view.categoryL2 || '',
      relativeDemand,
      momentum: prevRank && rank ? prevRank - rank : 0, // positive = moving up
      status,
      carried: haveIt,
      action: haveIt
        ? null
        : haveBrand
          ? `You carry the brand ${brand} but not this specific product — consider adding this variant to your catalog.`
          : `Best-seller on Google in ${view.categoryL1 || 'your category'} — not in your catalog. Investigate sourcing.`,
    };
  })
  .filter(r => r.status !== 'carried' || r.momentum !== 0) // keep moving-up carried items too
  .sort((a, b) => a.rank - b.rank);

  const missing = items.filter(r => r.status === 'missing');
  const brandOnly = items.filter(r => r.status === 'brand_only');

  return {
    items,
    missing, brandOnly,
    totals: {
      count: items.length,
      missingCount: missing.length,
      brandOnlyCount: brandOnly.length,
    },
  };
}

/* ─── 4. PMAX SEARCH THEMES ──────────────────────────────────────────
   campaign_search_term_insight emits intent-grouped categories. For
   each Pmax campaign we pull its top categories by conversions; the
   high-ROAS ones are fork candidates into Search campaigns (where the
   operator has more control). */
export function analyzePmaxThemes({
  rows = [],
  campaignsById = null,
} = {}) {
  if (!rows?.length) return { items: [], totals: { count: 0 } };

  // rows look like: { campaign: { id, name }, campaignSearchTermInsight: { categoryLabel, id }, metrics: {...} }
  const normalized = rows.map(r => {
    const m = r.metrics || {};
    const ins = r.campaignSearchTermInsight || {};
    const campaignId = r.campaign?.id;
    const campaignName = r.campaign?.name || (campaignsById?.get(String(campaignId))?.name) || '';
    const clicks = num(m.clicks);
    const impressions = num(m.impressions);
    const cost = 0; // campaign_search_term_insight doesn't return cost directly
    const conversions = num(m.conversions);
    const conversionValue = num(m.conversionsValue);
    return {
      campaignId, campaignName,
      categoryLabel: ins.categoryLabel || '',
      insightId: ins.id || '',
      impressions, clicks, conversions, conversionValue,
      ctr: impressions > 0 ? clicks / impressions : 0,
    };
  }).filter(r => r.categoryLabel && r.conversions > 0);

  // Top categories globally by conversionValue
  const global = [...normalized].sort((a, b) => b.conversionValue - a.conversionValue);

  // Per-campaign top 10 categories
  const byCampaign = new Map();
  for (const row of normalized) {
    if (!row.campaignId) continue;
    const arr = byCampaign.get(row.campaignId) || [];
    arr.push(row);
    byCampaign.set(row.campaignId, arr);
  }
  for (const arr of byCampaign.values()) {
    arr.sort((a, b) => b.conversionValue - a.conversionValue);
    arr.splice(10); // cap
  }

  // Fork candidates: category with ≥5 conversions and conversion value > ₹5000
  const forkCandidates = normalized
    .filter(r => r.conversions >= 5 && r.conversionValue >= 5000)
    .sort((a, b) => b.conversionValue - a.conversionValue)
    .slice(0, 30)
    .map(r => ({
      ...r,
      action: `Fork "${r.categoryLabel}" into a dedicated Search campaign — ${Math.round(r.conversions)} conversions / ₹${Math.round(r.conversionValue).toLocaleString('en-IN')} value inside ${r.campaignName}. Search gives you exact keyword control.`,
    }));

  return {
    items: global.slice(0, 200),
    byCampaign: [...byCampaign.entries()].map(([cid, arr]) => ({
      campaignId: cid,
      campaignName: arr[0]?.campaignName || '',
      topCategories: arr,
    })),
    forkCandidates,
    totals: {
      count: normalized.length,
      forkCount: forkCandidates.length,
    },
  };
}
