/**
 * Generic CSV exporter. Accepts an array of plain objects + an optional
 * column ordering. Escapes quotes/newlines correctly; triggers a file
 * download named `${name}-YYYY-MM-DD.csv`.
 */

function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function rowsToCsv(rows, columns) {
  if (!rows?.length) return '';
  const cols = columns?.length ? columns : Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

export function downloadCsv(rows, name = 'export', columns = null) {
  const csv = rowsToCsv(rows, columns);
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
