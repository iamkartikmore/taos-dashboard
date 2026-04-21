/**
 * Collection Spend — data source rules:
 *
 * ✓ 7D / 14D / 30D  : brandData[b.id].insights* directly (no rawAccounts —
 *                     rawAccounts multiplies by account-count per brand → wrong)
 * ✓ Yesterday / 3D  : lazy-fetched from Meta on demand (not in standard pull)
 * ✓ ROAS            : metaRoas from insight row (Meta's own purchase_roas).
 *                     Collection / campaign / adset: computed from summed revenue / spend.
 * ✓ Budget          : only shown when campaignMap / adsetMap are populated.
 *                     If not: shows a "not loaded" chip instead of 0.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, TrendingUp, Loader2, RefreshCw,
  AlertTriangle, Zap, Target, BarChart3, Flame, Info,
} from 'lucide-react';
import { useStore } from '../store';
import { fetchInsights } from '../lib/api';
import { normalizeInsight } from '../lib/analytics';

/* ─── PERIODS ─────────────────────────────────────────────────────── */
const PERIODS = [
  { id: 'yesterday', label: 'Yesterday', days: 1,  preset: 'yesterday', lazy: true },
  { id: '3d',        label: 'Last 3D',   days: 3,  preset: 'last_3d',   lazy: true },
  { id: '7d',        label: 'Last 7D',   days: 7  },
  { id: '14d',       label: 'Last 14D',  days: 14 },
];

