import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Head from "next/head";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const uid = () => Math.random().toString(36).slice(2, 9);
const f$ = (n) => { if (n == null || isNaN(n)) return "$0"; return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString(); };
const fk = (n) => { if (n == null || isNaN(n)) return "$0"; return (n < 0 ? "-" : "") + "$" + Math.round(Math.abs(n) / 1000) + "k"; };
const fp = (n) => (+(n || 0) * 100).toFixed(1) + "%";

function addMo(base, n) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(1);
  return d;
}
function yrs(s, t) { if (!s) return 0; return Math.max(0, (t - new Date(s + "T00:00:00Z")) / 31557600000); }
function active(p, d) {
  if (!p || !p.active || !p.startDate) return false;
  if (d < new Date(p.startDate + "T00:00:00Z")) return false;
  if (p.endDate && d > new Date(p.endDate + "T00:00:00Z")) return false;
  return true;
}
function moLbl(d) { return d.toLocaleDateString("en-US", { year: "2-digit", month: "short", timeZone: "UTC" }); }
function moLeft(s) { if (!s) return null; return Math.ceil((new Date(s) - new Date()) / (1000 * 60 * 60 * 24 * 30.4)); }

const FC0 = "2025-04-01";
const FCN = 36;
const GC = ["#185FA5","#0F6E56","#854F0B","#3B6D11","#534AB7","#993C1D","#5F5E5A","#712B13"];
const ROLES = ["PhD Student","MSc Student","Postdoc","Research Staff","Undergraduate","Prospective Student"];
const CATS = ["Sequencing-NGS","Sequencing-LongRead","Sequencing-Sanger","Animals-PerDiem","Animals-Procedures","Animals-Genotyping","Consumables-MolBio","Consumables-CellCulture","DNA-Synthesis","Computing-Cloud","Services-Core","Services-Maintenance","Travel","General"];
const RS = {
  critical:   { bg:"bg-red-50",    border:"border-red-300",    badge:"bg-red-100 text-red-800",       lbl:"Critical" },
  high:       { bg:"bg-orange-50", border:"border-orange-300", badge:"bg-orange-100 text-orange-800", lbl:"Urgent" },
  medium:     { bg:"bg-amber-50",  border:"border-amber-200",  badge:"bg-amber-100 text-amber-800",   lbl:"Review" },
  fellowship: { bg:"bg-green-50",  border:"border-green-300",  badge:"bg-green-100 text-green-800",   lbl:"Fellowship" },
  ok:         { bg:"bg-blue-50",   border:"border-blue-200",   badge:"bg-blue-100 text-blue-800",     lbl:"On track" },
};

const ES = { salaryInc: 0.035, stipendInc: 0.03, benefitsRate: 0.22 };
const BLANK = { settings: { ...ES }, grants: [], inflows: [], people: [], research: [] };

function safe(d) {
  if (!d || typeof d !== "object") return { settings: { ...ES }, grants: [], inflows: [], people: [], research: [] };
  return {
    settings: (d.settings && typeof d.settings === "object") ? d.settings : { ...ES },
    grants:   Array.isArray(d.grants)   ? d.grants   : [],
    inflows:  Array.isArray(d.inflows)  ? d.inflows  : [],
    people:   Array.isArray(d.people)   ? d.people   : [],
    research: Array.isArray(d.research) ? d.research : [],
  };
}

