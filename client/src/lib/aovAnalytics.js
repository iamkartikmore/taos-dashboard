/* ─── AOV ANALYTICS ENGINE v2 — Supreme Precision ───────────────────
 * Pure functions only. All analysis is quantified in ₹ with confidence.
 * Data sources: Shopify orders + inventoryMap (stock + collections) + Meta enrichedRows + GA
 */

const p = v => parseFloat(v || 0);
const today = () => new Date().toISOString().slice(0, 10);

/* ─── UTM / channel detection ───────────────────────────────────── */
export function detectChannel(order) {
  const notes = {};
  (order.note_attributes || []).forEach(({ name, value }) => {
    if (name?.toLowerCase().startsWith('utm_')) notes[name.toLowerCase()] = value;
  });
  const utmSrc = notes.utm_source || (() => {
    try {
      const site = order.landing_site || '';
      if (!site) return null;
      const url = site.startsWith('http') ? site : `https://x${site}`;
      return new URL(url).searchParams.get('utm_source');
    } catch { return null; }
  })();

  if (utmSrc) {
    const s = utmSrc.toLowerCase();
    if (s.includes('facebook') || s.includes('instagram') || s.includes('meta') || s.includes('fb')) return 'Meta Ads';
    if (s.includes('google')) return 'Google Ads';
    if (s.includes('email') || s.includes('klaviyo') || s.includes('sendgrid') || s.includes('mailchimp')) return 'Email';
    if (s.includes('whatsapp')) return 'WhatsApp';
    return utmSrc;
  }
  const ref = order.referring_site || '';
  if (ref.includes('facebook') || ref.includes('fb.')) return 'Facebook Organic';
  if (ref.includes('instagram')) return 'Instagram Organic';
  if (ref.includes('google')) return 'Google Organic';
  if (ref.includes('youtube')) return 'YouTube';
  if (ref.includes('whatsapp')) return 'WhatsApp';
  const sn = (order.source_name || '').toLowerCase();
  if (sn === 'web' || sn === '') return 'Direct / Organic';
  if (sn === 'shopify_draft_orders' || sn === 'shopify') return 'Manual Order';
  return sn || 'Direct / Organic';
}

/* ─── SKU → primary collection ──────────────────────────────────── */
function skuCollection(sku, inventoryMap) {
  const inv = inventoryMap[sku] || {};
  return inv.collectionLabel || inv.collections?.[0] || inv.productType || 'Uncollected';
}

