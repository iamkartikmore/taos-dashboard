/**
 * Google Ads recommendation engine.
 *
 * Each recommendation is a concrete, reviewable action an operator can
 * take inside the Ads UI — not vague advice. We score them so the
 * UI can sort by impact (estimated savings or upside in ₹).
 *
 * Categories we produce:
 *   1. `negative_keyword` — search terms that burned spend with no conversion
 *   2. `pause_keyword`    — paid keywords with high cost, zero conv, poor QS
 *   3. `pause_ad`         — ads underperforming their ad-group average
 *   4. `budget_shift`     — reallocate from low-ROAS to high-ROAS campaigns
 *   5. `bid_up`           — high-converting segments (device/hour/geo)
 *                           that look under-spent
 *   6. `bid_down`         — the inverse
 *   7. `expand_keyword`   — search terms with strong conversion that
 *                           aren't yet explicit keywords
 *   8. `quality_score`    — low-QS keywords that still cost material money
 *
 * Thresholds are conservative by default so we don't drown the operator
 * in noise. Every rec carries: id, type, severity, impactRs,
 * explanation, evidence (the rows that triggered it), action (a short
 * imperative the operator can paste into Ads).
 *
 * All pure — no IO, no network. The UI is responsible for persisting
 * approve/reject state.
 */

const DEFAULTS = {
  // Negative keyword rules
  stWasteMinCost: 200,       // ₹200 with zero conversions
  stWasteMinClicks: 10,
  // Pause-keyword rules
  kwPauseMinCost: 500,
  kwPauseMinClicks: 30,
  kwPauseMaxQs: 4,            // QS 1-4 = low
  // Ad-pause rules
  adRelativeFactor: 0.5,      // ad ROAS < 50% of ad-group ROAS
  adMinCost: 300,
  // Budget-shift rules
  budgetTopRoasPct: 0.25,     // top quartile ROAS
  budgetBottomRoasPct: 0.25,
  budgetMinShiftRs: 500,
  // Bid adjustments
  hourMinSharePct: 0.05,      // hour must hold >5% of spend to matter
  // Expand-keyword rules
  stExpandMinConv: 2,
};

/* ─── HELPERS ─────────────────────────────────────────────────────── */

function wasteSavings(row) {
  // Pure-waste estimate: if we cut spend here, we'd save `cost` with ~0 conv lost.
  return Math.round(row.cost || 0);
}

function shiftUpside(slice, targetRoas) {
  // If we reallocate `cost` to a slice delivering `targetRoas`, extra revenue:
  // (targetRoas - currentRoas) * cost. Assume proportional scale-up.
  const current = slice.roas || 0;
  return Math.max(0, Math.round((targetRoas - current) * (slice.cost || 0)));
}

/* ─── RULE: NEGATIVE KEYWORDS FROM WASTEFUL SEARCH TERMS ─────────── */

export function recsNegativeKeywords(searchTerms, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const recs = [];
  for (const s of searchTerms || []) {
    if (!s.searchTerm) continue;
    if ((s.cost || 0) < o.stWasteMinCost) continue;
    if ((s.clicks || 0) < o.stWasteMinClicks) continue;
    if ((s.conversions || 0) > 0.5) continue; // tolerate a lucky near-conv
    recs.push({
      id: `neg|${s.adGroupId}|${s.searchTerm}`,
      type: 'negative_keyword',
      severity: (s.cost >= o.stWasteMinCost * 2) ? 'high' : 'medium',
      title: `Add negative keyword: "${s.searchTerm}"`,
      action: `Add "${s.searchTerm}" as a negative keyword at the ad-group or campaign level.`,
      explanation: `₹${Math.round(s.cost).toLocaleString()} spent on ${s.clicks} clicks with zero conversions. Safe to block.`,
      impactRs: wasteSavings(s),
      evidence: { searchTerm: s.searchTerm, cost: s.cost, clicks: s.clicks, conversions: s.conversions, adGroupId: s.adGroupId, campaignId: s.campaignId },
    });
  }
  recs.sort((a, b) => b.impactRs - a.impactRs);
  return recs;
}

/* ─── RULE: PAUSE POOR KEYWORDS ────────────────────────────────────── */

