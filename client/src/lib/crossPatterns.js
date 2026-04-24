/**
 * Cross-dimensional pattern analytics — 2-D and 3-D aggregations on
 * enrichedRows with ROAS / spend / purchases / CPA per cell.
 *
 * Everything returns a tidy {rowKeys, colKeys, matrix, rowTotals,
 * colTotals, totals} shape so one <Heatmap> component renders every
 * combo without special-casing.
 *
 * For cells with < minSpend, we return null metrics so the heatmap
 * can gray them out instead of drawing noise.
 */

const safeNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* ─── CORE AGGREGATOR ─────────────────────────────────────────────
   rows: enrichedRows array. rowKey / colKey are field names to
   group by. Each cell aggregates spend / revenue / purchases and
   derives ROAS + CPA + CVR.                                        */
export function buildCrossMatrix(rows = [], rowKey, colKey, {
  rowValues = null,           // optional: pre-filtered list of row keys
  colValues = null,           // optional: pre-filtered list of col keys
  skuMap    = null,           // optional: override rowKey lookup via sku → quadrant map
  minSpend  = 100,
} = {}) {
  const matrix = {};
  const rowTotals = new Map();
  const colTotals = new Map();
  let grandTotals = { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, rows: 0 };

  for (const r of rows) {
    // Resolve row value — either a field on r, or skuMap lookup (for Star Quadrant joins)
    const rKey = skuMap
      ? (skuMap.get?.(String(r.sku || '').toUpperCase().trim()) || null)
      : (r[rowKey] || null);
    const cKey = r[colKey] || null;
    if (!rKey || !cKey) continue;
    if (rKey === 'none' || cKey === 'none') continue;
    if (rowValues && !rowValues.includes(rKey)) continue;
    if (colValues && !colValues.includes(cKey)) continue;

    const key = `${rKey}|||${cKey}`;
    let cell = matrix[key];
    if (!cell) {
      cell = { row: rKey, col: cKey, spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, rows: 0 };
      matrix[key] = cell;
    }
    const spend = safeNum(r.spend);
    const purchases = safeNum(r.purchases);
    const rev = safeNum(r.revenue) || (safeNum(r.metaRoas) * spend);
    cell.spend      += spend;
    cell.revenue    += rev;
    cell.purchases  += purchases;
    cell.clicks     += safeNum(r.clicks);
    cell.impressions += safeNum(r.impressions);
    cell.rows++;

    rowTotals.set(rKey, (rowTotals.get(rKey) || 0) + spend);
    colTotals.set(cKey, (colTotals.get(cKey) || 0) + spend);
    grandTotals.spend     += spend;
    grandTotals.revenue   += rev;
    grandTotals.purchases += purchases;
    grandTotals.rows++;
  }

  // Derive per-cell rates; null-out low-signal cells
  for (const cell of Object.values(matrix)) {
    cell.roas = cell.spend > 0 ? cell.revenue / cell.spend : 0;
    cell.cpa  = cell.purchases > 0 ? cell.spend / cell.purchases : null;
    cell.ctr  = cell.impressions > 0 ? cell.clicks / cell.impressions : 0;
    cell.belowThreshold = cell.spend < minSpend;
  }

  const rowKeys = [...rowTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colKeys = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  return { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotals };
}

/* ─── TOP-N dimension values by spend (used to cap heatmap size) ── */
export function topValuesBy(rows = [], key, { metric = 'spend', n = 20 } = {}) {
  const totals = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k || k === 'none') continue;
    totals.set(k, (totals.get(k) || 0) + safeNum(r[metric]));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/* ─── Group ROAS by dim for a summary bar (used alongside heatmap) ── */
export function roasByDimension(rows = [], key) {
  const totals = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k || k === 'none') continue;
    const cur = totals.get(k) || { key: k, spend: 0, revenue: 0, purchases: 0 };
    cur.spend     += safeNum(r.spend);
    cur.revenue   += safeNum(r.revenue) || safeNum(r.metaRoas) * safeNum(r.spend);
    cur.purchases += safeNum(r.purchases);
    totals.set(k, cur);
  }
  return [...totals.values()]
    .filter(v => v.spend >= 100)
    .map(v => ({ ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0 }))
    .sort((a, b) => b.spend - a.spend);
}

/* ─── Build a SKU → quadrant map from the Star Products output ──── */
export function skuQuadrantMap(starSkus = []) {
  const map = new Map();
  for (const s of starSkus) {
    if (!s?.sku || !s?.action) continue;
    map.set(String(s.sku).toUpperCase().trim(), s.action);
  }
  return map;
}