/* ══════════════════════════════════════════════════════════════════
   1. DAILY AOV TIMELINE
══════════════════════════════════════════════════════════════════ */
export function buildAovTimeline(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const dayMap = {};
  const seenEmails = new Set();
  const sorted = [...active].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  sorted.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const rev   = p(o.total_price);
    const disc  = p(o.total_discounts);
    const items = (o.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const email = (o.email || o.customer?.email || '').toLowerCase().trim();
    const isNew = (o.customer?.orders_count || 1) <= 1 && !(email && seenEmails.has(email));
    if (email) seenEmails.add(email);
    const ch = detectChannel(o);

    if (!dayMap[date]) dayMap[date] = {
      date, orders: 0, revenue: 0, disc: 0, items: 0,
      newOrders: 0, channels: {}, skuRevMap: {},
    };
    const d = dayMap[date];
    d.orders++; d.revenue += rev; d.disc += disc; d.items += items;
    if (isNew) d.newOrders++;
    d.channels[ch] = (d.channels[ch] || 0) + 1;
    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty = li.quantity || 1;
      const net = p(li.price) * qty - p(li.total_discount);
      if (!d.skuRevMap[sku]) d.skuRevMap[sku] = { name: li.title || sku, rev: 0 };
      d.skuRevMap[sku].rev += net;
    });
  });

  const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  return days.map((d, i) => {
    const aov           = d.orders > 0 ? d.revenue / d.orders : 0;
    const itemsPerOrder = d.orders > 0 ? d.items  / d.orders  : 0;
    const avgItemPrice  = d.items  > 0 ? d.revenue / d.items   : 0;
    const discountRate  = d.revenue > 0 ? d.disc  / d.revenue * 100 : 0;
    const avgDiscount   = d.orders  > 0 ? d.disc  / d.orders  : 0;
    const newPct        = d.orders  > 0 ? d.newOrders / d.orders * 100 : 0;
    const w7 = days.slice(Math.max(0, i - 6), i + 1);
    const ma7 = w7.reduce((s, x) => s + (x.orders > 0 ? x.revenue / x.orders : 0), 0) / w7.length;
    return {
      date: d.date, orders: d.orders, revenue: d.revenue,
      aov: +aov.toFixed(0), ma7: +ma7.toFixed(0),
      itemsPerOrder: +itemsPerOrder.toFixed(2),
      avgItemPrice: +avgItemPrice.toFixed(0),
      discountRate: +discountRate.toFixed(1),
      avgDiscount: +avgDiscount.toFixed(0),
      newPct: +newPct.toFixed(1),
      channels: d.channels,
      skuRevMap: d.skuRevMap,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════
   2. OOS DETECTION — cross-referenced with real stock
   Returns ranked list of products likely OOS with ₹ revenue impact
══════════════════════════════════════════════════════════════════ */
export function detectOosSignals(orders, inventoryMap) {
  if (!orders?.length) return [];
  const active  = orders.filter(o => !o.cancelled_at);
  const todayStr = today();

  // Build per-SKU daily sales map
  const skuMap = {};
  active.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty = li.quantity || 1;
      const net = p(li.price) * qty - p(li.total_discount);
      if (!skuMap[sku]) skuMap[sku] = { sku, name: li.title || sku, dayRev: {}, dayUnits: {}, prices: [] };
      const s = skuMap[sku];
      s.dayRev[date]   = (s.dayRev[date]   || 0) + net;
      s.dayUnits[date] = (s.dayUnits[date] || 0) + qty;
      s.prices.push(p(li.price));
    });
  });

  const signals = [];
  for (const [sku, data] of Object.entries(skuMap)) {
    const dates = Object.keys(data.dayRev).sort();
    if (dates.length < 3) continue;
    const lastSale = dates[dates.length - 1];
    const daysSilent = Math.round((new Date(todayStr) - new Date(lastSale)) / 86400000);
    if (daysSilent < 2) continue;

    // Velocity = avg of last 7 active selling days before last sale
    const prior = dates.slice(-8, -1);
    const velocity    = prior.length > 0 ? prior.reduce((s, d) => s + (data.dayUnits[d] || 0), 0) / prior.length : data.dayUnits[lastSale] || 0;
    const avgRevPerDay = prior.length > 0 ? prior.reduce((s, d) => s + (data.dayRev[d] || 0), 0) / prior.length : data.dayRev[lastSale] || 0;
    if (velocity < 0.05 || avgRevPerDay < 30) continue;

    const inv          = inventoryMap[sku] || {};
    const currentStock = inv.stock ?? null;
    const avgPrice     = data.prices.length ? data.prices.reduce((s, v) => s + v, 0) / data.prices.length : 0;
    const collection   = skuCollection(sku, inventoryMap);

    // Detect gradual decline before silence (slope of last 7 active days)
    const priorRevs = prior.map(d => data.dayRev[d] || 0);
    const slope = priorRevs.length > 1
      ? (priorRevs[priorRevs.length - 1] - priorRevs[0]) / (priorRevs.length - 1)
      : 0;
    const wasDecliningSteadily = slope < -avgRevPerDay * 0.15;

    let confidence, reason, type;
    if (currentStock === 0) {
      confidence = 'confirmed'; type = 'oos';
      reason = `Current stock confirmed at 0. Was selling ${velocity.toFixed(1)} units/day.`;
    } else if (currentStock !== null && currentStock > 0 && currentStock < velocity * 4) {
      confidence = 'high'; type = 'near_oos';
      reason = `${currentStock} units left — only ${(currentStock / velocity).toFixed(1)} days of supply at current velocity. Likely ran OOS ~${lastSale}.`;
    } else if (daysSilent >= 7 && avgRevPerDay > 200) {
      confidence = 'high'; type = wasDecliningSteadily ? 'gradual_oos' : 'oos';
      reason = wasDecliningSteadily
        ? `Sales declined steadily before stopping ${daysSilent}d ago. Classic OOS pattern. ${currentStock !== null ? `Current stock: ${currentStock}.` : ''}`
        : `High-velocity product silent for ${daysSilent} days. ${currentStock !== null ? `Current stock: ${currentStock}.` : 'Stock data unavailable.'}`;
    } else if (daysSilent >= 4) {
      confidence = 'medium'; type = 'possible_oos';
      reason = `No sales for ${daysSilent} days after consistent activity. ${currentStock !== null ? `Current stock: ${currentStock}.` : 'Verify stock manually.'}`;
    } else {
      confidence = 'low'; type = 'paused';
      reason = `Sales paused for ${daysSilent} days. Could be OOS, seasonal, or promotional.`;
    }

    // Revenue at risk = avg daily × days silent (capped at 30d)
    const revLost = avgRevPerDay * Math.min(daysSilent, 30);
    // AOV impact: rough estimate — if this SKU contributed X% of daily revenue and it's gone,
    // and it was a solo-purchase product, AOV drops by its price contribution per order
    const soloRevImpact = avgPrice * Math.min(daysSilent, 30);

    signals.push({
      sku, name: data.name,
      collection, collections: inv.collections || [],
      lastSaleDate: lastSale, firstSaleDate: dates[0],
      daysSilent, velocity: +velocity.toFixed(2),
      avgRevPerDay: +avgRevPerDay.toFixed(0),
      revLost: +revLost.toFixed(0),
      soloRevImpact: +soloRevImpact.toFixed(0),
      currentStock, avgPrice: +avgPrice.toFixed(0),
      confidence, type, reason,
      wasDecliningSteadily,
      totalActiveDays: dates.length,
      dailyHistory: dates.slice(-14).map(d => ({ date: d, rev: +(data.dayRev[d] || 0).toFixed(0), units: data.dayUnits[d] || 0 })),
    });
  }

  const order = { confirmed: 0, high: 1, medium: 2, low: 3 };
  return signals.sort((a, b) => {
    const cd = (order[a.confidence] || 3) - (order[b.confidence] || 3);
    return cd !== 0 ? cd : b.revLost - a.revLost;
  });
}

