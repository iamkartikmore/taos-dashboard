import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ListChecks, Filter } from 'lucide-react';
import { useStore } from '../store';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import ManualEditDrawer from '../components/ui/ManualEditDrawer';
import AdDetailDrawer from '../components/ui/AdDetailDrawer';
import { fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';

const DECISION_ORDER = ['Scale Hard','Scale Carefully','Defend','Fix','Watch','Pause','Kill'];
const DECISION_COLORS = {
  'Scale Hard':      'text-emerald-300',
  'Scale Carefully': 'text-teal-300',
  'Defend':          'text-sky-300',
  'Fix':             'text-amber-300',
  'Watch':           'text-slate-400',
  'Kill':            'text-red-300',
  'Pause':           'text-orange-300',
};

export default function DecisionQueue() {
  const { enrichedRows, fetchStatus } = useStore();
  const [filterDecision, setFilterDecision] = useState('All');
  const [filterAccount, setFilterAccount] = useState('All');
  const [minSpend, setMinSpend] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);

  const accounts = useMemo(() =>
    ['All', ...new Set(enrichedRows.map(r => r.accountKey).filter(Boolean))],
  [enrichedRows]);

  const filtered = useMemo(() => {
    let rows = [...enrichedRows].sort((a, b) => {
      const da = DECISION_ORDER.indexOf(a.decision);
      const db = DECISION_ORDER.indexOf(b.decision);
      return (da === -1 ? 99 : da) - (db === -1 ? 99 : db) || safeNum(b.spend) - safeNum(a.spend);
    });
    if (filterDecision !== 'All') rows = rows.filter(r => r.decision === filterDecision);
    if (filterAccount  !== 'All') rows = rows.filter(r => r.accountKey === filterAccount);
    if (minSpend) rows = rows.filter(r => safeNum(r.spend) >= safeNum(minSpend));
    return rows;
  }, [enrichedRows, filterDecision, filterAccount, minSpend]);

  const counts = useMemo(() => {
    const c = {};
    enrichedRows.forEach(r => { c[r.decision] = (c[r.decision] || 0) + 1; });
    return c;
  }, [enrichedRows]);

  if (fetchStatus === 'loading') return <FullPageSpinner message="Loading..." />;

  const columns = [
    {
      key: 'decision', label: 'Action', width: 130,
      render: v => <Badge label={v} />,
    },
    { key: 'adName',       label: 'Ad',        width: 220, render: (v, row) => <span className="text-slate-200 font-medium leading-snug break-words whitespace-normal" title={v}>{v}</span> },
    { key: 'campaignName', label: 'Campaign',  width: 160, render: v => <span className="text-slate-400 text-xs" title={v}>{v}</span> },
    { key: 'accountKey',   label: 'Account',   width: 90  },
    {
      key: 'spend', label: 'Spend', align: 'right', width: 90,
      render: v => <span className="font-semibold">{fmt.currency(v)}</span>,
    },
    {
      key: 'metaRoas', label: 'ROAS', align: 'right', width: 70,
      render: v => (
        <span className={safeNum(v) >= 4 ? 'text-emerald-400 font-bold' : safeNum(v) >= 2.5 ? 'text-amber-400' : 'text-red-400'}>
          {fmt.roas(v)}
        </span>
      ),
    },
    {
      key: 'metaCpr', label: 'CPR', align: 'right', width: 80,
      render: v => <span className={safeNum(v) < 80 ? 'text-emerald-400' : safeNum(v) < 120 ? 'text-amber-400' : 'text-red-400'}>{fmt.currency(v)}</span>,
    },
    {
      key: 'currentQuality', label: 'Quality', width: 90,
      render: v => <Badge label={v} size="xs" />,
    },
    {
      key: 'trendSignal', label: 'Trend', width: 150,
      render: v => <Badge label={v} size="xs" />,
    },
    {
      key: 'ctrAll', label: 'CTR', align: 'right', width: 70,
      render: v => fmt.pct(v),
    },
    {
      key: 'purchases', label: 'Purch', align: 'right', width: 70,
      render: v => fmt.number(v),
    },
    {
      key: 'frequency', label: 'Freq', align: 'right', width: 60,
      render: v => fmt.decimal(v),
    },
    {
      key: 'audienceFamily', label: 'Audience', width: 110,
      render: v => v ? <Badge label={v} size="xs" /> : '—',
    },
    { key: 'collection', label: 'Collection', width: 100 },
    { key: 'notes',      label: 'Notes',      width: 140 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Decision Queue</h1>
        <p className="text-sm text-slate-500 mt-1">Every ad ranked by priority action needed, 7-day window</p>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        {DECISION_ORDER.map(d => (
          <button
            key={d}
            onClick={() => setFilterDecision(filterDecision === d ? 'All' : d)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              filterDecision === d ? 'ring-2 ring-white/20' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <Badge label={d} size="xs" />
            <span className={`${DECISION_COLORS[d]} tabular-nums`}>{counts[d] || 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-gray-900/60 px-4 py-3 rounded-xl border border-gray-800">
        <Filter size={14} className="text-slate-500" />
        <select
          value={filterAccount}
          onChange={e => setFilterAccount(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {accounts.map(a => <option key={a}>{a}</option>)}
        </select>
        <input
          type="number"
          value={minSpend}
          onChange={e => setMinSpend(e.target.value)}
          placeholder="Min spend ₹"
          className="w-32 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} rows</span>
      </div>

      <DataTable columns={columns} data={filtered} onEditRow={setEditRow} onViewRow={setViewRow} />

      {editRow && <ManualEditDrawer row={editRow} onClose={() => setEditRow(null)} />}
      {viewRow && <AdDetailDrawer row={viewRow} onClose={() => setViewRow(null)} />}
    </div>
  );
}
