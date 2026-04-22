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

/* ─── INVENTORY DEFAULTS (used when procurement has no per-SKU data) ── */
const DEFAULT_LEAD_TIME_DAYS = 14;
const DEFAULT_SAFETY_DAYS    = 7;
const OVERSTOCK_DAYS         = 180;

/* ─── BUILD ─────────────────────────────────────────────────────── */
export function buildStarProducts({ orders = [], inventoryMap = {}, plan = {}, procurement = {}, merchantBySku = null, preset = 'balanced', windowDays = 90 } = {}) {
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
          shopifyProductId: inv.productId || item.product_id || null,
          handle: inv.handle || null,
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

  const suppliers = procurement?.suppliers || {};

  /* ── pass 2: per-SKU derived metrics ── */
  const skus = Object.values(skuMap).map(s => {
    const grossContribution = s.revenueWindow * marginPct;
    const velocity14 = s.units14d / 14;
    const velocity30 = s.units30d / 30;
    const momentum   = velocity30 > 0 ? (velocity14 - velocity30) / velocity30 : 0;   // -1..+∞
    const daysSince  = s.lastSeen ? Math.ceil((now - s.lastSeen) / 86400000) : null;
    const historyThreshold = Math.min(60, Math.max(3, windowDays * 0.4));
    const hasHistory = s.firstSeen ? (now - s.firstSeen) / 86400000 >= historyThreshold : false;
    const revenueShare = totalRevenueInWindow > 0 ? s.revenueWindow / totalRevenueInWindow : 0;
    const gatewayRate  = s.ordersWindow > 0 ? s.newOrders / s.ordersWindow : 0;
    const repeatRate   = s.ordersWindow > 0 ? s.repeatOrders / s.ordersWindow : 0;
    const bundleRate   = s.ordersWindow > 0 ? s.bundleOrders / s.ordersWindow : 0;
    const dailyUnits   = s.unitsWindow / effectiveDays;
    const daysOfStock  = s.stock != null && dailyUnits > 0 ? s.stock / dailyUnits : null;

    /* ── inventory layer: forward-looking, lead-time aware ────────── */
    // Use the higher of recent (14d) and trailing (30d) daily rate as the demand
    // baseline so we don't under-project hot SKUs. Apply positive momentum only
    // (never *lower* forecast below observed — stockout decisions should be
    // conservative).
    const baseVel        = Math.max(velocity14, velocity30, dailyUnits);
    const momentumBoost  = momentum > 0 ? Math.min(momentum, 1) : 0;   // cap at +100%
    const forwardVelocity = baseVel * (1 + momentumBoost);
    const forwardDoS = s.stock != null && forwardVelocity > 0
      ? s.stock / forwardVelocity
      : (s.stock != null && s.stock > 0 ? 999 : null);

    const supplier = suppliers[s.sku] || {};
    const leadTimeDays = Number(supplier.leadTimeDays) > 0 ? Number(supplier.leadTimeDays) : DEFAULT_LEAD_TIME_DAYS;
    const safetyDays   = Number(supplier.safetyDays)   > 0 ? Number(supplier.safetyDays)   : DEFAULT_SAFETY_DAYS;
    const reorderPoint = (leadTimeDays + safetyDays) * forwardVelocity;
    const safetyStock  = safetyDays * forwardVelocity;
    const reorderByDate = (forwardDoS != null && forwardDoS < 999 && leadTimeDays > 0 && forwardVelocity > 0)
      ? new Date(now.getTime() + Math.max(0, (forwardDoS - leadTimeDays)) * 86400000).toISOString().slice(0, 10)
      : null;

    let inventoryPosture = 'unknown';
    let inventoryAction  = 'UNKNOWN';
    if (s.stock == null) {
      inventoryPosture = 'unknown';
      inventoryAction  = 'UNKNOWN';
    } else if (s.stock <= 0) {
      inventoryPosture = 'oos';
      inventoryAction  = forwardVelocity > 0 ? 'RESTOCK' : 'REVIEW';
    } else if (forwardVelocity > 0 && s.stock <= reorderPoint) {
      inventoryPosture = 'critical';
      inventoryAction  = 'REORDER NOW';
    } else if (forwardVelocity > 0 && forwardDoS <= leadTimeDays * 2) {
      inventoryPosture = 'low';
      inventoryAction  = 'REORDER SOON';
    } else if (forwardVelocity > 0 && forwardDoS > OVERSTOCK_DAYS) {
      inventoryPosture = 'overstock';
      inventoryAction  = 'LIQUIDATE';
    } else if (forwardVelocity === 0 && s.stock > 0) {
      inventoryPosture = 'stale';
      inventoryAction  = 'LIQUIDATE';
    } else {
      inventoryPosture = 'healthy';
      inventoryAction  = 'OK';
    }

    const stockConstrained = inventoryPosture === 'oos' || inventoryPosture === 'critical';

    /* ── feed layer: does Google even serve this? ──────────────────
       We can only assert 'absent' when we actually have a merchant feed
       to compare against. If merchantBySku is null (feed not pulled),
       feedPosture stays 'unknown' so the absence doesn't cascade into
       blocking every SKU. */
    const hasFeedData  = !!merchantBySku;
    const feedRec      = hasFeedData ? (merchantBySku.get?.(s.sku) || null) : null;
    const inFeed       = !!feedRec;
    const feedStatus   = !hasFeedData ? 'unknown'
                        : feedRec?.status?.primaryStatus || (inFeed ? 'unknown' : 'absent');
    const feedApproved = feedStatus === 'approved';
    const feedDisapproved = feedStatus === 'disapproved';
    const feedIssues   = feedRec?.status?.itemIssues || [];
    const feedAvail    = feedRec?.availability || null;
    // Feed posture: 'absent' | 'disapproved' | 'pending' | 'approved' | 'unknown'
    const feedPosture  = feedStatus;

    return {
      ...s,
      revenueShare, grossContribution, momentum,
      velocity14, velocity30, dailyUnits, daysOfStock, daysSince,
      forwardVelocity, forwardDoS, reorderPoint, safetyStock, leadTimeDays, safetyDays, reorderByDate,
      inventoryPosture, inventoryAction, stockConstrained,
      gatewayRate, repeatRate, bundleRate,
      hasHistory, thinData: s.ordersWindow < 5 || !hasHistory,
      // feed slice
      inFeed, feedStatus, feedApproved, feedDisapproved, feedIssues, feedAvail, feedPosture,
      feedLink:  feedRec?.link || null,
      feedImage: feedRec?.imageLink || null,
      feedTopIssue: feedIssues[0]?.description || null,
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
    if (s.thinData) { s.action = 'INVESTIGATE'; s.quadrant = 'thin'; }
    else {
      const hiEcon  = s.econRank  >= econMedian;
      const hiStrat = s.stratRank >= stratMedian;
      if (hiEcon && hiStrat)       { s.action = 'DOUBLE DOWN'; s.quadrant = 'star'; }
      else if (hiEcon && !hiStrat) { s.action = 'MILK';        s.quadrant = 'cash'; }
      else if (!hiEcon && hiStrat) {
        s.action = s.bundleRate >= 0.60 ? 'BUNDLE' : 'BET';
        s.quadrant = s.bundleRate >= 0.60 ? 'bundle' : 'question';
      } else                       { s.action = 'EXIT';        s.quadrant = 'dog'; }
    }
    s.composedAction = composeAction(s.action, s.inventoryPosture, s.feedPosture);
    s.budgetCap      = adBudgetCap(s);
    // A SKU is "blocked" when its commercial quadrant can't be executed
    // right now — either stock is unavailable, or the feed won't serve it.
    // Used by the UI to filter stock-OOS winners out of actionable lists.
    const stockBlocked = s.inventoryPosture === 'oos' || s.inventoryPosture === 'critical';
    const feedBlocked  = s.feedPosture === 'disapproved' || s.feedPosture === 'absent';
    s.blocked = stockBlocked || feedBlocked;
    s.blockedReasons = [
      stockBlocked ? (s.inventoryPosture === 'oos' ? 'Out of stock' : 'Below reorder point') : null,
      s.feedPosture === 'disapproved' ? 'Feed disapproved' : null,
      s.feedPosture === 'absent'      ? 'Not in feed'      : null,
    ].filter(Boolean);
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

  /* ── bundle radar: top pairs by lift × support, filtered to sellable SKUs ── */
  const postureBySku = new Map(skus.map(s => [s.sku, s.inventoryPosture]));
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
    const postureA = postureBySku.get(a) || 'unknown';
    const postureB = postureBySku.get(b) || 'unknown';
    const blocked = postureA === 'oos' || postureB === 'oos';
    return {
      a, b,
      nameA: skuMap[a]?.name || a,
      nameB: skuMap[b]?.name || b,
      postureA, postureB, blocked,
      count, support, lift, confidence,
      score: lift * Math.log2(1 + count),
    };
  })
  .filter(pair => pair.count >= 3 && pair.lift > 1.2 && !pair.blocked)
  .sort((a, b) => b.score - a.score)
  .slice(0, 15);

  /* ── inventory roll-ups for the summary ── */
  const playableForInv = skus.filter(s => !s.thinData);
  const invCounts = {
    oos:       playableForInv.filter(s => s.inventoryPosture === 'oos').length,
    critical:  playableForInv.filter(s => s.inventoryPosture === 'critical').length,
    low:       playableForInv.filter(s => s.inventoryPosture === 'low').length,
    healthy:   playableForInv.filter(s => s.inventoryPosture === 'healthy').length,
    overstock: playableForInv.filter(s => s.inventoryPosture === 'overstock').length,
    stale:     playableForInv.filter(s => s.inventoryPosture === 'stale').length,
    unknown:   playableForInv.filter(s => s.inventoryPosture === 'unknown').length,
  };
  const revenueAtRisk = playableForInv
    .filter(s => s.stockConstrained)
    .reduce((sum, s) => sum + s.revenueWindow, 0);

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
    inventory: {
      counts: invCounts,
      revenueAtRisk,
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

/* ─── ACTION COMPOSITION ──────────────────────────────────────────
   Layer the commercial quadrant with the inventory posture. Stock
   constraints *veto* scale actions (you can't scale what you can't
   ship), and they *convert* exit actions (delist-clean vs. liquidate). */
function composeAction(commercial, posture, feedPosture = 'unknown') {
  if (commercial === 'INVESTIGATE') return { label: 'INVESTIGATE', severity: 'info', hint: 'Thin data — revisit.' };

  /* ── feed veto: if Google won't serve it, scale actions are moot ──
     A disapproved SKU can still earn Shopify revenue organically; that's
     why we only *degrade* the action here rather than hiding it. Absent
     from feed = uploadable fix. Disapproved = fixable via feed/page edit. */
  if (feedPosture === 'disapproved') {
    if (commercial === 'DOUBLE DOWN')  return { label: 'FIX FEED · BLOCKED SCALE', severity: 'critical', hint: 'Winner SKU but feed disapproved — ads not serving. Resolve the disapproval; spend is locked out until then.' };
    if (commercial === 'MILK')         return { label: 'FIX FEED · PROTECT CASH',  severity: 'high',     hint: 'Cash cow disapproved in feed. Organic revenue exists; fix the feed to unlock paid support.' };
    if (commercial === 'BET')          return { label: 'FIX FEED BEFORE TEST',     severity: 'medium',   hint: 'Can\'t test ad scale with a disapproved feed listing. Fix first.' };
    if (commercial === 'BUNDLE')       return { label: 'FIX FEED · BUNDLE',        severity: 'medium',   hint: 'Bundle attachment will still work organically; fix feed to pair with paid traffic.' };
    // EXIT stays EXIT — no point fixing a disapproval on a SKU you're delisting.
  }
  if (feedPosture === 'absent' && (commercial === 'DOUBLE DOWN' || commercial === 'MILK' || commercial === 'BET')) {
    // Not in feed at all — upload + approve before any paid scale makes sense.
    if (commercial === 'DOUBLE DOWN')  return { label: 'LIST IN FEED · SCALE', severity: 'high',   hint: 'Winner selling organically but missing from Google Merchant feed — upload, then scale.' };
    if (commercial === 'MILK')         return { label: 'LIST IN FEED',         severity: 'medium', hint: 'Cash cow not in merchant feed. Add it to open up a paid channel.' };
    if (commercial === 'BET')          return { label: 'LIST IN FEED · TEST',  severity: 'medium', hint: 'Not in feed — upload before running a scale test.' };
  }

  switch (commercial) {
    case 'DOUBLE DOWN':
      if (posture === 'oos')       return { label: 'HALT ADS · RESTOCK',  severity: 'critical', hint: 'Scaling was best bet but stock is out. Pause spend, expedite PO.' };
      if (posture === 'critical')  return { label: 'SCALE + PO TODAY',    severity: 'high',     hint: 'Winner — but runway is under reorder point. Cap budget to stock runway and place PO today.' };
      if (posture === 'low')       return { label: 'SCALE · WATCH STOCK', severity: 'medium',   hint: 'Scale, but queue a PO before runway goes critical.' };
      if (posture === 'overstock') return { label: 'SCALE AGGRESSIVE',    severity: 'high',     hint: 'Winner with excess stock — push hard, no supply risk.' };
      return { label: 'SCALE', severity: 'high', hint: 'Scale ad spend. Stock can support it.' };
    case 'MILK':
      if (posture === 'oos')       return { label: 'RESTOCK URGENT',      severity: 'critical', hint: "Harvest plan blocked — can't milk what isn't on the shelf." };
      if (posture === 'critical')  return { label: 'HARVEST · REORDER',   severity: 'high',     hint: 'Cash cow running out. PO now; keep ad budget capped to runway.' };
      if (posture === 'low')       return { label: 'HARVEST · PO SOON',   severity: 'medium',   hint: 'Harvest, PO within reorder lead time.' };
      if (posture === 'overstock') return { label: 'FLASH SALE',          severity: 'medium',   hint: 'Overstocked cash cow — run a promo/flash to pull cash forward.' };
      if (posture === 'stale')     return { label: 'LIQUIDATE',           severity: 'medium',   hint: 'Revenue exists but no forward velocity — clear dead shelf.' };
      return { label: 'HARVEST', severity: 'medium', hint: 'Steady margin. Minimal reinvestment.' };
    case 'BET':
      if (posture === 'oos')       return { label: 'HOLD TEST · RESTOCK', severity: 'high',     hint: "Can't test-scale a SKU that's out. Restock before campaigning." };
      if (posture === 'critical')  return { label: 'SMALL TEST + PO',     severity: 'medium',   hint: 'Run a small scale test and simultaneously place PO.' };
      if (posture === 'overstock') return { label: 'TEST · BUNDLE DUMP',  severity: 'medium',   hint: 'Test scale; if it doesn\'t move, liquidate via bundle.' };
      return { label: 'TEST SCALE', severity: 'medium', hint: 'Strategic pull exists. Test before committing budget.' };
    case 'BUNDLE':
      if (posture === 'oos')       return { label: 'BUNDLE BLOCKED',      severity: 'high',     hint: 'Attachment SKU is OOS — pairs will break. Restock first.' };
      if (posture === 'critical')  return { label: 'BUNDLE · REORDER',    severity: 'medium',   hint: 'Keep bundling but PO now — attach rate will drain stock quickly.' };
      if (posture === 'overstock') return { label: 'BUNDLE LIQUIDATE',    severity: 'medium',   hint: 'Use bundles to clear excess attachment stock.' };
      return { label: 'BUNDLE', severity: 'info', hint: 'Attaches to orders. Bundle rather than advertise alone.' };
    case 'EXIT':
      if (posture === 'oos')       return { label: 'DELIST CLEAN',        severity: 'info',     hint: 'Already out, low value — delist, free the shelf.' };
      if (posture === 'critical')  return { label: 'SELL THROUGH',        severity: 'info',     hint: 'Let current stock drain then delist. No restock.' };
      if (posture === 'overstock') return { label: 'LIQUIDATE',           severity: 'medium',   hint: 'Bundle/discount — convert shelf to cash.' };
      if (posture === 'stale')     return { label: 'LIQUIDATE',           severity: 'medium',   hint: 'Dead stock. Bundle/discount to clear.' };
      return { label: 'SELL THROUGH', severity: 'info', hint: 'Low value — drain stock, then delist.' };
    default:
      return { label: commercial, severity: 'info', hint: '' };
  }
}

/* ─── AD BUDGET CEILING ───────────────────────────────────────────
   For SKUs where the commercial action is SCALE/DOUBLE DOWN, suggest a
   weekly budget ceiling bounded by stock runway so the campaign can't
   outrun inventory. Returns { weeklyCapRs, daysOfRunway } or null. */
function adBudgetCap(s) {
  if (!['DOUBLE DOWN', 'MILK', 'BET'].includes(s.action)) return null;
  if (s.stock == null || s.forwardVelocity <= 0) return null;
  const price = Number(s.price) || (s.revenueWindow / Math.max(1, s.unitsWindow));
  if (!price) return null;
  // Safe target: don't let ads pull more than the runway buys us between now
  // and a realistic PO arrival (leadTimeDays). Unit budget per week:
  const usableUnitsPerWeek = Math.min(s.forwardVelocity, s.stock / Math.max(1, s.leadTimeDays)) * 7;
  if (usableUnitsPerWeek <= 0) return null;
  // Rough CAC assumption: ad spend equal to ~30% of realized revenue is a
  // working ceiling — UI can override with the brand's target MER later.
  const weeklyCapRs = usableUnitsPerWeek * price * 0.30;
  return { weeklyCapRs, daysOfRunway: s.forwardDoS };
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

export const POSTURE_STYLES = {
  oos:       { color: '#ef4444', bg: 'bg-red-500/15',     text: 'text-red-300',      border: 'border-red-500/40',     label: 'OOS',        desc: 'Out of stock. Cannot fulfil.' },
  critical:  { color: '#f97316', bg: 'bg-orange-500/15',  text: 'text-orange-300',   border: 'border-orange-500/40',  label: 'CRITICAL',   desc: 'Below reorder point — runway < lead time + safety.' },
  low:       { color: '#f59e0b', bg: 'bg-amber-500/15',   text: 'text-amber-300',    border: 'border-amber-500/30',   label: 'LOW',        desc: 'Runway < 2× lead time. Queue a PO soon.' },
  healthy:   { color: '#22c55e', bg: 'bg-emerald-500/10', text: 'text-emerald-300',  border: 'border-emerald-500/20', label: 'HEALTHY',    desc: 'Comfortable runway above reorder point.' },
  overstock: { color: '#0ea5e9', bg: 'bg-sky-500/15',     text: 'text-sky-300',      border: 'border-sky-500/30',     label: 'OVERSTOCK',  desc: 'Runway > 180 days. Liquidate via bundles/flash.' },
  stale:     { color: '#a855f7', bg: 'bg-purple-500/15',  text: 'text-purple-300',   border: 'border-purple-500/30',  label: 'STALE',      desc: 'Stock sitting, no forward velocity. Dead shelf.' },
  unknown:   { color: '#64748b', bg: 'bg-gray-500/10',    text: 'text-slate-400',    border: 'border-gray-500/20',    label: 'NO DATA',    desc: 'Inventory map has no record for this SKU.' },
};

export const SEVERITY_STYLES = {
  critical: { bg: 'bg-red-500/20',     text: 'text-red-200',     border: 'border-red-500/40' },
  high:     { bg: 'bg-orange-500/15',  text: 'text-orange-200',  border: 'border-orange-500/30' },
  medium:   { bg: 'bg-amber-500/15',   text: 'text-amber-200',   border: 'border-amber-500/30' },
  info:     { bg: 'bg-slate-500/10',   text: 'text-slate-300',   border: 'border-slate-500/20' },
};
