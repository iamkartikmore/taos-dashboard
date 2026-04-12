import { motion } from 'framer-motion';
import clsx from 'clsx';

export default function MetricCard({ label, value, sub, delta, icon: Icon, color = 'blue', size = 'md' }) {
  const colorMap = {
    blue:   { bg: 'bg-blue-500/10',   icon: 'text-blue-400',   border: 'border-blue-500/20' },
    green:  { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', border: 'border-emerald-500/20' },
    amber:  { bg: 'bg-amber-500/10',  icon: 'text-amber-400',  border: 'border-amber-500/20' },
    red:    { bg: 'bg-red-500/10',    icon: 'text-red-400',    border: 'border-red-500/20' },
    purple: { bg: 'bg-violet-500/10', icon: 'text-violet-400', border: 'border-violet-500/20' },
    teal:   { bg: 'bg-teal-500/10',   icon: 'text-teal-400',   border: 'border-teal-500/20' },
  };
  const c = colorMap[color] || colorMap.blue;
  const deltaNum = parseFloat(delta);
  const deltaColor = !isNaN(deltaNum) ? (deltaNum >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-xl border p-4 flex flex-col gap-2 relative overflow-hidden',
        'bg-gray-900/80 backdrop-blur-sm',
        c.border,
      )}
    >
      <div className={clsx('absolute inset-0 opacity-30 pointer-events-none', c.bg)} />
      <div className="flex items-start justify-between relative">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className={clsx('p-1.5 rounded-lg', c.bg)}>
            <Icon size={14} className={c.icon} />
          </div>
        )}
      </div>
      <div className="relative">
        <div className={clsx('font-bold tabular-nums', size === 'lg' ? 'text-3xl' : 'text-2xl')}>
          {value ?? '—'}
        </div>
        {(sub || delta !== undefined) && (
          <div className="flex items-center gap-2 mt-1">
            {sub && <span className="text-xs text-slate-500">{sub}</span>}
            {delta !== undefined && (
              <span className={clsx('text-xs font-medium', deltaColor)}>
                {!isNaN(deltaNum) ? (deltaNum >= 0 ? '▲' : '▼') : ''} {delta}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
