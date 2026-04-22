/**
 * Opportunities engine — the "what to do next" surface for Google Ads.
 *
 * Six independent analyses, all pure joins on data we already have:
 *   1. recommendationsInbox     — Google's own recs, sanitized against our inventory
 *   2. smartNegatives           — wasteful search terms clustered by root
 *   3. dayparting               — hour×dow combos to pause/boost
 *   4. pdpCro                   — landing pages with clicks but low CVR
 *   5. hiddenScaleSkus          — Shopify winners that Google isn't scaling
 *   6. channelScorecard         — one joined row per SKU (Shopify × Google × Meta × feed)
 *
 * Each returns { items, totals } so the UI can render a KPI strip + table.
 */

const U   = v => (v == null ? '' : String(v).trim().toUpperCase());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ─── 1. RECOMMENDATIONS INBOX ───────────────────────────────────────
   Google already ranks these by impact (in its own currency). We take
   the raw list and:
     - Translate the type enum into plain English
     - Annotate keyword recs with whether the keyword matches a SKU we
       actually stock (otherwise: silent drop — don't bid on OOS terms)
     - Compute a local "value score" = recommended budget Δ × current ROAS
   ──────────────────────────────────────────────────────────────────── */
const REC_LABEL = {
  CAMPAIGN_BUDGET:                     'Raise budget',
  KEYWORD:                             'Add keyword',
  TEXT_AD:                             'Add ad copy',
  TARGET_CPA_OPT_IN:                   'Switch to Target CPA bidding',
  MAXIMIZE_CLICKS_OPT_IN:              'Switch to Maximize Clicks',
  MAXIMIZE_CONVERSIONS_OPT_IN:         'Switch to Maximize Conversions',
  MAXIMIZE_CONVERSION_VALUE_OPT_IN:    'Switch to Max Conversion Value',
  ENHANCED_CPC_OPT_IN:                 'Enable Enhanced CPC',
  SEARCH_PARTNERS_OPT_IN:              'Opt in to Search Partners',
  DISPLAY_EXPANSION_OPT_IN:            'Opt in to Display expansion',
  MOVE_UNUSED_BUDGET:                  'Move unused budget',
  FORECASTING_CAMPAIGN_BUDGET:         'Seasonal budget boost (forecast)',
  OPTIMIZE_AD_ROTATION:                'Optimize ad rotation',
  KEYWORD_MATCH_TYPE:                  'Change keyword match type',
  CALLOUT_ASSET:                       'Add callouts',
  SITELINK_ASSET:                      'Add sitelinks',
  CALL_ASSET:                          'Add call extension',
  RESPONSIVE_SEARCH_AD:                'Add responsive search ad',
  RESPONSIVE_SEARCH_AD_ASSET:          'Add responsive search ad asset',
  USE_BROAD_MATCH_KEYWORD:             'Expand to broad match',
  FORECASTING_SET_TARGET_ROAS:         'Set Target ROAS (forecast)',
  UPGRADE_SMART_SHOPPING_CAMPAIGN_TO_PERFORMANCE_MAX: 'Upgrade to Performance Max',
  PERFORMANCE_MAX_OPT_IN:              'Enable Performance Max',
  RAISE_TARGET_CPA_BID_TOO_LOW:        'Raise target CPA (too low)',
  DISPLAY_EXPANSION_OPT_OUT:           'Opt out of Display expansion',
};

export function recommendationsInbox({ recommendations = [], merchantBySku = null, campaignsById = null } = {}) {
  if (!recommendations?.length) return { items: [], totals: { count: 0, estRev: 0 } };

  const items = recommendations.map(r => {
    const campaignName = (campaignsById && r.campaignId && campaignsById.get(String(r.campaignId))?.name) || null;
    const label = REC_LABEL[r.type] || r.type.replace(/_/g, ' ').toLowerCase();

    // Keyword recs: scan against our SKU titles. If the keyword clearly
    // maps to a product that's OOS or disapproved, this rec is noise —
    // hide it. Otherwise mark it as "confirmed: product available".
    let inventoryNote = null;
    let suppressed = false;
    if (r.type === 'KEYWORD' && r.keyword && merchantBySku) {
      const kw = U(r.keyword);
      let matchedOos = null, matchedOk = null;
      for (const [, feed] of merchantBySku.entries()) {
        const title = U(feed.title);
        if (!title) continue;
        // crude substring match; good enough to filter obvious noise
        if (title.includes(kw) || kw.includes(title.split(' ')[0])) {
          if (feed.availability === 'out of stock' || feed.status?.primaryStatus === 'disapproved') {
            matchedOos = feed; break;
          } else {
            matchedOk = feed;
          }
        }
      }
      if (matchedOos) {
        suppressed = true;
        inventoryNote = `Matches OOS/disapproved SKU: ${matchedOos.title || matchedOos.sku}`;
      } else if (matchedOk) {
        inventoryNote = `Linked SKU in stock: ${matchedOk.title}`;
      }
    }

    // Render a one-line "headline" and "action" the UI can drop straight in
    let headline = label;
    let action   = null;
    if (r.type === 'CAMPAIGN_BUDGET' && r.recommendedBudget > 0) {
      const delta = r.recommendedBudget - r.currentBudget;
      headline = `Raise ${campaignName || 'campaign'} budget to ₹${Math.round(r.recommendedBudget).toLocaleString('en-IN')}/day`;
      action   = `Google estimates +${Math.round(r.upliftConversions)} conv (+${r.upliftRevenue > 0 ? '₹' + Math.round(r.upliftRevenue).toLocaleString('en-IN') : '—'} rev) for ₹${Math.round(delta).toLocaleString('en-IN')} more spend.`;
    } else if (r.type === 'KEYWORD' && r.keyword) {
      headline = `Add keyword "${r.keyword}" [${r.keywordMatchType || 'BROAD'}]`;
      action   = `Suggested CPC ₹${r.keywordRecommendedCpc?.toFixed(0) || '—'}. Est +${Math.round(r.upliftConversions)} conv/wk.${inventoryNote ? ' ' + inventoryNote : ''}`;
    } else if (r.type === 'TARGET_CPA_OPT_IN' && r.targetCpa > 0) {
      headline = `Switch ${campaignName || 'campaign'} to Target CPA at ₹${Math.round(r.targetCpa)}`;
      action   = `Projected +${Math.round(r.upliftConversions)} conv at the same spend.`;
    } else if (r.type === 'MAXIMIZE_CONVERSION_VALUE_OPT_IN' || r.type === 'MAXIMIZE_CONVERSIONS_OPT_IN') {
      headline = `${label} for ${campaignName || 'campaign'}`;
      action   = `Est. +₹${Math.round(r.upliftRevenue).toLocaleString('en-IN')} revenue uplift.`;
    } else if (r.type === 'TEXT_AD' && r.adHeadline1) {
      headline = `Add ad: "${r.adHeadline1}${r.adHeadline2 ? ' — ' + r.adHeadline2 : ''}"`;
      action   = r.adDescription || '';
    } else if (r.type.includes('ASSET')) {
      headline = `${label} on ${campaignName || 'campaign'}`;
      action   = `Assets expand where your ads show; Google estimates +${Math.round(r.upliftConversions)} conv/wk.`;
    }

    return {
      ...r,
      label, headline, action, campaignName,
      inventoryNote, suppressed,
      valueScore: Math.abs(r.upliftRevenue) + Math.abs(r.upliftConversions) * 1000,
    };
  }).filter(r => !r.suppressed);

  items.sort((a, b) => b.valueScore - a.valueScore);

  return {
    items,
    totals: {
      count: items.length,
      estRev: items.reduce((a, r) => a + (r.upliftRevenue > 0 ? r.upliftRevenue : 0), 0),
      estConv: items.reduce((a, r) => a + (r.upliftConversions > 0 ? r.upliftConversions : 0), 0),
    },
  };
}

/* ─── 2. SMART NEGATIVES ─────────────────────────────────────────────
   Search terms with money spent, zero conversions, and a repeating
   pattern ("free", "how to", brand-competitor names). We cluster by
   leading/trailing stopwords so the operator sees one negative keyword
   that blocks a family of terms instead of 200 individual rows.
   ──────────────────────────────────────────────────────────────────── */
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'and', 'or', 'is']);

