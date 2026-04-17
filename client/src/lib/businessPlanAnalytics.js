/* ─── BUSINESS PLAN ANALYTICS ────────────────────────────────────────
   Seeded from Taos Business Plan Excel (Mar–Dec 2026)
   20% monthly order-volume growth, AOV ₹340 → ₹385
   ─────────────────────────────────────────────────────────────────── */

const DAYS_IN = (year, month) => new Date(year, month, 0).getDate();
const MONTH_KEY = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/* ─── SEED DATA FROM EXCEL ──────────────────────────────────────────── */
export const DEFAULT_PLAN = {
  aov: 340,
  cpr: 55,                        // cost per result
  avgBudgetPerCampaign: 1136,     // ₹/day per campaign
  avgCreativesPerCampaign: 1.75,
  inventoryCostPct: 0.20,         // inventory = 20% of sales value
  grossMarginPct:   0.50,         // ~50% gross margin on plants/seeds
  opsCostPct:       0.12,         // ops (packing, shipping, salaries)

  collectionAlloc: { plants: 0.35, seeds: 0.20, allMix: 0.45 },
  collectionRoas:  { plants: 4.53, seeds: 3.58, allMix: 4.83 },

  // 20% monthly compounding from 800/day in Mar to 4128/day in Dec
  months: [
    { key: '2026-03', label: 'Mar 2026', ordersPerDay:  800, aov: 340, adBudgetPerDay:  44000 },
    { key: '2026-04', label: 'Apr 2026', ordersPerDay:  960, aov: 345, adBudgetPerDay:  52800 },
    { key: '2026-05', label: 'May 2026', ordersPerDay: 1152, aov: 350, adBudgetPerDay:  63360 },
    { key: '2026-06', label: 'Jun 2026', ordersPerDay: 1382, aov: 355, adBudgetPerDay:  76032 },
    { key: '2026-07', label: 'Jul 2026', ordersPerDay: 1658, aov: 360, adBudgetPerDay:  91238 },
    { key: '2026-08', label: 'Aug 2026', ordersPerDay: 1990, aov: 365, adBudgetPerDay: 109486 },
    { key: '2026-09', label: 'Sep 2026', ordersPerDay: 2388, aov: 370, adBudgetPerDay: 131383 },
    { key: '2026-10', label: 'Oct 2026', ordersPerDay: 2866, aov: 375, adBudgetPerDay: 157660 },
    { key: '2026-11', label: 'Nov 2026', ordersPerDay: 3439, aov: 380, adBudgetPerDay: 189192 },
    { key: '2026-12', label: 'Dec 2026', ordersPerDay: 4128, aov: 385, adBudgetPerDay: 227030 },
  ],

  warehouses: [
    { id: 'wh1', name: 'Pune WH1',  location: 'Pune',      capacity: 5000, active: true, notes: 'Primary — all categories',     skuCategories: 'Plants, All Mix' },
    { id: 'wh2', name: 'Pune WH2',  location: 'Pune',      capacity: 3000, active: true, notes: 'Expanding capacity',            skuCategories: 'Plants, All Mix' },
    { id: 'wh3', name: 'Hyderabad', location: 'Hyderabad', capacity: 2000, active: true, notes: 'Seeds & Dawbu — transitioning', skuCategories: 'Seeds, Dawbu' },
  ],
};

