/**
 * Parse a CSV string that may contain quoted fields with commas inside.
 * Returns array of objects keyed by header row.
 */
export function parseCsv(text) {
  const lines = [];
  let cur = '';
  let inQuote = false;

  // Normalise line endings then split char by char to handle quoted newlines
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Handle escaped double-quote ""
      if (inQuote && text[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur.length || lines.length) lines.push(cur);
      cur = '';
      if (ch === '\r' && text[i + 1] === '\n') i++; // CRLF
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);

  if (lines.length < 2) return [];

  const parseRow = line => {
    const fields = [];
    let f = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { f += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        fields.push(f.trim());
        f = '';
      } else {
        f += c;
      }
    }
    fields.push(f.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseRow(lines[i]);
    if (vals.every(v => !v)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    rows.push(obj);
  }

  return rows;
}

/**
 * Convert parsed CSV rows (from 02_MANUAL.csv format) into the manualMap shape.
 * Key = Ad ID.  Value = all manual fields.
 * Skips rows where Ad ID is blank/empty.
 */
export function csvRowsToManualMap(rows) {
  const MANUAL_FIELDS = [
    'Collection','Creator','SKU',
    'Campaign Type','Offer Type','Geography',
    'Influe Video','Static','Inhouse Video',
    'Broad','ASC','ATC','IC','Purchase',
    'View content audience','Website visit','Interest','Lookalike',
    'Customer list','FB engage','Insta engage',
    'Status Override','Notes',
  ];

  const map = {};
  rows.forEach(row => {
    const adId = (row['Ad ID'] || '').trim().replace(/^'+/, '').replace(/\.0$/, '');
    if (!adId) return; // skip blank Ad ID rows

    const entry = {};
    MANUAL_FIELDS.forEach(f => {
      if (row[f] !== undefined) entry[f] = row[f];
    });
    map[adId] = entry;
  });

  return map;
}

/**
 * Detect unique non-empty, non-'none', non-'no' values per list-column from CSV rows.
 * Returns { Collection: [...], 'Campaign Type': [...], 'Offer Type': [...], Geography: [...], 'Status Override': [...] }
 */
export function detectListsFromCsvRows(rows) {
  const LIST_COLUMNS = ['Collection', 'Campaign Type', 'Offer Type', 'Geography', 'Status Override'];
  const SKIP_VALUES = new Set(['none', 'no', '']);

  const result = {};
  LIST_COLUMNS.forEach(col => { result[col] = []; });

  const seen = {};
  LIST_COLUMNS.forEach(col => { seen[col] = new Set(); });

  rows.forEach(row => {
    const adId = (row['Ad ID'] || '').trim().replace(/^'+/, '').replace(/\.0$/, '');
    if (!adId) return; // skip blank rows

    LIST_COLUMNS.forEach(col => {
      const val = (row[col] || '').trim();
      if (!val) return;
      if (SKIP_VALUES.has(val.toLowerCase())) return;
      if (!seen[col].has(val)) {
        seen[col].add(val);
        result[col].push(val);
      }
    });
  });

  return result;
}