/* ══════════════════════════════════════════════════════════════════
   3. COLLECTION REVENUE — Shopify orders → collection mapping
   Uses inventoryMap[sku].collections to assign each line item
══════════════════════════════════════════════════════════════════ */
export function buildCollectionRevenue(orders, inventoryMap) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const colMap = {};
  const t7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const t14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const t30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  active.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const orderColls = new Set();

    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty = li.quantity || 1;
      const net = p(li.price) * qty - p(li.total_discount);
      const inv  = inventoryMap[sku] || {};
      const colls = inv.collections?.length > 0
        ? inv.collections
        : [inv.collectionLabel || inv.productType || 'Uncollected'];

      colls.slice(0, 2).forEach(col => { // max 2 collections per SKU to avoid over-counting
        orderColls.add(col);
        if (!colMap[col]) colMap[col] = { name: col, dayMap: {}, skus: new Set(), rev: 0, rev7: 0, rev14: 0, rev30: 0, orders: 0, items: 0 };
        const c = colMap[col];
        c.skus.add(sku);
        c.rev += net;
        if (date >= t7)  c.rev7  += net;
        if (date >= t14 && date < t7)  c.rev14 += net;
        if (date >= t30) c.rev30 += net;
        if (!c.dayMap[date]) c.dayMap[date] = { date, rev: 0, orders: 0 };
        c.dayMap[date].rev += net;
        c.items += qty;
      });
    });

    // Order count — credit to primary collection of the first line item
    const firstSku = (o.line_items?.[0]?.sku || '').trim().toUpperCase() || `pid_${o.line_items?.[0]?.product_id}`;
    const primaryCol = skuCollection(firstSku, inventoryMap);
    if (colMap[primaryCol]) {
      colMap[primaryCol].orders++;
      if (colMap[primaryCol].dayMap[date]) colMap[primaryCol].dayMap[date].orders++;
    }
  });

  return Object.values(colMap).map(c => {
    const dayTrend = Object.values(c.dayMap).sort((a, b) => a.date.localeCompare(b.date));
    const revTrend7vs14 = c.rev14 > 0 ? (c.rev7 - c.rev14) / c.rev14 * 100 : null;
    return {
      name: c.name,
      rev: c.rev, rev7: c.rev7, rev14: c.rev14, rev30: c.rev30,
      orders: c.orders,
      aov: c.orders > 0 ? +(c.rev30 / c.orders).toFixed(0) : 0,
      skuCount: c.skus.size,
      revTrend7vs14: revTrend7vs14 !== null ? +revTrend7vs14.toFixed(1) : null,
      dayTrend,
    };
  }).sort((a, b) => b.rev30 - a.rev30);
}

