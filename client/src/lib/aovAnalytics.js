/* ─── AOV ANALYTICS ENGINE ───────────────────────────────────────────
 * Pure functions — no React, no store imports.
 * Each function is self-contained and memoization-friendly.
 */

const p = v => parseFloat(v || 0);

/* ─── Channel detection ─────────────────────────────────────────── */
function detectChannel(order) {
  const notes = {};
  (order.note_attributes || []).forEach(({ name, value }) => {
    if (name?.toLowerCase().startsWith('utm_')) notes[name.toLowerCase()] = value;
  });
  if (notes.utm_source) {
    const s = notes.utm_source.toLowerCase();
    if (s.includes('facebook') || s.includes('instagram') || s.includes('meta') || s.includes('fb')) return 'Meta Ads';
    if (s.includes('google')) return 'Google';
    if (s.includes('email') || s.includes('klaviyo') || s.includes('sendgrid')) return 'Email';
    return notes.utm_source;
  }
  const site = order.landing_site || '';
  try {
    if (site) {
      const url = site.startsWith('http') ? site : `https://x${site}`;
      const src = new URL(url).searchParams.get('utm_source');
      if (src) {
        const s = src.toLowerCase();
        if (s.includes('facebook') || s.includes('instagram') || s.includes('meta') || s.includes('fb')) return 'Meta Ads';
        if (s.includes('google')) return 'Google';
        if (s.includes('email') || s.includes('klaviyo')) return 'Email';
        return src;
      }
    }
  } catch {}
  const ref = order.referring_site || '';
  if (ref.includes('facebook') || ref.includes('fb.')) return 'Meta Organic';
  if (ref.includes('instagram')) return 'Instagram';
  if (ref.includes('google')) return 'Google Organic';
  if (ref.includes('youtube')) return 'YouTube';
  if (ref.includes('pinterest')) return 'Pinterest';
  if (ref.includes('whatsapp')) return 'WhatsApp';
  const sn = (order.source_name || '').toLowerCase();
  if (sn === 'web' || sn === '') return 'Direct / Organic';
  if (sn === 'shopify_draft_orders') return 'Manual';
  return sn || 'Direct / Organic';
}

