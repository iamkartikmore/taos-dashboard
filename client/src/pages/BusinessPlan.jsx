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

/* ─── BRAND-AWARE STORAGE ────────────────────────────────────────────── */
const lsKey  = id  => `taos_bplan_v4_${id||'default'}`;
const lsGet  = id  => { try { const r=localStorage.getItem(lsKey(id)); return r?JSON.parse(r):null; } catch { return null; } };
const lsSet  = (id,v) => { try { localStorage.setItem(lsKey(id),JSON.stringify(v)); } catch {} };

const hydrate = stored => ({
  ...DEFAULT_PLAN, ...stored,
  collections:   stored?.collections?.length   ? stored.collections   : DEFAULT_PLAN.collections,
  skuDimensions: stored?.skuDimensions?.length  ? stored.skuDimensions : DEFAULT_PLAN.skuDimensions,
  warehouses:    stored?.warehouses?.length     ? stored.warehouses    : DEFAULT_PLAN.warehouses,
  suppliers:     stored?.suppliers?.length      ? stored.suppliers     : DEFAULT_PLAN.suppliers,
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
  URGENT:{ row:'border-l-2 border-red-500 bg-red-900/20',   badge:'bg-red-500/20 text-red-300 border-red-700/50' },
  HIGH:  { row:'border-l-2 border-amber-500 bg-amber-900/15',badge:'bg-amber-500/20 text-amber-300 border-amber-700/40' },
  MEDIUM:{ row:'border-l-2 border-brand-500 bg-brand-900/10',badge:'bg-brand-500/15 text-brand-300 border-brand-700/30' },
  LOW:   { row:'border-l-2 border-gray-600',                 badge:'bg-gray-800 text-slate-400 border-gray-700/40' },
};

/* ─── SHARED COMPONENTS ──────────────────────────────────────────────── */
function KpiCard({ label, value, sub, delta, inverse=false, cls='', warn, accent, sparkline }) {
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
          <span className="text-white font-bold">{p.value>5000?fmtRs(p.value):typeof p.value==='number'?fmtK(p.value):p.value}</span>
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

function Section({ title, icon:Icon, children, defaultOpen=true, badge }) {
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
        {open?<ChevronDown size={14} className="text-slate-600"/>:<ChevronRight size={14} className="text-slate-600"/>}
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-800/40 pt-3">{children}</div>}
    </div>
  );
}

/* ─── PULL PANEL ─────────────────────────────────────────────────────── */
function PullPanel({ isPulling, pullLog, pullProgress, onPull, lastPullAt, stats, onUpload }) {
  const fileRef=useRef();
  const ready  = stats.orders>0||stats.ads>0;
  return (
    <div className={clsx('rounded-xl border p-4',
      isPulling?'border-brand-700/60 bg-brand-950/30':ready?'border-gray-800/50 bg-gray-900/40':'border-amber-800/40 bg-amber-950/20')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-bold text-white shrink-0">Live Data</span>
          {ready&&!isPulling&&(
            <div className="flex items-center gap-2 text-[10px] flex-wrap">
              {stats.ads>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.ads.toLocaleString()} ads</span>}
              {stats.orders>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.orders.toLocaleString()} orders</span>}
              {stats.skus>0&&<span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">{stats.skus} SKUs</span>}
              {lastPullAt&&<span className="text-slate-600">· {new Date(lastPullAt).toLocaleTimeString()}</span>}
            </div>
          )}
          {!ready&&!isPulling&&<span className="text-[10px] text-amber-400/80">No data loaded — pull to unlock all analytics</span>}
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
            <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500"
              style={{width:`${pullProgress}%`}}/>
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
  );
}

/* ─── TAB: COMMAND ───────────────────────────────────────────────────── */
function TabCommand({ plan, months, predictions, adv, stage, decisions, finPlan, whPlan, pva, seasonality }) {
  const now     = new Date();
  const currKey = MONTH_KEY(now);
  const curr    = pva.find(m=>m.key===currKey);
  const currFin = finPlan.find(m=>m.key===currKey);
  const currMo  = months.find(m=>m.key===currKey)||months[0];
  const nextStage = STAGES[STAGES.findIndex(s=>s.id===stage?.id)+1];
  const firstOver = whPlan.find(m=>m.overfill);

  /* 30-day orders movement chart */
  const movementData = (predictions.recentDays||[]).map(d=>({
    date: d.date, Orders: d.orders,
    '7d Avg': Math.round(predictions.avg7||0),
    Plan: currMo?.ordersPerDay||0,
  }));

  /* PvA — show last 2 + current + next 3 */
  const pvaVisible = pva.filter((_,i)=>i<6);

  /* Forecast scenarios */
  const forecastData = (adv.forecastArray||[]).slice(0,21).map(d=>({
    date: d.date, Base: d.base, Bull: d.bull, Bear: d.bear,
  }));

  const progressPct = curr ? Math.round((curr.daysElapsed/(curr.days||30))*100) : 0;

  return (
    <div className="space-y-5">
      {/* Stage + next stage strip */}
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
        {/* Stage progress bar */}
        {stage&&(
          <div>
            <div className="flex justify-between text-[10px] text-slate-600 mb-1">
              <span>{stage.name}: {stage.min}–{stage.max===Infinity?'∞':stage.max} orders/day</span>
              <span className="font-semibold" style={{color:stage.color}}>
                {stage.max!==Infinity?`${Math.round(Math.min(((predictions.avg7||0)-stage.min)/(stage.max-stage.min)*100,100))}% through stage`:'Max stage'}
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{
                  width:`${stage.max!==Infinity?Math.min(((predictions.avg7||0)-stage.min)/(stage.max-stage.min)*100,100):100}%`,
                  background:`linear-gradient(90deg,${stage.color}80,${stage.color})`,
                }}/>
            </div>
          </div>
        )}
      </div>

      {/* Decision signals */}
      {decisions.length>0&&(
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action Required</span>
            <span className="text-[10px] bg-red-500/20 text-red-400 rounded-full px-2 py-0.5 font-bold">{decisions.filter(d=>d.priority==='URGENT'||d.priority==='HIGH').length} urgent</span>
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

      {/* Current month progress */}
      {curr&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{curr.label}</span>
              <StatusPill status={curr.status}/>
            </div>
            <span className="text-[10px] text-slate-500">{curr.daysElapsed}d elapsed · {curr.daysRemaining}d left</span>
          </div>
          {/* Month progress bar */}
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-700 to-brand-500 transition-all"
              style={{width:`${progressPct}%`}}/>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Orders/Day (actual)"
              value={curr.actualOrdPerDay.toFixed(0)}
              sub={`Target: ${curr.ordersPerDay}/day`}
              delta={curr.ordersPerDay>0?((curr.actualOrdPerDay-curr.ordersPerDay)/curr.ordersPerDay*100):null}/>
            <KpiCard label="Revenue MTD"
              value={fmtRs(curr.actualRevenue)}
              sub={`Plan: ${fmtRs(curr.planRevenue)}`}
              delta={curr.planRevenue>0?((curr.actualRevenue-curr.planRevenue)/curr.planRevenue*100):null}/>
            <KpiCard label="EOM Projection"
              value={fmtRs(curr.projectedRevenue)}
              sub={`Gap: ${fmtRs(Math.abs(curr.gap))}`}
              cls={curr.gap<=0?'text-emerald-400':'text-amber-400'}/>
            <KpiCard label="Net Margin (est)"
              value={currFin?fmtPct(currFin.netMarginPct):'—'}
              sub="After ads + ops"
              cls={currFin&&currFin.netMarginPct>0?'text-emerald-400':'text-red-400'}/>
          </div>
        </div>
      )}

      {/* Orders movement chart — 30 days */}
      {movementData.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-bold text-white">Orders Movement — 30 Days</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                7d avg <span className="text-white font-semibold">{predictions.avg7}</span>
                <span className="mx-2 text-slate-700">·</span>
                14d avg <span className="text-slate-300">{predictions.avg14}</span>
                <span className="mx-2 text-slate-700">·</span>
                <span className={clsx('font-semibold', predictions.trend>0?'text-emerald-400':predictions.trend<0?'text-red-400':'text-slate-400')}>
                  {predictions.trendLabel}
                </span>
              </div>
            </div>
            <div className="flex gap-3 text-[10px] text-slate-600">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-brand-400 inline-block"/>Actual</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t border-dashed border-slate-600 inline-block"/>Plan</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={movementData} margin={{top:8,right:4,bottom:0,left:0}}>
              <defs>
                <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.6}/>
              <XAxis dataKey="date" tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} interval={4}/>
              <YAxis tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} width={28}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={currMo?.ordersPerDay||0} stroke="#64748b" strokeDasharray="4 3" strokeWidth={1}/>
              <Area type="monotone" dataKey="Orders" stroke="#818cf8" fill="url(#ordersGrad)" strokeWidth={2} dot={false} activeDot={{r:3}}/>
              <Line type="monotone" dataKey="7d Avg" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="3 2"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 21-day scenario forecast */}
      {forecastData.length>0&&(
        <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
          <div className="text-sm font-bold text-white mb-0.5">21-Day Forecast</div>
          <div className="text-[10px] text-slate-500 mb-3">
            {adv.regStats?.interpretation||'Regression-based forecast'} · R² {adv.regStats?.r2} · Confidence: <span className={adv.regStats?.confidence==='High'?'text-emerald-400':adv.regStats?.confidence==='Medium'?'text-amber-400':'text-slate-400'}>{adv.regStats?.confidence}</span>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={forecastData} margin={{top:4,right:4,bottom:0,left:0}}>
              <defs>
                <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" strokeOpacity={0.5}/>
              <XAxis dataKey="date" tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} interval={4}/>
              <YAxis tick={{fill:'#475569',fontSize:9}} axisLine={false} tickLine={false} width={28}/>
              <Tooltip content={<Tip/>}/>
              <Area type="monotone" dataKey="Bull" stroke="#22c55e" fill="url(#bullGrad)" strokeWidth={1} dot={false} strokeDasharray="3 2"/>
              <Area type="monotone" dataKey="Base" stroke="#818cf8" fill="none" strokeWidth={2} dot={false}/>
              <Area type="monotone" dataKey="Bear" stroke="#ef4444" fill="url(#bearGrad)" strokeWidth={1} dot={false} strokeDasharray="3 2"/>
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center mt-1">
            {[['Base','#818cf8'],['Bull','#22c55e'],['Bear','#ef4444']].map(([l,c])=>(
              <div key={l} className="flex items-center gap-1 text-[10px] text-slate-600">
                <span className="w-3 h-0.5 inline-block rounded" style={{background:c}}/>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan vs Actual table */}
      <Section title="Plan vs Actual — Monthly" icon={Target} badge={`${pvaVisible.filter(m=>m.status==='on-track').length} on track`}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/60">
                {['Month','Status','Plan Orders','Actual/Day','Revenue Plan','Revenue Actual','Projected','vs Plan'].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pvaVisible.map(m=>(
                <tr key={m.key} className={clsx('border-b border-gray-800/30 transition-colors hover:bg-gray-800/20',
                  m.key===currKey?'bg-brand-950/20':'')}>
                  <td className="px-3 py-2.5 font-medium text-white whitespace-nowrap">
                    {m.label}
                    {m.key===currKey&&<span className="ml-1.5 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={m.status}/></td>
                  <td className="px-3 py-2.5 text-slate-300">{m.ordersPerDay}/day</td>
                  <td className="px-3 py-2.5">
                    <span className={clsx('font-semibold',m.actualOrdPerDay>0?m.actualOrdPerDay>=m.ordersPerDay?'text-emerald-400':'text-amber-400':'text-slate-600')}>
                      {m.actualOrdPerDay>0?m.actualOrdPerDay.toFixed(0):'—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{fmtRs(m.planRevenue)}</td>
                  <td className="px-3 py-2.5 text-white">{m.actualRevenue>0?fmtRs(m.actualRevenue):'—'}</td>
                  <td className="px-3 py-2.5 text-slate-300">{m.projectedRevenue>0?fmtRs(m.projectedRevenue):'—'}</td>
                  <td className="px-3 py-2.5">
                    {m.projPct>0?(
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={clsx('h-full rounded-full',STATUS[m.status]?.bar||'bg-gray-600')}
                            style={{width:`${Math.min(m.projPct,100)}%`}}/>
                        </div>
                        <span className={clsx('text-[10px] font-semibold',
                          m.projPct>=95?'text-emerald-400':m.projPct>=75?'text-amber-400':'text-red-400')}>
                          {m.projPct.toFixed(0)}%
                        </span>
                      </div>
                    ):<span className="text-slate-600 text-[10px]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Day of week seasonality */}
      {seasonality.dowPatterns?.some(d=>d.avgOrders>0)&&(
        <Section title="Day-of-Week Patterns" icon={Activity} defaultOpen={false}>
          <div className="grid grid-cols-7 gap-1.5 mt-1">
            {seasonality.dowPatterns.map(d=>(
              <div key={d.day} className="text-center">
                <div className="text-[9px] text-slate-500 mb-1">{d.day}</div>
                <div className="h-16 bg-gray-800 rounded-lg relative overflow-hidden flex items-end justify-center">
                  <div className={clsx('w-full rounded-lg transition-all',
                    d.indexVsAvg>=1.1?'bg-brand-500/60':d.indexVsAvg>=0.9?'bg-gray-600':'bg-gray-700/60')}
                    style={{height:`${Math.min((d.indexVsAvg||0)*60,100)}%`}}/>
                </div>
                <div className="text-[9px] font-bold text-white mt-1">{d.avgOrders}</div>
                <div className={clsx('text-[8px]',d.indexVsAvg>=1.1?'text-emerald-400':d.indexVsAvg<0.9?'text-red-400':'text-slate-600')}>
                  {d.indexVsAvg>=1?'+':''}{((d.indexVsAvg-1)*100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-slate-500">
            <span>Best: <span className="text-emerald-400 font-semibold">{seasonality.bestDay?.day} ({seasonality.bestDay?.avgOrders} avg)</span></span>
            <span>Worst: <span className="text-red-400 font-semibold">{seasonality.worstDay?.day} ({seasonality.worstDay?.avgOrders} avg)</span></span>
          </div>
        </Section>
      )}

      {/* Stage priorities */}
      <Section title={`${stage?.name} Stage Priorities`} icon={CheckCircle} defaultOpen={false}>
        <div className="space-y-2">
          {(stage?.priorities||[]).map((p,i)=>(
            <div key={i} className="flex items-start gap-2.5 text-xs text-slate-300">
              <span className="w-5 h-5 rounded-full bg-brand-600/25 text-brand-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
              {p}
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-gray-800/40 grid grid-cols-1 md:grid-cols-2 gap-2">
          {(stage?.milestones||[]).map((m,i)=>(
            <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0"/>
              {m}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ─── TAB: PLAN ──────────────────────────────────────────────────────── */
function TabPlan({ plan, months, finPlan, whPlan, opsPlan, savePlan, cohorts }) {
  const [editCore,setEditCore]=useState(false);
  const [core,setCore]=useState({
    brandName: plan.brandName||'',
    baseOrdersPerDay: plan.baseOrdersPerDay,
    monthlyGrowthRate: Math.round((plan.monthlyGrowthRate||0.2)*100),
    targetCpr: plan.targetCpr, targetRoas: plan.targetRoas, aov: plan.aov,
  });
  const [editCols,setEditCols]=useState(false);
  const [colsDraft,setColsDraft]=useState((plan.collections||[]).map(c=>({...c})));
  const [editWH,setEditWH]=useState(false);
  const [whDraft,setWhDraft]=useState((plan.warehouses||[]).map(w=>({...w})));
  const [editDims,setEditDims]=useState(false);
  const [dimsDraft,setDimsDraft]=useState((plan.skuDimensions||[]).map(d=>({...d})));
  const [editSupp,setEditSupp]=useState(false);
  const [suppDraft,setSuppDraft]=useState((plan.suppliers||[]).map(s=>({...s})));

  const saveCore=()=>{ savePlan({brandName:core.brandName, baseOrdersPerDay:+core.baseOrdersPerDay, monthlyGrowthRate:core.monthlyGrowthRate/100, targetCpr:+core.targetCpr, targetRoas:+core.targetRoas, aov:+core.aov}); setEditCore(false); };

  const chartData = finPlan.map(m=>({
    label:m.label.slice(0,3), Revenue:Math.round(m.revenue),
    'Ad Spend':Math.round(m.adSpend), 'Net Profit':Math.round(m.netProfit),
  }));

  return (
    <div className="space-y-5">
      {/* Core inputs */}
      <Section title="Growth Targets" icon={Zap}>
        {editCore?(
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-1">
            {[['brandName','Brand Name',''],['baseOrdersPerDay','Base Orders/Day',''],['monthlyGrowthRate','Growth Rate','%'],['targetCpr','Target CPR','₹'],['targetRoas','Target ROAS','x'],['aov','Avg Order Value','₹']].map(([f,l,u])=>(
              <div key={f}>
                <div className="text-[9px] text-slate-500 mb-1">{l}</div>
                <div className="flex items-center gap-1">
                  {u&&<span className="text-[10px] text-slate-500">{u}</span>}
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:border-brand-500 focus:outline-none"
                    value={core[f]} onChange={e=>setCore(p=>({...p,[f]:e.target.value}))}/>
                </div>
              </div>
            ))}
            <div className="col-span-2 md:col-span-3 flex gap-2 pt-1">
              <button onClick={saveCore} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold hover:bg-brand-500 transition-colors">Recalculate Plan</button>
              <button onClick={()=>setEditCore(false)} className="px-3 py-2 bg-gray-700 text-slate-300 rounded-lg text-xs hover:bg-gray-600 transition-colors">Cancel</button>
            </div>
          </div>
        ):(
          <div className="flex flex-wrap gap-3 mt-1">
            {[['Brand',plan.brandName||'—'],['Base Orders',`${plan.baseOrdersPerDay}/day`],['Growth',`${Math.round((plan.monthlyGrowthRate||0.2)*100)}%/mo`],['Target CPR',`₹${plan.targetCpr}`],['Target ROAS',`${plan.targetRoas}x`],['AOV',`₹${plan.aov}`]].map(([l,v])=>(
              <div key={l} className="bg-gray-800/60 border border-gray-700/40 rounded-xl px-4 py-2.5">
                <div className="text-[9px] text-slate-500 mb-0.5">{l}</div>
                <div className="text-sm font-bold text-white">{v}</div>
              </div>
            ))}
            <button onClick={()=>setEditCore(true)} className="self-center flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 px-2 py-1.5">
              <Edit2 size={11}/>Edit
            </button>
          </div>
        )}
      </Section>

      {/* Revenue chart */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 p-4">
        <div className="text-sm font-bold text-white mb-3">12-Month P&L Forecast</div>
        <ResponsiveContainer width="100%" height={190}>
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
            <YAxis tickFormatter={fmtRs} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} width={55}/>
            <Tooltip content={<Tip/>}/>
            <Area type="monotone" dataKey="Revenue"    stroke="#818cf8" fill="url(#revGrad)"    strokeWidth={2} dot={false}/>
            <Area type="monotone" dataKey="Ad Spend"   stroke="#f59e0b" fill="none"              strokeWidth={1.5} strokeDasharray="4 2" dot={false}/>
            <Area type="monotone" dataKey="Net Profit" stroke="#22c55e" fill="url(#profitGrad)" strokeWidth={2} dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-5 justify-center mt-1">
          {[['Revenue','#818cf8'],['Ad Spend','#f59e0b'],['Net Profit','#22c55e']].map(([l,c])=>(
            <div key={l} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{background:c+'80',border:`1.5px solid ${c}`}}/>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* 12-month table */}
      <div className="bg-gray-900/70 rounded-xl border border-gray-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800/40 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-200">12-Month Breakdown</span>
          <button onClick={()=>downloadCsv('plan.csv',finPlan.map(m=>({Month:m.label,Orders:m.ordersPerDay,Revenue:Math.round(m.revenue),AdSpend:Math.round(m.adSpend),GrossProfit:Math.round(m.grossProfit),NetProfit:Math.round(m.netProfit),CapNeeded:m.capitalNeeded})),['Month','Orders','Revenue','AdSpend','GrossProfit','NetProfit','CapNeeded'])}
            className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
            <Download size={11}/>Export
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/40 bg-gray-900/40">
              {['Month','Stage','Ord/Day','Revenue','Ad Spend','Gross Profit','Net Profit','Capital Needed','Staff · Shifts','WH%'].map(h=>(
                <th key={h} className="px-3 py-2.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {months.map((m,i)=>{
                const f=finPlan[i]||{}, wh=whPlan[i]||{}, ops=opsPlan[i]||{};
                const st=STAGES.find(s=>m.ordersPerDay>=s.min&&m.ordersPerDay<s.max)||STAGES[0];
                const isNow=m.key===MONTH_KEY();
                return (
                  <tr key={m.key} className={clsx('border-b border-gray-800/30 transition-colors hover:bg-gray-800/15',isNow&&'bg-brand-950/20')}>
                    <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                      {m.label}
                      {isNow&&<span className="ml-1 text-[8px] bg-brand-500/20 text-brand-400 px-1 py-0.5 rounded font-bold">NOW</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{background:st.color+'20',color:st.color}}>{st.badge}</span>
                    </td>
                    <td className="px-3 py-2.5 text-white font-semibold">{m.ordersPerDay}</td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(f.revenue)}</td>
                    <td className="px-3 py-2.5 text-amber-400">{fmtRs(f.adSpend)}</td>
                    <td className="px-3 py-2.5 text-emerald-400">{fmtRs(f.grossProfit)}</td>
                    <td className={clsx('px-3 py-2.5 font-semibold',f.netProfit>0?'text-emerald-400':'text-red-400')}>{fmtRs(f.netProfit)}</td>
                    <td className={clsx('px-3 py-2.5',f.capitalNeeded>f.grossProfit?'text-amber-400':'text-slate-400')}>{fmtRs(f.capitalNeeded)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{ops.totalHeadcount} · {ops.shifts}sh</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-10 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={clsx('h-full rounded-full',wh.danger?'bg-red-500':wh.overfill?'bg-amber-500':'bg-brand-500/60')}
                            style={{width:`${Math.min(wh.utilization||0,100)}%`}}/>
                        </div>
                        <span className={clsx('text-[10px] font-semibold',wh.danger?'text-red-400':wh.overfill?'text-amber-400':'text-slate-400')}>
                          {(wh.utilization||0).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collections */}
      <Section title="Collection Targets" icon={Flame} defaultOpen={false}>
        {editCols?(
          <div className="space-y-2.5 mt-1">
            {colsDraft.map((c,i)=>(
              <div key={c.key} className="grid grid-cols-5 gap-2 items-center">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:c.color}}/>{c.label}
                </div>
                {[['alloc','Alloc %','pct'],['roas','ROAS','x'],['cpr','CPR','₹']].map(([f,l,u])=>(
                  <div key={f}>
                    <div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs text-center focus:border-brand-500 focus:outline-none"
                      value={f==='alloc'?Math.round(c[f]*100):c[f]}
                      onChange={e=>setColsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:f==='alloc'?parseFloat(e.target.value)/100:e.target.value}:x))}/>
                  </div>
                ))}
                <div className="text-[10px] text-slate-600">{(c.alloc*100).toFixed(0)}% of budget</div>
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({collections:colsDraft.map(c=>({...c,alloc:parseFloat(c.alloc),roas:parseFloat(c.roas),cpr:parseFloat(c.cpr)}))});setEditCols(false);}}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold">Save</button>
              <button onClick={()=>setEditCols(false)} className="px-3 py-2 bg-gray-700 text-white rounded-lg text-xs">Cancel</button>
            </div>
          </div>
        ):(
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
              {(plan.collections||[]).map(c=>(
                <div key={c.key} className="bg-gray-800/50 border border-gray-700/30 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{background:c.color}}/>
                    <span className="text-xs font-semibold text-white">{c.label}</span>
                  </div>
                  <div className="text-xl font-bold text-white">{Math.round(c.alloc*100)}%</div>
                  <div className="text-[10px] text-slate-500 mt-1">ROAS {parseFloat(c.roas).toFixed(2)}x · CPR ₹{c.cpr}</div>
                  <div className="h-1 bg-gray-700 rounded-full mt-2"><div className="h-full rounded-full" style={{width:`${c.alloc*100}%`,background:c.color}}/></div>
                </div>
              ))}
            </div>
            <button onClick={()=>setEditCols(true)} className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit</button>
          </div>
        )}
      </Section>

      {/* SKU Dimensions */}
      <Section title="SKU Dimensions (Warehouse Space Calc)" icon={Package} defaultOpen={false}>
        <div className="text-[10px] text-slate-500 mb-3">Box size × buffer days = m³ storage required each month. Drives the WH% column above.</div>
        {editDims?(
          <div className="space-y-2">
            {dimsDraft.map((d,i)=>(
              <div key={d.key} className="grid grid-cols-6 gap-2 items-center">
                <span className="text-xs text-slate-300">{d.label}</span>
                {[['lengthCm','L cm'],['widthCm','W cm'],['heightCm','H cm'],['unitsPerOrder','Units/Ord'],['bufferDays','Buffer d']].map(([f,l])=>(
                  <div key={f}><div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-white text-xs text-center focus:border-brand-500 focus:outline-none"
                      value={d[f]} onChange={e=>setDimsDraft(p=>p.map((x,j)=>j===i?{...x,[f]:parseFloat(e.target.value)||0}:x))}/>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({skuDimensions:dimsDraft});setEditDims(false);}} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold">Save</button>
              <button onClick={()=>setEditDims(false)} className="px-3 py-2 bg-gray-700 text-white rounded-lg text-xs">Cancel</button>
            </div>
          </div>
        ):(
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs mb-2">
                <thead><tr className="border-b border-gray-800/40">
                  {['Category','L×W×H (cm)','Units/Order','Buffer Days','m³/unit'].map(h=>(
                    <th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{(plan.skuDimensions||[]).map(d=>(
                  <tr key={d.key} className="border-b border-gray-800/30">
                    <td className="px-2 py-2 text-white font-medium">{d.label}</td>
                    <td className="px-2 py-2 text-slate-300">{d.lengthCm}×{d.widthCm}×{d.heightCm}</td>
                    <td className="px-2 py-2 text-slate-400">{d.unitsPerOrder}</td>
                    <td className="px-2 py-2 text-amber-400 font-semibold">{d.bufferDays}d</td>
                    <td className="px-2 py-2 text-slate-500">{((d.lengthCm*d.widthCm*d.heightCm)/1_000_000).toFixed(5)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button onClick={()=>setEditDims(true)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit</button>
          </div>
        )}
      </Section>

      {/* Warehouses */}
      <Section title="Warehouses" icon={Building2} defaultOpen={false}>
        {editWH?(
          <div className="space-y-2 mt-1">
            {whDraft.map((w,i)=>(
              <div key={w.id} className="grid grid-cols-6 gap-2 items-center">
                <input className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs" value={w.name} onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                {[['sqMeters','sqm'],['heightMeters','h(m)'],['utilizationPct','util%']].map(([f,l])=>(
                  <div key={f}><div className="text-[9px] text-slate-600 mb-0.5">{l}</div>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1.5 text-white text-xs text-center"
                      value={f==='utilizationPct'?Math.round(w[f]*100):w[f]}
                      onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,[f]:f==='utilizationPct'?parseFloat(e.target.value)/100:parseFloat(e.target.value)||0}:x))}/>
                  </div>
                ))}
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={w.active} onChange={e=>setWhDraft(p=>p.map((x,j)=>j===i?{...x,active:e.target.checked}:x))} className="accent-brand-500"/>Active
                </label>
                <div className="text-[10px] text-brand-400 font-semibold">{((w.sqMeters||0)*(w.heightMeters||3.5)*(w.utilizationPct||0.7)).toFixed(0)}m³</div>
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({warehouses:whDraft});setEditWH(false);}} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold">Save</button>
              <button onClick={()=>setEditWH(false)} className="px-3 py-2 bg-gray-700 text-white rounded-lg text-xs">Cancel</button>
            </div>
          </div>
        ):(
          <div className="flex flex-wrap gap-3 mt-1">
            {(plan.warehouses||[]).map(w=>(
              <div key={w.id} className={clsx('flex-1 min-w-[140px] rounded-xl border p-3.5',
                w.active?'bg-gray-800/50 border-gray-700/50':'bg-gray-900/30 border-gray-800/30 opacity-50')}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-white">{w.name}</span>
                  <span className={clsx('text-[8px] px-1.5 py-0.5 rounded font-bold',w.active?'bg-emerald-500/20 text-emerald-400':'bg-gray-700 text-slate-500')}>{w.active?'ACTIVE':'INACTIVE'}</span>
                </div>
                <div className="text-[10px] text-slate-500">{w.location} · {w.sqMeters}sqm · {w.heightMeters}m</div>
                <div className="text-sm font-bold text-brand-400 mt-1">{((w.sqMeters||0)*(w.heightMeters||3.5)*(w.utilizationPct||0.7)).toFixed(0)}m³ usable</div>
                {w.notes&&<div className="text-[9px] text-slate-600 mt-1">{w.notes}</div>}
              </div>
            ))}
            <button onClick={()=>setEditWH(true)} className="self-start mt-1 text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit</button>
          </div>
        )}
      </Section>

      {/* Suppliers */}
      <Section title="Suppliers & Lead Times" icon={ShoppingCart} defaultOpen={false}>
        {editSupp?(
          <div className="space-y-2 mt-1">
            {suppDraft.map((s,i)=>(
              <div key={s.id} className="grid grid-cols-5 gap-2 items-center">
                <input className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs" placeholder="Name" value={s.name} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                <input className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs" placeholder="Category" value={s.category} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,category:e.target.value}:x))}/>
                <div><div className="text-[9px] text-slate-600 mb-0.5">Lead days</div>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs text-center" value={s.leadTimeDays} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,leadTimeDays:parseInt(e.target.value)||0}:x))}/></div>
                <input className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs" placeholder="Terms" value={s.paymentTerms} onChange={e=>setSuppDraft(p=>p.map((x,j)=>j===i?{...x,paymentTerms:e.target.value}:x))}/>
                <button onClick={()=>setSuppDraft(p=>p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300 transition-colors"><Trash2 size={13}/></button>
              </div>
            ))}
            <button onClick={()=>setSuppDraft(p=>[...p,{id:`sup${Date.now()}`,name:'',category:'',collectionKey:'',leadTimeDays:30,paymentTerms:'Advance',moqUnits:100,notes:''}])}
              className="text-[10px] text-brand-400 flex items-center gap-1 hover:text-brand-300"><Plus size={10}/>Add</button>
            <div className="flex gap-2 pt-2 border-t border-gray-800/40">
              <button onClick={()=>{savePlan({suppliers:suppDraft});setEditSupp(false);}} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold">Save</button>
              <button onClick={()=>setEditSupp(false)} className="px-3 py-2 bg-gray-700 text-white rounded-lg text-xs">Cancel</button>
            </div>
          </div>
        ):(
          <div>
            <table className="w-full text-xs mt-1 mb-2">
              <thead><tr className="border-b border-gray-800/40">
                {['Supplier','Category','Lead Time','Terms','MOQ'].map(h=><th key={h} className="px-2 py-1.5 text-left text-[9px] font-bold text-slate-500 uppercase">{h}</th>)}
              </tr></thead>
              <tbody>{(plan.suppliers||[]).map(s=>(
                <tr key={s.id} className="border-b border-gray-800/30">
                  <td className="px-2 py-2 text-white font-medium">{s.name}</td>
                  <td className="px-2 py-2 text-slate-400">{s.category}</td>
                  <td className="px-2 py-2 text-amber-400 font-bold">{s.leadTimeDays}d</td>
                  <td className="px-2 py-2 text-slate-400">{s.paymentTerms}</td>
                  <td className="px-2 py-2 text-slate-400">{s.moqUnits}</td>
                </tr>
              ))}</tbody>
            </table>
            <button onClick={()=>setEditSupp(true)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"><Edit2 size={10}/>Edit</button>
          </div>
        )}
      </Section>

      {/* Cohorts */}
      {cohorts.total>0&&(
        <Section title="Customer Cohorts" icon={Zap} defaultOpen={false}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Total Customers" value={fmtK(cohorts.total)} sub="from Shopify data"/>
            <KpiCard label="Repeat Rate" value={fmtPct(cohorts.repeatRate)} sub={`${cohorts.repeat} repeat buyers`} cls={cohorts.repeatRate>20?'text-emerald-400':'text-amber-400'}/>
            <KpiCard label="Avg LTV" value={fmtRs(cohorts.avgLtv)} sub="revenue per customer"/>
            <KpiCard label="High Value (>₹1K)" value={fmtK(cohorts.highValue)} sub={`${cohorts.total>0?((cohorts.highValue/cohorts.total)*100).toFixed(0):0}% of customers`}/>
          </div>
          {cohorts.ltvBuckets&&(
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">LTV Distribution</div>
              <div className="flex gap-1 items-end h-16">
                {cohorts.ltvBuckets.map(b=>{
                  const maxCount=Math.max(...cohorts.ltvBuckets.map(x=>x.count),1);
                  return (
                    <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-brand-500/30 rounded-sm" style={{height:`${(b.count/maxCount)*52}px`}}/>
                      <div className="text-[8px] text-slate-600 text-center leading-tight">{b.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

/* ─── TAB: EXECUTE ───────────────────────────────────────────────────── */
function TabExecute({ plan, months, finPlan, whPlan, opsPlan, procSchedule, creative, allOrders, inventoryNeeds }) {
  const [mktView,setMktView]=useState('publish');

  const urgentPOs = procSchedule.filter(p=>p.urgency!=='UPCOMING');
  const firstOver = whPlan.find(m=>m.overfill);

  return (
    <div className="space-y-5">
      {/* Marketing */}
      <Section title="Marketing & Content" icon={Flame} badge={creative.fatigueAlerts?.length>0?`${creative.fatigueAlerts.length} fatigued`:undefined}>
        <div className="flex gap-1 mb-4 bg-gray-900/50 rounded-lg p-1 border border-gray-800/40 w-fit">
          {[['publish','What to Publish'],['top','Top Performers'],['budget','Monthly Budget']].map(([v,l])=>(
            <button key={v} onClick={()=>setMktView(v)}
              className={clsx('px-3 py-1.5 rounded text-xs font-medium transition-all',mktView===v?'bg-brand-600/20 text-brand-300':'text-slate-400 hover:text-slate-200')}>
              {l}
            </button>
          ))}
        </div>

        {mktView==='publish'&&(
          <div className="space-y-3">
            {creative.whatToPublish.length===0?(
              <div className="text-center py-8 text-slate-500 text-xs bg-gray-900/40 rounded-xl border border-gray-800/30">Pull Meta data to unlock collection-level recommendations</div>
            ):creative.whatToPublish.map(w=>{
              const coll=(plan.collections||[]).find(c=>c.key===w.key);
              const PSTYLE={HIGH:'border-l-4 border-amber-500 bg-amber-950/15',URGENT:'border-l-4 border-red-500 bg-red-950/15',MEDIUM:'border-l-4 border-brand-500 bg-brand-950/10',LOW:'border-l-4 border-gray-600'};
              return (
                <div key={w.key} className={clsx('rounded-xl border border-gray-800/50 p-4',PSTYLE[w.urgency]||PSTYLE.LOW)}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{background:coll?.color||'#818cf8'}}/>
                      <span className="text-sm font-bold text-white">{w.collection}</span>
                      <span className="text-[10px] text-slate-500">{w.budgetShare}% of budget</span>
                    </div>
                    <span className={clsx('text-[9px] px-2 py-0.5 rounded-full font-bold border',PRIORITY[w.urgency]?.badge)}>{w.urgency}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
                    <div>
                      <div className="text-[9px] text-slate-500 mb-0.5">Live ROAS</div>
                      <div className={clsx('font-bold',w.currentRoas>=w.targetRoas?'text-emerald-400':'text-amber-400')}>{w.currentRoas.toFixed(2)}x</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 mb-0.5">Target ROAS</div>
                      <div className="font-bold text-white">{w.targetRoas.toFixed(2)}x</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 mb-0.5">Active Ads</div>
                      <div className="font-bold text-white">{w.activeAds}</div>
                    </div>
                  </div>
                  <div className="bg-gray-900/60 border border-gray-700/40 rounded-lg p-2.5 text-xs text-slate-300">
                    <span className="font-bold text-white">→ </span>{w.recommendation}
                  </div>
                </div>
              );
            })}
            {creative.fatigueAlerts?.length>0&&(
              <div className="mt-1">
                <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={10}/>Creative Fatigue Alerts
                </div>
                {creative.fatigueAlerts.map((a,i)=>(
                  <div key={i} className="flex items-center gap-3 bg-amber-950/20 border border-amber-800/30 rounded-lg p-2.5 text-xs mb-1.5">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0"/>
                    <div className="flex-1"><span className="text-white font-medium">{a.name}</span><span className="text-slate-500 ml-2">{a.collection}</span></div>
                    <div className="text-right shrink-0">
                      <div className="text-red-400 font-bold">{a.roas7d?.toFixed(1)}x now</div>
                      <div className="text-slate-500 text-[9px]">{a.roas30d?.toFixed(1)}x was 30d</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mktView==='top'&&(
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {creative.collections.slice(0,4).map(c=>(
                <div key={c.name} className="bg-gray-800/50 border border-gray-700/30 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white truncate">{c.name}</span>
                    <span className={clsx('text-[8px] px-1 py-0.5 rounded font-bold',c.status==='excellent'?'bg-emerald-500/20 text-emerald-400':c.status==='good'?'bg-brand-500/20 text-brand-400':'bg-amber-500/20 text-amber-400')}>{c.status.toUpperCase()}</span>
                  </div>
                  <div className="text-xl font-bold text-white">{c.avgRoas}x</div>
                  <div className="text-[10px] text-slate-500">ROAS · ₹{c.avgCpr} CPR · {c.adCount} ads</div>
                  <div className="text-[10px] text-slate-600 mt-1">{fmtRs(c.spend)} spend</div>
                </div>
              ))}
            </div>
            {creative.topCreatives.length>0&&(
              <div className="overflow-x-auto rounded-xl border border-gray-800/50">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
                    {['Creative','Collection','7d ROAS','CPR','Spend','Purchases'].map(h=>(
                      <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{creative.topCreatives.slice(0,10).map((c,i)=>(
                    <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                      <td className="px-3 py-2.5 text-white max-w-[180px] truncate font-medium">{c.name}</td>
                      <td className="px-3 py-2.5 text-slate-400">{c.collection}</td>
                      <td className="px-3 py-2.5 text-emerald-400 font-bold">{c.roas7d?.toFixed(2)}x</td>
                      <td className="px-3 py-2.5 text-slate-300">₹{c.cpr7d?.toFixed(0)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{fmtRs(c.spend)}</td>
                      <td className="px-3 py-2.5 text-slate-300">{c.purchases}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {mktView==='budget'&&(
          <div className="overflow-x-auto rounded-xl border border-gray-800/50 mt-1">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
                {['Month','Budget/Day','Total Budget','Campaigns','Creatives','Expected Orders'].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>{months.map(m=>{
                const mk=buildMarketingNeeds(m,plan);
                return (
                  <tr key={m.key} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                    <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                    <td className="px-3 py-2.5 text-amber-400 font-semibold">{fmtRs(m.adBudgetPerDay)}</td>
                    <td className="px-3 py-2.5 text-slate-300">{fmtRs(mk.totalMonthlyBudget)}</td>
                    <td className="px-3 py-2.5 text-slate-300">{mk.campaigns}</td>
                    <td className="px-3 py-2.5 text-slate-300">{mk.creatives}</td>
                    <td className="px-3 py-2.5 text-white">{mk.expectedResults.toLocaleString()}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Procurement */}
      <Section title="Procurement & Import Pipeline" icon={ShoppingCart}
        badge={urgentPOs.length>0?`${urgentPOs.length} action needed`:undefined}>
        {urgentPOs.length>0&&(
          <div className="mb-4 space-y-2">
            {urgentPOs.map((po,i)=>(
              <div key={i} className={clsx('rounded-xl border p-3.5 flex items-center gap-4',
                po.urgency==='OVERDUE'?'bg-red-950/25 border-red-800/40':'bg-amber-950/15 border-amber-800/30')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={clsx('text-[9px] font-bold px-2 py-0.5 rounded-full border',
                      po.urgency==='OVERDUE'?'bg-red-500/20 text-red-400 border-red-700/40':'bg-amber-500/20 text-amber-400 border-amber-700/40')}>
                      {po.urgency==='OVERDUE'?'OVERDUE':`DUE IN ${po.daysUntil}d`}
                    </span>
                    <span className="text-xs font-bold text-white">{po.supplier}</span>
                    <span className="text-[10px] text-slate-500">for {po.monthLabel}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{po.orderQty.toLocaleString()} units · {fmtRs(po.poValue)} · {po.leadTimeDays}d lead time</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-slate-500">PO by</div>
                  <div className="text-sm font-bold text-white">{po.poDate}</div>
                  <div className="text-[9px] text-slate-600">→ {po.deliveryDate}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Full Schedule</div>
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
              {['PO Date','Supplier','For Month','Units','Value','Lead','Delivery'].map(h=>(
                <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{procSchedule.slice(0,14).map((po,i)=>(
              <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                <td className={clsx('px-3 py-2.5 font-semibold whitespace-nowrap',
                  po.urgency==='OVERDUE'?'text-red-400':po.urgency==='DUE_SOON'?'text-amber-400':'text-slate-300')}>
                  {po.poDate}
                </td>
                <td className="px-3 py-2.5 text-white font-medium">{po.supplier}</td>
                <td className="px-3 py-2.5 text-slate-400">{po.monthLabel}</td>
                <td className="px-3 py-2.5 text-slate-300">{po.orderQty.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-emerald-400 font-semibold">{fmtRs(po.poValue)}</td>
                <td className="px-3 py-2.5 text-amber-400">{po.leadTimeDays}d</td>
                <td className="px-3 py-2.5 text-slate-500">{po.deliveryDate}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      {/* Ops */}
      <Section title="Operations — Warehouse & Staffing" icon={Building2}
        badge={firstOver?`overflow ${firstOver.label}`:undefined}>
        {firstOver&&(
          <div className={clsx('rounded-xl border p-3.5 mb-4 flex items-start gap-3',
            firstOver.danger?'bg-red-950/25 border-red-800/40':'bg-amber-950/15 border-amber-800/30')}>
            <Building2 size={14} className={clsx('mt-0.5 shrink-0',firstOver.danger?'text-red-400':'text-amber-400')}/>
            <div className="text-xs">
              <span className={clsx('font-bold',firstOver.danger?'text-red-300':'text-amber-300')}>
                {firstOver.danger?'Warehouse full':'Overflow in '}
              </span>
              {!firstOver.danger&&<span className="font-bold text-white">{firstOver.label}</span>}
              <span className="text-slate-400"> — {firstOver.utilization.toFixed(0)}% utilized ({firstOver.totalVolumeM3}m³ needed, {firstOver.totalCapM3}m³ available · {firstOver.palletsNeeded} pallets)</span>
              <div className="mt-1 text-slate-500">Activate next warehouse or reduce buffer days before this date.</div>
            </div>
          </div>
        )}
        <div className="mb-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Warehouse Utilization</div>
          <div className="space-y-1.5">
            {whPlan.map(m=>(
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-14 text-[10px] text-slate-500 shrink-0">{m.label.slice(0,6)}</div>
                <div className="flex-1 h-3.5 bg-gray-800 rounded overflow-hidden relative">
                  <div className={clsx('h-full rounded transition-all duration-300',
                    m.danger?'bg-gradient-to-r from-red-600 to-red-500':m.overfill?'bg-gradient-to-r from-amber-600 to-amber-500':'bg-gradient-to-r from-brand-700 to-brand-500')}
                    style={{width:`${Math.min(m.utilization,100)}%`}}/>
                </div>
                <div className={clsx('w-12 text-[10px] font-bold text-right shrink-0',m.danger?'text-red-400':m.overfill?'text-amber-400':'text-slate-400')}>
                  {m.utilization.toFixed(0)}%
                </div>
                <div className="w-28 text-[10px] text-slate-600 shrink-0">{m.totalVolumeM3}m³/{m.totalCapM3}m³</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Headcount & Shifts</div>
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
              {['Month','Ord/Day','Packers','QC','Shifts','Ops','CS','Total','Packing Cap'].map(h=>(
                <th key={h} className="px-2.5 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{opsPlan.map((m,i)=>{
              const prev=opsPlan[i-1];
              const delta=prev?m.totalHeadcount-prev.totalHeadcount:0;
              const shiftUp=prev&&m.shifts>prev.shifts;
              return (
                <tr key={m.key} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/15',shiftUp&&'bg-amber-950/10')}>
                  <td className="px-2.5 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{m.ordersPerDay}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{m.packers}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{m.qc}</td>
                  <td className={clsx('px-2.5 py-2.5 font-bold',shiftUp?'text-amber-400':'text-white')}>{m.shifts}{shiftUp&&<span className="text-[8px] ml-1">↑</span>}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{m.ops}</td>
                  <td className="px-2.5 py-2.5 text-slate-300">{m.cs}</td>
                  <td className="px-2.5 py-2.5 text-white font-semibold">
                    {m.totalHeadcount}
                    {delta>0&&<span className="text-emerald-400 text-[9px] ml-1">+{delta}</span>}
                  </td>
                  <td className={clsx('px-2.5 py-2.5 text-[10px]',m.capacityBuffer<10?'text-amber-400':'text-slate-500')}>
                    {m.packingCapacity.toLocaleString()}/day
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>

        {inventoryNeeds.length>0&&(
          <div className="mt-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Live SKU Health (from Shopify)</div>
            <div className="overflow-x-auto rounded-xl border border-gray-800/50">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
                  {['SKU','Stock','Vel/Day','Days Left','Demand 30d','Reorder'].map(h=>(
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>{inventoryNeeds.slice(0,15).map(item=>(
                  <tr key={item.sku} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                    <td className="px-3 py-2.5 text-white font-medium max-w-[180px] truncate">{item.name}</td>
                    <td className="px-3 py-2.5 text-slate-300">{item.current.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.vel}</td>
                    <td className={clsx('px-3 py-2.5 font-bold text-sm',
                      item.status==='oos'?'text-red-400':item.status==='critical'?'text-red-400':item.status==='low'?'text-amber-400':'text-emerald-400')}>
                      {fmtDays(item.daysOfStock)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{item.demandNext30.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-300">{item.reorderQty.toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* Finance */}
      <Section title="Capital & Cash Flow" icon={Wallet} defaultOpen={false}>
        <div className="overflow-x-auto rounded-xl border border-gray-800/50">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-800/50 bg-gray-900/40">
              {['Month','Revenue','COGS','Gross Profit','Ad Spend','Ops','Net Profit','Capital Needed','Margin'].map(h=>(
                <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{finPlan.map(m=>(
              <tr key={m.key} className="border-b border-gray-800/30 hover:bg-gray-800/15">
                <td className="px-3 py-2.5 text-white font-medium whitespace-nowrap">{m.label}</td>
                <td className="px-3 py-2.5 text-slate-300">{fmtRs(m.revenue)}</td>
                <td className="px-3 py-2.5 text-slate-500">{fmtRs(m.cogs)}</td>
                <td className="px-3 py-2.5 text-emerald-400 font-semibold">{fmtRs(m.grossProfit)}</td>
                <td className="px-3 py-2.5 text-amber-400">{fmtRs(m.adSpend)}</td>
                <td className="px-3 py-2.5 text-slate-500">{fmtRs(m.opsCost)}</td>
                <td className={clsx('px-3 py-2.5 font-bold',m.netProfit>0?'text-emerald-400':'text-red-400')}>{fmtRs(m.netProfit)}</td>
                <td className={clsx('px-3 py-2.5',m.capitalNeeded>m.grossProfit?'text-amber-400':'text-slate-400')}>{fmtRs(m.capitalNeeded)}</td>
                <td className={clsx('px-3 py-2.5 font-bold',m.netMarginPct>0?'text-emerald-400':'text-red-400')}>{m.netMarginPct}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────── */
const TABS = [
  { id:'command', label:'Command',  icon:Zap },
  { id:'plan',    label:'Plan',     icon:TrendingUp },
  { id:'execute', label:'Execute',  icon:Flame },
];

export default function BusinessPlan() {
  const { shopifyOrders, inventoryMap, enrichedRows, brands, activeBrandIds,
    setBrandMetaData, setBrandMetaStatus, setBrandInventory, setBrandOrders } = useStore();

  const primaryBrandId = activeBrandIds[0] || 'default';
  const prevBrandId    = useRef(primaryBrandId);

  const [tab,setTab]             = useState('command');
  const [isPulling,setIsPulling] = useState(false);
  const [pullLog,setPullLog]     = useState([]);
  const [pullProgress,setPullProgress] = useState(0);
  const [lastPullAt,setLastPullAt] = useState(null);
  const [uploadedOrders,setUploadedOrders] = useState([]);

  /* Brand-aware plan */
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

  /* Live pull */
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
          setPullLog(prev=>[...prev.slice(0,-1),{msg:`${acc.key}: ${r.ads?.length||0} ads · ${r.insights7d?.length||0} insights`,count:r.ads?.length,status:'done',ts:new Date().toLocaleTimeString()}]);
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

  /* Derived */
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

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">{plan.brandName||brand?.name||'Business'} Plan</h1>
            {stage&&<StageBadge stage={stage} size="sm"/>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {months[0]?.label} – {months[months.length-1]?.label} · {Math.round((plan.monthlyGrowthRate||0.2)*100)}% growth · {brands.length>1&&<span>Viewing: <span className="text-brand-400">{brand?.name||'All'}</span> · </span>}Switch brand at top to load that brand's plan
          </p>
        </div>
        <button onClick={()=>{if(confirm('Reset to Dawbu defaults?')){const d=DEFAULT_PLAN;lsSet(primaryBrandId,d);setPlan(d);}}}
          className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">Reset</button>
      </div>

      <PullPanel isPulling={isPulling} pullLog={pullLog} pullProgress={pullProgress}
        onPull={handlePull} lastPullAt={lastPullAt} stats={stats} onUpload={handleUpload}/>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/50 rounded-xl p-1 border border-gray-800/50 w-fit">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              tab===t.id?'bg-brand-600/20 text-brand-300 shadow-inner':'text-slate-400 hover:text-slate-200 hover:bg-gray-800/40')}>
            <t.icon size={14}/>{t.label}
          </button>
        ))}
      </div>

      {tab==='command'&&<TabCommand plan={plan} months={months} predictions={predictions} adv={predictions} stage={stage} decisions={decisions} finPlan={finPlan} whPlan={whPlan} pva={pva} seasonality={seasonality}/>}
      {tab==='plan'&&<TabPlan plan={plan} months={months} finPlan={finPlan} whPlan={whPlan} opsPlan={opsPlan} savePlan={savePlan} cohorts={cohorts}/>}
      {tab==='execute'&&<TabExecute plan={plan} months={months} finPlan={finPlan} whPlan={whPlan} opsPlan={opsPlan} procSchedule={procSchedule} creative={creative} allOrders={allOrders} inventoryNeeds={inventoryNeeds}/>}
    </div>
  );
}