/* ══════════════════════════════════════════════════════════════════
   4. META COLLECTION SPEND — from enrichedRows
   Matches Meta manual-map collection labels to Shopify collection revenue
══════════════════════════════════════════════════════════════════ */
export function buildMetaCollectionSpend(enrichedRows) {
  if (!enrichedRows?.length) return [];
  const colMap = {};

  enrichedRows.forEach(r => {
    const col = (r.collection || '').trim() || 'Uncollected';
    if (!colMap[col]) colMap[col] = {
      name: col, spend: 0, revenue: 0, purchases: 0,
      roasSum: 0, roasN: 0, ads: 0,
    };
    const c = colMap[col];
    c.spend     += p(r.spend);
    c.revenue   += p(r.revenue);
    c.purchases += p(r.purchases);
    c.ads++;
    if (r.metaRoas > 0 && r.spend > 0) { c.roasSum += r.metaRoas * r.spend; c.roasN += r.spend; }
  });

  return Object.values(colMap).map(c => ({
    name: c.name, spend: c.spend, metaRevenue: c.revenue, purchases: c.purchases, ads: c.ads,
    metaRoas: c.roasN > 0 ? +(c.roasSum / c.roasN).toFixed(2) : 0,
    cpa: c.purchases > 0 ? +(c.spend / c.purchases).toFixed(0) : 0,
  })).sort((a, b) => b.spend - a.spend);
}

