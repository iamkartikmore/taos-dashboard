import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  Mail, TrendingUp, Users, Flame, AlertCircle, Calendar, Clock, Zap,
  BarChart3, Target, Gift, RefreshCw, Star, Package, ArrowUpRight,
  ChevronRight, Filter, CheckCircle, Circle, PauseCircle, Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import {
  buildSubscribers, summariseList, filterSubscribers, SEGMENT_TEMPLATES,
} from '../lib/emailSegmentation';
import {
  FLOWS, WEEKLY_CALENDAR, MONTHLY_THEMES, currentMonthTheme,
  computeDueSends, projectVolume,
} from '../lib/emailFlows';
import {
  attributeOrdersToCampaigns, programKpis, flowPerformance,
} from '../lib/emailAttribution';

const num = v => Number(v || 0).toLocaleString('en-IN');
const cur = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const pct = v => `${((Number(v) || 0) * 100).toFixed(1)}%`;
const fmtCompact = v => {
  const n = Number(v) || 0;
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

const TIER_COLOR = {
  1: '#22c55e', 2: '#06b6d4', 3: '#a78bfa',
};
const TIER_LABEL = {
  1: 'Tier 1 · Critical', 2: 'Tier 2 · Growth', 3: 'Tier 3 · Hygiene',
};
const PRIORITY_COLOR = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#64748b',
};

const TABS = [
  { id: 'overview',   label: 'Overview',      icon: BarChart3 },
  { id: 'flows',      label: 'Flows (12)',    icon: Zap },
  { id: 'calendar',   label: 'Weekly Calendar', icon: Calendar },
  { id: 'segments',   label: 'Segments',      icon: Filter },
  { id: 'attribution', label: 'Attribution',  icon: TrendingUp },
  { id: 'playbook',   label: 'Playbook',      icon: Target },
];

