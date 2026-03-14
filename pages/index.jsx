import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Head from "next/head";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

const uid = () => Math.random().toString(36).slice(2, 9);
const f$ = (n) => { if (n == null || isNaN(n)) return "$0"; return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString(); };
const f$k = (n) => { if (n == null || isNaN(n)) return "$0"; return (n < 0 ? "-" : "") + "$" + Math.round(Math.abs(n) / 1000) + "k"; };
const fpct = (n) => (+(n || 0) * 100).toFixed(1) + "%";

function addMonths(base, n) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(1);
  return d;
}
function yrsFrom(startStr, toDate) {
  if (!startStr) return 0;
  return Math.max(0, (toDate - new Date(startStr + "T00:00:00Z")) / 31557600000);
}
function personActiveOn(p, d) {
  if (!p || !p.active || !p.startDate) return false;
  if (d < new Date(p.startDate + "T00:00:00Z")) return false;
  if (p.endDate && d > new Date(p.endDate + "T00:00:00Z")) return false;
  return true;
}
function moLabel(d) { return d.toLocaleDateString("en-US", { year: "2-digit", month: "short", timeZone: "UTC" }); }
function moToDate(dateStr) { if (!dateStr) return null; return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24 * 30.4)); }

const FC_START = "2025-04-01";
const FC_MONTHS = 36;
const GRANT_COLORS = ["#185FA5","#0F6E56","#854F0B","#3B6D11","#534AB7","#993C1D","#5F5E5A","#712B13"];
const ROLES = ["PhD Student","MSc Student","Postdoc","Research Staff","Undergraduate","Prospective Student"];
const CAT_SUGGESTIONS = ["Sequencing-NGS","Sequencing-LongRead","Sequencing-Sanger","Animals-PerDiem","Animals-Procedures","Animals-Genotyping","Consumables-MolBio","Consumables-CellCulture","DNA-Synthesis","Computing-Cloud","Services-Core","Services-Maintenance","Travel","General"];
const REC_STYLES = {
  critical:   { bg:"bg-red-50",    border:"border-red-300",    badge:"bg-red-100 text-red-800",       label:"Critical" },
  high:       { bg:"bg-orange-50", border:"border-orange-300", badge:"bg-orange-100 text-orange-800", label:"Urgent" },
  medium:     { bg:"bg-amber-50",  border:"border-amber-200",  badge:"bg-amber-100 text-amber-800",   label:"Review" },
  fellowship: { bg:"bg-green-50",  border:"border-green-300",  badge:"bg-green-100 text-green-800",   label:"Fellowship" },
  ok:         { bg:"bg-blue-50",   border:"border-blue-200",   badge:"bg-blue-100 text-blue-800",     label:"On track" },
};

const EMPTY_SETTINGS = { salaryInc: 0.035, stipendInc: 0.03, benefitsRate: 0.22 };
const BLANK = { settings: { ...EMPTY_SETTINGS }, grants: [], inflows: [], people: [], research: [] };

function safe(d) {
  if (!d || typeof d !== "object") return { settings: { ...EMPTY_SETTINGS }, grants: [], inflows: [], people: [], research: [] };
  return {
    settings: (d.settings && typeof d.settings === "object") ? d.settings : { ...EMPTY_SETTINGS },
    grants:   Array.isArray(d.grants)   ? d.grants   : [],
    inflows:  Array.isArray(d.inflows)  ? d.inflows  : [],
    people:   Array.isArray(d.people)   ? d.people   : [],
    research: Array.isArray(d.research) ? d.research : [],
  };
}

function buildForecast(rawData) {
  const data = safe(rawData);
  const { grants, people, research, inflows, settings } = data;
  const ag = grants.filter((g) => g && g.active);
  if (!ag.length) return [];
  const bals = {};
  ag.forEach((g) => { bals[g.id] = +g.totalAward || 0; });
  return Array.from({ length: FC_MONTHS }, (_, mi) => {
    const md = addMonths(FC_START, mi);
    const [my, mm] = [md.getUTCFullYear(), md.getUTCMonth()];
    const row = { label: moLabel(md), tP: 0, tR: 0, tIDC: 0, tI: 0 };
    ag.forEach((g, gi) => {
      let pers = 0, res = 0, inf = 0;
      people.forEach((p) => {
        if (!personActiveOn(p, md)) return;
        const allocs = Array.isArray(p.allocations) ? p.allocations : [];
        const frac = +(allocs.find((a) => a && a.grantId === g.id) || {}).fraction || 0;
        if (!frac) return;
        const isStudent = ["PhD Student","MSc Student"].includes(p.role);
        const inc = isStudent ? (+settings.stipendInc || 0.03) : (+settings.salaryInc || 0.035);
        const scaled = (+p.baseMonthly || 0) * Math.pow(1 + inc, yrsFrom(p.startDate, md));
        const benMult = p.benefits ? 1 + (+settings.benefitsRate || 0.22) : 1;
        pers += scaled * benMult * frac;
      });
      research.filter((r) => r && r.grantId === g.id).forEach((r) => {
        const yr = Math.max(0, yrsFrom(g.startDate || FC_START, md));
        res += (+r.monthlyBase || 0) * Math.pow(1 + (+r.escalation || 0), yr);
      });
      const idcRate = g.idcExempt ? 0 : (+g.idcRate || 0);
      const idc = (pers + (g.type === "Capital" ? 0 : res)) * idcRate;
      inflows.filter((i) => i && i.grantId === g.id && i.date).forEach((i) => {
        const d = new Date(i.date + "T00:00:00Z");
        if (d.getUTCFullYear() === my && d.getUTCMonth() === mm) inf += +i.amount || 0;
      });
      bals[g.id] = (bals[g.id] || 0) + inf - pers - res - idc;
      row["b"+gi] = Math.round(bals[g.id]);
      row["sp"+gi] = Math.round(pers + res + idc);
      row["idc"+gi] = Math.round(idc);
      row.tP += pers; row.tR += res; row.tIDC += idc; row.tI += inf;
    });
    row.tSpend = Math.round(row.tP + row.tR + row.tIDC);
    row.tI = Math.round(row.tI);
    row.net = Math.round(row.tI - row.tSpend);
    row.portBal = Math.round(ag.reduce((s, _, gi) => s + (row["b"+gi] || 0), 0));
    return row;
  });
}

