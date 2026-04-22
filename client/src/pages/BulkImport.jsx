import { useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Loader2, Package, Users, Sparkles, Table2, Brain, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { parseBulkCsvFiles } from '../lib/shopifyCsvImport';
import { buildAllFeatures } from '../lib/retention/features';
import { buildAffinity } from '../lib/retention/affinity';
import { buildTaxonomy, applyTaxonomy } from '../lib/retention/taxonomy';
import { rankAllOpportunities } from '../lib/retention/opportunities';

function fmtBytes(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export default function BulkImport() {
  const { brands, activeBrandIds, brandData, mergeBrandOrdersFromCsv, mergeBrandCustomersFromCsv, clearBrandImport } = useStore();
  const [clearing, setClearing] = useState(false);
  const activeBrands = brands.filter(b => activeBrandIds.includes(b.id));
  const [targetBrandId, setTargetBrandId] = useState(activeBrands[0]?.id || brands[0]?.id || '');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const brand = brands.find(b => b.id === targetBrandId);
  const brandCounts = brand ? brandData[brand.id] || {} : {};
  const currentOrders = brandCounts.orders?.length || 0;
  const currentCustomers = brandCounts.customers?.length || 0;

  // Auto-compute a compact retention summary once an import has just landed.
  // Recomputes whenever the brand's orders array identity changes (which it
  // does after mergeBrandOrdersFromCsv), so this reflects the post-import data.
  const retentionSummary = useMemo(() => {
    if (!result || result.error) return null;
    const orders = brandCounts.orders || [];
    const customers = brandCounts.customers || [];
    if (!orders.length) return null;
    try {
      const taxonomy = buildTaxonomy(orders);
      applyTaxonomy(orders, taxonomy.skuLabel);
      const { features, replenish } = buildAllFeatures(orders, customers);
      const affinity = buildAffinity(orders);
      const { flat } = rankAllOpportunities({
        features, replenishClock: replenish,
        copurchase: affinity.copurchase, taxonomy,
        newLaunches: affinity.newLaunches, orders,
      });
      const feats = Object.values(features).filter(f => f.orders_lifetime > 0);
      const byTier = { VIP: 0, Core: 0, Emerging: 0 };
      for (const f of feats) byTier[f.value_tier] = (byTier[f.value_tier] || 0) + 1;
      const byOpp = {};
      let totalExp = 0;
      for (const r of flat) {
        byOpp[r.opportunity] = (byOpp[r.opportunity] || 0) + 1;
        totalExp += r.expected_incremental_revenue || 0;
      }
      return {
        buyers: feats.length,
        vips: byTier.VIP,
        replenish_skus: Object.keys(replenish).length,
        copurchase_pairs: affinity.copurchase.pairs.length,
        new_launches: affinity.newLaunches.length,
        collections: Object.keys(taxonomy.collections).length,
        opportunities: flat.length,
        byOpp,
        expected_rev: totalExp,
      };
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, brandCounts.orders, brandCounts.customers]);

  const addFiles = newFiles => {
    const arr = Array.from(newFiles).filter(f => f.name.toLowerCase().endsWith('.csv'));
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.name + ':' + f.size));
      const merged = [...prev];
      for (const f of arr) {
        const key = f.name + ':' + f.size;
        if (!seen.has(key)) { seen.add(key); merged.push(f); }
      }
      return merged;
    });
  };

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, []);

  const removeFile = idx => setFiles(prev => prev.filter((_, i) => i !== idx));

  const appendLog = msg => setLog(prev => [...prev.slice(-50), { t: Date.now(), msg }]);

  const doClearImport = async () => {
    if (!targetBrandId) return;
    const ok = window.confirm(
      `Clear all imported orders (${currentOrders.toLocaleString()}) and customers (${currentCustomers.toLocaleString()}) for ${brand?.name || 'this brand'}?\n\nThis removes them from memory AND IndexedDB. Cannot be undone — you'll need to re-import from CSV or pull fresh from Shopify.`
    );
    if (!ok) return;
    setClearing(true); setResult(null);
    try {
      appendLog(`Clearing imported data for ${brand?.name}...`);
      await clearBrandImport(targetBrandId);
      appendLog(`✅ Cleared — 0 orders, 0 customers`);
      setFiles([]);
    } catch (e) {
      appendLog(`❌ Clear failed: ${e.message}`);
    } finally {
      setClearing(false);
    }
  };

  const doImport = async () => {
    if (!targetBrandId || !files.length) return;
    setProcessing(true); setResult(null); setLog([]);
    try {
      appendLog(`Parsing ${files.length} file(s) for ${brand.name}...`);
      const parsed = await parseBulkCsvFiles(files, msg => appendLog(msg));
      appendLog(`✓ Parse complete: ${parsed.orders.length} orders, ${parsed.customers.length} customers`);

      let ordersResult = null, customersResult = null;
      if (parsed.orders.length) {
        appendLog('Merging orders into store + IndexedDB...');
        ordersResult = mergeBrandOrdersFromCsv(targetBrandId, parsed.orders);
        appendLog(`  → ${ordersResult.total} orders on file (+${Math.max(ordersResult.added, 0)} new)`);
      }
      if (parsed.customers.length) {
        appendLog('Merging customers into store + IndexedDB...');
        customersResult = mergeBrandCustomersFromCsv(targetBrandId, parsed.customers);
        appendLog(`  → ${customersResult.total} customers on file (+${Math.max(customersResult.added, 0)} new)`);
      }
      setResult({ ordersResult, customersResult, perFile: parsed.perFile });
      appendLog('✅ Done');
    } catch (e) {
      appendLog(`❌ Error: ${e.message}`);
      setResult({ error: e.message });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Upload size={20} className="text-brand-400" />
          Bulk CSV Import
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Upload Shopify <code className="text-slate-300">orders_export_*.csv</code> and <code className="text-slate-300">customers_export_*.csv</code> files. Merged with existing data, deduped by ID, stored per brand in IndexedDB. Unlocks 5-year history without API limits.
        </p>
      </div>

      {/* Target brand selector */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/60 p-4">
        <label className="block text-[11px] text-slate-500 uppercase tracking-wide mb-2">Target brand</label>
        <select
          value={targetBrandId}
          onChange={e => setTargetBrandId(e.target.value)}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
        >
          {brands.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {brand && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="bg-gray-950/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <Package size={14} className="text-emerald-400" />
                <div>
                  <div className="text-[10px] text-slate-500">Orders on file</div>
                  <div className="text-sm font-semibold text-white">{currentOrders.toLocaleString()}</div>
                </div>
              </div>
              <div className="bg-gray-950/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <Users size={14} className="text-blue-400" />
                <div>
                  <div className="text-[10px] text-slate-500">Customers on file</div>
                  <div className="text-sm font-semibold text-white">{currentCustomers.toLocaleString()}</div>
                </div>
              </div>
            </div>
            {(currentOrders > 0 || currentCustomers > 0) && (
              <button
                onClick={doClearImport}
                disabled={clearing || processing}
                className="mt-3 w-full px-3 py-2 rounded-lg bg-red-900/20 hover:bg-red-900/40 disabled:opacity-50 border border-red-800/40 text-red-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {clearing ? 'Clearing…' : `Clear imported data for ${brand.name}`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-brand-500 bg-brand-500/5' : 'border-gray-700 hover:border-gray-600 bg-gray-900/40'
        }`}
      >
        <Upload size={28} className="text-slate-500 mx-auto mb-2" />
        <div className="text-sm text-slate-300 font-medium">Drop CSV files here or click to browse</div>
        <div className="text-[11px] text-slate-500 mt-1">Supports multiple files. Orders and customers exports auto-detected.</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,text/csv"
          onChange={e => addFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Staged files */}
      {files.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800/60 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-300">{files.length} file(s) staged</div>
            <button onClick={() => setFiles([])} className="text-[11px] text-slate-500 hover:text-red-400">Clear all</button>
          </div>
          <div className="divide-y divide-gray-800/40">
            {files.map((f, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <FileText size={14} className="text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{f.name}</div>
                  <div className="text-[11px] text-slate-500">{fmtBytes(f.size)}</div>
                </div>
                <button onClick={() => removeFile(i)} className="text-slate-500 hover:text-red-400">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action */}
      <div className="flex items-center gap-3">
        <button
          onClick={doImport}
          disabled={processing || !files.length || !targetBrandId}
          className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:bg-gray-800 disabled:text-slate-500 text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {processing ? 'Importing...' : `Import into ${brand?.name || '—'}`}
        </button>
        {result && !result.error && (
          <div className="text-xs text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Import complete
          </div>
        )}
        {result?.error && (
          <div className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={13} /> {result.error}
          </div>
        )}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="bg-gray-950 border border-gray-800/60 rounded-xl p-4 font-mono text-[11px] text-slate-300 max-h-64 overflow-auto">
          {log.map(l => (
            <div key={l.t}>{l.msg}</div>
          ))}
        </div>
      )}

      {/* Retention summary (auto-computed after import) */}
      {retentionSummary && (
        <div className="bg-gradient-to-br from-fuchsia-500/5 to-brand-500/5 rounded-xl border border-fuchsia-500/20 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-fuchsia-400" />
              <div className="text-sm font-semibold text-white">Retention data — auto-computed</div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/retention-sheets"
                className="px-3 py-1.5 rounded-lg bg-gray-900/70 hover:bg-gray-800 border border-gray-800 text-xs text-slate-200 flex items-center gap-1.5"
              >
                <Table2 size={13} /> Open sheets
              </Link>
              <Link
                to="/customer-brain"
                className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs text-white font-medium flex items-center gap-1.5"
              >
                <Brain size={13} /> Customer Brain
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-4">
            <SummaryTile label="Buyers"          value={retentionSummary.buyers.toLocaleString()} />
            <SummaryTile label="VIPs"            value={retentionSummary.vips.toLocaleString()} />
            <SummaryTile label="Opportunities"   value={retentionSummary.opportunities.toLocaleString()} />
            <SummaryTile label="Est. ₹"
              value={'₹' + Math.round(retentionSummary.expected_rev).toLocaleString('en-IN')} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <SummaryTile label="Replenish SKUs"  value={retentionSummary.replenish_skus.toLocaleString()} />
            <SummaryTile label="Co-purchase pairs" value={retentionSummary.copurchase_pairs.toLocaleString()} />
            <SummaryTile label="New launches"    value={retentionSummary.new_launches.toLocaleString()} />
            <SummaryTile label="Auto collections" value={retentionSummary.collections.toLocaleString()} />
          </div>

          {Object.keys(retentionSummary.byOpp).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(retentionSummary.byOpp).sort((a,b)=>b[1]-a[1]).map(([k, v]) => (
                <span key={k} className="px-2.5 py-1 rounded-full bg-gray-900/60 border border-gray-800 text-[11px] text-slate-300">
                  <span className="text-slate-500">{k.replace(/_/g,' ').toLowerCase()}</span> <span className="text-slate-100 font-medium ml-1">{v.toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">
            Features, replenish clocks, co-purchase graph, category transitions, and taxonomy are all recomputed
            from the current orders set. Every sheet is exportable as CSV with SKU name + product URL joined
            from the Shopify inventory map.
          </div>
        </div>
      )}

      {/* Per-file breakdown */}
      {result?.perFile?.length > 0 && (
        <div className="bg-gray-900/60 rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-800/60 text-xs font-semibold text-slate-300">Per-file breakdown</div>
          <table className="w-full text-xs">
            <thead className="bg-gray-950/60 text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">File</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Rows</th>
                <th className="text-right px-4 py-2 font-medium">Added</th>
                <th className="text-right px-4 py-2 font-medium">Merged</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {result.perFile.map((pf, i) => (
                <tr key={i} className="border-t border-gray-800/40">
                  <td className="px-4 py-2 truncate max-w-xs">{pf.name}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      pf.type === 'orders' ? 'bg-emerald-500/10 text-emerald-400' :
                      pf.type === 'customers' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>{pf.type}</span>
                  </td>
                  <td className="px-4 py-2 text-right">{(pf.rows || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-emerald-400">+{pf.added || 0}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{pf.replaced || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }) {
  return (
    <div className="bg-gray-950/60 rounded-lg px-3 py-2.5 border border-gray-800/60">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
