/* ─── GA4 ANALYTICS PROCESSOR ───────────────────────────────────────
 * Processes raw GA4 API data into chart-ready structures.
 * Also provides cross-reference functions that blend GA + Shopify + Meta.
 */

const n = v => parseFloat(v || 0);
const pct = v => +n(v).toFixed(2);

/* ── Parse ISO date from GA "YYYYMMDD" or "YYYYMM" format ── */
function gaDate(s) {
  if (!s) return '';
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  if (s.length === 6) return `${s.slice(0,4)}-${s.slice(4,6)}`;
  return s;
}

/* ── Traffic Overview KPIs ── */
export function buildGaOverview(gaData) {
  if (!gaData?.dailyTrend?.length) return null;
  const days = gaData.dailyTrend;
  const totals = days.reduce((acc, d) => {
    acc.sessions    += n(d.sessions);
    acc.users       += n(d.totalUsers);
    acc.newUsers    += n(d.newUsers);
    acc.pageViews   += n(d.screenPageViews);
    acc.conversions += n(d.conversions);
    acc.revenue     += n(d.purchaseRevenue);
    return acc;
  }, { sessions:0, users:0, newUsers:0, pageViews:0, conversions:0, revenue:0 });

  const lastDay = days[days.length-1] || {};
  const avgBounce = days.reduce((s,d)=>s+n(d.bounceRate),0)/Math.max(days.length,1);
  const avgDuration = days.reduce((s,d)=>s+n(d.averageSessionDuration),0)/Math.max(days.length,1);

  return {
    ...totals,
    avgBounceRate:     pct(avgBounce * 100),
    avgSessionDuration: +avgDuration.toFixed(1),
    pagesPerSession:   totals.sessions > 0 ? +(totals.pageViews / totals.sessions).toFixed(2) : 0,
    conversionRate:    totals.sessions > 0 ? pct(totals.conversions / totals.sessions * 100) : 0,
    revenuePerSession: totals.sessions > 0 ? +(totals.revenue / totals.sessions).toFixed(2) : 0,
    returningUsers:    totals.users - totals.newUsers,
    newUserRate:       totals.users > 0 ? pct(totals.newUsers / totals.users * 100) : 0,
    days:              days.length,
  };
}

/* ── Daily trend with 7D moving average ── */
export function buildGaDailyTrend(gaData) {
  if (!gaData?.dailyTrend?.length) return [];
  const sorted = [...gaData.dailyTrend].sort((a,b)=>(gaDate(a.date)).localeCompare(gaDate(b.date)));
  return sorted.map((d, i) => {
    const window = sorted.slice(Math.max(0, i-6), i+1);
    const avgSessions = window.reduce((s,x)=>s+n(x.sessions),0)/window.length;
    return {
      date:        gaDate(d.date),
      sessions:    n(d.sessions),
      users:       n(d.totalUsers),
      newUsers:    n(d.newUsers),
      pageViews:   n(d.screenPageViews),
      conversions: n(d.conversions),
      revenue:     n(d.purchaseRevenue),
      bounceRate:  pct(n(d.bounceRate) * 100),
      duration:    +n(d.averageSessionDuration).toFixed(1),
      avg7dSessions: +avgSessions.toFixed(1),
    };
  });
}

/* ── Monthly trend ── */
export function buildGaMonthlyTrend(gaData) {
  if (!gaData?.monthlyTrend?.length && !gaData?.dailyTrend?.length) return [];
  if (gaData.monthlyTrend?.length) {
    return [...gaData.monthlyTrend]
      .sort((a,b) => (a.yearMonth||'').localeCompare(b.yearMonth||''))
      .map(d => ({ month: gaDate(d.yearMonth), sessions: n(d.sessions), users: n(d.totalUsers), newUsers: n(d.newUsers), conversions: n(d.conversions), revenue: n(d.purchaseRevenue) }));
  }
  // Fall back: aggregate daily to monthly
  const map = {};
  gaData.dailyTrend.forEach(d => {
    const mo = gaDate(d.date).slice(0,7);
    if (!map[mo]) map[mo] = { month:mo, sessions:0, users:0, newUsers:0, conversions:0, revenue:0 };
    map[mo].sessions    += n(d.sessions);
    map[mo].users       += n(d.totalUsers);
    map[mo].newUsers    += n(d.newUsers);
    map[mo].conversions += n(d.conversions);
    map[mo].revenue     += n(d.purchaseRevenue);
  });
  return Object.values(map).sort((a,b)=>a.month.localeCompare(b.month));
}

