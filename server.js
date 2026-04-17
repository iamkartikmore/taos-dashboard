const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const compression = require('compression');

const app = express();

// Gzip all responses — critical for Render.com bandwidth limits
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Render.com: keep connections alive, disable proxy buffering on SSE routes
app.use((req, res, next) => {
  if (!req.path.includes('/stream')) {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=120');
  }
  next();
});

/* ─── HELPERS ─────────────────────────────────────────────────────── */

// Exponential backoff retry — handles Meta 80004 / Shopify 429 gracefully
async function withRetry(fn, maxAttempts = 4, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const code   = err.response?.data?.error?.code;
      // Retry on: 429 rate limit, 503 service unavailable, Meta transient (80004, 1, 2)
      const retryable = [429, 503, 500].includes(status) || [1, 2, 80004, 17, 613].includes(code);
      if (!retryable || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Shopify: obtain access token with retry
async function shopifyToken(shopDomain, clientId, clientSecret) {
  const resp = await withRetry(() => axios.post(
    `https://${shopDomain}.myshopify.com/admin/oauth/access_token`,
    { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
    { timeout: 20000 },
  ));
  const token = resp.data?.access_token;
  if (!token) throw new Error('Failed to obtain Shopify access token — check client_id / client_secret');
  return token;
}

/* ─── META PROXY ──────────────────────────────────────────────────── */

// Standard Meta Graph API proxy (avoids browser CORS)
app.post('/api/meta/fetch', async (req, res) => {
  const { url, params } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const response = await withRetry(() => axios.get(url, { params, timeout: 45000 }));
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  }
});

// Meta insights with custom time_range — supports any date up to 37 months back.
// For ranges > 90 days the caller chunks by quarter; this endpoint handles one chunk.
app.post('/api/meta/insights-range', async (req, res) => {
  const { url, params } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    // May take longer for large accounts / long ranges — extend timeout
    const response = await withRetry(() => axios.get(url, { params, timeout: 90000 }));
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  }
});

/* ─── SHOPIFY INVENTORY ───────────────────────────────────────────── */

app.post('/api/shopify/inventory', async (req, res) => {
  const { shop, clientId, clientSecret } = req.body;
  if (!shop || !clientId || !clientSecret) return res.status(400).json({ error: 'shop, clientId and clientSecret required' });
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    const accessToken = await shopifyToken(shopDomain, clientId, clientSecret);
    const headers = { 'X-Shopify-Access-Token': accessToken };

    // Step 1: Pull products page-by-page — extract ONLY needed fields, never buffer all products.
    // Request minimal fields from Shopify to reduce inbound payload too (images/options/body_html excluded).
    const variantMap  = {};  // inventory_item_id → slim variant record
    const skuToItemId = {};
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,product_type,tags,variants`;
    while (url) {
      const resp = await withRetry(() => axios.get(url, { headers, timeout: 45000 }));
      for (const p of (resp.data.products || [])) {
        const pid = String(p.id);
        for (const v of (p.variants || [])) {
          const sku = (v.sku || '').trim().toUpperCase();
          if (!v.inventory_item_id) continue;
          const itemId = String(v.inventory_item_id);
          variantMap[itemId] = {
            sku,
            variantTitle: v.title   || '',
            price:        parseFloat(v.price) || 0,
            productId:    pid,
            productTitle: p.title        || '',
            productType:  p.product_type || '',
            tags:         p.tags         || '',
            _totalStock:  0,
          };
          if (sku) skuToItemId[sku] = itemId;
        }
      }
      const m = (resp.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }

    // Step 2: Fetch active locations
    let locations = [];
    try {
      const locResp = await withRetry(() => axios.get(
        `https://${shopDomain}.myshopify.com/admin/api/2024-01/locations.json`,
        { headers, timeout: 15000 },
      ));
      locations = (locResp.data.locations || []).filter(l => l.active);
    } catch (_) {}

    // Step 3: Fetch inventory levels in batches of 50 — accumulate totals only
    const itemIds = Object.keys(variantMap);
    if (itemIds.length > 0) {
      const batches = [];
      for (let i = 0; i < itemIds.length; i += 50) batches.push(itemIds.slice(i, i + 50));
      const CONCURRENCY = 4;
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        await Promise.all(batches.slice(i, i + CONCURRENCY).map(async batch => {
          try {
            const lvlResp = await withRetry(() => axios.get(
              `https://${shopDomain}.myshopify.com/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${batch.join(',')}&limit=250`,
              { headers, timeout: 45000 },
            ));
            (lvlResp.data.inventory_levels || []).forEach(lvl => {
              const rec = variantMap[lvl.inventory_item_id];
              if (rec) rec._totalStock += (lvl.available || 0);
            });
          } catch (_) {}
        }));
      }
    }

    // Step 4: Fetch collections + product memberships
    let allCollections = [];
    const productCollections = {}; // productId → [collectionTitle, ...]
    try {
      const customColls = [];
      let ccUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/custom_collections.json?limit=250&fields=id,title,handle`;
      while (ccUrl) {
        const r = await withRetry(() => axios.get(ccUrl, { headers, timeout: 20000 }));
        customColls.push(...(r.data.custom_collections || []));
        const m = (r.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
        ccUrl = m ? m[1] : null;
      }

      const smartColls = [];
      let scUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/smart_collections.json?limit=250&fields=id,title,handle`;
      while (scUrl) {
        const r = await withRetry(() => axios.get(scUrl, { headers, timeout: 20000 }));
        smartColls.push(...(r.data.smart_collections || []));
        const m = (r.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
        scUrl = m ? m[1] : null;
      }

      allCollections = [
        ...customColls.map(c => ({ id: String(c.id), title: c.title, handle: c.handle, type: 'custom' })),
        ...smartColls.map(c => ({ id: String(c.id), title: c.title, handle: c.handle, type: 'smart'  })),
      ];

      const collById = Object.fromEntries(allCollections.map(c => [c.id, c.title]));

      let collectsUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/collects.json?limit=250&fields=collection_id,product_id`;
      while (collectsUrl) {
        const r = await withRetry(() => axios.get(collectsUrl, { headers, timeout: 20000 }));
        for (const c of (r.data.collects || [])) {
          const pid   = String(c.product_id);
          const title = collById[String(c.collection_id)];
          if (!title) continue;
          if (!productCollections[pid]) productCollections[pid] = [];
          if (!productCollections[pid].includes(title)) productCollections[pid].push(title);
        }
        const m = (r.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
        collectsUrl = m ? m[1] : null;
      }

      // Batch smart-collection product lookups — 5 at a time to avoid memory spikes
      const smartToCheck = smartColls.slice(0, 50);
      const SC_BATCH = 5;
      for (let i = 0; i < smartToCheck.length; i += SC_BATCH) {
        await Promise.all(smartToCheck.slice(i, i + SC_BATCH).map(async sc => {
          try {
            let spUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/collections/${sc.id}/products.json?limit=250&fields=id`;
            while (spUrl) {
              const r = await withRetry(() => axios.get(spUrl, { headers, timeout: 20000 }));
              for (const p of (r.data.products || [])) {
                const pid = String(p.id);
                if (!productCollections[pid]) productCollections[pid] = [];
                if (!productCollections[pid].includes(sc.title)) productCollections[pid].push(sc.title);
              }
              const m = (r.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
              spUrl = m ? m[1] : null;
            }
          } catch (_) {}
        }));
      }
    } catch (collErr) {
      console.warn('[inventory] collections fetch failed (non-fatal):', collErr.message);
    }

    // Step 5: Build inventory map server-side — send pre-computed map, NOT raw products.
    // This keeps the response payload small (a few KB/MB vs. potentially 100MB+ of raw products).
    const map = {};
    for (const [itemId, rec] of Object.entries(variantMap)) {
      if (!rec.sku) continue;
      const collections   = productCollections[rec.productId] || [];
      const collectionLabel = collections[0] || rec.productType || '';
      if (map[rec.sku]) {
        map[rec.sku].stock += rec._totalStock;
      } else {
        map[rec.sku] = {
          title:           rec.productTitle,
          variantTitle:    rec.variantTitle,
          stock:           rec._totalStock,
          price:           rec.price,
          productType:     rec.productType,
          collectionLabel,
          collections,
          tags:            rec.tags,
          productId:       rec.productId,
          inventoryItemId: itemId,
        };
      }
    }

    res.json({ map, locations, skuToItemId, collections: allCollections });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.errors || err.message });
  }
});