/* ══════════════════════════════════════════════════════════════════
   5. DROP AUTOPSY — comprehensive cause analysis for a date range
   Returns a ranked, named, ₹-quantified cause list
══════════════════════════════════════════════════════════════════ */
export function buildDropAutopsy(orders, inventoryMap, enrichedRows, dropStart, dropEnd, baseStart, baseEnd) {
  if (!orders?.length || !dropStart || !dropEnd || !baseStart || !baseEnd) return null;
  const active = orders.filter(o => !o.cancelled_at);

  function inRange(o, s, e) { const d = o.created_at?.slice(0, 10); return d && d >= s && d <= e; }

  const dropOrders = active.filter(o => inRange(o, dropStart, dropEnd));
  const baseOrders = active.filter(o => inRange(o, baseStart, baseEnd));
  if (!dropOrders.length || !baseOrders.length) return null;

  function summarise(orderList, label) {
    let revenue = 0, disc = 0, items = 0;
    const skuRev = {}, skuUnits = {}, skuName = {}, channelN = {}, discCodes = {};
    let newOrders = 0;
    const seenEmails = new Set();
    const dayCount = orderList.length > 0
      ? (() => {
          const dates = [...new Set(orderList.map(o => o.created_at?.slice(0, 10)).filter(Boolean))];
          return dates.length || 1;
        })()
      : 1;

    orderList.forEach(o => {
      const rev  = p(o.total_price);
      const disc_ = p(o.total_discounts);
      revenue += rev; disc += disc_;
      const orderItems = (o.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0);
      items += orderItems;
      const email = (o.email || o.customer?.email || '').toLowerCase().trim();
      const isNew = (o.customer?.orders_count || 1) <= 1 && !(email && seenEmails.has(email));
      if (email) seenEmails.add(email);
      if (isNew) newOrders++;
      channelN[detectChannel(o)] = (channelN[detectChannel(o)] || 0) + 1;
      (o.discount_codes || []).forEach(dc => {
        const code = dc.code || '(unknown)';
        if (!discCodes[code]) discCodes[code] = { code, uses: 0, totalDisc: 0, revenue: 0 };
        discCodes[code].uses++;
        discCodes[code].totalDisc += p(dc.amount);
        discCodes[code].revenue   += rev;
      });
      (o.line_items || []).forEach(li => {
        const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
        const qty = li.quantity || 1;
        const net = p(li.price) * qty - p(li.total_discount);
        skuRev[sku]   = (skuRev[sku]   || 0) + net;
        skuUnits[sku] = (skuUnits[sku] || 0) + qty;
        skuName[sku]  = li.title || sku;
      });
    });

    const N = orderList.length;
    return {
      label, N, dayCount,
      revenue, disc, items,
      aov:           N  > 0 ? revenue / N : 0,
      aovPerDay:     dayCount > 0 ? revenue / dayCount : 0,
      itemsPerOrder: N  > 0 ? items / N  : 0,
      avgItemPrice:  items > 0 ? revenue / items : 0,
      discRate:      revenue > 0 ? disc / revenue * 100 : 0,
      avgDiscount:   N > 0 ? disc / N : 0,
      newPct:        N > 0 ? newOrders / N * 100 : 0,
      ordersPerDay:  dayCount > 0 ? N / dayCount : 0,
      channelN, skuRev, skuUnits, skuName,
      discCodes: Object.values(discCodes),
    };
  }

  const drop = summarise(dropOrders, 'drop');
  const base = summarise(baseOrders, 'base');
  const Δaov = drop.aov - base.aov;

  /* ── Cause 1: OOS signals in drop period ── */
  const oosInPeriod = detectOosSignals(orders, inventoryMap).filter(s => {
    // Signal is relevant if lastSaleDate falls within or just before drop window
    const d = new Date(s.lastSaleDate);
    const ds = new Date(dropStart);
    const de = new Date(dropEnd);
    return d >= new Date(new Date(dropStart) - 14 * 86400000) && d <= de;
  });

  const oosRevLost = oosInPeriod.filter(s => s.confidence !== 'low').reduce((s, x) => s + x.avgRevPerDay, 0);
  const dropDays   = Math.round((new Date(dropEnd) - new Date(dropStart)) / 86400000) + 1;
  const oosImpact  = -(oosRevLost / (drop.ordersPerDay > 0 ? drop.ordersPerDay : 1));

  /* ── Cause 2: Product mix shift ── */
  const allSkus    = new Set([...Object.keys(drop.skuRev), ...Object.keys(base.skuRev)]);
  const baseRevPerDay = base.dayCount > 0 ? base.revenue / base.dayCount : base.revenue;
  const dropRevPerDay = drop.dayCount > 0 ? drop.revenue / drop.dayCount : drop.revenue;
  const skuChanges = [];

  for (const sku of allSkus) {
    const bRev = base.skuRev[sku] || 0;
    const dRev = drop.skuRev[sku] || 0;
    const bShare = base.revenue > 0 ? bRev / base.revenue * 100 : 0;
    const dShare = drop.revenue > 0 ? dRev / drop.revenue * 100 : 0;
    const bRevDay = base.dayCount > 0 ? bRev / base.dayCount : bRev;
    const dRevDay = drop.dayCount > 0 ? dRev / drop.dayCount : dRev;
    const inv = inventoryMap[sku] || {};
    const price = inv.price || (bRevDay + dRevDay) / ((base.skuUnits[sku] || 0) + (drop.skuUnits[sku] || 0) + 1);
    const collection = skuCollection(sku, inventoryMap);
    const oosFlag = oosInPeriod.find(s => s.sku === sku);

    if (bRevDay + dRevDay < 50 || (bShare < 0.5 && dShare < 0.5)) continue;
    skuChanges.push({
      sku, name: drop.skuName[sku] || base.skuName[sku] || sku,
      collection, price: +price.toFixed(0),
      bRev: +bRevDay.toFixed(0), dRev: +dRevDay.toFixed(0),
      bShare: +bShare.toFixed(1), dShare: +dShare.toFixed(1),
      revChange: +(dRevDay - bRevDay).toFixed(0),
      shareChange: +(dShare - bShare).toFixed(1),
      pctChange: bRevDay > 0 ? +((dRevDay - bRevDay) / bRevDay * 100).toFixed(1) : null,
      status: dRevDay === 0 ? 'disappeared' : bRevDay === 0 ? 'new' : dRevDay < bRevDay * 0.5 ? 'crashed' : dRevDay < bRevDay * 0.8 ? 'dropped' : dRevDay > bRevDay * 1.5 ? 'surged' : 'stable',
      isOos: !!oosFlag,
      oosConf: oosFlag?.confidence,
    });
  }
  skuChanges.sort((a, b) => a.revChange - b.revChange);

  // Products that disappeared or crashed — price mix effect
  const highAovProducts = skuChanges.filter(s => s.price > (base.avgItemPrice * 1.3) && (s.status === 'crashed' || s.status === 'disappeared'));
  const lowAovGained    = skuChanges.filter(s => s.price < (base.avgItemPrice * 0.8) && s.shareChange > 2);
  const priceMixEffect  = base.itemsPerOrder * (drop.avgItemPrice - base.avgItemPrice);

  /* ── Cause 3: Basket size ── */
  const basketEffect = (drop.itemsPerOrder - base.itemsPerOrder) * base.avgItemPrice;

  /* ── Cause 4: Discount codes ── */
  const dropDiscRate = drop.discRate;
  const baseDiscRate = base.discRate;
  const discEffect   = -(drop.avgDiscount - base.avgDiscount);
  const newCodes     = drop.discCodes.filter(dc => !base.discCodes.find(b => b.code === dc.code) && dc.uses > 1);
  const highDiscCodes = drop.discCodes.filter(dc => dc.totalDisc / dc.uses > base.avgDiscount * 1.5 && dc.uses > 1);

  /* ── Cause 5: Channel shift ── */
  const allChans = new Set([...Object.keys(drop.channelN), ...Object.keys(base.channelN)]);
  const chanChanges = [];
  for (const ch of allChans) {
    const bPct = base.N > 0 ? (base.channelN[ch] || 0) / base.N * 100 : 0;
    const dPct = drop.N > 0 ? (drop.channelN[ch] || 0) / drop.N * 100 : 0;
    chanChanges.push({ channel: ch, basePct: +bPct.toFixed(1), dropPct: +dPct.toFixed(1), delta: +(dPct - bPct).toFixed(1) });
  }
  chanChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  // Paid→organic shift (paid typically has higher AOV)
  const paidBase = (base.channelN['Meta Ads'] || 0) + (base.channelN['Google Ads'] || 0);
  const paidDrop = (drop.channelN['Meta Ads'] || 0) + (drop.channelN['Google Ads'] || 0);
  const paidPctBase = base.N > 0 ? paidBase / base.N * 100 : 0;
  const paidPctDrop = drop.N > 0 ? paidDrop / drop.N * 100 : 0;
  const channelEffect = -(paidPctDrop - paidPctBase) * base.aov * 0.12 / 100;

  /* ── Cause 6: New customer ratio ── */
  const newCustEffect = -(drop.newPct - base.newPct) / 100 * base.aov * 0.20;

  /* ── Cause 7: Collection-level Meta spend changes ── */
  // (enrichedRows is 7d window — use as proxy for spend trends)
  const metaByCol = buildMetaCollectionSpend(enrichedRows || []);
  const collRevDrop = buildCollectionRevenue(dropOrders, inventoryMap);
  const collRevBase = buildCollectionRevenue(baseOrders, inventoryMap);

  // Build cause list
  const causes = [];

  if (oosInPeriod.filter(s => ['confirmed', 'high'].includes(s.confidence)).length > 0) {
    const confirmed = oosInPeriod.filter(s => s.confidence === 'confirmed');
    const highConf  = oosInPeriod.filter(s => s.confidence === 'high');
    const affected  = [...confirmed, ...highConf];
    causes.push({
      type: 'oos',
      priority: 1,
      icon: '🚫',
      label: `Out of Stock: ${affected.length} product${affected.length > 1 ? 's' : ''}`,
      detail: affected.slice(0, 3).map(s => `${s.name} (${s.collection}) — silent ${s.daysSilent}d${s.currentStock === 0 ? ', stock=0✓' : ''}`).join(' · '),
      impact: -(oosRevLost * dropDays / (drop.ordersPerDay > 0 ? drop.ordersPerDay : 1)),
      magnitude: oosRevLost,
      confidence: confirmed.length > 0 ? 'confirmed' : 'high',
      items: affected,
      action: `Restock ${affected.map(s => s.name).join(', ')}. Estimated ₹${(oosRevLost).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/day revenue recovery.`,
    });
  }

  if (Math.abs(priceMixEffect) > 20) {
    const droppedHighAov = highAovProducts.slice(0, 3).map(s => `${s.name} (₹${s.price})`).join(', ');
    causes.push({
      type: 'price_mix',
      priority: 2,
      icon: '📦',
      label: 'Product price-mix shift',
      detail: `Avg item price: ₹${base.avgItemPrice.toFixed(0)} → ₹${drop.avgItemPrice.toFixed(0)}${droppedHighAov ? `. High-AOV products dropped: ${droppedHighAov}` : ''}`,
      impact: priceMixEffect,
      magnitude: Math.abs(priceMixEffect),
      confidence: Math.abs(drop.avgItemPrice - base.avgItemPrice) > 100 ? 'high' : 'medium',
      items: skuChanges.filter(s => s.status !== 'stable').slice(0, 10),
      action: drop.avgItemPrice < base.avgItemPrice
        ? `Cheaper products gained share. ${droppedHighAov ? `Reactivate ads for: ${droppedHighAov}.` : 'Check which high-price products lost traffic.'}`
        : 'Higher-priced items gaining — positive driver.',
    });
  }

  if (Math.abs(basketEffect) > 20) {
    causes.push({
      type: 'basket',
      priority: 3,
      icon: '🛒',
      label: 'Basket size change',
      detail: `Items/order: ${base.itemsPerOrder.toFixed(2)} → ${drop.itemsPerOrder.toFixed(2)} (${basketEffect > 0 ? '+' : ''}${((drop.itemsPerOrder - base.itemsPerOrder) / base.itemsPerOrder * 100).toFixed(1)}%)`,
      impact: basketEffect,
      magnitude: Math.abs(basketEffect),
      confidence: Math.abs(drop.itemsPerOrder - base.itemsPerOrder) > 0.2 ? 'high' : Math.abs(drop.itemsPerOrder - base.itemsPerOrder) > 0.08 ? 'medium' : 'low',
      items: [],
      action: drop.itemsPerOrder < base.itemsPerOrder
        ? 'Customers buying fewer items per order. Check if bundle pages are converting, or if upsell cross-sell widgets are still active.'
        : 'Basket size improved — positive driver.',
    });
  }

  if (Math.abs(discEffect) > 15 || highDiscCodes.length > 0) {
    const codeDetail = highDiscCodes.slice(0, 3).map(dc => `${dc.code} (${dc.uses}x, avg ₹${(dc.totalDisc / dc.uses).toFixed(0)} off)`).join(', ');
    causes.push({
      type: 'discount',
      priority: 4,
      icon: '🏷️',
      label: `Discount pressure${highDiscCodes.length > 0 ? ` — ${highDiscCodes.length} high-discount code(s)` : ''}`,
      detail: `Discount rate: ${base.discRate.toFixed(1)}% → ${drop.discRate.toFixed(1)}%. ${codeDetail || 'Avg discount per order increased.'}`,
      impact: discEffect,
      magnitude: Math.abs(discEffect),
      confidence: Math.abs(drop.discRate - base.discRate) > 3 ? 'high' : Math.abs(drop.discRate - base.discRate) > 1 ? 'medium' : 'low',
      items: drop.discCodes.sort((a, b) => b.uses - a.uses),
      action: drop.discRate > base.discRate
        ? `High-discount codes suppressing revenue per order. ${highDiscCodes.length > 0 ? `Review: ${highDiscCodes.map(c => c.code).join(', ')}.` : 'Check which codes are active.'}`
        : 'Discount usage decreased — positive.',
    });
  }

  if (Math.abs(channelEffect) > 15 || Math.abs(paidPctDrop - paidPctBase) > 5) {
    causes.push({
      type: 'channel',
      priority: 5,
      icon: '📡',
      label: `Channel mix shift${paidPctDrop < paidPctBase ? ' — less paid traffic' : ' — more paid traffic'}`,
      detail: `Paid (Meta+Google): ${paidPctBase.toFixed(0)}% → ${paidPctDrop.toFixed(0)}% of orders. ${chanChanges[0] ? `Biggest shift: ${chanChanges[0].channel} ${chanChanges[0].delta > 0 ? '+' : ''}${chanChanges[0].delta}pp` : ''}`,
      impact: channelEffect,
      magnitude: Math.abs(channelEffect),
      confidence: Math.abs(paidPctDrop - paidPctBase) > 8 ? 'high' : 'medium',
      items: chanChanges,
      action: paidPctDrop < paidPctBase
        ? 'Paid traffic share dropped — organic/direct has lower AOV on average. Check Meta/Google campaign activity in this period.'
        : 'More paid traffic — typically drives higher-intent purchases.',
    });
  }

  if (Math.abs(newCustEffect) > 15) {
    causes.push({
      type: 'new_cust',
      priority: 6,
      icon: '👤',
      label: 'New vs Repeat customer ratio',
      detail: `New customer share: ${base.newPct.toFixed(0)}% → ${drop.newPct.toFixed(0)}%. New customers typically buy entry-level products.`,
      impact: newCustEffect,
      magnitude: Math.abs(newCustEffect),
      confidence: Math.abs(drop.newPct - base.newPct) > 10 ? 'medium' : 'low',
      items: [],
      action: drop.newPct > base.newPct
        ? 'More first-time buyers pulled in (lower AOV). If from paid acquisition this is intended — watch AOV trend as they become repeat buyers.'
        : 'More repeat buyers — positive for AOV.',
    });
  }

  causes.sort((a, b) => b.magnitude - a.magnitude);
  const totalExplained = causes.reduce((s, c) => s + (c.impact || 0), 0);

  return {
    dropStart, dropEnd, baseStart, baseEnd,
    drop, base, Δaov: +Δaov.toFixed(0),
    causes,
    skuChanges,
    chanChanges,
    oosInPeriod,
    totalExplained: +totalExplained.toFixed(0),
    unexplained: +(Δaov - totalExplained).toFixed(0),
    collRevDrop, collRevBase,
  };
}

