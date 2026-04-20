/* ─── BUSINESS PLAN ANALYTICS v2 ─────────────────────────────────────
   Deep engine: stages · scenarios · seasonality · cohorts · creatives
   procurement EOQ · stage roadmap · CSV export
   ──────────────────────────────────────────────────────────────────── */

const DAYS_IN   = (year, month) => new Date(year, month, 0).getDate();
const MONTH_KEY = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ─── GROWTH STAGES ─────────────────────────────────────────────────── */
export const STAGES = [
  {
    id: 'seed', name: 'Seed', min: 0, max: 400, color: '#818cf8', badge: '🌱',
    description: 'Build foundation — find winning creatives, prove unit economics',
    requirements: {
      ordersPerDay: 400, campaigns: 15, creatives: 26,
      warehouses: 1, whCapacity: 2000, workingCapital: 500000,
      teamSize: 3, adBudgetPerDay: 22000, blendedRoas: 3.5, cpr: 60,
    },
    milestones: [
      '3+ winning creatives per collection',
      '2 profitable collections generating ROAS >3.5x',
      '30-day inventory buffer on top 10 SKUs',
      '₹5L working capital deployed',
      'CPR below ₹60 consistently',
      '400 orders/day for 14 consecutive days',
    ],
    priorities: [
      'Find 3 winning creatives before scaling budget beyond ₹22K/day',
      'Build 30-day inventory buffer for top 10 SKUs',
      'Establish Pune WH1 SOPs — packing, QC, dispatch timelines',
      'Achieve <₹60 CPR on best-performing collection',
      'Hit 400 orders/day consistently for 14 days',
    ],
    creativePlaybook: [
      'Test 5 hook variations per concept — measure 3-sec hold rate',
      'UGC product-in-use beats studio shots 2–3x on CTR',
      'Plant transformation before/after = highest engagement format',
      'Problem→solution: small space, gifting, home décor angles',
      'Video under 15s; hook lands in first 3 seconds',
    ],
  },
  {
    id: 'growth', name: 'Growth', min: 400, max: 1200, color: '#22c55e', badge: '📈',
    description: 'Scale what works — more budget, more creatives, expand capacity',
    requirements: {
      ordersPerDay: 1200, campaigns: 42, creatives: 74,
      warehouses: 2, whCapacity: 5000, workingCapital: 1500000,
      teamSize: 8, adBudgetPerDay: 66000, blendedRoas: 4.0, cpr: 55,
    },
    milestones: [
      '42+ active campaigns across all collections',
      '2 warehouses operational (Pune WH1 + WH2)',
      '5,000 unit throughput capacity',
      '₹15L working capital deployed',
      'Repeat purchase rate above 25%',
      'ROAS above 4.0x blended',
    ],
    priorities: [
      'Activate Pune WH2 — scale to 5K+ daily capacity',
      'Publish 5+ new creatives per week per collection',
      'Build retention: email + WhatsApp post-purchase sequences',
      'Hire ops manager + 2 packing staff',
      'Negotiate 30-day payment terms with top 3 suppliers',
    ],
    creativePlaybook: [
      'Scale winners: same hook, new product angle + fresh audience',
      '5 new videos/week — customer testimonials as top format',
      'Seasonal content: gifting, home refresh, monsoon plant care',
      'Retargeting: cart abandonment + social proof overlay',
      'ATC retargeting: ₹50–80 CPR acceptable for warm audiences',
    ],
  },
  {
    id: 'accelerate', name: 'Accelerate', min: 1200, max: 3000, color: '#f59e0b', badge: '🚀',
    description: 'Expand geography, supply chain, and creative engine at scale',
    requirements: {
      ordersPerDay: 3000, campaigns: 100, creatives: 175,
      warehouses: 3, whCapacity: 12000, workingCapital: 5000000,
      teamSize: 20, adBudgetPerDay: 165000, blendedRoas: 4.5, cpr: 50,
    },
    milestones: [
      '100+ campaigns live across all collections',
      '3 warehouses — Pune x2 + Hyderabad online',
      '12,000 unit capacity (south India coverage)',
      '₹50L working capital deployed',
      'Supply chain lead time under 7 days',
      'ROAS above 4.5x blended, CPR below ₹50',
    ],
    priorities: [
      'Activate Hyderabad WH — D+1 delivery for south India',
      'Negotiate 60-day vendor credit with key suppliers',
      'Video creative machine: 10+ per week, launch creator program',
      'Dynamic CPM bidding — expand winning audience segments',
      'EOQ-based procurement: 60-day pipeline per SKU',
    ],
    creativePlaybook: [
      '10+ video creatives/week — UGC + scripted mix',
      'Creator program: 20+ monthly UGC submissions',
      'Collection-specific landing pages (CVR +20-30%)',
      'Influencer seeding: build organic pools for retargeting',
      'Lookalike audiences from best customers (LTV >₹1K)',
    ],
  },
  {
    id: 'dominate', name: 'Dominate', min: 3000, max: Infinity, color: '#ef4444', badge: '👑',
    description: 'Category leader — brand moat, subscriptions, B2B channels',
    requirements: {
      ordersPerDay: 5000, campaigns: 200, creatives: 350,
      warehouses: 5, whCapacity: 30000, workingCapital: 15000000,
      teamSize: 50, adBudgetPerDay: 275000, blendedRoas: 5.0, cpr: 45,
    },
    milestones: [
      '200+ campaigns live, ₹2.75L/day ad budget',
      '5 warehouses pan-India (Pune x2, Hyd, Delhi, Bangalore)',
      '30,000 unit capacity, <24hr dispatch all metro cities',
      '₹1.5Cr working capital deployed',
      'Repeat rate above 40%, subscription program live',
      'ROAS above 5.0x blended',
    ],
    priorities: [
      'Open Delhi NCR + Bangalore warehouses (north + south hubs)',
      'Launch membership/subscription for repeat plant buyers',
      'Build proprietary creative testing framework',
      'Wholesale/B2B: corporate gifting + interior designers',
      'Direct import supply chain for exotic/rare plants',
    ],
    creativePlaybook: [
      'Brand story content: founder journey, nursery origins, team',
      'YouTube care guides (SEO + brand equity + remarketing pool)',
      'Ambassador program: 50+ micro-influencers, monthly fresh content',
      'Co-branded drops with premium lifestyle/home décor brands',
      'Community content: plant parent stories, seasonal showcases',
    ],
  },
];

export function detectGrowthStage(avgOrdersPerDay) {
  const v = parseFloat(avgOrdersPerDay) || 0;
  return STAGES.find(s => v >= s.min && v < s.max) || STAGES[0];
}

/* ─── DEFAULT PLAN ───────────────────────────────────────────────────── */
export const DEFAULT_PLAN = {
  /* ── TAOS Business Plan — Mar–Dec 2026 ── */
  aov: 340,
  cpr: 55,
  avgBudgetPerCampaign:    1136,
  avgCreativesPerCampaign: 1.75,
  inventoryCostPct: 0.20,
  grossMarginPct:   0.50,
  opsCostPct:       0.12,

  /* ── RTO model inputs ── */
  codPct:            0.60,
  rtoRateCOD:        0.28,
  rtoRatePrepaid:    0.06,
  forwardShipping:   65,
  reverseLogistics:  60,
  restockingCost:    25,
  damageWriteoff:    20,

  /* ── Contribution stack inputs ── */
  gatewayFeePct:     0.029,
  gatewayFeeFixed:   3,
  pickPackCost:      15,
  packagingCost:     8,

  /* ── Inventory ── */
  defaultLeadTimeDays: 45,

  collectionAlloc: { plants: 0.35, seeds: 0.20, allMix: 0.45 },
  collectionRoas:  { plants: 4.53, seeds: 3.58, allMix: 4.83 },

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
    { id: 'wh1', name: 'Pune WH1',  location: 'Pune',      capacity: 5000, active: true,  orderTag: '1', notes: 'Primary — all categories',     skuCategories: 'Plants, All Mix' },
    { id: 'wh2', name: 'Pune WH2',  location: 'Pune',      capacity: 3000, active: true,  orderTag: '8', notes: 'Expanding capacity',            skuCategories: 'Plants, All Mix' },
    { id: 'wh3', name: 'Hyderabad', location: 'Hyderabad', capacity: 2000, active: false, orderTag: '9', notes: 'Seeds hub — activate at scale', skuCategories: 'Seeds' },
  ],
};

/* ── Generic plan seed for non-TAOS brands ──────────────────────────── */
export const GENERIC_PLAN = {
  aov: 300, cpr: 60,
  avgBudgetPerCampaign: 1000, avgCreativesPerCampaign: 2,
  inventoryCostPct: 0.20, grossMarginPct: 0.50, opsCostPct: 0.12,
  codPct: 0.60, rtoRateCOD: 0.28, rtoRatePrepaid: 0.06,
  forwardShipping: 65, reverseLogistics: 60, restockingCost: 25, damageWriteoff: 20,
  gatewayFeePct: 0.029, gatewayFeeFixed: 3, pickPackCost: 15, packagingCost: 8,
  defaultLeadTimeDays: 45,
  collectionAlloc: { colA: 0.40, colB: 0.35, colC: 0.25 },
  collectionRoas:  { colA: 4.0,  colB: 3.5,  colC: 4.5  },
  months: DEFAULT_PLAN.months.map(m => ({ ...m })),
  warehouses: [],
};

/* ── Parse warehouse:N tags from orders ─────────────────────────────── */
export function parseWarehouseTags(orders = []) {
  const map = {};
  orders.forEach(o => {
    const tags = (o.tags || '').split(',').map(t => t.trim().toLowerCase());
    const whTag = tags.find(t => /^warehouse:\d+$/.test(t));
    if (!whTag) return;
    const num = whTag.split(':')[1];
    if (!map[num]) map[num] = { tagNum: num, orders: 0, revenue: 0 };
    map[num].orders++;
    map[num].revenue += parseFloat(o.total_price || o.totalPrice || 0);
  });
  return map;
}

/* Helper: get collectionAlloc-style object from plan.collections array */
export function collectionAllocObj(plan) {
  const cols = plan.collections || [];
  const obj = {};
  cols.forEach(c => { obj[c.key] = c.alloc; });
  return obj;
}
export function collectionRoasObj(plan) {
  const cols = plan.collections || [];
  const obj = {};
  cols.forEach(c => { obj[c.key] = c.roas; });
  return obj;
}

/* ─── FORMATTERS ─────────────────────────────────────────────────────── */
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

