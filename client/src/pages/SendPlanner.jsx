import { useState, useMemo, useEffect } from 'react';
import { Send, AlertCircle, Shield, Download, CheckCircle2, Info, Upload, X, FileText, Eye } from 'lucide-react';
import { useStore } from '../store';
import { buildAllFeatures } from '../lib/retention/features';
import { buildAffinity } from '../lib/retention/affinity';
import { buildTaxonomy, applyTaxonomy } from '../lib/retention/taxonomy';
import { rankAllOpportunities } from '../lib/retention/opportunities';
import { planSends } from '../lib/retention/planner';
import { appendSends, loadAllSends, buildCustomerStateFromSends } from '../lib/sendLog';
import { buildProductLookup, productFor } from '../lib/retention/productLookup';
import { downloadCsv } from '../lib/retention/exportCsv';
import { publishPlanToListmonk } from '../lib/retention/publish';
import { OPP_TEMPLATES, renderPreview } from '../lib/retention/emailTemplates';
import { fitBrandSurvival, makeCustomerHazard, makeSkuHazard } from '../lib/retention/survival';
import { buildRecommender } from '../lib/retention/recommender';
import { attributeOrders } from '../lib/retention/attribution';
import { buildUpliftTable, indexUplift, lookupLift } from '../lib/retention/uplift';
import { updateBandit, makeBanditWeight } from '../lib/retention/bandit';
import { buildSuppressionSet } from '../lib/suppression';

