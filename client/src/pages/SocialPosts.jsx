import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  Instagram, Facebook, RefreshCw, Flame, TrendingUp, PauseCircle,
  Hash, MessageCircle, AlertTriangle, Zap, ExternalLink, X,
  Sparkles, Users, Search, Layers, Clock, BarChart3, Play,
  ArrowUpRight, Eye, Bookmark, Share2, Heart, ChevronRight,
  Calendar,
} from 'lucide-react';
import clsx from 'clsx';
import {
  enrichAllPosts, pickBoostCandidates, pickMismatchedBoosts,
  pickLateBloomers, clusterContentDna, aggregateCadence,
  buildTrendSeries, buildSocialCrossMatrix, extractTopics,
} from '../lib/socialAnalytics';
import { pullInstagram, pullFacebook } from '../lib/socialApi';

const num = v => (Number(v) || 0).toLocaleString('en-IN');
const pct = v => `${((Number(v) || 0) * 100).toFixed(1)}%`;
const fmtCompact = v => {
  const n = Number(v) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

const ageLabel = ts => {
  if (!ts) return '—';
  const hours = (Date.now() - new Date(ts).getTime()) / 3600000;
  if (hours < 1)  return 'now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  if (hours < 24 * 30) return `${Math.round(hours / 24)}d ago`;
  if (hours < 24 * 365) return `${Math.round(hours / (24 * 30))}mo ago`;
  return `${Math.round(hours / (24 * 365))}y ago`;
};

const SCORE_COLOR = s =>
  s >= 75 ? '#22c55e' :
  s >= 55 ? '#84cc16' :
  s >= 40 ? '#eab308' :
  s >= 25 ? '#f97316' : '#ef4444';

const TABS = [
  { id: 'feed',     label: 'Feed',             icon: Layers },
  { id: 'boost',    label: 'Ad Opportunities', icon: Flame },
  { id: 'comments', label: 'Comments',         icon: MessageCircle },
  { id: 'trends',   label: 'Trends',           icon: TrendingUp },
  { id: 'patterns', label: 'Patterns',         icon: BarChart3 },
  { id: 'dna',      label: 'Content DNA',      icon: Sparkles },
  { id: 'cadence',  label: 'Cadence',          icon: Calendar },
];

const OBJECTIVE_META = {
  awareness:   { label: 'Awareness',   color: '#06b6d4', hint: 'Broad reach, shares, engagement volume' },
  traffic:     { label: 'Traffic',     color: '#3b82f6', hint: 'Profile visits + link-intent comments' },
  conversion:  { label: 'Conversion',  color: '#22c55e', hint: 'Save rate + purchase/price intent comments' },
  retargeting: { label: 'Retargeting', color: '#a855f7', hint: 'Deep engagement on lower-reach posts' },
  catalog:     { label: 'Catalog/DPA', color: '#f59e0b', hint: 'Save rate + product-intent language' },
};

/* ──────────────────────────────────────────────────────────────── */

function KPI({ label, value, sub, color = '#06b6d4', Icon }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest">
        {Icon && <Icon size={11} style={{ color }} />}
        {label}
      </div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function ScoreBadge({ score, thin }) {
  const col = SCORE_COLOR(score);
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: `${col}22`, color: col, border: `1px solid ${col}55` }}
      title={thin ? 'Thin data — score has low confidence' : 'Ads-potential composite score'}
    >
      <Zap size={9} /> {score}{thin && <span className="opacity-60">·?</span>}
    </div>
  );
}

function PlatformIcon({ platform, size = 11 }) {
  if (platform === 'facebook') return <Facebook size={size} className="text-blue-400" />;
  return <Instagram size={size} className="text-pink-400" />;
}