/* ─── CSV EXPORT ─────────────────────────────────────────────────────── */
export function downloadCsv(filename, rows, headers) {
  const esc = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach(row => lines.push(headers.map(h => esc(row[h] ?? '')).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── LINEAR REGRESSION ──────────────────────────────────────────────── */
export function linReg(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0] || 0, r2: 0, stderr: 0, yMean: points[0] || 0 };
  const xMean = (n - 1) / 2;
  const yMean = points.reduce((a, b) => a + b, 0) / n;
  const ssXX  = points.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const ssXY  = points.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0);
  const ssYY  = points.reduce((s, y)    => s + (y - yMean) ** 2, 0);
  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;
  const r2    = ssYY > 0 ? Math.min(1, (ssXY ** 2) / (ssXX * ssYY)) : 0;
  const sse   = points.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
  const stderr = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  return { slope, intercept, r2, stderr, yMean, n };
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

  return (plan.months || []).map(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const days = DAYS_IN(yr, mo);
    const planRevenue = m.ordersPerDay * days * m.aov;
    const planOrders  = m.ordersPerDay * days;
    const actual = byMonth[m.key] || { revenue: 0, count: 0 };
    const isCurrentMonth = m.key === currentKey;
    const isPast = m.key < currentKey;
    const daysElapsed    = isCurrentMonth ? now.getDate() : (isPast ? days : 0);
    const daysRemaining  = isCurrentMonth ? days - now.getDate() : (isPast ? 0 : days);
    const actualOrdPerDay = daysElapsed > 0 ? actual.count / daysElapsed : 0;
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
      projectedRevenue, projectedOrders, pct, projPct,
      daysElapsed, daysRemaining, isCurrentMonth, isPast,
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
      week: weekIdx, label: `Wk ${weekIdx}`, dateRange: `${start}–${end}`,
      days: weekDays,
      targetOrders: Math.round(tOrd), targetRevenue: Math.round(tOrd * monthPlan.aov),
      targetBudget: Math.round(monthPlan.adBudgetPerDay * weekDays),
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
  const { cpr, avgBudgetPerCampaign, avgCreativesPerCampaign } = plan;
  const [yr, mo] = monthPlan.key.split('-').map(Number);
  const days = DAYS_IN(yr, mo);
  const campaigns      = Math.ceil(adBudgetPerDay / avgBudgetPerCampaign);
  const creatives      = Math.ceil(campaigns * avgCreativesPerCampaign);
  const expectedResults = Math.round(adBudgetPerDay / cpr);

  /* support both new collections array and legacy collectionAlloc/collectionRoas objects */
  const rawCols = plan.collections?.length
    ? plan.collections.map(c => ({ key: c.key, label: c.label, pct: c.alloc, roas: c.roas, color: c.color }))
    : Object.entries(plan.collectionAlloc || {}).map(([key, pct]) => ({
        key, pct, roas: (plan.collectionRoas || {})[key] || 0,
        label: key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1),
      }));

  const collections = rawCols.map(c => ({
    ...c,
    pctDisplay: Math.round(c.pct * 100),
    budgetPerDay: adBudgetPerDay * c.pct,
    revenuePerDay: adBudgetPerDay * c.pct * c.roas,
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
    const inv      = planRevenue * plan.inventoryCostPct;
    const mktSpend = adBudgetPerDay * days;
    const opsCost  = planRevenue * plan.opsCostPct;
    const gross    = planRevenue * plan.grossMarginPct;
    const net      = gross - mktSpend - opsCost;
    const upfrontNeed = inv + mktSpend * 0.30;
    return {
      ...pva, inventoryInvestment: inv, marketingSpend: mktSpend,
      opsCost, grossMargin: gross, netProfit: net, upfrontNeed,
      scenarios: [
        { pct: 20, label: '20%', capital: planRevenue * 0.20, gap: Math.max(0, upfrontNeed - planRevenue * 0.20), color: '#ef4444' },
        { pct: 40, label: '40%', capital: planRevenue * 0.40, gap: Math.max(0, upfrontNeed - planRevenue * 0.40), color: '#f59e0b' },
        { pct: 60, label: '60%', capital: planRevenue * 0.60, gap: Math.max(0, upfrontNeed - planRevenue * 0.60), color: '#22c55e' },
      ],
    };
  });
}

/* ─── BASIC PREDICTIONS (backward compat) ────────────────────────────── */
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
  const avgOf  = arr => arr.length ? arr.reduce((s, [, v]) => s + v.orders, 0) / arr.length : 0;
  const avg7   = avgOf(sorted.slice(-7));
  const avg14  = avgOf(sorted.slice(-14));
  const avg30  = avgOf(sorted.slice(-30));
  const trend  = avg14 > 0 ? (avg7 - avg14) / avg14 : 0;
  const trendLabel = trend > 0.05 ? 'Accelerating ↑' : trend < -0.05 ? 'Decelerating ↓' : 'Stable →';
  const trendColor = trend > 0.05 ? '#22c55e' : trend < -0.05 ? '#ef4444' : '#94a3b8';
  const planMonths_ = plan.months || [];
  const currentPlan = planMonths_.find(m => m.key === currentKey);
  const [yr, mo] = currentKey.split('-').map(Number);
  const daysInMonth  = DAYS_IN(yr, mo);
  const daysElapsed  = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed;
  const monthActual = sorted
    .filter(([d]) => d.startsWith(currentKey))
    .reduce((s, [, v]) => ({ orders: s.orders + v.orders, revenue: s.revenue + v.revenue }), { orders: 0, revenue: 0 });
  const eomOrders  = monthActual.orders  + avg7 * daysRemaining;
  const eomRevenue = monthActual.revenue + avg7 * daysRemaining * (currentPlan?.aov || plan.aov);
  const planTarget = currentPlan ? currentPlan.ordersPerDay * daysInMonth : 0;
  const gapPct = planTarget > 0 ? ((eomOrders - planTarget) / planTarget) * 100 : 0;
  const forecast = planMonths_.filter(m => m.key >= currentKey).slice(0, 4).map((m, i) => {
    const [myr, mmo] = m.key.split('-').map(Number);
    const mdays = DAYS_IN(myr, mmo);
    const factor = Math.pow(1 + trend * 0.5, i);
    const fOrders = avg7 * mdays * factor;
    return {
      label: m.label,
      forecastOrders: Math.round(fOrders), forecastRevenue: Math.round(fOrders * m.aov),
      planRevenue: m.ordersPerDay * mdays * m.aov, planOrders: m.ordersPerDay * mdays,
      gapPct: m.ordersPerDay > 0 ? ((fOrders / mdays - m.ordersPerDay) / m.ordersPerDay) * 100 : 0,
    };
  });
  const recentDays = sorted.slice(-30).map(([d, v]) => ({
    date: d.slice(5), orders: v.orders, revenue: Math.round(v.revenue),
  }));
  return {
    avg7: Math.round(avg7 * 10) / 10, avg14: Math.round(avg14 * 10) / 10, avg30: Math.round(avg30 * 10) / 10,
    trend: Math.round(trend * 1000) / 10, trendLabel, trendColor,
    eomOrders: Math.round(eomOrders), eomRevenue: Math.round(eomRevenue),
    planTarget, gapPct: Math.round(gapPct * 10) / 10,
    daysRemaining, monthActual, forecast, recentDays, currentPlan,
  };
}

/* ─── SEASONALITY ─────────────────────────────────────────────────────── */
export function buildSeasonality(shopifyOrders) {
  const dowOrders = Array(7).fill(0);
  const dowDays   = Array(7).fill(0);
  const seenDates = new Set();
  const monthly   = {};

  (shopifyOrders || []).forEach(order => {
    if (!order.created_at) return;
    const d   = new Date(order.created_at);
    const dow = d.getDay();
    const ds  = order.created_at.slice(0, 10);
    dowOrders[dow]++;
    if (!seenDates.has(ds)) { seenDates.add(ds); dowDays[dow]++; }
    const mk = order.created_at.slice(0, 7);
    if (!monthly[mk]) monthly[mk] = 0;
    monthly[mk]++;
  });

  const dowPatterns = DAY_NAMES.map((name, i) => ({
    day: name,
    avgOrders: dowDays[i] > 0 ? parseFloat((dowOrders[i] / dowDays[i]).toFixed(1)) : 0,
  }));
  const overallAvg = dowPatterns.reduce((s, d) => s + d.avgOrders, 0) / 7;
  dowPatterns.forEach(d => {
    d.indexVsAvg = overallAvg > 0 ? parseFloat((d.avgOrders / overallAvg).toFixed(2)) : 1;
  });
  const bestDay  = dowPatterns.reduce((a, b) => a.avgOrders > b.avgOrders ? a : b, dowPatterns[0]);
  const worstDay = dowPatterns.reduce((a, b) => a.avgOrders < b.avgOrders ? a : b, dowPatterns[0]);

  const monthKeys = Object.keys(monthly).sort();
  const monthlyList = monthKeys.map(k => ({ key: k, label: k, total: monthly[k] })).slice(-12);
  const globalMonthlyAvg = monthlyList.length
    ? monthlyList.reduce((s, m) => s + m.total, 0) / monthlyList.length : 1;
  monthlyList.forEach(m => { m.indexVsAvg = parseFloat((m.total / globalMonthlyAvg).toFixed(2)); });

  return { dowPatterns, monthlyList, bestDay, worstDay, globalAvgPerDay: parseFloat(overallAvg.toFixed(1)) };
}

/* ─── COHORT METRICS ─────────────────────────────────────────────────── */
export function buildCohortMetrics(shopifyOrders) {
  const customers = {};
  (shopifyOrders || []).forEach(order => {
    const email = order.email || order.customer?.email;
    if (!email) return;
    const rev = parseFloat(order.total_price || 0);
    const dt  = order.created_at?.slice(0, 10) || '';
    if (!customers[email]) customers[email] = { orders: 0, revenue: 0, firstDate: dt, lastDate: dt };
    customers[email].orders++;
    customers[email].revenue += rev;
    if (dt && dt < customers[email].firstDate) customers[email].firstDate = dt;
    if (dt && dt > customers[email].lastDate)  customers[email].lastDate  = dt;
  });

  const all = Object.values(customers);
  const total  = all.length;
  const repeat = all.filter(c => c.orders > 1).length;
  const repeatRate = total > 0 ? (repeat / total) * 100 : 0;
  const avgLtv    = total > 0 ? all.reduce((s, c) => s + c.revenue, 0) / total : 0;
  const avgOrders = total > 0 ? all.reduce((s, c) => s + c.orders, 0) / total : 0;

  const cohorts = {};
  all.forEach(c => {
    const mk = c.firstDate.slice(0, 7);
    if (!cohorts[mk]) cohorts[mk] = { new: 0, repeat: 0, revenue: 0 };
    cohorts[mk].new++;
    if (c.orders > 1) cohorts[mk].repeat++;
    cohorts[mk].revenue += c.revenue;
  });
  const cohortList = Object.entries(cohorts).sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([key, c]) => ({
    key, label: key,
    newCustomers: c.new, repeatCustomers: c.repeat,
    repeatRate: c.new > 0 ? parseFloat(((c.repeat / c.new) * 100).toFixed(1)) : 0,
    avgRevenue: c.new > 0 ? Math.round(c.revenue / c.new) : 0,
  }));

  const ltvBuckets = [
    { label: '<₹200',       min: 0,    max: 200,   count: 0 },
    { label: '₹200–500',    min: 200,  max: 500,   count: 0 },
    { label: '₹500–1K',     min: 500,  max: 1000,  count: 0 },
    { label: '₹1K–2K',      min: 1000, max: 2000,  count: 0 },
    { label: '>₹2K',        min: 2000, max: Infinity, count: 0 },
  ];
  all.forEach(c => {
    const b = ltvBuckets.find(b => c.revenue >= b.min && c.revenue < b.max);
    if (b) b.count++;
  });

  return {
    total, repeat, repeatRate: parseFloat(repeatRate.toFixed(1)),
    avgLtv: Math.round(avgLtv),
    avgOrders: parseFloat(avgOrders.toFixed(2)),
    cohortList, ltvBuckets,
    highValue: all.filter(c => c.revenue >= 1000).length,
  };
}

/* ─── ADVANCED PREDICTIONS (base / bull / bear + regression) ─────────── */
export function buildAdvancedPredictions(plan, shopifyOrders) {
  const base = buildPredictions(plan, shopifyOrders);
  if (!shopifyOrders?.length) return { ...base, forecastArray: [], scenarios: [], regStats: null };

  const dailyData = {};
  (shopifyOrders || []).forEach(order => {
    if (!order.created_at) return;
    const d = order.created_at.slice(0, 10);
    if (!dailyData[d]) dailyData[d] = { orders: 0 };
    dailyData[d].orders++;
  });
  const sorted     = Object.entries(dailyData).sort((a, b) => a[0].localeCompare(b[0]));
  const recent30   = sorted.slice(-30);
  const reg        = linReg(recent30.map(([, v]) => v.orders));
  const ci95       = reg.stderr * 1.96;
  const lastIdx    = recent30.length - 1;

  const forecastArray = Array.from({ length: 30 }, (_, i) => {
    const x    = lastIdx + 1 + i;
    const base = Math.max(0, reg.intercept + reg.slope * x);
    const d    = new Date(); d.setDate(d.getDate() + i + 1);
    return {
      date:  d.toISOString().slice(5, 10),
      base:  parseFloat(base.toFixed(1)),
      bull:  parseFloat(Math.max(0, reg.intercept + reg.slope * 1.6 * x).toFixed(1)),
      bear:  parseFloat(Math.max(0, reg.intercept + reg.slope * 0.5 * x).toFixed(1)),
      upper: parseFloat((base + ci95).toFixed(1)),
      lower: parseFloat(Math.max(0, base - ci95).toFixed(1)),
    };
  });

  const now = new Date();
  const currentKey = MONTH_KEY(now);
  const scenarios = (plan.months || []).filter(m => m.key >= currentKey).slice(0, 6).map(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const mdays = DAYS_IN(yr, mo);
    const proj  = base.avg7 * mdays;
    return {
      label: m.label,
      base: Math.round(proj),         bull: Math.round(proj * 1.5),   bear: Math.round(proj * 0.6),
      plan: m.ordersPerDay * mdays,
      baseRev: Math.round(proj * m.aov),
      bullRev: Math.round(proj * 1.5 * m.aov),
      bearRev: Math.round(proj * 0.6 * m.aov),
      planRev: m.ordersPerDay * mdays * m.aov,
      baseGap: m.ordersPerDay > 0 ? ((proj / mdays - m.ordersPerDay) / m.ordersPerDay) * 100 : 0,
    };
  });

  const regStats = {
    slope: parseFloat(reg.slope.toFixed(3)),
    r2: parseFloat(reg.r2.toFixed(3)),
    stderr: parseFloat(reg.stderr.toFixed(2)),
    confidence: reg.r2 > 0.7 ? 'High' : reg.r2 > 0.4 ? 'Medium' : 'Low',
    interpretation: reg.slope > 1 ? `Growing +${reg.slope.toFixed(1)} orders/day trend`
      : reg.slope > 0.1 ? `Slowly growing +${reg.slope.toFixed(2)}/day`
      : reg.slope < -1  ? `Declining ${reg.slope.toFixed(1)} orders/day`
      : 'Flat — no clear directional trend',
  };

  return { ...base, forecastArray, scenarios, regStats };
}

