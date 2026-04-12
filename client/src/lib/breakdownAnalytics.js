import { normalizeInsight, aggregateMetrics, safeNum, safeText, median } from './analytics';

export function normalizeBreakdownRow(r) {
  const base = normalizeInsight(r, r.__accountKey, r.__window);
  // Hourly breakdown field — Meta returns e.g. "14" (hour 0-23)
  const rawHourAdv = safeText(r.hourly_stats_aggregated_by_advertiser_time_zone);
  const rawHourAud = safeText(r.hourly_stats_aggregated_by_audience_time_zone);
  return {
    ...base,
    bdKey:      r.__bdKey,
    bdAge:      safeText(r.age),
    bdGender:   safeText(r.gender),
    bdPlatform: safeText(r.publisher_platform),
    bdPosition: safeText(r.platform_position),
    bdDevice:   safeText(r.impression_device),
    bdCountry:  safeText(r.country),
    bdRegion:   safeText(r.region),
    bdHourAdv:  rawHourAdv,
    bdHourAud:  rawHourAud,
    // numeric hour for sorting
    bdHourAdvN: rawHourAdv ? parseInt(rawHourAdv, 10) : null,
    bdHourAudN: rawHourAud ? parseInt(rawHourAud, 10) : null,
  };
}

export function buildDimSummary(rows, dimField) {
  const groups = {};
  rows.forEach(r => {
    const k = safeText(r[dimField]) || 'Unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  return Object.entries(groups)
    .map(([label, items]) => {
      const agg = aggregateMetrics(items) || {};
      return {
        label,
        count: items.length,
        spend: agg.spend || 0,
        roas: agg.roas || 0,
        cpr: agg.cpr || 0,
        purchases: agg.purchases || 0,
        revenue: agg.revenue || 0,
        impressions: agg.impressions || 0,
        cpm: agg.cpm || 0,
        convRate: agg.convRate || 0,
        ...agg,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export function computeHealthBand(value, accountMedian, higherIsBetter) {
  if (!accountMedian || accountMedian === 0) return 'normal';
  const ratio = value / accountMedian;
  if (higherIsBetter) {
    if (ratio >= 1.3)  return 'strong';
    if (ratio >= 0.85) return 'normal';
    if (ratio >= 0.6)  return 'weak';
    return 'bad';
  } else {
    if (ratio <= 0.7)  return 'strong';
    if (ratio <= 1.15) return 'normal';
    if (ratio <= 1.5)  return 'weak';
    return 'bad';
  }
}

export function buildAdsetSummary(baseRows) {
  const groups = {};
  baseRows.forEach(r => {
    const k = r.adSetId || 'unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const byAccount = {};
  baseRows.forEach(r => {
    const k = r.accountKey || r.accountId;
    if (!byAccount[k]) byAccount[k] = [];
    byAccount[k].push(r);
  });

  const accountAdsetMetrics = {};
  Object.entries(byAccount).forEach(([acct, rows]) => {
    const adsetGroups = {};
    rows.forEach(r => {
      const k = r.adSetId || 'unknown';
      if (!adsetGroups[k]) adsetGroups[k] = [];
      adsetGroups[k].push(r);
    });
    const adsetAggs = Object.values(adsetGroups).map(items => aggregateMetrics(items)).filter(Boolean);
    accountAdsetMetrics[acct] = {
      medRoas: median(adsetAggs.map(a => a.roas).filter(v => v > 0)),
      medCpr:  median(adsetAggs.map(a => a.cpr).filter(v => v > 0)),
    };
  });

  return Object.entries(groups)
    .map(([adsetId, items]) => {
      const agg = aggregateMetrics(items) || {};
      const first = items[0] || {};
      const acctKey = first.accountKey || first.accountId;
      const med = accountAdsetMetrics[acctKey] || { medRoas: 0, medCpr: 0 };

      const roasHealth = computeHealthBand(agg.roas || 0, med.medRoas, true);
      const cprHealth  = computeHealthBand(agg.cpr  || 0, med.medCpr,  false);

      const spend = agg.spend || 0;
      const roas  = agg.roas  || 0;
      const cpr   = agg.cpr   || 0;
      const medCpr = med.medCpr || 0;

      let recommendation;
      if (spend < 100) {
        recommendation = 'Watch';
      } else if (roas < 1.5 && spend > 300) {
        recommendation = 'Kill';
      } else if (roas >= 5 && cpr < medCpr * 0.7) {
        recommendation = 'Scale Hard';
      } else if (roas >= 4) {
        recommendation = 'Scale';
      } else if (roasHealth === 'bad' || cprHealth === 'bad') {
        recommendation = 'Fix';
      } else if (roas >= 3 && (roasHealth === 'weak' || cprHealth === 'weak')) {
        recommendation = 'Defend';
      } else {
        recommendation = 'Watch';
      }

      return {
        adsetId,
        adSetName:   first.adSetName || adsetId,
        campaignId:  first.campaignId || '',
        campaignName: first.campaignName || '',
        accountKey:  acctKey,
        adCount:     items.length,
        spend:       agg.spend || 0,
        roas:        agg.roas  || 0,
        cpr:         agg.cpr   || 0,
        purchases:   agg.purchases || 0,
        revenue:     agg.revenue   || 0,
        impressions: agg.impressions || 0,
        cpm:         agg.cpm || 0,
        convRate:    agg.convRate || 0,
        accountMedianRoas: med.medRoas,
        accountMedianCpr:  med.medCpr,
        roasHealth,
        cprHealth,
        recommendation,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export function buildQuickWins(dimSummaries) {
  const wins = [];

  const addWin = (type, icon, message, impact = 'medium') => {
    wins.push({ type, icon, message, impact });
  };

  const { age, gender, platform, device, country } = dimSummaries;

  if (age?.length >= 2) {
    const best  = [...age].sort((a, b) => b.roas - a.roas)[0];
    const worst = [...age].sort((a, b) => a.roas - b.roas)[0];
    if (best && best.roas > 0) {
      addWin('age', 'Users', `Age ${best.label} leads with ${best.roas.toFixed(2)}x ROAS — prioritize budget here.`, 'high');
    }
    if (worst && worst.label !== best?.label && worst.roas < 1.5 && worst.spend > 100) {
      addWin('age', 'AlertTriangle', `Age ${worst.label} is underperforming at ${worst.roas.toFixed(2)}x ROAS with ₹${Math.round(worst.spend)} spend — consider exclusion.`, 'high');
    }
  }

  if (gender?.length >= 2) {
    const best = [...gender].sort((a, b) => b.roas - a.roas)[0];
    const worst = [...gender].sort((a, b) => a.roas - b.roas)[0];
    if (best && worst && best.label !== worst.label) {
      const gap = best.roas - worst.roas;
      if (gap > 1) {
        addWin('gender', 'Users', `${best.label} converts ${gap.toFixed(1)}x better than ${worst.label} — reallocate creative messaging.`, 'high');
      }
    }
  }

  if (platform?.length >= 1) {
    const best = [...platform].sort((a, b) => b.roas - a.roas)[0];
    if (best && best.roas >= 4) {
      addWin('platform', 'Monitor', `${best.label} is your strongest platform at ${best.roas.toFixed(2)}x ROAS — scale spend here.`, 'high');
    }
    const weak = platform.filter(p => p.roas < 1.5 && p.spend > 200);
    weak.forEach(p => {
      addWin('platform', 'AlertTriangle', `${p.label} is burning ₹${Math.round(p.spend)} at only ${p.roas.toFixed(2)}x ROAS — review or pause.`, 'medium');
    });
  }

  if (device?.length >= 2) {
    const best = [...device].sort((a, b) => b.roas - a.roas)[0];
    const worst = [...device].sort((a, b) => a.roas - b.roas)[0];
    if (best && worst && best.label !== worst.label && best.roas - worst.roas > 1.5) {
      addWin('device', 'Monitor', `${best.label} outperforms ${worst.label} by ${(best.roas - worst.roas).toFixed(1)}x ROAS — optimize creatives for ${best.label}.`, 'medium');
    }
  }

  if (country?.length >= 2) {
    const topByRoas = [...country].filter(c => c.spend > 100).sort((a, b) => b.roas - a.roas).slice(0, 3);
    if (topByRoas.length > 0) {
      addWin('country', 'Globe', `Top countries by ROAS: ${topByRoas.map(c => `${c.label} (${c.roas.toFixed(1)}x)`).join(', ')}.`, 'medium');
    }
    const lowPerf = country.filter(c => c.roas < 1.5 && c.spend > 300);
    lowPerf.slice(0, 2).forEach(c => {
      addWin('country', 'AlertTriangle', `${c.label} is spending ₹${Math.round(c.spend)} at ${c.roas.toFixed(2)}x ROAS — consider geo exclusion.`, 'high');
    });
  }

  return wins;
}
