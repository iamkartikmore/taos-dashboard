import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, CheckCircle, AlertCircle, RefreshCw, Key, Users, BookOpen, Upload, ShoppingBag } from 'lucide-react';
import { useStore } from '../store';
import { pullAccount, verifyToken, fetchShopifyInventory } from '../lib/api';
import { BREAKDOWN_SPECS, pullAllBreakdowns } from '../lib/breakdownApi';
import { parseCsv, csvRowsToManualMap, detectListsFromCsvRows } from '../lib/csvImport';
import Spinner from '../components/ui/Spinner';

// Lists come from store — computed at render time in component

export default function Setup() {
  const {
    config, setConfig, updateAccount, addAccount, removeAccount,
    manualMap, setManualMap, setManualRow, rebuildEnriched,
    fetchStatus, fetchLog, appendLog, clearLog, setFetchStatus, setRawAccounts,
    enrichedRows,
    dynamicLists, mergeDynamicLists,
    inventoryStatus, setInventoryMap, setInventoryStatus,
    setBreakdownData, setBreakdownStatus,
  } = useStore();

  const LISTS = dynamicLists;

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [inventoryFetching, setInventoryFetching] = useState(false);
  const [inventoryResult, setInventoryResult]     = useState(null);
  const [activeManualAd, setActiveManualAd] = useState(null);
  const [manualSearch, setManualSearch] = useState('');
  const [activeTab, setActiveTab] = useState('credentials');
  const [csvImportStatus, setCsvImportStatus] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const csvFileRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Show a brief "Saved" flash whenever config changes
  const flashSaved = () => {
    setSavedFlash(true);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
  };

  const handleCsvImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const newMap = csvRowsToManualMap(rows);
      const count = Object.keys(newMap).length;
      // Detect and merge dynamic lists from CSV
      const detected = detectListsFromCsvRows(rows);
      mergeDynamicLists(detected);
      // Merge with existing (CSV wins on conflicts)
      setManualMap({ ...manualMap, ...newMap });
      rebuildEnriched();
      setCsvImportStatus({ count, merged: true });
      flashSaved();
    } catch (err) {
      setCsvImportStatus({ error: err.message });
    }
    // Reset file input so same file can be re-imported
    e.target.value = '';
  };

  const handleVerify = async () => {
    if (!config.token) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const me = await verifyToken(config.token, config.apiVersion);
      setVerifyResult({ ok: true, name: me.name, id: me.id });
    } catch (e) {
      setVerifyResult({ ok: false, message: e.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleFetchInventory = async () => {
    if (!config.shopifyShop || !config.shopifyClientId || !config.shopifyClientSecret) return;
    setInventoryFetching(true);
    setInventoryResult(null);
    setInventoryStatus('loading');
    try {
      const map = await fetchShopifyInventory(config.shopifyShop, config.shopifyClientId, config.shopifyClientSecret);
      setInventoryMap(map);
      const count = Object.keys(map).length;
      setInventoryResult({ ok: true, count });
    } catch (e) {
      setInventoryStatus('error');
      setInventoryResult({ ok: false, message: e.message });
    } finally {
      setInventoryFetching(false);
    }
  };

  const handlePull = async () => {
    const accounts = config.accounts.filter(a => a.key && a.id);
    if (!config.token) return alert('Enter Meta Access Token first.');
    if (!accounts.length) return alert('Add at least one Ad Account.');

    setFetchStatus('loading');
    clearLog();
    appendLog('Starting pull...');

    try {
      // Step 1: Pull insights for all windows
      const results = [];
      for (const acc of accounts) {
        const result = await pullAccount(
          { ver: config.apiVersion, token: config.token, accountKey: acc.key, accountId: acc.id },
          msg => appendLog(msg),
        );
        results.push(result);
      }
      setRawAccounts(results);
      setFetchStatus('success');
      appendLog('✅ Insights done! Now pulling 7D breakdowns...');

      // Step 2: Auto-pull all breakdowns for 7D window
      setBreakdownStatus('loading');
      const bdResult = await pullAllBreakdowns(
        {
          ver:      config.apiVersion,
          token:    config.token,
          accounts,
          specs:    BREAKDOWN_SPECS,
          window:   '7D',
        },
        msg => appendLog(msg),
      );
      setBreakdownData(bdResult);
      appendLog('✅ Breakdowns done!');
    } catch (e) {
      setFetchStatus('error', e.message);
      appendLog('❌ Error: ' + e.message);
    }
  };

  // Ads available for manual labeling
  const adsForManual = enrichedRows
    .filter(r => !manualSearch || r.adName?.toLowerCase().includes(manualSearch.toLowerCase())
                              || r.campaignName?.toLowerCase().includes(manualSearch.toLowerCase()))
    .slice(0, 200);

  const TABS = [
    { id: 'credentials', label: 'API Credentials', icon: Key },
    { id: 'import',      label: 'Import CSV',       icon: Upload },
    { id: 'manual',      label: 'Manual Labels',   icon: BookOpen },
    { id: 'log',         label: 'Fetch Log',        icon: RefreshCw },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Study Manual</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure your Meta API credentials, ad accounts, and apply manual labels to ads.
          This is the only section that requires your input — all dashboards are auto-generated.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── CREDENTIALS TAB ─────────────────────────────────────── */}
      {activeTab === 'credentials' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Token */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Key size={16} className="text-brand-400" /> Meta Access Token
              </div>
              <div className="flex items-center gap-2">
                {config.token && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-500/30">
                    Token set ✓
                  </span>
                )}
                {savedFlash && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-900/40 text-brand-300 ring-1 ring-brand-500/30 animate-pulse">
                    Saved to browser ✓
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Access Token</label>
                <input
                  type="password"
                  value={config.token}
                  onChange={e => { setConfig({ ...config, token: e.target.value }); flashSaved(); }}
                  placeholder="EAA..."
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">API Version</label>
                <input
                  type="text"
                  value={config.apiVersion}
                  onChange={e => { setConfig({ ...config, apiVersion: e.target.value }); flashSaved(); }}
                  className="w-48 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <button
                onClick={handleVerify}
                disabled={verifying || !config.token}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-all"
              >
                {verifying ? <Spinner size="sm" /> : <CheckCircle size={14} />}
                Verify Token
              </button>
              {verifyResult && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                  verifyResult.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'
                }`}>
                  {verifyResult.ok
                    ? <><CheckCircle size={14} /> Connected as <strong>{verifyResult.name}</strong> ({verifyResult.id})</>
                    : <><AlertCircle size={14} /> {verifyResult.message}</>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Accounts */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Users size={16} className="text-brand-400" /> Ad Accounts
              </div>
              <button
                onClick={() => { addAccount(); flashSaved(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-slate-300 rounded-lg transition-all border border-gray-700"
              >
                <Plus size={12} /> Add account
              </button>
            </div>

            {config.accounts.length === 0 && (
              <p className="text-sm text-slate-500 italic">No accounts yet. Click "Add account" above.</p>
            )}

            <div className="space-y-2">
              {config.accounts.map((acc, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={acc.key}
                    onChange={e => { updateAccount(i, { key: e.target.value }); flashSaved(); }}
                    placeholder="Account key (e.g. MAIN)"
                    className="w-36 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <input
                    type="text"
                    value={acc.id}
                    onChange={e => { updateAccount(i, { id: e.target.value }); flashSaved(); }}
                    placeholder="Account ID (act_... or numeric)"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    onClick={() => { removeAccount(i); flashSaved(); }}
                    className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Shopify Inventory */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <div className="flex items-center gap-2 text-white font-semibold">
              <ShoppingBag size={16} className="text-emerald-400" /> Shopify Inventory
              <span className="text-xs font-normal text-slate-500 ml-1">— links SKU codes to current stock levels</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Shopify Shop Domain</label>
                <input
                  type="text"
                  value={config.shopifyShop || ''}
                  onChange={e => { setConfig({ ...config, shopifyShop: e.target.value }); flashSaved(); }}
                  placeholder="yourshop (without .myshopify.com)"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Client ID</label>
                <input
                  type="text"
                  value={config.shopifyClientId || ''}
                  onChange={e => { setConfig({ ...config, shopifyClientId: e.target.value }); flashSaved(); }}
                  placeholder="bc70bfdc89f06d5810b5bed1c..."
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Client Secret</label>
                <input
                  type="password"
                  value={config.shopifyClientSecret || ''}
                  onChange={e => { setConfig({ ...config, shopifyClientSecret: e.target.value }); flashSaved(); }}
                  placeholder="shpss_..."
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                onClick={handleFetchInventory}
                disabled={inventoryFetching || !config.shopifyShop || !config.shopifyClientId || !config.shopifyClientSecret}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-all"
              >
                {inventoryFetching ? <Spinner size="sm" /> : <ShoppingBag size={14} />}
                {inventoryFetching ? 'Fetching stock...' : 'Fetch Inventory Stock'}
              </button>
              {inventoryResult && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                  inventoryResult.ok ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'
                }`}>
                  {inventoryResult.ok
                    ? <><CheckCircle size={14} /> Loaded <strong>{inventoryResult.count}</strong> SKUs from Shopify</>
                    : <><AlertCircle size={14} /> {inventoryResult.message}</>
                  }
                </div>
              )}
            </div>
          </div>

          {/* Pull button */}
          <button
            onClick={handlePull}
            disabled={fetchStatus === 'loading'}
            className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all shadow-glow"
          >
            {fetchStatus === 'loading' ? <Spinner size="sm" /> : <RefreshCw size={16} />}
            {fetchStatus === 'loading' ? 'Fetching Meta Data...' : 'Pull Meta + Refresh All'}
          </button>
        </motion.div>
      )}

      {/* ── IMPORT CSV TAB ──────────────────────────────────────── */}
      {activeTab === 'import' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 max-w-lg">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Upload size={16} className="text-brand-400" /> Import 02_MANUAL.csv
            </div>
            <p className="text-sm text-slate-400">
              Upload your exported <span className="font-mono text-slate-300">02_MANUAL.csv</span> file.
              All columns (Collection, Campaign Type, Offer Type, Audience flags, Status Override, Notes, etc.)
              are loaded automatically. Existing labels are overwritten only where the CSV has a row.
            </p>

            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-700 hover:border-brand-500 rounded-xl p-8 cursor-pointer transition-colors">
              <Upload size={28} className="text-slate-500" />
              <span className="text-sm text-slate-400">Click to choose file or drag & drop</span>
              <span className="text-xs text-slate-600">Accepts .csv files from your TAOS Google Sheet</span>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvImport}
                className="hidden"
              />
            </label>

            {csvImportStatus && !csvImportStatus.error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-emerald-900/30 text-emerald-300 rounded-lg text-sm">
                <CheckCircle size={16} />
                Loaded <strong>{csvImportStatus.count}</strong> ad rows into the manual map.
                {' '}All dashboards have been refreshed.
              </div>
            )}
            {csvImportStatus?.error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-900/30 text-red-300 rounded-lg text-sm">
                <AlertCircle size={16} /> {csvImportStatus.error}
              </div>
            )}

            {Object.keys(manualMap).length > 0 && (
              <div className="text-xs text-slate-500">
                Currently loaded: <span className="text-slate-300 font-medium">{Object.keys(manualMap).length}</span> ads labeled
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── MANUAL LABELS TAB ───────────────────────────────────── */}
      {activeTab === 'manual' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {enrichedRows.length === 0 ? (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-slate-500">
              Pull Meta data first to see ads available for labeling.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={manualSearch}
                  onChange={e => setManualSearch(e.target.value)}
                  placeholder="Search ads / campaigns..."
                  className="w-80 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <span className="text-xs text-slate-500">{adsForManual.length} ads shown</span>
              </div>

              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold w-64">Ad</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Campaign</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Collection</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Campaign Type</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Offer</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Override</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adsForManual.map((row, i) => {
                      const m = manualMap[row.adId] || {};
                      return (
                        <tr key={row.adId} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                          <td className="px-3 py-2 text-slate-300 max-w-[200px] truncate">{row.adName}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate">{row.campaignName}</td>
                          {['Collection','Campaign Type','Offer Type','Status Override'].map(field => (
                            <td key={field} className="px-3 py-1">
                              {LISTS[field] ? (
                                <select
                                  value={m[field] || ''}
                                  onChange={e => { setManualRow(row.adId, { [field]: e.target.value }); rebuildEnriched(); flashSaved(); }}
                                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                                >
                                  <option value="">—</option>
                                  {LISTS[field].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={m[field] || ''}
                                  onChange={e => { setManualRow(row.adId, { [field]: e.target.value }); rebuildEnriched(); flashSaved(); }}
                                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                              )}
                            </td>
                          ))}
                          <td className="px-3 py-1">
                            <input
                              type="text"
                              value={m['Notes'] || ''}
                              onChange={e => { setManualRow(row.adId, { Notes: e.target.value }); rebuildEnriched(); flashSaved(); }}
                              placeholder="notes..."
                              className="w-32 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* ── LOG TAB ─────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 font-mono text-xs text-slate-300 h-96 overflow-y-auto space-y-0.5">
            {fetchLog.length === 0
              ? <span className="text-slate-600">No log entries yet.</span>
              : fetchLog.map((l, i) => <div key={i} className="leading-relaxed">{l}</div>)
            }
          </div>
        </motion.div>
      )}
    </div>
  );
}