/* ─── FORMATTERS ──────────────────────────────────────────────────── */
function fmt(v) {
  const n = parseFloat(v) || 0;
  if (!n) return '—';
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}
function fmtN(v) {
  const n = parseFloat(v) || 0;
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
// ROAS from Meta's purchase_roas — never divide by zero or invent numbers
function fmtRoas(metaRoas) {
  const n = parseFloat(metaRoas) || 0;
  return n > 0 ? n.toFixed(2) + 'x' : '—';
}
// Aggregated ROAS (unavoidable at collection level)
function fmtAggRoas(revenue, spend) {
  if (!spend || !revenue) return '—';
  return (revenue / spend).toFixed(2) + 'x';
}
function roasCls(roas) {
  const n = parseFloat(roas) || 0;
  if (n >= 3)   return 'text-emerald-400';
  if (n >= 1.5) return 'text-amber-400';
  if (n > 0)    return 'text-red-400';
  return 'text-slate-500';
}
function aggRoasCls(revenue, spend) {
  if (!spend) return 'text-slate-500';
  return roasCls(revenue / spend);
}
function statusCls(s) {
  const u = (s || '').toUpperCase();
  if (u === 'ACTIVE')   return 'bg-emerald-500/15 text-emerald-400';
  if (u === 'PAUSED')   return 'bg-gray-700/40 text-slate-400';
  if (u.includes('PEND') || u.includes('PROC')) return 'bg-amber-500/15 text-amber-400';
  return 'bg-red-500/10 text-red-400';
}
function fatigueCls(level) {
  if (level === 'critical') return 'bg-red-500/15 text-red-400';
  if (level === 'high')     return 'bg-orange-500/15 text-orange-400';
  if (level === 'medium')   return 'bg-amber-500/15 text-amber-400';
  return '';
}
function fmtBudget(db, lb) {
  if (db > 0) return fmt(db) + '/d';
  if (lb > 0) return fmt(lb) + ' LT';
  return null; // null = not set / unknown
}

/* ─── BUILD COLLECTION GROUPS ────────────────────────────────────── */
function buildGroups(periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodDays) {
  const hasAdMap = Object.keys(adMap).length > 0;
  const isActive = id => !hasAdMap || !adMap[id] || adMap[id].effective_status === 'ACTIVE';

  /* ── 1. Period metrics per entity — ACTIVE ads only ── */
  const byAd  = {};
  const byAs  = {};
  const byCam = {};

  for (const r of periodRows) {
    // Skip paused/deleted/inactive ads when we have adMap data
    if (hasAdMap && adMap[r.adId] && adMap[r.adId].effective_status !== 'ACTIVE') continue;
    const acc = (map, id) => {
      if (!id) return;
      if (!map[id]) map[id] = {
        spend:0, impressions:0, clicks:0, purchases:0, revenue:0,
        freqSum:0, n:0,
        metaRoas:0, metaCpr:0,
        _roasWSum:0, _roasWN:0, _cprWSum:0, _cprWN:0,
        _n: {},
      };
      const m = map[id];
      const _sp = parseFloat(r.spend) || 0;
      m.spend       += _sp;
      m.impressions += parseFloat(r.impressions)                     || 0;
      m.clicks      += parseFloat(r.outboundClicks || r.clicksAll)  || 0;
      m.purchases   += parseFloat(r.purchases)                       || 0;
      m.revenue     += parseFloat(r.revenue)                         || 0;
      m.freqSum     += parseFloat(r.frequency)                       || 0;
      m.n++;
      // Spend-weighted accumulation — Meta's raw values, no division
      const _roas = parseFloat(r.metaRoas) || 0;
      const _cpr  = parseFloat(r.metaCpr)  || 0;
      if (_roas > 0 && _sp > 0) { m._roasWSum += _sp * _roas; m._roasWN += _sp; }
      if (_cpr  > 0 && _sp > 0) { m._cprWSum  += _sp * _cpr;  m._cprWN  += _sp; }
    };
    acc(byAd,  r.adId);
    acc(byAs,  r.adSetId);
    acc(byCam, r.campaignId);
    // name fallbacks from insight rows
    if (r.adId && byAd[r.adId]) byAd[r.adId]._n = {
      ad: r.adName, adSet: r.adSetName, adSetId: r.adSetId,
      campaign: r.campaignName, campaignId: r.campaignId,
    };
  }

  // Resolve spend-weighted avg ROAS/CPR — Meta raw, never computed
  for (const m of [...Object.values(byAd), ...Object.values(byAs), ...Object.values(byCam)]) {
    m.metaRoas = m._roasWN > 0 ? m._roasWSum / m._roasWN : 0;
    m.metaCpr  = m._cprWN  > 0 ? m._cprWSum  / m._cprWN  : 0;
  }

  /* ── 2. Enriched map ── */
  const enrichedByAdId = {};
  for (const r of enrichedRows) enrichedByAdId[r.adId] = r;

  /* ── 3. All ad IDs — active only ── */
  const allAdIds = new Set([
    ...Object.keys(byAd),
    ...Object.keys(adMap).filter(id => manualMap[id] && isActive(id)),
  ]);

  /* ── 4. Pre-compute PRIMARY collection per campaign and adset
          = collection where the most ad-spend for that entity comes from.
          This ensures each campaign/adset appears in exactly ONE collection. ── */
  const camSpend = {};   // { [camId]: { [col]: totalSpend } }
  const asSpend  = {};   // { [asId]:  { [col]: totalSpend } }

  for (const adId of allAdIds) {
    const col   = manualMap[adId]?.Collection || 'Unmapped';
    const adRec = adMap[adId] || {};
    const n     = byAd[adId]?._n || {};
    const camId = adRec.campaign_id  || n.campaignId || '';
    const asId  = adRec.adset_id    || n.adSetId    || '';
    const spend = byAd[adId]?.spend || 0;

    if (camId) {
      if (!camSpend[camId]) camSpend[camId] = {};
      camSpend[camId][col] = (camSpend[camId][col] || 0) + spend;
    }
    if (asId) {
      if (!asSpend[asId]) asSpend[asId] = {};
      asSpend[asId][col] = (asSpend[asId][col] || 0) + spend;
    }
  }

  // Resolve primary col for each campaign / adset
  const camPrimary = {};
  for (const [id, m] of Object.entries(camSpend))
    camPrimary[id] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unmapped';

  const asPrimary = {};
  for (const [id, m] of Object.entries(asSpend))
    asPrimary[id] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unmapped';

  /* ── 5. Global budget dedup sets (prevent same campaign budget in 2 groups) ── */
  const budgetCampSeen = new Set();
  const budgetAsSeen   = new Set();
  const hasBudgetData  = Object.keys(campaignMap).length > 0 || Object.keys(adsetMap).length > 0;

  /* ── 6. Build groups ── */
  const groups = {};

  for (const adId of allAdIds) {
    const manual   = manualMap[adId] || {};
    const col      = manual.Collection || 'Unmapped';
    const adRec    = adMap[adId]        || {};
    const n        = byAd[adId]?._n     || {};
    const asId     = adRec.adset_id    || n.adSetId    || '';
    const camId    = adRec.campaign_id  || n.campaignId || '';
    const asRec    = adsetMap[asId]     || {};
    const camRec   = campaignMap[camId] || {};
    const adName   = adRec.name        || n.ad         || adId;
    const asName   = asRec.name        || n.adSet      || asId;
    const camName  = camRec.name       || n.campaign   || camId;
    const adStatus = adRec.effective_status || adRec.status || '';

    if (!groups[col]) {
      groups[col] = {
        collection: col, hasBudgetData,
        spend:0, impressions:0, clicks:0, purchases:0, revenue:0,
        dailyBudget:0, lifetimeBudget:0,
        _roasWSum:0, _roasWN:0, _cprWSum:0, _cprWN:0,
        campaigns:{}, adsets:{}, ads:[],
      };
    }
    const g = groups[col];

    /* Ad-level spend → collection totals */
    const pm = byAd[adId] || { spend:0, impressions:0, clicks:0, purchases:0, revenue:0, n:1 };
    g.spend       += pm.spend;
    g.impressions += pm.impressions;
    g.clicks      += pm.clicks;
    g.purchases   += pm.purchases;
    g.revenue     += pm.revenue;
    if (pm.metaRoas > 0 && pm.spend > 0) { g._roasWSum += pm.spend * pm.metaRoas; g._roasWN += pm.spend; }
    if (pm.metaCpr  > 0 && pm.spend > 0) { g._cprWSum  += pm.spend * pm.metaCpr;  g._cprWN  += pm.spend; }

    /* Budget (Meta minor units → /100). Only count in primary collection, only once globally. */
    const campDB = parseInt(camRec.daily_budget    || 0);
    const campLB = parseInt(camRec.lifetime_budget || 0);
    const asDB   = parseInt(asRec.daily_budget     || 0);
    const asLB   = parseInt(asRec.lifetime_budget  || 0);

    if (camId && camPrimary[camId] === col && !budgetCampSeen.has(camId)) {
      budgetCampSeen.add(camId);
      if (campDB > 0) g.dailyBudget    += campDB / 100;
      if (campLB > 0) g.lifetimeBudget += campLB / 100;
    }
    if (asId && asPrimary[asId] === col && !budgetAsSeen.has(asId)) {
      budgetAsSeen.add(asId);
      if (!campDB && !campLB) {   // ABO: adset carries budget, campaign doesn't
        if (asDB > 0) g.dailyBudget    += asDB / 100;
        if (asLB > 0) g.lifetimeBudget += asLB / 100;
      }
    }

    /* Campaign row — ONLY in its primary collection, ACTIVE only */
    const camStatus = camRec.effective_status || camRec.status || '';
    if (camId && camPrimary[camId] === col && !g.campaigns[camId] &&
        (!hasAdMap || !camStatus || camStatus === 'ACTIVE')) {
      const cm = byCam[camId] || {};
      g.campaigns[camId] = {
        id: camId, name: camName,
        status: camRec.effective_status || camRec.status || '',
        objective: (camRec.objective || '').replace(/_/g, ' '),
        dailyBudget: campDB / 100, lifetimeBudget: campLB / 100,
        spend: cm.spend||0, impressions: cm.impressions||0,
        clicks: cm.clicks||0, purchases: cm.purchases||0, revenue: cm.revenue||0,
        metaRoas: cm.metaRoas||0, metaCpr: cm.metaCpr||0,
      };
    }

    /* Adset row — ONLY in its primary collection, ACTIVE only */
    const asStatus = asRec.effective_status || asRec.status || '';
    if (asId && asPrimary[asId] === col && !g.adsets[asId] &&
        (!hasAdMap || !asStatus || asStatus === 'ACTIVE')) {
      const am = byAs[asId] || {};
      g.adsets[asId] = {
        id: asId, name: asName,
        campaignId: camId, campaignName: camName,
        status: asRec.effective_status || asRec.status || '',
        dailyBudget: asDB / 100, lifetimeBudget: asLB / 100,
        spend: am.spend||0, impressions: am.impressions||0,
        clicks: am.clicks||0, purchases: am.purchases||0, revenue: am.revenue||0,
        metaRoas: am.metaRoas||0, metaCpr: am.metaCpr||0,
      };
    }

    /* Fatigue from enriched */
    const en   = enrichedByAdId[adId] || {};
    const freq = pm.n > 0 ? (pm.freqSum / pm.n) : parseFloat(en.frequency || 0);
    const qr   = en.qualityRanking    || '';
    const er   = en.engagementRanking || '';
    const cr   = en.conversionRanking || '';
    const trend= en.trendSignal       || '';

    let fatigueScore = 0;
    const signals = [];
    if      (freq > 5) { fatigueScore += 3; signals.push(`Freq ${freq.toFixed(1)}x — critical`); }
    else if (freq > 3) { fatigueScore += 2; signals.push(`Freq ${freq.toFixed(1)}x — high`); }
    else if (freq > 2) { fatigueScore += 1; signals.push(`Freq ${freq.toFixed(1)}x`); }
    if (qr.includes('BELOW')) { fatigueScore += qr.includes('10') || qr.includes('20') ? 2 : 1; signals.push('Below-avg quality'); }
    if (er.includes('BELOW')) { fatigueScore += 1; signals.push('Below-avg engagement'); }
    if (cr.includes('BELOW')) { fatigueScore += 1; signals.push('Below-avg conv rate'); }
    if (trend.includes('Fatigue / Worsening')) { fatigueScore += 3; signals.push('Fatigue + ROAS declining'); }
    else if (trend.includes('Fatigue'))         { fatigueScore += 2; signals.push('Fatigue risk'); }
    else if (trend.includes('Worsening'))       { fatigueScore += 1; signals.push('ROAS declining'); }
    const fatigueLevel = fatigueScore >= 5 ? 'critical' : fatigueScore >= 3 ? 'high' : fatigueScore >= 1 ? 'medium' : 'none';

    g.ads.push({
      id: adId, name: adName,
      adSetId: asId, adSetName: asName,
      campaignId: camId, campaignName: camName,
      status: adStatus, manual,
      spend: pm.spend, impressions: pm.impressions, clicks: pm.clicks,
      purchases: pm.purchases, revenue: pm.revenue,
      metaRoas: pm.metaRoas || 0,   // Meta's purchase_roas — direct
      metaCpr:  pm.metaCpr  || 0,   // Meta's cost_per_result — direct
      frequency: Math.round(freq * 10) / 10,
      ctr: pm.impressions > 0 ? (pm.clicks / pm.impressions) * 100 : 0,
      cpm: pm.impressions > 0 ? (pm.spend  / pm.impressions) * 1000 : 0,
      fatigueScore, fatigueLevel, signals,
      trendSignal:    en.trendSignal     || '',
      currentQuality: en.currentQuality || '',
      decision:       en.decision       || '',
      audienceFamily: en.audienceFamily || '',
      qualityRanking: qr, engagementRanking: er, conversionRanking: cr,
    });
  }

  /* ── 7. Finalise ── */
  return Object.values(groups).map(g => {
    const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
    const cpm = g.impressions > 0 ? (g.spend  / g.impressions) * 1000 : 0;
    // Spend-weighted avg of Meta's own purchase_roas and cost_per_result — no division
    const avgMetaRoas = g._roasWN > 0 ? g._roasWSum / g._roasWN : 0;
    const avgMetaCpr  = g._cprWN  > 0 ? g._cprWSum  / g._cprWN  : 0;
    const expectedSpend  = g.dailyBudget * periodDays;
    const pacing         = expectedSpend > 0 ? (g.spend / expectedSpend) * 100 : null;
    const campaigns      = Object.values(g.campaigns).sort((a, b) => b.spend - a.spend);
    const adsets         = Object.values(g.adsets).sort((a, b) => b.spend - a.spend);
    const ads            = g.ads.sort((a, b) => b.spend - a.spend);
    const highFatigueAds = ads.filter(a => a.fatigueLevel === 'critical' || a.fatigueLevel === 'high');
    const activeAds      = ads.filter(a => a.status === 'ACTIVE').length;
    const decisionDist   = {};
    for (const a of ads) if (a.decision) decisionDist[a.decision] = (decisionDist[a.decision] || 0) + 1;
    return {
      ...g, ctr, cpm, avgMetaRoas, avgMetaCpr, expectedSpend, pacing,
      campaigns, adsets, ads, highFatigueAds, activeAds, decisionDist,
    };
  }).filter(g => g.spend > 0).sort((a, b) => b.spend - a.spend);
}

/* ─── ATOMS ───────────────────────────────────────────────────────── */
function SBadge({ s }) {
  if (!s) return null;
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusCls(s)}`}>{s}</span>;
}
function FBadge({ level }) {
  if (level === 'none') return null;
  const map = { critical: 'FATIGUE', high: 'FATIGUE', medium: 'RISK' };
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${fatigueCls(level)}`}>{map[level]}</span>;
}
function Chip({ label, value, cls = 'text-white' }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <div className="text-[10px] text-slate-500 leading-none mb-1">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
function BudgetChip({ label, dailyBudget, lifetimeBudget, hasBudgetData }) {
  if (!hasBudgetData) return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <div className="text-[10px] text-slate-500 leading-none mb-1">{label}</div>
      <div className="text-[10px] text-slate-600 italic">not loaded</div>
    </div>
  );
  const display = fmtBudget(dailyBudget, lifetimeBudget);
  return <Chip label={label} value={display || 'none set'} cls={display ? 'text-blue-300' : 'text-slate-500'} />;
}

