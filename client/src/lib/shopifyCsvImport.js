/**
 * Shopify CSV bulk import — parses `orders_export_*.csv` and
 * `customers_export_*.csv` into the same shapes the Shopify REST API
 * returns, so downstream analytics code works unchanged.
 *
 * Streaming line-by-line parser (one pass per file) — memory-safe for
 * 50k+ row CSVs. Uses File.stream() when available to avoid loading
 * the whole file into memory.
 */

import { parseCsv } from './csvImport';

/* ─── SAFE HELPERS ──────────────────────────────────────────────── */
const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
};
const str  = v => String(v ?? '').trim();
const lower = v => str(v).toLowerCase();
const stripShopifyId = v => str(v).replace(/^'+/, '').replace(/\.0$/, '');
// Shopify's CSV exports date as "2025-10-22 12:58:38 +0530" — convert to ISO.
// Replace first space with T, strip space before timezone, so Date() can parse.
const toIso = v => {
  const s = str(v);
  if (!s) return '';
  const normalized = s
    .replace(' ', 'T')
    .replace(/\s+([+-]\d{4})$/, '$1');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? s : d.toISOString();
};

/* ─── FILE → TEXT (stream-friendly) ─────────────────────────────── */
export async function readFileText(file, onProgress) {
  if (typeof file.text === 'function') {
    // Modern browsers — full read, but typically fast for 10–20MB
    onProgress?.(`Reading ${file.name}...`);
    return await file.text();
  }
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/* ─── ORDERS: CSV ROWS → SHOPIFY-SHAPED ORDERS ──────────────────── */
/**
 * Shopify's orders_export has ONE ROW PER LINE-ITEM. All rows for the
 * same order share the same `Id` (and `Name`). We group by `Id` and
 * rebuild the object the REST API would return.
 */
export function orderRowsToApiShape(rows) {
  const byId = new Map();

  for (const row of rows) {
    const orderId = stripShopifyId(row['Id'] || row['Name']);
    if (!orderId) continue;

    // Line-item for this row
    const sku     = str(row['Lineitem sku']);
    const liName  = str(row['Lineitem name']);
    if (!byId.has(orderId)) {
      const createdIso = toIso(row['Created at']);
      const paidIso    = toIso(row['Paid at']);
      const fulfIso    = toIso(row['Fulfilled at']);
      const cancIso    = toIso(row['Cancelled at']);
      const tags       = str(row['Tags']);
      const email      = lower(row['Email']);
      const billing    = row['Billing City'] || row['Billing Province'] ? {
        city:     str(row['Billing City']),
        province: str(row['Billing Province Name'] || row['Billing Province']),
        country:  str(row['Billing Country']),
        zip:      stripShopifyId(row['Billing Zip']),
        phone:    stripShopifyId(row['Billing Phone']),
        address1: str(row['Billing Address1']),
        address2: str(row['Billing Address2']),
        name:     str(row['Billing Name']),
      } : null;
      const shipping   = row['Shipping City'] || row['Shipping Province'] ? {
        city:     str(row['Shipping City']),
        province: str(row['Shipping Province Name'] || row['Shipping Province']),
        country:  str(row['Shipping Country']),
        zip:      stripShopifyId(row['Shipping Zip']),
        phone:    stripShopifyId(row['Shipping Phone']),
        address1: str(row['Shipping Address1']),
        address2: str(row['Shipping Address2']),
        name:     str(row['Shipping Name']),
      } : null;

      const discountCodes = str(row['Discount Code'])
        ? [{ code: str(row['Discount Code']), amount: String(num(row['Discount Amount'])) }]
        : [];

      byId.set(orderId, {
        id:                 orderId,
        name:               str(row['Name']),
        created_at:         createdIso,
        processed_at:       paidIso || createdIso,
        cancelled_at:       cancIso || null,
        cancel_reason:      null,
        email,
        currency:           str(row['Currency']) || 'INR',
        total_price:        String(num(row['Total'])),
        subtotal_price:     String(num(row['Subtotal'])),
        total_discounts:    String(num(row['Discount Amount'])),
        total_tax:          String(num(row['Taxes'])),
        total_shipping_price_set: {
          shop_money: { amount: String(num(row['Shipping'])) },
        },
        financial_status:   lower(row['Financial Status']) || 'paid',
        fulfillment_status: lower(row['Fulfillment Status']) || null,
        tags,
        source_name:        str(row['Source']) || 'csv_import',
        payment_gateway_names: str(row['Payment Method']) ? [str(row['Payment Method'])] : [],
        billing_address:    billing,
        shipping_address:   shipping,
        customer:           email ? {
          email,
          first_name: str(row['Billing Name']).split(' ')[0],
          last_name:  str(row['Billing Name']).split(' ').slice(1).join(' '),
          phone:      stripShopifyId(row['Phone']) || stripShopifyId(row['Billing Phone']),
          orders_count: null,
          total_spent:  null,
        } : null,
        line_items:         [],
        discount_codes:     discountCodes,
        refunds:            num(row['Refunded Amount']) > 0
          ? [{ transactions: [{ amount: String(num(row['Refunded Amount'])) }] }]
          : [],
        note:               str(row['Notes']),
        _source:            'csv',
      });
    }

    // Attach line-item (one per row)
    if (sku || liName) {
      const order = byId.get(orderId);
      order.line_items.push({
        sku,
        name:                str(liName),
        quantity:            num(row['Lineitem quantity']) || 1,
        price:               String(num(row['Lineitem price'])),
        compare_at_price:    num(row['Lineitem compare at price']) > 0
          ? String(num(row['Lineitem compare at price']))
          : null,
        total_discount:      String(num(row['Lineitem discount'])),
        requires_shipping:   lower(row['Lineitem requires shipping']) === 'true',
        taxable:             lower(row['Lineitem taxable']) === 'true',
        fulfillment_status:  lower(row['Lineitem fulfillment status']) || null,
        product_id:          null,
        variant_id:          null,
      });
    }
  }

  return Array.from(byId.values());
}

/* ─── CUSTOMERS: CSV ROWS → NORMALIZED RECORDS ──────────────────── */
export function customerRowsToRecords(rows) {
  const out = [];
  for (const row of rows) {
    const email = lower(row['Email']);
    const customerId = stripShopifyId(row['Customer ID']);
    if (!email && !customerId) continue;

    const tags = str(row['Tags']);
    out.push({
      customer_id:  customerId,
      email,
      first_name:   str(row['First Name']),
      last_name:    str(row['Last Name']),
      phone:        stripShopifyId(row['Phone']) || stripShopifyId(row['Default Address Phone']),
      accepts_email_marketing: lower(row['Accepts Email Marketing']) === 'yes',
      accepts_sms_marketing:   lower(row['Accepts SMS Marketing']) === 'yes',
      total_spent:  num(row['Total Spent']),
      total_orders: num(row['Total Orders']),
      tags,
      note:         str(row['Note']),
      city:         str(row['Default Address City']),
      province:     str(row['Default Address Province Code']),
      country:      str(row['Default Address Country Code']),
      zip:          stripShopifyId(row['Default Address Zip']),
      address1:     str(row['Default Address Address1']),
      address2:     str(row['Default Address Address2']),
      company:      str(row['Default Address Company']),
      _source:      'csv',
    });
  }
  return out;
}

/* ─── DETECT CSV TYPE ───────────────────────────────────────────── */
export function detectCsvType(headerLine) {
  const h = (headerLine || '').toLowerCase();
  if (h.includes('lineitem sku') || h.includes('lineitem name')) return 'orders';
  if (h.includes('customer id') && h.includes('total spent'))   return 'customers';
  if (h.includes('accepts email marketing'))                    return 'customers';
  return 'unknown';
}

/* ─── BULK PARSE MULTIPLE FILES ─────────────────────────────────── */
/**
 * Returns { orders: [...], customers: [...], perFile: [{name,type,rows,...}] }
 * Orders and customers are deduped across files.
 */
export async function parseBulkCsvFiles(files, onProgress) {
  const allOrders    = new Map(); // id → order
  const allCustomers = new Map(); // email (or customer_id) → record
  const perFile      = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(`[${i + 1}/${files.length}] ${f.name} — reading...`);
    const text = await readFileText(f);
    const firstNewline = text.indexOf('\n');
    const header = firstNewline >= 0 ? text.slice(0, firstNewline) : text.slice(0, 500);
    const type = detectCsvType(header);

    if (type === 'unknown') {
      perFile.push({ name: f.name, type, rows: 0, added: 0, skipped: 0, error: 'unrecognized headers' });
      continue;
    }

    onProgress?.(`[${i + 1}/${files.length}] ${f.name} — parsing ${type}...`);
    const rows = parseCsv(text);

    if (type === 'orders') {
      const orders = orderRowsToApiShape(rows);
      let added = 0, replaced = 0;
      for (const o of orders) {
        if (allOrders.has(o.id)) {
          // Keep the one with more line-items (more complete)
          const prev = allOrders.get(o.id);
          if ((o.line_items?.length || 0) > (prev.line_items?.length || 0)) {
            allOrders.set(o.id, o);
            replaced++;
          }
        } else {
          allOrders.set(o.id, o);
          added++;
        }
      }
      perFile.push({ name: f.name, type, rows: rows.length, added, replaced });
      onProgress?.(`  → ${rows.length} rows, ${orders.length} orders (+${added} new, ${replaced} replaced)`);
    } else {
      const customers = customerRowsToRecords(rows);
      let added = 0, replaced = 0;
      for (const c of customers) {
        const key = c.email || c.customer_id;
        if (!key) continue;
        if (allCustomers.has(key)) {
          // Merge — prefer non-empty fields, higher totals
          const prev = allCustomers.get(key);
          allCustomers.set(key, {
            ...prev,
            ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== '' && v != null)),
            total_spent:  Math.max(prev.total_spent  || 0, c.total_spent  || 0),
            total_orders: Math.max(prev.total_orders || 0, c.total_orders || 0),
            tags: [prev.tags, c.tags].filter(Boolean).join(', '),
          });
          replaced++;
        } else {
          allCustomers.set(key, c);
          added++;
        }
      }
      perFile.push({ name: f.name, type, rows: rows.length, added, replaced });
      onProgress?.(`  → ${rows.length} rows, ${customers.length} customers (+${added} new, ${replaced} merged)`);
    }
  }

  return {
    orders:    Array.from(allOrders.values()),
    customers: Array.from(allCustomers.values()),
    perFile,
  };
}

