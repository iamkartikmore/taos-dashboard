/* ─── PROCUREMENT ANALYTICS ──────────────────────────────────────────
   PERFORMANCE: buildProcurementTable does a single O(orders) pre-pass to
   index all SKU metrics, then builds the table in O(skus) lookups.
──────────────────────────────────────────────────────────────────── */

/* ─── STOCK HEALTH ────────────────────────────────────────────────── */

export function calcDaysOfInventory(currentStock, velocityPerDay) {
  if (velocityPerDay <= 0) return currentStock > 0 ? 999 : 0;
  return Math.floor(currentStock / velocityPerDay);
}

export function classifyStockHealth(doi, stock) {
  if (stock === 0 || doi === 0) return 'stockout';
  if (doi < 14) return 'critical';
  if (doi < 30) return 'low';
  if (doi < 90) return 'healthy';
  return 'overstock';
}

export const HEALTH_META = {
  stockout:  { label: 'Stockout',  color: '#ef4444', bg: 'bg-red-500/10',    text: 'text-red-400',   ring: 'ring-red-500/30'   },
  critical:  { label: 'Critical',  color: '#f97316', bg: 'bg-orange-500/10', text: 'text-orange-400',ring: 'ring-orange-500/30' },
  low:       { label: 'Low',       color: '#eab308', bg: 'bg-yellow-500/10', text: 'text-yellow-400',ring: 'ring-yellow-500/30' },
  healthy:   { label: 'Healthy',   color: '#22c55e', bg: 'bg-emerald-500/10',text: 'text-emerald-400',ring: 'ring-emerald-500/30'},
  overstock: { label: 'Overstock', color: '#6366f1', bg: 'bg-violet-500/10', text: 'text-violet-400', ring: 'ring-violet-500/30' },
};

/* ─── ORDER INDEX (single-pass pre-computation) ───────────────────── */
// Builds SKU-keyed lookup maps in ONE pass through orders.
// Tracks gross sales + refunds across 7d / 30d / 90d / 365d windows.

function mkSkuEntry() {
  return {
    qty7: 0, qty30: 0, qty90: 0, qty365: 0,          // gross units sold
    rev30: 0, rev90: 0, rev365: 0,                    // gross revenue
    refQty30: 0, refQty365: 0,                        // refunded units
    refRev30: 0, refRev365: 0,                        // refunded revenue
    lastTs: 0,
  };
}

function buildOrderIndex(orders) {
  const now       = Date.now();
  const cutoff7   = now - 7   * 86400000;
  const cutoff30  = now - 30  * 86400000;
  const cutoff90  = now - 90  * 86400000;
  const cutoff365 = now - 365 * 86400000;

  const index = {};

  for (const o of orders) {
    const ts = new Date(o.created_at || o.createdAt).getTime();
    if (isNaN(ts)) continue;
    const isCancelled = !!o.cancelled_at;

    for (const item of (o.line_items || o.lineItems || [])) {
      const sku   = (item.sku || item.SKU || '').trim().toUpperCase();
      if (!sku) continue;
      const qty   = parseInt(item.quantity) || 0;
      const price = parseFloat(item.price)  || 0;

      if (!isCancelled) {
        if (!index[sku]) index[sku] = mkSkuEntry();
        const e = index[sku];
        if (ts > e.lastTs) e.lastTs = ts;
        if (ts >= cutoff7)   e.qty7   += qty;
        if (ts >= cutoff30)  { e.qty30  += qty; e.rev30  += qty * price; }
        if (ts >= cutoff90)  { e.qty90  += qty; e.rev90  += qty * price; }
        if (ts >= cutoff365) { e.qty365 += qty; e.rev365 += qty * price; }
      }
    }

    // Process refunds — use order.created_at for consistent window attribution
    for (const refund of (o.refunds || [])) {
      for (const rli of (refund.refund_line_items || [])) {
        const sku  = ((rli.line_item?.sku || '').trim().toUpperCase());
        if (!sku) continue;
        const rqty = parseInt(rli.quantity) || 0;
        const rrev = parseFloat(rli.subtotal) || 0;

        if (!index[sku]) index[sku] = mkSkuEntry();
        const e = index[sku];
        if (ts >= cutoff30)  { e.refQty30  += rqty; e.refRev30  += rrev; }
        if (ts >= cutoff365) { e.refQty365 += rqty; e.refRev365 += rrev; }
      }
    }
  }

  return index;
}

