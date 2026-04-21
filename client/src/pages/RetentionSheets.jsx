import { useState, useMemo, useEffect } from 'react';
import { Download, Table2, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { buildAllFeatures } from '../lib/retention/features';
import { buildAffinity } from '../lib/retention/affinity';
import { buildTaxonomy, applyTaxonomy } from '../lib/retention/taxonomy';
import { rankAllOpportunities } from '../lib/retention/opportunities';
import { buildProductLookup, productFor } from '../lib/retention/productLookup';
import { downloadCsv } from '../lib/retention/exportCsv';

/**
 * One-stop view of every auto-computed retention dataset for the
 * selected brand. Each sheet renders as a paginated table with a
 * per-sheet CSV export. All exports include SKU name + product URL
 * joined from the inventory map.
 */
const SHEETS = [
  { id: 'features',     label: 'Customer Features' },
  { id: 'opportunities',label: 'Opportunities (all)' },
  { id: 'replenish',    label: 'SKU Replenish Clock' },
  { id: 'copurchase',   label: 'Co-purchase Pairs' },
  { id: 'transitions',  label: 'Category Transitions' },
  { id: 'new_launches', label: 'New Launches' },
  { id: 'taxonomy',     label: 'Collections (auto)' },
];

const PAGE_SIZE = 100;

export default function RetentionSheets() {
  const { brands, activeBrandIds, brandData } = useStore();
  const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
  const [brandId, setBrandId] = useState(activeBrands[0]?.id || brands[0]?.id || '');
  const [active, setActive] = useState('features');
  const [page, setPage] = useState(0);
  const [computing, setComputing] = useState(false);
  const [compiled, setCompiled] = useState(null);

  const brand = brands.find(b => b.id === brandId);
  const bd    = brand ? brandData[brand.id] || {} : {};
  const lookup = useMemo(() => buildProductLookup(brand, bd.inventoryMap), [brand, bd.inventoryMap]);

  const run = () => {
    if (!bd.orders?.length) { setCompiled(null); return; }
    setComputing(true);
    setTimeout(() => {
      const orders = bd.orders || [];
      const customers = bd.customers || [];
      const taxonomy = buildTaxonomy(orders);
      applyTaxonomy(orders, taxonomy.skuLabel);
      const { features, replenish } = buildAllFeatures(orders, customers);
      const affinity = buildAffinity(orders);
      const { flat } = rankAllOpportunities({
        features,
        replenishClock: replenish,
        copurchase: affinity.copurchase,
        taxonomy,
        newLaunches: affinity.newLaunches,
        orders,
      });
      setCompiled({ features, replenish, affinity, taxonomy, flat });
      setComputing(false);
    }, 30);
  };

  useEffect(() => { setCompiled(null); setPage(0); run(); /* eslint-disable-next-line */ }, [brandId]);

  const rows = useMemo(() => buildRows(active, compiled, lookup), [active, compiled, lookup]);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const exportAll = () => {
    if (!rows.length) return;
    const name = `${(brand?.name || 'brand').toLowerCase().replace(/\s+/g,'-')}-${active}`;
    downloadCsv(rows, name);
  };

  const exportEverything = () => {
    if (!compiled) return;
    for (const s of SHEETS) {
      const r = buildRows(s.id, compiled, lookup);
      if (r.length) downloadCsv(r, `${(brand?.name || 'brand').toLowerCase().replace(/\s+/g,'-')}-${s.id}`);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Retention Sheets</h1>
          <p className="text-sm text-slate-400 mt-1">
            Auto-computed retention datasets. Every sheet exports to CSV with SKU name + product URL.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={brandId}
            onChange={e => setBrandId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200"
          >
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button
            onClick={run}
            disabled={computing || !bd.orders?.length}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-sm text-white font-medium"
          >
            {computing ? 'Computing…' : 'Recompute'}
          </button>
          <button
            onClick={exportEverything}
            disabled={!compiled}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm text-white font-medium flex items-center gap-1.5"
            title="Download every sheet as separate CSVs"
          >
            <Sparkles className="w-4 h-4" /> Export all
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 text-xs flex-wrap">
        <Pill label="Orders"       value={(bd.orders?.length || 0).toLocaleString()} />
        <Pill label="Customers"    value={(bd.customers?.length || 0).toLocaleString()} />
        <Pill label="Inventory SKUs" value={Object.keys(lookup).length.toLocaleString()} />
        {compiled && <Pill label="Features"     value={Object.keys(compiled.features).length.toLocaleString()} />}
        {compiled && <Pill label="Opportunities" value={compiled.flat.length.toLocaleString()} />}
        {compiled && <Pill label="Replenish SKUs" value={Object.keys(compiled.replenish).length.toLocaleString()} />}
        {compiled && <Pill label="Co-purchase pairs" value={compiled.affinity.copurchase.pairs.length.toLocaleString()} />}
      </div>

      {!Object.keys(lookup).length && bd.orders?.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
          No Shopify inventory loaded for this brand — SKU names + product URLs in exports will be blank.
          Pull inventory from <b>Shopify Ops</b> to enrich exports.
        </div>
      )}

      {!compiled && !computing && (
        <div className="p-8 rounded-xl bg-gray-900 border border-gray-800 text-center">
          <Table2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <div className="text-slate-300 font-medium">No retention data yet</div>
          <div className="text-slate-500 text-sm mt-1">Ingest orders via Bulk CSV Import, then click Recompute.</div>
        </div>
      )}

      {compiled && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 flex-wrap border-b border-gray-800">
            {SHEETS.map(s => {
              const r = buildRows(s.id, compiled, lookup);
              return (
                <button
                  key={s.id}
                  onClick={() => { setActive(s.id); setPage(0); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    active === s.id
                      ? 'text-brand-300 border-brand-500'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  {s.label}
                  <span className="ml-2 text-[10px] text-slate-500">{r.length.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          {/* Per-sheet toolbar */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <div>Showing {rows.length ? (page * PAGE_SIZE + 1).toLocaleString() : 0}–{Math.min((page + 1) * PAGE_SIZE, rows.length).toLocaleString()} of {rows.length.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded bg-gray-900 border border-gray-800 disabled:opacity-40"
              >Prev</button>
              <div>{page + 1} / {totalPages}</div>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded bg-gray-900 border border-gray-800 disabled:opacity-40"
              >Next</button>
              <button
                onClick={exportAll}
                disabled={!rows.length}
                className="ml-2 px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-40"
              ><Download className="w-3.5 h-3.5" /> Export CSV</button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-auto max-h-[70vh]">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 sticky top-0 border-b border-gray-800 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  {rows[0] && Object.keys(rows[0]).map(k => (
                    <th key={k} className="p-2 font-medium whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    {Object.entries(r).map(([k, v], j) => (
                      <td key={j} className="p-2 align-top max-w-[260px]">
                        {renderCell(k, v)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr><td className="p-8 text-center text-slate-500" colSpan={99}>No rows.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-900 border border-gray-800 text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-100">{value}</span>
    </span>
  );
}

function renderCell(key, val) {
  if (val == null || val === '') return <span className="text-slate-600">—</span>;
  if (/(_url|^url$|product_url)/.test(key) && typeof val === 'string' && val.startsWith('http')) {
    return <a className="text-brand-400 hover:underline truncate block" href={val} target="_blank" rel="noreferrer">{val.replace(/^https?:\/\//,'')}</a>;
  }
  if (typeof val === 'number') return <span className="text-slate-200 tabular-nums">{Number.isInteger(val) ? val.toLocaleString() : val.toLocaleString(undefined,{maximumFractionDigits:2})}</span>;
  if (typeof val === 'object') return <span className="text-slate-400">{JSON.stringify(val).slice(0,80)}</span>;
  const s = String(val);
  return <span className="text-slate-300 truncate block">{s.length > 120 ? s.slice(0,120) + '…' : s}</span>;
}

/* ─── SHEET ROW BUILDERS ──────────────────────────────────────────── */

function buildRows(which, compiled, lookup) {
  if (!compiled) return [];
  switch (which) {
    case 'features':      return buildFeatureRows(compiled.features, lookup);
    case 'opportunities': return buildOpportunityRows(compiled.flat, compiled.features, lookup);
    case 'replenish':     return buildReplenishRows(compiled.replenish, lookup);
    case 'copurchase':    return buildCopurchaseRows(compiled.affinity.copurchase.pairs, lookup);
    case 'transitions':   return buildTransitionRows(compiled.affinity.transitions);
    case 'new_launches':  return buildNewLaunchRows(compiled.affinity.newLaunches, lookup);
    case 'taxonomy':      return compiled.taxonomy.collections.map(c => ({ collection: c.name, sku_count: c.sku_count }));
    default:              return [];
  }
}

function buildFeatureRows(features, lookup) {
  return Object.values(features).map(f => {
    const top = f.top_skus?.[0]?.sku;
    const p = top ? productFor(top, lookup) : {};
    return {
      email:            f.email,
      first_name:       f.first_name,
      last_name:        f.last_name,
      city:             f.city,
      value_tier:       f.value_tier,
      lifecycle_stage:  f.lifecycle_stage,
      rfm_segment:      f.rfm_segment,
      r_score:          f.r_score,
      f_score:          f.f_score,
      m_score:          f.m_score,
      orders:           f.true_orders_lifetime,
      spend:            f.true_spend_lifetime,
      aov:              f.aov_lifetime,
      days_since_last:  f.days_since_last_order,
      gap_median:       f.gap_median,
      next_order_days:  f.next_order_eta_days,
      overdue_ratio:    f.overdue_ratio,
      primary_collection: f.primary_collection,
      top_sku:          top || '',
      top_sku_name:     p.name || '',
      top_sku_url:      p.url || '',
      avg_basket_size:  f.avg_basket_size,
      discount_ratio:   f.discount_order_ratio,
      novelty_ratio:    f.novelty_ratio,
      preferred_hour_utc: f.preferred_hour_utc,
      accepts_email_marketing: f.accepts_email_marketing,
      accepts_sms_marketing:   f.accepts_sms_marketing,
    };
  }).sort((a, b) => (b.spend || 0) - (a.spend || 0));
}

function buildOpportunityRows(flat, features, lookup) {
  return flat.map(r => {
    const sku = r.recommended_skus?.[0] || '';
    const p = sku ? productFor(sku, lookup) : {};
    const f = features[r.email] || {};
    return {
      email:          r.email,
      first_name:     f.first_name || '',
      value_tier:     f.value_tier || '',
      opportunity:    r.opportunity,
      score:          r.score,
      expected_rev:   r.expected_incremental_revenue,
      recommended_sku:sku,
      sku_name:       p.name || '',
      product_url:    p.url || '',
      product_price:  p.price || 0,
      all_recommended: (r.recommended_skus || []).join('|'),
      reason:         r.reason,
    };
  });
}

function buildReplenishRows(clock, lookup) {
  return Object.values(clock).map(c => {
    const p = productFor(c.sku, lookup);
    return {
      sku:             c.sku,
      name:            p.name || '',
      product_url:     p.url || '',
      median_gap_days: c.median_gap_days,
      p25_days:        c.p25,
      p75_days:        c.p75,
      sample_size:     c.sample_size,
      is_consumable:   c.is_consumable,
      price:           p.price || 0,
      stock:           p.stock || 0,
    };
  }).sort((a, b) => b.sample_size - a.sample_size);
}

function buildCopurchaseRows(pairs, lookup) {
  return pairs.map(p => {
    const a = productFor(p.a, lookup);
    const b = productFor(p.b, lookup);
    return {
      sku_a:   p.a,
      name_a:  a.name || '',
      url_a:   a.url || '',
      sku_b:   p.b,
      name_b:  b.name || '',
      url_b:   b.url || '',
      lift:    p.lift,
      conf_a_to_b: p.conf_a_to_b,
      conf_b_to_a: p.conf_b_to_a,
      support: p.support,
    };
  });
}

function buildTransitionRows(trans) {
  const rows = [];
  for (const [from, list] of Object.entries(trans || {})) {
    for (const r of list) {
      rows.push({ from_collection: from, to_collection: r.to, probability: r.prob, support: r.support });
    }
  }
  return rows.sort((a, b) => b.support - a.support);
}

function buildNewLaunchRows(launches, lookup) {
  return launches.map(l => {
    const p = productFor(l.sku, lookup);
    return {
      sku:          l.sku,
      name:         p.name || '',
      product_url:  p.url || '',
      first_seen:   new Date(l.first_seen_ms).toISOString().slice(0, 10),
      age_days:     l.age_days,
      order_count:  l.order_count,
      price:        p.price || 0,
      collection:   p.collection || '',
    };
  });
}
