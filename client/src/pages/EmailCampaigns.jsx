import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Mail, Send, RefreshCw, X, CheckCircle, AlertCircle, Clock, Eye, MousePointerClick, AlertTriangle,
} from 'lucide-react';
import { useStore } from '../store';
import {
  fetchListmonkCampaigns, fetchListmonkLists, fetchListmonkAnalytics,
  sendListmonkCampaign,
} from '../lib/api';
import Spinner from '../components/ui/Spinner';

const num = v => Number(v || 0).toLocaleString('en-IN');
const pct = (a, b) => b ? ((a / b) * 100).toFixed(2) + '%' : '—';
const fmtTime = ts => ts ? new Date(ts).toLocaleString() : '—';
const statusColor = s => ({
  draft:     'bg-slate-700/50 text-slate-300',
  scheduled: 'bg-amber-800/40 text-amber-300',
  running:   'bg-blue-800/40 text-blue-300 animate-pulse',
  paused:    'bg-orange-800/40 text-orange-300',
  finished:  'bg-emerald-800/40 text-emerald-300',
  cancelled: 'bg-red-800/40 text-red-300',
}[s] || 'bg-slate-700/50 text-slate-300');

function KPI({ label, value, sub, icon: Icon, color = '#38bdf8' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BrandPicker({ brands, activeIds, selected, onChange }) {
  const configured = brands.filter(b => b.listmonk?.url && b.listmonk?.username && b.listmonk?.password);
  if (!configured.length) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500">Brand:</span>
      {configured.map(b => (
        <button key={b.id}
          onClick={() => onChange(b.id)}
          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
            selected === b.id ? 'border-sky-500 text-sky-300 bg-sky-900/30' : 'border-gray-700 text-slate-400 hover:border-gray-600'
          }`}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

/* ─── SEND CAMPAIGN MODAL ─────────────────────────────────────────── */
function SendModal({ brand, lists, onClose, onSent }) {
  const [name, setName]           = useState('');
  const [subject, setSubject]     = useState('');
  const [fromEmail, setFromEmail] = useState(brand.listmonk?.fromEmail || '');
  const [listIds, setListIds]     = useState(
    brand.listmonk?.defaultListId ? [Number(brand.listmonk.defaultListId)] : []
  );
  const [body, setBody]           = useState('<p>Hello {{ .Subscriber.FirstName | default "there" }},</p>\n<p>Write your email here…</p>');
  const [contentType, setContentType] = useState('html');
  const [sendAt, setSendAt]       = useState(''); // ISO local datetime
  const [sending, setSending]     = useState(false);
  const [err, setErr]             = useState('');

  const canSubmit = name && subject && fromEmail && listIds.length && body;

  async function submit() {
    setSending(true); setErr('');
    try {
      await sendListmonkCampaign(brand.listmonk, {
        name, subject, fromEmail, listIds, body, contentType,
        sendAt:   sendAt ? new Date(sendAt).toISOString() : undefined,
        startNow: !sendAt,
      });
      onSent();
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white flex items-center gap-2"><Send size={14} /> Send Campaign — {brand.name}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Campaign Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Weekly newsletter — 2026-04-19"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Subject Line</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="🌿 New arrivals this week"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">From Email</label>
              <input value={fromEmail} onChange={e => setFromEmail(e.target.value)}
                placeholder='"TAOS" <hello@theaffordableorganicstore.com>'
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Target Lists</label>
              <div className="flex flex-wrap gap-2">
                {lists.map(l => {
                  const on = listIds.includes(l.id);
                  return (
                    <button key={l.id}
                      onClick={() => setListIds(on ? listIds.filter(x => x !== l.id) : [...listIds, l.id])}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        on ? 'border-sky-500 bg-sky-900/40 text-sky-200' : 'border-gray-700 text-slate-400 hover:border-gray-600'
                      }`}>
                      {l.name} <span className="opacity-50">({l.subscriberCount ?? l.subscriber_count ?? 0})</span>
                    </button>
                  );
                })}
                {!lists.length && <span className="text-[11px] text-slate-600">No lists found — create one in Listmonk UI first.</span>}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Content Type</label>
              <select value={contentType} onChange={e => setContentType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-sky-500">
                <option value="html">HTML</option>
                <option value="richtext">Rich text</option>
                <option value="plain">Plain text</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Schedule (optional)</label>
              <input type="datetime-local" value={sendAt} onChange={e => setSendAt(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-sky-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">Body</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono" />
              <div className="text-[10px] text-slate-600 mt-1">
                Listmonk template syntax: <code className="text-slate-500">{'{{ .Subscriber.FirstName }}'}</code>, <code className="text-slate-500">{'{{ .Subscriber.Attribs.brand }}'}</code>.
              </div>
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" /> {err}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-600">
            {sendAt ? `Will schedule for ${new Date(sendAt).toLocaleString()}` : 'Will send immediately upon creation'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={submit} disabled={!canSubmit || sending}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-sky-700/40 hover:bg-sky-700/60 disabled:opacity-40 text-sky-200 border border-sky-700/40">
              {sending ? <Spinner size="sm" /> : <Send size={11} />}
              {sendAt ? 'Schedule' : 'Send Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── CAMPAIGN DETAIL DRAWER ──────────────────────────────────────── */
function CampaignDetail({ brand, campaign, onClose }) {
  const [series, setSeries] = useState({ views: [], clicks: [], bounces: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [v, c, b] = await Promise.all([
          fetchListmonkAnalytics(brand.listmonk, { type: 'views',   campaignIds: [campaign.id] }),
          fetchListmonkAnalytics(brand.listmonk, { type: 'clicks',  campaignIds: [campaign.id] }),
          fetchListmonkAnalytics(brand.listmonk, { type: 'bounces', campaignIds: [campaign.id] }),
        ]);
        if (!cancelled) setSeries({ views: v.series, clicks: c.series, bounces: b.series });
      } catch {} finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [brand.id, campaign.id]);

  const merged = useMemo(() => {
    const byTs = new Map();
    ['views', 'clicks', 'bounces'].forEach(k => {
      (series[k] || []).forEach(r => {
        const ts = r.timestamp || r.time || r.created_at;
        const label = new Date(ts).toLocaleDateString();
        const row = byTs.get(label) || { label };
        row[k] = (row[k] || 0) + Number(r.count || 0);
        byTs.set(label, row);
      });
    });
    return Array.from(byTs.values());
  }, [series]);

  return (
    <div className="fixed inset-0 z-40 flex bg-black/60 backdrop-blur-sm">
      <div className="flex-1" onClick={onClose} />
      <div className="w-full max-w-3xl bg-gray-950 border-l border-gray-800 overflow-y-auto">
        <div className="sticky top-0 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <div className="text-base font-semibold text-white">{campaign.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{campaign.subject}</div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPI label="Sent"    value={num(campaign.sent)}    sub={`/ ${num(campaign.toSend)} target`} icon={Send} />
            <KPI label="Opens"   value={num(campaign.views)}   sub={pct(campaign.views, campaign.sent)} icon={Eye} color="#60a5fa" />
            <KPI label="Clicks"  value={num(campaign.clicks)}  sub={pct(campaign.clicks, campaign.views)} icon={MousePointerClick} color="#22c55e" />
            <KPI label="Bounces" value={num(campaign.bounces)} sub={pct(campaign.bounces, campaign.sent)} icon={AlertTriangle} color="#f87171" />
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-300 mb-3">Timeline</div>
            {loading ? <div className="h-56 flex items-center justify-center"><Spinner /></div>
              : merged.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={merged}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                    <Legend />
                    <Area type="monotone" dataKey="views"   stroke="#60a5fa" fill="#60a5fa22" name="Opens" />
                    <Area type="monotone" dataKey="clicks"  stroke="#22c55e" fill="#22c55e22" name="Clicks" />
                    <Area type="monotone" dataKey="bounces" stroke="#f87171" fill="#f8717122" name="Bounces" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="h-56 flex items-center justify-center text-xs text-slate-600">No timeline data yet</div>}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-slate-400 space-y-1">
            <div><span className="text-slate-600">Status:</span> <span className={`ml-1 px-1.5 py-0.5 rounded ${statusColor(campaign.status)}`}>{campaign.status}</span></div>
            <div><span className="text-slate-600">Created:</span> {fmtTime(campaign.createdAt)}</div>
            <div><span className="text-slate-600">Started:</span> {fmtTime(campaign.startedAt)}</div>
            <div><span className="text-slate-600">Finished:</span> {fmtTime(campaign.finishedAt)}</div>
            <div><span className="text-slate-600">Lists:</span> {(campaign.lists || []).map(l => l.name).join(', ') || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PAGE ────────────────────────────────────────────────────────── */
export default function EmailCampaigns() {
  const { brands, activeBrandIds, startPullJob, finishPullJob } = useStore();
  const configured = brands.filter(b => b.listmonk?.url && b.listmonk?.username && b.listmonk?.password);

  const [brandId, setBrandId] = useState(configured[0]?.id || null);
  const brand = configured.find(b => b.id === brandId);

  const [campaigns, setCampaigns] = useState([]);
  const [lists, setLists]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState('');
  const [showSend, setShowSend]   = useState(false);
  const [detail, setDetail]       = useState(null);

  async function load() {
    if (!brand) return;
    setLoading(true); setErr('');
    const jobId = `listmonk-campaigns:${brand.id}:${Date.now()}`;
    startPullJob(jobId, `Listmonk — ${brand.name}`, 'campaigns + lists');
    try {
      const [c, l] = await Promise.all([
        fetchListmonkCampaigns(brand.listmonk),
        fetchListmonkLists(brand.listmonk),
      ]);
      setCampaigns(c.campaigns || []);
      setLists((l.lists || []).map(x => ({
        id: x.id, name: x.name, subscriberCount: x.subscriber_count,
      })));
      finishPullJob(jobId, true, `${(c.campaigns || []).length} campaigns · ${(l.lists || []).length} lists`);
    } catch (e) {
      setErr(e.message);
      finishPullJob(jobId, false, e.message || 'Listmonk fetch failed');
    }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [brandId]);

  const totals = useMemo(() => campaigns.reduce((a, c) => ({
    sent:    a.sent    + Number(c.sent || 0),
    views:   a.views   + Number(c.views || 0),
    clicks:  a.clicks  + Number(c.clicks || 0),
    bounces: a.bounces + Number(c.bounces || 0),
  }), { sent: 0, views: 0, clicks: 0, bounces: 0 }), [campaigns]);

  if (!configured.length) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Mail size={24} className="mx-auto mb-3 text-slate-600" />
        <div className="text-sm">No brands have Listmonk configured yet.</div>
        <div className="text-xs text-slate-600 mt-1">Go to Study Manual → brand card → Listmonk section to connect.</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Mail size={18} /> Email Campaigns</h1>
          <div className="text-xs text-slate-500 mt-0.5">Listmonk — campaigns, stats, and sends</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BrandPicker brands={brands} activeIds={activeBrandIds} selected={brandId} onChange={setBrandId} />
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-300 bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-40">
            {loading ? <Spinner size="sm" /> : <RefreshCw size={11} />} Refresh
          </button>
          <button onClick={() => setShowSend(true)} disabled={!brand}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-700/40 hover:bg-sky-700/60 disabled:opacity-40 text-sky-200 border border-sky-700/40">
            <Send size={11} /> Send Campaign
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-xs">
          <AlertCircle size={12} className="shrink-0 mt-0.5" /> {err}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total Sent"    value={num(totals.sent)}    icon={Send} />
        <KPI label="Total Opens"   value={num(totals.views)}   sub={pct(totals.views, totals.sent)}   icon={Eye} color="#60a5fa" />
        <KPI label="Total Clicks"  value={num(totals.clicks)}  sub={pct(totals.clicks, totals.views)} icon={MousePointerClick} color="#22c55e" />
        <KPI label="Total Bounces" value={num(totals.bounces)} sub={pct(totals.bounces, totals.sent)} icon={AlertTriangle} color="#f87171" />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Campaigns</h2>
          <span className="text-[11px] text-slate-500">{campaigns.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-950/60 text-slate-500 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Sent</th>
                <th className="text-right px-4 py-2">Opens</th>
                <th className="text-right px-4 py-2">CTR</th>
                <th className="text-right px-4 py-2">Clicks</th>
                <th className="text-right px-4 py-2">Bounces</th>
                <th className="text-left px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}
                  onClick={() => setDetail(c)}
                  className="border-t border-gray-800/50 hover:bg-gray-800/40 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200 font-medium">{c.name}</div>
                    <div className="text-[10px] text-slate-600">{c.subject}</div>
                  </td>
                  <td className="px-4 py-2.5"><span className={`px-1.5 py-0.5 rounded text-[10px] ${statusColor(c.status)}`}>{c.status}</span></td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{num(c.sent)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{num(c.views)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{pct(c.clicks, c.views)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300">{num(c.clicks)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{num(c.bounces)}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-[11px]">{fmtTime(c.createdAt)}</td>
                </tr>
              ))}
              {!campaigns.length && !loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600">No campaigns yet. Click <span className="text-sky-400">Send Campaign</span> to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showSend && brand && (
        <SendModal brand={brand} lists={lists} onClose={() => setShowSend(false)} onSent={load} />
      )}
      {detail && brand && (
        <CampaignDetail brand={brand} campaign={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