/* ─── REORDER PLANNING ────────────────────────────────────────────── */

export function calcReorderQty(velocity30, moq = 0, leadTimeDays = 14, restockDays = 45) {
  const needed = velocity30 * restockDays;
  return Math.max(moq, Math.ceil(needed));
}

export function calcReorderPoint(velocity30, leadTimeDays = 14, safetyDays = 7) {
  return velocity30 * (leadTimeDays + safetyDays);
}

// For legacy callers still using these
export function calcSalesVelocity(orders, sku, days = 30) {
  const index = buildOrderIndex(orders);
  const e = index[(sku || '').trim().toUpperCase()];
  if (!e) return 0;
  if (days <= 7)  return e.qty7  / 7;
  if (days <= 30) return e.qty30 / 30;
  return e.qty90 / 90;
}

export function calcSkuRevenue(orders, sku, days = 30) {
  const index = buildOrderIndex(orders);
  const e = index[(sku || '').trim().toUpperCase()];
  if (!e) return 0;
  return days <= 30 ? e.rev30 : e.rev90;
}

/* ─── MAIN PROCUREMENT TABLE ──────────────────────────────────────── */

export function buildProcurementTable(inventoryMap, orders, suppliers = {}) {
  const idx = buildOrderIndex(orders);
  const now = Date.now();
  const rows = [];

  for (const [sku, inv] of Object.entries(inventoryMap)) {
    const sup = suppliers[sku] || {};
    const e   = idx[sku.trim().toUpperCase()] || {};

    const vel7   = (e.qty7   || 0) / 7;
    const vel30  = (e.qty30  || 0) / 30;
    const vel90  = (e.qty90  || 0) / 90;
    const vel365 = (e.qty365 || 0) / 365;

    // Net demand (after refunds) — for 1Y planning
    const netQty365 = Math.max(0, (e.qty365 || 0) - (e.refQty365 || 0));
    const netVel365 = netQty365 / 365;

    // Refund rates
    const refundRate365 = e.qty365 > 0 ? (e.refQty365 || 0) / e.qty365 : 0;
    const refundRate30  = e.qty30  > 0 ? (e.refQty30  || 0) / e.qty30  : 0;

    // Planning velocity: weight long-period data more for annual planning,
    // but lean on recent data when short-term trend diverges significantly.
    // Priority: 365d blend > 90d > 30d
    let planVelocity;
    if (vel365 > 0) {
      planVelocity = vel365 * 0.35 + vel90 * 0.40 + vel30 * 0.25;
    } else if (vel90 > 0) {
      planVelocity = vel90;
    } else {
      planVelocity = vel30;
    }

    const doi    = calcDaysOfInventory(inv.stock, planVelocity);
    const health = classifyStockHealth(doi, inv.stock);

    const leadTime   = sup.leadTimeDays ?? 14;
    const moq        = sup.moq ?? 0;
    const safetyDays = sup.safetyDays ?? 7;
    const costPrice  = sup.costPrice > 0 ? sup.costPrice : (inv.price * 0.4);

    const rop         = calcReorderPoint(planVelocity, leadTime, safetyDays);
    const shouldReorder = inv.stock <= rop && planVelocity > 0;
    const reorderQty  = calcReorderQty(planVelocity, moq, leadTime);

    const inventoryValue = inv.stock * (inv.price || 0);
    const costValue      = inv.stock * (costPrice || 0);

    const lastTs       = e.lastTs || 0;
    const lastSaleDateObj = lastTs ? new Date(lastTs) : null;
    const daysSinceSale   = lastTs ? Math.floor((now - lastTs) / 86400000) : 999;
    const isDead          = daysSinceSale > 90 && inv.stock > 0;

    // Days of stock at 1-year net velocity (more accurate for annual planning)
    const doi365 = netVel365 > 0 ? Math.floor(inv.stock / netVel365) : (inv.stock > 0 ? 999 : 0);

    let priority = 6;
    if      (health === 'stockout')                  priority = 1;
    else if (health === 'critical' && shouldReorder) priority = 2;
    else if (health === 'critical')                  priority = 3;
    else if (health === 'low'      && shouldReorder) priority = 4;
    else if (health === 'low')                       priority = 5;
    else if (isDead)                                 priority = 7;
    else if (health === 'overstock')                 priority = 8;

    rows.push({
      sku,
      title:         inv.title || sku,
      variantTitle:  inv.variantTitle || '',
      productType:   inv.productType  || '',
      stock:         inv.stock,
      price:         inv.price,
      costPrice,
      inventoryValue,
      costValue,
      vel7,
      vel30,
      vel90,
      vel365,
      netVel365,
      planVelocity,
      units30:  Math.round(vel30 * 30),
      qty365:   e.qty365  || 0,
      rev365:   e.rev365  || 0,
      netQty365,
      refQty365: e.refQty365 || 0,
      refQty30:  e.refQty30  || 0,
      refRev365: e.refRev365 || 0,
      refundRate365,
      refundRate30,
      doi,
      doi365,
      health,
      rop:          Math.ceil(rop),
      shouldReorder,
      reorderQty,
      supplier:     sup.supplier || '',
      leadTime,
      moq,
      safetyDays,
      rev30:  e.rev30 || 0,
      rev90:  e.rev90 || 0,
      lastSaleDate: lastSaleDateObj,
      daysSinceSale,
      isDead,
      priority,
      estReorderCost: reorderQty * costPrice,
    });
  }

  rows.sort((a, b) => a.priority - b.priority || a.doi - b.doi);
  return rows;
}

