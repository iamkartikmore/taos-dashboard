import { useState, useMemo, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, TrendingUp, Loader2, RefreshCw,
  AlertTriangle, Zap, Target, BarChart3, Flame, Shield,
} from 'lucide-react';
import { useStore } from '../store';
import { fetchInsights } from '../lib/api';
import { normalizeInsight } from '../lib/analytics';

/* ─── PERIODS ─────────────────────────────────────────────────────── */
const PERIODS = [
  { id: 'yesterday', label: 'Yesterday', days: 1 },
  { id: '3d',        label: 'Last 3D',   days: 3, lazy: true },
  { id: '7d',        label: 'Last 7D',   days: 7 },
  { id: '14d',       label: 'Last 14D',  days: 14 },
];

/* ─── FORMATTERS ──────────────────────────────────────────────────── */
const n = v => parseFloat(v || 0);
function fmt(v) {
  if (!v) return '—';
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
  if (v >= 1e3) return '₹' + (v / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(v);
}
function fmtN(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}
function fmtR(rev, spend) {
  if (!spend || !rev) return '—';
  return (rev / spend).toFixed(2) + 'x';
}
function fmtPct(v) { return v != null ? Math.round(v) + '%' : '—'; }
function roasCls(rev, spend) {
  if (!spend) return 'text-slate-500';
  const r = rev / spend;
  if (r >= 3) return 'text-emerald-400';
  if (r >= 1.5) return 'text-amber-400';
  return 'text-red-400';
}
function statusCls(s) {
  const upper = (s || '').toUpperCase();
  if (upper === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/20';
  if (upper === 'PAUSED') return 'bg-gray-700/40 text-slate-400 ring-gray-600/20';
  if (upper.includes('PENDING') || upper.includes('PROCESS')) return 'bg-amber-500/15 text-amber-400 ring-amber-500/20';
  return 'bg-red-500/10 text-red-400 ring-red-500/20';
}
function fatigueCls(level) {
  if (level === 'critical') return 'bg-red-500/15 text-red-400';
  if (level === 'high')     return 'bg-orange-500/15 text-orange-400';
  if (level === 'medium')   return 'bg-amber-500/15 text-amber-400';
  return 'bg-gray-700/30 text-slate-500';
}

/* ─── BUILD COLLECTION GROUPS ────────────────────────────────────── */
function buildCollectionGroups(periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodDays) {
  // 1. Aggregate period metrics per entity
  const byAd  = {};
  const byAs  = {};
  const byCam = {};
  for (const r of periodRows) {
    const add = (map, id) => {
      if (!map[id]) map[id] = { spend:0, impressions:0, clicks:0, purchases:0, revenue:0, freqSum:0, n:0 };
      const m = map[id];
      m.spend       += n(r.spend);
      m.impressions += n(r.impressions);
      m.clicks      += n(r.outboundClicks || r.clicksAll);
      m.purchases   += n(r.purchases);
      m.revenue     += n(r.revenue);
      m.freqSum     += n(r.frequency);
      m.n++;
      // store names from insight row as fallback
      if (!m._adName     && r.adName)       m._adName       = r.adName;
      if (!m._adSetName  && r.adSetName)     m._adSetName    = r.adSetName;
      if (!m._campName   && r.campaignName)  m._campName     = r.campaignName;
      if (!m._adSetId    && r.adSetId)       m._adSetId      = r.adSetId;
      if (!m._campaignId && r.campaignId)    m._campaignId   = r.campaignId;
    };
    if (r.adId)       add(byAd,  r.adId);
    if (r.adSetId)    add(byAs,  r.adSetId);
    if (r.campaignId) add(byCam, r.campaignId);
  }

  // 2. Enriched map for quality/fatigue
  const enrichedByAdId = {};
  for (const r of enrichedRows) enrichedByAdId[r.adId] = r;

  // 3. Candidate ad IDs = ads with spend OR ads in adMap that have a manual mapping
  const allAdIds = new Set([
    ...Object.keys(byAd),
    ...Object.keys(adMap).filter(id => manualMap[id]),
  ]);

  // 4. Build groups
  const groups = {};

  for (const adId of allAdIds) {
    const manual     = manualMap[adId] || {};
    const col        = manual.Collection || 'Unmapped';
    const adRec      = adMap[adId] || {};
    const asId       = adRec.adset_id   || byAd[adId]?._adSetId   || '';
    const camId      = adRec.campaign_id || byAd[adId]?._campaignId || '';
    const asRec      = adsetMap[asId]    || {};
    const camRec     = campaignMap[camId] || {};
    const adName     = adRec.name        || byAd[adId]?._adName   || adId;
    const asName     = asRec.name        || byAd[adId]?._adSetName || asId;
    const camName    = camRec.name       || byAd[adId]?._campName  || camId;
    const adStatus   = adRec.effective_status || adRec.status || '';

    if (!groups[col]) {
      groups[col] = {
        collection: col,
        spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0,
        dailyBudget: 0, lifetimeBudget: 0,
        campaigns: {}, adsets: {}, ads: [],
        _campB: new Set(), _asB: new Set(),
      };
    }
    const g = groups[col];

    // Spend metrics
    const pm = byAd[adId] || { spend:0, impressions:0, clicks:0, purchases:0, revenue:0, freqSum:0, n:1 };
    g.spend       += pm.spend;
    g.impressions += pm.impressions;
    g.clicks      += pm.clicks;
    g.purchases   += pm.purchases;
    g.revenue     += pm.revenue;

    // Budget — Meta returns minor currency units (paise for INR) → /100
    const campDB = parseInt(camRec.daily_budget    || 0);
    const campLB = parseInt(camRec.lifetime_budget || 0);
    const asDB   = parseInt(asRec.daily_budget     || 0);
    const asLB   = parseInt(asRec.lifetime_budget  || 0);

    if (camId && !g._campB.has(camId)) {
      g._campB.add(camId);
      if (campDB > 0) g.dailyBudget    += campDB / 100;
      if (campLB > 0) g.lifetimeBudget += campLB / 100;
    }
    if (asId && !g._asB.has(asId)) {
      g._asB.add(asId);
      // Only add adset budget if its parent campaign doesn't hold one (ABO)
      if (asDB > 0 && !campDB && !campLB) g.dailyBudget    += asDB / 100;
      if (asLB > 0 && !campDB && !campLB) g.lifetimeBudget += asLB / 100;
    }

    // Campaign entry (deduped)
    if (camId && !g.campaigns[camId]) {
      const cm = byCam[camId] || { spend:0, impressions:0, clicks:0, purchases:0, revenue:0 };
      g.campaigns[camId] = {
        id: camId, name: camName,
        status: camRec.effective_status || camRec.status || '',
        objective: camRec.objective || '',
        dailyBudget:    campDB / 100,
        lifetimeBudget: campLB / 100,
        spend: cm.spend, impressions: cm.impressions, clicks: cm.clicks,
        purchases: cm.purchases, revenue: cm.revenue,
      };
    }

    // Adset entry (deduped)
    if (asId && !g.adsets[asId]) {
      const am = byAs[asId] || { spend:0, impressions:0, clicks:0, purchases:0, revenue:0 };
      g.adsets[asId] = {
        id: asId, name: asName,
        campaignId: camId, campaignName: camName,
        status: asRec.effective_status || asRec.status || '',
        dailyBudget:    asDB / 100,
        lifetimeBudget: asLB / 100,
        spend: am.spend, impressions: am.impressions, clicks: am.clicks,
        purchases: am.purchases, revenue: am.revenue,
      };
    }

    // Enriched / fatigue data
    const en  = enrichedByAdId[adId] || {};
    const freq = pm.n > 0 ? pm.freqSum / pm.n : n(en.frequency);
    const ctr  = pm.impressions > 0 ? (pm.clicks / pm.impressions) * 100 : 0;
    const cpm  = pm.impressions > 0 ? (pm.spend  / pm.impressions) * 1000 : 0;
    const roas = pm.spend > 0 && pm.revenue > 0 ? pm.revenue / pm.spend : 0;

    let fatigueScore = 0;
    const signals = [];
    if (freq > 5)      { fatigueScore += 3; signals.push(`Freq ${freq.toFixed(1)}x — critical`); }
    else if (freq > 3) { fatigueScore += 2; signals.push(`Freq ${freq.toFixed(1)}x — high`); }
    else if (freq > 2) { fatigueScore += 1; signals.push(`Freq ${freq.toFixed(1)}x`); }

    const qr = en.qualityRanking    || '';
    const er = en.engagementRanking || '';
    const cr = en.conversionRanking || '';
    if (qr.includes('BELOW')) { fatigueScore += qr.includes('10') || qr.includes('20') ? 2 : 1; signals.push('Below-avg quality'); }
    if (er.includes('BELOW')) { fatigueScore += 1; signals.push('Below-avg engagement'); }
    if (cr.includes('BELOW')) { fatigueScore += 1; signals.push('Below-avg conversion'); }

    const trend = en.trendSignal || '';
    if (trend.includes('Fatigue / Worsening')) { fatigueScore += 3; signals.push('Fatigue + ROAS declining'); }
    else if (trend.includes('Fatigue'))         { fatigueScore += 2; signals.push('Fatigue risk'); }
    else if (trend.includes('Worsening'))       { fatigueScore += 1; signals.push('ROAS declining'); }

    const fatigueLevel = fatigueScore >= 5 ? 'critical' : fatigueScore >= 3 ? 'high' : fatigueScore >= 1 ? 'medium' : 'none';

    g.ads.push({
      id: adId, name: adName,
      adSetId: asId, adSetName: asName,
      campaignId: camId, campaignName: camName,
      status: adStatus,
      manual,
      spend: pm.spend, impressions: pm.impressions, clicks: pm.clicks,
      purchases: pm.purchases, revenue: pm.revenue,
      frequency: Math.round(freq * 10) / 10,
      ctr: Math.round(ctr * 100) / 100,
      cpm: Math.round(cpm),
      roas,
      fatigueScore, fatigueLevel, signals,
      trendSignal: en.trendSignal      || '',
      currentQuality: en.currentQuality || '',
      decision: en.decision            || '',
      qualityRanking:    qr,
      engagementRanking: er,
      conversionRanking: cr,
      audienceFamily: en.audienceFamily || '',
      creativeDominance: en.creativeDominance || '',
    });
  }

  // 5. Finalise
  return Object.values(groups).map(g => {
    delete g._campB; delete g._asB;
    const roas = g.spend > 0 && g.revenue > 0 ? g.revenue / g.spend : 0;
    const cpm  = g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0;
    const ctr  = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
    const expectedSpend = g.dailyBudget * periodDays;
    const pacing = expectedSpend > 0 ? (g.spend / expectedSpend) * 100 : null;
    const campaigns = Object.values(g.campaigns).sort((a, b) => b.spend - a.spend);
    const adsets    = Object.values(g.adsets).sort((a, b) => b.spend - a.spend);
    const ads       = g.ads.sort((a, b) => b.spend - a.spend);
    const highFatigueAds = ads.filter(a => a.fatigueLevel === 'critical' || a.fatigueLevel === 'high');
    const activeAds = ads.filter(a => a.status === 'ACTIVE').length;
    // Decision distribution
    const decisionDist = {};
    for (const a of ads) { if (a.decision) decisionDist[a.decision] = (decisionDist[a.decision] || 0) + 1; }
    return {
      ...g, roas, cpm, ctr, expectedSpend, pacing,
      campaigns, adsets, ads, highFatigueAds, activeAds, decisionDist,
    };
  }).sort((a, b) => b.spend - a.spend);
}

/* ─── SMALL UI ATOMS ─────────────────────────────────────────────── */
function Badge({ label, cls = '' }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ${cls}`}>{label}</span>;
}
function StatusBadge({ status }) {
  if (!status) return null;
  return <Badge label={status} cls={statusCls(status)} />;
}
function FatigueBadge({ level }) {
  if (level === 'none') return null;
  const labels = { critical: 'FATIGUE', high: 'HIGH FATIGUE', medium: 'FATIGUE RISK' };
  return <Badge label={labels[level] || level.toUpperCase()} cls={fatigueCls(level) + ' ring-0'} />;
}
function Chip({ label, value, cls = '' }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2 text-center">
      <div className="text-[10px] text-slate-500 leading-none mb-1">{label}</div>
      <div className={`text-sm font-semibold ${cls || 'text-white'}`}>{value}</div>
    </div>
  );
}

/* ─── PACING BAR ─────────────────────────────────────────────────── */
function PacingBar({ spend, expectedSpend, pacing }) {
  if (!expectedSpend) return null;
  const pct = Math.min(pacing || 0, 140);
  const cls = pacing > 110 ? 'bg-red-500' : pacing > 90 ? 'bg-emerald-500' : pacing > 70 ? 'bg-amber-400' : 'bg-blue-500';
  const label = pacing > 110 ? 'Over-pacing' : pacing > 90 ? 'On track' : pacing > 60 ? 'Under-pacing' : 'Under-delivering';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-500">Spend vs Budget</span>
        <span className="text-slate-400">{fmt(spend)} / {fmt(expectedSpend)} · {fmtPct(pacing)}</span>
      </div>
      <div className="h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct / 1.4}%` }} />
      </div>
      <div className={`text-[9px] ${cls.replace('bg-', 'text-')}`}>{label}</div>
    </div>
  );
}

