/* ─── DATE WINDOWS ───────────────────────────────────────────────── */

export function getWindowDates(w, cSince, cUntil) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const shift = days => new Date(now - days * 86400000);

  switch (w) {
    case 'today': {
      const t = iso(now);
      return { since: `${t}T00:00:00`, until: now.toISOString() };
    }
    case 'yesterday': {
      const y = shift(1); const d = iso(y);
      return { since: `${d}T00:00:00`, until: `${d}T23:59:59` };
    }
    case '7d':        return { since: shift(7).toISOString(),  until: now.toISOString() };
    case '14d':       return { since: shift(14).toISOString(), until: now.toISOString() };
    case '30d':       return { since: shift(30).toISOString(), until: now.toISOString() };
    case 'last_month': {
      const yr = now.getMonth() === 0 ? now.getFullYear()-1 : now.getFullYear();
      const mo = now.getMonth() === 0 ? 12 : now.getMonth();
      const last = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      return { since: `${yr}-${pad(mo)}-01T00:00:00`, until: `${yr}-${pad(mo)}-${pad(last)}T23:59:59` };
    }
    case 'custom': return { since: cSince || shift(7).toISOString(), until: cUntil || now.toISOString() };
    default:       return { since: shift(7).toISOString(), until: now.toISOString() };
  }
}

/* ─── HELPERS ────────────────────────────────────────────────────── */

const p = v => parseFloat(v || 0);

function getReferrer(site) {
  if (!site) return 'direct';
  try {
    const url = site.includes('://') ? site : `https://${site}`;
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (!h) return 'direct';
    if (h.includes('google')) return 'google';
    if (h.includes('facebook') || h.includes('fb.')) return 'facebook';
    if (h.includes('instagram')) return 'instagram';
    if (h.includes('youtube')) return 'youtube';
    if (h.includes('pinterest')) return 'pinterest';
    return h;
  } catch { return 'direct'; }
}

function quintileScore(items, getValue, lowerBetter = false) {
  const sorted = [...items].sort((a, b) => lowerBetter ? getValue(a) - getValue(b) : getValue(b) - getValue(a));
  const n = sorted.length;
  const map = new Map();
  sorted.forEach((x, i) => map.set(x.id, Math.max(1, Math.ceil((1 - i / n) * 5))));
  return map;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function percentile(arr, pct) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * pct / 100)] || 0;
}

/* ─── MAIN PROCESSOR ─────────────────────────────────────────────── */

