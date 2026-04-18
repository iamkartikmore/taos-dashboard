import { useState, useEffect, useCallback } from 'react';
import { Users, Activity, Plus, Edit2, Trash2, X, Check, Shield, Copy, AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../store';

/* ─── CONSTANTS ─────────────────────────────────────────────────── */

const ALL_MODULES = [
  { key: 'overview',         label: 'Overview',           group: 'Dashboard' },
  { key: 'decisions',        label: 'Decision Queue',     group: 'Dashboard' },
  { key: 'boards',           label: 'Action Boards',      group: 'Dashboard' },
  { key: 'patterns',         label: 'Pattern Analysis',   group: 'Intelligence' },
  { key: 'scorecard',        label: 'Scorecard',          group: 'Intelligence' },
  { key: 'video',            label: 'Video Insights',     group: 'Intelligence' },
  { key: 'sku',              label: 'SKU Intelligence',   group: 'Intelligence' },
  { key: 'flat',             label: 'Raw Flat Data',      group: 'Intelligence' },
  { key: 'breakdowns',       label: 'Breakdowns',         group: 'Intelligence' },
  { key: 'creative-intel',   label: 'Creative Intel',     group: 'AI Intel' },
  { key: 'attribution',      label: 'Attribution',        group: 'AI Intel' },
  { key: 'momentum',         label: 'Momentum',           group: 'AI Intel' },
  { key: 'inactive',         label: 'Inactive Ads',       group: 'AI Intel' },
  { key: 'daily',            label: 'Daily Briefing',     group: 'AI Intel' },
  { key: 'analysis',         label: 'Order Analysis',     group: 'AI Intel' },
  { key: 'collection-spend', label: 'Collection Spend',   group: 'AI Intel' },
  { key: 'aov',              label: 'AOV Analysis',       group: 'AI Intel' },
  { key: 'business-plan',    label: 'Business Plan',      group: 'Business Plan' },
  { key: 'shopify',          label: 'Shopify Orders',     group: 'Commerce' },
  { key: 'shopify-insights', label: 'Shopify Analytics',  group: 'Commerce' },
  { key: 'shopify-ops',      label: 'Shopify Ops',        group: 'Commerce' },
  { key: 'procurement',      label: 'Procurement',        group: 'Commerce' },
  { key: 'ga',               label: 'GA Analytics',       group: 'Commerce' },
  { key: 'setup',            label: 'Study Manual',       group: 'Config' },
];

const MODULE_GROUPS = [...new Set(ALL_MODULES.map(m => m.group))];

const ROLES = ['admin', 'marketing', 'commerce', 'analyst', 'operations', 'custom'];

const ROLE_COLORS = {
  admin:      'bg-brand-600/20 text-brand-300 border-brand-500/30',
  marketing:  'bg-purple-600/20 text-purple-300 border-purple-500/30',
  commerce:   'bg-emerald-600/20 text-emerald-300 border-emerald-500/30',
  analyst:    'bg-blue-600/20 text-blue-300 border-blue-500/30',
  operations: 'bg-amber-600/20 text-amber-300 border-amber-500/30',
  custom:     'bg-gray-600/20 text-gray-300 border-gray-500/30',
};

const DEFAULT_USER = { email: '', name: '', role: 'marketing', modules: [], brands: ['*'] };

/* ─── API HELPERS ─────────────────────────────────────────────── */

function useAdminApi() {
  const { authFetch } = useAuth();
  const get    = url           => authFetch(url).then(r => r.json());
  const post   = (url, body)   => authFetch(url, { method: 'POST',   body: JSON.stringify(body) }).then(r => r.json());
  const put    = (url, body)   => authFetch(url, { method: 'PUT',    body: JSON.stringify(body) }).then(r => r.json());
  const del    = url           => authFetch(url, { method: 'DELETE' }).then(r => r.json());
  return { get, post, put, del };
}

/* ─── USER MODAL ─────────────────────────────────────────────── */

function UserModal({ user: initial, roleDefs, brands, onSave, onClose }) {
  const [form, setForm]       = useState(initial || { ...DEFAULT_USER });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const isNew = !initial;

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  // When role changes to a built-in role, clear custom modules
  const handleRole = (role) => {
    set('role', role);
    if (role !== 'custom') set('modules', []);
  };

  const toggleModule = (key) => {
    setForm(f => {
      const has = f.modules.includes(key);
      return { ...f, modules: has ? f.modules.filter(k => k !== key) : [...f.modules, key] };
    });
  };

  const toggleBrand = (id) => {
    setForm(f => {
      if (id === '*') return { ...f, brands: ['*'] };
      const filtered = (f.brands || []).filter(b => b !== '*');
      const has = filtered.includes(id);
      const next = has ? filtered.filter(b => b !== id) : [...filtered, id];
      return { ...f, brands: next.length ? next : ['*'] };
    });
  };

  const allBrands  = !form.brands || form.brands.includes('*');
  const roleModules = roleDefs[form.role] || [];
  const effectiveMods = form.role === 'admin' ? ['*'] :
                        form.role === 'custom' ? form.modules :
                        roleModules;

  async function handleSave() {
    if (!form.email.trim() || !form.name.trim()) { setError('Name and email required.'); return; }
    setSaving(true); setError('');
    try { await onSave(form); onClose(); }
    catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-base font-bold text-white">{isNew ? 'Add User' : `Edit — ${initial.name}`}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-gray-800 transition-colors"><X size={16}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
              <AlertTriangle size={14}/>{error}
            </div>
          )}

          {/* Name + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Name</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email</label>
              <input value={form.email} onChange={e => set('email', e.target.value)}
                disabled={!isNew}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="user@company.com" />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Role / Level</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map(r => (
                <button key={r} onClick={() => handleRole(r)}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize',
                    form.role === r ? ROLE_COLORS[r] : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
                  {r}
                </button>
              ))}
            </div>
            {form.role !== 'custom' && form.role !== 'admin' && (
              <p className="text-[11px] text-slate-500 mt-2">
                Inherits: {roleModules.join(', ')}
              </p>
            )}
          </div>

          {/* Modules — shown only for custom role */}
          {form.role === 'custom' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-400">Module Access</label>
                <div className="flex gap-2">
                  <button onClick={() => set('modules', ALL_MODULES.map(m => m.key))}
                    className="text-[11px] text-brand-400 hover:text-brand-300">Select all</button>
                  <span className="text-slate-600">·</span>
                  <button onClick={() => set('modules', [])}
                    className="text-[11px] text-slate-500 hover:text-slate-300">Clear</button>
                </div>
              </div>
              <div className="space-y-3">
                {MODULE_GROUPS.map(group => (
                  <div key={group}>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">{group}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_MODULES.filter(m => m.group === group).map(m => {
                        const on = form.modules.includes(m.key);
                        return (
                          <button key={m.key} onClick={() => toggleModule(m.key)}
                            className={clsx('px-2.5 py-1 rounded-md text-xs font-medium border transition-all',
                              on ? 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                                 : 'bg-gray-800 border-gray-700 text-slate-500 hover:text-slate-300')}>
                            {on && <Check size={10} className="inline mr-1" />}{m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Brand access */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Brand Access</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => set('brands', ['*'])}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                  allBrands ? 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                            : 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
                {allBrands && <Check size={10} className="inline mr-1" />}All Brands
              </button>
              {brands.map(b => {
                const on = !allBrands && form.brands.includes(b.id);
                return (
                  <button key={b.id} onClick={() => toggleBrand(b.id)}
                    style={on ? { background: `${b.color}22`, borderColor: `${b.color}55`, color: b.color } : {}}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                      !on && 'bg-gray-800 border-gray-700 text-slate-400 hover:text-slate-200')}>
                    {on && <Check size={10} className="inline mr-1" />}{b.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <p className="text-[11px] text-slate-600">Changes apply immediately. Commit auth-config.json to persist across deploys.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-slate-300 text-sm font-medium hover:bg-gray-700 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50">
              {saving ? <RefreshCw size={13} className="animate-spin"/> : <Check size={13}/>}
              {isNew ? 'Add User' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── USERS TAB ─────────────────────────────────────────────────── */

function UsersTab({ brands }) {
  const { get, post, put, del } = useAdminApi();
  const [users, setUsers]       = useState([]);
  const [roleDefs, setRoleDefs] = useState({});
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // null | 'add' | userObj
  const [copied, setCopied]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [us, roles] = await Promise.all([get('/api/admin/users'), get('/api/admin/roles')]);
    setUsers(Array.isArray(us) ? us : []);
    setRoleDefs(roles && !roles.error ? roles : {});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(form) {
    if (modal === 'add') {
      const r = await post('/api/admin/users', form);
      if (r.error) throw new Error(r.error);
    } else {
      const r = await put(`/api/admin/users/${encodeURIComponent(modal.email)}`, form);
      if (r.error) throw new Error(r.error);
    }
    await load();
  }

  async function handleDelete(email) {
    if (!confirm(`Remove ${email}?`)) return;
    await del(`/api/admin/users/${encodeURIComponent(email)}`);
    await load();
  }

  function copyConfig() {
    navigator.clipboard.writeText(JSON.stringify({ users, roles: roleDefs }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {modal && (
        <UserModal
          user={modal === 'add' ? null : modal}
          roleDefs={roleDefs}
          brands={brands}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-400">{users.length} user{users.length !== 1 ? 's' : ''} with access</div>
        <div className="flex gap-2">
          <button onClick={copyConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-slate-300 hover:text-white transition-colors">
            {copied ? <Check size={12}/> : <Copy size={12}/>}
            {copied ? 'Copied!' : 'Export JSON'}
          </button>
          <button onClick={() => setModal('add')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors">
            <Plus size={12}/>Add User
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                {['Name', 'Email', 'Role', 'Modules', 'Brands', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const mods   = u.modules?.includes('*') ? ['All'] : (u.modules?.length ? u.modules : [`${u.role} defaults`]);
                const brnds  = !u.brands || u.brands.includes('*') ? ['All brands'] : u.brands;
                return (
                  <tr key={u.email} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0 text-xs font-bold text-white">
                          {u.name?.[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-200">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 rounded-md text-xs font-semibold border capitalize', ROLE_COLORS[u.role] || ROLE_COLORS.custom)}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {mods.slice(0, 4).map(m => (
                          <span key={m} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-slate-400 border border-gray-700">{m}</span>
                        ))}
                        {mods.length > 4 && <span className="text-[10px] text-slate-500">+{mods.length - 4} more</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {brnds.slice(0, 3).map(b => (
                          <span key={b} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-slate-400 border border-gray-700">{b}</span>
                        ))}
                        {brnds.length > 3 && <span className="text-[10px] text-slate-500">+{brnds.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setModal(u)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-gray-700 transition-colors">
                          <Edit2 size={13}/>
                        </button>
                        <button onClick={() => handleDelete(u.email)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 rounded-lg bg-amber-900/20 border border-amber-700/30 flex items-start gap-2 text-xs text-amber-300">
        <AlertTriangle size={13} className="shrink-0 mt-0.5"/>
        Changes are live immediately but reset on next deploy. Use "Export JSON" to copy the config, then commit it to auth-config.json in git to make it permanent.
      </div>
    </>
  );
}

/* ─── LOGS TAB ─────────────────────────────────────────────────── */

function LogsTab() {
  const { get } = useAdminApi();
  const [logs, setLogs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await get('/api/admin/logs?limit=500');
    setLogs(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? logs.filter(l => l.email?.includes(search) || l.name?.toLowerCase().includes(search.toLowerCase()) || l.label?.toLowerCase().includes(search.toLowerCase()))
    : logs;

  function fmt(ts) {
    const d = new Date(ts);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const TYPE_STYLES = {
    login:  'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
    page:   'bg-blue-900/20 text-blue-300 border-blue-700/30',
    admin:  'bg-brand-900/30 text-brand-300 border-brand-700/40',
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter by name, email, or page..."
          className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"/>
        <button onClick={load} className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-slate-400 hover:text-white transition-colors">
          <RefreshCw size={14}/>
        </button>
        <span className="text-xs text-slate-500">{filtered.length} events</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">No logs yet — activity will appear here as users navigate.</div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                {['Time', 'User', 'Email', 'Type', 'Detail'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmt(log.ts)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-200 text-xs">{log.name || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{log.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx('px-2 py-0.5 rounded text-[10px] font-semibold border', TYPE_STYLES[log.type] || 'bg-gray-800 text-slate-400 border-gray-700')}>
                      {log.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">
                    {log.type === 'page'  && (log.label || log.path)}
                    {log.type === 'login' && 'Signed in'}
                    {log.type === 'admin' && `${log.action?.replace('_', ' ')} → ${log.target}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-600">Logs are stored in memory — cleared on server restart. Last 2,000 events kept.</p>
    </>
  );
}

/* ─── MAIN ─────────────────────────────────────────────────────── */

export default function Admin() {
  const { user } = useAuth();
  const { brands } = useStore();
  const [tab, setTab] = useState('users');

  if (user?.role !== 'admin') return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Shield size={40} className="text-slate-600"/>
      <p className="text-slate-400 font-semibold">Admin only</p>
    </div>
  );

  const TABS = [
    { id: 'users', label: 'Users',      icon: Users },
    { id: 'logs',  label: 'Usage Logs', icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">User Management</h1>
        <p className="text-sm text-slate-400 mt-0.5">Control who can access the dashboard and which modules they see.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
              tab === id ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab brands={brands || []} />}
      {tab === 'logs'  && <LogsTab />}
    </div>
  );
}
