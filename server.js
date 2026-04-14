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

    // Fetch inventory levels in batches of 50 (API limit)
    const itemIds = Object.keys(variantMap);
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
              // Sum across all locations
              v._totalStock = (v._totalStock || 0) + (lvl.available || 0);
            }
          });
        } catch (_) {
          // Inventory Levels API failed — fall back to variant.inventory_quantity
        }
      }
    }

    res.json({ products: allProducts });
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
    // Only fetch fields actually used in analytics — skip bulky unused ones
    // (shipping_lines, note_attributes, tags, subtotal_price, total_tax, etc.)
    const fields = [
      'id','created_at','cancelled_at','cancel_reason',
      'email',                                   // order-level email — present even for guest checkouts
      'total_price','total_discounts','total_shipping_price_set',
      'customer','line_items','discount_codes',
      'billing_address','shipping_address',
      'source_name','referring_site','landing_site',
      'payment_gateway','payment_gateway_names',
      'refunds','fulfillments','note_attributes',
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