function tokenize(s) {
  return U(s).split(/[^A-Z0-9]+/).filter(t => t && !STOP.has(t.toLowerCase()));
}

export function smartNegatives({ searchTerms = [], minSpend = 300, minImpressions = 100 } = {}) {
  if (!searchTerms?.length) return { items: [], totals: { count: 0, wasted: 0 } };

  // Step 1: filter to wasteful terms
  const wasteful = searchTerms.filter(t =>
    t.cost >= minSpend &&
    t.conversions === 0 &&
    t.impressions >= minImpressions
  );

  // Step 2: cluster by 1-gram root (most common word across wasteful terms)
  const byToken = new Map(); // token → { token, terms, cost, impressions, clicks }
  wasteful.forEach(t => {
    const tokens = tokenize(t.searchTerm);
    tokens.forEach(tk => {
      const existing = byToken.get(tk) || { token: tk, terms: [], cost: 0, impressions: 0, clicks: 0 };
      existing.terms.push(t);
      existing.cost        += t.cost;
      existing.impressions += t.impressions;
      existing.clicks      += t.clicks;
      byToken.set(tk, existing);
    });
  });

  // Step 3: clusters with ≥3 search terms and ≥₹1000 wasted share
  const clusters = [...byToken.values()]
    .filter(c => c.terms.length >= 3 && c.cost >= 1000)
    .map(c => ({
      root:        c.token.toLowerCase(),
      termsCount:  c.terms.length,
      cost:        c.cost,
      impressions: c.impressions,
      clicks:      c.clicks,
      cpa:         c.clicks > 0 ? c.cost / c.clicks : 0,
      examples:    c.terms.sort((a, b) => b.cost - a.cost).slice(0, 5).map(t => t.searchTerm),
      suggested:   `"${c.token.toLowerCase()}"`,
      matchType:   'PHRASE', // phrase match is the safest; they can change if they want
    }))
    .sort((a, b) => b.cost - a.cost);

  const totals = {
    count:   clusters.length,
    wasted:  clusters.reduce((a, c) => a + c.cost, 0),
    termsCovered: clusters.reduce((a, c) => a + c.termsCount, 0),
  };

  // Also: individual high-waste terms that don't cluster well
  const clusteredTermSet = new Set();
  clusters.forEach(c => c.examples.forEach(e => clusteredTermSet.add(e)));
  const unclustered = wasteful
    .filter(t => !clusteredTermSet.has(t.searchTerm) && t.cost >= 500)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20)
    .map(t => ({
      searchTerm: t.searchTerm,
      cost:       t.cost,
      impressions: t.impressions,
      clicks:     t.clicks,
      cpa:        t.clicks > 0 ? t.cost / t.clicks : 0,
      suggested:  `[${t.searchTerm}]`,
      matchType:  'EXACT',
    }));

  return { items: clusters, singles: unclustered, totals };
}

