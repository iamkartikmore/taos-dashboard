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

function quintileScore(items, getValue, lowerBetter = false) {
  const sorted = [...items].sort((a, b) => lowerBetter ? getValue(a) - getValue(b) : getValue(b) - getValue(a));
  const n = sorted.length;
  const map = new Map();
  sorted.forEach((x, i) => map.set(x.id, Math.max(1, Math.ceil((1 - i / n) * 5))));
  return map;
}

/* ─── MAIN PROCESSOR — single pass ──────────────────────────────── */

export function processShopifyOrders(orders, inventoryMap = {}) {
  if (!orders?.length) return null;

  const active = orders.filter(o => !o.cancelled_at);
  const N = active.length;
  let totalRev = 0, totalDisc = 0, totalItems = 0;

  const custMap   = {};
  const skuMap    = {};
  const discMap   = {};
  const dayMap    = {};
  const hourMap   = {};
  const geoMap    = {};
  const cityMap   = {};
  const srcMap    = {};
  const crossSell = {};

  active.forEach(o => {
    const rev   = p(o.total_price);
    const disc  = p(o.total_discounts);
    const date  = o.created_at?.slice(0, 10);
    const hour  = o.created_at ? new Date(o.created_at).getHours() : null;
    const isNew = (o.customer?.orders_count || 1) <= 1;
    const cid   = o.customer?.id;

    totalRev  += rev;
    totalDisc += disc;

    // daily
    if (date) {
      if (!dayMap[date]) dayMap[date] = { date, orders: 0, revenue: 0, newOrders: 0, discount: 0 };
      dayMap[date].orders++;
      dayMap[date].revenue  += rev;
      dayMap[date].discount += disc;
      if (isNew) dayMap[date].newOrders++;
    }

    // hour
    if (hour !== null) {
      if (!hourMap[hour]) hourMap[hour] = { hour, orders: 0, revenue: 0 };
      hourMap[hour].orders++;
      hourMap[hour].revenue += rev;
    }

    // geo
    const prov = o.billing_address?.province || o.shipping_address?.province || 'Unknown';
    const city = o.billing_address?.city     || o.shipping_address?.city     || 'Unknown';
    if (!geoMap[prov]) geoMap[prov] = { province: prov, orders: 0, revenue: 0, custSet: new Set() };
    geoMap[prov].orders++; geoMap[prov].revenue += rev;
    if (cid) geoMap[prov].custSet.add(cid);
    if (!cityMap[city]) cityMap[city] = { city, orders: 0, revenue: 0 };
    cityMap[city].orders++; cityMap[city].revenue += rev;

    // source
    const src = o.source_name || 'web';
    if (!srcMap[src]) srcMap[src] = { source: src, orders: 0, revenue: 0 };
    srcMap[src].orders++; srcMap[src].revenue += rev;

    // customer
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

    // discounts
    (o.discount_codes || []).forEach(dc => {
      const code = dc.code || '(none)';
      if (!discMap[code]) discMap[code] = { code, uses: 0, grossRevenue: 0, discountTotal: 0, ordSet: new Set() };
      discMap[code].uses++;
      discMap[code].grossRevenue += rev;
      discMap[code].discountTotal += p(dc.amount);
      discMap[code].ordSet.add(o.id);
    });

    // line items → SKU
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
      };
      const s = skuMap[sku];
      s.revenue      += net;
      s.grossRevenue += gross;
      s.units        += qty;
      s.orders++;
      s.discount     += iDisc;
      if (isNew) s.newOrders++; else s.repeatOrders++;
    });

    // refunds
    (o.refunds || []).forEach(rf => {
      (rf.refund_line_items || []).forEach(rli => {
        const sku = ((rli.line_item?.sku || '').trim().toUpperCase()) || `pid_${rli.line_item?.product_id}`;
        if (skuMap[sku]) {
          skuMap[sku].refundedUnits   += rli.quantity || 0;
          skuMap[sku].refundedRevenue += p(rli.subtotal);
        }
      });
    });

    // cross-sell
    const uSkus = [...new Set(orderSkus)];
    for (let i = 0; i < uSkus.length; i++)
      for (let j = i+1; j < uSkus.length; j++) {
        const k = [uSkus[i], uSkus[j]].sort().join('|');
        crossSell[k] = (crossSell[k] || 0) + 1;
      }
  });

  /* ── Post-process ────────────────────────────────────────────── */

  const dailyTrend = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  const days       = Math.max(dailyTrend.length, 1);

  const skuList = Object.values(skuMap).map(s => {
    const inv       = inventoryMap[s.sku] || {};
    const dailyU    = s.units / days;
    const stock     = inv.stock ?? null;
    return {
      ...s,
      productName:  inv.title || s.name,
      stock,
      daysRunway:   stock !== null && dailyU > 0 ? Math.round(stock / dailyU) : null,
      dailyUnits:   +dailyU.toFixed(2),
      aov:          s.orders > 0 ? s.revenue / s.orders : 0,
      discountRate: s.grossRevenue > 0 ? s.discount / s.grossRevenue * 100 : 0,
      refundRate:   s.units > 0 ? s.refundedUnits / s.units * 100 : 0,
      newPct:       s.orders > 0 ? s.newOrders / s.orders * 100 : 0,
      netRevenue:   s.revenue - s.refundedRevenue,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const discList = Object.values(discMap).map(d => ({
    code: d.code, uses: d.uses,
    grossRevenue: d.grossRevenue,
    discountTotal: d.discountTotal,
    uniqueOrders: d.ordSet.size,
    discountRate: d.grossRevenue > 0 ? d.discountTotal / d.grossRevenue * 100 : 0,
    avgDisc: d.uses > 0 ? d.discountTotal / d.uses : 0,
  })).sort((a, b) => b.grossRevenue - a.grossRevenue);

  const geoList  = Object.values(geoMap).map(g => ({ province: g.province, orders: g.orders, revenue: g.revenue, customers: g.custSet.size })).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const cityList = Object.values(cityMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const srcList  = Object.values(srcMap).sort((a, b) => b.revenue - a.revenue);

  const crossSellList = Object.entries(crossSell)
    .map(([pair, count]) => { const [s1, s2] = pair.split('|'); return { sku1: s1, sku2: s2, count }; })
    .sort((a, b) => b.count - a.count).slice(0, 20);

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: h, label: `${String(h).padStart(2,'0')}:00`,
    orders: hourMap[h]?.orders || 0,
    revenue: hourMap[h]?.revenue || 0,
  }));

  /* ── RFM ─────────────────────────────────────────────────────── */
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

  const rfmData = rfmRaw.map(c => {
    const r = rMap.get(c.id)||1, f = fMap.get(c.id)||1, m = mMap.get(c.id)||1;
    return { ...c, rScore: r, fScore: f, mScore: m, rfmScore: r*100+f*10+m, segment: seg(r,f,m) };
  });

  const segMap = {};
  rfmData.forEach(c => {
    if (!segMap[c.segment]) segMap[c.segment] = { segment: c.segment, count: 0, revenue: 0 };
    segMap[c.segment].count++;
    segMap[c.segment].revenue += c.lifetimeRevenue;
  });
  const segments = Object.values(segMap)
    .map(s => ({ ...s, avgLTV: s.count > 0 ? s.revenue/s.count : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  const topCustomers = [...rfmData].sort((a, b) => b.revenueInWindow - a.revenueInWindow).slice(0, 50);

  /* ── Overview ────────────────────────────────────────────────── */
  const refundedOrders  = active.filter(o => (o.refunds||[]).length > 0).length;
  const ordersWithDisc  = active.filter(o => p(o.total_discounts) > 0).length;
  const newCustOrders   = active.filter(o => (o.customer?.orders_count||1) <= 1).length;
  const repeatRevenue   = active.filter(o => (o.customer?.orders_count||1) > 1).reduce((s,o) => s + p(o.total_price), 0);

  return {
    overview: {
      orders: N,
      revenue: totalRev,
      aov: N > 0 ? totalRev / N : 0,
      discount: totalDisc,
      discountRate:        totalRev > 0 ? totalDisc / totalRev * 100 : 0,
      discountedOrderPct:  N > 0 ? ordersWithDisc / N * 100 : 0,
      uniqueCustomers:     custList.length,
      newCustomerOrders:   newCustOrders,
      newCustomerPct:      N > 0 ? newCustOrders / N * 100 : 0,
      repeatRevenuePct:    totalRev > 0 ? repeatRevenue / totalRev * 100 : 0,
      avgItemsPerOrder:    N > 0 ? totalItems / N : 0,
      refundedOrders,
      refundRate:          N > 0 ? refundedOrders / N * 100 : 0,
      cancelledCount:      orders.length - N,
      days,
      dailyRevenue:        totalRev / days,
      dailyOrders:         N / days,
    },
    skuList, rfmData, segments, topCustomers,
    discList, dailyTrend, hourlyData,
    geoList, cityList, srcList, crossSellList,
  };
}
