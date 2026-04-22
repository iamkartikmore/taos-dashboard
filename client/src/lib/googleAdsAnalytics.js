// Google Ads API returns proto JSON like:
// { campaign: { id, name, status, ... }, metrics: { impressions, clicks, costMicros, ... }, segments: { date } }
// We flatten to simple rows the UI can consume.

const fromMicros = v => (v == null ? 0 : Number(v) / 1e6);
const num        = v => (v == null ? 0 : Number(v));

function commonMetrics(m = {}) {
  const impressions = num(m.impressions);
  const clicks      = num(m.clicks);
  const cost        = fromMicros(m.costMicros);
  const conv        = num(m.conversions);
  const convValue   = num(m.conversionsValue);
  const allConv     = num(m.allConversions);
  const allConvVal  = num(m.allConversionsValue);
  const ctr         = num(m.ctr);
  const avgCpc      = fromMicros(m.averageCpc);
  return {
    impressions, clicks, cost,
    conversions:       conv,
    conversionValue:   convValue,
    allConversions:    allConv,
    allConversionValue: allConvVal,
    viewThroughConv:   num(m.viewThroughConversions),
    ctr,
    cpc:   avgCpc,
    cpa:   conv > 0 ? cost / conv : 0,
    roas:  cost > 0 ? convValue / cost : 0,
    aov:   conv > 0 ? convValue / conv : 0,
    convRate: clicks > 0 ? conv / clicks : 0,
  };
}

export function normalizeCampaigns(rows = []) {
  // Aggregate per campaign (server may return multiple rows with same campaign.id if segments.date wasn't used)
  const map = new Map();
  rows.forEach(r => {
    const id   = r.campaign?.id;
    const name = r.campaign?.name;
    if (!id) return;
    const existing = map.get(id) || {
      id, name,
      status:        r.campaign?.status,
      channel:       r.campaign?.advertisingChannelType,
      biddingStrategy: r.campaign?.biddingStrategyType,
      budget:        fromMicros(r.campaignBudget?.amountMicros),
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
      allConversions: 0, allConversionValue: 0, viewThroughConv: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions       += m.impressions;
    existing.clicks            += m.clicks;
    existing.cost              += m.cost;
    existing.conversions       += m.conversions;
    existing.conversionValue   += m.conversionValue;
    existing.allConversions    += m.allConversions;
    existing.allConversionValue += m.allConversionValue;
    existing.viewThroughConv   += m.viewThroughConv;
    map.set(id, existing);
  });
  return Array.from(map.values()).map(c => {
    c.ctr      = c.impressions > 0 ? c.clicks / c.impressions : 0;
    c.cpc      = c.clicks > 0 ? c.cost / c.clicks : 0;
    c.cpa      = c.conversions > 0 ? c.cost / c.conversions : 0;
    c.roas     = c.cost > 0 ? c.conversionValue / c.cost : 0;
    c.aov      = c.conversions > 0 ? c.conversionValue / c.conversions : 0;
    c.convRate = c.clicks > 0 ? c.conversions / c.clicks : 0;
    return c;
  });
}

export function normalizeAdGroups(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const id = r.adGroup?.id;
    if (!id) return;
    const existing = map.get(id) || {
      id,
      name:         r.adGroup?.name,
      status:       r.adGroup?.status,
      type:         r.adGroup?.type,
      cpcBid:       fromMicros(r.adGroup?.cpcBidMicros),
      campaignId:   r.campaign?.id,
      campaignName: r.campaign?.name,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(id, existing);
  });
  return Array.from(map.values()).map(a => {
    a.ctr      = a.impressions > 0 ? a.clicks / a.impressions : 0;
    a.cpc      = a.clicks > 0 ? a.cost / a.clicks : 0;
    a.cpa      = a.conversions > 0 ? a.cost / a.conversions : 0;
    a.roas     = a.cost > 0 ? a.conversionValue / a.cost : 0;
    a.convRate = a.clicks > 0 ? a.conversions / a.clicks : 0;
    return a;
  });
}

export function normalizeAds(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const id = r.adGroupAd?.ad?.id;
    if (!id) return;
    const existing = map.get(id) || {
      id,
      name:         r.adGroupAd?.ad?.name,
      type:         r.adGroupAd?.ad?.type,
      status:       r.adGroupAd?.status,
      finalUrls:    r.adGroupAd?.ad?.finalUrls || [],
      adGroupId:    r.adGroup?.id,
      adGroupName:  r.adGroup?.name,
      campaignId:   r.campaign?.id,
      campaignName: r.campaign?.name,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(id, existing);
  });
  return Array.from(map.values()).map(a => {
    a.ctr      = a.impressions > 0 ? a.clicks / a.impressions : 0;
    a.cpc      = a.clicks > 0 ? a.cost / a.clicks : 0;
    a.roas     = a.cost > 0 ? a.conversionValue / a.cost : 0;
    a.cpa      = a.conversions > 0 ? a.cost / a.conversions : 0;
    return a;
  });
}