/* ─── FORMATTERS ────────────────────────────────────────────────────── */
export function fmtRs(n) {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

export function fmtK(n) {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/* ─── PLAN VS ACTUAL ─────────────────────────────────────────────────── */
export function buildPlanVsActual(plan, shopifyOrders) {
  const byMonth = {};
  (shopifyOrders || []).forEach(order => {
    if (!order.created_at) return;
    const key = order.created_at.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = { revenue: 0, count: 0 };
    byMonth[key].revenue += parseFloat(order.total_price || 0);
    byMonth[key].count++;
  });

  const now = new Date();
  const currentKey = MONTH_KEY(now);

  return plan.months.map(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const days = DAYS_IN(yr, mo);
    const planRevenue = m.ordersPerDay * days * m.aov;
    const planOrders  = m.ordersPerDay * days;

    const actual = byMonth[m.key] || { revenue: 0, count: 0 };
    const isCurrentMonth = m.key === currentKey;
    const isPast = m.key < currentKey;

    const daysElapsed   = isCurrentMonth ? now.getDate() : (isPast ? days : 0);
    const daysRemaining = isCurrentMonth ? days - now.getDate() : (isPast ? 0 : days);

    const actualOrdPerDay  = daysElapsed > 0 ? actual.count / daysElapsed : 0;
    const projectedRevenue = isCurrentMonth && daysElapsed > 0
      ? (actual.revenue / daysElapsed) * days : actual.revenue;
    const projectedOrders  = isCurrentMonth && daysElapsed > 0
      ? (actual.count / daysElapsed) * days : actual.count;

    const pct     = planRevenue > 0 ? (actual.revenue / planRevenue) * 100 : 0;
    const projPct = planRevenue > 0 ? (projectedRevenue / planRevenue) * 100 : 0;
    const compareRev = isPast ? actual.revenue : projectedRevenue;

    const status = !isPast && !isCurrentMonth ? 'future'
      : projPct >= 95 ? 'on-track'
      : projPct >= 75 ? 'behind'
      : isPast ? 'missed' : 'critical';

    return {
      ...m, days, planRevenue, planOrders,
      actualRevenue: actual.revenue, actualOrders: actual.count, actualOrdPerDay,
      projectedRevenue, projectedOrders,
      pct, projPct, daysElapsed, daysRemaining, isCurrentMonth, isPast,
      gap: planRevenue - compareRev, status,
    };
  });
}

/* ─── WEEKLY BREAKDOWN ──────────────────────────────────────────────── */
export function buildWeeklyBreakdown(monthPlan, shopifyOrders) {
  const [yr, mo] = monthPlan.key.split('-').map(Number);
  const days = DAYS_IN(yr, mo);

  const dailyActual = {};
  (shopifyOrders || []).forEach(order => {
    if (!order.created_at?.startsWith(monthPlan.key)) return;
    const day = parseInt(order.created_at.slice(8, 10));
    if (!dailyActual[day]) dailyActual[day] = { revenue: 0, count: 0 };
    dailyActual[day].revenue += parseFloat(order.total_price || 0);
    dailyActual[day].count++;
  });

  const weeks = [];
  let dayNum = 1, weekIdx = 1;
  while (dayNum <= days) {
    const start = dayNum, end = Math.min(dayNum + 6, days);
    const weekDays = end - start + 1;
    let aRev = 0, aOrd = 0;
    for (let d = start; d <= end; d++) { aRev += dailyActual[d]?.revenue || 0; aOrd += dailyActual[d]?.count || 0; }
    const tOrd = monthPlan.ordersPerDay * weekDays;
    weeks.push({
      week: weekIdx,
      label: `Wk ${weekIdx}`,
      dateRange: `${start}–${end}`,
      days: weekDays,
      targetOrders:  Math.round(tOrd),
      targetRevenue: Math.round(tOrd * monthPlan.aov),
      targetBudget:  Math.round(monthPlan.adBudgetPerDay * weekDays),
      actualRevenue: aRev, actualOrders: aOrd,
      pct: tOrd > 0 ? (aOrd / tOrd) * 100 : 0,
    });
    dayNum += 7; weekIdx++;
  }
  return weeks;
}

/* ─── MARKETING NEEDS ────────────────────────────────────────────────── */
export function buildMarketingNeeds(monthPlan, plan) {
  const { adBudgetPerDay } = monthPlan;
  const { cpr, avgBudgetPerCampaign, avgCreativesPerCampaign, collectionAlloc, collectionRoas } = plan;
  const [yr, mo] = monthPlan.key.split('-').map(Number);
  const days = DAYS_IN(yr, mo);

  const campaigns = Math.ceil(adBudgetPerDay / avgBudgetPerCampaign);
  const creatives  = Math.ceil(campaigns * avgCreativesPerCampaign);
  const expectedResults = Math.round(adBudgetPerDay / cpr);

  const collections = Object.entries(collectionAlloc).map(([key, pct]) => ({
    key,
    label: key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1),
    pct, pctDisplay: Math.round(pct * 100),
    budgetPerDay: adBudgetPerDay * pct,
    roas: collectionRoas[key] || 0,
    revenuePerDay: adBudgetPerDay * pct * (collectionRoas[key] || 0),
  }));

  const blendedRoas = collections.reduce((s, c) => s + c.pct * c.roas, 0);

  return {
    adBudgetPerDay, totalMonthlyBudget: adBudgetPerDay * days,
    campaigns, creatives, expectedResults, collections, blendedRoas,
    totalExpectedRevenue: adBudgetPerDay * blendedRoas * days,
  };
}

