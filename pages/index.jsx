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
  // Note: we do NOT check p.active here — the active toggle is UI-only (hides from Students tab).
  // The end date is what controls when forecasting stops. This way marking someone inactive
  // keeps their historical charges in the forecast up to their end date.
  if (!p || !p.startDate) return false;
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
function countMonths(from, to) {
  if (!from || !to) return null;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

const CATS = ["Sequencing-NGS","Sequencing-LongRead","Sequencing-Sanger","Animals-PerDiem","Animals-Procedures","Animals-Genotyping","Consumables-MolBio","Consumables-CellCulture","DNA-Synthesis","Computing-Cloud","Services-Core","Services-Maintenance","Travel","General"];
const RS = {
  critical:   { bg:"bg-red-50",    border:"border-red-300",    badge:"bg-red-100 text-red-800",       lbl:"Critical" },
  high:       { bg:"bg-orange-50", border:"border-orange-300", badge:"bg-orange-100 text-orange-800", lbl:"Urgent" },
  medium:     { bg:"bg-amber-50",  border:"border-amber-200",  badge:"bg-amber-100 text-amber-800",   lbl:"Review" },
  fellowship: { bg:"bg-green-50",  border:"border-green-300",  badge:"bg-green-100 text-green-800",   lbl:"Fellowship" },
  ok:         { bg:"bg-blue-50",   border:"border-blue-200",   badge:"bg-blue-100 text-blue-800",     lbl:"On track" },
};

const ES = { postdocInc: 0.035, staffInc: 0.035, postdocBenefits: 0.22, staffBenefits: 0.22 };
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
        // Find allocation active in this month (check from/to date range)
        const alloc = allocs.find((a) => {
          if (!a || a.grantId !== g.id) return false;
          if (a.from && md < new Date(a.from + "T00:00:00Z")) return false;
          if (a.to   && md > new Date(a.to   + "T00:00:00Z")) return false;
          return true;
        });
        const frac = +(alloc || {}).fraction || 0;
        if (!frac) return;
        // Resolve base monthly: check salaryHistory for a matching date range, fallback to baseMonthly
        const history = Array.isArray(p.salaryHistory) ? p.salaryHistory : [];
        const activeRate = history.find((h) => {
          if (!h || !h.base) return false;
          if (h.from && md < new Date(h.from + "T00:00:00Z")) return false;
          if (h.to   && md > new Date(h.to   + "T00:00:00Z")) return false;
          return true;
        });
        const baseThisMonth = activeRate ? (+activeRate.base || 0) : (+p.baseMonthly || 0);
        // Role-based escalation and benefits rates
        const isStudent  = ["PhD Student","MSc Student"].includes(p.role);
        const isPostdoc  = p.role === "Postdoc";
        const incRate    = isPostdoc ? (+D.settings.postdocInc || 0.035) : (+D.settings.staffInc || 0.035);
        const benRate    = isPostdoc ? (+D.settings.postdocBenefits || 0.22) : (+D.settings.staffBenefits || 0.22);
        const sc = isStudent
          ? baseThisMonth
          : baseThisMonth * Math.pow(1 + incRate, Math.max(0, yrs(FC0, md)));
        pers += sc * (p.benefits ? 1 + benRate : 1) * frac;
      });
      D.research.filter((r) => {
        if (!r || r.grantId !== g.id) return false;
        if (r.from && md < new Date(r.from + "-01T00:00:00Z")) return false;
        if (r.to   && md > new Date(r.to   + "-01T00:00:00Z")) return false;
        return true;
      }).forEach((r) => {
        res += (+r.monthlyBase || 0) * Math.pow(1 + (+r.escalation || 0), Math.max(0, yrs(g.startDate || FC0, md)));
      });
      const idc = (pers + (g.type === "Capital" ? 0 : res)) * (g.idcExempt ? 0 : (+g.idcRate || 0));
      D.inflows.filter((i) => i && i.grantId === g.id && i.date).forEach((i) => {
        const id = new Date(i.date + "T00:00:00Z");
        if (id.getUTCFullYear() === my && id.getUTCMonth() === mm) inf += +i.amount || 0;
      });
      bal[g.id] = (bal[g.id] || 0) + inf - pers - res - idc;
      row["b"+gi]   = Math.round(bal[g.id]);
      row["sp"+gi]  = Math.round(pers + res + idc);
      row["idc"+gi] = Math.round(idc);
      row["p"+gi]   = Math.round(pers);
      row["r"+gi]   = Math.round(res);
      row.tP += pers; row.tR += res; row.tIDC += idc; row.tI += inf;
    });
    row.tSpend = Math.round(row.tP + row.tR + row.tIDC);
    row.tI = Math.round(row.tI);
    row.net = Math.round(row.tI - row.tSpend);
    row.portBal = Math.round(ag.reduce((s, _, gi) => s + (row["b"+gi] || 0), 0));
    return row;
  });
}