/* ── Channel breakdown ── */
export function buildGaChannels(gaData) {
  if (!gaData?.sourceMedium?.length) return [];
  const totalSessions = gaData.sourceMedium.reduce((s,r)=>s+n(r.sessions),0)||1;
  return gaData.sourceMedium
    .map(r => ({
      sourceMedium:  r.sessionSourceMedium || '(direct)/(none)',
      channel:       r.sessionDefaultChannelGrouping || 'Other',
      sessions:      n(r.sessions),
      users:         n(r.totalUsers),
      newUsers:      n(r.newUsers),
      conversions:   n(r.conversions),
      revenue:       n(r.purchaseRevenue),
      bounceRate:    pct(n(r.bounceRate) * 100),
      engagementRate:pct(n(r.engagementRate) * 100),
      share:         pct(n(r.sessions) / totalSessions * 100),
      convRate:      n(r.sessions) > 0 ? pct(n(r.conversions)/n(r.sessions)*100) : 0,
    }))
    .sort((a,b) => b.sessions - a.sessions);
}

/* ── Campaign performance ── */
export function buildGaCampaigns(gaData) {
  if (!gaData?.campaigns?.length) return [];
  return gaData.campaigns
    .filter(r => r.sessionCampaignName && r.sessionCampaignName !== '(not set)')
    .map(r => ({
      campaign:    r.sessionCampaignName,
      source:      r.sessionSource,
      medium:      r.sessionMedium,
      sessions:    n(r.sessions),
      newUsers:    n(r.newUsers),
      conversions: n(r.conversions),
      revenue:     n(r.purchaseRevenue),
      convRate:    n(r.sessions) > 0 ? pct(n(r.conversions)/n(r.sessions)*100) : 0,
      cpr:         n(r.conversions) > 0 ? +(n(r.purchaseRevenue)/n(r.conversions)).toFixed(2) : 0,
    }))
    .sort((a,b) => b.sessions - a.sessions);
}

/* ── Landing pages ── */
export function buildGaLandingPages(gaData) {
  if (!gaData?.landingPages?.length) return [];
  return gaData.landingPages
    .map(r => ({
      page:          r.landingPagePlusQueryString || '/',
      sessions:      n(r.sessions),
      users:         n(r.totalUsers),
      bounceRate:    pct(n(r.bounceRate) * 100),
      conversions:   n(r.conversions),
      engagementRate:pct(n(r.engagementRate) * 100),
      pageViews:     n(r.screenPageViews),
      convRate:      n(r.sessions) > 0 ? pct(n(r.conversions)/n(r.sessions)*100) : 0,
    }))
    .sort((a,b) => b.sessions - a.sessions)
    .slice(0, 100);
}

/* ── Geo ── */
export function buildGaGeo(gaData) {
  if (!gaData?.geo?.length) return { byCountry:[], byRegion:[], byCity:[] };
  const totalSessions = gaData.geo.reduce((s,r)=>s+n(r.sessions),0)||1;
  const byCountry={}, byRegion={}, byCity={};
  gaData.geo.forEach(r => {
    const add = (map, k, r) => {
      if (!map[k]) map[k] = { label:k, sessions:0, users:0, conversions:0, revenue:0 };
      map[k].sessions    += n(r.sessions);
      map[k].users       += n(r.totalUsers);
      map[k].conversions += n(r.conversions);
      map[k].revenue     += n(r.purchaseRevenue);
    };
    add(byCountry, r.country||'Unknown', r);
    if (r.region && r.region !== '(not set)') add(byRegion, r.region, r);
    if (r.city    && r.city    !== '(not set)') add(byCity,   r.city,   r);
  });
  const fin = (map) => Object.values(map)
    .map(x => ({ ...x, share: pct(x.sessions/totalSessions*100), convRate: x.sessions>0?pct(x.conversions/x.sessions*100):0 }))
    .sort((a,b)=>b.sessions-a.sessions).slice(0,50);
  return { byCountry:fin(byCountry), byRegion:fin(byRegion), byCity:fin(byCity) };
}

/* ── Device breakdown ── */
export function buildGaDevices(gaData) {
  if (!gaData?.devices?.length) return [];
  const total = gaData.devices.reduce((s,r)=>s+n(r.sessions),0)||1;
  return gaData.devices
    .map(r => ({
      device:      r.deviceCategory,
      os:          r.operatingSystem,
      sessions:    n(r.sessions),
      users:       n(r.totalUsers),
      newUsers:    n(r.newUsers),
      conversions: n(r.conversions),
      revenue:     n(r.purchaseRevenue),
      share:       pct(n(r.sessions)/total*100),
    }))
    .sort((a,b) => b.sessions - a.sessions);
}

