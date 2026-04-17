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

/* ─── DEFAULT PLAN (seeded from Excel) ─────────────────────────────── */
export const DEFAULT_PLAN = {
  aov: 340,
  cpr: 55,
  avgBudgetPerCampaign: 1136,
  avgCreativesPerCampaign: 1.75,
  inventoryCostPct: 0.20,
  grossMarginPct:   0.50,
  opsCostPct:       0.12,

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
    { id: 'wh1', name: 'Pune WH1',  location: 'Pune',      capacity: 5000, active: true, notes: 'Primary — all categories',     skuCategories: 'Plants, All Mix' },
    { id: 'wh2', name: 'Pune WH2',  location: 'Pune',      capacity: 3000, active: true, notes: 'Expanding capacity',            skuCategories: 'Plants, All Mix' },
    { id: 'wh3', name: 'Hyderabad', location: 'Hyderabad', capacity: 2000, active: true, notes: 'Seeds & Dawbu — transitioning', skuCategories: 'Seeds, Dawbu' },
  ],

  suppliers: [
    { id: 'sup1', name: 'Pune Nursery Collective', category: 'Plants', leadTimeDays: 3,  paymentTerms: 'Advance', moqUnits: 50,  notes: 'Primary plant supplier' },
    { id: 'sup2', name: 'Maharashtra Seeds Co.',   category: 'Seeds',  leadTimeDays: 5,  paymentTerms: 'Advance', moqUnits: 200, notes: 'Seeds & seed kits' },
    { id: 'sup3', name: 'All Mix Vendor',           category: 'Mix',    leadTimeDays: 4,  paymentTerms: 'Net-7',   moqUnits: 100, notes: 'All Mix collection' },
  ],

  notes: '',
  manualOverrides: {},
};

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

  return plan.months.map(m => {
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
  const { cpr, avgBudgetPerCampaign, avgCreativesPerCampaign, collectionAlloc, collectionRoas } = plan;
  const [yr, mo] = monthPlan.key.split('-').map(Number);
  const days = DAYS_IN(yr, mo);
  const campaigns      = Math.ceil(adBudgetPerDay / avgBudgetPerCampaign);
  const creatives      = Math.ceil(campaigns * avgCreativesPerCampaign);
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
  const currentPlan = plan.months.find(m => m.key === currentKey);
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
  const forecast = plan.months.filter(m => m.key >= currentKey).slice(0, 4).map((m, i) => {
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
  const scenarios = plan.months.filter(m => m.key >= currentKey).slice(0, 6).map(m => {
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

  const whatToPublish = Object.entries(plan.collectionAlloc).map(([key, pct]) => {
    const label = key === 'allMix' ? 'All Mix' : key.charAt(0).toUpperCase() + key.slice(1);
    const colData = collections.find(c => c.name.toLowerCase().includes(key.toLowerCase()));
    const currentRoas = colData?.avgRoas || 0;
    const targetRoas  = plan.collectionRoas[key] || 0;
    const gap = targetRoas > 0 ? ((currentRoas - targetRoas) / targetRoas) * 100 : 0;
    return {
      collection: label, key,
      budgetShare: Math.round(pct * 100),
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
  const currentBudget   = plan.months.find(m => {
    const n = new Date(); return m.key === MONTH_KEY(n);
  })?.adBudgetPerDay || 0;

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
