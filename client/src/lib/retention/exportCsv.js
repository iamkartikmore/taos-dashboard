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

/**
 * Bundle multiple sheets into ONE text file with section dividers.
 * Avoids a 7-way download dialog and stays dep-free. Spreadsheet apps
 * will see one big CSV; split by `# === <name> ===` markers to restore
 * individual sheets.
 *
 * @param sheets  [{ name, rows, columns? }]
 * @param fileName base name for the single downloaded file
 */
export function downloadCsvBundle(sheets, fileName = 'retention-bundle') {
  const parts = [];
  for (const s of sheets) {
    if (!s.rows?.length) continue;
    const body = rowsToCsv(s.rows, s.columns);
    if (!body) continue;
    parts.push(`# === ${s.name} (${s.rows.length} rows) ===`);
    parts.push(body);
    parts.push('');
  }
  if (!parts.length) return;
  const blob = new Blob([parts.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
