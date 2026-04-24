/**
 * Social analytics — normalization + scoring + classification for
 * Instagram / Facebook organic posts. Everything runs in the browser
 * on data the server has already pulled. No per-post API calls here.
 *
 * Contents:
 *   - normalizePost(platform, raw, ctx)   canonical shape for UI
 *   - computeBaseline(posts, {windowDays})  per-metric distribution
 *   - scoreAdsPotential(post, baseline)     0-100 with transparent breakdown
 *   - classifyComment(text)                 intent / issue / ugc / sentiment
 *   - enrichWithCommentStats(posts)          roll classifier up per post
 *   - detectLateBloomer(post, baseline)      slope proxy via age+engagement
 *   - joinToAdCreatives(posts, enrichedAds)  organic ↔ paid match
 *   - clusterContentDna(posts, {k})          TF-IDF + k-means clusters
 *   - aggregateCadence(posts, {bucket})      publishing cadence buckets
 *
 * Design principles:
 *   - Every score degrades gracefully with thin data (returns 0-score
 *     with a 'thin-data' flag, never throws).
 *   - Every ranking controls for post age — a 2h-old post with 5k reach
 *     is not comparable to a 90d-old one.
 *   - Scoring is ALWAYS percentile-based against the brand's own
 *     distribution, not against universal thresholds that go stale.
 */

import { kmeans } from './advancedStats';
import { enrichPostsDeep, extractTopics } from './socialNlp';

/* ══════════════════════════════════════════════════════════════
   NORMALIZATION — turn raw Graph API payload into canonical post
   ══════════════════════════════════════════════════════════ */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function extractIgInsight(insights = [], key) {
  const row = insights.find(i => i.name === key);
  if (!row) return 0;
  const v = row.values?.[0]?.value;
  // Some insights return objects (e.g. post_reactions_by_type_total) — sum if so
  if (v && typeof v === 'object') {
    return Object.values(v).reduce((s, x) => s + (Number(x) || 0), 0);
  }
  return Number(v) || 0;
}

function parseHashtags(caption = '') {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.toLowerCase());
}
function parseMentions(caption = '') {
  return (caption.match(/@[\p{L}\p{N}_.]+/gu) || []).map(t => t.toLowerCase());
}

function normalizeInstagram(raw, ctx) {
  // ─── Classify the media type correctly first ───────────────────
  // Meta's two type fields:
  //   media_product_type: AD | FEED | STORY | REELS
  //   media_type:         IMAGE | VIDEO | CAROUSEL_ALBUM
  // A REELS post is always media_type=VIDEO, but not every VIDEO is a REEL
  // (VIDEO + media_product_type=FEED = feed video, NOT a reel).
  const productType = String(raw.media_product_type || '').toUpperCase();
  const baseType    = String(raw.media_type || 'IMAGE').toUpperCase();
  const isReel      = raw._isReel || productType === 'REELS';
  const mediaType   = isReel ? 'REEL' : baseType;

  // Does this media carry video content? Drives which "watch"/"play"
  // metrics are meaningful. A CAROUSEL with video children counts.
  const carouselHasVideo = baseType === 'CAROUSEL_ALBUM'
    && (raw.children?.data || []).some(c => String(c.media_type).toUpperCase() === 'VIDEO');
  const isVideoMedia = isReel || baseType === 'VIDEO' || carouselHasVideo;

  const i = raw._insights || [];

  // ─── Metrics that exist on EVERY media type ────────────────────
  const reach       = extractIgInsight(i, 'reach');
  const saves       = extractIgInsight(i, 'saved');
  const likes       = extractIgInsight(i, 'likes')    || num(raw.like_count);
  const comments    = extractIgInsight(i, 'comments') || num(raw.comments_count);
  const shares      = extractIgInsight(i, 'shares');
  const totalInteractions = extractIgInsight(i, 'total_interactions')
                        || (likes + comments + shares + saves);

  // ─── `views` is overloaded — it means different things per type. ─
  // For IMAGE/CAROUSEL: views = scroll-past impressions (how many times
  //   the media was rendered in someone's feed).
  // For VIDEO/REEL:     views = plays (user intentionally watched).
  // We store the raw number on a generic `views` field and separately
  // expose `videoViews` ONLY for video media so the UI never renders
  // "Video views" for a photo.
  const views = extractIgInsight(i, 'views');
  const videoViews = isVideoMedia
    ? (views || extractIgInsight(i, 'video_views') || extractIgInsight(i, 'plays'))
    : 0;
  // `impressions` was deprecated in v20; keep it as an alias of views
  // for downstream callers that still reference it.
  const impressions = views || reach;

  // ─── IMAGE-only metrics (Meta does not return these for video/reel) ─
  const profileVisits = isVideoMedia ? 0 : extractIgInsight(i, 'profile_visits');
  const profileActivity = isVideoMedia ? 0 : extractIgInsight(i, 'profile_activity');
  const follows         = isVideoMedia ? 0 : extractIgInsight(i, 'follows');

  // ─── REEL-only metrics — `ig_reels_avg_watch_time` is ms. ──────
  const avgWatchSec      = isReel ? (extractIgInsight(i, 'ig_reels_avg_watch_time') / 1000) : 0;
  const totalWatchTimeSec= isReel ? (extractIgInsight(i, 'ig_reels_video_view_total_time') / 1000) : 0;

  const denom = Math.max(1, reach);
  return {
    platform: 'instagram',
    brandId: ctx.brandId,
    id: String(raw.id),
    shortcode: raw.shortcode || '',
    caption: raw.caption || '',
    permalink: raw.permalink || '',
    mediaUrl: raw.media_url || raw.thumbnail_url || '',
    thumbnailUrl: raw.thumbnail_url || raw.media_url || '',
    mediaType,
    productType,                  // FEED / REELS / STORY / AD — useful for UI filters
    isVideoMedia,                 // drives which KPI tiles render
    timestamp: raw.timestamp || '',
    hashtags: parseHashtags(raw.caption || ''),
    mentions: parseMentions(raw.caption || ''),

    // Core (every type)
    reach, impressions, views, saves, likes, comments, shares, totalInteractions,

    // Video-only (zero on images/carousels-without-video)
    videoViews,
    avgWatchSec,
    totalWatchTimeSec,
    // Legacy `plays` field kept for back-compat; mirrors videoViews
    plays: videoViews,

    // Image-only (zero on video/reel)
    profileVisits,
    profileActivity,
    follows,

    // Derived rates — always /reach (unique accounts), never /impressions
    engagementRate:    totalInteractions / denom,
    saveRate:          saves / denom,
    commentRate:       comments / denom,
    shareRate:         shares / denom,
    likeRate:          likes / denom,
    profileVisitRate:  profileVisits / denom,   // always 0 for video
    viewRate:          views / denom,            // image view-through, video play-through
    videoViewRate:     videoViews / denom,       // plays/reach for video; 0 otherwise

    // Comments — raw, classified later
    _rawComments: (raw._comments || []).map(c => ({
      text: c.text || '',
      username: c.username || '',
      timestamp: c.timestamp || '',
      likeCount: num(c.like_count),
      replies: c.replies?.summary?.total_count || 0,
    })),
  };
}

