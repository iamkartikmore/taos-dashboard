import { useMemo, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays, FolderDown, Upload, RefreshCw, Zap, TrendingUp,
  TrendingDown, Sparkles, AlertTriangle, Flame, PackageOpen, X,
  CheckCircle2, ExternalLink,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { useStore } from '../store';
import { listDriveFiles, downloadDriveFile } from '../lib/api';
import {
  parseUtmReport, extractBrandFromName, analyzeReports,
} from '../lib/utmReportAnalytics';

const cur = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const num = v => (Number(v) || 0).toLocaleString('en-IN');
const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);

function deltaColor(v) {
  if (v == null) return 'text-slate-400';
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400';
}

function KPI({ label, value, sub, delta, color = '#06b6d4' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      {delta != null && <div className={`text-[11px] mt-0.5 ${deltaColor(delta)}`}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}% DoD</div>}
    </div>
  );
}

function Card({ title, children, icon: Icon, tone = 'neutral' }) {
  const bg = tone === 'bad' ? 'border-red-800/40 bg-red-900/10'
           : tone === 'good' ? 'border-emerald-800/40 bg-emerald-900/10'
           : tone === 'warn' ? 'border-amber-800/40 bg-amber-900/10'
           : 'border-gray-800 bg-gray-900';
  return (
    <div className={`rounded-xl border ${bg} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-slate-400" />}
        <h3 className="text-xs font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ChannelRow({ row, mode }) {
  const badge = row.isNew ? 'NEW' : row.isGone ? 'GONE' : row.severity ? row.severity.toUpperCase() : '';
  const badgeClass = row.isNew ? 'bg-emerald-900/40 text-emerald-300'
                    : row.isGone ? 'bg-gray-800 text-slate-400'
                    : row.severity === 'critical' ? 'bg-red-900/40 text-red-300'
                    : row.severity === 'high' ? 'bg-orange-900/40 text-orange-300'
                    : 'bg-amber-900/40 text-amber-300';
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-950/40 border border-gray-800/30">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 font-medium truncate">{row.channel}</div>
        {row.reason && <div className="text-[11px] text-slate-500 mt-0.5">{row.reason}</div>}
      </div>
      <div className="text-right text-[11px] text-slate-400">
        <div>{cur(row.revenue)} <span className="text-slate-600">/ {row.orders} orders</span></div>
        {mode !== 'emerging' && mode !== 'fading' && row.revenuePrior != null && (
          <div className="text-[10px] text-slate-600">was {cur(row.revenuePrior)}</div>
        )}
      </div>
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${badgeClass}`}>{badge}</span>
      )}
    </div>
  );
}