/* ─── SUMMARY KPIs ────────────────────────────────────────────────── */

export function calcProcurementSummary(rows) {
  const totalValue   = rows.reduce((s, r) => s + r.inventoryValue, 0);
  const totalCostVal = rows.reduce((s, r) => s + r.costValue, 0);
  const deadStock    = rows.filter(r => r.isDead);
  const toReorder    = rows.filter(r => r.shouldReorder);
  const overstock    = rows.filter(r => r.health === 'overstock');
  const atRisk       = rows.filter(r => ['critical', 'stockout'].includes(r.health));

  const doiVals = rows.filter(r => r.doi > 0 && r.doi < 999);
  const avgDoi  = doiVals.length > 0
    ? Math.round(doiVals.reduce((s, r) => s + r.doi, 0) / doiVals.length) : 0;

  const totalRev30  = rows.reduce((s, r) => s + r.rev30, 0);
  const totalRev365 = rows.reduce((s, r) => s + r.rev365, 0);
  const totalRefunds365  = rows.reduce((s, r) => s + r.refQty365, 0);
  const totalRefundRev365= rows.reduce((s, r) => s + r.refRev365, 0);
  const highRefundSkus   = rows.filter(r => r.refundRate365 > 0.1 && r.qty365 >= 5).length;

  const estReorderTotal = toReorder.reduce((s, r) => s + r.estReorderCost, 0);

  return {
    totalSkus:       rows.length,
    activeSkus:      rows.filter(r => r.stock > 0 || r.vel30 > 0).length,
    totalValue,
    totalCostVal,
    atRiskCount:     atRisk.length,
    atRiskValue:     atRisk.reduce((s, r) => s + r.inventoryValue, 0),
    deadStockCount:  deadStock.length,
    deadStockValue:  deadStock.reduce((s, r) => s + r.inventoryValue, 0),
    reorderCount:    toReorder.length,
    estReorderTotal,
    overstockCount:  overstock.length,
    overstockValue:  overstock.reduce((s, r) => s + r.inventoryValue, 0),
    avgDoi,
    totalRev30,
    totalRev365,
    totalRefunds365,
    totalRefundRev365,
    highRefundSkus,
    stockoutCount:   rows.filter(r => r.health === 'stockout').length,
  };
}

/* ─── TOP 30 DEMAND ───────────────────────────────────────────────── */
// Returns top 30 SKUs ranked by consumption over the loaded period.
// daysLoaded: how many days of orders are actually available (used to
// annotate extrapolated annualized figures correctly).

