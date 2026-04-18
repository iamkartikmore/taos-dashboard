import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import {
  Zap, TrendingUp, Package, Building2, Wallet,
  RefreshCw, Download, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, ArrowUp, ArrowDown, Minus,
  Flame, ShoppingCart, Edit2, Plus, Trash2, Upload, Target, Activity,
  BarChart2, Users, Layers,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders } from '../lib/api';
import {
  DEFAULT_PLAN, STAGES, detectGrowthStage,
  buildPlanVsActual, buildMarketingNeeds, buildInventoryNeeds,
  buildPredictions, buildSeasonality, buildCohortMetrics,
  buildCreativeStrategy, buildCollectionsFromMeta, parseOrdersCsv,
  downloadCsv, fmtRs, fmtK,
  buildMonthlyPlan, buildFinancePlan, buildWarehouseNeeds,
  buildOpsNeeds, buildProcurementSchedule, buildDecisionSignals,
  buildAdvancedPredictions,
} from '../lib/businessPlanAnalytics';

/* ─── STORAGE ────────────────────────────────────────────────────────── */
const lsKey = id  => `taos_bplan_v5_${id||'default'}`;
const lsGet = id  => { try { const r=localStorage.getItem(lsKey(id)); return r?JSON.parse(r):null; } catch { return null; } };
const lsSet = (id,v) => { try { localStorage.setItem(lsKey(id),JSON.stringify(v)); } catch {} };

const DEFAULT_SHIFT_ROLES = {
  packer:    'Packer',
  qc:        'QC Inspector',
  ops:       'Ops Lead',
  cs:        'CS Agent',
  logistics: 'Logistics',
  manager:   'Shift Manager',
};

const hydrate = stored => ({
  ...DEFAULT_PLAN, ...stored,
  collections:   stored?.collections?.length   ? stored.collections   : DEFAULT_PLAN.collections,
  skuDimensions: stored?.skuDimensions?.length  ? stored.skuDimensions : DEFAULT_PLAN.skuDimensions,
  warehouses:    stored?.warehouses?.length     ? stored.warehouses    : DEFAULT_PLAN.warehouses,
  suppliers:     stored?.suppliers?.length      ? stored.suppliers     : DEFAULT_PLAN.suppliers,
  shiftRoles:    stored?.shiftRoles             ? stored.shiftRoles    : { ...DEFAULT_SHIFT_ROLES },
});

const fmtPct  = n => `${(parseFloat(n)||0).toFixed(1)}%`;
const fmtDays = n => { const v=parseFloat(n)||0; return v>=999?'—':`${Math.round(v)}d`; };
const MONTH_KEY = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

const STATUS = {
  'on-track': { bar:'bg-emerald-500',  pill:'bg-emerald-500/15 text-emerald-400 border-emerald-800/30', label:'On Track' },
  behind:     { bar:'bg-amber-500',    pill:'bg-amber-500/15  text-amber-400  border-amber-800/30',   label:'Behind' },
  critical:   { bar:'bg-red-500',      pill:'bg-red-500/15    text-red-400    border-red-800/30',      label:'Critical' },
  missed:     { bar:'bg-red-700',      pill:'bg-red-900/30    text-red-300    border-red-800/30',      label:'Missed' },
  future:     { bar:'bg-gray-600',     pill:'bg-gray-800      text-slate-400  border-gray-700/40',    label:'Upcoming' },
};
const PRIORITY = {
  URGENT:{ row:'border-l-2 border-red-500 bg-red-900/20',    badge:'bg-red-500/20 text-red-300 border-red-700/50' },
  HIGH:  { row:'border-l-2 border-amber-500 bg-amber-900/15',badge:'bg-amber-500/20 text-amber-300 border-amber-700/40' },
  MEDIUM:{ row:'border-l-2 border-brand-500 bg-brand-900/10',badge:'bg-brand-500/15 text-brand-300 border-brand-700/30' },
  LOW:   { row:'border-l-2 border-gray-600',                  badge:'bg-gray-800 text-slate-400 border-gray-700/40' },
};