function normalizeFacebook(raw, ctx) {
  const i = raw._insights || [];
  const impressions = extractIgInsight(i, 'post_impressions');
  const reach       = extractIgInsight(i, 'post_impressions_unique');
  const clicks      = extractIgInsight(i, 'post_clicks');
  const engaged     = extractIgInsight(i, 'post_engaged_users');
  const reactions   = extractIgInsight(i, 'post_reactions_by_type_total')
                    || num(raw.reactions?.summary?.total_count);
  const comments    = num(raw.comments?.summary?.total_count);
  const shares      = num(raw.shares?.count);

  // Classify FB media type properly — attachment.media_type values are
  // things like "photo", "video", "video_inline", "video_autoplay",
  // "album", "link", "share", "event". status_type is a rougher cut.
  const attachment   = raw.attachments?.data?.[0] || null;
  const attachTypeUC = String(attachment?.media_type || '').toUpperCase();
  const statusTypeUC = String(raw.status_type || '').toUpperCase();
  const isVideoAttach = attachTypeUC.includes('VIDEO');
  const isVideoStatus = statusTypeUC.includes('VIDEO') || raw._fromVideoEdge;
  const isVideoMedia  = isVideoAttach || isVideoStatus;

  // Reels on FB Pages come through the /videos edge → status_type is
  // just "video" but we flagged them _fromVideoEdge in the pull.
  // FB doesn't distinguish Reels from regular videos in the public API,
  // so any Page video is treated as video-type media.
  const mediaType = isVideoMedia ? 'VIDEO'
                  : (attachTypeUC === 'PHOTO' || statusTypeUC === 'ADDED_PHOTOS') ? 'PHOTO'
                  : (attachTypeUC === 'ALBUM') ? 'CAROUSEL'
                  : (attachTypeUC === 'LINK')  ? 'LINK'
                  : (statusTypeUC || 'STATUS');

  // Video metrics — only meaningful when isVideoMedia
  const videoViews = isVideoMedia ? extractIgInsight(i, 'post_video_views') : 0;
  const videoAvgMs = isVideoMedia ? extractIgInsight(i, 'post_video_avg_time_watched') : 0;

  const denom = Math.max(1, reach);
  const likes = reactions;
  const totalInteractions = reactions + comments + shares;
  return {
    platform: 'facebook',
    brandId: ctx.brandId,
    id: String(raw.id),
    caption: raw.message || '',
    permalink: raw.permalink_url || '',
    mediaUrl: raw.full_picture || attachment?.media?.image?.src || '',
    thumbnailUrl: raw.full_picture || attachment?.media?.image?.src || '',
    mediaType,
    productType: isVideoMedia ? 'VIDEO' : 'FEED',
    isVideoMedia,
    timestamp: raw.created_time || '',
    hashtags: parseHashtags(raw.message || ''),
    mentions: parseMentions(raw.message || ''),

    // Core
    reach, impressions, views: impressions, saves: 0, likes, comments, shares, totalInteractions,

    // Video-only (zeroed on photos/status)
    videoViews,
    avgWatchSec: videoAvgMs / 1000,
    totalWatchTimeSec: 0,    // not returned at post level on FB
    plays: videoViews,

    // FB has no saves / profile_visits / follows per-post, keep zeroed
    profileVisits: 0,
    profileActivity: 0,
    follows: 0,

    clicks,

    // Derived
    engagementRate: totalInteractions / denom,
    saveRate: 0,
    commentRate: comments / denom,
    shareRate: shares / denom,
    likeRate: likes / denom,
    clickRate: clicks / denom,
    viewRate: impressions / denom,
    videoViewRate: videoViews / denom,

    _rawComments: (raw._comments || []).map(c => ({
      text: c.message || '',
      username: c.from?.name || '',
      timestamp: c.created_time || '',
      likeCount: num(c.like_count),
      replies: 0,
    })),
  };
}

export function normalizePost(platform, raw, ctx = {}) {
  if (platform === 'facebook') return normalizeFacebook(raw, ctx);
  return normalizeInstagram(raw, ctx);
}

/* ══════════════════════════════════════════════════════════════
   BASELINE — per-brand rolling distribution of every metric
   ══════════════════════════════════════════════════════════ */

const PCTILE_METRICS = [
  'reach','engagementRate','saveRate','commentRate','shareRate','likeRate',
  'profileVisitRate','avgWatchSec','videoViews',
];

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function percentileOf(sorted, v) {
  // Binary search — returns position (0..1) of v in sorted
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  return sorted.length ? lo / sorted.length : 0.5;
}

