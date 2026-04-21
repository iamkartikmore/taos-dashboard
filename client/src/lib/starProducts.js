/* ─── STAR PRODUCTS ─────────────────────────────────────────────────────
   Two-axis MBA framework (Economic Value × Strategic Value) for per-SKU
   portfolio decisions. Builds on order line_items + inventoryMap; uses
   plan.grossMarginPct (default 0.50) as margin proxy when per-SKU COGS
   is unavailable.

   Pillars
   ─ Economic Value   = revenue_share · gross_contribution · momentum
   ─ Strategic Value  = gateway_rate  · repeat_rate · bundle_affinity

   Each pillar is percentile-ranked within the brand (robust to outliers
   and small catalogs), then weighted per preset. Quadrant labels based
   on median splits — INVESTIGATE for thin-data SKUs.
   ──────────────────────────────────────────────────────────────────── */

const p = v => parseFloat(v || 0);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export const PRESETS = {
  balanced: {
    label: 'Balanced',
    desc: 'Equal weight to acquisition, retention, basket lift.',
    econ: { revenue: 0.40, margin: 0.30, momentum: 0.30 },
    strat:{ gateway: 0.40, repeat: 0.30, bundle: 0.30 },
  },
  acquisition: {
    label: 'Acquisition-led',
    desc: 'Weights gateway SKUs — CAC is the bottleneck.',
    econ: { revenue: 0.30, margin: 0.20, momentum: 0.50 },
    strat:{ gateway: 0.60, repeat: 0.15, bundle: 0.25 },
  },
  retention: {
    label: 'Retention-led',
    desc: 'Weights repeat-driver SKUs — LTV is the lever.',
    econ: { revenue: 0.35, margin: 0.40, momentum: 0.25 },
    strat:{ gateway: 0.20, repeat: 0.55, bundle: 0.25 },
  },
};

/* ─── percentile ranks: 0-1, robust to outliers and small N ───── */
function rankPct(values) {
  const n = values.length;
  if (!n) return new Map();
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Map();
  sorted.forEach(({ i }, rank) => {
    out.set(i, n === 1 ? 0.5 : rank / (n - 1));
  });
  return out;
}