function forecast(raw) {
  const D = safe(raw);
  const ag = D.grants.filter((g) => g && g.active);
  if (!ag.length) return [];
  const bal = {};
  ag.forEach((g) => { bal[g.id] = +g.totalAward || 0; });
  return Array.from({ length: FCN }, (_, mi) => {
    const md = addMo(FC0, mi);
    const [my, mm] = [md.getUTCFullYear(), md.getUTCMonth()];
    const row = { label: moLbl(md), tP: 0, tR: 0, tIDC: 0, tI: 0 };
    ag.forEach((g, gi) => {
      let pers = 0, res = 0, inf = 0;
      D.people.forEach((p) => {
        if (!active(p, md)) return;
        const allocs = Array.isArray(p.allocations) ? p.allocations : [];
        const frac = +(allocs.find((a) => a && a.grantId === g.id) || {}).fraction || 0;
        if (!frac) return;
        const inc = ["PhD Student","MSc Student"].includes(p.role) ? (+D.settings.stipendInc || 0.03) : (+D.settings.salaryInc || 0.035);
        const sc = (+p.baseMonthly || 0) * Math.pow(1 + inc, Math.max(0, yrs(FC0, md)));
        pers += sc * (p.benefits ? 1 + (+D.settings.benefitsRate || 0.22) : 1) * frac;
      });
      D.research.filter((r) => r && r.grantId === g.id).forEach((r) => {
        res += (+r.monthlyBase || 0) * Math.pow(1 + (+r.escalation || 0), Math.max(0, yrs(g.startDate || FC0, md)));
      });
      const idc = (pers + (g.type === "Capital" ? 0 : res)) * (g.idcExempt ? 0 : (+g.idcRate || 0));
      D.inflows.filter((i) => i && i.grantId === g.id && i.date).forEach((i) => {
        const id = new Date(i.date + "T00:00:00Z");
        if (id.getUTCFullYear() === my && id.getUTCMonth() === mm) inf += +i.amount || 0;
      });
      bal[g.id] = (bal[g.id] || 0) + inf - pers - res - idc;
      row["b"+gi] = Math.round(bal[g.id]);
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

function recForStudent(p) {
  if (!p || !p.startDate) return null;
  const y = yrs(p.startDate, new Date());
  if (p.role === "PhD Student") {
    if (y >= 5) return { level:"critical",   txt:"Past 5-year mark. Immediate graduation plan + funding review." };
    if (y >= 4) return { level:"high",       txt:"Year 4+: Set firm graduation date. Fund conditionally on milestones." };
    if (y >= 3) return { level:"medium",     txt:"Year 3: Confirm thesis scope. Apply NSERC CGS-D this cycle." };
    if (y >= 2) return { level:"fellowship", txt:"Year 2: Prime fellowship window. Apply NSERC CGS-D / Vanier / CIHR." };
    return              { level:"ok",        txt:"Year 1: Focus on qualifying exams. Prepare CGS-M application." };
  }
  if (p.role === "MSc Student") {
    if (y >= 2) return { level:"high", txt:"Year 2+: Initiate thesis completion. Confirm submission date." };
    return              { level:"ok",  txt:"Apply NSERC CGS-M if not held." };
  }
  if (p.role === "Postdoc") {
    if (y >= 3) return { level:"medium", txt:"Senior postdoc: Discuss faculty track. Apply Banting Fellowship." };
    return              { level:"ok",    txt:"Active postdoc — on track." };
  }
  return null;
}

// ── shared UI ───────────────────────────────────────────────────────────────
function Badge({ c = "blue", children }) {
  const m = { blue:"bg-blue-50 text-blue-800", green:"bg-green-50 text-green-800", amber:"bg-amber-50 text-amber-800", red:"bg-red-50 text-red-700", gray:"bg-gray-100 text-gray-600", purple:"bg-purple-50 text-purple-800" };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${m[c]||m.blue}`}>{children}</span>;
}
function Card({ children, className = "" }) {
  return <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>{children}</div>;
}
function SH({ title, action }) {
  return <div className="flex items-center justify-between mb-3"><h2 className="text-base font-medium text-gray-700">{title}</h2>{action}</div>;
}
function Btn({ onClick, children, v = "primary", sm = false, disabled = false }) {
  const base = `font-medium rounded-md cursor-pointer transition-colors ${sm?"px-3 py-1 text-xs":"px-4 py-2 text-sm"} ${disabled?"opacity-50 cursor-not-allowed":""}`;
  const s = { primary:"bg-blue-700 text-white hover:bg-blue-800", secondary:"bg-gray-100 text-gray-700 hover:bg-gray-200", danger:"text-red-600 hover:bg-red-50", ghost:"text-blue-600 hover:bg-blue-50", green:"bg-green-700 text-white hover:bg-green-800" };
  return <button className={`${base} ${s[v]||s.primary}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function FL({ label, children }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label>{children}</div>;
}
function Inp({ className = "", ...p }) {
  return <input className={`w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 ${className}`} {...p} />;
}
function Sel({ children, ...p }) {
  return <select className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white" {...p}>{children}</select>;
}
function Metric({ label, value, sub, warn = false }) {
  return (
    <div className={`rounded-lg p-4 border flex-1 min-w-[130px] ${warn?"bg-red-50 border-red-200":"bg-white border-gray-200"}`}>
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-medium ${warn?"text-red-700":"text-gray-800"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
function TT({ active: a, payload, label }) {
  if (!a || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs">
      <div className="font-medium text-gray-700 mb-2">{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }} className="mb-0.5">{p.name}: {f$(p.value)}</div>)}
    </div>
  );
}
function SyncBar({ state, meta, onSync, onSave }) {
  const dot = state==="saved"?"bg-green-400":state==="saving"?"bg-yellow-400 animate-pulse":state==="unsaved"?"bg-orange-400":"bg-red-400";
  const msg = state==="saved"&&meta ? `Saved by ${meta.savedBy} at ${new Date(meta.savedAt).toLocaleTimeString()}` : state==="saving"?"Saving...":state==="unsaved"?"Unsaved changes":"Save failed";
  return (
    <div className="bg-blue-950 text-blue-200 px-5 py-2 flex items-center justify-between gap-4 text-xs flex-wrap">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <span>{msg}</span>
      </div>
      <div className="flex gap-2">
        <Btn onClick={onSync} v="secondary" sm>Refresh</Btn>
        <Btn onClick={onSave} v="green" sm disabled={state==="saving"}>Save now</Btn>
      </div>
    </div>
  );
}

// ── per-grant chart ──────────────────────────────────────────────────────────
function GrantSummary({ g, gi, fc }) {
  if (!g || !fc.length) return null;
  const last = fc[fc.length - 1];
  const bal = last["b"+gi] || 0;
  const avg = Math.round(fc.reduce((s, r) => s + (r["sp"+gi] || 0), 0) / fc.length);
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      {[["Starting balance", f$(g.totalAward)], ["Avg monthly", f$(avg)], ["Balance (36mo)", f$(bal)]].map(([lbl, val]) => (
        <div key={lbl} className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400 mb-1">{lbl}</div>
          <div className={"text-sm font-medium " + (lbl === "Balance (36mo)" && bal < 0 ? "text-red-600" : "text-gray-800")}>{val}</div>
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
    ag.forEach((g, gi) => { if (sel === "all" || sel === g.id) r["b"+gi] = row["b"+gi]; });
    return r;
  });
  return (
    <div>
      <p className="text-xs text-gray-400 mb-3">{sel === "all" ? "All active grants — click a name to isolate" : "Click 'All grants' to zoom back out"}</p>
      <div className="flex gap-2 flex-wrap mb-3">
        <button onClick={() => setSel("all")} className={"px-3 py-1 rounded text-xs font-medium border " + (sel==="all" ? "bg-blue-700 text-white border-blue-700" : "bg-white text-gray-600 border-gray-300")}>All grants</button>
        {ag.map((g, gi) => (
          <button key={g.id} onClick={() => setSel(g.id)}
            className={"px-3 py-1 rounded text-xs font-medium border " + (sel===g.id ? "text-white" : "bg-white text-gray-600 border-gray-300")}
            style={sel===g.id ? { background: GC[gi%GC.length], borderColor: GC[gi%GC.length] } : {}}>
            {g.code}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top:4, right:8, left:8, bottom:4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
          <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
          <Tooltip content={<TT />} />
          <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5} />
          {sel === "all" && <Legend iconType="line" iconSize={10} wrapperStyle={{ fontSize:11 }} />}
          {ag.map((g, gi) => {
            const key = "b" + gi;
            const show = sel === "all" || sel === g.id;
            if (!show) return null;
            return <Line key={g.id} type="monotone" dataKey={key} name={g.code} stroke={GC[gi%GC.length]} strokeWidth={sel===g.id?2.5:1.5} dot={false} connectNulls />;
          })}
        </LineChart>
      </ResponsiveContainer>
      {sel !== "all" && selIdx >= 0 && <GrantSummary g={ag[selIdx]} gi={selIdx} fc={fc} />}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ data, fc }) {
  const [tab, setTab] = useState("portfolio");
  const D = safe(data);
  const ag = D.grants.filter((g) => g && g.active);
  const totalAward = ag.reduce((s, g) => s + (+g.totalAward || 0), 0);
  const lastBal = fc.length ? fc[fc.length-1].portBal : 0;
  const avgBurn = fc.length ? Math.round(fc.reduce((s, r) => s + r.tSpend, 0) / fc.length) : 0;
  const avgIDC = fc.length ? Math.round(fc.reduce((s, r) => s + r.tIDC, 0) / fc.length) : 0;
  const biIdx = fc.findIndex((r) => r.portBal < 0);
  const moZero = biIdx === -1 ? ">" + FCN + "mo" : biIdx + "mo";
  const tabs = [["portfolio","Portfolio balance"],["pergrant","Per-grant"],["burn","Monthly burn"],["idc","IDC breakdown"],["cashflow","Cash flow"]];
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Metric label="Total portfolio" value={f$(totalAward)} sub={ag.length + " active grant" + (ag.length!==1?"s":"")} />
        <Metric label="Avg monthly burn" value={f$(avgBurn)} sub="personnel + research + IDC" />
        <Metric label="Avg monthly IDC" value={f$(avgIDC)} sub="overhead charged" />
        <Metric label="Balance at 36mo" value={f$(lastBal)} sub="end of forecast" warn={lastBal<0} />
        <Metric label="Months to zero" value={moZero} sub="combined portfolio" warn={biIdx>0&&biIdx<18} />
      </div>
      <Card>
        <div className="flex gap-2 flex-wrap mb-4">
          {tabs.map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} className={"px-3 py-1.5 rounded-md text-xs font-medium " + (tab===k?"bg-blue-700 text-white":"bg-gray-100 text-gray-600 hover:bg-gray-200")}>{l}</button>
          ))}
        </div>
        {tab==="portfolio" && (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={fc} margin={{ top:4, right:8, left:8, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
              <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
              <Tooltip content={<TT />} />
              <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5} />
              <Area type="monotone" dataKey="portBal" name="Portfolio balance" stroke="#185FA5" fill="#E6F1FB" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {tab==="pergrant" && <PerGrantChart ag={ag} fc={fc} />}
        {tab==="burn" && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{ top:4, right:8, left:8, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
              <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
              <Tooltip content={<TT />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize:11 }} />
              {ag.map((g,gi) => <Bar key={g.id} dataKey={"sp"+gi} name={g.code} stackId="spend" fill={GC[gi%GC.length]} />)}
              <Bar dataKey="tI" name="Inflows" fill="#5DCAA5" />
            </BarChart>
          </ResponsiveContainer>
        )}
        {tab==="idc" && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{ top:4, right:8, left:8, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
              <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
              <Tooltip content={<TT />} />
              <Legend iconSize={10} wrapperStyle={{ fontSize:11 }} />
              {ag.map((g,gi) => <Bar key={g.id} dataKey={"idc"+gi} name={g.code+" IDC"} stackId="idc" fill={GC[gi%GC.length]} opacity={0.7} />)}
            </BarChart>
          </ResponsiveContainer>
        )}
        {tab==="cashflow" && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={fc} margin={{ top:4, right:8, left:8, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
              <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
              <Tooltip content={<TT />} />
              <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" />
              <Bar dataKey="net" name="Net monthly" shape={(props) => { const {x,y,width,height,value}=props; return <rect x={x} y={value>=0?y:y+height} width={width} height={Math.abs(height)} fill={value>=0?"#5DCAA5":"#F09595"} rx={1} />; }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
      <Card>
        <SH title="Grant status" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout:"fixed", minWidth:680 }}>
            <thead>
              <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                {["Grant","Funder","Type","Balance (Apr 25)","IDC","36mo balance","Mo left","Status"].map((h) => (
                  <th key={h} className="py-2 pr-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {D.grants.map((g, gi) => {
                const aIdx = ag.indexOf(g);
                const bal = aIdx >= 0 && fc.length ? fc[fc.length-1]["b"+aIdx] : null;
                const mo = moLeft(g.endDate);
                const st = !g.active?"inactive":mo!==null&&mo<=3?"expiring":bal!==null&&bal<0?"depleted":bal!==null&&bal/(+g.totalAward||1)<0.1?"low":"active";
                const sc = { active:"bg-green-50 text-green-800", inactive:"bg-gray-100 text-gray-500", expiring:"bg-red-50 text-red-700", depleted:"bg-red-100 text-red-800", low:"bg-amber-50 text-amber-700" };
                return (
                  <tr key={g.id} className={"border-b border-gray-50 " + (!g.active?"opacity-50":"")}>
                    <td className="py-2 pr-2 font-medium text-blue-700">{g.code}</td>
                    <td className="py-2 pr-2 text-gray-600">{g.funder}</td>
                    <td className="py-2 pr-2"><Badge c={g.type==="Capital"?"amber":"blue"}>{g.type}</Badge></td>
                    <td className="py-2 pr-2 text-right">{f$(g.totalAward)}</td>
                    <td className="py-2 pr-2 text-center">{g.idcExempt?<Badge c="gray">Exempt</Badge>:<Badge c="purple">{fp(g.idcRate)}</Badge>}</td>
                    <td className={"py-2 pr-2 text-right font-medium " + (bal!==null&&bal<0?"text-red-600":bal!==null&&bal<50000?"text-amber-600":"text-green-700")}>{bal!==null?f$(bal):"—"}</td>
                    <td className={"py-2 pr-2 text-center text-xs " + (mo!==null&&mo<=12?"text-red-600 font-medium":"text-gray-500")}>{mo!==null?mo+"mo":"—"}</td>
                    <td className="py-2"><span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + sc[st]}>{st}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Grants ───────────────────────────────────────────────────────────────────
function Grants({ data, setData }) {
  const D = safe(data);
  const [form, setForm] = useState(null);
  const [infForm, setInfForm] = useState(null);
  const BG = { code:"",funder:"",fullName:"",type:"Operating",startDate:"",endDate:"",totalAward:"",idcRate:0.25,idcExempt:false,notes:"" };

  function saveGrant() {
    if (!form.code||!form.startDate||!form.totalAward) return alert("Grant code, start date and total award required.");
    if (form.id) {
      setData(function(prev) { var s=safe(prev); s.grants=s.grants.map(function(g){return g.id===form.id?form:g;}); return s; });
    } else {
      setData(function(prev) { var s=safe(prev); s.grants=[...s.grants,{...form,id:uid(),active:true}]; return s; });
    }
    setForm(null);
  }
  function saveInflow() {
    if (!infForm.grantId||!infForm.date||!infForm.amount) return alert("Grant, date and amount required.");
    if (infForm.id) {
      setData(function(prev) { var s=safe(prev); s.inflows=s.inflows.map(function(i){return i.id===infForm.id?infForm:i;}); return s; });
    } else {
      setData(function(prev) { var s=safe(prev); s.inflows=[...s.inflows,{...infForm,id:uid()}]; return s; });
    }
    setInfForm(null);
  }
  function toggleGrant(id) {
    setData(function(prev) {
      var s = safe(prev);
      s.grants = s.grants.map(function(g) { return g.id===id ? {...g,active:!g.active} : g; });
      return s;
    });
  }
  function deleteGrant(id) {
    if (!window.confirm("Delete this grant and all linked data?")) return;
    setData(function(prev) {
      var s = safe(prev);
      s.grants = s.grants.filter(function(g) { return g.id !== id; });
      s.inflows = s.inflows.filter(function(i) { return i.grantId !== id; });
      s.research = s.research.filter(function(r) { return r.grantId !== id; });
      return s;
    });
  }
  function deleteInflow(id) {
    setData(function(prev) { var s=safe(prev); s.inflows=s.inflows.filter(function(i){return i.id!==id;}); return s; });
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        <strong>IDC (Overhead):</strong> Rate your institution charges on eligible direct costs. Capital grants often exempt. Operating grants typically 20–60%.
      </div>
      <Card>
        <SH title="Grants registry" action={<Btn onClick={() => setForm({...BG})}>+ Add grant</Btn>} />
        {form && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-blue-800 mb-3 text-sm">{form.id?"Edit grant":"New grant"}</div>
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))" }}>
              <FL label="Grant ID *"><Inp value={form.code} onChange={(e) => setForm((f) => ({...f,code:e.target.value}))} placeholder="e.g. CIHR-2025" /></FL>
              <FL label="Funder *"><Inp value={form.funder} onChange={(e) => setForm((f) => ({...f,funder:e.target.value}))} /></FL>
              <FL label="Full name"><Inp value={form.fullName} onChange={(e) => setForm((f) => ({...f,fullName:e.target.value}))} /></FL>
              <FL label="Type"><Sel value={form.type} onChange={(e) => setForm((f) => ({...f,type:e.target.value}))}>{["Operating","Capital","Industry","Fellowship"].map((t) => <option key={t}>{t}</option>)}</Sel></FL>
              <FL label="Start date *"><Inp type="date" value={form.startDate} onChange={(e) => setForm((f) => ({...f,startDate:e.target.value}))} /></FL>
              <FL label="End date *"><Inp type="date" value={form.endDate} onChange={(e) => setForm((f) => ({...f,endDate:e.target.value}))} /></FL>
              <FL label="Current balance ($) — amount available as of forecast start *"><Inp type="number" value={form.totalAward} onChange={(e) => setForm((f) => ({...f,totalAward:e.target.value}))} /></FL>
              <FL label="IDC rate (0.25 = 25%)"><Inp type="number" step="0.01" min="0" max="1" value={form.idcRate} onChange={(e) => setForm((f) => ({...f,idcRate:+e.target.value}))} disabled={form.idcExempt} className={form.idcExempt?"bg-gray-100":""} /></FL>
              <FL label="IDC exempt?">
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input type="checkbox" checked={form.idcExempt} onChange={(e) => setForm((f) => ({...f,idcExempt:e.target.checked}))} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">Exempt from IDC</span>
                </label>
              </FL>
              <FL label="Notes"><Inp value={form.notes} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="flex gap-2"><Btn onClick={saveGrant}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Active","Code","Funder","Type","Dates","Award","IDC","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {D.grants.map((g) => (
                <tr key={g.id} className={"border-b border-gray-50 " + (!g.active?"opacity-50":"")}>
                  <td className="py-2 pr-3">
                    <button onClick={() => toggleGrant(g.id)} className={"px-2 py-0.5 rounded text-xs font-medium " + (g.active?"bg-green-100 text-green-800":"bg-gray-100 text-gray-500")}>{g.active?"YES":"NO"}</button>
                  </td>
                  <td className="py-2 pr-3 font-medium text-blue-700">{g.code}</td>
                  <td className="py-2 pr-3 text-gray-600">{g.funder}</td>
                  <td className="py-2 pr-3"><Badge c={g.type==="Capital"?"amber":"blue"}>{g.type}</Badge></td>
                  <td className="py-2 pr-3 text-xs text-gray-500">{g.startDate&&g.startDate.slice(0,7)} – {g.endDate&&g.endDate.slice(0,7)}</td>
                  <td className="py-2 pr-3 font-medium">{f$(g.totalAward)}</td>
                  <td className="py-2 pr-3 text-center">{g.idcExempt?<Badge c="gray">Exempt</Badge>:<Badge c="purple">{fp(g.idcRate)}</Badge>}</td>
                  <td className="py-2 pr-3 text-xs text-gray-400 max-w-[120px] truncate">{g.notes}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Btn onClick={() => setForm({...g})} v="ghost" sm>Edit</Btn>
                    <Btn onClick={() => deleteGrant(g.id)} v="danger" sm>Del</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <SH title="Planned inflows & installments" action={<Btn onClick={() => setInfForm({grantId:"",date:"",amount:"",notes:""})}>+ Add inflow</Btn>} />
        {infForm && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{infForm.id?"Edit":"New inflow"}</div>
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))" }}>
              <FL label="Grant *"><Sel value={infForm.grantId} onChange={(e) => setInfForm((f) => ({...f,grantId:e.target.value}))}><option value="">Select...</option>{D.grants.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</Sel></FL>
              <FL label="Date *"><Inp type="date" value={infForm.date} onChange={(e) => setInfForm((f) => ({...f,date:e.target.value}))} /></FL>
              <FL label="Amount ($) *"><Inp type="number" value={infForm.amount} onChange={(e) => setInfForm((f) => ({...f,amount:e.target.value}))} /></FL>
              <FL label="Notes"><Inp value={infForm.notes||""} onChange={(e) => setInfForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="flex gap-2"><Btn onClick={saveInflow}>Save</Btn><Btn onClick={() => setInfForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Grant","Date","Amount","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {[...D.inflows].sort((a,b) => a.date > b.date ? 1 : -1).map((i) => {
              const g = D.grants.find((g) => g.id === i.grantId);
              return (
                <tr key={i.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><Badge c="blue">{g?g.code:"?"}</Badge></td>
                  <td className="py-2 pr-3 text-gray-600">{i.date}</td>
                  <td className="py-2 pr-3 font-medium text-green-700">{f$(i.amount)}</td>
                  <td className="py-2 pr-3 text-xs text-gray-400">{i.notes}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Btn onClick={() => setInfForm({...i})} v="ghost" sm>Edit</Btn>
                    <Btn onClick={() => deleteInflow(i.id)} v="danger" sm>Del</Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────────
function People({ data, setData }) {
  const D = safe(data);
  const [form, setForm] = useState(null);
  const BP = { name:"",role:"PhD Student",startDate:"",endDate:"",baseMonthly:"",benefits:false,allocations:[{grantId:"",fraction:""}],fellowship:"",notes:"" };

  function savePerson() {
    if (!form.name||!form.startDate||!form.baseMonthly) return alert("Name, start date and monthly base required.");
    const total = (form.allocations||[]).reduce((s,a) => s+(+a.fraction||0), 0);
    if (total > 1.005) return alert("Allocations sum to " + (total*100).toFixed(0) + "% — must not exceed 100%.");
    if (form.id) {
      setData(function(prev) { var s=safe(prev); s.people=s.people.map(function(p){return p.id===form.id?form:p;}); return s; });
    } else {
      setData(function(prev) { var s=safe(prev); s.people=[...s.people,{...form,id:uid(),active:true}]; return s; });
    }
    setForm(null);
  }
  function deletePerson(id) {
    setData(function(prev) { var s=safe(prev); s.people=s.people.filter(function(p){return p.id!==id;}); return s; });
  }
  function updAlloc(i, k, v) {
    setForm((f) => {
      const al = [...(f.allocations||[])];
      al[i] = {...al[i], [k]: v};
      return {...f, allocations: al};
    });
  }
  function addAlloc() {
    setForm((f) => ({...f, allocations: [...(f.allocations||[]), {grantId:"",fraction:""}]}));
  }
  function removeAlloc(i) {
    setForm((f) => ({...f, allocations: (f.allocations||[]).filter((_,j) => j!==i)}));
  }

  return (
    <div className="space-y-4">
      <Card>
        <SH title="Lab personnel & allocations" action={<Btn onClick={() => setForm({...BP})}>+ Add person</Btn>} />
        <p className="text-xs text-gray-400 mb-3">Base monthly = current salary or stipend. Annual increase applies from April 2025 forward only — not backdated.</p>
        {form && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{form.id?"Edit person":"New person"}</div>
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))" }}>
              <FL label="Name *"><Inp value={form.name} onChange={(e) => setForm((f) => ({...f,name:e.target.value}))} /></FL>
              <FL label="Role"><Sel value={form.role} onChange={(e) => setForm((f) => ({...f,role:e.target.value}))}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Sel></FL>
              <FL label="Program / hire start *"><Inp type="date" value={form.startDate} onChange={(e) => setForm((f) => ({...f,startDate:e.target.value}))} /></FL>
              <FL label="Expected end / graduation"><Inp type="date" value={form.endDate||""} onChange={(e) => setForm((f) => ({...f,endDate:e.target.value}))} /></FL>
              <FL label="Base monthly ($) *"><Inp type="number" value={form.baseMonthly} onChange={(e) => setForm((f) => ({...f,baseMonthly:e.target.value}))} /></FL>
              <FL label="Benefits (staff/postdoc)"><Sel value={form.benefits?"YES":"NO"} onChange={(e) => setForm((f) => ({...f,benefits:e.target.value==="YES"}))}><option>YES</option><option>NO</option></Sel></FL>
              <FL label="Fellowship status"><Inp value={form.fellowship||""} onChange={(e) => setForm((f) => ({...f,fellowship:e.target.value}))} placeholder="None / Applying CGS-D" /></FL>
              <FL label="Notes"><Inp value={form.notes||""} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-2">Grant allocations (must sum to 1.0)</div>
              {(form.allocations||[]).map((a, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <div className="flex-[2]">
                    <Sel value={a.grantId} onChange={(e) => updAlloc(i, "grantId", e.target.value)}>
                      <option value="">Select grant...</option>
                      {D.grants.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.fullName}</option>)}
                    </Sel>
                  </div>
                  <div className="flex-1"><Inp type="number" min="0" max="1" step="0.1" placeholder="0.5" value={a.fraction} onChange={(e) => updAlloc(i, "fraction", e.target.value)} /></div>
                  <button onClick={() => removeAlloc(i)} className="text-red-400 hover:text-red-600 px-2">x</button>
                </div>
              ))}
              <Btn onClick={addAlloc} v="secondary" sm>+ Add grant slot</Btn>
            </div>
            <div className="flex gap-2"><Btn onClick={savePerson}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Name","Role","Yr","Start","Base/mo","Benefits","Allocations","Fellowship",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {D.people.map((p) => {
                const y = yrs(p.startDate, new Date());
                const isS = ["PhD Student","MSc Student"].includes(p.role);
                const yrStr = isS ? "Yr "+(Math.floor(y)+1) : p.role==="Postdoc" ? "PD"+(Math.floor(y)+1) : "—";
                const late = (p.role==="PhD Student"&&y>=4)||(p.role==="MSc Student"&&y>=2);
                return (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3"><Badge c={p.role==="Postdoc"?"blue":p.role==="Research Staff"?"gray":"green"}>{p.role}</Badge></td>
                    <td className={"py-2 pr-3 text-sm font-medium " + (late?"text-red-600":"text-gray-600")}>{yrStr}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.startDate}</td>
                    <td className="py-2 pr-3 font-medium">{f$(p.baseMonthly)}</td>
                    <td className="py-2 pr-3"><Badge c={p.benefits?"green":"gray"}>{p.benefits?"YES":"NO"}</Badge></td>
                    <td className="py-2 pr-3 text-xs">
                      {(p.allocations||[]).filter((a) => a.grantId).map((a, i) => {
                        const g = D.grants.find((g) => g.id === a.grantId);
                        return <span key={i} className="mr-1"><Badge c="blue">{g?g.code:"?"}</Badge> {(+a.fraction*100).toFixed(0)}%</span>;
                      })}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.fellowship||"—"}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Btn onClick={() => setForm({...p})} v="ghost" sm>Edit</Btn>
                      <Btn onClick={() => deletePerson(p.id)} v="danger" sm>Del</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Research ─────────────────────────────────────────────────────────────────
function Research({ data, setData }) {
  const D = safe(data);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const BR = { grantId:"",category:"",monthlyBase:"",escalation:0,notes:"" };

  function saveResearch() {
    if (!form.grantId||!form.category||!form.monthlyBase) return alert("Grant, category and monthly base required.");
    if (form.id) {
      setData(function(prev) { var s=safe(prev); s.research=s.research.map(function(r){return r.id===form.id?form:r;}); return s; });
    } else {
      setData(function(prev) { var s=safe(prev); s.research=[...s.research,{...form,id:uid()}]; return s; });
    }
    setForm(null);
  }
  function deleteResearch(id) {
    setData(function(prev) { var s=safe(prev); s.research=s.research.filter(function(r){return r.id!==id;}); return s; });
  }

  const sums = D.grants.filter((g) => g.active).map((g) => ({
    ...g,
    total: D.research.filter((r) => r.grantId===g.id).reduce((s,r) => s+(+r.monthlyBase||0), 0),
    count: D.research.filter((r) => r.grantId===g.id).length,
  }));
  const filtered = filter ? D.research.filter((r) => r.category.toLowerCase().includes(filter.toLowerCase())) : D.research;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {sums.map((g) => (
          <div key={g.id} className="bg-white border border-gray-200 rounded-lg p-3 flex-1 min-w-[120px]">
            <div className="text-xs text-gray-400 font-medium">{g.code}</div>
            <div className="text-lg font-medium text-gray-800 mt-1">{f$(g.total)}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
            <div className="text-xs text-gray-400">{g.count} items · IDC {g.idcExempt?"exempt":fp(g.idcRate)}</div>
          </div>
        ))}
      </div>
      <Card>
        <SH title="Research cost items" action={<Btn onClick={() => setForm({...BR})}>+ Add cost item</Btn>} />
        <p className="text-xs text-gray-400 mb-3">Suggested: {CATS.slice(0,6).join(" · ")} ...</p>
        {form && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="font-medium text-green-800 mb-3 text-sm">{form.id?"Edit item":"New cost item"}</div>
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))" }}>
              <FL label="Grant *"><Sel value={form.grantId} onChange={(e) => setForm((f) => ({...f,grantId:e.target.value}))}><option value="">Select...</option>{D.grants.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</Sel></FL>
              <FL label="Category *">
                <input list="cats" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" value={form.category} onChange={(e) => setForm((f) => ({...f,category:e.target.value}))} placeholder="e.g. Sequencing-NGS" />
                <datalist id="cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist>
              </FL>
              <FL label="Monthly base ($) *"><Inp type="number" value={form.monthlyBase} onChange={(e) => setForm((f) => ({...f,monthlyBase:e.target.value}))} /></FL>
              <FL label="Escalation (%/yr)"><Inp type="number" step="0.01" min="0" max="1" value={form.escalation} onChange={(e) => setForm((f) => ({...f,escalation:e.target.value}))} placeholder="0.03 = 3%/yr" /></FL>
              <FL label="Notes"><Inp value={form.notes||""} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="flex gap-2"><Btn onClick={saveResearch}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="mb-3"><Inp value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by category..." className="max-w-xs" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Category","Grant","Monthly base","Escalation","Yr 2 est.","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r) => {
                const g = D.grants.find((g) => g.id===r.grantId);
                return (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-green-800">{r.category}</td>
                    <td className="py-2 pr-3"><Badge c="blue">{g?g.code:"—"}</Badge></td>
                    <td className="py-2 pr-3 font-medium">{f$(r.monthlyBase)}</td>
                    <td className={"py-2 pr-3 text-xs " + (+r.escalation>0?"text-amber-700 font-medium":"text-gray-400")}>{+r.escalation>0?fp(r.escalation):"—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{f$((+r.monthlyBase||0)*Math.pow(1+(+r.escalation||0),1))}</td>
                    <td className="py-2 pr-3 text-xs text-gray-400">{r.notes}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Btn onClick={() => setForm({...r})} v="ghost" sm>Edit</Btn>
                      <Btn onClick={() => deleteResearch(r.id)} v="danger" sm>Del</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Students ─────────────────────────────────────────────────────────────────
function Students({ data }) {
  const D = safe(data);
  const trainees = D.people.filter((p) => p.active && ["PhD Student","MSc Student","Postdoc"].includes(p.role));
  return (
    <div className="space-y-3">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-700">Recommendations auto-generate from role and year in program. Update Fellowship Status in People tab when awards are received.</div>
      {trainees.length === 0 && <div className="text-center py-12 text-gray-400">No active trainees. Add people in the People tab.</div>}
      {trainees.map((p) => {
        const y = yrs(p.startDate, new Date());
        const rec = recForStudent(p);
        const rs = rec ? RS[rec.level] : null;
        const mo = p.endDate ? moLeft(p.endDate) : null;
        const grants = (p.allocations||[]).filter((a) => a.grantId).map((a) => {
          const g = D.grants.find((g) => g.id===a.grantId);
          return g ? g.code+" ("+(+a.fraction*100).toFixed(0)+"%)" : null;
        }).filter(Boolean);
        return (
          <div key={p.id} className={"rounded-lg p-4 border-l-4 border " + (rs ? rs.bg+" "+rs.border : "bg-white border-gray-200 border-l-gray-300")}>
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div>
                <div className="font-medium text-gray-800">{p.name}</div>
                <div className="text-xs text-gray-500 mt-1">{p.role} · Year {Math.floor(y)+1} · Started {p.startDate}{mo!==null && <span className={"ml-2 "+(mo<12?"text-red-600 font-medium":"")}> · {mo}mo funding left</span>}</div>
                <div className="text-xs text-gray-400 mt-1">Grants: {grants.join(", ")||"none"} · Fellowship: {p.fellowship||"none"}</div>
              </div>
              {rs && <span className={"px-2 py-1 rounded text-xs font-medium flex-shrink-0 "+rs.badge}>{rs.lbl}</span>}
            </div>
            {rec && <div className={"mt-3 p-2 rounded text-xs font-medium "+rs.badge}>{rec.txt}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
function Settings({ data, setData, userName, setUserName }) {
  const D = safe(data);
  const s = D.settings;
  const fileRef = useRef();

  function updSetting(k, v) {
    setData(function(prev) {
      var sd = safe(prev);
      sd.settings = {...sd.settings, [k]: v};
      return sd;
    });
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(safe(data), null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yachie-lab-gms-" + new Date().toISOString().slice(0,10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.grants || !parsed.people) throw new Error("Invalid");
        setData(safe(parsed));
        alert("Data imported successfully.");
      } catch(err) {
        alert("Could not read file. Make sure it is a GMS export JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function Row({ label, desc, k, step, min, max, fmt }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-gray-100 gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-700">{label}</div>
          <div className="text-xs text-gray-400 mt-0.5">{desc} · Now: <strong className="text-blue-700">{fmt(s[k])}</strong></div>
        </div>
        <input type="number" step={step} min={min} max={max} value={s[k]||0} onChange={(e) => updSetting(k, +e.target.value)}
          className="w-28 border border-yellow-300 bg-yellow-50 rounded-md px-3 py-1.5 text-sm text-center font-medium text-blue-800 focus:outline-none" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SH title="Your name (shown on saves)" />
        <div className="flex gap-3 items-center">
          <Inp value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="e.g. Yachie" className="max-w-xs" />
          <span className="text-xs text-gray-400">Appears in the sync banner.</span>
        </div>
      </Card>
      <Card>
        <SH title="Forecast assumptions" />
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">Changes here update all forecasts instantly. Base monthly = what each person earns RIGHT NOW. The annual increase % is applied from April 2025 forward only.</div>
        <Row label="Salary annual increase — staff & postdoc" desc="Compounded from hire date" k="salaryInc" step="0.001" min="0" max="0.2" fmt={fp} />
        <Row label="Stipend annual increase — PhD & MSc" desc="Compounded from program start" k="stipendInc" step="0.001" min="0" max="0.2" fmt={fp} />
        <Row label="Benefits rate — staff & postdoc only" desc="CPP, EI, vacation, health as % of salary" k="benefitsRate" step="0.01" min="0" max="0.5" fmt={fp} />
      </Card>
      <Card>
        <SH title="Export & import data" />
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">Export to back up your data or share with your manager. Import to load a previously exported file.</div>
        <div className="flex gap-3 flex-wrap">
          <Btn onClick={exportData}>Export as JSON</Btn>
          <div>
            <input ref={fileRef} type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
            <Btn onClick={() => fileRef.current && fileRef.current.click()} v="secondary">Import JSON</Btn>
          </div>
        </div>
      </Card>
      <Card className="border-red-200">
        <SH title="Reset" />
        <Btn onClick={() => { if (window.confirm("Clear ALL data?")) setData({...BLANK}); }} v="danger">Clear everything</Btn>
      </Card>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState("loading");
  const [syncMeta, setSyncMeta] = useState(null);
  const [userName, setUserName] = useState("PI");
  const saveRef = useRef(null);
  const SECRET = process.env.NEXT_PUBLIC_LAB_SECRET || "yachie-lab-2025";

  const loadFromServer = useCallback(async function() {
    try {
      const res = await fetch("/api/data?secret=" + SECRET);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.data) {
        setData(safe(json.data));
        setSyncMeta(json.meta);
        setSyncState("saved");
      } else {
        setSyncState("unsaved");
      }
    } catch(e) {
      console.error("Load failed:", e);
      try {
        const local = localStorage.getItem("yachie-gms-local");
        if (local) setData(safe(JSON.parse(local)));
      } catch(e2) {}
      setSyncState("error");
    }
    setLoaded(true);
  }, [SECRET]);

  useEffect(function() { loadFromServer(); }, [loadFromServer]);

  const saveToServer = useCallback(async function() {
    setSyncState("saving");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lab-secret": SECRET },
        body: JSON.stringify({ data: safe(data), savedBy: userName }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      setSyncMeta(json.meta);
      setSyncState("saved");
    } catch(e) {
      console.error("Save failed:", e);
      setSyncState("error");
    }
  }, [data, userName, SECRET]);

  useEffect(function() {
    if (!loaded) return;
    setSyncState("unsaved");
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(saveToServer, 2000);
    try { localStorage.setItem("yachie-gms-local", JSON.stringify(safe(data))); } catch(e) {}
  }, [data, loaded]);

  const fc = useMemo(function() { return forecast(data); }, [data]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-400">
        <div className="text-center"><div className="text-lg font-medium text-gray-600 mb-2">Yachie Lab GMS</div><div>Loading...</div></div>
      </div>
    );
  }

  const D = safe(data);
  const ag = D.grants.filter((g) => g && g.active);
  const total = ag.reduce((s, g) => s + (+g.totalAward || 0), 0);
  const TABS = [["dashboard","Dashboard"],["grants","Grants"],["people","People"],["research","Research"],["students","Students"],["settings","Settings"]];

  return (
    <>
      <Head><title>Yachie Lab — Grant Management</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-900 text-white">
          <div className="px-5 pt-4">
            <div className="font-medium text-base">Yachie Lab — Grant Management System</div>
            <div className="text-blue-300 text-xs mt-1">{ag.length} active grant{ag.length!==1?"s":""} · {D.people.filter((p) => p.active).length} lab members · {f$(total)} total portfolio</div>
          </div>
          <div className="flex gap-0.5 px-4 pt-3 overflow-x-auto">
            {TABS.map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)} className={"px-4 py-2 text-sm rounded-t-md transition-colors whitespace-nowrap " + (tab===k?"bg-gray-50 text-blue-900 font-medium":"text-blue-200 hover:text-white hover:bg-blue-800")}>{l}</button>
            ))}
          </div>
        </div>
        <SyncBar state={syncState} meta={syncMeta} onSync={loadFromServer} onSave={saveToServer} />
        <div className="p-4">
          {tab==="dashboard" && <Dashboard data={data} fc={fc} />}
          {tab==="grants"    && <Grants    data={data} setData={setData} />}
          {tab==="people"    && <People    data={data} setData={setData} />}
          {tab==="research"  && <Research  data={data} setData={setData} />}
          {tab==="students"  && <Students  data={data} />}
          {tab==="settings"  && <Settings  data={data} setData={setData} userName={userName} setUserName={setUserName} />}
        </div>
      </div>
    </>
  );
}
