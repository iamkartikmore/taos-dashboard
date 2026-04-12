import { useState, useEffect, useRef } from 'react';
import { X, Save, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store';
import { fmt, safeNum } from '../../lib/analytics';

/* ─── FIELD GROUPS ───────────────────────────────────────────────── */

const WINDOW_OPTIONS = ['none', '1d', '3d', '7d', '14d', '30d', '60d', '90d', '180d', '365d'];

const BOOLEAN_FIELDS = ['Broad', 'ASC', 'Customer list', 'Interest'];
const WINDOW_FIELDS  = [
  'ATC', 'IC', 'Purchase', 'View content audience',
  'Website visit', 'FB engage', 'Insta engage', 'Lookalike',
];
const NUMBER_FIELDS  = ['Influe Video', 'Static', 'Inhouse Video'];
const TEXT_FIELDS    = ['Creator', 'SKU', 'Notes'];
const LIST_FIELDS    = ['Collection', 'Campaign Type', 'Offer Type', 'Geography', 'Status Override'];

const ALL_FIELDS = [...LIST_FIELDS, ...TEXT_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS, ...WINDOW_FIELDS];

function defaultValue(field) {
  if (BOOLEAN_FIELDS.includes(field)) return 'no';
  if (NUMBER_FIELDS.includes(field))  return '0';
  return 'none';
}

/* ─── SMALL FORM WIDGETS ─────────────────────────────────────────── */

function FieldRow({ label, children }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <label className="text-xs text-slate-500 w-40 shrink-0 pt-1.5 leading-tight">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function SelInput({ value, onChange, options }) {
  return (
    <select
      value={value ?? 'none'}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700/80 rounded-lg text-slate-200
                 focus:outline-none focus:ring-1 focus:ring-brand-500 appearance-none cursor-pointer"
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function TxtInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700/80 rounded-lg text-slate-200
                 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
  );
}

function NumInput({ value, onChange }) {
  return (
    <input
      type="number"
      min="0"
      value={value ?? 0}
      onChange={e => onChange(e.target.value)}
      className="w-24 px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700/80 rounded-lg text-slate-200
                 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
  );
}

function Toggle({ value, onChange }) {
  const isYes = String(value ?? '').toLowerCase() === 'yes';
  return (
    <button
      type="button"
      onClick={() => onChange(isYes ? 'no' : 'yes')}
      className={clsx(
        'px-3 py-1 rounded-full text-xs font-semibold transition-all',
        isYes
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : 'bg-gray-800 text-slate-500 hover:text-slate-300',
      )}
    >
      {isYes ? 'YES' : 'NO'}
    </button>
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900/70 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</span>
        <ChevronDown size={13} className={clsx('text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 bg-gray-950/40 divide-y divide-gray-800/40">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── DRAWER ─────────────────────────────────────────────────────── */

export default function ManualEditDrawer({ row, onClose }) {
  const { manualMap, setManualRow, rebuildEnriched, dynamicLists } = useStore();
  const [fields, setFields] = useState({});
  const [saved, setSaved]   = useState(false);
  const timerRef = useRef(null);

  /* Seed fields from existing manualMap when row changes */
  useEffect(() => {
    if (!row) return;
    const existing = manualMap[row.adId] || {};
    const init = {};
    ALL_FIELDS.forEach(f => { init[f] = existing[f] ?? defaultValue(f); });
    setFields(init);
    setSaved(false);
  }, [row?.adId]);  // eslint-disable-line

  if (!row) return null;

  const update = (field, val) => setFields(prev => ({ ...prev, [field]: val }));

  const handleSave = () => {
    setManualRow(row.adId, { ...fields });
    rebuildEnriched();
    setSaved(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 2500);
  };

  /* Key-press: Escape closes */
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const decisionColor = {
    'Scale Hard': 'text-emerald-400', 'Scale Carefully': 'text-teal-400',
    'Defend': 'text-sky-400', 'Fix': 'text-amber-400', 'Kill': 'text-red-400',
    'Watch': 'text-slate-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* panel */}
      <div className="relative flex flex-col w-[500px] max-w-full h-full bg-gray-950 border-l border-gray-800 shadow-2xl overflow-hidden">

        {/* ── HEADER ───────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-800 bg-gray-950 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white">Edit Manual Labels</h2>
            {/* Full name shown here */}
            <p className="text-xs text-slate-400 mt-1 leading-snug break-words">
              {row.adName || row.adId}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
              <span className="text-slate-500">{row.accountKey}</span>
              <span className="text-slate-600">|</span>
              <span>Spend <span className="text-white">{fmt.currency(row.spend)}</span></span>
              <span className="text-slate-600">|</span>
              <span>ROAS <span className="text-violet-300 font-semibold">{fmt.roas(row.metaRoas)}</span></span>
              <span className="text-slate-600">|</span>
              <span className={clsx('font-semibold', decisionColor[row.decision] || 'text-slate-400')}>
                {row.decision}
              </span>
            </div>
            {row.campaignName && (
              <p className="text-[11px] text-slate-600 mt-1 truncate" title={row.campaignName}>
                {row.campaignName}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-slate-500 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ── FORM BODY ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          <Section title="Product Info">
            <FieldRow label="Collection">
              <SelInput value={fields['Collection']} onChange={v => update('Collection', v)}
                options={dynamicLists['Collection'] || []} />
            </FieldRow>
            <FieldRow label="SKU">
              <TxtInput value={fields['SKU']} onChange={v => update('SKU', v)} placeholder="e.g. TF-CACT-001" />
            </FieldRow>
            <FieldRow label="Creator">
              <TxtInput value={fields['Creator']} onChange={v => update('Creator', v)} placeholder="Creator name / handle" />
            </FieldRow>
          </Section>

          <Section title="Campaign Settings">
            <FieldRow label="Campaign Type">
              <SelInput value={fields['Campaign Type']} onChange={v => update('Campaign Type', v)}
                options={dynamicLists['Campaign Type'] || []} />
            </FieldRow>
            <FieldRow label="Offer Type">
              <SelInput value={fields['Offer Type']} onChange={v => update('Offer Type', v)}
                options={dynamicLists['Offer Type'] || []} />
            </FieldRow>
            <FieldRow label="Geography">
              <SelInput value={fields['Geography']} onChange={v => update('Geography', v)}
                options={dynamicLists['Geography'] || []} />
            </FieldRow>
          </Section>

          <Section title="Creative Count">
            {NUMBER_FIELDS.map(f => (
              <FieldRow key={f} label={f}>
                <NumInput value={fields[f]} onChange={v => update(f, v)} />
              </FieldRow>
            ))}
          </Section>

          <Section title="Audience Targeting">
            {BOOLEAN_FIELDS.map(f => (
              <FieldRow key={f} label={f}>
                <Toggle value={fields[f]} onChange={v => update(f, v)} />
              </FieldRow>
            ))}
          </Section>

          <Section title="Retargeting Windows">
            {WINDOW_FIELDS.map(f => (
              <FieldRow key={f} label={f}>
                <SelInput value={fields[f]} onChange={v => update(f, v)} options={WINDOW_OPTIONS} />
              </FieldRow>
            ))}
          </Section>

          <Section title="Override & Notes">
            <FieldRow label="Status Override">
              <SelInput value={fields['Status Override']} onChange={v => update('Status Override', v)}
                options={dynamicLists['Status Override'] || []} />
            </FieldRow>
            <FieldRow label="Notes">
              <textarea
                value={fields['Notes'] || ''}
                onChange={e => update('Notes', e.target.value)}
                rows={3}
                placeholder="Internal notes…"
                className="w-full px-2.5 py-2 text-xs bg-gray-800 border border-gray-700/80 rounded-lg text-slate-200
                           placeholder-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </FieldRow>
          </Section>

          {/* Ad ID (read-only) */}
          <div className="text-[10px] text-slate-700 px-1">
            Ad ID: <span className="font-mono">{row.adId}</span>
          </div>
        </div>

        {/* ── FOOTER ────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-t border-gray-800 bg-gray-950">
          <button
            onClick={handleSave}
            className={clsx(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
              saved
                ? 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'bg-brand-600 hover:bg-brand-500 text-white',
            )}
          >
            <Save size={14} />
            {saved ? 'Saved ✓' : 'Save Labels'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Close
          </button>
          {saved && (
            <span className="text-[11px] text-slate-500 ml-auto">
              Dashboards updated automatically
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
