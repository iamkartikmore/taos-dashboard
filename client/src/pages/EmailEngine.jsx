import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Send, Upload, RefreshCw, Eye, CheckCircle, AlertCircle,
  ExternalLink, Package, Users, MousePointerClick, Mail, Clock,
} from 'lucide-react';
import { useStore } from '../store';
import { computeRfm } from '../lib/shopifyAnalytics';
import { TEMPLATES, templatesForSegment, renderTemplate, SEGMENT_META } from '../lib/emailTemplates';
import { buildEnrichmentCtx } from '../lib/emailEnrichment';
import {
  upsertListmonkTemplate, createListmonkCampaignDraft,
  fetchListmonkCampaigns, fetchListmonkCampaignStats,
} from '../lib/api';
import Spinner from '../components/ui/Spinner';

const num = v => Number(v || 0).toLocaleString('en-IN');
const pct = (a, b) => b ? `${((a / b) * 100).toFixed(1)}%` : '—';
const fmtTime = ts => ts ? new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const SEGMENT_ORDER = [
  'Champions', 'Loyal', 'Potential Loyal', 'New', 'Promising',
  'At Risk', "Can't Lose", 'Dormant',
];

const SEGMENT_ACCENT = {
  Champions:        '#15803d',
  Loyal:            '#0284c7',
  'Potential Loyal':'#0d9488',
  New:              '#0369a1',
  Promising:        '#7c3aed',
  'At Risk':        '#d97706',
  "Can't Lose":     '#b91c1c',
  Dormant:          '#6366f1',
};

