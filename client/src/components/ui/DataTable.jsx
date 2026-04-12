import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

export default function DataTable({ columns, data, rowKey = 'adId', maxRows = 200, className, onEditRow, onViewRow }) {
  const [sort, setSort]   = useState({ key: null, dir: 'desc' });
  const [page, setPage]   = useState(0);
  const [search, setSearch] = useState('');
  const PAGE = 50;

  const filtered = useMemo(() => {
    if (!search.trim()) return data || [];
    const q = search.toLowerCase();
    return (data || []).filter(r =>
      columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, columns]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      const an = parseFloat(av); const bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return sort.dir === 'asc' ? an - bn : bn - an;
      return sort.dir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [filtered, sort]);

  const pages    = Math.ceil(sorted.length / PAGE);
  const visible  = sorted.slice(page * PAGE, (page + 1) * PAGE);

  const toggleSort = key => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
    setPage(0);
  };

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          className="w-64 px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-xs text-slate-500">{sorted.length} rows</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-xs text-left">
          <thead className="bg-gray-900 sticky top-0 z-10">
            <tr>
              {(onEditRow || onViewRow) && (
                <th className="px-2 py-2.5 w-12 text-slate-600 font-semibold" />
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  className={clsx(
                    'px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap select-none',
                    col.sortable !== false && 'cursor-pointer hover:text-slate-200',
                    col.align === 'right' && 'text-right',
                  )}
                  style={{ minWidth: col.width || 80 }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable !== false && (
                      sort.key === col.key
                        ? sort.dir === 'asc'
                          ? <ChevronUp size={11} />
                          : <ChevronDown size={11} />
                        : <ChevronsUpDown size={11} className="opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  No data
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr
                  key={row[rowKey] ?? i}
                  className={clsx(
                    'border-t border-gray-800/50 transition-colors',
                    i % 2 === 0 ? 'bg-gray-950/60' : 'bg-gray-900/40',
                    'hover:bg-brand-900/30',
                  )}
                >
                  {(onEditRow || onViewRow) && (
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-0.5">
                        {onViewRow && (
                          <button
                            onClick={() => onViewRow(row)}
                            className="p-1 rounded hover:bg-gray-700 text-slate-600 hover:text-brand-300 transition-colors"
                            title="View ad detail"
                          >
                            <ExternalLink size={11} />
                          </button>
                        )}
                        {onEditRow && (
                          <button
                            onClick={() => onEditRow(row)}
                            className="p-1 rounded hover:bg-gray-700 text-slate-600 hover:text-brand-400 transition-colors"
                            title="Edit manual labels"
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={clsx(
                        'px-3 py-2 text-gray-300 whitespace-nowrap',
                        col.align === 'right' && 'text-right tabular-nums',
                        col.className,
                      )}
                    >
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-slate-300 disabled:opacity-30 hover:bg-gray-700"
          >← Prev</button>
          <span className="text-xs text-slate-500">{page + 1} / {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-slate-300 disabled:opacity-30 hover:bg-gray-700"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