export function recsPauseKeywords(keywords, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const recs = [];
  for (const k of keywords || []) {
    if ((k.cost || 0) < o.kwPauseMinCost) continue;
    if ((k.clicks || 0) < o.kwPauseMinClicks) continue;
    if ((k.conversions || 0) > 0.5) continue;
    const lowQs = k.qualityScore && k.qualityScore <= o.kwPauseMaxQs;
    recs.push({
      id: `pauseKw|${k.adGroupId}|${k.keyword}|${k.matchType}`,
      type: 'pause_keyword',
      severity: lowQs ? 'high' : 'medium',
      title: `Pause keyword: "${k.keyword}" [${k.matchType}]`,
      action: `Pause keyword "${k.keyword}" (${k.matchType}) in ad group ${k.adGroupName}.`,
      explanation: lowQs
        ? `₹${Math.round(k.cost).toLocaleString()} spent, 0 conv, QS ${k.qualityScore}/10 — low relevance and no return.`
        : `₹${Math.round(k.cost).toLocaleString()} spent across ${k.clicks} clicks, 0 conversions.`,
      impactRs: wasteSavings(k),
      evidence: { keyword: k.keyword, matchType: k.matchType, cost: k.cost, clicks: k.clicks, qualityScore: k.qualityScore, adGroupId: k.adGroupId, campaignId: k.campaignId },
    });
  }
  recs.sort((a, b) => b.impactRs - a.impactRs);
  return recs;
}

/* ─── RULE: PAUSE UNDERPERFORMING ADS ──────────────────────────────── */

export function recsPauseAds(ads, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const byGroup = new Map();
  for (const a of ads || []) {
    const g = byGroup.get(a.adGroupId) || { cost: 0, conv: 0, rev: 0, ads: [] };
    g.cost += a.cost || 0; g.conv += a.conversions || 0; g.rev += a.conversionValue || 0;
    g.ads.push(a);
    byGroup.set(a.adGroupId, g);
  }
  const recs = [];
  for (const g of byGroup.values()) {
    if (g.ads.length < 2) continue;
    const groupRoas = g.cost > 0 ? g.rev / g.cost : 0;
    for (const a of g.ads) {
      if ((a.cost || 0) < o.adMinCost) continue;
      const aRoas = a.cost > 0 ? a.conversionValue / a.cost : 0;
      if (groupRoas === 0) continue;
      if (aRoas >= groupRoas * o.adRelativeFactor) continue;
      recs.push({
        id: `pauseAd|${a.id}`,
        type: 'pause_ad',
        severity: aRoas === 0 ? 'high' : 'medium',
        title: `Pause ad: ${a.name || `(${a.type})`} in ${a.adGroupName}`,
        action: `Pause the ad (${a.type}) "${a.name || a.id}" — its ROAS is ${aRoas.toFixed(2)} vs ad-group average ${groupRoas.toFixed(2)}.`,
        explanation: `₹${Math.round(a.cost).toLocaleString()} spent at ROAS ${aRoas.toFixed(2)} (group ${groupRoas.toFixed(2)}). Redirect impressions to stronger siblings.`,
        impactRs: Math.round(a.cost * (1 - aRoas / Math.max(groupRoas, 0.01))),
        evidence: { adId: a.id, adName: a.name, type: a.type, cost: a.cost, roas: aRoas, groupRoas, adGroupId: a.adGroupId, campaignId: a.campaignId },
      });
    }
  }
  recs.sort((a, b) => b.impactRs - a.impactRs);
  return recs;
}

/* ─── RULE: BUDGET SHIFTS BETWEEN CAMPAIGNS ────────────────────────── */

export function recsBudgetShifts(campaigns, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const live = (campaigns || []).filter(c => c.status === 'ENABLED' && c.cost > 0 && c.conversions > 0);
  if (live.length < 4) return [];
  const sortedRoas = [...live].sort((a, b) => b.roas - a.roas);
  const topN    = Math.max(1, Math.round(live.length * o.budgetTopRoasPct));
  const bottomN = Math.max(1, Math.round(live.length * o.budgetBottomRoasPct));
  const top     = sortedRoas.slice(0, topN);
  const bottom  = sortedRoas.slice(-bottomN);

  const topAvgRoas = top.reduce((a, b) => a + b.roas, 0) / top.length;
  const recs = [];
  for (const b of bottom) {
    if (b.cost < o.budgetMinShiftRs) continue;
    if (b.roas >= topAvgRoas * 0.5) continue; // not bad enough to move
    const upside = shiftUpside(b, topAvgRoas);
    recs.push({
      id: `shift|${b.id}`,
      type: 'budget_shift',
      severity: b.roas < topAvgRoas * 0.25 ? 'high' : 'medium',
      title: `Shift budget away from "${b.name}"`,
      action: `Cut budget on "${b.name}" (ROAS ${b.roas.toFixed(2)}) and redistribute to top campaigns (avg ROAS ${topAvgRoas.toFixed(2)}) — ${top.slice(0, 3).map(c => `"${c.name}"`).join(', ')}.`,
      explanation: `"${b.name}" burned ₹${Math.round(b.cost).toLocaleString()} at ROAS ${b.roas.toFixed(2)} — top quartile averaged ${topAvgRoas.toFixed(2)}.`,
      impactRs: upside,
      evidence: { campaignId: b.id, name: b.name, cost: b.cost, roas: b.roas, topAvgRoas, topCampaigns: top.slice(0, 3).map(c => ({ id: c.id, name: c.name, roas: c.roas })) },
    });
  }
  recs.sort((a, b) => b.impactRs - a.impactRs);
  return recs;
}