/* ─── CREATIVE STRATEGY ──────────────────────────────────────────────── */
export function buildCreativeStrategy(plan, enrichedRows) {
  const rows = enrichedRows || [];
  if (!rows.length) return { collections: [], topCreatives: [], fatigueAlerts: [], whatToPublish: [] };

  const byCollection = {};
  rows.forEach(r => {
    const coll = r.collection || r.collectionLabel || 'Unknown';
    if (!byCollection[coll]) byCollection[coll] = { spend: 0, roas: [], cpr: [], ads: [] };
    const b = byCollection[coll];
    b.spend += parseFloat(r.spend || 0);
    b.ads.push(r);
    if ((r.roas7d || 0) > 0) b.roas.push(r.roas7d);
    if ((r.cpr7d  || 0) > 0) b.cpr.push(r.cpr7d);
  });

  const collections = Object.entries(byCollection).map(([name, d]) => {
    const avgRoas = d.roas.length ? d.roas.reduce((s, v) => s + v, 0) / d.roas.length : 0;
    const avgCpr  = d.cpr.length  ? d.cpr.reduce((s, v)  => s + v, 0) / d.cpr.length  : 0;
    const topAds  = [...d.ads].sort((a, b) => (b.roas7d || 0) - (a.roas7d || 0)).slice(0, 5);
    return {
      name, spend: d.spend, adCount: d.ads.length,
      avgRoas: parseFloat(avgRoas.toFixed(2)),
      avgCpr:  parseFloat(avgCpr.toFixed(0)),
      topAds,
      status: avgRoas > 4.5 ? 'excellent' : avgRoas > 3.5 ? 'good' : avgRoas > 2 ? 'average' : 'poor',
    };
  }).sort((a, b) => b.spend - a.spend);

  const topCreatives = [...rows]
    .filter(r => (r.roas7d || 0) > 3 && (r.spend || 0) > 500)
    .sort((a, b) => (b.roas7d || 0) - (a.roas7d || 0))
    .slice(0, 12)
    .map(r => ({
      name: r.adName || r.name || r.adId || 'Ad',
      collection: r.collection || r.collectionLabel || 'Unknown',
      roas7d: r.roas7d, cpr7d: r.cpr7d,
      spend: r.spend, purchases: r.purchases7d || 0,
    }));

  const fatigueAlerts = rows
    .filter(r => (r.spend || 0) > 5000 && (r.roas7d || 0) < 2.5 && (r.roas30d || 0) > 3.5)
    .slice(0, 6)
    .map(r => ({
      name: r.adName || r.adId || 'Ad',
      collection: r.collection || 'Unknown',
      spend: r.spend, roas7d: r.roas7d, roas30d: r.roas30d,
      action: 'Refresh creative — ROAS dropped 30%+ from 30-day avg',
    }));

  const planCols = plan.collections?.length
    ? plan.collections
    : Object.entries(plan.collectionAlloc || {}).map(([key, pct]) => ({
        key, label: key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1),
        alloc: pct, roas: (plan.collectionRoas || {})[key] || 0,
      }));

  const whatToPublish = planCols.map(({ key, label, alloc, roas: targetRoas }) => {
    const colData = collections.find(c => c.name.toLowerCase().includes(key.toLowerCase()));
    const currentRoas = colData?.avgRoas || 0;
    const gap = targetRoas > 0 ? ((currentRoas - targetRoas) / targetRoas) * 100 : 0;
    return {
      collection: label, key,
      budgetShare: Math.round((alloc || 0) * 100),
      currentRoas, targetRoas, gap: parseFloat(gap.toFixed(1)),
      activeAds: colData?.adCount || 0,
      recommendation: currentRoas >= targetRoas
        ? `Scale +20% budget — ROAS above target (${currentRoas.toFixed(2)}x)`
        : currentRoas >= targetRoas * 0.8
        ? `Hold — near target ROAS, test 3 new creatives this week`
        : `Refresh: pause bottom 30% by ROAS, launch 5 new creatives`,
      formatRec: 'Short video (10–15s): hook → product in use → CTA',
      urgency: currentRoas < targetRoas * 0.7 ? 'HIGH' : currentRoas < targetRoas ? 'MEDIUM' : 'LOW',
    };
  });

  return { collections, topCreatives, fatigueAlerts, whatToPublish };
}

/* ─── PROCUREMENT PLAN ───────────────────────────────────────────────── */
export function buildProcurementPlan(inventoryMap, shopifyOrders, plan) {
  const orderCostPerPO = 500;
  const holdingCostPctPerYear = 0.20;
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

  const suppliers = plan.suppliers || [];

  const items = Object.entries(inventoryMap || {})
    .map(([sku, inv]) => {
      const current = inv._totalStock || 0;
      const vel = velocity[sku] || 0;
      if (vel === 0 && current === 0) return null;

      const unitCost = parseFloat(inv.cost || 0) || 50;
      const annualDemand = vel * 365;
      const holdingPerUnit = unitCost * holdingCostPctPerYear;
      const eoq = holdingPerUnit > 0 && annualDemand > 0
        ? Math.round(Math.sqrt((2 * annualDemand * orderCostPerPO) / holdingPerUnit))
        : Math.round(vel * 30);

      const supplier = suppliers[0]; // simplify: first supplier
      const leadTime = supplier?.leadTimeDays || 5;
      const safetyDays = Math.ceil(leadTime * 1.5);
      const reorderPoint = Math.round(vel * (leadTime + safetyDays));
      const daysOfStock = vel > 0 ? Math.floor(current / vel) : 999;
      const needsReorder = current <= reorderPoint;
      const suggestedQty = Math.max(0, Math.max(eoq, Math.round(vel * 60)) - current);
      const daysUntilReorder = vel > 0 ? Math.max(0, Math.floor((current - reorderPoint) / vel)) : 999;

      const poDate = new Date(now); poDate.setDate(now.getDate() + Math.min(daysUntilReorder, 30));
      const deliveryDate = new Date(poDate); deliveryDate.setDate(poDate.getDate() + leadTime);

      return {
        sku, name: inv.name || inv.title || sku,
        current, vel: parseFloat(vel.toFixed(2)),
        daysOfStock: Math.min(daysOfStock, 999),
        eoq: Math.max(10, eoq), reorderPoint, suggestedQty,
        needsReorder, daysUntilReorder: Math.min(daysUntilReorder, 999),
        leadTime, safetyDays,
        poDate:        poDate.toISOString().slice(0, 10),
        deliveryDate:  deliveryDate.toISOString().slice(0, 10),
        estimatedPoValue: Math.round(suggestedQty * unitCost),
        supplier: supplier?.name || 'Unknown',
        priority: current === 0 ? 'URGENT' : needsReorder ? 'HIGH' : daysOfStock < 30 ? 'MEDIUM' : 'LOW',
      };
    })
    .filter(Boolean)
    .sort((a, b) => ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[a.priority] - ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[b.priority])));

  const urgentItems    = items.filter(i => i.priority === 'URGENT' || i.priority === 'HIGH');
  const totalPoValue   = urgentItems.reduce((s, i) => s + i.estimatedPoValue, 0);
  const totalPoUnits   = urgentItems.reduce((s, i) => s + i.suggestedQty, 0);

  return { items, urgentItems, totalPoValue, totalPoUnits };
}

/* ─── PERIOD FILTER ──────────────────────────────────────────────────── */
export function filterOrdersByPeriod(orders, days) {
  if (!days || days <= 0) return orders || [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return (orders || []).filter(o => o.created_at >= cutoff);
}

/* ─── COLLECTIONS FROM META ADS ──────────────────────────────────────── */
export function buildCollectionsFromMeta(enrichedRows) {
  const map = {};
  (enrichedRows || []).forEach(r => {
    const coll = r.collection || r.collectionLabel || 'Unknown';
    if (!map[coll]) map[coll] = { spend: 0, roas: [], cpr: [], count: 0 };
    map[coll].spend += parseFloat(r.spend || 0);
    map[coll].count++;
    if ((r.roas7d || 0) > 0) map[coll].roas.push(r.roas7d);
    if ((r.cpr7d  || 0) > 0) map[coll].cpr.push(r.cpr7d);
  });
  const totalSpend = Object.values(map).reduce((s, c) => s + c.spend, 0);
  return Object.entries(map)
    .filter(([, c]) => c.spend > 0)
    .sort((a, b) => b[1].spend - a[1].spend)
    .map(([name, c]) => ({
      name,
      spend: c.spend,
      spendShare: totalSpend > 0 ? parseFloat(((c.spend / totalSpend) * 100).toFixed(1)) : 0,
      avgRoas: c.roas.length ? parseFloat((c.roas.reduce((s, v) => s + v, 0) / c.roas.length).toFixed(2)) : 0,
      avgCpr:  c.cpr.length  ? parseFloat((c.cpr.reduce((s, v)  => s + v, 0) / c.cpr.length).toFixed(0))  : 0,
      adCount: c.count,
    }));
}

/* ─── PARSE UPLOADED CSV ─────────────────────────────────────────────── */
export function parseOrdersCsv(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = line.match(/("([^"]*)"|[^,]*)(,|$)/g)?.map(v => v.replace(/,$/, '').replace(/^"|"$/g, '').trim()) || line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    // normalise to Shopify-like shape
    return {
      id:          obj.id || obj.order_id || obj.name || '',
      created_at:  obj.created_at || obj.date || obj.order_date || '',
      total_price: parseFloat(obj.total_price || obj.total || obj.revenue || 0),
      email:       obj.email || obj.customer_email || '',
      line_items:  [],
    };
  }).filter(o => o.created_at && o.total_price > 0);
}

/* ─── STAGE ROADMAP ──────────────────────────────────────────────────── */
export function buildStageRoadmap(avgOrdersPerDay, plan, pva, enrichedRows) {
  const stage     = detectGrowthStage(avgOrdersPerDay);
  const nextIdx   = STAGES.findIndex(s => s.id === stage.id) + 1;
  const nextStage = STAGES[nextIdx] || null;
  const req       = stage.requirements;

  const activeCampaigns = new Set((enrichedRows || []).map(r => r.campaignId || r.campaign_id).filter(Boolean)).size;
  const activeCreatives = (enrichedRows || []).length;
  const activeWH        = plan.warehouses.filter(w => w.active).length;
  const totalCap        = plan.warehouses.filter(w => w.active).reduce((s, w) => s + (w.capacity || 0), 0);
  const validRoas       = (enrichedRows || []).filter(r => (r.roas7d || 0) > 0);
  const blendedRoas     = validRoas.length ? validRoas.reduce((s, r) => s + r.roas7d, 0) / validRoas.length : 0;
  const validCpr        = (enrichedRows || []).filter(r => (r.cpr7d || 0) > 0);
  const avgCpr          = validCpr.length ? validCpr.reduce((s, r) => s + r.cpr7d, 0) / validCpr.length : 0;
  const currentMonthKey = MONTH_KEY(new Date());
  const planMonths      = plan._months || plan.months || [];
  const currentBudget   = planMonths.find(m => m.key === currentMonthKey)?.adBudgetPerDay
    || Math.round((plan.baseOrdersPerDay || 0) * (plan.targetCpr || plan.cpr || 70));

  const gaps = [
    { metric: 'Orders / Day',     target: req.ordersPerDay,   current: Math.round(avgOrdersPerDay), unit: '/day',   met: avgOrdersPerDay >= req.ordersPerDay,  higher: true },
    { metric: 'Active Campaigns', target: req.campaigns,       current: activeCampaigns,              unit: '',       met: activeCampaigns >= req.campaigns,     higher: true },
    { metric: 'Active Creatives', target: req.creatives,       current: activeCreatives,              unit: '',       met: activeCreatives >= req.creatives,     higher: true },
    { metric: 'WH Count',         target: req.warehouses,      current: activeWH,                     unit: '',       met: activeWH >= req.warehouses,           higher: true },
    { metric: 'WH Capacity',      target: req.whCapacity,      current: totalCap,                     unit: ' units', met: totalCap >= req.whCapacity,           higher: true },
    { metric: 'Blended ROAS',     target: req.blendedRoas,     current: parseFloat(blendedRoas.toFixed(2)), unit: 'x', met: blendedRoas >= req.blendedRoas,   higher: true },
    { metric: 'Avg CPR',          target: req.cpr,             current: Math.round(avgCpr),           unit: '₹',      met: avgCpr > 0 && avgCpr <= req.cpr,      higher: false },
    { metric: 'Budget / Day',     target: req.adBudgetPerDay,  current: currentBudget,                unit: '₹',      met: currentBudget >= req.adBudgetPerDay,  higher: true },
  ].map(g => ({
    ...g,
    pct: g.higher
      ? Math.min(100, g.target > 0 ? (g.current / g.target) * 100 : 100)
      : Math.min(100, g.current > 0 ? (g.target / g.current) * 100 : 100),
    gap: g.higher ? g.target - g.current : g.current - g.target,
  }));

  const metCount  = gaps.filter(g => g.met).length;
  const readiness = Math.round((metCount / gaps.length) * 100);

  // Estimated days to reach next stage at current daily growth
  const ordersToNext = nextStage ? nextStage.min - Math.max(avgOrdersPerDay, 1) : 0;
  const dailyGrowth  = 0.04 * Math.max(avgOrdersPerDay, 50); // ~4% daily growth on orders
  const daysToNext   = ordersToNext > 0 && dailyGrowth > 0
    ? Math.ceil(ordersToNext / dailyGrowth) : 0;

  return {
    stage, nextStage, gaps, readiness, metCount,
    totalRequirements: gaps.length,
    daysToNext: Math.min(daysToNext, 999),
    priorities:      stage.priorities,
    creativePlaybook: stage.creativePlaybook,
    milestones:      stage.milestones,
  };
}

