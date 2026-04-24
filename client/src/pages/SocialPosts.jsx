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
  { id: 'feed',     label: 'Feed',         icon: Layers },
  { id: 'boost',    label: 'Boost queue',  icon: Flame },
  { id: 'comments', label: 'Comments',     icon: MessageCircle },
  { id: 'dna',      label: 'Content DNA',  icon: Sparkles },
  { id: 'cadence',  label: 'Cadence',      icon: Calendar },
];

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
  const hasVideo = ['VIDEO','REEL'].includes(post.mediaType) || post.videoViews > 0;
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

        {/* Metrics tile grid */}
        <div className="grid grid-cols-4 gap-2">
          <KPI label="Reach"      value={fmtCompact(post.reach)}        Icon={Eye}           color="#06b6d4" />
          <KPI label="Engagement" value={pct(post.engagementRate)}      Icon={Heart}         color="#ec4899" sub={`${fmtCompact(post.totalInteractions)} total`} />
          <KPI label="Save rate"  value={pct(post.saveRate)}            Icon={Bookmark}      color="#a855f7" sub={`${fmtCompact(post.saves)} saves`} />
          <KPI label="Share rate" value={pct(post.shareRate)}           Icon={Share2}        color="#22c55e" sub={`${fmtCompact(post.shares)} shares`} />
          <KPI label="Comments"   value={fmtCompact(post.comments)}     Icon={MessageCircle} color="#f59e0b" />
          <KPI label="Likes"      value={fmtCompact(post.likes)}        Icon={Heart}         color="#ef4444" />
          {post.videoViews > 0 && <KPI label="Video views" value={fmtCompact(post.videoViews)} Icon={Play} color="#8b5cf6" sub={post.avgWatchSec ? `avg ${post.avgWatchSec.toFixed(1)}s` : null} />}
          {post.profileVisits > 0 && <KPI label="Profile visits" value={fmtCompact(post.profileVisits)} Icon={Users} color="#3b82f6" sub={post.follows ? `+${post.follows} follows` : null} />}
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
          if (cfg.igBusinessId) {
            appendLog(`[${b.name}] IG: fetching media + insights…`);
            const ig = await pullInstagram({ token, apiVersion, igUserId: cfg.igBusinessId, brandId: b.id, sinceDays, limit: 200 });
            chunks.push(...ig);
            appendLog(`[${b.name}] IG: ${ig.length} posts`);
          }
          if (cfg.fbPageId && cfg.pageAccessToken) {
            appendLog(`[${b.name}] FB: fetching posts + insights…`);
            const fb = await pullFacebook({ pageAccessToken: cfg.pageAccessToken, apiVersion, pageId: cfg.fbPageId, brandId: b.id, sinceDays, limit: 200 });
            chunks.push(...fb);
            appendLog(`[${b.name}] FB: ${fb.length} posts`);
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
            <RefreshCw size={11} className={pulling ? 'animate-spin' : ''} /> {pulling ? 'Pulling…' : 'Pull posts'}
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
        <CommentsTab rows={commentFeed} onOpenPost={setOpenPost} />
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

function CommentsTab({ rows, onOpenPost }) {
  const issues = rows.filter(r => r.issue);
  const intents = rows.filter(r => r.intent && !r.issue);
  const ugc = rows.filter(r => r.ugcMention && !r.issue && !r.intent);
  return (
    <div className="space-y-4">
      <CommentSection title={`Issues · ${issues.length}`} subtitle="Comments matching refund / damaged / not-delivered / allergy keywords. Escalate to support." rows={issues} onOpenPost={onOpenPost} color="#ef4444" />
      <CommentSection title={`High-intent · ${intents.length}`} subtitle="Price / size / link / DM / availability questions — these posts are catalog/conversion-ad candidates." rows={intents} onOpenPost={onOpenPost} color="#22c55e" />
      <CommentSection title={`UGC mentions · ${ugc.length}`} subtitle="Customers tagging friends — potential affiliate/creator prospects." rows={ugc} onOpenPost={onOpenPost} color="#a855f7" />
    </div>
  );
}

function CommentSection({ title, subtitle, rows, onOpenPost, color }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <div className="text-sm font-semibold text-white">{title}</div>
        </div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-slate-600 italic text-center">Nothing here.</div>
      ) : (
        <div className="divide-y divide-gray-800/60 max-h-[520px] overflow-auto">
          {rows.slice(0, 200).map((c, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2 hover:bg-gray-800/30 transition-colors">
              <button onClick={() => onOpenPost(c.post)} className="flex-shrink-0">
                {c.post.thumbnailUrl && <img src={c.post.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="w-10 h-10 object-cover rounded" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="text-slate-300 font-semibold">{c.username}</span>
                  <span>·</span>
                  <span>{ageLabel(c.timestamp)}</span>
                  {c.post.permalink && (
                    <a href={c.post.permalink} target="_blank" rel="noopener noreferrer" className="ml-auto text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
                      <ExternalLink size={9} /> open
                    </a>
                  )}
                </div>
                <div className="text-[12px] text-slate-200 mt-0.5">{c.text}</div>
                <button onClick={() => onOpenPost(c.post)} className="text-[10px] text-slate-500 hover:text-slate-300 mt-1 truncate block max-w-full text-left">
                  on: {c.post.caption?.slice(0, 80) || c.post.mediaType}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