/* ─── INVENTORY NEEDS ────────────────────────────────────────────────── */
export function buildInventoryNeeds(inventoryMap, shopifyOrders) {
  const now = new Date();
  const thirtyAgo = new Date(now - 30 * 86400000);

  const velocity = {};
  (shopifyOrders || []).forEach(order => {
    if (!order.created_at || new Date(order.created_at) < thirtyAgo) return;
    (order.line_items || []).forEach(item => {
      const sku = item.sku || `pid_${item.product_id}`;
      if (!sku) return;
      velocity[sku] = (velocity[sku] || 0) + (item.quantity || 1);
    });
  });
  Object.keys(velocity).forEach(k => { velocity[k] /= 30; });

  return Object.entries(inventoryMap || {})
    .map(([sku, inv]) => {
      const current = inv._totalStock || 0;
      const vel = velocity[sku] || 0;
      const daysOfStock = vel > 0 ? Math.floor(current / vel) : 999;
      const demandNext30 = Math.round(vel * 30);
      const demandNext60 = Math.round(vel * 60);
      const reorderQty   = Math.max(0, demandNext60 - current);
      const status = current === 0 ? 'oos'
        : daysOfStock < 7  ? 'critical'
        : daysOfStock < 14 ? 'low'
        : daysOfStock < 30 ? 'watch' : 'ok';
      return {
        sku, name: inv.name || inv.title || sku,
        current, vel: parseFloat(vel.toFixed(2)),
        daysOfStock: Math.min(daysOfStock, 999),
        demandNext30, demandNext60, reorderQty, status,
      };
    })
    .filter(r => r.vel > 0 || r.current > 0)
    .sort((a, b) => a.daysOfStock - b.daysOfStock);
}

/* ─── WORKING CAPITAL ────────────────────────────────────────────────── */
export function buildWorkingCapital(plan, planVsActual) {
  return planVsActual.map(pva => {
    const { adBudgetPerDay, days, planRevenue } = pva;
    const inv     = planRevenue * plan.inventoryCostPct;
    const mktSpend = adBudgetPerDay * days;
    const opsCost = planRevenue * plan.opsCostPct;
    const gross   = planRevenue * plan.grossMarginPct;
    const net     = gross - mktSpend - opsCost;
    const upfrontNeed = inv + mktSpend * 0.30;
    return {
      ...pva, inventoryInvestment: inv, marketingSpend: mktSpend,
      opsCost, grossMargin: gross, netProfit: net,
      scenarios: [
        { pct: 20, label: '20%', capital: planRevenue * 0.20, gap: Math.max(0, upfrontNeed - planRevenue * 0.20), color: '#ef4444' },
        { pct: 40, label: '40%', capital: planRevenue * 0.40, gap: Math.max(0, upfrontNeed - planRevenue * 0.40), color: '#f59e0b' },
        { pct: 60, label: '60%', capital: planRevenue * 0.60, gap: Math.max(0, upfrontNeed - planRevenue * 0.60), color: '#22c55e' },
      ],
    };
  });
}