/* ══════════════════════════════════════════════════════════════════
   6. PRODUCT VITALS — per-product health dashboard
══════════════════════════════════════════════════════════════════ */
export function buildProductVitals(orders, inventoryMap) {
  if (!orders?.length) return [];
  const active  = orders.filter(o => !o.cancelled_at);
  const todayStr = today();
  const t7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const t30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const skuMap = {};

  active.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const isNew = (o.customer?.orders_count || 1) <= 1;
    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty = li.quantity || 1;
      const net = p(li.price) * qty - p(li.total_discount);
      if (!skuMap[sku]) skuMap[sku] = {
        sku, name: li.title || sku,
        rev: 0, rev7: 0, rev30: 0, units: 0, units7: 0, orders: 0,
        newOrders: 0, daySet: new Set(), dayRev: {}, dayUnits: {},
        prices: [],
      };
      const s = skuMap[sku];
      s.rev += net; s.units += qty; s.orders++;
      if (date >= t7)  { s.rev7  += net; s.units7 += qty; }
      if (date >= t30) s.rev30 += net;
      if (isNew) s.newOrders++;
      s.daySet.add(date);
      s.dayRev[date]   = (s.dayRev[date]   || 0) + net;
      s.dayUnits[date] = (s.dayUnits[date] || 0) + qty;
      s.prices.push(p(li.price));
    });
  });

  return Object.values(skuMap).map(s => {
    const inv     = inventoryMap[s.sku] || {};
    const velocity7d = s.units7 / 7;
    const stock   = inv.stock ?? null;
    const runway  = stock !== null && velocity7d > 0 ? Math.round(stock / velocity7d) : null;
    const dates   = [...s.daySet].sort();
    const lastSale = dates[dates.length - 1] || '';
    const daysSilent = lastSale ? Math.round((new Date(todayStr) - new Date(lastSale)) / 86400000) : 999;
    const avgPrice = s.prices.length ? s.prices.reduce((a, v) => a + v, 0) / s.prices.length : 0;

    let stockStatus = 'ok';
    if (stock === 0) stockStatus = 'oos';
    else if (stock !== null && runway !== null && runway < 7) stockStatus = 'critical';
    else if (stock !== null && runway !== null && runway < 14) stockStatus = 'low';
    else if (daysSilent > 3 && velocity7d > 0.1) stockStatus = 'paused';

    return {
      sku: s.sku, name: s.name,
      collection: skuCollection(s.sku, inventoryMap),
      collections: inv.collections || [],
      rev: s.rev, rev7: s.rev7, rev30: s.rev30,
      units: s.units, units7: s.units7,
      orders: s.orders, newPct: s.orders > 0 ? s.newOrders / s.orders * 100 : 0,
      aov: s.orders > 0 ? s.rev / s.orders : 0,
      avgPrice: +avgPrice.toFixed(0),
      velocity7d: +velocity7d.toFixed(2),
      stock, runway,
      lastSaleDate: lastSale, daysSilent, stockStatus,
      activeDays: s.daySet.size,
      sparkline: dates.slice(-14).map(d => ({ date: d, rev: +(s.dayRev[d] || 0).toFixed(0), units: s.dayUnits[d] || 0 })),
    };
  }).sort((a, b) => b.rev30 - a.rev30);
}