/* ─── SHOPIFY ORDERS (non-streaming, legacy) ──────────────────────── */

app.post('/api/shopify/orders', async (req, res) => {
  const { shop, clientId, clientSecret, since, until } = req.body;
  if (!shop || !clientId || !clientSecret) return res.status(400).json({ error: 'shop, clientId, clientSecret required' });
  const startMs = Date.now();
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    const accessToken = await shopifyToken(shopDomain, clientId, clientSecret);
    const headers = { 'X-Shopify-Access-Token': accessToken };

    const fields = [
      'id','name','created_at','closed_at','cancelled_at','cancel_reason',
      'financial_status','fulfillment_status',
      'total_price','subtotal_price','total_discounts','total_tax','total_shipping_price_set',
      'customer','line_items','discount_codes','billing_address','shipping_address',
      'source_name','referring_site','landing_site','processing_method',
      'payment_gateway','payment_gateway_names',
      'refunds','tags','note_attributes','fulfillments','shipping_lines',
    ].join(',');

    let qs = `limit=250&status=any&fields=${fields}`;
    if (since) qs += `&created_at_min=${encodeURIComponent(since)}`;
    if (until) qs += `&created_at_max=${encodeURIComponent(until)}`;

    const allOrders = [];
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/orders.json?${qs}`;
    let pageCount = 0;
    while (url) {
      const resp = await withRetry(() => axios.get(url, { headers, timeout: 90000 }));
      allOrders.push(...(resp.data.orders || []));
      pageCount++;
      const m = (resp.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      if (url) await new Promise(r => setTimeout(r, 300));
    }

    res.json({ orders: allOrders, count: allOrders.length, pages: pageCount, fetchMs: Date.now() - startMs });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.errors || err.message });
  }
});

/* ─── SHOPIFY ORDERS STREAM (SSE — real-time page-by-page) ───────── */

app.post('/api/shopify/orders/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const emit = obj => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const { shop, clientId, clientSecret, since, until } = req.body;
  if (!shop || !clientId || !clientSecret) {
    emit({ type: 'error', msg: 'shop, clientId, clientSecret required' });
    return res.end();
  }

  const startMs = Date.now();
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    emit({ type: 'log', msg: `Connecting to ${shopDomain}.myshopify.com...` });

    const accessToken = await shopifyToken(shopDomain, clientId, clientSecret);
    emit({ type: 'log', msg: '✓ Authenticated' });

    const headers = { 'X-Shopify-Access-Token': accessToken };
    const fields = [
      'id','created_at','cancelled_at','cancel_reason',
      'email',
      'total_price','total_discounts','total_shipping_price_set',
      'customer','line_items','discount_codes',
      'billing_address','shipping_address',
      'source_name','referring_site','landing_site',
      'payment_gateway','payment_gateway_names',
      'refunds','fulfillments','note_attributes',
      'tags','fulfillment_status','financial_status',
    ].join(',');

    let qs = `limit=250&status=any&fields=${fields}`;
    if (since) qs += `&created_at_min=${encodeURIComponent(since)}`;
    if (until) qs += `&created_at_max=${encodeURIComponent(until)}`;

    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/orders.json?${qs}`;
    let page = 0;
    let totalOrders = 0;

    while (url) {
      page++;
      emit({ type: 'log', msg: `Fetching page ${page}... (${totalOrders} so far)` });

      let resp;
      try {
        resp = await withRetry(() => axios.get(url, { headers, timeout: 90000 }));
      } catch (pageErr) {
        emit({ type: 'error', msg: `Page ${page} failed: ${pageErr.message}` });
        break;
      }

      const batch = resp.data.orders || [];
      totalOrders += batch.length;

      emit({ type: 'batch', orders: batch, offset: (page - 1) * 250 });
      emit({ type: 'page', page, batchCount: batch.length, total: totalOrders,
        msg: `✓ Page ${page}: +${batch.length} orders → ${totalOrders} total` });

      const m = (resp.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      if (url) await new Promise(r => setTimeout(r, 300));
    }

    emit({ type: 'done', count: totalOrders, pages: page, fetchMs: Date.now() - startMs });
    emit({ type: 'log', msg: `✓ Complete — ${totalOrders} orders · ${page} pages · ${((Date.now() - startMs)/1000).toFixed(1)}s` });
  } catch (err) {
    emit({ type: 'error', msg: String(err.response?.data?.errors || err.message) });
  }
  if (!res.writableEnded) res.end();
});

