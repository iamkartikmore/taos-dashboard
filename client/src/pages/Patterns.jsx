import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, CartesianGrid, Legend,
} from 'recharts';
import { Layers } from 'lucide-react';
import { useStore } from '../store';
import { buildPatternSummary, fmt, safeNum } from '../lib/analytics';
import { FullPageSpinner } from '../components/ui/Spinner';
import CrossPatterns from '../components/CrossPatterns';

const COLORS = ['#2d7cf6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80'];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl text-xs space-y-1 min-w-[160px]">
      <div className="font-semibold text-slate-200">{d.label}</div>
      <div className="text-slate-400">Ads: <span className="text-white">{d.count}</span></div>
      <div className="text-slate-400">Spend: <span className="text-white">{fmt.currency(d.spend)}</span></div>
      <div className="text-slate-400">ROAS: <span className="text-violet-300 font-bold">{fmt.roas(d.roas)}</span></div>
      <div className="text-slate-400">CPR: <span className="text-white">{fmt.currency(d.cpr)}</span></div>
      <div className="text-slate-400">Purchases: <span className="text-white">{fmt.number(d.purchases)}</span></div>
      <div className="text-slate-400">Conv%: <span className="text-white">{fmt.pct(d.convRate)}</span></div>
    </div>
  );
};

function PatternChart({ title, groupKey, color = '#2d7cf6', metric = 'roas', metricLabel = 'ROAS' }) {
  const { enrichedRows } = useStore();
  const data = useMemo(() =>
    buildPatternSummary(enrichedRows, groupKey).filter(d => d.label !== 'Unknown' && d.label !== '').slice(0, 12),
  [enrichedRows, groupKey]);

  if (!data.length) return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">{title}</h2>
      <p className="text-sm text-slate-600 text-center py-8">No data — apply manual labels</p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900 rounded-xl border border-gray-800 p-5"
    >
      <h2 className="text-sm font-semibold text-slate-300 mb-4">{title}</h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey={metric} name={metricLabel} radius={4}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Table below chart */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {['Label','Ads','Budget','Spend','ROAS','CPR','Purchases','Conv%'].map(h => (
                <th key={h} className="px-2 py-1.5 text-left text-slate-500 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label} className={i % 2 === 0 ? 'bg-gray-950/30' : ''}>
                <td className="px-2 py-1.5 font-medium text-slate-200">{d.label}</td>
                <td className="px-2 py-1.5 text-slate-400">{d.count}</td>
                <td className="px-2 py-1.5 tabular-nums text-slate-300">{d.budget > 0 ? fmt.currency(d.budget) : <span className="text-slate-700">—</span>}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmt.currency(d.spend)}</td>
                <td className="px-2 py-1.5 tabular-nums font-semibold text-violet-300">{fmt.roas(d.roas)}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmt.currency(d.cpr)}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmt.number(d.purchases)}</td>
                <td className="px-2 py-1.5 tabular-nums">{fmt.pct(d.convRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

function ScatterViz() {
  const { enrichedRows } = useStore();
  const data = enrichedRows
    .filter(r => safeNum(r.spend) > 50 && safeNum(r.metaRoas) > 0)
    .map(r => ({
      label:    r.adName?.slice(0, 30),
      x:        safeNum(r.spend),
      y:        safeNum(r.metaRoas),
      z:        safeNum(r.purchases),
      decision: r.decision,
    }));

  const DECISION_COLORS2 = {
    'Scale Hard': '#22c55e', 'Scale Carefully': '#34d399',
    'Defend': '#38bdf8', 'Fix': '#fbbf24', 'Kill': '#ef4444', 'Watch': '#94a3b8',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900 rounded-xl border border-gray-800 p-5"
    >
      <h2 className="text-sm font-semibold text-slate-300 mb-1">Spend vs ROAS Scatter</h2>
      <p className="text-xs text-slate-500 mb-4">Bubble size = purchases. Color = decision.</p>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart>
          <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
          <XAxis dataKey="x" name="Spend (₹)" type="number" tick={{ fill: '#64748b', fontSize: 10 }}
            label={{ value: 'Spend ₹', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }} />
          <YAxis dataKey="y" name="ROAS" type="number" tick={{ fill: '#64748b', fontSize: 10 }}
            label={{ value: 'ROAS', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
          <ZAxis dataKey="z" range={[40, 400]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs">
                  <div className="font-semibold text-white mb-1">{d.label}</div>
                  <div>Spend: {fmt.currency(d.x)}</div>
                  <div>ROAS: {fmt.roas(d.y)}</div>
                  <div>Purchases: {fmt.number(d.z)}</div>
                </div>
              );
            }}
          />
          {Object.entries(DECISION_COLORS2).map(([dec, color]) => (
            <Scatter
              key={dec}
              name={dec}
              data={data.filter(d => d.decision === dec)}
              fill={color}
              opacity={0.75}
            />
          ))}
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: '#94a3b8', fontSize: 10 }}>{v}</span>} />
        </ScatterChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

export default function Patterns() {
  const { fetchStatus } = useStore();
  const [tab, setTab] = useState('creative');

  if (fetchStatus === 'loading') return <FullPageSpinner />;

  const TABS = [
    { id: 'creative',  label: 'Creative Patterns' },
    { id: 'audience',  label: 'Audience Patterns' },
    { id: 'offer',     label: 'Offer Patterns' },
    { id: 'cross',     label: 'Cross Patterns' },
    { id: 'scatter',   label: 'Spend vs ROAS' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-violet-500/20">
          <Layers size={20} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Pattern Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">Which creative types, audiences, and offers are winning?</p>
        </div>
      </div>

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

      {tab === 'creative' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <PatternChart title="ROAS by Creative Dominance" groupKey="creativeDominance" color="#a78bfa" />
          <PatternChart title="ROAS by Creative Mix"       groupKey="creativeMix"       color="#60a5fa" />
          <PatternChart title="Spend by Collection"        groupKey="collection"  metric="spend" metricLabel="Spend" color="#34d399" />
          <PatternChart title="ROAS by Collection"         groupKey="collection" color="#f472b6" />
        </div>
      )}

      {tab === 'audience' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <PatternChart title="ROAS by Audience Family"   groupKey="audienceFamily"  color="#38bdf8" />
          <PatternChart title="ROAS by Customer State"    groupKey="customerState"   color="#fb923c" />
          <PatternChart title="ROAS by Campaign Type"     groupKey="campaignType"    color="#4ade80" />
          <PatternChart title="Conv% by Audience Family"  groupKey="audienceFamily"  metric="convRate" metricLabel="Conv%" color="#a78bfa" />
        </div>
      )}

      {tab === 'offer' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <PatternChart title="ROAS by Offer Type"         groupKey="offerType"    color="#fbbf24" />
          <PatternChart title="Purchases by Offer Type"    groupKey="offerType"    metric="purchases" metricLabel="Purchases" color="#f472b6" />
          <PatternChart title="ROAS by Geography"          groupKey="geography"    color="#34d399" />
          <PatternChart title="Spend by Offer Type"        groupKey="offerType"    metric="spend" metricLabel="Spend" color="#60a5fa" />
        </div>
      )}

      {tab === 'cross' && <CrossPatterns />}

      {tab === 'scatter' && <ScatterViz />}
    </div>
  );
}