function getStudentRec(p) {
  if (!p || !p.startDate) return null;
  const yr = yrsFrom(p.startDate, new Date());
  if (p.role === "PhD Student") {
    if (yr >= 5) return { level:"critical",   text:"Past 5-year mark. Immediate graduation plan + funding review required." };
    if (yr >= 4) return { level:"high",       text:"Year 4+: Set firm graduation date. Fund conditionally on milestones." };
    if (yr >= 3) return { level:"medium",     text:"Year 3: Confirm thesis scope. Apply NSERC CGS-D this cycle if not held." };
    if (yr >= 2) return { level:"fellowship", text:"Year 2: Prime fellowship window. Apply NSERC CGS-D / Vanier / CIHR now." };
    return              { level:"ok",         text:"Year 1: Focus on qualifying exams. Prepare CGS-M application." };
  }
  if (p.role === "MSc Student") {
    if (yr >= 2) return { level:"high", text:"Year 2+: Initiate thesis completion. Confirm submission date." };
    return              { level:"ok",   text:"Apply NSERC CGS-M if not held." };
  }
  if (p.role === "Postdoc") {
    if (yr >= 3) return { level:"medium", text:"Senior postdoc: Discuss faculty track. Apply Banting Fellowship." };
    return              { level:"ok",     text:"Active postdoc — on track." };
  }
  return null;
}