/* ─── AUTO-GENERATE 12-MONTH PLAN FROM 5 INPUTS ─────────────────────── */
export function buildMonthlyPlan(plan) {
  const months = [];
  let opd  = parseFloat(plan.baseOrdersPerDay) || 350;
  const rate = parseFloat(plan.monthlyGrowthRate) || 0.20;
  const cpr  = parseFloat(plan.targetCpr) || 70;
  const aov  = parseFloat(plan.aov) || 350;
  const now  = new Date();
  let yr = now.getFullYear(), mo = now.getMonth() + 1;
  for (let i = 0; i < 12; i++) {
    const key   = `${yr}-${String(mo).padStart(2, '0')}`;
    const label = new Date(yr, mo - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
    months.push({ key, label, ordersPerDay: Math.round(opd), aov, adBudgetPerDay: Math.round(opd * cpr) });
    opd *= (1 + rate);
    if (++mo > 12) { mo = 1; yr++; }
  }
  return months;
}

/* ─── FULL FINANCE PLAN (P&L + capital per month) ───────────────────── */
export function buildFinancePlan(plan, months) {
  const importLockMonths = 2.5;
  return months.map(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const days       = DAYS_IN(yr, mo);
    const revenue    = m.ordersPerDay * days * m.aov;
    const adSpend    = m.adBudgetPerDay * days;
    const cogs       = revenue * (plan.inventoryCostPct || 0.30);
    const grossP     = revenue * (plan.grossMarginPct   || 0.60);
    const opsCost    = revenue * (plan.opsCostPct       || 0.05);
    const netProfit  = grossP - adSpend - opsCost;
    const capLocked  = (cogs / days) * (importLockMonths * 30);
    const capNeeded  = capLocked + adSpend * 0.30;
    return {
      ...m, days, revenue, adSpend, cogs, grossProfit: grossP, opsCost, netProfit,
      netMarginPct: revenue > 0 ? parseFloat(((netProfit / revenue) * 100).toFixed(1)) : 0,
      capitalLocked: Math.round(capLocked),
      capitalNeeded: Math.round(capNeeded),
      roas: adSpend > 0 ? parseFloat((revenue / adSpend).toFixed(2)) : 0,
    };
  });
}

/* ─── WAREHOUSE SPACE NEEDS (m³ per month) ───────────────────────────── */
export function buildWarehouseNeeds(plan, months) {
  const activeWH   = (plan.warehouses || []).filter(w => w.active);
  const totalCapM3 = activeWH.reduce((s, w) =>
    s + (w.sqMeters || 0) * (w.heightMeters || 3.5) * (w.utilizationPct || 0.70), 0);
  const dims = plan.skuDimensions || [];

  return months.map(m => {
    let totalVol = 0;
    const byCategory = dims.map(sku => {
      const coll     = (plan.collections || []).find(c => c.key === sku.key);
      const alloc    = coll?.alloc ?? (1 / Math.max(dims.length, 1));
      const daily    = m.ordersPerDay * alloc * (sku.unitsPerOrder || 1);
      const buffer   = daily * (sku.bufferDays || 60);
      const volUnit  = ((sku.lengthCm||20)*(sku.widthCm||15)*(sku.heightCm||10)) / 1_000_000;
      const vol      = buffer * volUnit * 1.30;
      totalVol      += vol;
      return { key: sku.key, label: sku.label || sku.key, units: Math.round(buffer), volM3: parseFloat(vol.toFixed(1)) };
    });
    const util   = totalCapM3 > 0 ? (totalVol / totalCapM3) * 100 : 999;
    return {
      ...m,
      totalVolumeM3:  parseFloat(totalVol.toFixed(1)),
      totalCapM3:     parseFloat(totalCapM3.toFixed(1)),
      utilization:    parseFloat(util.toFixed(1)),
      overfill:       util >= 85,
      danger:         util >= 100,
      palletsNeeded:  Math.ceil(totalVol / 1.44),
      sqFtNeeded:     Math.ceil((totalVol / (activeWH[0]?.heightMeters || 3.5)) * 10.764),
      byCategory,
    };
  });
}

/* ─── OPS PLAN (staff + shifts per month) ────────────────────────────── */
export function buildOpsNeeds(months) {
  return months.map(m => {
    const opd     = m.ordersPerDay;
    const packers = Math.ceil(opd / 50);
    const qc      = Math.ceil(packers / 5);
    const shifts  = opd <= 250 ? 1 : opd <= 500 ? 2 : 3;
    const ops     = opd < 400 ? 1 : opd < 1200 ? 2 : 3;
    const cs      = Math.max(1, Math.ceil(opd / 400));
    const logistics = opd < 800 ? 1 : 2;
    const total   = packers + qc + ops + cs + logistics + 1;
    return {
      ...m, packers, qc, shifts, ops, cs, logistics, totalHeadcount: total,
      packingCapacity:  packers * 50 * shifts,
      capacityBuffer:   parseFloat(((packers * 50 * shifts / opd - 1) * 100).toFixed(1)),
    };
  });
}

/* ─── PROCUREMENT SCHEDULE (PO calendar) ────────────────────────────── */
export function buildProcurementSchedule(plan, months) {
  const now = new Date();
  const schedule = [];
  months.forEach(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const days       = DAYS_IN(yr, mo);
    const monthStart = new Date(yr, mo - 1, 1);
    (plan.suppliers || []).forEach(sup => {
      const coll  = (plan.collections || []).find(c =>
        c.key === sup.collectionKey ||
        c.label?.toLowerCase().includes((sup.category||'').toLowerCase()));
      const alloc = coll?.alloc || 0.25;
      const monthlyUnits = m.ordersPerDay * days * alloc;
      const orderQty     = Math.round(monthlyUnits * (1 + (sup.leadTimeDays||45)/30));
      const unitCost     = m.aov * alloc * (1 - (plan.grossMarginPct||0.60));
      const poValue      = Math.round(orderQty * Math.max(unitCost, 100));
      const poDate       = new Date(monthStart);
      poDate.setDate(poDate.getDate() - (sup.leadTimeDays||45));
      const daysUntil    = Math.round((poDate - now) / 86400000);
      schedule.push({
        month: m.key, monthLabel: m.label,
        supplier: sup.name, category: sup.category, collectionKey: coll?.key,
        orderQty, poValue, leadTimeDays: sup.leadTimeDays||45,
        poDate:       poDate.toISOString().slice(0, 10),
        deliveryDate: monthStart.toISOString().slice(0, 10),
        daysUntil,
        urgency: daysUntil < 0 ? 'OVERDUE' : daysUntil < 14 ? 'DUE_SOON' : 'UPCOMING',
      });
    });
  });
  return schedule.sort((a, b) => a.poDate.localeCompare(b.poDate));
}

/* ─── DECISION SIGNALS (what to do right now) ───────────────────────── */
export function buildDecisionSignals({ plan, months, finPlan, whPlan, opsPlan, procSchedule, creative, predictions, inventoryNeeds }) {
  const signals = [];
  const targetRoas = parseFloat(plan.targetRoas) || 4.5;
  const targetCpr  = parseFloat(plan.targetCpr)  || plan.cpr || 70;

  /* ROAS / CPR signal from live Meta */
  const liveRoas = (plan.collections||[]).reduce((s,c) => s + c.alloc*(c.roas||0), 0);
  if (liveRoas > targetRoas * 1.1) {
    signals.push({ id:'scale_ads', priority:'HIGH', icon:'📈',
      title:'Scale Ad Spend Now',
      detail:`Blended ROAS ${liveRoas.toFixed(2)}x vs target ${targetRoas}x — headroom to push budget +20–30%`,
      action:'Increase daily budget on all green collections' });
  } else if (liveRoas > 0 && liveRoas < targetRoas * 0.8) {
    signals.push({ id:'fix_roas', priority:'HIGH', icon:'⚠️',
      title:'ROAS Below Target',
      detail:`${liveRoas.toFixed(2)}x vs ${targetRoas}x — pause bottom 30% of ads, refresh creatives`,
      action:'Kill low-performers, launch 5 new creatives this week' });
  }

  /* Overdue / due-soon POs */
  const overdue  = procSchedule.filter(p => p.urgency==='OVERDUE').slice(0,3);
  const dueSoon  = procSchedule.filter(p => p.urgency==='DUE_SOON').slice(0,2);
  if (overdue.length) {
    signals.push({ id:'po_overdue', priority:'URGENT', icon:'🚨',
      title:`${overdue.length} PO${overdue.length>1?'s':''} Overdue`,
      detail: overdue.map(p=>`${p.supplier} (${p.monthLabel}): ${fmtRs(p.poValue)}`).join(' · '),
      action:'Place purchase orders immediately — every day late pushes stockout closer' });
  } else if (dueSoon.length) {
    signals.push({ id:'po_soon', priority:'MEDIUM', icon:'📦',
      title:`${dueSoon.length} PO${dueSoon.length>1?'s':''} due within 14 days`,
      detail: dueSoon.map(p=>`${p.supplier}: ${fmtRs(p.poValue)} by ${p.poDate}`).join(' · '),
      action:'Confirm stock availability and place orders this week' });
  }

  /* Warehouse overflow */
  const firstOver = whPlan?.find(m => m.overfill);
  if (firstOver) {
    signals.push({ id:'wh_overflow', priority: firstOver.danger?'URGENT':'MEDIUM', icon:'🏭',
      title: firstOver.danger ? 'Warehouse at Capacity' : `WH Overflow in ${firstOver.label}`,
      detail:`${firstOver.utilization.toFixed(0)}% used in ${firstOver.label} — need ${firstOver.totalVolumeM3}m³, have ${firstOver.totalCapM3}m³`,
      action: firstOver.danger ? 'Activate next warehouse immediately' : `Activate WH2 before ${firstOver.label}` });
  }

  /* Capital gap */
  const capGap = finPlan?.find(m => m.capitalNeeded > m.grossProfit);
  if (capGap) {
    signals.push({ id:'capital_gap', priority:'MEDIUM', icon:'💰',
      title:`Capital Gap in ${capGap.label}`,
      detail:`Need ${fmtRs(capGap.capitalNeeded)} upfront (inventory + ad advance), gross profit only ${fmtRs(capGap.grossProfit)}`,
      action:'Arrange credit line or supplier credit terms before this month' });
  }

  /* Creative fatigue */
  const fatigued = (creative?.fatigueAlerts||[]).slice(0,2);
  if (fatigued.length) {
    signals.push({ id:'fatigue', priority:'MEDIUM', icon:'🎨',
      title:`${fatigued.length} Fatigued Creative${fatigued.length>1?'s':''}`,
      detail: fatigued.map(f=>`${f.name}: ${f.roas7d?.toFixed(1)}x ROAS`).join(' · '),
      action:'Same hook, new format — replace within 48 hours' });
  }

  /* Ops headcount shift */
  const nextShiftMonth = opsPlan?.find((m,i) => i>0 && m.shifts > opsPlan[i-1].shifts);
  if (nextShiftMonth) {
    signals.push({ id:'add_shift', priority:'LOW', icon:'👥',
      title:`Add ${nextShiftMonth.shifts}nd Shift by ${nextShiftMonth.label}`,
      detail:`Orders hit ${nextShiftMonth.ordersPerDay}/day — single shift packing capacity (${opsPlan[0]?.packingCapacity}) won't cover`,
      action:'Hire and train packing staff before orders exceed current capacity' });
  }

  /* OOS risk from inventory */
  const oosRisk = (inventoryNeeds||[]).filter(i => i.status==='critical'||i.status==='oos').slice(0,3);
  if (oosRisk.length) {
    signals.push({ id:'oos_risk', priority:'HIGH', icon:'🔴',
      title:`${oosRisk.length} SKU${oosRisk.length>1?'s':''} OOS / Critical`,
      detail: oosRisk.map(i=>`${i.name}: ${i.daysOfStock}d stock`).join(' · '),
      action:'Emergency reorder — check local supplier for bridge stock' });
  }

  const rank = {URGENT:0,HIGH:1,MEDIUM:2,LOW:3};
  return signals.sort((a,b)=>(rank[a.priority]||2)-(rank[b.priority]||2));
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 1 — MOLECULAR ANALYTICS ENGINE
   ═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
   1. THEORY OF CONSTRAINTS — Current Bottleneck Scorer
   ──────────────────────────────────────────────────────────────
   Scores 5 constraints (marketing, ops, inventory, capital,
   logistics) per month. Returns top bottleneck + 5-step plan.
   ────────────────────────────────────────────────────────────── */
export function buildCurrentConstraint({ plan, predictions, inventoryNeeds, pva, wc, creative }) {
  const months = plan?.months || [];
  if (!months.length) return null;

  const results = months.map((m, i) => {
    const pred = predictions?.[i] || {};
    const wcm  = wc?.[i] || {};
    const ordersDay = m.ordersPerDay || 0;
    const revenue   = ordersDay * 30 * (m.aov || plan.aov || 340);

    /* ── Score each constraint 0-100 (higher = more constrained) ── */

    // MARKETING: CAC rising, ROAS dropping, or ad budget not keeping up with order targets
    const requiredRoas  = ordersDay * (m.aov || 340) / (m.adBudgetPerDay || 1);
    const marketingScore = Math.min(100, Math.max(0,
      (requiredRoas > 5 ? 80 : requiredRoas > 4 ? 50 : requiredRoas > 3 ? 25 : 10)
      + (i > 0 && months[i-1].adBudgetPerDay > 0
          ? Math.max(0, (m.adBudgetPerDay / months[i-1].adBudgetPerDay - 1.25) * 200)
          : 0)
    ));

    // OPS: single-shift capacity saturated (assume 1 shift = 1200 orders/day, 2 shifts = 2400)
    const maxCapacitySingleShift = 1200;
    const maxCapacityDoubleShift = 2400;
    let opsScore = 0;
    if (ordersDay > maxCapacityDoubleShift) opsScore = 90;
    else if (ordersDay > maxCapacitySingleShift) opsScore = 60 + (ordersDay - maxCapacitySingleShift) / (maxCapacityDoubleShift - maxCapacitySingleShift) * 30;
    else opsScore = ordersDay / maxCapacitySingleShift * 50;

    // INVENTORY: OOS + critical SKUs weighted by revenue impact
    const oosCritical = (inventoryNeeds || []).filter(s => s.status === 'oos' || s.status === 'critical').length;
    const totalSkus   = (inventoryNeeds || []).length || 1;
    const inventoryScore = Math.min(100, (oosCritical / totalSkus) * 200);

    // CAPITAL: working capital gap as % of required capital
    const capitalGap = wcm.capitalGap || 0;
    const capitalNeeded = wcm.capitalNeeded || revenue * 0.35;
    const capitalScore = Math.min(100, Math.max(0, capitalNeeded > 0 ? (capitalGap / capitalNeeded) * 100 : 0));

    // LOGISTICS: RTO rate proxy — COD share × estimated RTO rate × 100
    const codPct    = plan.codPct || 0.60;
    const rtoCOD    = plan.rtoRateCOD || 0.28;
    const rtoBlended = codPct * rtoCOD + (1 - codPct) * (plan.rtoRatePrepaid || 0.06);
    const logisticsScore = Math.min(100, rtoBlended * 200);

    const scores = {
      marketing:  Math.round(marketingScore),
      ops:        Math.round(opsScore),
      inventory:  Math.round(inventoryScore),
      capital:    Math.round(capitalScore),
      logistics:  Math.round(logisticsScore),
    };

    const topConstraint = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];

    /* ── Goldratt's 5 Focusing Steps for the top constraint ── */
    const focusingSteps = {
      marketing: [
        'IDENTIFY: Marketing efficiency (ROAS ' + requiredRoas.toFixed(1) + 'x required)',
        'EXPLOIT: Reallocate budget to best-ROAS collection (All Mix currently leads)',
        'SUBORDINATE: Pause brand campaigns; all spend → performance',
        'ELEVATE: Expand Meta + Google audience; launch influencer pipeline',
        'REASSESS: Monitor for 2 weeks; constraint may shift to ops at scale',
      ],
      ops: [
        'IDENTIFY: Packing throughput at ' + ordersDay + '/day hitting shift ceiling',
        'EXPLOIT: Optimize pick-path sequence; reduce avg pack time from 6→4 min',
        'SUBORDINATE: Delay non-critical SKU additions; keep SKU count flat',
        'ELEVATE: Add second shift by ' + m.label + '; hire 8 packing staff',
        'REASSESS: Track DPMO and cycle time daily after shift addition',
      ],
      inventory: [
        'IDENTIFY: ' + oosCritical + ' SKUs at OOS/Critical — revenue leaking daily',
        'EXPLOIT: Prioritise reorder for top-revenue SKUs first',
        'SUBORDINATE: Reduce promotions on low-stock SKUs immediately',
        'ELEVATE: Place emergency PO; negotiate 2-week lead time with alternate supplier',
        'REASSESS: Daily stock count; set alert at 15-day buffer going forward',
      ],
      capital: [
        'IDENTIFY: Capital gap ₹' + fmtK(capitalGap) + ' — inventory + ad advance exceeds cash',
        'EXPLOIT: Negotiate 30-day credit with top 3 suppliers',
        'SUBORDINATE: Delay non-essential capex this month',
        'ELEVATE: Draw on credit line; arrange invoice discounting for COD orders',
        'REASSESS: Track CCC weekly — target <25 days by Q3',
      ],
      logistics: [
        'IDENTIFY: Blended RTO ' + (rtoBlended*100).toFixed(1) + '% draining ₹' + fmtK(ordersDay*30*rtoBlended*(plan.reverseLogistics||60)) + '/month',
        'EXPLOIT: Activate NDR management — target 72% rescue rate',
        'SUBORDINATE: Shift 10% COD customers to prepaid via cashback offer',
        'ELEVATE: Partner with 3PL for same-day NDR outreach automation',
        'REASSESS: Track COD-to-prepaid ratio weekly; target <45% COD',
      ],
    };

    return {
      month: m.label,
      key:   m.key,
      ordersPerDay: ordersDay,
      scores,
      topConstraint: topConstraint[0],
      topScore: topConstraint[1],
      focusingSteps: focusingSteps[topConstraint[0]],
      allScoresSorted: Object.entries(scores).sort((a,b)=>b[1]-a[1]),
    };
  });

  return results;
}