/* ─── RULE: HOUR-OF-DAY BID ADJUSTMENTS ────────────────────────────── */

export function recsHourBids(hoursByHour, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!hoursByHour?.length) return [];
  const totalCost = hoursByHour.reduce((a, b) => a + (b.cost || 0), 0);
  if (totalCost === 0) return [];
  const meanRoas = (hoursByHour.reduce((a, b) => a + (b.conversionValue || 0), 0)) / totalCost;
  const recs = [];
  for (const h of hoursByHour) {
    if (!h.cost || h.cost / totalCost < o.hourMinSharePct) continue;
    const hr = String(h.hour).padStart(2, '0') + ':00';
    if (h.conversions === 0 && h.cost >= 300) {
      recs.push({
        id: `bidDown|hour|${h.hour}`,
        type: 'bid_down',
        severity: 'medium',
        title: `Bid down at ${hr}`,
        action: `Apply a -30% to -50% bid adjustment for hour ${hr} — ₹${Math.round(h.cost).toLocaleString()} spent with 0 conversions over the window.`,
        explanation: `This hour accounts for ${((h.cost / totalCost) * 100).toFixed(1)}% of spend but produces no conversions.`,
        impactRs: Math.round(h.cost * 0.4),
        evidence: { hour: h.hour, cost: h.cost, conversions: h.conversions, sharePct: h.cost / totalCost },
      });
      continue;
    }
    if (h.roas > meanRoas * 1.4 && h.conversions >= 3) {
      recs.push({
        id: `bidUp|hour|${h.hour}`,
        type: 'bid_up',
        severity: 'low',
        title: `Bid up at ${hr}`,
        action: `Apply a +10% to +20% bid adjustment for hour ${hr} — ROAS ${h.roas.toFixed(2)} vs day-part avg ${meanRoas.toFixed(2)}.`,
        explanation: `${h.conversions.toFixed(0)} conversions at ROAS ${h.roas.toFixed(2)} — worth leaning in.`,
        impactRs: Math.round(h.cost * 0.15 * (h.roas - meanRoas)),
        evidence: { hour: h.hour, cost: h.cost, conversions: h.conversions, roas: h.roas, meanRoas },
      });
    }
  }
  recs.sort((a, b) => b.impactRs - a.impactRs);
  return recs;
}

/* ─── RULE: DEVICE BID ADJUSTMENTS ─────────────────────────────────── */

export function recsDeviceBids(devices) {
  if (!devices?.length) return [];
  const totalCost = devices.reduce((a, b) => a + (b.cost || 0), 0);
  if (totalCost === 0) return [];
  const meanRoas = devices.reduce((a, b) => a + (b.conversionValue || 0), 0) / totalCost;
  const recs = [];
  for (const d of devices) {
    if (!d.cost) continue;
    if (d.conversions === 0 && d.cost / totalCost > 0.1) {
      recs.push({
        id: `bidDown|device|${d.device}`,
        type: 'bid_down',
        severity: 'high',
        title: `Bid down on ${d.device}`,
        action: `Apply -50% to -80% bid adjustment on ${d.device} — ₹${Math.round(d.cost).toLocaleString()} spent, 0 conversions.`,
        explanation: `${d.device} is ${((d.cost / totalCost) * 100).toFixed(1)}% of spend and produces no conversions.`,
        impactRs: Math.round(d.cost * 0.7),
        evidence: { device: d.device, cost: d.cost, clicks: d.clicks, conversions: d.conversions },
      });
    } else if (d.roas > meanRoas * 1.3 && d.conversions >= 5) {
      recs.push({
        id: `bidUp|device|${d.device}`,
        type: 'bid_up',
        severity: 'low',
        title: `Bid up on ${d.device}`,
        action: `Apply +10% to +20% bid adjustment on ${d.device} — ROAS ${d.roas.toFixed(2)} vs account avg ${meanRoas.toFixed(2)}.`,
        explanation: `${d.device} converts at ${d.roas.toFixed(2)} ROAS — above the account average.`,
        impactRs: Math.round(d.cost * 0.15 * (d.roas - meanRoas)),
        evidence: { device: d.device, cost: d.cost, conversions: d.conversions, roas: d.roas, meanRoas },
      });
    }
  }
  return recs.sort((a, b) => b.impactRs - a.impactRs);
}