function KPI({ label, value, sub, icon: Icon, color = '#06b6d4', trend }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest">
        {Icon && <Icon size={11} style={{ color }} />}
        {label}
      </div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
      {trend && (
        <div className={clsx('text-[10px] mt-0.5 font-medium',
          trend.dir === 'up' ? 'text-emerald-400' : 'text-red-400')}>
          {trend.dir === 'up' ? '▲' : '▼'} {trend.label}
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, children, right }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/* ── OVERVIEW TAB ─────────────────────────────────────────────── */
function OverviewTab({ subscribers, kpis, dueVolume, flowStats, summary }) {
  const theme = currentMonthTheme();
  return (
    <div className="space-y-4">
      {/* Top KPI strip — the 4 numbers that matter */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPI label="Subscribers"         value={num(subscribers.length)}                Icon={Users} color="#06b6d4"
             sub={`Total spent ${cur(summary.totalSpent)}`} />
        <KPI label="Rev / email (30d)"   value={cur(kpis.revenuePerEmail)}              Icon={Mail} color="#22c55e"
             sub={kpis.revenuePerEmail > 50 ? 'Strong' : kpis.revenuePerEmail > 20 ? 'Average' : 'Needs work — target ₹50+'} />
        <KPI label="Email rev (30d)"     value={cur(kpis.emailRevenue)}                 Icon={TrendingUp} color="#22c55e"
             sub={`${pct(kpis.pctRevenueFromEmail)} of total revenue`} />
        <KPI label="% from flows"        value={pct(kpis.pctFromFlows)}                 Icon={Zap} color="#f59e0b"
             sub={`target 60-70%`} />
        <KPI label="Due today"           value={num(dueVolume.total)}                   Icon={Clock} color="#ec4899"
             sub={`${dueVolume.byFlow.length} flows active`} />
        <KPI label="Campaigns (30d)"     value={num(kpis.campaignsCount)}               Icon={Calendar} color="#a78bfa"
             sub={`${kpis.broadcastsCount} broadcasts, ${kpis.flowsCount} flow sends`} />
        <KPI label="Monthly theme"       value={theme.theme.split(/\s+/).slice(0, 3).join(' ')} Icon={Sparkles} color="#a855f7"
             sub={theme.angle} />
      </div>

      {/* Diagnostic banner */}
      {kpis.pctFromFlows < 0.3 && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 flex gap-3 items-start">
          <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[12px] text-amber-200 leading-relaxed">
            <strong>Only {pct(kpis.pctFromFlows)} of your email revenue comes from automated flows.</strong> Top D2C brands are at 60-70%. Your #1 lift right now = building out Welcome + Abandoned Cart flows (they alone make 40% of flow revenue). See the Flows tab → Tier 1 section.
          </div>
        </div>
      )}

      {/* Today + this week */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Section title="Due to send today" subtitle="From automated flows — server cron should pick these up on its next run">
          {dueVolume.byFlow.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic py-6 text-center">Nothing due right now.</div>
          ) : (
            <div className="space-y-1.5">
              {dueVolume.byFlow.map(f => (
                <div key={f.flowId} className="flex items-center gap-3 text-xs">
                  <div className="w-3 h-3 rounded" style={{ background: TIER_COLOR[FLOWS.find(x => x.id === f.flowId)?.tier || 3] }} />
                  <div className="flex-1 text-slate-200">{f.name}</div>
                  <div className="font-mono text-slate-400">{num(f.count)}</div>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-gray-800/60 flex items-center gap-3 text-xs font-semibold">
                <div className="flex-1 text-slate-300">Total</div>
                <div className="font-mono text-white">{num(dueVolume.total)}</div>
              </div>
            </div>
          )}
        </Section>

        <Section title="This week's broadcast calendar" subtitle="Always-on schedule · skip Sunday to protect deliverability">
          <div className="space-y-1">
            {WEEKLY_CALENDAR.map(day => (
              <div key={`${day.day}-${day.time || 'rest'}`} className="flex items-center gap-2 text-[11px] py-1">
                <div className="w-14 text-slate-400 font-medium">{day.day}</div>
                <div className="w-12 text-slate-500 font-mono">{day.time || '—'}</div>
                <div className="flex-1 text-slate-300 truncate">{day.label}</div>
                <div className="text-[10px] text-slate-600">{day.expectedOpen}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* List health breakdown */}
      <Section title="List health breakdown" subtitle="Distribution of your subscriber base across each strategic dimension">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <DimensionCard title="Engagement" data={summary.engagement} colorMap={{ Hot: '#22c55e', Warm: '#eab308', Cool: '#f97316', Cold: '#64748b' }} />
          <DimensionCard title="Recency"    data={summary.recency}    colorMap={{ '0–30 days': '#22c55e', '31–90 days': '#eab308', '91–180 days': '#f97316', '180+ days': '#ef4444' }} />
          <DimensionCard title="Frequency"  data={summary.frequency}  colorMap={{ '10+ orders': '#a855f7', '4–9 orders': '#8b5cf6', '2–3 orders': '#06b6d4', '1 order': '#64748b' }} />
          <DimensionCard title="LTV Tier"   data={summary.ltvTier}    colorMap={{ VIP: '#a855f7', HIGH: '#22c55e', MID: '#eab308', LOW: '#64748b' }} />
          <DimensionCard title="AOV Tier"   data={summary.aovTier}    />
          <DimensionCard title="Category"   data={summary.category}   />
          <DimensionCard title="Channel"    data={summary.channel}    />
          <DimensionCard title="Geography"  data={summary.geo}        colorMap={{ Metro: '#22c55e', 'Tier-2': '#06b6d4', 'Tier-3': '#eab308' }} />
        </div>
      </Section>
    </div>
  );
}

function DimensionCard({ title, data, colorMap = {} }) {
  const max = Math.max(1, ...data.map(d => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="bg-gray-950/60 rounded-lg border border-gray-800/70 p-3">
      <div className="text-[11px] font-semibold text-slate-300 mb-2">{title}</div>
      <div className="space-y-1">
        {data.slice(0, 6).map(d => {
          const color = colorMap[d.label] || '#38bdf8';
          return (
            <div key={d.label} className="flex items-center gap-2 text-[10px]">
              <div className="w-20 text-slate-400 truncate">{d.label}</div>
              <div className="flex-1 h-3 bg-gray-900 rounded overflow-hidden">
                <div className="h-full" style={{ width: `${(d.count / max) * 100}%`, background: color }} />
              </div>
              <div className="w-12 text-right font-mono text-slate-300">{num(d.count)}</div>
              <div className="w-10 text-right font-mono text-slate-500">{total > 0 ? `${Math.round(d.count / total * 100)}%` : '—'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── FLOWS TAB ────────────────────────────────────────────────── */
function FlowsTab({ flowStats, subscribers, abandonedCarts }) {
  const [activeFlow, setActiveFlow] = useState(null);

  const tiers = [1, 2, 3];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="text-sm font-semibold text-white mb-1">The 12 flows every D2C brand must run</div>
        <div className="text-[11px] text-slate-500">
          70% of email revenue at top D2C brands comes from these. Tier 1 alone drives ~80% of flow revenue. Click any flow to see its full step sequence, trigger, and expected performance.
        </div>
      </div>

      {tiers.map(tier => {
        const flows = FLOWS.filter(f => f.tier === tier);
        return (
          <div key={tier}>
            <div className="flex items-center gap-2 mb-2 mt-4">
              <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLOR[tier] }} />
              <h2 className="text-[11px] uppercase tracking-widest font-bold" style={{ color: TIER_COLOR[tier] }}>
                {TIER_LABEL[tier]}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {flows.map(flow => (
                <FlowCard key={flow.id} flow={flow} onClick={() => setActiveFlow(flow)} stats={flowStats[flow.id]} />
              ))}
            </div>
          </div>
        );
      })}

      {activeFlow && <FlowDetailModal flow={activeFlow} onClose={() => setActiveFlow(null)} />}
    </div>
  );
}

function FlowCard({ flow, onClick, stats }) {
  return (
    <button onClick={onClick}
            className="text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl overflow-hidden transition-colors">
      <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
        <Zap size={13} style={{ color: TIER_COLOR[flow.tier] }} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{flow.name}</div>
          <div className="text-[10px] text-slate-500">{flow.steps.length} step{flow.steps.length > 1 ? 's' : ''}</div>
        </div>
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
              style={{ background: `${PRIORITY_COLOR[flow.priority]}22`, color: PRIORITY_COLOR[flow.priority] }}>
          {flow.priority}
        </span>
      </div>
      <div className="p-3 space-y-2">
        <div className="text-[11px] text-slate-400">{flow.description}</div>
        <div className="text-[10px] text-emerald-400 flex items-center gap-1">
          <ArrowUpRight size={10} /> {flow.expectedRevenue}
        </div>
        <div className="text-[10px] text-slate-500 italic">Trigger: {flow.trigger.condition}</div>
        {stats && (
          <div className="pt-2 mt-2 border-t border-gray-800/60 flex gap-3 text-[10px]">
            <div><span className="text-slate-500">Sent:</span> <span className="font-mono text-slate-300">{num(stats.sent)}</span></div>
            <div><span className="text-slate-500">Orders:</span> <span className="font-mono text-slate-300">{num(stats.orders)}</span></div>
            <div><span className="text-slate-500">Revenue:</span> <span className="font-mono text-emerald-400">{cur(stats.revenue)}</span></div>
          </div>
        )}
      </div>
    </button>
  );
}

function FlowDetailModal({ flow, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
           className="w-full max-w-2xl h-screen overflow-y-auto bg-gray-950 border-l border-gray-800 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Zap size={18} style={{ color: TIER_COLOR[flow.tier] }} />
          <div className="flex-1">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">{TIER_LABEL[flow.tier]}</div>
            <h2 className="text-lg font-bold text-white">{flow.name}</h2>
            <div className="text-[12px] text-slate-400 mt-1">{flow.description}</div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>

        <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/10 p-3">
          <div className="text-[10px] text-emerald-400 uppercase font-semibold tracking-wider">Expected Revenue</div>
          <div className="text-[13px] text-emerald-200 mt-0.5">{flow.expectedRevenue}</div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-1">Trigger</div>
          <div className="text-[11px] text-slate-300 font-mono">{flow.trigger.type}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{flow.trigger.condition}</div>
        </div>

        <div>
          <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Step sequence</div>
          <div className="space-y-2">
            {flow.steps.map((step, i) => (
              <div key={step.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-5 h-5 rounded-full bg-gray-800 flex items-center justify-center text-[10px] font-bold text-slate-300">
                    {i + 1}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {step.delay === 0 ? 'Immediate' :
                      step.delay < 3600000 ? `+${Math.round(step.delay / 60000)}min` :
                      step.delay < 86400000 ? `+${Math.round(step.delay / 3600000)}h` :
                      `+${Math.round(step.delay / 86400000)}d`}
                  </div>
                  {step.discount && (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-900/40 text-amber-300">
                      {step.discount.pct}% OFF
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-white font-medium mt-1">{step.subject}</div>
                <div className="text-[11px] text-slate-500 mt-1">{step.goal}</div>
                {step.discount && (
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">
                    Code: <span className="text-amber-400">{step.discount.code}</span> · expires {step.discount.expiryHours}h
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CALENDAR TAB ─────────────────────────────────────────────── */
function CalendarTab() {
  const theme = currentMonthTheme();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-start gap-3">
          <Calendar size={18} className="text-brand-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-white mb-1">Weekly broadcast calendar</div>
            <div className="text-[11px] text-slate-500">
              Always-on schedule. Flows run silently in parallel. Skip Sunday to protect deliverability (top D2C brands don't send on Sunday).
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">This month</div>
            <div className="text-[13px] font-semibold text-amber-300">{theme.theme}</div>
            <div className="text-[11px] text-slate-400">{theme.angle}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {WEEKLY_CALENDAR.map((day, i) => (
          <div key={i} className={clsx(
            'rounded-xl border overflow-hidden',
            day.kind === 'rest' ? 'border-gray-800/40 bg-gray-900/40' : 'border-gray-800 bg-gray-900',
          )}>
            <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="w-20 font-bold text-white">{day.day}</div>
              <div className="w-20 text-slate-400 font-mono text-sm">{day.time || '—'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-200">{day.label}</div>
                <div className="text-[11px] text-slate-500 truncate">{day.description}</div>
              </div>
              <div className="flex gap-1">
                {day.segments.map(s => (
                  <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-slate-400">{s}</span>
                ))}
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Open / Click</div>
                <div className="text-[11px] font-mono text-slate-300">{day.expectedOpen} · {day.expectedClick}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60 text-sm font-semibold text-white">
          Monthly themes (India retail calendar)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1 p-3">
          {MONTHLY_THEMES.map(m => {
            const isCurrent = m.month === new Date().getMonth() + 1;
            return (
              <div key={m.key} className={clsx('px-3 py-2 rounded-lg',
                isCurrent ? 'bg-brand-900/30 border border-brand-700/50' : 'bg-gray-950/50')}>
                <div className="flex items-center gap-2">
                  <div className="w-8 text-[10px] text-slate-500 font-mono">{String(m.month).padStart(2, '0')}</div>
                  <div className="text-[13px] font-semibold text-slate-200">{m.theme}</div>
                  {isCurrent && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-brand-500/30 text-brand-300 font-bold">NOW</span>}
                </div>
                <div className="text-[10px] text-slate-500 pl-10">{m.angle}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── SEGMENTS TAB ─────────────────────────────────────────────── */
function SegmentsTab({ subscribers }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const segments = useMemo(() => {
    return SEGMENT_TEMPLATES.map(t => ({
      ...t,
      subs: filterSubscribers(subscribers, t.filters),
    }));
  }, [subscribers]);

  const totalLtv = subscribers.reduce((s, x) => s + (x.predictedLtv || 0), 0);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="text-sm font-semibold text-white mb-1">Pre-built segments</div>
        <div className="text-[11px] text-slate-500">
          10 ready-made segments matching the 12-flow playbook. Each one targets a specific flow or broadcast kind.
          Click any segment to see sample subscribers, then push to Listmonk as a named list.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {segments.map(s => (
          <button key={s.id} onClick={() => setSelectedTemplate(s)}
                  className="text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{s.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{s.desc}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-white">{num(s.subs.length)}</div>
                <div className="text-[10px] text-slate-600">subs</div>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-800/60 flex items-center gap-2 text-[10px] text-slate-500">
              <span>LTV: {cur(s.subs.reduce((a, x) => a + (x.predictedLtv || 0), 0))}</span>
              <span>·</span>
              <span>AOV avg: {cur(s.subs.reduce((a, x) => a + (x.aov || 0), 0) / Math.max(1, s.subs.length))}</span>
            </div>
          </button>
        ))}
      </div>

      {selectedTemplate && (
        <SegmentPreviewModal segment={selectedTemplate} onClose={() => setSelectedTemplate(null)} />
      )}
    </div>
  );
}

function SegmentPreviewModal({ segment, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
           className="w-full max-w-3xl h-screen overflow-y-auto bg-gray-950 border-l border-gray-800 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Filter size={18} className="text-brand-400" />
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">{segment.name}</h2>
            <div className="text-[11px] text-slate-500">{segment.desc}</div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <KPI label="Subscribers" value={num(segment.subs.length)} Icon={Users} />
          <KPI label="Total LTV"  value={cur(segment.subs.reduce((s, x) => s + (x.predictedLtv || 0), 0))} Icon={TrendingUp} color="#22c55e" />
          <KPI label="Avg AOV"    value={cur(segment.subs.reduce((s, x) => s + (x.aov || 0), 0) / Math.max(1, segment.subs.length))} Icon={Package} />
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800/60 text-[11px] font-semibold text-slate-300">
            Sample subscribers (first 20)
          </div>
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900">
                <tr>
                  <th className="px-2 py-1 text-left text-slate-500">Email</th>
                  <th className="px-2 py-1 text-left text-slate-500">Tier</th>
                  <th className="px-2 py-1 text-right text-slate-500">Orders</th>
                  <th className="px-2 py-1 text-right text-slate-500">LTV</th>
                  <th className="px-2 py-1 text-left text-slate-500">Category</th>
                </tr>
              </thead>
              <tbody>
                {segment.subs.slice(0, 20).map(s => (
                  <tr key={s.email} className="border-t border-gray-800/60">
                    <td className="px-2 py-1 text-slate-300 truncate max-w-[200px]">{s.email}</td>
                    <td className="px-2 py-1 text-slate-400">{s.ltvTier.label}</td>
                    <td className="px-2 py-1 text-right font-mono text-slate-300">{s.orderCount}</td>
                    <td className="px-2 py-1 text-right font-mono text-emerald-400">{cur(s.predictedLtv)}</td>
                    <td className="px-2 py-1 text-slate-400">{s.category.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="text-[10px] text-slate-600 italic">
          Push-to-Listmonk coming in the next build (requires per-brand Listmonk list IDs).
        </div>
      </div>
    </div>
  );
}

/* ── ATTRIBUTION TAB ──────────────────────────────────────────── */
function AttributionTab({ kpis, attributedCampaigns, flowStats }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Rev / email" value={cur(kpis.revenuePerEmail)} Icon={Mail} color="#22c55e"
             sub={kpis.revenuePerEmail > 50 ? 'Strong' : kpis.revenuePerEmail > 20 ? 'Average' : 'Target ₹50+'} />
        <KPI label="% rev from email" value={pct(kpis.pctRevenueFromEmail)} Icon={TrendingUp} color="#06b6d4"
             sub="top brands hit 40%+" />
        <KPI label="% from flows" value={pct(kpis.pctFromFlows)} Icon={Zap} color="#f59e0b" sub="target 60-70%" />
        <KPI label="Conversion rate" value={pct(kpis.emailOrderRate)} Icon={Target} color="#a855f7" />
      </div>

      <Section title="Top campaigns by attributed revenue (last 30 days)"
               subtitle="Click-attributed (7d) + open-attributed (2d × 0.3 weight) + UTM-attributed (0.5 weight)">
        {attributedCampaigns.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic py-6 text-center">
            No campaigns attributed yet. Send some campaigns and come back — attribution matches against Shopify orders automatically.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-800/60">
                  <th className="px-2 py-2 text-left text-slate-400 font-semibold">Campaign</th>
                  <th className="px-2 py-2 text-right text-slate-400">Sent</th>
                  <th className="px-2 py-2 text-right text-slate-400">Orders</th>
                  <th className="px-2 py-2 text-right text-slate-400">Revenue</th>
                  <th className="px-2 py-2 text-right text-slate-400">Rev/email</th>
                  <th className="px-2 py-2 text-right text-slate-400">Conv rate</th>
                </tr>
              </thead>
              <tbody>
                {attributedCampaigns.slice(0, 50).map(c => (
                  <tr key={c.id} className="border-b border-gray-800/30">
                    <td className="px-2 py-2 text-slate-200 truncate max-w-[280px]">
                      {c.name}
                      {c.flowId && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-amber-900/40 text-amber-300">FLOW</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-300">{num(c.sent)}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-300">{num(c.attributedOrders)}</td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-400">{cur(c.attributedRevenue)}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-300">{cur(c.revenuePerEmail)}</td>
                    <td className="px-2 py-2 text-right font-mono" style={{ color: c.conversionRate > 0.02 ? '#22c55e' : '#64748b' }}>
                      {pct(c.conversionRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Flow performance" subtitle="Revenue by automated flow — where each flow has actually sent campaigns">
        {Object.keys(flowStats).length === 0 ? (
          <div className="text-[11px] text-slate-500 italic py-6 text-center">
            Flows haven't been activated yet — once the flow orchestrator starts sending, numbers populate here.
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(flowStats).map(([flowId, s]) => {
              const flow = FLOWS.find(f => f.id === flowId);
              return (
                <div key={flowId} className="flex items-center gap-3 text-[11px] bg-gray-950/40 p-2 rounded">
                  <div className="w-3 h-3 rounded" style={{ background: TIER_COLOR[flow?.tier || 3] }} />
                  <div className="flex-1 font-semibold text-slate-200">{flow?.name || flowId}</div>
                  <div><span className="text-slate-500">Sent:</span> <span className="font-mono text-slate-300">{num(s.sent)}</span></div>
                  <div><span className="text-slate-500">Orders:</span> <span className="font-mono text-slate-300">{num(s.orders)}</span></div>
                  <div><span className="text-slate-500">Revenue:</span> <span className="font-mono text-emerald-400">{cur(s.revenue)}</span></div>
                  <div><span className="text-slate-500">Rev/email:</span> <span className="font-mono text-slate-300">{cur(s.revenuePerEmail)}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ── PLAYBOOK TAB ─────────────────────────────────────────────── */
function PlaybookTab() {
  const sections = [
    {
      icon: Target,
      title: 'Goal',
      color: '#22c55e',
      content: [
        'Flip revenue mix to 60-65% from flows, 35-40% from broadcasts within 60 days.',
        'Target ₹50+ revenue per email sent (industry top quartile).',
        'Email should drive 25-35% of total store revenue.',
      ],
    },
    {
      icon: Users,
      title: 'Segmentation first, volume second',
      color: '#06b6d4',
      content: [
        'Always cut by at least 2 dimensions. Top performers cut by 4+.',
        'Sending 4k targeted emails beats 40k blasted ones 3:1.',
        'Ruthlessly sunset non-engagers at 180d — sender reputation > list size.',
      ],
    },
    {
      icon: Zap,
      title: 'Build Tier 1 flows first',
      color: '#f59e0b',
      content: [
        'Welcome Series + Abandoned Cart alone = 40% of flow revenue.',
        'Post-Purchase + Win-Back close another 25%.',
        'Browse Abandonment catches the long tail of warm traffic.',
      ],
    },
    {
      icon: Calendar,
      title: 'Respect the weekly rhythm',
      color: '#a855f7',
      content: [
        'Monday = priming (educational). Thursday = conversion. Sunday = rest.',
        'Saturday is "deposit" day — brand content, not sales.',
        'Retarget Thursday non-openers at 6 PM — typical 18-22% open on retarget.',
      ],
    },
    {
      icon: Gift,
      title: 'Frequency policy by engagement',
      color: '#ec4899',
      content: [
        'Hot (30d): up to 4/week. Warm (30-60d): 2/week. Cool (60-90d): 1/week. Cold (90+d): flow-only.',
        'Top 20% LTV get early access — they reward with 3-5× response.',
        'Sunset at 180d no open = remove from broadcasts entirely.',
      ],
    },
    {
      icon: TrendingUp,
      title: 'Measure what matters',
      color: '#38bdf8',
      content: [
        'Stop watching open rate. Track revenue per email first.',
        'Flows should average 8-10× the rev/email of broadcasts.',
        'Complaint rate <0.1% is critical — SES enforces deliverability based on it.',
      ],
    },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-lg font-bold text-white">The corporate D2C email playbook</h2>
        <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
          Top D2C brands (Warby Parker, Glossier, Mamaearth, Nykaa) follow the same six principles. This is the condensed version.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map(s => (
          <div key={s.title} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={14} style={{ color: s.color }} />
              <div className="text-[12px] font-bold uppercase tracking-widest" style={{ color: s.color }}>{s.title}</div>
            </div>
            <ul className="space-y-1.5">
              {s.content.map((c, i) => (
                <li key={i} className="text-[12px] text-slate-300 leading-relaxed flex items-start gap-2">
                  <span className="text-slate-600 mt-0.5">▸</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-amber-400" />
          <div className="text-[12px] font-bold text-amber-300 uppercase tracking-widest">Implementation order</div>
        </div>
        <ol className="space-y-2 text-[12px] text-amber-100">
          <li><span className="font-mono text-amber-400">W1</span> — Subscriber sync (Shopify → Listmonk, segmented) + broadcast calendar live</li>
          <li><span className="font-mono text-amber-400">W2</span> — Welcome series + Abandoned cart flows (the two biggest rocks)</li>
          <li><span className="font-mono text-amber-400">W3</span> — Post-purchase + Browse abandonment flows + attribution dashboard</li>
          <li><span className="font-mono text-amber-400">W4</span> — Win-back + Replenishment flows</li>
          <li><span className="font-mono text-amber-400">W5</span> — VIP + Birthday flows + segment automation</li>
          <li><span className="font-mono text-amber-400">W6</span> — Back-in-stock + Sunset flows + A/B framework</li>
          <li><span className="font-mono text-amber-400">W7-8</span> — Advanced: send-time optimization, churn prediction, journey branching</li>
        </ol>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════ */

export default function EmailOps() {
  const { shopifyOrders, brands, activeBrandIds } = useStore();
  const [tab, setTab] = useState('overview');

  const active = brands.filter(b => activeBrandIds.includes(b.id));
  const activeOrders = useMemo(() => {
    // Filter orders to active brands — if store has per-brand attribution we use it
    return shopifyOrders || [];
  }, [shopifyOrders]);

  const subscribers = useMemo(() => buildSubscribers(activeOrders, {}), [activeOrders]);
  const summary    = useMemo(() => summariseList(subscribers), [subscribers]);
  const dueSends   = useMemo(() => computeDueSends({ subscribers, abandonedCarts: [], sentMap: {} }), [subscribers]);
  const dueVolume  = useMemo(() => projectVolume(dueSends), [dueSends]);

  // Attribution — without real campaign + event data, these are zero placeholders.
  // When EmailEngine/EmailCampaigns pull Listmonk events, we hook them in here.
  const attributedCampaigns = useMemo(() => [], []);
  const kpis = useMemo(() => programKpis(attributedCampaigns, activeOrders, { windowDays: 30 }), [attributedCampaigns, activeOrders]);
  const flowStats = useMemo(() => {
    const fp = flowPerformance(attributedCampaigns);
    const out = {};
    for (const f of fp) out[f.flowId] = f;
    return out;
  }, [attributedCampaigns]);

  if (!active.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
        Select an active brand to use Email Ops.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center flex-wrap gap-3">
        <Mail size={18} className="text-brand-400" />
        <h1 className="text-lg font-bold text-white">Email Ops</h1>
        <span className="text-[10px] text-slate-600">corporate D2C email program · 12 flows · weekly calendar · revenue attribution</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span>{num(subscribers.length)} subscribers · {num(activeOrders.length)} orders synced</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-gray-800 gap-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                    tab === t.id
                      ? 'border-brand-500 text-brand-300'
                      : 'border-transparent text-slate-500 hover:text-slate-300',
                  )}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview'    && <OverviewTab subscribers={subscribers} kpis={kpis} dueVolume={dueVolume} flowStats={flowStats} summary={summary} />}
      {tab === 'flows'       && <FlowsTab flowStats={flowStats} subscribers={subscribers} abandonedCarts={[]} />}
      {tab === 'calendar'    && <CalendarTab />}
      {tab === 'segments'    && <SegmentsTab subscribers={subscribers} />}
      {tab === 'attribution' && <AttributionTab kpis={kpis} attributedCampaigns={attributedCampaigns} flowStats={flowStats} />}
      {tab === 'playbook'    && <PlaybookTab />}
    </div>
  );
}
