import { useMemo, useState } from 'react';
import {
  Users, Upload, RefreshCw, CheckCircle, AlertCircle, ExternalLink,
} from 'lucide-react';
import { useStore } from '../store';
import { computeRfm, RFM_SEGMENT_COLORS } from '../lib/shopifyAnalytics';
import { ensureListmonkLists, importListmonkSubscribers } from '../lib/api';
import Spinner from '../components/ui/Spinner';

const num = v => Number(v || 0).toLocaleString('en-IN');
const inr = v => '₹' + Math.round(Number(v || 0)).toLocaleString('en-IN');
const fmtTime = ts => ts ? new Date(ts).toLocaleString() : '—';

const SEGMENT_ORDER = [
  'Champions', 'Loyal', 'Potential Loyal', 'New', 'Promising',
  'At Risk', "Can't Lose", 'Dormant', 'Others',
];

const SEGMENT_DESC = {
  'Champions':       'High R, F, M — your best customers. Low-discount exclusives, VIP early access.',
  'Loyal':           'High F, M, recent — steady buyers. Cross-sell, replenishment reminders.',
  'Potential Loyal': 'Recent + multiple orders — push to Champion tier with loyalty offer.',
  'New':             'Recent first purchase — welcome series, onboarding, brand story.',
  'Promising':       'Recent but low frequency — second-order nudge with small discount.',
  'At Risk':         'Was good, now silent — win-back email with medium discount.',
  "Can't Lose":      'High M, went silent — personal outreach, premium win-back.',
  'Dormant':         'Long silent + low value — last-chance big discount or sunset.',
  'Others':          'Unclassified — review manually or leave for general campaigns.',
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

function buildAttribs(c) {
  return {
    city: c.city || '',
    segment: c.segment,
    r: c.rScore, f: c.fScore, m: c.mScore,
    order_count: c.orderCount || 0,
    total_spent: Math.round(c.totalSpent || 0),
    aov: Math.round(c.aov || 0),
    recency_days: c.recencyDays,
    lifespan_days: c.lifespan || 0,
  };
}

export default function Segments() {
  const { brands, activeBrandIds, shopifyOrders, customerCache, brandData, setBrandSegmentSync } = useStore();
  const configured = brands.filter(b => b.listmonk?.url && b.listmonk?.username && b.listmonk?.password);
  const [selectedBrand, setSelectedBrand] = useState(configured[0]?.id || null);

  const [syncing, setSyncing]  = useState(false);
  const [progress, setProgress] = useState('');
  const [syncError, setSyncError] = useState('');

  const brand = brands.find(b => b.id === selectedBrand);
  const lastSync = brandData?.[selectedBrand]?.segmentSync;

  const rfmRows = useMemo(() => {
    if (!shopifyOrders?.length) return [];
    return computeRfm(shopifyOrders, customerCache || {});
  }, [shopifyOrders, customerCache]);

  const segments = useMemo(() => {
    const m = {};
    SEGMENT_ORDER.forEach(s => { m[s] = { segment: s, count: 0, revenue: 0, sample: [] }; });
    rfmRows.forEach(c => {
      const bucket = m[c.segment] || m['Others'];
      bucket.count++;
      bucket.revenue += c.totalSpent || 0;
      if (bucket.sample.length < 5) bucket.sample.push(c);
    });
    return SEGMENT_ORDER.map(s => m[s]);
  }, [rfmRows]);

  const totalCustomers = rfmRows.length;
  const totalRevenue = rfmRows.reduce((a, c) => a + (c.totalSpent || 0), 0);

  async function handleSyncAll() {
    if (!brand?.listmonk || !rfmRows.length) return;
    setSyncing(true); setSyncError(''); setProgress('Creating Listmonk lists...');
    try {
      const segmentNames = SEGMENT_ORDER.filter(s => segments.find(x => x.segment === s && x.count > 0));
      const { lists: listMap } = await ensureListmonkLists(brand.listmonk, segmentNames, `TAOS-${brand.name.slice(0,12)}`);

      const perSegmentCount = {};
      let totalSynced = 0;
      for (const seg of segmentNames) {
        const listId = listMap[seg];
        if (!listId) continue;
        const customers = rfmRows
          .filter(c => c.segment === seg && c.email && c.email.includes('@'))
          .map(c => ({ email: c.email, name: c.name || c.email.split('@')[0], attribs: buildAttribs(c) }));
        if (!customers.length) { perSegmentCount[seg] = 0; continue; }
        setProgress(`Syncing ${seg} (${customers.length} customers)...`);
        await importListmonkSubscribers(brand.listmonk, listId, customers);
        perSegmentCount[seg] = customers.length;
        totalSynced += customers.length;
      }

      setBrandSegmentSync(brand.id, {
        syncedAt: Date.now(), listMap, perSegmentCount, totalSynced,
      });
      setProgress(`Done — ${totalSynced} customers synced across ${segmentNames.length} segments.`);
    } catch (e) {
      setSyncError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Customer Segments</h1>
        <p className="text-sm text-slate-500 mt-1">
          RFM-based buckets, computed from Shopify order history. Push to Listmonk as synced lists for segmented campaigns.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <BrandPicker brands={brands} selected={selectedBrand} onChange={setSelectedBrand} />
        <div className="flex items-center gap-3">
          {lastSync?.syncedAt && (
            <span className="text-[11px] text-slate-500">Last sync: {fmtTime(lastSync.syncedAt)} · {num(lastSync.totalSynced)} synced</span>
          )}
          <button
            onClick={handleSyncAll}
            disabled={syncing || !rfmRows.length || !brand?.listmonk?.url}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-gray-800 disabled:text-slate-500 text-white text-sm font-semibold transition-colors">
            {syncing ? <Spinner size={14} /> : <Upload size={14} />}
            {syncing ? 'Syncing...' : 'Sync All to Listmonk'}
          </button>
        </div>
      </div>

      {!rfmRows.length && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-amber-400 shrink-0" />
          <div>
            <div className="text-sm font-medium text-amber-200">No orders loaded</div>
            <div className="text-xs text-amber-400/70 mt-0.5">
              Pull Shopify orders first from Study Manual or the Shopify Orders page — RFM segments are computed from that data.
            </div>
          </div>
        </div>
      )}

      {syncError && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-sm text-red-300">
          Sync failed: {syncError}
        </div>
      )}

      {syncing && progress && (
        <div className="bg-sky-950/30 border border-sky-800/40 rounded-xl p-3 text-sm text-sky-300 flex items-center gap-2">
          <Spinner size={12} /> {progress}
        </div>
      )}

      {rfmRows.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Total Customers</div>
              <div className="text-xl font-bold text-white">{num(totalCustomers)}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Total Lifetime Revenue</div>
              <div className="text-xl font-bold text-emerald-400">{inr(totalRevenue)}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Segments Active</div>
              <div className="text-xl font-bold text-sky-400">{segments.filter(s => s.count > 0).length} / 9</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {segments.map(s => {
              const pct = totalCustomers ? (s.count / totalCustomers * 100).toFixed(1) : '0.0';
              const synced = lastSync?.perSegmentCount?.[s.segment] || 0;
              const listId = lastSync?.listMap?.[s.segment];
              const color = RFM_SEGMENT_COLORS[s.segment] || '#64748b';
              return (
                <div key={s.segment} className={`bg-gray-900 border rounded-xl p-4 ${s.count === 0 ? 'border-gray-800/50 opacity-60' : 'border-gray-800'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      <span className="font-semibold text-white">{s.segment}</span>
                    </div>
                    {synced > 0 && (
                      <span title={`${synced} synced to Listmonk list ${listId}`} className="text-emerald-400">
                        <CheckCircle size={14} />
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-500 mb-3 leading-relaxed">{SEGMENT_DESC[s.segment]}</div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase">Customers</div>
                      <div className="text-base font-bold text-white">{num(s.count)}</div>
                      <div className="text-[10px] text-slate-500">{pct}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase">Revenue</div>
                      <div className="text-base font-bold text-emerald-400">{inr(s.revenue)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase">Synced</div>
                      <div className="text-base font-bold text-sky-400">{num(synced)}</div>
                      {listId && <div className="text-[10px] text-slate-500">list #{listId}</div>}
                    </div>
                  </div>

                  {s.sample.length > 0 && (
                    <div className="border-t border-gray-800 pt-2 mt-2">
                      <div className="text-[10px] text-slate-600 uppercase mb-1">Sample</div>
                      <div className="space-y-0.5">
                        {s.sample.map(c => (
                          <div key={c.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 truncate max-w-[180px]">{c.email || c.name}</span>
                            <span className="text-slate-600 tabular-nums">{inr(c.totalSpent)} · {c.orderCount}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {brand?.listmonk?.url && (
            <div className="text-xs text-slate-500 text-center">
              Listmonk: <a href={brand.listmonk.url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline inline-flex items-center gap-1">
                {brand.listmonk.url} <ExternalLink size={10} />
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