/* ─── 1. DAILY AOV TIMELINE ─────────────────────────────────────── */
export function buildAovTimeline(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const dayMap = {};
  const seenEmails = new Set();
  const sorted = [...active].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  sorted.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const rev  = p(o.total_price);
    const disc = p(o.total_discounts);
    const orderItems = (o.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const email = (o.email || o.customer?.email || '').toLowerCase().trim();
    const lifetimeNew = (o.customer?.orders_count || 1) <= 1;
    const isNew = lifetimeNew && !(email && seenEmails.has(email));
    if (email) seenEmails.add(email);
    const ch = detectChannel(o);

    if (!dayMap[date]) dayMap[date] = {
      date, orders: 0, revenue: 0, disc: 0, items: 0,
      newOrders: 0, channels: {}, skuRevMap: {},
    };
    const d = dayMap[date];
    d.orders++;
    d.revenue += rev;
    d.disc += disc;
    d.items += orderItems;
    if (isNew) d.newOrders++;
    d.channels[ch] = (d.channels[ch] || 0) + 1;

    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty = li.quantity || 1;
      const net = p(li.price) * qty - p(li.total_discount);
      d.skuRevMap[sku] = (d.skuRevMap[sku] || { name: li.title || sku, rev: 0 });
      d.skuRevMap[sku].rev += net;
    });
  });

  const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  return days.map((d, i) => {
    const aov            = d.orders > 0 ? d.revenue / d.orders : 0;
    const itemsPerOrder  = d.orders > 0 ? d.items  / d.orders : 0;
    const avgItemPrice   = d.items  > 0 ? d.revenue / d.items  : 0;
    const discountRate   = d.revenue > 0 ? d.disc / d.revenue * 100 : 0;
    const avgDiscount    = d.orders > 0 ? d.disc / d.orders : 0;
    const newPct         = d.orders > 0 ? d.newOrders / d.orders * 100 : 0;
    const window7        = days.slice(Math.max(0, i - 6), i + 1);
    const ma7            = window7.reduce((s, x) => s + (x.orders > 0 ? x.revenue / x.orders : 0), 0) / window7.length;
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

/* ─── 2. PRODUCT CONTRIBUTION ───────────────────────────────────── */
export function buildProductContrib(orders, dayCount = 30) {
  if (!orders?.length) return { products: [], gainers: [], losers: [], disappeared: [] };
  const cutoff = new Date(Date.now() - dayCount * 86400000).toISOString().slice(0, 10);
  const mid    = new Date(Date.now() - (dayCount / 2) * 86400000).toISOString().slice(0, 10);
  const active = orders.filter(o => !o.cancelled_at && (o.created_at || '') >= cutoff);

  const skuMap = {};
  let totalRevFirst = 0, totalRevSecond = 0;

  active.forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const isFirst  = date < mid;
    const isSecond = date >= mid;

    (o.line_items || []).forEach(li => {
      const sku  = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const qty  = li.quantity || 1;
      const net  = p(li.price) * qty - p(li.total_discount);
      const disc = p(li.total_discount);
      if (!skuMap[sku]) skuMap[sku] = {
        sku, name: li.title || sku,
        rev: 0, units: 0, orders: 0, disc: 0,
        revFirst: 0, revSecond: 0,
        byDay: {},
      };
      const s = skuMap[sku];
      s.rev   += net; s.units += qty; s.orders++; s.disc += disc;
      if (isFirst)  { s.revFirst  += net; totalRevFirst  += net; }
      if (isSecond) { s.revSecond += net; totalRevSecond += net; }
      if (!s.byDay[date]) s.byDay[date] = 0;
      s.byDay[date] += net;
    });
  });

  const totalRev = Object.values(skuMap).reduce((s, x) => s + x.rev, 0);

  const products = Object.values(skuMap).map(s => {
    const shareFirst  = totalRevFirst  > 0 ? s.revFirst  / totalRevFirst  * 100 : 0;
    const shareSecond = totalRevSecond > 0 ? s.revSecond / totalRevSecond * 100 : 0;
    const trend       = s.revFirst > 0 ? (s.revSecond - s.revFirst) / s.revFirst * 100 : (s.revSecond > 0 ? 100 : 0);
    return {
      sku: s.sku, name: s.name,
      rev: s.rev, units: s.units, orders: s.orders, disc: s.disc,
      aov: s.orders > 0 ? s.rev / s.orders : 0,
      avgPrice: s.units > 0 ? (s.rev + s.disc) / s.units : 0,
      discRate: (s.rev + s.disc) > 0 ? s.disc / (s.rev + s.disc) * 100 : 0,
      sharePct: totalRev > 0 ? s.rev / totalRev * 100 : 0,
      shareFirst, shareSecond,
      revFirst: s.revFirst, revSecond: s.revSecond,
      trend, byDay: s.byDay,
    };
  }).sort((a, b) => b.rev - a.rev);

  const gainers      = [...products].filter(p => p.trend > 5  && p.revFirst > 100).sort((a, b) => b.trend - a.trend).slice(0, 8);
  const losers       = [...products].filter(p => p.trend < -5 && p.revFirst > 100).sort((a, b) => a.trend - b.trend).slice(0, 8);
  const disappeared  = [...products].filter(p => p.revFirst > 200 && p.revSecond === 0);

  return { products: products.slice(0, 50), gainers, losers, disappeared };
}