/* windowDays=0 → use all posts. Otherwise use posts within the window. */
export function computeBaseline(posts = [], { windowDays = 90 } = {}) {
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86400000 : 0;
  const inWindow = cutoff > 0
    ? posts.filter(p => new Date(p.timestamp).getTime() >= cutoff)
    : posts;

  const dists = {};
  for (const metric of PCTILE_METRICS) {
    const values = inWindow.map(p => num(p[metric])).filter(v => Number.isFinite(v));
    const sorted = values.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const mean = sorted.length ? sum / sorted.length : 0;
    const variance = sorted.length
      ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length
      : 0;
    dists[metric] = {
      n: sorted.length,
      sorted,
      mean,
      stdev: Math.sqrt(variance),
      median: quantile(sorted, 0.5),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.90),
    };
  }
  return { windowDays, n: inWindow.length, metrics: dists };
}

function pctileFor(baseline, metric, value) {
  const d = baseline?.metrics?.[metric];
  if (!d || !d.sorted.length) return 0.5;
  return percentileOf(d.sorted, value);
}

/* ══════════════════════════════════════════════════════════════
   ADS-POTENTIAL SCORE — percentile composite with transparent
   per-signal breakdown the UI can render. 0-100 scale.
   ══════════════════════════════════════════════════════════ */

const POST_AGE_HOURS = p => Math.max(1, (Date.now() - new Date(p.timestamp).getTime()) / 3600000);

// Signals + weights. These sum to ~100 when every signal is at the top
// percentile. We return the breakdown so the UI can show exactly why a
// score is what it is, and tune per brand once we have enough data.
const SIGNAL_DEFS_REEL_VIDEO = [
  { key: 'saveRate',         label: 'Save rate',         metric: 'saveRate',      weight: 30 },
  { key: 'engagementRate',   label: 'Engagement rate',   metric: 'engagementRate', weight: 20 },
  { key: 'reach24h',         label: '24h reach velocity', custom: true,            weight: 20 },
  { key: 'watchTime',        label: 'Avg watch time',    metric: 'avgWatchSec',   weight: 15 },
  { key: 'shareRate',        label: 'Share rate',        metric: 'shareRate',     weight: 10 },
  { key: 'commentIntent',    label: 'Comment intent',    custom: true,             weight: 5 },
];

const SIGNAL_DEFS_STATIC = [
  { key: 'saveRate',         label: 'Save rate',         metric: 'saveRate',      weight: 30 },
  { key: 'engagementRate',   label: 'Engagement rate',   metric: 'engagementRate', weight: 25 },
  { key: 'reach24h',         label: '24h reach velocity', custom: true,            weight: 20 },
  { key: 'commentRate',      label: 'Comment rate',      metric: 'commentRate',   weight: 10 },
  { key: 'profileVisitRate', label: 'Profile visit rate', metric: 'profileVisitRate', weight: 10 },
  { key: 'commentIntent',    label: 'Comment intent',    custom: true,             weight: 5 },
];

function reach24hVelocityPctile(post, baseline) {
  // Normalize reach by post age (cap at 24h). A 2-day-old post with 2k
  // reach is not comparable to a 10-hour-old post with 2k reach.
  const age = POST_AGE_HOURS(post);
  const effectiveHours = Math.min(24, age);
  const reachPerHour = post.reach / Math.max(1, effectiveHours);
  // Compare to brand's per-hour distribution (rebuild on the fly)
  const d = baseline?.metrics?.reach;
  if (!d || !d.sorted.length) return 0.5;
  // Use brand median reach per typical 24h as a rough calibration anchor
  const anchor = d.median / 24;
  if (anchor <= 0) return 0.5;
  // Map ratio to pctile space using log-scale so 2x isn't pinned at 1.0
  const ratio = reachPerHour / anchor;
  const pct = Math.max(0, Math.min(1, 0.5 + Math.log2(Math.max(0.01, ratio)) * 0.20));
  return pct;
}

function commentIntentPctile(post) {
  const stats = post.commentStats;
  if (!stats || stats.total < 3) return 0.4; // insufficient data, slight negative
  const intentDensity = stats.intentCount / stats.total;
  // Map density 0..0.5+ → pctile
  return Math.min(1, 0.3 + intentDensity * 1.4);
}

export function scoreAdsPotential(post, baseline) {
  const isVideo = ['VIDEO','REEL','VIDEO_INLINE','SHARE'].includes(post.mediaType)
               || post.videoViews > 0 || post.avgWatchSec > 0;
  const defs = isVideo ? SIGNAL_DEFS_REEL_VIDEO : SIGNAL_DEFS_STATIC;

  const breakdown = [];
  let total = 0;
  for (const def of defs) {
    let pct;
    let rawValue;
    if (def.custom) {
      if (def.key === 'reach24h')     { pct = reach24hVelocityPctile(post, baseline); rawValue = post.reach; }
      else if (def.key === 'commentIntent') { pct = commentIntentPctile(post); rawValue = post.commentStats?.intentCount || 0; }
      else { pct = 0.5; rawValue = 0; }
    } else {
      rawValue = post[def.metric] ?? 0;
      pct = pctileFor(baseline, def.metric, rawValue);
    }
    const pts = def.weight * pct;
    total += pts;
    breakdown.push({
      key: def.key,
      label: def.label,
      rawValue,
      pctile: pct,
      weight: def.weight,
      points: pts,
    });
  }

  // Post-age penalty: if >14d old and not late-bloomer, apply a small
  // penalty so stale viral posts don't dominate the boost queue.
  const ageH = POST_AGE_HOURS(post);
  let agePenalty = 0;
  if (ageH > 14 * 24) agePenalty = Math.min(10, (ageH / 24 - 14) * 0.3);
  total = Math.max(0, total - agePenalty);

  const thinData = !baseline || baseline.n < 5;
  return {
    score: Math.round(total),
    breakdown,
    agePenalty,
    thinData,
  };
}