/* ──────────────────────────────────────────────────────────────
   2. BREAKING POINTS ENGINE — Cascade Action-By Date Timeline
   ──────────────────────────────────────────────────────────────
   For each department, returns the exact date (or month) at
   which the current setup breaks, and the action needed before.
   ────────────────────────────────────────────────────────────── */
export function buildBreakingPoints({ plan, predictions, inventoryNeeds, pva, opsPlan, whPlan }) {
  const months = plan?.months || [];
  const breakpoints = [];

  /* ── OPS: Single-shift capacity break ── */
  const singleShiftMax = 1200;
  const doubleShiftMax = 2400;
  const shift2Month = months.find(m => m.ordersPerDay > singleShiftMax);
  const shift3Month = months.find(m => m.ordersPerDay > doubleShiftMax);

  if (shift2Month) {
    const daysIntoMonth = Math.ceil((singleShiftMax / shift2Month.ordersPerDay) * 30);
    breakpoints.push({
      dept: 'Operations',
      icon: '🏭',
      severity: 'CRITICAL',
      breakMonth: shift2Month.key,
      breakLabel: shift2Month.label,
      daysBuffer: daysIntoMonth,
      actionByDate: shift2Month.key,
      title: 'Single-shift packing capacity exhausted',
      detail: `Orders reach ${shift2Month.ordersPerDay}/day — single shift handles ~${singleShiftMax}/day. Packing backlog starts.`,
      action: 'Hire 8 packers + 2 supervisors. Start training 3 weeks prior.',
      leadTimeDays: 21,
    });
  }

  if (shift3Month) {
    breakpoints.push({
      dept: 'Operations',
      icon: '🏭',
      severity: 'HIGH',
      breakMonth: shift3Month.key,
      breakLabel: shift3Month.label,
      daysBuffer: 0,
      actionByDate: shift3Month.key,
      title: 'Double-shift capacity exhausted — 3rd shift or new warehouse needed',
      detail: `Orders reach ${shift3Month.ordersPerDay}/day — 2 shifts handle ~${doubleShiftMax}/day.`,
      action: 'Activate Hyderabad WH or lease 3rd Pune facility. 45-day lead.',
      leadTimeDays: 45,
    });
  }

  /* ── INVENTORY: OOS / Critical SKUs ── */
  const oosSkus = (inventoryNeeds || []).filter(s => s.status === 'oos' || s.status === 'critical');
  oosSkus.slice(0, 5).forEach(sku => {
    breakpoints.push({
      dept: 'Inventory',
      icon: '📦',
      severity: sku.status === 'oos' ? 'CRITICAL' : 'HIGH',
      breakMonth: sku.stockoutDate || 'Imminent',
      breakLabel: sku.stockoutDate || 'Imminent',
      daysBuffer: sku.daysOfStock || 0,
      actionByDate: 'Place PO now',
      title: `${sku.name} — ${sku.status === 'oos' ? 'OUT OF STOCK' : 'Critical: ' + (sku.daysOfStock || 0) + ' days left'}`,
      detail: `At current velocity, stockout in ${sku.daysOfStock || 0} days. Revenue impact: ₹${fmtK((sku.velocity || 0) * (sku.aov || plan.aov || 340) * Math.max(0, 45 - (sku.daysOfStock || 0)))} over 45-day risk window.`,
      action: 'Emergency reorder. MOQ negotiation with supplier for faster turnaround.',
      leadTimeDays: plan.defaultLeadTimeDays || 45,
    });
  });

  /* ── CAPITAL: Working capital gap months ── */
  if (pva) {
    pva.forEach((m, i) => {
      const revenue = m.revenue || 0;
      const capitalNeeded = revenue * 0.35;
      const grossProfit   = revenue * (plan.grossMarginPct || 0.50);
      if (capitalNeeded > grossProfit * 1.5) {
        breakpoints.push({
          dept: 'Capital',
          icon: '💰',
          severity: capitalNeeded > grossProfit * 2 ? 'CRITICAL' : 'HIGH',
          breakMonth: m.key || m.label,
          breakLabel: m.label,
          daysBuffer: 30,
          actionByDate: `2 weeks before ${m.label}`,
          title: `Capital gap: ${fmtRs(capitalNeeded - grossProfit)} unfunded in ${m.label}`,
          detail: `Need ${fmtRs(capitalNeeded)} for inventory + ad advance. Gross profit only ${fmtRs(grossProfit)}.`,
          action: 'Arrange credit line or supplier credit 30 days before month start.',
          leadTimeDays: 30,
        });
      }
    });
  }

  /* ── MARKETING: ROAS stress points ── */
  months.forEach((m, i) => {
    const requiredRoas = m.ordersPerDay * (m.aov || plan.aov || 340) / ((m.adBudgetPerDay || 1));
    if (requiredRoas > 5.5) {
      breakpoints.push({
        dept: 'Marketing',
        icon: '📣',
        severity: 'HIGH',
        breakMonth: m.key,
        breakLabel: m.label,
        daysBuffer: 14,
        actionByDate: `Start of ${m.label}`,
        title: `ROAS target ${requiredRoas.toFixed(1)}x — above sustainable ceiling in ${m.label}`,
        detail: `Budget ₹${fmtK(m.adBudgetPerDay * 30)}/month must yield ${requiredRoas.toFixed(1)}x to hit order targets. Meta avg ROAS ceiling ~5-5.5x.`,
        action: 'Increase ad budget 15-20% OR reduce order target. Add new channels (Google Shopping, Affiliate).',
        leadTimeDays: 14,
      });
    }
  });

  /* ── LOGISTICS: RTO cost break ── */
  const blendedRTO = (plan.codPct || 0.60) * (plan.rtoRateCOD || 0.28) + (1 - (plan.codPct || 0.60)) * (plan.rtoRatePrepaid || 0.06);
  const rtoFullCost = (plan.forwardShipping || 65) + (plan.reverseLogistics || 60) + (plan.restockingCost || 25) + (plan.damageWriteoff || 20);
  months.forEach((m) => {
    const dailyRTOCost = m.ordersPerDay * blendedRTO * rtoFullCost;
    if (dailyRTOCost > 50000) {
      breakpoints.push({
        dept: 'Logistics',
        icon: '🚚',
        severity: dailyRTOCost > 100000 ? 'CRITICAL' : 'HIGH',
        breakMonth: m.key,
        breakLabel: m.label,
        daysBuffer: 0,
        actionByDate: `Before ${m.label}`,
        title: `RTO cost ₹${fmtK(dailyRTOCost)}/day — logistics margin erosion in ${m.label}`,
        detail: `${m.ordersPerDay}/day × ${(blendedRTO*100).toFixed(0)}% RTO × ₹${rtoFullCost}/RTO = ₹${fmtK(dailyRTOCost * 30)}/month drain.`,
        action: 'Activate NDR automation. Target COD < 45%. Introduce prepaid cashback.',
        leadTimeDays: 14,
      });
    }
  });

  /* ── WAREHOUSE: Capacity break ── */
  const warehouses = plan.warehouses || [];
  const activeCapacity = warehouses.filter(w => w.active).reduce((s, w) => s + (w.capacity || 0), 0);
  const capacityBreakMonth = months.find(m => {
    const estSkuCount = 200 + Math.floor(m.ordersPerDay / 10);
    return estSkuCount > activeCapacity * 0.85;
  });
  if (capacityBreakMonth) {
    breakpoints.push({
      dept: 'Warehouse',
      icon: '🏢',
      severity: 'HIGH',
      breakMonth: capacityBreakMonth.key,
      breakLabel: capacityBreakMonth.label,
      daysBuffer: 60,
      actionByDate: `60 days before ${capacityBreakMonth.label}`,
      title: `Warehouse capacity at 85% threshold in ${capacityBreakMonth.label}`,
      detail: `Active capacity: ${activeCapacity} units. At ${capacityBreakMonth.ordersPerDay}/day, buffer margin drops below safe operating level.`,
      action: 'Activate Hyderabad hub or expand Pune WH2. 60-day lead for fit-out.',
      leadTimeDays: 60,
    });
  }

  const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return breakpoints.sort((a,b) => (severityRank[a.severity]||3) - (severityRank[b.severity]||3));
}

/* ──────────────────────────────────────────────────────────────
   3. RTO MODEL — India D2C COD/Prepaid + NDR Funnel
   ──────────────────────────────────────────────────────────────
   Full cost model: forward + reverse + restock + damage +
   margin loss. NDR funnel: 35% get NDR, 72% rescued.
   ────────────────────────────────────────────────────────────── */