/* ─── RULE: EXPAND HIGH-CONVERTING SEARCH TERMS AS KEYWORDS ───────── */

export function recsExpandKeywords(searchTerms, keywords, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const kwSet = new Set((keywords || []).map(k => (k.keyword || '').toLowerCase()));
  const recs = [];
  for (const s of searchTerms || []) {
    if (!s.searchTerm) continue;
    if (kwSet.has(s.searchTerm.toLowerCase())) continue; // already a keyword
    if ((s.conversions || 0) < o.stExpandMinConv) continue;
    if ((s.roas || 0) <= 1) continue;
    recs.push({
      id: `expandKw|${s.adGroupId}|${s.searchTerm}`,
      type: 'expand_keyword',
      severity: 'medium',
      title: `Add "${s.searchTerm}" as a keyword`,
      action: `Add "${s.searchTerm}" (phrase or exact match) to ad group ${s.adGroupId} — it converts at ROAS ${s.roas.toFixed(2)}.`,
      explanation: `${s.conversions.toFixed(0)} conversions at ROAS ${s.roas.toFixed(2)} from ₹${Math.round(s.cost).toLocaleString()} of spend — currently matched only via broad / dynamic.`,
      impactRs: Math.round((s.conversionValue || 0) * 0.2), // upside from cleaner targeting
      evidence: { searchTerm: s.searchTerm, cost: s.cost, conversions: s.conversions, roas: s.roas, adGroupId: s.adGroupId, campaignId: s.campaignId },
    });
  }
  return recs.sort((a, b) => b.impactRs - a.impactRs);
}

/* ─── RULE: LOW QUALITY-SCORE KEYWORDS ─────────────────────────────── */

export function recsQualityScore(keywords) {
  const recs = [];
  for (const k of keywords || []) {
    if (!k.qualityScore || k.qualityScore > 4) continue;
    if ((k.cost || 0) < 200) continue;
    recs.push({
      id: `qs|${k.adGroupId}|${k.keyword}|${k.matchType}`,
      type: 'quality_score',
      severity: k.qualityScore <= 2 ? 'high' : 'medium',
      title: `Low QS on "${k.keyword}" (${k.qualityScore}/10)`,
      action: `Review landing page relevance, ad copy, and expected CTR for "${k.keyword}" in ${k.adGroupName}. Low QS means you're paying a Google "tax" on every click.`,
      explanation: `QS ${k.qualityScore}/10 with ₹${Math.round(k.cost).toLocaleString()} spent — rewrite the ad/landing page or tighten match type.`,
      impactRs: Math.round(k.cost * 0.2), // rule-of-thumb: +1 QS ≈ -10% CPC
      evidence: { keyword: k.keyword, matchType: k.matchType, qualityScore: k.qualityScore, cost: k.cost, conversions: k.conversions, adGroupId: k.adGroupId, campaignId: k.campaignId },
    });
  }
  return recs.sort((a, b) => b.impactRs - a.impactRs);
}

/* ─── ORCHESTRATOR ─────────────────────────────────────────────────── */
/**
 * One-call entry point. Returns a flat list of all recommendations,
 * each with a stable id. Pass the same `data` shape that `normalizeGoogleAdsResponse`
 * produces.
 */
export function generateRecommendations(data, opts = {}) {
  if (!data) return { all: [], byType: {} };
  const all = [
    ...recsNegativeKeywords(data.searchTerms, opts),
    ...recsPauseKeywords(data.keywords, opts),
    ...recsPauseAds(data.ads, opts),
    ...recsBudgetShifts(data.campaigns, opts),
    ...recsHourBids(data.hours?.byHour, opts),
    ...recsDeviceBids(data.devices, opts),
    ...recsExpandKeywords(data.searchTerms, data.keywords, opts),
    ...recsQualityScore(data.keywords),
  ];
  all.sort((a, b) => b.impactRs - a.impactRs);
  const byType = {};
  for (const r of all) (byType[r.type] ||= []).push(r);
  const savings = all.filter(r => ['negative_keyword', 'pause_keyword', 'pause_ad', 'bid_down'].includes(r.type))
                     .reduce((a, b) => a + (b.impactRs || 0), 0);
  const upside  = all.filter(r => ['budget_shift', 'bid_up', 'expand_keyword', 'quality_score'].includes(r.type))
                     .reduce((a, b) => a + (b.impactRs || 0), 0);
  return { all, byType, summary: { count: all.length, savings, upside } };
}