/* ─── 3. DAYPARTING / GEO PAUSE LIST ─────────────────────────────────
   Hour × day-of-week combinations where ROAS < 0.5× account median on
   volume above the impression floor. The output is a ready-to-pause
   schedule change recommendation.
   ──────────────────────────────────────────────────────────────────── */
export function dayparting({ hours = { byHour: [], byDow: [] }, minImpressions = 500 } = {}) {
  const { byHour = [], byDow = [] } = hours;
  if (!byHour.length && !byDow.length) return { items: [], totals: { count: 0 } };

  const allRoas = [...byHour, ...byDow].filter(r => r.cost > 0).map(r => r.roas);
  const median = allRoas.length ? allRoas.sort((a, b) => a - b)[Math.floor(allRoas.length / 2)] : 0;
  const threshold = median * 0.5;

  const badHours = byHour
    .filter(h => h.impressions >= minImpressions && h.roas < threshold && h.cost > 200)
    .map(h => ({
      type: 'hour',
      bucket: `${String(h.hour).padStart(2, '0')}:00`,
      cost: h.cost,
      conversions: h.conversions,
      roas: h.roas,
      impressions: h.impressions,
      action: `Pause or reduce bids during ${String(h.hour).padStart(2, '0')}:00–${String(h.hour + 1).padStart(2, '0')}:00. ROAS ${h.roas.toFixed(2)} vs account median ${median.toFixed(2)}.`,
    }))
    .sort((a, b) => b.cost - a.cost);

  const badDows = byDow
    .filter(d => d.impressions >= minImpressions && d.roas < threshold && d.cost > 500)
    .map(d => ({
      type: 'dow',
      bucket: d.day,
      cost: d.cost,
      conversions: d.conversions,
      roas: d.roas,
      impressions: d.impressions,
      action: `Consider pausing ${d.day}. ROAS ${d.roas.toFixed(2)} vs median ${median.toFixed(2)}.`,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Also: winners where we should boost bids
  const goodHours = byHour
    .filter(h => h.impressions >= minImpressions && h.roas > median * 1.5)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 3)
    .map(h => ({
      type: 'hour-winner',
      bucket: `${String(h.hour).padStart(2, '0')}:00`,
      cost: h.cost,
      roas: h.roas,
      action: `Raise bids ${String(h.hour).padStart(2, '0')}:00–${String(h.hour + 1).padStart(2, '0')}:00 (ROAS ${h.roas.toFixed(2)} — ${((h.roas / median - 1) * 100).toFixed(0)}% above median).`,
    }));

  return {
    items: [...badHours, ...badDows],
    winners: goodHours,
    totals: {
      count:    badHours.length + badDows.length,
      wastedCost: [...badHours, ...badDows].reduce((a, r) => a + r.cost, 0),
      medianRoas: median,
    },
  };
}

/* ─── 4. PDP CRO ─────────────────────────────────────────────────────
   Landing-page URLs with clicks above floor but conversion rate below
   peer median. Joined to Shopify by URL match against product handle. */
export function pdpCro({ landingPages = [], shopifyBySku = null, orders = [], minClicks = 50 } = {}) {
  if (!landingPages?.length) return { items: [], totals: { count: 0, lostRev: 0 } };

  const withVol = landingPages.filter(p => p.clicks >= minClicks);
  if (!withVol.length) return { items: [], totals: { count: 0, lostRev: 0 } };

  const medianCvr = withVol.map(p => p.convRate).sort((a, b) => a - b)[Math.floor(withVol.length / 2)] || 0;

  // Build a handle → shopify-sales lookup from orders (ground-truth organic CVR)
  const organicByHandle = new Map();
  for (const o of orders) {
    for (const li of o.line_items || []) {
      const handle = li.handle || li.product_handle || li.vendor || null; // shopify line items don't always have handle
      if (!handle) continue;
      const cur = organicByHandle.get(handle) || { handle, units: 0, rev: 0 };
      cur.units += Number(li.quantity) || 1;
      cur.rev   += (Number(li.price) || 0) * (Number(li.quantity) || 1);
      organicByHandle.set(handle, cur);
    }
  }

  const items = withVol
    .filter(p => p.convRate < medianCvr * 0.7)
    .map(p => {
      const handleMatch = Array.from(organicByHandle.keys()).find(h => p.url.includes(`/products/${h}`));
      const organic = handleMatch ? organicByHandle.get(handleMatch) : null;
      const lostConv  = (medianCvr - p.convRate) * p.clicks;
      const lostRev   = lostConv * (p.conversions > 0 ? p.conversionValue / p.conversions : p.cost * 3);
      return {
        url: p.url,
        handle: handleMatch,
        clicks: p.clicks,
        convRate: p.convRate,
        medianCvr,
        cost: p.cost,
        conversions: p.conversions,
        conversionValue: p.conversionValue,
        organicUnits: organic?.units || 0,
        organicRev:   organic?.rev || 0,
        lostConv, lostRev,
        severity:   p.convRate === 0 ? 'critical' : p.convRate < medianCvr * 0.4 ? 'high' : 'medium',
        action:     `${p.clicks} clicks landed here with ${(p.convRate * 100).toFixed(2)}% CVR (peer median ${(medianCvr * 100).toFixed(2)}%). ${p.convRate === 0 ? 'Zero conversions — verify the PDP loads, stock is available, and price is competitive.' : 'Audit for stock, price, PDP speed, above-fold layout.'}`,
      };
    })
    .sort((a, b) => b.lostRev - a.lostRev);

  return {
    items,
    totals: {
      count:   items.length,
      lostRev: items.reduce((a, i) => a + i.lostRev, 0),
      peerCvr: medianCvr,
    },
  };
}

/* ─── 5. HIDDEN SCALE SKUs ───────────────────────────────────────────
   SKUs selling well on Shopify AND performing well on Meta, but getting
   <100 Google impressions. These are ad-dollars-available opportunities
   — the SKU is proven, Google just isn't scaling it.
   ──────────────────────────────────────────────────────────────────── */
export function hiddenScaleSkus({ blend, metaBySku = null, shopifyBySku = null, minShopifyRev = 5000, maxGoogleImpr = 100 } = {}) {
  if (!blend?.bySku?.length) return { items: [], totals: { count: 0, estPotential: 0 } };

  // Shopify rev threshold: top quartile of SKUs that sold anything
  const withRev = blend.bySku.filter(r => (r.shopRevenue || 0) > 0).map(r => r.shopRevenue);
  const q3      = withRev.length ? withRev.sort((a, b) => a - b)[Math.floor(withRev.length * 0.75)] : minShopifyRev;
  const threshold = Math.max(minShopifyRev, q3);

  const items = blend.bySku
    .filter(r =>
      r.shopRevenue >= threshold &&
      r.adImpr       <= maxGoogleImpr &&
      r.feedApproved &&                    // has to be servable
      r.inventoryPosture !== 'oos' &&
      r.inventoryPosture !== 'critical'
    )
    .map(r => {
      // Meta performance — optional signal
      const meta = metaBySku?.get?.(r.sku) || null;
      const metaRoas = meta?.spend > 0 ? (meta.revenue || 0) / meta.spend : null;
      return {
        sku: r.sku,
        title: r.title,
        image: r.image,
        feedLink: r.feedLink,
        shopRevenue: r.shopRevenue,
        shopUnits:   r.shopUnits,
        adImpr:      r.adImpr,
        adSpend:     r.adSpend,
        metaSpend:   meta?.spend || 0,
        metaRoas,
        productType: r.productType,
        signals: [
          `₹${Math.round(r.shopRevenue).toLocaleString('en-IN')} organic rev`,
          metaRoas ? `Meta ROAS ${metaRoas.toFixed(1)}` : null,
          `${r.adImpr || 0} Google impr`,
        ].filter(Boolean).join(' · '),
        action: metaRoas && metaRoas > 2
          ? `Proven on Meta (${metaRoas.toFixed(1)}x ROAS) + selling organically — launch a dedicated Google Search or Shopping campaign for this SKU.`
          : `Selling organically without Google push — add to a Shopping campaign asset group or create a dedicated Search ad.`,
        // Rough "potential" estimate: if Shopify conversion rate held on Google, at 30% impression share
        estMonthlyPotential: Math.round(r.shopRevenue * 0.3),
      };
    })
    .sort((a, b) => b.shopRevenue - a.shopRevenue);

  return {
    items,
    totals: {
      count: items.length,
      estPotential: items.reduce((a, i) => a + i.estMonthlyPotential, 0),
    },
  };
}

/* ─── 6. CHANNEL SCORECARD ───────────────────────────────────────────
   One row per SKU with: Shopify revenue, Google cost/rev, Meta cost/rev,
   inventory, feed status, recommended action. This is the master lens
   — replaces Star Products as the operator's single source of truth
   for "which SKUs need attention". */
export function channelScorecard({ blend, metaBySku = null } = {}) {
  if (!blend?.bySku?.length) return { items: [], totals: { count: 0 } };

  const items = blend.bySku.map(r => {
    const meta = metaBySku?.get?.(r.sku) || null;
    const metaSpend = meta?.spend || 0;
    const metaRev   = meta?.revenue || 0;
    const metaRoas  = metaSpend > 0 ? metaRev / metaSpend : 0;

    const googleRoas = r.adSpend > 0 ? r.adRev / r.adSpend : 0;
    const totalRev   = r.shopRevenue + r.adRev + metaRev;
    const totalCost  = r.adSpend + metaSpend;
    const blendedRoas = totalCost > 0 ? totalRev / totalCost : null;

    // Tier: star / scale / leak / fix / drop / monitor
    let tier = 'monitor';
    if (r.signals?.wastedSpend || r.signals?.outOfStockServing) tier = 'fix';
    else if (r.shopRevenue > 0 && r.adImpr < 100 && r.feedApproved) tier = 'scale';
    else if (googleRoas > 3 && metaRoas > 3 && r.shopRevenue > 0) tier = 'star';
    else if (r.adSpend > 1000 && googleRoas < 1) tier = 'leak';
    else if (r.adSpend > 0 && r.conversions === 0 && r.shopRevenue === 0) tier = 'drop';

    const action = {
      star:    'Protect — keep bidding high, monitor stock weekly.',
      scale:   'Launch a dedicated campaign — proven organically but not being advertised.',
      fix:     r.signals?.wastedSpend ? 'Fix feed disapproval to unblock spend.' : 'Pause campaign until restocked.',
      leak:    'Cut budget or move to exact-match campaign — high spend, low return.',
      drop:    'Stop advertising — no Shopify demand, no Google conversions.',
      monitor: 'No urgent action.',
    }[tier];

    return {
      sku: r.sku,
      title: r.title,
      image: r.image,
      feedLink: r.feedLink,
      productType: r.productType,
      // Channel slices
      shopRevenue: r.shopRevenue,
      shopUnits:   r.shopUnits,
      googleCost:  r.adSpend,
      googleRev:   r.adRev,
      googleRoas,
      metaCost:    metaSpend,
      metaRev,
      metaRoas,
      totalRev, totalCost, blendedRoas,
      // Health
      feedStatus:  r.feedStatus,
      inventoryPosture: r.inventoryPosture,
      // Verdict
      tier, action,
    };
  });

  // Sort by totalRev desc
  items.sort((a, b) => b.totalRev - a.totalRev);

  const byTier = { star: 0, scale: 0, leak: 0, fix: 0, drop: 0, monitor: 0 };
  items.forEach(i => byTier[i.tier]++);

  return {
    items,
    totals: {
      count: items.length,
      totalShop: items.reduce((a, i) => a + i.shopRevenue, 0),
      totalGoogleCost: items.reduce((a, i) => a + i.googleCost, 0),
      totalMetaCost:   items.reduce((a, i) => a + i.metaCost, 0),
      byTier,
    },
  };
}

/* ─── ONE-SHOT ORCHESTRATOR ──────────────────────────────────────── */
export function analyzeOpportunities({ data, blend, merchantBySku, orders, shopifyBySku, metaBySku } = {}) {
  if (!data) return null;
  const campaignsById = new Map((data.campaigns || []).map(c => [String(c.id), c]));

  return {
    recs:        recommendationsInbox({ recommendations: data.recommendations, merchantBySku, campaignsById }),
    negatives:   smartNegatives({ searchTerms: data.searchTerms }),
    dayparting:  dayparting({ hours: data.hours }),
    pdp:         pdpCro({ landingPages: data.landingPages, shopifyBySku, orders }),
    hidden:      hiddenScaleSkus({ blend, metaBySku, shopifyBySku }),
    scorecard:   channelScorecard({ blend, metaBySku }),
  };
}