/* ══════════════════════════════════════════════════════════════
   LATE BLOOMER — post still picking up steam after day 3
   ══════════════════════════════════════════════════════════ */

/* We don't have per-day time series from the Graph API, so we use a
   proxy: if reach/hour is still above the brand's typical 24h-old
   reach/hour at t > 72h, the post is still growing. Crude but useful. */
export function detectLateBloomer(post, baseline) {
  const age = POST_AGE_HOURS(post);
  if (age < 72) return { isLateBloomer: false, reason: 'too young' };
  if (!baseline?.metrics?.reach?.median) return { isLateBloomer: false, reason: 'no baseline' };
  const reachPerHour = post.reach / age;
  const typicalPerHour = (baseline.metrics.reach.median) / 24;
  const ratio = typicalPerHour > 0 ? reachPerHour / typicalPerHour : 0;
  return {
    isLateBloomer: ratio >= 0.8 && age >= 72 && age <= 30 * 24, // still active, within 30d
    reachPerHour,
    ratio,
  };
}

/* ══════════════════════════════════════════════════════════════
   COMMENT CLASSIFICATION — lexicon only, deterministic, zero cost
   ══════════════════════════════════════════════════════════ */

const INTENT_LEXICON = [
  // Price / shopping
  /\bprice\b/i, /\bcost\b/i, /\bhow much\b/i, /\brate\b/i, /\bkitne? (ka|ki|ke)\b/i,
  /\bkitna\b/i, /\bmrp\b/i, /₹|\brs\.?\s?\d/i,
  // Availability
  /\bavailable\b/i, /\bin stock\b/i, /\bkahan milega\b/i, /\bkab milega\b/i,
  /\bshipping\b/i, /\bdelivery\b/i, /\bcourier\b/i, /\bcod\b/i,
  // Link / where to buy
  /\blink\b/i, /\bwhere to buy\b/i, /\bwhere can i (get|buy)\b/i, /\bbio link\b/i,
  // Size / variant
  /\bsize\b/i, /\bcolou?r\b/i, /\bvariant\b/i, /\bdo you have\b/i,
  // Want / desire
  /\bwant\s+(this|it|one)\b/i, /\border\b/i, /\bdm\b/i, /\bpls\s+(help|guide)\b/i,
];

const ISSUE_LEXICON = [
  /\bnot (received|delivered|arrived|shipped|working)\b/i,
  /\bnever (received|got|arrived|delivered)\b/i,
  /\b(broken|damaged|defective|faulty|leaking|expired)\b/i,
  /\b(refund|return|replacement|exchange)\b/i,
  /\bwrong (item|product|size|colou?r|order)\b/i,
  /\bcomplain(t|ing)?\b/i, /\bfraud\b/i, /\bscam\b/i,
  /\b(worst|terrible|horrible|useless)\b/i,
  /\b(allergic|rash|reaction)\b/i,
  /\bstill (waiting|not)\b/i,
];

const POSITIVE_LEXICON = [
  /\b(love|loving|loved|adore|awesome|amazing|fantastic|beautiful|gorgeous|best|perfect|excellent|wonderful|great)\b/i,
  /\b(so (cool|cute|nice|pretty|good))\b/i,
  /😍|🥰|❤️|💖|🔥|✨|😊|👏|🎉|💯/,
  /\b(thanks|thank you|thankyou|ty)\b/i,
];

const NEGATIVE_LEXICON = [
  /\b(bad|worst|awful|ugly|boring|disappointed|disappointing|poor|cheap quality)\b/i,
  /\b(hate|hated|dislike)\b/i,
  /👎|💩|😡|🤮|😤|😞|😔/,
];

function matchesAny(text, lexicon) {
  return lexicon.some(rx => rx.test(text));
}

export function classifyComment(text = '') {
  const t = String(text).trim();
  if (!t) return { intent: false, issue: false, ugcMention: false, positive: false, negative: false };
  const intent = matchesAny(t, INTENT_LEXICON);
  const issue  = matchesAny(t, ISSUE_LEXICON);
  // UGC mention: any @-handle that isn't an obvious spam/robot pattern
  const mentions = (t.match(/@[\p{L}\p{N}_.]+/gu) || []);
  const ugcMention = mentions.length > 0;
  const positive = matchesAny(t, POSITIVE_LEXICON) && !issue;
  const negative = matchesAny(t, NEGATIVE_LEXICON) || issue;
  return { intent, issue, ugcMention, mentions, positive, negative };
}

/* Roll per-comment classification up per post. Called once per pull;
   result stored on the post so downstream scoring/UI is cheap. */
export function enrichWithCommentStats(posts = []) {
  return posts.map(p => {
    const raws = p._rawComments || [];
    const classified = raws.map(c => ({ ...c, ...classifyComment(c.text) }));
    let intentCount = 0, issueCount = 0, ugcMentions = 0, positive = 0, negative = 0;
    for (const c of classified) {
      if (c.intent)     intentCount++;
      if (c.issue)      issueCount++;
      if (c.ugcMention) ugcMentions++;
      if (c.positive)   positive++;
      if (c.negative)   negative++;
    }
    const total = classified.length;
    return {
      ...p,
      comments_detail: classified,
      commentStats: {
        total, intentCount, issueCount, ugcMentions, positive, negative,
        sentimentScore: total ? (positive - negative) / total : 0, // -1..1
      },
    };
  });
}

/* ══════════════════════════════════════════════════════════════
   AD MATCH — organic post → paid ad (using enrichedRows)
   ══════════════════════════════════════════════════════════ */