/* ─── 3. DROP DIAGNOSIS ─────────────────────────────────────────── */
export function buildDropDiagnosis(orders, dropDate, baselineDays = 7) {
  if (!orders?.length || !dropDate) return null;
  const active = orders.filter(o => !o.cancelled_at);

  // Baseline = average of N days before drop (excluding drop day itself)
  const dropDt = new Date(dropDate);
  const baselineOrders = active.filter(o => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at.slice(0, 10));
    const diff = (dropDt - d) / 86400000;
    return diff > 0 && diff <= baselineDays;
  });
  const dropOrders = active.filter(o => o.created_at?.slice(0, 10) === dropDate);

  if (!dropOrders.length || !baselineOrders.length) return null;

  function summarise(orderList) {
    let revenue = 0, disc = 0, items = 0;
    const skuRev = {}, skuName = {}, channelCounts = {};
    let newOrders = 0;
    const seen = new Set();

    orderList.forEach(o => {
      const rev = p(o.total_price);
      revenue += rev;
      disc    += p(o.total_discounts);
      items   += (o.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0);
      const email = (o.email || o.customer?.email || '').toLowerCase().trim();
      const lifetimeNew = (o.customer?.orders_count || 1) <= 1;
      if (lifetimeNew && !(email && seen.has(email))) newOrders++;
      if (email) seen.add(email);
      const ch = detectChannel(o);
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      (o.line_items || []).forEach(li => {
        const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
        const qty = li.quantity || 1;
        const net = p(li.price) * qty - p(li.total_discount);
        skuRev[sku]  = (skuRev[sku]  || 0) + net;
        skuName[sku] = li.title || sku;
      });
    });

    const N = orderList.length;
    return {
      orders: N, revenue, disc, items,
      aov:          N    > 0 ? revenue / N : 0,
      itemsPerOrder: N   > 0 ? items / N   : 0,
      avgItemPrice: items > 0 ? revenue / items : 0,
      discountRate: revenue > 0 ? disc / revenue * 100 : 0,
      avgDiscount:  N > 0 ? disc / N : 0,
      newPct:       N > 0 ? newOrders / N * 100 : 0,
      channelCounts, skuRev, skuName,
    };
  }

  const base = summarise(baselineOrders);
  // Normalise baseline per-day
  const baseN = baselineDays;
  const baseAvg = {
    ...base,
    orders:        base.orders        / baseN,
    revenue:       base.revenue       / baseN,
    aov:           base.aov,  // AOV doesn't need per-day normalisation
    itemsPerOrder: base.itemsPerOrder,
    avgItemPrice:  base.avgItemPrice,
    discountRate:  base.discountRate,
    avgDiscount:   base.avgDiscount,
    newPct:        base.newPct,
  };
  const drop = summarise(dropOrders);

  const Δaov = drop.aov - baseAvg.aov;

  // Additive decomposition: AOV = itemsPerOrder × avgItemPrice
  const basketEffect   = (drop.itemsPerOrder - baseAvg.itemsPerOrder) * baseAvg.avgItemPrice;
  const priceEffect    = baseAvg.itemsPerOrder * (drop.avgItemPrice  - baseAvg.avgItemPrice);
  const discountEffect = -(drop.avgDiscount - baseAvg.avgDiscount);
  const newCustEffect  = -(drop.newPct - baseAvg.newPct) / 100 * baseAvg.aov * 0.20;

  // Product-level changes
  const allSkus = new Set([...Object.keys(drop.skuRev), ...Object.keys(base.skuRev)]);
  const skuBasePerDay = {};
  for (const sku of Object.keys(base.skuRev)) skuBasePerDay[sku] = base.skuRev[sku] / baseN;

  const productChanges = [];
  for (const sku of allSkus) {
    const bRev = skuBasePerDay[sku] || 0;
    const dRev = drop.skuRev[sku]  || 0;
    const name = drop.skuName[sku] || base.skuName?.[sku] || sku;
    if (bRev + dRev < 50) continue;
    productChanges.push({
      sku, name,
      baseRev: +bRev.toFixed(0), dropRev: +dRev.toFixed(0),
      revChange: +(dRev - bRev).toFixed(0),
      pctChange: bRev > 0 ? +((dRev - bRev) / bRev * 100).toFixed(1) : null,
      status: dRev === 0 ? 'disappeared' : bRev === 0 ? 'new' : dRev < bRev * 0.7 ? 'dropped' : dRev > bRev * 1.3 ? 'surged' : 'stable',
    });
  }
  productChanges.sort((a, b) => a.revChange - b.revChange);

  // Channel shift
  const allChannels = new Set([...Object.keys(drop.channelCounts), ...Object.keys(base.channelCounts)]);
  const channelChanges = [];
  for (const ch of allChannels) {
    const bPct = base.orders > 0 ? (base.channelCounts[ch] || 0) / base.orders * 100 : 0;
    const dPct = drop.orders > 0 ? (drop.channelCounts[ch] || 0) / drop.orders * 100 : 0;
    channelChanges.push({ channel: ch, basePct: +bPct.toFixed(1), dropPct: +dPct.toFixed(1), delta: +(dPct - bPct).toFixed(1) });
  }
  channelChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const causes = [
    {
      id: 'basket', label: 'Basket Size',
      desc:   `Items/order: ${baseAvg.itemsPerOrder.toFixed(2)} → ${drop.itemsPerOrder.toFixed(2)}`,
      impact: basketEffect, magnitude: Math.abs(basketEffect),
      direction: basketEffect >= 0 ? 'pos' : 'neg',
      confidence: Math.abs(drop.itemsPerOrder - baseAvg.itemsPerOrder) > 0.15 ? 'high' : Math.abs(drop.itemsPerOrder - baseAvg.itemsPerOrder) > 0.05 ? 'medium' : 'low',
      action: drop.itemsPerOrder < baseAvg.itemsPerOrder
        ? 'Customers are buying fewer items per order. Try bundle promotions, "complete the look" widgets, or free-shipping thresholds.'
        : 'Basket size increased — positive driver.',
    },
    {
      id: 'price_mix', label: 'Product Price Mix',
      desc:   `Avg item price: ₹${baseAvg.avgItemPrice.toFixed(0)} → ₹${drop.avgItemPrice.toFixed(0)}`,
      impact: priceEffect, magnitude: Math.abs(priceEffect),
      direction: priceEffect >= 0 ? 'pos' : 'neg',
      confidence: Math.abs(drop.avgItemPrice - baseAvg.avgItemPrice) > 100 ? 'high' : Math.abs(drop.avgItemPrice - baseAvg.avgItemPrice) > 30 ? 'medium' : 'low',
      action: drop.avgItemPrice < baseAvg.avgItemPrice
        ? 'Cheaper products gained share. Check Product Lens tab for which high-AOV product dropped out.'
        : 'Higher-priced products gaining — AOV positive.',
    },
    {
      id: 'discount', label: 'Discount Pressure',
      desc:   `Avg discount: ₹${baseAvg.avgDiscount.toFixed(0)} → ₹${drop.avgDiscount.toFixed(0)} | Rate: ${baseAvg.discountRate.toFixed(1)}% → ${drop.discountRate.toFixed(1)}%`,
      impact: discountEffect, magnitude: Math.abs(discountEffect),
      direction: discountEffect >= 0 ? 'pos' : 'neg',
      confidence: Math.abs(drop.discountRate - baseAvg.discountRate) > 2 ? 'high' : Math.abs(drop.discountRate - baseAvg.discountRate) > 0.5 ? 'medium' : 'low',
      action: drop.discountRate > baseAvg.discountRate
        ? 'Higher discounts cut into revenue per order. Check which coupon codes spiked and their AOV vs full-price orders.'
        : 'Discount usage decreased — revenue positive.',
    },
    {
      id: 'new_cust', label: 'New vs Repeat Mix',
      desc:   `New customer share: ${baseAvg.newPct.toFixed(0)}% → ${drop.newPct.toFixed(0)}%`,
      impact: newCustEffect, magnitude: Math.abs(newCustEffect),
      direction: newCustEffect >= 0 ? 'pos' : 'neg',
      confidence: Math.abs(drop.newPct - baseAvg.newPct) > 8 ? 'medium' : 'low',
      action: drop.newPct > baseAvg.newPct
        ? 'More new customers (who typically order entry products). If intentional (paid acquisition), acceptable. Watch AOV trend.'
        : 'Repeat customers increased — typically positive for AOV.',
    },
  ].sort((a, b) => b.magnitude - a.magnitude);

  const totalExplained = basketEffect + priceEffect + discountEffect + newCustEffect;

  return {
    dropDate, baselineDays,
    drop, base: baseAvg,
    Δaov: +Δaov.toFixed(0),
    basketEffect: +basketEffect.toFixed(0),
    priceEffect:  +priceEffect.toFixed(0),
    discountEffect: +discountEffect.toFixed(0),
    newCustEffect: +newCustEffect.toFixed(0),
    totalExplained: +totalExplained.toFixed(0),
    unexplained: +(Δaov - totalExplained).toFixed(0),
    causes, productChanges,
    channelChanges: channelChanges.slice(0, 10),
  };
}