/* ─── SHARED COMPONENTS ──────────────────────────────────────────────── */
function KpiCard({ label, value, sub, delta, inverse=false, cls='', warn, accent }) {
  const n   = parseFloat(delta);
  const good= inverse ? n<0 : n>0;
  const dCls= !Number.isFinite(n)?'':n===0?'text-slate-500':good?'text-emerald-400':'text-red-400';
  const DI  = n===0?Minus:n>0?ArrowUp:ArrowDown;
  return (
    <div className={clsx('relative bg-gray-900/70 rounded-xl border px-4 py-3.5 overflow-hidden',
      warn?'border-red-800/50':accent?'border-brand-700/40':'border-gray-800/50')}>
      {accent && <div className="absolute inset-0 bg-brand-600/3 pointer-events-none"/>}
      <div className="text-[10px] text-slate-500 mb-1 relative">{label}</div>
      <div className={clsx('text-xl font-bold relative',cls||'text-white')}>{value}</div>
      <div className="flex items-center gap-2 mt-0.5 relative">
        {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
        {Number.isFinite(n) && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${dCls}`}>
            <DI size={10}/>{Math.abs(n).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div className="bg-gray-950 border border-gray-700/80 rounded-xl p-3 text-xs shadow-2xl min-w-[140px]">
      <div className="text-slate-400 mb-2 font-semibold">{label}</div>
      {payload.map(p=>(
        <div key={p.name} className="flex justify-between gap-4 mb-0.5">
          <span style={{color:p.color}} className="font-medium">{p.name}</span>
          <span className="text-white font-bold">{p.value>5000?fmtRs(p.value):typeof p.value==='number'?p.value.toLocaleString():p.value}</span>
        </div>
      ))}
    </div>
  );
}

function StageBadge({ stage, size='md' }) {
  if (!stage) return null;
  const sm=size==='sm';
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-bold border',
      sm?'px-2 py-0.5 text-[10px]':'px-3 py-1 text-xs')}
      style={{background:stage.color+'18',borderColor:stage.color+'50',color:stage.color}}>
      {stage.badge} {stage.name}
    </span>
  );
}

function StatusPill({ status }) {
  const s = STATUS[status]||STATUS.future;
  return <span className={clsx('text-[9px] px-2 py-0.5 rounded-full border font-bold',s.pill)}>{s.label}</span>;
}

function Section({ title, icon:Icon, children, defaultOpen=true, badge, action }) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 overflow-hidden">
      <button onClick={()=>setOpen(v=>!v)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-gray-800/20 transition-colors">
        <div className="flex items-center gap-2.5">
          {Icon && <Icon size={14} className="text-slate-500"/>}
          <span className="text-sm font-bold text-slate-200">{title}</span>
          {badge && <span className="text-[10px] bg-brand-600/20 text-brand-400 px-2 py-0.5 rounded-full font-semibold">{badge}</span>}
        </div>
        <div className="flex items-center gap-2">
          {action && <span onClick={e=>{e.stopPropagation();action.fn();}} className="text-[10px] text-brand-400 hover:text-brand-300 px-2 py-1 rounded">{action.label}</span>}
          {open?<ChevronDown size={14} className="text-slate-600"/>:<ChevronRight size={14} className="text-slate-600"/>}
        </div>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-800/40 pt-3">{children}</div>}
    </div>
  );
}

function EditBtn({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 px-2 py-1 rounded transition-colors">
      <Edit2 size={10}/>Edit
    </button>
  );
}

function SaveCancelBtns({ onSave, onCancel, label='Save' }) {
  return (
    <div className="flex gap-2 pt-2 border-t border-gray-800/40 mt-2">
      <button onClick={onSave} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold hover:bg-brand-500 transition-colors">{label}</button>
      <button onClick={onCancel} className="px-3 py-2 bg-gray-700 text-slate-300 rounded-lg text-xs hover:bg-gray-600 transition-colors">Cancel</button>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="text-center py-10 text-slate-500 text-xs bg-gray-900/40 rounded-xl border border-gray-800/30">{text}</div>;
}

/* ─── TAB: COMMAND ───────────────────────────────────────────────────── */
function TabCommand({ plan, months, predictions, adv, stage, decisions, finPlan, whPlan, pva, allOrders }) {
  const now      = new Date();
  const currKey  = MONTH_KEY(now);
  const curr     = pva.find(m=>m.key===currKey);
  const currFin  = finPlan.find(m=>m.key===currKey);
  const nextStage= STAGES[STAGES.findIndex(s=>s.id===stage?.id)+1];
  const progressPct = curr ? Math.round((curr.daysElapsed/(curr.days||30))*100) : 0;

  const movementData = (predictions.recentDays||[]).map(d=>({
    date: d.date.slice(5), Orders: d.orders,
    '7d Avg': Math.round(predictions.avg7||0),
    Plan: months.find(m=>m.key===currKey)?.ordersPerDay||0,
  }));

  const pvaVisible = pva.filter((_,i)=>i<6);

  return (
    <div className="space-y-5">
      {/* Stage strip */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <StageBadge stage={stage}/>
          <span className="text-xs text-slate-400 flex-1 min-w-0">{stage?.description}</span>
          {nextStage&&(
            <div className="flex items-center gap-2 text-[10px] bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-1.5">
              <span className="text-slate-500">Next:</span>
              <span style={{color:nextStage.color}} className="font-bold">{nextStage.badge} {nextStage.name}</span>
              <span className="text-slate-600">@ {nextStage.min}+ orders/day</span>
            </div>
          )}
        </div>
        {stage&&(
          <div>
            <div className="flex justify-between text-[10px] text-slate-600 mb-1">
              <span>{stage.name}: {stage.min}–{stage.max===Infinity?'∞':stage.max} orders/day</span>
              <span className="font-semibold" style={{color:stage.color}}>
                {stage.max!==Infinity
                  ?`${Math.round(Math.min(((predictions.avg7||0)-stage.min)/(stage.max-stage.min)*100,100))}% through stage`
                  :'Max stage'}
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width:`${stage.max!==Infinity?Math.min(((predictions.avg7||0)-stage.min)/(stage.max-stage.min)*100,100):100}%`,
                background:`linear-gradient(90deg,${stage.color}80,${stage.color})`,
              }}/>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="7-Day Avg Orders" value={Math.round(predictions.avg7||0)} sub="/day" accent/>
        <KpiCard label="30-Day Avg Orders" value={Math.round(predictions.avg30||0)} sub="/day"/>
        <KpiCard label="MTD Revenue" value={fmtRs(currFin?.revenue||0)} sub="projected"/>
        <KpiCard label="MTD Net Profit" value={fmtRs(currFin?.netProfit||0)}
          cls={currFin?.netProfit>0?'text-emerald-400':'text-red-400'}/>
      </div>

      {/* Decisions */}
      {decisions.length>0&&(
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action Required</span>
            <span className="text-[10px] bg-red-500/20 text-red-400 rounded-full px-2 py-0.5 font-bold">
              {decisions.filter(d=>d.priority==='URGENT'||d.priority==='HIGH').length} urgent
            </span>
          </div>
          {decisions.map(d=>(
            <div key={d.id} className={clsx('rounded-xl p-3.5 border',PRIORITY[d.priority]?.row)}>
              <div className="flex items-start gap-3">
                <span className="text-lg leading-none shrink-0 mt-0.5">{d.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-white">{d.title}</span>
                    <span className={clsx('text-[9px] px-1.5 py-0.5 rounded border font-bold',PRIORITY[d.priority]?.badge)}>{d.priority}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mb-1.5 leading-relaxed">{d.detail}</div>
                  <div className="text-[10px] font-semibold text-slate-300">→ {d.action}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current month */}
      {curr&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{curr.label}</span>
              <StatusPill status={curr.status}/>
            </div>
            <span className="text-[10px] text-slate-500">{curr.daysElapsed}d elapsed · {curr.daysRemaining}d left</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-700 to-brand-500 transition-all" style={{width:`${progressPct}%`}}/>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5">Plan Orders</div>
              <div className="font-bold text-white">{curr.planOrders?.toLocaleString()||'—'}</div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5">Actual Orders</div>
              <div className={clsx('font-bold',(curr.actualOrders||0)>=(curr.planOrders||0)?'text-emerald-400':'text-amber-400')}>
                {curr.actualOrders?.toLocaleString()||'0'}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-500 mb-0.5">Gap</div>
              <div className={clsx('font-bold',(curr.gap||0)>=0?'text-emerald-400':'text-red-400')}>
                {(curr.gap||0)>=0?'+':''}{(curr.gap||0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 30-day movement chart */}
      {movementData.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="text-sm font-bold text-white mb-3">30-Day Order Movement</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={movementData} margin={{top:4,right:4,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.6}/>
              <XAxis dataKey="date" tick={{fill:'#64748b',fontSize:9}} axisLine={false} tickLine={false} interval={4}/>
              <YAxis tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} width={30}/>
              <Tooltip content={<Tip/>}/>
              <Line type="monotone" dataKey="Orders" stroke="#818cf8" strokeWidth={2} dot={false}/>
              <Line type="monotone" dataKey="7d Avg" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 2" dot={false}/>
              <Line type="monotone" dataKey="Plan" stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 3" dot={false}/>
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-5 justify-center mt-1">
            {[['Orders','#818cf8'],['7d Avg','#22c55e'],['Plan','#f59e0b']].map(([l,c])=>(
              <div key={l} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="w-2.5 h-2.5 rounded-full" style={{background:c+'80',border:`1.5px solid ${c}`}}/>{l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan vs Actual table */}
      {pvaVisible.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/40">
            <span className="text-sm font-bold text-slate-200">Plan vs Actual</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                {['Month','Plan','Actual','Gap','Status'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pvaVisible.map(m=>(
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',m.key===currKey&&'bg-brand-950/20')}>
                    <td className="px-3 py-2.5 text-white font-medium">
                      {m.label}
                      {m.key===currKey&&<span className="ml-1 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{m.planOrders?.toLocaleString()||'—'}</td>
                    <td className="px-3 py-2.5 text-white font-semibold">{m.actualOrders?.toLocaleString()||'—'}</td>
                    <td className={clsx('px-3 py-2.5 font-semibold',(m.gap||0)>=0?'text-emerald-400':'text-red-400')}>
                      {(m.gap||0)>=0?'+':''}{(m.gap||0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5"><StatusPill status={m.status}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── TAB: MARKETING ─────────────────────────────────────────────────── */
function TabMarketing({ plan, months, creative, savePlan, enrichedRows }) {
  const [view,setView]         = useState('live');
  const [editCols,setEditCols] = useState(false);
  const [colsDraft,setColsDraft]= useState((plan.collections||[]).map(c=>({...c})));

  useEffect(()=>{ setColsDraft((plan.collections||[]).map(c=>({...c}))); },[plan.collections]);

  const saveCols = () => {
    savePlan({collections:colsDraft.map(c=>({...c,alloc:parseFloat(c.alloc)||0,roas:parseFloat(c.roas)||0,cpr:parseFloat(c.cpr)||0}))});
    setEditCols(false);
  };

  const hasLive = creative.collections?.length>0 || creative.topCreatives?.length>0;
  const totalSpend = creative.collections?.reduce((s,c)=>s+(c.spend||0),0)||0;

  return (
    <div className="space-y-5">
      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-900/50 rounded-xl p-1 border border-gray-800/50 w-fit">
        {[['live','Live Performance'],['budget','Budget Plan'],['creative','Creatives']].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)}
            className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-all',
              view===v?'bg-brand-600/20 text-brand-300':'text-slate-400 hover:text-slate-200 hover:bg-gray-800/40')}>
            {l}
          </button>
        ))}
      </div>

      {/* ── LIVE PERFORMANCE ── */}
      {view==='live'&&(
        <div className="space-y-4">
          {!hasLive&&<EmptyState text="Pull Meta data from Analytics tab to unlock live performance"/>}

          {hasLive&&(
            <>
              {/* Collection scorecards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {creative.collections.slice(0,4).map(c=>{
                  const target=(plan.collections||[]).find(x=>x.key===c.key||x.label===c.name);
                  const roasOk = c.avgRoas>=(target?.roas||4);
                  const cprOk  = (c.avgCpr||999)<=(target?.cpr||999);
                  return (
                    <div key={c.name} className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{background:target?.color||'#818cf8'}}/>
                          <span className="text-xs font-bold text-white truncate max-w-[90px]">{c.name}</span>
                        </div>
                        <span className={clsx('text-[8px] px-1.5 py-0.5 rounded font-bold',
                          c.status==='excellent'?'bg-emerald-500/20 text-emerald-400':
                          c.status==='good'?'bg-brand-500/20 text-brand-400':'bg-amber-500/20 text-amber-400')}>
                          {(c.status||'').toUpperCase()}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-white mb-0.5">{c.avgRoas}x</div>
                      <div className={clsx('text-[10px]',roasOk?'text-emerald-400':'text-amber-400')}>
                        ROAS {roasOk?'▲ above':'▼ below'} {target?.roas||4}x target
                      </div>
                      <div className="flex justify-between text-[10px] mt-2 text-slate-500">
                        <span>₹{c.avgCpr} CPR</span>
                        <span>{c.adCount} ads</span>
                        <span>{fmtRs(c.spend)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Fatigue alerts */}
              {creative.fatigueAlerts?.length>0&&(
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 px-1">
                    <AlertTriangle size={10}/>Creative Fatigue — {creative.fatigueAlerts.length} ads
                  </div>
                  {creative.fatigueAlerts.slice(0,5).map((a,i)=>(
                    <div key={i} className="flex items-center gap-3 bg-amber-950/20 border border-amber-800/30 rounded-lg p-3 text-xs">
                      <AlertTriangle size={12} className="text-amber-400 shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-medium truncate block">{a.name}</span>
                        <span className="text-slate-500 text-[10px]">{a.collection}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-red-400 font-bold text-sm">{a.roas7d?.toFixed(1)}x</div>
                        <div className="text-slate-500 text-[9px]">was {a.roas30d?.toFixed(1)}x</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* What to publish */}
              {creative.whatToPublish?.length>0&&(
                <Section title="Collection Recommendations" icon={Target} defaultOpen={true}>
                  {creative.whatToPublish.map(w=>{
                    const coll=(plan.collections||[]).find(c=>c.key===w.key);
                    const PSTYLE={HIGH:'border-l-4 border-amber-500 bg-amber-950/15',URGENT:'border-l-4 border-red-500 bg-red-950/15',MEDIUM:'border-l-4 border-brand-500 bg-brand-950/10',LOW:'border-l-4 border-gray-600'};
                    return (
                      <div key={w.key} className={clsx('rounded-xl border border-gray-800/50 p-3.5 mb-3',PSTYLE[w.urgency]||PSTYLE.LOW)}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{background:coll?.color||'#818cf8'}}/>
                            <span className="text-sm font-bold text-white">{w.collection}</span>
                            <span className="text-[10px] text-slate-500">{w.budgetShare}% of budget</span>
                          </div>
                          <span className={clsx('text-[9px] px-1.5 py-0.5 rounded border font-bold',PRIORITY[w.urgency]?.badge)}>{w.urgency}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2.5 text-xs">
                          <div><div className="text-[9px] text-slate-500 mb-0.5">Live ROAS</div>
                            <div className={clsx('font-bold',w.currentRoas>=w.targetRoas?'text-emerald-400':'text-amber-400')}>{w.currentRoas.toFixed(2)}x</div></div>
                          <div><div className="text-[9px] text-slate-500 mb-0.5">Target</div>
                            <div className="font-bold text-white">{w.targetRoas.toFixed(2)}x</div></div>
                          <div><div className="text-[9px] text-slate-500 mb-0.5">Active Ads</div>
                            <div className="font-bold text-white">{w.activeAds}</div></div>
                        </div>
                        <div className="bg-gray-900/60 border border-gray-700/40 rounded-lg p-2.5 text-xs text-slate-300">
                          <span className="font-bold text-white">→ </span>{w.recommendation}
                        </div>
                      </div>
                    );
                  })}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BUDGET PLAN ── */}
      {view==='budget'&&(
        <div className="space-y-4">
          <Section title="Collection Targets" icon={Layers}
            action={!editCols?{label:'Edit',fn:()=>setEditCols(true)}:undefined}>
            {editCols?(
              <div className="space-y-3 mt-1">
                {colsDraft.map((c,i)=>(
                  <div key={c.key} className="grid grid-cols-4 gap-2 items-end">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background:c.color}}/>{c.label}
                    </div>
                    {[['alloc','Alloc %'],['roas','ROAS x'],['cpr','CPR ₹']].map(([f,l])=>(
                      <div key={f}>
                        <div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                        <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs text-center focus:border-brand-500 focus:outline-none"
                          value={f==='alloc'?Math.round(c[f]*100):c[f]}
                          onChange={e=>setColsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:f==='alloc'?parseFloat(e.target.value)/100:e.target.value}:x))}/>
                      </div>
                    ))}
                  </div>
                ))}
                <SaveCancelBtns onSave={saveCols} onCancel={()=>setEditCols(false)}/>
              </div>
            ):(
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                {(plan.collections||[]).map(c=>(
                  <div key={c.key} className="bg-gray-800/50 border border-gray-700/30 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-2 h-2 rounded-full" style={{background:c.color}}/>
                      <span className="text-xs font-bold text-white">{c.label}</span>
                    </div>
                    <div className="text-lg font-bold text-white">{Math.round(c.alloc*100)}%</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">budget share</div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-2">
                      <span>{c.roas}x ROAS</span><span>₹{c.cpr} CPR</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800/40 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">Monthly Marketing Budget</span>
              <button onClick={()=>downloadCsv('marketing_budget.csv',months.map(m=>{const mk=buildMarketingNeeds(m,plan);return{Month:m.label,Budget_Per_Day:Math.round(m.adBudgetPerDay),Monthly_Budget:Math.round(mk.totalMonthlyBudget),Campaigns:mk.campaigns,Creatives:mk.creatives,Expected_Orders:mk.expectedResults};}))}
                className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
                <Download size={11}/>CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                  {['Month','Budget/Day','Monthly Budget','Campaigns','Creatives','Target Orders','CPR Target'].map(h=>(
                    <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{months.map(m=>{
                  const mk=buildMarketingNeeds(m,plan);
                  const isNow=m.key===MONTH_KEY();
                  return (
                    <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',isNow&&'bg-brand-950/20')}>
                      <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">
                        {m.label}{isNow&&<span className="ml-1 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                      </td>
                      <td className="px-3 py-2.5 text-amber-400 font-semibold">{fmtRs(m.adBudgetPerDay)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{mk.campaigns}</td>
                      <td className="px-3 py-2.5 text-slate-300">{mk.creatives}</td>
                      <td className="px-3 py-2.5 text-white">{mk.expectedResults?.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-slate-400">₹{plan.targetCpr}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATIVES ── */}
      {view==='creative'&&(
        <div className="space-y-4">
          {!hasLive&&<EmptyState text="Pull Meta data from Analytics tab to unlock creative performance"/>}
          {hasLive&&creative.topCreatives?.length>0&&(
            <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800/40">
                <span className="text-sm font-bold text-slate-200">Top Performing Creatives</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                    {['Creative','Collection','7d ROAS','30d ROAS','CPR','Spend','Purchases','Status'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{creative.topCreatives.slice(0,20).map((c,i)=>{
                    const dropping = c.roas7d<c.roas30d*0.8;
                    return (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                        <td className="px-3 py-2.5 text-white max-w-[200px] truncate font-medium">{c.name}</td>
                        <td className="px-3 py-2.5 text-slate-400">{c.collection}</td>
                        <td className={clsx('px-3 py-2.5 font-bold',dropping?'text-red-400':'text-emerald-400')}>{c.roas7d?.toFixed(2)}x</td>
                        <td className="px-3 py-2.5 text-slate-400">{c.roas30d?.toFixed(2)}x</td>
                        <td className="px-3 py-2.5 text-slate-300">₹{c.cpr7d?.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{fmtRs(c.spend)}</td>
                        <td className="px-3 py-2.5 text-slate-300">{c.purchases}</td>
                        <td className="px-3 py-2.5">
                          {dropping
                            ?<span className="text-[9px] bg-red-500/20 text-red-400 border border-red-700/40 px-1.5 py-0.5 rounded font-bold">FATIGUE</span>
                            :<span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-700/30 px-1.5 py-0.5 rounded font-bold">ACTIVE</span>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── TAB: FINANCE ───────────────────────────────────────────────────── */
function TabFinance({ plan, months, finPlan, savePlan }) {
  const [editCore,setEditCore]=useState(false);
  const [core,setCore]=useState({
    brandName:        plan.brandName||'',
    baseOrdersPerDay: plan.baseOrdersPerDay,
    monthlyGrowthRate:Math.round((plan.monthlyGrowthRate||0.2)*100),
    targetCpr:        plan.targetCpr,
    targetRoas:       plan.targetRoas,
    aov:              plan.aov,
    grossMarginPct:   Math.round((plan.grossMarginPct||0.6)*100),
    opsCostPct:       Math.round((plan.opsCostPct||0.05)*100),
    inventoryCostPct: Math.round((plan.inventoryCostPct||0.3)*100),
  });

  useEffect(()=>{
    setCore({
      brandName:plan.brandName||'',baseOrdersPerDay:plan.baseOrdersPerDay,
      monthlyGrowthRate:Math.round((plan.monthlyGrowthRate||0.2)*100),
      targetCpr:plan.targetCpr,targetRoas:plan.targetRoas,aov:plan.aov,
      grossMarginPct:Math.round((plan.grossMarginPct||0.6)*100),
      opsCostPct:Math.round((plan.opsCostPct||0.05)*100),
      inventoryCostPct:Math.round((plan.inventoryCostPct||0.3)*100),
    });
  },[plan]);

  const saveCore = () => {
    savePlan({
      brandName:core.brandName,
      baseOrdersPerDay:+core.baseOrdersPerDay,
      monthlyGrowthRate:core.monthlyGrowthRate/100,
      targetCpr:+core.targetCpr, targetRoas:+core.targetRoas, aov:+core.aov,
      grossMarginPct:core.grossMarginPct/100,
      opsCostPct:core.opsCostPct/100,
      inventoryCostPct:core.inventoryCostPct/100,
    });
    setEditCore(false);
  };

  const chartData = finPlan.map(m=>({
    label:m.label.slice(0,3),
    Revenue:Math.round(m.revenue),
    'Ad Spend':Math.round(m.adSpend),
    'Net Profit':Math.round(m.netProfit),
  }));

  const totalRev   = finPlan.reduce((s,m)=>s+(m.revenue||0),0);
  const totalProfit= finPlan.reduce((s,m)=>s+(m.netProfit||0),0);
  const totalSpend = finPlan.reduce((s,m)=>s+(m.adSpend||0),0);
  const totalCap   = finPlan.reduce((s,m)=>s+(m.capitalNeeded||0),0);

  return (
    <div className="space-y-5">
      {/* Core model editor */}
      <Section title="Financial Model" icon={Wallet} action={!editCore?{label:'Edit',fn:()=>setEditCore(true)}:undefined}>
        {editCore?(
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-1">
            {[
              ['brandName','Brand Name',''],
              ['baseOrdersPerDay','Base Orders/Day',''],
              ['monthlyGrowthRate','Monthly Growth','%'],
              ['aov','Avg Order Value','₹'],
              ['targetCpr','Target CPR','₹'],
              ['targetRoas','Target ROAS','x'],
              ['grossMarginPct','Gross Margin','%'],
              ['opsCostPct','Ops Cost','%'],
              ['inventoryCostPct','Inventory Cost','%'],
            ].map(([f,l,u])=>(
              <div key={f}>
                <div className="text-[9px] text-slate-500 mb-1">{l}{u&&<span className="text-slate-600"> ({u})</span>}</div>
                <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-brand-500 focus:outline-none"
                  value={core[f]} onChange={e=>setCore(p=>({...p,[f]:e.target.value}))}/>
              </div>
            ))}
            <SaveCancelBtns onSave={saveCore} onCancel={()=>setEditCore(false)} label="Recalculate"/>
          </div>
        ):(
          <div className="flex flex-wrap gap-3 mt-1">
            {[
              ['Base Orders',`${plan.baseOrdersPerDay}/day`],
              ['Growth',`${Math.round((plan.monthlyGrowthRate||0.2)*100)}%/mo`],
              ['AOV',`₹${plan.aov}`],
              ['Gross Margin',`${Math.round((plan.grossMarginPct||0.6)*100)}%`],
              ['Ops Cost',`${Math.round((plan.opsCostPct||0.05)*100)}%`],
              ['Inv Cost',`${Math.round((plan.inventoryCostPct||0.3)*100)}%`],
            ].map(([l,v])=>(
              <div key={l} className="bg-gray-800/60 border border-gray-700/40 rounded-xl px-4 py-2.5">
                <div className="text-[9px] text-slate-500 mb-0.5">{l}</div>
                <div className="text-sm font-bold text-white">{v}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 12-month summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="12M Revenue" value={fmtRs(totalRev)} accent/>
        <KpiCard label="12M Net Profit" value={fmtRs(totalProfit)} cls={totalProfit>0?'text-emerald-400':'text-red-400'}/>
        <KpiCard label="12M Ad Spend" value={fmtRs(totalSpend)}/>
        <KpiCard label="Peak Capital Need" value={fmtRs(Math.max(...finPlan.map(m=>m.capitalNeeded||0)))} warn/>
      </div>

      {/* P&L chart */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
        <div className="text-sm font-bold text-white mb-3">12-Month P&L Forecast</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{top:4,right:4,bottom:0,left:0}}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/><stop offset="95%" stopColor="#818cf8" stopOpacity={0.02}/>
              </linearGradient>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.6}/>
            <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={v=>fmtK(v)} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} width={50}/>
            <Tooltip content={<Tip/>}/>
            <Area type="monotone" dataKey="Revenue"    stroke="#818cf8" fill="url(#revGrad)"    strokeWidth={2} dot={false}/>
            <Area type="monotone" dataKey="Ad Spend"   stroke="#f59e0b" fill="none"              strokeWidth={1.5} strokeDasharray="4 2" dot={false}/>
            <Area type="monotone" dataKey="Net Profit" stroke="#22c55e" fill="url(#profitGrad)" strokeWidth={2} dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-5 justify-center mt-1">
          {[['Revenue','#818cf8'],['Ad Spend','#f59e0b'],['Net Profit','#22c55e']].map(([l,c])=>(
            <div key={l} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{background:c+'80',border:`1.5px solid ${c}`}}/>{l}
            </div>
          ))}
        </div>
      </div>

      {/* P&L table */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/40 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-200">Detailed P&L by Month</span>
          <button onClick={()=>downloadCsv('pl.csv',finPlan.map(m=>({Month:m.label,Revenue:Math.round(m.revenue),COGS:Math.round(m.cogs),GrossProfit:Math.round(m.grossProfit),AdSpend:Math.round(m.adSpend),OpsCost:Math.round(m.opsCost),NetProfit:Math.round(m.netProfit),Capital:Math.round(m.capitalNeeded),Margin:m.netMarginPct})))}
            className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
            <Download size={11}/>CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
              {['Month','Revenue','COGS','Gross Profit','Ad Spend','Ops Cost','Net Profit','Capital Need','Margin %'].map(h=>(
                <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {finPlan.map((m,i)=>{
                const isNow=months[i]?.key===MONTH_KEY();
                return (
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',isNow&&'bg-brand-950/20')}>
                    <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">
                      {m.label}{isNow&&<span className="ml-1 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(m.revenue)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{fmtRs(m.cogs)}</td>
                    <td className="px-3 py-2.5 text-emerald-400 font-semibold">{fmtRs(m.grossProfit)}</td>
                    <td className="px-3 py-2.5 text-amber-400">{fmtRs(m.adSpend)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{fmtRs(m.opsCost)}</td>
                    <td className={clsx('px-3 py-2.5 font-bold',m.netProfit>0?'text-emerald-400':'text-red-400')}>{fmtRs(m.netProfit)}</td>
                    <td className={clsx('px-3 py-2.5',m.capitalNeeded>m.grossProfit?'text-amber-400':'text-slate-400')}>{fmtRs(m.capitalNeeded)}</td>
                    <td className={clsx('px-3 py-2.5 font-bold',m.netMarginPct>0?'text-emerald-400':'text-red-400')}>{m.netMarginPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── TAB: OPERATIONS ────────────────────────────────────────────────── */
function TabOperations({ plan, months, opsPlan, whPlan, savePlan }) {
  const roles = plan.shiftRoles || DEFAULT_SHIFT_ROLES;
  const [editRoles,setEditRoles] = useState(false);
  const [rolesDraft,setRolesDraft]= useState({...roles});
  const [editWH,setEditWH]       = useState(false);
  const [whDraft,setWhDraft]     = useState((plan.warehouses||[]).map(w=>({...w})));

  useEffect(()=>{ setRolesDraft({...plan.shiftRoles||DEFAULT_SHIFT_ROLES}); },[plan.shiftRoles]);
  useEffect(()=>{ setWhDraft((plan.warehouses||[]).map(w=>({...w}))); },[plan.warehouses]);

  const saveRoles = () => { savePlan({shiftRoles:rolesDraft}); setEditRoles(false); };
  const saveWH = () => {
    savePlan({warehouses:whDraft.map(w=>({...w,sqMeters:+w.sqMeters,heightMeters:+w.heightMeters,utilizationPct:+w.utilizationPct}))});
    setEditWH(false);
  };

  const firstOver = whPlan.find(m=>m.overfill);

  return (
    <div className="space-y-5">
      {/* Shift Role Editor */}
      <Section title={`Shift Roles — ${plan.brandName||'Brand'}`} icon={Users}
        badge="brand-specific"
        action={!editRoles?{label:'Edit Roles',fn:()=>setEditRoles(true)}:undefined}>
        {editRoles?(
          <div className="space-y-3 mt-2">
            <div className="text-[10px] text-slate-500 mb-3">Customize how your brand names each role. These titles appear throughout the Operations view.</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(DEFAULT_SHIFT_ROLES).map(([key,defaultLabel])=>(
                <div key={key}>
                  <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wider">{key}</div>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-brand-500 focus:outline-none"
                    placeholder={defaultLabel}
                    value={rolesDraft[key]||''}
                    onChange={e=>setRolesDraft(p=>({...p,[key]:e.target.value}))}/>
                </div>
              ))}
            </div>
            <SaveCancelBtns onSave={saveRoles} onCancel={()=>setEditRoles(false)}/>
          </div>
        ):(
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(roles).map(([key,label])=>(
              <div key={key} className="bg-gray-800/60 border border-gray-700/40 rounded-xl px-3 py-2">
                <div className="text-[9px] text-slate-600 mb-0.5 uppercase tracking-wider">{key}</div>
                <div className="text-xs font-bold text-white">{label}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Warehouse utilization */}
      {firstOver&&(
        <div className={clsx('rounded-xl border p-3.5 flex items-start gap-3',
          firstOver.danger?'bg-red-950/25 border-red-800/40':'bg-amber-950/15 border-amber-800/30')}>
          <Building2 size={14} className={clsx('mt-0.5 shrink-0',firstOver.danger?'text-red-400':'text-amber-400')}/>
          <div className="text-xs">
            <span className={clsx('font-bold',firstOver.danger?'text-red-300':'text-amber-300')}>
              {firstOver.danger?'Warehouse full — ':'Overflow projected: '}
            </span>
            <span className="font-bold text-white">{firstOver.label}</span>
            <span className="text-slate-400"> · {firstOver.utilization?.toFixed(0)}% utilized · {firstOver.totalVolumeM3}m³ needed vs {firstOver.totalCapM3}m³ available</span>
          </div>
        </div>
      )}

      <Section title="Warehouse Config" icon={Building2}
        action={!editWH?{label:'Edit',fn:()=>setEditWH(true)}:undefined}>
        {editWH?(
          <div className="space-y-3 mt-2">
            {whDraft.map((w,i)=>(
              <div key={w.id} className="bg-gray-800/40 rounded-xl border border-gray-700/30 p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                  {[['name','Name'],['location','Location'],['sqMeters','Floor m²'],['heightMeters','Height m']].map(([f,l])=>(
                    <div key={f}>
                      <div className="text-[9px] text-slate-500 mb-0.5">{l}</div>
                      <input className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:border-brand-500 focus:outline-none"
                        value={w[f]} onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,[f]:e.target.value}:x))}/>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={w.active||false}
                      onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,active:e.target.checked}:x))}
                      className="accent-brand-500"/>
                    Active
                  </label>
                  <div className="flex-1 text-[10px] text-slate-500">{w.notes}</div>
                </div>
              </div>
            ))}
            <SaveCancelBtns onSave={saveWH} onCancel={()=>setEditWH(false)}/>
          </div>
        ):(
          <div className="space-y-2 mt-2">
            {(plan.warehouses||[]).map(w=>(
              <div key={w.id} className={clsx('flex items-center gap-4 rounded-xl border p-3',
                w.active?'border-brand-700/40 bg-brand-950/10':'border-gray-700/30 bg-gray-800/20 opacity-60')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-1.5 h-1.5 rounded-full',w.active?'bg-emerald-400':'bg-gray-600')}/>
                    <span className="text-xs font-bold text-white">{w.name}</span>
                    <span className="text-[10px] text-slate-500">{w.location}</span>
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{w.sqMeters}m² · {w.heightMeters}m · {w.notes}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-white">{Math.round(w.sqMeters*w.heightMeters*(w.utilizationPct||0.7))}m³</div>
                  <div className="text-[9px] text-slate-500">usable</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Warehouse utilization timeline */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
        <div className="text-sm font-bold text-white mb-3">Warehouse Utilization Timeline</div>
        <div className="space-y-1.5">
          {whPlan.map(m=>(
            <div key={m.key} className="flex items-center gap-3">
              <div className="w-14 text-[10px] text-slate-500 shrink-0">{m.label?.slice(0,6)}</div>
              <div className="flex-1 h-3.5 bg-gray-800 rounded overflow-hidden relative">
                <div className={clsx('h-full rounded transition-all duration-300',
                  m.danger?'bg-gradient-to-r from-red-600 to-red-500':
                  m.overfill?'bg-gradient-to-r from-amber-600 to-amber-500':
                  'bg-gradient-to-r from-brand-700 to-brand-500')}
                  style={{width:`${Math.min(m.utilization||0,100)}%`}}/>
              </div>
              <div className={clsx('w-12 text-[10px] font-bold text-right shrink-0',m.danger?'text-red-400':m.overfill?'text-amber-400':'text-slate-400')}>
                {(m.utilization||0).toFixed(0)}%
              </div>
              <div className="w-28 text-[10px] text-slate-600 shrink-0">{m.totalVolumeM3}m³/{m.totalCapM3}m³</div>
            </div>
          ))}
        </div>
      </div>

      {/* Headcount & shifts table */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/40">
          <span className="text-sm font-bold text-slate-200">Headcount & Shifts Plan</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
              {['Month','Ord/Day',roles.packer+'s',roles.qc,'Shifts',roles.ops,roles.cs,roles.logistics,'Total',roles.manager,'Packing Cap'].map(h=>(
                <th key={h} className="px-2.5 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {opsPlan.map((m,i)=>{
                const prev=opsPlan[i-1];
                const delta=prev?m.totalHeadcount-prev.totalHeadcount:0;
                const shiftUp=prev&&m.shifts>prev.shifts;
                const isNow=m.key===MONTH_KEY();
                return (
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',
                    shiftUp&&'bg-amber-950/10',isNow&&'bg-brand-950/20')}>
                    <td className="px-2.5 py-2.5 text-white font-medium whitespace-nowrap">
                      {m.label}{isNow&&<span className="ml-1 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.ordersPerDay}</td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.packers}</td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.qc}</td>
                    <td className={clsx('px-2.5 py-2.5 font-bold',shiftUp?'text-amber-400':'text-white')}>
                      {m.shifts}{shiftUp&&<span className="text-[8px] ml-1">↑</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.ops}</td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.cs}</td>
                    <td className="px-2.5 py-2.5 text-slate-300">{m.logistics}</td>
                    <td className="px-2.5 py-2.5 text-white font-semibold">
                      {m.totalHeadcount}{delta>0&&<span className="text-emerald-400 text-[9px] ml-1">+{delta}</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-500">1</td>
                    <td className={clsx('px-2.5 py-2.5 text-[10px]',m.capacityBuffer<10?'text-amber-400':'text-slate-500')}>
                      {m.packingCapacity?.toLocaleString()}/day
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── TAB: INVENTORY ─────────────────────────────────────────────────── */
function TabInventory({ plan, inventoryNeeds, savePlan }) {
  const [editDims,setEditDims]   = useState(false);
  const [dimsDraft,setDimsDraft] = useState((plan.skuDimensions||[]).map(d=>({...d})));
  const [editSupp,setEditSupp]   = useState(false);
  const [suppDraft,setSuppDraft] = useState((plan.suppliers||[]).map(s=>({...s})));

  useEffect(()=>{ setDimsDraft((plan.skuDimensions||[]).map(d=>({...d}))); },[plan.skuDimensions]);
  useEffect(()=>{ setSuppDraft((plan.suppliers||[]).map(s=>({...s}))); },[plan.suppliers]);

  const saveDims = () => { savePlan({skuDimensions:dimsDraft.map(d=>({...d,lengthCm:+d.lengthCm,widthCm:+d.widthCm,heightCm:+d.heightCm,unitsPerOrder:+d.unitsPerOrder,bufferDays:+d.bufferDays}))}); setEditDims(false); };
  const saveSupp = () => { savePlan({suppliers:suppDraft}); setEditSupp(false); };

  const critical  = inventoryNeeds.filter(i=>i.status==='critical'||i.status==='oos');
  const low       = inventoryNeeds.filter(i=>i.status==='low');
  const healthy   = inventoryNeeds.filter(i=>i.status==='healthy');

  return (
    <div className="space-y-5">
      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Critical / OOS" value={critical.length} cls={critical.length>0?'text-red-400':'text-emerald-400'} warn={critical.length>0}/>
        <KpiCard label="Low Stock" value={low.length} cls={low.length>0?'text-amber-400':'text-slate-300'}/>
        <KpiCard label="Healthy" value={healthy.length} cls="text-emerald-400"/>
      </div>

      {/* Live SKU health */}
      {inventoryNeeds.length===0?(
        <EmptyState text="Pull Shopify data from Analytics tab to see live stock levels"/>
      ):(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/40 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-200">Live SKU Health</span>
            <button onClick={()=>downloadCsv('inventory.csv',inventoryNeeds.map(i=>({SKU:i.name,Stock:i.current,VelPerDay:i.vel,DaysLeft:i.daysOfStock,Demand30d:i.demandNext30,ReorderQty:i.reorderQty,Status:i.status})))}
              className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
              <Download size={11}/>CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                {['SKU / Product','Stock','Vel/Day','Days Left','Demand 30d','Reorder Qty','Status'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {inventoryNeeds.map(item=>(
                  <tr key={item.sku} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',
                    (item.status==='oos'||item.status==='critical')&&'bg-red-950/10',
                    item.status==='low'&&'bg-amber-950/10')}>
                    <td className="px-3 py-2.5 text-white font-medium max-w-[220px] truncate">{item.name}</td>
                    <td className="px-3 py-2.5 text-slate-300">{item.current?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.vel}</td>
                    <td className={clsx('px-3 py-2.5 font-bold',
                      item.status==='oos'?'text-red-400':
                      item.status==='critical'?'text-red-400':
                      item.status==='low'?'text-amber-400':'text-emerald-400')}>
                      {fmtDays(item.daysOfStock)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{item.demandNext30?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300 font-semibold">{item.reorderQty?.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full font-bold border',
                        item.status==='oos'?'bg-red-500/20 text-red-400 border-red-700/40':
                        item.status==='critical'?'bg-red-500/15 text-red-400 border-red-800/30':
                        item.status==='low'?'bg-amber-500/15 text-amber-400 border-amber-800/30':
                        'bg-emerald-500/15 text-emerald-400 border-emerald-800/30')}>
                        {(item.status||'').toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SKU Dimensions */}
      <Section title="SKU Dimensions & Buffer Days" icon={Package}
        action={!editDims?{label:'Edit',fn:()=>setEditDims(true)}:undefined}
        defaultOpen={false}>
        {editDims?(
          <div className="space-y-3 mt-2">
            {dimsDraft.map((d,i)=>(
              <div key={d.key} className="bg-gray-800/40 rounded-xl border border-gray-700/30 p-3">
                <div className="text-xs font-bold text-white mb-2">{d.label}</div>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {[['lengthCm','L (cm)'],['widthCm','W (cm)'],['heightCm','H (cm)'],['unitsPerOrder','Units/Ord'],['bufferDays','Buffer Days']].map(([f,l])=>(
                    <div key={f}>
                      <div className="text-[9px] text-slate-500 mb-0.5">{l}</div>
                      <input className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:border-brand-500 focus:outline-none"
                        value={d[f]} onChange={e=>setDimsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:e.target.value}:x))}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <SaveCancelBtns onSave={saveDims} onCancel={()=>setEditDims(false)}/>
          </div>
        ):(
          <div className="overflow-x-auto rounded-xl border border-gray-800/50 mt-2">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                {['Collection','L×W×H (cm)','Units/Order','Buffer Days','Vol/Order (L)'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>{(plan.skuDimensions||[]).map(d=>{
                const vol=((d.lengthCm*d.widthCm*d.heightCm)/1000*d.unitsPerOrder).toFixed(1);
                return (
                  <tr key={d.key} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                    <td className="px-3 py-2.5 text-white font-medium">{d.label}</td>
                    <td className="px-3 py-2.5 text-slate-300">{d.lengthCm}×{d.widthCm}×{d.heightCm}</td>
                    <td className="px-3 py-2.5 text-slate-300">{d.unitsPerOrder}</td>
                    <td className="px-3 py-2.5 text-amber-400 font-semibold">{d.bufferDays}d</td>
                    <td className="px-3 py-2.5 text-slate-400">{vol}L</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Supplier lead times (tracking only, no PO planning) */}
      <Section title="Supplier Lead Times" icon={ShoppingCart}
        action={!editSupp?{label:'Edit',fn:()=>setEditSupp(true)}:undefined}
        defaultOpen={false}>
        {editSupp?(
          <div className="space-y-3 mt-2">
            {suppDraft.map((s,i)=>(
              <div key={s.id} className="bg-gray-800/40 rounded-xl border border-gray-700/30 p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[['name','Supplier Name'],['category','Category'],['leadTimeDays','Lead Days'],['paymentTerms','Payment Terms']].map(([f,l])=>(
                    <div key={f}>
                      <div className="text-[9px] text-slate-500 mb-0.5">{l}</div>
                      <input className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:border-brand-500 focus:outline-none"
                        value={s[f]} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,[f]:e.target.value}:x))}/>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <div className="text-[9px] text-slate-500 mb-0.5">Notes</div>
                  <input className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:border-brand-500 focus:outline-none"
                    value={s.notes||''} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,notes:e.target.value}:x))}/>
                </div>
              </div>
            ))}
            <SaveCancelBtns onSave={saveSupp} onCancel={()=>setEditSupp(false)}/>
          </div>
        ):(
          <div className="overflow-x-auto rounded-xl border border-gray-800/50 mt-2">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                {['Supplier','Category','Lead Time','Payment','MOQ','Notes'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>{(plan.suppliers||[]).map(s=>(
                <tr key={s.id} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                  <td className="px-3 py-2.5 text-white font-medium">{s.name}</td>
                  <td className="px-3 py-2.5 text-slate-400">{s.category}</td>
                  <td className="px-3 py-2.5 text-amber-400 font-semibold">{s.leadTimeDays}d</td>
                  <td className="px-3 py-2.5 text-slate-300">{s.paymentTerms}</td>
                  <td className="px-3 py-2.5 text-slate-400">{s.moqUnits?.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-slate-500 max-w-[200px] truncate">{s.notes}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── TAB: ANALYTICS ─────────────────────────────────────────────────── */
function TabAnalytics({ predictions, adv, seasonality, cohorts, allOrders, isPulling, pullLog, pullProgress, onPull, lastPullAt, stats, onUpload }) {
  const fileRef = useRef();

  const forecastData = (adv.forecastArray||[]).slice(0,21).map(d=>({
    date:d.date, Base:d.base, Bull:d.bull, Bear:d.bear,
  }));

  const cohortList = cohorts.cohortList||[];
  const ltvBuckets = cohorts.ltvBuckets||[];

  return (
    <div className="space-y-5">
      {/* Pull panel */}
      <div className={clsx('rounded-xl border p-4',
        isPulling?'border-brand-700/60 bg-brand-950/30':
        stats.orders>0||stats.ads>0?'border-gray-800/50 bg-gray-900/40':'border-amber-800/40 bg-amber-950/20')}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-bold text-white shrink-0">Live Data Pull</span>
            {(stats.orders>0||stats.ads>0)&&!isPulling&&(
              <div className="flex items-center gap-2 text-[10px] flex-wrap">
                {stats.ads>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.ads.toLocaleString()} ads</span>}
                {stats.orders>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.orders.toLocaleString()} orders</span>}
                {stats.skus>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.skus} SKUs</span>}
                {lastPullAt&&<span className="text-slate-600">· {new Date(lastPullAt).toLocaleTimeString()}</span>}
              </div>
            )}
            {!(stats.orders>0||stats.ads>0)&&!isPulling&&(
              <span className="text-[10px] text-amber-400/80">No data — pull to unlock all analytics</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={()=>fileRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 border border-gray-700/60 text-slate-400 rounded-lg text-[10px] hover:bg-gray-700 hover:text-slate-200 transition-colors">
              <Upload size={10}/>CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e=>{
              const f=e.target.files?.[0]; if(!f) return;
              const r=new FileReader(); r.onload=ev=>onUpload(ev.target.result); r.readAsText(f); e.target.value='';
            }}/>
            <button onClick={onPull} disabled={isPulling}
              className={clsx('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all',
                isPulling?'bg-brand-800/50 text-brand-400 cursor-not-allowed':'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40')}>
              <RefreshCw size={12} className={isPulling?'animate-spin':''}/>
              {isPulling?'Pulling…':'Pull Live Data'}
            </button>
          </div>
        </div>
        {isPulling&&(
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
              <span>Fetching…</span><span className="font-semibold text-brand-400">{pullProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500" style={{width:`${pullProgress}%`}}/>
            </div>
          </div>
        )}
        {pullLog.length>0&&(
          <div className="mt-3 space-y-0.5 max-h-36 overflow-y-auto scrollbar-thin">
            {pullLog.map((e,i)=>(
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                  e.status==='done'?'bg-emerald-400':e.status==='error'?'bg-red-400':'bg-amber-400 animate-pulse')}/>
                <span className={e.status==='error'?'text-red-400':e.status==='done'?'text-slate-300':'text-slate-500'}>{e.msg}</span>
                {e.count!=null&&e.count>0&&<span className="text-slate-600">· {e.count.toLocaleString()}</span>}
                <span className="text-slate-700 ml-auto shrink-0">{e.ts}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prediction KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="7-Day Avg" value={Math.round(predictions.avg7||0)} sub="orders/day" accent/>
        <KpiCard label="30-Day Avg" value={Math.round(predictions.avg30||0)} sub="orders/day"/>
        <KpiCard label="Trend" value={adv.regStats?.interpretation||'—'} cls="text-sm text-slate-300"/>
        <KpiCard label="Model Confidence" value={adv.regStats?.confidence||'—'}
          cls={adv.regStats?.confidence==='High'?'text-emerald-400':adv.regStats?.confidence==='Medium'?'text-amber-400':'text-red-400'}/>
      </div>

      {/* 21-day forecast */}
      {forecastData.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="text-sm font-bold text-white mb-1">21-Day Order Forecast</div>
          <div className="text-[10px] text-slate-500 mb-3">
            R²={adv.regStats?.r2} · slope={adv.regStats?.slope}/day · {adv.regStats?.interpretation}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={forecastData} margin={{top:4,right:4,bottom:0,left:0}}>
              <defs>
                <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.6}/>
              <XAxis dataKey="date" tick={{fill:'#64748b',fontSize:9}} axisLine={false} tickLine={false} interval={3}/>
              <YAxis tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} width={30}/>
              <Tooltip content={<Tip/>}/>
              <Area type="monotone" dataKey="Bull" stroke="#22c55e" fill="url(#bullGrad)" strokeWidth={1} strokeDasharray="3 3" dot={false}/>
              <Area type="monotone" dataKey="Base" stroke="#818cf8" fill="none" strokeWidth={2} dot={false}/>
              <Area type="monotone" dataKey="Bear" stroke="#ef4444" fill="none" strokeWidth={1} strokeDasharray="3 3" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-5 justify-center mt-1">
            {[['Base','#818cf8'],['Bull','#22c55e'],['Bear','#ef4444']].map(([l,c])=>(
              <div key={l} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="w-2.5 h-2.5 rounded-full" style={{background:c+'80',border:`1.5px solid ${c}`}}/>{l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scenarios */}
      {adv.scenarios?.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/40">
            <span className="text-sm font-bold text-slate-200">6-Month Scenario Analysis</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                {['Month','Plan Orders','Base Orders','Bull Orders','Bear Orders','Base Rev','Gap to Plan'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>{adv.scenarios.map(s=>(
                <tr key={s.label} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                  <td className="px-3 py-2.5 text-white font-medium">{s.label}</td>
                  <td className="px-3 py-2.5 text-slate-400">{s.plan?.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-brand-400 font-semibold">{s.base?.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-emerald-400">{s.bull?.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-red-400">{s.bear?.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-slate-300">{fmtRs(s.baseRev)}</td>
                  <td className={clsx('px-3 py-2.5 font-semibold',(s.baseGap||0)>=0?'text-emerald-400':'text-red-400')}>
                    {(s.baseGap||0)>=0?'+':''}{(s.baseGap||0).toFixed(1)}%
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cohort metrics */}
      {allOrders.length>0&&(
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Total Customers" value={(cohorts.total||0).toLocaleString()}/>
            <KpiCard label="Repeat Rate" value={`${cohorts.repeatRate||0}%`} cls="text-brand-400"/>
            <KpiCard label="Avg LTV" value={fmtRs(cohorts.avgLtv||0)} accent/>
          </div>

          {cohortList.length>0&&(
            <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800/40">
                <span className="text-sm font-bold text-slate-200">Monthly Cohorts</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
                    {['Month','New Customers','Repeat','Repeat Rate','Avg Revenue'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{cohortList.map(c=>(
                    <tr key={c.key} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                      <td className="px-3 py-2.5 text-white font-medium">{c.label}</td>
                      <td className="px-3 py-2.5 text-slate-300">{c.newCustomers?.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-brand-400">{c.repeatCustomers?.toLocaleString()}</td>
                      <td className={clsx('px-3 py-2.5 font-semibold',c.repeatRate>20?'text-emerald-400':c.repeatRate>10?'text-amber-400':'text-slate-400')}>
                        {c.repeatRate}%
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{fmtRs(c.avgRevenue)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* LTV buckets */}
          {ltvBuckets.length>0&&(
            <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
              <div className="text-sm font-bold text-white mb-3">Customer LTV Distribution</div>
              <div className="space-y-2">
                {ltvBuckets.map(b=>{
                  const pct=cohorts.total>0?Math.round((b.count/cohorts.total)*100):0;
                  return (
                    <div key={b.label} className="flex items-center gap-3">
                      <div className="w-20 text-[10px] text-slate-400 shrink-0">{b.label}</div>
                      <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full rounded bg-gradient-to-r from-brand-700 to-brand-500 transition-all" style={{width:`${pct}%`}}/>
                      </div>
                      <div className="w-16 text-[10px] text-right shrink-0">
                        <span className="font-bold text-white">{b.count?.toLocaleString()}</span>
                        <span className="text-slate-600 ml-1">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seasonality */}
          {(seasonality.dayOfWeek||[]).length>0&&(
            <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
              <div className="text-sm font-bold text-white mb-3">Day-of-Week Seasonality</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={seasonality.dayOfWeek} margin={{top:4,right:4,bottom:0,left:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.6}/>
                  <XAxis dataKey="day" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#64748b',fontSize:9}} axisLine={false} tickLine={false} width={30}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="orders" fill="#818cf8" radius={[3,3,0,0]}>
                    {(seasonality.dayOfWeek||[]).map((d,i)=>(
                      <Cell key={i} fill={d.orders===Math.max(...seasonality.dayOfWeek.map(x=>x.orders))?'#818cf8':'#818cf850'}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {allOrders.length===0&&(
        <EmptyState text="Pull Shopify data to see cohort analysis, LTV distribution, and seasonality patterns"/>
      )}
    </div>
  );
}

/* ─── TABS CONFIG ────────────────────────────────────────────────────── */
const TABS = [
  { id:'command',   label:'Command',   icon:Zap },
  { id:'marketing', label:'Marketing', icon:Target },
  { id:'finance',   label:'Finance',   icon:Wallet },
  { id:'operations',label:'Operations',icon:Building2 },
  { id:'inventory', label:'Inventory', icon:Package },
  { id:'analytics', label:'Analytics', icon:Activity },
];

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
export default function BusinessPlan() {
  const { shopifyOrders, inventoryMap, enrichedRows, brands, activeBrandIds,
    setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders } = useStore();

  const primaryBrandId = activeBrandIds[0] || 'default';
  const prevBrandId    = useRef(primaryBrandId);

  const [tab,setTab]                   = useState('command');
  const [isPulling,setIsPulling]       = useState(false);
  const [pullLog,setPullLog]           = useState([]);
  const [pullProgress,setPullProgress] = useState(0);
  const [lastPullAt,setLastPullAt]     = useState(null);
  const [uploadedOrders,setUploadedOrders] = useState([]);

  const [plan,setPlan] = useState(() => hydrate(lsGet(primaryBrandId)));

  useEffect(() => {
    if (primaryBrandId !== prevBrandId.current) {
      prevBrandId.current = primaryBrandId;
      setPlan(hydrate(lsGet(primaryBrandId)));
      setUploadedOrders([]);
    }
  }, [primaryBrandId]);

  const savePlan = useCallback(updates => {
    setPlan(prev => {
      const next = {...prev, ...updates};
      lsSet(primaryBrandId, next);
      return next;
    });
  }, [primaryBrandId]);

  const handlePull = useCallback(async () => {
    const active = brands.filter(b => activeBrandIds.includes(b.id));
    if (!active.length) return;
    setIsPulling(true); setPullLog([]); setPullProgress(0);
    const totalSteps = active.reduce((s,b)=>s+(b.meta?.accounts?.filter(a=>a.id&&a.key).length||0)+2,0);
    let done = 0;
    const tick = () => { done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100)); };

    for (const brand of active) {
      const {token,apiVersion:ver,accounts=[]} = brand.meta||{};
      const valid = accounts.filter(a=>a.id&&a.key);
      if (!token||!valid.length) continue;
      setBrandMetaStatus(brand.id,'loading');
      const results=[];
      for (const acc of valid) {
        setPullLog(prev=>[...prev,{msg:`Meta ${acc.key}…`,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const r = await pullAccount({ver:ver||'v21.0',token,accountKey:acc.key,accountId:acc.id});
          results.push(r);
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`${acc.key}: ${r.ads?.length||0} ads`,count:r.ads?.length,status:'done',ts:new Date().toLocaleTimeString()}]);
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`${acc.key} failed: ${e.message}`,status:'error',ts:new Date().toLocaleTimeString()}]);
        }
        tick();
      }
      if (results.length) {
        setBrandMetaData(brand.id,{campaigns:results.flatMap(r=>r.campaigns),adsets:results.flatMap(r=>r.adsets),ads:results.flatMap(r=>r.ads),insightsToday:results.flatMap(r=>r.insightsToday),insights7d:results.flatMap(r=>r.insights7d),insights14d:results.flatMap(r=>r.insights14d),insights30d:results.flatMap(r=>r.insights30d)});
        setBrandMetaStatus(brand.id,'success');
      }
      const {shop,clientId,clientSecret} = brand.shopify||{};
      if (shop&&clientId&&clientSecret) {
        setPullLog(prev=>[...prev,{msg:`Shopify inventory: ${shop}…`,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const {map,locations,skuToItemId,collections} = await fetchShopifyInventory(shop,clientId,clientSecret);
          setBrandInventory(brand.id,map,locations,null,skuToItemId,collections);
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Inventory: ${Object.keys(map).length} SKUs`,count:Object.keys(map).length,status:'done',ts:new Date().toLocaleTimeString()}]);
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Inventory failed: ${e.message}`,status:'error',ts:new Date().toLocaleTimeString()}]);
        }
        tick();
        setPullLog(prev=>[...prev,{msg:`Orders 180d: ${shop}…`,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const now=new Date(),since=new Date(now-180*86400000).toISOString();
          const res = await fetchShopifyOrders(shop,clientId,clientSecret,since,now.toISOString());
          setBrandOrders(brand.id,res.orders,'180d');
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Orders: ${res.orders?.length||0} (180d)`,count:res.orders?.length,status:'done',ts:new Date().toLocaleTimeString()}]);
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Orders failed: ${e.message}`,status:'error',ts:new Date().toLocaleTimeString()}]);
        }
        tick();
      }
    }
    setPullProgress(100); setIsPulling(false); setLastPullAt(Date.now());
  }, [brands,activeBrandIds,setBrandMetaData,setBrandMetaStatus,setBrandInventory,setBrandOrders]);

  const handleUpload = useCallback(text => setUploadedOrders(prev=>[...prev,...parseOrdersCsv(text)]), []);

  /* Derived analytics */
  const allOrders    = useMemo(()=>[...(shopifyOrders||[]),...uploadedOrders],[shopifyOrders,uploadedOrders]);
  const months       = useMemo(()=>buildMonthlyPlan(plan),[plan.baseOrdersPerDay,plan.monthlyGrowthRate,plan.targetCpr,plan.aov]);
  const finPlan      = useMemo(()=>buildFinancePlan(plan,months),[plan,months]);
  const whPlan       = useMemo(()=>buildWarehouseNeeds(plan,months),[plan,months]);
  const opsPlan      = useMemo(()=>buildOpsNeeds(months),[months]);
  const procSchedule = useMemo(()=>buildProcurementSchedule(plan,months),[plan,months]);
  const planWithMonths=useMemo(()=>({...plan,months}),[plan,months]);
  const pva          = useMemo(()=>buildPlanVsActual(planWithMonths,allOrders),[planWithMonths,allOrders]);
  const predictions  = useMemo(()=>buildPredictions(planWithMonths,allOrders),[planWithMonths,allOrders]);
  const adv          = useMemo(()=>buildAdvancedPredictions(planWithMonths,allOrders),[planWithMonths,allOrders]);
  const seasonality  = useMemo(()=>buildSeasonality(allOrders),[allOrders]);
  const cohorts      = useMemo(()=>buildCohortMetrics(allOrders),[allOrders]);
  const creative     = useMemo(()=>buildCreativeStrategy(plan,enrichedRows),[plan,enrichedRows]);
  const inventoryNeeds=useMemo(()=>buildInventoryNeeds(inventoryMap,allOrders),[inventoryMap,allOrders]);
  const stage        = useMemo(()=>detectGrowthStage(predictions.avg7||0),[predictions.avg7]);
  const decisions    = useMemo(()=>buildDecisionSignals({plan,months,finPlan,whPlan,opsPlan,procSchedule,creative,predictions,inventoryNeeds}),[plan,months,finPlan,whPlan,opsPlan,procSchedule,creative,predictions,inventoryNeeds]);

  const brand = brands.find(b=>b.id===primaryBrandId);
  const stats = { ads:enrichedRows?.length||0, orders:allOrders.length, skus:Object.keys(inventoryMap||{}).length };

  /* Brand-aware tab labels */
  const brandName = plan.brandName || brand?.name || 'Brand';
  const tabsWithBrand = TABS.map(t =>
    t.id==='operations' ? {...t, label:`Operations`} : t
  );

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">{brandName} — Business Plan</h1>
            {stage&&<StageBadge stage={stage} size="sm"/>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {months[0]?.label} – {months[months.length-1]?.label} · {Math.round((plan.monthlyGrowthRate||0.2)*100)}% growth/mo
            {brands.length>1&&<> · <span className="text-brand-400">{brand?.name||'All brands'}</span></>}
          </p>
        </div>
        <button onClick={()=>{if(confirm('Reset plan to defaults?')){const d={...DEFAULT_PLAN,shiftRoles:{...DEFAULT_SHIFT_ROLES}};lsSet(primaryBrandId,d);setPlan(d);}}}
          className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Reset</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/50 rounded-xl p-1 border border-gray-800/50 overflow-x-auto scrollbar-none">
        {tabsWithBrand.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0',
              tab===t.id?'bg-brand-600/20 text-brand-300 shadow-inner':'text-slate-400 hover:text-slate-200 hover:bg-gray-800/40')}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab==='command'&&<TabCommand plan={plan} months={months} predictions={predictions} adv={adv} stage={stage} decisions={decisions} finPlan={finPlan} whPlan={whPlan} pva={pva} allOrders={allOrders}/>}
      {tab==='marketing'&&<TabMarketing plan={plan} months={months} creative={creative} savePlan={savePlan} enrichedRows={enrichedRows}/>}
      {tab==='finance'&&<TabFinance plan={plan} months={months} finPlan={finPlan} savePlan={savePlan}/>}
      {tab==='operations'&&<TabOperations plan={plan} months={months} opsPlan={opsPlan} whPlan={whPlan} savePlan={savePlan}/>}
      {tab==='inventory'&&<TabInventory plan={plan} inventoryNeeds={inventoryNeeds} savePlan={savePlan}/>}
      {tab==='analytics'&&<TabAnalytics predictions={predictions} adv={adv} seasonality={seasonality} cohorts={cohorts} allOrders={allOrders} isPulling={isPulling} pullLog={pullLog} pullProgress={pullProgress} onPull={handlePull} lastPullAt={lastPullAt} stats={stats} onUpload={handleUpload}/>}
    </div>
  );
}
