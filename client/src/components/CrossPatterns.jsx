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

/* ─── Color scale for ROAS ───────────────────────────────────
   Mid-range ROAS (1-2x) is neutral, high is green, low is red.
   Scale is non-linear via log so a 10x ROAS doesn't blow out. */
function roasToColor(roas, belowThreshold) {
  if (belowThreshold) return { bg: 'rgba(55,65,81,0.3)', fg: '#475569' };
  if (roas <= 0)      return { bg: 'rgba(239,68,68,0.15)', fg: '#f87171' };
  if (roas < 1)       return { bg: `rgba(239,68,68,${0.25 + (1 - roas) * 0.5})`, fg: '#fca5a5' };
  if (roas < 2)       return { bg: `rgba(251,191,36,${0.20 + (2 - roas) * 0.10})`, fg: '#fde68a' };
  // ≥2: green, scaled by log so very high values don't saturate instantly
  const intensity = Math.min(0.85, 0.25 + Math.log2(roas) * 0.20);
  return { bg: `rgba(34,197,94,${intensity.toFixed(2)})`, fg: '#fff' };
}

/* ─── Reusable heatmap ────────────────────────────────────── */
function Heatmap({ title, subtitle, matrix, rowKeys, colKeys, rowLabel = 'Row', colLabel = 'Col', rowTruncate = 22 }) {
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
                  const color = roasToColor(cell.roas, cell.belowThreshold);
                  return (
                    <td key={c} className="px-0 py-0">
                      <div
                        style={{ background: color.bg, color: color.fg }}
                        className="px-2 py-2 text-center font-mono min-w-[100px] cursor-default"
                        title={`${r} × ${c}\nSpend: ${cur(cell.spend)}\nRevenue: ${cur(cell.revenue)}\nROAS: ${cell.roas.toFixed(2)}x\nPurchases: ${cell.purchases}\nCPA: ${cell.cpa ? cur(cell.cpa) : '—'}\nRows: ${cell.rows}`}
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
      <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-3 text-[10px] text-slate-600 justify-end">
        <span>Cell: ROAS + spend</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.5)' }} /> &lt;1x</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(251,191,36,0.4)' }} /> 1–2x</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,0.6)' }} /> ≥2x</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'rgba(55,65,81,0.3)' }} /> low spend</span>
      </div>
    </div>
  );
}

/* ─── MAIN — four heatmaps ────────────────────────────────── */
const QUADRANT_ORDER = ['DOUBLE DOWN', 'MILK', 'BET', 'BUNDLE', 'EXIT', 'INVESTIGATE'];

export default function CrossPatterns() {
  const { enrichedRows, activeBrandIds, brandData } = useStore();

  /* Filter enriched rows to active brands for clean cross-brand isolation */
  const rows = useMemo(
    () => (enrichedRows || []).filter(r => !activeBrandIds?.length || activeBrandIds.includes(r._brandId || r.brandId)),
    [enrichedRows, activeBrandIds]
  );

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
        Green cells = ROAS ≥ 2x (do more). Amber = 1-2x (break-even zone). Red = &lt;1x (losing money). Gray = below spend floor; not enough signal. Hover any cell for the full breakdown. The spot-check pattern: look for a green cell next to a red cell in the same row — that's your "wrong creative for this product" signal.
      </div>
    </div>
  );
}