/* ─── 4. CHANNEL AOV ────────────────────────────────────────────── */
export function buildChannelAov(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const map = {};
  const seenEmails = {};

  active.forEach(o => {
    const ch  = detectChannel(o);
    const rev = p(o.total_price);
    const disc = p(o.total_discounts);
    const date = o.created_at?.slice(0, 10) || '';
    const email = (o.email || o.customer?.email || '').toLowerCase().trim();
    const lifetimeNew = (o.customer?.orders_count || 1) <= 1;
    const isNew = lifetimeNew && !(email && seenEmails[email]);
    if (email) seenEmails[email] = true;

    if (!map[ch]) map[ch] = {
      channel: ch, orders: 0, revenue: 0, disc: 0,
      newOrders: 0, byDay: {},
    };
    const m = map[ch];
    m.orders++; m.revenue += rev; m.disc += disc;
    if (isNew) m.newOrders++;
    if (!m.byDay[date]) m.byDay[date] = { date, orders: 0, revenue: 0 };
    m.byDay[date].orders++;
    m.byDay[date].revenue += rev;
  });

  return Object.values(map).map(m => ({
    channel:    m.channel,
    orders:     m.orders,
    revenue:    m.revenue,
    aov:        m.orders > 0 ? +(m.revenue / m.orders).toFixed(0) : 0,
    discRate:   m.revenue > 0 ? +(m.disc / m.revenue * 100).toFixed(1) : 0,
    newPct:     m.orders > 0 ? +(m.newOrders / m.orders * 100).toFixed(1) : 0,
    revenueShare: 0, // filled below
    dayTrend: Object.values(m.byDay).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      date: d.date, orders: d.orders, revenue: d.revenue,
      aov: d.orders > 0 ? +(d.revenue / d.orders).toFixed(0) : 0,
    })),
  })).sort((a, b) => b.revenue - a.revenue).map((c, _i, arr) => {
    const total = arr.reduce((s, x) => s + x.revenue, 0);
    return { ...c, revenueShare: total > 0 ? +(c.revenue / total * 100).toFixed(1) : 0 };
  });
}