/* ─── ENTITY TABLE ───────────────────────────────────────────────── */
function EntityTable({ rows, type }) {
  const cols = {
    campaigns: [
      { key: 'name',           label: 'Campaign',     wide: true, render: r => r.name },
      { key: 'status',         label: 'Status',       render: r => <StatusBadge status={r.status} /> },
      { key: 'objective',      label: 'Objective',    render: r => <span className="text-slate-500 text-[11px]">{(r.objective||'').replace(/_/g,' ')}</span> },
      { key: 'budget',         label: 'Daily Budget', num: true, render: r => r.dailyBudget ? fmt(r.dailyBudget) : (r.lifetimeBudget ? fmt(r.lifetimeBudget) + ' LT' : '—') },
      { key: 'spend',          label: 'Spend',        num: true, render: r => fmt(r.spend) },
      { key: 'impressions',    label: 'Impr.',        num: true, render: r => fmtN(r.impressions) },
      { key: 'clicks',         label: 'Clicks',       num: true, render: r => fmtN(r.clicks) },
      { key: 'purchases',      label: 'Purch.',       num: true, render: r => fmtN(r.purchases) },
      { key: 'revenue',        label: 'Revenue',      num: true, cls: () => 'text-emerald-400', render: r => fmt(r.revenue) },
      { key: 'roas',           label: 'ROAS',         num: true, cls: r => roasCls(r.revenue, r.spend), render: r => fmtR(r.revenue, r.spend) },
    ],
    adsets: [
      { key: 'name',           label: 'Ad Set',       wide: true, render: r => r.name },
      { key: 'campaignName',   label: 'Campaign',     sub: true, render: r => r.campaignName },
      { key: 'status',         label: 'Status',       render: r => <StatusBadge status={r.status} /> },
      { key: 'budget',         label: 'Budget/day',   num: true, render: r => r.dailyBudget ? fmt(r.dailyBudget) : (r.lifetimeBudget ? fmt(r.lifetimeBudget) + ' LT' : '—') },
      { key: 'spend',          label: 'Spend',        num: true, render: r => fmt(r.spend) },
      { key: 'impressions',    label: 'Impr.',        num: true, render: r => fmtN(r.impressions) },
      { key: 'clicks',         label: 'Clicks',       num: true, render: r => fmtN(r.clicks) },
      { key: 'purchases',      label: 'Purch.',       num: true, render: r => fmtN(r.purchases) },
      { key: 'revenue',        label: 'Revenue',      num: true, cls: () => 'text-emerald-400', render: r => fmt(r.revenue) },
      { key: 'roas',           label: 'ROAS',         num: true, cls: r => roasCls(r.revenue, r.spend), render: r => fmtR(r.revenue, r.spend) },
    ],
    ads: [
      { key: 'name',           label: 'Ad',           wide: true, render: r => <div><div className="font-medium text-white">{r.name}</div><div className="text-[10px] text-slate-500 truncate max-w-[180px]">{r.adSetName}</div></div> },
      { key: 'status',         label: 'Status',       render: r => <StatusBadge status={r.status} /> },
      { key: 'fatigue',        label: 'Fatigue',      render: r => <FatigueBadge level={r.fatigueLevel} /> },
      { key: 'spend',          label: 'Spend',        num: true, render: r => fmt(r.spend) },
      { key: 'impressions',    label: 'Impr.',        num: true, render: r => fmtN(r.impressions) },
      { key: 'freq',           label: 'Freq',         num: true, cls: r => r.frequency > 4 ? 'text-red-400' : r.frequency > 2.5 ? 'text-amber-400' : '', render: r => r.frequency || '—' },
      { key: 'ctr',            label: 'CTR%',         num: true, render: r => r.ctr ? r.ctr.toFixed(2) + '%' : '—' },
      { key: 'cpm',            label: 'CPM',          num: true, render: r => r.cpm ? '₹' + r.cpm : '—' },
      { key: 'purchases',      label: 'Purch.',       num: true, render: r => fmtN(r.purchases) },
      { key: 'revenue',        label: 'Revenue',      num: true, cls: () => 'text-emerald-400', render: r => fmt(r.revenue) },
      { key: 'roas',           label: 'ROAS',         num: true, cls: r => roasCls(r.revenue, r.spend), render: r => fmtR(r.revenue, r.spend) },
    ],
  }[type] || [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700/40">
            {cols.map(c => (
              <th key={c.key}
                className={`py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap
                  ${c.num ? 'text-right' : 'text-left'}
                  ${c.wide ? 'min-w-[180px]' : ''}
                  ${c.sub ? 'min-w-[120px]' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-gray-800/30 hover:bg-white/[0.02]">
              {cols.map(c => (
                <td key={c.key}
                  className={`py-2 px-3
                    ${c.num ? 'text-right font-mono' : 'text-left'}
                    ${c.sub ? 'text-slate-500 text-[11px]' : 'text-gray-300'}
                    ${c.cls ? c.cls(row) : ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="py-6 text-center text-slate-600 text-xs">No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ─── FATIGUE TABLE ──────────────────────────────────────────────── */
const FATIGUE_ACTION = {
  critical: 'Pause and replace creative immediately',
  high:     'Refresh creative this week; reduce budget',
  medium:   'Monitor closely; prepare fresh variations',
  none:     'Healthy — no action needed',
};
function FatigueTable({ ads }) {
  const sorted = [...ads].filter(a => a.fatigueLevel !== 'none').sort((a, b) => b.fatigueScore - a.fatigueScore);
  if (!sorted.length) return (
    <div className="py-8 text-center text-slate-500 text-sm">No fatigue detected in this collection</div>
  );
  return (
    <div className="space-y-2 p-2">
      {sorted.map(ad => (
        <div key={ad.id} className={`rounded-xl border p-4 ${
          ad.fatigueLevel === 'critical' ? 'border-red-700/40 bg-red-900/10'
          : ad.fatigueLevel === 'high'   ? 'border-orange-700/40 bg-orange-900/10'
          : 'border-amber-700/40 bg-amber-900/10'
        }`}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <div className="font-medium text-white text-sm truncate">{ad.name}</div>
              <div className="text-[11px] text-slate-500">{ad.adSetName} · {ad.campaignName}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <FatigueBadge level={ad.fatigueLevel} />
              <span className="text-[11px] text-slate-500">Score {ad.fatigueScore}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {ad.signals.map((s, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-gray-800 text-slate-400 text-[10px]">{s}</span>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {[
              { l: 'Frequency',  v: ad.frequency || '—' },
              { l: 'ROAS',       v: fmtR(ad.revenue, ad.spend) },
              { l: 'Spend',      v: fmt(ad.spend) },
              { l: 'Trend',      v: ad.trendSignal || '—' },
            ].map(m => (
              <div key={m.l} className="bg-gray-800/50 rounded-lg px-2 py-1.5">
                <div className="text-[9px] text-slate-500">{m.l}</div>
                <div className="text-xs font-medium text-white">{m.v}</div>
              </div>
            ))}
          </div>
          {ad.qualityRanking || ad.engagementRanking ? (
            <div className="flex gap-2 flex-wrap mb-2">
              {[
                { l: 'Quality',    v: ad.qualityRanking },
                { l: 'Engagement', v: ad.engagementRanking },
                { l: 'Conversion', v: ad.conversionRanking },
              ].filter(m => m.v).map(m => (
                <span key={m.l} className={`text-[10px] px-2 py-0.5 rounded ${m.v.includes('BELOW') ? 'bg-red-900/30 text-red-400' : 'bg-emerald-900/30 text-emerald-400'}`}>
                  {m.l}: {m.v.replace(/_/g,' ')}
                </span>
              ))}
            </div>
          ) : null}
          <div className={`text-[11px] flex items-center gap-1 ${
            ad.fatigueLevel === 'critical' ? 'text-red-400' : ad.fatigueLevel === 'high' ? 'text-orange-400' : 'text-amber-400'
          }`}>
            <AlertTriangle size={10} />
            {FATIGUE_ACTION[ad.fatigueLevel]}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── OVERVIEW TAB ───────────────────────────────────────────────── */
function OverviewTab({ g, periodDays }) {
  const cpa = g.purchases > 0 ? g.spend / g.purchases : 0;
  const kpis = [
    { l: 'Spend',      v: fmt(g.spend),              c: 'text-white' },
    { l: 'Revenue',    v: fmt(g.revenue),             c: 'text-emerald-400' },
    { l: 'ROAS',       v: fmtR(g.revenue, g.spend),  c: roasCls(g.revenue, g.spend) },
    { l: 'Impressions',v: fmtN(g.impressions),        c: 'text-gray-300' },
    { l: 'Clicks',     v: fmtN(g.clicks),             c: 'text-gray-300' },
    { l: 'Purchases',  v: fmtN(g.purchases),          c: 'text-gray-300' },
    { l: 'CTR',        v: g.ctr ? g.ctr.toFixed(2) + '%' : '—', c: 'text-gray-300' },
    { l: 'CPM',        v: g.cpm ? fmt(g.cpm) : '—',   c: 'text-gray-300' },
    { l: 'CPA',        v: fmt(cpa),                    c: cpa > 0 && cpa < 200 ? 'text-emerald-400' : 'text-amber-400' },
    { l: 'Daily Budget', v: g.dailyBudget ? fmt(g.dailyBudget) : '—', c: 'text-blue-300' },
    { l: 'Period Budget',v: g.expectedSpend ? fmt(g.expectedSpend) : '—', c: 'text-blue-300' },
    { l: 'Pacing',     v: g.pacing != null ? fmtPct(g.pacing) : '—',
      c: g.pacing > 110 ? 'text-red-400' : g.pacing > 85 ? 'text-emerald-400' : 'text-amber-400' },
  ];

  const topAds  = g.ads.filter(a => a.spend > 0).slice(0, 3);
  const wrstAds = [...g.ads.filter(a => a.spend > 50)].sort((a, b) => (a.revenue/a.spend||0) - (b.revenue/b.spend||0)).slice(0, 3);

  // Decision dist
  const decEntries = Object.entries(g.decisionDist).sort((a, b) => b[1] - a[1]);

  // Audience breakdown
  const audDist = {};
  for (const a of g.ads) { if (a.audienceFamily) audDist[a.audienceFamily] = (audDist[a.audienceFamily] || 0) + 1; }

  return (
    <div className="p-4 space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {kpis.map(k => <Chip key={k.l} label={k.l} value={k.v} cls={k.c} />)}
      </div>

      {/* Budget pacing */}
      {g.expectedSpend > 0 && (
        <div className="bg-gray-800/30 rounded-xl border border-gray-700/40 p-4">
          <PacingBar spend={g.spend} expectedSpend={g.expectedSpend} pacing={g.pacing} />
        </div>
      )}

      {/* Decision + Audience splits */}
      <div className="grid grid-cols-2 gap-3">
        {decEntries.length > 0 && (
          <div className="bg-gray-800/30 rounded-xl border border-gray-700/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
              <Target size={10} /> Decision Distribution
            </div>
            <div className="space-y-1">
              {decEntries.slice(0, 6).map(([dec, cnt]) => (
                <div key={dec} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{dec}</span>
                  <span className="text-slate-500">{cnt} ads</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {Object.keys(audDist).length > 0 && (
          <div className="bg-gray-800/30 rounded-xl border border-gray-700/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
              <Zap size={10} /> Audience Split
            </div>
            <div className="space-y-1">
              {Object.entries(audDist).sort((a, b) => b[1] - a[1]).map(([aud, cnt]) => (
                <div key={aud} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{aud}</span>
                  <span className="text-slate-500">{cnt} ads</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top / worst ads */}
      {(topAds.length > 0 || wrstAds.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {topAds.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2 flex items-center gap-1">
                <TrendingUp size={10} /> Top Ads by Spend
              </div>
              {topAds.map(a => (
                <div key={a.id} className="flex items-center justify-between py-1 border-b border-gray-700/30 last:border-0 text-xs">
                  <span className="text-slate-300 truncate max-w-[130px]">{a.name}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-1">
                    <span className="text-white font-medium">{fmt(a.spend)}</span>
                    <span className={roasCls(a.revenue, a.spend)}>{fmtR(a.revenue, a.spend)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {wrstAds.length > 0 && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-red-600 mb-2 flex items-center gap-1">
                <AlertTriangle size={10} /> Worst ROAS
              </div>
              {wrstAds.map(a => (
                <div key={a.id} className="flex items-center justify-between py-1 border-b border-gray-700/30 last:border-0 text-xs">
                  <span className="text-slate-300 truncate max-w-[130px]">{a.name}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-1">
                    <span className="text-white font-medium">{fmt(a.spend)}</span>
                    <span className={roasCls(a.revenue, a.spend)}>{fmtR(a.revenue, a.spend)}</span>
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

/* ─── COLLECTION CARD ────────────────────────────────────────────── */
function CollectionCard({ g, totalSpend, periodDays }) {
  const [open, setOpen]     = useState(false);
  const [subTab, setSubTab] = useState('overview');
  const pct   = totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0;
  const tabs  = [
    { id: 'overview',  label: 'Overview',     icon: BarChart3 },
    { id: 'campaigns', label: `Campaigns`,    count: g.campaigns.length },
    { id: 'adsets',    label: `Ad Sets`,      count: g.adsets.length },
    { id: 'ads',       label: `Ads`,          count: g.ads.length },
    { id: 'fatigue',   label: `Fatigue`,      count: g.highFatigueAds.length,
      warn: g.highFatigueAds.length > 0 },
  ];

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      open ? 'border-gray-700/80' : 'border-gray-800/60 hover:border-gray-700/60'
    }`}>
      {/* Clickable header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gray-900/50 hover:bg-gray-800/40 transition-colors text-left"
      >
        <span className="text-slate-500 shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Name + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{g.collection}</span>
            {g.highFatigueAds.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-orange-400">
                <Flame size={10} />{g.highFatigueAds.length} fatigued
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 max-w-[180px]">
            <div className="flex-1 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
            <span className="text-[10px] text-slate-500 shrink-0">{pct.toFixed(1)}%</span>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="hidden sm:flex items-center gap-4 shrink-0">
          {[
            { l: 'Spend',    v: fmt(g.spend),          c: 'text-white font-semibold text-sm' },
            { l: 'Budget/d', v: g.dailyBudget ? fmt(g.dailyBudget) : '—', c: 'text-blue-300 text-sm' },
            { l: 'Pacing',   v: g.pacing != null ? fmtPct(g.pacing) : '—',
              c: (g.pacing > 110 ? 'text-red-400' : g.pacing > 85 ? 'text-emerald-400' : 'text-amber-400') + ' text-sm' },
            { l: 'Revenue',  v: fmt(g.revenue),         c: 'text-emerald-400 text-sm' },
            { l: 'ROAS',     v: fmtR(g.revenue, g.spend), c: roasCls(g.revenue, g.spend) + ' text-sm font-bold' },
            { l: 'Active Ads', v: g.activeAds + ' / ' + g.ads.length, c: 'text-gray-300 text-sm' },
          ].map(m => (
            <div key={m.l} className="text-right min-w-[60px]">
              <div className="text-[9px] text-slate-500 leading-none mb-1">{m.l}</div>
              <div className={m.c}>{m.v}</div>
            </div>
          ))}
        </div>

        {/* Mobile compact */}
        <div className="flex sm:hidden items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[9px] text-slate-500">Spend</div>
            <div className="text-sm font-semibold text-white">{fmt(g.spend)}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-slate-500">ROAS</div>
            <div className={`text-sm font-bold ${roasCls(g.revenue, g.spend)}`}>{fmtR(g.revenue, g.spend)}</div>
          </div>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/40">
          {/* Sub-tabs */}
          <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors whitespace-nowrap border-b-2
                    ${subTab === t.id
                      ? 'bg-gray-800/60 text-white border-brand-500'
                      : 'text-slate-500 hover:text-slate-300 border-transparent hover:bg-gray-800/30'
                    } ${t.warn ? 'text-orange-400' : ''}`}
                >
                  {Icon && <Icon size={11} />}
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

          {/* Tab content */}
          <div className="border-t border-gray-800/50">
            {subTab === 'overview'  && <OverviewTab g={g} periodDays={periodDays} />}
            {subTab === 'campaigns' && <div className="px-1 py-1"><EntityTable rows={g.campaigns} type="campaigns" /></div>}
            {subTab === 'adsets'    && <div className="px-1 py-1"><EntityTable rows={g.adsets} type="adsets" /></div>}
            {subTab === 'ads'       && <div className="px-1 py-1"><EntityTable rows={g.ads} type="ads" /></div>}
            {subTab === 'fatigue'   && <FatigueTable ads={g.ads} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────── */
export default function CollectionSpend() {
  const { rawAccounts, enrichedRows, manualMap, campaignMap, adsetMap, adMap, brands, activeBrandIds } = useStore();

  const [period, setPeriod]           = useState('7d');
  const [rows3d, setRows3d]           = useState([]);
  const [fetch3dStatus, setFetch3dStatus] = useState('idle');
  const [fetch3dMsg, setFetch3dMsg]   = useState('');
  const [sortBy, setSortBy]           = useState('spend');

  /* ── fetch 3D on demand ── */
  const fetchRows3d = useCallback(async () => {
    setFetch3dStatus('loading');
    setFetch3dMsg('Connecting...');
    const collected = [];
    const active = (brands || []).filter(b => (activeBrandIds || []).includes(b.id));
    try {
      for (const brand of active) {
        const { token, apiVersion = 'v21.0', accounts = [] } = brand.meta || {};
        if (!token) continue;
        for (const acc of accounts) {
          if (!acc.id || !acc.key) continue;
          setFetch3dMsg(`Fetching ${acc.key}...`);
          const raw = await fetchInsights(apiVersion, token, acc.id, 'last_3d');
          collected.push(...raw.map(r => normalizeInsight(r, acc.key, '3D')));
        }
      }
      setRows3d(collected);
      setFetch3dStatus('done');
      setFetch3dMsg('');
    } catch (e) {
      setFetch3dStatus('error');
      setFetch3dMsg(e.message);
    }
  }, [brands, activeBrandIds]);

  function handlePeriod(id) {
    setPeriod(id);
    if (id === '3d' && fetch3dStatus === 'idle') fetchRows3d();
  }

  /* ── period rows ── */
  const periodDays = PERIODS.find(p => p.id === period)?.days || 7;
  const periodRows = useMemo(() => {
    if (period === '3d')        return rows3d;
    if (period === 'yesterday') return rawAccounts.flatMap(a => a.insightsToday || []);
    if (period === '7d')        return rawAccounts.flatMap(a => a.insights7d    || []);
    if (period === '14d')       return rawAccounts.flatMap(a => a.insights14d   || []);
    return [];
  }, [period, rawAccounts, rows3d]);

  /* ── build collection groups ── */
  const groups = useMemo(
    () => buildCollectionGroups(periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodDays),
    [periodRows, enrichedRows, manualMap, campaignMap, adsetMap, adMap, periodDays],
  );

  /* ── sort ── */
  const sorted = useMemo(() => {
    const arr = [...groups];
    if (sortBy === 'budget')  return arr.sort((a, b) => b.dailyBudget - a.dailyBudget);
    if (sortBy === 'roas')    return arr.sort((a, b) => b.roas - a.roas);
    if (sortBy === 'fatigue') return arr.sort((a, b) => b.highFatigueAds.length - a.highFatigueAds.length);
    if (sortBy === 'name')    return arr.sort((a, b) => a.collection.localeCompare(b.collection));
    return arr; // default: spend (already sorted)
  }, [groups, sortBy]);

  /* ── totals ── */
  const totals = useMemo(() => ({
    spend:         groups.reduce((s, g) => s + g.spend, 0),
    revenue:       groups.reduce((s, g) => s + g.revenue, 0),
    purchases:     groups.reduce((s, g) => s + g.purchases, 0),
    impressions:   groups.reduce((s, g) => s + g.impressions, 0),
    dailyBudget:   groups.reduce((s, g) => s + g.dailyBudget, 0),
    expectedSpend: groups.reduce((s, g) => s + g.expectedSpend, 0),
    highFatigue:   groups.reduce((s, g) => s + g.highFatigueAds.length, 0),
    activeAds:     groups.reduce((s, g) => s + g.activeAds, 0),
    totalAds:      groups.reduce((s, g) => s + g.ads.length, 0),
  }), [groups]);

  const periodName = { yesterday:'Yesterday', '3d':'Last 3 Days', '7d':'Last 7 Days', '14d':'Last 14 Days' }[period];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp size={20} className="text-brand-400" />
            Collection Spend
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Full spend, budget & creative health by collection — {periodName}
          </p>
        </div>
        {/* Sort */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-slate-500">Sort</span>
          {[
            { id: 'spend', l: 'Spend' },
            { id: 'budget', l: 'Budget' },
            { id: 'roas', l: 'ROAS' },
            { id: 'fatigue', l: 'Fatigue' },
            { id: 'name', l: 'A–Z' },
          ].map(s => (
            <button key={s.id} onClick={() => setSortBy(s.id)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors
                ${sortBy === s.id ? 'bg-brand-600/20 text-brand-300' : 'text-slate-500 hover:text-slate-300'}`}>
              {s.l}
            </button>
          ))}
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => handlePeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              period === p.id
                ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30'
                : 'bg-gray-800/50 text-slate-400 hover:text-slate-200 hover:bg-gray-800'
            }`}>
            {p.label}
            {p.lazy && fetch3dStatus === 'loading' && period === p.id && <Loader2 size={11} className="animate-spin" />}
          </button>
        ))}
        {period === '3d' && fetch3dStatus === 'done' && (
          <button onClick={fetchRows3d} className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-200 hover:bg-gray-800 flex items-center gap-1.5">
            <RefreshCw size={11} /> Refresh 3D
          </button>
        )}
      </div>

      {/* 3D status */}
      {period === '3d' && fetch3dStatus === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-400 bg-gray-800/40 rounded-xl border border-gray-700/30 px-4 py-3">
          <Loader2 size={14} className="animate-spin text-brand-400 shrink-0" />
          {fetch3dMsg}
        </div>
      )}
      {period === '3d' && fetch3dStatus === 'error' && (
        <div className="flex items-center gap-3 bg-red-900/20 border border-red-800/30 rounded-xl px-4 py-3">
          <span className="text-red-400 text-sm flex-1">{fetch3dMsg}</span>
          <button onClick={fetchRows3d} className="text-xs text-red-300 underline shrink-0">Retry</button>
        </div>
      )}

      {/* Summary KPIs */}
      {groups.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { l: 'Total Spend',    v: fmt(totals.spend),       c: 'text-white' },
            { l: 'Total Budget/d', v: totals.dailyBudget ? fmt(totals.dailyBudget) : '—', c: 'text-blue-300' },
            { l: 'Period Budget',  v: totals.expectedSpend ? fmt(totals.expectedSpend) : '—', c: 'text-blue-300' },
            { l: 'Pacing',        v: totals.expectedSpend ? fmtPct(totals.spend / totals.expectedSpend * 100) : '—',
              c: totals.expectedSpend && totals.spend / totals.expectedSpend > 1.1 ? 'text-red-400'
               : totals.expectedSpend && totals.spend / totals.expectedSpend > 0.85 ? 'text-emerald-400' : 'text-amber-400' },
            { l: 'Total Revenue',  v: fmt(totals.revenue),     c: 'text-emerald-400' },
            { l: 'Overall ROAS',   v: fmtR(totals.revenue, totals.spend), c: roasCls(totals.revenue, totals.spend) },
            { l: 'Active Ads',     v: `${totals.activeAds} / ${totals.totalAds}`, c: 'text-gray-300' },
            { l: 'Fatigued Ads',  v: String(totals.highFatigue), c: totals.highFatigue > 0 ? 'text-orange-400' : 'text-slate-500' },
          ].map(k => (
            <div key={k.l} className="bg-gray-900/60 rounded-xl border border-gray-800/50 px-3 py-3">
              <div className="text-[10px] text-slate-500 mb-1 leading-none">{k.l}</div>
              <div className={`text-lg font-bold ${k.c}`}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Fatigue alert */}
      {totals.highFatigue > 0 && (
        <div className="flex items-center gap-3 bg-orange-900/20 border border-orange-700/30 rounded-xl px-4 py-3">
          <Flame size={16} className="text-orange-400 shrink-0" />
          <span className="text-sm text-orange-300">
            <strong>{totals.highFatigue} ads</strong> show high creative fatigue across {groups.filter(g => g.highFatigueAds.length > 0).length} collections.
            Expand each collection and open the <strong>Fatigue</strong> tab for details.
          </span>
        </div>
      )}

      {/* Empty state */}
      {groups.length === 0 && fetch3dStatus !== 'loading' && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 border border-gray-800/40 rounded-2xl bg-gray-900/20">
          <Shield size={40} className="mb-3 opacity-20" />
          <div className="text-sm font-medium">No data for {periodName}</div>
          <div className="text-xs mt-1 opacity-60 text-center max-w-xs">
            {period === '3d' && fetch3dStatus === 'idle'
              ? 'Click the Last 3D tab to fetch data from Meta.'
              : 'Fetch Meta data from Setup, then assign collections to ads via the manual map.'}
          </div>
        </div>
      )}

      {/* Collection cards */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map(g => (
            <CollectionCard key={g.collection} g={g} totalSpend={totals.spend} periodDays={periodDays} />
          ))}
        </div>
      )}
    </div>
  );
}