export function buildRTOModel({ plan, predictions }) {
  const months = plan?.months || [];
  const {
    codPct        = 0.60,
    rtoRateCOD    = 0.28,
    rtoRatePrepaid= 0.06,
    forwardShipping  = 65,
    reverseLogistics = 60,
    restockingCost   = 25,
    damageWriteoff   = 20,
    aov: planAov     = 340,
    grossMarginPct   = 0.50,
  } = plan || {};

  // NDR funnel constants (India D2C industry benchmarks)
  const ndrRate       = 0.35;  // 35% of all orders get NDR
  const ndrRescueRate = 0.72;  // 72% rescued with active NDR management
  const unmanagedRTORateCOD = rtoRateCOD;            // 28% unmanaged
  const managedRTORateCOD   = rtoRateCOD * (1 - ndrRate * ndrRescueRate); // ~18%

  const rtoFullCostPerOrder = forwardShipping + reverseLogistics + restockingCost + damageWriteoff;
  const marginLossPerRTO    = (planAov * grossMarginPct) * 0.05; // 5% margin lost on returned item handling

  const monthly = months.map(m => {
    const aov         = m.aov || planAov;
    const totalOrders = m.ordersPerDay * 30;
    const codOrders   = totalOrders * codPct;
    const prepOrders  = totalOrders * (1 - codPct);

    // Unmanaged scenario
    const rtoUnmanaged = codOrders * unmanagedRTORateCOD + prepOrders * rtoRatePrepaid;
    const costUnmanaged = rtoUnmanaged * (rtoFullCostPerOrder + marginLossPerRTO);

    // Managed scenario (NDR active)
    const rtoManaged = codOrders * managedRTORateCOD + prepOrders * rtoRatePrepaid;
    const costManaged = rtoManaged * (rtoFullCostPerOrder + marginLossPerRTO);

    const blendedRTOPctUnmanaged = rtoUnmanaged / totalOrders;
    const blendedRTOPctManaged   = rtoManaged / totalOrders;

    const ndrOrders   = totalOrders * ndrRate;
    const ndrRescued  = ndrOrders * ndrRescueRate;
    const savingsFromNDR = costUnmanaged - costManaged;

    return {
      month: m.label,
      key:   m.key,
      totalOrders,
      codOrders:  Math.round(codOrders),
      prepOrders: Math.round(prepOrders),
      codPct,
      rtoUnmanagedOrders: Math.round(rtoUnmanaged),
      rtoManagedOrders:   Math.round(rtoManaged),
      blendedRTOPctUnmanaged: +(blendedRTOPctUnmanaged * 100).toFixed(1),
      blendedRTOPctManaged:   +(blendedRTOPctManaged * 100).toFixed(1),
      costUnmanaged:   Math.round(costUnmanaged),
      costManaged:     Math.round(costManaged),
      savingsFromNDR:  Math.round(savingsFromNDR),
      dailyCostUnmanaged: Math.round(costUnmanaged / 30),
      dailyCostManaged:   Math.round(costManaged / 30),
      ndrOrders:    Math.round(ndrOrders),
      ndrRescued:   Math.round(ndrRescued),
      rtoFullCostPerOrder: Math.round(rtoFullCostPerOrder + marginLossPerRTO),
    };
  });

  const totalSavings = monthly.reduce((s, m) => s + m.savingsFromNDR, 0);
  const totalCostUnmanaged = monthly.reduce((s, m) => s + m.costUnmanaged, 0);
  const totalCostManaged   = monthly.reduce((s, m) => s + m.costManaged, 0);

  return {
    monthly,
    summary: {
      totalCostUnmanaged,
      totalCostManaged,
      totalSavings,
      annualSavingsFromNDR: totalSavings,
      blendedRTOUnmanaged: +(monthly.reduce((s,m)=>s+m.blendedRTOPctUnmanaged,0)/monthly.length).toFixed(1),
      blendedRTOManaged:   +(monthly.reduce((s,m)=>s+m.blendedRTOPctManaged,0)/monthly.length).toFixed(1),
      ndrRescueRate: ndrRescueRate * 100,
      rtoFullCostPerOrder: Math.round(rtoFullCostPerOrder + marginLossPerRTO),
    },
    inputs: { codPct, rtoRateCOD, rtoRatePrepaid, ndrRate, ndrRescueRate, forwardShipping, reverseLogistics, restockingCost, damageWriteoff },
  };
}

/* ──────────────────────────────────────────────────────────────
   4. CONTRIBUTION STACK — CM1 / CM2 / CM3 per Month per Collection
   ──────────────────────────────────────────────────────────────
   CM1 = Revenue - COGS
   CM2 = CM1 - Shipping - Gateway - PickPack - Packaging
   CM3 = CM2 - CAC - RTO cost allocation
   ────────────────────────────────────────────────────────────── */
export function buildContributionStack({ plan, pva }) {
  const months = plan?.months || [];
  const {
    grossMarginPct  = 0.50,
    gatewayFeePct   = 0.029,
    gatewayFeeFixed = 3,
    forwardShipping = 65,
    pickPackCost    = 15,
    packagingCost   = 8,
    codPct          = 0.60,
    rtoRateCOD      = 0.28,
    rtoRatePrepaid  = 0.06,
    reverseLogistics= 60,
    restockingCost  = 25,
    damageWriteoff  = 20,
    cpr             = 55,
    collectionAlloc = { plants: 0.35, seeds: 0.20, allMix: 0.45 },
    collectionRoas  = { plants: 4.53, seeds: 3.58, allMix: 4.83 },
    aov: planAov    = 340,
  } = plan || {};

  const blendedRTO = codPct * rtoRateCOD + (1 - codPct) * rtoRatePrepaid;
  const rtoFullCost = forwardShipping + reverseLogistics + restockingCost + damageWriteoff;

  const collections = ['plants', 'seeds', 'allMix'];
  const collLabel   = { plants: 'Plants', seeds: 'Seeds', allMix: 'All Mix' };

  const monthly = months.map(m => {
    const aov         = m.aov || planAov;
    const totalOrders = m.ordersPerDay * 30;
    const totalRev    = totalOrders * aov;
    const adBudget    = m.adBudgetPerDay * 30;

    const collectionData = collections.map(coll => {
      const allocPct = (collectionAlloc[coll] || 0);
      const roas     = (collectionRoas[coll]  || 4);
      const orders   = totalOrders * allocPct;
      const revenue  = orders * aov;
      const cogs     = revenue * (1 - grossMarginPct);

      // CM1
      const cm1 = revenue - cogs;
      const cm1Pct = revenue > 0 ? cm1 / revenue : 0;

      // CM2 deductions per order
      const shippingTotal  = orders * forwardShipping;
      const gatewayTotal   = orders * (aov * gatewayFeePct + gatewayFeeFixed);
      const pickPackTotal  = orders * pickPackCost;
      const packagingTotal = orders * packagingCost;
      const cm2 = cm1 - shippingTotal - gatewayTotal - pickPackTotal - packagingTotal;
      const cm2Pct = revenue > 0 ? cm2 / revenue : 0;

      // CM3 deductions: CAC + RTO
      const collAdBudget = adBudget * allocPct;
      const cac = orders > 0 ? collAdBudget / orders : cpr;
      const rtoCost = orders * blendedRTO * rtoFullCost;
      const cacTotal = collAdBudget;
      const cm3 = cm2 - cacTotal - rtoCost;
      const cm3Pct = revenue > 0 ? cm3 / revenue : 0;

      return {
        collection: coll,
        label: collLabel[coll],
        orders:    Math.round(orders),
        revenue:   Math.round(revenue),
        cogs:      Math.round(cogs),
        cm1:       Math.round(cm1),       cm1Pct: +(cm1Pct*100).toFixed(1),
        shippingTotal: Math.round(shippingTotal),
        gatewayTotal:  Math.round(gatewayTotal),
        pickPackTotal: Math.round(pickPackTotal),
        packagingTotal:Math.round(packagingTotal),
        cm2:       Math.round(cm2),       cm2Pct: +(cm2Pct*100).toFixed(1),
        cacTotal:  Math.round(cacTotal),
        cac:       Math.round(cac),
        rtoCost:   Math.round(rtoCost),
        cm3:       Math.round(cm3),       cm3Pct: +(cm3Pct*100).toFixed(1),
      };
    });

    const totCm1 = collectionData.reduce((s,c)=>s+c.cm1,0);
    const totCm2 = collectionData.reduce((s,c)=>s+c.cm2,0);
    const totCm3 = collectionData.reduce((s,c)=>s+c.cm3,0);

    return {
      month:  m.label,
      key:    m.key,
      totalOrders,
      totalRevenue: Math.round(totalRev),
      collections:  collectionData,
      totals: {
        cm1: totCm1, cm1Pct: +(totCm1/totalRev*100).toFixed(1),
        cm2: totCm2, cm2Pct: +(totCm2/totalRev*100).toFixed(1),
        cm3: totCm3, cm3Pct: +(totCm3/totalRev*100).toFixed(1),
      },
    };
  });

  return monthly;
}

/* ──────────────────────────────────────────────────────────────
   5. BCG MATRIX — Collection Quadrant (Internal Portfolio)
   ──────────────────────────────────────────────────────────────
   X-axis: revenue share (market share proxy)
   Y-axis: MoM revenue growth rate
   Quadrants split at medians. Labels: Star/Cash Cow/Question Mark/Dog
   ────────────────────────────────────────────────────────────── */
const BCG_PALETTE = ['#22c55e','#f59e0b','#818cf8','#06b6d4','#f97316','#ec4899','#84cc16','#a855f7','#14b8a6','#ef4444'];

function _bcgQuadrant(p, medianShare, medianGrowth) {
  const hs = p.shareX >= medianShare, hg = p.growthY >= medianGrowth;
  if (hs && hg)   return { name: 'Star',          color: '#22c55e', action: 'Invest aggressively — double ad budget, expand SKUs' };
  if (hs && !hg)  return { name: 'Cash Cow',      color: '#f59e0b', action: 'Milk margins — reduce CAC, maintain SKU depth' };
  if (!hs && hg)  return { name: 'Question Mark', color: '#818cf8', action: 'Selective invest — test 2x budget for 60 days; if ROAS holds → Star' };
  return                  { name: 'Dog',           color: '#ef4444', action: 'Harvest or drop — minimal ad spend, clear inventory' };
}

function _buildBCGFromOrders({ allOrders, enrichedRows, inventoryMap }) {
  const pN = v => parseFloat(v) || 0;
  // Build collection revenue by month from real Shopify orders
  const collMonthly = {}; // collName → { [YYYY-MM]: revenue }
  const collTotal   = {}; // collName → total revenue
  const collOrders  = {}; // collName → order count

  (allOrders || []).filter(o => !o.cancelled_at).forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const mk = date.slice(0, 7);
    const seen = new Set();
    (o.line_items || []).forEach(li => {
      const sku  = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const net  = pN(li.price) * (li.quantity || 1) - pN(li.total_discount);
      const inv  = (inventoryMap || {})[sku] || {};
      const col  = (inv.collections?.length > 0 ? inv.collections[0] : null)
                || inv.collectionLabel || inv.productType || li.product_type || 'Uncollected';
      if (!collMonthly[col]) collMonthly[col] = {};
      collMonthly[col][mk] = (collMonthly[col][mk] || 0) + net;
      collTotal[col]  = (collTotal[col] || 0) + net;
      if (!seen.has(col)) { collOrders[col] = (collOrders[col] || 0) + 1; seen.add(col); }
    });
  });

  const allMonths = [...new Set(Object.values(collMonthly).flatMap(m => Object.keys(m)))].sort();
  const lastMk  = allMonths[allMonths.length - 1];
  const prevMk  = allMonths[allMonths.length - 2];
  const totalRevLast = Object.values(collMonthly).reduce((s, m) => s + (m[lastMk] || 0), 0);

  // Meta spend+revenue per collection label
  const metaSpend = {}, metaRev = {};
  (enrichedRows || []).forEach(r => {
    const col = (r.collection || '').trim(); if (!col) return;
    metaSpend[col] = (metaSpend[col] || 0) + pN(r.spend);
    metaRev[col]   = (metaRev[col]   || 0) + pN(r.revenue);
  });

  const sorted = Object.keys(collTotal).sort((a, b) => collTotal[b] - collTotal[a]);
  const points = sorted.map((col, i) => {
    const revLast = collMonthly[col]?.[lastMk] || 0;
    const revPrev = collMonthly[col]?.[prevMk] || 0;
    const shareX  = totalRevLast > 0 ? revLast / totalRevLast : 0;
    const growthY = revPrev > 0 ? (revLast - revPrev) / revPrev : 0;
    const spend   = metaSpend[col] || 0;
    const roas    = spend > 0 ? +(( metaRev[col] || 0) / spend).toFixed(2) : 0;
    const totalOrd = collOrders[col] || 0;
    const totalRev = collTotal[col] || 0;
    return {
      collection: col, label: col,
      color:      BCG_PALETTE[i % BCG_PALETTE.length],
      shareX:     +(shareX * 100).toFixed(1),
      growthY:    +(growthY * 100).toFixed(1),
      roas, alloc: +(shareX * 100).toFixed(0),
      revLast: Math.round(revLast), revTotal: Math.round(totalRev),
      orders: totalOrd,
      contribPct: totalRevLast > 0 ? +((revLast / totalRevLast) * 100).toFixed(1) : 0,
    };
  });

  if (!points.length) return { matrix: [], medianShare: 0, medianGrowth: 0, recommendations: [], fromShopify: true };

  const sortedShares  = [...points.map(p => p.shareX)].sort((a,b) => a-b);
  const sortedGrowths = [...points.map(p => p.growthY)].sort((a,b) => a-b);
  const medianShare   = sortedShares[Math.floor(sortedShares.length / 2)];
  const medianGrowth  = sortedGrowths[Math.floor(sortedGrowths.length / 2)];

  const matrix = points.map(p => ({ ...p, quadrant: _bcgQuadrant(p, medianShare, medianGrowth) }));
  const recommendations = matrix.map(m => ({
    collection: m.label, quadrant: m.quadrant.name, color: m.quadrant.color,
    action: m.quadrant.action,
    budgetSignal: m.quadrant.name === 'Star' ? '+30%' : m.quadrant.name === 'Cash Cow' ? 'Maintain' : m.quadrant.name === 'Question Mark' ? 'Test +20%' : '-50%',
  }));
  return { matrix, medianShare, medianGrowth, recommendations, axisLabels: { x: 'Revenue Share (%)', y: 'MoM Growth (%)' }, fromShopify: true };
}