export function normalizeKeywords(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const kw   = r.adGroupCriterion?.keyword;
    if (!kw?.text) return;
    const key  = `${r.adGroup?.id}|${kw.text}|${kw.matchType}`;
    const existing = map.get(key) || {
      keyword:      kw.text,
      matchType:    kw.matchType,
      status:       r.adGroupCriterion?.status,
      qualityScore: r.adGroupCriterion?.qualityInfo?.qualityScore,
      adGroupId:    r.adGroup?.id,
      adGroupName:  r.adGroup?.name,
      campaignId:   r.campaign?.id,
      campaignName: r.campaign?.name,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(key, existing);
  });
  return Array.from(map.values()).map(k => {
    k.ctr      = k.impressions > 0 ? k.clicks / k.impressions : 0;
    k.cpc      = k.clicks > 0 ? k.cost / k.clicks : 0;
    k.cpa      = k.conversions > 0 ? k.cost / k.conversions : 0;
    k.roas     = k.cost > 0 ? k.conversionValue / k.cost : 0;
    k.convRate = k.clicks > 0 ? k.conversions / k.clicks : 0;
    return k;
  });
}

export function normalizeSearchTerms(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const term = r.searchTermView?.searchTerm;
    if (!term) return;
    const key  = `${r.adGroup?.id}|${term}`;
    const existing = map.get(key) || {
      searchTerm: term,
      adGroupId:  r.adGroup?.id,
      campaignId: r.campaign?.id,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(key, existing);
  });
  return Array.from(map.values()).map(s => {
    s.ctr  = s.impressions > 0 ? s.clicks / s.impressions : 0;
    s.cpc  = s.clicks > 0 ? s.cost / s.clicks : 0;
    s.cpa  = s.conversions > 0 ? s.cost / s.conversions : 0;
    s.roas = s.cost > 0 ? s.conversionValue / s.cost : 0;
    return s;
  });
}

export function normalizeDailyCampaigns(rows = []) {
  // One row per campaign + date — flatten
  return rows.map(r => {
    const m = commonMetrics(r.metrics || {});
    return {
      date:         r.segments?.date,
      campaignId:   r.campaign?.id,
      campaignName: r.campaign?.name,
      ...m,
    };
  });
}

export function normalizeBreakdownDevice(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const device = r.segments?.device || 'UNKNOWN';
    const existing = map.get(device) || {
      device,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(device, existing);
  });
  return Array.from(map.values()).map(d => {
    d.ctr  = d.impressions > 0 ? d.clicks / d.impressions : 0;
    d.roas = d.cost > 0 ? d.conversionValue / d.cost : 0;
    d.cpa  = d.conversions > 0 ? d.cost / d.conversions : 0;
    return d;
  });
}

export function normalizeBreakdownHour(rows = []) {
  // Aggregate by hour of day (0-23) across all days
  const byHour = new Map();
  const byDow  = new Map();
  const dowNames = ['','SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']; // Google uses 1-7 Mon-Sun?
  rows.forEach(r => {
    const hr = Number(r.segments?.hour);
    const dw = r.segments?.dayOfWeek;
    const m  = commonMetrics(r.metrics || {});

    if (!Number.isNaN(hr)) {
      const e = byHour.get(hr) || { hour: hr, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 };
      e.impressions     += m.impressions;
      e.clicks          += m.clicks;
      e.cost            += m.cost;
      e.conversions     += m.conversions;
      e.conversionValue += m.conversionValue;
      byHour.set(hr, e);
    }
    if (dw) {
      const e = byDow.get(dw) || { day: dw, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 };
      e.impressions     += m.impressions;
      e.clicks          += m.clicks;
      e.cost            += m.cost;
      e.conversions     += m.conversions;
      e.conversionValue += m.conversionValue;
      byDow.set(dw, e);
    }
  });
  const finish = row => ({
    ...row,
    ctr:  row.impressions > 0 ? row.clicks / row.impressions : 0,
    roas: row.cost > 0 ? row.conversionValue / row.cost : 0,
    cpa:  row.conversions > 0 ? row.cost / row.conversions : 0,
  });
  return {
    byHour: Array.from(byHour.values()).sort((a, b) => a.hour - b.hour).map(finish),
    byDow:  Array.from(byDow.values()).map(finish),
  };
}

export function normalizeBreakdownAge(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const age = r.adGroupCriterion?.ageRange?.type || 'UNKNOWN';
    const existing = map.get(age) || {
      ageRange: age,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(age, existing);
  });
  return Array.from(map.values()).map(a => ({
    ...a,
    ctr:  a.impressions > 0 ? a.clicks / a.impressions : 0,
    roas: a.cost > 0 ? a.conversionValue / a.cost : 0,
    cpa:  a.conversions > 0 ? a.cost / a.conversions : 0,
  }));
}

export function normalizeBreakdownGender(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const gender = r.adGroupCriterion?.gender?.type || 'UNKNOWN';
    const existing = map.get(gender) || {
      gender,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(gender, existing);
  });
  return Array.from(map.values()).map(g => ({
    ...g,
    ctr:  g.impressions > 0 ? g.clicks / g.impressions : 0,
    roas: g.cost > 0 ? g.conversionValue / g.cost : 0,
    cpa:  g.conversions > 0 ? g.cost / g.conversions : 0,
  }));
}

