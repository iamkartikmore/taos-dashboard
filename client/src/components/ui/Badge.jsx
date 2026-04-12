import clsx from 'clsx';

const variants = {
  // Decision
  'Scale Hard':      'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40',
  'Scale Carefully': 'bg-teal-500/20 text-teal-300 ring-1 ring-teal-500/40',
  'Defend':          'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40',
  'Fix':             'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40',
  'Watch':           'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/40',
  'Kill':            'bg-red-500/20 text-red-300 ring-1 ring-red-500/40',
  'Pause':           'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40',
  // Quality
  'Elite':   'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40',
  'Healthy': 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40',
  'Weak':    'bg-red-500/20 text-red-300 ring-1 ring-red-500/40',
  'Mixed':   'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/40',
  // Trend
  'Improving Strong':  'bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-500/40',
  'Improving':         'bg-green-500/20 text-green-300 ring-1 ring-green-500/40',
  'Recovering':        'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40',
  'Stable Good':       'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40',
  'Stable':            'bg-slate-500/20 text-slate-300 ring-1 ring-slate-500/40',
  'Stable Weak':       'bg-yellow-600/20 text-yellow-300 ring-1 ring-yellow-600/40',
  'Soft Worsening':    'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40',
  'Worsening':         'bg-red-500/20 text-red-300 ring-1 ring-red-500/40',
  'Worsening Bad':     'bg-red-700/20 text-red-300 ring-1 ring-red-700/40',
  'Fatigue Risk':      'bg-amber-600/20 text-amber-300 ring-1 ring-amber-600/40',
  'Fatigue / Worsening': 'bg-red-600/20 text-red-300 ring-1 ring-red-600/40',
  'No 30D baseline':   'bg-slate-700/20 text-slate-400 ring-1 ring-slate-700/40',
  // Audience
  'Acquisition':  'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40',
  'Retargeting':  'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40',
  'Retention':    'bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/40',
  // Status
  'ACTIVE':   'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40',
  'PAUSED':   'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40',
  'ARCHIVED': 'bg-slate-700/20 text-slate-400 ring-1 ring-slate-700/40',
};

export default function Badge({ label, size = 'sm', className }) {
  const cls = variants[label] || 'bg-slate-700/20 text-slate-400 ring-1 ring-slate-700/40';
  return (
    <span className={clsx(
      'inline-flex items-center rounded-full font-medium whitespace-nowrap',
      size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      cls, className,
    )}>
      {label}
    </span>
  );
}