/* ══════════════════════════════════════════════════════════════════
   7. AUTO-DETECT DROP EVENTS
══════════════════════════════════════════════════════════════════ */
export function detectDropEvents(timeline, thresholdPct = 12) {
  return timeline.map((d, i) => {
    if (i < 4 || !d.orders) return null;
    const prev    = timeline.slice(Math.max(0, i - 7), i).filter(x => x.orders > 0);
    if (prev.length < 3) return null;
    const avgAov  = prev.reduce((s, x) => s + x.aov, 0) / prev.length;
    if (!avgAov) return null;
    const dropPct = (avgAov - d.aov) / avgAov * 100;
    if (dropPct < thresholdPct) return null;
    return { ...d, dropPct: +dropPct.toFixed(1), avgAov: +avgAov.toFixed(0), severity: dropPct >= 25 ? 'critical' : dropPct >= 15 ? 'high' : 'medium' };
  }).filter(Boolean).sort((a, b) => b.dropPct - a.dropPct);
}

/* ══════════════════════════════════════════════════════════════════
   8. GA BLEND
══════════════════════════════════════════════════════════════════ */
export function blendGaWithAov(aovTimeline, gaData) {
  if (!gaData?.dailyTrend?.length) return aovTimeline;
  const gaMap = {};
  gaData.dailyTrend.forEach(d => {
    const date = d.date?.length === 8
      ? `${d.date.slice(0,4)}-${d.date.slice(4,6)}-${d.date.slice(6,8)}` : d.date;
    if (date) gaMap[date] = d;
  });
  return aovTimeline.map(d => {
    const ga = gaMap[d.date];
    if (!ga) return d;
    const sessions    = parseFloat(ga.sessions    || 0);
    const conversions = parseFloat(ga.conversions || 0);
    return {
      ...d,
      sessions, conversions,
      convRate:    sessions > 0 ? +(conversions / sessions * 100).toFixed(2) : 0,
      bounceRate:  +(parseFloat(ga.bounceRate || 0) * 100).toFixed(1),
      avgDuration: +parseFloat(ga.averageSessionDuration || 0).toFixed(0),
    };
  });
}
