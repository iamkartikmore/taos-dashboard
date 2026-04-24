/**
 * Email attribution — join Listmonk campaign sends / opens / clicks to
 * Shopify orders so we know WHICH EMAIL drove WHICH REVENUE.
 *
 * Top D2C email programs chase "revenue per email sent" not open rate.
 * This library computes that number per campaign, per flow, and
 * rolled up to the email program as a whole.
 *
 * Attribution model (configurable):
 *   - A click inside window (default 7 days) → fully attribute order
 *   - An open inside a narrower window (default 2 days) + no click →
 *     give partial credit (0.3 weight by default)
 *   - Fall back to UTM params on the order (utm_source=listmonk)
 *   - De-duplicate when multiple campaigns match — most recent wins
 *
 * All calculations are deterministic + run client-side from data
 * already pulled by the dashboard.
 */

const DAY_MS = 86_400_000;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ══════════════════════════════════════════════════════════════
   ATTRIBUTION WINDOWS + WEIGHTS — tunable per program
   ══════════════════════════════════════════════════════════ */

export const ATTRIBUTION_CONFIG = {
  clickWindowDays: 7,
  openWindowDays:  2,
  clickWeight: 1.0,
  openWeight:  0.3,
  // When an order matches multiple events, use the highest-weight
  // event; ties broken by recency.
};

/* ══════════════════════════════════════════════════════════════
   MATCH ORDERS TO EMAILS
   Given:
     - orders: normalized Shopify orders (with email + created_at)
     - events: { email, campaignId, type ('send'|'open'|'click'), ts }
     - campaigns: [{ id, name, sent, date, subject, flowId? }]
   Returns per-campaign attribution with revenue + order count.
   ══════════════════════════════════════════════════════════ */

export function attributeOrdersToCampaigns({ orders = [], events = [], campaigns = [], config = ATTRIBUTION_CONFIG }) {
  // Index events by email for O(1) lookup
  const byEmail = new Map();
  for (const ev of events) {
    const em = String(ev.email || '').toLowerCase();
    if (!em) continue;
    if (!byEmail.has(em)) byEmail.set(em, []);
    byEmail.get(em).push({ ...ev, ts: new Date(ev.ts).getTime() });
  }
  for (const list of byEmail.values()) list.sort((a, b) => b.ts - a.ts);

  // Per-campaign accumulator
  const campaignMap = new Map();
  for (const c of campaigns) {
    campaignMap.set(String(c.id), {
      ...c,
      attributedOrders: 0,
      attributedRevenue: 0,
      clickAttributedOrders: 0,
      openAttributedOrders: 0,
      utmAttributedOrders: 0,
      uniqueBuyers: new Set(),
    });
  }

  // UTM helper — if order carries utm_campaign matching a campaign id/name
  const utmMatchers = campaigns.map(c => ({
    id: String(c.id),
    idRegex: new RegExp(`listmonk[_-]?${String(c.id)}\\b`, 'i'),
    nameRegex: c.name ? new RegExp(c.name.replace(/\s+/g, '[-_]?'), 'i') : null,
  }));

  const clickWin = config.clickWindowDays * DAY_MS;
  const openWin  = config.openWindowDays  * DAY_MS;

  for (const o of orders) {
    const email = String(o.email || o.customer?.email || '').toLowerCase();
    if (!email) continue;
    const orderTs = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (!orderTs) continue;
    const revenue = num(o.total_price || o.current_total_price || 0);

    let matched = null; // { type, weight, campaignId, event }

    // 1. Try click match (highest weight)
    const emailEvents = byEmail.get(email) || [];
    for (const ev of emailEvents) {
      if (ev.type !== 'click') continue;
      const delta = orderTs - ev.ts;
      if (delta < 0 || delta > clickWin) continue;
      matched = { type: 'click', weight: config.clickWeight, campaignId: String(ev.campaignId), event: ev };
      break; // emailEvents already sorted desc by ts
    }

    // 2. Try open match if no click
    if (!matched) {
      for (const ev of emailEvents) {
        if (ev.type !== 'open') continue;
        const delta = orderTs - ev.ts;
        if (delta < 0 || delta > openWin) continue;
        matched = { type: 'open', weight: config.openWeight, campaignId: String(ev.campaignId), event: ev };
        break;
      }
    }

    // 3. UTM fallback
    if (!matched) {
      const landing = String(
        o.landing_site || o.landing_site_ref || o.referring_site || '',
      );
      if (/listmonk|utm_source=email/i.test(landing)) {
        // Try to find campaign id/name in the URL
        for (const m of utmMatchers) {
          if (m.idRegex.test(landing) || (m.nameRegex && m.nameRegex.test(landing))) {
            matched = { type: 'utm', weight: 0.5, campaignId: m.id, event: null };
            break;
          }
        }
      }
    }

    if (!matched) continue;
    const bucket = campaignMap.get(matched.campaignId);
    if (!bucket) continue;
    bucket.attributedOrders += 1;
    bucket.attributedRevenue += revenue * matched.weight;
    bucket.uniqueBuyers.add(email);
    if (matched.type === 'click')      bucket.clickAttributedOrders++;
    else if (matched.type === 'open')  bucket.openAttributedOrders++;
    else if (matched.type === 'utm')   bucket.utmAttributedOrders++;
  }

  const out = [];
  for (const c of campaignMap.values()) {
    out.push({
      id: c.id,
      name: c.name,
      date: c.date,
      sent: c.sent,
      attributedOrders:      c.attributedOrders,
      attributedRevenue:     c.attributedRevenue,
      uniqueBuyers:          c.uniqueBuyers.size,
      revenuePerEmail:       c.sent > 0 ? c.attributedRevenue / c.sent : 0,
      conversionRate:        c.sent > 0 ? c.attributedOrders / c.sent : 0,
      clickAttributedOrders: c.clickAttributedOrders,
      openAttributedOrders:  c.openAttributedOrders,
      utmAttributedOrders:   c.utmAttributedOrders,
      flowId: c.flowId || null,
    });
  }
  return out.sort((a, b) => b.attributedRevenue - a.attributedRevenue);
}