export default function DailyReports() {
  const {
    brands, activeBrandIds, brandData,
    upsertBrandUtmReport, removeBrandUtmSnapshot,
  } = useStore();

  const bBrands = (brands || []).filter(b => activeBrandIds.includes(b.id));
  const [selectedBrandId, setSelectedBrandId] = useState(() => bBrands[0]?.id || '');
  const brand = brands.find(b => b.id === selectedBrandId);
  const bData = brandData?.[selectedBrandId] || {};
  const snapshots = bData.utmSnapshots || [];

  const [pulling, setPulling]   = useState(false);
  const [error, setError]       = useState(null);
  const [log, setLog]           = useState([]);
  const appendLog = msg => setLog(prev => [...prev.slice(-20), { t: Date.now(), msg }]);

  const fileInputRef = useRef(null);

  const handlePullDrive = useCallback(async () => {
    if (!brand?.drive?.apiKey || !brand?.drive?.folderId) {
      setError('Configure Drive API key + folder ID for this brand in Study Manual first.');
      return;
    }
    setPulling(true); setError(null); setLog([]);
    try {
      appendLog(`Listing files in folder…`);
      const files = await listDriveFiles(brand.drive.apiKey, brand.drive.folderId);
      appendLog(`Found ${files.length} CSV file(s)`);
      const known = new Set(snapshots.map(s => s.filename));
      const newFiles = files.filter(f => !known.has(f.name));
      appendLog(`${newFiles.length} new file(s) since last sync`);
      let importedCount = 0;
      for (const f of newFiles.slice(0, 20)) {
        try {
          appendLog(`  → ${f.name}`);
          const csv = await downloadDriveFile(brand.drive.apiKey, f.id);
          const snap = parseUtmReport(csv, { filename: f.name });
          snap.driveFileId = f.id;
          snap.driveModifiedTime = f.modifiedTime;
          upsertBrandUtmReport(brand.id, snap);
          importedCount++;
        } catch (e) {
          appendLog(`    ✗ ${e.message}`);
        }
      }
      appendLog(`Done — imported ${importedCount} snapshot(s)`);
    } catch (e) {
      setError(e.message);
      appendLog(`✗ ${e.message}`);
    } finally {
      setPulling(false);
    }
  }, [brand, snapshots, upsertBrandUtmReport]);

  const handleFiles = useCallback(async (files) => {
    if (!brand || !files?.length) return;
    setPulling(true); setError(null); setLog([]);
    try {
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.csv')) continue;
        const text = await f.text();
        const inferredBrandId = extractBrandFromName(f.name, brands);
        const targetBrandId = inferredBrandId || brand.id;
        const snap = parseUtmReport(text, { filename: f.name });
        upsertBrandUtmReport(targetBrandId, snap);
        appendLog(`✓ ${f.name} → ${brands.find(b => b.id === targetBrandId)?.name || 'brand'} · ${snap.rows.length} rows · ${snap.reportDate}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setPulling(false);
    }
  }, [brand, brands, upsertBrandUtmReport]);

  const analysis = useMemo(() => analyzeReports(snapshots), [snapshots]);

  /* Trend chart data: newest 14 days, total revenue per day */
  const trendData = useMemo(() => {
    if (!snapshots.length) return [];
    return snapshots.slice(-14).map(s => {
      const totals = (s.rows || []).reduce((a, r) => {
        a.revenue  += r.revenue || 0;
        a.sessions += r.sessions || 0;
        a.orders   += r.orders || 0;
        return a;
      }, { revenue: 0, sessions: 0, orders: 0 });
      return { date: s.reportDate.slice(5), ...totals };
    });
  }, [snapshots]);

  if (!bBrands.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <CalendarDays size={40} className="opacity-30" />
        <p className="text-sm">No active brands.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-500/20"><CalendarDays size={18} className="text-cyan-400" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">Daily Reports</h1>
          <p className="text-[11px] text-slate-500">
            UTM / channel performance pulled from Drive or dropped manually · {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} in history
          </p>
        </div>
        {bBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 ml-4">
            {bBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept=".csv,text/csv" className="hidden"
            onChange={e => { handleFiles([...(e.target.files || [])]); e.target.value = ''; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={pulling}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-slate-300 text-xs flex items-center gap-1.5 disabled:opacity-40">
            <Upload size={12} /> Drop CSVs
          </button>
          <button onClick={handlePullDrive} disabled={pulling || !brand?.drive?.apiKey || !brand?.drive?.folderId}
            className="px-3 py-1.5 rounded-lg bg-cyan-700/30 hover:bg-cyan-700/50 border border-cyan-800/40 text-cyan-300 text-xs flex items-center gap-1.5 disabled:opacity-40"
            title={!brand?.drive?.apiKey ? 'Add Drive API key in Study Manual' : 'Pull newest reports from Drive folder'}>
            {pulling ? <RefreshCw size={12} className="animate-spin" /> : <FolderDown size={12} />}
            {pulling ? 'Pulling…' : 'Pull from Drive'}
          </button>
        </div>
      </div>

      {/* Error + log */}
      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-800/40 bg-red-900/20 text-red-200 text-xs">
          <div className="font-semibold mb-1">Error</div>
          <div className="text-red-200/80">{error}</div>
        </div>
      )}
      {log.length > 0 && (
        <div className="px-4 py-2.5 rounded-xl border border-gray-800 bg-gray-950 text-[11px] text-slate-400 font-mono max-h-40 overflow-auto">
          {log.map(l => <div key={l.t}>{l.msg}</div>)}
        </div>
      )}

      {/* Empty state */}
      {!snapshots.length && !pulling && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
          <CalendarDays size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-2">No reports imported yet.</p>
          <p className="text-[11px] text-slate-600 max-w-md mx-auto">
            Either drop CSVs here directly, or configure Drive API key + folder ID in <span className="text-slate-400">Study Manual → brand</span> and click Pull from Drive.
          </p>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Totals KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label={`Revenue · ${analysis.latest.reportDate}`} value={cur(analysis.totals.revenue)}
              sub={analysis.prior ? `was ${cur(analysis.priorTotals.revenue)}` : '(first snapshot)'}
              delta={analysis.totalsDelta?.revenuePct} color="#22c55e" />
            <KPI label="Orders" value={num(analysis.totals.orders)}
              sub={analysis.prior ? `was ${num(analysis.priorTotals.orders)}` : ''}
              delta={analysis.totalsDelta?.ordersPct} color="#f59e0b" />
            <KPI label="Sessions" value={num(analysis.totals.sessions)}
              sub={analysis.prior ? `was ${num(analysis.priorTotals.sessions)}` : ''}
              delta={analysis.totalsDelta?.sessionsPct} color="#06b6d4" />
            <KPI label="Channels active"
              value={num(analysis.classified.distressed.length + analysis.classified.opportunity.length + analysis.classified.stable.length + analysis.classified.emerging.length)}
              sub={`${analysis.classified.distressed.length} distressed · ${analysis.classified.opportunity.length} surging`} color="#a78bfa" />
          </div>

          {/* Trend line */}
          {trendData.length >= 2 && (
            <Card title="14-day revenue + sessions trend">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left"  dataKey="revenue"  stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" dataKey="sessions" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" dataKey="orders"   stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Classified panels */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title={`Distressed channels (${analysis.classified.distressed.length})`} icon={TrendingDown} tone="bad">
              {analysis.classified.distressed.length === 0
                ? <div className="text-xs text-slate-500 italic">No channels dropping &gt;25% with real volume today.</div>
                : <div className="space-y-2">{analysis.classified.distressed.slice(0, 15).map((r, i) => <ChannelRow key={i} row={r} mode="distressed" />)}</div>}
            </Card>
            <Card title={`Opportunity channels (${analysis.classified.opportunity.length})`} icon={TrendingUp} tone="good">
              {analysis.classified.opportunity.length === 0
                ? <div className="text-xs text-slate-500 italic">No channels up &gt;25% vs yesterday.</div>
                : <div className="space-y-2">{analysis.classified.opportunity.slice(0, 15).map((r, i) => <ChannelRow key={i} row={r} mode="opportunity" />)}</div>}
            </Card>
            <Card title={`Emerging channels (${analysis.classified.emerging.length})`} icon={Sparkles} tone="warn">
              {analysis.classified.emerging.length === 0
                ? <div className="text-xs text-slate-500 italic">No new channels today.</div>
                : <div className="space-y-2">{analysis.classified.emerging.slice(0, 10).map((r, i) => <ChannelRow key={i} row={r} mode="emerging" />)}</div>}
            </Card>
            <Card title={`Fading channels (${analysis.classified.fading.length})`} icon={PackageOpen}>
              {analysis.classified.fading.length === 0
                ? <div className="text-xs text-slate-500 italic">No significant channels disappeared today.</div>
                : <div className="space-y-2">{analysis.classified.fading.slice(0, 10).map((r, i) => <ChannelRow key={i} row={r} mode="fading" />)}</div>}
            </Card>
          </div>

          {/* Trend leaderboard (multi-day) */}
          {analysis.trends.length > 0 && snapshots.length >= 3 && (
            <Card title={`Multi-day channel trends · Mann-Kendall (${snapshots.length} days)`} icon={Flame}>
              <div className="overflow-auto" style={{ maxHeight: '440px' }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Channel</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Total rev ({snapshots.length}d)</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Avg/day</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">Slope</th>
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold">Direction</th>
                      <th className="px-3 py-2 text-right text-slate-400 font-semibold">p-value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.trends.slice(0, 40).map((t, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                        <td className="px-3 py-2 text-slate-200 truncate max-w-[260px]">{t.channel}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(t.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(t.avg)}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.slope.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {t.direction === 'up' && <span className="text-emerald-400">↑ up{t.significant ? ' (sig)' : ''}</span>}
                          {t.direction === 'down' && <span className="text-red-400">↓ down{t.significant ? ' (sig)' : ''}</span>}
                          {t.direction === 'flat' && <span className="text-slate-500">flat</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-500">{t.pValue.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Full comparison table */}
          <Card title={`Full channel comparison · ${analysis.latest.reportDate} vs ${analysis.prior?.reportDate || 'nothing'}`}>
            <div className="overflow-auto" style={{ maxHeight: '500px' }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-400 font-semibold">Channel</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Sessions</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Orders</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Revenue</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">CVR</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">AOV</th>
                    <th className="px-3 py-2 text-right text-slate-400 font-semibold">Δ Rev</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.compared.slice(0, 200).map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40'}>
                      <td className="px-3 py-2 text-slate-200 truncate max-w-[260px]">{r.channel}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.sessions)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{num(r.orders)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{cur(r.revenue)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{(r.cvr * 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{cur(r.aov)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${deltaColor(r.revenueDeltaPct)}`}>{pct(r.revenueDeltaPct, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Snapshot history */}
          <Card title={`Snapshots in history (${snapshots.length})`}>
            <div className="flex flex-wrap gap-2">
              {snapshots.slice().reverse().map(s => (
                <div key={s.reportDate} className="px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-[11px] text-slate-300 flex items-center gap-2">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  {s.reportDate}
                  <span className="text-slate-600">· {s.rows?.length || 0} rows</span>
                  <button onClick={() => removeBrandUtmSnapshot(brand.id, s.reportDate)}
                    className="text-slate-600 hover:text-red-400 ml-1"><X size={11} /></button>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
