import { useState, useMemo, useEffect } from 'react';
import { Send, AlertCircle, Shield, Download } from 'lucide-react';
import { useStore } from '../store';
import { buildAllFeatures } from '../lib/retention/features';
import { buildAffinity } from '../lib/retention/affinity';
import { buildTaxonomy, applyTaxonomy } from '../lib/retention/taxonomy';
import { rankAllOpportunities } from '../lib/retention/opportunities';
import { planSends } from '../lib/retention/planner';

const OPP_LABEL = {
  REPLENISH: 'Replenish', COMPLEMENT: 'Complement', WINBACK: 'Winback',
  NEW_LAUNCH: 'New Launch', UPSELL: 'Upsell', VIP_PROTECT: 'VIP Protect',
};

export default function SendPlanner() {
  const { brands, activeBrandIds, brandData } = useStore();
  const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));

  const [dailyCap, setDailyCap] = useState(240_000);
  const [holdoutPct, setHoldoutPct] = useState(0.05);
  const [fatigueMax, setFatigueMax] = useState(2);
  const [cooldownHours, setCooldownHours] = useState(48);
  const [minScore, setMinScore] = useState(0.2);
  const [computing, setComputing] = useState(false);
  const [plan, setPlan] = useState(null);

  const run = () => {
    setComputing(true);
    setPlan(null);
    setTimeout(() => {
      const allFlat = [];
      for (const b of activeBrands) {
        const bd = brandData[b.id] || {};
        const orders = bd.orders || [];
        if (!orders.length) continue;
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
        for (const row of flat) {
          allFlat.push({
            ...row,
            brand: b.name,
            brand_id: b.id,
            accepts_email_marketing: features[row.email]?.accepts_email_marketing,
            consent: features[row.email]?.accepts_email_marketing ? true : false,
          });
        }
      }
      const result = planSends(allFlat, {}, {
        dailyCap, holdoutPct, fatigueMax, cooldownHours, minScore,
      });
      setPlan(result);
      setComputing(false);
    }, 50);
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const topPicks = useMemo(() => (plan?.picks || []).slice(0, 200), [plan]);

  const deferReasons = useMemo(() => {
    if (!plan) return {};
    const m = {};
    for (const d of plan.deferred) m[d.skip_reason] = (m[d.skip_reason] || 0) + 1;
    return m;
  }, [plan]);

  const exportCsv = () => {
    if (!plan?.picks.length) return;
    const header = ['brand','email','opportunity','score','expected_incremental_revenue','recommended_skus','reason'];
    const rows = plan.picks.map(p => [
      p.brand || '',
      p.email,
      p.opportunity,
      p.score,
      p.expected_incremental_revenue,
      (p.recommended_skus || []).join('|'),
      (p.reason || '').replace(/"/g, '""'),
    ]);
    const csv = [header.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `send-plan-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Send Planner</h1>
          <p className="text-sm text-slate-400 mt-1">
            Global daily allocation across brands under the {dailyCap.toLocaleString()} send cap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={computing}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-sm text-white font-medium"
          >
            {computing ? 'Computing…' : 'Recompute'}
          </button>
          <button
            onClick={exportCsv}
            disabled={!plan?.picks.length}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-sm text-slate-200 flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-5 gap-3">
        <Knob label="Daily cap" value={dailyCap} onChange={v => setDailyCap(parseInt(v, 10) || 0)} min={0} step={1000} />
        <Knob label="Holdout %" value={holdoutPct} onChange={v => setHoldoutPct(parseFloat(v) || 0)} min={0} max={0.2} step={0.01} />
        <Knob label="Fatigue / 7d" value={fatigueMax} onChange={v => setFatigueMax(parseInt(v, 10) || 0)} min={0} max={7} step={1} />
        <Knob label="Cooldown (h)" value={cooldownHours} onChange={v => setCooldownHours(parseInt(v, 10) || 0)} min={0} step={6} />
        <Knob label="Min score" value={minScore} onChange={v => setMinScore(parseFloat(v) || 0)} min={0} max={1} step={0.05} />
      </div>

      {plan && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            <Stat icon={<Send className="w-5 h-5" />}      label="Picked"           value={plan.summary.total_picked.toLocaleString()} accent="text-emerald-400" />
            <Stat icon={<Shield className="w-5 h-5" />}    label="Held out / filt." value={plan.summary.total_deferred.toLocaleString()} accent="text-slate-300" />
            <Stat icon={<AlertCircle className="w-5 h-5"/>} label="Fill ratio"       value={(plan.summary.fill_ratio * 100).toFixed(1) + '%'} accent="text-cyan-400" />
            <Stat label="Est. incremental revenue" value={'₹' + Math.round(plan.summary.expected_incremental_revenue).toLocaleString('en-IN')} accent="text-amber-400" />
          </div>

          {/* By brand / opp */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Sends by Brand</div>
              <div className="space-y-1.5">
                {Object.entries(plan.summary.by_brand).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">{k}</span>
                    <span className="tabular-nums text-slate-100 font-medium">{v.toLocaleString()}</span>
                  </div>
                ))}
                {!Object.keys(plan.summary.by_brand).length && (
                  <div className="text-slate-500 text-sm">No sends allocated.</div>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Sends by Opportunity</div>
              <div className="space-y-1.5">
                {Object.entries(plan.summary.by_opportunity).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">{OPP_LABEL[k] || k}</span>
                    <span className="tabular-nums text-slate-100 font-medium">{v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Defer reasons */}
          {Object.keys(deferReasons).length > 0 && (
            <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Why filtered / deferred</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(deferReasons).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
                  <span key={k} className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-slate-300">
                    <span className="text-slate-500">{k.replace(/_/g,' ')}</span> <span className="font-medium text-slate-100">{v.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top picks */}
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-500">Top picks (preview first 200)</div>
              <div className="text-xs text-slate-500">Sorted by expected incremental revenue</div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-900 border-b border-gray-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Brand</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Opportunity</th>
                  <th className="p-3 font-medium">SKUs</th>
                  <th className="p-3 font-medium">Why</th>
                  <th className="p-3 font-medium text-right">Score</th>
                  <th className="p-3 font-medium text-right">Est. ₹</th>
                </tr>
              </thead>
              <tbody>
                {topPicks.map((p, i) => (
                  <tr key={p.brand_id + ':' + p.email + ':' + i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="p-3 text-slate-300">{p.brand}</td>
                    <td className="p-3 text-slate-200 text-xs">{p.email}</td>
                    <td className="p-3 text-slate-300">{OPP_LABEL[p.opportunity] || p.opportunity}</td>
                    <td className="p-3 text-slate-400 text-xs max-w-[180px] truncate">{(p.recommended_skus || []).join(', ')}</td>
                    <td className="p-3 text-slate-400 text-xs max-w-[260px]">{p.reason}</td>
                    <td className="p-3 text-right tabular-nums text-slate-200">{p.score.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums text-emerald-400">₹{Math.round(p.expected_incremental_revenue).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {topPicks.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-slate-500">No picks — import data for at least one brand.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Knob({ label, value, onChange, ...rest }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-slate-200"
        {...rest}
      />
    </label>
  );
}
function Stat({ icon, label, value, accent = 'text-slate-100' }) {
  return (
    <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