/* ─── 5. MIX ANALYSIS ───────────────────────────────────────────── */
export function buildMixAnalysis(orders) {
  if (!orders?.length) return { byItemCount: [], weeklyTrend: [], byChannel: [] };
  const active = orders.filter(o => !o.cancelled_at);
  const icMap  = {}, weekMap = {};

  active.forEach(o => {
    const rev   = p(o.total_price);
    const disc  = p(o.total_discounts);
    const items = (o.line_items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const label = items >= 5 ? '5+' : String(items);
    const date  = o.created_at?.slice(0, 10) || '';

    if (!icMap[label]) icMap[label] = { label, orders: 0, revenue: 0, disc: 0 };
    icMap[label].orders++;
    icMap[label].revenue += rev;
    icMap[label].disc    += disc;

    if (date) {
      const dt = new Date(date + 'T00:00:00');
      const dow = dt.getDay();
      const weekStart = new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10);
      if (!weekMap[weekStart]) weekMap[weekStart] = { week: weekStart, orders: 0, revenue: 0, items: 0, single: 0, multi: 0 };
      const w = weekMap[weekStart];
      w.orders++; w.revenue += rev; w.items += items;
      if (items === 1) w.single++; else w.multi++;
    }
  });

  const byItemCount = ['1', '2', '3', '4', '5+'].map(l => {
    const d = icMap[l] || { orders: 0, revenue: 0, disc: 0 };
    return {
      label: `${l} item${l === '1' ? '' : 's'}`,
      orders:   d.orders,
      revenue:  d.revenue,
      aov:      d.orders > 0 ? +(d.revenue / d.orders).toFixed(0) : 0,
      discRate: d.revenue > 0 ? +(d.disc / d.revenue * 100).toFixed(1) : 0,
      sharePct: 0,
    };
  });
  const totalOrders = byItemCount.reduce((s, x) => s + x.orders, 0);
  byItemCount.forEach(r => { r.sharePct = totalOrders > 0 ? +(r.orders / totalOrders * 100).toFixed(1) : 0; });

  const weeklyTrend = Object.values(weekMap).sort((a, b) => a.week.localeCompare(b.week)).map(w => ({
    week: w.week,
    aov: w.orders > 0 ? +(w.revenue / w.orders).toFixed(0) : 0,
    itemsPerOrder: w.orders > 0 ? +(w.items / w.orders).toFixed(2) : 0,
    multiItemPct: w.orders > 0 ? +(w.multi / w.orders * 100).toFixed(1) : 0,
    orders: w.orders,
    revenue: w.revenue,
  }));

  return { byItemCount, weeklyTrend };
}

