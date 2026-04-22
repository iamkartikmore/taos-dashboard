import { normalizeInsight } from './analytics';

const META_BASE = 'https://graph.facebook.com';

/* ─── PROXY FETCHER ──────────────────────────────────────────────── */

// Retries on transient network failures (server restarts, cold starts, brief 502/5xx/429).
// Backoff: 2s, 6s — lets Render bring the instance back up after an OOM restart.
async function proxyGet(url, params = {}, endpoint = '/api/meta/fetch') {
  const BACKOFFS = [0, 2000, 6000];
  let lastErr;
  for (const wait of BACKOFFS) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    let res;
    try {
      res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, params }),
      });
    } catch (e) {
      // TypeError: Failed to fetch → server unreachable. Retry.
      if (e.name === 'TypeError' || /fetch/i.test(e.message)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
    if (res.status >= 500 || res.status === 429) {
      lastErr = new Error(`Meta proxy HTTP ${res.status}`);
      continue;
    }
    let json;
    try { json = await res.json(); }
    catch { throw new Error(`Meta proxy returned non-JSON (HTTP ${res.status})`); }
    if (!res.ok) {
      const e = json?.error;
      const msg = (typeof e === 'string' && e) ||
                  e?.message ||
                  (e && JSON.stringify(e)) ||
                  `Meta proxy HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }
  throw lastErr || new Error('Meta proxy unreachable');
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
    if (json.data?.length) { for (const row of json.data) out.push(row); }
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
    for (const row of rows) all.push(row);
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

  // Phase 1: structural (small payloads, safe to parallelise)
  log('fetching structure...');
  const [campaigns, adsets, ads] = await Promise.all([
    fetchCampaigns(ver, token, accountId).then(r => { log(`${r.length} campaigns`); return r; }),
    fetchAdsets(ver, token, accountId).then(r  => { log(`${r.length} adsets`);    return r; }),
    fetchAds(ver, token, accountId).then(r     => { log(`${r.length} ads`);       return r; }),
  ]);

  // Phase 2: insights (big payloads) — run sequentially so Render memory stays flat
  log('fetching insight windows sequentially...');
  const rawToday     = await fetchInsights(ver, token, accountId, 'today',     msg => log(`Today ${msg}`));
  const rawYesterday = await fetchInsights(ver, token, accountId, 'yesterday', msg => log(`Yesterday ${msg}`));
  const raw3d        = await fetchInsights(ver, token, accountId, 'last_3d',   msg => log(`3D ${msg}`));
  const raw7d        = await fetchInsights(ver, token, accountId, 'last_7d',   msg => log(`7D ${msg}`));
  const raw14d       = await fetchInsights(ver, token, accountId, 'last_14d',  msg => log(`14D ${msg}`));
  const raw30d       = await fetchInsights(ver, token, accountId, 'last_30d',  msg => log(`30D ${msg}`));

  const insightsToday     = rawToday.map(r     => normalizeInsight(r, accountKey, 'Today'));
  const insightsYesterday = rawYesterday.map(r => normalizeInsight(r, accountKey, 'Yesterday'));
  const insights3d        = raw3d.map(r        => normalizeInsight(r, accountKey, '3D'));
  const insights7d        = raw7d.map(r        => normalizeInsight(r, accountKey, '7D'));
  const insights14d       = raw14d.map(r       => normalizeInsight(r, accountKey, '14D'));
  const insights30d       = raw30d.map(r       => normalizeInsight(r, accountKey, '30D'));

  log(`✓ Done — Today:${insightsToday.length} Yd:${insightsYesterday.length} 3D:${insights3d.length} 7D:${insights7d.length} 14D:${insights14d.length} 30D:${insights30d.length}`);
  return { accountKey, accountId, campaigns, adsets, ads, insightsToday, insightsYesterday, insights3d, insights7d, insights14d, insights30d };
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

  return {
    map:         json.map         || {},
    locations:   json.locations   || [],
    skuToItemId: json.skuToItemId || {},
    collections: json.collections || [],
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
          if (data.orders?.length) { for (const o of data.orders) accOrders.push(o); }
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

/* ─── GOOGLE ADS ─────────────────────────────────────────────────── */

export async function verifyGoogleAds(creds) {
  const res = await fetch('/api/google-ads/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Google Ads credential verification failed');
  return json; // { ok, name, currency, timeZone }
}

export async function fetchGoogleAds(creds, datePreset = 'last_30d', onProgress) {
  onProgress?.(`Pulling Google Ads (${datePreset})...`);
  const res = await fetch('/api/google-ads/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds, datePreset }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Google Ads API error');
  onProgress?.(`✓ Google Ads — campaigns:${json.campaigns?.length || 0} adgroups:${json.adGroups?.length || 0} ads:${json.ads?.length || 0} keywords:${json.keywords?.length || 0}`);
  return json;
}

/* ─── GOOGLE MERCHANT CENTER ─────────────────────────────────────── */

export async function verifyMerchant(creds) {
  const res = await fetch('/api/google-merchant/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'Merchant Center verification failed');
  return json;
}

export async function fetchMerchant(creds, onProgress) {
  onProgress?.('Pulling Merchant Center feed...');
  const res = await fetch('/api/google-merchant/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Merchant Center API error');
  onProgress?.(`✓ Merchant — products:${json.products?.length || 0} statuses:${json.productStatuses?.length || 0}`);
  return json;
}

/* ─── LISTMONK ───────────────────────────────────────────────────── */

async function listmonkCall(path, creds, body) {
  const res = await fetch(`/api/listmonk${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds, ...(body || {}) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Listmonk ${path} failed (${res.status})`);
  return json;
}

export async function verifyListmonk(creds) {
  return listmonkCall('/verify', creds);  // { ok, version, lists: [{id,name,count}] }
}

export async function fetchListmonkCampaigns(creds) {
  return listmonkCall('/campaigns', creds);  // { campaigns: [...] }
}

export async function fetchListmonkCampaign(creds, id) {
  return listmonkCall('/campaign', creds, { id });  // { campaign: {...} }
}

export async function fetchListmonkAnalytics(creds, { type = 'views', campaignIds = [], from, to }) {
  return listmonkCall('/analytics', creds, { type, campaignIds, from, to });  // { series: [...] }
}

export async function fetchListmonkLists(creds) {
  return listmonkCall('/lists', creds);  // { lists: [...] }
}

export async function fetchListmonkTemplates(creds) {
  return listmonkCall('/templates', creds);  // { templates: [...] }
}

export async function sendListmonkCampaign(creds, payload) {
  // payload: { name, subject, fromEmail, listIds:[], body, contentType:'html'|'richtext', templateId?, sendAt?, startNow? }
  return listmonkCall('/send', creds, payload);  // { campaign: {id, status, ...} }
}

export async function ensureListmonkLists(creds, segmentNames, prefix = 'TAOS') {
  return listmonkCall('/ensure-lists', creds, { segmentNames, prefix });  // { lists: {segment: id} }
}

export async function importListmonkSubscribers(creds, listId, customers) {
  return listmonkCall('/import-subscribers', creds, { listId, customers });
}

export async function fetchListmonkImportStatus(creds) {
  return listmonkCall('/import-status', creds);
}

export async function fetchListmonkImportLogs(creds) {
  return listmonkCall('/import-logs', creds);  // { logs: "..." }
}

export async function stopListmonkImport(creds) {
  return listmonkCall('/import-stop', creds);  // { ok, status }
}

export async function upsertListmonkTemplate(creds, { name, subject, body, type = 'campaign' }) {
  return listmonkCall('/template-upsert', creds, { name, subject, body, type });
}

export async function deleteListmonkTemplate(creds, id) {
  return listmonkCall('/template-delete', creds, { id });
}

export async function createListmonkCampaignDraft(creds, payload) {
  // payload: { name, subject, fromEmail, listIds, templateId, body?, tags? }
  return listmonkCall('/campaign-draft', creds, payload);
}

export async function fetchListmonkCampaignStats(creds, id) {
  return listmonkCall('/campaign-stats', creds, { id });
}

/* ─── VERIFY TOKEN ───────────────────────────────────────────────── */

export async function verifyToken(token, ver = 'v21.0') {
  return proxyGet(`${META_BASE}/${ver}/me`, { access_token: token, fields: 'id,name' });
}
