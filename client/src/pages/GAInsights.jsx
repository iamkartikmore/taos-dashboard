import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie,
} from 'recharts';
import {
  TrendingUp, Users, Globe, Monitor, Zap, Package, Tag, RefreshCw,
  ChevronDown, ChevronRight, ArrowUpRight, Activity, Map,
} from 'lucide-react';
import { useStore } from '../store';
import {
  buildGaOverview, buildGaDailyTrend, buildGaMonthlyTrend,
  buildGaChannels, buildGaCampaigns, buildGaLandingPages,
  buildGaGeo, buildGaDevices, buildGaEvents, buildGaItems,
  buildGaUtm, buildCrossRef, buildSkuCrossRef,
} from '../lib/gaAnalytics';

/* ─── FORMATTERS ─────────────────────────────────────────────────── */
const cur  = n => `₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
const num  = n => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0});
const pct  = n => `${Number(n||0).toFixed(1)}%`;
const dur  = s => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m${Math.round(s%60)}s`;
const dec  = (n,d=1) => Number(n||0).toFixed(d);

const COLORS = ['#3b82f6','#22c55e','#f59e0b','#a78bfa','#f472b6','#34d399','#fb923c','#60a5fa','#e879f9','#4ade80','#c084fc','#38bdf8'];

function exportCSV(filename, rows, cols) {
  if (!rows?.length) return;
  const header = cols.map(c=>`"${c.label}"`).join(',');
  const lines  = rows.map(r=>cols.map(c=>{const v=c.fn?c.fn(r):(r[c.key]??'');return `"${String(v).replace(/"/g,'""')}"`;}).join(','));
  const csv = [header,...lines].join('\n');
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),download:filename});
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

