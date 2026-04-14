/* ─── RFM SEGMENT COLOURS (used by both ShopifyOrders and ShopifyInsights) ── */

export const RFM_SEGMENT_COLORS = {
  'Champions':      '#22c55e',
  'Loyal':          '#34d399',
  'Potential Loyal':'#3b82f6',
  'New':            '#60a5fa',
  'Promising':      '#a78bfa',
  'At Risk':        '#f59e0b',
  "Can't Lose":     '#fb923c',
  'Dormant':        '#ef4444',
  'Others':         '#64748b',
};

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

  const cancelled = orders.filter(o => !!o.cancelled_at);
  // Sort active orders by date so within-window first-seen detection is accurate
  const active = orders
    .filter(o => !o.cancelled_at)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const N = active.length;
  let totalRev = 0, totalDisc = 0, totalItems = 0, totalShipping = 0;

  // Identity key: order-level email covers guest checkouts; fall back to customer ID.
  // Two orders with the same email = same person even without a customer account.
  const orderKey = o => (o.email || o.customer?.email || '').toLowerCase().trim() || `cid_${o.customer?.id}` || null;

  // Track first-seen per identity key as we iterate (orders are date-sorted)
  const seenInWindow = new Set();

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
    const cid    = o.customer?.id;

    // isNew = true if this order is a first-time acquisition.
    // Uses email as identity key (works for guest checkouts too).
    // Priority:
    //   1. lifetime orders_count > 1 → definitively repeat
    //   2. same email/cid seen earlier in this window → repeat within window
    //   3. first occurrence or no identity → new
    const key = orderKey(o);
    const lifetimeOrders = o.customer?.orders_count;
    const isNew = lifetimeOrders != null
      ? lifetimeOrders <= 1 && !(key && seenInWindow.has(key))
      : !(key && seenInWindow.has(key));
    if (key) seenInWindow.add(key);

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
    if (key) geoMap[prov].custSet.add(key);
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

    // ── customer (keyed by email so guest checkouts are deduplicated)
    const custKey = key || (cid ? `cid_${cid}` : null);
    if (custKey) {
      const email = (o.email || o.customer?.email || '').toLowerCase().trim();
      if (!custMap[custKey]) custMap[custKey] = {
        id: cid || custKey, email,
        firstName: o.customer?.first_name || '',
        lastName: o.customer?.last_name || '',
        lastOrderDate: date, firstOrderDate: date,
        ordersInWindow: 0, revenueInWindow: 0,
        lifetimeOrders: o.customer?.orders_count || 1,
        lifetimeRevenue: p(o.customer?.total_spent),
        joinedAt: o.customer.created_at,
      };
      const c = custMap[custKey];
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

    // ── customer orders for sequence analysis (use email key → catches guest repeats)
    const seqKey = key || (cid ? `cid_${cid}` : null);
    if (seqKey) {
      if (!custOrders[seqKey]) custOrders[seqKey] = [];
      custOrders[seqKey].push({ date: o.created_at || '', skus: uSkus });
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

/* ─── SHOPIFY INSIGHTS ADAPTER FUNCTIONS ────────────────────────── */
// These functions are used by ShopifyInsights.jsx (the 7-tab analytics page).
// Each does a focused single-pass over the raw orders array and returns
// the exact shape the page expects. They are fast enough to run inside
// React's useMemo without noticeable lag even on ~10 000 orders.

const _pad = n => String(n).padStart(2, '0');

/* ── 1. Order summary KPIs ──────────────────────────────────────── */
export function buildOrderSummary(orders) {
  if (!orders?.length) return {
    totalOrders:0, revenue:0, aov:0, uniqueCustomers:0,
    repeatOrders:0, repeatRate:0, refundedOrders:0, refundRate:0,
    discountUsageRate:0, discountImpact:0, newCustomers:0,
  };
  const active = orders.filter(o => !o.cancelled_at);
  const N = active.length;
  let revenue = 0, discount = 0;
  const custSet = new Set();
  let repeatOrders = 0, refundedOrders = 0, discOrders = 0, newCusts = 0;
  active.forEach(o => {
    revenue  += p(o.total_price);
    discount += p(o.total_discounts);
    const key = (o.email||o.customer?.email||'').toLowerCase().trim() || (o.customer?.id ? `c${o.customer.id}` : null);
    if (key) custSet.add(key);
    if ((o.customer?.orders_count||1) > 1) repeatOrders++;
    if ((o.refunds||[]).length > 0) refundedOrders++;
    if (p(o.total_discounts) > 0) discOrders++;
    if ((o.customer?.orders_count||1) <= 1) newCusts++;
  });
  return {
    totalOrders: N, revenue, aov: N>0?revenue/N:0,
    uniqueCustomers: custSet.size,
    repeatOrders, repeatRate: N>0?repeatOrders/N*100:0,
    refundedOrders, refundRate: N>0?refundedOrders/N*100:0,
    discountUsageRate: N>0?discOrders/N*100:0,
    discountImpact: revenue>0?discount/revenue*100:0,
    newCustomers: newCusts,
  };
}

/* ── 2. SKU sales analytics ─────────────────────────────────────── */
export function buildSkuSalesAnalytics(orders, inventoryMap = {}) {
  if (!orders?.length) return [];
  const now = new Date();
  const cutoff7d  = new Date(now - 7  * 86400000).toISOString();
  const cutoff30d = new Date(now - 30 * 86400000).toISOString();
  const active = orders.filter(o => !o.cancelled_at);
  const skuMap = {};
  active.forEach(o => {
    const is7d  = (o.created_at||'') >= cutoff7d;
    const is30d = (o.created_at||'') >= cutoff30d;
    (o.line_items||[]).forEach(item => {
      const sku  = (item.sku||'').trim().toUpperCase() || `pid_${item.product_id}`;
      const qty  = item.quantity || 1;
      const gross = p(item.price) * qty;
      const iDisc = p(item.total_discount);
      const net   = gross - iDisc;
      if (!skuMap[sku]) skuMap[sku] = {
        sku, name: item.title||sku,
        units:0, revenue:0, discount:0, gross:0, orders:0,
        units7d:0, revenue7d:0, units30d:0, revenue30d:0,
        refundedUnits:0, refundedRevenue:0,
      };
      const s = skuMap[sku];
      s.units+=qty; s.revenue+=net; s.discount+=iDisc; s.gross+=gross; s.orders++;
      if (is7d)  { s.units7d+=qty;  s.revenue7d+=net;  }
      if (is30d) { s.units30d+=qty; s.revenue30d+=net; }
    });
    (o.refunds||[]).forEach(rf => {
      (rf.refund_line_items||[]).forEach(rli => {
        const sku = ((rli.line_item?.sku||'').trim().toUpperCase()) || `pid_${rli.line_item?.product_id}`;
        if (skuMap[sku]) { skuMap[sku].refundedUnits+=rli.quantity||0; skuMap[sku].refundedRevenue+=p(rli.subtotal); }
      });
    });
  });
  return Object.values(skuMap).map(s => {
    const inv = inventoryMap[s.sku] || {};
    const dv30 = s.units30d / 30;
    const stock = inv.stock ?? null;
    return {
      sku: s.sku,
      stockTitle: inv.title || s.name,
      unitsSold: s.units,
      revenue: s.revenue,
      revenue30d: s.revenue30d,
      units30d: s.units30d,
      dailyVelocity7d:  +(s.units7d/7).toFixed(2),
      dailyVelocity30d: +dv30.toFixed(2),
      stock,
      daysOfStock: stock!==null && dv30>0 ? Math.round(stock/dv30) : null,
      refundRate:  s.units>0 ? s.refundedUnits/s.units*100 : 0,
      discountRate: s.gross>0 ? s.discount/s.gross*100 : 0,
    };
  }).sort((a,b) => b.revenue - a.revenue);
}

/* ── 3. RFM ─────────────────────────────────────────────────────── */
function _rfmQuintile(items, getValue, lowerBetter = false) {
  const sorted = [...items].sort((a,b) => lowerBetter ? getValue(a)-getValue(b) : getValue(b)-getValue(a));
  const n = sorted.length;
  const map = new Map();
  sorted.forEach((x,i) => map.set(x.id, Math.max(1, Math.ceil((1-i/n)*5))));
  return map;
}

export function computeRfm(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const custMap = {};
  active.forEach(o => {
    const email = (o.email||o.customer?.email||'').toLowerCase().trim();
    const key   = email || (o.customer?.id ? `c${o.customer.id}` : null);
    if (!key) return;
    const date = o.created_at?.slice(0,10);
    const city = o.billing_address?.city || o.shipping_address?.city || '';
    const skus = (o.line_items||[]).map(i=>(i.sku||'').trim().toUpperCase()).filter(Boolean);
    const rev  = p(o.total_price);
    if (!custMap[key]) custMap[key] = {
      id: key, email,
      name: `${o.customer?.first_name||''} ${o.customer?.last_name||''}`.trim() || email.split('@')[0],
      city, orders:0, revenue:0,
      lifetimeOrders: o.customer?.orders_count||1,
      lifetimeRevenue: p(o.customer?.total_spent),
      firstDate: date, lastDate: date, skuSet: new Set(),
    };
    const c = custMap[key];
    c.orders++; c.revenue+=rev;
    if (date > c.lastDate) c.lastDate = date;
    if (date < c.firstDate) c.firstDate = date;
    skus.forEach(s => c.skuSet.add(s));
  });
  const today = new Date();
  const custList = Object.values(custMap).map(c => ({
    ...c,
    recencyDays: c.lastDate ? Math.round((today - new Date(c.lastDate))/86400000) : 999,
    lifespan: c.firstDate&&c.lastDate&&c.firstDate!==c.lastDate
      ? Math.round((new Date(c.lastDate)-new Date(c.firstDate))/86400000) : 0,
    totalSpent:  c.lifetimeRevenue||c.revenue,
    orderCount:  c.lifetimeOrders||c.orders,
    uniqueSkus:  c.skuSet.size,
    aov:         c.orders>0?c.revenue/c.orders:0,
  }));
  const rMap = _rfmQuintile(custList, c=>c.recencyDays, true);
  const fMap = _rfmQuintile(custList, c=>c.orderCount);
  const mMap = _rfmQuintile(custList, c=>c.totalSpent);
  const seg = (r,f,m) => {
    if (r>=4&&f>=4&&m>=4) return 'Champions';
    if (f>=4&&m>=4)       return 'Loyal';
    if (r>=4&&f<=2)       return 'New';
    if (r>=3&&f>=2&&m>=3) return 'Potential Loyal';
    if (r<=2&&f>=3&&m>=3) return 'At Risk';
    if (r<=1&&m>=4)       return "Can't Lose";
    if (r<=2&&f<=2)       return 'Dormant';
    if (r>=3&&f<=2&&m<=2) return 'Promising';
    return 'Others';
  };
  return custList.map(c => {
    const r=rMap.get(c.id)||1, f=fMap.get(c.id)||1, m=mMap.get(c.id)||1;
    const segment = seg(r,f,m);
    return { ...c, r, f, m, rScore:r, fScore:f, mScore:m, segment, segmentColor: RFM_SEGMENT_COLORS[segment]||'#64748b' };
  }).sort((a,b) => b.totalSpent-a.totalSpent);
}

/* ── 4. Cohort retention ────────────────────────────────────────── */
export function buildCohortData(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const custFirstMonth = {}, custMonths = {};
  active.forEach(o => {
    const email = (o.email||o.customer?.email||'').toLowerCase().trim();
    const key   = email || (o.customer?.id ? `c${o.customer.id}` : null);
    if (!key||!o.created_at) return;
    const mo = o.created_at.slice(0,7);
    if (!custFirstMonth[key]||mo<custFirstMonth[key]) custFirstMonth[key] = mo;
    if (!custMonths[key]) custMonths[key] = new Set();
    custMonths[key].add(mo);
  });
  const cohortMap = {};
  Object.entries(custFirstMonth).forEach(([key,cohort]) => {
    if (!cohortMap[cohort]) cohortMap[cohort] = { cohortSize:0, customers:[] };
    cohortMap[cohort].cohortSize++;
    cohortMap[cohort].customers.push(key);
  });
  const months = Object.keys(cohortMap).sort();
  return months.map(cohort => {
    const { cohortSize, customers } = cohortMap[cohort];
    const row = { month:cohort, cohortSize };
    for (let mi = 0; mi < 12; mi++) {
      const [y,m] = cohort.split('-').map(Number);
      const target = new Date(y, m-1+mi);
      if (target > new Date()) { row[`m${mi}`] = null; continue; }
      const tKey = `${target.getFullYear()}-${_pad(target.getMonth()+1)}`;
      const retained = customers.filter(k => custMonths[k]?.has(tKey)).length;
      row[`m${mi}`] = cohortSize>0 ? Math.round(retained/cohortSize*100) : null;
    }
    return row;
  });
}

/* ── 5. Discount analysis ───────────────────────────────────────── */
export function buildDiscountAnalysis(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at);
  const map = {};
  active.forEach(o => {
    const rev  = p(o.total_price);
    const codes = o.discount_codes||[];
    if (codes.length===0) {
      const k = '(no discount)';
      if (!map[k]) map[k]={code:k,orders:0,revenue:0,discount:0};
      map[k].orders++; map[k].revenue+=rev;
    } else {
      codes.forEach(dc => {
        const code = dc.code||'(unknown)';
        if (!map[code]) map[code]={code,orders:0,revenue:0,discount:0};
        map[code].orders++; map[code].revenue+=rev; map[code].discount+=p(dc.amount);
      });
    }
  });
  return Object.values(map).map(d=>({
    code: d.code, orders: d.orders, revenue: d.revenue,
    avgDiscount: d.orders>0?d.discount/d.orders:0,
    aov: d.orders>0?d.revenue/d.orders:0,
    discountRate: d.revenue>0?d.discount/d.revenue*100:0,
  })).sort((a,b)=>b.revenue-a.revenue);
}

/* ── 6. AOV analysis ────────────────────────────────────────────── */
export function buildAovAnalysis(orders) {
  if (!orders?.length) return { byItemCount:[], byMonth:[] };
  const active = orders.filter(o => !o.cancelled_at);
  const icMap = {}, moMap = {};
  active.forEach(o => {
    const rev   = p(o.total_price);
    const disc  = p(o.total_discounts);
    const items = (o.line_items||[]).reduce((s,i)=>s+(i.quantity||1),0);
    const label = items>=5?'5+':String(items);
    if (!icMap[label]) icMap[label]={label,orders:0,total:0};
    icMap[label].orders++; icMap[label].total+=rev;
    const mo = o.created_at?.slice(0,7);
    if (mo) {
      if (!moMap[mo]) moMap[mo]={label:mo,orders:0,total:0,totalDisc:0};
      moMap[mo].orders++; moMap[mo].total+=rev; moMap[mo].totalDisc+=disc;
    }
  });
  const byItemCount = ['1','2','3','4','5+'].map(l => {
    const d = icMap[l]||{orders:0,total:0};
    return { label:`${l} item${l==='1'?'':'s'}`, orders:d.orders, aov:d.orders>0?d.total/d.orders:0 };
  });
  const byMonth = Object.values(moMap).sort((a,b)=>a.label.localeCompare(b.label)).map(m=>({
    label:m.label, orders:m.orders, aov:m.orders>0?m.total/m.orders:0, discounts:m.totalDisc,
  }));
  return { byItemCount, byMonth };
}

/* ── 7. Geo analysis ────────────────────────────────────────────── */
export function buildGeoAnalysis(orders) {
  if (!orders?.length) return { byState:[], byCity:[] };
  const active = orders.filter(o => !o.cancelled_at);
  const stMap={}, ctMap={};
  active.forEach(o => {
    const rev   = p(o.total_price);
    const email = (o.email||o.customer?.email||'').toLowerCase().trim();
    const key   = email || (o.customer?.id?`c${o.customer.id}`:null);
    const state = o.billing_address?.province||o.shipping_address?.province||'Unknown';
    const city  = o.billing_address?.city    ||o.shipping_address?.city    ||'Unknown';
    if (!stMap[state]) stMap[state]={label:state,orders:0,revenue:0,custSet:new Set()};
    stMap[state].orders++; stMap[state].revenue+=rev; if(key) stMap[state].custSet.add(key);
    if (!ctMap[city])  ctMap[city] ={label:city, orders:0,revenue:0,custSet:new Set()};
    ctMap[city].orders++;  ctMap[city].revenue+=rev;  if(key) ctMap[city].custSet.add(key);
  });
  const totalRev = active.reduce((s,o)=>s+p(o.total_price),0)||1;
  const fin = map => Object.values(map).map(r=>({
    label:r.label, orders:r.orders, revenue:r.revenue,
    aov: r.orders>0?r.revenue/r.orders:0,
    customers: r.custSet.size,
    revenueShare: r.revenue/totalRev*100,
  })).sort((a,b)=>b.revenue-a.revenue).slice(0,20);
  return { byState:fin(stMap), byCity:fin(ctMap) };
}

/* ── 8. Timing analysis ─────────────────────────────────────────── */
export function buildTimingAnalysis(orders) {
  if (!orders?.length) return { byHour:[], byDay:[] };
  const active = orders.filter(o => !o.cancelled_at);
  const hMap={}, dMap={};
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  active.forEach(o => {
    if (!o.created_at) return;
    const dt = new Date(o.created_at);
    const rev= p(o.total_price);
    const h  = dt.getHours(), d = dt.getDay();
    if (!hMap[h]) hMap[h]={hour:h,label:`${_pad(h)}:00`,orders:0,revenue:0};
    hMap[h].orders++; hMap[h].revenue+=rev;
    if (!dMap[d]) dMap[d]={day:d,label:DAYS[d],orders:0,revenue:0};
    dMap[d].orders++; dMap[d].revenue+=rev;
  });
  const byHour = Array.from({length:24},(_,h)=>({
    hour:h, label:`${_pad(h)}:00`,
    orders:hMap[h]?.orders||0, revenue:hMap[h]?.revenue||0,
    aov: hMap[h]?.orders>0 ? hMap[h].revenue/hMap[h].orders : 0,
  }));
  const byDay = Array.from({length:7},(_,d)=>({
    day:d, label:DAYS[d],
    orders:dMap[d]?.orders||0, revenue:dMap[d]?.revenue||0,
    aov: dMap[d]?.orders>0 ? dMap[d].revenue/dMap[d].orders : 0,
  }));
  return { byHour, byDay };
}

/* ── 9. Revenue trend by month ──────────────────────────────────── */
export function buildRevenueTrend(orders) {
  if (!orders?.length) return [];
  const active = orders.filter(o => !o.cancelled_at)
    .sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
  const map = {};
  const seenCust = {};
  active.forEach(o => {
    const mo  = o.created_at?.slice(0,7);
    if (!mo) return;
    if (!map[mo]) map[mo]={month:mo,orders:0,revenue:0,newCustomers:0,repeatCustomers:0};
    map[mo].orders++; map[mo].revenue+=p(o.total_price);
    const email = (o.email||o.customer?.email||'').toLowerCase().trim();
    const key   = email || (o.customer?.id?`c${o.customer.id}`:null);
    const isNew = (o.customer?.orders_count||1)<=1 && !(key && seenCust[key]);
    if (key) seenCust[key] = true;
    if (isNew) map[mo].newCustomers++; else map[mo].repeatCustomers++;
  });
  return Object.values(map).sort((a,b)=>a.month.localeCompare(b.month)).map(m=>({
    ...m, aov: m.orders>0?m.revenue/m.orders:0,
  }));
}
