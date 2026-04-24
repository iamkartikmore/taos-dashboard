/* ─── SAFE HELPERS ────────────────────────────────────────────────── */

export const safeText = v =>
  v == null ? '' : String(v).trim();

export const safeNum = v => {
  let s = safeText(v)
    .replace(/\u00A0/g, '').replace(/,/g, '').replace(/[₹$%]/g, '')
    .replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

export const pct = (v, base) =>
  base > 0 ? ((safeNum(v) - safeNum(base)) / safeNum(base)) * 100 : 0;

export const safeDivide = (a, b) => {
  a = safeNum(a); b = safeNum(b);
  return b ? a / b : 0;
};

export const median = arr => {
  if (!arr?.length) return 0;
  const a = arr.map(safeNum).filter(x => !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export const fmt = {
  currency: n => `₹${safeNum(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  number:   n => safeNum(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
  decimal:  (n, d = 2) => safeNum(n).toFixed(d),
  pct:      n => `${safeNum(n).toFixed(1)}%`,
  roas:     n => `${safeNum(n).toFixed(2)}x`,
  delta:    n => {
    const v = safeNum(n);
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  }
};

/* ─── ACTION MAP HELPER (Meta returns arrays) ─────────────────────── */

const mapFromArray = arr => {
  const out = {};
  (arr || []).forEach(x => {
    const t = safeText(x?.action_type);
    if (!t) return;
    out[t] = (out[t] || 0) + safeNum(x?.value);
  });
  return out;
};

const sumTypes = (map, types) =>
  (types || []).reduce((s, t) => s + safeNum(map[t]), 0);

// For purchase count and revenue we take the FIRST non-zero match from the
// priority list — summing all types causes 3-4× inflation when Meta returns
// offsite_conversion.fb_pixel_purchase + purchase + omni_purchase for the
// same event.
const PURCHASE_TYPES = [
  'onsite_web_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'omni_purchase',
];
const bestType = map => {
  for (const t of PURCHASE_TYPES) { const v = safeNum(map[t]); if (v > 0) return v; }
  return 0;
};

const pickMetric = v => {
  if (!v) return 0;
  if (Array.isArray(v) && v.length)
    return safeNum(v[0]?.value !== undefined ? v[0].value : v[0]);
  return safeNum(v);
};

const metaRoas = pr => {
  if (!pr) return 0;
  if (Array.isArray(pr)) {
    const preferred = ['onsite_web_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'];
    for (const pref of preferred)
      for (const x of pr)
        if (safeText(x.action_type).toLowerCase() === pref) return safeNum(x.value);
    return pr.length ? safeNum(pr[0]?.value ?? pr[0]) : 0;
  }
  return safeNum(pr);
};

/* ─── NORMALIZE RAW INSIGHT OBJECT ───────────────────────────────── */

export function normalizeInsight(o, accountKey, windowKey) {
  const actions      = mapFromArray(o.actions);
  const actionValues = mapFromArray(o.action_values);
  const cpaMap       = mapFromArray(o.cost_per_action_type);
  const spend        = safeNum(o.spend);
  const impressions  = safeNum(o.impressions);
  const outboundClicks = pickMetric(o.outbound_clicks);

  const purchases = bestType(actions);
  const revenue   = bestType(actionValues);
  const cpr = [
    cpaMap['offsite_conversion.fb_pixel_purchase'],
    cpaMap['purchase'],
    cpaMap['onsite_web_purchase'],
    cpaMap['omni_purchase']
  ].find(v => safeNum(v) > 0) ?? 0;

  const lpv = sumTypes(actions, ['landing_page_view', 'omni_landing_page_view']);
  const atc = sumTypes(actions, [
    'offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart',
    'onsite_web_add_to_cart', 'omni_add_to_cart'
  ]);
  const ic = sumTypes(actions, [
    'offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout',
    'onsite_web_initiate_checkout', 'omni_initiated_checkout'
  ]);

  return {
    accountKey: safeText(accountKey),
    window: safeText(windowKey),
    accountId:    safeText(o.account_id),
    accountName:  safeText(o.account_name),
    campaignId:   safeText(o.campaign_id),
    campaignName: safeText(o.campaign_name),
    adSetId:      safeText(o.adset_id),
    adSetName:    safeText(o.adset_name),
    adId:         safeText(o.ad_id),
    adName:       safeText(o.ad_name),
    dateStart:    safeText(o.date_start),
    dateStop:     safeText(o.date_stop),

    purchases, revenue, metaRoas: metaRoas(o.purchase_roas), spend,
    metaCpr: safeNum(cpr), metaCpp: safeNum(cpr),

    cpm: safeNum(o.cpm), cpc: safeNum(o.cpc), cpp: safeNum(o.cpp),
    cpoc: safeDivide(spend, outboundClicks),

    impressions, reach: safeNum(o.reach), frequency: safeNum(o.frequency),
    clicksAll: safeNum(o.clicks), uniqueClicks: safeNum(o.unique_clicks),
    ctrAll: safeNum(o.ctr), uniqueCtr: safeNum(o.unique_ctr),
    outboundCtr: safeDivide(outboundClicks, impressions) * 100,
    outboundClicks,
    inlineLinkClicks: pickMetric(o.inline_link_clicks),

    lpv, atc, ic,
    viewContent: sumTypes(actions, [
      'offsite_conversion.fb_pixel_view_content', 'view_content',
      'onsite_web_view_content', 'omni_view_content'
    ]),

    threeSec:  safeNum(actions['video_view']) + safeNum(actions['video_play']),
    thruplays: safeNum(actions['video_thruplay_watched_actions']) + safeNum(actions['thruplay']),

    // computed
    aov:          safeDivide(revenue, purchases),
    lpvRate:      safeDivide(lpv, outboundClicks) * 100,
    atcRate:      safeDivide(atc, lpv) * 100,
    icRate:       safeDivide(ic, atc) * 100,
    purchaseRate: safeDivide(purchases, ic) * 100,
    convRate:     safeDivide(purchases, outboundClicks) * 100,
    costPerLpv:   safeDivide(spend, lpv),
    costPerAtc:   safeDivide(spend, atc),
    costPerIc:    safeDivide(spend, ic),

    // Video funnel (Meta returns these as arrays like actions)
    videoPlays:    pickMetric(o.video_play_actions),
    videoP25:      pickMetric(o.video_p25_watched_actions),
    videoP50:      pickMetric(o.video_p50_watched_actions),
    videoP75:      pickMetric(o.video_p75_watched_actions),
    videoP95:      pickMetric(o.video_p95_watched_actions),
    videoP100:     pickMetric(o.video_p100_watched_actions),
    videoAvgWatch: pickMetric(o.video_avg_time_watched_actions),
    // Quality rankings (strings from Meta)
    qualityRanking:        safeText(o.quality_ranking),
    engagementRanking:     safeText(o.engagement_rate_ranking),
    conversionRanking:     safeText(o.conversion_rate_ranking),

    // Video funnel rates
    videoP25Rate:  (() => { const p = pickMetric(o.video_play_actions); return p > 0 ? pickMetric(o.video_p25_watched_actions) / p * 100 : 0; })(),
    videoP50Rate:  (() => { const p = pickMetric(o.video_play_actions); return p > 0 ? pickMetric(o.video_p50_watched_actions) / p * 100 : 0; })(),
    videoP75Rate:  (() => { const p = pickMetric(o.video_play_actions); return p > 0 ? pickMetric(o.video_p75_watched_actions) / p * 100 : 0; })(),
    videoP95Rate:  (() => { const p = pickMetric(o.video_play_actions); return p > 0 ? pickMetric(o.video_p95_watched_actions) / p * 100 : 0; })(),
    videoP100Rate: (() => { const p = pickMetric(o.video_play_actions); return p > 0 ? pickMetric(o.video_p100_watched_actions) / p * 100 : 0; })(),
    holdRate:      impressions > 0 ? (pickMetric(o.video_thruplay_watched_actions) / impressions) * 100 : 0,
  };
}

/* ─── QUALITY + TREND CLASSIFIERS ────────────────────────────────── */

export function deriveCurrentQuality(r) {
  const roas = safeNum(r.metaRoas);
  const cpr  = safeNum(r.metaCpr);
  if (roas >= 6 && cpr > 0 && cpr < 60)  return 'Elite';
  if (roas >= 5 && cpr > 0 && cpr < 70)  return 'Healthy';
  if (roas >= 4 && cpr > 0 && cpr < 90)  return 'Watch';
  if ((roas > 0 && roas < 3) || cpr > 100) return 'Weak';
  return 'Mixed';
}

export function deriveTrendSignal(r7, t30) {
  if (!t30 || safeNum(t30.spend) <= 0) return 'No 30D baseline';
  const roas7 = safeNum(r7.metaRoas);
  const cpr7  = safeNum(r7.metaCpr);
  const freq  = safeNum(r7.frequency);
  const roasDelta = pct(roas7, t30.metaRoas) / 100;
  const cprDelta  = pct(cpr7,  t30.metaCpr)  / 100;
  const badNow    = (roas7 > 0 && roas7 < 3) || cpr7 > 90;
  const strongNow = roas7 >= 5 && cpr7 > 0 && cpr7 < 70;

  if (roasDelta >= 0.25 && cprDelta <= -0.15) return strongNow ? 'Improving Strong' : 'Improving';
  if (roasDelta >= 0.12 && cprDelta <= -0.05) return 'Improving';
  if (roasDelta <= -0.25 && cprDelta >= 0.15) return freq >= 2.2 ? 'Fatigue / Worsening' : (badNow ? 'Worsening Bad' : 'Worsening');
  if (roasDelta <= -0.12 && cprDelta >= 0.08) return strongNow ? 'Soft Worsening' : 'Worsening';
  if (freq >= 3 && roasDelta <= -0.10) return 'Fatigue Risk';
  if (Math.abs(roasDelta) <= 0.08 && Math.abs(cprDelta) <= 0.08)
    return strongNow ? 'Stable Good' : (badNow ? 'Stable Weak' : 'Stable');
  if (roasDelta > 0.10) return 'Recovering';
  if (roasDelta < -0.10) return 'Soft Worsening';
  return strongNow ? 'Stable Good' : 'Stable';
}

/* ─── MANUAL ENRICHMENT CLASSIFIERS ─────────────────────────────── */

const hasWindow  = v => { const s = safeText(v).toLowerCase(); return !!s && s !== 'none'; };
const isYes      = v => safeText(v).toLowerCase() === 'yes';

export function deriveCustomerState(m) {
  if (!m) return 'Unknown';
  if (isYes(m['Customer list']))  return 'Owned';
  if (hasWindow(m['Purchase']))   return 'Repeat';
  if (hasWindow(m['ATC']) || hasWindow(m['IC'])) return 'Hard warm';
  if (hasWindow(m['Website visit']) || hasWindow(m['FB engage']) || hasWindow(m['Insta engage'])) return 'Soft warm';
  if (isYes(m['Interest']) || hasWindow(m['Lookalike'])) return 'Qualified cold';
  if (isYes(m['Broad']) || isYes(m['ASC'])) return 'Cold discovery';
  return 'Unknown';
}

export function deriveAudienceFamily(m) {
  const state = deriveCustomerState(m);
  if (state === 'Cold discovery' || state === 'Qualified cold') return 'Acquisition';
  if (state === 'Soft warm' || state === 'Hard warm') return 'Retargeting';
  if (state === 'Repeat' || state === 'Owned') return 'Retention';
  return 'Other';
}

export function deriveCreativeDominance(influe, stat, inhouse) {
  influe = safeNum(influe); stat = safeNum(stat); inhouse = safeNum(inhouse);
  const maxV = Math.max(influe, stat, inhouse);
  if (maxV <= 0) return 'No Creative Tag';
  const wins = [];
  if (influe === maxV) wins.push('Influencer');
  if (stat   === maxV) wins.push('Static');
  if (inhouse === maxV) wins.push('Inhouse');
  return wins.length === 1 ? `${wins[0]}-led` : 'Mixed-led';
}

export function deriveCreativeMix(influe, stat, inhouse) {
  const i = safeNum(influe) > 0;
  const s = safeNum(stat) > 0;
  const h = safeNum(inhouse) > 0;
  if (i && !s && !h) return 'Influencer Only';
  if (!i && s && !h) return 'Static Only';
  if (!i && !s && h) return 'Inhouse Only';
  if (i && s && !h) return 'Influencer + Static';
  if (i && !s && h) return 'Influencer + Inhouse';
  if (!i && s && h) return 'Static + Inhouse';
  if (i && s && h)  return 'Full Mixed';
  return 'No Creative Tag';
}

/* ─── DECISION CLASSIFICATION ────────────────────────────────────── */

export function classifyDecision(r, manual) {
  const override = safeText(manual?.['Status Override']).toLowerCase();
  if (override && override !== 'none') {
    const map = {
      'scale hard': 'Scale Hard', 'scale carefully': 'Scale Carefully',
      'defend': 'Defend', 'creative fix': 'Fix', 'offer fix': 'Fix',
      'targeting fix': 'Fix', 'watch': 'Watch', 'pause': 'Pause', 'kill': 'Kill',
    };
    return map[override] || override;
  }

  const roas  = safeNum(r.metaRoas);
  const cpr   = safeNum(r.metaCpr);
  const spend = safeNum(r.spend);
  const freq  = safeNum(r.frequency);
  const trend = r.trendSignal || '';

  if (spend < 100) return 'Watch';

  // Kill signals
  if (roas < 1.5 && spend > 300) return 'Kill';
  if (cpr > 200 && spend > 300)  return 'Kill';

  // Scale signals
  if (roas >= 6 && cpr < 60 && trend.includes('Improving')) return 'Scale Hard';
  if (roas >= 5 && cpr < 70) return 'Scale Hard';
  if (roas >= 4 && cpr < 90) return 'Scale Carefully';

  // Defend signals
  if (roas >= 3 && (trend.includes('Worsening') || trend.includes('Fatigue'))) return 'Defend';

  // Fix signals
  if (roas >= 2.5 && cpr > 80) return 'Fix';
  if (roas < 3 && spend > 200 && freq > 2.5) return 'Fix';

  if (roas < 2.5 && spend > 200) return 'Kill';
  return 'Watch';
}

/* ─── BUILD FLAT ENRICHED ROWS ───────────────────────────────────── */

import {
  calcFatigueScore, calcMomentumScore, calcFunnelLeak,
  predictRoas7d, calcDaysUntilFatigue,
} from './metaIntelligence.js';

/* Hierarchy-aware active check.
   Returns true only when the ad, its adset, AND its campaign are
   ALL reporting effective_status === 'ACTIVE' at the time the maps
   were pulled. If any link in the chain is paused, archived, deleted,
   in review, disapproved, etc. — the ad is considered inactive and
   should be filtered out of every ads analytics module.
   Meta's own effective_status usually rolls up (an ad under a paused
   campaign shows CAMPAIGN_PAUSED), but that rollup is not guaranteed
   on every sync. Checking all three explicitly is the safe default.
   When a parent record is missing from its map (partial fetch), we
   fall back to the ad's own effective_status instead of punishing it. */
export function isAdFullyActive(adIdOrInsight, adMap = {}, adsetMap = {}, campaignMap = {}) {
  if (!adIdOrInsight) return false;
  const hasMap = Object.keys(adMap).length > 0;
  if (!hasMap) return true; // maps not loaded yet — don't filter, keep UI populated

  // Accept either an ad id string, an ad record, or an insight row
  const adId = typeof adIdOrInsight === 'string'
    ? adIdOrInsight
    : (adIdOrInsight.adId || adIdOrInsight.id);
  const ad = adMap[adId];
  if (!ad) return false;
  if ((ad.effective_status || ad.status) !== 'ACTIVE') return false;

  const adsetId = ad.adset_id || (typeof adIdOrInsight === 'object' ? adIdOrInsight.adSetId : null);
  const adset = adsetId ? adsetMap[adsetId] : null;
  if (adset) {
    const s = adset.effective_status || adset.status;
    if (s && s !== 'ACTIVE') return false;
  }

  const campaignId = ad.campaign_id || (typeof adIdOrInsight === 'object' ? adIdOrInsight.campaignId : null);
  const campaign = campaignId ? campaignMap[campaignId] : null;
  if (campaign) {
    const s = campaign.effective_status || campaign.status;
    if (s && s !== 'ACTIVE') return false;
  }

  return true;
}

export function buildEnrichedRows(insights7d, insights30d, manualMap, adsetMap = {}, campaignMap = {}, adMap = {}) {
  // Strict: ad + adset + campaign must ALL be ACTIVE at the time of the pull.
  // Anything else (paused adset, archived campaign, disapproved ad, etc.)
  // is excluded from enrichedRows and therefore from every downstream
  // analytics module — those ads live in the Inactive Ads view instead.
  // When adMap is empty (data not yet fetched) we pass everything through
  // so the UI stays populated while the first pull is in flight.
  const hasAdMap = Object.keys(adMap).length > 0;
  const keepRow = r => !hasAdMap || isAdFullyActive(r, adMap, adsetMap, campaignMap);
  const activeInsights7d  = hasAdMap ? insights7d.filter(keepRow)  : insights7d;
  const activeInsights30d = hasAdMap ? insights30d.filter(keepRow) : insights30d;

  const rows30 = {};
  activeInsights30d.forEach(r => { rows30[r.adId] = r; });

  const account7Metrics = {};
  activeInsights7d.forEach(r => {
    const key = r.accountKey || r.accountId;
    if (!account7Metrics[key]) account7Metrics[key] = [];
    account7Metrics[key].push(r);
  });

  const accountMedians = {};
  Object.entries(account7Metrics).forEach(([key, rows]) => {
    accountMedians[key] = {
      cpr:          median(rows.map(r => r.metaCpr).filter(v => v > 0)),
      roas:         median(rows.map(r => r.metaRoas).filter(v => v > 0)),
      ctrAll:       median(rows.map(r => r.ctrAll).filter(v => v > 0)),
      outboundCtr:  median(rows.map(r => r.outboundCtr).filter(v => v > 0)),
      lpvRate:      median(rows.map(r => r.lpvRate).filter(v => v > 0)),
      atcRate:      median(rows.map(r => r.atcRate).filter(v => v > 0)),
      purchaseRate: median(rows.map(r => r.purchaseRate).filter(v => v > 0)),
    };
  });

  return activeInsights7d.map(r => {
    const manual = manualMap?.[r.adId] || {};
    const t30    = rows30[r.adId] || null;
    const accKey = r.accountKey || r.accountId;
    const med    = accountMedians[accKey] || {};

    // Budget: adset-level first, fall back to campaign-level (CBO)
    // Meta returns budgets in minor currency units (paise for INR) — divide by 100
    const adset    = adsetMap[r.adSetId]     || {};
    const campaign = campaignMap[r.campaignId] || {};
    let budget = 0, budgetType = '', budgetLevel = '';
    if (safeNum(adset.daily_budget) > 0) {
      budget = safeNum(adset.daily_budget) / 100; budgetType = 'daily';    budgetLevel = 'adset';
    } else if (safeNum(adset.lifetime_budget) > 0) {
      budget = safeNum(adset.lifetime_budget) / 100; budgetType = 'lifetime'; budgetLevel = 'adset';
    } else if (safeNum(campaign.daily_budget) > 0) {
      budget = safeNum(campaign.daily_budget) / 100; budgetType = 'daily';    budgetLevel = 'campaign';
    } else if (safeNum(campaign.lifetime_budget) > 0) {
      budget = safeNum(campaign.lifetime_budget) / 100; budgetType = 'lifetime'; budgetLevel = 'campaign';
    }

    const trendSignal    = deriveTrendSignal(r, t30);
    const currentQuality = deriveCurrentQuality(r);
    const decision       = classifyDecision({ ...r, trendSignal }, manual);

    return {
      ...r,
      // Manual labels
      collection: safeText(manual['Collection']),
      creator:    safeText(manual['Creator']),
      sku:        safeText(manual['SKU']),
      campaignType: safeText(manual['Campaign Type']),
      offerType:    safeText(manual['Offer Type']),
      geography:    safeText(manual['Geography']),
      influeVideo:  safeNum(manual['Influe Video']),
      staticCount:  safeNum(manual['Static']),
      inhouseVideo: safeNum(manual['Inhouse Video']),
      statusOverride: safeText(manual['Status Override']),
      notes:          safeText(manual['Notes']),

      // Derived from manual
      creativeDominance: deriveCreativeDominance(manual['Influe Video'], manual['Static'], manual['Inhouse Video']),
      creativeMix:       deriveCreativeMix(manual['Influe Video'], manual['Static'], manual['Inhouse Video']),
      customerState:     deriveCustomerState(manual),
      audienceFamily:    deriveAudienceFamily(manual),

      // Benchmarks
      accountMedianCpr:          med.cpr || 0,
      accountMedianRoas:         med.roas || 0,
      cprVsMedian:               med.cpr  > 0 ? safeDivide(r.metaCpr, med.cpr)    : 0,
      roasVsMedian:              med.roas > 0 ? safeDivide(r.metaRoas, med.roas)   : 0,

      // 30D comparison
      spend30d:        t30?.spend || 0,
      purchases30d:    t30?.purchases || 0,
      revenue30d:      t30?.revenue || 0,
      metaCpr30d:      t30?.metaCpr || 0,
      metaRoas30d:     t30?.metaRoas || 0,
      spendDelta:      t30 ? pct(r.spend, t30.spend) : 0,
      roasDelta:       t30 ? pct(r.metaRoas, t30.metaRoas) : 0,
      cprDelta:        t30 ? pct(r.metaCpr, t30.metaCpr) : 0,

      // Quality / trend
      currentQuality,
      trendSignal,
      decision,

      // Budget (adset or campaign level)
      budget,
      budgetType,
      budgetLevel,

      // ─── Advanced intelligence fields ───────────────────────────
      // Hook rate: what % of outbound clicks land on page
      hookRate: safeDivide(r.lpv, r.outboundClicks) * 100,

      // Fatigue / momentum scores (0-100 and -100..100)
      fatigueScore:      calcFatigueScore(r, t30),
      momentumScore:     calcMomentumScore(r, t30),
      daysUntilFatigue:  calcDaysUntilFatigue(r, t30),

      // Predicted ROAS in next 7 days
      predictedRoas7d: predictRoas7d(r, t30),

      // Funnel leak: which stage is most below account median
      funnelLeak: calcFunnelLeak(r, {
        lpvRate:      med.lpvRate      || 0,
        atcRate:      med.atcRate      || 0,
        purchaseRate: med.purchaseRate || 0,
      }),
    };
  });
}

/* ─── AGGREGATE SUMMARIES ────────────────────────────────────────── */
// ROAS and CPR are spend-/purchase-weighted averages of Meta's reported values.
// We never divide revenue÷spend or spend÷purchases for these two metrics.

export function aggregateMetrics(rows) {
  if (!rows?.length) return null;
  const spend       = rows.reduce((s, r) => s + safeNum(r.spend), 0);
  const purchases   = rows.reduce((s, r) => s + safeNum(r.purchases), 0);
  const revenue     = rows.reduce((s, r) => s + safeNum(r.revenue), 0);
  const impressions = rows.reduce((s, r) => s + safeNum(r.impressions), 0);
  const clicks      = rows.reduce((s, r) => s + safeNum(r.clicksAll), 0);
  const lpv         = rows.reduce((s, r) => s + safeNum(r.lpv), 0);
  const atc         = rows.reduce((s, r) => s + safeNum(r.atc), 0);
  const ic          = rows.reduce((s, r) => s + safeNum(r.ic), 0);
  const outbound    = rows.reduce((s, r) => s + safeNum(r.outboundClicks), 0);

  // Budget: deduplicated by adset/campaign to avoid counting same budget multiple times
  const seenAdsets = new Set(), seenCampaigns = new Set();
  let budget = 0;
  rows.forEach(r => {
    if (safeNum(r.budget) <= 0) return;
    if (r.budgetLevel === 'adset' && r.adSetId && !seenAdsets.has(r.adSetId)) {
      seenAdsets.add(r.adSetId); budget += safeNum(r.budget);
    } else if (r.budgetLevel === 'campaign' && r.campaignId && !seenCampaigns.has(r.campaignId)) {
      seenCampaigns.add(r.campaignId); budget += safeNum(r.budget);
    }
  });

  // ROAS: spend-weighted average of Meta's purchase_roas field
  const roasRows   = rows.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
  const roasSpend  = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
  const roas       = roasSpend > 0
    ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend
    : 0;

  // CPR: purchase-weighted average of Meta's cost_per_action_type field
  const cprRows      = rows.filter(r => safeNum(r.metaCpr) > 0 && safeNum(r.purchases) > 0);
  const cprPurchases = cprRows.reduce((s, r) => s + safeNum(r.purchases), 0);
  const cpr          = cprPurchases > 0
    ? cprRows.reduce((s, r) => s + safeNum(r.metaCpr) * safeNum(r.purchases), 0) / cprPurchases
    : 0;

  return {
    spend, purchases, revenue, impressions, clicks, lpv, atc, ic,
    budget,
    roas, cpr,
    cpm:          safeDivide(spend, impressions) * 1000,
    ctr:          safeDivide(clicks, impressions) * 100,
    outboundCtr:  safeDivide(outbound, impressions) * 100,
    lpvRate:      safeDivide(lpv, outbound) * 100,
    atcRate:      safeDivide(atc, lpv) * 100,
    purchaseRate: safeDivide(purchases, ic) * 100,
    convRate:     safeDivide(purchases, outbound) * 100,
    aov:          safeDivide(revenue, purchases),
  };
}

/* ─── PATTERN ANALYSIS ───────────────────────────────────────────── */

export function groupBy(rows, key) {
  const out = {};
  rows.forEach(r => {
    const k = safeText(r[key]) || 'Unknown';
    if (!out[k]) out[k] = [];
    out[k].push(r);
  });
  return out;
}

export function buildPatternSummary(rows, groupKey) {
  const groups = groupBy(rows.filter(r => safeNum(r.spend) > 0), groupKey);
  return Object.entries(groups)
    .map(([label, items]) => {
      const agg = aggregateMetrics(items);
      // Deduplicate budgets by source — avoid double-counting shared adset/campaign budgets
      const seen = new Set();
      let totalBudget = 0;
      items.forEach(r => {
        if (!r.budget || r.budget <= 0) return;
        const key = r.budgetLevel === 'adset'
          ? `adset_${r.adSetId}`
          : `campaign_${r.campaignId}`;
        if (!seen.has(key)) { seen.add(key); totalBudget += r.budget; }
      });
      return { label, count: items.length, totalBudget, ...agg };
    })
    .sort((a, b) => b.roas - a.roas);
}