/* ─── 6. AUTO-DETECT DROP EVENTS ───────────────────────────────── */
export function detectDropEvents(timeline, thresholdPct = 12) {
  return timeline
    .map((d, i) => {
      if (i < 4) return null;
      const prev  = timeline.slice(Math.max(0, i - 7), i);
      const avgAov = prev.reduce((s, x) => s + x.aov, 0) / (prev.length || 1);
      if (!avgAov || !d.aov) return null;
      const dropPct = (avgAov - d.aov) / avgAov * 100;
      if (dropPct < thresholdPct) return null;
      return { ...d, dropPct: +dropPct.toFixed(1), avgAov: +avgAov.toFixed(0), severity: dropPct >= 25 ? 'critical' : dropPct >= 15 ? 'high' : 'medium' };
    })
    .filter(Boolean)
    .sort((a, b) => b.dropPct - a.dropPct);
}

/* ─── 7. BLEND GA DATA ──────────────────────────────────────────── */
export function blendGaWithAov(aovTimeline, gaData) {
  if (!gaData?.dailyTrend?.length) return aovTimeline;
  const gaMap = {};
  gaData.dailyTrend.forEach(d => {
    const date = d.date?.length === 8 ? `${d.date.slice(0,4)}-${d.date.slice(4,6)}-${d.date.slice(6,8)}` : d.date;
    if (date) gaMap[date] = d;
  });
  return aovTimeline.map(d => {
    const ga = gaMap[d.date];
    if (!ga) return d;
    const sessions     = parseFloat(ga.sessions     || 0);
    const conversions  = parseFloat(ga.conversions  || 0);
    const convRate     = sessions > 0 ? conversions / sessions * 100 : 0;
    const bounceRate   = parseFloat(ga.bounceRate   || 0) * 100;
    const avgDuration  = parseFloat(ga.averageSessionDuration || 0);
    return { ...d, sessions, conversions, convRate: +convRate.toFixed(2), bounceRate: +bounceRate.toFixed(1), avgDuration: +avgDuration.toFixed(0) };
  });
}