/* ══════════════════════════════════════════════════════════════
   PROGRAM-LEVEL KPIs
   ══════════════════════════════════════════════════════════ */

export function programKpis(attributedCampaigns = [], allOrders = [], { windowDays = 30 } = {}) {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const recentOrders = allOrders.filter(o => o.created_at && new Date(o.created_at).getTime() >= cutoff);
  const totalRevenue = recentOrders.reduce((s, o) => s + num(o.total_price || o.current_total_price || 0), 0);

  const recentCampaigns = attributedCampaigns.filter(c => c.date && new Date(c.date).getTime() >= cutoff);
  const emailRevenue = recentCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const emailSent    = recentCampaigns.reduce((s, c) => s + (c.sent || 0), 0);
  const emailOrders  = recentCampaigns.reduce((s, c) => s + c.attributedOrders, 0);

  const flowCampaigns = recentCampaigns.filter(c => c.flowId);
  const broadcastCampaigns = recentCampaigns.filter(c => !c.flowId);
  const flowRevenue = flowCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const broadcastRevenue = broadcastCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);

  return {
    windowDays,
    totalRevenue,
    emailRevenue,
    emailSent,
    emailOrders,
    pctRevenueFromEmail: totalRevenue > 0 ? emailRevenue / totalRevenue : 0,
    revenuePerEmail:     emailSent > 0 ? emailRevenue / emailSent : 0,
    emailOrderRate:      emailSent > 0 ? emailOrders  / emailSent : 0,
    flowRevenue,
    broadcastRevenue,
    pctFromFlows:        emailRevenue > 0 ? flowRevenue / emailRevenue : 0,
    campaignsCount:      recentCampaigns.length,
    broadcastsCount:     broadcastCampaigns.length,
    flowsCount:          flowCampaigns.length,
  };
}

/* ══════════════════════════════════════════════════════════════
   FLOW PERFORMANCE — group attributed campaigns by flowId
   ══════════════════════════════════════════════════════════ */

export function flowPerformance(attributedCampaigns = []) {
  const byFlow = {};
  for (const c of attributedCampaigns) {
    if (!c.flowId) continue;
    if (!byFlow[c.flowId]) byFlow[c.flowId] = {
      flowId: c.flowId,
      sent: 0, orders: 0, revenue: 0, campaignCount: 0,
    };
    byFlow[c.flowId].sent += c.sent || 0;
    byFlow[c.flowId].orders += c.attributedOrders;
    byFlow[c.flowId].revenue += c.attributedRevenue;
    byFlow[c.flowId].campaignCount++;
  }
  return Object.values(byFlow).map(f => ({
    ...f,
    revenuePerEmail: f.sent > 0 ? f.revenue / f.sent : 0,
    conversionRate:  f.sent > 0 ? f.orders / f.sent  : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}

/* ══════════════════════════════════════════════════════════════
   SEND-TIME ANALYSIS — bucket opens + clicks by hour-of-day
   so the UI can show optimal send windows per brand.
   ══════════════════════════════════════════════════════════ */

export function sendTimeAnalysis(events = []) {
  const byHour = new Array(24).fill(0).map(() => ({ open: 0, click: 0 }));
  const byDow  = new Array(7).fill(0).map(() => ({ open: 0, click: 0 }));
  for (const ev of events) {
    const d = new Date(ev.ts);
    if (isNaN(d)) continue;
    const h = d.getHours();
    const dow = d.getDay();
    if (ev.type === 'open')  { byHour[h].open++;  byDow[dow].open++; }
    if (ev.type === 'click') { byHour[h].click++; byDow[dow].click++; }
  }
  return { byHour, byDow };
}
