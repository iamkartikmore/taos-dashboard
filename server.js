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
async function withRetry(fn, maxAttempts = 5, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status  = err.response?.status;
      const code    = err.response?.data?.error?.code;        // Meta error code
      const errCode = err.code;                               // axios/node network code
      const isAppLimit     = code === 4;                      // Meta "Application request limit reached" — transient
      const isRateOrServer = [429, 503, 500, 502, 504].includes(status);
      const isMetaTransient = [1, 2, 17, 613, 80004].includes(code);
      const isNetwork      = ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN', 'ENETUNREACH'].includes(errCode);
      const retryable = isAppLimit || isRateOrServer || isMetaTransient || isNetwork;
      if (!retryable || attempt === maxAttempts) throw err;
      // App-level rate limit needs to wait much longer for the bucket to refill
      const delay = isAppLimit
        ? 15000 * Math.pow(2, attempt - 1)     // 15s, 30s, 60s, 120s
        : baseDelayMs * Math.pow(2, attempt - 1);
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
  const START_MS = Date.now();
  const BUDGET_MS = 25000; // bail out before Render's 30s hard kill
  const timeLeft = () => BUDGET_MS - (Date.now() - START_MS);
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    const accessToken = await shopifyToken(shopDomain, clientId, clientSecret);
    const headers = { 'X-Shopify-Access-Token': accessToken };

    // Step 1: Pull products page-by-page — extract ONLY needed fields, never buffer all products.
    // Request minimal fields from Shopify to reduce inbound payload too (images/options/body_html excluded).
    const variantMap  = {};  // inventory_item_id → slim variant record
    const skuToItemId = {};
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/products.json?limit=250&status=active&fields=id,title,handle,product_type,tags,variants,image`;
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
            productHandle:p.handle       || '',
            productImage: p.image?.src   || '',
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

    // Step 4: Fetch collections + product memberships — skip if budget is low to avoid truncated JSON
    let allCollections = [];
    const productCollections = {}; // productId → [collectionTitle, ...]
    if (timeLeft() > 8000) {
      try {
        const collTimeout = Math.min(timeLeft() - 4000, 18000); // leave 4s for response write

        const customColls = [];
        let ccUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/custom_collections.json?limit=250&fields=id,title,handle`;
        while (ccUrl && timeLeft() > 6000) {
          const r = await withRetry(() => axios.get(ccUrl, { headers, timeout: Math.min(collTimeout, 15000) }));
          customColls.push(...(r.data.custom_collections || []));
          const m = (r.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
          ccUrl = m ? m[1] : null;
        }

        const smartColls = [];
        let scUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/smart_collections.json?limit=250&fields=id,title,handle`;
        while (scUrl && timeLeft() > 6000) {
          const r = await withRetry(() => axios.get(scUrl, { headers, timeout: Math.min(collTimeout, 15000) }));
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
        while (collectsUrl && timeLeft() > 6000) {
          const r = await withRetry(() => axios.get(collectsUrl, { headers, timeout: Math.min(collTimeout, 15000) }));
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

        // Smart-collection product lookups — only if time allows
        if (timeLeft() > 7000) {
          const smartToCheck = smartColls.slice(0, 30); // cap at 30 to stay within budget
          const SC_BATCH = 5;
          for (let i = 0; i < smartToCheck.length && timeLeft() > 6000; i += SC_BATCH) {
            await Promise.all(smartToCheck.slice(i, i + SC_BATCH).map(async sc => {
              try {
                let spUrl = `https://${shopDomain}.myshopify.com/admin/api/2024-01/collections/${sc.id}/products.json?limit=250&fields=id`;
                while (spUrl && timeLeft() > 5000) {
                  const r = await withRetry(() => axios.get(spUrl, { headers, timeout: 12000 }));
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
        }
      } catch (collErr) {
        console.warn('[inventory] collections fetch failed (non-fatal):', collErr.message);
      }
    } else {
      console.warn('[inventory] skipping collections — budget exhausted after products+inventory');
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
          handle:          rec.productHandle,
          image:           rec.productImage,
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

    res.json({ map, locations, skuToItemId, collections: allCollections, elapsedMs: Date.now() - START_MS });
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

    // Smaller page size = faster per-page response = fewer TCP timeouts over long pulls.
    // For 60 days TAOS volume (~5k orders) this means ~50 pages at 1-2s each vs 20 pages at 5-10s each.
    const PAGE_LIMIT = 100;
    let qs = `limit=${PAGE_LIMIT}&status=any&fields=${fields}`;
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
        // 60s is plenty for a 100-row page; withRetry handles ETIMEDOUT / 429 / 5xx with backoff.
        resp = await withRetry(() => axios.get(url, { headers, timeout: 60000 }));
      } catch (pageErr) {
        const detail = pageErr.message
          || pageErr.code
          || (pageErr.response && `HTTP ${pageErr.response.status}`)
          || 'unknown error';
        emit({ type: 'error', msg: `Page ${page} failed: ${detail}` });
        break;
      }

      const batch = resp.data.orders || [];
      totalOrders += batch.length;

      emit({ type: 'batch', orders: batch, offset: (page - 1) * PAGE_LIMIT });
      emit({ type: 'page', page, batchCount: batch.length, total: totalOrders,
        msg: `✓ Page ${page}: +${batch.length} orders → ${totalOrders} total` });

      const m = (resp.headers['link'] || '').match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      // Shopify REST bucket leaks at 2 req/s — 250ms keeps us just under.
      if (url) await new Promise(r => setTimeout(r, 250));
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

    // GA4 allows max 10 concurrent requests per property — run in two batches of 9
    const [
      dailyTrend, sourceMedium, campaigns, landingPages, devices,
      geo, pages, events, items, utmDrill,
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
      // addToCarts and checkouts are event-scoped — incompatible with item dimensions
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'itemName'},{name:'itemId'},{name:'itemCategory'},{name:'itemBrand'}],
        metrics:['itemRevenue','itemsPurchased'].map(n=>({name:n})), limit:200 }),
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionSource'},{name:'sessionMedium'},{name:'sessionCampaignName'},{name:'sessionManualAdContent'}],
        metrics:['sessions','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})), limit:500 }),
    ]);

    const [
      browsers, userType, monthlyTrend,
      sessionHour, deviceChannel, osVersion, engagementByChannel, screenResolution,
    ] = await Promise.all([
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

/* ─── GOOGLE ADS ──────────────────────────────────────────────────── */

const GADS_API_VERSION = 'v23';
const GADS_BASE = 'https://googleads.googleapis.com';

async function getGadsAccessToken(clientId, clientSecret, refreshToken) {
  const r = await axios.post('https://oauth2.googleapis.com/token', null, {
    params: { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    timeout: 15000,
  });
  return r.data.access_token;
}

async function gadsQuery({ accessToken, devToken, loginCustomerId, customerId, query }) {
  const url = `${GADS_BASE}/${GADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const headers = {
    'Authorization':   `Bearer ${accessToken}`,
    'developer-token': devToken,
    'Content-Type':    'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const allRows = [];
  let pageToken;
  do {
    const body = { query, pageSize: 10000 };
    if (pageToken) body.pageToken = pageToken;
    const r = await withRetry(() => axios.post(url, body, { headers, timeout: 60000 }));
    if (r.data.results?.length) allRows.push(...r.data.results);
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return allRows;
}

const GADS_DATE_PRESETS = {
  today:    'TODAY',
  last_7d:  'LAST_7_DAYS',
  last_14d: 'LAST_14_DAYS',
  last_30d: 'LAST_30_DAYS',
  last_90d: 'LAST_90_DAYS',
};

// POST /api/google-ads/verify — test credentials, return customer metadata
app.post('/api/google-ads/verify', async (req, res) => {
  const { devToken, loginCustomerId, customerId, clientId, clientSecret, refreshToken } = req.body;
  if (!devToken || !customerId || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ ok: false, error: 'missing required fields' });
  }
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const rows = await gadsQuery({
      accessToken, devToken,
      loginCustomerId: loginCustomerId || customerId,
      customerId,
      query: 'SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1',
    });
    const c = rows[0]?.customer || {};
    res.json({ ok: true, name: c.descriptiveName, currency: c.currencyCode, timeZone: c.timeZone });
  } catch (err) {
    const gErr = err.response?.data?.error;
    const msg  = gErr?.details?.[0]?.errors?.[0]?.message || gErr?.message || err.message;
    res.status(400).json({ ok: false, error: msg, status: err.response?.status });
  }
});

// POST /api/google-ads/pull — full parallel pull of campaigns, adgroups, ads, keywords, search terms, breakdowns, shopping
app.post('/api/google-ads/pull', async (req, res) => {
  const { devToken, loginCustomerId, customerId, clientId, clientSecret, refreshToken, datePreset = 'last_30d' } = req.body;
  if (!devToken || !customerId || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: 'devToken, customerId, clientId, clientSecret, refreshToken required' });
  }
  const startMs = Date.now();
  const mcc    = loginCustomerId || customerId;
  const during = GADS_DATE_PRESETS[datePreset] || 'LAST_30_DAYS';

  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const q = query => gadsQuery({ accessToken, devToken, loginCustomerId: mcc, customerId, query });

    const queries = {
      campaigns: `
        SELECT campaign.id, campaign.name, campaign.status,
          campaign.advertising_channel_type, campaign.bidding_strategy_type,
          campaign_budget.amount_micros,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value,
          metrics.all_conversions, metrics.all_conversions_value,
          metrics.view_through_conversions,
          metrics.ctr, metrics.average_cpc
        FROM campaign
        WHERE segments.date DURING ${during}
          AND campaign.status != 'REMOVED'`,
      campaignsDaily: `
        SELECT campaign.id, campaign.name, segments.date,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date DURING ${during}`,
      adGroups: `
        SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
          campaign.id, campaign.name, ad_group.cpc_bid_micros,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
        FROM ad_group
        WHERE segments.date DURING ${during}
          AND ad_group.status != 'REMOVED'`,
      ads: `
        SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
          ad_group_ad.status, ad_group_ad.ad.final_urls,
          ad_group.id, ad_group.name, campaign.id, campaign.name,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
        FROM ad_group_ad
        WHERE segments.date DURING ${during}
          AND ad_group_ad.status != 'REMOVED'`,
      keywords: `
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
          ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
          ad_group.id, ad_group.name, campaign.id, campaign.name,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
        FROM keyword_view
        WHERE segments.date DURING ${during}
          AND ad_group_criterion.status != 'REMOVED'`,
      searchTerms: `
        SELECT search_term_view.search_term,
          ad_group.id, campaign.id,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr
        FROM search_term_view
        WHERE segments.date DURING ${during}`,
      devices: `
        SELECT campaign.id, segments.device,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date DURING ${during}`,
      hours: `
        SELECT campaign.id, segments.hour, segments.day_of_week,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date DURING ${during}`,
      geo: `
        SELECT campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM geographic_view
        WHERE segments.date DURING ${during}`,
      age: `
        SELECT ad_group.id, ad_group.name, ad_group_criterion.age_range.type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM age_range_view
        WHERE segments.date DURING ${during}`,
      gender: `
        SELECT ad_group.id, ad_group.name, ad_group_criterion.gender.type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM gender_view
        WHERE segments.date DURING ${during}`,
      shopping: `
        SELECT segments.product_item_id, segments.product_title, segments.product_brand,
          segments.product_type_l1, segments.product_channel,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM shopping_performance_view
        WHERE segments.date DURING ${during}`,
    };

    // Run in parallel; individual failures are tolerated (e.g., shopping fails on non-ecommerce accounts)
    const entries = await Promise.all(Object.entries(queries).map(async ([key, query]) => {
      try {
        const rows = await q(query);
        return [key, rows];
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.response?.data?.error?.details?.[0]?.errors?.[0]?.message || e.message;
        console.warn(`[gads:${customerId}] ${key} failed: ${msg}`);
        return [key, [], msg];
      }
    }));

    const data   = {};
    const errors = {};
    entries.forEach(([key, rows, err]) => { data[key] = rows; if (err) errors[key] = err; });

    res.json({ ...data, errors, fetchMs: Date.now() - startMs });
  } catch (err) {
    const gErr = err.response?.data?.error;
    const msg  = gErr?.details?.[0]?.errors?.[0]?.message || gErr?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/* ─── LISTMONK (email) ────────────────────────────────────────────── */

function listmonkAuth({ url, username, password }) {
  if (!url || !username || !password) throw new Error('listmonk url, username, password required');
  return {
    baseURL: url.replace(/\/+$/, ''),
    auth:    { username, password },
    timeout: 30000,
  };
}

function listmonkErr(err) {
  return err.response?.data?.message || err.response?.data?.error || err.message;
}

// POST /api/listmonk/verify — confirm reachable + list configured lists
app.post('/api/listmonk/verify', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const [health, lists] = await Promise.all([
      axios.get(`${cfg.baseURL}/api/health`, cfg),
      axios.get(`${cfg.baseURL}/api/lists?per_page=200`, cfg),
    ]);
    const listRows = (lists.data?.data?.results || []).map(l => ({
      id: l.id, name: l.name, type: l.type, subscriberCount: l.subscriber_count,
    }));
    res.json({ ok: true, health: health.data?.data ?? true, lists: listRows });
  } catch (err) {
    res.status(400).json({ ok: false, error: listmonkErr(err) });
  }
});

// POST /api/listmonk/campaigns — list recent campaigns (with stats)
app.post('/api/listmonk/campaigns', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.get(`${cfg.baseURL}/api/campaigns?per_page=200&order_by=created_at&order=desc`, cfg);
    const campaigns = (r.data?.data?.results || []).map(c => ({
      id:        c.id,
      name:      c.name,
      subject:   c.subject,
      status:    c.status,
      type:      c.type,
      createdAt: c.created_at,
      sendAt:    c.send_at,
      startedAt: c.started_at,
      finishedAt:c.finished_at,
      toSend:    c.to_send,
      sent:      c.sent,
      views:     c.views,
      clicks:    c.clicks,
      bounces:   c.bounces,
      lists:     (c.lists || []).map(l => ({ id: l.id, name: l.name })),
    }));
    res.json({ campaigns });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/campaign — single campaign detail
app.post('/api/listmonk/campaign', async (req, res) => {
  try {
    const { id, ...creds } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const cfg = listmonkAuth(creds);
    const r = await axios.get(`${cfg.baseURL}/api/campaigns/${id}`, cfg);
    res.json({ campaign: r.data?.data });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/analytics — views/clicks/bounces/links time series
app.post('/api/listmonk/analytics', async (req, res) => {
  try {
    const { type = 'views', campaignIds = [], from, to, ...creds } = req.body;
    const cfg = listmonkAuth(creds);
    const params = new URLSearchParams();
    (campaignIds || []).forEach(id => params.append('id', id));
    if (from) params.set('from', from);
    if (to)   params.set('to',   to);
    const r = await axios.get(`${cfg.baseURL}/api/campaigns/analytics/${type}?${params}`, cfg);
    res.json({ series: r.data?.data || [] });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/lists — list subscriber lists
app.post('/api/listmonk/lists', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.get(`${cfg.baseURL}/api/lists?per_page=200`, cfg);
    res.json({ lists: r.data?.data?.results || [] });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/templates — list templates
app.post('/api/listmonk/templates', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.get(`${cfg.baseURL}/api/templates`, cfg);
    res.json({ templates: r.data?.data || [] });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/template-upsert — create or update a template by name
// body: url, username, password, name, subject?, body, type? ('campaign'|'tx')
app.post('/api/listmonk/template-upsert', async (req, res) => {
  try {
    const { name, subject, body, type = 'campaign', ...creds } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    const cfg = listmonkAuth(creds);
    // Find existing by exact name match
    const listResp = await axios.get(`${cfg.baseURL}/api/templates`, cfg);
    const existing = (listResp.data?.data || []).find(t => t.name === name);
    const payload = { name, body, type };
    if (subject) payload.subject = subject;
    let tpl;
    if (existing?.id) {
      const r = await axios.put(`${cfg.baseURL}/api/templates/${existing.id}`, payload, cfg);
      tpl = r.data?.data || { ...existing, ...payload };
    } else {
      const r = await axios.post(`${cfg.baseURL}/api/templates`, payload, cfg);
      tpl = r.data?.data;
    }
    res.json({ template: tpl });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/template-delete — delete template by id
app.post('/api/listmonk/template-delete', async (req, res) => {
  try {
    const { id, ...creds } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const cfg = listmonkAuth(creds);
    await axios.delete(`${cfg.baseURL}/api/templates/${id}`, cfg);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/campaign-draft — create a campaign in draft status (user sends manually)
// body: url, username, password, name, subject, fromEmail, listIds, templateId, body?, tags?
app.post('/api/listmonk/campaign-draft', async (req, res) => {
  try {
    const {
      name, subject, fromEmail, listIds, templateId,
      body = '', contentType = 'html', tags = [],
      ...creds
    } = req.body;
    if (!name || !subject || !fromEmail || !Array.isArray(listIds) || !listIds.length) {
      return res.status(400).json({ error: 'name, subject, fromEmail, listIds[] required' });
    }
    const cfg = listmonkAuth(creds);
    const payload = {
      name, subject,
      from_email:   fromEmail,
      lists:        listIds.map(Number),
      content_type: contentType,
      messenger:    'email',
      body,
      type:         'regular',
      tags,
    };
    if (templateId) payload.template_id = Number(templateId);
    const r = await axios.post(`${cfg.baseURL}/api/campaigns`, payload, cfg);
    res.json({ campaign: r.data?.data });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/campaign-stats — detailed stats for a single campaign
// body: url, username, password, id
app.post('/api/listmonk/campaign-stats', async (req, res) => {
  try {
    const { id, ...creds } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const cfg = listmonkAuth(creds);
    const [detail, links] = await Promise.all([
      axios.get(`${cfg.baseURL}/api/campaigns/${id}`, cfg),
      axios.get(`${cfg.baseURL}/api/campaigns/analytics/links?id=${id}`, cfg).catch(() => ({ data: { data: [] } })),
    ]);
    res.json({
      campaign: detail.data?.data || null,
      links:    links.data?.data  || [],
    });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/send — create + start a campaign
// body: url, username, password, name, subject, fromEmail, listIds, body, contentType?, templateId?, sendAt?, startNow?
app.post('/api/listmonk/send', async (req, res) => {
  try {
    const {
      name, subject, fromEmail, listIds, body, contentType = 'html',
      templateId, sendAt, startNow = true, ...creds
    } = req.body;

    if (!name || !subject || !fromEmail || !Array.isArray(listIds) || !listIds.length) {
      return res.status(400).json({ error: 'name, subject, fromEmail, listIds[] required' });
    }

    const cfg = listmonkAuth(creds);

    const payload = {
      name,
      subject,
      from_email:   fromEmail,
      lists:        listIds.map(Number),
      content_type: contentType,
      messenger:    'email',
      body:         body || '',
      type:         'regular',
    };
    if (templateId) payload.template_id = Number(templateId);
    if (sendAt)     payload.send_at     = sendAt;

    // 1) Create campaign (draft)
    const created = await axios.post(`${cfg.baseURL}/api/campaigns`, payload, cfg);
    const campaign = created.data?.data;
    if (!campaign?.id) throw new Error('campaign creation returned no id');

    // 2) Flip status → running (or scheduled if sendAt was provided)
    if (startNow || sendAt) {
      const nextStatus = sendAt ? 'scheduled' : 'running';
      await axios.put(`${cfg.baseURL}/api/campaigns/${campaign.id}/status`, { status: nextStatus }, cfg);
      campaign.status = nextStatus;
    }

    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/ensure-lists — idempotently create segment lists, return {segmentName: listId}
// body: url, username, password, segmentNames: string[], prefix?: string (default "TAOS")
app.post('/api/listmonk/ensure-lists', async (req, res) => {
  try {
    const { segmentNames, prefix = 'TAOS', ...creds } = req.body;
    if (!Array.isArray(segmentNames) || !segmentNames.length) {
      return res.status(400).json({ error: 'segmentNames[] required' });
    }
    const cfg = listmonkAuth(creds);
    const listsResp = await axios.get(`${cfg.baseURL}/api/lists?per_page=500`, cfg);
    const existing = listsResp.data?.data?.results || [];
    const byName = new Map(existing.map(l => [l.name, l]));
    const result = {};
    for (const seg of segmentNames) {
      const name = `${prefix} — ${seg}`;
      if (byName.has(name)) {
        result[seg] = byName.get(name).id;
        continue;
      }
      const created = await axios.post(`${cfg.baseURL}/api/lists`, {
        name, type: 'private', optin: 'single', tags: ['taos', 'rfm', seg.toLowerCase()],
      }, cfg);
      result[seg] = created.data?.data?.id;
    }
    res.json({ lists: result });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/import-subscribers — bulk upsert via Listmonk CSV import
// body: url, username, password, listId, customers: [{email, name, attribs}]
app.post('/api/listmonk/import-subscribers', async (req, res) => {
  try {
    const { listId, customers, ...creds } = req.body;
    if (!listId || !Array.isArray(customers) || !customers.length) {
      return res.status(400).json({ error: 'listId and customers[] required' });
    }
    const cfg = listmonkAuth(creds);

    // Listmonk CSV import: email,name,attributes(JSON)
    const header = 'email,name,attributes';
    const rows = customers.map(c => {
      const email = (c.email || '').replace(/"/g, '""');
      const name  = (c.name  || '').replace(/"/g, '""');
      const attribs = JSON.stringify(c.attribs || {}).replace(/"/g, '""');
      return `"${email}","${name}","${attribs}"`;
    });
    const csv = [header, ...rows].join('\n');

    // Build multipart form-data manually (avoid extra dep)
    const boundary = '----taos' + Date.now();
    const params = JSON.stringify({
      mode: 'subscribe',
      subscription_status: 'confirmed',
      delim: ',',
      lists: [Number(listId)],
      overwrite: true,
    });
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="params"',
      '',
      params,
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="subscribers.csv"',
      'Content-Type: text/csv',
      '',
      csv,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const r = await axios.post(`${cfg.baseURL}/api/import/subscribers`, body, {
      ...cfg,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    res.json({ ok: true, import: r.data?.data || null, imported: customers.length });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// GET /api/listmonk/import-status — current import progress (Listmonk returns singleton job)
app.post('/api/listmonk/import-status', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.get(`${cfg.baseURL}/api/import/subscribers`, cfg);
    res.json({ status: r.data?.data || null });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/import-logs — fetch raw log text from the running/last import
app.post('/api/listmonk/import-logs', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.get(`${cfg.baseURL}/api/import/subscribers/logs`, cfg);
    res.json({ logs: r.data?.data || '' });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
  }
});

// POST /api/listmonk/import-stop — abort the currently running import
app.post('/api/listmonk/import-stop', async (req, res) => {
  try {
    const cfg = listmonkAuth(req.body);
    const r = await axios.delete(`${cfg.baseURL}/api/import/subscribers`, cfg);
    res.json({ ok: true, status: r.data?.data || null });
  } catch (err) {
    res.status(400).json({ error: listmonkErr(err) });
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
