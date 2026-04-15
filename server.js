const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Meta Graph API proxy — avoids browser CORS restrictions
app.post('/api/meta/fetch', async (req, res) => {
  const { url, params } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const response = await axios.get(url, { params, timeout: 30000 });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  }
});

// Shopify inventory proxy — fetches all active products with stock levels
// Uses client_credentials OAuth (DAWBU-style Custom App) to get access token first.
app.post('/api/shopify/inventory', async (req, res) => {
  const { shop, clientId, clientSecret } = req.body;
  if (!shop || !clientId || !clientSecret) return res.status(400).json({ error: 'shop, clientId and clientSecret required' });
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');

    // Step 0: Exchange client_credentials for an access token
    const tokenResp = await axios.post(
      `https://${shopDomain}.myshopify.com/admin/oauth/access_token`,
      { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
      { timeout: 15000 }
    );
    const accessToken = tokenResp.data?.access_token;
    if (!accessToken) return res.status(401).json({ error: 'Failed to obtain access token from Shopify' });

    const headers = { 'X-Shopify-Access-Token': accessToken };
    const allProducts = [];

    // Step 1: Pull all products (variants include inventory_quantity for single-location stores)
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/products.json?limit=250&status=active`;
    while (url) {
      const resp = await axios.get(url, { headers, timeout: 30000 });
      allProducts.push(...(resp.data.products || []));
      const link = resp.headers['link'] || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }

    // Step 2: For multi-location stores, inventory_quantity may be stale.
    // Fetch inventory levels via the Inventory Levels API for accuracy.
    // Collect all variant inventory_item_ids first.
    const variantMap = {}; // inventory_item_id → variant
    allProducts.forEach(p => {
      (p.variants || []).forEach(v => {
        if (v.inventory_item_id) variantMap[v.inventory_item_id] = v;
      });
    });

    // Step 2a: Fetch all locations (warehouses)
    let locations = [];
    try {
      const locResp = await axios.get(
        `https://${shopDomain}.myshopify.com/admin/api/2024-01/locations.json`,
        { headers, timeout: 15000 }
      );
      locations = (locResp.data.locations || []).filter(l => l.active);
    } catch (_) {}

    // Step 2b: Fetch inventory levels in batches of 50 — collect per-location
    const itemIds = Object.keys(variantMap);
    // inventoryByLocation: { [locationId]: { [inventoryItemId]: available } }
    const inventoryByLocation = {};
    // Also sum across all locations for total stock
    if (itemIds.length > 0) {
      for (let i = 0; i < itemIds.length; i += 50) {
        const batch = itemIds.slice(i, i + 50).join(',');
        try {
          const lvlResp = await axios.get(
            `https://${shopDomain}.myshopify.com/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${batch}&limit=250`,
            { headers, timeout: 30000 }
          );
          (lvlResp.data.inventory_levels || []).forEach(lvl => {
            const v = variantMap[lvl.inventory_item_id];
            if (v) {
              v._totalStock = (v._totalStock || 0) + (lvl.available || 0);
              const locId = String(lvl.location_id);
              if (!inventoryByLocation[locId]) inventoryByLocation[locId] = {};
              inventoryByLocation[locId][String(lvl.inventory_item_id)] = lvl.available || 0;
            }
          });
        } catch (_) {}
      }
    }

    // Build SKU → inventoryItemId map for client-side cross-reference
    const skuToItemId = {};
    allProducts.forEach(p => {
      (p.variants || []).forEach(v => {
        const sku = (v.sku || '').trim().toUpperCase();
        if (sku && v.inventory_item_id) skuToItemId[sku] = String(v.inventory_item_id);
      });
    });

    res.json({ products: allProducts, locations, inventoryByLocation, skuToItemId });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.errors || err.message });
  }
});

