import { useState, useEffect, useMemo } from 'react';
import { Gauge, Activity, Layers, Target, Zap, AlertTriangle } from 'lucide-react';
import { useStore } from '../store';
import { fitBrandSurvival, survival } from '../lib/retention/survival';
import { buildRecommender } from '../lib/retention/recommender';
import { fitBrandElasticity } from '../lib/retention/elasticity';
import { attributeOrders } from '../lib/retention/attribution';
import { buildUpliftTable } from '../lib/retention/uplift';
import { summarizeBandit } from '../lib/retention/bandit';
import { loadAllSends } from '../lib/sendLog';
import { oosSkus } from '../lib/retention/productLookup';
import { buildProductLookup } from '../lib/retention/productLookup';

const OPP_LABEL = {
  REPLENISH: 'Replenish', COMPLEMENT: 'Complement', WINBACK: 'Winback',
  NEW_LAUNCH: 'New Launch', UPSELL: 'Upsell', VIP_PROTECT: 'VIP Protect',
};

export default function ModelDiagnostics() {
  const { brands, activeBrandIds, brandData } = useStore();
  const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));

  const [survFits, setSurvFits] = useState({});
  const [recStats, setRecStats] = useState({});
  const [oosByBrand, setOosByBrand] = useState({});
  const [elasticity, setElasticity] = useState({});
  const [uplift, setUplift] = useState([]);
  const [bandit, setBandit] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const surv = {}, rs = {}, oos = {};
      const allOrders = [];
      for (const b of activeBrands) {
        const bd = brandData[b.id] || {};
        const orders = bd.orders || [];
        if (!orders.length) continue;
        const s = fitBrandSurvival(orders);
        surv[b.id] = { brand: b.name, ...s };
        const rec = buildRecommender(orders);
        const skuCount = Object.keys(rec.contentIndex).length;
        const collabSizes = Object.values(rec.collabNeighbors).map(v => v.length);
        const contentSizes = Object.values(rec.contentNeighbors).map(v => v.length);
        const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
        rs[b.id] = {
          brand: b.name,
          sku_count: skuCount,
          avg_collab_neighbors: +avg(collabSizes).toFixed(1),
          avg_content_neighbors: +avg(contentSizes).toFixed(1),
          collab_anchors: Object.keys(rec.collabNeighbors).length,
        };
        const lookup = buildProductLookup(b, bd.inventoryMap);
        oos[b.id] = { brand: b.name, oos: oosSkus(lookup, 1), total: Object.keys(lookup).length };
        for (const o of orders) allOrders.push({ ...o, _brandId: b.id });
      }
      setSurvFits(surv);
      setRecStats(rs);
      setOosByBrand(oos);

      const sends = await loadAllSends();
      const attributed = attributeOrders(sends, allOrders, { windowDays: 7 });
      setElasticity(fitBrandElasticity(attributed));
      const { rows } = buildUpliftTable(attributed);
      setUplift(rows);

      try {
        const raw = localStorage.getItem('retention:bandit:v1');
        const state = raw ? JSON.parse(raw) : null;
        setBandit(state ? summarizeBandit(state) : []);
      } catch { setBandit([]); }

      setLoading(false);
    })();
  }, [activeBrandIds.join(',')]);   // eslint-disable-line

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Gauge className="w-6 h-6 text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Model Diagnostics</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Visibility into the ML primitives driving opportunity scoring and
            the global allocator — Weibull timing, recommender, elasticity,
            uplift, bandit.
          </p>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500">Fitting models…</div>}

      {/* SURVIVAL */}
      <Section icon={<Activity className="w-4 h-4" />} title="Weibull survival (next-order timing)">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500">
            <tr>
              <Th>Brand</Th><Th>n gaps</Th><Th>mean</Th><Th>median</Th><Th>shape k</Th><Th>scale λ</Th>
              <Th>S(30d)</Th><Th>S(60d)</Th><Th>S(90d)</Th>
              <Th>customers fitted</Th><Th>SKUs fitted</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(survFits).map(([bid, s]) => {
              const f = s.brandFit;
              const nCust = Object.values(s.customerFits || {}).filter(Boolean).length;
              const nSku  = Object.values(s.skuFits || {}).filter(Boolean).length;
              return (
                <tr key={bid} className="border-b border-gray-800/50">
                  <Td>{s.brand}</Td>
                  <Td>{f?.n ?? '—'}</Td>
                  <Td>{f ? f.mean + 'd' : '—'}</Td>
                  <Td>{f ? f.median + 'd' : '—'}</Td>
                  <Td>{f ? f.k.toFixed(2) : '—'}</Td>
                  <Td>{f ? f.lambda.toFixed(1) : '—'}</Td>
                  <Td>{f ? (survival(f, 30) * 100).toFixed(0) + '%' : '—'}</Td>
                  <Td>{f ? (survival(f, 60) * 100).toFixed(0) + '%' : '—'}</Td>
                  <Td>{f ? (survival(f, 90) * 100).toFixed(0) + '%' : '—'}</Td>
                  <Td>{nCust}</Td>
                  <Td>{nSku}</Td>
                </tr>
              );
            })}
            {!Object.keys(survFits).length && <tr><td className="p-4 text-slate-500" colSpan={11}>No brand data imported.</td></tr>}
          </tbody>
        </table>
        <div className="text-[11px] text-slate-500 p-3 border-t border-gray-800">
          k &lt; 1: increasing risk of churn over time. k ≈ 1: memoryless. k &gt; 1: a clear cadence (most retail). λ is the characteristic cadence in days.
        </div>
      </Section>

      {/* RECOMMENDER */}
      <Section icon={<Layers className="w-4 h-4" />} title="Hybrid recommender coverage">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500">
            <tr>
              <Th>Brand</Th><Th>SKUs indexed</Th><Th>Anchors w/ collab</Th>
              <Th>Avg collab neighbors</Th><Th>Avg content neighbors</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(recStats).map(([bid, r]) => (
              <tr key={bid} className="border-b border-gray-800/50">
                <Td>{r.brand}</Td><Td>{r.sku_count}</Td><Td>{r.collab_anchors}</Td>
                <Td>{r.avg_collab_neighbors}</Td><Td>{r.avg_content_neighbors}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* INVENTORY */}
      <Section icon={<AlertTriangle className="w-4 h-4" />} title="Inventory guardrail">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500">
            <tr><Th>Brand</Th><Th>SKUs</Th><Th>OOS (stock &lt; 1)</Th><Th>Sample OOS</Th></tr>
          </thead>
          <tbody>
            {Object.entries(oosByBrand).map(([bid, o]) => (
              <tr key={bid} className="border-b border-gray-800/50">
                <Td>{o.brand}</Td><Td>{o.total}</Td><Td className="text-rose-400">{o.oos.length}</Td>
                <Td className="text-xs text-slate-500 max-w-xl truncate">
                  {o.oos.slice(0, 8).map(x => x.sku).join(', ') || '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ELASTICITY */}
      <Section icon={<Zap className="w-4 h-4" />} title="Price elasticity (discount → P(buy))">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500">
            <tr>
              <Th>Brand</Th><Th>n samples</Th><Th>base rate</Th>
              <Th>β₀</Th><Th>β₁ (per %)</Th>
              <Th>P(buy @ 0%)</Th><Th>P(buy @ 10%)</Th><Th>P(buy @ 20%)</Th>
              <Th>Optimal d @ 45% margin</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(elasticity).map(([bid, e]) => (
              <tr key={bid} className={'border-b border-gray-800/50 ' + (e.ok ? '' : 'opacity-60')}>
                <Td>{bid}</Td><Td>{e.n}</Td><Td>{(e.base_rate * 100).toFixed(2)}%</Td>
                <Td>{e.b0}</Td><Td>{e.b1}</Td>
                <Td>{(e.predict(0) * 100).toFixed(2)}%</Td>
                <Td>{(e.predict(10) * 100).toFixed(2)}%</Td>
                <Td>{(e.predict(20) * 100).toFixed(2)}%</Td>
                <Td className="text-amber-400">{e.optimalDiscount(0.45)}%</Td>
              </tr>
            ))}
            {!Object.keys(elasticity).length && <tr><td className="p-4 text-slate-500" colSpan={9}>No send history yet — nothing to fit.</td></tr>}
          </tbody>
        </table>
        <div className="text-[11px] text-slate-500 p-3 border-t border-gray-800">
          Fit is marked unreliable (dimmed) when the sample has too few converters or β₁ is negative — in that case the planner falls back to the empirical rate.
        </div>
      </Section>

      {/* UPLIFT */}
      <Section icon={<Target className="w-4 h-4" />} title={`Uplift table (${uplift.length} cells)`}>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <Th>Brand</Th><Th>Opp</Th><Th>Tier</Th>
                <Th>n_sent</Th><Th>n_hold</Th>
                <Th>sent CR</Th><Th>hold CR</Th>
                <Th>raw lift</Th><Th>shrunk</Th>
                <Th>CI lo–hi</Th><Th>incr ₹/sent</Th><Th>kill</Th>
              </tr>
            </thead>
            <tbody>
              {uplift.map(r => (
                <tr key={r.brand_id + r.opportunity + r.value_tier} className={'border-b border-gray-800/50 ' + (r.kill ? 'bg-rose-900/10' : '')}>
                  <Td>{r.brand_id}</Td><Td>{OPP_LABEL[r.opportunity] || r.opportunity}</Td><Td>{r.value_tier}</Td>
                  <Td>{r.n_sent}</Td><Td>{r.n_holdout}</Td>
                  <Td>{(r.sent_cr * 100).toFixed(2)}%</Td>
                  <Td>{(r.holdout_cr * 100).toFixed(2)}%</Td>
                  <Td className={r.raw_lift >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{(r.raw_lift * 100).toFixed(2)}%</Td>
                  <Td className={r.shrunk_lift >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{(r.shrunk_lift * 100).toFixed(2)}%</Td>
                  <Td className="text-xs text-slate-500">{(r.lift_ci_lo * 100).toFixed(1)}–{(r.lift_ci_hi * 100).toFixed(1)}%</Td>
                  <Td>₹{r.incr_rev_per_sent.toFixed(2)}</Td>
                  <Td>{r.kill ? <span className="text-rose-400 font-medium">KILL</span> : <span className="text-slate-600">ok</span>}</Td>
                </tr>
              ))}
              {!uplift.length && <tr><td className="p-4 text-slate-500" colSpan={12}>Need confirmed plans + attributed orders for uplift measurement.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* BANDIT */}
      <Section icon={<Gauge className="w-4 h-4" />} title={`Bandit posteriors (${bandit.length} arms)`}>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800 text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <Th>Brand</Th><Th>Opp</Th><Th>Tier</Th>
                <Th>α</Th><Th>β</Th><Th>n</Th>
                <Th>mean</Th><Th>CI (95%)</Th>
              </tr>
            </thead>
            <tbody>
              {bandit.map(r => (
                <tr key={r.brand_id + r.opportunity + r.value_tier} className="border-b border-gray-800/50">
                  <Td>{r.brand_id}</Td><Td>{OPP_LABEL[r.opportunity] || r.opportunity}</Td><Td>{r.value_tier}</Td>
                  <Td>{r.alpha}</Td><Td>{r.beta}</Td><Td>{r.n}</Td>
                  <Td>{(r.mean * 100).toFixed(2)}%</Td>
                  <Td className="text-xs text-slate-500">{(r.ci_lo * 100).toFixed(1)}–{(r.ci_hi * 100).toFixed(1)}%</Td>
                </tr>
              ))}
              {!bandit.length && <tr><td className="p-4 text-slate-500" colSpan={8}>Bandit is empty — run a plan first.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <div className="text-xs uppercase tracking-wide text-slate-400 font-medium">{title}</div>
      </div>
      {children}
    </div>
  );
}
function Th({ children }) { return <th className="p-2.5 text-left font-medium">{children}</th>; }
function Td({ children, className = '' }) { return <td className={'p-2.5 text-slate-300 tabular-nums ' + className}>{children}</td>; }
