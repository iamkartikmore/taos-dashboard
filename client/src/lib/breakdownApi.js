const META_BASE = 'https://graph.facebook.com';

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

export const BREAKDOWN_SPECS = [
  { key: 'base',          label: 'Base',                    breakdowns: null },
  { key: 'age',           label: 'Age',                     breakdowns: 'age' },
  { key: 'gender',        label: 'Gender',                  breakdowns: 'gender' },
  { key: 'age_gender',    label: 'Age × Gender',            breakdowns: 'age,gender' },
  { key: 'platform',      label: 'Publisher Platform',      breakdowns: 'publisher_platform' },
  { key: 'platform_pos',  label: 'Platform + Position',     breakdowns: 'publisher_platform,platform_position' },
  { key: 'device',        label: 'Impression Device',       breakdowns: 'impression_device' },
  { key: 'country',       label: 'Country',                 breakdowns: 'country' },
  { key: 'region',        label: 'Region',                  breakdowns: 'region' },
  { key: 'hour_adv',      label: 'Hour (Advertiser TZ)',    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' },
  { key: 'hour_aud',      label: 'Hour (Audience TZ)',      breakdowns: 'hourly_stats_aggregated_by_audience_time_zone' },
];

export const WINDOW_PRESETS = {
  'Today': 'today',
  '7D':    'last_7d',
  '14D':   'last_14d',
  '30D':   'last_30d',
};

// Retries on transient network failures (Render free-tier restarts, cold starts, brief 502s).
// Backoff: 2s, 6s — gives Render time to bring the instance back up after an OOM restart.
async function proxyGet(url, params = {}) {
  const BACKOFFS = [0, 2000, 6000];
  let lastErr;
  for (const wait of BACKOFFS) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      const res = await fetch('/api/meta/fetch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, params }),
      });
      // Retry on 5xx / 429; don't retry on 4xx auth errors.
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json.error) || 'Meta API error');
      return json;
    } catch (e) {
      // TypeError: Failed to fetch → server unreachable (crashed/restarting). Retry.
      if (e.name === 'TypeError' || /fetch/i.test(e.message)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Meta proxy unreachable');
}

function actId(id) {
  const s = String(id || '').trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function fetchBreakdownPages(ver, token, accountId, spec, windowKey, dateRange) {
  const act = actId(accountId);
  const baseUrl = `${META_BASE}/${ver}/${act}/insights`;

  const params = {
    access_token: token,
    level: 'ad',
    fields: INSIGHT_FIELDS,
    limit: 250,
    action_report_time: 'mixed',
    action_attribution_windows: "['7d_click','1d_view']",
  };

  if (spec.breakdowns) {
    params.breakdowns = spec.breakdowns;
  }

  if (dateRange && dateRange.since && dateRange.until) {
    params.time_range = JSON.stringify({ since: dateRange.since, until: dateRange.until });
  } else {
    params.date_preset = WINDOW_PRESETS[windowKey] || 'last_7d';
  }

  const out = [];
  let url = baseUrl;
  let page = 0;
  const maxPages = 20;

  while (url && page < maxPages) {
    const json = await proxyGet(url, page === 0 ? params : {});
    if (json.data?.length) out.push(...json.data);
    url = json.paging?.next || '';
    page++;
    await new Promise(r => setTimeout(r, 150));
  }

  return out;
}

export async function pullAllBreakdowns({ ver, token, accounts, specs, window: windowKey, dateRange }, onProgress) {
  const result = {};
  for (const spec of specs) {
    result[spec.key] = [];
  }

  for (const account of accounts) {
    for (const spec of specs) {
      onProgress?.(`[${account.key}] pulling ${spec.label}...`);
      try {
        const rows = await fetchBreakdownPages(ver, token, account.id, spec, windowKey, dateRange);
        const tagged = rows.map(r => ({
          ...r,
          __accountKey: account.key,
          __bdKey:      spec.key,
          __window:     windowKey,
        }));
        result[spec.key].push(...tagged);
        onProgress?.(`[${account.key}] ${spec.label}: ${rows.length} rows`);
      } catch (err) {
        onProgress?.(`[${account.key}] ${spec.label}: ERROR — ${err.message}`);
      }
    }
  }

  return result;
}