function Badge({ children, color = "blue" }) {
  const m = { blue:"bg-blue-50 text-blue-800", green:"bg-green-50 text-green-800", amber:"bg-amber-50 text-amber-800", red:"bg-red-50 text-red-700", gray:"bg-gray-100 text-gray-600", purple:"bg-purple-50 text-purple-800" };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${m[color]||m.blue}`}>{children}</span>;
}
function Metric({ label, value, sub, warn=false }) {
  return (
    <div className={`rounded-lg p-4 border flex-1 min-w-[130px] ${warn?"bg-red-50 border-red-200":"bg-white border-gray-200"}`}>
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-medium ${warn?"text-red-700":"text-gray-800"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
function SH({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base font-medium text-gray-700">{title}</h2>
      {action}
    </div>
  );
}
function Btn({ onClick, children, variant="primary", sm=false, disabled=false }) {
  const base = `font-medium rounded-md cursor-pointer transition-colors ${sm?"px-3 py-1 text-xs":"px-4 py-2 text-sm"} ${disabled?"opacity-50 cursor-not-allowed":""}`;
  const s = { primary:"bg-blue-700 text-white hover:bg-blue-800", secondary:"bg-gray-100 text-gray-700 hover:bg-gray-200", danger:"text-red-600 hover:bg-red-50", ghost:"text-blue-600 hover:bg-blue-50", green:"bg-green-700 text-white hover:bg-green-800" };
  return <button className={`${base} ${s[variant]||s.primary}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function FF({ label, children }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label>{children}</div>;
}
function Inp({ className="", ...p }) {
  return <input className={`w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 ${className}`} {...p}/>;
}
function Sel({ children, ...p }) {
  return <select className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white" {...p}>{children}</select>;
}
function TT({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs">
      <div className="font-medium text-gray-700 mb-2">{label}</div>
      {payload.map((p, i) => <div key={i} style={{color:p.color}} className="mb-0.5">{p.name}: {f$(p.value)}</div>)}
    </div>
  );
}
function SyncBanner({ syncState, meta, onSync, onSave, userName }) {
  const dotColor = syncState==="saved"?"bg-green-400":syncState==="saving"?"bg-yellow-400 animate-pulse":syncState==="unsaved"?"bg-orange-400":"bg-red-400";
  const msg = syncState==="saved" && meta ? `Saved by ${meta.savedBy} at ${new Date(meta.savedAt).toLocaleTimeString()}` : syncState==="saving" ? "Saving..." : syncState==="unsaved" ? "Unsaved changes" : "Save failed — check connection";
  return (
    <div className="bg-blue-950 text-blue-200 px-5 py-2 flex items-center justify-between gap-4 text-xs flex-wrap">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`}/>
        <span>{msg}</span>
      </div>
      <div className="flex gap-2">
        <Btn onClick={onSync} variant="secondary" sm>Refresh</Btn>
        <Btn onClick={onSave} variant="green" sm disabled={syncState==="saving"}>Save now</Btn>
      </div>
    </div>
  );
}

function PerGrantSummary({ g, gi, fc }) {
  const last = fc[fc.length - 1] || {};
  const bal = last["b"+gi] || 0;
  const avg = Math.round(fc.reduce((s, r) => s + (r["sp"+gi] || 0), 0) / fc.length);
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      {[["Total award", f$(g.totalAward)], ["Avg monthly", f$(avg)], ["Balance (36mo)", f$(bal)]].map(([lbl, val]) => (
        <div key={lbl} className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400 mb-1">{lbl}</div>
          <div className={`text-sm font-medium ${lbl==="Balance (36mo)" && bal<0 ? "text-red-600" : "text-gray-800"}`}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function PerGrantChart({ ag, fc }) {
  const [sel, setSel] = useState("all");
  const selIdx = sel === "all" ? -1 : ag.findIndex((g) => g.id === sel);

  const chartData = fc.map((row) => {
    const r = { label: row.label };
    ag.forEach((g, gi) => {
      if (sel === "all" || sel === g.id) r["b"+gi] = row["b"+gi];
    });
    return r;
  });

  return (
    <>
      <p className="text-xs text-gray-400 mb-3">
        {sel === "all" ? "All active grants — click a name to isolate" : "Click 'All grants' to zoom back out"}
      </p>
      <div className="flex gap-2 flex-wrap mb-3">
        <button onClick={() => setSel("all")}
          className={`px-3 py-1 rounded text-xs font-medium border ${sel==="all"?"bg-blue-700 text-white border-blue-700":"bg-white text-gray-600 border-gray-300"}`}>
          All grants
        </button>
        {ag.map((g, gi) => (
          <button key={g.id} onClick={() => setSel(g.id)}
            className={`px-3 py-1 rounded text-xs font-medium border ${sel===g.id?"text-white":"bg-white text-gray-600 border-gray-300"}`}
            style={sel===g.id ? {background:GRANT_COLORS[gi%GRANT_COLORS.length],borderColor:GRANT_COLORS[gi%GRANT_COLORS.length]} : {}}>
            {g.code}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{top:4,right:8,left:8,bottom:4}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
          <XAxis dataKey="label" tick={{fontSize:10}} interval={5}/>
          <YAxis tickFormatter={f$k} tick={{fontSize:10}} width={52}/>
          <Tooltip content={<TT/>}/>
          <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5}/>
          {sel === "all" && <Legend iconType="line" iconSize={10} wrapperStyle={{fontSize:11}}/>}
          {ag.map((g, gi) => {
            const key = "b"+gi;
            const visible = sel === "all" || sel === g.id;
            if (!visible) return null;
            return (
              <Line key={g.id} type="monotone" dataKey={key} name={g.code}
                stroke={GRANT_COLORS[gi%GRANT_COLORS.length]}
                strokeWidth={sel===g.id ? 2.5 : 1.5} dot={false} connectNulls/>
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      {sel !== "all" && selIdx >= 0 && fc.length > 0 && (
        <PerGrantSummary g={ag[selIdx]} gi={selIdx} fc={fc}/>
      )}
    </>
  );
}

function Dashboard({ data, fc }) {
  const [chartTab, setChartTab] = useState("portfolio");
  const d = safe(data);
  const ag = d.grants.filter((g) => g && g.active);
  const totalAward = ag.reduce((s, g) => s + (+g.totalAward || 0), 0);
  const lastBal = fc.length ? fc[fc.length-1].portBal : 0;
  const avgBurn = fc.length ? Math.round(fc.reduce((s, r) => s + r.tSpend, 0) / fc.length) : 0;
  const avgIDC = fc.length ? Math.round(fc.reduce((s, r) => s + r.tIDC, 0) / fc.length) : 0;
  const bankruptIdx = fc.findIndex((r) => r.portBal < 0);
  const moToZero = bankruptIdx === -1 ? `>${FC_MONTHS}mo` : `${bankruptIdx}mo`;
  const tabs = [["portfolio","Portfolio balance"],["pergrant","Per-grant"],["burn","Monthly burn"],["idc","IDC breakdown"],["cashflow","Cash flow"]];
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Metric label="Total portfolio" value={f$(totalAward)} sub={`${ag.length} active grant${ag.length!==1?"s":""}`}/>
        <Metric label="Avg monthly burn" value={f$(avgBurn)} sub="personnel + research + IDC"/>
        <Metric label="Avg monthly IDC" value={f$(avgIDC)} sub="overhead charged"/>
        <Metric label="Balance at 36mo" value={f$(lastBal)} sub="end of forecast" warn={lastBal<0}/>
        <Metric label="Months to zero" value={moToZero} sub="combined portfolio" warn={bankruptIdx>0&&bankruptIdx<18}/>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex gap-2 flex-wrap mb-4">
          {tabs.map(([k,l]) => (
            <button key={k} onClick={() => setChartTab(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${chartTab===k?"bg-blue-700 text-white":"bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {l}
            </button>
          ))}
        </div>
        {chartTab==="portfolio" && <>
          <p className="text-xs text-gray-400 mb-3">Combined portfolio balance — red line = zero</p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={fc} margin={{top:4,right:8,left:8,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{fontSize:10}} interval={5}/>
              <YAxis tickFormatter={f$k} tick={{fontSize:10}} width={52}/>
              <Tooltip content={<TT/>}/>
              <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5}/>
              <Area type="monotone" dataKey="portBal" name="Portfolio balance" stroke="#185FA5" fill="#E6F1FB" strokeWidth={2} dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </>}
        {chartTab==="pergrant" && <PerGrantChart ag={ag} fc={fc}/>}
        {chartTab==="burn" && <>
          <p className="text-xs text-gray-400 mb-3">Monthly spend stacked by grant, inflows in teal</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{top:4,right:8,left:8,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{fontSize:10}} interval={5}/>
              <YAxis tickFormatter={f$k} tick={{fontSize:10}} width={52}/>
              <Tooltip content={<TT/>}/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
              {ag.map((g,gi) => <Bar key={g.id} dataKey={"sp"+gi} name={g.code} stackId="spend" fill={GRANT_COLORS[gi%GRANT_COLORS.length]}/>)}
              <Bar dataKey="tI" name="Inflows" fill="#5DCAA5"/>
            </BarChart>
          </ResponsiveContainer>
        </>}
        {chartTab==="idc" && <>
          <p className="text-xs text-gray-400 mb-3">Monthly IDC overhead per grant</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{top:4,right:8,left:8,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{fontSize:10}} interval={5}/>
              <YAxis tickFormatter={f$k} tick={{fontSize:10}} width={52}/>
              <Tooltip content={<TT/>}/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
              {ag.map((g,gi) => <Bar key={g.id} dataKey={"idc"+gi} name={`${g.code} IDC`} stackId="idc" fill={GRANT_COLORS[gi%GRANT_COLORS.length]} opacity={0.7}/>)}
            </BarChart>
          </ResponsiveContainer>
        </>}
        {chartTab==="cashflow" && <>
          <p className="text-xs text-gray-400 mb-3">Net monthly cash flow — green positive, red negative</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{top:4,right:8,left:8,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="label" tick={{fontSize:10}} interval={5}/>
              <YAxis tickFormatter={f$k} tick={{fontSize:10}} width={52}/>
              <Tooltip content={<TT/>}/>
              <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3"/>
              <Bar dataKey="net" name="Net monthly"
                shape={(props) => { const {x,y,width,height,value}=props; return <rect x={x} y={value>=0?y:y+height} width={width} height={Math.abs(height)} fill={value>=0?"#5DCAA5":"#F09595"} rx={1}/>; }}/>
            </BarChart>
          </ResponsiveContainer>
        </>}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Grant status"/>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{tableLayout:"fixed",minWidth:680}}>
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
              {["Grant","Funder","Type","Total award","IDC rate","36mo balance","Mo left","Status"].map(h => <th key={h} className="py-2 pr-2 text-left font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {d.grants.map((g, gi) => {
                const activeIdx = ag.indexOf(g);
                const bal = activeIdx >= 0 && fc.length ? fc[fc.length-1]["b"+activeIdx] : null;
                const mo = moToDate(g.endDate);
                const status = !g.active?"inactive":mo!==null&&mo<=3?"expiring":bal!==null&&bal<0?"depleted":bal!==null&&bal/(+g.totalAward||1)<0.1?"low":"active";
                const stMap = {active:"bg-green-50 text-green-800",inactive:"bg-gray-100 text-gray-500",expiring:"bg-red-50 text-red-700",depleted:"bg-red-100 text-red-800",low:"bg-amber-50 text-amber-700"};
                return (
                  <tr key={g.id} className={`border-b border-gray-50 ${!g.active?"opacity-50":""}`}>
                    <td className="py-2 pr-2 font-medium text-blue-700">{g.code}</td>
                    <td className="py-2 pr-2 text-gray-600">{g.funder}</td>
                    <td className="py-2 pr-2"><Badge color={g.type==="Capital"?"amber":"blue"}>{g.type}</Badge></td>
                    <td className="py-2 pr-2 text-right">{f$(g.totalAward)}</td>
                    <td className="py-2 pr-2 text-center">{g.idcExempt?<Badge color="gray">Exempt</Badge>:<Badge color="purple">{fpct(g.idcRate)}</Badge>}</td>
                    <td className={`py-2 pr-2 text-right font-medium ${bal!==null&&bal<0?"text-red-600":bal!==null&&bal<50000?"text-amber-600":"text-green-700"}`}>{bal!==null?f$(bal):"—"}</td>
                    <td className={`py-2 pr-2 text-center text-xs ${mo!==null&&mo<=12?"text-red-600 font-medium":"text-gray-500"}`}>{mo!==null?`${mo}mo`:"—"}</td>
                    <td className="py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${stMap[status]}`}>{status}</span></td>
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

function Grants({ data, setData }) {
  const d = safe(data);
  const [form, setForm] = useState(null);
  const [infForm, setInfForm] = useState(null);
  const blank = { code:"",funder:"",fullName:"",type:"Operating",startDate:"",endDate:"",totalAward:"",idcRate:0.25,idcExempt:false,notes:"" };

  const saveGrant = () => {
    if (!form.code||!form.startDate||!form.totalAward) return alert("Grant code, start date and total award required.");
    if (form.id) setData((prev) => { const s=safe(prev); return {...s,grants:s.grants.map(g=>g.id===form.id?form:g)}; });
    else setData((prev) => { const s=safe(prev); return {...s,grants:[...s.grants,{...form,id:uid(),active:true}]}; });
    setForm(null);
  };
  const saveInflow = () => {
    if (!infForm.grantId||!infForm.date||!infForm.amount) return alert("Grant, date and amount required.");
    if (infForm.id) setData((prev) => { const s=safe(prev); return {...s,inflows:s.inflows.map(i=>i.id===infForm.id?infForm:i)}; });
    else setData((prev) => { const s=safe(prev); return {...s,inflows:[...s.inflows,{...infForm,id:uid()}]}; });
    setInfForm(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        <strong>IDC (Indirect Cost / Overhead):</strong> Rate your institution charges on eligible direct costs. Capital grants are often exempt. Operating grants typically 20–60%.
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Grants registry" action={<Btn onClick={()=>setForm({...blank})}>+ Add grant</Btn>}/>
        {form && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-blue-800 mb-3 text-sm">{form.id?"Edit grant":"New grant"}</div>
            <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))"}}>
              <FF label="Grant ID / code *"><Inp value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value}))} placeholder="e.g. CIHR-2025"/></FF>
              <FF label="Funder *"><Inp value={form.funder} onChange={e=>setForm(f=>({...f,funder:e.target.value}))}/></FF>
              <FF label="Full name"><Inp value={form.fullName} onChange={e=>setForm(f=>({...f,fullName:e.target.value}))}/></FF>
              <FF label="Type"><Sel value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{["Operating","Capital","Industry","Fellowship"].map(t=><option key={t}>{t}</option>)}</Sel></FF>
              <FF label="Start date *"><Inp type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/></FF>
              <FF label="End date *"><Inp type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))}/></FF>
              <FF label="Total award ($) *"><Inp type="number" value={form.totalAward} onChange={e=>setForm(f=>({...f,totalAward:e.target.value}))}/></FF>
              <FF label="IDC rate (0.25 = 25%)"><Inp type="number" step="0.01" min="0" max="1" value={form.idcRate} onChange={e=>setForm(f=>({...f,idcRate:+e.target.value}))} disabled={form.idcExempt} className={form.idcExempt?"bg-gray-100":""}/></FF>
              <FF label="IDC exempt?">
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input type="checkbox" checked={form.idcExempt} onChange={e=>setForm(f=>({...f,idcExempt:e.target.checked}))} className="w-4 h-4 accent-blue-600"/>
                  <span className="text-sm text-gray-700">Exempt from IDC</span>
                </label>
              </FF>
              <FF label="Notes"><Inp value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></FF>
            </div>
            <div className="flex gap-2"><Btn onClick={saveGrant}>Save</Btn><Btn onClick={()=>setForm(null)} variant="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
              {["Active","Code","Funder","Type","Dates","Award","IDC","Notes",""].map(h=><th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {d.grants.map(g=>(
                <tr key={g.id} className={`border-b border-gray-50 ${!g.active?"opacity-50":""}`}>
                  <td className="py-2 pr-3">
                    <button onClick={()=>setData(prev=>{const s=safe(prev);return{...s,grants:s.grants.map(x=>x.id===g.id?{...x,active:!x.active}:x);})})}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${g.active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-500"}`}>
                      {g.active?"YES":"NO"}
                    </button>
                  </td>
                  <td className="py-2 pr-3 font-medium text-blue-700">{g.code}</td>
                  <td className="py-2 pr-3 text-gray-600">{g.funder}</td>
                  <td className="py-2 pr-3"><Badge color={g.type==="Capital"?"amber":"blue"}>{g.type}</Badge></td>
                  <td className="py-2 pr-3 text-xs text-gray-500">{g.startDate?.slice(0,7)} – {g.endDate?.slice(0,7)}</td>
                  <td className="py-2 pr-3 font-medium">{f$(g.totalAward)}</td>
                  <td className="py-2 pr-3 text-center">{g.idcExempt?<Badge color="gray">Exempt</Badge>:<Badge color="purple">{fpct(g.idcRate)}</Badge>}</td>
                  <td className="py-2 pr-3 text-xs text-gray-400 max-w-[120px] truncate">{g.notes}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Btn onClick={()=>setForm({...g})} variant="ghost" sm>Edit</Btn>
                    <Btn onClick={()=>{if(window.confirm("Delete this grant and all linked data?"))setData(prev=>{const s=safe(prev);return{...s,grants:s.grants.filter(x=>x.id!==g.id),inflows:s.inflows.filter(i=>i.grantId!==g.id),research:s.research.filter(r=>r.grantId!==g.id)};});}} variant="danger" sm>Del</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Planned inflows & installments" action={<Btn onClick={()=>setInfForm({grantId:"",date:"",amount:"",notes:""})}>+ Add inflow</Btn>}/>
        {infForm && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{infForm.id?"Edit":"New inflow"}</div>
            <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))"}}>
              <FF label="Grant *"><Sel value={infForm.grantId} onChange={e=>setInfForm(f=>({...f,grantId:e.target.value}))}><option value="">Select...</option>{d.grants.map(g=><option key={g.id} value={g.id}>{g.code}</option>)}</Sel></FF>
              <FF label="Date *"><Inp type="date" value={infForm.date} onChange={e=>setInfForm(f=>({...f,date:e.target.value}))}/></FF>
              <FF label="Amount ($) *"><Inp type="number" value={infForm.amount} onChange={e=>setInfForm(f=>({...f,amount:e.target.value}))}/></FF>
              <FF label="Notes"><Inp value={infForm.notes||""} onChange={e=>setInfForm(f=>({...f,notes:e.target.value}))}/></FF>
            </div>
            <div className="flex gap-2"><Btn onClick={saveInflow}>Save</Btn><Btn onClick={()=>setInfForm(null)} variant="secondary">Cancel</Btn></div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Grant","Date","Amount","Notes",""].map(h=><th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {[...d.inflows].sort((a,b)=>a.date>b.date?1:-1).map(i=>{
              const g=d.grants.find(g=>g.id===i.grantId);
              return (
                <tr key={i.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><Badge color="blue">{g?.code||"?"}</Badge></td>
                  <td className="py-2 pr-3 text-gray-600">{i.date}</td>
                  <td className="py-2 pr-3 font-medium text-green-700">{f$(i.amount)}</td>
                  <td className="py-2 pr-3 text-xs text-gray-400">{i.notes}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Btn onClick={()=>setInfForm({...i})} variant="ghost" sm>Edit</Btn>
                    <Btn onClick={()=>setData(prev=>{const s=safe(prev);return{...s,inflows:s.inflows.filter(x=>x.id!==i.id)};})} variant="danger" sm>Del</Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function People({ data, setData }) {
  const d = safe(data);
  const [form, setForm] = useState(null);
  const blank = { name:"",role:"PhD Student",startDate:"",endDate:"",baseMonthly:"",benefits:false,allocations:[{grantId:"",fraction:""}],fellowship:"",notes:"" };

  const save = () => {
    if (!form.name||!form.startDate||!form.baseMonthly) return alert("Name, start date and monthly base required.");
    const total = (form.allocations||[]).reduce((s,a)=>s+(+a.fraction||0),0);
    if (total > 1.005) return alert(`Allocations sum to ${(total*100).toFixed(0)}% — must not exceed 100%.`);
    if (form.id) setData((prev)=>{ const s=safe(prev); return {...s,people:s.people.map(p=>p.id===form.id?form:p)}; });
    else setData((prev)=>{ const s=safe(prev); return {...s,people:[...s.people,{...form,id:uid(),active:true}]}; });
    setForm(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Lab personnel & allocations" action={<Btn onClick={()=>setForm({...blank})}>+ Add person</Btn>}/>
        <p className="text-xs text-gray-400 mb-3">Salary/stipend escalates annually from start date. Enter the full monthly amount (including any tuition component) in Base monthly.</p>
        {form && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{form.id?"Edit person":"New person"}</div>
            <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))"}}>
              <FF label="Name *"><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></FF>
              <FF label="Role"><Sel value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>{ROLES.map(r=><option key={r}>{r}</option>)}</Sel></FF>
              <FF label="Program / hire start *"><Inp type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/></FF>
              <FF label="Expected end / graduation"><Inp type="date" value={form.endDate||""} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))}/></FF>
              <FF label="Base monthly ($) *"><Inp type="number" value={form.baseMonthly} onChange={e=>setForm(f=>({...f,baseMonthly:e.target.value}))}/></FF>
              <FF label="Benefits (staff/postdoc)"><Sel value={form.benefits?"YES":"NO"} onChange={e=>setForm(f=>({...f,benefits:e.target.value==="YES"}))}><option>YES</option><option>NO</option></Sel></FF>
              <FF label="Fellowship status"><Inp value={form.fellowship||""} onChange={e=>setForm(f=>({...f,fellowship:e.target.value}))} placeholder="None / Applying CGS-D / Held NSERC"/></FF>
              <FF label="Notes"><Inp value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></FF>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-2">Grant allocations (fractions must sum to 1.0)</div>
              {(form.allocations||[]).map((a,i)=>(
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <div className="flex-[2]">
                    <Sel value={a.grantId} onChange={e=>{const al=[...(form.allocations||[])];al[i]={...al[i],grantId:e.target.value};setForm(f=>({...f,allocations:al}));}}>
                      <option value="">Select grant...</option>
                      {d.grants.map(g=><option key={g.id} value={g.id}>{g.code} — {g.fullName}</option>)}
                    </Sel>
                  </div>
                  <div className="flex-1"><Inp type="number" min="0" max="1" step="0.1" placeholder="e.g. 0.5" value={a.fraction} onChange={e=>{const al=[...(form.allocations||[])];al[i]={...al[i],fraction:e.target.value};setForm(f=>({...f,allocations:al}));}}/></div>
                  <button onClick={()=>setForm(f=>({...f,allocations:(f.allocations||[]).filter((_,j)=>j!==i)}))} className="text-red-400 hover:text-red-600 px-2">x</button>
                </div>
              ))}
              <Btn onClick={()=>setForm(f=>({...f,allocations:[...(f.allocations||[]),{grantId:"",fraction:""}]}))} variant="secondary" sm>+ Add grant slot</Btn>
            </div>
            <div className="flex gap-2"><Btn onClick={save}>Save</Btn><Btn onClick={()=>setForm(null)} variant="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
              {["Name","Role","Yr","Start","Base/mo","Benefits","Allocations","Fellowship",""].map(h=><th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {d.people.map(p=>{
                const yr=yrsFrom(p.startDate,new Date());
                const isS=["PhD Student","MSc Student"].includes(p.role);
                const yrStr=isS?`Yr ${Math.floor(yr)+1}`:p.role==="Postdoc"?`PD${Math.floor(yr)+1}`:"—";
                const late=(p.role==="PhD Student"&&yr>=4)||(p.role==="MSc Student"&&yr>=2);
                return (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3"><Badge color={p.role==="Postdoc"?"blue":p.role==="Research Staff"?"gray":"green"}>{p.role}</Badge></td>
                    <td className={`py-2 pr-3 text-sm font-medium ${late?"text-red-600":"text-gray-600"}`}>{yrStr}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.startDate}</td>
                    <td className="py-2 pr-3 font-medium">{f$(p.baseMonthly)}</td>
                    <td className="py-2 pr-3"><Badge color={p.benefits?"green":"gray"}>{p.benefits?"YES":"NO"}</Badge></td>
                    <td className="py-2 pr-3 text-xs">{(p.allocations||[]).filter(a=>a.grantId).map((a,i)=>{const g=d.grants.find(g=>g.id===a.grantId);return<span key={i} className="mr-1"><Badge color="blue">{g?.code||"?"}</Badge> {(+a.fraction*100).toFixed(0)}%</span>;})}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.fellowship||"—"}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Btn onClick={()=>setForm({...p})} variant="ghost" sm>Edit</Btn>
                      <Btn onClick={()=>setData(prev=>{const s=safe(prev);return{...s,people:s.people.filter(x=>x.id!==p.id)};})} variant="danger" sm>Del</Btn>
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

function Research({ data, setData }) {
  const d = safe(data);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const blank = { grantId:"",category:"",monthlyBase:"",escalation:0,notes:"" };

  const save = () => {
    if (!form.grantId||!form.category||!form.monthlyBase) return alert("Grant, category and monthly base required.");
    if (form.id) setData((prev)=>{ const s=safe(prev); return {...s,research:s.research.map(r=>r.id===form.id?form:r)}; });
    else setData((prev)=>{ const s=safe(prev); return {...s,research:[...s.research,{...form,id:uid()}]}; });
    setForm(null);
  };

  const grantSums = d.grants.filter(g=>g.active).map(g=>({
    ...g,
    total: d.research.filter(r=>r.grantId===g.id).reduce((s,r)=>s+(+r.monthlyBase||0),0),
    count: d.research.filter(r=>r.grantId===g.id).length,
  }));
  const filtered = filter ? d.research.filter(r=>r.category.toLowerCase().includes(filter.toLowerCase())) : d.research;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {grantSums.map(g=>(
          <div key={g.id} className="bg-white border border-gray-200 rounded-lg p-3 flex-1 min-w-[120px]">
            <div className="text-xs text-gray-400 font-medium">{g.code}</div>
            <div className="text-lg font-medium text-gray-800 mt-1">{f$(g.total)}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
            <div className="text-xs text-gray-400">{g.count} items · IDC {g.idcExempt?"exempt":fpct(g.idcRate)}</div>
          </div>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Research cost items" action={<Btn onClick={()=>setForm({...blank})}>+ Add cost item</Btn>}/>
        <p className="text-xs text-gray-400 mb-3">Suggested: {CAT_SUGGESTIONS.slice(0,6).join(" · ")} ...</p>
        {form && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{form.id?"Edit item":"New cost item"}</div>
            <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))"}}>
              <FF label="Grant *"><Sel value={form.grantId} onChange={e=>setForm(f=>({...f,grantId:e.target.value}))}><option value="">Select...</option>{d.grants.map(g=><option key={g.id} value={g.id}>{g.code}</option>)}</Sel></FF>
              <FF label="Category *">
                <input list="cats" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder="e.g. Sequencing-NGS"/>
                <datalist id="cats">{CAT_SUGGESTIONS.map(c=><option key={c} value={c}/>)}</datalist>
              </FF>
              <FF label="Monthly base ($) *"><Inp type="number" value={form.monthlyBase} onChange={e=>setForm(f=>({...f,monthlyBase:e.target.value}))}/></FF>
              <FF label="Escalation (%/yr)"><Inp type="number" step="0.01" min="0" max="1" value={form.escalation} onChange={e=>setForm(f=>({...f,escalation:e.target.value}))} placeholder="0.03 = 3%/yr"/></FF>
              <FF label="Notes"><Inp value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></FF>
            </div>
            <div className="flex gap-2"><Btn onClick={save}>Save</Btn><Btn onClick={()=>setForm(null)} variant="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="mb-3"><Inp value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by category..." className="max-w-xs"/></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Category","Grant","Monthly base","Escalation","Yr 2 est.","Notes",""].map(h=><th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map(r=>{
                const g=d.grants.find(g=>g.id===r.grantId);
                return (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-green-800">{r.category}</td>
                    <td className="py-2 pr-3"><Badge color="blue">{g?.code||"—"}</Badge></td>
                    <td className="py-2 pr-3 font-medium">{f$(r.monthlyBase)}</td>
                    <td className={`py-2 pr-3 text-xs ${+r.escalation>0?"text-amber-700 font-medium":"text-gray-400"}`}>{+r.escalation>0?fpct(r.escalation):"—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{f$((+r.monthlyBase||0)*Math.pow(1+(+r.escalation||0),1))}</td>
                    <td className="py-2 pr-3 text-xs text-gray-400">{r.notes}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Btn onClick={()=>setForm({...r})} variant="ghost" sm>Edit</Btn>
                      <Btn onClick={()=>setData(prev=>{const s=safe(prev);return{...s,research:s.research.filter(x=>x.id!==r.id)};})} variant="danger" sm>Del</Btn>
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

function Students({ data }) {
  const d = safe(data);
  const trainees = d.people.filter(p=>p.active&&["PhD Student","MSc Student","Postdoc"].includes(p.role));
  return (
    <div className="space-y-3">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-700">
        Recommendations auto-generate from role and year in program. Update Fellowship Status in People tab when awards are received.
      </div>
      {trainees.length===0 && <div className="text-center py-12 text-gray-400">No active trainees. Add people in the People tab.</div>}
      {trainees.map(p=>{
        const yr=yrsFrom(p.startDate,new Date());
        const rec=getStudentRec(p);
        const rs=rec?REC_STYLES[rec.level]:null;
        const mo=p.endDate?moToDate(p.endDate):null;
        const grants=(p.allocations||[]).filter(a=>a.grantId).map(a=>{const g=d.grants.find(g=>g.id===a.grantId);return g?`${g.code} (${(+a.fraction*100).toFixed(0)}%)`:null;}).filter(Boolean);
        return (
          <div key={p.id} className={`rounded-lg p-4 border-l-4 border ${rs?`${rs.bg} ${rs.border}`:"bg-white border-gray-200 border-l-gray-300"}`}>
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div>
                <div className="font-medium text-gray-800">{p.name}</div>
                <div className="text-xs text-gray-500 mt-1">{p.role} · Year {Math.floor(yr)+1} · Started {p.startDate}{mo!==null&&<span className={`ml-2 ${mo<12?"text-red-600 font-medium":""}`}> · {mo}mo funding left</span>}</div>
                <div className="text-xs text-gray-400 mt-1">Grants: {grants.join(", ")||"none"} · Fellowship: {p.fellowship||"none"}</div>
              </div>
              {rs&&<span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${rs.badge}`}>{rs.label}</span>}
            </div>
            {rec&&<div className={`mt-3 p-2 rounded text-xs font-medium ${rs.badge}`}>{rec.text}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Settings({ data, setData, userName, setUserName }) {
  const d = safe(data);
  const s = d.settings;
  const up = (k,v) => setData(prev=>{ const sd=safe(prev); return {...sd,settings:{...sd.settings,[k]:v}}; });
  const fileRef = useRef();

  const exportData = () => {
    const blob=new Blob([JSON.stringify(safe(data),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`yachie-lab-gms-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importData = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{ try { const p=JSON.parse(ev.target.result); if(!p.grants||!p.people) throw new Error("Invalid"); setData(safe(p)); alert("Imported."); } catch { alert("Could not read file."); } };
    reader.readAsText(file); e.target.value="";
  };
  const Row = ({label,desc,k,step,min,max,fmt}) => (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 gap-4">
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-xs text-gray-400 mt-0.5">{desc} · Now: <strong className="text-blue-700">{fmt(s[k])}</strong></div>
      </div>
      <input type="number" step={step} min={min} max={max} value={s[k]||0} onChange={e=>up(k,+e.target.value)}
        className="w-28 border border-yellow-300 bg-yellow-50 rounded-md px-3 py-1.5 text-sm text-center font-medium text-blue-800 focus:outline-none"/>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Your name (shown on saves)"/>
        <div className="flex gap-3 items-center">
          <Inp value={userName} onChange={e=>setUserName(e.target.value)} placeholder="e.g. Yachie" className="max-w-xs"/>
          <span className="text-xs text-gray-400">Appears in the sync banner.</span>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Forecast assumptions"/>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">Changes here update all forecasts instantly. Enter full monthly amounts (including any tuition) in each person's Base monthly field.</div>
        <Row label="Salary annual increase — staff & postdoc" desc="Compounded from hire date" k="salaryInc" step="0.001" min="0" max="0.2" fmt={fpct}/>
        <Row label="Stipend annual increase — PhD & MSc" desc="Compounded from program start" k="stipendInc" step="0.001" min="0" max="0.2" fmt={fpct}/>
        <Row label="Benefits rate — staff & postdoc only" desc="CPP, EI, vacation, health as % of salary" k="benefitsRate" step="0.01" min="0" max="0.5" fmt={fpct}/>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <SH title="Export & import data"/>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">Export to back up your data or share with your manager. Import to load a previously exported file.</div>
        <div className="flex gap-3 flex-wrap">
          <Btn onClick={exportData}>Export as JSON</Btn>
          <div><input ref={fileRef} type="file" accept=".json" onChange={importData} style={{display:"none"}}/><Btn onClick={()=>fileRef.current?.click()} variant="secondary">Import JSON</Btn></div>
        </div>
      </div>
      <div className="bg-white border border-red-200 rounded-lg p-4">
        <SH title="Reset"/>
        <Btn onClick={()=>{ if(window.confirm("Clear ALL data?")) setData({...BLANK}); }} variant="danger">Clear everything</Btn>
      </div>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState("loading");
  const [syncMeta, setSyncMeta] = useState(null);
  const [userName, setUserName] = useState("PI");
  const saveTimeout = useRef(null);
  const LAB_SECRET = process.env.NEXT_PUBLIC_LAB_SECRET || "yachie-lab-2025";

  const loadFromServer = useCallback(async () => {
    try {
      const res = await fetch(`/api/data?secret=${LAB_SECRET}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.data) { setData(safe(json.data)); setSyncMeta(json.meta); setSyncState("saved"); }
      else { setSyncState("unsaved"); }
    } catch (e) {
      console.error("Load failed:", e);
      try { const local=localStorage.getItem("yachie-gms-local"); if(local) setData(safe(JSON.parse(local))); } catch {}
      setSyncState("error");
    }
    setLoaded(true);
  }, [LAB_SECRET]);

  useEffect(() => { loadFromServer(); }, [loadFromServer]);

  const saveToServer = useCallback(async () => {
    setSyncState("saving");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lab-secret": LAB_SECRET },
        body: JSON.stringify({ data: safe(data), savedBy: userName }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      setSyncMeta(json.meta); setSyncState("saved");
    } catch (e) {
      console.error("Save failed:", e); setSyncState("error");
    }
  }, [data, userName, LAB_SECRET]);

  useEffect(() => {
    if (!loaded) return;
    setSyncState("unsaved");
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(saveToServer, 2000);
    try { localStorage.setItem("yachie-gms-local", JSON.stringify(safe(data))); } catch {}
  }, [data, loaded]);

  const fc = useMemo(() => buildForecast(data), [data]);

  if (!loaded) return (
    <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-400">
      <div className="text-center"><div className="text-lg font-medium text-gray-600 mb-2">Yachie Lab GMS</div><div>Loading...</div></div>
    </div>
  );

  const d = safe(data);
  const ag = d.grants.filter(g => g && g.active);
  const totalPortfolio = ag.reduce((s, g) => s + (+g.totalAward || 0), 0);
  const TABS = [["dashboard","Dashboard"],["grants","Grants"],["people","People"],["research","Research"],["students","Students"],["settings","Settings"]];

  return (
    <>
      <Head><title>Yachie Lab — Grant Management</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-900 text-white">
          <div className="px-5 pt-4">
            <div className="font-medium text-base">Yachie Lab — Grant Management System</div>
            <div className="text-blue-300 text-xs mt-1">{ag.length} active grant{ag.length!==1?"s":""} · {d.people.filter(p=>p.active).length} lab members · {f$(totalPortfolio)} total portfolio</div>
          </div>
          <div className="flex gap-0.5 px-4 pt-3 overflow-x-auto">
            {TABS.map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)}
                className={`px-4 py-2 text-sm rounded-t-md transition-colors whitespace-nowrap ${tab===k?"bg-gray-50 text-blue-900 font-medium":"text-blue-200 hover:text-white hover:bg-blue-800"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <SyncBanner syncState={syncState} meta={syncMeta} onSync={loadFromServer} onSave={saveToServer} userName={userName}/>
        <div className="p-4">
          {tab==="dashboard" && <Dashboard data={data} fc={fc}/>}
          {tab==="grants"    && <Grants    data={data} setData={setData}/>}
          {tab==="people"    && <People    data={data} setData={setData}/>}
          {tab==="research"  && <Research  data={data} setData={setData}/>}
          {tab==="students"  && <Students  data={data}/>}
          {tab==="settings"  && <Settings  data={data} setData={setData} userName={userName} setUserName={setUserName}/>}
        </div>
      </div>
    </>
  );
}
