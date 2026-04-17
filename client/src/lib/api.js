import { normalizeInsight } from './analytics';

const META_BASE = 'https://graph.facebook.com';

/* ─── PROXY FETCHER ──────────────────────────────────────────────── */

async function proxyGet(url, params = {}, endpoint = '/api/meta/fetch') {
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url, params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json.error) || 'Meta API error');
  return json;
}

/* ─── PAGINATED FETCHER ──────────────────────────────────────────── */
// endpoint param: use /api/meta/insights-range for custom date range calls
// (longer timeout on server side)

async function fetchAllPages(baseUrl, params, maxPages = 20, onProgress, endpoint = '/api/meta/fetch') {
  let url = baseUrl;
  let pageParams = { ...params };
  const out = [];
  let page = 0;

  while (url && page < maxPages) {
    const json = await proxyGet(url, page === 0 ? pageParams : {}, endpoint);
    if (json.data?.length) out.push(...json.data);
    url = json.paging?.next || '';
    page++;
    onProgress?.(`page ${page} (${out.length} rows)`);
    if (url) await new Promise(r => setTimeout(r, 80)); // reduced from 120ms
  }
  return out;
}

function actId(id) {
  const s = String(id || '').trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

/* ─── STANDARD INSIGHTS (date presets: today, 7d, 14d, 30d) ─────── */

const INSIGHT_FIELDS = [
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
].join(',');

export async function fetchInsights(ver, token, accountId, datePreset, onProgress) {
  const act = actId(accountId);
  return fetchAllPages(
    `${META_BASE}/${ver}/${act}/insights`,
    {
      access_token: token,
      level: 'ad',
      fields: INSIGHT_FIELDS,
      date_preset: datePreset,
      limit: 500,
      action_report_time: 'mixed',
      action_attribution_windows: "['7d_click','1d_view']",
    },
    20,
    onProgress,
  );
}

/* ─── CUSTOM DATE RANGE INSIGHTS (for >30d, up to 37 months back) ── */
// Supports: since/until as 'YYYY-MM-DD' strings.
// For ranges > 180d: automatically chunks into 90-day windows fetched sequentially
// to avoid Meta timeouts and keep memory manageable.

export async function fetchInsightsCustom(ver, token, accountId, since, until, onProgress) {
  const act = actId(accountId);

  // Chunk large ranges into 90-day windows
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const CHUNK_MS = 90 * 86400000; // 90 days

  const chunks = [];
  let chunkStart = sinceMs;
  while (chunkStart < untilMs) {
    const chunkEnd = Math.min(chunkStart + CHUNK_MS, untilMs);
    chunks.push({
      since: new Date(chunkStart).toISOString().slice(0, 10),
      until: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    chunkStart = chunkEnd + 86400000; // next day after chunk end
  }

  onProgress?.(`Fetching ${chunks.length} date chunk(s) for custom range...`);
  const all = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    onProgress?.(`Chunk ${ci + 1}/${chunks.length}: ${chunk.since} → ${chunk.until}`);
    const rows = await fetchAllPages(
      `${META_BASE}/${ver}/${act}/insights`,
      {
        access_token: token,
        level: 'ad',
        fields: INSIGHT_FIELDS,
        time_range: JSON.stringify({ since: chunk.since, until: chunk.until }),
        limit: 500,
        action_report_time: 'mixed',
        action_attribution_windows: "['7d_click','1d_view']",
      },
      20,
      msg => onProgress?.(`  ${msg}`),
      '/api/meta/insights-range', // uses extended timeout endpoint
    );
    all.push(...rows);
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  return all;
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
// Parallelises Today/7D/14D/30D insight fetches for maximum speed.
// Hierarchy (campaigns/adsets/ads) is fetched in parallel too.

export async function pullAccount({ ver, token, accountKey, accountId }, onProgress) {
  const log = msg => onProgress?.(`[${accountKey}] ${msg}`);

  // Fetch structural data and all insight windows in parallel
  log('fetching structure + all insight windows in parallel...');
  const [
    campaigns, adsets, ads,
    rawToday, raw7d, raw14d, raw30d,
  ] = await Promise.all([
    fetchCampaigns(ver, token, accountId).then(r => { log(`${r.length} campaigns`); return r; }),
    fetchAdsets(ver, token, accountId).then(r => { log(`${r.length} adsets`); return r; }),
    fetchAds(ver, token, accountId).then(r => { log(`${r.length} ads`); return r; }),
    fetchInsights(ver, token, accountId, 'today',     msg => log(`Today ${msg}`)),
    fetchInsights(ver, token, accountId, 'last_7d',   msg => log(`7D ${msg}`)),
    fetchInsights(ver, token, accountId, 'last_14d',  msg => log(`14D ${msg}`)),
    fetchInsights(ver, token, accountId, 'last_30d',  msg => log(`30D ${msg}`)),
  ]);

  const insightsToday = rawToday.map(r => normalizeInsight(r, accountKey, 'Today'));
  const insights7d    = raw7d.map(r =>    normalizeInsight(r, accountKey, '7D'));
  const insights14d   = raw14d.map(r =>   normalizeInsight(r, accountKey, '14D'));
  const insights30d   = raw30d.map(r =>   normalizeInsight(r, accountKey, '30D'));

  log(`✓ Done — Today:${insightsToday.length} 7D:${insights7d.length} 14D:${insights14d.length} 30D:${insights30d.length}`);
  return { accountKey, accountId, campaigns, adsets, ads, insightsToday, insights7d, insights14d, insights30d };
}

/* ─── CUSTOM DATE RANGE FULL PULL ────────────────────────────────── */
// Like pullAccount but adds a custom window (90d, 180d, 365d, or custom dates)

export async function pullAccountWithCustomRange({ ver, token, accountKey, accountId, customSince, customUntil, customLabel }, onProgress) {
  const log = msg => onProgress?.(`[${accountKey}] ${msg}`);
  log(`fetching custom range ${customLabel || customSince + '→' + customUntil}...`);

  const rawCustom = await fetchInsightsCustom(ver, token, accountId, customSince, customUntil, log);
  const insightsCustom = rawCustom.map(r => normalizeInsight(r, accountKey, customLabel || 'Custom'));
  log(`✓ Custom range: ${insightsCustom.length} insight rows`);
  return insightsCustom;
}

/* ─── SHOPIFY INVENTORY ──────────────────────────────────────────── */

export async function fetchShopifyInventory(shop, clientId, clientSecret) {
  const res = await fetch('/api/shopify/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, clientId, clientSecret }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Shopify inventory API error');

  // Server now returns pre-built map — no client-side product processing needed
  return {
    map:                 json.map                 || {},
    locations:           json.locations           || [],
    inventoryByLocation: json.inventoryByLocation || {},
    skuToItemId:         json.skuToItemId         || {},
    collections:         json.collections         || [],
  };
}

/* ─── SHOPIFY ORDERS — SSE streaming ─────────────────────────────── */

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

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const accOrders = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();
    for (const event of events) {
      const dataLine = event.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine.slice(6));
        if (data.type === 'log' || data.type === 'page') {
          onLog?.(data.msg);
        } else if (data.type === 'batch') {
          accOrders.push(...(data.orders || []));
        } else if (data.type === 'error') {
          throw new Error(data.msg);
        } else if (data.type === 'done') {
          result = { ...data, orders: accOrders };
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }

  if (!result) throw new Error('Stream ended without completion signal');
  return {
    orders:   result.orders,
    count:    result.count    || accOrders.length,
    pages:    result.pages    || 1,
    fetchMs:  result.fetchMs  || 0,
  };
}

/* ─── GOOGLE ANALYTICS 4 ─────────────────────────────────────────── */

export async function fetchGaData(serviceAccountJson, propertyId, dateRange, onProgress) {
  onProgress?.('Connecting to Google Analytics...');
  const res = await fetch('/api/ga/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceAccountJson, propertyId, dateRange }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'GA API error');
  onProgress?.(`✓ GA data loaded — ${json.dailyTrend?.length || 0} days`);
  return json;
}

/* ─── VERIFY TOKEN ───────────────────────────────────────────────── */

export async function verifyToken(token, ver = 'v21.0') {
  return proxyGet(`${META_BASE}/${ver}/me`, { access_token: token, fields: 'id,name' });
}
