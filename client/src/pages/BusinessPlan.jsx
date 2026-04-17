import { useMemo, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import {
  Zap, TrendingUp, Package, Building2, Wallet,
  RefreshCw, Download, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, ArrowUp, ArrowDown, Minus,
  Flame, ShoppingCart, Users, Edit2, Check, X, Plus, Trash2, Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { pullAccount, fetchShopifyInventory, fetchShopifyOrders } from '../lib/api';
import {
  DEFAULT_PLAN, STAGES, detectGrowthStage,
  buildPlanVsActual, buildMarketingNeeds, buildInventoryNeeds,
  buildPredictions, buildCreativeStrategy, buildProcurementPlan,
  buildCollectionsFromMeta, filterOrdersByPeriod, parseOrdersCsv,
  downloadCsv, fmtRs, fmtK,
  buildMonthlyPlan, buildFinancePlan, buildWarehouseNeeds,
  buildOpsNeeds, buildProcurementSchedule, buildDecisionSignals,
} from '../lib/businessPlanAnalytics';

const LS_KEY = 'taos_bplan_v4';
const ls = {
  get: fb  => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : fb; } catch { return fb; } },
  set: v   => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch {} },
};

const fmtPct  = n => `${(parseFloat(n)||0).toFixed(1)}%`;
const fmtDays = n => { const v=parseFloat(n)||0; return v>=999?'—':`${Math.round(v)}d`; };

const PRIORITY_STYLE = {
  URGENT: { pill:'bg-red-900/40 text-red-300 border-red-700/50',   dot:'bg-red-400' },
  HIGH:   { pill:'bg-amber-500/20 text-amber-300 border-amber-700/40', dot:'bg-amber-400' },
  MEDIUM: { pill:'bg-brand-500/15 text-brand-300 border-brand-700/30', dot:'bg-brand-400' },
  LOW:    { pill:'bg-gray-800 text-slate-400 border-gray-700/40',   dot:'bg-gray-500' },
};

/* ─── SHARED ─────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, delta, inverse, cls='', accent, warn }) {
  const n = parseFloat(delta);
  const good = inverse ? n < 0 : n > 0;
  const dCls = !delta && delta!==0 ? '' : n===0 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400';
  const DI   = n===0 ? Minus : n>0 ? ArrowUp : ArrowDown;
  return (
    <div className={clsx('bg-gray-900/60 rounded-xl border px-4 py-3',
      warn ? 'border-red-800/40' : accent ? 'border-brand-700/40' : 'border-gray-800/50')}>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className={clsx('text-xl font-bold', cls||'text-white')}>{value}</div>
      {(sub||delta!=null) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
          {delta!=null && <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${dCls}`}><DI size={10}/>{Math.abs(n).toFixed(1)}%</span>}
        </div>
      )}
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[130px]">
      <div className="text-slate-400 mb-1.5 font-medium">{label}</div>
      {payload.map(p=>(
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{color:p.color}}>{p.name}</span>
          <span className="text-white font-semibold">{p.value>5000?fmtRs(p.value):fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StageBadge({ stage, size='md' }) {
  if (!stage) return null;
  const sm = size==='sm';
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full font-bold border',
      sm?'px-2 py-0.5 text-[10px]':'px-3 py-1 text-xs')}
      style={{background:stage.color+'20',borderColor:stage.color+'50',color:stage.color}}>
      {stage.badge} {stage.name}
    </span>
  );
}

function Section({ title, icon: Icon, children, defaultOpen=true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800/50">
      <button onClick={()=>setOpen(v=>!v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-slate-400"/>}
          <span className="text-sm font-bold text-slate-200">{title}</span>
        </div>
        {open ? <ChevronDown size={14} className="text-slate-500"/> : <ChevronRight size={14} className="text-slate-500"/>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ─── LIVE PULL PANEL ─────────────────────────────────────────────────── */
function PullPanel({ isPulling, pullLog, pullProgress, onPull, lastPullAt, dataStats, onUpload }) {
  const fileRef = useRef();
  const ready   = dataStats.orders > 0 || dataStats.ads > 0;
  return (
    <div className={clsx('rounded-xl border p-4 mb-5',
      isPulling ? 'border-brand-700/50 bg-brand-900/10' : ready ? 'border-gray-800/50 bg-gray-900/40' : 'border-amber-800/40 bg-amber-900/5')}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Live Data</span>
          {ready && !isPulling && (
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              {dataStats.ads > 0 && <span className="text-emerald-400">{dataStats.ads} ads</span>}
              {dataStats.orders > 0 && <span className="text-emerald-400">{dataStats.orders.toLocaleString()} orders</span>}
              {dataStats.skus > 0 && <span className="text-emerald-400">{dataStats.skus} SKUs</span>}
              {lastPullAt && <span>· {new Date(lastPullAt).toLocaleTimeString()}</span>}
            </div>
          )}
          {!ready && !isPulling && (
            <span className="text-[10px] text-amber-400">No data — pull to enable all analytics</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>fileRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 border border-gray-700 text-slate-300 rounded-lg text-[10px] hover:bg-gray-700">
            <Upload size={10}/>Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e=>{
            const f=e.target.files?.[0]; if(!f) return;
            const r=new FileReader(); r.onload=ev=>onUpload(ev.target.result); r.readAsText(f);
            e.target.value='';
          }}/>
          <button onClick={onPull} disabled={isPulling}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
              isPulling ? 'bg-brand-800/40 text-brand-400 cursor-not-allowed'
                        : 'bg-brand-600 text-white hover:bg-brand-500')}>
            <RefreshCw size={12} className={isPulling?'animate-spin':''}/>
            {isPulling ? 'Pulling…' : 'Pull Live Data'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isPulling && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
            <span>Fetching data…</span><span>{pullProgress}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{width:`${pullProgress}%`}}/>
          </div>
        </div>
      )}

      {/* Live log */}
      {pullLog.length > 0 && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {pullLog.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                entry.status==='done'  ? 'bg-emerald-400'
                : entry.status==='error' ? 'bg-red-400'
                : 'bg-amber-400 animate-pulse')}/>
              <span className={entry.status==='error'?'text-red-400':entry.status==='done'?'text-slate-300':'text-slate-400'}>
                {entry.msg}
              </span>
              {entry.count != null && entry.count > 0 &&
                <span className="text-slate-600">· {entry.count.toLocaleString()}</span>}
              <span className="text-slate-700 ml-auto">{entry.ts}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── TAB: COMMAND ───────────────────────────────────────────────────── */
