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
// Requires Shopify Admin API token with read_products + read_inventory scopes.
app.post('/api/shopify/inventory', async (req, res) => {
  const { shop, token } = req.body;
  if (!shop || !token) return res.status(400).json({ error: 'shop and token required' });
  try {
    const headers = { 'X-Shopify-Access-Token': token };
    const shopDomain = shop.replace(/\.myshopify\.com$/, '');
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