function BrandPicker({ brands, selected, onChange }) {
  const eligible = brands.filter(b => b.listmonk?.url && b.listmonk?.username && b.listmonk?.password);
  if (!eligible.length) {
    return <div className="text-sm text-slate-500">No brand has Listmonk configured. Set it up in Study Manual first.</div>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500">Brand:</span>
      {eligible.map(b => (
        <button key={b.id}
          onClick={() => onChange(b.id)}
          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
            selected === b.id ? 'border-sky-500 text-sky-300 bg-sky-900/30' : 'border-gray-700 text-slate-400 hover:border-gray-600'
          }`}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

function KPI({ label, value, sub, icon: Icon, color = '#38bdf8' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ─── PREVIEW MODAL ─────────────────────────────────────────── */

function PreviewModal({ html, subject, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Subject</div>
            <div className="text-sm font-semibold text-white truncate max-w-[500px]">{subject}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-xl leading-none px-2">\u00d7</button>
        </div>
        <iframe srcDoc={html} title="Email preview" className="flex-1 w-full bg-white" />
      </div>
    </div>
  );
}

/* ─── SEGMENT CARD ─────────────────────────────────────────── */

function SegmentCard({
  segmentKey, segmentSize, template, listId, ctx, brand,
  campaigns, onPushed, onDrafted, onPreview,
}) {
  const [pushing, setPushing]     = useState(false);
  const [drafting, setDrafting]   = useState(false);
  const [pushed, setPushed]       = useState(null);   // template object after push
  const [err, setErr]             = useState('');
  const accent = SEGMENT_ACCENT[segmentKey] || '#94a3b8';

  const rendered = useMemo(() => renderTemplate(template, ctx), [template, ctx]);

  // Pull campaigns tagged with this segment (matching list_id)
  const segmentCampaigns = (campaigns || []).filter(c =>
    (c.lists || []).some(l => l.id === listId)
  );

  const perf = useMemo(() => {
    if (!segmentCampaigns.length) return null;
    const sent = segmentCampaigns.filter(c => ['finished', 'running', 'paused'].includes(c.status));
    if (!sent.length) return null;
    const tot = sent.reduce((a, c) => ({
      views:   a.views   + (c.views   || 0),
      clicks:  a.clicks  + (c.clicks  || 0),
      sent:    a.sent    + (c.sent    || 0),
      bounces: a.bounces + (c.bounces || 0),
    }), { views: 0, clicks: 0, sent: 0, bounces: 0 });
    return {
      ...tot,
      openRate:   tot.sent  ? (tot.views  / tot.sent) * 100 : 0,
      clickRate:  tot.sent  ? (tot.clicks / tot.sent) * 100 : 0,
      ctr:        tot.views ? (tot.clicks / tot.views) * 100 : 0,
      count:      sent.length,
    };
  }, [segmentCampaigns]);

  async function handlePush() {
    setPushing(true); setErr('');
    try {
      const { template: tpl } = await upsertListmonkTemplate(brand.listmonk, {
        name: rendered.name,
        subject: rendered.subject,
        body: rendered.body,
        type: 'campaign',
      });
      setPushed(tpl);
      onPushed?.(tpl);
    } catch (e) { setErr(e.message || 'Push failed'); }
    finally { setPushing(false); }
  }

  async function handleDraft() {
    if (!pushed?.id && !template._listmonkId) {
      setErr('Push the template first.');
      return;
    }
    const templateId = pushed?.id || template._listmonkId;
    setDrafting(true); setErr('');
    try {
      const draftName = `${brand.name} \u00b7 ${segmentKey} \u00b7 ${new Date().toISOString().slice(0, 10)}`;
      const { campaign } = await createListmonkCampaignDraft(brand.listmonk, {
        name: draftName,
        subject: rendered.subject,
        fromEmail: brand.listmonk.fromEmail || '',
        listIds: [listId],
        templateId,
        body: rendered.body,  // Listmonk still stores body even with templateId
        tags: ['taos', 'rfm', segmentKey.toLowerCase().replace(/\s+/g, '-')],
      });
      onDrafted?.(campaign);
    } catch (e) { setErr(e.message || 'Draft failed'); }
    finally { setDrafting(false); }
  }

  const productCount = ctx.products?.length || 0;
  const hasCollection = !!ctx.collection;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3"
           style={{ background: `linear-gradient(90deg, ${accent}18, transparent)` }}>
        <div className="w-2 h-8 rounded-full shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">{segmentKey}</div>
          <div className="text-[10px] text-slate-500 truncate">{SEGMENT_META[segmentKey]?.goal}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-bold text-white">{num(segmentSize)}</div>
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">customers</div>
        </div>
      </div>

      {/* Template + preview */}
      <div className="px-4 py-3 space-y-2">
        <div className="text-[11px] text-slate-400">
          <span className="text-slate-500">Template:</span>{' '}
          <span className="text-slate-200 font-medium">{template.name}</span>
        </div>
        <div className="text-[11px] text-slate-400 truncate" title={rendered.subject.replace(/\{\{[^}]+\}\}/g, '…')}>
          <span className="text-slate-500">Subject:</span>{' '}
          <span className="text-slate-200">{rendered.subject.replace(/\{\{[^}]+\}\}/g, '…')}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className={productCount >= 4 ? 'text-emerald-400' : productCount > 0 ? 'text-amber-400' : 'text-red-400'}>
            <Package size={10} className="inline mr-1" />{productCount}/4 products
          </span>
          <span className={hasCollection ? 'text-emerald-400' : 'text-slate-500'}>
            {hasCollection ? '\u2713 collection linked' : 'no collection'}
          </span>
        </div>
        {/* Product thumbs */}
        {ctx.products?.length > 0 && (
          <div className="flex gap-1.5 pt-1">
            {ctx.products.map(p => (
              <div key={p.sku} className="flex-1 min-w-0" title={p.title}>
                {p.image
                  ? <img src={p.image} alt={p.title} className="w-full aspect-square object-cover rounded-md bg-gray-800" />
                  : <div className="w-full aspect-square rounded-md bg-gray-800" />}
                <div className="text-[9px] text-slate-500 truncate mt-1">{p.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      {perf && (
        <div className="px-4 py-2 border-t border-gray-800 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider"><Eye size={9} className="inline" /> Open</div>
            <div className={`text-sm font-bold ${perf.openRate >= 20 ? 'text-emerald-400' : perf.openRate >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
              {perf.openRate.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider"><MousePointerClick size={9} className="inline" /> Click</div>
            <div className={`text-sm font-bold ${perf.clickRate >= 3 ? 'text-emerald-400' : perf.clickRate >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
              {perf.clickRate.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Sends</div>
            <div className="text-sm font-bold text-slate-300">{num(perf.sent)}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2">
        <button
          onClick={() => onPreview(rendered)}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-slate-300 hover:border-gray-600 flex items-center gap-1.5"
        >
          <Eye size={12} /> Preview
        </button>
        <button
          onClick={handlePush}
          disabled={pushing || productCount === 0}
          className="text-xs px-3 py-1.5 rounded-lg border border-sky-700/40 bg-sky-900/40 text-sky-200 hover:bg-sky-900/60 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {pushing ? <Spinner size="sm" /> : <Upload size={12} />}
          {pushed ? 'Re-push' : 'Push Template'}
        </button>
        <button
          onClick={handleDraft}
          disabled={drafting || (!pushed && !template._listmonkId)}
          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/40 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ml-auto"
          title={!pushed && !template._listmonkId ? 'Push the template first' : 'Creates a draft campaign; you hit send in Listmonk'}
        >
          {drafting ? <Spinner size="sm" /> : <Send size={12} />}
          Create Draft
        </button>
      </div>
      {err && (
        <div className="mx-4 mb-3 px-3 py-2 text-[11px] text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg flex items-start gap-2">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />{err}
        </div>
      )}
      {pushed && (
        <div className="mx-4 mb-3 px-3 py-2 text-[11px] text-emerald-400 bg-emerald-900/20 border border-emerald-900/40 rounded-lg flex items-center gap-2">
          <CheckCircle size={11} />Template pushed to Listmonk (id {pushed.id})
        </div>
      )}
    </div>
  );
}

/* ─── MAIN ─────────────────────────────────────────── */

export default function EmailEngine() {
  const { brands, shopifyOrders, customerCache, brandData } = useStore();
  const configured = brands.filter(b => b.listmonk?.url && b.listmonk?.username && b.listmonk?.password);
  const [selectedBrand, setSelectedBrand] = useState(configured[0]?.id || null);
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [campErr, setCampErr] = useState('');
  const [preview, setPreview] = useState(null); // { html, subject }
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState('');

  const brand = brands.find(b => b.id === selectedBrand);
  const bData = brandData?.[selectedBrand];
  const segmentSync = bData?.segmentSync;
  const listMap = segmentSync?.listMap || {};
  const inventoryMap = bData?.inventoryMap || {};
  const collections = bData?.collections || [];

  const brandOrders = useMemo(() => bData?.orders || [], [bData]);

  const rfm = useMemo(() =>
    brandOrders.length ? computeRfm(brandOrders, customerCache || {}) : [],
    [brandOrders, customerCache]);

  const segmentCounts = useMemo(() => {
    const m = {};
    SEGMENT_ORDER.forEach(s => { m[s] = 0; });
    rfm.forEach(c => { if (m[c.segment] !== undefined) m[c.segment]++; });
    return m;
  }, [rfm]);

  // Load Listmonk campaigns
  async function loadCampaigns() {
    if (!brand?.listmonk) return;
    setLoadingCamps(true); setCampErr('');
    try {
      const { campaigns } = await fetchListmonkCampaigns(brand.listmonk);
      setCampaigns(campaigns || []);
    } catch (e) {
      setCampErr(e.message || 'Failed to load campaigns');
    } finally {
      setLoadingCamps(false);
    }
  }
  useEffect(() => { if (brand) loadCampaigns(); }, [brand?.id]);

  // Bulk push / draft all eligible templates
  async function handleBulkPush() {
    if (!brand?.listmonk) return;
    setBulkBusy(true); setToast('');
    let ok = 0, fail = 0;
    for (const seg of SEGMENT_ORDER) {
      if (!listMap[seg] || segmentCounts[seg] === 0) continue;
      const tpls = templatesForSegment(seg);
      for (const t of tpls) {
        const ctx = buildEnrichmentCtx({
          segmentKey: seg, brand, shopifyOrders: brandOrders,
          inventoryMap, inventoryCollections: collections,
        });
        if (!ctx.products.length) { fail++; continue; }
        const r = renderTemplate(t, ctx);
        try {
          await upsertListmonkTemplate(brand.listmonk, {
            name: r.name, subject: r.subject, body: r.body, type: 'campaign',
          });
          ok++;
        } catch { fail++; }
      }
    }
    setToast(`Pushed ${ok} template${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''}.`);
    setBulkBusy(false);
    setTimeout(() => setToast(''), 5000);
  }

  // Summary numbers
  const totalEligible = SEGMENT_ORDER.filter(s => listMap[s] && segmentCounts[s] > 0).length;
  const totalReachable = SEGMENT_ORDER.reduce((a, s) => a + (listMap[s] ? segmentCounts[s] : 0), 0);

  if (!configured.length) {
    return (
      <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl text-sm text-slate-400">
        No brand has Listmonk configured. Add credentials in <a href="/setup" className="text-sky-400 underline">Study Manual</a> first.
      </div>
    );
  }

  if (!brand) return <Spinner />;

  if (!segmentSync) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Email Engine</h1>
          <BrandPicker brands={brands} selected={selectedBrand} onChange={setSelectedBrand} />
        </div>
        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl text-sm text-slate-400">
          No segments synced yet for <b>{brand.name}</b>. Open <a href="/segments" className="text-sky-400 underline">Customer Segments</a> and run \u201cSync All\u201d first \u2014 the Engine needs a list per segment before it can create campaigns.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-yellow-400" /> Email Engine
          </h1>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Segment-aware templates, live enrichment from Shopify, one-click push to Listmonk. You send.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <BrandPicker brands={brands} selected={selectedBrand} onChange={setSelectedBrand} />
          <button
            onClick={loadCampaigns}
            disabled={loadingCamps}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-slate-300 hover:border-gray-600 flex items-center gap-1.5"
          >
            {loadingCamps ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            Refresh stats
          </button>
          <button
            onClick={handleBulkPush}
            disabled={bulkBusy || totalEligible === 0}
            className="text-xs px-3 py-1.5 rounded-lg border border-sky-700/40 bg-sky-900/40 text-sky-200 hover:bg-sky-900/60 disabled:opacity-40 flex items-center gap-1.5"
          >
            {bulkBusy ? <Spinner size="sm" /> : <Upload size={12} />}
            Push all templates
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Segments ready"       value={`${totalEligible}/${SEGMENT_ORDER.length}`} icon={Users}  color="#38bdf8" sub="with list + customers" />
        <KPI label="Reachable customers"  value={num(totalReachable)}                         icon={Mail}   color="#34d399" />
        <KPI label="Templates in library" value={TEMPLATES.length}                            icon={Sparkles} color="#facc15" />
        <KPI label="Products in stock"    value={num(Object.values(inventoryMap).filter(i => (i.stock ?? i._totalStock ?? 0) > 0).length)} icon={Package} color="#a78bfa" />
        <KPI label="Last sync"            value={fmtTime(segmentSync.syncedAt)}               icon={Clock}  color="#94a3b8" />
      </div>

      {toast && (
        <div className="px-4 py-2 bg-sky-900/20 border border-sky-900/40 rounded-lg text-sm text-sky-300 flex items-center gap-2">
          <CheckCircle size={13} />{toast}
        </div>
      )}
      {campErr && (
        <div className="px-4 py-2 bg-red-900/20 border border-red-900/40 rounded-lg text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={13} />{campErr}
        </div>
      )}

      {/* Segment grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {SEGMENT_ORDER.map(seg => {
          const listId = listMap[seg];
          const size = segmentCounts[seg];
          if (!listId || size === 0) return null;
          const tpls = templatesForSegment(seg);
          if (!tpls.length) return null;
          const template = tpls[0]; // one per segment today; variants added later
          const ctx = buildEnrichmentCtx({
            segmentKey: seg, brand, shopifyOrders: brandOrders,
            inventoryMap, inventoryCollections: collections,
          });
          return (
            <SegmentCard
              key={seg}
              segmentKey={seg}
              segmentSize={size}
              template={template}
              listId={listId}
              ctx={ctx}
              brand={brand}
              campaigns={campaigns}
              onPreview={setPreview}
              onPushed={() => { /* no-op; state lives in card */ }}
              onDrafted={() => loadCampaigns()}
            />
          );
        })}
      </div>

      {/* How-to / footer note */}
      <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl text-[11px] text-slate-500 space-y-1">
        <div><b className="text-slate-300">How this works:</b></div>
        <div>1. <b>Push Template</b> upserts the HTML + subject into Listmonk by name (re-push to refresh with latest products).</div>
        <div>2. <b>Create Draft</b> makes a campaign in Listmonk pointing at the segment list. You open Listmonk, review, hit send.</div>
        <div>3. After send, open/click rates show up per segment here (tap Refresh stats).</div>
        <div>4. Skipped segments have no synced list or no customers \u2014 fix in <a href="/segments" className="text-sky-400 underline">Customer Segments</a>.</div>
      </div>

      {preview && <PreviewModal html={preview.body} subject={preview.subject.replace(/\{\{[^}]+\}\}/g, '\u2026')} onClose={() => setPreview(null)} />}
    </div>
  );
}
