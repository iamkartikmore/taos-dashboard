import { useMemo } from 'react';
import { useStore } from '../store';
import { buildCrossMatrix, topValuesBy, skuQuadrantMap } from '../lib/crossPatterns';
import { buildStarProducts } from '../lib/starProducts';

const cur = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const num = v => (Number(v) || 0).toLocaleString('en-IN');

function truncate(s, n = 20) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/* ─── Adaptive color scale for ROAS ──────────────────────────
   Compute the distribution of ROAS across this heatmap's cells
   (mean, median, mode, stdev, quartiles) and color each cell by
   where it lands *within that distribution*, not against fixed
   1x/2x thresholds. That way a heatmap where everything is 3-8x
   shows a real spread of reds/ambers/greens — the weakest 3x
   cell isn't coloured the same as the strongest 8x cell.

   Hard floor: ROAS < 1 is always red-ish (you're losing money,
   regardless of how badly the rest of the matrix is doing). */
function buildRoasDistribution(matrix) {
  const values = [];
  for (const key in matrix) {
    const cell = matrix[key];
    if (!cell || cell.belowThreshold) continue;
    if (!Number.isFinite(cell.roas) || cell.roas <= 0) continue;
    values.push(cell.roas);
  }
  const n = values.length;
  if (n < 4) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  const q = p => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  };

  // Mode via 0.25x-wide bins (ROAS is continuous — a true mode is useless)
  const bins = new Map();
  for (const v of values) {
    const bin = Math.round(v * 4) / 4;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }
  let mode = mean, modeCount = 0;
  for (const [k, c] of bins) if (c > modeCount) { mode = k; modeCount = c; }

  // Percentile lookup for a given roas (used in tooltip)
  const percentileOf = v => {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    return lo / n;
  };

  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    stdev,
    median: q(0.5),
    mode,
    p10: q(0.10),
    p25: q(0.25),
    p75: q(0.75),
    p90: q(0.90),
    percentileOf,
  };
}

function adaptiveRoasColor(roas, belowThreshold, dist) {
  if (belowThreshold) return { bg: 'rgba(55,65,81,0.3)', fg: '#475569' };
  if (!Number.isFinite(roas) || roas <= 0) return { bg: 'rgba(239,68,68,0.2)', fg: '#f87171' };

  // Hard floor — below breakeven is always red, regardless of the group
  if (roas < 1) {
    const intensity = 0.35 + Math.min(0.5, (1 - roas) * 0.5);
    return { bg: `rgba(239,68,68,${intensity.toFixed(2)})`, fg: '#fff' };
  }

  // Too few points to fit a distribution → fall back to the fixed scale
  if (!dist) {
    if (roas < 2) return { bg: `rgba(251,191,36,${(0.20 + (2 - roas) * 0.10).toFixed(2)})`, fg: '#fde68a' };
    const intensity = Math.min(0.85, 0.25 + Math.log2(roas) * 0.20);
    return { bg: `rgba(34,197,94,${intensity.toFixed(2)})`, fg: '#fff' };
  }

  const { mean, stdev, median, p25, p75 } = dist;
  const z = stdev > 0 ? (roas - mean) / stdev : 0;

  // Below Q1 of this matrix → red (weakest quartile in this group)
  if (roas < p25) {
    const span = Math.max(0.01, p25 - 1);
    const t = Math.max(0, Math.min(1, (p25 - roas) / span));
    return { bg: `rgba(239,68,68,${(0.22 + 0.38 * t).toFixed(2)})`, fg: '#fff' };
  }
  // Q1 → median → amber
  if (roas < median) {
    const span = Math.max(0.01, median - p25);
    const t = 1 - (roas - p25) / span; // 1 at p25, 0 at median
    return { bg: `rgba(251,191,36,${(0.22 + 0.18 * t).toFixed(2)})`, fg: '#fde68a' };
  }
  // Median → Q3 → light green (above-average but not star)
  if (roas < p75) {
    const span = Math.max(0.01, p75 - median);
    const t = (roas - median) / span; // 0 at median, 1 at p75
    return { bg: `rgba(132,204,22,${(0.24 + 0.18 * t).toFixed(2)})`, fg: '#ecfccb' };
  }
  // Above Q3 → green, deepened by z-score (caps at +2σ)
  const intensity = Math.min(0.92, 0.45 + Math.max(0, z) * 0.22);
  return { bg: `rgba(34,197,94,${intensity.toFixed(2)})`, fg: '#fff' };
}

