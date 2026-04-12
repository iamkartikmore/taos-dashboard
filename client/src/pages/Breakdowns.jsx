import { useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import {
  BarChart2, BarChart3, Globe, Monitor, Users, Zap, Target,
  TrendingUp, AlertTriangle, CheckCircle,
} from 'lucide-react';
import { useStore } from '../store';
import { BREAKDOWN_SPECS, pullAllBreakdowns } from '../lib/breakdownApi';
import {
  buildDimSummary, buildAdsetSummary, buildQuickWins, computeHealthBand,
} from '../lib/breakdownAnalytics';
import { fmt, safeNum } from '../lib/analytics';
import MetricCard from '../components/ui/MetricCard';
import DataTable from '../components/ui/DataTable';
import Spinner from '../components/ui/Spinner';

/* ─── HELPERS ────────────────────────────────────────────────────────── */

function roasColor(roas) {
  const v = safeNum(roas);
  if (v >= 5)   return '#34d399'; // emerald
  if (v >= 3)   return '#f59e0b'; // amber
  if (v >= 1.5) return '#fb923c'; // orange
  return '#ef4444';               // red
}

const HEALTH_COLORS = {
  strong: { bg: '#064e3b', text: '#34d399' },
  normal: { bg: '#1e293b', text: '#94a3b8' },
  weak:   { bg: '#451a03', text: '#fbbf24' },
  bad:    { bg: '#450a0a', text: '#f87171' },
};

const REC_COLORS = {
  'Scale Hard': { bg: '#052e16', text: '#4ade80' },
  'Scale':      { bg: '#052e16', text: '#34d399' },
  'Defend':     { bg: '#082f49', text: '#38bdf8' },
  'Fix':        { bg: '#422006', text: '#fbbf24' },
  'Kill':       { bg: '#450a0a', text: '#f87171' },
  'Watch':      { bg: '#1e293b', text: '#94a3b8' },
};

function HealthBadge({ band }) {
  const c = HEALTH_COLORS[band] || HEALTH_COLORS.normal;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold capitalize"
      style={{ background: c.bg, color: c.text }}
    >
      {band}
    </span>
  );
}

function RecBadge({ rec }) {
  const c = REC_COLORS[rec] || REC_COLORS['Watch'];
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      {rec}
    </span>
  );
}

function DeltaPct({ value, median: med }) {
  if (!med || med === 0) return <span className="text-slate-500">—</span>;
  const pct = ((value - med) / med) * 100;
  const color = pct >= 0 ? 'text-emerald-400' : 'text-red-400';
  const sign  = pct >= 0 ? '+' : '';
  return <span className={`tabular-nums text-xs font-medium ${color}`}>{sign}{pct.toFixed(0)}%</span>;
}

const DimTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs space-y-1 min-w-[150px]">
      <div className="font-semibold text-slate-200">{d.label}</div>
      <div className="text-slate-400">Spend: <span className="text-white">{fmt.currency(d.spend)}</span></div>
      <div className="text-slate-400">ROAS: <span className="font-bold" style={{ color: roasColor(d.roas) }}>{fmt.roas(d.roas)}</span></div>
      <div className="text-slate-400">CPR: <span className="text-white">{fmt.currency(d.cpr)}</span></div>
      <div className="text-slate-400">Purchases: <span className="text-white">{fmt.number(d.purchases)}</span></div>
      <div className="text-slate-400">Conv%: <span className="text-white">{fmt.pct(d.convRate)}</span></div>
    </div>
  );
};

/* ─── SPEND × ROAS × CPR PANEL ──────────────────────────────────────── */
// Shows bars sized by SPEND (what's actually running), coloured by ROAS,
// with CPR shown as a label. Low-spend rows are dimmed.