/* ─── CHART TOOLTIP ─────────────────────────────────────────────── */
function CT({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1 shadow-xl min-w-[160px]">
      {label && <div className="font-semibold text-slate-200 mb-1">{label}</div>}
      {payload.map((p,i)=>(
        <div key={i} className="text-slate-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{background:p.color}}/>
          {p.name}: <span className="font-bold text-white ml-auto pl-2">
            {p.name?.toLowerCase().includes('rev')||p.name?.toLowerCase().includes('revenue') ? cur(p.value)
             : p.name?.toLowerCase().includes('rate')||p.name?.toLowerCase().includes('pct') ? pct(p.value)
             : p.name?.toLowerCase().includes('dur') ? dur(p.value)
             : num(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function KPI({ label, value, sub, color = '#3b82f6', trend }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub   && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── UTM TREE ──────────────────────────────────────────────────── */
function UtmTree({ data }) {
  const [open, setOpen] = useState({});
  const [openMed, setOpenMed] = useState({});
  const [openCamp, setOpenCamp] = useState({});
  const maxSess = data[0]?.sessions || 1;
  return (
    <div className="space-y-1 text-xs">
      {data.slice(0,15).map(src => (
        <div key={src.source}>
          <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-800/40 rounded cursor-pointer"
            onClick={() => setOpen(p=>({...p,[src.source]:!p[src.source]}))}>
            <span className="text-slate-500 w-3">{open[src.source]?'▾':'▸'}</span>
            <span className="font-semibold text-slate-200 w-28 truncate">{src.source}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-1.5 mx-2">
              <div className="h-1.5 rounded-full bg-blue-500" style={{width:`${src.sessions/maxSess*100}%`}}/>
            </div>
            <span className="text-slate-400 w-16 text-right tabular-nums">{num(src.sessions)}</span>
            <span className="text-emerald-400 w-20 text-right tabular-nums">{cur(src.revenue)}</span>
            <span className="text-slate-500 w-14 text-right tabular-nums">{pct(src.sessions>0?src.conversions/src.sessions*100:0)} CR</span>
          </div>
          {open[src.source] && src.mediums.map(med => (
            <div key={med.medium} className="ml-5">
              <div className="flex items-center gap-2 py-1 px-2 hover:bg-gray-800/30 rounded cursor-pointer"
                onClick={() => setOpenMed(p=>({...p,[src.source+'_'+med.medium]:!p[src.source+'_'+med.medium]}))}>
                <span className="text-slate-600 w-3">{openMed[src.source+'_'+med.medium]?'▾':'▸'}</span>
                <span className="text-slate-400 w-24 truncate">{med.medium}</span>
                <span className="text-slate-500 ml-auto tabular-nums">{num(med.sessions)} sessions · {cur(med.revenue)}</span>
              </div>
              {openMed[src.source+'_'+med.medium] && med.campaigns.map(camp => (
                <div key={camp.campaign} className="ml-8">
                  <div className="flex items-center gap-2 py-0.5 px-2 hover:bg-gray-800/20 rounded cursor-pointer"
                    onClick={() => setOpenCamp(p=>({...p,[camp.campaign]:!p[camp.campaign]}))}>
                    <span className="text-slate-600 w-3 text-[10px]">{openCamp[camp.campaign]?'▾':'▸'}</span>
                    <span className="text-slate-500 flex-1 truncate">{camp.campaign}</span>
                    <span className="text-slate-600 tabular-nums text-[10px]">{num(camp.sessions)} · {cur(camp.revenue)} · {pct(camp.sessions>0?camp.conversions/camp.sessions*100:0)} CR</span>
                  </div>
                  {openCamp[camp.campaign] && camp.contents.slice(0,5).map(c => (
                    <div key={c.content} className="ml-10 flex items-center gap-2 py-0.5 px-2 text-[10px] text-slate-600">
                      <span className="truncate flex-1">{c.content}</span>
                      <span className="tabular-nums">{num(c.sessions)} · {cur(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── TABS ──────────────────────────────────────────────────────── */
const TABS = [
  { id:'overview',    label:'Overview',     icon:TrendingUp  },
  { id:'acquisition', label:'Acquisition',  icon:Zap         },
  { id:'utm',         label:'UTM Drill',    icon:Tag         },
  { id:'pages',       label:'Pages',        icon:Activity    },
  { id:'ecommerce',   label:'Ecommerce',    icon:Package     },
  { id:'audience',    label:'Audience',     icon:Users       },
  { id:'geo',         label:'Geo',          icon:Globe       },
  { id:'crossref',    label:'× Shopify+Meta', icon:ArrowUpRight },
];

/* ─── PAGE ──────────────────────────────────────────────────────── */
export default function GAInsights() {
  const { brands, activeBrandIds, brandData, shopifyOrders, inventoryMap, enrichedRows } = useStore();
  const [tab, setTab] = useState('overview');
  const [selectedBrandId, setSelectedBrandId] = useState(() =>
    (brands||[]).find(b => (activeBrandIds||[]).includes(b.id) && brandData?.[b.id]?.gaData)?.id ||
    (brands||[])[0]?.id || ''
  );

  const gaBrands = (brands||[]).filter(b => brandData?.[b.id]?.gaData);
  const activeBrand = brands?.find(b => b.id === selectedBrandId);
  const gaData = brandData?.[selectedBrandId]?.gaData;
  const gaStatus = brandData?.[selectedBrandId]?.gaStatus || 'idle';

  // Brand's shopify orders + meta rows for cross-ref
  const brandOrders = useMemo(() => (shopifyOrders||[]).filter(o => o._brandId === selectedBrandId), [shopifyOrders, selectedBrandId]);

  const overview    = useMemo(() => buildGaOverview(gaData),        [gaData]);
  const dailyTrend  = useMemo(() => buildGaDailyTrend(gaData),      [gaData]);
  const monthlyTrend= useMemo(() => buildGaMonthlyTrend(gaData),    [gaData]);
  const channels    = useMemo(() => buildGaChannels(gaData),        [gaData]);
  const campaigns   = useMemo(() => buildGaCampaigns(gaData),       [gaData]);
  const landingPages= useMemo(() => buildGaLandingPages(gaData),    [gaData]);
  const geo         = useMemo(() => buildGaGeo(gaData),             [gaData]);
  const devices     = useMemo(() => buildGaDevices(gaData),         [gaData]);
  const events      = useMemo(() => buildGaEvents(gaData),          [gaData]);
  const gaItems     = useMemo(() => buildGaItems(gaData),           [gaData]);
  const utmTree     = useMemo(() => buildGaUtm(gaData),             [gaData]);
  const crossRef    = useMemo(() => buildCrossRef(gaData, brandOrders, enrichedRows), [gaData, brandOrders, enrichedRows]);
  const skuCrossRef = useMemo(() => buildSkuCrossRef(gaData, brandOrders, inventoryMap), [gaData, brandOrders, inventoryMap]);

  /* ── Empty states ── */
  if (!gaBrands.length) {
    if (gaStatus === 'loading') return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-sm">Fetching Google Analytics…</span>
      </div>
    );
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
        <Activity size={40} className="opacity-30" />
        <p className="text-sm">No Google Analytics data loaded.</p>
        <p className="text-xs text-slate-600">Add GA4 credentials in Study Manual → brand card → Google Analytics 4, then Pull Everything.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2.5 rounded-xl bg-blue-500/20">
            <Activity size={18} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Google Analytics</h1>
            {overview && <p className="text-[11px] text-slate-500">{num(overview.sessions)} sessions · {num(overview.users)} users · {overview.days}d</p>}
          </div>
        </div>

        {gaBrands.length > 1 && (
          <select value={selectedBrandId} onChange={e=>setSelectedBrandId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-slate-200 focus:outline-none">
            {gaBrands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        {activeBrand && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-2 h-2 rounded-full" style={{background: activeBrand.color}}/>
            <span className="text-xs text-slate-400">{activeBrand.name}</span>
            {brandData?.[selectedBrandId]?.gaFetchAt && (
              <span className="text-[10px] text-slate-600 ml-2">Last pull: {new Date(brandData[selectedBrandId].gaFetchAt).toLocaleTimeString()}</span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit overflow-x-auto">
        {TABS.map(({id,label,icon:Icon})=>(
          <button key={id} onClick={()=>setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${tab===id?'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/40':'text-slate-400 hover:text-slate-200'}`}>
            <Icon size={12}/> {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────── */}
      {tab==='overview' && overview && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="Sessions"         value={num(overview.sessions)}           sub={`${dec(overview.days)}d period`} />
            <KPI label="Total Users"      value={num(overview.users)}              sub={`${pct(overview.newUserRate)} new`} />
            <KPI label="Conversions"      value={num(overview.conversions)}        sub={`${pct(overview.conversionRate)} rate`} />
            <KPI label="GA Revenue"       value={cur(overview.revenue)}            sub={`${cur(overview.revenuePerSession)} /session`} />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KPI label="Bounce Rate"      value={pct(overview.avgBounceRate)}      sub="lower is better" />
            <KPI label="Avg Session"      value={dur(overview.avgSessionDuration)} sub="engagement duration" />
            <KPI label="Pages/Session"    value={dec(overview.pagesPerSession)}    sub="avg page depth" />
            <KPI label="Returning Users"  value={num(overview.returningUsers)}     sub={`${pct(100-overview.newUserRate)} of total`} />
          </div>

          {/* Daily sessions + revenue trend */}
          {dailyTrend.length > 0 && (
            <Card title="Daily Sessions vs Revenue">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="gSess" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                    <linearGradient id="gRev"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4"/>
                  <XAxis dataKey="date" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>v.slice(5)} interval={Math.max(1,Math.floor(dailyTrend.length/12))}/>
                  <YAxis yAxisId="s" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis yAxisId="r" orientation="right" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false}/>
                  <Tooltip content={<CT/>}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#94a3b8'}}/>
                  <Area yAxisId="s" type="monotone" dataKey="sessions" stroke="#3b82f6" fill="url(#gSess)" strokeWidth={2} dot={false} name="Sessions"/>
                  <Line  yAxisId="r" type="monotone" dataKey="revenue"  stroke="#22c55e" strokeWidth={2} dot={false} name="Revenue"/>
                  <Line  yAxisId="s" type="monotone" dataKey="avg7dSessions" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="7D Avg"/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Monthly trend */}
          {monthlyTrend.length >= 2 && (
            <Card title="Monthly Sessions + Revenue">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyTrend}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4"/>
                  <XAxis dataKey="month" tick={{fill:'#64748b',fontSize:10}}/>
                  <YAxis yAxisId="s" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis yAxisId="r" orientation="right" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false}/>
                  <Tooltip content={<CT/>}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#94a3b8'}}/>
                  <Bar yAxisId="s" dataKey="sessions" fill="#3b82f650" name="Sessions" radius={[2,2,0,0]}/>
                  <Line yAxisId="r" type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={false} name="Revenue"/>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* User type breakdown */}
          {gaData?.userType?.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <Card title="New vs Returning">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={gaData.userType.map((r,i)=>({name:r.newVsReturning,value:parseFloat(r.sessions||0),fill:i===0?'#3b82f6':'#22c55e'}))}
                      cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    </Pie>
                    <Tooltip formatter={v=>num(v)}/>
                  </PieChart>
                </ResponsiveContainer>
              </Card>
              <Card title="Events Overview">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={events.slice(0,8)} layout="vertical">
                    <XAxis type="number" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>(v/1000).toFixed(0)+'k'}/>
                    <YAxis type="category" dataKey="event" width={120} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip content={<CT/>}/>
                    <Bar dataKey="count" radius={[0,4,4,0]} name="Event Count">
                      {events.slice(0,8).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}
        </motion.div>
      )}

      {/* ── ACQUISITION ──────────────────────────────────────────── */}
      {tab==='acquisition' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          {/* Channel bar */}
          {channels.length > 0 && (
            <Card title="Sessions by Channel" action={
              <button onClick={()=>exportCSV('ga_channels.csv',channels,[
                {key:'sourceMedium',label:'Source/Medium'},{key:'channel',label:'Channel'},{key:'sessions',label:'Sessions'},
                {key:'users',label:'Users'},{key:'newUsers',label:'New Users'},{key:'conversions',label:'Conversions'},
                {key:'revenue',label:'Revenue'},{key:'bounceRate',label:'Bounce%'},{key:'convRate',label:'Conv Rate%'},{key:'share',label:'Share%'},
              ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export
              </button>
            }>
              <div className="space-y-2">
                {channels.slice(0,20).map((ch,i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <div className="w-36 text-slate-300 truncate font-medium">{ch.sourceMedium}</div>
                    <div className="flex-1 bg-gray-800 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{width:`${ch.share}%`,background:COLORS[i%COLORS.length]}}/>
                    </div>
                    <div className="w-20 tabular-nums text-slate-400 text-right">{num(ch.sessions)}</div>
                    <div className="w-20 tabular-nums text-emerald-400 text-right">{cur(ch.revenue)}</div>
                    <div className="w-12 tabular-nums text-violet-400 text-right">{pct(ch.convRate)}</div>
                    <div className="w-10 tabular-nums text-slate-500 text-right">{pct(ch.bounceRate)}</div>
                  </div>
                ))}
                <div className="flex items-center gap-3 text-[10px] text-slate-600 pl-0 mt-2">
                  <div className="w-36"/>
                  <div className="flex-1"/>
                  <div className="w-20 text-right">Sessions</div>
                  <div className="w-20 text-right">Revenue</div>
                  <div className="w-12 text-right">Conv%</div>
                  <div className="w-10 text-right">Bounce%</div>
                </div>
              </div>
            </Card>
          )}

          {/* Campaigns table */}
          {campaigns.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Campaigns — {campaigns.length}</h2>
                <button onClick={()=>exportCSV('ga_campaigns.csv',campaigns,[
                  {key:'campaign',label:'Campaign'},{key:'source',label:'Source'},{key:'medium',label:'Medium'},
                  {key:'sessions',label:'Sessions'},{key:'newUsers',label:'New Users'},{key:'conversions',label:'Conversions'},
                  {key:'revenue',label:'Revenue'},{key:'convRate',label:'Conv Rate%'},{key:'cpr',label:'Cost Per Result'},
                ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-800">
                    {['Campaign','Source','Medium','Sessions','New Users','Conversions','Revenue','Conv%'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {campaigns.slice(0,50).map((r,i)=>(
                      <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                        <td className="px-3 py-2.5 text-slate-200 max-w-[200px] truncate font-medium">{r.campaign}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.source}</td>
                        <td className="px-3 py-2.5 text-slate-400">{r.medium}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.sessions)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-blue-400">{num(r.newUsers)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-violet-400">{num(r.conversions)}</td>
                        <td className="px-3 py-2.5 tabular-nums text-emerald-400 font-semibold">{cur(r.revenue)}</td>
                        <td className="px-3 py-2.5 tabular-nums" style={{color:r.convRate>=5?'#22c55e':r.convRate>=2?'#f59e0b':'#64748b'}}>{pct(r.convRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── UTM DRILL ────────────────────────────────────────────── */}
      {tab==='utm' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          <Card title="UTM Source → Medium → Campaign → Content">
            {utmTree.length > 0 ? <UtmTree data={utmTree}/> : <p className="text-slate-500 text-sm">No UTM data in this time range.</p>}
          </Card>
        </motion.div>
      )}

      {/* ── PAGES ────────────────────────────────────────────────── */}
      {tab==='pages' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Landing Pages — {landingPages.length}</h2>
              <button onClick={()=>exportCSV('ga_landing_pages.csv',landingPages,[
                {key:'page',label:'Page'},{key:'sessions',label:'Sessions'},{key:'users',label:'Users'},
                {key:'bounceRate',label:'Bounce%'},{key:'conversions',label:'Conversions'},{key:'convRate',label:'Conv%'},{key:'engagementRate',label:'Engagement%'},
              ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-800">
                  {['Landing Page','Sessions','Users','Bounce%','Conv%','Engagement%','Conversions'].map(h=>(
                    <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {landingPages.slice(0,80).map((r,i)=>(
                    <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                      <td className="px-3 py-2.5 text-slate-300 max-w-[300px] truncate font-mono text-[10px]">{r.page}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.sessions)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{num(r.users)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{color:r.bounceRate>70?'#ef4444':r.bounceRate>50?'#f59e0b':'#22c55e'}}>{pct(r.bounceRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{color:r.convRate>=5?'#22c55e':r.convRate>=1?'#f59e0b':'#64748b'}}>{pct(r.convRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-blue-400">{pct(r.engagementRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-violet-400">{num(r.conversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── ECOMMERCE ────────────────────────────────────────────── */}
      {tab==='ecommerce' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          {gaItems.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-slate-500">
              <Package size={32} className="mx-auto mb-3 opacity-30"/>
              <p className="text-sm">No ecommerce item data. Make sure GA4 Enhanced Ecommerce is set up for your store.</p>
            </div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Items — {gaItems.length} products</h2>
                  <button onClick={()=>exportCSV('ga_items.csv',gaItems,[
                    {key:'gaName',label:'Product'},{key:'gaItemId',label:'Item ID'},{key:'gaCategory',label:'Category'},
                    {key:'gaRevenue',label:'GA Revenue'},{key:'gaSold',label:'Sold'},{key:'gaAddToCart',label:'Add to Cart'},
                    {key:'gaCheckouts',label:'Checkouts'},{key:'cartToCheckout',label:'Cart→Checkout%'},{key:'checkoutToPurch',label:'Checkout→Buy%'},
                  ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-800">
                      {['Product','Category','Revenue','Sold','Add to Cart','Checkouts','Cart→Chk%','Chk→Buy%','AOV'].map(h=>(
                        <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {gaItems.slice(0,80).map((r,i)=>(
                        <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                          <td className="px-3 py-2.5 text-slate-200 max-w-[200px] truncate font-medium">{r.gaName}</td>
                          <td className="px-3 py-2.5 text-slate-500">{r.gaCategory||'—'}</td>
                          <td className="px-3 py-2.5 tabular-nums text-emerald-400 font-semibold">{cur(r.gaRevenue)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.gaSold)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-blue-400">{num(r.gaAddToCart)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-violet-400">{num(r.gaCheckouts)}</td>
                          <td className="px-3 py-2.5 tabular-nums" style={{color:r.cartToCheckout>=50?'#22c55e':r.cartToCheckout>=30?'#f59e0b':'#ef4444'}}>{pct(r.cartToCheckout)}</td>
                          <td className="px-3 py-2.5 tabular-nums" style={{color:r.checkoutToPurch>=70?'#22c55e':r.checkoutToPurch>=50?'#f59e0b':'#ef4444'}}>{pct(r.checkoutToPurch)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-400">{cur(r.aov)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Top 15 items chart */}
              <Card title="Top 15 Items — Revenue">
                <ResponsiveContainer width="100%" height={Math.max(240, Math.min(gaItems.length,15)*28)}>
                  <BarChart data={gaItems.slice(0,15)} layout="vertical" margin={{right:60}}>
                    <XAxis type="number" tick={{fill:'#64748b',fontSize:10}} tickFormatter={v=>'₹'+(v/1000).toFixed(0)+'k'} axisLine={false} tickLine={false}/>
                    <YAxis type="category" dataKey="gaName" width={160} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip content={<CT/>}/>
                    <Bar dataKey="gaRevenue" radius={[0,4,4,0]} name="Revenue">
                      {gaItems.slice(0,15).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </>
          )}
        </motion.div>
      )}

      {/* ── AUDIENCE ─────────────────────────────────────────────── */}
      {tab==='audience' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          {/* Device breakdown */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {devices.length > 0 && (
              <Card title="Device Breakdown">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={devices.filter((d,i,arr)=>arr.findIndex(x=>x.device===d.device)===i).map(d=>({...d,label:d.device})).slice(0,6)}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="4 4"/>
                    <XAxis dataKey="label" tick={{fill:'#64748b',fontSize:10}}/>
                    <YAxis tick={{fill:'#64748b',fontSize:10}}/>
                    <Tooltip content={<CT/>}/>
                    <Legend wrapperStyle={{fontSize:11}}/>
                    <Bar dataKey="sessions" fill="#3b82f6" name="Sessions" radius={[2,2,0,0]}/>
                    <Bar dataKey="conversions" fill="#22c55e" name="Conversions" radius={[2,2,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
            {events.length > 0 && (
              <Card title="Top Events">
                <div className="space-y-2">
                  {events.slice(0,10).map((e,i)=>(
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="text-slate-300 flex-1 truncate font-mono">{e.event}</span>
                      <span className="tabular-nums text-slate-400">{num(e.count)}</span>
                      <span className="tabular-nums text-violet-400">{num(e.conversions)} conv</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </motion.div>
      )}

      {/* ── GEO ──────────────────────────────────────────────────── */}
      {tab==='geo' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* By region */}
            {geo.byRegion.length > 0 && (
              <Card title="Top Regions" action={
                <button onClick={()=>exportCSV('ga_geo_region.csv',geo.byRegion,[
                  {key:'label',label:'Region'},{key:'sessions',label:'Sessions'},{key:'users',label:'Users'},
                  {key:'conversions',label:'Conversions'},{key:'revenue',label:'Revenue'},{key:'convRate',label:'Conv%'},{key:'share',label:'Share%'},
                ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
              }>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={geo.byRegion.slice(0,15)} layout="vertical" margin={{right:60}}>
                    <XAxis type="number" tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis type="category" dataKey="label" width={120} tick={{fill:'#94a3b8',fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip content={<CT/>}/>
                    <Bar dataKey="sessions" radius={[0,4,4,0]} name="Sessions">
                      {geo.byRegion.slice(0,15).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
            {/* By city */}
            {geo.byCity.length > 0 && (
              <Card title="Top Cities">
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {geo.byCity.slice(0,30).map((c,i)=>(
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="w-4 text-slate-600 text-[10px]">{i+1}</span>
                      <span className="text-slate-300 flex-1 truncate">{c.label}</span>
                      <span className="tabular-nums text-slate-400">{num(c.sessions)}</span>
                      <span className="tabular-nums text-emerald-400">{cur(c.revenue)}</span>
                      <span className="tabular-nums text-slate-600">{pct(c.convRate)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </motion.div>
      )}

      {/* ── CROSS-REFERENCE ──────────────────────────────────────── */}
      {tab==='crossref' && (
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="space-y-5">
          {!crossRef ? (
            <p className="text-slate-500 text-sm">Load GA data + Shopify orders first for cross-reference.</p>
          ) : (
            <>
              {/* Blended channel view */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white">GA Sessions × Shopify Revenue — Blended</h2>
                    <p className="text-xs text-slate-500 mt-0.5">GA sessions = traffic volume · Shopify revenue = actual sales from that channel via UTM</p>
                  </div>
                  <button onClick={()=>exportCSV('crossref_channels.csv',crossRef.blended,[
                    {key:'sourceMedium',label:'Source/Medium'},{key:'sessions',label:'GA Sessions'},{key:'conversions',label:'GA Conversions'},
                    {key:'revenue',label:'GA Revenue'},{key:'shopOrders',label:'Shopify Orders'},{key:'shopRevenue',label:'Shopify Revenue'},
                    {key:'convRate',label:'Conv%'},{key:'bounceRate',label:'Bounce%'},
                  ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-800">
                      {['Source/Medium','GA Sessions','GA Conv','GA Revenue','Shop Orders','Shop Revenue','Conv%','Bounce%'].map(h=>(
                        <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {crossRef.blended.slice(0,40).map((r,i)=>(
                        <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                          <td className="px-3 py-2.5 text-slate-200 font-medium">{r.sourceMedium}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.sessions)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-violet-400">{num(r.conversions)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-blue-400">{cur(r.revenue)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.shopOrders)}</td>
                          <td className="px-3 py-2.5 tabular-nums text-emerald-400 font-semibold">{cur(r.shopRevenue)}</td>
                          <td className="px-3 py-2.5 tabular-nums" style={{color:r.convRate>=5?'#22c55e':r.convRate>=2?'#f59e0b':'#64748b'}}>{pct(r.convRate)}</td>
                          <td className="px-3 py-2.5 tabular-nums" style={{color:r.bounceRate>70?'#ef4444':r.bounceRate>50?'#f59e0b':'#22c55e'}}>{pct(r.bounceRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SKU cross-ref */}
              {skuCrossRef.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-white">GA Items × Shopify SKUs — Revenue Reconciliation</h2>
                      <p className="text-xs text-slate-500 mt-0.5">GA item revenue vs Shopify order revenue for the same product</p>
                    </div>
                    <button onClick={()=>exportCSV('sku_crossref.csv',skuCrossRef,[
                      {key:'gaName',label:'GA Product'},{key:'shopSku',label:'Shop SKU'},{key:'gaRevenue',label:'GA Revenue'},
                      {key:'shopRevenue',label:'Shop Revenue'},{key:'gaSold',label:'GA Sold'},{key:'shopUnits',label:'Shop Units'},
                      {key:'gaAddToCart',label:'Add to Cart'},{key:'gaCheckouts',label:'Checkouts'},{key:'stock',label:'Stock'},
                    ])} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-slate-300 transition-all">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Export
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-800">
                        {['GA Product','Shop SKU','Category','GA Rev','Shop Rev','GA Sold','Shop Units','Cart','Checkout','Stock'].map(h=>(
                          <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {skuCrossRef.slice(0,60).map((r,i)=>(
                          <tr key={i} className={`border-t border-gray-800/40 ${i%2===0?'bg-gray-950/30':''}`}>
                            <td className="px-3 py-2.5 text-slate-200 max-w-[160px] truncate font-medium">{r.gaName}</td>
                            <td className="px-3 py-2.5 text-slate-400 font-mono">{r.shopSku}</td>
                            <td className="px-3 py-2.5 text-slate-500">{r.gaCategory||'—'}</td>
                            <td className="px-3 py-2.5 tabular-nums text-blue-400">{cur(r.gaRevenue)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-emerald-400">{cur(r.shopRevenue)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.gaSold)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-300">{num(r.shopUnits)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-violet-400">{num(r.gaAddToCart)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-400">{num(r.gaCheckouts)}</td>
                            <td className="px-3 py-2.5 tabular-nums">{r.stock===null?<span className="text-slate-600">—</span>:r.stock<=0?<span className="text-red-400 font-bold">OUT</span>:<span className={r.stock<20?'text-amber-400':'text-emerald-400'}>{r.stock}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