// Shopify orders — accepts since/until ISO strings, paginates, returns all orders
app.post('/api/shopify/orders', async (req, res) => {
  const { shop, clientId, clientSecret, since, until } = req.body;
  if (!shop || !clientId || !clientSecret) return res.status(400).json({ error: 'shop, clientId, clientSecret required' });
  const startMs = Date.now();
  try {
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
    const tokenResp = await axios.post(
      `https://${shopDomain}.myshopify.com/admin/oauth/access_token`,
      { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
      { timeout: 15000 }
    );
    const accessToken = tokenResp.data?.access_token;
    if (!accessToken) return res.status(401).json({ error: 'Failed to obtain access token' });

    const headers = { 'X-Shopify-Access-Token': accessToken };
    const fields = [
      'id','name','created_at','closed_at','cancelled_at','cancel_reason',
      'financial_status','fulfillment_status',
      'total_price','subtotal_price','total_discounts','total_tax','total_shipping_price_set',
      'customer','line_items','discount_codes','billing_address','shipping_address',
      'source_name','referring_site','landing_site','processing_method',
      'payment_gateway','payment_gateway_names',
      'refunds','tags','note_attributes',
      'fulfillments','shipping_lines',
    ].join(',');

    let qs = `limit=250&status=any&fields=${fields}`;
    if (since) qs += `&created_at_min=${since}`;
    if (until) qs += `&created_at_max=${until}`;

    const allOrders = [];
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/orders.json?${qs}`;
    let pageCount = 0;
    while (url) {
      const resp = await axios.get(url, { headers, timeout: 60000 });
      allOrders.push(...(resp.data.orders || []));
      pageCount++;
      const link = resp.headers['link'] || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      if (url) await new Promise(r => setTimeout(r, 350));
    }

    res.json({ orders: allOrders, count: allOrders.length, pages: pageCount, fetchMs: Date.now() - startMs });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.errors || err.message });
  }
});

// Shopify orders — SSE streaming version (real-time page-by-page progress)
app.post('/api/shopify/orders/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering
  res.flushHeaders();

  const emit = obj => {
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

    const tokenResp = await axios.post(
      `https://${shopDomain}.myshopify.com/admin/oauth/access_token`,
      { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
      { timeout: 15000 }
    );
    const accessToken = tokenResp.data?.access_token;
    if (!accessToken) {
      emit({ type: 'error', msg: 'Failed to obtain Shopify access token — check client_id / client_secret' });
      return res.end();
    }
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
      'tags','fulfillment_status','financial_status',  // warehouse tags + status for ops analytics
    ].join(',');

    let qs = `limit=250&status=any&fields=${fields}`;
    if (since) qs += `&created_at_min=${encodeURIComponent(since)}`;
    if (until) qs += `&created_at_max=${encodeURIComponent(until)}`;

    // Stream each page to the client as it arrives — never accumulate all orders
    // in server memory. Peak memory = one page (250 orders) at a time.
    let url = `https://${shopDomain}.myshopify.com/admin/api/2024-01/orders.json?${qs}`;
    let page = 0;
    let totalOrders = 0;

    while (url) {
      page++;
      emit({ type: 'log', msg: `Fetching page ${page}... (${totalOrders} so far)` });
      const resp = await axios.get(url, { headers, timeout: 60000 });
      const batch = resp.data.orders || [];
      totalOrders += batch.length;

      // Emit this page immediately — don't buffer
      emit({ type: 'batch', orders: batch, offset: (page - 1) * 250 });
      emit({ type: 'page', page, batchCount: batch.length, total: totalOrders,
        msg: `✓ Page ${page}: +${batch.length} orders → ${totalOrders} total` });

      const link = resp.headers['link'] || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      if (url) await new Promise(r => setTimeout(r, 350));
    }

    emit({ type: 'done', count: totalOrders, pages: page, fetchMs: Date.now() - startMs });
    emit({ type: 'log', msg: `✓ Complete — ${totalOrders} orders · ${page} pages · ${((Date.now() - startMs)/1000).toFixed(1)}s` });
  } catch (err) {
    emit({ type: 'error', msg: String(err.response?.data?.errors || err.message) });
  }
  res.end();
});