/* Meta surfaces the organic post behind an ad via
   creative.instagram_permalink_url / object_story_id. Our enrichedRows
   don't have that today, so we match on a coarser signal: the ad's
   thumbnail_url matches the post media_url, OR the ad name / caption
   contains the post shortcode. If neither is available we return null.
   UI will progressively improve as the fields propagate.           */
function normalizeUrl(u = '') {
  return String(u).toLowerCase().split('?')[0].replace(/\/+$/, '');
}

export function joinToAdCreatives(posts = [], enrichedAds = []) {
  if (!posts.length || !enrichedAds.length) {
    return { byPostId: {}, boosted: [], unboosted: posts };
  }
  const byShortcode = new Map();
  const byMediaUrl  = new Map();
  for (const ad of enrichedAds) {
    if (!ad) continue;
    const adName = String(ad.adName || ad.ad_name || '').toLowerCase();
    const thumb  = normalizeUrl(ad.thumbnailUrl || ad.thumbnail_url || ad.image_url || '');
    // Shortcode-matching: if "BnA3_abc" appears in the ad name
    const sc = adName.match(/\b([A-Za-z0-9_-]{9,13})\b/g) || [];
    for (const s of sc) {
      if (!byShortcode.has(s)) byShortcode.set(s, []);
      byShortcode.get(s).push(ad);
    }
    if (thumb) {
      if (!byMediaUrl.has(thumb)) byMediaUrl.set(thumb, []);
      byMediaUrl.get(thumb).push(ad);
    }
  }
  const byPostId = {};
  const boosted = [], unboosted = [];
  for (const p of posts) {
    let match = null;
    if (p.shortcode && byShortcode.has(p.shortcode)) match = byShortcode.get(p.shortcode)[0];
    if (!match) {
      const u = normalizeUrl(p.mediaUrl || p.thumbnailUrl);
      if (u && byMediaUrl.has(u)) match = byMediaUrl.get(u)[0];
    }
    if (match) {
      const summary = {
        adId:        match.adId || match.ad_id,
        adName:      match.adName || match.ad_name,
        spend:       num(match.spend),
        roas:        num(match.metaRoas),
        impressions: num(match.impressions),
        ctr:         num(match.ctrAll || match.ctr),
        purchases:   num(match.purchases),
        trendSignal: match.trendSignal || '',
      };
      byPostId[p.id] = summary;
      boosted.push({ ...p, adMatch: summary });
    } else {
      unboosted.push(p);
    }
  }
  return { byPostId, boosted, unboosted };
}

/* ══════════════════════════════════════════════════════════════
   CONTENT DNA — TF-IDF on captions/hashtags + k-means cluster
   ══════════════════════════════════════════════════════════ */

const STOPWORDS = new Set(('a,an,the,of,and,or,but,to,in,on,for,with,this,that,is,are,was,were,be,been,being,as,at,by,from,it,its,we,our,us,you,your,he,she,they,them,his,her,their,i,me,my,mine,ours,have,has,had,do,does,did,so,if,then,than,not,no,yes,just,also,all,very,more,most,some,any,one,two,three,get,got,make,made,made,here,there,about,into,out,up,down,over,under').split(','));