export function normalizeShopping(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const id = r.segments?.productItemId;
    if (!id) return;
    const existing = map.get(id) || {
      productId:    id,
      productTitle: r.segments?.productTitle,
      productBrand: r.segments?.productBrand,
      productType:  r.segments?.productTypeL1,
      channel:      r.segments?.productChannel,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(id, existing);
  });
  return Array.from(map.values()).map(p => ({
    ...p,
    ctr:  p.impressions > 0 ? p.clicks / p.impressions : 0,
    roas: p.cost > 0 ? p.conversionValue / p.cost : 0,
    cpa:  p.conversions > 0 ? p.cost / p.conversions : 0,
  }));
}

/**
 * Same data as normalizeShopping but keyed by (campaignId, productItemId) so
 * the merchant blend can roll up *per campaign* (which SKUs a campaign is
 * actually spending on). normalizeShopping collapses that dimension.
 */
export function normalizeShoppingByCampaign(rows = []) {
  const map = new Map();
  rows.forEach(r => {
    const itemId = r.segments?.productItemId;
    if (!itemId) return;
    const campaignId   = r.campaign?.id ? String(r.campaign.id) : '';
    const campaignName = r.campaign?.name || '';
    const key = `${campaignId}|${itemId}`;
    const existing = map.get(key) || {
      campaignId, campaignName,
      productItemId: itemId,
      productId:    itemId,
      productTitle: r.segments?.productTitle,
      productBrand: r.segments?.productBrand,
      productType:  r.segments?.productTypeL1,
      channel:      r.segments?.productChannel,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0,
    };
    const m = commonMetrics(r.metrics || {});
    existing.impressions     += m.impressions;
    existing.clicks          += m.clicks;
    existing.cost            += m.cost;
    existing.conversions     += m.conversions;
    existing.conversionValue += m.conversionValue;
    map.set(key, existing);
  });
  return Array.from(map.values()).map(p => ({
    ...p,
    conversionsValue: p.conversionValue, // alias for blend library compatibility
    ctr:  p.impressions > 0 ? p.clicks / p.impressions : 0,
    roas: p.cost > 0 ? p.conversionValue / p.cost : 0,
    cpa:  p.conversions > 0 ? p.cost / p.conversions : 0,
  }));
}

export function normalizeChangeEvents(rows = []) {
  return rows.map(r => {
    const e = r.changeEvent || {};
    return {
      ts:          e.changeDateTime,
      resourceType: e.changeResourceType,
      resourceName: e.changeResourceName,
      operation:   e.resourceChangeOperation,
      clientType:  e.clientType,
      userEmail:   e.userEmail,
      changedFields: e.changedFields,
      campaign:    e.campaign,
      adGroup:     e.adGroup,
      oldResource: e.oldResource,
      newResource: e.newResource,
    };
  });
}

export function normalizeBudgets(rows = []) {
  return rows.map(r => {
    const b = r.campaignBudget || {};
    return {
      id:            b.id,
      name:          b.name,
      amount:        fromMicros(b.amountMicros),
      status:        b.status,
      refCount:      b.referenceCount,
      recommended:   fromMicros(b.recommendedBudgetAmountMicros),
      hasRecommended: b.hasRecommendedBudget,
    };
  });
}

// One-shot: take the full server response and return normalized buckets
export function normalizeGoogleAdsResponse(raw = {}) {
  return {
    campaigns:      normalizeCampaigns(raw.campaigns),
    campaignsDaily: normalizeDailyCampaigns(raw.campaignsDaily),
    adGroups:       normalizeAdGroups(raw.adGroups),
    ads:            normalizeAds(raw.ads),
    keywords:       normalizeKeywords(raw.keywords),
    searchTerms:    normalizeSearchTerms(raw.searchTerms),
    devices:        normalizeBreakdownDevice(raw.devices),
    hours:          normalizeBreakdownHour(raw.hours),
    age:            normalizeBreakdownAge(raw.age),
    gender:         normalizeBreakdownGender(raw.gender),
    shopping:       normalizeShopping(raw.shopping),
    shoppingByCampaign: normalizeShoppingByCampaign(raw.shopping),
    changeEvents:   normalizeChangeEvents(raw.changeEvents),
    budgets:        normalizeBudgets(raw.budgets),
    errors:         raw.errors || {},
    fetchMs:        raw.fetchMs,
  };
}

// Totals for Scorecard / DailyBriefing integration
export function totalsFromNormalized(norm) {
  const c = norm?.campaigns || [];
  return c.reduce((acc, row) => ({
    spend:           acc.spend           + (row.cost            || 0),
    impressions:     acc.impressions     + (row.impressions     || 0),
    clicks:          acc.clicks          + (row.clicks          || 0),
    conversions:     acc.conversions     + (row.conversions     || 0),
    conversionValue: acc.conversionValue + (row.conversionValue || 0),
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });
}
