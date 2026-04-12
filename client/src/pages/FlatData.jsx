import { useState } from 'react';
import { Database } from 'lucide-react';
import { useStore } from '../store';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import ManualEditDrawer from '../components/ui/ManualEditDrawer';
import AdDetailDrawer from '../components/ui/AdDetailDrawer';
import { fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';

export default function FlatData() {
  const { enrichedRows, fetchStatus } = useStore();
  const [editRow, setEditRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);

  if (fetchStatus === 'loading') return <FullPageSpinner />;

  const columns = [
    { key: 'accountKey',       label: 'Account',         width: 80  },
    { key: 'adName',           label: 'Ad',              width: 220, render: v => <span className="text-slate-200 break-words whitespace-normal leading-snug" title={v}>{v}</span> },
    { key: 'adSetName',        label: 'Ad Set',          width: 180, render: v => <span className="text-slate-400 text-xs">{v}</span> },
    { key: 'campaignName',     label: 'Campaign',        width: 180, render: v => <span className="text-slate-400 text-xs">{v}</span> },
    { key: 'decision',         label: 'Decision',        width: 130, render: v => <Badge label={v} /> },
    { key: 'currentQuality',   label: 'Quality',         width: 90,  render: v => <Badge label={v} size="xs" /> },
    { key: 'trendSignal',      label: 'Trend',           width: 150, render: v => <Badge label={v} size="xs" /> },
    { key: 'spend',            label: 'Spend',           align: 'right', width: 90,  render: v => fmt.currency(v) },
    { key: 'revenue',          label: 'Revenue',         align: 'right', width: 90,  render: v => fmt.currency(v) },
    { key: 'metaRoas',         label: 'ROAS',            align: 'right', width: 70,
      render: v => <span className={safeNum(v) >= 4 ? 'text-emerald-400 font-bold' : safeNum(v) >= 2.5 ? 'text-amber-400' : 'text-red-400'}>{fmt.roas(v)}</span> },
    { key: 'metaCpr',          label: 'CPR',             align: 'right', width: 80,  render: v => fmt.currency(v) },
    { key: 'purchases',        label: 'Purchases',       align: 'right', width: 80,  render: v => fmt.number(v) },
    { key: 'impressions',      label: 'Impressions',     align: 'right', width: 100, render: v => fmt.number(v) },
    { key: 'ctrAll',           label: 'CTR',             align: 'right', width: 65,  render: v => fmt.pct(v) },
    { key: 'outboundCtr',      label: 'Outbound CTR',    align: 'right', width: 100, render: v => fmt.pct(v) },
    { key: 'frequency',        label: 'Freq',            align: 'right', width: 60,  render: v => fmt.decimal(v) },
    { key: 'cpm',              label: 'CPM',             align: 'right', width: 75,  render: v => fmt.currency(v) },
    { key: 'lpvRate',          label: 'LPV Rate',        align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'atcRate',          label: 'ATC Rate',        align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'convRate',         label: 'Conv Rate',       align: 'right', width: 80,  render: v => fmt.pct(v) },
    { key: 'aov',              label: 'AOV',             align: 'right', width: 80,  render: v => fmt.currency(v) },
    { key: 'spendDelta',       label: 'Spend Δ 30D',     align: 'right', width: 90,
      render: v => { const n = safeNum(v); return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>; }
    },
    { key: 'roasDelta',        label: 'ROAS Δ 30D',      align: 'right', width: 90,
      render: v => { const n = safeNum(v); return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>; }
    },
    { key: 'cprDelta',         label: 'CPR Δ 30D',       align: 'right', width: 85,
      render: v => { const n = safeNum(v); return <span className={n <= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt.delta(n)}</span>; }
    },
    { key: 'spend30d',         label: 'Spend 30D',       align: 'right', width: 90,  render: v => fmt.currency(v) },
    { key: 'metaRoas30d',      label: 'ROAS 30D',        align: 'right', width: 80,  render: v => fmt.roas(v) },
    { key: 'audienceFamily',   label: 'Audience',        width: 100, render: v => v ? <Badge label={v} size="xs" /> : '—' },
    { key: 'customerState',    label: 'Cust State',      width: 110 },
    { key: 'creativeDominance',label: 'Creative',        width: 120 },
    { key: 'collection',       label: 'Collection',      width: 100 },
    { key: 'offerType',        label: 'Offer',           width: 100 },
    { key: 'campaignType',     label: 'Camp Type',       width: 100 },
    { key: 'geography',        label: 'Geo',             width: 100 },
    { key: 'statusOverride',   label: 'Override',        width: 120 },
    { key: 'notes',            label: 'Notes',           width: 140 },
    { key: 'adId',             label: 'Ad ID',           width: 140, render: v => <span className="font-mono text-[10px] text-slate-600">{v}</span> },
    { key: 'dateStart',        label: 'Date Start',      width: 90 },
    { key: 'dateStop',         label: 'Date Stop',       width: 90 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-slate-700/40">
          <Database size={20} className="text-slate-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Raw Flat Data</h1>
          <p className="text-sm text-slate-500 mt-1">
            All {enrichedRows.length} ad rows enriched with labels, benchmarks, and trend signals.
          </p>
        </div>
      </div>

      <DataTable columns={columns} data={enrichedRows} onEditRow={setEditRow} onViewRow={setViewRow} />

      {editRow && <ManualEditDrawer row={editRow} onClose={() => setEditRow(null)} />}
      {viewRow && <AdDetailDrawer row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}