export function buildTop30Demand(rows, daysLoaded = 365) {
  // Sort by best available long-period demand signal
  const sorted = [...rows]
    .filter(r => r.qty365 > 0 || r.vel30 > 0)
    .sort((a, b) => {
      // primary: gross units over available history
      const aSignal = a.qty365 || a.vel30 * 30;
      const bSignal = b.qty365 || b.vel30 * 30;
      return bSignal - aSignal;
    })
    .slice(0, 30);

  return sorted.map((r, i) => {
    // Annualised figures — scale from loaded days if < 365
    const scaleFactor  = daysLoaded < 365 ? 365 / daysLoaded : 1;
    const annualGross  = Math.round(r.qty365  * scaleFactor);
    const annualNet    = Math.round(r.netQty365 * scaleFactor);
    const annualRefund = Math.round(r.refQty365 * scaleFactor);

    // How many days of current stock at net 1Y velocity
    const planVel = r.netVel365 > 0 ? r.netVel365
                  : r.vel90 > 0     ? r.vel90
                  : r.vel30;
    const stockDays = planVel > 0 ? Math.floor(r.stock / planVel) : (r.stock > 0 ? 999 : 0);

    // Demand gap: how many units short for next 90 days at plan velocity
    const needed90 = Math.ceil(planVel * 90);
    const gap90    = Math.max(0, needed90 - r.stock);

    // Recommended reorder to cover 90 days + safety buffer
    const recOrder = gap90 > 0 ? gap90 + Math.ceil(planVel * (r.leadTime || 14)) : 0;

    return {
      ...r,
      rank:          i + 1,
      annualGross,
      annualNet,
      annualRefund,
      planVel,
      stockDays,
      gap90,
      recOrder,
      isExtrapolated: daysLoaded < 365,
    };
  });
}

/* ─── REFUND IMPACT ───────────────────────────────────────────────── */
// Returns SKUs with notable refunds, sorted by refund rate descending.
// Useful for identifying quality/fulfilment problems.

export function buildRefundImpact(rows) {
  return [...rows]
    .filter(r => r.refQty365 > 0 && r.qty365 >= 3) // at least 3 sales to be meaningful
    .map(r => ({
      ...r,
      refundPct365:  r.refundRate365 * 100,
      refundPct30:   r.refundRate30  * 100,
      revLost365:    r.refRev365 || 0,
      isCritical:    r.refundRate365 > 0.15,  // >15% rate is a red flag
      isElevated:    r.refundRate365 > 0.08,  // >8% is worth watching
    }))
    .sort((a, b) => b.refundPct365 - a.refundPct365);
}

/* ─── ABC ANALYSIS ────────────────────────────────────────────────── */

export function calcAbcAnalysis(rows, revenueKey = 'rev30') {
  const sorted   = [...rows].sort((a, b) => (b[revenueKey] || 0) - (a[revenueKey] || 0));
  const totalRev = sorted.reduce((s, r) => s + (r[revenueKey] || 0), 0);
  let cumulative = 0;
  return sorted.map(r => {
    cumulative += r[revenueKey] || 0;
    const cumulativePercent = totalRev > 0 ? cumulative / totalRev : 0;
    return { ...r, abc: cumulativePercent <= 0.80 ? 'A' : cumulativePercent <= 0.95 ? 'B' : 'C',
      cumulativeRevenue: cumulative, cumulativePercent };
  });
}

/* ─── VELOCITY TRENDS ─────────────────────────────────────────────── */

export function buildDailyVelocity(orders, skus, days = 30) {
  const normalSkus = new Set(skus.map(s => s.trim().toUpperCase()));
  const cutoffMs   = Date.now() - days * 86400000;
  const dailyMap   = {};

  for (const o of orders) {
    if (o.cancelled_at) continue;
    const d = new Date(o.created_at);
    if (d.getTime() < cutoffMs) continue;
    const dateKey = d.toISOString().slice(0, 10);
    if (!dailyMap[dateKey]) dailyMap[dateKey] = {};
    for (const item of o.line_items || []) {
      const sku = (item.sku || '').trim().toUpperCase();
      if (!normalSkus.has(sku)) continue;
      dailyMap[dateKey][sku] = (dailyMap[dateKey][sku] || 0) + (parseInt(item.quantity) || 0);
    }
  }

  return { dates: Object.keys(dailyMap).sort(), dailyMap };
}

/* ─── TOP / SLOW MOVERS ───────────────────────────────────────────── */

export function getTopMovers(rows, n = 10) {
  return [...rows].sort((a, b) => b.vel30 - a.vel30).slice(0, n);
}

export function getSlowMovers(rows, n = 10) {
  return [...rows].filter(r => r.stock > 0).sort((a, b) => a.vel30 - b.vel30).slice(0, n);
}
