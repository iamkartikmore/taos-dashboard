import { normalizeInsight } from './analytics';

const META_BASE = 'https://graph.facebook.com';

/* ─── PROXY FETCHER ──────────────────────────────────────────────── */

async function proxyGet(url, params = {}) {
  const res = await fetch('/api/meta/fetch', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json.error) || 'Meta API error');
  return json;
}

/* ─── PAGINATED FETCHER ──────────────────────────────────────────── */

async function fetchAllPages(baseUrl, params, maxPages = 10, onProgress) {
  let url = baseUrl;
  let pageParams = { ...params };
  const out = [];
  let page = 0;

  while (url && page < maxPages) {
    const json = await proxyGet(url, page === 0 ? pageParams : {});
    if (json.data?.length) out.push(...json.data);
    url = json.paging?.next || '';
    page++;
    onProgress?.(`page ${page}`);
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

function actId(id) {
  const s = String(id || '').trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

/* ─── FETCH FUNCTIONS ────────────────────────────────────────────── */

export async function fetchInsights(ver, token, accountId, datePreset, onProgress) {
  const act = actId(accountId);
  const raw = await fetchAllPages(
    `${META_BASE}/${ver}/${act}/insights`,
    {
      access_token: token,
      level: 'ad',
      fields: [
        'account_id','account_name',
        'campaign_id','campaign_name',
        'adset_id','adset_name',
        'ad_id','ad_name',
        'date_start','date_stop',
        'spend','impressions','reach','frequency',
        'clicks','unique_clicks','ctr','unique_ctr','cpc','cpm','cpp',
        'outbound_clicks','inline_link_clicks','unique_inline_link_clicks','inline_post_engagement',
        'actions','action_values','cost_per_action_type','purchase_roas',
        'video_play_actions',
        'video_p25_watched_actions',
        'video_p50_watched_actions',
        'video_p75_watched_actions',
        'video_p95_watched_actions',
        'video_p100_watched_actions',
        'video_avg_time_watched_actions',
        'video_thruplay_watched_actions',
        'quality_ranking',
        'engagement_rate_ranking',
        'conversion_rate_ranking',
      ].join(','),
      date_preset: datePreset,
      limit: 500,
      action_report_time: 'mixed',
      action_attribution_windows: "['7d_click','1d_view']",
    },
    10,
    onProgress,
  );
  return raw;
}

export async function fetchAds(ver, token, accountId) {
  const act = actId(accountId);
  return fetchAllPages(`${META_BASE}/${ver}/${act}/ads`, {
    access_token: token,
    fields: 'id,name,adset_id,campaign_id,status,effective_status',
    limit: 500,
  });
}

export async function fetchAdsets(ver, token, accountId) {
  const act = actId(accountId);
  return fetchAllPages(`${META_BASE}/${ver}/${act}/adsets`, {
    access_token: token,
    fields: 'id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status',
    limit: 500,
  });
}

export async function fetchCampaigns(ver, token, accountId) {
  const act = actId(accountId);
  return fetchAllPages(`${META_BASE}/${ver}/${act}/campaigns`, {
    access_token: token,
    fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
    limit: 500,
  });
}

/* ─── FULL ACCOUNT PULL ──────────────────────────────────────────── */

export async function pullAccount({ ver, token, accountKey, accountId }, onProgress) {
  const log = msg => onProgress?.(`[${accountKey}] ${msg}`);

  log('fetching campaigns...');
  const campaigns = await fetchCampaigns(ver, token, accountId);
  log(`${campaigns.length} campaigns`);

  log('fetching adsets...');
  const adsets = await fetchAdsets(ver, token, accountId);
  log(`${adsets.length} adsets`);

  log('fetching ads...');
  const ads = await fetchAds(ver, token, accountId);
  log(`${ads.length} ads`);

  log('fetching Today insights...');
  const rawToday = await fetchInsights(ver, token, accountId, 'today', log);
  const insightsToday = rawToday.map(r => normalizeInsight(r, accountKey, 'Today'));
  log(`${insightsToday.length} insight rows (Today)`);

  log('fetching 7D insights...');
  const raw7d = await fetchInsights(ver, token, accountId, 'last_7d', log);
  const insights7d = raw7d.map(r => normalizeInsight(r, accountKey, '7D'));
  log(`${insights7d.length} insight rows (7D)`);

  log('fetching 14D insights...');
  const raw14d = await fetchInsights(ver, token, accountId, 'last_14d', log);
  const insights14d = raw14d.map(r => normalizeInsight(r, accountKey, '14D'));
  log(`${insights14d.length} insight rows (14D)`);

  log('fetching 30D insights...');
  const raw30d = await fetchInsights(ver, token, accountId, 'last_30d', log);
  const insights30d = raw30d.map(r => normalizeInsight(r, accountKey, '30D'));
  log(`${insights30d.length} insight rows (30D)`);

  return { accountKey, accountId, campaigns, adsets, ads, insightsToday, insights7d, insights14d, insights30d };
}

/* ─── SHOPIFY INVENTORY ──────────────────────────────────────────── */

export async function fetchShopifyInventory(shop, clientId, clientSecret) {
  const res = await fetch('/api/shopify/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, clientId, clientSecret }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Shopify API error');

  // Build SKU → { title, stock, price, productType } map
  // Use _totalStock (multi-location sum) if server fetched it, else inventory_quantity
  const map = {};
  for (const p of json.products || []) {
    for (const v of p.variants || []) {
      const sku = (v.sku || '').trim().toUpperCase();
      if (!sku) continue;
      const stock = v._totalStock !== undefined
        ? v._totalStock
        : (parseInt(v.inventory_quantity) || 0);
      if (map[sku]) {
        // Multiple variants share a SKU — sum stock
        map[sku].stock += stock;
      } else {
        map[sku] = {
          title:       p.title || '',
          stock,
          price:       parseFloat(v.price) || 0,
          productType: p.product_type || '',
        };
      }
    }
  }
  return map;
}

/* ─── SHOPIFY ORDERS — SSE streaming (real-time page-by-page logs) ─ */

export async function fetchShopifyOrders(shop, clientId, clientSecret, since, until, onLog) {
  const res = await fetch('/api/shopify/orders/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, clientId, clientSecret, since, until }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const accOrders = [];  // accumulate batch events — avoids one giant SSE payload

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by double newlines
    const events = buffer.split('\n\n');
    buffer = events.pop(); // last chunk may be incomplete
    for (const event of events) {
      const dataLine = event.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine.slice(6));
        if (data.type === 'log' || data.type === 'page') {
          onLog?.(data.msg);
        } else if (data.type === 'batch') {
          // Small batch of orders (50 at a time) — accumulate
          accOrders.push(...(data.orders || []));
        } else if (data.type === 'error') {
          throw new Error(data.msg);
        } else if (data.type === 'done') {
          // done only carries stats — orders already accumulated via batch events
          result = { ...data, orders: accOrders };
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }

  if (!result) throw new Error('Stream ended without completion signal');
  return { orders: result.orders, count: result.count || accOrders.length, pages: result.pages || 1, fetchMs: result.fetchMs || 0 };
}

/* ─── VERIFY TOKEN ───────────────────────────────────────────────── */

export async function verifyToken(token, ver = 'v21.0') {
  const json = await proxyGet(`${META_BASE}/${ver}/me`, {
    access_token: token,
    fields: 'id,name',
  });
  return json;
}