/* ── Events ── */
export function buildGaEvents(gaData) {
  if (!gaData?.events?.length) return [];
  return gaData.events
    .map(r => ({ event:r.eventName, count:n(r.eventCount), users:n(r.totalUsers), conversions:n(r.conversions) }))
    .sort((a,b) => b.count - a.count);
}

/* ── Ecommerce items ── */
export function buildGaItems(gaData) {
  if (!gaData?.items?.length) return [];
  return gaData.items
    .filter(r => r.itemName && r.itemName !== '(not set)')
    .map(r => ({
      name:      r.itemName,
      itemId:    r.itemId,
      category:  r.itemCategory,
      brand:     r.itemBrand,
      revenue:   n(r.itemRevenue),
      sold:      n(r.itemsSold),
      addToCarts:n(r.addToCarts),
      checkouts: n(r.checkouts),
      cartToCheckout: n(r.addToCarts) > 0 ? pct(n(r.checkouts)/n(r.addToCarts)*100) : 0,
      checkoutToPurch: n(r.checkouts) > 0 ? pct(n(r.itemPurchaseQuantity)/n(r.checkouts)*100) : 0,
      aov: n(r.itemsSold) > 0 ? +(n(r.itemRevenue)/n(r.itemsSold)).toFixed(2) : 0,
    }))
    .sort((a,b) => b.revenue - a.revenue);
}

/* ── UTM drill ── */
export function buildGaUtm(gaData) {
  if (!gaData?.utmDrill?.length) return [];
  // Build hierarchical source → medium → campaign → content
  const srcMap = {};
  gaData.utmDrill.forEach(r => {
    const src  = r.sessionSource  || '(direct)';
    const med  = r.sessionMedium  || '(none)';
    const camp = r.sessionCampaignName    || '(not set)';
    const cont = r.sessionManualAdContent || '';
    if (!srcMap[src]) srcMap[src] = { source:src, sessions:0, newUsers:0, conversions:0, revenue:0, mediums:{} };
    srcMap[src].sessions    += n(r.sessions);
    srcMap[src].newUsers    += n(r.newUsers);
    srcMap[src].conversions += n(r.conversions);
    srcMap[src].revenue     += n(r.purchaseRevenue);
    if (!srcMap[src].mediums[med]) srcMap[src].mediums[med] = { medium:med, sessions:0, newUsers:0, conversions:0, revenue:0, campaigns:{} };
    srcMap[src].mediums[med].sessions    += n(r.sessions);
    srcMap[src].mediums[med].conversions += n(r.conversions);
    srcMap[src].mediums[med].revenue     += n(r.purchaseRevenue);
    if (!srcMap[src].mediums[med].campaigns[camp])
      srcMap[src].mediums[med].campaigns[camp] = { campaign:camp, sessions:0, conversions:0, revenue:0, contents:{} };
    srcMap[src].mediums[med].campaigns[camp].sessions    += n(r.sessions);
    srcMap[src].mediums[med].campaigns[camp].conversions += n(r.conversions);
    srcMap[src].mediums[med].campaigns[camp].revenue     += n(r.purchaseRevenue);
    if (cont) {
      if (!srcMap[src].mediums[med].campaigns[camp].contents[cont])
        srcMap[src].mediums[med].campaigns[camp].contents[cont] = { content:cont, sessions:0, conversions:0, revenue:0 };
      srcMap[src].mediums[med].campaigns[camp].contents[cont].sessions    += n(r.sessions);
      srcMap[src].mediums[med].campaigns[camp].contents[cont].conversions += n(r.conversions);
      srcMap[src].mediums[med].campaigns[camp].contents[cont].revenue     += n(r.purchaseRevenue);
    }
  });
  return Object.values(srcMap)
    .map(s => ({ ...s, mediums: Object.values(s.mediums).map(m => ({ ...m, campaigns: Object.values(m.campaigns).map(c => ({ ...c, contents: Object.values(c.contents).sort((a,b)=>b.sessions-a.sessions) })).sort((a,b)=>b.sessions-a.sessions) })).sort((a,b)=>b.sessions-a.sessions) }))
    .sort((a,b) => b.sessions - a.sessions);
}

