/**
 * Attribute orders to send-log records and compute uplift vs holdout.
 *
 * Rules:
 *   - A send (or holdout) record matches an order if:
 *       brand_id and email match,
 *       AND order.created_at is within `attributionWindowDays` after sent_at.
 *   - If multiple sends within the window match the same order, we attribute
 *     to the most recent send (last-touch).
 *   - Uplift is computed per campaign: sent_conversion_rate vs holdout_conversion_rate.
 *     Revenue uplift = (sent_rev_per_recipient - holdout_rev_per_recipient) * sent_count.
 */

const DAY = 86_400_000;

export function attributeOrders(sends, orders, { windowDays = 7 } = {}) {
  // Index orders by (brand_id, email) for O(1) lookup
  const byKey = new Map();
  for (const o of orders) {
    if (o?.cancelled_at) continue;
    const e = (o.email || o.customer?.email || '').toLowerCase().trim();
    if (!e) continue;
    const brandId = o._brandId || o.brand_id || 'default';
    const key = `${brandId}|${e}`;
    if (!byKey.has(key)) byKey.set(key, []);
    const t = Date.parse(o.created_at);
    if (isFinite(t)) byKey.get(key).push({ t, order: o });
  }
  for (const list of byKey.values()) list.sort((a, b) => a.t - b.t);

  // For each send, find first order in window. Mark send as converted.
  const enriched = sends.map(s => ({ ...s }));
  // Group sends per key, sort by sent_at so the most recent in-window wins
  const sendsByKey = new Map();
  for (const s of enriched) {
    const key = `${s.brand_id}|${s.email}`;
    if (!sendsByKey.has(key)) sendsByKey.set(key, []);
    sendsByKey.get(key).push(s);
  }

  for (const [key, list] of sendsByKey) {
    list.sort((a, b) => a.sent_at - b.sent_at);
    const orderList = byKey.get(key) || [];
    for (const s of list) {
      const windowEnd = s.sent_at + windowDays * DAY;
      for (const { t, order } of orderList) {
        if (t < s.sent_at) continue;
        if (t > windowEnd) break;
        // Take the first order after sent_at within the window
        s.converted      = true;
        s.converted_at   = t;
        s.attributed_rev = parseFloat(order.total_price || 0) || 0;
        s.attributed_order_id = order.id;
        break;
      }
      if (s.converted == null) {
        s.converted      = false;
        s.converted_at   = null;
        s.attributed_rev = 0;
      }
    }
  }

  return enriched;
}

/* ─── ROLL UP BY CAMPAIGN ──────────────────────────────────────── */
export function summarizeCampaigns(attributedSends) {
  const byCampaign = {};
  for (const s of attributedSends) {
    const c = s.campaign_id || 'uncategorized';
    if (!byCampaign[c]) {
      byCampaign[c] = {
        campaign_id:        c,
        sent_at:            s.sent_at,
        brands:             new Set(),
        sent:               { recipients: 0, converted: 0, revenue: 0 },
        holdout:            { recipients: 0, converted: 0, revenue: 0 },
        by_opportunity:     {},
      };
    }
    const bucket = s.was_holdout ? byCampaign[c].holdout : byCampaign[c].sent;
    bucket.recipients++;
    if (s.converted) { bucket.converted++; bucket.revenue += s.attributed_rev || 0; }
    byCampaign[c].brands.add(s.brand_id);

    const opp = s.opportunity || 'unknown';
    if (!byCampaign[c].by_opportunity[opp]) byCampaign[c].by_opportunity[opp] = { sent: 0, holdout: 0, sent_converted: 0, holdout_converted: 0, sent_revenue: 0, holdout_revenue: 0 };
    const ob = byCampaign[c].by_opportunity[opp];
    if (s.was_holdout) {
      ob.holdout++;
      if (s.converted) { ob.holdout_converted++; ob.holdout_revenue += s.attributed_rev || 0; }
    } else {
      ob.sent++;
      if (s.converted) { ob.sent_converted++; ob.sent_revenue += s.attributed_rev || 0; }
    }
  }

  // Compute conversion rates + incremental lift per campaign
  const out = [];
  for (const c of Object.values(byCampaign)) {
    const sent_cr     = c.sent.recipients     ? c.sent.converted    / c.sent.recipients     : 0;
    const holdout_cr  = c.holdout.recipients  ? c.holdout.converted / c.holdout.recipients  : 0;
    const rev_per_sent    = c.sent.recipients    ? c.sent.revenue    / c.sent.recipients    : 0;
    const rev_per_holdout = c.holdout.recipients ? c.holdout.revenue / c.holdout.recipients : 0;
    const lift_cr     = sent_cr - holdout_cr;
    const incremental_rev = (rev_per_sent - rev_per_holdout) * c.sent.recipients;
    out.push({
      ...c,
      brands: Array.from(c.brands),
      sent_conversion_rate:    +sent_cr.toFixed(4),
      holdout_conversion_rate: +holdout_cr.toFixed(4),
      lift_rate:               +lift_cr.toFixed(4),
      revenue_per_sent:        +rev_per_sent.toFixed(2),
      revenue_per_holdout:     +rev_per_holdout.toFixed(2),
      incremental_revenue:     +incremental_rev.toFixed(2),
    });
  }
  out.sort((a, b) => b.sent_at - a.sent_at);
  return out;
}

export function summarizeByOpportunity(attributedSends) {
  const map = {};
  for (const s of attributedSends) {
    const opp = s.opportunity || 'unknown';
    if (!map[opp]) map[opp] = { opp, sent: 0, holdout: 0, sent_converted: 0, holdout_converted: 0, sent_revenue: 0, holdout_revenue: 0 };
    const m = map[opp];
    if (s.was_holdout) {
      m.holdout++;
      if (s.converted) { m.holdout_converted++; m.holdout_revenue += s.attributed_rev || 0; }
    } else {
      m.sent++;
      if (s.converted) { m.sent_converted++; m.sent_revenue += s.attributed_rev || 0; }
    }
  }
  return Object.values(map).map(m => ({
    ...m,
    sent_cr:     m.sent    ? +(m.sent_converted    / m.sent).toFixed(4)    : 0,
    holdout_cr:  m.holdout ? +(m.holdout_converted / m.holdout).toFixed(4) : 0,
    lift:        m.sent && m.holdout
                 ? +(m.sent_converted / m.sent - m.holdout_converted / m.holdout).toFixed(4)
                 : null,
    rev_per_sent:    m.sent    ? +(m.sent_revenue    / m.sent).toFixed(2)    : 0,
    rev_per_holdout: m.holdout ? +(m.holdout_revenue / m.holdout).toFixed(2) : 0,
  }));
}
