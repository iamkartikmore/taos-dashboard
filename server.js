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

// Serialize Meta proxy calls so response buffers don't stack and OOM the 512MB instance.
// Concurrency of 2 keeps throughput reasonable while capping peak memory.
const META_MAX_CONCURRENT = 2;
let metaInFlight = 0;
const metaQueue = [];
function acquireMetaSlot() {
  if (metaInFlight < META_MAX_CONCURRENT) {
    metaInFlight++;
    return Promise.resolve();
  }
  return new Promise(resolve => metaQueue.push(resolve));
}
function releaseMetaSlot() {
  const next = metaQueue.shift();
  if (next) next();
  else metaInFlight--;
}

// Standard Meta Graph API proxy (avoids browser CORS)
app.post('/api/meta/fetch', async (req, res) => {
  const { url, params } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  await acquireMetaSlot();
  try {
    const response = await withRetry(() => axios.get(url, { params, timeout: 45000 }));
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  } finally {
    releaseMetaSlot();
  }
});

// Meta insights with custom time_range — supports any date up to 37 months back.
// For ranges > 90 days the caller chunks by quarter; this endpoint handles one chunk.
app.post('/api/meta/insights-range', async (req, res) => {
  const { url, params } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  await acquireMetaSlot();
  try {
    // May take longer for large accounts / long ranges — extend timeout
    const response = await withRetry(() => axios.get(url, { params, timeout: 90000 }));
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  } finally {
    releaseMetaSlot();
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

  // v23 removed pageSize — the server returns a fixed 10000-row page and
  // we paginate via nextPageToken. Sending pageSize now errors out.
  const allRows = [];
  let pageToken;
  do {
    const body = { query };
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
        SELECT campaign.id, campaign.name,
          segments.product_item_id, segments.product_title, segments.product_brand,
          segments.product_type_l1, segments.product_channel,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value
        FROM shopping_performance_view
        WHERE segments.date DURING ${during}`,
      // Operator-visible setting changes from the past 30 days. This is
      // what lets the intel engine correlate "CPA jumped on the 14th"
      // with "someone flipped the bidding strategy at 09:42 on the 14th".
      // change_event has a hard 30-day cap on the API side regardless
      // of the pull preset — so always use LAST_30_DAYS here.
      changeEvents: `
        SELECT change_event.change_date_time, change_event.change_resource_type,
          change_event.change_resource_name, change_event.resource_change_operation,
          change_event.client_type, change_event.user_email,
          change_event.changed_fields, change_event.campaign, change_event.ad_group,
          change_event.old_resource, change_event.new_resource
        FROM change_event
        WHERE change_event.change_date_time DURING LAST_30_DAYS
        ORDER BY change_event.change_date_time DESC
        LIMIT 1000`,
      // Account-level daily budget utilisation — when an account is
      // "limited by budget" impressions collapse. Pull this so the
      // reach-collapse anomaly has a ready-made explanation.
      budgets: `
        SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros,
          campaign_budget.status, campaign_budget.reference_count,
          campaign_budget.recommended_budget_amount_micros,
          campaign_budget.has_recommended_budget
        FROM campaign_budget
        WHERE campaign_budget.status != 'REMOVED'`,

      // Google's own recommendations, ranked by impact. Active recommendations
      // only — dismissed ones are noise. The impact block is the money field;
      // we expose it so the UI can sort and annotate against our inventory.
      recommendations: `
        SELECT recommendation.resource_name, recommendation.type,
          recommendation.dismissed, recommendation.campaign, recommendation.ad_group,
          recommendation.impact.base_metrics.impressions,
          recommendation.impact.base_metrics.clicks,
          recommendation.impact.base_metrics.cost_micros,
          recommendation.impact.base_metrics.conversions,
          recommendation.impact.base_metrics.all_conversions,
          recommendation.impact.base_metrics.conversions_value,
          recommendation.impact.potential_metrics.impressions,
          recommendation.impact.potential_metrics.clicks,
          recommendation.impact.potential_metrics.cost_micros,
          recommendation.impact.potential_metrics.conversions,
          recommendation.impact.potential_metrics.all_conversions,
          recommendation.impact.potential_metrics.conversions_value,
          recommendation.campaign_budget_recommendation.current_budget_amount_micros,
          recommendation.campaign_budget_recommendation.recommended_budget_amount_micros,
          recommendation.keyword_recommendation.keyword.text,
          recommendation.keyword_recommendation.keyword.match_type,
          recommendation.keyword_recommendation.recommended_cpc_bid_micros,
          recommendation.text_ad_recommendation.ad.expanded_text_ad.headline_part1,
          recommendation.text_ad_recommendation.ad.expanded_text_ad.headline_part2,
          recommendation.text_ad_recommendation.ad.expanded_text_ad.description,
          recommendation.target_cpa_opt_in_recommendation.recommended_target_cpa_micros,
          recommendation.maximize_clicks_opt_in_recommendation.recommended_budget_amount_micros,
          recommendation.maximize_conversions_opt_in_recommendation.recommended_budget_amount_micros
        FROM recommendation
        WHERE recommendation.dismissed = false`,

      // Per-URL performance — joins against Shopify handles downstream to
      // surface PDPs with high Google traffic + low CVR (= CRO opportunity).
      landingPages: `
        SELECT landing_page_view.unexpanded_final_url, campaign.id, campaign.name,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
        FROM landing_page_view
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

/* ─── GOOGLE ADS KEYWORD PLANNER ────────────────────────────────────
   KeywordPlanIdeaService.GenerateKeywordIdeas returns historical
   monthly search volume + low/high-top-of-page CPC for a list of seed
   keywords. We use Shopify product titles as seeds to find
   under-advertised demand. Rate-limited hard by Google (~100
   keywords/req, ~60 requests/min). */
app.post('/api/google-ads/keyword-ideas', async (req, res) => {
  const {
    devToken, loginCustomerId, customerId, clientId, clientSecret, refreshToken,
    seeds = [],           // array of seed keyword strings
    geoTargetIds = [],    // optional — defaults to India (2356)
    language = '1000',    // English
  } = req.body;
  if (!devToken || !customerId || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: 'missing required fields' });
  }
  if (!seeds.length) return res.json({ ideas: [] });

  const startMs = Date.now();
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const url = `${GADS_BASE}/${GADS_API_VERSION}/customers/${customerId}:generateKeywordIdeas`;
    const headers = {
      'Authorization':   `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type':    'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    // Google caps to ~20 seeds per call. Chunk, cap at ~10 chunks to
    // avoid rate-limit bans on a free dev token.
    const geos = (geoTargetIds.length ? geoTargetIds : ['2356']).map(id => `geoTargetConstants/${id}`);
    const languageResource = `languageConstants/${language}`;
    const chunks = [];
    for (let i = 0; i < seeds.length && chunks.length < 10; i += 20) {
      chunks.push(seeds.slice(i, i + 20));
    }

    const byKeyword = new Map();
    for (const chunk of chunks) {
      const body = {
        geoTargetConstants: geos,
        language:           languageResource,
        includeAdultKeywords: false,
        keywordSeed: { keywords: chunk },
        keywordPlanNetwork: 'GOOGLE_SEARCH',
      };
      try {
        const r = await withRetry(() => axios.post(url, body, { headers, timeout: 30000 }));
        for (const res of (r.data.results || [])) {
          const text = res.text;
          if (!text || byKeyword.has(text)) continue;
          const m = res.keywordIdeaMetrics || {};
          byKeyword.set(text, {
            keyword:     text,
            avgMonthlySearches: Number(m.avgMonthlySearches) || 0,
            competition: m.competition || 'UNKNOWN',       // LOW | MEDIUM | HIGH
            competitionIndex: Number(m.competitionIndex) || 0,
            lowCpc:      m.lowTopOfPageBidMicros  ? Number(m.lowTopOfPageBidMicros)  / 1e6 : 0,
            highCpc:     m.highTopOfPageBidMicros ? Number(m.highTopOfPageBidMicros) / 1e6 : 0,
            monthly:     (m.monthlySearchVolumes || []).map(v => ({
              year:  Number(v.year), month: v.month, searches: Number(v.monthlySearches) || 0,
            })),
          });
        }
      } catch (e) {
        console.warn('[keyword-ideas] chunk failed:', e.response?.data?.error?.message || e.message);
      }
      // Polite pause between chunks
      await new Promise(r => setTimeout(r, 400));
    }
    res.json({ ideas: [...byKeyword.values()], fetchMs: Date.now() - startMs });
  } catch (err) {
    const gErr = err.response?.data?.error;
    const msg  = gErr?.details?.[0]?.errors?.[0]?.message || gErr?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/* ─── GOOGLE ADS PMAX SEARCH-TERM INSIGHTS ───────────────────────────
   campaign_search_term_insight is gated by a single campaign filter —
   so we iterate per Pmax campaign. Expensive but unavoidable. */
app.post('/api/google-ads/pmax-search-terms', async (req, res) => {
  const {
    devToken, loginCustomerId, customerId, clientId, clientSecret, refreshToken,
    campaignIds = [], datePreset = 'last_30d',
  } = req.body;
  if (!devToken || !customerId || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: 'missing required fields' });
  }
  if (!campaignIds.length) return res.json({ rows: [] });

  const during = GADS_DATE_PRESETS[datePreset] || 'LAST_30_DAYS';
  const startMs = Date.now();
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const mcc = loginCustomerId || customerId;
    const all = [];

    // Cap at 10 campaigns to protect the free dev token
    for (const cid of campaignIds.slice(0, 10)) {
      const query = `
        SELECT campaign.id, campaign.name,
          campaign_search_term_insight.category_label,
          campaign_search_term_insight.id,
          metrics.impressions, metrics.clicks,
          metrics.conversions, metrics.conversions_value
        FROM campaign_search_term_insight
        WHERE segments.date DURING ${during}
          AND campaign_search_term_insight.campaign_id = ${cid}
        ORDER BY metrics.impressions DESC
        LIMIT 500`;
      try {
        const rows = await gadsQuery({ accessToken, devToken, loginCustomerId: mcc, customerId, query });
        all.push(...rows);
      } catch (e) {
        console.warn('[pmax-search-terms]', cid, 'failed:', e.response?.data?.error?.message || e.message);
      }
    }
    res.json({ rows: all, fetchMs: Date.now() - startMs });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/* ─── GOOGLE MERCHANT CENTER REPORTS (Content API v2.1) ─────────────
   Query price competitiveness / best sellers / competitive visibility.
   Uses reports.search with a SQL-like query. */
app.post('/api/google-merchant/reports', async (req, res) => {
  const { clientId, clientSecret, refreshToken, merchantId, report, days = 30 } = req.body;
  if (!clientId || !clientSecret || !refreshToken || !merchantId) {
    return res.status(400).json({ error: 'credentials + merchantId required' });
  }
  if (!report) return res.status(400).json({ error: 'report type required (price_competitiveness | best_sellers_products | best_sellers_brands | competitive_visibility)' });

  const startMs = Date.now();
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const url = `${GMC_BASE}/${merchantId}/reports/search`;
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    let query;
    if (report === 'price_competitiveness') {
      query = `
        SELECT offer_id, id, title, brand, price.amount_micros, price.currency_code,
          benchmark_price.amount_micros, benchmark_price.currency_code,
          report_country_code, report_category_id
        FROM PriceCompetitivenessProductView
        LIMIT 1000`;
    } else if (report === 'best_sellers_products') {
      query = `
        SELECT rank, previous_rank, title, brand, category_l1, category_l2,
          relative_demand, previous_relative_demand,
          variant_gtins, google_product_category, report_country_code,
          report_date.year, report_date.month, report_date.day
        FROM BestSellersProductClusterView
        WHERE report_date.year >= 2025
        ORDER BY rank ASC
        LIMIT 200`;
    } else if (report === 'best_sellers_brands') {
      query = `
        SELECT rank, previous_rank, brand, relative_demand, previous_relative_demand,
          report_country_code, report_category_id,
          report_date.year, report_date.month, report_date.day
        FROM BestSellersBrandView
        WHERE report_date.year >= 2025
        ORDER BY rank ASC
        LIMIT 200`;
    } else if (report === 'competitive_visibility') {
      query = `
        SELECT domain, rank, ads_organic_ratio, page_overlap_rate, higher_position_rate,
          report_country_code, report_category_id,
          date.year, date.month, date.day
        FROM CompetitiveVisibilityCompetitorView
        WHERE date.year >= 2025
        ORDER BY rank ASC
        LIMIT 100`;
    } else {
      return res.status(400).json({ error: 'unknown report type' });
    }

    const all = [];
    let pageToken;
    for (let page = 0; page < 20; page++) {
      const body = { query, pageSize: 500 };
      if (pageToken) body.pageToken = pageToken;
      try {
        const r = await withRetry(() => axios.post(url, body, { headers, timeout: 45000 }));
        if (r.data.results?.length) all.push(...r.data.results);
        pageToken = r.data.nextPageToken;
        if (!pageToken) break;
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        // Report not available for this merchant (common — many merchants
        // don't meet the 1000-click threshold for best-sellers, etc.)
        return res.status(e.response?.status || 500).json({ error: msg, report });
      }
    }
    res.json({ rows: all, report, fetchMs: Date.now() - startMs });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const scopeHint = /insufficient|scope|unauthorized/i.test(msg) ? ' — re-authorize with `content` scope.' : '';
    res.status(err.response?.status || 500).json({ error: msg + scopeHint });
  }
});

/* ─── GOOGLE MERCHANT CENTER (Content API v2.1) ─────────────────────
   GMC feeds power Shopping / Performance Max campaigns. The Google Ads
   `shopping_performance_view` only tells us *which item_ids spent how
   much*; GMC tells us *the whole picture* — approval status, per-SKU
   disapprovals, price/availability Google actually has on file, which
   is the gap we need to diagnose feed-level revenue leaks.
   ──────────────────────────────────────────────────────────────────── */

const GMC_BASE = 'https://shoppingcontent.googleapis.com/content/v2.1';

async function gmcListAll({ accessToken, merchantId, resource, params = {} }) {
  const all = [];
  let pageToken;
  for (let page = 0; page < 100; page++) {
    const qs = new URLSearchParams({ maxResults: '250', ...params });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `${GMC_BASE}/${merchantId}/${resource}?${qs.toString()}`;
    const r = await withRetry(() => axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 60000,
    }));
    if (r.data.resources?.length) all.push(...r.data.resources);
    pageToken = r.data.nextPageToken;
    if (!pageToken) break;
  }
  return all;
}

// POST /api/google-merchant/verify — confirms credentials + scope, returns account info
app.post('/api/google-merchant/verify', async (req, res) => {
  const { clientId, clientSecret, refreshToken, merchantId } = req.body;
  if (!clientId || !clientSecret || !refreshToken || !merchantId) {
    return res.status(400).json({ ok: false, error: 'clientId, clientSecret, refreshToken, merchantId required' });
  }
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    // accounts.authinfo — user must have content scope AND access to this merchantId
    const authInfo = await axios.get(`${GMC_BASE}/accounts/authinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });
    const accountIds = (authInfo.data?.accountIdentifiers || []).map(a => a.merchantId || a.aggregatorId);
    const hasAccess = accountIds.some(id => String(id) === String(merchantId));
    // Pull account details for the merchant
    let accountName;
    try {
      const acct = await axios.get(`${GMC_BASE}/${merchantId}/accounts/${merchantId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });
      accountName = acct.data?.name;
    } catch { /* non-aggregator accounts can't query sub-account — fine */ }
    res.json({ ok: true, hasAccess, accountIds, accountName });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const status = err.response?.status || 500;
    // Scope missing is the common "works but fails" case — surface it plainly
    const scopeHint = /insufficient|scope|unauthorized/i.test(msg)
      ? ' — re-authorize with the `content` scope. The current refresh token only has `adwords`.'
      : '';
    res.status(status).json({ ok: false, error: msg + scopeHint });
  }
});

// POST /api/google-merchant/pull — products + product statuses for a single merchant
app.post('/api/google-merchant/pull', async (req, res) => {
  const { clientId, clientSecret, refreshToken, merchantId } = req.body;
  if (!clientId || !clientSecret || !refreshToken || !merchantId) {
    return res.status(400).json({ error: 'clientId, clientSecret, refreshToken, merchantId required' });
  }
  const startMs = Date.now();
  try {
    const accessToken = await getGadsAccessToken(clientId, clientSecret, refreshToken);
    const [products, productStatuses] = await Promise.all([
      gmcListAll({ accessToken, merchantId, resource: 'products' }),
      gmcListAll({ accessToken, merchantId, resource: 'productstatuses', params: { destinations: 'Shopping' } }),
    ]);
    res.json({ products, productStatuses, fetchMs: Date.now() - startMs });
  } catch (err) {
    const gErr = err.response?.data?.error;
    const msg  = gErr?.message || err.message;
    const scopeHint = /insufficient|scope|unauthorized/i.test(msg)
      ? ' — re-authorize with the `content` scope.'
      : '';
    res.status(err.response?.status || 500).json({ error: msg + scopeHint });
  }
});

/* ─── GOOGLE DRIVE PULL (public folder + API key) ──────────────────
   Pull daily UTM / marketing reports from a Drive folder shared
   publicly via link. User provides:
     - apiKey   : Google Cloud API key with Drive API enabled
     - folderId : the share-link folder ID

   The folder must be accessible to "anyone with the link" — that's
   what lets a plain API key read it (no OAuth needed). Each brand
   gets its own sub-folder so reports stay cleanly separated. */

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

// POST /api/drive/list — list CSV files in a folder
app.post('/api/drive/list', async (req, res) => {
  const { apiKey, folderId } = req.body;
  if (!apiKey || !folderId) return res.status(400).json({ error: 'apiKey and folderId required' });
  try {
    const q = `'${folderId}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      key: apiKey,
      fields: 'files(id,name,mimeType,size,createdTime,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const r = await axios.get(`${DRIVE_BASE}/files?${params.toString()}`, { timeout: 20000 });
    const files = (r.data.files || []).filter(f =>
      (f.mimeType || '').includes('csv')
      || (f.name || '').toLowerCase().endsWith('.csv')
    );
    res.json({ files });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const status = err.response?.status || 500;
    res.status(status).json({ error: msg });
  }
});

// POST /api/drive/download — fetch a file's contents by id
app.post('/api/drive/download', async (req, res) => {
  const { apiKey, fileId } = req.body;
  if (!apiKey || !fileId) return res.status(400).json({ error: 'apiKey and fileId required' });
  try {
    const url = `${DRIVE_BASE}/files/${fileId}?alt=media&key=${apiKey}`;
    const r = await axios.get(url, { timeout: 60000, responseType: 'text', transformResponse: [v => v] });
    res.type('text/plain').send(r.data);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.statusText || err.message;
    const status = err.response?.status || 500;
    res.status(status).json({ error: msg });
  }
});

/* ─── MICROSOFT CLARITY (Data Export API) ──────────────────────────
   Clarity gives us behavioral "why" data (rage clicks, dead clicks,
   quick-backs, scroll depth) that pairs with our "what" data (Google
   clicks, Shopify conversions) to diagnose PDP issues.

   The API has hard limits: 10 requests/project/day, max 3 days of
   data per request, max 3 dimensions per request. So one logical
   "pull" = 5 carefully-chosen dimension slices = 5 calls, leaving
   budget for a prior-period comparison.

   Token is project-scoped: user generates it in Clarity → Settings
   → Data Export. We accept it as-is and pass through. */

const CLARITY_BASE = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

async function clarityCall({ apiToken, numOfDays = 3, dimensions = [] }) {
  const params = new URLSearchParams({ numOfDays: String(numOfDays) });
  dimensions.slice(0, 3).forEach((d, i) => params.set(`dimension${i + 1}`, d));
  const url = `${CLARITY_BASE}?${params.toString()}`;
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
    timeout: 30000,
  });
  return r.data; // array of metric blocks
}

