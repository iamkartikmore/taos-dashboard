import { useState, useEffect, useMemo } from 'react';
import { Target, TrendingUp, ShieldCheck, Mail, Trash2, Package, Download } from 'lucide-react';
import { useStore } from '../store';
import { loadAllSends, clearSends } from '../lib/sendLog';
import { attributeOrders, summarizeCampaigns, summarizeByOpportunity, summarizeBySku } from '../lib/retention/attribution';
import { buildProductLookup, productFor } from '../lib/retention/productLookup';
import { downloadCsv } from '../lib/retention/exportCsv';

const OPP_LABEL = {
  REPLENISH: 'Replenish', COMPLEMENT: 'Complement', WINBACK: 'Winback',
  NEW_LAUNCH: 'New Launch', UPSELL: 'Upsell', VIP_PROTECT: 'VIP Protect',
};

export default function CampaignPerformance() {
  const { brands, brandData } = useStore();
  const [windowDays, setWindowDays] = useState(7);
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAllSends().then(s => { setSends(s); setLoading(false); });
  }, []);

  const ordersAll = useMemo(() => {
    const out = [];
    for (const b of brands) {
      const list = brandData[b.id]?.orders || [];
      for (const o of list) out.push(o);
    }
    return out;
  }, [brands, brandData]);

  const attributed = useMemo(
    () => sends.length ? attributeOrders(sends, ordersAll, { windowDays }) : [],
    [sends, ordersAll, windowDays],
  );

  const campaigns = useMemo(() => summarizeCampaigns(attributed), [attributed]);
  const byOpp     = useMemo(() => summarizeByOpportunity(attributed), [attributed]);

  // One combined lookup across every brand the app knows about, so SKU
  // rows can carry human names + product URLs regardless of which brand
  // the send belonged to.
  const combinedLookup = useMemo(() => {
    const out = {};
    for (const b of brands) {
      const bd = brandData[b.id] || {};
      Object.assign(out, buildProductLookup(b, bd.inventoryMap));
    }
    return out;
  }, [brands, brandData]);

  const bySku = useMemo(
    () => summarizeBySku(attributed, ordersAll).slice(0, 200),
    [attributed, ordersAll],
  );

  const exportSku = () => {
    if (!bySku.length) return;
    const rows = bySku.map(s => {
      const p = productFor(s.sku, combinedLookup);
      return {
        sku: s.sku,
        name: p.name,
        url: p.url,
        recommended_sent: s.recommended_sent,
        recommended_holdout: s.recommended_holdout,
        converted_sent: s.converted_sent,
        sku_in_order_sent: s.sku_in_order_sent,
        hit_rate_sent: s.hit_rate_sent,
        conv_rate_sent: s.conv_rate_sent,
        rev_per_rec_sent: s.rev_per_rec_sent,
        rev_sent: Math.round(s.rev_sent),
        rev_holdout: Math.round(s.rev_holdout),
      };
    });
    downloadCsv(rows, 'sku-performance');
  };

  const totals = useMemo(() => {
    let sent = 0, holdout = 0, sentConv = 0, holdoutConv = 0, sentRev = 0, holdoutRev = 0;
    for (const s of attributed) {
      if (s.was_holdout) {
        holdout++;
        if (s.converted) { holdoutConv++; holdoutRev += s.attributed_rev || 0; }
      } else {
        sent++;
        if (s.converted) { sentConv++; sentRev += s.attributed_rev || 0; }
      }
    }
    const sentCr    = sent    ? sentConv    / sent    : 0;
    const holdoutCr = holdout ? holdoutConv / holdout : 0;
    const revPerSent    = sent    ? sentRev    / sent    : 0;
    const revPerHoldout = holdout ? holdoutRev / holdout : 0;
    const incrementalRev = (revPerSent - revPerHoldout) * sent;
    return {
      sent, holdout, sentConv, holdoutConv, sentRev, holdoutRev,
      sentCr, holdoutCr, revPerSent, revPerHoldout, incrementalRev,
    };
  }, [attributed]);

  const clearAll = async () => {
    if (!confirm('Clear the entire send log? This will wipe all attribution history.')) return;
    await clearSends();
    setSends([]);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaign Performance</h1>
          <p className="text-sm text-slate-400 mt-1">
            Uplift vs holdout — does the engine actually drive incremental revenue?
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500 flex items-center gap-2">
            Attribution window
            <input
              type="number"
              value={windowDays}
              onChange={e => setWindowDays(Math.max(1, parseInt(e.target.value, 10) || 7))}
              className="w-16 px-2 py-1 rounded bg-gray-900 border border-gray-800 text-sm text-slate-200 text-center"
              min={1}
              max={90}
            />
            days
          </label>
          <button
            onClick={clearAll}
            disabled={!sends.length}
            className="px-3 py-1.5 rounded-lg bg-gray-900 border border-red-900/40 hover:bg-red-900/20 disabled:opacity-40 text-xs text-red-300 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear log
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading send log…</div>
      ) : !sends.length ? (
        <div className="p-8 rounded-xl bg-gray-900 border border-gray-800 text-center">
          <Target className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <div className="text-slate-300 font-medium">No confirmed plans yet</div>
          <div className="text-slate-500 text-sm mt-1">Go to Send Planner and click "Confirm Plan" to start tracking.</div>
        </div>
      ) : (
        <>
          {/* Top-line uplift */}
          <div className="grid grid-cols-4 gap-4">
            <Stat icon={<Mail className="w-5 h-5" />}        label="Sent"             value={totals.sent.toLocaleString()}     accent="text-slate-100" />
            <Stat icon={<ShieldCheck className="w-5 h-5" />} label="Holdout"          value={totals.holdout.toLocaleString()}  accent="text-slate-400" />
            <Stat icon={<TrendingUp className="w-5 h-5" />}  label="Lift rate"
                  value={((totals.sentCr - totals.holdoutCr) * 100).toFixed(2) + ' pp'}
                  sub={`sent ${(totals.sentCr * 100).toFixed(2)}% · holdout ${(totals.holdoutCr * 100).toFixed(2)}%`}
                  accent={totals.sentCr >= totals.holdoutCr ? 'text-emerald-400' : 'text-red-400'} />
            <Stat label="Incremental revenue"
                  value={'₹' + Math.round(totals.incrementalRev).toLocaleString('en-IN')}
                  sub={`₹${totals.revPerSent.toFixed(0)}/sent · ₹${totals.revPerHoldout.toFixed(0)}/holdout`}
                  accent={totals.incrementalRev >= 0 ? 'text-amber-400' : 'text-red-400'} />
          </div>

          {/* By opportunity */}
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-xs uppercase tracking-wide text-slate-500">
              Uplift by opportunity
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 font-medium">Opportunity</th>
                  <th className="p-3 font-medium text-right">Sent</th>
                  <th className="p-3 font-medium text-right">Holdout</th>
                  <th className="p-3 font-medium text-right">Sent CR</th>
                  <th className="p-3 font-medium text-right">Holdout CR</th>
                  <th className="p-3 font-medium text-right">Lift</th>
                  <th className="p-3 font-medium text-right">₹ / sent</th>
                  <th className="p-3 font-medium text-right">₹ / holdout</th>
                </tr>
              </thead>
              <tbody>
                {byOpp.sort((a,b) => (b.lift ?? -Infinity) - (a.lift ?? -Infinity)).map(o => (
                  <tr key={o.opp} className="border-b border-gray-800/50">
                    <td className="p-3 text-slate-200">{OPP_LABEL[o.opp] || o.opp}</td>
                    <td className="p-3 text-right tabular-nums text-slate-300">{o.sent.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{o.holdout.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-slate-200">{(o.sent_cr * 100).toFixed(2)}%</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{(o.holdout_cr * 100).toFixed(2)}%</td>
                    <td className={`p-3 text-right tabular-nums ${o.lift == null ? 'text-slate-500' : o.lift >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {o.lift == null ? '—' : ((o.lift * 100).toFixed(2) + ' pp')}
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-300">₹{o.rev_per_sent.toFixed(0)}</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">₹{o.rev_per_holdout.toFixed(0)}</td>
                  </tr>
                ))}
                {!byOpp.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No data</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Per campaign */}
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-xs uppercase tracking-wide text-slate-500">
              Campaigns ({campaigns.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Campaign</th>
                  <th className="p-3 font-medium">Brands</th>
                  <th className="p-3 font-medium text-right">Sent</th>
                  <th className="p-3 font-medium text-right">Holdout</th>
                  <th className="p-3 font-medium text-right">Sent CR</th>
                  <th className="p-3 font-medium text-right">Lift</th>
                  <th className="p-3 font-medium text-right">Incremental ₹</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.campaign_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-slate-300 text-xs">{new Date(c.sent_at).toLocaleDateString()}</td>
                    <td className="p-3 text-slate-400 text-xs font-mono">{c.campaign_id.slice(0, 30)}…</td>
                    <td className="p-3 text-slate-400 text-xs">
                      {c.brands.map(id => brands.find(b => b.id === id)?.name).filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-200">{c.sent.recipients.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{c.holdout.recipients.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums">{(c.sent_conversion_rate * 100).toFixed(2)}%</td>
                    <td className={`p-3 text-right tabular-nums ${c.lift_rate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(c.lift_rate * 100).toFixed(2)} pp
                    </td>
                    <td className={`p-3 text-right tabular-nums ${c.incremental_revenue >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                      ₹{Math.round(c.incremental_revenue).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
                {!campaigns.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No campaigns logged</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Per SKU */}
          <div className="rounded-xl bg-gray-900/50 border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Performance by recommended SKU ({bySku.length})
              </div>
              <button
                onClick={exportSku}
                disabled={!bySku.length}
                className="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-[11px] text-slate-200 flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> CSV
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 font-medium">SKU</th>
                  <th className="p-3 font-medium text-right">Rec. sent</th>
                  <th className="p-3 font-medium text-right">In-order</th>
                  <th className="p-3 font-medium text-right">Hit rate</th>
                  <th className="p-3 font-medium text-right">Converted</th>
                  <th className="p-3 font-medium text-right">Conv rate</th>
                  <th className="p-3 font-medium text-right">₹ / rec</th>
                  <th className="p-3 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {bySku.map(s => {
                  const p = productFor(s.sku, combinedLookup);
                  return (
                    <tr key={s.sku} className="border-b border-gray-800/50">
                      <td className="p-3 text-slate-200 max-w-[280px]">
                        <div className="text-xs font-mono text-slate-400">{s.sku}</div>
                        {p.name && <div className="text-[11px] text-slate-300 truncate">{p.url
                          ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-brand-300">{p.name}</a>
                          : p.name}</div>}
                      </td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{s.recommended_sent.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{s.sku_in_order_sent.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-400">{(s.hit_rate_sent * 100).toFixed(1)}%</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{s.converted_sent.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">{(s.conv_rate_sent * 100).toFixed(2)}%</td>
                      <td className="p-3 text-right tabular-nums text-slate-300">₹{s.rev_per_rec_sent.toFixed(0)}</td>
                      <td className="p-3 text-right tabular-nums text-amber-400">₹{Math.round(s.rev_sent).toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
                {!bySku.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Not enough data — log a few plans + let orders flow in.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub, accent = 'text-slate-100' }) {
  return (
    <div className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