function SpendMatrix({ title, data, minSpendPct = 0 }) {
  const rows = (data || []).filter(d => d.spend > 0);
  if (!rows.length) return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h3>
      <p className="text-slate-600 text-xs py-6 text-center">No data</p>
    </div>
  );

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const threshold = totalSpend * (minSpendPct / 100);
  const sorted = [...rows].sort((a, b) => b.spend - a.spend).slice(0, 15);
  const maxSpend = sorted[0]?.spend || 1;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h3>
        <div className="flex items-center gap-3 text-[9px] text-slate-600">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ≥4x</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 2-4x</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> &lt;2x</span>
        </div>
      </div>
      <div className="space-y-2.5">
        {sorted.map(d => {
          const pct = (d.spend / maxSpend) * 100;
          const sharePct = totalSpend > 0 ? (d.spend / totalSpend) * 100 : 0;
          const lowSpend = threshold > 0 && d.spend < threshold;
          return (
            <div key={d.label} className={lowSpend ? 'opacity-40' : ''}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-slate-300 font-medium truncate max-w-[130px]" title={d.label}>{d.label}</span>
                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  <span className="font-bold" style={{ color: roasColor(d.roas) }}>{fmt.roas(d.roas)}</span>
                  <span className="text-slate-400">CPR {fmt.currency(d.cpr)}</span>
                  <span className="text-slate-500">{fmt.currency(d.spend)}</span>
                  <span className="text-slate-600 w-8 text-right">{sharePct.toFixed(0)}%</span>
                </div>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: roasColor(d.roas) }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-slate-700 mt-3">Bar = spend share · colour = ROAS · % = share of total</div>
    </div>
  );
}

// Keep the old chart for the adset/campaign charts that still need recharts
function HBarChart({ title, data, dataKey, label, height = 220 }) {
  const sliced = data.slice(0, 15);
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h3>
      {sliced.length === 0 ? (
        <p className="text-slate-600 text-xs py-6 text-center">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={sliced} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<DimTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar dataKey={dataKey} name={label} radius={3} maxBarSize={18}>
              {sliced.map((d, i) => (
                <Cell key={i} fill={dataKey === 'roas' ? roasColor(d.roas) : '#2d7cf6'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ─── DIM METRICS TABLE ──────────────────────────────────────────────── */

function DimTable({ data, rowKey = 'label' }) {
  const cols = [
    { key: 'label',    label: 'Dimension',  width: 130 },
    { key: 'spend',    label: 'Spend',      align: 'right', render: v => fmt.currency(v) },
    { key: 'roas',     label: 'ROAS',       align: 'right', render: v => <span style={{ color: roasColor(v) }} className="font-bold">{fmt.roas(v)}</span> },
    { key: 'cpr',      label: 'CPR',        align: 'right', render: v => fmt.currency(v) },
    { key: 'purchases',label: 'Purchases',  align: 'right', render: v => fmt.number(v) },
    { key: 'impressions', label: 'Impr',    align: 'right', render: v => fmt.number(v) },
    { key: 'cpm',      label: 'CPM',        align: 'right', render: v => fmt.currency(v) },
    { key: 'convRate', label: 'Conv%',       align: 'right', render: v => fmt.pct(v) },
  ];
  return <DataTable columns={cols} data={data} rowKey={rowKey} />;
}

/* ─── ACCOUNT MULTI-SELECT ───────────────────────────────────────────── */

function AccountSelect({ accounts, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const allSelected = selected.length === accounts.length;

  const toggle = key => {
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const toggleAll = () => {
    if (allSelected) onChange([]);
    else onChange(accounts.map(a => a.key));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-300 hover:bg-gray-700 transition-colors"
      >
        <Users size={12} />
        Accounts
        <span className="px-1.5 py-0.5 rounded-full bg-brand-600/30 text-brand-300 text-[10px] font-bold">
          {selected.length}
        </span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 min-w-[160px]">
          <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer text-xs text-slate-300">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-brand-500" />
            All accounts
          </label>
          <div className="border-t border-gray-800 my-1" />
          {accounts.map(a => (
            <label key={a.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={selected.includes(a.key)}
                onChange={() => toggle(a.key)}
                className="accent-brand-500"
              />
              {a.key || a.id}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── TABS ───────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'demo',      label: 'Demographics' },
  { id: 'platform',  label: 'Platform & Device' },
  { id: 'geo',       label: 'Geography' },
  { id: 'hourly',    label: 'Hourly' },
  { id: 'campaign',  label: 'Campaigns' },
  { id: 'adset',     label: 'Adsets' },
  { id: 'ads',       label: 'Ads' },
];

/* ─── OVERVIEW TAB ───────────────────────────────────────────────────── */

function OverviewTab({ breakdownRows }) {
  const baseRows = breakdownRows.base || [];

  const totals = useMemo(() => {
    const spend     = baseRows.reduce((s, r) => s + safeNum(r.spend),     0);
    const purchases = baseRows.reduce((s, r) => s + safeNum(r.purchases), 0);
    const revenue   = baseRows.reduce((s, r) => s + safeNum(r.revenue),   0);
    const roasRows  = baseRows.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
    const roasSpend = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
    const roas      = roasSpend > 0
      ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend
      : 0;
    const cprRows   = baseRows.filter(r => safeNum(r.metaCpr) > 0 && safeNum(r.purchases) > 0);
    const cprPurch  = cprRows.reduce((s, r) => s + safeNum(r.purchases), 0);
    const cpr       = cprPurch > 0
      ? cprRows.reduce((s, r) => s + safeNum(r.metaCpr) * safeNum(r.purchases), 0) / cprPurch
      : 0;
    return { spend, purchases, revenue, roas, cpr };
  }, [baseRows]);

  const ageSummary      = useMemo(() => buildDimSummary(breakdownRows.age      || [], 'bdAge'),      [breakdownRows.age]);
  const genderSummary   = useMemo(() => buildDimSummary(breakdownRows.gender   || [], 'bdGender'),   [breakdownRows.gender]);
  const platformSummary = useMemo(() => buildDimSummary(breakdownRows.platform || [], 'bdPlatform'), [breakdownRows.platform]);
  const deviceSummary   = useMemo(() => buildDimSummary(breakdownRows.device   || [], 'bdDevice'),   [breakdownRows.device]);
  const countrySummary  = useMemo(() => buildDimSummary(breakdownRows.country  || [], 'bdCountry'),  [breakdownRows.country]);

  const quickWins = useMemo(() => buildQuickWins({
    age: ageSummary, gender: genderSummary, platform: platformSummary,
    device: deviceSummary, country: countrySummary,
  }), [ageSummary, genderSummary, platformSummary, deviceSummary, countrySummary]);

  const topPerformers = useMemo(() => {
    const best = arr => arr.filter(d => d.spend > 0).sort((a, b) => b.roas - a.roas)[0];
    return [
      { dim: 'Age',      item: best(ageSummary) },
      { dim: 'Gender',   item: best(genderSummary) },
      { dim: 'Platform', item: best(platformSummary) },
      { dim: 'Device',   item: best(deviceSummary) },
      { dim: 'Country',  item: best(countrySummary) },
    ].filter(d => d.item);
  }, [ageSummary, genderSummary, platformSummary, deviceSummary, countrySummary]);

  const WIN_ICONS = { Users, AlertTriangle, Monitor, Globe, Target };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total Spend"    value={fmt.currency(totals.spend)}      icon={Target}     color="blue" />
        <MetricCard label="Avg ROAS"       value={fmt.roas(totals.roas)}            icon={TrendingUp} color="green" />
        <MetricCard label="Avg CPR"        value={fmt.currency(totals.cpr)}         icon={Zap}        color="amber" />
        <MetricCard label="Total Purchases" value={fmt.number(totals.purchases)}    icon={CheckCircle} color="purple" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Top Performers by Dimension</h3>
          <div className="space-y-2">
            {topPerformers.map(({ dim, item }) => (
              <div key={dim} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/50">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">{dim}</span>
                  <div className="text-sm font-semibold text-slate-200">{item.label}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm" style={{ color: roasColor(item.roas) }}>{fmt.roas(item.roas)}</div>
                  <div className="text-[10px] text-slate-500">{fmt.currency(item.spend)} spend</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Wins</h3>
          {quickWins.length === 0 ? (
            <p className="text-slate-600 text-xs py-6 text-center">No actionable insights yet</p>
          ) : (
            <div className="space-y-2">
              {quickWins.map((w, i) => {
                const Icon = WIN_ICONS[w.icon] || CheckCircle;
                return (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-gray-800/50">
                    <Icon size={13} className={w.impact === 'high' ? 'text-amber-400 mt-0.5 shrink-0' : 'text-slate-500 mt-0.5 shrink-0'} />
                    <p className="text-xs text-slate-300 leading-relaxed">{w.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">All Dimensions — Summary</h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[
            { label: 'By Age',      data: ageSummary },
            { label: 'By Gender',   data: genderSummary },
            { label: 'By Platform', data: platformSummary },
            { label: 'By Device',   data: deviceSummary },
          ].map(({ label, data }) => (
            <div key={label}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{label}</p>
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-900">
                      <th className="px-2 py-2 text-left text-slate-500">Dimension</th>
                      <th className="px-2 py-2 text-right text-slate-500">Spend</th>
                      <th className="px-2 py-2 text-right text-slate-500">ROAS</th>
                      <th className="px-2 py-2 text-right text-slate-500">CPR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 8).map((d, i) => (
                      <tr key={d.label} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
                        <td className="px-2 py-1.5 text-slate-300">{d.label || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{fmt.currency(d.spend)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-bold" style={{ color: roasColor(d.roas) }}>{fmt.roas(d.roas)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{fmt.currency(d.cpr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── DEMOGRAPHICS TAB ───────────────────────────────────────────────── */

function DemographicsTab({ breakdownRows }) {
  const ageSummary    = useMemo(() => buildDimSummary(breakdownRows.age      || [], 'bdAge'),    [breakdownRows.age]);
  const genderSummary = useMemo(() => buildDimSummary(breakdownRows.gender   || [], 'bdGender'), [breakdownRows.gender]);

  const ageGenderRows = breakdownRows.age_gender || [];

  const ageGenderMatrix = useMemo(() => {
    const genders   = [...new Set(ageGenderRows.map(r => r.bdGender).filter(Boolean))];
    const ages      = [...new Set(ageGenderRows.map(r => r.bdAge).filter(Boolean))];
    const cellMap   = {};
    ageGenderRows.forEach(r => {
      const k = `${r.bdAge}__${r.bdGender}`;
      if (!cellMap[k]) cellMap[k] = [];
      cellMap[k].push(r);
    });
    const cells = {};
    ages.forEach(age => {
      genders.forEach(gender => {
        const k = `${age}__${gender}`;
        const rows = cellMap[k] || [];
        if (!rows.length) { cells[k] = null; return; }
        const roasRows  = rows.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
        const roasSpend = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
        const roas = roasSpend > 0
          ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend
          : 0;
        cells[k] = roas;
      });
    });
    return { ages, genders, cells };
  }, [ageGenderRows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SpendMatrix title="Age — Spend · ROAS · CPR" data={ageSummary} minSpendPct={2} />
        <SpendMatrix title="Gender — Spend · ROAS · CPR" data={genderSummary} minSpendPct={2} />
      </div>

      {ageGenderMatrix.ages.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Age × Gender ROAS Matrix</h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-slate-500">Age</th>
                  {ageGenderMatrix.genders.map(g => (
                    <th key={g} className="px-3 py-2 text-center text-slate-500 capitalize">{g}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ageGenderMatrix.ages.map((age, i) => (
                  <tr key={age} className={i % 2 === 0 ? 'bg-gray-950/40' : ''}>
                    <td className="px-3 py-2 text-slate-300 font-medium">{age}</td>
                    {ageGenderMatrix.genders.map(gender => {
                      const val = ageGenderMatrix.cells[`${age}__${gender}`];
                      return (
                        <td key={gender} className="px-3 py-2 text-center tabular-nums font-bold"
                          style={{ color: val !== null ? roasColor(val) : '#475569' }}>
                          {val !== null ? fmt.roas(val) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Full Age Metrics</h3>
        <DimTable data={ageSummary} />
      </div>
    </div>
  );
}

/* ─── PLATFORM & DEVICE TAB ──────────────────────────────────────────── */

function PlatformTab({ breakdownRows }) {
  const platformSummary    = useMemo(() => buildDimSummary(breakdownRows.platform     || [], 'bdPlatform'), [breakdownRows.platform]);
  const platformPosSummary = useMemo(() => buildDimSummary(breakdownRows.platform_pos || [], 'bdPosition'), [breakdownRows.platform_pos]);
  const deviceSummary      = useMemo(() => buildDimSummary(breakdownRows.device       || [], 'bdDevice'),   [breakdownRows.device]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SpendMatrix title="Platform — Spend · ROAS · CPR" data={platformSummary}    minSpendPct={1} />
        <SpendMatrix title="Device — Spend · ROAS · CPR"   data={deviceSummary}      minSpendPct={1} />
        <SpendMatrix title="Platform Position — Spend · ROAS · CPR" data={platformPosSummary} minSpendPct={1} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Platform Metrics</h3>
        <DimTable data={platformSummary} />
      </div>

      {platformPosSummary.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Platform Position Metrics</h3>
          <DimTable data={platformPosSummary} />
        </div>
      )}

      {deviceSummary.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Device Metrics</h3>
          <DimTable data={deviceSummary} />
        </div>
      )}
    </div>
  );
}

/* ─── GEOGRAPHY TAB ──────────────────────────────────────────────────── */

function GeoTab({ breakdownRows }) {
  const countrySummary = useMemo(() => buildDimSummary(breakdownRows.country || [], 'bdCountry'), [breakdownRows.country]);
  const regionSummary  = useMemo(() => buildDimSummary(breakdownRows.region  || [], 'bdRegion'),  [breakdownRows.region]);

  const top15Roas  = useMemo(() => [...countrySummary].sort((a, b) => b.roas  - a.roas).slice(0, 15), [countrySummary]);
  const top15Spend = useMemo(() => [...countrySummary].sort((a, b) => b.spend - a.spend).slice(0, 15), [countrySummary]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SpendMatrix title="Countries by Spend — ROAS · CPR" data={top15Spend} minSpendPct={1} />
        <SpendMatrix title="Countries by ROAS (top spenders)" data={top15Roas}  minSpendPct={1} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Country Metrics</h3>
        <DimTable data={countrySummary} />
      </div>

      {regionSummary.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Region Metrics</h3>
          <DimTable data={regionSummary} />
        </div>
      )}
    </div>
  );
}

/* ─── ADSET INTEL TAB ────────────────────────────────────────────────── */

function AdsetTab({ breakdownRows }) {
  const adsets = useMemo(() => buildAdsetSummary(breakdownRows.base || []), [breakdownRows.base]);

  const counts = useMemo(() => ({
    total:   adsets.length,
    scaling: adsets.filter(a => a.recommendation === 'Scale Hard' || a.recommendation === 'Scale').length,
    fixing:  adsets.filter(a => a.recommendation === 'Fix').length,
    killing: adsets.filter(a => a.recommendation === 'Kill').length,
  }), [adsets]);

  const byRec = useMemo(() => {
    const groups = {};
    adsets.forEach(a => {
      if (!groups[a.recommendation]) groups[a.recommendation] = [];
      groups[a.recommendation].push(a);
    });
    return groups;
  }, [adsets]);

  const columns = [
    { key: 'adSetName',    label: 'Adset',    width: 160, render: (v, r) => (
      <div>
        <div className="text-slate-200 font-medium truncate max-w-[150px]" title={v}>{v || r.adsetId}</div>
        <div className="text-[10px] text-slate-600 truncate">{r.campaignName}</div>
      </div>
    )},
    { key: 'accountKey',   label: 'Account',  width: 100 },
    { key: 'adCount',      label: 'Rows',     align: 'right', render: v => fmt.number(v) },
    { key: 'spend',        label: 'Spend',    align: 'right', render: v => fmt.currency(v) },
    { key: 'roas',         label: 'ROAS',     align: 'right', render: (v, r) => (
      <span style={{ color: roasColor(v) }} className="font-bold">{fmt.roas(v)}</span>
    )},
    { key: 'roas',         label: 'vs Med ROAS', align: 'right', sortable: false, render: (v, r) => (
      <DeltaPct value={v} median={r.accountMedianRoas} />
    )},
    { key: 'cpr',          label: 'CPR',      align: 'right', render: v => fmt.currency(v) },
    { key: 'cpr',          label: 'vs Med CPR', align: 'right', sortable: false, render: (v, r) => (
      <DeltaPct value={v} median={r.accountMedianCpr} />
    )},
    { key: 'roasHealth',   label: 'Health',   sortable: false, render: v => <HealthBadge band={v} /> },
    { key: 'recommendation', label: 'Action', sortable: false, render: v => <RecBadge rec={v} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total Adsets"  value={counts.total}   icon={BarChart2}    color="blue" />
        <MetricCard label="Scaling"       value={counts.scaling} icon={TrendingUp}   color="green" />
        <MetricCard label="Needs Fix"     value={counts.fixing}  icon={AlertTriangle} color="amber" />
        <MetricCard label="Kill"          value={counts.killing} icon={Target}       color="red" />
      </div>

      <DataTable
        columns={columns}
        data={adsets}
        rowKey="adsetId"
      />

      {Object.keys(byRec).length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recommendations by Type</h3>
          <div className="space-y-4">
            {['Scale Hard', 'Scale', 'Defend', 'Fix', 'Kill', 'Watch'].filter(rec => byRec[rec]?.length).map(rec => (
              <div key={rec}>
                <div className="flex items-center gap-2 mb-2">
                  <RecBadge rec={rec} />
                  <span className="text-xs text-slate-500">{byRec[rec].length} adset{byRec[rec].length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-1 pl-2">
                  {byRec[rec].slice(0, 6).map(a => (
                    <div key={a.adsetId} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-gray-800/40">
                      <span className="text-slate-300 truncate max-w-[240px]">{a.adSetName}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-slate-500">{a.accountKey}</span>
                        <span style={{ color: roasColor(a.roas) }} className="font-bold tabular-nums">{fmt.roas(a.roas)}</span>
                        <span className="text-slate-400 tabular-nums">{fmt.currency(a.spend)}</span>
                      </div>
                    </div>
                  ))}
                  {byRec[rec].length > 6 && (
                    <p className="text-[10px] text-slate-600 pl-3">+ {byRec[rec].length - 6} more</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── HOURLY TAB ─────────────────────────────────────────────────────── */

function HourlyTab({ breakdownRows }) {
  const [tz, setTz] = useState('adv'); // adv | aud

  const hourRows = tz === 'adv'
    ? (breakdownRows.hour_adv || [])
    : (breakdownRows.hour_aud || []);

  const hourSummary = useMemo(() => {
    const groups = {};
    hourRows.forEach(r => {
      const h = r.bdHourAdvN ?? r.bdHourAudN;
      if (h === null || h === undefined) return;
      if (!groups[h]) groups[h] = [];
      groups[h].push(r);
    });
    return Array.from({ length: 24 }, (_, h) => {
      const items = groups[h] || [];
      const spend = items.reduce((s, r) => s + safeNum(r.spend), 0);
      const roasRows = items.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
      const roasSpend = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
      const roas = roasSpend > 0
        ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend
        : 0;
      const purchases = items.reduce((s, r) => s + safeNum(r.purchases), 0);
      const impressions = items.reduce((s, r) => s + safeNum(r.impressions), 0);
      const label = `${String(h).padStart(2, '0')}:00`;
      return { h, label, spend, roas, purchases, impressions };
    }).filter(d => d.spend > 0 || hourRows.length === 0);
  }, [hourRows]);

  const hasHour = hourSummary.length > 0;

  const HourTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-xl text-xs">
        <div className="font-bold text-slate-200 mb-1">{d.label}</div>
        <div className="text-slate-400">ROAS: <span style={{ color: roasColor(d.roas) }} className="font-bold">{fmt.roas(d.roas)}</span></div>
        <div className="text-slate-400">Spend: <span className="text-white">{fmt.currency(d.spend)}</span></div>
        <div className="text-slate-400">Purchases: <span className="text-white">{fmt.number(d.purchases)}</span></div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Timezone:</span>
        {[['adv','Advertiser TZ'], ['aud','Audience TZ']].map(([v, l]) => (
          <button key={v} onClick={() => setTz(v)}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              tz === v ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40' : 'text-slate-400 hover:text-slate-200'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {!hasHour ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-600 gap-2 text-sm">
          <BarChart3 size={28} />
          <p>No hourly data — pull with Hour breakdown selected</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">ROAS by Hour</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={hourSummary} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<HourTooltip />} />
                  <Line type="monotone" dataKey="roas" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Spend by Hour</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourSummary} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<HourTooltip />} />
                  <Bar dataKey="spend" fill="#2d7cf6" radius={2} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top / worst hours */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Best Hours by ROAS</h3>
              <div className="space-y-1.5">
                {[...hourSummary].filter(d => d.roas > 0).sort((a, b) => b.roas - a.roas).slice(0, 8).map(d => (
                  <div key={d.h} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-800/50 text-xs">
                    <span className="text-slate-300 font-medium">{d.label}</span>
                    <div className="flex items-center gap-4">
                      <span style={{ color: roasColor(d.roas) }} className="font-bold tabular-nums">{fmt.roas(d.roas)}</span>
                      <span className="text-slate-500 tabular-nums">{fmt.currency(d.spend)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Worst Hours by ROAS</h3>
              <div className="space-y-1.5">
                {[...hourSummary].filter(d => d.spend > 50).sort((a, b) => a.roas - b.roas).slice(0, 8).map(d => (
                  <div key={d.h} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-800/50 text-xs">
                    <span className="text-slate-300 font-medium">{d.label}</span>
                    <div className="flex items-center gap-4">
                      <span style={{ color: roasColor(d.roas) }} className="font-bold tabular-nums">{fmt.roas(d.roas)}</span>
                      <span className="text-slate-500 tabular-nums">{fmt.currency(d.spend)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── CAMPAIGN TAB ───────────────────────────────────────────────────── */

function CampaignTab({ breakdownRows }) {
  const baseRows = breakdownRows.base || [];

  const campaigns = useMemo(() => {
    const groups = {};
    baseRows.forEach(r => {
      const k = r.campaignId || 'unknown';
      if (!groups[k]) groups[k] = [];
      groups[k].push(r);
    });

    // build per-account medians for health bands
    const byAcct = {};
    baseRows.forEach(r => {
      const k = r.accountKey;
      if (!byAcct[k]) byAcct[k] = [];
      byAcct[k].push(r);
    });
    const acctMed = {};
    Object.entries(byAcct).forEach(([k, rows]) => {
      const spends = rows.map(r => safeNum(r.spend)).filter(v => v > 0).sort((a, b) => a - b);
      const mid = Math.floor(spends.length / 2);
      acctMed[k] = { medSpend: spends.length % 2 ? spends[mid] : (spends[mid - 1] + spends[mid]) / 2 };
    });

    return Object.entries(groups)
      .map(([campaignId, items]) => {
        const first = items[0] || {};
        const spend = items.reduce((s, r) => s + safeNum(r.spend), 0);
        const purchases = items.reduce((s, r) => s + safeNum(r.purchases), 0);
        const revenue = items.reduce((s, r) => s + safeNum(r.revenue), 0);
        const impressions = items.reduce((s, r) => s + safeNum(r.impressions), 0);

        const roasRows = items.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
        const roasSpend = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
        const roas = roasSpend > 0
          ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend : 0;

        const cprRows = items.filter(r => safeNum(r.metaCpr) > 0 && safeNum(r.purchases) > 0);
        const cprPurch = cprRows.reduce((s, r) => s + safeNum(r.purchases), 0);
        const cpr = cprPurch > 0
          ? cprRows.reduce((s, r) => s + safeNum(r.metaCpr) * safeNum(r.purchases), 0) / cprPurch : 0;

        const adCount = new Set(items.map(r => r.adId)).size;
        const adSetCount = new Set(items.map(r => r.adSetId)).size;

        return {
          campaignId,
          campaignName: first.campaignName || campaignId,
          accountKey: first.accountKey || '',
          adCount, adSetCount,
          spend, purchases, revenue, impressions, roas, cpr,
          cpm: spend > 0 && impressions > 0 ? spend / impressions * 1000 : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [baseRows]);

  const columns = [
    { key: 'campaignName', label: 'Campaign', width: 180,
      render: (v, r) => <div><div className="text-slate-200 font-medium break-words whitespace-normal leading-snug">{v || r.campaignId}</div><div className="text-[10px] text-slate-600">{r.accountKey}</div></div> },
    { key: 'adSetCount', label: 'Adsets', align: 'right', render: v => fmt.number(v) },
    { key: 'adCount',    label: 'Ads',    align: 'right', render: v => fmt.number(v) },
    { key: 'spend',      label: 'Spend',  align: 'right', render: v => fmt.currency(v) },
    { key: 'roas',       label: 'ROAS',   align: 'right', render: v => <span style={{ color: roasColor(v) }} className="font-bold">{fmt.roas(v)}</span> },
    { key: 'cpr',        label: 'CPR',    align: 'right', render: v => fmt.currency(v) },
    { key: 'purchases',  label: 'Purchases', align: 'right', render: v => fmt.number(v) },
    { key: 'revenue',    label: 'Revenue',   align: 'right', render: v => fmt.currency(v) },
    { key: 'cpm',        label: 'CPM',    align: 'right', render: v => fmt.currency(v) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          ['Campaigns',  campaigns.length,                              BarChart3,   'blue'],
          ['Total Spend', fmt.currency(campaigns.reduce((s, c) => s + c.spend, 0)), TrendingUp, 'green'],
          ['Avg ROAS',   (() => { const r = campaigns.filter(c => c.roas > 0); return fmt.roas(r.length ? r.reduce((s, c) => s + c.roas, 0) / r.length : 0); })(), CheckCircle, 'amber'],
          ['Purchases',  fmt.number(campaigns.reduce((s, c) => s + c.purchases, 0)), Users, 'purple'],
        ].map(([label, value, Icon, color]) => (
          <MetricCard key={label} label={label} value={value} icon={Icon} color={color} />
        ))}
      </div>

      <HBarChart title="Campaign ROAS" data={campaigns.slice(0, 20)} dataKey="roas" label="ROAS" height={Math.max(180, campaigns.slice(0, 20).length * 28)} />

      <DataTable columns={columns} data={campaigns} rowKey="campaignId" />
    </div>
  );
}

/* ─── ADS TAB ────────────────────────────────────────────────────────── */

function AdsTab({ breakdownRows }) {
  const baseRows = breakdownRows.base || [];

  const ads = useMemo(() => {
    const groups = {};
    baseRows.forEach(r => {
      if (!r.adId) return;
      if (!groups[r.adId]) groups[r.adId] = [];
      groups[r.adId].push(r);
    });

    return Object.entries(groups)
      .map(([adId, items]) => {
        const first = items[0] || {};
        const spend = items.reduce((s, r) => s + safeNum(r.spend), 0);
        const purchases = items.reduce((s, r) => s + safeNum(r.purchases), 0);
        const revenue = items.reduce((s, r) => s + safeNum(r.revenue), 0);
        const impressions = items.reduce((s, r) => s + safeNum(r.impressions), 0);

        const roasRows = items.filter(r => safeNum(r.metaRoas) > 0 && safeNum(r.spend) > 0);
        const roasSpend = roasRows.reduce((s, r) => s + safeNum(r.spend), 0);
        const roas = roasSpend > 0
          ? roasRows.reduce((s, r) => s + safeNum(r.metaRoas) * safeNum(r.spend), 0) / roasSpend : 0;

        const cprRows = items.filter(r => safeNum(r.metaCpr) > 0 && safeNum(r.purchases) > 0);
        const cprPurch = cprRows.reduce((s, r) => s + safeNum(r.purchases), 0);
        const cpr = cprPurch > 0
          ? cprRows.reduce((s, r) => s + safeNum(r.metaCpr) * safeNum(r.purchases), 0) / cprPurch : 0;

        const outbound = items.reduce((s, r) => s + safeNum(r.outboundClicks), 0);
        const lpv = items.reduce((s, r) => s + safeNum(r.lpv), 0);
        const atc = items.reduce((s, r) => s + safeNum(r.atc), 0);
        const convRate = outbound > 0 ? purchases / outbound * 100 : 0;

        return {
          adId, spend, purchases, revenue, impressions, roas, cpr, convRate,
          adName: first.adName || adId,
          adSetName: first.adSetName || '',
          campaignName: first.campaignName || '',
          accountKey: first.accountKey || '',
          cpm: spend > 0 && impressions > 0 ? spend / impressions * 1000 : 0,
          lpvRate: outbound > 0 ? lpv / outbound * 100 : 0,
          atcRate: lpv > 0 ? atc / lpv * 100 : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [baseRows]);

  const columns = [
    { key: 'adName',      label: 'Ad',       width: 200,
      render: (v, r) => <div>
        <div className="text-slate-200 break-words whitespace-normal leading-snug">{v}</div>
        <div className="text-[10px] text-slate-600">{r.adSetName}</div>
      </div> },
    { key: 'accountKey',  label: 'Account',  width: 80 },
    { key: 'spend',       label: 'Spend',    align: 'right', render: v => fmt.currency(v) },
    { key: 'roas',        label: 'ROAS',     align: 'right', render: v => <span style={{ color: roasColor(v) }} className="font-bold">{fmt.roas(v)}</span> },
    { key: 'cpr',         label: 'CPR',      align: 'right', render: v => fmt.currency(v) },
    { key: 'purchases',   label: 'Purchases',align: 'right', render: v => fmt.number(v) },
    { key: 'cpm',         label: 'CPM',      align: 'right', render: v => fmt.currency(v) },
    { key: 'lpvRate',     label: 'LPV Rate', align: 'right', render: v => fmt.pct(v) },
    { key: 'atcRate',     label: 'ATC Rate', align: 'right', render: v => fmt.pct(v) },
    { key: 'convRate',    label: 'Conv%',    align: 'right', render: v => fmt.pct(v) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{ads.length} ads with breakdown data</span>
        <span>Total spend: {fmt.currency(ads.reduce((s, a) => s + a.spend, 0))}</span>
      </div>
      <DataTable columns={columns} data={ads} rowKey="adId" />
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */

export default function Breakdowns() {
  const { config, breakdownRows, breakdownStatus, lastBreakdownAt, setBreakdownData, setBreakdownStatus } = useStore();

  const [tab, setTab] = useState('overview');
  const [selectedAccounts, setSelectedAccounts] = useState(() => config.accounts.map(a => a.key));
  const [window, setWindow] = useState('7D');
  const [dateRange, setDateRange] = useState({ since: '', until: '' });
  const [pullLog, setPullLog] = useState([]);

  const accounts = config.accounts.filter(a => a.id && a.key);
  const activeAccounts = accounts.filter(a => selectedAccounts.includes(a.key));

  const hasData = Object.keys(breakdownRows).some(k => (breakdownRows[k] || []).length > 0);

  const handlePull = async () => {
    if (!config.token || activeAccounts.length === 0) return;
    setBreakdownStatus('loading');
    setPullLog([]);

    const onProgress = msg => setPullLog(prev => [...prev.slice(-4), msg]);

    try {
      const raw = await pullAllBreakdowns({
        ver:       config.apiVersion || 'v21.0',
        token:     config.token,
        accounts:  activeAccounts,
        specs:     BREAKDOWN_SPECS,
        window,
        dateRange: window === 'custom' ? dateRange : null,
      }, onProgress);
      setBreakdownData(raw);
    } catch (err) {
      setBreakdownStatus('error');
      setPullLog(prev => [...prev.slice(-4), `ERROR: ${err.message}`]);
    }
  };

  const filteredRows = useMemo(() => {
    if (!hasData) return {};
    const out = {};
    Object.entries(breakdownRows).forEach(([bdKey, rows]) => {
      out[bdKey] = selectedAccounts.length === accounts.length
        ? rows
        : rows.filter(r => selectedAccounts.includes(r.accountKey));
    });
    return out;
  }, [breakdownRows, selectedAccounts, accounts.length, hasData]);

  return (
    <div className="space-y-0">
      {/* Sticky control bar */}
      <div className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-6 py-3 -mx-6 -mt-6 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-2">
            <div className="p-1.5 rounded-lg bg-brand-600/20">
              <BarChart2 size={14} className="text-brand-400" />
            </div>
            <span className="text-sm font-bold text-white">Breakdown Analytics</span>
          </div>

          <AccountSelect
            accounts={accounts}
            selected={selectedAccounts}
            onChange={setSelectedAccounts}
          />

          <div className="flex items-center gap-1 p-1 bg-gray-900 border border-gray-800 rounded-lg">
            {['Today', '7D', '14D', '30D', 'custom'].map(w => (
              <button
                key={w}
                onClick={() => setWindow(w === 'Today' ? 'today' : w)}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  (window === 'today' ? 'Today' : window) === w
                    ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          {window === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={dateRange.since}
                onChange={e => setDateRange(d => ({ ...d, since: e.target.value }))}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <span className="text-slate-600">→</span>
              <input
                type="date"
                value={dateRange.until}
                onChange={e => setDateRange(d => ({ ...d, until: e.target.value }))}
                className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}

          <button
            onClick={handlePull}
            disabled={breakdownStatus === 'loading' || !config.token || activeAccounts.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {breakdownStatus === 'loading' ? <Spinner size="sm" /> : <Zap size={12} />}
            {breakdownStatus === 'loading' ? 'Pulling...' : 'Pull Breakdown Data'}
          </button>

          {lastBreakdownAt && (
            <span className="text-[10px] text-slate-600 ml-auto">
              Last pulled {new Date(lastBreakdownAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {pullLog.length > 0 && (
          <div className="mt-2 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800 font-mono text-[10px] text-slate-500 space-y-0.5">
            {pullLog.map((line, i) => (
              <div key={i} className={line.startsWith('ERROR') ? 'text-red-400' : ''}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {!hasData ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-24 gap-5 text-center"
        >
          <div className="p-4 rounded-2xl bg-gray-900 border border-gray-800">
            <BarChart2 size={32} className="text-slate-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-300">No Breakdown Data Yet</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">
              Select your accounts and time window, then click <span className="text-brand-400 font-medium">Pull Breakdown Data</span> to fetch
              age, gender, platform, device, country, and region breakdowns from the Meta API.
            </p>
          </div>
          {accounts.length === 0 && (
            <p className="text-xs text-amber-400">No accounts configured — visit Setup to add accounts.</p>
          )}
        </motion.div>
      ) : (
        <div className="space-y-5">
          <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id
                    ? 'bg-brand-600/30 text-brand-300 ring-1 ring-brand-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {tab === 'overview'  && <OverviewTab     breakdownRows={filteredRows} />}
            {tab === 'demo'      && <DemographicsTab breakdownRows={filteredRows} />}
            {tab === 'platform'  && <PlatformTab     breakdownRows={filteredRows} />}
            {tab === 'geo'       && <GeoTab          breakdownRows={filteredRows} />}
            {tab === 'hourly'    && <HourlyTab       breakdownRows={filteredRows} />}
            {tab === 'campaign'  && <CampaignTab     breakdownRows={filteredRows} />}
            {tab === 'adset'     && <AdsetTab        breakdownRows={filteredRows} />}
            {tab === 'ads'       && <AdsTab          breakdownRows={filteredRows} />}
          </motion.div>
        </div>
      )}
    </div>
  );
}