/* ─── PREDICTIONS / TREND ────────────────────────────────────────────── */
export function buildPredictions(plan, shopifyOrders) {
  const now = new Date();
  const currentKey = MONTH_KEY(now);

  const dailyData = {};
  (shopifyOrders || []).forEach(order => {
    if (!order.created_at) return;
    const d = order.created_at.slice(0, 10);
    if (!dailyData[d]) dailyData[d] = { orders: 0, revenue: 0 };
    dailyData[d].orders++;
    dailyData[d].revenue += parseFloat(order.total_price || 0);
  });

  const sorted = Object.entries(dailyData).sort((a, b) => a[0].localeCompare(b[0]));
  const avg = (arr) => arr.length ? arr.reduce((s, [, v]) => s + v.orders, 0) / arr.length : 0;
  const avg7  = avg(sorted.slice(-7));
  const avg14 = avg(sorted.slice(-14));
  const avg30 = avg(sorted.slice(-30));

  const trend = avg14 > 0 ? (avg7 - avg14) / avg14 : 0;
  const trendLabel = trend > 0.05 ? 'Accelerating ↑' : trend < -0.05 ? 'Decelerating ↓' : 'Stable →';
  const trendColor  = trend > 0.05 ? '#22c55e' : trend < -0.05 ? '#ef4444' : '#94a3b8';

  const currentPlan = plan.months.find(m => m.key === currentKey);
  const [yr, mo] = currentKey.split('-').map(Number);
  const daysInMonth = DAYS_IN(yr, mo);
  const daysElapsed = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed;

  const monthActual = sorted
    .filter(([d]) => d.startsWith(currentKey))
    .reduce((s, [, v]) => ({ orders: s.orders + v.orders, revenue: s.revenue + v.revenue }),
      { orders: 0, revenue: 0 });

  const eomOrders  = monthActual.orders  + avg7 * daysRemaining;
  const eomRevenue = monthActual.revenue + avg7 * daysRemaining * (currentPlan?.aov || plan.aov);
  const planTarget = currentPlan ? currentPlan.ordersPerDay * daysInMonth : 0;
  const gapPct = planTarget > 0 ? ((eomOrders - planTarget) / planTarget) * 100 : 0;

  const forecast = plan.months.filter(m => m.key >= currentKey).slice(0, 4).map((m, i) => {
    const [myr, mmo] = m.key.split('-').map(Number);
    const mdays = DAYS_IN(myr, mmo);
    const factor = Math.pow(1 + trend * 0.5, i);
    const fOrders = avg7 * mdays * factor;
    return {
      label: m.label,
      forecastOrders:  Math.round(fOrders),
      forecastRevenue: Math.round(fOrders * m.aov),
      planRevenue:     m.ordersPerDay * mdays * m.aov,
      planOrders:      m.ordersPerDay * mdays,
      gapPct: m.ordersPerDay > 0 ? ((fOrders / mdays - m.ordersPerDay) / m.ordersPerDay) * 100 : 0,
    };
  });

  const recentDays = sorted.slice(-30).map(([d, v]) => ({
    date: d.slice(5), orders: v.orders, revenue: Math.round(v.revenue),
  }));

  return {
    avg7: Math.round(avg7 * 10) / 10,
    avg14: Math.round(avg14 * 10) / 10,
    avg30: Math.round(avg30 * 10) / 10,
    trend: Math.round(trend * 1000) / 10,
    trendLabel, trendColor,
    eomOrders: Math.round(eomOrders),
    eomRevenue: Math.round(eomRevenue),
    planTarget, gapPct: Math.round(gapPct * 10) / 10,
    daysRemaining, monthActual, forecast, recentDays,
    currentPlan,
  };
}