function _buildBCGFromPlan({ plan, enrichedRows }) {
  const months = plan?.months || [];
  const collectionAlloc = plan?.collectionAlloc || {};
  const collectionRoas  = plan?.collectionRoas  || {};
  const aov = plan?.aov || 340;
  const collections = Object.keys(collectionAlloc);
  if (!collections.length) return { matrix: [], medianShare: 0, medianGrowth: 0, recommendations: [] };

  const collMonthly = {};
  collections.forEach(c => { collMonthly[c] = []; });
  months.forEach(m => {
    const totalRev = m.ordersPerDay * 30 * (m.aov || aov);
    collections.forEach(c => { collMonthly[c].push(totalRev * (collectionAlloc[c] || 0)); });
  });
  const lastIdx = months.length - 1;
  const prevIdx = Math.max(0, lastIdx - 1);
  const totalRevLast = collections.reduce((s, c) => s + (collMonthly[c][lastIdx] || 0), 0);
  const metaSpend = {}, metaRev = {};
  (enrichedRows || []).forEach(r => {
    const col = (r.collection || '').trim(); if (!col) return;
    metaSpend[col] = (metaSpend[col] || 0) + parseFloat(r.spend || 0);
    metaRev[col]   = (metaRev[col]   || 0) + parseFloat(r.revenue || 0);
  });

  const points = collections.map((c, i) => {
    const revLast = collMonthly[c][lastIdx] || 0;
    const revPrev = collMonthly[c][prevIdx] || 0;
    const shareX  = totalRevLast > 0 ? revLast / totalRevLast : 0;
    const growthY = revPrev > 0 ? (revLast - revPrev) / revPrev : 0;
    const spend   = metaSpend[c] || 0;
    const roas    = spend > 0 ? +((metaRev[c] || 0) / spend).toFixed(2) : (collectionRoas[c] || 0);
    return {
      collection: c, label: c,
      color:      BCG_PALETTE[i % BCG_PALETTE.length],
      shareX:     +(shareX * 100).toFixed(1),
      growthY:    +(growthY * 100).toFixed(1),
      roas, alloc: +((collectionAlloc[c] || 0) * 100).toFixed(0),
      revLast: Math.round(revLast), revTotal: Math.round(revLast),
      contribPct: +(shareX * 100).toFixed(1),
    };
  });

  const sortedShares  = [...points.map(p => p.shareX)].sort((a,b) => a-b);
  const sortedGrowths = [...points.map(p => p.growthY)].sort((a,b) => a-b);
  const medianShare   = sortedShares[Math.floor(sortedShares.length / 2)];
  const medianGrowth  = sortedGrowths[Math.floor(sortedGrowths.length / 2)];
  const matrix = points.map(p => ({ ...p, quadrant: _bcgQuadrant(p, medianShare, medianGrowth) }));
  const recommendations = matrix.map(m => ({
    collection: m.label, quadrant: m.quadrant.name, color: m.quadrant.color,
    action: m.quadrant.action,
    budgetSignal: m.quadrant.name === 'Star' ? '+30%' : m.quadrant.name === 'Cash Cow' ? 'Maintain' : m.quadrant.name === 'Question Mark' ? 'Test +20%' : '-50%',
  }));
  return { matrix, medianShare, medianGrowth, recommendations, axisLabels: { x: 'Revenue Share (%)', y: 'MoM Growth Rate (%)' } };
}

export function buildBCGMatrix({ plan, allOrders, enrichedRows, inventoryMap }) {
  // Use real Shopify collections when inventory data is available
  if (inventoryMap && Object.keys(inventoryMap).length > 0 && allOrders?.length > 0) {
    return _buildBCGFromOrders({ allOrders, enrichedRows, inventoryMap });
  }
  return _buildBCGFromPlan({ plan, enrichedRows });
}

/* Build collection revenue contribution for analytics (product-wise + collection-wise) */
export function buildCollectionContrib({ allOrders, inventoryMap, plan }) {
  const pN = v => parseFloat(v) || 0;
  const collData = {}; // col → { rev, orders, units, rev30, revByMonth }
  const now = Date.now();
  const t30 = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  (allOrders || []).filter(o => !o.cancelled_at).forEach(o => {
    const date = o.created_at?.slice(0, 10);
    if (!date) return;
    const mk = date.slice(0, 7);
    (o.line_items || []).forEach(li => {
      const sku = (li.sku || '').trim().toUpperCase() || `pid_${li.product_id}`;
      const net = pN(li.price) * (li.quantity || 1) - pN(li.total_discount);
      const qty = li.quantity || 1;
      const inv = (inventoryMap || {})[sku] || {};
      const col = (inv.collections?.length > 0 ? inv.collections[0] : null)
               || inv.collectionLabel || inv.productType || li.product_type || 'Uncollected';
      if (!collData[col]) collData[col] = { name: col, rev: 0, orders: 0, units: 0, rev30: 0, revByMonth: {} };
      const c = collData[col];
      c.rev += net; c.units += qty;
      if (date >= t30) c.rev30 += net;
      c.revByMonth[mk] = (c.revByMonth[mk] || 0) + net;
    });
    // count order for primary collection
    const firstSku = (o.line_items?.[0]?.sku || '').trim().toUpperCase() || `pid_${o.line_items?.[0]?.product_id}`;
    const inv0 = (inventoryMap || {})[firstSku] || {};
    const primaryCol = (inv0.collections?.length > 0 ? inv0.collections[0] : null)
                    || inv0.collectionLabel || inv0.productType || o.line_items?.[0]?.product_type || 'Uncollected';
    if (collData[primaryCol]) collData[primaryCol].orders++;
  });

  const total30 = Object.values(collData).reduce((s, c) => s + c.rev30, 0);
  const totalRev = Object.values(collData).reduce((s, c) => s + c.rev, 0);

  // Monthly plan revenue for target comparison
  const planByMonth = {};
  (plan?.months || []).forEach(m => {
    const key = m.key || m.label;
    const rev = (m.ordersPerDay || 0) * 30 * (m.aov || plan?.aov || 340);
    planByMonth[key] = rev;
  });

  const results = Object.values(collData)
    .sort((a, b) => b.rev30 - a.rev30)
    .map((c, i) => {
      const months = Object.entries(c.revByMonth).sort(([a],[b]) => a.localeCompare(b));
      const lastTwo = months.slice(-2);
      const momGrowth = lastTwo.length === 2 && lastTwo[0][1] > 0
        ? ((lastTwo[1][1] - lastTwo[0][1]) / lastTwo[0][1] * 100).toFixed(1)
        : null;
      return {
        name: c.name,
        color: BCG_PALETTE[i % BCG_PALETTE.length],
        rev: Math.round(c.rev),
        rev30: Math.round(c.rev30),
        orders: c.orders,
        units: c.units,
        contribPct30: total30 > 0 ? +((c.rev30 / total30) * 100).toFixed(1) : 0,
        contribPctAll: totalRev > 0 ? +((c.rev / totalRev) * 100).toFixed(1) : 0,
        momGrowth: momGrowth !== null ? parseFloat(momGrowth) : null,
        aov: c.orders > 0 ? Math.round(c.rev30 / c.orders) : 0,
        revByMonth: c.revByMonth,
      };
    });

  return { collections: results, total30: Math.round(total30), totalRev: Math.round(totalRev) };
}

/* ──────────────────────────────────────────────────────────────
   6. GROWTH-ADJUSTED INVENTORY — Quadratic Safety Stock + ROP
   ──────────────────────────────────────────────────────────────
   Standard stock/velocity wrong for accelerating demand.
   Uses: effectiveDays = (-v + √(v²+2g×S)) / g
   Safety stock adds acceleration term: (g × LT²) / 2
   ────────────────────────────────────────────────────────────── */