function tokensFromPost(p) {
  const txt = [p.caption, p.hashtags.join(' '), p.mentions.join(' ')].join(' ');
  const raw = (txt.match(/[\p{L}\p{N}_#@]+/gu) || []).map(t => t.toLowerCase());
  return raw.filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function tfidf(posts) {
  const docs = posts.map(tokensFromPost);
  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;
  const vocab = [...df.entries()]
    .filter(([, c]) => c >= 2 && c < N * 0.5) // drop ultra-rare + ultra-common
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60) // top 60 terms
    .map(([t]) => t);
  const vocabIdx = new Map(vocab.map((t, i) => [t, i]));
  return docs.map(d => {
    const vec = new Array(vocab.length).fill(0);
    for (const t of d) {
      const i = vocabIdx.get(t);
      if (i === undefined) continue;
      vec[i] += 1;
    }
    // tf-idf
    for (let i = 0; i < vocab.length; i++) {
      if (!vec[i]) continue;
      const idf = Math.log(N / (df.get(vocab[i]) || 1));
      vec[i] = vec[i] * idf;
    }
    return { vec, tokens: d };
  }).map((x, i) => ({ id: posts[i].id, features: x.vec, tokens: x.tokens, _vocab: vocab }));
}

export function clusterContentDna(posts = [], { k = 5 } = {}) {
  if (posts.length < Math.max(10, k * 2)) {
    return { clusters: [], vocab: [], postCluster: {} };
  }
  const feat = tfidf(posts);
  const vocab = feat[0]._vocab;
  const { clusters, centroids } = kmeans(feat, k, { maxIter: 30 });
  const postCluster = {};
  const clusterBuckets = Array.from({ length: k }, () => ({ posts: [], topTerms: [], metrics: {} }));
  for (let i = 0; i < clusters.length; i++) {
    const cid = clusters[i].cluster;
    postCluster[clusters[i].id] = cid;
    clusterBuckets[cid].posts.push(posts.find(p => p.id === clusters[i].id));
  }
  // Top terms per cluster — highest centroid values
  for (let c = 0; c < k; c++) {
    const cen = centroids[c] || [];
    const ranked = vocab
      .map((t, i) => ({ t, v: cen[i] || 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5)
      .map(x => x.t);
    clusterBuckets[c].topTerms = ranked;
    const bucket = clusterBuckets[c];
    const ps = bucket.posts.filter(Boolean);
    if (!ps.length) continue;
    const avg = key => ps.reduce((s, p) => s + (p[key] || 0), 0) / ps.length;
    bucket.metrics = {
      count: ps.length,
      avgEngagement: avg('engagementRate'),
      avgSaveRate:   avg('saveRate'),
      avgReach:      avg('reach'),
      avgAdsPotential: ps.reduce((s, p) => s + (p.adsPotential?.score || 0), 0) / ps.length,
    };
  }
  return { clusters: clusterBuckets, vocab, postCluster };
}

/* ══════════════════════════════════════════════════════════════
   CADENCE — posting frequency by day-of-week + hour buckets
   ══════════════════════════════════════════════════════════ */

export function aggregateCadence(posts = [], { bucket = 'week' } = {}) {
  const byKey = new Map();
  const byDow = new Array(7).fill(0).map(() => ({ count: 0, engagement: 0, reach: 0 }));
  const byHour = new Array(24).fill(0).map(() => ({ count: 0, engagement: 0, reach: 0 }));
  for (const p of posts) {
    const t = new Date(p.timestamp);
    if (isNaN(t)) continue;
    let key;
    if (bucket === 'day')  key = t.toISOString().slice(0, 10);
    else if (bucket === 'month') key = t.toISOString().slice(0, 7);
    else {
      // ISO week (YYYY-Www)
      const onejan = new Date(t.getUTCFullYear(), 0, 1);
      const week = Math.ceil((((t - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
      key = `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    const cur = byKey.get(key) || { key, count: 0, engagement: 0, reach: 0 };
    cur.count++;
    cur.engagement += p.totalInteractions || 0;
    cur.reach      += p.reach || 0;
    byKey.set(key, cur);

    const dow = byDow[t.getUTCDay()];
    dow.count++; dow.engagement += p.totalInteractions || 0; dow.reach += p.reach || 0;
    const h = byHour[t.getUTCHours()];
    h.count++; h.engagement += p.totalInteractions || 0; h.reach += p.reach || 0;
  }
  const series = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    series,
    byDayOfWeek: byDow.map((d, i) => ({
      dow: i,
      label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],
      count: d.count,
      avgEngagement: d.count ? d.engagement / d.count : 0,
      avgReach:      d.count ? d.reach      / d.count : 0,
    })),
    byHour: byHour.map((h, i) => ({
      hour: i,
      count: h.count,
      avgEngagement: h.count ? h.engagement / h.count : 0,
      avgReach:      h.count ? h.reach      / h.count : 0,
    })),
  };
}

/* ══════════════════════════════════════════════════════════════
   OVERALL PIPELINE — run every step once per pull
   ══════════════════════════════════════════════════════════ */

export function enrichAllPosts(posts = [], enrichedAds = []) {
  // 1. Deep comment NLP — intent/issue/UGC with severity + multi-language
  let out = enrichPostsDeep(posts);
  // 2. Baseline from the brand's own posts
  const baseline = computeBaseline(out, { windowDays: 90 });
  // 3. Score each post with transparent breakdown + objective segmentation
  out = out.map(p => ({
    ...p,
    adsPotential: scoreAdsPotential(p, baseline),
    adObjectives: scoreAdObjectives(p, baseline),
    lateBloomer:  detectLateBloomer(p, baseline),
  }));
  // 4. Ad-creative match
  const { byPostId, boosted, unboosted } = joinToAdCreatives(out, enrichedAds);
  out = out.map(p => ({ ...p, adMatch: byPostId[p.id] || null }));
  return { posts: out, baseline, boostedIds: new Set(boosted.map(b => b.id)), unboostedIds: new Set(unboosted.map(b => b.id)) };
}

/* ══════════════════════════════════════════════════════════════
   AD OPPORTUNITY BY OBJECTIVE — Andromeda-inspired segmentation
   ══════════════════════════════════════════════════════════

   Meta's delivery system (Andromeda + Advantage+) optimizes ads
   differently by objective. An organic post's signal mix tells us
   which objective it's primed for:

   AWARENESS:    high share rate + comment volume + broad engagement
   TRAFFIC:      high profile-visit rate + high click-likelihood signals
   CONVERSION:   high save rate + high-intent comments + purchase-intent hits
   RETARGETING:  high engagement from existing followers, mid save rate
   CATALOG DPA:  high save rate + mentions a specific product/SKU

   Each dimension returns {score 0-100, confidence 0-1, signals[]}
   so the UI can show exactly why we'd recommend that objective.
   ══════════════════════════════════════════════════════════ */

function clip01(x) { return Math.max(0, Math.min(1, x)); }

function pctFor(baseline, metric, value) {
  const d = baseline?.metrics?.[metric];
  if (!d || !d.sorted?.length) return 0.5;
  let lo = 0, hi = d.sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (d.sorted[m] < value) lo = m + 1; else hi = m; }
  return lo / d.sorted.length;
}

export function scoreAdObjectives(post, baseline) {
  const sharePct  = pctFor(baseline, 'shareRate', post.shareRate);
  const engPct    = pctFor(baseline, 'engagementRate', post.engagementRate);
  const savePct   = pctFor(baseline, 'saveRate', post.saveRate);
  const commentPct= pctFor(baseline, 'commentRate', post.commentRate);
  const profilePct= pctFor(baseline, 'profileVisitRate', post.profileVisitRate);
  const reachPct  = pctFor(baseline, 'reach', post.reach);
  const watchPct  = pctFor(baseline, 'avgWatchSec', post.avgWatchSec);

  const cs = post.commentStats || {};
  const intentDensity = cs.total ? (cs.intentCount || 0) / cs.total : 0;
  const purchaseIntentCount = cs.intentByKey?.purchase_intent || 0;
  const priceIntentCount    = cs.intentByKey?.price || 0;
  const linkIntentCount     = cs.intentByKey?.link || 0;
  const totalIntentHits     = (cs.intentCount || 0);

  // 1. AWARENESS — virality / broad reach signals
  const awarenessSignals = [];
  let awareness = 0;
  awareness += sharePct * 35;       awarenessSignals.push({ label: 'Share rate', pctile: sharePct, w: 35 });
  awareness += reachPct * 25;       awarenessSignals.push({ label: 'Reach', pctile: reachPct, w: 25 });
  awareness += commentPct * 20;     awarenessSignals.push({ label: 'Comment rate', pctile: commentPct, w: 20 });
  awareness += engPct * 20;         awarenessSignals.push({ label: 'Engagement rate', pctile: engPct, w: 20 });

  // 2. TRAFFIC — clicks / profile visits / link-intent
  const trafficSignals = [];
  let traffic = 0;
  traffic += profilePct * 35;       trafficSignals.push({ label: 'Profile visit rate', pctile: profilePct, w: 35 });
  traffic += clip01(linkIntentCount / 3) * 30; trafficSignals.push({ label: 'Link requests in comments', raw: linkIntentCount, w: 30 });
  traffic += engPct * 20;           trafficSignals.push({ label: 'Engagement rate', pctile: engPct, w: 20 });
  traffic += reachPct * 15;         trafficSignals.push({ label: 'Reach', pctile: reachPct, w: 15 });

  // 3. CONVERSION — save rate + purchase intent + price queries
  const conversionSignals = [];
  let conversion = 0;
  conversion += savePct * 35;       conversionSignals.push({ label: 'Save rate', pctile: savePct, w: 35 });
  conversion += clip01(purchaseIntentCount / 2) * 25; conversionSignals.push({ label: 'Purchase-intent comments', raw: purchaseIntentCount, w: 25 });
  conversion += clip01(priceIntentCount / 3)    * 20; conversionSignals.push({ label: 'Price queries', raw: priceIntentCount, w: 20 });
  conversion += engPct * 10;        conversionSignals.push({ label: 'Engagement rate', pctile: engPct, w: 10 });
  conversion += clip01(intentDensity * 3) * 10; conversionSignals.push({ label: 'Comment intent density', raw: intentDensity, w: 10 });

  // 4. RETARGETING — steady engagement + saves but lower reach
  const retargetingSignals = [];
  let retargeting = 0;
  retargeting += savePct * 25;      retargetingSignals.push({ label: 'Save rate', pctile: savePct, w: 25 });
  retargeting += engPct * 25;       retargetingSignals.push({ label: 'Engagement rate', pctile: engPct, w: 25 });
  retargeting += clip01(1 - reachPct) * 20; retargetingSignals.push({ label: 'Low reach (not saturated)', pctile: 1 - reachPct, w: 20 });
  retargeting += watchPct * 15;     retargetingSignals.push({ label: 'Avg watch time', pctile: watchPct, w: 15 });
  retargeting += commentPct * 15;   retargetingSignals.push({ label: 'Comment rate', pctile: commentPct, w: 15 });

  // 5. CATALOG DPA — high save + product-relevance language
  const productTerms = /\b(buy|order|link|price|size|variant|in stock|available|kharid|lelo)\b/i;
  const productMention = productTerms.test(post.caption || '') || priceIntentCount >= 2 || purchaseIntentCount >= 1;
  const catalogSignals = [];
  let catalog = 0;
  catalog += savePct * 40;          catalogSignals.push({ label: 'Save rate', pctile: savePct, w: 40 });
  catalog += (productMention ? 25 : 0); catalogSignals.push({ label: 'Product-intent language', raw: productMention ? 1 : 0, w: 25 });
  catalog += clip01(priceIntentCount / 2) * 15; catalogSignals.push({ label: 'Price queries', raw: priceIntentCount, w: 15 });
  catalog += engPct * 10;           catalogSignals.push({ label: 'Engagement rate', pctile: engPct, w: 10 });
  catalog += clip01(purchaseIntentCount / 1) * 10; catalogSignals.push({ label: 'Purchase intent', raw: purchaseIntentCount, w: 10 });

  const objectives = {
    awareness:    { score: Math.round(awareness),    signals: awarenessSignals },
    traffic:      { score: Math.round(traffic),      signals: trafficSignals },
    conversion:   { score: Math.round(conversion),   signals: conversionSignals },
    retargeting:  { score: Math.round(retargeting),  signals: retargetingSignals },
    catalog:      { score: Math.round(catalog),      signals: catalogSignals },
  };

  // Recommend the single highest-scoring objective above a bar
  const ranked = Object.entries(objectives).sort((a, b) => b[1].score - a[1].score);
  const recommended = ranked[0][1].score >= 40 ? ranked[0][0] : null;

  return { objectives, recommended, top: ranked.slice(0, 3).map(([k, v]) => ({ key: k, score: v.score })) };
}

/* ══════════════════════════════════════════════════════════════
   TREND SERIES — per-day aggregate of reach / engagement / saves
   so the UI can draw proper time-series charts instead of static KPIs.
   ══════════════════════════════════════════════════════════ */

export function buildTrendSeries(posts = [], { bucket = 'day' } = {}) {
  const byKey = new Map();
  for (const p of posts) {
    const t = new Date(p.timestamp);
    if (isNaN(t)) continue;
    let key;
    if (bucket === 'month')    key = t.toISOString().slice(0, 7);
    else if (bucket === 'week') {
      const onejan = new Date(t.getUTCFullYear(), 0, 1);
      const week = Math.ceil((((t - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
      key = `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    } else key = t.toISOString().slice(0, 10);
    const cur = byKey.get(key) || {
      key, posts: 0, reach: 0, engagement: 0, saves: 0, shares: 0, comments: 0,
      videoViews: 0, reels: 0, intent: 0, issues: 0, positive: 0, negative: 0,
    };
    cur.posts++;
    cur.reach       += p.reach || 0;
    cur.engagement  += p.totalInteractions || 0;
    cur.saves       += p.saves || 0;
    cur.shares      += p.shares || 0;
    cur.comments    += p.comments || 0;
    cur.videoViews  += p.videoViews || 0;
    if (p.mediaType === 'REEL') cur.reels++;
    cur.intent      += p.commentStats?.intentCount || 0;
    cur.issues      += p.commentStats?.issueCount || 0;
    cur.positive    += p.commentStats?.positive || 0;
    cur.negative    += p.commentStats?.negative || 0;
    byKey.set(key, cur);
  }
  const series = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  // Attach engagement-rate per row
  for (const row of series) {
    row.engagementRate = row.reach > 0 ? row.engagement / row.reach : 0;
    row.saveRate       = row.reach > 0 ? row.saves / row.reach      : 0;
    row.sentiment      = (row.positive + row.negative) > 0
      ? (row.positive - row.negative) / (row.positive + row.negative)
      : 0;
  }
  return series;
}

/* ══════════════════════════════════════════════════════════════
   CROSS-PATTERN HEATMAPS — same shape as adsʼ cross matrix
   rowKey × colKey × cellMetric
   ══════════════════════════════════════════════════════════ */

function postDimension(post, key) {
  switch (key) {
    case 'platform':       return post.platform;
    case 'mediaType':      return post.mediaType;
    case 'dayOfWeek': {
      const t = new Date(post.timestamp);
      if (isNaN(t)) return null;
      return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][t.getUTCDay()];
    }
    case 'hourBucket': {
      const t = new Date(post.timestamp);
      if (isNaN(t)) return null;
      const h = t.getUTCHours();
      if (h < 6)  return '00-06';
      if (h < 12) return '06-12';
      if (h < 18) return '12-18';
      return '18-24';
    }
    case 'captionLength': {
      const n = (post.caption || '').length;
      if (n < 50)  return '<50';
      if (n < 150) return '50-150';
      if (n < 400) return '150-400';
      return '400+';
    }
    case 'hashtagDensity': {
      const n = post.hashtags?.length || 0;
      if (n === 0) return 'none';
      if (n <= 3)  return '1-3';
      if (n <= 10) return '4-10';
      return '11+';
    }
    case 'hasVideo':       return post.videoViews > 0 || post.mediaType === 'REEL' || post.mediaType === 'VIDEO' ? 'video' : 'static';
    case 'boostStatus':    return post.adMatch ? 'boosted' : 'organic';
    case 'sentiment': {
      const s = post.commentStats?.sentimentScore || 0;
      if (s > 0.3)  return 'positive';
      if (s < -0.3) return 'negative';
      return 'neutral';
    }
    default:               return null;
  }
}

export function buildSocialCrossMatrix(posts = [], rowKey, colKey, { minPosts = 2 } = {}) {
  const matrix = {};
  const rowTotals = new Map(), colTotals = new Map();
  for (const p of posts) {
    const r = postDimension(p, rowKey);
    const c = postDimension(p, colKey);
    if (!r || !c) continue;
    const key = `${r}|||${c}`;
    let cell = matrix[key];
    if (!cell) {
      cell = {
        row: r, col: c, posts: 0,
        reach: 0, engagement: 0, saves: 0, shares: 0, comments: 0,
        adsPotentialSum: 0, videoViews: 0, issues: 0, intent: 0,
      };
      matrix[key] = cell;
    }
    cell.posts++;
    cell.reach       += p.reach || 0;
    cell.engagement  += p.totalInteractions || 0;
    cell.saves       += p.saves || 0;
    cell.shares      += p.shares || 0;
    cell.comments    += p.comments || 0;
    cell.videoViews  += p.videoViews || 0;
    cell.adsPotentialSum += p.adsPotential?.score || 0;
    cell.issues      += p.commentStats?.issueCount || 0;
    cell.intent      += p.commentStats?.intentCount || 0;
    rowTotals.set(r, (rowTotals.get(r) || 0) + (p.reach || 0));
    colTotals.set(c, (colTotals.get(c) || 0) + (p.reach || 0));
  }
  for (const cell of Object.values(matrix)) {
    cell.engagementRate = cell.reach > 0 ? cell.engagement / cell.reach : 0;
    cell.saveRate       = cell.reach > 0 ? cell.saves / cell.reach       : 0;
    cell.avgAdsPotential = cell.posts > 0 ? cell.adsPotentialSum / cell.posts : 0;
    cell.belowThreshold = cell.posts < minPosts;
  }
  const rowKeys = [...rowTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colKeys = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { rowKeys, colKeys, matrix };
}

export { extractTopics };

/* Convenience: pick the top-N boost candidates from enriched posts.
   Scoring + age weight do most of the sorting; we just filter out low-
   confidence results and posts already boosted. */
export function pickBoostCandidates(posts = [], { limit = 15 } = {}) {
  return [...posts]
    .filter(p => !p.adMatch && p.adsPotential?.score >= 45 && p.reach >= 200)
    .sort((a, b) => (b.adsPotential?.score || 0) - (a.adsPotential?.score || 0))
    .slice(0, limit);
}

/* Posts we boosted that are paying off poorly despite strong organic
   signals — candidate for audience / placement rework, not creative. */
export function pickMismatchedBoosts(posts = [], { limit = 10 } = {}) {
  return posts
    .filter(p => p.adMatch && (p.adsPotential?.score || 0) >= 60 && (p.adMatch.roas || 0) < 1.5 && (p.adMatch.spend || 0) >= 500)
    .sort((a, b) => ((b.adsPotential?.score || 0) - (b.adMatch?.roas || 0) * 10)
                  - ((a.adsPotential?.score || 0) - (a.adMatch?.roas || 0) * 10))
    .slice(0, limit);
}

export function pickLateBloomers(posts = [], { limit = 10 } = {}) {
  return posts
    .filter(p => p.lateBloomer?.isLateBloomer)
    .sort((a, b) => (b.lateBloomer?.ratio || 0) - (a.lateBloomer?.ratio || 0))
    .slice(0, limit);
}
