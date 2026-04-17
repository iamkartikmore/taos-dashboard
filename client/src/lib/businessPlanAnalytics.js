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
  brandName: 'Dawbu',

  /* ── 5 core inputs — everything else derives from these ── */
  baseOrdersPerDay:  350,
  monthlyGrowthRate: 0.20,
  targetCpr:   70,
  targetRoas:  4.5,
  aov:         350,

  /* ── unit economics ── */
  avgBudgetPerCampaign:    620,
  avgCreativesPerCampaign: 1.0,
  inventoryCostPct: 0.30,
  grossMarginPct:   0.60,
  opsCostPct:       0.05,

  /* ── collections: drives budget split, ROAS targets, procurement ── */
  collections: [
    { key: 'buildingBlock',   label: 'Building Block',   alloc: 0.49, roas: 4.20,  cpr: 124, color: '#818cf8' },
    { key: 'miniature',       label: 'Miniature',        alloc: 0.31, roas: 4.07,  cpr: 82,  color: '#22c55e' },
    { key: 'diamondPainting', label: 'Diamond Painting', alloc: 0.07, roas: 11.47, cpr: 86,  color: '#f59e0b' },
    { key: 'other',           label: 'Other',            alloc: 0.13, roas: 6.18,  cpr: 89,  color: '#64748b' },
  ],

  /* ── SKU dimensions: drives warehouse space calculation ── */
  skuDimensions: [
    { key: 'buildingBlock',   label: 'Building Block',   lengthCm: 30, widthCm: 20, heightCm: 15, unitsPerOrder: 1.2, bufferDays: 75 },
    { key: 'miniature',       label: 'Miniature',        lengthCm: 20, widthCm: 15, heightCm: 10, unitsPerOrder: 1.0, bufferDays: 75 },
    { key: 'diamondPainting', label: 'Diamond Painting', lengthCm: 25, widthCm: 20, heightCm:  5, unitsPerOrder: 1.0, bufferDays: 45 },
    { key: 'other',           label: 'Other',            lengthCm: 15, widthCm: 10, heightCm:  5, unitsPerOrder: 1.5, bufferDays: 30 },
  ],

  /* ── warehouses: sqMeters × height × utilization = usable m³ ── */
  warehouses: [
    { id: 'wh1', name: 'Pune WH1',  location: 'Pune',   sqMeters: 500, heightMeters: 3.5, utilizationPct: 0.70, active: true,  notes: 'Primary — BB + Mini' },
    { id: 'wh2', name: 'Pune WH2',  location: 'Pune',   sqMeters: 300, heightMeters: 3.5, utilizationPct: 0.70, active: false, notes: 'Activate at Growth stage' },
    { id: 'wh3', name: 'Mumbai WH', location: 'Mumbai', sqMeters: 400, heightMeters: 4.0, utilizationPct: 0.70, active: false, notes: 'West hub — Accelerate stage' },
  ],

  /* ── suppliers: collectionKey links to collections array ── */
  suppliers: [
    { id: 'sup1', name: 'China Import BB',   category: 'Building Block',   collectionKey: 'buildingBlock',   leadTimeDays: 45, paymentTerms: 'Advance', moqUnits: 500, notes: 'Sea freight 40–45 days' },
    { id: 'sup2', name: 'China Import Mini', category: 'Miniature',        collectionKey: 'miniature',       leadTimeDays: 45, paymentTerms: 'Advance', moqUnits: 300, notes: 'Sea freight 40–45 days' },
    { id: 'sup3', name: 'China Import DP',   category: 'Diamond Painting', collectionKey: 'diamondPainting', leadTimeDays: 30, paymentTerms: 'Advance', moqUnits: 200, notes: 'Air freight when urgent' },
    { id: 'sup4', name: 'Local Accessories', category: 'Other',            collectionKey: 'other',           leadTimeDays: 7,  paymentTerms: 'Net-7',   moqUnits: 50,  notes: 'Local add-ons' },
  ],

  notes: '',
};

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