/* ─── Reusable heatmap ────────────────────────────────────── */
function Heatmap({ title, subtitle, matrix, rowKeys, colKeys, rowLabel = 'Row', colLabel = 'Col', rowTruncate = 22 }) {
  const dist = useMemo(() => buildRoasDistribution(matrix || {}), [matrix]);

  if (!rowKeys?.length || !colKeys?.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="text-sm font-semibold text-white mb-1">{title}</div>
        <div className="text-xs text-slate-500 italic">Not enough data in this combo.</div>
      </div>
    );
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="text-sm font-semibold text-white">{title}</div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-3 overflow-auto" style={{ maxHeight: '560px' }}>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-gray-900 z-10 px-2 py-1 text-left text-[10px] text-slate-500 uppercase tracking-wider min-w-[180px]">
                {rowLabel} ↓ / {colLabel} →
              </th>
              {colKeys.map(c => (
                <th key={c} className="px-2 py-1 text-left text-[10px] text-slate-400 font-semibold min-w-[100px]" title={c}>
                  {truncate(c, 16)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map(r => (
              <tr key={r}>
                <td className="sticky left-0 bg-gray-900 z-10 px-2 py-1 text-slate-300 font-medium border-r border-gray-800" title={r}>
                  {truncate(r, rowTruncate)}
                </td>
                {colKeys.map(c => {
                  const cell = matrix[`${r}|||${c}`];
                  if (!cell) return <td key={c} className="px-2 py-1"><span className="text-slate-700">·</span></td>;
                  const color = adaptiveRoasColor(cell.roas, cell.belowThreshold, dist);
                  const z = dist && dist.stdev > 0 ? (cell.roas - dist.mean) / dist.stdev : null;
                  const pct = dist && !cell.belowThreshold && cell.roas > 0 ? dist.percentileOf(cell.roas) : null;
                  const statsLine = dist && !cell.belowThreshold && cell.roas > 0
                    ? `\nz = ${z >= 0 ? '+' : ''}${z.toFixed(2)}σ · pctile ${Math.round(pct * 100)} (of ${dist.n})`
                    : '';
                  return (
                    <td key={c} className="px-0 py-0">
                      <div
                        style={{ background: color.bg, color: color.fg }}
                        className="px-2 py-2 text-center font-mono min-w-[100px] cursor-default"
                        title={`${r} × ${c}\nSpend: ${cur(cell.spend)}\nRevenue: ${cur(cell.revenue)}\nROAS: ${cell.roas.toFixed(2)}x\nPurchases: ${cell.purchases}\nCPA: ${cell.cpa ? cur(cell.cpa) : '—'}\nRows: ${cell.rows}${statsLine}`}
                      >
                        <div className="font-bold text-sm">{cell.roas.toFixed(2)}x</div>
                        <div className="text-[10px] opacity-80">{cur(cell.spend)}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
        {dist ? (
          <>
            <span className="text-slate-400 font-semibold">Adaptive scale (n={dist.n}):</span>
            <span title="Mean ROAS of all qualifying cells">μ {dist.mean.toFixed(2)}x</span>
            <span title="Median ROAS">med {dist.median.toFixed(2)}x</span>
            <span title="Mode (0.25x bins)">mode {dist.mode.toFixed(2)}x</span>
            <span title="1 standard deviation">σ {dist.stdev.toFixed(2)}</span>
            <span className="flex-1" />
            <span className="flex items-center gap-1" title="Below breakeven — always red"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.55)' }} /> &lt;1x</span>
            <span className="flex items-center gap-1" title={`Bottom quartile: <${dist.p25.toFixed(2)}x`}><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.32)' }} /> &lt;Q1 ({dist.p25.toFixed(2)}x)</span>
            <span className="flex items-center gap-1" title={`Q1–median: ${dist.p25.toFixed(2)}–${dist.median.toFixed(2)}x`}><span className="w-3 h-3 rounded" style={{ background: 'rgba(251,191,36,0.35)' }} /> ≤med</span>
            <span className="flex items-center gap-1" title={`Median–Q3: ${dist.median.toFixed(2)}–${dist.p75.toFixed(2)}x`}><span className="w-3 h-3 rounded" style={{ background: 'rgba(132,204,22,0.35)' }} /> ≤Q3</span>
            <span className="flex items-center gap-1" title={`Top quartile: ≥${dist.p75.toFixed(2)}x — intensity scales with z-score`}><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,0.7)' }} /> ≥Q3 ({dist.p75.toFixed(2)}x)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(55,65,81,0.3)' }} /> low spend</span>
          </>
        ) : (
          <>
            <span className="text-slate-400">Fixed scale (too few cells for adaptive):</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.5)' }} /> &lt;1x</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(251,191,36,0.4)' }} /> 1–2x</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,0.6)' }} /> ≥2x</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(55,65,81,0.3)' }} /> low spend</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── MAIN — four heatmaps ────────────────────────────────── */
const QUADRANT_ORDER = ['DOUBLE DOWN', 'MILK', 'BET', 'BUNDLE', 'EXIT', 'INVESTIGATE'];

export default function CrossPatterns() {
  const { enrichedRows, activeBrandIds, brandData } = useStore();

  /* enrichedRows is already scoped to active brands by the store's
     _rebuild. No extra filtering needed here. */
  const rows = enrichedRows || [];

  /* Star quadrant map — pooled across active brands' orders/inventory */
  const quadrantMap = useMemo(() => {
    if (!activeBrandIds?.length) return new Map();
    const allOrders = [];
    let mergedInventory = {};
    for (const bid of activeBrandIds) {
      const bd = brandData?.[bid];
      if (!bd) continue;
      if (bd.orders?.length) { for (const o of bd.orders) allOrders.push(o); }
      if (bd.inventoryMap)   Object.assign(mergedInventory, bd.inventoryMap);
    }
    if (!allOrders.length) return new Map();
    try {
      const { skus } = buildStarProducts({ orders: allOrders, inventoryMap: mergedInventory, windowDays: 90 });
      return skuQuadrantMap(skus);
    } catch { return new Map(); }
  }, [activeBrandIds, brandData]);

  /* 1. Collection × Creative Dominance */
  const collectionCreative = useMemo(
    () => buildCrossMatrix(rows, 'collection', 'creativeDominance', { minSpend: 500 }),
    [rows]
  );

  /* 2. Collection × Campaign Type (Influencer vs In-house focus) */
  const collectionCampaign = useMemo(
    () => buildCrossMatrix(rows, 'collection', 'campaignType', { minSpend: 500 }),
    [rows]
  );

  /* 3. Star Quadrant × Creative Dominance */
  const quadrantCreative = useMemo(
    () => buildCrossMatrix(rows, '__quadrant__', 'creativeDominance', {
      skuMap: quadrantMap,
      rowValues: QUADRANT_ORDER,
      minSpend: 500,
    }),
    [rows, quadrantMap]
  );

  /* 4. Top-20 SKUs × Creative Dominance */
  const topSkus = useMemo(() => topValuesBy(rows, 'sku', { metric: 'spend', n: 20 }), [rows]);
  const skuCreative = useMemo(
    () => buildCrossMatrix(rows, 'sku', 'creativeDominance', { rowValues: topSkus, minSpend: 300 }),
    [rows, topSkus]
  );

  const hasAnyRows = rows?.length > 0;

  if (!hasAnyRows) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
        Pull Meta data for active brands first — Cross Patterns needs enriched ad rows.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1 + 2 side-by-side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Heatmap
          title="Collection × Creative Dominance"
          subtitle="Which creative format wins for each product collection · cells: ROAS + spend"
          {...collectionCreative}
          rowLabel="Collection"
          colLabel="Creative"
        />
        <Heatmap
          title="Collection × Campaign Type"
          subtitle="Influencer vs In-house performance broken down by collection"
          {...collectionCampaign}
          rowLabel="Collection"
          colLabel="Campaign Type"
        />
      </div>

      {/* 3 — Star Quadrant × Creative */}
      <Heatmap
        title="Star Quadrant × Creative Dominance"
        subtitle={`Are your DOUBLE DOWN SKUs getting the right creative treatment? · joined via SKU → quadrant (${quadrantMap.size} SKUs mapped)`}
        {...quadrantCreative}
        rowLabel="Star Quadrant"
        colLabel="Creative"
        rowTruncate={14}
      />

      {/* 4 — Top-20 SKUs × Creative */}
      <Heatmap
        title="Top-20 SKUs × Creative Dominance"
        subtitle="Per-SKU: which creative format produces the best ROAS (ranked by ad spend)"
        {...skuCreative}
        rowLabel="SKU"
        colLabel="Creative"
        rowTruncate={24}
      />

      {/* Summary narrative */}
      <div className="px-4 py-3 rounded-xl border border-violet-800/30 bg-violet-900/10 text-[11px] text-violet-200 leading-relaxed">
        <div className="font-semibold text-violet-300 mb-1">How to read these</div>
        Colors are <span className="text-violet-300 font-semibold">adaptive per heatmap</span>: each cell is scored against its own matrix's distribution (mean μ, median, mode, σ, quartiles) — so "green" means top quartile of <em>this</em> group, not a fixed 2x threshold. Below Q1 &rarr; red, Q1–median &rarr; amber, median–Q3 &rarr; light green, above Q3 &rarr; deep green (intensity scaled by z-score). Hard floor: anything &lt; 1x ROAS stays red (you're losing money regardless). Hover a cell to see its z-score and percentile. Gray = below the spend floor — not enough signal. The spot-check pattern: a deep-green cell next to a red cell in the same row means "wrong creative for this product."
      </div>
    </div>
  );
}
