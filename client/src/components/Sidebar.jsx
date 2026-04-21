import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ListChecks, TrendingUp, Wrench, Shield,
  Skull, Layers, BarChart3, Trophy, Settings, Zap, Database, Play, Package, BarChart2, ShoppingBag, Activity, Truck, ClipboardList,
  Flame, GitMerge, PauseCircle, CalendarSearch, LineChart, TrendingDown, BookOpen, Search, Mail, Users, Sparkles, Star, Upload, Brain, Send as SendIcon, Target, Table2,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';

const NAV = [
  { to: '/setup',       icon: Settings,       label: 'Study Manual',       group: 'config' },
  { to: '/bulk-import', icon: Upload,         label: 'Bulk CSV Import',    group: 'config' },
  { to: '/',            icon: LayoutDashboard, label: 'Overview',           group: 'dash', end: true },
  { to: '/decisions',   icon: ListChecks,      label: 'Decision Queue',     group: 'dash' },
  { to: '/scale',       icon: TrendingUp,      label: 'Scale Board',        group: 'boards' },
  { to: '/fix',         icon: Wrench,          label: 'Fix Board',          group: 'boards' },
  { to: '/defend',      icon: Shield,          label: 'Defend Board',       group: 'boards' },
  { to: '/kill',        icon: Skull,           label: 'Kill Board',         group: 'boards' },
  { to: '/patterns',      icon: Layers,          label: 'Pattern Analysis',   group: 'intel' },
  { to: '/scorecard',    icon: Trophy,          label: 'Scorecard',          group: 'intel' },
  { to: '/video',        icon: Play,            label: 'Video Insights',     group: 'intel' },
  { to: '/sku',          icon: Package,         label: 'SKU Intelligence',   group: 'intel' },
  { to: '/star-products',icon: Star,            label: 'Star Products',      group: 'intel' },
  { to: '/flat',         icon: Database,        label: 'Raw Flat Data',      group: 'intel' },
  { to: '/breakdowns',   icon: BarChart2,       label: 'Breakdown Analytics',group: 'intel' },
  { to: '/creative-intel', icon: Flame,         label: 'Creative Intel',     group: 'advanced' },
  { to: '/attribution',  icon: GitMerge,        label: 'Attribution',        group: 'advanced' },
  { to: '/momentum',     icon: TrendingUp,      label: 'Momentum',           group: 'advanced' },
  { to: '/inactive',     icon: PauseCircle,     label: 'Inactive Ads',       group: 'advanced' },
  { to: '/daily',        icon: CalendarSearch,  label: 'Daily Briefing',     group: 'advanced' },
  { to: '/analysis',     icon: LineChart,       label: 'Order Analysis',     group: 'advanced' },
  { to: '/collection-spend', icon: BarChart3,   label: 'Collection Spend',   group: 'advanced' },
  { to: '/aov',          icon: TrendingDown,    label: 'AOV Analysis',       group: 'advanced' },
  { to: '/business-plan', icon: BookOpen,       label: 'Business Plan',      group: 'plan' },
  { to: '/shopify',          icon: ShoppingBag, label: 'Shopify Orders',     group: 'shopify' },
  { to: '/shopify-insights', icon: BarChart3,   label: 'Shopify Analytics',  group: 'shopify' },
  { to: '/shopify-ops',      icon: Truck,       label: 'Shopify Ops',        group: 'shopify' },
  { to: '/procurement',      icon: ClipboardList, label: 'Procurement',      group: 'shopify' },
  { to: '/ga',               icon: Activity,    label: 'GA Analytics',       group: 'shopify' },
  { to: '/google-ads',       icon: Search,      label: 'Google Ads',         group: 'shopify' },
  { to: '/email-campaigns',  icon: Mail,        label: 'Email Campaigns',    group: 'shopify' },
  { to: '/email-engine',     icon: Sparkles,    label: 'Email Engine',       group: 'shopify' },
  { to: '/segments',         icon: Users,       label: 'Customer Segments',  group: 'shopify' },
  { to: '/customer-brain',   icon: Brain,       label: 'Customer Brain',     group: 'retention' },
  { to: '/retention-sheets', icon: Table2,      label: 'Retention Sheets',   group: 'retention' },
  { to: '/send-planner',     icon: SendIcon,    label: 'Send Planner',       group: 'retention' },
  { to: '/campaign-perf',    icon: Target,      label: 'Campaign Performance', group: 'retention' },
];

const GROUP_LABELS = {
  config:   'Configuration',
  dash:     'Dashboard',
  boards:   'Action Boards',
  intel:    'Intelligence',
  advanced: 'AI Intelligence',
  plan:     'Business Plan',
  shopify:  'Commerce & Ops',
  retention:'Retention Engine',
};

export default function Sidebar() {
  const { fetchStatus, lastFetchAt, enrichedRows, brands } = useStore();

  const visibleNav = NAV;
  const groups = [...new Set(visibleNav.map(n => n.group))];

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-gray-950 border-r border-gray-800/60 h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">TAOS Elite</div>
            <div className="text-[10px] text-slate-500">Meta Ops Dashboard</div>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="px-4 py-2 border-b border-gray-800/40">
        <div className={clsx(
          'flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2 py-1 w-fit',
          fetchStatus === 'loading' && 'bg-amber-500/10 text-amber-400',
          fetchStatus === 'success' && 'bg-emerald-500/10 text-emerald-400',
          fetchStatus === 'error'   && 'bg-red-500/10 text-red-400',
          fetchStatus === 'idle'    && 'bg-gray-800 text-slate-500',
        )}>
          <span className={clsx(
            'w-1.5 h-1.5 rounded-full',
            fetchStatus === 'loading' && 'bg-amber-400 animate-pulse',
            fetchStatus === 'success' && 'bg-emerald-400',
            fetchStatus === 'error'   && 'bg-red-400',
            fetchStatus === 'idle'    && 'bg-gray-600',
          )} />
          {fetchStatus === 'loading' && 'Fetching...'}
          {fetchStatus === 'success' && `${enrichedRows.length} ads`}
          {fetchStatus === 'error'   && 'Error'}
          {fetchStatus === 'idle'    && 'Not fetched'}
        </div>
        {lastFetchAt && (
          <div className="text-[10px] text-slate-600 mt-1 px-2">
            {new Date(lastFetchAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-4">
        {groups.map(group => (
          <div key={group}>
            <div className="px-2 mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
              {GROUP_LABELS[group]}
            </div>
            {visibleNav.filter(n => n.group === group).map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-brand-600/20 text-brand-300 ring-1 ring-brand-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-gray-800/60',
                )}
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Brands count */}
      {brands?.length > 0 && (
        <div className="px-4 py-3 text-[10px] text-slate-600 border-t border-gray-800/40">
          {brands.length} brand{brands.length > 1 ? 's' : ''} configured
        </div>
      )}
    </aside>
  );
}