/* ─── BUILD ─────────────────────────────────────────────────────── */
export function buildStarProducts({ orders = [], inventoryMap = {}, plan = {}, preset = 'balanced', windowDays = 90 } = {}) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86400000);
  const cutoff30    = new Date(now.getTime() - 30 * 86400000);
  const cutoff14    = new Date(now.getTime() - 14 * 86400000);
  const cutoff60    = new Date(now.getTime() - 60 * 86400000);

  const marginPct = plan.grossMarginPct != null ? plan.grossMarginPct : 0.50;
  const w = PRESETS[preset] || PRESETS.balanced;

  /* ── pass 1: filter orders to window, accrue per-SKU aggregates ── */
  const inWindow = [];
  const skuMap   = {};
  const skuOrderIds = {};                  // unique order IDs per SKU
  const crossSell  = {};                   // pair -> count
  const skuOrderCount = {};                // unique order count for lift base
  let totalOrdersInWindow = 0;
  let totalRevenueInWindow = 0;
  let multiItemOrders = 0;
  let firstOrderDate = null;

  for (const o of orders) {
    const date = new Date(o.created_at || o.processed_at || 0);
    if (isNaN(date) || date < windowStart) continue;
    inWindow.push(o);
    totalOrdersInWindow++;
    totalRevenueInWindow += p(o.total_price);
    if (!firstOrderDate || date < firstOrderDate) firstOrderDate = date;

    const ordersCount = o.customer?.orders_count ?? 1;
    const isNewCust   = ordersCount === 1;
    const within30    = date >= cutoff30;
    const within14    = date >= cutoff14;

    const items = o.line_items || [];
    const uSkus = [];
    const seenSkus = new Set();
    for (const item of items) {
      const sku = (item.sku || '').trim().toUpperCase() || `pid_${item.product_id || 'unk'}`;
      const qty = item.quantity || 1;
      const gross = p(item.price) * qty;
      const iDisc = p(item.total_discount);
      const net = gross - iDisc;

      if (!skuMap[sku]) {
        const inv = inventoryMap[sku] || {};
        skuMap[sku] = {
          sku,
          name: inv.title || item.title || sku,
          image: inv.image || '',
          collection: inv.collectionLabel || inv.productType || '',
          stock: inv.stock ?? null,
          price: inv.price ?? p(item.price),
          revenueWindow: 0, revenue30d: 0, revenue14d: 0,
          unitsWindow: 0,   units30d: 0,   units14d: 0,
          ordersWindow: 0,  orders30d: 0,
          newOrders: 0,     repeatOrders: 0,
          soloOrders: 0,    bundleOrders: 0,
          firstSeen: date,  lastSeen: date,
        };
      }
      const s = skuMap[sku];
      s.revenueWindow += net;
      s.unitsWindow   += qty;
      if (within30) { s.revenue30d += net; s.units30d += qty; }
      if (within14) { s.revenue14d += net; s.units14d += qty; }
      if (date < s.firstSeen) s.firstSeen = date;
      if (date > s.lastSeen)  s.lastSeen  = date;
      if (!seenSkus.has(sku)) { uSkus.push(sku); seenSkus.add(sku); }
    }

    const isMulti = uSkus.length > 1;
    if (isMulti) multiItemOrders++;
    uSkus.forEach(sku => {
      const s = skuMap[sku];
      s.ordersWindow++;
      if (within30) s.orders30d++;
      if (isNewCust) s.newOrders++; else s.repeatOrders++;
      if (isMulti)   s.bundleOrders++; else s.soloOrders++;
      skuOrderCount[sku] = (skuOrderCount[sku] || 0) + 1;
    });

    // pair co-occurrence (cap to avoid O(n²) on huge baskets)
    if (isMulti && uSkus.length <= 12) {
      for (let i = 0; i < uSkus.length; i++)
        for (let j = i + 1; j < uSkus.length; j++) {
          const key = [uSkus[i], uSkus[j]].sort().join('|');
          crossSell[key] = (crossSell[key] || 0) + 1;
        }
    }
  }

  const effectiveDays = Math.max(1, Math.min(windowDays, firstOrderDate
    ? Math.ceil((now - firstOrderDate) / 86400000) + 1
    : windowDays));

  /* ── pass 2: per-SKU derived metrics ── */
  const skus = Object.values(skuMap).map(s => {
    const grossContribution = s.revenueWindow * marginPct;
    const velocity14 = s.units14d / 14;
    const velocity30 = s.units30d / 30;
    const momentum   = velocity30 > 0 ? (velocity14 - velocity30) / velocity30 : 0;   // -1..+∞
    const daysSince  = s.lastSeen ? Math.ceil((now - s.lastSeen) / 86400000) : null;
    // History threshold scales with the window so short windows (7d/14d) don't
    // flag every SKU as thin. Cap at 60d for long windows.
    const historyThreshold = Math.min(60, Math.max(3, windowDays * 0.4));
    const hasHistory = s.firstSeen ? (now - s.firstSeen) / 86400000 >= historyThreshold : false;
    const revenueShare = totalRevenueInWindow > 0 ? s.revenueWindow / totalRevenueInWindow : 0;
    const gatewayRate  = s.ordersWindow > 0 ? s.newOrders / s.ordersWindow : 0;
    const repeatRate   = s.ordersWindow > 0 ? s.repeatOrders / s.ordersWindow : 0;
    const bundleRate   = s.ordersWindow > 0 ? s.bundleOrders / s.ordersWindow : 0;
    const dailyUnits   = s.unitsWindow / effectiveDays;
    const daysOfStock  = s.stock != null && dailyUnits > 0 ? s.stock / dailyUnits : null;

    return {
      ...s,
      revenueShare, grossContribution, momentum,
      velocity14, velocity30, dailyUnits, daysOfStock, daysSince,
      gatewayRate, repeatRate, bundleRate,
      hasHistory, thinData: s.ordersWindow < 5 || !hasHistory,
    };
  });

  /* ── pass 3: percentile-rank each pillar, compose scores ── */
  const rev  = rankPct(skus.map(s => s.revenueShare));
  const marg = rankPct(skus.map(s => s.grossContribution));
  const mom  = rankPct(skus.map(s => s.momentum));
  const gate = rankPct(skus.map(s => s.gatewayRate));
  const rep  = rankPct(skus.map(s => s.repeatRate));
  const bund = rankPct(skus.map(s => s.bundleRate));

  skus.forEach((s, i) => {
    s.econRank  = (rev.get(i) || 0)  * w.econ.revenue
                + (marg.get(i) || 0) * w.econ.margin
                + (mom.get(i) || 0)  * w.econ.momentum;
    s.stratRank = (gate.get(i) || 0) * w.strat.gateway
                + (rep.get(i) || 0)  * w.strat.repeat
                + (bund.get(i) || 0) * w.strat.bundle;
    // Star Score: Euclidean combination, scaled 0-100
    s.starScore = Math.sqrt(s.econRank * s.econRank + s.stratRank * s.stratRank)
                  / Math.SQRT2 * 100;
  });

  /* ── pass 4: quadrant action labels via median splits ──
     Medians are computed only over non-thin SKUs so the "playable" portfolio
     actually splits into four quadrants. Including thin-data SKUs drags the
     econ median down (they have tiny revenue shares), causing every real SKU
     to land hiEcon and collapse into DOUBLE DOWN / MILK. */
  const playable = skus.filter(s => !s.thinData);
  const econMedian  = median(playable.map(s => s.econRank));
  const stratMedian = median(playable.map(s => s.stratRank));
  skus.forEach(s => {
    if (s.thinData) { s.action = 'INVESTIGATE'; s.quadrant = 'thin'; return; }
    const hiEcon  = s.econRank  >= econMedian;
    const hiStrat = s.stratRank >= stratMedian;
    if (hiEcon && hiStrat)       { s.action = 'DOUBLE DOWN'; s.quadrant = 'star'; }
    else if (hiEcon && !hiStrat) { s.action = 'MILK';        s.quadrant = 'cash'; }
    else if (!hiEcon && hiStrat) {
      s.action = s.bundleRate >= 0.60 ? 'BUNDLE' : 'BET';
      s.quadrant = s.bundleRate >= 0.60 ? 'bundle' : 'question';
    } else                       { s.action = 'EXIT';        s.quadrant = 'dog'; }
  });

  skus.sort((a, b) => b.starScore - a.starScore);

  /* ── concentration stats ── */
  const hhi = skus.reduce((sum, s) => sum + s.revenueShare * s.revenueShare, 0) * 10000;
  const top5Share = skus.slice(0, 5).reduce((sum, s) => sum + s.revenueShare, 0);
  const top10Share = skus.slice(0, 10).reduce((sum, s) => sum + s.revenueShare, 0);

  const totalNewOrders = skus.reduce((sum, s) => sum + s.newOrders, 0);
  const gatewayTop3Share = totalNewOrders > 0
    ? [...skus].sort((a, b) => b.newOrders - a.newOrders).slice(0, 3)
        .reduce((sum, s) => sum + s.newOrders, 0) / totalNewOrders
    : 0;

  /* ── bundle radar: top pairs by lift × support ── */
  const totalOrdersForLift = totalOrdersInWindow || 1;
  const bundles = Object.entries(crossSell).map(([key, count]) => {
    const [a, b] = key.split('|');
    const countA = skuOrderCount[a] || 1;
    const countB = skuOrderCount[b] || 1;
    const support = count / totalOrdersForLift;
    const supportA = countA / totalOrdersForLift;
    const supportB = countB / totalOrdersForLift;
    const lift = supportA > 0 && supportB > 0 ? support / (supportA * supportB) : 0;
    const confidence = count / countA; // P(B | A)
    return {
      a, b,
      nameA: skuMap[a]?.name || a,
      nameB: skuMap[b]?.name || b,
      count, support, lift, confidence,
      score: lift * Math.log2(1 + count),
    };
  })
  .filter(pair => pair.count >= 3 && pair.lift > 1.2)
  .sort((a, b) => b.score - a.score)
  .slice(0, 15);

  /* ── summary ── */
  const summary = {
    windowDays: effectiveDays,
    windowStartISO: iso(windowStart),
    windowEndISO: iso(now),
    totalSkus: skus.length,
    totalOrders: totalOrdersInWindow,
    totalRevenue: totalRevenueInWindow,
    multiItemOrders,
    multiItemRate: totalOrdersInWindow > 0 ? multiItemOrders / totalOrdersInWindow : 0,
    marginPctUsed: marginPct,
    preset,
    counts: {
      doubleDown: skus.filter(s => s.action === 'DOUBLE DOWN').length,
      milk:       skus.filter(s => s.action === 'MILK').length,
      bet:        skus.filter(s => s.action === 'BET').length,
      bundle:     skus.filter(s => s.action === 'BUNDLE').length,
      exit:       skus.filter(s => s.action === 'EXIT').length,
      investigate:skus.filter(s => s.action === 'INVESTIGATE').length,
    },
  };

  return {
    skus,
    summary,
    concentration: { hhi, top5Share, top10Share, gatewayTop3Share },
    bundles,
    medians: { econ: econMedian, strat: stratMedian },
  };
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const ACTION_STYLES = {
  'DOUBLE DOWN': { color: '#22c55e', bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', desc: 'High Econ × High Strat. Scale spend, protect stock.' },
  'MILK':        { color: '#38bdf8', bg: 'bg-sky-500/15',      text: 'text-sky-300',     border: 'border-sky-500/30',     desc: 'High Econ × Low Strat. Harvest margin, minimal reinvestment.' },
  'BET':         { color: '#a78bfa', bg: 'bg-violet-500/15',   text: 'text-violet-300',  border: 'border-violet-500/30',  desc: 'Low Econ × High Strat. Test scale — strategic pull exists.' },
  'BUNDLE':      { color: '#f59e0b', bg: 'bg-amber-500/15',    text: 'text-amber-300',   border: 'border-amber-500/30',   desc: 'Attaches to orders. Bundle rather than advertise alone.' },
  'EXIT':        { color: '#ef4444', bg: 'bg-red-500/15',      text: 'text-red-300',     border: 'border-red-500/30',     desc: 'Low Econ × Low Strat. Delist unless it has a non-commercial role.' },
  'INVESTIGATE': { color: '#64748b', bg: 'bg-gray-500/15',     text: 'text-slate-300',   border: 'border-gray-500/30',    desc: 'Under 60d of data or < 5 orders. Revisit next cycle.' },
};