export function processShopifyOrders(orders, inventoryMap = {}) {
  if (!orders?.length) return null;

  const active    = orders.filter(o => !o.cancelled_at);
  const cancelled = orders.filter(o => !!o.cancelled_at);
  const N = active.length;
  let totalRev = 0, totalDisc = 0, totalItems = 0, totalShipping = 0;

  // Accumulator maps
  const custMap     = {};
  const skuMap      = {};
  const discMap     = {};
  const dayMap      = {};
  const hourMap     = {};
  const geoMap      = {};
  const cityMap     = {};
  const srcMap      = {};
  const payMap      = {};   // payment gateway
  const refMap      = {};   // referring site
  const crossSell   = {};   // pair co-occurrence counts
  const tripMap     = {};   // triplet co-occurrence counts
  const skuOrdCnt   = {};   // SKU → # distinct orders containing it (for lift)
  const custOrders  = {};   // cid → [{date, skus}] for sequence analysis
  const fulfillTimes = [];  // hours from creation to first fulfillment
  const cancelMap   = {};   // cancel_reason → count + revenue

  active.forEach(o => {
    const rev    = p(o.total_price);
    const disc   = p(o.total_discounts);
    const ship   = p(o.total_shipping_price_set?.shop_money?.amount) || p(o.shipping_lines?.[0]?.price);
    const date   = o.created_at?.slice(0, 10);
    const hour   = o.created_at ? new Date(o.created_at).getHours() : null;
    const isNew  = (o.customer?.orders_count || 1) <= 1;
    const cid    = o.customer?.id;

    totalRev      += rev;
    totalDisc     += disc;
    totalShipping += ship;

    // ── daily
    if (date) {
      if (!dayMap[date]) dayMap[date] = { date, orders: 0, revenue: 0, newOrders: 0, discount: 0, shipping: 0 };
      dayMap[date].orders++;
      dayMap[date].revenue  += rev;
      dayMap[date].discount += disc;
      dayMap[date].shipping += ship;
      if (isNew) dayMap[date].newOrders++;
    }

    // ── hour
    if (hour !== null) {
      if (!hourMap[hour]) hourMap[hour] = { hour, orders: 0, revenue: 0 };
      hourMap[hour].orders++;
      hourMap[hour].revenue += rev;
    }

    // ── geo
    const prov = o.billing_address?.province || o.shipping_address?.province || 'Unknown';
    const city = o.billing_address?.city     || o.shipping_address?.city     || 'Unknown';
    if (!geoMap[prov]) geoMap[prov] = { province: prov, orders: 0, revenue: 0, custSet: new Set() };
    geoMap[prov].orders++; geoMap[prov].revenue += rev;
    if (cid) geoMap[prov].custSet.add(cid);
    if (!cityMap[city]) cityMap[city] = { city, orders: 0, revenue: 0 };
    cityMap[city].orders++; cityMap[city].revenue += rev;

    // ── source (source_name)
    const src = o.source_name || 'web';
    if (!srcMap[src]) srcMap[src] = { source: src, orders: 0, revenue: 0 };
    srcMap[src].orders++; srcMap[src].revenue += rev;

    // ── payment gateway
    const gw = (o.payment_gateway_names?.[0] || o.payment_gateway || 'unknown').toLowerCase();
    if (!payMap[gw]) payMap[gw] = { gateway: gw, orders: 0, revenue: 0, newOrders: 0 };
    payMap[gw].orders++; payMap[gw].revenue += rev;
    if (isNew) payMap[gw].newOrders++;

    // ── referring site
    const ref = getReferrer(o.referring_site);
    if (!refMap[ref]) refMap[ref] = { source: ref, orders: 0, revenue: 0, newOrders: 0 };
    refMap[ref].orders++; refMap[ref].revenue += rev;
    if (isNew) refMap[ref].newOrders++;

    // ── customer
    if (cid) {
      if (!custMap[cid]) custMap[cid] = {
        id: cid, email: o.customer.email || '',
        firstName: o.customer.first_name || '',
        lastName: o.customer.last_name || '',
        lastOrderDate: date, firstOrderDate: date,
        ordersInWindow: 0, revenueInWindow: 0,
        lifetimeOrders: o.customer.orders_count || 1,
        lifetimeRevenue: p(o.customer.total_spent),
        joinedAt: o.customer.created_at,
      };
      const c = custMap[cid];
      c.ordersInWindow++;
      c.revenueInWindow += rev;
      if (date > c.lastOrderDate) c.lastOrderDate = date;
      if (date < c.firstOrderDate) c.firstOrderDate = date;
    }

    // ── discounts
    (o.discount_codes || []).forEach(dc => {
      const code = dc.code || '(none)';
      if (!discMap[code]) discMap[code] = { code, uses: 0, grossRevenue: 0, discountTotal: 0, ordSet: new Set(), newUses: 0 };
      discMap[code].uses++;
      discMap[code].grossRevenue  += rev;
      discMap[code].discountTotal += p(dc.amount);
      discMap[code].ordSet.add(o.id);
      if (isNew) discMap[code].newUses++;
    });

    // ── line items → SKU
    const orderSkus = [];
    (o.line_items || []).forEach(item => {
      const sku   = (item.sku || '').trim().toUpperCase() || `pid_${item.product_id}`;
      const qty   = item.quantity || 1;
      const gross = p(item.price) * qty;
      const iDisc = p(item.total_discount);
      const net   = gross - iDisc;

      totalItems += qty;
      orderSkus.push(sku);

      if (!skuMap[sku]) skuMap[sku] = {
        sku, name: item.title || sku,
        revenue: 0, grossRevenue: 0, units: 0,
        orders: 0, discount: 0,
        newOrders: 0, repeatOrders: 0,
        refundedUnits: 0, refundedRevenue: 0,
        soloOrders: 0, bundleOrders: 0,
      };
      const s = skuMap[sku];
      s.revenue      += net;
      s.grossRevenue += gross;
      s.units        += qty;
      s.orders++;
      s.discount     += iDisc;
      if (isNew) s.newOrders++; else s.repeatOrders++;
    });

    // ── refunds
    (o.refunds || []).forEach(rf => {
      (rf.refund_line_items || []).forEach(rli => {
        const sku = ((rli.line_item?.sku || '').trim().toUpperCase()) || `pid_${rli.line_item?.product_id}`;
        if (skuMap[sku]) {
          skuMap[sku].refundedUnits   += rli.quantity || 0;
          skuMap[sku].refundedRevenue += p(rli.subtotal);
        }
      });
    });

    const uSkus = [...new Set(orderSkus)];
    const isMulti = uSkus.length > 1;

    // ── solo/bundle per SKU
    uSkus.forEach(sku => {
      if (skuMap[sku]) {
        if (isMulti) skuMap[sku].bundleOrders++;
        else skuMap[sku].soloOrders++;
      }
    });

    // ── per-SKU order count (for lift)
    uSkus.forEach(s => { skuOrdCnt[s] = (skuOrdCnt[s] || 0) + 1; });

    // ── pairs
    for (let i = 0; i < uSkus.length; i++)
      for (let j = i + 1; j < uSkus.length; j++) {
        const k = [uSkus[i], uSkus[j]].sort().join('|');
        crossSell[k] = (crossSell[k] || 0) + 1;
      }

    // ── triplets
    if (uSkus.length >= 3) {
      for (let i = 0; i < uSkus.length; i++)
        for (let j = i + 1; j < uSkus.length; j++)
          for (let k = j + 1; k < uSkus.length; k++) {
            const key = [uSkus[i], uSkus[j], uSkus[k]].sort().join('||');
            tripMap[key] = (tripMap[key] || 0) + 1;
          }
    }

    // ── customer orders for sequence analysis
    if (cid) {
      if (!custOrders[cid]) custOrders[cid] = [];
      custOrders[cid].push({ date: o.created_at || '', skus: uSkus });
    }

    // ── fulfillment velocity
    if (o.fulfillments?.length > 0 && o.fulfillments[0].created_at) {
      const hrs = (new Date(o.fulfillments[0].created_at) - new Date(o.created_at)) / 3600000;
      if (hrs >= 0 && hrs < 720) fulfillTimes.push(hrs);
    }
  });

  /* ── Cancelled orders analysis ─────────────────────────────────── */
  cancelled.forEach(o => {
    const reason = o.cancel_reason || 'unknown';
    if (!cancelMap[reason]) cancelMap[reason] = { reason, count: 0, revenue: 0 };
    cancelMap[reason].count++;
    cancelMap[reason].revenue += p(o.total_price);
  });

  /* ── Post-process ────────────────────────────────────────────────── */

  const dailyTrend = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  const days       = Math.max(dailyTrend.length, 1);

  // SKU list with inventory + metrics
  const skuList = Object.values(skuMap).map(s => {
    const inv     = inventoryMap[s.sku] || {};
    const dailyU  = s.units / days;
    const stock   = inv.stock ?? null;
    return {
      ...s,
      productName:   inv.title || s.name,
      stock,
      daysRunway:    stock !== null && dailyU > 0 ? Math.round(stock / dailyU) : null,
      dailyUnits:    +dailyU.toFixed(2),
      aov:           s.orders > 0 ? s.revenue / s.orders : 0,
      discountRate:  s.grossRevenue > 0 ? s.discount / s.grossRevenue * 100 : 0,
      refundRate:    s.units > 0 ? s.refundedUnits / s.units * 100 : 0,
      newPct:        s.orders > 0 ? s.newOrders / s.orders * 100 : 0,
      netRevenue:    s.revenue - s.refundedRevenue,
      soloRate:      s.orders > 0 ? s.soloOrders / s.orders * 100 : 0,
      bundleRate:    s.orders > 0 ? s.bundleOrders / s.orders * 100 : 0,
      // entry SKU = high new-customer purchase rate
      // retention SKU = high repeat-customer purchase rate
      skuRole:       s.orders > 0
        ? (s.newOrders / s.orders >= 0.6 ? 'entry' : s.repeatOrders / s.orders >= 0.6 ? 'retention' : 'mixed')
        : 'mixed',
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Discount list
  const discList = Object.values(discMap).map(d => ({
    code: d.code, uses: d.uses,
    grossRevenue: d.grossRevenue,
    discountTotal: d.discountTotal,
    uniqueOrders: d.ordSet.size,
    newUses: d.newUses,
    repeatUses: d.uses - d.newUses,
    newPct: d.uses > 0 ? d.newUses / d.uses * 100 : 0,
    discountRate: d.grossRevenue > 0 ? d.discountTotal / d.grossRevenue * 100 : 0,
    avgDisc: d.uses > 0 ? d.discountTotal / d.uses : 0,
  })).sort((a, b) => b.grossRevenue - a.grossRevenue);

  const geoList  = Object.values(geoMap).map(g => ({ province: g.province, orders: g.orders, revenue: g.revenue, customers: g.custSet.size })).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  const cityList = Object.values(cityMap).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  const srcList  = Object.values(srcMap).sort((a, b) => b.revenue - a.revenue);
  const payList  = Object.values(payMap).sort((a, b) => b.orders - a.orders);
  const referList = Object.values(refMap).sort((a, b) => b.orders - a.orders).slice(0, 20);
  const cancelList = Object.values(cancelMap).sort((a, b) => b.count - a.count);

  // Cross-sell pairs with lift + confidence + support
  const crossSellList = Object.entries(crossSell)
    .filter(([, cnt]) => cnt >= 2)
    .map(([pair, count]) => {
      const [s1, s2] = pair.split('|');
      const lift = N > 0 ? (count * N) / ((skuOrdCnt[s1] || 1) * (skuOrdCnt[s2] || 1)) : 0;
      const conf1 = (count / (skuOrdCnt[s1] || 1)) * 100;
      const conf2 = (count / (skuOrdCnt[s2] || 1)) * 100;
      return {
        sku1: s1, sku2: s2, count,
        lift: +lift.toFixed(2),
        conf1: +conf1.toFixed(1),
        conf2: +conf2.toFixed(1),
        supportPct: +(count / N * 100).toFixed(2),
      };
    })
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 60);

  // Triplets
  const tripletList = Object.entries(tripMap)
    .filter(([, c]) => c >= 2)
    .map(([combo, count]) => ({
      combo,
      skus: combo.split('||'),
      count,
      supportPct: +(count / N * 100).toFixed(2),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // Purchase sequences (repeat customer journeys within window)
  const seqMap = {};
  Object.values(custOrders).forEach(ordList => {
    if (ordList.length < 2) return;
    ordList.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < ordList.length - 1; i++) {
      const from = ordList[i].skus;
      const to   = ordList[i + 1].skus;
      from.forEach(f => to.forEach(t => {
        if (f !== t) {
          const key = `${f}|||${t}`;
          seqMap[key] = (seqMap[key] || 0) + 1;
        }
      }));
    }
  });
  const sequenceList = Object.entries(seqMap)
    .map(([key, count]) => {
      const [from, to] = key.split('|||');
      return { from, to, count, fromName: skuMap[from]?.name || from, toName: skuMap[to]?.name || to };
    })
    .filter(s => s.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  /* ── CAC Reducer Scoring ─────────────────────────────────────────── */
  // How much each SKU helps reduce Customer Acquisition Cost:
  //
  //  Acquisition power  (0–35 pts): % of buyers who are NEW customers.
  //                                  High = this SKU is an acquisition vehicle.
  //  Discount efficiency (0–25 pts): Lower discount rate = converts without bribing.
  //                                  High = CAC isn't inflated by promos.
  //  LTV unlock          (0–25 pts): How often this SKU appears as the "from" SKU
  //                                  in repeat-purchase sequences. Buying this SKU
  //                                  leads customers back → spreads fixed CAC over
  //                                  multiple orders.
  //  Volume reliability  (0–15 pts): Enough orders to trust the signal (>= 20 orders).

  const seqFromCount = {};
  sequenceList.forEach(s => { seqFromCount[s.from] = (seqFromCount[s.from] || 0) + s.count; });
  const maxSeqFrom = Math.max(...Object.values(seqFromCount), 1);
  const maxOrders  = Math.max(...skuList.map(s => s.orders), 1);

  skuList.forEach(s => {
    const acqScore   = (s.newPct / 100) * 35;
    const discEff    = ((100 - Math.min(s.discountRate, 100)) / 100) * 25;
    const ltvScore   = ((seqFromCount[s.sku] || 0) / maxSeqFrom) * 25;
    const volScore   = (Math.min(s.orders, 20) / 20) * 15;
    const total      = Math.round(acqScore + discEff + ltvScore + volScore);

    s.cacScore       = total;
    s.cacAcqScore    = Math.round(acqScore);
    s.cacDiscScore   = Math.round(discEff);
    s.cacLtvScore    = Math.round(ltvScore);
    s.cacVolScore    = Math.round(volScore);
    s.cacFromCount   = seqFromCount[s.sku] || 0;
    // Interpretation label
    s.cacLabel       = total >= 75 ? 'Top Reducer'
                     : total >= 55 ? 'Strong'
                     : total >= 35 ? 'Moderate'
                     : 'Weak';
  });

  const cacReducers = [...skuList].sort((a, b) => b.cacScore - a.cacScore).slice(0, 30);

  // Fulfillment stats
  fulfillTimes.sort((a, b) => a - b);
  const fulfillStats = fulfillTimes.length ? {
    count:      fulfillTimes.length,
    avg:        +(fulfillTimes.reduce((s, v) => s + v, 0) / fulfillTimes.length).toFixed(1),
    median:     +median(fulfillTimes).toFixed(1),
    p90:        +percentile(fulfillTimes, 90).toFixed(1),
    under24h:   fulfillTimes.filter(t => t < 24).length,
    under48h:   fulfillTimes.filter(t => t < 48).length,
    over72h:    fulfillTimes.filter(t => t > 72).length,
  } : null;

  // Hourly data (full 24h)
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: h, label: `${String(h).padStart(2, '0')}:00`,
    orders:  hourMap[h]?.orders  || 0,
    revenue: hourMap[h]?.revenue || 0,
  }));

  /* ── RFM ─────────────────────────────────────────────────────────── */
  const custList = Object.values(custMap);
  const today    = new Date();
  const rfmRaw   = custList.map(c => ({
    ...c,
    recencyDays: c.lastOrderDate ? Math.round((today - new Date(c.lastOrderDate)) / 86400000) : 999,
  }));

  const rMap = quintileScore(rfmRaw, c => c.recencyDays, true);
  const fMap = quintileScore(rfmRaw, c => c.lifetimeOrders);
  const mMap = quintileScore(rfmRaw, c => c.lifetimeRevenue);

  const seg = (r, f, m) => {
    if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
    if (f >= 4 && m >= 4)           return 'Loyal';
    if (r >= 4 && f <= 2)           return 'New';
    if (r >= 3 && f >= 2 && m >= 3) return 'Potential Loyal';
    if (r <= 2 && f >= 3 && m >= 3) return 'At Risk';
    if (r <= 1 && m >= 4)           return "Can't Lose";
    if (r <= 2 && f <= 2)           return 'Dormant';
    if (r >= 3 && f <= 2 && m <= 2) return 'Promising';
    return 'Others';
  };

  const rfmData = rfmRaw.map(c => {
    const r = rMap.get(c.id) || 1, f = fMap.get(c.id) || 1, m = mMap.get(c.id) || 1;
    return { ...c, rScore: r, fScore: f, mScore: m, rfmScore: r * 100 + f * 10 + m, segment: seg(r, f, m) };
  });

  const segMap = {};
  rfmData.forEach(c => {
    if (!segMap[c.segment]) segMap[c.segment] = { segment: c.segment, count: 0, revenue: 0 };
    segMap[c.segment].count++;
    segMap[c.segment].revenue += c.lifetimeRevenue;
  });
  const segments = Object.values(segMap)
    .map(s => ({ ...s, avgLTV: s.count > 0 ? s.revenue / s.count : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  const topCustomers = [...rfmData].sort((a, b) => b.revenueInWindow - a.revenueInWindow).slice(0, 100);

  // LTV distribution buckets
  const ltvBuckets = [
    { label: '<₹500',   min: 0,     max: 500 },
    { label: '₹500-2k', min: 500,   max: 2000 },
    { label: '₹2k-5k',  min: 2000,  max: 5000 },
    { label: '₹5k-10k', min: 5000,  max: 10000 },
    { label: '₹10k-25k',min: 10000, max: 25000 },
    { label: '>₹25k',   min: 25000, max: Infinity },
  ].map(b => ({
    ...b,
    count: custList.filter(c => c.lifetimeRevenue >= b.min && c.lifetimeRevenue < b.max).length,
  }));

  // Frequency distribution
  const freqBuckets = [1, 2, 3, 4, 5].map(n => ({
    label: n < 5 ? `${n}x` : '5x+',
    count: custList.filter(c => n < 5 ? c.lifetimeOrders === n : c.lifetimeOrders >= 5).length,
  }));

  /* ── Overview ────────────────────────────────────────────────────── */
  const refundedOrders    = active.filter(o => (o.refunds || []).length > 0).length;
  const ordersWithDisc    = active.filter(o => p(o.total_discounts) > 0).length;
  const newCustOrders     = active.filter(o => (o.customer?.orders_count || 1) <= 1).length;
  const repeatRevenue     = active.filter(o => (o.customer?.orders_count || 1) > 1).reduce((s, o) => s + p(o.total_price), 0);
  const multiItemOrders   = active.filter(o => (o.line_items || []).length > 1).length;

  return {
    overview: {
      orders: N,
      revenue: totalRev,
      aov: N > 0 ? totalRev / N : 0,
      discount: totalDisc,
      shipping: totalShipping,
      discountRate:        totalRev > 0 ? totalDisc / totalRev * 100 : 0,
      discountedOrderPct:  N > 0 ? ordersWithDisc / N * 100 : 0,
      uniqueCustomers:     custList.length,
      newCustomerOrders:   newCustOrders,
      newCustomerPct:      N > 0 ? newCustOrders / N * 100 : 0,
      repeatRevenuePct:    totalRev > 0 ? repeatRevenue / totalRev * 100 : 0,
      avgItemsPerOrder:    N > 0 ? totalItems / N : 0,
      multiItemOrderPct:   N > 0 ? multiItemOrders / N * 100 : 0,
      refundedOrders,
      refundRate:          N > 0 ? refundedOrders / N * 100 : 0,
      cancelledCount:      cancelled.length,
      cancelRate:          orders.length > 0 ? cancelled.length / orders.length * 100 : 0,
      days,
      dailyRevenue:        totalRev / days,
      dailyOrders:         N / days,
    },
    skuList, cacReducers, rfmData, segments, topCustomers,
    discList, dailyTrend, hourlyData,
    geoList, cityList, srcList,
    payList, referList, cancelList,
    crossSellList, tripletList, sequenceList,
    fulfillStats,
    ltvBuckets, freqBuckets,
  };
}
