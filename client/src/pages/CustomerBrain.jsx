import { useState, useMemo, useEffect } from 'react';
import { Search, TrendingUp, Clock, Gift, PackageCheck, Heart, Zap, DollarSign, Users, Download, X, ShoppingBag, Send, ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import { buildAllFeatures } from '../lib/retention/features';
import { buildAffinity } from '../lib/retention/affinity';
import { buildTaxonomy, applyTaxonomy } from '../lib/retention/taxonomy';
import { rankAllOpportunities } from '../lib/retention/opportunities';
import { buildProductLookup, productFor } from '../lib/retention/productLookup';
import { downloadCsv } from '../lib/retention/exportCsv';
import { loadBrandSends } from '../lib/sendLog';

const OPP_META = {
  REPLENISH:   { icon: PackageCheck, color: 'text-emerald-400 bg-emerald-500/10', label: 'Replenish' },
  COMPLEMENT:  { icon: Gift,         color: 'text-violet-400 bg-violet-500/10',   label: 'Complement' },
  WINBACK:     { icon: Heart,        color: 'text-rose-400 bg-rose-500/10',       label: 'Winback' },
  NEW_LAUNCH:  { icon: Zap,          color: 'text-amber-400 bg-amber-500/10',     label: 'New Launch' },
  UPSELL:      { icon: TrendingUp,   color: 'text-cyan-400 bg-cyan-500/10',       label: 'Upsell' },
  VIP_PROTECT: { icon: Heart,        color: 'text-fuchsia-400 bg-fuchsia-500/10', label: 'VIP Protect' },
};

export default function CustomerBrain() {
  const { brands, activeBrandIds, brandData } = useStore();
  const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
  const [targetBrandId, setTargetBrandId] = useState(activeBrands[0]?.id || brands[0]?.id || '');
  const [search, setSearch] = useState('');
  const [filterOpp, setFilterOpp] = useState('ALL');
  const [filterTier, setFilterTier] = useState('ALL');
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState(null);
  const [activeEmail, setActiveEmail] = useState(null);
  const [brandSends, setBrandSends] = useState([]);

  const brand = brands.find(b => b.id === targetBrandId);
  const bd = brand ? brandData[brand.id] || {} : {};
  const ordersCount = bd.orders?.length || 0;
  const customersCount = bd.customers?.length || 0;

  const run = () => {
    if (!brand || !bd.orders?.length) return;
    setComputing(true);
    setResult(null);
    setTimeout(() => {
      const orders = bd.orders || [];
      const customers = bd.customers || [];

      const taxonomy = buildTaxonomy(orders);
      applyTaxonomy(orders, taxonomy.skuLabel);

      const { features, replenish } = buildAllFeatures(orders, customers);
      const affinity = buildAffinity(orders);
      const { flat, byCustomer } = rankAllOpportunities({
        features,
        replenishClock: replenish,
        copurchase: affinity.copurchase,
        taxonomy,
        newLaunches: affinity.newLaunches,
        orders,
      });

      setResult({ features, replenish, affinity, taxonomy, flat, byCustomer });
      setComputing(false);
    }, 50);
  };

  // Auto-run once when brand has data
  useEffect(() => {
    if (ordersCount && !result) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBrandId, ordersCount]);

  // Load this brand's send log for the detail drawer
  useEffect(() => {
    if (!targetBrandId) { setBrandSends([]); return; }
    loadBrandSends(targetBrandId).then(setBrandSends).catch(() => setBrandSends([]));
  }, [targetBrandId]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    const out = [];
    for (const [email, opps] of Object.entries(result.byCustomer)) {
      if (!opps.length) continue;
      if (filterOpp !== 'ALL' && !opps.some(o => o.opportunity === filterOpp)) continue;
      const f = result.features[email] || {};
      if (filterTier !== 'ALL' && f.value_tier !== filterTier) continue;
      if (q && !email.includes(q) && !(f.first_name || '').toLowerCase().includes(q)) continue;
      out.push({ email, opps, f });
    }
    out.sort((a, b) => (b.opps[0]?.score || 0) - (a.opps[0]?.score || 0));
    return out.slice(0, 500);
  }, [result, search, filterOpp, filterTier]);

  const lookup = useMemo(() => buildProductLookup(brand, bd.inventoryMap), [brand, bd.inventoryMap]);

  const exportAll = () => {
    if (!result?.flat?.length) return;
    const rows = result.flat.map(r => {
      const f = result.features[r.email] || {};
      const firstSku = r.recommended_skus?.[0] || '';
      const p = productFor(firstSku, lookup);
      return {
        email: r.email,
        first_name: f.first_name || '',
        last_name: f.last_name || '',
        value_tier: f.value_tier || '',
        lifecycle_stage: f.lifecycle_stage || '',
        rfm_segment: f.rfm_segment || '',
        orders_lifetime: f.true_orders_lifetime || 0,
        spend_lifetime: Math.round(f.true_spend_lifetime || 0),
        aov: Math.round(f.aov_lifetime || 0),
        days_since_last: f.days_since_last_order ?? '',
        opportunity: r.opportunity,
        score: Number(r.score?.toFixed(3) || 0),
        expected_incremental_revenue: Math.round(r.expected_incremental_revenue || 0),
        recommended_skus: (r.recommended_skus || []).join('|'),
        primary_sku: firstSku,
        primary_sku_name: p.name,
        primary_product_url: p.url,
        reason: r.reason || '',
      };
    });
    const name = `${(brand?.name || 'brand').toLowerCase().replace(/\s+/g,'-')}-opportunities`;
    downloadCsv(rows, name);
  };

  const stats = useMemo(() => {
    if (!result) return null;
    const feats = Object.values(result.features).filter(f => f.orders_lifetime > 0);
    const byTier = {};
    const byStage = {};
    const bySegment = {};
    for (const f of feats) {
      byTier[f.value_tier] = (byTier[f.value_tier] || 0) + 1;
      byStage[f.lifecycle_stage] = (byStage[f.lifecycle_stage] || 0) + 1;
      bySegment[f.rfm_segment] = (bySegment[f.rfm_segment] || 0) + 1;
    }
    const byOpp = {};
    let totalRev = 0;
    for (const r of result.flat) {
      byOpp[r.opportunity] = (byOpp[r.opportunity] || 0) + 1;
      totalRev += r.expected_incremental_revenue || 0;
    }
    return {
      buyers: feats.length,
      byTier, byStage, bySegment, byOpp,
      total_expected_rev: totalRev,
      total_opps: result.flat.length,
      replenish_skus: Object.keys(result.replenish).length,
      copurchase_pairs: result.affinity.copurchase.pairs.length,
    };
  }, [result]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Customer Brain</h1>
          <p className="text-sm text-slate-400 mt-1">
            Ranked opportunities per customer — what, when, why to send.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={targetBrandId}
            onChange={e => { setTargetBrandId(e.target.value); setResult(null); }}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200"
          >
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button
            onClick={run}
            disabled={computing || !ordersCount}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white font-medium"
          >
            {computing ? 'Computing…' : 'Recompute'}
          </button>
          <button
            onClick={exportAll}
            disabled={!result?.flat?.length}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-slate-200 font-medium flex items-center gap-2"
            title="Export all opportunities with customer features + SKU name + product URL"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Data status */}
      <div className="flex gap-3 text-xs">
        <Pill label="Orders"    value={ordersCount.toLocaleString()} />
        <Pill label="Customers" value={customersCount.toLocaleString()} />
        {stats && <Pill label="Buyers"        value={stats.buyers.toLocaleString()} />}
        {stats && <Pill label="Opportunities" value={stats.total_opps.toLocaleString()} />}
        {stats && <Pill label="Est. revenue"  value={'₹' + Math.round(stats.total_expected_rev).toLocaleString('en-IN')} />}
        {stats && <Pill label="Consumable SKUs" value={stats.replenish_skus} />}
      </div>

      {!ordersCount && (
        <div className="p-8 rounded-xl bg-gray-900 border border-gray-800 text-center">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <div className="text-slate-300 font-medium">No orders for this brand yet</div>
          <div className="text-slate-500 text-sm mt-1">Use Bulk CSV Import to ingest Shopify exports.</div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="By Value Tier">
            {['VIP','Core','Emerging'].map(t => (
              <Row key={t} label={t} value={(stats.byTier[t] || 0).toLocaleString()} />
            ))}
          </Card>
          <Card title="By Lifecycle">
            {Object.entries(stats.byStage).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
              <Row key={k} label={k.replace(/_/g, ' ')} value={v.toLocaleString()} />
            ))}
          </Card>
          <Card title="By Opportunity">
            {Object.entries(stats.byOpp).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
              <Row key={k} label={OPP_META[k]?.label || k} value={v.toLocaleString()} />
            ))}
          </Card>
        </div>
      )}

      {/* Filters */}
      {result && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by email or name…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </div>
          <select
            value={filterOpp}
            onChange={e => setFilterOpp(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200"
          >
            <option value="ALL">All opportunities</option>
            {Object.keys(OPP_META).map(k => <option key={k} value={k}>{OPP_META[k].label}</option>)}
          </select>
          <select
            value={filterTier}
            onChange={e => setFilterTier(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200"
          >
            <option value="ALL">All tiers</option>
            <option value="VIP">VIP</option>
            <option value="Core">Core</option>
            <option value="Emerging">Emerging</option>
          </select>
        </div>
      )}

      {/* Results table */}
      {result && (
        <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="p-3 font-medium">Customer</th>
                <th className="p-3 font-medium">Tier / Stage</th>
                <th className="p-3 font-medium">Spend / Orders</th>
                <th className="p-3 font-medium">Last / Cadence</th>
                <th className="p-3 font-medium">Top Opportunity</th>
                <th className="p-3 font-medium">Why</th>
                <th className="p-3 font-medium text-right">Score</th>
                <th className="p-3 font-medium text-right">Est. ₹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ email, opps, f }) => {
                const top = opps[0];
                const meta = OPP_META[top.opportunity] || {};
                const Icon = meta.icon || TrendingUp;
                return (
                  <tr
                    key={email}
                    onClick={() => setActiveEmail(email)}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                  >
                    <td className="p-3">
                      <div className="text-slate-200">{f.first_name || '—'} {f.last_name || ''}</div>
                      <div className="text-[11px] text-slate-500">{email}</div>
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium mr-1 ${
                        f.value_tier === 'VIP' ? 'bg-fuchsia-500/15 text-fuchsia-300' :
                        f.value_tier === 'Core' ? 'bg-cyan-500/15 text-cyan-300' :
                        'bg-gray-700/50 text-slate-400'
                      }`}>{f.value_tier}</span>
                      <div className="text-[11px] text-slate-500 mt-1">{f.lifecycle_stage?.replace(/_/g,' ')}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-slate-200">₹{Math.round(f.true_spend_lifetime).toLocaleString('en-IN')}</div>
                      <div className="text-[11px] text-slate-500">{f.true_orders_lifetime} orders · AOV ₹{Math.round(f.aov_lifetime)}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-slate-200 flex items-center gap-1"><Clock className="w-3 h-3" /> {f.days_since_last_order ?? '—'}d</div>
                      <div className="text-[11px] text-slate-500">typical {f.gap_median ?? '—'}d</div>
                    </td>
                    <td className="p-3">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${meta.color}`}>
                        <Icon className="w-3.5 h-3.5" /> {meta.label || top.opportunity}
                      </div>
                      {top.recommended_skus?.length > 0 && (
                        <div className="text-[11px] text-slate-500 mt-1 truncate max-w-[200px]">
                          → {top.recommended_skus.slice(0,2).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-[12px] text-slate-400 max-w-[260px]">{top.reason}</td>
                    <td className="p-3 text-right text-slate-200 tabular-nums">{top.score.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums text-emerald-400">₹{Math.round(top.expected_incremental_revenue).toLocaleString('en-IN')}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500 text-sm">No customers match the current filters.</td></tr>
              )}
            </tbody>
          </table>
          {rows.length >= 500 && (
            <div className="p-3 text-center text-xs text-slate-500 bg-gray-900/50 border-t border-gray-800">
              Showing top 500 — use filters or search to narrow.
            </div>
          )}
        </div>
      )}

      {activeEmail && result && (
        <CustomerDrawer
          email={activeEmail}
          features={result.features[activeEmail]}
          opps={result.byCustomer[activeEmail] || []}
          orders={bd.orders || []}
          sends={brandSends.filter(s => s.email === activeEmail)}
          lookup={lookup}
          onClose={() => setActiveEmail(null)}
        />
      )}
    </div>
  );
}

function CustomerDrawer({ email, features, opps, orders, sends, lookup, onClose }) {
  const f = features || {};
  const myOrders = useMemo(
    () => orders
      .filter(o => (o.email || o.customer?.email || '').toLowerCase() === email.toLowerCase() && !o.cancelled_at)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 30),
    [orders, email],
  );

  const sortedSends = useMemo(
    () => [...sends].sort((a, b) => b.sent_at - a.sent_at).slice(0, 20),
    [sends],
  );

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex justify-end" onClick={onClose}>
      <div
        className="bg-gray-950 border-l border-gray-800 h-full w-full max-w-2xl overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-950 border-b border-gray-800 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="text-white font-semibold">{f.first_name || '—'} {f.last_name || ''}</div>
            <div className="text-xs text-slate-500">{email}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Vitals */}
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Tier"      value={f.value_tier || '—'} />
            <MiniStat label="Stage"     value={(f.lifecycle_stage || '—').replace(/_/g,' ')} />
            <MiniStat label="Orders"    value={(f.true_orders_lifetime || 0).toLocaleString()} />
            <MiniStat label="Spend"     value={'₹' + Math.round(f.true_spend_lifetime || 0).toLocaleString('en-IN')} />
            <MiniStat label="AOV"       value={'₹' + Math.round(f.aov_lifetime || 0).toLocaleString('en-IN')} />
            <MiniStat label="Last order" value={f.days_since_last_order != null ? `${f.days_since_last_order}d` : '—'} />
            <MiniStat label="Cadence"   value={f.gap_median != null ? `${f.gap_median}d` : '—'} />
            <MiniStat label="RFM"       value={f.rfm_segment || '—'} />
          </div>

          {/* Ranked opportunities */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Ranked opportunities</div>
            <div className="space-y-2">
              {opps.map((o, i) => {
                const p = productFor(o.recommended_skus?.[0], lookup);
                return (
                  <div key={o.opportunity + i} className="rounded-lg bg-gray-900/60 border border-gray-800 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-200 font-medium">{(OPP_META[o.opportunity]?.label) || o.opportunity}</div>
                      <div className="text-xs text-emerald-400 tabular-nums">₹{Math.round(o.expected_incremental_revenue).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="text-[12px] text-slate-400 mt-1">{o.reason}</div>
                    {o.recommended_skus?.length > 0 && (
                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
                        {o.recommended_skus.slice(0, 4).map(s => {
                          const pr = productFor(s, lookup);
                          return (
                            <a
                              key={s}
                              href={pr.url || '#'}
                              target="_blank" rel="noreferrer"
                              className="text-slate-300 hover:text-brand-300 inline-flex items-center gap-1"
                              onClick={e => !pr.url && e.preventDefault()}
                            >
                              {pr.name ? `${s} · ${pr.name}` : s}
                              {pr.url && <ExternalLink className="w-3 h-3" />}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {!opps.length && <div className="text-slate-500 text-sm">No active opportunities.</div>}
            </div>
          </div>

          {/* Send history */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
              <Send className="w-3 h-3" /> Send history ({sortedSends.length})
            </div>
            {sortedSends.length ? (
              <div className="rounded-lg bg-gray-900/60 border border-gray-800 divide-y divide-gray-800">
                {sortedSends.map(s => (
                  <div key={s.id} className="px-3 py-2 text-xs flex items-center justify-between">
                    <div>
                      <div className="text-slate-200">{(OPP_META[s.opportunity]?.label) || s.opportunity}</div>
                      <div className="text-slate-500 text-[10px]">{new Date(s.sent_at).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      {s.was_holdout
                        ? <span className="text-[10px] text-slate-500">holdout</span>
                        : <span className="text-[10px] text-emerald-400">sent</span>}
                      {s.converted && <div className="text-[10px] text-amber-400">converted ₹{Math.round(s.attributed_rev||0)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm">No sends logged for this customer yet.</div>
            )}
          </div>

          {/* Recent orders */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
              <ShoppingBag className="w-3 h-3" /> Orders ({myOrders.length})
            </div>
            {myOrders.length ? (
              <div className="rounded-lg bg-gray-900/60 border border-gray-800 divide-y divide-gray-800">
                {myOrders.map(o => (
                  <div key={o.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-200">#{o.name || o.id}</div>
                      <div className="text-slate-300 tabular-nums">₹{Math.round(parseFloat(o.total_price || 0)).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="text-slate-500 text-[10px] mt-0.5">
                      {new Date(o.created_at).toLocaleDateString()} · {(o.line_items || []).length} item(s)
                    </div>
                    {(o.line_items || []).slice(0, 3).length > 0 && (
                      <div className="text-slate-400 text-[11px] mt-1 flex flex-wrap gap-1">
                        {(o.line_items || []).slice(0, 3).map((li, i) => {
                          const pr = productFor(li.sku, lookup);
                          return <span key={i} className="text-slate-400">{pr.name || li.title || li.sku}{i < Math.min(2, o.line_items.length - 1) ? ',' : ''}</span>;
                        })}
                        {o.line_items.length > 3 && <span className="text-slate-600">+{o.line_items.length - 3} more</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm">No orders on file for this customer.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-gray-900/60 border border-gray-800 px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold text-slate-100 tabular-nums">{value}</div>
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
function Card({ title, children }) {
  return (
    <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-medium tabular-nums">{value}</span>
    </div>
  );
}