/* ─── ENTITY TABLE ───────────────────────────────────────────────── */
function EntityTable({ rows, type }) {
  const colDefs = {
    campaigns: [
      { h: 'Campaign',    r: row => <span className="font-medium text-white text-xs">{row.name}</span>, w: 'min-w-[160px]' },
      { h: 'Status',      r: row => <SBadge s={row.status} /> },
      { h: 'Objective',   r: row => <span className="text-[11px] text-slate-500">{row.objective}</span> },
      { h: 'Daily Budget',r: row => row.dailyBudget > 0 ? <span className="text-blue-300 font-mono text-xs">{fmt(row.dailyBudget)}</span> : null, num: true },
      { h: 'Life. Budget',r: row => row.lifetimeBudget > 0 ? <span className="text-blue-300 font-mono text-xs">{fmt(row.lifetimeBudget)}</span> : null, num: true },
      { h: 'Spend',       r: row => fmt(row.spend),                               num: true },
      { h: 'Impressions', r: row => fmtN(row.impressions),                        num: true },
      { h: 'Purchases',   r: row => fmtN(row.purchases),                          num: true },
      { h: 'Revenue',     r: row => <span className="text-emerald-400 font-mono text-xs">{fmt(row.revenue)}</span>, num: true },
      { h: 'ROAS (Meta)', r: row => <span className={roasCls(row.metaRoas) + ' font-bold font-mono text-xs'}>{fmtRoas(row.metaRoas)}</span>, num: true },
      { h: 'CPR (Meta)',  r: row => row.metaCpr > 0 ? <span className="font-mono text-xs text-gray-300">{fmt(row.metaCpr)}</span> : null, num: true },
    ],
    adsets: [
      { h: 'Ad Set',      r: row => <div><div className="font-medium text-white text-xs">{row.name}</div><div className="text-[10px] text-slate-500">{row.campaignName}</div></div>, w: 'min-w-[160px]' },
      { h: 'Status',      r: row => <SBadge s={row.status} /> },
      { h: 'Daily Budget',r: row => row.dailyBudget > 0 ? <span className="text-blue-300 font-mono text-xs">{fmt(row.dailyBudget)}</span> : null, num: true },
      { h: 'Life. Budget',r: row => row.lifetimeBudget > 0 ? <span className="text-blue-300 font-mono text-xs">{fmt(row.lifetimeBudget)}</span> : null, num: true },
      { h: 'Spend',       r: row => fmt(row.spend),                               num: true },
      { h: 'Impressions', r: row => fmtN(row.impressions),                        num: true },
      { h: 'Purchases',   r: row => fmtN(row.purchases),                          num: true },
      { h: 'Revenue',     r: row => <span className="text-emerald-400 font-mono text-xs">{fmt(row.revenue)}</span>, num: true },
      { h: 'ROAS (Meta)', r: row => <span className={roasCls(row.metaRoas) + ' font-bold font-mono text-xs'}>{fmtRoas(row.metaRoas)}</span>, num: true },
      { h: 'CPR (Meta)',  r: row => row.metaCpr > 0 ? <span className="font-mono text-xs text-gray-300">{fmt(row.metaCpr)}</span> : null, num: true },
    ],
    ads: [
      { h: 'Ad',          r: row => <div><div className="font-medium text-white text-xs">{row.name}</div><div className="text-[10px] text-slate-500 truncate max-w-[160px]">{row.adSetName}</div></div>, w: 'min-w-[160px]' },
      { h: 'Status',      r: row => <SBadge s={row.status} /> },
      { h: 'Fatigue',     r: row => <FBadge level={row.fatigueLevel} /> },
      { h: 'Spend',       r: row => fmt(row.spend),         num: true },
      { h: 'Impressions', r: row => fmtN(row.impressions),  num: true },
      { h: 'Freq',        r: row => <span className={row.frequency > 4 ? 'text-red-400' : row.frequency > 2.5 ? 'text-amber-400' : 'text-gray-300'}>{row.frequency || '—'}</span>, num: true },
      { h: 'CTR%',        r: row => row.ctr > 0 ? row.ctr.toFixed(2) + '%' : '—', num: true },
      { h: 'CPM',         r: row => row.cpm > 0 ? fmt(row.cpm) : '—',             num: true },
      { h: 'Purchases',   r: row => fmtN(row.purchases),    num: true },
      { h: 'Revenue',     r: row => <span className="text-emerald-400">{fmt(row.revenue)}</span>, num: true },
      // Meta's own ROAS and CPR — not computed
      { h: 'ROAS (Meta)', r: row => <span className={roasCls(row.metaRoas) + ' font-bold'}>{fmtRoas(row.metaRoas)}</span>, num: true },
      { h: 'CPR (Meta)',  r: row => row.metaCpr > 0 ? <span className="font-mono text-gray-300">{fmt(row.metaCpr)}</span> : null, num: true },
    ],
  }[type] || [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700/40">
            {colDefs.map((c, i) => (
              <th key={i} className={`py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap ${c.num ? 'text-right' : 'text-left'} ${c.w || ''}`}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.id || ri} className="border-b border-gray-800/30 hover:bg-white/[0.02]">
              {colDefs.map((c, ci) => (
                <td key={ci} className={`py-2 px-3 text-gray-300 ${c.num ? 'text-right font-mono' : 'text-left'}`}>
                  {c.r(row) ?? <span className="text-slate-600">—</span>}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={colDefs.length} className="py-6 text-center text-slate-600 text-xs">No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── FATIGUE TAB ─────────────────────────────────────────────────── */
const FATIGUE_REC = {
  critical: 'Pause immediately and replace creative',
  high:     'Refresh creative this week; reduce budget',
  medium:   'Monitor closely; prepare new variations',
};
function FatigueTab({ ads }) {
  const fatigued = [...ads].filter(a => a.fatigueLevel !== 'none').sort((a, b) => b.fatigueScore - a.fatigueScore);
  if (!fatigued.length) return (
    <div className="py-10 text-center text-slate-500 text-sm">No creative fatigue detected in this collection</div>
  );
  return (
    <div className="space-y-2 p-3">
      {fatigued.map(ad => (
        <div key={ad.id} className={`rounded-xl border p-4 ${
          ad.fatigueLevel === 'critical' ? 'border-red-700/40 bg-red-950/30'
          : ad.fatigueLevel === 'high'   ? 'border-orange-700/40 bg-orange-950/30'
          : 'border-amber-700/30 bg-amber-950/20'}`}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="font-semibold text-white text-sm truncate">{ad.name}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{ad.adSetName} · {ad.campaignName}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <FBadge level={ad.fatigueLevel} />
              <span className="text-[10px] text-slate-500">score {ad.fatigueScore}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { l: 'Frequency', v: ad.frequency || '—', w: ad.frequency > 3 },
              { l: 'ROAS (Meta)', v: fmtRoas(ad.metaRoas) },
              { l: 'Spend',      v: fmt(ad.spend) },
              { l: 'Trend',      v: ad.trendSignal || '—' },
            ].map(m => (
              <div key={m.l} className="bg-gray-800/50 rounded-lg px-2 py-1.5">
                <div className="text-[9px] text-slate-500">{m.l}</div>
                <div className={`text-xs font-semibold ${m.w ? 'text-red-400' : 'text-white'}`}>{m.v}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ad.signals.map((s, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-gray-800 text-slate-400 text-[10px]">{s}</span>
            ))}
          </div>
          {(ad.qualityRanking || ad.engagementRanking || ad.conversionRanking) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { l: 'Quality',    v: ad.qualityRanking },
                { l: 'Engagement', v: ad.engagementRanking },
                { l: 'Conversion', v: ad.conversionRanking },
              ].filter(m => m.v).map(m => (
                <span key={m.l} className={`text-[10px] px-2 py-0.5 rounded ${m.v.includes('BELOW') ? 'bg-red-900/30 text-red-400' : 'bg-emerald-900/30 text-emerald-400'}`}>
                  {m.l}: {m.v.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
          <div className={`text-[11px] flex items-center gap-1 ${
            ad.fatigueLevel === 'critical' ? 'text-red-400' : ad.fatigueLevel === 'high' ? 'text-orange-400' : 'text-amber-400'
          }`}>
            <AlertTriangle size={10} className="shrink-0" />
            {FATIGUE_REC[ad.fatigueLevel]}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── OVERVIEW TAB ────────────────────────────────────────────────── */
function OverviewTab({ g, periodDays }) {
  const topAds  = g.ads.filter(a => a.spend > 0).slice(0, 3);
  const wrstAds = [...g.ads.filter(a => a.spend > 50)]
    .sort((a, b) => (parseFloat(a.metaRoas) || 0) - (parseFloat(b.metaRoas) || 0))
    .slice(0, 3);
  const decEntries = Object.entries(g.decisionDist).sort((a, b) => b[1] - a[1]);
  const audDist    = {};
  for (const a of g.ads) if (a.audienceFamily) audDist[a.audienceFamily] = (audDist[a.audienceFamily] || 0) + 1;

  return (
    <div className="p-4 space-y-4">
      {/* KPI chips */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Chip label="Spend"      value={fmt(g.spend)} />
        <Chip label="Revenue"    value={fmt(g.revenue)} cls="text-emerald-400" />
        <Chip label="ROAS (Meta)" value={fmtRoas(g.avgMetaRoas)} cls={roasCls(g.avgMetaRoas)} />
        <Chip label="Impressions" value={fmtN(g.impressions)} cls="text-gray-300" />
        <Chip label="Purchases"   value={fmtN(g.purchases)} cls="text-gray-300" />
        <Chip label="CPR (Meta)"  value={g.avgMetaCpr > 0 ? fmt(g.avgMetaCpr) : '—'} cls={g.avgMetaCpr > 0 && g.avgMetaCpr < 500 ? 'text-emerald-400' : 'text-amber-400'} />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Chip label="CTR%" value={g.ctr > 0 ? g.ctr.toFixed(2) + '%' : '—'} cls="text-gray-300" />
        <Chip label="CPM"  value={g.cpm > 0 ? fmt(g.cpm) : '—'} cls="text-gray-300" />
        <BudgetChip label="Daily Budget"  dailyBudget={g.dailyBudget}  lifetimeBudget={0}              hasBudgetData={g.hasBudgetData} />
        <BudgetChip label="Life. Budget"  dailyBudget={0}              lifetimeBudget={g.lifetimeBudget} hasBudgetData={g.hasBudgetData} />
        <BudgetChip label="Period Budget" dailyBudget={g.expectedSpend} lifetimeBudget={0}              hasBudgetData={g.hasBudgetData} />
        <Chip label="Pacing" value={g.pacing != null ? Math.round(g.pacing) + '%' : g.hasBudgetData ? '—' : 'N/A'}
          cls={g.pacing == null ? 'text-slate-500' : g.pacing > 110 ? 'text-red-400' : g.pacing > 85 ? 'text-emerald-400' : 'text-amber-400'} />
      </div>

      {/* Pacing bar */}
      {g.expectedSpend > 0 && g.pacing != null && (
        <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 p-3 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-500">Spend vs {periodDays}d budget</span>
            <span className="text-slate-400">{fmt(g.spend)} / {fmt(g.expectedSpend)}</span>
          </div>
          <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${g.pacing > 110 ? 'bg-red-500' : g.pacing > 85 ? 'bg-emerald-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(g.pacing, 140) / 1.4}%` }}
            />
          </div>
          <div className={`text-[10px] ${g.pacing > 110 ? 'text-red-400' : g.pacing > 85 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {g.pacing > 110 ? 'Over-pacing' : g.pacing > 85 ? 'On track' : g.pacing > 60 ? 'Under-pacing' : 'Under-delivering'}
          </div>
        </div>
      )}

      {/* Decision + audience */}
      {(decEntries.length > 0 || Object.keys(audDist).length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {decEntries.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                <Target size={10} /> Decision Split
              </div>
              {decEntries.slice(0, 6).map(([d, n]) => (
                <div key={d} className="flex justify-between text-xs py-0.5">
                  <span className="text-slate-300">{d}</span>
                  <span className="text-slate-500">{n}</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(audDist).length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                <Zap size={10} /> Audience Split
              </div>
              {Object.entries(audDist).sort((a, b) => b[1] - a[1]).map(([aud, n]) => (
                <div key={aud} className="flex justify-between text-xs py-0.5">
                  <span className="text-slate-300">{aud}</span>
                  <span className="text-slate-500">{n} ads</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top / worst */}
      {(topAds.length > 0 || wrstAds.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {topAds.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-2">Top Spend</div>
              {topAds.map(a => (
                <div key={a.id} className="flex justify-between items-center py-1 border-b border-gray-700/30 last:border-0 text-xs gap-2">
                  <span className="text-slate-300 truncate">{a.name}</span>
                  <div className="flex gap-2 shrink-0">
                    <span className="text-white font-medium">{fmt(a.spend)}</span>
                    <span className={roasCls(a.metaRoas)}>{fmtRoas(a.metaRoas)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {wrstAds.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700 mb-2">Worst ROAS</div>
              {wrstAds.map(a => (
                <div key={a.id} className="flex justify-between items-center py-1 border-b border-gray-700/30 last:border-0 text-xs gap-2">
                  <span className="text-slate-300 truncate">{a.name}</span>
                  <div className="flex gap-2 shrink-0">
                    <span className="text-white font-medium">{fmt(a.spend)}</span>
                    <span className={roasCls(a.metaRoas)}>{fmtRoas(a.metaRoas)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── COLLECTION CARD ─────────────────────────────────────────────── */
function CollectionCard({ g, totalSpend, periodDays }) {
  const [open, setOpen]     = useState(false);
  const [subTab, setSubTab] = useState('overview');
  const pct = totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0;

  const tabs = [
    { id: 'overview',  label: 'Overview',  Icon: BarChart3 },
    { id: 'campaigns', label: 'Campaigns', count: g.campaigns.length },
    { id: 'adsets',    label: 'Ad Sets',   count: g.adsets.length },
    { id: 'ads',       label: 'Ads',       count: g.ads.length },
    { id: 'fatigue',   label: 'Fatigue',   count: g.highFatigueAds.length, warn: g.highFatigueAds.length > 0 },
  ];

  const budgetDisplay = fmtBudget(g.dailyBudget, g.lifetimeBudget);

  return (
    <div className={`border rounded-xl overflow-hidden ${open ? 'border-gray-700/80' : 'border-gray-800/60'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gray-900/50 hover:bg-gray-800/40 transition-colors text-left"
      >
        <span className="text-slate-500 shrink-0">{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</span>

        {/* Name + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{g.collection}</span>
            {g.highFatigueAds.length > 0 && (
              <span className="text-[10px] text-orange-400 flex items-center gap-0.5">
                <Flame size={9}/>{g.highFatigueAds.length} fatigued
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 max-w-[160px]">
            <div className="flex-1 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }}/>
            </div>
            <span className="text-[10px] text-slate-500 shrink-0">{pct.toFixed(1)}%</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {[
            { l: 'Spend',     v: fmt(g.spend),                         c: 'text-white font-semibold' },
            { l: 'Budget/d',  v: g.hasBudgetData ? (budgetDisplay || 'none') : '—',  c: g.hasBudgetData && budgetDisplay ? 'text-blue-300' : 'text-slate-500' },
            { l: 'Pacing',    v: g.pacing != null ? Math.round(g.pacing) + '%' : '—',
              c: g.pacing == null ? 'text-slate-500' : g.pacing > 110 ? 'text-red-400' : g.pacing > 85 ? 'text-emerald-400' : 'text-amber-400' },
            { l: 'Revenue',   v: fmt(g.revenue),                                   c: 'text-emerald-400' },
            { l: 'ROAS',      v: fmtRoas(g.avgMetaRoas),                            c: roasCls(g.avgMetaRoas) + ' font-bold' },
            { l: 'CPR',       v: g.avgMetaCpr > 0 ? fmt(g.avgMetaCpr) : '—',       c: 'text-gray-300' },
            { l: 'Ads',       v: `${g.activeAds}A / ${g.ads.length}`,   c: 'text-gray-300' },
          ].map(m => (
            <div key={m.l} className="text-right min-w-[56px]">
              <div className="text-[9px] text-slate-500 leading-none mb-1">{m.l}</div>
              <div className={`text-sm ${m.c}`}>{m.v}</div>
            </div>
          ))}
        </div>

        {/* Mobile: spend + ROAS only */}
        <div className="flex md:hidden items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[9px] text-slate-500">Spend</div>
            <div className="text-sm font-semibold text-white">{fmt(g.spend)}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-slate-500">ROAS</div>
            <div className={`text-sm font-bold ${roasCls(g.avgMetaRoas)}`}>{fmtRoas(g.avgMetaRoas)}</div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/40">
          {/* Sub-tabs */}
          <div className="flex gap-0.5 px-4 pt-3 overflow-x-auto">
            {tabs.map(t => {
              const Icon = t.Icon;
              return (
                <button key={t.id} onClick={() => setSubTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                    ${subTab === t.id ? 'bg-gray-800/60 text-white border-brand-500' : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-gray-800/30'}
                    ${t.warn ? '!text-orange-400' : ''}`}>
                  {Icon && <Icon size={11}/>}
                  {t.label}
                  {t.count != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center
                      ${t.warn ? 'bg-orange-500/20 text-orange-400' : subTab === t.id ? 'bg-brand-600/30 text-brand-300' : 'bg-gray-700/50 text-slate-500'}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-gray-800/50">
            {subTab === 'overview'  && <OverviewTab g={g} periodDays={periodDays} />}
            {subTab === 'campaigns' && <div className="px-1 py-1"><EntityTable rows={g.campaigns} type="campaigns" /></div>}
            {subTab === 'adsets'    && <div className="px-1 py-1"><EntityTable rows={g.adsets}    type="adsets" /></div>}
            {subTab === 'ads'       && <div className="px-1 py-1"><EntityTable rows={g.ads}       type="ads" /></div>}
            {subTab === 'fatigue'   && <FatigueTab ads={g.ads} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── LAZY FETCH PANEL ────────────────────────────────────────────── */
function LazyFetchPanel({ period, status, msg, onFetch }) {
  const meta = PERIODS.find(p => p.id === period);
  return (
    <div className="flex flex-col items-center justify-center py-14 border border-gray-800/40 rounded-2xl bg-gray-900/20 text-center">
      <Info size={32} className="text-slate-600 mb-3" />
      <div className="text-sm font-medium text-white mb-1">{meta?.label} is not in the standard pull</div>
      <div className="text-xs text-slate-500 mb-4 max-w-xs">
        Fetch it now directly from Meta API. Data stays in memory until you leave the page.
      </div>
      {status === 'error' && (
        <div className="text-xs text-red-400 mb-3 max-w-xs bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{msg}</div>
      )}
      <button
        onClick={onFetch}
        disabled={status === 'loading'}
        className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {status === 'loading' ? (msg || 'Fetching…') : `Fetch ${meta?.label}`}
      </button>
    </div>
  );
}

/* ─── MAIN PAGE ───────────────────────────────────────────────────── */
export default function CollectionSpend() {
  const {
    brandData, brands, activeBrandIds,
    enrichedRows, manualMap, campaignMap, adsetMap, adMap,
    startPullJob, updatePullJob, finishPullJob,
  } = useStore();

  const [period, setPeriod] = useState('7d');
  const [sortBy, setSortBy] = useState('spend');

  // Lazy-fetched data: keyed by period id
  const [lazyData, setLazyData] = useState({});   // { [id]: rows[] }
  const [lazyStatus, setLazyStatus] = useState({}); // { [id]: 'idle'|'loading'|'done'|'error' }
  const [lazyMsg, setLazyMsg]   = useState({});     // { [id]: string }

  /* ── Lazy fetch ── */
  const doFetch = useCallback(async (pid) => {
    const meta = PERIODS.find(p => p.id === pid);
    if (!meta?.lazy || !meta.preset) return;
    setLazyStatus(s => ({ ...s, [pid]: 'loading' }));
    setLazyMsg(s => ({ ...s, [pid]: 'Connecting…' }));
    const collected = [];
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    const jobId = `collection-spend:${pid}:${Date.now()}`;
    startPullJob(jobId, `Collection Spend — ${meta.label || pid}`, `${active.length} brand(s)`);
    const accountUnits = active.flatMap(b =>
      (b.meta?.accounts || []).filter(a => a.id && a.key && b.meta?.token).map(a => ({ brand: b, acc: a })),
    );
    let done = 0;
    try {
      for (const brand of active) {
        const { token, apiVersion = 'v21.0', accounts = [] } = brand.meta || {};
        if (!token) continue;
        for (const acc of accounts) {
          if (!acc.id || !acc.key) continue;
          setLazyMsg(s => ({ ...s, [pid]: `Fetching ${acc.key}…` }));
          updatePullJob(jobId, {
            pct: accountUnits.length ? (done / accountUnits.length) * 100 : null,
            detail: `${brand.name} · ${acc.key}: fetching ${meta.preset}`,
          });
          const raw = await fetchInsights(apiVersion, token, acc.id, meta.preset);
          collected.push(...raw.map(r => ({ ...normalizeInsight(r, acc.key, pid), _brandId: brand.id })));
          done++;
        }
      }
      setLazyData(d => ({ ...d, [pid]: collected }));
      setLazyStatus(s => ({ ...s, [pid]: 'done' }));
      setLazyMsg(s => ({ ...s, [pid]: '' }));
      finishPullJob(jobId, true, `${collected.length} rows · ${accountUnits.length} account(s)`);
    } catch (e) {
      setLazyStatus(s => ({ ...s, [pid]: 'error' }));
      setLazyMsg(s => ({ ...s, [pid]: e.message }));
      finishPullJob(jobId, false, e.message || 'Collection spend fetch failed');
    }
  }, [brands, activeBrandIds, startPullJob, updatePullJob, finishPullJob]);

  /* ── Clear lazy cache whenever the active brand set changes ── */
  useEffect(() => {
    setLazyData({});
    setLazyStatus({});
    setLazyMsg({});
  }, [activeBrandIds]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Period rows — prefer brandData (cached by standard pull); fall back to lazy ── */
  const periodMeta = PERIODS.find(p => p.id === period) || PERIODS[2];
  const cachedRows = useMemo(() => {
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    if (period === 'yesterday') return active.flatMap(b => brandData[b.id]?.insightsYesterday || []);
    if (period === '3d')        return active.flatMap(b => brandData[b.id]?.insights3d        || []);
    if (period === '7d')        return active.flatMap(b => brandData[b.id]?.insights7d        || []);
    if (period === '14d')       return active.flatMap(b => brandData[b.id]?.insights14d       || []);
    if (period === '30d')       return active.flatMap(b => brandData[b.id]?.insights30d       || []);
    return active.flatMap(b => brandData[b.id]?.insightsToday || []);
  }, [period, brands, activeBrandIds, brandData]);

  const periodRows = useMemo(() => {
    if (periodMeta.lazy && !cachedRows.length) {
      const ids = new Set(activeBrandIds || []);
      return (lazyData[period] || []).filter(r => !r._brandId || ids.has(r._brandId));
    }
    return cachedRows;
  }, [periodMeta.lazy, cachedRows, period, lazyData, activeBrandIds]);

  /* ── Auto-fetch when a lazy period is selected AND brandData has no cached rows ── */
  useEffect(() => {
    const meta = PERIODS.find(p => p.id === period);
    if (!meta?.lazy) return;
    if (cachedRows.length) return;                    // already have data from standard pull
    const status = lazyStatus[period];
    if (status === 'loading' || status === 'done' || status === 'error') return;
    doFetch(period);
  }, [period, lazyStatus, doFetch, cachedRows.length]);

  /* ── Build groups ── */
  const groups = useMemo(
    () => buildGroups(periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodMeta.days),
    [periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodMeta.days],
  );

  /* ── Sort ── */
  const sorted = useMemo(() => {
    const arr = [...groups];
    if (sortBy === 'budget')  return arr.sort((a, b) => b.dailyBudget - a.dailyBudget);
    if (sortBy === 'roas')    return arr.sort((a, b) => (b.avgMetaRoas || 0) - (a.avgMetaRoas || 0));
    if (sortBy === 'fatigue') return arr.sort((a, b) => b.highFatigueAds.length - a.highFatigueAds.length);
    if (sortBy === 'name')    return arr.sort((a, b) => a.collection.localeCompare(b.collection));
    return arr; // 'spend': already sorted in buildGroups
  }, [groups, sortBy]);

  /* ── Totals ── */
  const T = useMemo(() => {
    const roasWSum = groups.reduce((s, g) => s + (g.avgMetaRoas > 0 ? g.spend * g.avgMetaRoas : 0), 0);
    const roasWN   = groups.reduce((s, g) => s + (g.avgMetaRoas > 0 ? g.spend : 0), 0);
    const cprWSum  = groups.reduce((s, g) => s + (g.avgMetaCpr  > 0 ? g.spend * g.avgMetaCpr  : 0), 0);
    const cprWN    = groups.reduce((s, g) => s + (g.avgMetaCpr  > 0 ? g.spend : 0), 0);
    return {
      spend:         groups.reduce((s, g) => s + g.spend, 0),
      revenue:       groups.reduce((s, g) => s + g.revenue, 0),
      purchases:     groups.reduce((s, g) => s + g.purchases, 0),
      dailyBudget:   groups.reduce((s, g) => s + g.dailyBudget, 0),
      expectedSpend: groups.reduce((s, g) => s + g.expectedSpend, 0),
      highFatigue:   groups.reduce((s, g) => s + g.highFatigueAds.length, 0),
      activeAds:     groups.reduce((s, g) => s + g.activeAds, 0),
      totalAds:      groups.reduce((s, g) => s + g.ads.length, 0),
      hasBudget:     groups.some(g => g.hasBudgetData && (g.dailyBudget > 0 || g.lifetimeBudget > 0)),
      avgMetaRoas:   roasWN > 0 ? roasWSum / roasWN : 0,
      avgMetaCpr:    cprWN  > 0 ? cprWSum  / cprWN  : 0,
    };
  }, [groups]);

  const lazyFallback  = periodMeta.lazy && !cachedRows.length;
  const lazyNeedsLoad = lazyFallback && (!lazyStatus[period] || lazyStatus[period] === 'idle');
  const lazyLoading   = lazyFallback && lazyStatus[period] === 'loading';
  const lazyError     = lazyFallback && lazyStatus[period] === 'error';
  const lazyReady     = lazyFallback && lazyStatus[period] === 'done';

  return (
    <div className="space-y-5">
      {/* Header + sort */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp size={20} className="text-brand-400" />
            Collection Spend
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {periodMeta.label} — spend, budget & creative health by collection
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap">
          <span className="text-[11px] text-slate-500 mr-1">Sort</span>
          {['spend','budget','roas','fatigue','name'].map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors capitalize
                ${sortBy === s ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              period === p.id
                ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30'
                : 'bg-gray-800/50 text-slate-400 hover:text-slate-200 hover:bg-gray-800'
            }`}>
            {p.label}
            {p.lazy && lazyLoading && period === p.id && <Loader2 size={11} className="animate-spin"/>}
          </button>
        ))}
        {lazyReady && (
          <button onClick={() => doFetch(period)}
            className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-200 hover:bg-gray-800 flex items-center gap-1.5">
            <RefreshCw size={11}/> Refresh
          </button>
        )}
      </div>

      {/* Lazy fallback panel — only if brandData has no cached rows for this period */}
      {lazyFallback && (lazyNeedsLoad || lazyLoading || lazyError) && (
        <LazyFetchPanel
          period={period}
          status={lazyStatus[period] || 'idle'}
          msg={lazyMsg[period] || ''}
          onFetch={() => doFetch(period)}
        />
      )}

      {/* Budget not loaded notice */}
      {!lazyNeedsLoad && !lazyLoading && groups.length > 0 && !T.hasBudget && (
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-gray-800/30 border border-gray-700/30 rounded-xl px-4 py-3">
          <Info size={13} className="shrink-0" />
          Budget data not loaded — pull Meta structure (campaigns/adsets) from Setup to see budgets and pacing
        </div>
      )}

      {/* Summary KPIs */}
      {groups.length > 0 && !(lazyNeedsLoad || lazyLoading) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { l: 'Total Spend',    v: fmt(T.spend),        c: 'text-white' },
            { l: 'Total Revenue',  v: fmt(T.revenue),      c: 'text-emerald-400' },
            { l: 'Overall ROAS',   v: fmtRoas(T.avgMetaRoas), c: roasCls(T.avgMetaRoas) },
            { l: 'Purchases',      v: fmtN(T.purchases),   c: 'text-gray-300' },
            { l: 'Daily Budget',   v: T.hasBudget ? fmt(T.dailyBudget) : '—', c: T.hasBudget ? 'text-blue-300' : 'text-slate-500' },
            { l: 'Period Budget',  v: T.hasBudget ? fmt(T.expectedSpend) : '—', c: T.hasBudget ? 'text-blue-300' : 'text-slate-500' },
            { l: 'Active Ads',     v: `${T.activeAds}/${T.totalAds}`, c: 'text-gray-300' },
            { l: 'Fatigued Ads',   v: String(T.highFatigue), c: T.highFatigue > 0 ? 'text-orange-400' : 'text-slate-500' },
          ].map(k => (
            <div key={k.l} className="bg-gray-900/60 rounded-xl border border-gray-800/50 px-3 py-3">
              <div className="text-[10px] text-slate-500 mb-1">{k.l}</div>
              <div className={`text-lg font-bold ${k.c}`}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Fatigue alert */}
      {T.highFatigue > 0 && !(lazyNeedsLoad || lazyLoading) && (
        <div className="flex items-center gap-3 bg-orange-900/20 border border-orange-700/30 rounded-xl px-4 py-3">
          <Flame size={15} className="text-orange-400 shrink-0"/>
          <span className="text-sm text-orange-300">
            <strong>{T.highFatigue} ads</strong> show high creative fatigue across&nbsp;
            {groups.filter(g => g.highFatigueAds.length > 0).length} collection(s). Open each collection → Fatigue tab for details.
          </span>
        </div>
      )}

      {/* Collection cards */}
      {sorted.length > 0 && !(lazyNeedsLoad || lazyLoading) && (
        <div className="space-y-2">
          {sorted.map(g => (
            <CollectionCard key={g.collection} g={g} totalSpend={T.spend} periodDays={periodMeta.days}/>
          ))}
        </div>
      )}

      {/* No data (post-load) */}
      {sorted.length === 0 && !lazyNeedsLoad && !lazyLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 border border-gray-800/40 rounded-2xl bg-gray-900/20">
          <BarChart3 size={36} className="mb-3 opacity-20"/>
          <div className="text-sm font-medium">No spend data for {periodMeta.label}</div>
          <div className="text-xs mt-1 opacity-60">Assign collections to your ads via the manual map in Setup.</div>
        </div>
      )}
    </div>
  );
}
