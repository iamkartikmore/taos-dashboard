import { useState } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';

export default function PullProgressPanel() {
  const { pullJobs, clearFinishedPullJobs } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  const entries = Object.entries(pullJobs).sort((a, b) => (a[1].startedAt || 0) - (b[1].startedAt || 0));
  if (!entries.length) return null;

  const loading = entries.filter(([, j]) => j.status === 'loading');
  const errors  = entries.filter(([, j]) => j.status === 'error');

  return (
    <div className="fixed bottom-4 right-4 w-[22rem] max-w-[90vw] bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-40">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-gray-800/80 text-left"
      >
        {loading.length > 0
          ? <Loader2 size={13} className="text-sky-400 animate-spin shrink-0" />
          : errors.length > 0
            ? <AlertCircle size={13} className="text-red-400 shrink-0" />
            : <CheckCircle size={13} className="text-emerald-400 shrink-0" />}
        <span className="text-[11px] font-semibold text-white">
          Data Pulls
          <span className="text-slate-500 font-normal ml-1">
            {loading.length ? `· ${loading.length} active` : errors.length ? `· ${errors.length} error${errors.length > 1 ? 's' : ''}` : '· done'}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!loading.length && (
            <span
              onClick={e => { e.stopPropagation(); clearFinishedPullJobs(); }}
              className="p-0.5 text-slate-500 hover:text-slate-200 rounded"
              title="Clear"
            >
              <X size={11} />
            </span>
          )}
          {collapsed
            ? <ChevronUp size={11} className="text-slate-500" />
            : <ChevronDown size={11} className="text-slate-500" />}
        </div>
      </button>
      {!collapsed && (
        <div className="max-h-80 overflow-y-auto p-2 space-y-1.5">
          {entries.map(([id, j]) => <PullJobRow key={id} job={j} />)}
        </div>
      )}
    </div>
  );
}

function PullJobRow({ job }) {
  const pct = typeof job.pct === 'number' ? Math.max(0, Math.min(100, job.pct)) : null;
  const isError   = job.status === 'error';
  const isSuccess = job.status === 'success';
  const isLoading = job.status === 'loading';

  return (
    <div className={clsx(
      'px-2 py-1.5 rounded-lg border',
      isError   ? 'bg-red-950/20 border-red-900/40' :
      isSuccess ? 'bg-emerald-950/10 border-emerald-900/30' :
                  'bg-gray-800/40 border-gray-800'
    )}>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        {isLoading && <Loader2 size={11} className="text-sky-400 animate-spin shrink-0" />}
        {isSuccess && <CheckCircle size={11} className="text-emerald-400 shrink-0" />}
        {isError   && <AlertCircle size={11} className="text-red-400 shrink-0" />}
        <span className="text-slate-200 font-medium truncate flex-1">{job.label}</span>
        {pct !== null && <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{Math.round(pct)}%</span>}
      </div>

      <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full',
            isError   ? 'bg-red-500' :
            isSuccess ? 'bg-emerald-500' :
                        'bg-sky-500',
            isLoading && pct === null && 'animate-pulse',
          )}
          style={{ width: pct !== null ? `${pct}%` : (isLoading ? '30%' : '100%') }}
        />
      </div>

      {(job.detail || job.error) && (
        <div className={clsx(
          'text-[10px] mt-1 truncate flex items-center gap-1',
          isError ? 'text-red-400' : 'text-slate-500'
        )}>
          <Activity size={9} className="shrink-0" />
          <span className="truncate">{isError ? job.error : job.detail}</span>
        </div>
      )}
    </div>
  );
}