/* ── Cross-reference: GA sessions × Shopify orders (by UTM) ── */
export function buildCrossRef(gaData, shopifyOrders = [], metaEnrichedRows = []) {
  if (!gaData) return null;

  // 1. GA channel → sessions + GA revenue
  const channels = buildGaChannels(gaData);

  // 2. Shopify UTM → orders + revenue (from landing_site + note_attributes)
  const shopUtm = {};
  const parseUtm = (landingSite, noteAttributes) => {
    const notes = {};
    (noteAttributes||[]).forEach(({name,value}) => { if(name?.toLowerCase().startsWith('utm_')) notes[name.toLowerCase()]=value; });
    if (notes.utm_source) return { source: notes.utm_source, medium: notes.utm_medium||'(none)' };
    if (!landingSite) return null;
    try {
      const url = landingSite.startsWith('http') ? landingSite : `https://x.com${landingSite}`;
      const p = new URL(url).searchParams;
      const src = p.get('utm_source');
      return src ? { source: src, medium: p.get('utm_medium')||'(none)' } : null;
    } catch { return null; }
  };
  shopifyOrders.filter(o => !o.cancelled_at).forEach(o => {
    const utm = parseUtm(o.landing_site, o.note_attributes);
    const k = utm ? `${utm.source} / ${utm.medium}` : '(direct) / (none)';
    if (!shopUtm[k]) shopUtm[k] = { sourceMedium:k, orders:0, revenue:0 };
    shopUtm[k].orders++;
    shopUtm[k].revenue += parseFloat(o.total_price||0);
  });

  // 3. Meta spend by source label (campaign name matching)
  const metaSpendByCampaign = {};
  metaEnrichedRows.forEach(r => {
    const c = (r.campaignName||'').toLowerCase();
    if (!metaSpendByCampaign[c]) metaSpendByCampaign[c] = 0;
    metaSpendByCampaign[c] += parseFloat(r.spend||0);
  });

  // 4. Merge channel data
  const blended = channels.map(ch => {
    const sm = ch.sourceMedium;
    const shop = shopUtm[sm] || {};
    // Try to match Meta spend to GA campaign
    const gaRevenue = ch.revenue;
    const shopRevenue = shop.revenue || 0;
    const shopOrders  = shop.orders  || 0;
    return {
      ...ch,
      shopOrders,
      shopRevenue,
      blendedRevenue: gaRevenue || shopRevenue,
      revenueGap:     shopRevenue - gaRevenue,
    };
  });

  return { blended, shopUtm: Object.values(shopUtm).sort((a,b)=>b.revenue-a.revenue) };
}

/* ── SKU cross-reference: GA items × Shopify SKUs ── */
export function buildSkuCrossRef(gaData, shopifyOrders = [], inventoryMap = {}) {
  const gaItems = buildGaItems(gaData);
  if (!gaItems.length && !shopifyOrders.length) return [];

  // Build Shopify SKU map
  const shopSkuMap = {};
  shopifyOrders.filter(o=>!o.cancelled_at).forEach(o => {
    (o.line_items||[]).forEach(item => {
      const sku  = (item.sku||'').trim().toUpperCase() || `pid_${item.product_id}`;
      const name = item.title || sku;
      const qty  = item.quantity || 1;
      const rev  = parseFloat(item.price||0)*qty - parseFloat(item.total_discount||0);
      if (!shopSkuMap[sku]) shopSkuMap[sku] = { sku, name, orders:0, units:0, revenue:0 };
      shopSkuMap[sku].orders++;
      shopSkuMap[sku].units += qty;
      shopSkuMap[sku].revenue += rev;
    });
  });

  // Match GA items to Shopify SKUs by name similarity
  const matched = gaItems.map(item => {
    const nameLower = item.name.toLowerCase();
    // Find best Shopify match
    const shopMatch = Object.values(shopSkuMap).find(s =>
      s.name.toLowerCase().includes(nameLower.slice(0,15)) ||
      nameLower.includes(s.name.toLowerCase().slice(0,15))
    );
    const inv = shopMatch ? (inventoryMap[shopMatch.sku] || {}) : {};
    return {
      gaName:      item.name,
      gaItemId:    item.itemId,
      gaCategory:  item.category,
      gaRevenue:   item.revenue,
      gaSold:      item.sold,
      gaAddToCart: item.addToCarts,
      gaCheckouts: item.checkouts,
      cartToCheckout: item.cartToCheckout,
      // Shopify match
      shopSku:     shopMatch?.sku || '—',
      shopRevenue: shopMatch?.revenue || 0,
      shopOrders:  shopMatch?.orders || 0,
      shopUnits:   shopMatch?.units || 0,
      stock:       inv.stock ?? null,
      revenueDelta: (shopMatch?.revenue || 0) - item.revenue,
    };
  });

  return matched;
}