function TabCommand({ plan, months, predictions, stage, decisions, finPlan, whPlan, pva, allOrders }) {
  const now        = new Date();
  const currKey    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const currPva    = pva.find(m=>m.key===currKey);
  const currFin    = finPlan.find(m=>m.key===currKey);
  const firstOver  = whPlan.find(m=>m.overfill);
  const nextStage  = STAGES[STAGES.findIndex(s=>s.id===stage?.id)+1];

  /* Stage readiness — count signals met */
  const req = stage?.requirements||{};
  const metCount = [
    predictions.avg7 >= req.ordersPerDay,
    predictions.avg7 > 0,
  ].filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Stage strip */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4 flex flex-wrap items-center gap-4">
        <StageBadge stage={stage}/>
        <div className="text-xs text-slate-400 flex-1">{stage?.description}</div>
        {nextStage && (
          <div className="text-[10px] text-slate-500 border border-gray-700/50 rounded-lg px-3 py-1.5">
            Next: <span style={{color:nextStage.color}} className="font-bold">{nextStage.badge} {nextStage.name}</span>
            <span className="ml-2">@ {nextStage.min} orders/day</span>
          </div>
        )}
      </div>

      {/* Decision signals */}
      {decisions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">
            Decisions Required ({decisions.length})
          </div>
          {decisions.map(d => (
            <div key={d.id} className={clsx('rounded-xl border p-3.5', PRIORITY_STYLE[d.priority]?.pill)}>
              <div className="flex items-start gap-3">
                <span className="text-base leading-none mt-0.5">{d.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold">{d.title}</span>
                    <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-bold border',
                      PRIORITY_STYLE[d.priority]?.pill)}>
                      {d.priority}
                    </span>
                  </div>
                  <div className="text-[10px] opacity-80 mb-1.5">{d.detail}</div>
                  <div className="text-[10px] font-semibold opacity-90">→ {d.action}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Orders/Day (7d avg)" value={predictions.avg7||'—'} sub={`Target: ${months[0]?.ordersPerDay}/day`}
          delta={months[0]?.ordersPerDay > 0 ? ((predictions.avg7-months[0].ordersPerDay)/months[0].ordersPerDay*100) : null}/>
        <KpiCard label="Revenue MTD" value={currPva ? fmtRs(currPva.actualRevenue) : '—'}
          sub={currPva ? `Plan: ${fmtRs(currPva.planRevenue)}` : 'No orders data'}/>
        <KpiCard label="Blended ROAS (plan)" value={`${(plan.collections||[]).reduce((s,c)=>s+c.alloc*c.roas,0).toFixed(2)}x`}
          sub={`Target: ${plan.targetRoas}x`}
          cls={(plan.collections||[]).reduce((s,c)=>s+c.alloc*c.roas,0) >= (plan.targetRoas||4.5) ? 'text-emerald-400':'text-amber-400'}/>
        <KpiCard label="Blended CPR (plan)" value={`₹${(plan.collections||[]).reduce((s,c)=>s+c.alloc*c.cpr,0).toFixed(0)}`}
          sub={`Target: ₹${plan.targetCpr}`} inverse/>
        <KpiCard label="Working Capital Needed" value={currFin ? fmtRs(currFin.capitalNeeded) : '—'}
          sub="Import advance + ad upfront" warn={!!currFin && currFin.capitalNeeded > currFin.grossProfit}/>
        <KpiCard label="WH Utilization (now)" value={whPlan[0] ? `${whPlan[0].utilization.toFixed(0)}%` : '—'}
          sub={firstOver ? `Overflow: ${firstOver.label}` : 'Within capacity'}
          warn={!!firstOver} cls={firstOver?'text-amber-400':'text-emerald-400'}/>
        <KpiCard label="Net Margin (this month)" value={currFin ? fmtPct(currFin.netMarginPct) : '—'}
          sub="After ads + ops" cls={currFin&&currFin.netMarginPct>0?'text-emerald-400':'text-red-400'}/>
        <KpiCard label="Orders Trend" value={predictions.trendLabel||'—'}
          sub={`7d avg: ${predictions.avg7} · 14d: ${predictions.avg14}`}
          cls={predictions.trend>0?'text-emerald-400':predictions.trend<0?'text-red-400':'text-slate-300'}/>
      </div>

      {/* Stage priorities */}
      <Section title={`${stage?.name} Stage — Top Priorities`} icon={CheckCircle}>
        <div className="space-y-2">
          {(stage?.priorities||[]).map((p,i)=>(
            <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
              <span className="w-4 h-4 rounded-full bg-brand-600/30 text-brand-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
              {p}
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-800/40">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Milestones to Unlock Next Stage</div>
          <div className="space-y-1">
            {(stage?.milestones||[]).map((m,i)=>(
              <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0"/>
                {m}
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ─── TAB: PLAN ──────────────────────────────────────────────────────── */
function TabPlan({ plan, months, finPlan, whPlan, opsPlan, savePlan }) {
  const [editCore, setEditCore]   = useState(false);
  const [coreDraft, setCoreDraft] = useState({
    baseOrdersPerDay: plan.baseOrdersPerDay,
    monthlyGrowthRate: Math.round((plan.monthlyGrowthRate||0.2)*100),
    targetCpr: plan.targetCpr, targetRoas: plan.targetRoas, aov: plan.aov,
  });
  const [editCols, setEditCols]   = useState(false);
  const [colsDraft, setColsDraft] = useState((plan.collections||[]).map(c=>({...c})));
  const [editWH, setEditWH]       = useState(false);
  const [whDraft, setWhDraft]     = useState((plan.warehouses||[]).map(w=>({...w})));
  const [editDims, setEditDims]   = useState(false);
  const [dimsDraft, setDimsDraft] = useState((plan.skuDimensions||[]).map(d=>({...d})));
  const [editSupp, setEditSupp]   = useState(false);
  const [suppDraft, setSuppDraft] = useState((plan.suppliers||[]).map(s=>({...s})));

  const saveCore = () => {
    savePlan({ baseOrdersPerDay: +coreDraft.baseOrdersPerDay, monthlyGrowthRate: coreDraft.monthlyGrowthRate/100,
      targetCpr: +coreDraft.targetCpr, targetRoas: +coreDraft.targetRoas, aov: +coreDraft.aov });
    setEditCore(false);
  };

  /* chart data */
  const chartData = finPlan.map(m=>({
    label: m.label.slice(0,3),
    Revenue: Math.round(m.revenue),
    'Ad Spend': Math.round(m.adSpend),
    'Net Profit': Math.round(m.netProfit),
  }));

  const stageColor = m => {
    const s = STAGES.find(s=>m.ordersPerDay>=s.min&&m.ordersPerDay<s.max)||STAGES[0];
    return s.color+'30';
  };

  return (
    <div className="space-y-5">
      {/* Core inputs */}
      <Section title="Growth Inputs (drives entire plan)" icon={Zap} defaultOpen>
        {editCore ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-1">
            {[
              ['baseOrdersPerDay','Base Orders/Day',''],
              ['monthlyGrowthRate','Monthly Growth','%'],
              ['targetCpr','Target CPR','₹'],
              ['targetRoas','Target ROAS','x'],
              ['aov','AOV','₹'],
            ].map(([f,l,u])=>(
              <div key={f}>
                <div className="text-[9px] text-slate-500 mb-1">{l}</div>
                <div className="flex items-center gap-1">
                  {u&&<span className="text-[10px] text-slate-500">{u}</span>}
                  <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs"
                    value={coreDraft[f]} onChange={e=>setCoreDraft(p=>({...p,[f]:e.target.value}))}/>
                </div>
              </div>
            ))}
            <div className="col-span-2 md:col-span-5 flex gap-2 pt-1">
              <button onClick={saveCore} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs font-semibold">Recalculate Plan</button>
              <button onClick={()=>setEditCore(false)} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 mt-1">
            {[
              ['Base Orders',`${plan.baseOrdersPerDay}/day`],
              ['Growth Rate',`${Math.round((plan.monthlyGrowthRate||0.2)*100)}%/mo`],
              ['Target CPR',`₹${plan.targetCpr}`],
              ['Target ROAS',`${plan.targetRoas}x`],
              ['AOV',`₹${plan.aov}`],
            ].map(([l,v])=>(
              <div key={l} className="bg-gray-800/50 rounded-lg px-3 py-2">
                <div className="text-[9px] text-slate-500">{l}</div>
                <div className="text-sm font-bold text-white">{v}</div>
              </div>
            ))}
            <button onClick={()=>setEditCore(true)} className="self-center flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300">
              <Edit2 size={11}/>Edit
            </button>
          </div>
        )}
      </Section>

      {/* Revenue chart */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-4">
        <div className="text-xs font-bold text-slate-300 mb-3">12-Month P&L Forecast</div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{top:0,right:0,bottom:0,left:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.5}/>
            <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtRs} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} width={55}/>
            <Tooltip content={<Tip/>}/>
            <Area type="monotone" dataKey="Revenue"    stroke="#818cf8" fill="#818cf8" fillOpacity={0.12} strokeWidth={1.5}/>
            <Area type="monotone" dataKey="Ad Spend"   stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={1.5}/>
            <Area type="monotone" dataKey="Net Profit" stroke="#22c55e" fill="#22c55e" fillOpacity={0.12} strokeWidth={1.5}/>
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-1 justify-center">
          {[['Revenue','#818cf8'],['Ad Spend','#f59e0b'],['Net Profit','#22c55e']].map(([l,c])=>(
            <div key={l} className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className="w-2 h-2 rounded-full" style={{background:c}}/>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* 12-month table */}
      <div className="bg-gray-900/60 rounded-xl border border-gray-800/50 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-800/40">
          <div className="text-xs font-bold text-slate-300">12-Month Breakdown</div>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-800/40">
            {['Month','Stage','Orders/Day','Revenue','Ad Spend','Gross Profit','Net Profit','Capital Needed','Staff','WH%'].map(h=>(
              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {months.map((m,i)=>{
              const f   = finPlan[i]||{};
              const wh  = whPlan[i]||{};
              const ops = opsPlan[i]||{};
              const stage = STAGES.find(s=>m.ordersPerDay>=s.min&&m.ordersPerDay<s.max)||STAGES[0];
              return (
                <tr key={m.key} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                  <td className="px-3 py-2.5 font-medium text-white whitespace-nowrap">{m.label}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{background:stage.color+'25',color:stage.color}}>{stage.badge}{stage.name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-white font-semibold">{m.ordersPerDay}</td>
                  <td className="px-3 py-2.5 text-white">{fmtRs(f.revenue)}</td>
                  <td className="px-3 py-2.5 text-amber-400">{fmtRs(f.adSpend)}</td>
                  <td className="px-3 py-2.5 text-emerald-400">{fmtRs(f.grossProfit)}</td>
                  <td className={clsx('px-3 py-2.5 font-semibold', f.netProfit>0?'text-emerald-400':'text-red-400')}>{fmtRs(f.netProfit)}</td>
                  <td className={clsx('px-3 py-2.5', f.capitalNeeded>f.grossProfit?'text-amber-400':'text-slate-300')}>{fmtRs(f.capitalNeeded)}</td>
                  <td className="px-3 py-2.5 text-slate-300">{ops.totalHeadcount} · {ops.shifts}sh</td>
                  <td className={clsx('px-3 py-2.5 font-semibold', wh.danger?'text-red-400':wh.overfill?'text-amber-400':'text-emerald-400')}>
                    {wh.utilization?.toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Collections editor */}
      <Section title="Collection Targets" icon={Flame} defaultOpen={false}>
        {editCols ? (
          <div className="space-y-2 mt-2">
            {colsDraft.map((c,i)=>(
              <div key={c.key} className="grid grid-cols-6 gap-2 items-center">
                <span className="text-xs text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{background:c.color}}/>
                  {c.label}
                </span>
                {[['alloc','Alloc','%'],['roas','ROAS','x'],['cpr','CPR','₹']].map(([f,l,u])=>(
                  <div key={f}>
                    <div className="text-[9px] text-slate-600 mb-0.5">{l} ({u})</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center"
                      value={f==='alloc'?Math.round(c[f]*100):c[f]}
                      onChange={e=>setColsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:f==='alloc'?parseFloat(e.target.value)/100:e.target.value}:x))}/>
                  </div>
                ))}
                <div className="text-[10px] text-slate-500">{(c.alloc*100).toFixed(0)}%</div>
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({collections:colsDraft.map(c=>({...c,alloc:parseFloat(c.alloc),roas:parseFloat(c.roas),cpr:parseFloat(c.cpr)}))});setEditCols(false);}}
                className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
              <button onClick={()=>setEditCols(false)} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <div className="grid grid-cols-4 gap-2 mb-2">
              {(plan.collections||[]).map(c=>(
                <div key={c.key} className="bg-gray-800/50 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{background:c.color}}/>
                    <span className="text-[10px] font-semibold text-white truncate">{c.label}</span>
                  </div>
                  <div className="text-lg font-bold text-white">{Math.round(c.alloc*100)}%</div>
                  <div className="text-[10px] text-slate-500">ROAS {parseFloat(c.roas).toFixed(2)}x · CPR ₹{c.cpr}</div>
                </div>
              ))}
            </div>
            <button onClick={()=>setEditCols(true)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit Targets</button>
          </div>
        )}
      </Section>

      {/* SKU dimensions for warehouse calc */}
      <Section title="SKU Dimensions (Warehouse Space Calc)" icon={Package} defaultOpen={false}>
        <div className="text-[10px] text-slate-500 mb-3">Box dimensions per category drive the warehouse capacity forecast in the table above.</div>
        {editDims ? (
          <div className="space-y-2">
            {dimsDraft.map((d,i)=>(
              <div key={d.key} className="grid grid-cols-6 gap-2 items-center">
                <span className="text-xs text-slate-300">{d.label}</span>
                {[['lengthCm','L (cm)'],['widthCm','W (cm)'],['heightCm','H (cm)'],['unitsPerOrder','Units/Order'],['bufferDays','Buffer Days']].map(([f,l])=>(
                  <div key={f}>
                    <div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center"
                      value={d[f]} onChange={e=>setDimsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:parseFloat(e.target.value)||0}:x))}/>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({skuDimensions:dimsDraft});setEditDims(false);}}
                className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
              <button onClick={()=>setEditDims(false)} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <table className="w-full text-xs mb-2">
              <thead><tr className="border-b border-gray-800/40">
                {['Category','L×W×H (cm)','Units/Order','Buffer Days','Vol/Unit (m³)'].map(h=>(
                  <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(plan.skuDimensions||[]).map(d=>(
                  <tr key={d.key} className="border-b border-gray-800/30">
                    <td className="px-2 py-2 text-white font-medium">{d.label}</td>
                    <td className="px-2 py-2 text-slate-300">{d.lengthCm}×{d.widthCm}×{d.heightCm}</td>
                    <td className="px-2 py-2 text-slate-300">{d.unitsPerOrder}</td>
                    <td className="px-2 py-2 text-slate-300">{d.bufferDays}d</td>
                    <td className="px-2 py-2 text-slate-400">{((d.lengthCm*d.widthCm*d.heightCm)/1_000_000).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={()=>setEditDims(true)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit Dimensions</button>
          </div>
        )}
      </Section>

      {/* Warehouse editor */}
      <Section title="Warehouses" icon={Building2} defaultOpen={false}>
        {editWH ? (
          <div className="space-y-2 mt-1">
            {whDraft.map((w,i)=>(
              <div key={w.id} className="grid grid-cols-6 gap-2 items-center">
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" value={w.name} onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                {[['sqMeters','sqm'],['heightMeters','height(m)'],['utilizationPct','util%']].map(([f,l])=>(
                  <div key={f}>
                    <div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center"
                      value={f==='utilizationPct'?Math.round(w[f]*100):w[f]}
                      onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,[f]:f==='utilizationPct'?parseFloat(e.target.value)/100:parseFloat(e.target.value)||0}:x))}/>
                  </div>
                ))}
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={w.active} onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,active:e.target.checked}:x))} className="accent-brand-500"/>Active
                </label>
                <div className="text-[10px] text-slate-500">{((w.sqMeters||0)*(w.heightMeters||3.5)*(w.utilizationPct||0.7)).toFixed(0)}m³</div>
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({warehouses:whDraft});setEditWH(false);}} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
              <button onClick={()=>setEditWH(false)} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex gap-3 mt-1 flex-wrap">
              {(plan.warehouses||[]).map(w=>(
                <div key={w.id} className={clsx('flex-1 min-w-[140px] rounded-lg p-3 border', w.active?'bg-gray-800/50 border-gray-700/50':'bg-gray-900/40 border-gray-800/30 opacity-60')}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{w.name}</span>
                    <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-bold', w.active?'bg-emerald-500/20 text-emerald-400':'bg-gray-700 text-slate-500')}>{w.active?'ACTIVE':'INACTIVE'}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">{w.location} · {w.sqMeters}sqm · {w.heightMeters}m</div>
                  <div className="text-[10px] text-brand-400 font-semibold mt-1">{((w.sqMeters||0)*(w.heightMeters||3.5)*(w.utilizationPct||0.7)).toFixed(0)}m³ usable</div>
                  {w.notes && <div className="text-[9px] text-slate-600 mt-1">{w.notes}</div>}
                </div>
              ))}
            </div>
            <button onClick={()=>setEditWH(true)} className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit Warehouses</button>
          </div>
        )}
      </Section>

      {/* Supplier editor */}
      <Section title="Suppliers" icon={ShoppingCart} defaultOpen={false}>
        {editSupp ? (
          <div className="space-y-2 mt-1">
            {suppDraft.map((s,i)=>(
              <div key={s.id} className="grid grid-cols-5 gap-2 items-center">
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" placeholder="Name" value={s.name} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" placeholder="Category" value={s.category} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,category:e.target.value}:x))}/>
                <div>
                  <div className="text-[9px] text-slate-600 mb-0.5">Lead Days</div>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center" value={s.leadTimeDays} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,leadTimeDays:parseInt(e.target.value)||0}:x))}/>
                </div>
                <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs" placeholder="Terms" value={s.paymentTerms} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,paymentTerms:e.target.value}:x))}/>
                <button onClick={()=>setSuppDraft(p=>p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300"><Trash2 size={13}/></button>
              </div>
            ))}
            <button onClick={()=>setSuppDraft(p=>[...p,{id:`sup${Date.now()}`,name:'',category:'',leadTimeDays:30,paymentTerms:'Advance',moqUnits:100,notes:''}])}
              className="text-[10px] text-brand-400 flex items-center gap-1"><Plus size={10}/>Add Supplier</button>
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({suppliers:suppDraft});setEditSupp(false);}} className="px-3 py-1.5 bg-brand-600 text-white rounded text-xs">Save</button>
              <button onClick={()=>setEditSupp(false)} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <table className="w-full text-xs mt-1 mb-2">
              <thead><tr className="border-b border-gray-800/40">
                {['Supplier','Category','Lead Time','Terms','MOQ'].map(h=>(
                  <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(plan.suppliers||[]).map(s=>(
                  <tr key={s.id} className="border-b border-gray-800/30">
                    <td className="px-2 py-2 text-white font-medium">{s.name}</td>
                    <td className="px-2 py-2 text-slate-400">{s.category}</td>
                    <td className="px-2 py-2 text-amber-400 font-semibold">{s.leadTimeDays}d</td>
                    <td className="px-2 py-2 text-slate-400">{s.paymentTerms}</td>
                    <td className="px-2 py-2 text-slate-400">{s.moqUnits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={()=>setEditSupp(true)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit Suppliers</button>
          </div>
        )}
      </Section>

      {/* Export */}
      <div className="flex gap-2">
        <button onClick={()=>downloadCsv('business_plan.csv', finPlan.map(m=>({
          Month:m.label, Orders_Per_Day:m.ordersPerDay, Revenue:Math.round(m.revenue),
          Ad_Spend:Math.round(m.adSpend), Gross_Profit:Math.round(m.grossProfit),
          Net_Profit:Math.round(m.netProfit), Capital_Needed:m.capitalNeeded,
        })),['Month','Orders_Per_Day','Revenue','Ad_Spend','Gross_Profit','Net_Profit','Capital_Needed'])}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-slate-300 rounded-lg text-xs hover:bg-gray-700">
          <Download size={13}/>Export Plan CSV
        </button>
      </div>
    </div>
  );
}

/* ─── TAB: EXECUTE ───────────────────────────────────────────────────── */
function TabExecute({ plan, months, finPlan, whPlan, opsPlan, procSchedule, creative, metaCollections, allOrders, inventoryNeeds, savePlan }) {
  const [mktView, setMktView] = useState('publish');

  const urgentPOs  = procSchedule.filter(p=>p.urgency==='OVERDUE'||p.urgency==='DUE_SOON');
  const upcoming60 = procSchedule.filter(p=>p.urgency==='UPCOMING').slice(0,8);
  const firstOver  = whPlan.find(m=>m.overfill);

  return (
    <div className="space-y-5">

      {/* ── MARKETING ── */}
      <Section title="Marketing & Content" icon={Flame}>
        <div className="flex gap-1 mb-4 mt-1 bg-gray-900/40 rounded-lg p-1 border border-gray-800/40 w-fit">
          {[['publish','What to Publish'],['top','Top Performers'],['monthly','Monthly Budget']].map(([v,l])=>(
            <button key={v} onClick={()=>setMktView(v)}
              className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-all', mktView===v?'bg-brand-600/20 text-brand-300':'text-slate-400 hover:text-slate-200')}>
              {l}
            </button>
          ))}
        </div>

        {mktView==='publish' && (
          <div className="space-y-3">
            {creative.whatToPublish.length===0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">Pull Meta data to see collection-level recommendations.</div>
            ) : creative.whatToPublish.map(w=>(
              <div key={w.key} className="bg-gray-900/60 rounded-xl border border-gray-800/50 p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{background:(plan.collections||[]).find(c=>c.key===w.key)?.color||'#818cf8'}}/>
                    <span className="text-sm font-bold text-white">{w.collection}</span>
                    <span className="text-[10px] text-slate-500">{w.budgetShare}% of budget</span>
                  </div>
                  <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-bold border', PRIORITY_STYLE[w.urgency]?.pill)}>
                    {w.urgency}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                  <div><span className="text-slate-500">Live ROAS: </span><span className={clsx('font-bold',w.currentRoas>=w.targetRoas?'text-emerald-400':'text-amber-400')}>{w.currentRoas.toFixed(2)}x</span></div>
                  <div><span className="text-slate-500">Target: </span><span className="text-white font-bold">{w.targetRoas.toFixed(2)}x</span></div>
                  <div><span className="text-slate-500">Active Ads: </span><span className="text-white">{w.activeAds}</span></div>
                </div>
                <div className="bg-brand-600/10 border border-brand-500/20 rounded-lg p-2.5 text-xs text-brand-300">
                  <span className="font-bold">Action: </span>{w.recommendation}
                </div>
              </div>
            ))}
            {creative.fatigueAlerts.length>0 && (
              <div className="mt-2 space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fatigue Alerts</div>
                {creative.fatigueAlerts.map((a,i)=>(
                  <div key={i} className="flex items-center gap-3 bg-red-900/20 border border-red-800/30 rounded-lg p-2.5 text-xs">
                    <AlertTriangle size={13} className="text-red-400 shrink-0"/>
                    <div><span className="text-white font-medium">{a.name}</span><span className="text-slate-500 ml-2">{a.collection}</span></div>
                    <span className="ml-auto text-red-400 font-bold">{a.roas7d?.toFixed(1)}x ROAS</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mktView==='top' && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {creative.collections.slice(0,4).map(c=>(
                <div key={c.name} className="bg-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white truncate">{c.name}</span>
                    <span className={clsx('text-[9px] px-1 py-0.5 rounded font-bold',
                      c.status==='excellent'?'bg-emerald-500/20 text-emerald-400':c.status==='good'?'bg-brand-500/20 text-brand-400':'bg-amber-500/20 text-amber-400')}>
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white">{c.avgRoas}x</div>
                  <div className="text-[10px] text-slate-500">ROAS · CPR ₹{c.avgCpr} · {c.adCount} ads</div>
                </div>
              ))}
            </div>
            {creative.topCreatives.length>0 && (
              <div className="overflow-x-auto rounded-xl border border-gray-800/50">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800/50">
                    {['Creative','Collection','7d ROAS','CPR','Spend'].map(h=>(
                      <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>
                    ))}</tr></thead>
                  <tbody>
                    {creative.topCreatives.slice(0,8).map((c,i)=>(
                      <tr key={i} className="border-b border-gray-800/30">
                        <td className="px-3 py-2 text-white max-w-[200px] truncate">{c.name}</td>
                        <td className="px-3 py-2 text-slate-400">{c.collection}</td>
                        <td className="px-3 py-2 text-emerald-400 font-bold">{c.roas7d?.toFixed(2)}x</td>
                        <td className="px-3 py-2 text-slate-300">₹{c.cpr7d?.toFixed(0)}</td>
                        <td className="px-3 py-2 text-slate-300">{fmtRs(c.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {mktView==='monthly' && (
          <div className="overflow-x-auto rounded-xl border border-gray-800/50 mt-1">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50">
                {['Month','Budget/Day','Total Budget','Campaigns','Creatives','Expected Orders'].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}</tr></thead>
              <tbody>
                {months.map(m=>{
                  const mk = buildMarketingNeeds(m, plan);
                  return (
                    <tr key={m.key} className="border-b border-gray-800/30">
                      <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                      <td className="px-3 py-2.5 text-amber-400 font-semibold">{fmtRs(m.adBudgetPerDay)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{mk.campaigns}</td>
                      <td className="px-3 py-2.5 text-slate-300">{mk.creatives}</td>
                      <td className="px-3 py-2.5 text-white">{mk.expectedResults.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── PROCUREMENT ── */}
      <Section title="Procurement & Import Pipeline" icon={ShoppingCart}>
        {urgentPOs.length>0 && (
          <div className="mb-4 space-y-2">
            <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Immediate Action Required</div>
            {urgentPOs.map((po,i)=>(
              <div key={i} className={clsx('rounded-xl border p-3.5 flex items-center gap-4',
                po.urgency==='OVERDUE'?'bg-red-900/20 border-red-800/40':'bg-amber-900/15 border-amber-800/30')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded border',
                      po.urgency==='OVERDUE'?'bg-red-500/20 text-red-400 border-red-700/40':'bg-amber-500/20 text-amber-400 border-amber-700/40')}>
                      {po.urgency==='OVERDUE'?'OVERDUE':`DUE ${po.daysUntil}d`}
                    </span>
                    <span className="text-xs font-bold text-white">{po.supplier}</span>
                    <span className="text-[10px] text-slate-500">for {po.monthLabel}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {po.orderQty.toLocaleString()} units · {fmtRs(po.poValue)} · {po.leadTimeDays}d lead time
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-500">PO by</div>
                  <div className="text-sm font-bold text-white">{po.poDate}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Next 60 Days</div>
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/50">
              {['PO Date','Supplier','For Month','Qty','PO Value','Lead Time','Delivery'].map(h=>(
                <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}</tr></thead>
            <tbody>
              {procSchedule.slice(0,12).map((po,i)=>(
                <tr key={i} className="border-b border-gray-800/30">
                  <td className={clsx('px-3 py-2.5 font-semibold whitespace-nowrap',
                    po.urgency==='OVERDUE'?'text-red-400':po.urgency==='DUE_SOON'?'text-amber-400':'text-slate-300')}>
                    {po.poDate}
                  </td>
                  <td className="px-3 py-2.5 text-white font-medium">{po.supplier}</td>
                  <td className="px-3 py-2.5 text-slate-400">{po.monthLabel}</td>
                  <td className="px-3 py-2.5 text-slate-300">{po.orderQty.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-emerald-400 font-semibold">{fmtRs(po.poValue)}</td>
                  <td className="px-3 py-2.5 text-amber-400">{po.leadTimeDays}d</td>
                  <td className="px-3 py-2.5 text-slate-400">{po.deliveryDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── OPS ── */}
      <Section title="Operations — Warehouse & Staffing" icon={Building2}>

        {/* Warehouse by month */}
        <div className="mb-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Warehouse Utilization by Month</div>
          {firstOver && (
            <div className={clsx('rounded-lg border p-3 mb-3 text-xs flex items-center gap-3',
              firstOver.danger?'bg-red-900/20 border-red-800/40 text-red-300':'bg-amber-900/15 border-amber-800/30 text-amber-300')}>
              <Building2 size={14} className="shrink-0"/>
              <div>
                <span className="font-bold">{firstOver.danger?'Warehouse full':'Overflow imminent'}: </span>
                {firstOver.label} — {firstOver.utilization.toFixed(0)}% ({firstOver.totalVolumeM3}m³ needed, {firstOver.totalCapM3}m³ available)
                <div className="mt-0.5 opacity-75">Activate next warehouse or reduce buffer days before this month.</div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {whPlan.map((m,i)=>(
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-16 text-[10px] text-slate-500 shrink-0">{m.label.slice(0,3)}</div>
                <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden relative">
                  <div className={clsx('h-full rounded transition-all',
                    m.danger?'bg-red-500':m.overfill?'bg-amber-500':'bg-brand-500')}
                    style={{width:`${Math.min(m.utilization,100)}%`}}/>
                  {m.utilization>100 && (
                    <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center text-[9px] text-red-300 font-bold">OVERFLOW</div>
                  )}
                </div>
                <div className={clsx('w-12 text-[10px] font-bold text-right shrink-0',
                  m.danger?'text-red-400':m.overfill?'text-amber-400':'text-emerald-400')}>
                  {m.utilization.toFixed(0)}%
                </div>
                <div className="w-20 text-[10px] text-slate-600 shrink-0">{m.totalVolumeM3}m³/{m.totalCapM3}m³</div>
              </div>
            ))}
          </div>
        </div>

        {/* Staffing table */}
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Headcount & Shifts Required</div>
          <div className="overflow-x-auto rounded-xl border border-gray-800/50">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50">
                {['Month','Orders/Day','Packers','QC','Shifts','Ops','CS','Logistics','Total','Packing Cap'].map(h=>(
                  <th key={h} className="px-2.5 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}</tr></thead>
              <tbody>
                {opsPlan.map((m,i)=>{
                  const prev = opsPlan[i-1];
                  const staffDelta = prev ? m.totalHeadcount - prev.totalHeadcount : 0;
                  const shiftChange = prev && m.shifts !== prev.shifts;
                  return (
                    <tr key={m.key} className={clsx('border-b border-gray-800/30', shiftChange?'bg-amber-900/10':'')}>
                      <td className="px-2.5 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.ordersPerDay}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.packers}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.qc}</td>
                      <td className={clsx('px-2.5 py-2.5 font-bold', shiftChange?'text-amber-400':'text-white')}>{m.shifts}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.ops}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.cs}</td>
                      <td className="px-2.5 py-2.5 text-slate-300">{m.logistics}</td>
                      <td className="px-2.5 py-2.5 text-white font-semibold">
                        {m.totalHeadcount}
                        {staffDelta>0&&<span className="text-emerald-400 text-[9px] ml-1">+{staffDelta}</span>}
                      </td>
                      <td className={clsx('px-2.5 py-2.5 text-[10px]',
                        m.capacityBuffer<5?'text-amber-400':'text-slate-400')}>
                        {m.packingCapacity}/day ({m.capacityBuffer>0?'+':''}{ m.capacityBuffer}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* SKU-level inventory (from Shopify) */}
        {inventoryNeeds.length>0 && (
          <div className="mt-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Live SKU Inventory Health</div>
            <div className="overflow-x-auto rounded-xl border border-gray-800/50">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/50">
                  {['SKU','Stock','Velocity/Day','Days Left','Reorder Qty'].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}</tr></thead>
                <tbody>
                  {inventoryNeeds.slice(0,15).map(item=>(
                    <tr key={item.sku} className="border-b border-gray-800/30">
                      <td className="px-3 py-2 text-white font-medium max-w-[200px] truncate">{item.name}</td>
                      <td className="px-3 py-2 text-slate-300">{item.current.toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-400">{item.vel}</td>
                      <td className={clsx('px-3 py-2 font-bold',
                        item.status==='oos'?'text-red-400':item.status==='critical'?'text-red-400':item.status==='low'?'text-amber-400':'text-emerald-400')}>
                        {fmtDays(item.daysOfStock)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{item.reorderQty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── FINANCE SUMMARY ── */}
      <Section title="Capital & Cash Flow" icon={Wallet}>
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/50">
              {['Month','Revenue','COGS','Gross Profit','Ad Spend','Ops Cost','Net Profit','Capital Needed','Net Margin'].map(h=>(
                <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}</tr></thead>
            <tbody>
              {finPlan.map(m=>(
                <tr key={m.key} className="border-b border-gray-800/30">
                  <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                  <td className="px-3 py-2.5 text-white">{fmtRs(m.revenue)}</td>
                  <td className="px-3 py-2.5 text-slate-400">{fmtRs(m.cogs)}</td>
                  <td className="px-3 py-2.5 text-emerald-400">{fmtRs(m.grossProfit)}</td>
                  <td className="px-3 py-2.5 text-amber-400">{fmtRs(m.adSpend)}</td>
                  <td className="px-3 py-2.5 text-slate-400">{fmtRs(m.opsCost)}</td>
                  <td className={clsx('px-3 py-2.5 font-bold',m.netProfit>0?'text-emerald-400':'text-red-400')}>{fmtRs(m.netProfit)}</td>
                  <td className={clsx('px-3 py-2.5',m.capitalNeeded>m.grossProfit?'text-amber-400':'text-slate-300')}>{fmtRs(m.capitalNeeded)}</td>
                  <td className={clsx('px-3 py-2.5 font-semibold',m.netMarginPct>0?'text-emerald-400':'text-red-400')}>{m.netMarginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
const TABS = [
  { id:'command', label:'Command',  icon: Zap },
  { id:'plan',    label:'Plan',     icon: TrendingUp },
  { id:'execute', label:'Execute',  icon: Flame },
];

export default function BusinessPlan() {
  const { shopifyOrders, inventoryMap, enrichedRows, brands, activeBrandIds,
    setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders } = useStore();

  const [tab, setTab]               = useState('command');
  const [isPulling, setIsPulling]   = useState(false);
  const [pullLog, setPullLog]       = useState([]);
  const [pullProgress, setPullProgress] = useState(0);
  const [lastPullAt, setLastPullAt] = useState(null);
  const [uploadedOrders, setUploadedOrders] = useState([]);

  const [plan, setPlan] = useState(() => {
    const stored = ls.get(null);
    if (!stored) return DEFAULT_PLAN;
    return {
      ...DEFAULT_PLAN, ...stored,
      collections:   stored.collections?.length   ? stored.collections   : DEFAULT_PLAN.collections,
      skuDimensions: stored.skuDimensions?.length  ? stored.skuDimensions : DEFAULT_PLAN.skuDimensions,
      warehouses:    stored.warehouses?.length     ? stored.warehouses    : DEFAULT_PLAN.warehouses,
      suppliers:     stored.suppliers?.length      ? stored.suppliers     : DEFAULT_PLAN.suppliers,
    };
  });

  const savePlan = useCallback(updates => {
    setPlan(prev => { const next={...prev,...updates}; ls.set(next); return next; });
  }, []);

  /* ── Live pull with progress log ── */
  const handlePull = useCallback(async () => {
    const active = brands.filter(b => activeBrandIds.includes(b.id));
    if (!active.length) return;
    setIsPulling(true);
    setPullLog([]);
    setPullProgress(0);

    const allAccounts = active.reduce((s,b)=>s+(b.meta?.accounts?.filter(a=>a.id&&a.key).length||0),0);
    const totalSteps  = allAccounts + active.filter(b=>b.shopify?.shop).length * 2;
    let done = 0;

    const tick = (msg, count, status='done') => {
      done++;
      setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
      setPullLog(prev=>[...prev,{msg,count,status,ts:new Date().toLocaleTimeString()}]);
    };

    for (const brand of active) {
      const { token, apiVersion:ver, accounts=[] } = brand.meta||{};
      const valid = accounts.filter(a=>a.id&&a.key);
      if (!token||!valid.length) continue;

      setBrandMetaStatus(brand.id,'loading');
      const results=[];
      for (const acc of valid) {
        setPullLog(prev=>[...prev,{msg:`Meta ${acc.key}…`,count:null,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const r = await pullAccount({ver:ver||'v21.0',token,accountKey:acc.key,accountId:acc.id});
          results.push(r);
          /* remove the loading line, replace with done */
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Meta ${acc.key}: ${r.ads?.length||0} ads, ${r.insights7d?.length||0} 7d insights`,count:r.ads?.length,status:'done',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Meta ${acc.key}: ${e.message}`,count:0,status:'error',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        }
      }
      if (results.length) {
        setBrandMetaData(brand.id,{
          campaigns:results.flatMap(r=>r.campaigns), adsets:results.flatMap(r=>r.adsets),
          ads:results.flatMap(r=>r.ads), insightsToday:results.flatMap(r=>r.insightsToday),
          insights7d:results.flatMap(r=>r.insights7d), insights14d:results.flatMap(r=>r.insights14d),
          insights30d:results.flatMap(r=>r.insights30d),
        });
        setBrandMetaStatus(brand.id,'success');
      }

      const {shop,clientId,clientSecret} = brand.shopify||{};
      if (shop&&clientId&&clientSecret) {
        setPullLog(prev=>[...prev,{msg:`Shopify inventory: ${shop}…`,count:null,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const {map,locations,skuToItemId,collections} = await fetchShopifyInventory(shop,clientId,clientSecret);
          setBrandInventory(brand.id,map,locations,null,skuToItemId,collections);
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Shopify inventory: ${Object.keys(map).length} SKUs`,count:Object.keys(map).length,status:'done',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Inventory failed: ${e.message}`,count:0,status:'error',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        }

        /* fetch max 180 days of orders */
        setPullLog(prev=>[...prev,{msg:`Shopify orders 180d: ${shop}…`,count:null,status:'loading',ts:new Date().toLocaleTimeString()}]);
        try {
          const now=new Date(), since=new Date(now-180*86400000).toISOString();
          const res = await fetchShopifyOrders(shop,clientId,clientSecret,since,now.toISOString());
          setBrandOrders(brand.id,res.orders,'180d');
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Shopify orders: ${res.orders?.length||0} orders (180d)`,count:res.orders?.length,status:'done',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        } catch(e) {
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`Orders failed: ${e.message}`,count:0,status:'error',ts:new Date().toLocaleTimeString()}]);
          done++; setPullProgress(Math.round((done/Math.max(totalSteps,1))*100));
        }
      }
    }

    setPullProgress(100);
    setIsPulling(false);
    setLastPullAt(Date.now());
  }, [brands, activeBrandIds, setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders]);

  const handleUpload = useCallback(text => {
    const parsed = parseOrdersCsv(text);
    setUploadedOrders(prev=>[...prev,...parsed]);
  }, []);

  /* ── Derived data ── */
  const allOrders     = useMemo(()=>[...(shopifyOrders||[]),...uploadedOrders],[shopifyOrders,uploadedOrders]);
  const months        = useMemo(()=>buildMonthlyPlan(plan),[plan.baseOrdersPerDay,plan.monthlyGrowthRate,plan.targetCpr,plan.aov]);
  const finPlan       = useMemo(()=>buildFinancePlan(plan,months),[plan,months]);
  const whPlan        = useMemo(()=>buildWarehouseNeeds(plan,months),[plan,months]);
  const opsPlan       = useMemo(()=>buildOpsNeeds(months),[months]);
  const procSchedule  = useMemo(()=>buildProcurementSchedule(plan,months),[plan,months]);
  const predictions   = useMemo(()=>buildPredictions({...plan,months},allOrders),[plan,months,allOrders]);
  const stage         = useMemo(()=>detectGrowthStage(predictions.avg7||0),[predictions.avg7]);
  const pva           = useMemo(()=>buildPlanVsActual({...plan,months},allOrders),[plan,months,allOrders]);
  const creative      = useMemo(()=>buildCreativeStrategy(plan,enrichedRows),[plan,enrichedRows]);
  const metaCollections=useMemo(()=>buildCollectionsFromMeta(enrichedRows),[enrichedRows]);
  const inventoryNeeds= useMemo(()=>buildInventoryNeeds(inventoryMap,allOrders),[inventoryMap,allOrders]);
  const decisions     = useMemo(()=>buildDecisionSignals({plan,months,finPlan,whPlan,opsPlan,procSchedule,creative,predictions,inventoryNeeds}),[plan,months,finPlan,whPlan,opsPlan,procSchedule,creative,predictions,inventoryNeeds]);

  const dataStats = {
    ads:    enrichedRows?.length || 0,
    orders: allOrders.length,
    skus:   Object.keys(inventoryMap||{}).length,
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{plan.brandName || 'Business'} Plan</h1>
          <p className="text-xs text-slate-500 mt-0.5">Auto-generated · {months[0]?.label} – {months[months.length-1]?.label}</p>
        </div>
        <button onClick={()=>{if(confirm('Reset to defaults?')){ls.set(DEFAULT_PLAN);setPlan(DEFAULT_PLAN);}}}
          className="text-[10px] text-slate-600 hover:text-slate-400">Reset</button>
      </div>

      {/* Pull panel */}
      <PullPanel isPulling={isPulling} pullLog={pullLog} pullProgress={pullProgress}
        onPull={handlePull} lastPullAt={lastPullAt} dataStats={dataStats} onUpload={handleUpload}/>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900/40 rounded-lg p-1 border border-gray-800/40 w-fit">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all',
              tab===t.id?'bg-brand-600/20 text-brand-300':'text-slate-400 hover:text-slate-200')}>
            <t.icon size={14}/>{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab==='command' && (
        <TabCommand plan={plan} months={months} predictions={predictions} stage={stage}
          decisions={decisions} finPlan={finPlan} whPlan={whPlan} pva={pva} allOrders={allOrders}/>
      )}
      {tab==='plan' && (
        <TabPlan plan={plan} months={months} finPlan={finPlan} whPlan={whPlan}
          opsPlan={opsPlan} savePlan={savePlan}/>
      )}
      {tab==='execute' && (
        <TabExecute plan={plan} months={months} finPlan={finPlan} whPlan={whPlan}
          opsPlan={opsPlan} procSchedule={procSchedule} creative={creative}
          metaCollections={metaCollections} allOrders={allOrders}
          inventoryNeeds={inventoryNeeds} savePlan={savePlan}/>
      )}
    </div>
  );
}
