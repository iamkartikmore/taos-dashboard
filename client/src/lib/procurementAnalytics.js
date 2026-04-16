/* ─── PROCUREMENT ANALYTICS ──────────────────────────────────────────
   PERFORMANCE: buildProcurementTable does a single O(orders) pre-pass to
   index all SKU metrics, then builds the table in O(skus) lookups.
   This replaces the original O(skus × orders × 6) approach.
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
// Called once in buildProcurementTable — all subsequent lookups are O(1).

function buildOrderIndex(orders) {
  const now = Date.now();
  const cutoff7  = now - 7  * 86400000;
  const cutoff30 = now - 30 * 86400000;
  const cutoff90 = now - 90 * 86400000;

  // { sku → { qty7, qty30, qty90, rev30, rev90, lastTs } }
  const index = {};

  for (const o of orders) {
    if (o.cancelled_at) continue;
    const ts = new Date(o.created_at || o.createdAt).getTime();
    if (isNaN(ts)) continue;

    for (const item of (o.line_items || o.lineItems || [])) {
      const raw = (item.sku || item.SKU || '').trim().toUpperCase();
      if (!raw) continue;
      const qty   = parseInt(item.quantity) || 0;
      const price = parseFloat(item.price) || 0;

      if (!index[raw]) index[raw] = { qty7: 0, qty30: 0, qty90: 0, rev30: 0, rev90: 0, lastTs: 0 };
      const e = index[raw];

      if (ts > e.lastTs) e.lastTs = ts;
      if (ts >= cutoff7)  e.qty7  += qty;
      if (ts >= cutoff30) { e.qty30 += qty; e.rev30 += qty * price; }
      if (ts >= cutoff90) { e.qty90 += qty; e.rev90 += qty * price; }
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
  // Single O(orders × line_items) pass — all SKU metrics pre-computed
  const idx = buildOrderIndex(orders);
  const now = Date.now();
  const rows = [];

  for (const [sku, inv] of Object.entries(inventoryMap)) {
    const sup  = suppliers[sku] || {};
    const e    = idx[sku.trim().toUpperCase()] || {};

    const vel7  = (e.qty7  || 0) / 7;
    const vel30 = (e.qty30 || 0) / 30;
    const vel90 = (e.qty90 || 0) / 90;
    const planVelocity = vel30 > 0 ? vel30 : vel90;

    const doi    = calcDaysOfInventory(inv.stock, planVelocity);
    const health = classifyStockHealth(doi, inv.stock);

    const leadTime   = sup.leadTimeDays ?? 14;
    const moq        = sup.moq ?? 0;
    const safetyDays = sup.safetyDays ?? 7;
    const costPrice  = sup.costPrice > 0 ? sup.costPrice : (inv.price * 0.4);

    const rop        = calcReorderPoint(planVelocity, leadTime, safetyDays);
    const shouldReorder = inv.stock <= rop && planVelocity > 0;
    const reorderQty = calcReorderQty(planVelocity, moq, leadTime);

    const rev30 = e.rev30 || 0;
    const rev90 = e.rev90 || 0;

    const inventoryValue = inv.stock * (inv.price || 0);
    const costValue      = inv.stock * (costPrice || 0);

    const lastTs       = e.lastTs || 0;
    const lastSaleDateObj = lastTs ? new Date(lastTs) : null;
    const daysSinceSale   = lastTs ? Math.floor((now - lastTs) / 86400000) : 999;
    const isDead       = daysSinceSale > 90 && inv.stock > 0;

    let priority = 6;
    if      (health === 'stockout')                         priority = 1;
    else if (health === 'critical' && shouldReorder)        priority = 2;
    else if (health === 'critical')                         priority = 3;
    else if (health === 'low'      && shouldReorder)        priority = 4;
    else if (health === 'low')                              priority = 5;
    else if (isDead)                                        priority = 7;
    else if (health === 'overstock')                        priority = 8;

    rows.push({
      sku,
      title:         inv.title || sku,
      variantTitle:  inv.variantTitle || '',
      productType:   inv.productType || '',
      stock:         inv.stock,
      price:         inv.price,
      costPrice,
      inventoryValue,
      costValue,
      vel7,
      vel30,
      vel90,
      planVelocity,
      units30:       Math.round(vel30 * 30),
      doi,
      health,
      rop:           Math.ceil(rop),
      shouldReorder,
      reorderQty,
      supplier:      sup.supplier || '',
      leadTime,
      moq,
      safetyDays,
      rev30,
      rev90,
      lastSaleDate:  lastSaleDateObj,
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

  const totalRev30 = rows.reduce((s, r) => s + r.rev30, 0);
  const estReorderTotal = toReorder.reduce((s, r) => s + r.estReorderCost, 0);

  return {
    totalSkus:      rows.length,
    activeSkus:     rows.filter(r => r.stock > 0 || r.vel30 > 0).length,
    totalValue,
    totalCostVal,
    atRiskCount:    atRisk.length,
    atRiskValue:    atRisk.reduce((s, r) => s + r.inventoryValue, 0),
    deadStockCount: deadStock.length,
    deadStockValue: deadStock.reduce((s, r) => s + r.inventoryValue, 0),
    reorderCount:   toReorder.length,
    estReorderTotal,
    overstockCount: overstock.length,
    overstockValue: overstock.reduce((s, r) => s + r.inventoryValue, 0),
    avgDoi,
    totalRev30,
    stockoutCount:  rows.filter(r => r.health === 'stockout').length,
  };
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