const BANDIT_KEY = 'retention:bandit:v1';
const BRAND_WEIGHTS_KEY = 'retention:brandWeights:v1';
const PER_BRAND_FATIGUE_KEY = 'retention:perBrandFatigue:v1';

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

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
  const [logCount, setLogCount] = useState(0);
  const [confirmStatus, setConfirmStatus] = useState(null);
  const [brandCtx, setBrandCtx] = useState({});   // brand_id → { lookup, features, shop }
  const [publishing, setPublishing] = useState(false);
  const [publishLog, setPublishLog] = useState([]);
  const [publishResults, setPublishResults] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [previewOpp, setPreviewOpp] = useState(null);
  const [startNow, setStartNow] = useState(false);
  const [brandWeights, setBrandWeights] = useState(() => loadJson(BRAND_WEIGHTS_KEY, {}));
  const [perBrandFatigue, setPerBrandFatigue] = useState(() => loadJson(PER_BRAND_FATIGUE_KEY, {}));
  const [killedCells, setKilledCells] = useState([]);   // uplift auto-kill log
  const [banditSummary, setBanditSummary] = useState(null);

  const run = async () => {
    setComputing(true);
    setPlan(null);
    setConfirmStatus(null);

    // Hydrate fatigue/cooldown state + bandit posteriors from persisted history.
    // Uplift table is re-derived each run from attributed sends so new learning
    // lands immediately without a manual rebuild step.
    const sendsLog = await loadAllSends();
    setLogCount(sendsLog.length);
    const customerState = buildCustomerStateFromSends(sendsLog);

    // Re-attribute all sends against all known orders so the uplift table
    // reflects the most recent week of deliveries.
    const allOrders = [];
    for (const b of activeBrands) {
      const list = brandData[b.id]?.orders || [];
      for (const o of list) allOrders.push({ ...o, _brandId: b.id });
    }
    const attributed = attributeOrders(sendsLog, allOrders, { windowDays: 7 });
    const { rows: upliftRows } = buildUpliftTable(attributed);
    const upliftIndex = indexUplift(upliftRows);
    setKilledCells(upliftRows.filter(r => r.kill));

    // Bandit state: load previous posteriors, fold in new attributed sends.
    let banditState = loadJson(BANDIT_KEY, null);
    banditState = updateBandit(banditState, attributed);
    saveJson(BANDIT_KEY, banditState);
    const banditWeightFn = makeBanditWeight(banditState);

    // Load suppression registry once (cross-brand).
    const suppressionSet = await buildSuppressionSet();

    await new Promise(r => setTimeout(r, 20));
    const allFlat = [];
    const ctx = {};
    for (const b of activeBrands) {
      const bd = brandData[b.id] || {};
      const orders = bd.orders || [];
      if (!orders.length) continue;
      const customers = bd.customers || [];
      const taxonomy = buildTaxonomy(orders);
      applyTaxonomy(orders, taxonomy.skuLabel);
      const { features, replenish } = buildAllFeatures(orders, customers);
      const affinity = buildAffinity(orders);

      // ML primitives per brand (fit once, reuse across all scorers).
      const survivalFits = fitBrandSurvival(orders);
      const customerHazard = makeCustomerHazard(survivalFits);
      const skuHazard = makeSkuHazard(survivalFits);
      const recommender = buildRecommender(orders);
      const lookup = buildProductLookup(b, bd.inventoryMap);

      const { flat } = rankAllOpportunities({
        features,
        replenishClock: replenish,
        copurchase: affinity.copurchase,
        taxonomy,
        newLaunches: affinity.newLaunches,
        orders,
        skuHazard,
        customerHazard,
        recommender,
        lookup,
      });
      ctx[b.id] = { features, lookup, survivalFits, recommender };
      for (const row of flat) {
        const f = features[row.email];
        allFlat.push({
          ...row,
          brand: b.name,
          brand_id: b.id,
          accepts_email_marketing: f?.accepts_email_marketing,
          consent: f?.accepts_email_marketing ? true : false,
          value_tier: f?.value_tier || 'unknown',
          lifecycle_stage: f?.lifecycle_stage || 'unknown',
        });
      }
    }
    setBrandCtx(ctx);
    const result = planSends(allFlat, customerState, {
      dailyCap, holdoutPct, fatigueMax, cooldownHours, minScore,
      upliftIndex, lookupLift,
      banditWeight: banditWeightFn,
      suppressionSet,
      brandWeights,
      perBrandFatigue,
    });
    setPlan(result);
    setBanditSummary({ arms: Object.keys(banditState.arms || {}).length, updated_at: banditState.updated_at });
    setComputing(false);
  };

  const confirmPlan = async () => {
    if (!plan?.picks?.length) return;
    const campaignId = `plan_${new Date().toISOString().slice(0, 10)}_${Date.now().toString(36)}`;
    const now = Date.now();
    const records = plan.picks.map(p => ({
      id:             `${p.brand_id}|${p.email}|${now}`,
      brand_id:       p.brand_id,
      email:          p.email,
      opportunity:    p.opportunity,
      score:          p.score,
      expected_rev:   p.expected_incremental_revenue,
      skus:           p.recommended_skus || [],
      reason:         p.reason,
      sent_at:        now,
      was_holdout:    false,
      channel:        'email',
      campaign_id:    campaignId,
      converted:      null,
      converted_at:   null,
      attributed_rev: null,
    }));
    // Also log the holdout slice (picks that would have been sent but held out)
    // so performance can measure send-vs-holdout uplift.
    const holdouts = plan.deferred.filter(d => d.skip_reason === 'holdout').map(p => ({
      id:             `${p.brand_id}|${p.email}|${now}|h`,
      brand_id:       p.brand_id,
      email:          p.email,
      opportunity:    p.opportunity,
      score:          p.score,
      expected_rev:   p.expected_incremental_revenue,
      skus:           p.recommended_skus || [],
      reason:         p.reason,
      sent_at:        now,
      was_holdout:    true,
      channel:        'none',
      campaign_id:    campaignId,
      converted:      null,
      converted_at:   null,
      attributed_rev: null,
    }));
    const res = await appendSends([...records, ...holdouts]);
    setConfirmStatus({ ok: true, added: res.added, campaignId });
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const topPicks = useMemo(() => (plan?.picks || []).slice(0, 200), [plan]);

  const deferReasons = useMemo(() => {
    if (!plan) return {};
    const m = {};
    for (const d of plan.deferred) m[d.skip_reason] = (m[d.skip_reason] || 0) + 1;
    return m;
  }, [plan]);

  // Columns in the export line up 1:1 with Listmonk `{{ .Attribs.xxx }}`
  // merge fields. Upload this CSV as a subscriber list and each subscriber
  // carries the right attributes for mail-merge.
  const MAIL_MERGE_COLUMNS = [
    'email','brand','first_name','last_name',
    'opportunity','reason',
    'primary_sku','sku_name','product_url','product_image','price',
    'recommended_skus','recommended_names','recommended_urls',
    'days_since_last','value_tier','lifecycle_stage',
    'score','expected_rev','campaign_tag',
  ];

  const buildMailMergeRows = () => {
    if (!plan?.picks?.length) return [];
    const campaignTag = `plan_${new Date().toISOString().slice(0, 10)}`;
    return plan.picks.map(p => {
      const c = brandCtx[p.brand_id] || {};
      const f = c.features?.[p.email] || {};
      const lookup = c.lookup || {};
      const skus = p.recommended_skus || [];
      const primary = skus[0] || '';
      const primaryProd = productFor(primary, lookup);
      return {
        email: p.email,
        brand: p.brand || '',
        first_name: f.first_name || '',
        last_name:  f.last_name  || '',
        opportunity: p.opportunity,
        reason: p.reason || '',
        primary_sku: primary,
        sku_name: primaryProd.name,
        product_url: primaryProd.url,
        product_image: primaryProd.image || '',
        price: primaryProd.price || 0,
        recommended_skus: skus.join('|'),
        recommended_names: skus.map(s => productFor(s, lookup).name).filter(Boolean).join('|'),
        recommended_urls:  skus.map(s => productFor(s, lookup).url ).filter(Boolean).join('|'),
        days_since_last: f.days_since_last_order ?? '',
        value_tier: f.value_tier || '',
        lifecycle_stage: f.lifecycle_stage || '',
        score: Number(p.score?.toFixed(3) || 0),
        expected_rev: Math.round(p.expected_incremental_revenue || 0),
        campaign_tag: campaignTag,
      };
    });
  };

  const exportCsv = () => {
    const rows = buildMailMergeRows();
    if (!rows.length) return;
    downloadCsv(rows, 'send-plan', MAIL_MERGE_COLUMNS);
  };

  // Unique brand/opportunity pairs present in the plan, used for
  // the publish preview ("N lists to touch in Listmonk").
  const brandOppPairs = useMemo(() => {
    if (!plan?.picks) return [];
    const map = {};
    for (const p of plan.picks) {
      const key = `${p.brand_id}|${p.opportunity}`;
      if (!map[key]) map[key] = { brand: p.brand, brand_id: p.brand_id, opportunity: p.opportunity, count: 0 };
      map[key].count++;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [plan]);

  // Per-brand readiness — user sees which brands are wired up.
  const publishReadiness = useMemo(() => {
    const map = {};
    for (const b of brands) {
      const cfg = b.listmonk || {};
      map[b.id] = {
        name: b.name,
        configured: !!(cfg.url && cfg.username && cfg.password && cfg.fromEmail),
      };
    }
    return map;
  }, [brands]);

  const runPublish = async ({ dryRun }) => {
    if (!plan?.picks?.length) return;
    setPublishing(true);
    setPublishLog([]);
    setPublishResults(null);
    try {
      const campaignTag = `plan_${new Date().toISOString().slice(0, 10)}_${Date.now().toString(36)}`;
      const results = await publishPlanToListmonk(
        plan.picks, brands, brandCtx,
        {
          dryRun,
          startNow: !dryRun && startNow,
          campaignTag,
          onProgress: ({ msg }) => setPublishLog(prev => [...prev, { t: Date.now(), msg }]),
        },
      );
      setPublishResults(results);
    } catch (e) {
      setPublishLog(prev => [...prev, { t: Date.now(), msg: `❌ ${e.message}` }]);
    } finally {
      setPublishing(false);
    }
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
            onClick={confirmPlan}
            disabled={!plan?.picks?.length || confirmStatus?.ok}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white font-medium flex items-center gap-2"
            title="Persist this plan to the send log so fatigue/cooldown apply to future runs and performance tracking can attribute orders."
          >
            <CheckCircle2 className="w-4 h-4" />
            {confirmStatus?.ok ? `Confirmed (${confirmStatus.added})` : 'Confirm Plan'}
          </button>
          <button
            onClick={exportCsv}
            disabled={!plan?.picks.length}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-sm text-slate-200 flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => setPublishOpen(true)}
            disabled={!plan?.picks?.length}
            className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white font-medium flex items-center gap-2"
            title="Push subscribers + campaign drafts directly to Listmonk"
          >
            <Upload className="w-4 h-4" /> Publish to Listmonk
          </button>
        </div>
      </div>

      {logCount > 0 && (
        <div className="text-xs text-slate-500">
          Send log has <span className="text-slate-300 font-medium">{logCount.toLocaleString()}</span> records applied for fatigue + cooldown.
        </div>
      )}

      {/* Mail-merge doc */}
      <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-sky-300 mb-2">
          <Info className="w-3.5 h-3.5" /> How to personalize emails in Listmonk
        </div>
        <div className="text-xs text-slate-300 leading-relaxed space-y-2">
          <div>
            The exported CSV contains one row per subscriber + per-row attributes ready for mail-merge.
            Import it in Listmonk (<em className="text-slate-400">Subscribers → Import</em>) — each
            column becomes an attribute you can reference in the campaign template:
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 pl-2 font-mono text-[11px] text-slate-400">
            <div><code className="text-emerald-300">{'{{ .Attribs.first_name }}'}</code> — greeting</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.sku_name }}'}</code> — recommended product</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.product_url }}'}</code> — deep link</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.product_image }}'}</code> — hero image</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.reason }}'}</code> — why this pick</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.opportunity }}'}</code> — bucket label</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.value_tier }}'}</code> — VIP / Core / Emerging</div>
            <div><code className="text-emerald-300">{'{{ .Attribs.campaign_tag }}'}</code> — stable id to segment later</div>
          </div>
          <div className="text-slate-500">
            Build one template per <code className="text-slate-300">opportunity</code> (REPLENISH, WINBACK…) or
            segment the list by <code className="text-slate-300">opportunity</code>/<code className="text-slate-300">value_tier</code> and send each cohort its own creative.
          </div>
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

      {/* Governance: brand weights, per-brand fatigue override, uplift kill log, bandit */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">
            Brand weights
            <span className="block normal-case text-[10px] text-slate-600 mt-0.5">
              Multiplier on expected revenue. 1.0 = neutral; raise to bias the cap toward a brand.
            </span>
          </div>
          <div className="space-y-1.5">
            {activeBrands.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-300 truncate">{b.name}</span>
                <input
                  type="number" step="0.1" min="0" max="5"
                  value={brandWeights[b.id] ?? 1}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    const next = { ...brandWeights, [b.id]: isFinite(v) ? v : 1 };
                    setBrandWeights(next); saveJson(BRAND_WEIGHTS_KEY, next);
                  }}
                  className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-slate-200 tabular-nums"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">
            Per-brand fatigue override
            <span className="block normal-case text-[10px] text-slate-600 mt-0.5">
              Blank = use global {fatigueMax}/{cooldownHours}h.
            </span>
          </div>
          <div className="space-y-1.5">
            {activeBrands.map(b => {
              const pb = perBrandFatigue[b.id] || {};
              const set = (patch) => {
                const next = { ...perBrandFatigue, [b.id]: { ...pb, ...patch } };
                setPerBrandFatigue(next); saveJson(PER_BRAND_FATIGUE_KEY, next);
              };
              return (
                <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-300 truncate flex-1">{b.name}</span>
                  <input
                    type="number" min="0" max="7" placeholder="7d"
                    value={pb.fatigueMax ?? ''}
                    onChange={e => set({ fatigueMax: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    className="w-14 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-slate-200 tabular-nums"
                    title="Max sends per 7d"
                  />
                  <input
                    type="number" min="0" step="6" placeholder="hr"
                    value={pb.cooldownHours ?? ''}
                    onChange={e => set({ cooldownHours: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-slate-200 tabular-nums"
                    title="Cooldown hours"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">Governance signal</div>
          <div className="space-y-1.5 text-xs">
            {banditSummary && (
              <div className="text-slate-400">
                Bandit arms: <span className="text-slate-200 font-medium">{banditSummary.arms}</span>
                <span className="text-slate-600"> · updated {new Date(banditSummary.updated_at).toLocaleString()}</span>
              </div>
            )}
            {killedCells.length === 0 ? (
              <div className="text-slate-500">No (brand × opp × tier) cells auto-killed by uplift data.</div>
            ) : (
              <>
                <div className="text-rose-400 font-medium">Auto-killed cells ({killedCells.length}):</div>
                <div className="max-h-32 overflow-auto space-y-0.5 pr-2">
                  {killedCells.slice(0, 20).map(k => (
                    <div key={k.brand_id + k.opportunity + k.value_tier} className="text-slate-400 tabular-nums">
                      {k.brand_id} · {k.opportunity} · {k.value_tier}
                      <span className="text-rose-400 ml-1">lift {k.shrunk_lift.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
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

      {publishOpen && (
        <PublishModal
          onClose={() => setPublishOpen(false)}
          pairs={brandOppPairs}
          readiness={publishReadiness}
          running={publishing}
          log={publishLog}
          results={publishResults}
          startNow={startNow}
          setStartNow={setStartNow}
          onPreview={(opp) => setPreviewOpp(opp)}
          onRun={runPublish}
        />
      )}

      {previewOpp && (
        <PreviewModal opp={previewOpp} onClose={() => setPreviewOpp(null)} />
      )}
    </div>
  );
}

function PublishModal({ onClose, pairs, readiness, running, log, results, startNow, setStartNow, onPreview, onRun }) {
  const totalRecipients = pairs.reduce((s, p) => s + p.count, 0);
  const groupsByBrand = useMemo(() => {
    const m = {};
    for (const p of pairs) (m[p.brand_id] ||= []).push(p);
    return m;
  }, [pairs]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-white font-semibold">Publish plan to Listmonk</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {totalRecipients.toLocaleString()} recipients · {pairs.length} campaign{pairs.length !== 1 ? 's' : ''} across {Object.keys(groupsByBrand).length} brand{Object.keys(groupsByBrand).length !== 1 ? 's' : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-auto flex-1">
          {/* Brand × opportunity preview */}
          <div className="rounded-lg bg-gray-900/60 border border-gray-800">
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-gray-800">
              Campaigns to be created
            </div>
            <div className="divide-y divide-gray-800">
              {Object.entries(groupsByBrand).map(([brandId, rows]) => {
                const r = readiness[brandId] || {};
                return (
                  <div key={brandId} className="px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-200 font-medium">{r.name || brandId}</div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.configured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                        {r.configured ? 'Listmonk ready' : 'Not configured — skipped'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {rows.map(p => {
                        const tpl = OPP_TEMPLATES[p.opportunity];
                        return (
                          <button
                            key={p.brand_id + p.opportunity}
                            onClick={() => onPreview(p.opportunity)}
                            className="px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 text-[11px] text-slate-200 flex items-center gap-1.5"
                            title="Preview template"
                          >
                            <Eye className="w-3 h-3 text-slate-500" />
                            {tpl?.label || p.opportunity}
                            <span className="text-slate-500">· {p.count.toLocaleString()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!pairs.length && <div className="px-3 py-6 text-sm text-slate-500 text-center">No picks to publish.</div>}
            </div>
          </div>

          {/* Options */}
          <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={startNow}
              onChange={e => setStartNow(e.target.checked)}
              className="mt-0.5"
              disabled={running}
            />
            <div>
              <div>Start campaigns immediately</div>
              <div className="text-[11px] text-slate-500">
                Unchecked creates drafts — you can review and launch from Listmonk. Recommended for the first run.
              </div>
            </div>
          </label>

          {/* Run log */}
          {log.length > 0 && (
            <div className="rounded-lg bg-black/40 border border-gray-800 p-3 font-mono text-[11px] text-slate-300 max-h-56 overflow-auto">
              {log.map(l => <div key={l.t + l.msg}>{l.msg}</div>)}
            </div>
          )}

          {/* Results summary */}
          {results && (
            <div className="rounded-lg bg-gray-900/60 border border-gray-800 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Results</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <SmallStat label="Succeeded" value={results.filter(r => r.ok).length} accent="text-emerald-400" />
                <SmallStat label="Failed"    value={results.filter(r => !r.ok).length} accent="text-red-400" />
                <SmallStat label="Total subs" value={results.reduce((s, r) => s + (r.recipients || 0), 0)} />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-slate-200" disabled={running}>
            Close
          </button>
          <button
            onClick={() => onRun({ dryRun: true })}
            disabled={running || !pairs.length}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-xs text-slate-200 flex items-center gap-1.5"
            title="Walk the pipeline without writing anything to Listmonk"
          >
            <FileText className="w-3.5 h-3.5" /> Dry-run
          </button>
          <button
            onClick={() => onRun({ dryRun: false })}
            disabled={running || !pairs.length}
            className="px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-xs text-white font-medium flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" /> {running ? 'Publishing…' : (startNow ? 'Publish + send' : 'Publish drafts')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ opp, onClose }) {
  const tpl = OPP_TEMPLATES[opp];
  if (!tpl) return null;
  const rendered = renderPreview(tpl.body);
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-white font-semibold">{tpl.label} — preview</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{tpl.rationale}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-auto">
          <div className="px-5 py-3 bg-gray-900/60 border-b border-gray-800 text-xs">
            <span className="text-slate-500">Subject: </span>
            <span className="text-slate-200 font-medium">{renderPreview(tpl.subject)}</span>
          </div>
          <div className="p-6 bg-white text-gray-900" dangerouslySetInnerHTML={{ __html: rendered }} />
        </div>
      </div>
    </div>
  );
}

function SmallStat({ label, value, accent = 'text-slate-100' }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-black/30 border border-gray-800">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${accent}`}>{value.toLocaleString()}</div>
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