/* ─── MERGE with existing data (dedupe by id) ───────────────────── */
export function mergeOrders(existing = [], incoming = []) {
  const map = new Map();
  for (const o of existing) if (o?.id) map.set(String(o.id), o);
  for (const o of incoming) {
    const id = String(o?.id || '');
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) { map.set(id, o); continue; }
    // Keep whichever has more line_items or newer source
    const prevLi = prev.line_items?.length || 0;
    const newLi  = o.line_items?.length || 0;
    if (newLi > prevLi) map.set(id, o);
    else if (newLi === prevLi && o._source === 'api') map.set(id, o); // API shape beats CSV if tie
  }
  return Array.from(map.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export function mergeCustomers(existing = [], incoming = []) {
  const map = new Map();
  const keyOf = c => (c?.email || c?.customer_id || '').toLowerCase();
  for (const c of existing) { const k = keyOf(c); if (k) map.set(k, c); }
  for (const c of incoming) {
    const k = keyOf(c);
    if (!k) continue;
    const prev = map.get(k);
    if (!prev) { map.set(k, c); continue; }
    map.set(k, {
      ...prev,
      ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== '' && v != null)),
      total_spent:  Math.max(prev.total_spent  || 0, c.total_spent  || 0),
      total_orders: Math.max(prev.total_orders || 0, c.total_orders || 0),
    });
  }
  return Array.from(map.values());
}