/* ─── SHOPIFY DRAFT ORDERS (Purchase Orders) ─────────────────────── */
// Requires: read_draft_orders scope on the Shopify Custom App
app.post('/api/shopify/draft-orders', async (req, res) => {
  const { shop, clientId, clientSecret, status = 'open', limit = 250 } = req.body;
  if (!shop || !clientId || !clientSecret) return res.status(400).json({ error: 'shop, clientId, clientSecret required' });
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    const accessToken = await shopifyToken(shopDomain, clientId, clientSecret);
    const headers = { 'X-Shopify-Access-Token': accessToken };

    const allDrafts = [];
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/draft_orders.json?limit=${limit}&status=${status}`;
    while (url) {
      const resp = await withRetry(() => axios.get(url, { headers, timeout: 30000 }));
      allDrafts.push(...(resp.data.draft_orders || []));
      const m = (resp.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }
    res.json({ draft_orders: allDrafts, count: allDrafts.length });
  } catch (err) {
    const status = err.response?.status || 500;
    // 403 = missing read_draft_orders scope
    res.status(status).json({ error: err.response?.data?.errors || err.message, needsScope: status === 403 });
  }
});

/* ─── GOOGLE ANALYTICS 4 ──────────────────────────────────────────── */

app.post('/api/ga/report', async (req, res) => {
  const { serviceAccountJson, propertyId, dateRange } = req.body;
  if (!serviceAccountJson || !propertyId) return res.status(400).json({ error: 'serviceAccountJson and propertyId required' });
  try {
    const { GoogleAuth } = require('google-auth-library');
    let creds;
    try { creds = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson; }
    catch { return res.status(400).json({ error: 'Invalid serviceAccountJson — must be valid JSON' }); }

    const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    const since = dateRange?.since || '7daysAgo';
    const until = dateRange?.until || 'today';
    const BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const HDRS = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const parse = (report) => {
      if (!report) return [];
      const dimNames = (report.dimensionHeaders || []).map(h => h.name);
      const metNames = (report.metricHeaders  || []).map(h => h.name);
      return (report.rows || []).map(row => {
        const obj = {};
        (row.dimensionValues || []).forEach((v, i) => { obj[dimNames[i]] = v.value; });
        (row.metricValues   || []).forEach((v, i) => { obj[metNames[i]]  = parseFloat(v.value) || 0; });
        return obj;
      });
    };

    const run = async (body) => {
      try {
        const r = await axios.post(BASE, body, { headers: HDRS, timeout: 45000 });
        return parse(r.data);
      } catch (e) {
        console.error('[GA] sub-report error:', e.response?.data?.error?.message || e.message);
        return [];
      }
    };

    const [
      dailyTrend, sourceMedium, campaigns, landingPages, devices,
      geo, pages, events, items, utmDrill, browsers, userType, monthlyTrend,
      sessionHour, deviceChannel, osVersion, engagementByChannel, screenResolution,
    ] = await Promise.all([
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'date'}],
        metrics:['sessions','totalUsers','newUsers','engagedSessions','bounceRate','screenPageViews','conversions','purchaseRevenue','averageSessionDuration'].map(n=>({name:n})) }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionSourceMedium'},{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue','bounceRate','engagementRate'].map(n=>({name:n})), limit:150 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionCampaignName'},{name:'sessionSource'},{name:'sessionMedium'}],
        metrics:['sessions','newUsers','conversions','purchaseRevenue','engagementRate'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'landingPagePlusQueryString'}],
        metrics:['sessions','totalUsers','bounceRate','conversions','engagementRate','screenPageViews'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'deviceCategory'},{name:'operatingSystem'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})) }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'country'},{name:'region'},{name:'city'}],
        metrics:['sessions','totalUsers','conversions','purchaseRevenue'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'pageTitle'},{name:'fullPageUrl'}],
        metrics:['screenPageViews','averageSessionDuration','bounceRate','engagedSessions'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'eventName'}],
        metrics:['eventCount','totalUsers','conversions'].map(n=>({name:n})), limit:50 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'itemName'},{name:'itemId'},{name:'itemCategory'},{name:'itemBrand'}],
        metrics:['itemRevenue','itemsPurchased','addToCarts','checkouts'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionSource'},{name:'sessionMedium'},{name:'sessionCampaignName'},{name:'sessionManualAdContent'}],
        metrics:['sessions','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})), limit:500 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'browser'},{name:'deviceCategory'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:30 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'newVsReturning'}],
        metrics:['sessions','totalUsers','conversions','purchaseRevenue','engagementRate'].map(n=>({name:n})) }),
      run({ dateRanges:[{startDate:'730daysAgo',endDate:until}], dimensions:[{name:'year'},{name:'month'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})) }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'hour'},{name:'dayOfWeek'}],
        metrics:['sessions','conversions','purchaseRevenue','engagedSessions'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'deviceCategory'},{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','conversions','purchaseRevenue','bounceRate','engagementRate','averageSessionDuration'].map(n=>({name:n})), limit:50 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'operatingSystem'},{name:'operatingSystemVersion'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:60 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','engagedSessions','bounceRate','averageSessionDuration','screenPageViews','conversions','purchaseRevenue'].map(n=>({name:n})), limit:20 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'screenResolution'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:30 }),
    ]);

    const monthlyTrendNorm = monthlyTrend.map(r => ({ ...r, yearMonth: `${r.year}${r.month}` }));

    res.json({
      dailyTrend, sourceMedium, campaigns, landingPages, devices, geo, pages, events, items,
      utmDrill, browsers, userType, monthlyTrend: monthlyTrendNorm,
      sessionHour, deviceChannel, osVersion, engagementByChannel, screenResolution,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/* ─── HEALTH CHECK ────────────────────────────────────────────────── */

app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

/* ─── SERVE BUILT CLIENT ──────────────────────────────────────────── */

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, 'client/dist');
  app.use(express.static(dist, { maxAge: '1d' }));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`TAOS server → http://localhost:${PORT}`));