// ── Compute cumulative spend by category for cap checking ────────────────────
function computeGrantSpend(data, grantId, fc) {
  const D = safe(data);
  const g = D.grants.find((g) => g.id === grantId);
  if (!g) return null;
  const gi = D.grants.filter((g) => g.active).findIndex((g) => g.id === grantId);
  if (gi < 0) return null;

  // Personnel spend: sum from forecast rows
  const totalPersonnel = fc.reduce((s, r) => {
    // We need per-category spend — recalc from people
    return s;
  }, 0);

  // Simpler: compute directly from raw data for the grant period
  const fc0 = new Date(FC0 + "T00:00:00Z");
  let personnel = 0, research = 0, travel = 0, idc = 0;

  fc.forEach((row) => {
    if (row["sp"+gi] === undefined) return;
    // Approximate personnel vs research split using per-grant data
    personnel += row["p"+gi] || 0;
    research  += row["r"+gi] || 0;
    idc       += row["idc"+gi] || 0;
  });

  // Research split: separate travel from other research
  const travelItems = D.research.filter((r) => r.grantId === grantId && r.category.toLowerCase().includes("travel"));
  const travelMonthly = travelItems.reduce((s, r) => s + (+r.monthlyBase || 0), 0);
  const travelTotal = travelMonthly * fc.length;

  return {
    personnel: Math.round(personnel),
    research:  Math.round(Math.max(0, research - travelTotal)),
    travel:    Math.round(travelTotal),
    idc:       Math.round(idc),
    total:     Math.round(personnel + research + idc),
  };
}