/* ── Post card (feed grid) ─────────────────────────────────────── */
function PostCard({ post, onOpen }) {
  const media = post.thumbnailUrl || post.mediaUrl;
  // Trust media type classification, not metric-derived heuristics.
  // A photo's scroll-past "views" count is not a video signal.
  const hasVideo = post.isVideoMedia || ['VIDEO','REEL'].includes(post.mediaType);
  return (
    <button
      onClick={() => onOpen(post)}
      className="group text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl overflow-hidden transition-all"
    >
      <div className="relative aspect-square bg-gray-800 overflow-hidden">
        {media ? (
          <img src={media} alt="" loading="lazy" referrerPolicy="no-referrer"
               className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-700">
            <Hash size={24} />
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <div className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[9px] font-semibold text-white flex items-center gap-1">
            <PlatformIcon platform={post.platform} size={9} />
            {post.mediaType}
          </div>
          {hasVideo && <div className="p-1 rounded bg-black/60 backdrop-blur text-white"><Play size={9} /></div>}
        </div>
        <div className="absolute top-2 right-2">
          <ScoreBadge score={post.adsPotential?.score || 0} thin={post.adsPotential?.thinData} />
        </div>
        {post.adMatch && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-brand-500/70 backdrop-blur text-[9px] font-semibold text-white flex items-center gap-1">
            <ArrowUpRight size={9} /> Boosted · {(post.adMatch.roas || 0).toFixed(2)}x
          </div>
        )}
        {post.lateBloomer?.isLateBloomer && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500/80 backdrop-blur text-[9px] font-semibold text-white">
            Late bloomer
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-[11px] text-slate-400 line-clamp-2 min-h-[2.2em]" title={post.caption}>
          {post.caption || <span className="italic text-slate-600">no caption</span>}
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2">
          <span className="flex items-center gap-1"><Eye size={9} /> {fmtCompact(post.reach)}</span>
          {post.saves > 0 && <span className="flex items-center gap-1"><Bookmark size={9} /> {fmtCompact(post.saves)}</span>}
          <span className="flex items-center gap-1"><Heart size={9} /> {fmtCompact(post.likes)}</span>
          <span className="flex items-center gap-1"><MessageCircle size={9} /> {fmtCompact(post.comments)}</span>
        </div>
        <div className="text-[9px] text-slate-600 mt-1 flex items-center justify-between">
          <span>{ageLabel(post.timestamp)}</span>
          {post.commentStats?.issueCount > 0 && (
            <span className="text-red-400 flex items-center gap-0.5">
              <AlertTriangle size={8} /> {post.commentStats.issueCount} issue{post.commentStats.issueCount > 1 ? 's' : ''}
            </span>
          )}
          {post.commentStats?.intentCount > 0 && (
            <span className="text-emerald-400 flex items-center gap-0.5">
              <Search size={8} /> {post.commentStats.intentCount} intent
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Detail drawer — score breakdown, comments, ad match, etc ── */
function PostDrawer({ post, onClose }) {
  if (!post) return null;
  const media = post.thumbnailUrl || post.mediaUrl;
  const bp = post.adsPotential?.breakdown || [];

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl h-screen overflow-y-auto bg-gray-950 border-l border-gray-800 p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <PlatformIcon platform={post.platform} />
              <span>{post.mediaType}</span>
              <span>·</span>
              <span>{ageLabel(post.timestamp)}</span>
              {post.permalink && (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-brand-400 hover:text-brand-300">
                  <ExternalLink size={10} /> Open on {post.platform}
                </a>
              )}
            </div>
            <div className="text-sm text-slate-200 mt-1 leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
              {post.caption || <span className="italic text-slate-600">no caption</span>}
            </div>
            {post.hashtags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {post.hashtags.slice(0, 15).map(h => (
                  <span key={h} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-slate-400 font-mono">{h}</span>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-800 text-slate-500"><X size={14} /></button>
        </div>

        {media && (
          <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-900 max-h-[400px] flex items-center justify-center">
            <img src={media} alt="" referrerPolicy="no-referrer" className="w-full max-h-[400px] object-contain" />
          </div>
        )}

        {/* Metrics tile grid — rendered by media type.
            Meta's insights API exposes different metric sets per
            media_type/media_product_type, so the UI has to mirror
            that. Never show "Video views" on an image, never show
            "Profile visits" on a video/reel (Meta doesn't return
            those for video media). */}
        <div className="grid grid-cols-4 gap-2">
          {/* Core — always shown */}
          <KPI label="Reach"      value={fmtCompact(post.reach)}        Icon={Eye}           color="#06b6d4" />
          <KPI label="Engagement" value={pct(post.engagementRate)}      Icon={Heart}         color="#ec4899" sub={`${fmtCompact(post.totalInteractions)} total`} />
          <KPI label={post.platform === 'facebook' ? 'Reactions' : 'Likes'} value={fmtCompact(post.likes)} Icon={Heart} color="#ef4444" />
          <KPI label="Comments"   value={fmtCompact(post.comments)}     Icon={MessageCircle} color="#f59e0b" />
          <KPI label="Share rate" value={pct(post.shareRate)}           Icon={Share2}        color="#22c55e" sub={`${fmtCompact(post.shares)} shares`} />

          {/* IG-only on every IG post (FB has no save metric) */}
          {post.platform === 'instagram' && (
            <KPI label="Save rate" value={pct(post.saveRate)}           Icon={Bookmark}      color="#a855f7" sub={`${fmtCompact(post.saves)} saves`} />
          )}
          {post.platform === 'facebook' && post.clicks > 0 && (
            <KPI label="Clicks" value={fmtCompact(post.clicks)} Icon={ArrowUpRight} color="#3b82f6" sub={post.clickRate ? pct(post.clickRate) + ' of reach' : null} />
          )}

          {/* VIDEO / REEL tiles — only rendered for video media */}
          {post.isVideoMedia && post.videoViews > 0 && (
            <KPI label={post.mediaType === 'REEL' ? 'Reel plays' : 'Video plays'}
                 value={fmtCompact(post.videoViews)} Icon={Play} color="#8b5cf6"
                 sub={post.reach ? `${pct(post.videoViewRate)} play-through` : null} />
          )}
          {post.mediaType === 'REEL' && post.avgWatchSec > 0 && (
            <KPI label="Avg watch time" value={`${post.avgWatchSec.toFixed(1)}s`} Icon={Clock} color="#8b5cf6"
                 sub={post.totalWatchTimeSec ? `${fmtCompact(post.totalWatchTimeSec)}s total` : null} />
          )}

          {/* IMAGE / CAROUSEL tiles — only rendered for non-video IG media.
              `views` here is IG's scroll-past count, NOT a video metric. */}
          {post.platform === 'instagram' && !post.isVideoMedia && post.views > 0 && (
            <KPI label="Views" value={fmtCompact(post.views)} Icon={Eye} color="#06b6d4"
                 sub={`${pct(post.viewRate)} of reach`} />
          )}
          {post.platform === 'instagram' && !post.isVideoMedia && post.profileVisits > 0 && (
            <KPI label="Profile visits" value={fmtCompact(post.profileVisits)} Icon={Users} color="#3b82f6"
                 sub={post.follows ? `+${post.follows} follows` : null} />
          )}
          {post.platform === 'instagram' && !post.isVideoMedia && post.profileActivity > 0 && (
            <KPI label="Profile activity" value={fmtCompact(post.profileActivity)} Icon={Users} color="#3b82f6" sub="actions on profile" />
          )}
        </div>

        {/* Ads potential breakdown */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
            <Zap size={13} className="text-amber-400" />
            <div className="text-sm font-semibold text-white">Ads potential · {post.adsPotential?.score || 0}/100</div>
            {post.adsPotential?.thinData && <span className="text-[10px] text-amber-500">(thin data — low confidence)</span>}
          </div>
          <div className="p-3 space-y-1.5">
            {bp.map(b => {
              const col = SCORE_COLOR(Math.round(b.pctile * 100));
              const rawLabel = b.label === 'Avg watch time' ? `${(b.rawValue || 0).toFixed(1)}s`
                : b.label.toLowerCase().includes('rate') ? pct(b.rawValue)
                : b.label === '24h reach velocity' ? fmtCompact(b.rawValue)
                : b.label === 'Comment intent' ? `${b.rawValue} intent comments`
                : fmtCompact(b.rawValue);
              return (
                <div key={b.key} className="flex items-center gap-3 text-xs">
                  <div className="w-40 text-slate-400">{b.label}</div>
                  <div className="w-24 text-right font-mono text-slate-300">{rawLabel}</div>
                  <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden relative">
                    <div className="h-full" style={{ width: `${Math.round(b.pctile * 100)}%`, background: col }} />
                  </div>
                  <div className="w-20 text-right font-mono text-[10px] text-slate-500">p{Math.round(b.pctile * 100)}</div>
                  <div className="w-12 text-right font-mono font-semibold" style={{ color: col }}>
                    +{b.points.toFixed(1)}
                  </div>
                </div>
              );
            })}
            {post.adsPotential?.agePenalty > 0 && (
              <div className="flex items-center gap-3 text-xs text-red-400 border-t border-gray-800/50 pt-2 mt-2">
                <div className="w-40">Post-age penalty</div>
                <div className="flex-1 text-[10px] italic text-slate-500">Post is &gt;14d old without still-growing signal</div>
                <div className="w-12 text-right font-mono font-semibold">-{post.adsPotential.agePenalty.toFixed(1)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Ad objective recommendations */}
        {post.adObjectives && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
              <Flame size={13} className="text-amber-400" />
              <div className="text-sm font-semibold text-white">Ad opportunity by objective</div>
              {post.adObjectives.recommended && (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `${OBJECTIVE_META[post.adObjectives.recommended].color}33`, color: OBJECTIVE_META[post.adObjectives.recommended].color }}>
                  Recommended: {OBJECTIVE_META[post.adObjectives.recommended].label}
                </span>
              )}
            </div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
              {Object.entries(post.adObjectives.objectives).map(([k, obj]) => {
                const meta = OBJECTIVE_META[k];
                return (
                  <div key={k} className="rounded-lg p-3 border" style={{ background: `${meta.color}11`, borderColor: `${meta.color}44` }} title={meta.hint}>
                    <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: meta.color }}>{meta.label}</div>
                    <div className="text-2xl font-bold text-white">{obj.score}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{meta.hint}</div>
                    <div className="mt-2 space-y-0.5">
                      {obj.signals.slice(0, 3).map((s, i) => (
                        <div key={i} className="flex items-center gap-1 text-[9px] text-slate-500">
                          <span className="truncate">{s.label}</span>
                          <span className="ml-auto font-mono text-slate-400">{s.pctile !== undefined ? `p${Math.round(s.pctile * 100)}` : s.raw?.toString?.() || ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ad match card */}
        {post.adMatch && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-950/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpRight size={13} className="text-brand-400" />
              <div className="text-sm font-semibold text-brand-200">Already boosted</div>
            </div>
            <div className="text-[11px] text-slate-300 mb-2">{post.adMatch.adName}</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><div className="text-[9px] text-slate-500 uppercase">ROAS</div><div className="text-sm font-bold" style={{ color: (post.adMatch.roas || 0) >= 2 ? '#22c55e' : '#f59e0b' }}>{(post.adMatch.roas || 0).toFixed(2)}x</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase">Spend</div><div className="text-sm font-bold text-slate-200">₹{num(Math.round(post.adMatch.spend || 0))}</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase">Impr</div><div className="text-sm font-bold text-slate-200">{fmtCompact(post.adMatch.impressions)}</div></div>
              <div><div className="text-[9px] text-slate-500 uppercase">CTR</div><div className="text-sm font-bold text-slate-200">{pct(post.adMatch.ctr / 100)}</div></div>
            </div>
            {(post.adMatch.roas || 0) < 1.5 && (post.adsPotential?.score || 0) >= 60 && (
              <div className="mt-2 px-2 py-1.5 rounded bg-amber-900/30 border border-amber-800/50 text-[10px] text-amber-200">
                <strong>Mismatch:</strong> organic signals are strong but paid ROAS is weak — likely wrong audience or placement, not wrong creative.
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        {post.comments_detail?.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
              <MessageCircle size={13} className="text-slate-400" />
              <div className="text-sm font-semibold text-white">Top comments · {post.commentStats?.total}</div>
              <div className="ml-auto flex gap-1.5 text-[10px]">
                {post.commentStats?.intentCount > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">{post.commentStats.intentCount} intent</span>}
                {post.commentStats?.issueCount  > 0 && <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">{post.commentStats.issueCount} issues</span>}
                {post.commentStats?.ugcMentions > 0 && <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">{post.commentStats.ugcMentions} @mentions</span>}
              </div>
            </div>
            <div className="max-h-72 overflow-auto divide-y divide-gray-800/60">
              {post.comments_detail
                .sort((a, b) => Number(b.issue) + Number(b.intent) - Number(a.issue) - Number(a.intent) || b.likeCount - a.likeCount)
                .slice(0, 25)
                .map((c, i) => (
                  <div key={i} className="px-4 py-2 text-[11px]">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-slate-300 font-semibold">{c.username || 'user'}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-600 text-[10px]">{ageLabel(c.timestamp)}</span>
                      {c.intent && <span className="ml-auto px-1 py-0 rounded bg-emerald-900/40 text-emerald-300 text-[9px] font-semibold">INTENT</span>}
                      {c.issue  && <span className="ml-auto px-1 py-0 rounded bg-red-900/40 text-red-300 text-[9px] font-semibold">ISSUE</span>}
                      {c.ugcMention && <span className="px-1 py-0 rounded bg-purple-900/40 text-purple-300 text-[9px] font-semibold">UGC</span>}
                    </div>
                    <div className={clsx('text-slate-300', c.negative && !c.issue && 'text-slate-400')}>{c.text}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */

export default function SocialPosts() {
  const {
    brands, activeBrandIds, brandData, enrichedRows,
    socialPosts, socialPullStatus, socialPullError,
    setSocialPosts, setSocialPullStatus, appendLog,
  } = useStore();

  const active = brands.filter(b => activeBrandIds.includes(b.id));
  const [tab, setTab] = useState('feed');
  const [platform, setPlatform] = useState('all'); // all | instagram | facebook
  const [mediaFilter, setMediaFilter] = useState('all'); // all | REEL | IMAGE | VIDEO | CAROUSEL_ALBUM | STATUS
  const [search, setSearch] = useState('');
  const [openPost, setOpenPost] = useState(null);
  const [sinceDays, setSinceDays] = useState(90);
  const [pulling, setPulling] = useState(false);

  /* ── Combined post stream across active brands ───────────────── */
  const stream = useMemo(() => {
    const all = [];
    for (const b of active) {
      const bundle = socialPosts[b.id];
      if (!bundle?.posts?.length) continue;
      for (const p of bundle.posts) {
        all.push({ ...p, brandName: b.name, brandColor: b.color });
      }
    }
    return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [active, socialPosts]);

  /* ── Filtered for the Feed view ──────────────────────────────── */
  const filtered = useMemo(() => {
    let out = stream;
    if (platform !== 'all')   out = out.filter(p => p.platform === platform);
    if (mediaFilter !== 'all') out = out.filter(p => p.mediaType === mediaFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(p =>
        (p.caption || '').toLowerCase().includes(q) ||
        p.hashtags.some(h => h.includes(q)) ||
        p.mentions.some(m => m.includes(q))
      );
    }
    return out;
  }, [stream, platform, mediaFilter, search]);

  /* ── KPIs across stream ──────────────────────────────────────── */
  const kpis = useMemo(() => {
    const reach = stream.reduce((s, p) => s + (p.reach || 0), 0);
    const engs  = stream.reduce((s, p) => s + (p.totalInteractions || 0), 0);
    const saves = stream.reduce((s, p) => s + (p.saves || 0), 0);
    const reels = stream.filter(p => p.mediaType === 'REEL').length;
    const boosted = stream.filter(p => p.adMatch).length;
    return {
      posts: stream.length,
      reach, engs, saves, reels, boosted,
      engRate: reach > 0 ? engs / reach : 0,
    };
  }, [stream]);

  /* Media-mix — exact counts by platform × media type so the user
     can see instantly whether Meta actually returned any videos/reels
     or whether the account simply hasn't posted any in the window. */
  const mediaMix = useMemo(() => {
    const mix = {};
    for (const p of stream) {
      const key = `${p.platform}:${p.mediaType}`;
      mix[key] = (mix[key] || 0) + 1;
    }
    return mix;
  }, [stream]);

  /* ── Queues ──────────────────────────────────────────────────── */
  const boostCandidates = useMemo(() => pickBoostCandidates(stream, { limit: 15 }), [stream]);
  const mismatchedBoosts = useMemo(() => pickMismatchedBoosts(stream, { limit: 10 }), [stream]);
  const lateBloomers    = useMemo(() => pickLateBloomers(stream, { limit: 10 }), [stream]);

  /* ── DNA clusters ────────────────────────────────────────────── */
  const dna = useMemo(() => clusterContentDna(stream, { k: 5 }), [stream]);

  /* ── Cadence ─────────────────────────────────────────────────── */
  const cadence = useMemo(() => aggregateCadence(stream, { bucket: 'week' }), [stream]);

  /* ── Comment intelligence ────────────────────────────────────── */
  const commentFeed = useMemo(() => {
    const rows = [];
    for (const p of stream) {
      for (const c of (p.comments_detail || [])) {
        if (!c.intent && !c.issue && !c.ugcMention) continue;
        rows.push({ ...c, post: p });
      }
    }
    return rows.sort((a, b) =>
      Number(b.issue) - Number(a.issue) ||
      Number(b.intent) - Number(a.intent) ||
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }, [stream]);

  /* ── Pull handler ────────────────────────────────────────────── */
  const handlePull = async () => {
    if (pulling) return;
    setPulling(true);
    try {
      for (const b of active) {
        const cfg = b.social || {};
        const token = b.meta?.token;
        const apiVersion = b.meta?.apiVersion || 'v21.0';
        if (!token) { appendLog(`[${b.name}] Social pull skipped — no Meta token`); continue; }
        if (!cfg.igBusinessId && !cfg.fbPageId) { appendLog(`[${b.name}] Social pull skipped — no IG/FB ids (run Discover in Study Manual)`); continue; }
        setSocialPullStatus(b.id, 'loading');
        appendLog(`[${b.name}] Social pull starting…`);
        try {
          const chunks = [];
          const summarise = (platform, arr) => {
            const s = arr._stats;
            if (!s) { appendLog(`[${b.name}] ${platform}: ${arr.length} posts`); return; }
            // IG user diagnostics — critical for debugging "missing reels"
            if (s.igUser) {
              if (s.igUser.error) {
                appendLog(`[${b.name}] ${platform} account lookup FAILED: ${s.igUser.error}`);
              } else {
                appendLog(`[${b.name}] ${platform} account: @${s.igUser.username} · ${s.igUser.account_type || '?'} · media_count=${s.igUser.media_count ?? '?'} · followers=${s.igUser.followers_count ?? '?'}`);
              }
            }
            if (s.tokenSource) {
              appendLog(`[${b.name}] ${platform} token source: ${s.tokenSource}${s.tokenSource === 'user' ? ' (WARNING: Page token preferred — run Discover to capture it)' : ''}`);
            }
            if (s.suspiciousDelta && s.igUser?.media_count) {
              appendLog(`[${b.name}] ${platform} ⚠︎ Meta reports ${s.igUser.media_count} total media but /media returned only ${s.totalFetched} — token likely doesn't have full IG access. Regenerate with a Page Access Token.`);
            }
            const mixStr = s.byMediaType
              ? Object.entries(s.byMediaType).map(([k, v]) => `${k}:${v}`).join(', ')
              : '';
            const prodStr = s.byProductType
              ? Object.entries(s.byProductType).map(([k, v]) => `${k}:${v}`).join(', ')
              : '';
            appendLog(`[${b.name}] ${platform}: ${arr.length} posts · insights ok ${s.insightsOk}, fallback ${s.insightsFallback}, failed ${s.insightsFailed}`);
            if (mixStr)  appendLog(`[${b.name}] ${platform} media_type: ${mixStr}`);
            if (prodStr) appendLog(`[${b.name}] ${platform} media_product_type: ${prodStr}`);
            if (s.fromVideoEdge) appendLog(`[${b.name}] ${platform} /videos edge added ${s.fromVideoEdge} extra posts`);
            for (const err of (s.sampleErrors || []).slice(0, 3)) {
              appendLog(`[${b.name}] ${platform} err: ${err.firstError || err.fallbackError}`);
            }
          };
          if (cfg.igBusinessId) {
            appendLog(`[${b.name}] IG: fetching media + insights… (token=${cfg.pageAccessToken ? 'Page' : 'User'})`);
            // Pass the Page Access Token for IG calls — Meta docs recommend
            // this for all IG Business endpoints. User/System-User tokens
            // often return only a FEED subset, dropping reels.
            const ig = await pullInstagram({
              token,
              pageAccessToken: cfg.pageAccessToken,
              apiVersion,
              igUserId: cfg.igBusinessId,
              brandId: b.id,
              sinceDays,
              limit: 500,
            });
            chunks.push(...ig);
            summarise('IG', ig);
          }
          if (cfg.fbPageId && cfg.pageAccessToken) {
            appendLog(`[${b.name}] FB: fetching posts + insights…`);
            const fb = await pullFacebook({ pageAccessToken: cfg.pageAccessToken, apiVersion, pageId: cfg.fbPageId, brandId: b.id, sinceDays, limit: 200 });
            chunks.push(...fb);
            summarise('FB', fb);
          } else if (cfg.fbPageId) {
            appendLog(`[${b.name}] FB: skipped (no page access token — run Discover)`);
          }
          // Enrich in one pass (comments → baseline → score → ad match)
          const brandAdRows = enrichedRows.filter(r => {
            const bd = brandData[b.id];
            if (!bd) return false;
            // best-effort: if this ad came from this brand's accounts
            return bd.insights7d?.some(x => x.adId === r.adId) || bd.insights30d?.some(x => x.adId === r.adId);
          });
          const { posts, baseline } = enrichAllPosts(chunks, brandAdRows);
          setSocialPosts(b.id, { posts, baseline });
          setSocialPullStatus(b.id, 'success');
          appendLog(`[${b.name}] Social pull done — ${posts.length} posts scored.`);
        } catch (e) {
          setSocialPullStatus(b.id, 'error', e.message);
          appendLog(`[${b.name}] Social pull FAILED: ${e.message}`);
        }
      }
    } finally {
      setPulling(false);
    }
  };

  /* ── Empty state ─────────────────────────────────────────────── */
  if (!active.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-slate-500">
        Select an active brand to use Social Posts.
      </div>
    );
  }

  const configured = active.some(b => b.social?.igBusinessId || b.social?.fbPageId);

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Instagram size={16} className="text-pink-400" />
          <Facebook size={16} className="text-blue-400" />
          <h1 className="text-lg font-bold text-white">Social Posts</h1>
          <span className="text-[10px] text-slate-600">organic intel · per brand</span>
          {(() => {
            const bundles = active.map(b => socialPosts[b.id]).filter(Boolean);
            if (!bundles.length) return null;
            const latest = bundles.reduce((a, b) => (a.lastPullAt || 0) > (b.lastPullAt || 0) ? a : b);
            return (
              <span className="text-[10px] text-slate-500 bg-gray-800/60 px-2 py-0.5 rounded" title={new Date(latest.lastPullAt).toLocaleString()}>
                cached · updated {ageLabel(latest.lastPullAt)}
              </span>
            );
          })()}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-[10px] text-slate-500">Window</label>
          <select value={sinceDays} onChange={e => setSinceDays(Number(e.target.value))}
                  className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
            {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>Last {d}d</option>)}
          </select>
          <button
            onClick={handlePull}
            disabled={pulling || !configured}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600/30 hover:bg-brand-600/50 disabled:opacity-30 text-brand-200 border border-brand-700/40"
          >
            <RefreshCw size={11} className={pulling ? 'animate-spin' : ''} /> {pulling ? 'Pulling…' : stream.length ? 'Refresh' : 'Pull posts'}
          </button>
        </div>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-800/40 bg-amber-900/10 px-4 py-3 text-[12px] text-amber-200">
          No social accounts configured on active brands. Open <strong>Study Manual</strong>, find the brand's Meta block, and run <strong>Discover pages</strong> — it auto-fills the IG + FB IDs from your Meta token.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPI label="Posts"        value={num(kpis.posts)}      Icon={Layers}        color="#06b6d4" />
        <KPI label="Reach (sum)"  value={fmtCompact(kpis.reach)} Icon={Eye}         color="#06b6d4" />
        <KPI label="Engagement"   value={fmtCompact(kpis.engs)} Icon={Heart}        color="#ec4899" sub={pct(kpis.engRate)} />
        <KPI label="Saves"        value={fmtCompact(kpis.saves)} Icon={Bookmark}    color="#a855f7" />
        <KPI label="Reels"        value={num(kpis.reels)}      Icon={Play}          color="#8b5cf6" />
        <KPI label="Boosted"      value={num(kpis.boosted)}    Icon={ArrowUpRight}  color="#22c55e" sub={`${kpis.posts ? pct(kpis.boosted / kpis.posts) : '0.0%'} of posts`} />
        <KPI label="Boost queue"  value={num(boostCandidates.length)} Icon={Flame}  color="#f59e0b" sub={mismatchedBoosts.length ? `${mismatchedBoosts.length} mismatched` : null} />
      </div>

      {/* Media mix — shows exactly what Meta returned by platform × type.
          If you expected videos/reels and this shows 0, Meta's not
          returning them (account state / date window / product_type) —
          not a filter. */}
      {stream.length > 0 && (
        <div className="flex items-center flex-wrap gap-2 text-[10px] text-slate-500 px-1">
          <span className="text-slate-600">Media mix:</span>
          {Object.entries(mediaMix)
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => {
              const [plat, type] = key.split(':');
              return (
                <button
                  key={key}
                  onClick={() => { setPlatform(plat); setMediaFilter(type); setTab('feed'); }}
                  className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-slate-300 flex items-center gap-1"
                  title={`Filter to ${plat} ${type}`}
                >
                  <PlatformIcon platform={plat} size={9} />
                  <span className="font-mono">{type}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-semibold text-white">{n}</span>
                </button>
              );
            })}
          {!Object.keys(mediaMix).some(k => k.includes(':REEL') || k.includes(':VIDEO')) && (
            <span className="text-amber-400">
              No reels/videos in the pulled window — widen the window above to Last 365d and Refresh.
            </span>
          )}
        </div>
      )}

      {/* Priority queues row */}
      {stream.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <QueueCard title="Boost candidates" Icon={Flame} color="#f59e0b" posts={boostCandidates} emptyLabel="No organic winners pending a boost." onOpen={setOpenPost} />
          <QueueCard title="Late bloomers"    Icon={TrendingUp} color="#22c55e" posts={lateBloomers}   emptyLabel="No posts are still growing past day 3." onOpen={setOpenPost} />
          <QueueCard title="Mismatched boosts" Icon={AlertTriangle} color="#ef4444" posts={mismatchedBoosts} emptyLabel="No paid underperformers with strong organic." onOpen={setOpenPost} />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 gap-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 py-1.5">
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded px-2 py-1">
            <Search size={10} className="text-slate-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="caption, #tag, @mention…"
              className="bg-transparent text-[11px] text-slate-200 w-44 ml-1 outline-none placeholder:text-slate-600" />
          </div>
          <select value={platform} onChange={e => setPlatform(e.target.value)}
                  className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
            <option value="all">All platforms</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </select>
          <select value={mediaFilter} onChange={e => setMediaFilter(e.target.value)}
                  className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
            <option value="all">All types</option>
            <option value="REEL">Reels</option>
            <option value="VIDEO">Video</option>
            <option value="IMAGE">Image</option>
            <option value="CAROUSEL_ALBUM">Carousel</option>
            <option value="STATUS">Status</option>
          </select>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'feed' && (
        <div>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-sm text-slate-500">
              {stream.length === 0
                ? 'No posts yet — hit Pull posts above.'
                : 'No posts match your filters.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3">
              {filtered.slice(0, 300).map(p => (
                <PostCard key={`${p.brandId}:${p.id}`} post={p} onOpen={setOpenPost} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'boost' && (
        <div className="space-y-4">
          <QueueTable
            title={`Boost candidates (${boostCandidates.length})`}
            subtitle="Top organic performers we haven't put ad spend behind yet — ranked by the transparent ads-potential score."
            posts={boostCandidates}
            onOpen={setOpenPost}
          />
          <QueueTable
            title={`Already boosted, underperforming (${mismatchedBoosts.length})`}
            subtitle="Strong organic but weak paid ROAS — creative is fine, audience/placement probably isn't."
            posts={mismatchedBoosts}
            onOpen={setOpenPost}
            showMismatch
          />
          <QueueTable
            title={`Late bloomers (${lateBloomers.length})`}
            subtitle="Posts still picking up reach past day 3 — algorithm is favoring them, good ad candidates."
            posts={lateBloomers}
            onOpen={setOpenPost}
          />
        </div>
      )}

      {tab === 'comments' && (
        <CommentsTab rows={commentFeed} posts={stream} onOpenPost={setOpenPost} />
      )}

      {tab === 'trends' && (
        <TrendsTab posts={stream} />
      )}

      {tab === 'patterns' && (
        <PatternsTab posts={stream} onOpenPost={setOpenPost} />
      )}

      {tab === 'dna' && (
        <DnaTab dna={dna} onOpenPost={setOpenPost} />
      )}

      {tab === 'cadence' && (
        <CadenceTab cadence={cadence} />
      )}

      <PostDrawer post={openPost} onClose={() => setOpenPost(null)} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */

function QueueCard({ title, Icon, color, posts, emptyLabel, onOpen }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800/60 flex items-center gap-2">
        <Icon size={12} style={{ color }} />
        <div className="text-[11px] font-semibold text-white">{title}</div>
        <span className="ml-auto px-1.5 py-0.5 rounded bg-gray-800 text-slate-400 text-[10px] font-mono">{posts.length}</span>
      </div>
      <div className="divide-y divide-gray-800/60 max-h-[260px] overflow-auto">
        {posts.length === 0 && (
          <div className="px-4 py-6 text-[11px] text-slate-600 italic">{emptyLabel}</div>
        )}
        {posts.slice(0, 6).map(p => (
          <button key={p.id} onClick={() => onOpen(p)}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-800/40 transition-colors">
            {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-10 h-10 object-cover rounded flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-200 truncate">{p.caption || <span className="italic text-slate-600">no caption</span>}</div>
              <div className="text-[9px] text-slate-500 flex items-center gap-2 mt-0.5">
                <PlatformIcon platform={p.platform} size={8} />
                <span>{fmtCompact(p.reach)} reach</span>
                <span>·</span>
                <span>{ageLabel(p.timestamp)}</span>
              </div>
            </div>
            <ScoreBadge score={p.adsPotential?.score || 0} thin={p.adsPotential?.thinData} />
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueTable({ title, subtitle, posts, onOpen, showMismatch }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800/60">
        <div className="text-sm font-semibold text-white">{title}</div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {posts.length === 0 ? (
        <div className="px-4 py-8 text-[12px] text-slate-600 italic text-center">Nothing here.</div>
      ) : (
        <div className="divide-y divide-gray-800/60">
          {posts.map(p => (
            <button key={p.id} onClick={() => onOpen(p)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-800/30 transition-colors">
              {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="w-12 h-12 object-cover rounded flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-200 truncate">{p.caption || <span className="italic text-slate-600">no caption</span>}</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-1">
                  <PlatformIcon platform={p.platform} size={9} />
                  <span>{p.mediaType}</span>
                  <span>·</span>
                  <span>{ageLabel(p.timestamp)}</span>
                  <span>·</span>
                  <span>{fmtCompact(p.reach)} reach</span>
                  <span>·</span>
                  <span>{pct(p.saveRate)} saves</span>
                  <span>·</span>
                  <span>{pct(p.engagementRate)} eng</span>
                </div>
              </div>
              {showMismatch && p.adMatch && (
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">Paid ROAS</div>
                  <div className="text-sm font-bold text-red-400">{(p.adMatch.roas || 0).toFixed(2)}x</div>
                </div>
              )}
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Score</div>
                <ScoreBadge score={p.adsPotential?.score || 0} thin={p.adsPotential?.thinData} />
              </div>
              <ChevronRight size={14} className="text-slate-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SEVERITY_META = {
  4: { label: 'Critical', color: '#dc2626', bg: 'bg-red-900/40', text: 'text-red-200' },
  3: { label: 'High',     color: '#ef4444', bg: 'bg-red-900/25', text: 'text-red-300' },
  2: { label: 'Medium',   color: '#f59e0b', bg: 'bg-amber-900/25', text: 'text-amber-300' },
  1: { label: 'Low',      color: '#eab308', bg: 'bg-yellow-900/25', text: 'text-yellow-300' },
};

const LANG_META = {
  en:       { label: 'English',  color: '#60a5fa' },
  hi:       { label: 'Hindi',    color: '#a78bfa' },
  hinglish: { label: 'Hinglish', color: '#fb923c' },
  other:    { label: 'Other',    color: '#64748b' },
};

function CommentsTab({ rows, posts, onOpenPost }) {
  // Summaries by category
  const summary = useMemo(() => {
    const s = {
      issues: {}, intents: {}, ugc: {}, lang: {}, severity: { 1: 0, 2: 0, 3: 0, 4: 0 },
      spam: 0, positive: 0, negative: 0, total: 0, critical: 0,
    };
    for (const p of posts) {
      const cs = p.commentStats || {};
      s.total    += cs.total || 0;
      s.spam     += cs.spamCount || 0;
      s.positive += cs.positive || 0;
      s.negative += cs.negative || 0;
      for (const sev of [1, 2, 3, 4]) s.severity[sev] += cs.issueBySeverity?.[sev] || 0;
      s.critical += cs.issueBySeverity?.[4] || 0;
      for (const [k, v] of Object.entries(cs.issueByKey  || {})) s.issues[k]  = (s.issues[k]  || 0) + v;
      for (const [k, v] of Object.entries(cs.intentByKey || {})) s.intents[k] = (s.intents[k] || 0) + v;
      for (const [k, v] of Object.entries(cs.ugcByKey    || {})) s.ugc[k]     = (s.ugc[k]     || 0) + v;
      for (const [k, v] of Object.entries(cs.langByKey   || {})) s.lang[k]    = (s.lang[k]    || 0) + v;
    }
    return s;
  }, [posts]);

  const topics = useMemo(() => extractTopics(posts, { k: 15, minCount: 2 }), [posts]);

  const critical  = rows.filter(r => r.issueDeep?.severity === 4).sort((a, b) => (b.issueDeep?.confidence || 0) - (a.issueDeep?.confidence || 0));
  const high      = rows.filter(r => r.issueDeep?.severity === 3);
  const medium    = rows.filter(r => r.issueDeep?.severity === 2);
  const lowIssues = rows.filter(r => r.issueDeep?.severity === 1);
  const purchase  = rows.filter(r => r.intentDeep?.key === 'purchase_intent' && !r.issueDeep);
  const pricey    = rows.filter(r => r.intentDeep?.key === 'price' && !r.issueDeep);
  const linkReqs  = rows.filter(r => r.intentDeep?.key === 'link' && !r.issueDeep);
  const sizeQs    = rows.filter(r => r.intentDeep?.key === 'size' && !r.issueDeep);
  const availQs   = rows.filter(r => r.intentDeep?.key === 'availability' && !r.issueDeep);
  const dmQs      = rows.filter(r => r.intentDeep?.key === 'dm' && !r.issueDeep);
  const ugcTag    = rows.filter(r => r.ugcDeep?.some(u => u.key === 'tag_friend'));
  const advocacy  = rows.filter(r => r.ugcDeep?.some(u => u.key === 'advocacy'));
  const competitor= rows.filter(r => r.ugcDeep?.some(u => u.key === 'competitor_mention'));

  return (
    <div className="space-y-4">
      {/* Overview strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        <KPI label="Critical"    value={num(summary.severity[4])} color="#dc2626" Icon={AlertTriangle} sub="severity 4" />
        <KPI label="High issues" value={num(summary.severity[3])} color="#ef4444" sub="severity 3" />
        <KPI label="Medium"      value={num(summary.severity[2])} color="#f59e0b" sub="severity 2" />
        <KPI label="Purchase intent" value={num(purchase.length)} color="#22c55e" />
        <KPI label="Link/DM"     value={num(linkReqs.length + dmQs.length)} color="#06b6d4" />
        <KPI label="Spam filtered" value={num(summary.spam)} color="#64748b" />
      </div>

      {/* Issue category breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <CategoryCard title="Issues by category" data={summary.issues} colorBy="#ef4444" />
        <CategoryCard title="Intent by category" data={summary.intents} colorBy="#22c55e" />
        <CategoryCard title="UGC by category"    data={summary.ugc}     colorBy="#a855f7" />
      </div>

      {/* Language + sentiment strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
          <div className="text-[11px] font-semibold text-slate-300 mb-2">Language mix</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(summary.lang).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
              const meta = LANG_META[k] || LANG_META.other;
              return (
                <div key={k} className="px-2 py-1 rounded" style={{ background: `${meta.color}22`, color: meta.color }}>
                  <span className="text-[10px] font-semibold">{meta.label}</span>
                  <span className="text-sm font-bold ml-1">{num(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
          <div className="text-[11px] font-semibold text-slate-300 mb-2">Sentiment balance</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden relative">
              {(() => {
                const t = summary.positive + summary.negative;
                if (t === 0) return <div className="w-full h-full bg-slate-700" />;
                return (
                  <>
                    <div className="h-full" style={{ width: `${(summary.positive / t) * 100}%`, background: '#22c55e' }} />
                    <div className="h-full" style={{ width: `${(summary.negative / t) * 100}%`, background: '#ef4444', position: 'absolute', right: 0, top: 0 }} />
                  </>
                );
              })()}
            </div>
            <span className="text-[10px] text-emerald-400 font-mono">+{num(summary.positive)}</span>
            <span className="text-[10px] text-red-400 font-mono">-{num(summary.negative)}</span>
          </div>
        </div>
      </div>

      {/* Trending topics */}
      {topics.topics.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
          <div className="text-[11px] font-semibold text-slate-300 mb-2 flex items-center gap-2">
            <Hash size={11} /> Trending topics in comments
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topics.topics.map(t => (
              <span key={t.phrase} className="text-[10px] px-2 py-1 rounded bg-gray-800 text-slate-300 font-mono">
                {t.phrase} <span className="text-slate-500">· {t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Issue severity triage */}
      <CommentSection title={`🚨 Critical · ${critical.length}`} subtitle="Severity 4 — allergy, fraud, not-received with strong negative sentiment. Escalate immediately." rows={critical} onOpenPost={onOpenPost} color="#dc2626" showCategory />
      <CommentSection title={`High severity · ${high.length}`} subtitle="Severity 3 — damaged, not-received, wrong item, payment issues. Action this week." rows={high} onOpenPost={onOpenPost} color="#ef4444" showCategory />
      <CommentSection title={`Medium / low · ${medium.length + lowIssues.length}`} subtitle="Quality complaints, size issues, support frustration." rows={[...medium, ...lowIssues]} onOpenPost={onOpenPost} color="#f59e0b" showCategory />

      {/* High-conversion intent triage */}
      <CommentSection title={`💰 Purchase intent · ${purchase.length}`}   subtitle="'Ordering', 'need this', 'just bought' — warm leads." rows={purchase} onOpenPost={onOpenPost} color="#22c55e" showCategory />
      <CommentSection title={`💵 Price questions · ${pricey.length}`}     subtitle="Someone asking how much — reply with link + price to close." rows={pricey} onOpenPost={onOpenPost} color="#14b8a6" showCategory />
      <CommentSection title={`🔗 Link requests · ${linkReqs.length}`}     subtitle="Send the link — these posts are high-conversion-ad candidates." rows={linkReqs} onOpenPost={onOpenPost} color="#06b6d4" showCategory />
      <CommentSection title={`📐 Size / variant · ${sizeQs.length}`}      subtitle="Answer the spec — closes the loop on consideration." rows={sizeQs} onOpenPost={onOpenPost} color="#3b82f6" showCategory />
      <CommentSection title={`📦 Availability · ${availQs.length}`}       subtitle="Out-of-stock signals — procurement + reshipment cadence." rows={availQs} onOpenPost={onOpenPost} color="#8b5cf6" showCategory />
      <CommentSection title={`📮 DM requests · ${dmQs.length}`}           subtitle="Wants a direct message — unified-inbox lead." rows={dmQs} onOpenPost={onOpenPost} color="#ec4899" showCategory />

      {/* UGC */}
      <CommentSection title={`🤝 Tag-a-friend · ${ugcTag.length}`}     subtitle="Organic amplification — affiliate/creator candidates." rows={ugcTag} onOpenPost={onOpenPost} color="#a855f7" showCategory />
      <CommentSection title={`⭐ Brand advocacy · ${advocacy.length}`} subtitle="'Best brand', 'repeat customer' — testimonials, case-study fodder." rows={advocacy} onOpenPost={onOpenPost} color="#f472b6" showCategory />
      <CommentSection title={`🆚 Competitor mentions · ${competitor.length}`} subtitle="People naming competitors — positioning insight." rows={competitor} onOpenPost={onOpenPost} color="#64748b" showCategory />
    </div>
  );
}

function CategoryCard({ title, data, colorBy }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(x => x[1]));
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800/60 text-[11px] font-semibold text-slate-300">{title}</div>
      <div className="p-3 space-y-1">
        {entries.length === 0 && <div className="text-[10px] text-slate-600 italic">None detected.</div>}
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[11px]">
            <div className="w-28 text-slate-400 truncate">{k.replace(/_/g, ' ')}</div>
            <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
              <div className="h-full" style={{ width: `${(v / max) * 100}%`, background: colorBy }} />
            </div>
            <div className="w-8 text-right font-mono text-slate-300">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommentSection({ title, subtitle, rows, onOpenPost, color, showCategory }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <div className="text-sm font-semibold text-white">{title}</div>
        </div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="divide-y divide-gray-800/60 max-h-[420px] overflow-auto">
        {rows.slice(0, 200).map((c, i) => {
          const sev = c.issueDeep ? SEVERITY_META[c.issueDeep.severity] : null;
          const lang = LANG_META[c.lang] || LANG_META.other;
          return (
            <div key={i} className="px-3 py-2 flex items-start gap-2 hover:bg-gray-800/30 transition-colors">
              <button onClick={() => onOpenPost(c.post)} className="flex-shrink-0">
                {c.post.thumbnailUrl && <img src={c.post.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="w-10 h-10 object-cover rounded" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 flex-wrap">
                  <span className="text-slate-300 font-semibold">{c.username}</span>
                  <span>·</span>
                  <span>{ageLabel(c.timestamp)}</span>
                  <span className="px-1 py-0 rounded text-[9px] font-mono" style={{ background: `${lang.color}22`, color: lang.color }}>{c.lang}</span>
                  {showCategory && c.issueDeep && (
                    <span className={clsx('px-1.5 py-0 rounded text-[9px] font-semibold', sev.bg, sev.text)}>
                      {c.issueDeep.label} · sev {c.issueDeep.severity}
                    </span>
                  )}
                  {showCategory && c.intentDeep && !c.issueDeep && (
                    <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-emerald-900/40 text-emerald-300">
                      {c.intentDeep.label}
                    </span>
                  )}
                  {showCategory && c.ugcDeep?.[0] && !c.issueDeep && !c.intentDeep && (
                    <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-purple-900/40 text-purple-300">
                      {c.ugcDeep[0].label}
                    </span>
                  )}
                  {c.post.permalink && (
                    <a href={c.post.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
                      <ExternalLink size={9} /> open
                    </a>
                  )}
                </div>
                <div className="text-[12px] text-slate-200 mt-0.5">{c.text}</div>
                {c.sentiment && c.sentiment.intensity > 0.3 && (
                  <div className="text-[9px] mt-0.5" style={{ color: c.sentiment.polarity > 0 ? '#22c55e' : '#ef4444' }}>
                    {c.sentiment.polarity > 0 ? '▲' : '▼'} sentiment {c.sentiment.polarity > 0 ? '+' : ''}{c.sentiment.polarity.toFixed(2)} · intensity {c.sentiment.intensity.toFixed(2)}
                  </div>
                )}
                <button onClick={() => onOpenPost(c.post)} className="text-[10px] text-slate-500 hover:text-slate-300 mt-1 truncate block max-w-full text-left">
                  on: {c.post.caption?.slice(0, 80) || c.post.mediaType}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═════ TRENDS TAB ════════════════════════════════════════════════ */
function TrendsTab({ posts }) {
  const [bucket, setBucket] = useState('day');
  const [metric, setMetric] = useState('reach');
  const series = useMemo(() => buildTrendSeries(posts, { bucket }), [posts, bucket]);

  const metrics = [
    { key: 'reach',          label: 'Reach',           color: '#06b6d4' },
    { key: 'engagement',     label: 'Engagement',      color: '#ec4899' },
    { key: 'saves',          label: 'Saves',           color: '#a855f7' },
    { key: 'engagementRate', label: 'Engagement rate', color: '#22c55e', isRate: true },
    { key: 'saveRate',       label: 'Save rate',       color: '#8b5cf6', isRate: true },
    { key: 'issues',         label: 'Issues',          color: '#ef4444' },
    { key: 'intent',         label: 'Intent',          color: '#14b8a6' },
    { key: 'sentiment',      label: 'Sentiment',       color: '#f59e0b' },
  ];
  const active = metrics.find(m => m.key === metric) || metrics[0];
  const vals = series.map(r => r[metric] || 0);
  const maxV = Math.max(1, ...vals);
  const minV = Math.min(0, ...vals);
  const range = Math.max(Math.abs(maxV), Math.abs(minV));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[11px] text-slate-500">Bucket</div>
        {['day', 'week', 'month'].map(b => (
          <button key={b} onClick={() => setBucket(b)}
            className={clsx('px-2 py-1 text-[11px] rounded border',
              bucket === b ? 'bg-brand-600/30 border-brand-600/60 text-brand-200' : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
            {b}
          </button>
        ))}
        <div className="ml-4 text-[11px] text-slate-500">Metric</div>
        <select value={metric} onChange={e => setMetric(e.target.value)}
                className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
          {metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      {/* Main time-series chart */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="text-sm font-semibold text-white mb-3">{active.label} over time</div>
        {series.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No data in the current window.</div>
        ) : (
          <div className="relative">
            <div className="flex items-end gap-[2px] h-56 overflow-x-auto">
              {series.map((row, i) => {
                const v = row[metric] || 0;
                const h = range > 0 ? Math.abs(v) / range * 100 : 0;
                const isNeg = v < 0;
                const rawLabel = active.isRate ? pct(v) : fmtCompact(v);
                return (
                  <div key={row.key} className="flex flex-col items-center gap-0.5 min-w-[18px] group"
                       title={`${row.key}\n${active.label}: ${rawLabel}\nPosts: ${row.posts}`}>
                    {!isNeg && <div className="flex-1" />}
                    <div className="w-3 rounded-t transition-all group-hover:opacity-80"
                         style={{ height: `${h}%`, background: active.color, minHeight: v !== 0 ? '2px' : 0 }} />
                    {isNeg && <div className="flex-1" />}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[9px] text-slate-600 font-mono">
              <span>{series[0]?.key}</span>
              <span>{series[series.length - 1]?.key}</span>
            </div>
          </div>
        )}
      </div>

      {/* Mini multi-series */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {['reach', 'engagement', 'saves', 'issues'].map(m => {
          const meta = metrics.find(x => x.key === m);
          const mvals = series.map(r => r[m] || 0);
          const mmax = Math.max(1, ...mvals);
          const total = mvals.reduce((s, v) => s + v, 0);
          return (
            <div key={m} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="font-semibold text-slate-300">{meta.label}</span>
                <span className="text-slate-500 font-mono">Σ {fmtCompact(total)}</span>
              </div>
              <div className="flex items-end gap-[1px] h-12">
                {series.map((row, i) => (
                  <div key={row.key} className="flex-1 rounded-t" style={{ height: `${((row[m] || 0) / mmax) * 100}%`, background: meta.color, minHeight: row[m] ? '1px' : 0 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═════ PATTERNS TAB ══════════════════════════════════════════════ */
const PATTERN_DIMS = [
  { key: 'platform',       label: 'Platform' },
  { key: 'mediaType',      label: 'Media type' },
  { key: 'dayOfWeek',      label: 'Day of week' },
  { key: 'hourBucket',     label: 'Hour bucket' },
  { key: 'captionLength',  label: 'Caption length' },
  { key: 'hashtagDensity', label: 'Hashtag density' },
  { key: 'hasVideo',       label: 'Video vs static' },
  { key: 'boostStatus',    label: 'Boost status' },
  { key: 'sentiment',      label: 'Comment sentiment' },
];

const PATTERN_METRICS = [
  { key: 'engagementRate',   label: 'Engagement rate', format: v => pct(v) },
  { key: 'saveRate',         label: 'Save rate',       format: v => pct(v) },
  { key: 'avgAdsPotential',  label: 'Avg ads potential', format: v => Math.round(v) + '' },
  { key: 'reach',            label: 'Reach (sum)',     format: v => fmtCompact(v) },
  { key: 'issues',           label: 'Issues (sum)',    format: v => String(v) },
  { key: 'intent',           label: 'Intent (sum)',    format: v => String(v) },
];

function PatternsTab({ posts, onOpenPost }) {
  const [rowKey, setRowKey] = useState('mediaType');
  const [colKey, setColKey] = useState('dayOfWeek');
  const [metric, setMetric] = useState('engagementRate');
  const cross = useMemo(() => buildSocialCrossMatrix(posts, rowKey, colKey, { minPosts: 2 }), [posts, rowKey, colKey]);

  const active = PATTERN_METRICS.find(m => m.key === metric);

  // Build color scale from cell values
  const values = Object.values(cross.matrix).filter(c => !c.belowThreshold).map(c => c[metric] || 0);
  const maxV = Math.max(...values, 0.0001);
  const minV = Math.min(...values, 0);
  const range = maxV - minV || 1;

  const cellColor = v => {
    const t = (v - minV) / range;
    // viridis-ish: blue → cyan → green → yellow
    const r = Math.round(68 * (1 - t) + 240 * t);
    const g = Math.round(1 * (1 - t) + 200 * t);
    const b = Math.round(84 * (1 - t) + 20 * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-slate-500">Row</span>
        <select value={rowKey} onChange={e => setRowKey(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
          {PATTERN_DIMS.map(d => <option key={d.key} value={d.key} disabled={d.key === colKey}>{d.label}</option>)}
        </select>
        <span className="text-slate-500 ml-2">×</span>
        <span className="text-slate-500 ml-2">Col</span>
        <select value={colKey} onChange={e => setColKey(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
          {PATTERN_DIMS.map(d => <option key={d.key} value={d.key} disabled={d.key === rowKey}>{d.label}</option>)}
        </select>
        <span className="text-slate-500 ml-4">Cell metric</span>
        <select value={metric} onChange={e => setMetric(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-slate-200">
          {PATTERN_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60">
          <div className="text-sm font-semibold text-white">
            {PATTERN_DIMS.find(d => d.key === rowKey)?.label} × {PATTERN_DIMS.find(d => d.key === colKey)?.label}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Cell colour = {active.label}. Darker = lower; brighter = higher. Click any cell to filter the feed to that slice.
          </div>
        </div>
        <div className="p-3 overflow-auto" style={{ maxHeight: '620px' }}>
          {cross.rowKeys.length === 0 || cross.colKeys.length === 0 ? (
            <div className="text-xs text-slate-500 italic">Not enough data for that combo.</div>
          ) : (
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-gray-900 z-10 px-2 py-1 text-left text-[10px] text-slate-500 uppercase tracking-wider min-w-[140px]" />
                  {cross.colKeys.map(c => (
                    <th key={c} className="px-2 py-1 text-left text-[10px] text-slate-400 font-semibold min-w-[100px]">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cross.rowKeys.map(r => (
                  <tr key={r}>
                    <td className="sticky left-0 bg-gray-900 z-10 px-2 py-1 text-slate-300 font-medium">{r}</td>
                    {cross.colKeys.map(c => {
                      const cell = cross.matrix[`${r}|||${c}`];
                      if (!cell) return <td key={c} className="px-2 py-1"><span className="text-slate-700">·</span></td>;
                      if (cell.belowThreshold) {
                        return (
                          <td key={c} className="p-0">
                            <div className="px-2 py-2 text-center font-mono min-w-[100px] bg-gray-800/40 text-slate-600">
                              <div className="text-[10px]">{cell.posts} post</div>
                            </div>
                          </td>
                        );
                      }
                      const v = cell[metric] || 0;
                      return (
                        <td key={c} className="p-0">
                          <div
                            style={{ background: cellColor(v), color: v > (minV + range * 0.5) ? '#111' : '#fff' }}
                            className="px-2 py-2 text-center font-mono min-w-[100px] cursor-default"
                            title={`${r} × ${c}\n${active.label}: ${active.format(v)}\nPosts: ${cell.posts}\nReach: ${fmtCompact(cell.reach)}\nEngagement: ${fmtCompact(cell.engagement)}\nSaves: ${fmtCompact(cell.saves)}\nAvg potential: ${Math.round(cell.avgAdsPotential)}\nIssues: ${cell.issues} · Intent: ${cell.intent}`}
                          >
                            <div className="font-bold text-sm">{active.format(v)}</div>
                            <div className="text-[10px] opacity-80">{cell.posts} posts</div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DnaTab({ dna, onOpenPost }) {
  if (!dna.clusters.length) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-sm text-slate-500">
        Need at least ~10 posts to cluster into content types. Pull more data.
      </div>
    );
  }
  const sorted = dna.clusters.map((c, i) => ({ ...c, idx: i }))
    .filter(c => c.metrics?.count)
    .sort((a, b) => (b.metrics.avgAdsPotential || 0) - (a.metrics.avgAdsPotential || 0));
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">
        Auto-clustered by caption + hashtag TF-IDF. Each cluster's average ads-potential score tells you which content DNA to brief more of.
      </div>
      {sorted.map(c => (
        <div key={c.idx} className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-3 flex-wrap">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Cluster {c.idx + 1}</div>
            <div className="flex flex-wrap gap-1">
              {c.topTerms.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-slate-300 font-mono">{t}</span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3 text-[11px]">
              <span className="text-slate-400">{c.metrics.count} posts</span>
              <span className="text-slate-400">eng <span className="text-slate-200 font-mono">{pct(c.metrics.avgEngagement)}</span></span>
              <span className="text-slate-400">saves <span className="text-slate-200 font-mono">{pct(c.metrics.avgSaveRate)}</span></span>
              <span className="text-slate-400">reach <span className="text-slate-200 font-mono">{fmtCompact(c.metrics.avgReach)}</span></span>
              <ScoreBadge score={Math.round(c.metrics.avgAdsPotential || 0)} />
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-1 p-1">
            {c.posts.slice(0, 16).map(p => (
              <button key={p.id} onClick={() => onOpenPost(p)}
                      className="aspect-square bg-gray-800 hover:opacity-80 transition-opacity rounded overflow-hidden">
                {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CadenceTab({ cadence }) {
  const maxDow = Math.max(1, ...cadence.byDayOfWeek.map(d => d.count));
  const maxHour = Math.max(1, ...cadence.byHour.map(h => h.count));
  const maxDowEng = Math.max(1, ...cadence.byDayOfWeek.map(d => d.avgEngagement));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60 text-sm font-semibold text-white">Posts per day of week</div>
        <div className="p-4 space-y-2">
          {cadence.byDayOfWeek.map(d => (
            <div key={d.dow} className="flex items-center gap-3 text-[11px]">
              <div className="w-10 text-slate-400">{d.label}</div>
              <div className="w-8 text-right text-slate-500 font-mono">{d.count}</div>
              <div className="flex-1 h-4 rounded bg-gray-800 overflow-hidden">
                <div className="h-full" style={{ width: `${(d.count / maxDow) * 100}%`, background: '#06b6d4' }} />
              </div>
              <div className="w-16 text-right text-slate-500 text-[10px]">{fmtCompact(d.avgEngagement)} eng</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/60 text-sm font-semibold text-white">Posts per hour (UTC)</div>
        <div className="p-4 flex items-end gap-[2px] h-56">
          {cadence.byHour.map(h => {
            const barH = (h.count / maxHour) * 100;
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.hour}:00 · ${h.count} posts · ${fmtCompact(h.avgEngagement)} avg eng`}>
                <div className="w-full" style={{ height: `${barH}%`, background: '#06b6d4', opacity: 0.3 + (h.avgEngagement / maxDowEng) * 0.7, borderRadius: '2px 2px 0 0', minHeight: h.count ? '2px' : 0 }} />
                <div className="text-[8px] text-slate-600 font-mono">{h.hour}</div>
              </div>
            );
          })}
        </div>
        <div className="px-4 pb-3 text-[10px] text-slate-500">Bar height = post count · opacity = avg engagement.</div>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden lg:col-span-2">
        <div className="px-4 py-3 border-b border-gray-800/60 text-sm font-semibold text-white">Weekly cadence</div>
        <div className="p-4 flex items-end gap-1 h-40 overflow-auto">
          {cadence.series.length === 0 && <div className="text-xs text-slate-600 italic">Not enough data.</div>}
          {cadence.series.map(w => {
            const max = Math.max(...cadence.series.map(x => x.count)) || 1;
            return (
              <div key={w.key} className="flex flex-col items-center gap-1 min-w-[24px]" title={`${w.key} · ${w.count} posts`}>
                <div className="w-4 rounded-t" style={{ height: `${(w.count / max) * 100}%`, background: '#a855f7', minHeight: '2px' }} />
                <div className="text-[8px] text-slate-600 font-mono rotate-90 origin-left whitespace-nowrap" style={{ marginTop: '10px' }}>{w.key}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