// Google Analytics 4 Data API proxy — signs JWT server-side so private key never hits the browser
app.post('/api/ga/report', async (req, res) => {
  const { serviceAccountJson, propertyId, reports, dateRange } = req.body;
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

    // Parse helper: GA returns dimension/metric headers + rows
    const parse = (report) => {
      if (!report) return [];
      const dimNames = (report.dimensionHeaders||[]).map(h=>h.name);
      const metNames = (report.metricHeaders||[]).map(h=>h.name);
      return (report.rows||[]).map(row => {
        const obj = {};
        (row.dimensionValues||[]).forEach((v,i) => { obj[dimNames[i]] = v.value; });
        (row.metricValues||[]).forEach((v,i)  => { obj[metNames[i]]  = parseFloat(v.value)||0; });
        return obj;
      });
    };

    // Run each report individually so a single invalid field doesn't kill everything
    const run = async (body) => {
      try {
        const r = await axios.post(BASE, body, { headers: HDRS, timeout: 30000 });
        return parse(r.data);
      } catch (e) {
        console.error('[GA] sub-report error:', e.response?.data?.error?.message || e.message);
        return [];
      }
    };

    // All 18 reports run in parallel — validated against GA4 Data API v1beta schema
    const [
      dailyTrend, sourceMedium, campaigns, landingPages, devices,
      geo, pages, events, items, utmDrill, browsers, userType, monthlyTrend,
      sessionHour, deviceChannel, osVersion, engagementByChannel, screenResolution,
    ] = await Promise.all([
      // 0: Daily trend
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'date'}],
        metrics:['sessions','totalUsers','newUsers','engagedSessions','bounceRate','screenPageViews','conversions','purchaseRevenue','averageSessionDuration'].map(n=>({name:n})) }),
      // 1: Source / Medium
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionSourceMedium'},{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue','bounceRate','engagementRate'].map(n=>({name:n})), limit:150 }),
      // 2: Campaign + source + medium
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionCampaignName'},{name:'sessionSource'},{name:'sessionMedium'}],
        metrics:['sessions','newUsers','conversions','purchaseRevenue','engagementRate'].map(n=>({name:n})), limit:200 }),
      // 3: Landing pages
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'landingPagePlusQueryString'}],
        metrics:['sessions','totalUsers','bounceRate','conversions','engagementRate','screenPageViews'].map(n=>({name:n})), limit:200 }),
      // 4: Device + OS
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'deviceCategory'},{name:'operatingSystem'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})) }),
      // 5: Geo — country + region + city
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'country'},{name:'region'},{name:'city'}],
        metrics:['sessions','totalUsers','conversions','purchaseRevenue'].map(n=>({name:n})), limit:200 }),
      // 6: Page performance
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'pageTitle'},{name:'fullPageUrl'}],
        metrics:['screenPageViews','averageSessionDuration','bounceRate','engagedSessions'].map(n=>({name:n})), limit:200 }),
      // 7: Events
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'eventName'}],
        metrics:['eventCount','totalUsers','conversions'].map(n=>({name:n})), limit:50 }),
      // 8: Ecommerce items
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'itemName'},{name:'itemId'},{name:'itemCategory'},{name:'itemBrand'}],
        metrics:['itemRevenue','itemsPurchased','addToCarts','checkouts'].map(n=>({name:n})), limit:200 }),
      // 9: UTM full drill
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionSource'},{name:'sessionMedium'},{name:'sessionCampaignName'},{name:'sessionManualAdContent'}],
        metrics:['sessions','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})), limit:500 }),
      // 10: Browser + device
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'browser'},{name:'deviceCategory'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:30 }),
      // 11: User type (new vs returning)
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'newVsReturning'}],
        metrics:['sessions','totalUsers','conversions','purchaseRevenue','engagementRate'].map(n=>({name:n})) }),
      // 12: Monthly trend (last 24 months)
      run({ dateRanges:[{startDate:'730daysAgo',endDate:until}], dimensions:[{name:'year'},{name:'month'}],
        metrics:['sessions','totalUsers','newUsers','conversions','purchaseRevenue'].map(n=>({name:n})) }),
      // 13: Session hour heatmap (hour of day × day of week)
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'hour'},{name:'dayOfWeek'}],
        metrics:['sessions','conversions','purchaseRevenue','engagedSessions'].map(n=>({name:n})), limit:200 }),
      // 14: Device × Channel — conversion patterns across device+channel combos
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'deviceCategory'},{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','conversions','purchaseRevenue','bounceRate','engagementRate','averageSessionDuration'].map(n=>({name:n})), limit:50 }),
      // 15: OS + OS version — mobile fragmentation
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'operatingSystem'},{name:'operatingSystemVersion'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:60 }),
      // 16: Engagement metrics per channel (session quality)
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'sessionDefaultChannelGrouping'}],
        metrics:['sessions','engagedSessions','bounceRate','averageSessionDuration','screenPageViews','conversions','purchaseRevenue'].map(n=>({name:n})), limit:20 }),
      // 17: Screen resolution (desktop/mobile viewport patterns)
      run({ dateRanges:[{startDate:since,endDate:until}], dimensions:[{name:'screenResolution'}],
        metrics:['sessions','totalUsers','conversions'].map(n=>({name:n})), limit:30 }),
    ]);

    // Normalize monthlyTrend: merge year+month into yearMonth key for downstream compat
    const monthlyTrendNorm = monthlyTrend.map(r => ({ ...r, yearMonth: `${r.year}${r.month}` }));

    res.json({
      dailyTrend, sourceMedium, campaigns, landingPages, devices, geo, pages, events, items,
      utmDrill, browsers, userType, monthlyTrend: monthlyTrendNorm,
      sessionHour, deviceChannel, osVersion, engagementByChannel, screenResolution,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status||500).json({ error: msg });
  }
});

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, 'client/dist');
  app.use(express.static(dist));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`TAOS server → http://localhost:${PORT}`));