function recForStudent(p) {
  if (!p || !p.startDate) return null;
  // If person has an end date already set, show Departing — no further recommendation needed
  if (p.endDate) {
    const mo = moLeft(p.endDate);
    if (mo !== null && mo <= 6)  return { level:"high",   txt:"Departing within 6 months." };
    if (mo !== null && mo <= 12) return { level:"medium", txt:"Departing within 12 months." };
    return { level:"ok", txt:"End date set." };
  }
  const y = yrs(p.startDate, new Date());
  if (p.role === "PhD Student") {
    if (y >= 5) return { level:"critical",   txt:"Past 5-year mark." };
    if (y >= 4) return { level:"high",       txt:"Year 4 — graduation plan needed." };
    if (y >= 3) return { level:"medium",     txt:"Year 3 — confirm thesis scope." };
    if (y >= 2) return { level:"fellowship", txt:"Year 2 — fellowship window." };
    return              { level:"ok",        txt:"Year 1." };
  }
  if (p.role === "MSc Student") {
    if (y >= 2) return { level:"high", txt:"Year 2 — thesis completion." };
    return              { level:"ok",  txt:"Year 1." };
  }
  if (p.role === "Postdoc") {
    if (y >= 3) return { level:"medium", txt:"Year 3+ postdoc." };
    return              { level:"ok",    txt:"Active." };
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

function PerGrantTooltip({ active: a, payload, label, fc, gi }) {
  if (!a || !payload || !payload.length) return null;
  // Find the matching fc row for this label
  const row = fc.find((r) => r.label === label);
  if (!row) return null;
  const bal     = row["b"+gi];
  const spend   = row["sp"+gi];
  const pers    = row["p"+gi];
  const res     = row["r"+gi];
  const idc     = row["idc"+gi];
  const inf     = row.tI > 0 ? row.tI : null; // approximate — full portfolio inflow
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs min-w-[180px]">
      <div className="font-medium text-gray-700 mb-2 border-b border-gray-100 pb-1">{label}</div>
      {bal !== undefined && (
        <div className="flex justify-between gap-4 mb-1">
          <span className="text-gray-500">Balance</span>
          <span className={"font-medium " + (bal < 0 ? "text-red-600" : "text-gray-800")}>{f$(bal)}</span>
        </div>
      )}
      <div className="border-t border-gray-100 mt-1 pt-1">
        <div className="text-gray-400 mb-1 uppercase tracking-wide" style={{fontSize:10}}>This month spend</div>
        {spend !== undefined && <div className="flex justify-between gap-4 mb-0.5"><span className="text-gray-500">Total spend</span><span className="font-medium text-gray-800">{f$(spend)}</span></div>}
        {pers  !== undefined && <div className="flex justify-between gap-4 mb-0.5"><span className="text-gray-400">↳ Personnel</span><span className="text-gray-600">{f$(pers)}</span></div>}
        {res   !== undefined && <div className="flex justify-between gap-4 mb-0.5"><span className="text-gray-400">↳ Research</span><span className="text-gray-600">{f$(res)}</span></div>}
        {idc   !== undefined && idc > 0 && <div className="flex justify-between gap-4 mb-0.5"><span className="text-gray-400">↳ IDC</span><span className="text-gray-600">{f$(idc)}</span></div>}
      </div>
    </div>
  );
}
function SyncBar({ state, meta, onSync, onSave, saveError }) {
  const dot = state==="saved"?"bg-green-400":state==="saving"?"bg-yellow-400 animate-pulse":state==="unsaved"?"bg-orange-400":"bg-red-400";
  const msg = state==="saved"&&meta
    ? "Saved to cloud by " + meta.savedBy + " at " + new Date(meta.savedAt).toLocaleTimeString()
    : state==="saving" ? "Saving to cloud..."
    : state==="unsaved" ? "Unsaved changes — will auto-save in 2s"
    : "SAVE FAILED — data is only in this browser";
  return (
    <div>
      <div className={"px-5 py-2 flex items-center justify-between gap-4 text-xs flex-wrap " + (state==="error"?"bg-red-700 text-white":"bg-blue-950 text-blue-200")}>
        <div className="flex items-center gap-3">
          <span className={"w-2 h-2 rounded-full flex-shrink-0 " + dot} />
          <span className="font-medium">{msg}</span>
          {state==="error" && <span className="opacity-80">— Check Upstash env vars in Vercel Settings</span>}
        </div>
        <div className="flex gap-2">
          <Btn onClick={onSync} v="secondary" sm>Refresh from cloud</Btn>
          <Btn onClick={onSave} v="green" sm disabled={state==="saving"}>Save now</Btn>
        </div>
      </div>
      {state==="error" && saveError && (
        <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-xs text-red-700">
          <strong>Error detail:</strong> {saveError} — Your data is safe in this browser tab but will be lost if you close it or someone else opens the app.
        </div>
      )}
    </div>
  );
}

// ── per-grant chart ──────────────────────────────────────────────────────────
function GrantSummary({ g, gi, fc }) {
  if (!g || !fc.length) return null;
  const last = fc[fc.length - 1];
  const bal = last["b"+gi] || 0;

  // Only count months where this grant is active (has spend data)
  const activeRows = fc.filter((r) => r["sp"+gi] > 0);
  const avgSpend = activeRows.length
    ? Math.round(activeRows.reduce((s, r) => s + (r["sp"+gi] || 0), 0) / activeRows.length)
    : 0;

  // Peak monthly spend
  const peakSpend = Math.max(...fc.map((r) => r["sp"+gi] || 0));

  // Months until balance hits zero
  const zeroIdx = fc.findIndex((r) => (r["b"+gi] || 0) < 0);
  const moToZero = zeroIdx === -1 ? ">" + fc.length + "mo" : zeroIdx + "mo";

  const cards = [
    ["Starting balance", f$(g.totalAward), false],
    ["Avg monthly (active months)", f$(avgSpend), false],
    ["Peak monthly", f$(peakSpend), false],
    ["Balance at forecast end", f$(bal), bal < 0],
    ["Months to zero", moToZero, zeroIdx > 0 && zeroIdx < 18],
  ];

  return (
    <div className="mt-3 grid gap-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))"}}>
      {cards.map(([lbl, val, warn]) => (
        <div key={lbl} className={"rounded-lg p-3 text-center " + (warn ? "bg-red-50" : "bg-gray-50")}>
          <div className="text-xs text-gray-400 mb-1">{lbl}</div>
          <div className={"text-sm font-medium " + (warn ? "text-red-600" : "text-gray-800")}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function PerGrantChart({ ag, fc }) {
  const [sel, setSel] = useState("all");
  const selIdx = sel === "all" ? -1 : ag.findIndex((g) => g.id === sel);

  // Convert a grant end date to the nearest chart label for ReferenceLine x value
  function endLabel(g) {
    if (!g.endDate) return null;
    const end = new Date(g.endDate + "T00:00:00Z");
    const fc0 = new Date(FC0 + "T00:00:00Z");
    if (end < fc0) return null;
    // Find closest fc label
    let best = null, bestDiff = Infinity;
    fc.forEach((row) => {
      // Parse "Apr '25" style label back to approximate date
      const diff = Math.abs(end - new Date(g.endDate));
      if (diff < bestDiff) { bestDiff = diff; best = row.label; }
    });
    // Simpler: compute month index into fc
    const mi = Math.round((end - fc0) / (1000 * 60 * 60 * 24 * 30.4));
    const clamped = Math.max(0, Math.min(fc.length - 1, mi));
    return fc[clamped] ? fc[clamped].label : null;
  }

  // Grants to show end lines for: all when viewing all, or just selected
  const grantsToMark = sel === "all" ? ag : ag.filter((g) => g.id === sel);

  const chartData = fc.map((row) => {
    const r = { label: row.label };
    ag.forEach((g, gi) => { if (sel === "all" || sel === g.id) r["b"+gi] = row["b"+gi]; });
    return r;
  });

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{sel === "all" ? "All active grants — click a name to isolate" : "Click 'All grants' to zoom back out"}</p>
      <div className="flex gap-1 flex-wrap items-center mb-1 text-xs text-gray-400">
        <span className="inline-block w-6 border-t-2 border-dashed border-gray-400 mr-1" style={{verticalAlign:"middle"}}></span>
        Dashed vertical lines = grant end dates
      </div>
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
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top:4, right:8, left:8, bottom:4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
          <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
          <Tooltip content={
            sel !== "all" && selIdx >= 0
              ? <PerGrantTooltip fc={fc} gi={selIdx} />
              : <TT />
          } />
          <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5} />
          {sel === "all" && <Legend iconType="line" iconSize={10} wrapperStyle={{ fontSize:11 }} />}
          {/* Grant end date vertical lines — staggered to avoid overlap */}
          {grantsToMark
            .filter((g) => endLabel(g))
            .sort((a, b) => (a.endDate||"") > (b.endDate||"") ? 1 : -1)
            .map((g, idx) => {
              const lbl = endLabel(g);
              const color = GC[ag.indexOf(g) % GC.length];
              const offsets = [10, 28, 46, 64, 82];
              const offsetY = offsets[idx % offsets.length];
              return (
                <ReferenceLine
                  key={"end-"+g.id}
                  x={lbl}
                  stroke={color}
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: sel === "all" ? g.code : g.code + " ends",
                    position: "insideTopRight",
                    fontSize: 9,
                    fill: color,
                    fontWeight: 500,
                    dy: offsetY,
                  }}
                />
              );
            })}
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

// ── AI Reallocation Suggestions ───────────────────────────────────────────────
function AIsuggestions({ data, fc }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const D = safe(data);

  async function getSuggestions() {
    setLoading(true);
    setError(null);
    setResult(null);

    const ag = D.grants.filter((g) => g && g.active);

    // Build a concise summary for Claude
    const grantSummary = ag.map((g, gi) => {
      const lastBal = fc.length ? (fc[fc.length-1]["b"+gi] || 0) : 0;
      const avgSpend = fc.length ? Math.round(fc.reduce((s,r) => s+(r["sp"+gi]||0),0)/fc.length) : 0;
      const caps = g.caps || {};
      const spend = computeGrantSpend(data, g.id, fc);
      return {
        code: g.code,
        funder: g.funder,
        endDate: g.endDate,
        totalAward: g.totalAward,
        forecastBalance: lastBal,
        avgMonthlySpend: avgSpend,
        caps: Object.keys(caps).length ? caps : "none set",
        projectedSpend: spend,
      };
    });

    const peopleSummary = D.people
      .filter((p) => p.active !== false)
      .map((p) => ({
        name: p.name,
        role: p.role,
        baseMonthly: p.baseMonthly,
        benefits: p.benefits,
        startDate: p.startDate,
        endDate: p.endDate || "open",
        allocations: (p.allocations||[]).map((a) => {
          const g = D.grants.find((g) => g.id === a.grantId);
          return { grant: g ? g.code : "?", fraction: a.fraction, from: a.from||"start", to: a.to||"ongoing" };
        }),
      }));

    const prompt = `You are a research grant management advisor for a synthetic biology laboratory. Analyze the following grant portfolio and personnel data, then provide specific, actionable reallocation recommendations to maximize how long the lab can operate before running out of funding.

GRANT PORTFOLIO:
${JSON.stringify(grantSummary, null, 2)}

CURRENT PERSONNEL & ALLOCATIONS:
${JSON.stringify(peopleSummary, null, 2)}

Please provide:
1. A brief assessment of the current situation (2-3 sentences max)
2. Specific reallocation recommendations — name the person, the grant to move them to, the fraction, and the date to make the switch
3. Any budget cap concerns
4. Which grants are at risk of running over budget or expiring with money unspent

Format your response clearly with numbered recommendations. Be specific with names, grant codes, fractions, and dates. Keep it concise — this is for a busy PI.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = await res.json();
      if (json.content && json.content[0]) {
        setResult(json.content[0].text);
      } else {
        setError("No response received.");
      }
    } catch(e) {
      setError("Request failed: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-medium text-gray-700">AI reallocation suggestions</h2>
          <p className="text-xs text-gray-400 mt-0.5">Analyzes your grants, people and budget caps to suggest the best way to reallocate personnel</p>
        </div>
        <Btn onClick={getSuggestions} disabled={loading} v="primary">
          {loading ? "Analysing..." : "Get suggestions"}
        </Btn>
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>}
      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {result}
        </div>
      )}
      {!result && !error && !loading && (
        <div className="text-xs text-gray-400 text-center py-4">Click "Get suggestions" to analyse your portfolio and get reallocation recommendations.</div>
      )}
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
              {(() => {
                // Sort grants by end date so stagger is consistent
                const withEnd = ag
                  .map((g, gi) => ({ g, gi }))
                  .filter(({ g }) => g.endDate)
                  .sort((a, b) => a.g.endDate > b.g.endDate ? 1 : -1);
                const fc0 = new Date(FC0 + "T00:00:00Z");
                // Stagger offsets cycle through different vertical positions
                const offsets = [10, 28, 46, 64, 82];
                return withEnd.map(({ g, gi }, idx) => {
                  const end = new Date(g.endDate + "T00:00:00Z");
                  const mi = Math.round((end - fc0) / (1000 * 60 * 60 * 24 * 30.4));
                  const clamped = Math.max(0, Math.min(fc.length - 1, mi));
                  const lbl = fc[clamped] ? fc[clamped].label : null;
                  if (!lbl) return null;
                  const offsetY = offsets[idx % offsets.length];
                  return (
                    <ReferenceLine key={"pend-"+g.id} x={lbl}
                      stroke={GC[gi%GC.length]} strokeDasharray="6 3" strokeWidth={1.5}
                      label={{
                        value: g.code,
                        position: "insideTopRight",
                        fontSize: 9,
                        fill: GC[gi%GC.length],
                        fontWeight: 500,
                        dy: offsetY,
                      }}
                    />
                  );
                });
              })()}
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
                    <td className="py-2">
                      <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + sc[st]}>{st}</span>
                      {(() => {
                        const caps = g.caps || {};
                        const spend = computeGrantSpend(data, g.id, fc);
                        if (!spend) return null;
                        const warnings = [];
                        if (caps.personnel && spend.personnel > +caps.personnel) warnings.push("Personnel over cap");
                        if (caps.research  && spend.research  > +caps.research)  warnings.push("Research over cap");
                        if (caps.travel    && spend.travel    > +caps.travel)     warnings.push("Travel over cap");
                        if (caps.total     && spend.total     > +caps.total)      warnings.push("Total over cap");
                        if (!warnings.length) return null;
                        return <div className="mt-1">{warnings.map((w,i) => <span key={i} className="inline-block mr-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">{w}</span>)}</div>;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <AIsuggestions data={data} fc={fc} />
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
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
              <div className="text-xs font-medium text-yellow-800 mb-2">Budget caps (optional) — leave blank for no limit</div>
              <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))"}}>
                <FL label="Max personnel ($)"><Inp type="number" value={(form.caps||{}).personnel||""} onChange={(e) => setForm((f) => ({...f,caps:{...(f.caps||{}),personnel:e.target.value}}))} placeholder="e.g. 300000"/></FL>
                <FL label="Max research/consumables ($)"><Inp type="number" value={(form.caps||{}).research||""} onChange={(e) => setForm((f) => ({...f,caps:{...(f.caps||{}),research:e.target.value}}))} placeholder="e.g. 80000"/></FL>
                <FL label="Max travel ($)"><Inp type="number" value={(form.caps||{}).travel||""} onChange={(e) => setForm((f) => ({...f,caps:{...(f.caps||{}),travel:e.target.value}}))} placeholder="e.g. 15000"/></FL>
                <FL label="Max total direct ($)"><Inp type="number" value={(form.caps||{}).total||""} onChange={(e) => setForm((f) => ({...f,caps:{...(f.caps||{}),total:e.target.value}}))} placeholder="e.g. 450000"/></FL>
              </div>
            </div>
            <div className="flex gap-2"><Btn onClick={saveGrant}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Active","Code","Funder","Type","Dates","Starting balance","Total inflows","IDC","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
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
                  <td className="py-2 pr-3">
                    {(() => {
                      const total = D.inflows
                        .filter((i) => i.grantId === g.id)
                        .reduce((s, i) => s + (+i.amount || 0), 0);
                      const count = D.inflows.filter((i) => i.grantId === g.id).length;
                      return total > 0
                        ? <span className="font-medium text-green-700">{f$(total)}<span className="text-xs text-gray-400 font-normal ml-1">({count} installment{count!==1?"s":""})</span></span>
                        : <span className="text-gray-300 text-xs">none scheduled</span>;
                    })()}
                  </td>
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
        {D.inflows.length > 0 && (
          <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              {D.inflows.length} inflow{D.inflows.length!==1?"s":""} across {D.grants.filter(g=>D.inflows.some(i=>i.grantId===g.id)).length} grant{D.grants.filter(g=>D.inflows.some(i=>i.grantId===g.id)).length!==1?"s":""}
            </span>
            <span className="text-sm font-medium text-green-700">
              Total scheduled: {f$(D.inflows.reduce((s,i)=>s+(+i.amount||0),0))}
            </span>
          </div>
        )}
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
    // Validate: check no single month in the forecast exceeds 100% allocation
    // (rows with different date ranges are fine to both be 100%)
    const FC_START_DATE = new Date("2025-04-01T00:00:00Z");
    let overlapError = null;
    for (let mi = 0; mi < 36; mi++) {
      const md = new Date(FC_START_DATE);
      md.setUTCMonth(md.getUTCMonth() + mi);
      const monthTotal = (form.allocations||[]).reduce((s, a) => {
        if (!a.grantId) return s;
        if (a.from && md < new Date(a.from + "T00:00:00Z")) return s;
        if (a.to   && md > new Date(a.to   + "T00:00:00Z")) return s;
        return s + (+a.fraction || 0);
      }, 0);
      if (monthTotal > 1.005) {
        overlapError = md.toLocaleDateString("en-US", { year:"numeric", month:"short" }) + " sums to " + (monthTotal*100).toFixed(0) + "%";
        break;
      }
    }
    if (overlapError) return alert("Allocation overlap: " + overlapError + " — must not exceed 100% in any single month.");
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
  function togglePerson(id) {
    setData(function(prev) {
      var s = safe(prev);
      s.people = s.people.map(function(p) { return p.id===id ? {...p, active:!p.active} : p; });
      return s;
    });
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
  function updSalaryHistory(i, k, v) {
    setForm((f) => {
      const sh = [...(f.salaryHistory||[])];
      sh[i] = {...sh[i], [k]: v};
      return {...f, salaryHistory: sh};
    });
  }
  function addSalaryHistory() {
    setForm((f) => ({...f, salaryHistory: [...(f.salaryHistory||[]), {base:"", from:"", to:""}]}));
  }
  function removeSalaryHistory(i) {
    setForm((f) => ({...f, salaryHistory: (f.salaryHistory||[]).filter((_,j) => j!==i)}));
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
              <FL label="Current base monthly ($) *"><Inp type="number" value={form.baseMonthly} onChange={(e) => setForm((f) => ({...f,baseMonthly:e.target.value}))} /></FL>
              <FL label="Benefits (staff/postdoc)"><Sel value={form.benefits?"YES":"NO"} onChange={(e) => setForm((f) => ({...f,benefits:e.target.value==="YES"}))}><option>YES</option><option>NO</option></Sel></FL>
              <FL label="Fellowship status"><Inp value={form.fellowship||""} onChange={(e) => setForm((f) => ({...f,fellowship:e.target.value}))} placeholder="None / Applying CGS-D" /></FL>
              <FL label="Notes"><Inp value={form.notes||""} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-2">
                Grant allocations — fractions must sum to 1.0 <em>for any given month</em>.
                Use From/To dates to schedule moves between grants. Leave both blank if the allocation applies for the whole forecast.
                Add a new row when moving someone to a different grant.
              </div>
              {(form.allocations||[]).map((a, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 mb-2 border border-gray-200">
                  <div className="flex gap-2 mb-2 items-end flex-wrap">
                    <div className="flex-[2] min-w-[160px]">
                      <div className="text-xs text-gray-400 mb-1">Grant</div>
                      <Sel value={a.grantId} onChange={(e) => updAlloc(i, "grantId", e.target.value)}>
                        <option value="">Select grant...</option>
                        {D.grants.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.fullName}</option>)}
                      </Sel>
                    </div>
                    <div className="w-20">
                      <div className="text-xs text-gray-400 mb-1">Fraction</div>
                      <Inp type="number" min="0" max="1" step="0.1" placeholder="1.0" value={a.fraction} onChange={(e) => updAlloc(i, "fraction", e.target.value)} />
                    </div>
                    <div className="flex-1 min-w-[130px]">
                      <div className="text-xs text-gray-400 mb-1">From (leave blank = always)</div>
                      <Inp type="date" value={a.from||""} onChange={(e) => updAlloc(i, "from", e.target.value)} />
                    </div>
                    <div className="flex-1 min-w-[130px]">
                      <div className="text-xs text-gray-400 mb-1">To (leave blank = ongoing)</div>
                      <Inp type="date" value={a.to||""} onChange={(e) => updAlloc(i, "to", e.target.value)} />
                    </div>
                    <button onClick={() => removeAlloc(i)} className="text-red-400 hover:text-red-600 px-2 pb-1">x</button>
                  </div>
                  {a.from && a.to && (
                    <div className="text-xs text-blue-600">{a.from} → {a.to}</div>
                  )}
                  {a.from && !a.to && (
                    <div className="text-xs text-green-600">{a.from} → ongoing</div>
                  )}
                  {!a.from && !a.to && (
                    <div className="text-xs text-gray-400">Active for full forecast period</div>
                  )}
                </div>
              ))}
              <Btn onClick={addAlloc} v="secondary" sm>+ Add grant slot</Btn>
            </div>
            <div className="mb-3 mt-2">
              <div className="text-xs text-gray-500 mb-1">Salary / stipend history <span className="text-gray-400">(optional — only needed if base changed over time)</span></div>
              <div className="text-xs text-gray-400 mb-2">Leave empty to use "Current base monthly" for the full forecast. Add rows when the salary changed at a specific date.</div>
              {(form.salaryHistory||[]).map((h, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 mb-2 border border-gray-200 flex gap-2 items-end flex-wrap">
                  <div className="w-28">
                    <div className="text-xs text-gray-400 mb-1">Base ($)</div>
                    <Inp type="number" value={h.base||""} onChange={(e) => updSalaryHistory(i, "base", e.target.value)} placeholder="e.g. 3200"/>
                  </div>
                  <div className="flex-1 min-w-[130px]">
                    <div className="text-xs text-gray-400 mb-1">From</div>
                    <Inp type="date" value={h.from||""} onChange={(e) => updSalaryHistory(i, "from", e.target.value)}/>
                  </div>
                  <div className="flex-1 min-w-[130px]">
                    <div className="text-xs text-gray-400 mb-1">To (blank = ongoing)</div>
                    <Inp type="date" value={h.to||""} onChange={(e) => updSalaryHistory(i, "to", e.target.value)}/>
                  </div>
                  <button onClick={() => removeSalaryHistory(i)} className="text-red-400 hover:text-red-600 px-2 pb-1">x</button>
                </div>
              ))}
              <Btn onClick={addSalaryHistory} v="secondary" sm>+ Add salary period</Btn>
            </div>
            <div className="flex gap-2"><Btn onClick={savePerson}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Active","Name","Role","Yr","Start","Base/mo","Benefits","Allocations","Fellowship",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {D.people.map((p) => {
                const y = yrs(p.startDate, new Date());
                const isS = ["PhD Student","MSc Student"].includes(p.role);
                const yrStr = isS ? "Yr "+(Math.floor(y)+1) : p.role==="Postdoc" ? "PD"+(Math.floor(y)+1) : "—";
                const late = (p.role==="PhD Student"&&y>=4)||(p.role==="MSc Student"&&y>=2);
                return (
                  <tr key={p.id} className={"border-b border-gray-50 " + (!p.active ? "opacity-40" : "")}>
                    <td className="py-2 pr-3">
                      <button onClick={() => togglePerson(p.id)}
                        className={"px-2 py-0.5 rounded text-xs font-medium " + (p.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500")}>
                        {p.active ? "YES" : "NO"}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3"><Badge c={p.role==="Postdoc"?"blue":p.role==="Research Staff"?"gray":"green"}>{p.role}</Badge></td>
                    <td className={"py-2 pr-3 text-sm font-medium " + (late?"text-red-600":"text-gray-600")}>{yrStr}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.startDate}</td>
                    <td className="py-2 pr-3 font-medium">{f$(p.baseMonthly)}</td>
                    <td className="py-2 pr-3"><Badge c={p.benefits?"green":"gray"}>{p.benefits?"YES":"NO"}</Badge></td>
                    <td className="py-2 pr-3 text-xs">
                      {(p.allocations||[]).filter((a) => a.grantId).map((a, i) => {
                        const g = D.grants.find((g) => g.id === a.grantId);
                        const dated = a.from || a.to;
                        return (
                          <span key={i} className="mr-1 inline-block mb-0.5">
                            <Badge c="blue">{g?g.code:"?"}</Badge>
                            <span className="text-xs text-gray-600 ml-0.5">{(+a.fraction*100).toFixed(0)}%</span>
                            {dated && <span className="text-xs text-gray-400 ml-0.5">({a.from?a.from.slice(0,7):"start"}→{a.to?a.to.slice(0,7):"open"})</span>}
                          </span>
                        );
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
  const [monthFilter, setMonthFilter] = useState("");
  const BR = { grantId:"",category:"",monthlyBase:"",escalation:0,from:"",to:"",notes:"" };

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

  const sums = D.grants.filter((g) => g.active).map((g) => {
    const items = D.research.filter((r) => r.grantId===g.id);
    const monthlyTotal = items.reduce((s,r) => s+(+r.monthlyBase||0), 0);
    const periodTotal = items.reduce((s,r) => {
      const mo = countMonths(r.from, r.to);
      return s + (mo !== null ? (+r.monthlyBase||0) * mo : 0);
    }, 0);
    const hasPeriods = items.some((r) => r.from && r.to);
    return { ...g, total: monthlyTotal, count: items.length, periodTotal, hasPeriods };
  });
  const filtered = D.research.filter((r) => {
    if (filter && !r.category.toLowerCase().includes(filter.toLowerCase())) return false;
    if (monthFilter) {
      const md = new Date(monthFilter + "-01T00:00:00Z");
      if (r.from && md < new Date(r.from + "-01T00:00:00Z")) return false;
      if (r.to   && md > new Date(r.to   + "-01T00:00:00Z")) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        {sums.map((g) => (
          <div key={g.id} className="bg-white border border-gray-200 rounded-lg p-3 flex-1 min-w-[140px]">
            <div className="text-xs text-gray-400 font-medium">{g.code}</div>
            <div className="text-lg font-medium text-gray-800 mt-1">{f$(g.total)}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
            {g.hasPeriods && <div className="text-xs text-blue-700 font-medium mt-0.5">{f$(g.periodTotal)} total committed</div>}
            <div className="text-xs text-gray-400 mt-0.5">{g.count} items · IDC {g.idcExempt?"exempt":fp(g.idcRate)}</div>
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
              <FL label="From month (YYYY-MM, blank = always)"><Inp type="month" value={form.from||""} onChange={(e) => setForm((f) => ({...f,from:e.target.value}))} /></FL>
              <FL label="To month (YYYY-MM, blank = ongoing)"><Inp type="month" value={form.to||""} onChange={(e) => setForm((f) => ({...f,to:e.target.value}))} /></FL>
              <FL label="Notes"><Inp value={form.notes||""} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} /></FL>
            </div>
            <div className="flex gap-2"><Btn onClick={saveResearch}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="flex gap-3 mb-3 flex-wrap items-end">
          <div>
            <div className="text-xs text-gray-400 mb-1">Filter by category</div>
            <Inp value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. Sequencing" className="max-w-xs" />
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Filter by month (reconcile)</div>
            <Inp type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40" />
          </div>
          {monthFilter && (
            <div>
              <div className="text-xs text-gray-400 mb-1">Total active this month</div>
              <div className="text-sm font-medium text-blue-700 border border-gray-200 rounded-md px-3 py-1.5 bg-white">
                {f$(filtered.reduce((s, r) => {
                  const md = new Date(monthFilter + "-01T00:00:00Z");
                  if (r.from && md < new Date(r.from + "-01T00:00:00Z")) return s;
                  if (r.to   && md > new Date(r.to   + "-01T00:00:00Z")) return s;
                  return s + (+r.monthlyBase || 0);
                }, 0))}/mo
              </div>
            </div>
          )}
          {monthFilter && <Btn onClick={() => setMonthFilter("")} v="secondary" sm>Clear month</Btn>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Category","Grant","Monthly/mo","Esc.","Active period","Period total","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r) => {
                const g = D.grants.find((g) => g.id===r.grantId);
                return (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-green-800">{r.category}</td>
                    <td className="py-2 pr-3"><Badge c="blue">{g?g.code:"—"}</Badge></td>
                    <td className="py-2 pr-3 font-medium">{f$(r.monthlyBase)}</td>
                    <td className={"py-2 pr-3 text-xs " + (+r.escalation>0?"text-amber-700 font-medium":"text-gray-400")}>{+r.escalation>0?fp(r.escalation):"—"}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">
                      {r.from || r.to
                        ? <span className="text-blue-600">{r.from||"start"} → {r.to||"ongoing"}</span>
                        : <span className="text-gray-400">full forecast</span>}
                    </td>
                    <td className="py-2 pr-3 text-sm">
                      {r.from && r.to
                        ? <span className="font-medium text-gray-800">{f$(+r.monthlyBase * countMonths(r.from, r.to))}<span className="text-xs text-gray-400 font-normal ml-1">({countMonths(r.from, r.to)}mo)</span></span>
                        : <span className="text-gray-400 text-xs">ongoing</span>}
                    </td>
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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">Changes here update all forecasts instantly. Base monthly = current salary or stipend. PhD & MSc students are treated as flat (no annual increase). Staff and postdocs escalate annually from April 2025 forward.</div>
        <Row label="Postdoc — annual salary increase" desc="Compounded from April 2025 forward" k="postdocInc" step="0.001" min="0" max="0.2" fmt={fp} />
        <Row label="Postdoc — benefits rate" desc="CPP, EI, health, vacation as % of postdoc salary" k="postdocBenefits" step="0.01" min="0" max="0.5" fmt={fp} />
        <Row label="Research Staff — annual salary increase" desc="Compounded from April 2025 forward" k="staffInc" step="0.001" min="0" max="0.2" fmt={fp} />
        <Row label="Research Staff — benefits rate" desc="CPP, EI, health, vacation as % of staff salary" k="staffBenefits" step="0.01" min="0" max="0.5" fmt={fp} />

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
  const [saveError, setSaveError] = useState(null);
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
      setSaveError("Load error: " + (e.message || "Unknown") + ". Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel Settings.");
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
      setSaveError(e.message || "Unknown error");
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
        <SyncBar state={syncState} meta={syncMeta} onSync={loadFromServer} onSave={saveToServer} saveError={saveError} />
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