export function buildGrowthAdjustedInventory({ inventoryMap, allOrders, monthlyGrowthRate = 0.20 }) {
  if (!inventoryMap || !inventoryMap.length) return [];

  const g = monthlyGrowthRate / 30; // daily acceleration (orders/day/day)
  const LT = 45;                    // lead time days (default — overridden per SKU if available)
  const Z  = 1.65;                  // 95% service level

  return inventoryMap.map(sku => {
    const stock = sku.stock || 0;
    const vel   = sku.velocity || 0;      // orders per day currently
    const lt    = sku.leadTimeDays || LT;
    const sigma = sku.demandStdDev || vel * 0.25; // fallback: 25% CV

    // Effective days of stock (quadratic correction for accelerating demand)
    let effectiveDays;
    if (g > 0 && vel > 0) {
      const discriminant = vel * vel + 2 * g * stock;
      effectiveDays = discriminant >= 0
        ? (-vel + Math.sqrt(discriminant)) / g
        : 999;
    } else if (vel > 0) {
      effectiveDays = stock / vel;
    } else {
      effectiveDays = 999;
    }
    effectiveDays = Math.max(0, Math.round(effectiveDays));

    // Naive days (what most dashboards show — always overstates)
    const naiveDays = vel > 0 ? Math.round(stock / vel) : 999;

    // Growth-adjusted safety stock
    const safetyStock = Math.ceil(Z * sigma * Math.sqrt(lt) + (g * lt * lt) / 2);

    // Reorder point
    const rop = Math.ceil(vel * lt + (g * lt * lt) / 2 + safetyStock);

    // Stockout date (from today, using effective days)
    const today = new Date();
    const stockoutDate = new Date(today);
    stockoutDate.setDate(today.getDate() + effectiveDays);

    // Order-by date: must place order `lt` days before stockout to arrive on time
    const orderByDate = new Date(stockoutDate);
    orderByDate.setDate(stockoutDate.getDate() - lt);

    // Urgency: days until order-by date
    const daysToOrderBy = Math.round((orderByDate - today) / (1000 * 60 * 60 * 24));

    // Status
    let status;
    if (stock <= 0)               status = 'oos';
    else if (effectiveDays <= 7)  status = 'critical';
    else if (effectiveDays <= 14) status = 'low';
    else if (stock <= rop)        status = 'reorder';
    else                          status = 'ok';

    // Recommended order quantity: 60-day forward coverage at accelerating velocity
    const vel60 = vel + g * 30; // velocity at midpoint of 60-day window
    const recommendedQty = Math.ceil(vel60 * 60 + safetyStock - stock);

    return {
      ...sku,
      effectiveDays,
      naiveDays,
      overstatedDays: naiveDays - effectiveDays,
      safetyStock,
      rop,
      stockoutDate:   stockoutDate.toISOString().slice(0, 10),
      orderByDate:    orderByDate.toISOString().slice(0, 10),
      daysToOrderBy,
      recommendedQty: Math.max(0, recommendedQty),
      status,
      urgency: daysToOrderBy <= 0  ? 'OVERDUE'
             : daysToOrderBy <= 7  ? 'URGENT'
             : daysToOrderBy <= 14 ? 'SOON'
             : 'OK',
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 2 + 3 — MARKETING ANALYTICS ENGINE
   ═══════════════════════════════════════════════════════════════ */

/* ── Helpers ── */
function ordersInRange(allOrders, startISO, endISO) {
  return allOrders.filter(o => {
    const d = (o.created_at || o.createdAt || '').slice(0, 10);
    return d >= startISO && d <= endISO;
  });
}
/**
 * Enriched rows carry per-ad 7D + 30D aggregates (no daily breakdown).
 * To get spend/revenue for an arbitrary date range we pro-rate the 30D total
 * by the number of days that overlap with the rolling [today-30, today] window.
 * Ranges fully outside that window return 0.
 */
function _windowOverlapDays(startISO, endISO) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const winEnd   = today.getTime();
  const winStart = winEnd - 30 * 86400000;
  const rStart = new Date(`${startISO}T00:00:00`).getTime();
  const rEnd   = new Date(`${endISO}T23:59:59`).getTime();
  const overlapMs = Math.max(0, Math.min(winEnd, rEnd) - Math.max(winStart, rStart));
  return overlapMs / 86400000;
}
function spendInRange(rows, startISO, endISO) {
  const total30 = (rows || []).reduce((s, r) => s + parseFloat(r.spend30d || r.spend || 0), 0);
  const days = _windowOverlapDays(startISO, endISO);
  return days > 0 ? total30 * (days / 30) : 0;
}
function revenueInRange(rows, startISO, endISO) {
  const total30 = (rows || []).reduce((s, r) => s + parseFloat(r.revenue30d || r.revenue || 0), 0);
  const days = _windowOverlapDays(startISO, endISO);
  return days > 0 ? total30 * (days / 30) : 0;
}
function pctStatus(pct, isPartial = false) {
  const threshold = isPartial ? 80 : 90;
  return pct >= threshold ? 'on-track' : pct >= 65 ? 'behind' : 'critical';
}

/* ──────────────────────────────────────────────────────────────
   PHASE 2 · 1 — Weekly Marketing Tracker (16-week rolling window)
   ────────────────────────────────────────────────────────────── */
export function buildWeeklyMarketingTracker({ plan, allOrders, enrichedRows }) {
  const now = new Date();
  now.setHours(12, 0, 0, 0); // midday for comparison
  const weeks = [];

  // Start 8 weeks back, aligned to Monday
  const anchor = new Date(now);
  anchor.setDate(anchor.getDate() - 56);
  const dow = anchor.getDay();
  anchor.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));

  for (let w = 0; w < 20; w++) {
    const wStart = new Date(anchor);
    wStart.setDate(anchor.getDate() + w * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6);
    wEnd.setHours(23, 59, 59, 999);

    const s = wStart.toISOString().slice(0, 10);
    const e = wEnd.toISOString().slice(0, 10);

    // Find plan month by mid-week
    const mid = new Date(wStart); mid.setDate(wStart.getDate() + 3);
    const monthKey = `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, '0')}`;
    const pm = plan.months?.find(m => m.key === monthKey);

    const daysInWeek = 7;
    const aov = pm?.aov || plan.aov || 340;
    const targetOrders  = pm ? pm.ordersPerDay * daysInWeek : 0;
    const targetSpend   = pm ? pm.adBudgetPerDay * daysInWeek : 0;
    const targetRevenue = targetOrders * aov;
    const targetROAS    = targetSpend > 0 ? +(targetRevenue / targetSpend).toFixed(2) : 0;
    const targetCAC     = targetOrders > 0 ? Math.round(targetSpend / targetOrders) : (plan.cpr || 55);

    const weekOrders   = ordersInRange(allOrders, s, e);
    const actualOrders = weekOrders.length;
    const actualRevenue= weekOrders.reduce((sum, o) => sum + parseFloat(o.total_price || o.totalPrice || 0), 0);
    const actualSpend  = spendInRange(enrichedRows, s, e);
    const metaRevenue  = revenueInRange(enrichedRows, s, e);
    const useRevForROAS = metaRevenue > 0 ? metaRevenue : actualRevenue;
    const actualROAS   = actualSpend > 0 ? +(useRevForROAS / actualSpend).toFixed(2) : 0;
    const actualCAC    = actualOrders > 0 ? Math.round(actualSpend / actualOrders) : 0;

    const isPast    = wEnd < now;
    const isCurrent = wStart <= now && now <= wEnd;
    const isFuture  = wStart > now;

    let status = 'future';
    let ordersPct = 0;
    if (!isFuture && pm && targetOrders > 0) {
      if (isCurrent) {
        const elapsed = Math.max(1, (now - wStart) / 86400000);
        const expected = pm.ordersPerDay * elapsed;
        const prorated = expected > 0 ? actualOrders / expected * 100 : 100;
        ordersPct = +prorated.toFixed(1);
        status = pctStatus(prorated, true);
      } else {
        ordersPct = +(actualOrders / targetOrders * 100).toFixed(1);
        status = pctStatus(ordersPct, false);
      }
    }

    weeks.push({
      w, s, e, monthKey,
      label: `W${w + 1}`,
      dateRange: `${wStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${wEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
      monthLabel: pm?.label || '—',
      isPast, isCurrent, isFuture,
      targetOrders, actualOrders,
      targetRevenue: Math.round(targetRevenue), actualRevenue: Math.round(actualRevenue),
      targetSpend: Math.round(targetSpend), actualSpend: Math.round(actualSpend),
      targetROAS, actualROAS,
      targetCAC, actualCAC,
      ordersPct,
      spendPct: targetSpend > 0 ? +(actualSpend / targetSpend * 100).toFixed(1) : 0,
      roasDelta: targetROAS > 0 ? +(actualROAS - targetROAS).toFixed(2) : 0,
      status,
    });
  }
  return weeks;
}

/* ──────────────────────────────────────────────────────────────
   PHASE 2 · 2 — Monthly Marketing Actuals (plan + live Meta + Shopify)
   ────────────────────────────────────────────────────────────── */
export function buildMonthlyMarketingActuals({ plan, allOrders, enrichedRows }) {
  const now = new Date();
  return (plan.months || []).map(m => {
    const [yr, mo] = m.key.split('-').map(Number);
    const days   = DAYS_IN(yr, mo);
    const s      = `${m.key}-01`;
    const e      = `${m.key}-${String(days).padStart(2, '0')}`;
    const mStart = new Date(yr, mo - 1, 1);
    const mEnd   = new Date(yr, mo, 0, 23, 59, 59);

    const monthOrders   = ordersInRange(allOrders, s, e);
    const actualOrders  = monthOrders.length;
    const actualRevenue = monthOrders.reduce((sum, o) => sum + parseFloat(o.total_price || o.totalPrice || 0), 0);
    const actualSpend   = spendInRange(enrichedRows, s, e);
    const metaRevenue   = revenueInRange(enrichedRows, s, e);
    const useRev = metaRevenue > 0 ? metaRevenue : actualRevenue;

    const targetOrders  = m.ordersPerDay * days;
    const targetRevenue = targetOrders * (m.aov || plan.aov || 340);
    const targetSpend   = m.adBudgetPerDay * days;
    const targetROAS    = targetSpend > 0 ? +(targetRevenue / targetSpend).toFixed(2) : 0;
    const actualROAS    = actualSpend > 0 ? +(useRev / actualSpend).toFixed(2) : 0;
    const actualCAC     = actualOrders > 0 ? Math.round(actualSpend / actualOrders) : 0;

    const isPast    = mEnd < now;
    const isCurrent = mStart <= now && now <= mEnd;
    const isFuture  = mStart > now;
    const hasData   = actualOrders > 0 || actualSpend > 0;

    let status = 'future', ordersPct = 0;
    if (hasData && !isFuture) {
      if (isCurrent) {
        const elapsed = Math.max(1, (now - mStart) / 86400000);
        const expected = m.ordersPerDay * elapsed;
        ordersPct = expected > 0 ? +(actualOrders / expected * 100).toFixed(1) : 0;
        status = pctStatus(ordersPct, true);
      } else {
        ordersPct = targetOrders > 0 ? +(actualOrders / targetOrders * 100).toFixed(1) : 0;
        status = pctStatus(ordersPct, false);
      }
    }

    return {
      key: m.key, label: m.label,
      targetOrders, actualOrders,
      targetRevenue: Math.round(targetRevenue), actualRevenue: Math.round(actualRevenue),
      targetSpend: Math.round(targetSpend), actualSpend: Math.round(actualSpend),
      targetROAS, actualROAS,
      targetCAC: Math.round(plan.cpr || 55), actualCAC,
      ordersPct, spendPct: targetSpend > 0 ? +(actualSpend / targetSpend * 100).toFixed(1) : 0,
      isPast, isCurrent, isFuture, hasData, status,
      ordersPerDay: m.ordersPerDay, adBudgetPerDay: m.adBudgetPerDay,
    };
  });
}

/* ──────────────────────────────────────────────────────────────
   PHASE 2 · 3 — Creative Health Scoring
   ────────────────────────────────────────────────────────────── */
export function buildCreativeHealth({ enrichedRows, plan }) {
  if (!enrichedRows?.length) return [];
  const map = {};
  enrichedRows.forEach(r => {
    const name = r.ad_name || r.adName || r.name || 'Unknown';
    if (!map[name]) map[name] = { name, spend: 0, revenue: 0, impressions: 0, clicks: 0, orders: 0, days: new Set() };
    map[name].spend       += parseFloat(r.spend || 0);
    map[name].revenue     += parseFloat(r.purchase_value || r.revenue || r.purchaseValue || 0);
    map[name].impressions += parseInt(r.impressions || 0, 10);
    map[name].clicks      += parseInt(r.clicks || 0, 10);
    map[name].orders      += parseInt(r.results || r.purchases || 0, 10);
    if (r.date) map[name].days.add(r.date.slice(0, 10));
  });

  const targetROAS = plan.collectionRoas ? Math.max(...Object.values(plan.collectionRoas)) : 4;

  return Object.values(map)
    .filter(c => c.spend > 500)
    .map(c => {
      const roas  = c.spend > 0 ? +(c.revenue / c.spend).toFixed(2) : 0;
      const ctr   = c.impressions > 0 ? +(c.clicks / c.impressions * 100).toFixed(2) : 0;
      const cpc   = c.clicks > 0 ? Math.round(c.spend / c.clicks) : 0;
      const cac   = c.orders > 0 ? Math.round(c.spend / c.orders) : 0;
      const cpm   = c.impressions > 0 ? +(c.spend / c.impressions * 1000).toFixed(0) : 0;
      const activeDays = c.days.size;

      const roasScore = Math.min(100, roas / targetROAS * 100);
      const ctrScore  = Math.min(100, ctr / 2 * 100);
      const healthScore = Math.round(roasScore * 0.6 + ctrScore * 0.4);

      return {
        name: c.name, spend: Math.round(c.spend), revenue: Math.round(c.revenue),
        impressions: c.impressions, clicks: c.clicks, orders: c.orders,
        roas, ctr, cpc, cac, cpm, activeDays, healthScore,
        health: healthScore >= 70 ? 'strong' : healthScore >= 45 ? 'ok' : 'weak',
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);
}

/* ──────────────────────────────────────────────────────────────
   PHASE 3 · 1 — LTV:CAC Analysis per Collection
   ────────────────────────────────────────────────────────────── */
export function buildLTVCAC({ plan, allOrders }) {
  const cols = Object.keys(plan.collectionAlloc || {});
  const aov  = plan.aov || 340;
  const gm   = plan.grossMarginPct || 0.50;
  const cpr  = plan.cpr || 55;

  // Estimate repeat rate from order history
  const custOrders = {};
  allOrders.forEach(o => {
    const id = o.customer?.id || o.email || o.customer_email || 'anon';
    custOrders[id] = (custOrders[id] || 0) + 1;
  });
  const totalCust  = Object.keys(custOrders).length || 1;
  const repeatCust = Object.values(custOrders).filter(n => n > 1).length;
  const repeatRate = Math.max(0.15, repeatCust / totalCust);
  const monthlyRepurchase = repeatRate * 0.12; // monthly purchase probability for repeat customers

  // Average monthly ad budget across plan
  const avgMonthBudget = (plan.months || []).reduce((s, m) => s + m.adBudgetPerDay * 30, 0) / (plan.months?.length || 1);

  const COLL_LABELS = { plants: 'Plants', seeds: 'Seeds', allMix: 'All Mix', colA: 'Col A', colB: 'Col B', colC: 'Col C' };

  return cols.map(coll => {
    const allocPct = plan.collectionAlloc[coll] || 0;
    const roas     = plan.collectionRoas?.[coll] || 4;
    const collBudget  = avgMonthBudget * allocPct;
    const collRevenue = collBudget * roas;
    const collOrders  = aov > 0 ? collRevenue / aov : 0;
    const cac = collOrders > 0 ? Math.round(collBudget / collOrders) : cpr;

    // LTV: AOV × gross margin × expected lifetime orders
    const avgLifetimeOrders = 1 + repeatRate * 18 * monthlyRepurchase; // 18-month window
    const ltv = Math.round(aov * gm * avgLifetimeOrders * 0.85); // 15% time-value discount

    const ratio = cac > 0 ? +(ltv / cac).toFixed(2) : 0;
    const payback = aov * gm * monthlyRepurchase > 0
      ? +(cac / (aov * gm * monthlyRepurchase)).toFixed(1) : 24;

    return {
      coll, label: COLL_LABELS[coll] || coll, allocPct: Math.round(allocPct * 100),
      roas, cac, ltv, ratio, payback,
      collRevenue: Math.round(collRevenue),
      health: ratio >= 3 ? 'strong' : ratio >= 2 ? 'ok' : 'weak',
    };
  });
}

/* ──────────────────────────────────────────────────────────────
   PHASE 3 · 2 — McKinsey Revenue Decomposition
   ΔRevenue = Volume effect + Price (AOV) effect + Mix residual
   ────────────────────────────────────────────────────────────── */
export function buildMcKinseyDecomp({ plan, pva }) {
  if (!pva || pva.length < 2) return [];
  const aovFallback = plan.aov || 340;
  return pva.slice(1).map((m, i) => {
    const prev = pva[i];
    const prevAov    = (plan.months?.[i]?.aov   || aovFallback);
    const currAov    = (plan.months?.[i+1]?.aov || aovFallback);
    const prevOrders = (plan.months?.[i]?.ordersPerDay   || 0) * (prev.days || 30);
    const currOrders = (plan.months?.[i+1]?.ordersPerDay || 0) * (m.days   || 30);

    const volumeEffect = Math.round((currOrders - prevOrders) * prevAov);
    const priceEffect  = Math.round((currAov - prevAov) * currOrders);
    const totalDelta   = Math.round(m.planRevenue - prev.planRevenue);
    const mixEffect    = totalDelta - volumeEffect - priceEffect;

    return {
      key: m.key, label: m.label,
      totalDelta, volumeEffect, priceEffect, mixEffect,
      pct: prev.planRevenue > 0 ? +((totalDelta / prev.planRevenue) * 100).toFixed(1) : 0,
      prevRevenue: Math.round(prev.planRevenue),
      currRevenue: Math.round(m.planRevenue),
    };
  });
}