// POST /api/clarity/verify — confirms the API token + project access
app.post('/api/clarity/verify', async (req, res) => {
  const { apiToken } = req.body;
  if (!apiToken) return res.status(400).json({ ok: false, error: 'apiToken required' });
  try {
    const rows = await clarityCall({ apiToken, numOfDays: 1, dimensions: ['OS'] });
    // Rows may be empty if the project has no traffic in the window, but a
    // non-auth error means the token is valid.
    res.json({ ok: true, sampleRows: (rows?.[0]?.information?.length ?? 0) });
  } catch (err) {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message;
    const status = err.response?.status || 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// POST /api/clarity/pull — one logical pull = 5 dimension slices in parallel
// Caller can pass `periods: ['current']` (default) or `['current','prior']`.
// Prior adds another 5 calls — uses the full 10/day budget. We warn the
// client so it can rate-limit or rotate with caching.
app.post('/api/clarity/pull', async (req, res) => {
  const { apiToken, period = 'current' } = req.body;
  if (!apiToken) return res.status(400).json({ error: 'apiToken required' });

  // numOfDays is 1-3 for current; prior is "days 4-6 ago" — but the Clarity
  // API only exposes the most recent 3 days. So the client must cache daily
  // to build comparative history. We expose the slice set and caller stamps
  // the period into the returned record.
  const numOfDays = period === 'current' ? 3 : 3;

  // Five slices chosen to give the broadest coverage within 10-call quota:
  //   url          — per-page behavior (rage, dead, scroll)
  //   url+device   — PDP behavior split mobile vs desktop (the usual diff)
  //   channel      — which traffic source has the worst behavior
  //   country      — geo-level behavioral splits
  //   device+browser — tech stack CRO issues
  const slices = [
    { key: 'url',         dimensions: ['URL'] },
    { key: 'urlDevice',   dimensions: ['URL', 'Device'] },
    { key: 'channel',     dimensions: ['Channel'] },
    { key: 'country',     dimensions: ['Country'] },
    { key: 'deviceBrowser', dimensions: ['Device', 'Browser'] },
  ];

  const startMs = Date.now();
  const results = {};
  const errors = {};
  await Promise.all(slices.map(async s => {
    try {
      const data = await clarityCall({ apiToken, numOfDays, dimensions: s.dimensions });
      results[s.key] = data;
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message;
      errors[s.key] = msg;
      results[s.key] = [];
    }
  }));

  res.json({
    period,
    numOfDays,
    pulledAt: Date.now(),
    ...results,
    errors,
    fetchMs: Date.now() - startMs,
  });
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

/* ─── RETENTION: SUPPRESSION REGISTRY + LISTMONK WEBHOOK ─────────────
   File-backed suppression store. Emails that land here must never receive
   a marketing send, regardless of what the client-side planner decides.
   We persist to ./data/suppression.json (one line per record in NDJSON so
   appends are atomic and rebuilds don't rewrite the whole file). The client
   syncs on each planner run via GET /api/retention/suppression.

   The Listmonk webhook ingests three event types:
     - "bounced"    → reason 'bounce_hard' (permanent) or 'bounce_soft_3x'
     - "complained" → reason 'complaint'
     - "unsubscribed" → reason 'unsubscribed'
   Each translates into a suppression record scoped by brand_id. The brand
   is inferred from the Listmonk list prefix (`brand_{id}_{opp}`) or from a
   custom attribute on the subscriber — configured per deployment.
   ──────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const DATA_DIR = path.join(__dirname, 'data');
const SUPP_FILE = path.join(DATA_DIR, 'suppression.ndjson');

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
function suppressionRead() {
  ensureDataDir();
  try {
    if (!fs.existsSync(SUPP_FILE)) return [];
    const lines = fs.readFileSync(SUPP_FILE, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (const l of lines) {
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out;
  } catch { return []; }
}
function suppressionAppend(records) {
  ensureDataDir();
  const existing = new Map();
  for (const r of suppressionRead()) existing.set(r.id, r);
  let added = 0;
  for (const r of records) {
    if (!r?.brand_id || !r?.email) continue;
    r.id = `${r.brand_id}|${String(r.email).toLowerCase().trim()}`;
    r.email = String(r.email).toLowerCase().trim();
    r.added_at ||= Date.now();
    existing.set(r.id, r);
    added++;
  }
  const body = Array.from(existing.values()).map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(SUPP_FILE, body);
  return { added, total: existing.size };
}

/* ─── MANUAL LABELS / NOTES REGISTRY ────────────────────────────────
   Per-ad Notes + Collection + Override fields edited in Boards /
   Setup / Procurement / Star Products. Previously localStorage-only,
   so every browser had its own stale copy. Now server-persisted so
   a change by one operator shows up for everyone on reload / focus.

   Shape on disk: { [adId]: { Notes: '...', Collection: '...', ... } }
   Keys are whatever field names the client writes. Server is dumb —
   it just stores the map and returns it. The client merges on boot. */
const MANUAL_FILE = path.join(DATA_DIR, 'manual.json');

function manualRead() {
  ensureDataDir();
  try {
    if (!fs.existsSync(MANUAL_FILE)) return { map: {}, updatedAt: 0 };
    const raw = fs.readFileSync(MANUAL_FILE, 'utf8');
    const data = JSON.parse(raw);
    // Tolerate both old flat shape and the new wrapped shape
    if (data?.map) return { map: data.map, updatedAt: data.updatedAt || 0 };
    return { map: data || {}, updatedAt: 0 };
  } catch { return { map: {}, updatedAt: 0 }; }
}

function manualWriteAtomic(newMap) {
  ensureDataDir();
  const body = JSON.stringify({ map: newMap, updatedAt: Date.now() });
  const tmp  = MANUAL_FILE + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, MANUAL_FILE); // atomic replace prevents readers seeing a half-written file
}

// GET /api/manual — returns the full map so the client can merge on boot + on focus
app.get('/api/manual', (_req, res) => {
  const { map, updatedAt } = manualRead();
  res.json({ map, updatedAt });
});

// POST /api/manual — body: { updates: { [adId]: { fields } }, removals?: [adId] }
// Shallow-merges per-ad, deletes listed adIds.
app.post('/api/manual', (req, res) => {
  const { updates = {}, removals = [] } = req.body || {};
  const { map } = manualRead();
  for (const [adId, fields] of Object.entries(updates)) {
    if (!adId) continue;
    map[adId] = { ...(map[adId] || {}), ...(fields || {}) };
  }
  for (const adId of removals) {
    if (adId && map[adId]) delete map[adId];
  }
  manualWriteAtomic(map);
  res.json({ ok: true, total: Object.keys(map).length, updatedAt: Date.now() });
});

app.get('/api/retention/suppression', (req, res) => {
  const brand_id = req.query.brand_id || null;
  const rows = suppressionRead();
  res.json({ rows: brand_id ? rows.filter(r => r.brand_id === brand_id) : rows });
});

app.post('/api/retention/suppression', (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records[] required' });
  const r = suppressionAppend(records);
  res.json({ ok: true, ...r });
});

app.delete('/api/retention/suppression', (req, res) => {
  const { brand_id, email } = req.body || {};
  if (!brand_id || !email) return res.status(400).json({ error: 'brand_id + email required' });
  const id = `${brand_id}|${String(email).toLowerCase().trim()}`;
  const rows = suppressionRead().filter(r => r.id !== id);
  ensureDataDir();
  fs.writeFileSync(SUPP_FILE, rows.map(JSON.stringify).join('\n') + (rows.length ? '\n' : ''));
  res.json({ ok: true, total: rows.length });
});

// Listmonk webhook: POST body includes { event, subscriber: {email, attribs}, ... }
// We extract email + brand_id (from attribs.brand_id if set, else from query) and
// translate the event type into a suppression reason. Listmonk can be configured
// to hit this endpoint via `Settings → Webhooks` or via the webhook bundled in
// the email footer (for unsubscribe links that round-trip a POST).
app.post('/api/retention/webhook/listmonk', (req, res) => {
  try {
    const body = req.body || {};
    const event = String(body.event || body.type || '').toLowerCase();
    const sub   = body.subscriber || body.data || {};
    const email = String(sub.email || body.email || '').toLowerCase().trim();
    const brand_id = sub.attribs?.brand_id || body.brand_id || req.query.brand_id || 'default';
    if (!email) return res.status(400).json({ error: 'email missing' });
    const reasonMap = {
      bounced:       'bounce_hard',
      bounce:        'bounce_hard',
      complained:    'complaint',
      complaint:     'complaint',
      unsubscribed:  'unsubscribed',
      unsubscribe:   'unsubscribed',
    };
    const reason = reasonMap[event] || 'manual';
    suppressionAppend([{
      brand_id, email, reason,
      notes: `via listmonk webhook (event=${event})`,
      added_by: 'webhook:listmonk',
      channel: event === 'complained' || event === 'bounced' ? 'all' : 'email',
      added_at: Date.now(),
    }]);
    res.json({ ok: true, reason });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
