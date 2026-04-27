/**
 * Lab Grant Management System — Core Application
 * ════════════════════════════════════════════════
 * Original system developed by Madhumitha Rangesa
 * Yachie Lab · UBC School of Biomedical Engineering · Vancouver, Canada
 * github.com/madhurangesa/lab-gms · 2025
 *
 * Licensed under CC BY-NC 4.0 — free for academic research use.
 * Not for commercial use. Attribution must be preserved.
 *
 * To customise this app for your lab, edit config.js.
 * Do not modify this file unless you are adding new features.
 * ════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Head from "next/head";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Lab configuration (edit config.js, not this file) ───────────────────────
let LAB_CONFIG = {};
try { LAB_CONFIG = require("../config.js"); } catch(e) {}
const LAB_NAME       = LAB_CONFIG.labName       || "Yachie Lab";
const LAB_SUBTITLE   = LAB_CONFIG.labSubtitle   || "Grant Management System";
const PAGE_TITLE     = LAB_CONFIG.pageTitle      || "Lab GMS";
const HEADER_COLOR   = LAB_CONFIG.headerColor    || "#1e3a5f";
const FC0_CONFIG     = LAB_CONFIG.forecastStart  || "2025-04-01";
const CATS_CONFIG    = LAB_CONFIG.categories     || null;
const ROLES_CONFIG   = LAB_CONFIG.roles          || null;

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
  // The end date is what controls when forecasting stops. payRunFrac handles partial months.
  if (!p || !p.startDate) return false;
  // Check if person has ANY active days in this month
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const personStart = new Date(p.startDate + "T00:00:00Z");
  if (personStart > monthEnd) return false; // starts after this month ends
  if (p.endDate) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const personEnd = new Date(p.endDate + "T00:00:00Z");
    if (personEnd < monthStart) return false; // ended before this month started
  }
  return true;
}
function moLbl(d) { return d.toLocaleDateString("en-US", { year: "2-digit", month: "short", timeZone: "UTC" }); }
function moLeft(s) { if (!s) return null; return Math.ceil((new Date(s) - new Date()) / (1000 * 60 * 60 * 24 * 30.4)); }

const FC0 = FC0_CONFIG;
const FCN_DEFAULT = 36;
const GC = ["#185FA5","#0F6E56","#854F0B","#3B6D11","#534AB7","#993C1D","#5F5E5A","#712B13"];
const ROLES = ROLES_CONFIG || ["PhD Student","MSc Student","Postdoc","Research Associate","Research Staff","Undergraduate","Prospective Student"];
function countMonths(from, to) {
  if (!from || !to) return null;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

const CATS = CATS_CONFIG || ["Sequencing-NGS","Sequencing-LongRead","Sequencing-Sanger","Animals-PerDiem","Animals-Procedures","Animals-Genotyping","Consumables-MolBio","Consumables-CellCulture","DNA-Synthesis","Computing-Cloud","Services-Core","Services-Maintenance","Travel","General"];
const RS = {
  critical:     { bg:"bg-red-50",    border:"border-red-300",    badge:"bg-red-100 text-red-800",       lbl:"Critical" },
  high:         { bg:"bg-orange-50", border:"border-orange-300", badge:"bg-orange-100 text-orange-800", lbl:"Urgent" },
  medium:       { bg:"bg-amber-50",  border:"border-amber-200",  badge:"bg-amber-100 text-amber-800",   lbl:"Review" },
  fellowship:   { bg:"bg-green-50",  border:"border-green-300",  badge:"bg-green-100 text-green-800",   lbl:"Fellowship" },
  ok:           { bg:"bg-blue-50",   border:"border-blue-200",   badge:"bg-blue-100 text-blue-800",     lbl:"On track" },
  unallocated:  { bg:"bg-yellow-50", border:"border-yellow-400", badge:"bg-yellow-100 text-yellow-800", lbl:"Unallocated" },
};

// Returns the date (as string) from which a person has no allocation, or null if fully covered
function firstUnallocatedDate(p) {
  if (!p || !p.startDate) return null;
  const allocs = (p.allocations || []).filter((a) => a.grantId);
  if (!allocs.length) return p.startDate;

  // Find the latest allocation end date
  let latestEnd = null;
  let hasOpenEnded = false;
  allocs.forEach((a) => {
    if (!a.to) { hasOpenEnded = true; return; }
    const d = new Date(a.to + "T00:00:00Z");
    if (!latestEnd || d > latestEnd) latestEnd = d;
  });

  if (hasOpenEnded) return null; // at least one allocation goes to infinity

  if (!latestEnd) return p.startDate;

  // If person has an end date and allocations cover up to it, no gap
  if (p.endDate) {
    const personEnd = new Date(p.endDate + "T00:00:00Z");
    if (latestEnd >= personEnd) return null;
  }

  // Gap starts the day after the last allocation ends
  const gapStart = new Date(latestEnd);
  gapStart.setUTCDate(gapStart.getUTCDate() + 1);
  const today = new Date();
  // Only warn if gap is in the future
  if (gapStart < today) {
    // Gap already started — still warn
  }
  return gapStart.toISOString().slice(0, 10);
}

const ES = {
  postdocInc: 0.035, staffInc: 0.035,
  // benefits rates now per-person, not global
  // Tuition monthly rates (annual / 12)
  domPhDYr12: 708, domPhDYr3plus: 708,
  intlPhDYr12: 1833, intlPhDYr3plus: 1833,
  domMScYr12: 708, domMScYr2plus: 708,
  intlMScYr12: 1833, intlMScYr2plus: 1833,
  tuitionEscalation: 0.03,
};
const BLANK = { settings: { ...ES }, grants: [], inflows: [], people: [], research: [], fellowships: [], actuals: [] };

function safe(d) {
  if (!d || typeof d !== "object") return { settings: { ...ES }, grants: [], inflows: [], people: [], research: [], fellowships: [] };
  return {
    settings:    (d.settings && typeof d.settings === "object") ? d.settings : { ...ES },
    grants:      Array.isArray(d.grants)      ? d.grants      : [],
    inflows:     Array.isArray(d.inflows)     ? d.inflows     : [],
    people:      Array.isArray(d.people)      ? d.people      : [],
    research:    Array.isArray(d.research)    ? d.research    : [],
    fellowships: Array.isArray(d.fellowships) ? d.fellowships : [],
    actuals:     Array.isArray(d.actuals)     ? d.actuals     : [],
  };
}

// ── Tuition lookup ───────────────────────────────────────────────────────────
function getTuitionMonthly(p, md, settings) {
  const isPhD = p.role === "PhD Student";
  const isMSc = p.role === "MSc Student";
  if (!isPhD && !isMSc) return 0;

  const status = p.studentStatus || "Domestic";
  if (status === "N/A") return 0;

  const isIntl = status === "International";
  const yearInProg = Math.floor(yrs(p.startDate || FC0, md)) + 1;

  // Pick the right base rate
  let baseRate = 0;
  if (isPhD) {
    baseRate = yearInProg <= 2
      ? (isIntl ? (+settings.intlPhDYr12  || 0) : (+settings.domPhDYr12    || 0))
      : (isIntl ? (+settings.intlPhDYr3plus || 0) : (+settings.domPhDYr3plus  || 0));
  } else {
    baseRate = yearInProg <= 1
      ? (isIntl ? (+settings.intlMScYr12  || 0) : (+settings.domMScYr12    || 0))
      : (isIntl ? (+settings.intlMScYr2plus || 0) : (+settings.domMScYr2plus  || 0));
  }

  // Apply annual tuition escalation from FC0
  const esc = +settings.tuitionEscalation || 0;
  return baseRate * Math.pow(1 + esc, Math.max(0, yrs(FC0, md)));
}

// ── Fellowship offset ─────────────────────────────────────────────────────────
function getFellowshipOffset(p, md, fellowships) {
  if (!p.fellowshipId || !p.fellowshipStart) return { stipend: 0, coversTuition: false, tuitionAmount: 0 };
  const fel = (fellowships || []).find((f) => f.id === p.fellowshipId);
  if (!fel) return { stipend: 0, coversTuition: false, tuitionAmount: 0 };

  const start = new Date(p.fellowshipStart + "T00:00:00Z");
  if (md < start) return { stipend: 0, coversTuition: false, tuitionAmount: 0 };

  // Check duration
  const maxMo = +fel.maxMonths || 999;
  const moElapsed = Math.round((md - start) / (1000 * 60 * 60 * 24 * 30.4));
  if (moElapsed >= maxMo) return { stipend: 0, coversTuition: false, tuitionAmount: 0 };

  return {
    stipend:       +fel.stipendMonthly || 0,
    coversTuition: !!fel.coversTuition,
    tuitionAmount: +fel.tuitionAmount || 0,
  };
}

// ── UBC Payroll helper ────────────────────────────────────────────────────────
// UBC pays twice a month: the 15th and the last day of the month.
// Each pay run = 0.5 of monthly salary.
// For each run we check: is this person active on that date AND on this grant?
// First month: if person starts after the 15th, they only get the month-end run (0.5).
//              if they start on or before the 15th, they get both runs (1.0).
//              if they start after the last day, they get nothing (0).
// Last month: same logic in reverse for end date.
// Mid-career grant switch: whichever grant they're on ON the pay date gets that run.

function payRunFrac(alloc, person, md, grantId, allAllocs) {
  const year  = md.getUTCFullYear();
  const month = md.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const payDates = [
    new Date(Date.UTC(year, month, 15)),
    new Date(Date.UTC(year, month, lastDay)),
  ];

  let totalFrac = 0;

  payDates.forEach((payDate) => {
    // Check person is active on this pay date
    if (person.startDate) {
      const ps = new Date(person.startDate + "T00:00:00Z");
      // First month proration: if start is after the 15th, skip the 15th pay run
      if (ps > payDate) return;
    }
    if (person.endDate) {
      const pe = new Date(person.endDate + "T00:00:00Z");
      if (pe < payDate) return;
    }

    // Find which allocation is active on this specific pay date
    const activeAlloc = (allAllocs || []).find((a) => {
      if (!a || a.grantId !== grantId) return false;
      if (a.from && payDate < new Date(a.from + "T00:00:00Z")) return false;
      if (a.to   && payDate > new Date(a.to   + "T00:00:00Z")) return false;
      return true;
    });

    if (activeAlloc) {
      totalFrac += 0.5 * (+activeAlloc.fraction || 0);
    }
  });

  return totalFrac;
}

function forecast(raw, fcMonths) {
  const D = safe(raw);
  const ag = D.grants.filter((g) => g && g.active);
  if (!ag.length) return [];
  const bal = {};
  ag.forEach((g) => { bal[g.id] = +g.totalAward || 0; });
  const N = fcMonths || FCN_DEFAULT;
  return Array.from({ length: N }, (_, mi) => {
    const md = addMo(FC0, mi);
    const [my, mm] = [md.getUTCFullYear(), md.getUTCMonth()];
    const row = { label: moLbl(md), tP: 0, tR: 0, tIDC: 0, tI: 0 };
    ag.forEach((g, gi) => {
      let pers = 0, res = 0, inf = 0;
      D.people.forEach((p) => {
        if (!active(p, md)) return;
        const allocs = Array.isArray(p.allocations) ? p.allocations : [];
        // Use UBC payroll logic: check allocation on the 15th and last day of month
        const payFrac = payRunFrac(null, p, md, g.id, allocs);
        if (!payFrac) return;
        // Keep alloc reference for salary history resolution
        const alloc = allocs.find((a) => {
          if (!a || a.grantId !== g.id) return false;
          if (a.from && md < new Date(a.from + "T00:00:00Z")) return false;
          if (a.to   && md > new Date(a.to   + "T00:00:00Z")) return false;
          return true;
        });
        const frac = 1; // payFrac already incorporates the allocation fraction
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
        // Benefits rate: use period-specific rate if set, otherwise fall back to person rate
        const benRate    = (activeRate && activeRate.benefitsRate) ? +activeRate.benefitsRate : (+p.benefitsRate || 0.21);
        // No automatic annual escalation — use salary history to record raises manually
        const sc = baseThisMonth;

        // Tuition (students only) and fellowship offset
        const tuition = getTuitionMonthly(p, md, D.settings);
        const felOff  = getFellowshipOffset(p, md, D.fellowships || []);
        // Grant pays: stipend minus fellowship stipend (floor 0) + tuition minus fellowship tuition coverage
        const grantStipend  = Math.max(0, sc - felOff.stipend);
        const grantTuition  = felOff.coversTuition ? Math.max(0, tuition - felOff.tuitionAmount) : tuition;
        const grossCost     = isStudent
          ? (grantStipend + grantTuition)
          : sc * (p.benefits ? 1 + benRate : 1);
        pers += grossCost * payFrac;
      });
      D.research.filter((r) => {
        if (!r || r.grantId !== g.id) return false;
        if (r.from && md < new Date(r.from + "-01T00:00:00Z")) return false;
        if (r.to   && md > new Date(r.to   + "-01T00:00:00Z")) return false;
        return true;
      }).forEach((r) => {
        res += (+r.monthlyBase || 0) * Math.pow(1 + (+r.escalation || 0), Math.floor(Math.max(0, yrs(g.startDate || FC0, md))));
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

function PerGrantTooltip({ active: a, payload, label, fc, gi, data, grantId }) {
  if (!a || !payload || !payload.length) return null;
  const row = fc.find((r) => r.label === label);
  if (!row) return null;
  const bal   = row["b"+gi];
  const spend = row["sp"+gi];
  const pers  = row["p"+gi];
  const res   = row["r"+gi];
  const idc   = row["idc"+gi];

  // Build per-person breakdown for this month
  const D = safe(data);
  const g = D.grants.find((g) => g.id === grantId);

  // Find the forecast month date from FC0
  const fc0 = new Date(FC0 + "T00:00:00Z");
  const rowIdx = fc.findIndex((r) => r.label === label);
  const md = addMo(FC0, rowIdx);

  const personBreakdown = D.people
    .filter((p) => {
      if (!active(p, md)) return false;
      const allocs = Array.isArray(p.allocations) ? p.allocations : [];
      const alloc = allocs.find((al) => {
        if (!al || al.grantId !== grantId) return false;
        if (al.from && md < new Date(al.from + "T00:00:00Z")) return false;
        if (al.to   && md > new Date(al.to   + "T00:00:00Z")) return false;
        return true;
      });
      return !!alloc;
    })
    .map((p) => {
      const allocs = Array.isArray(p.allocations) ? p.allocations : [];
      const alloc = allocs.find((al) => {
        if (!al || al.grantId !== grantId) return false;
        if (al.from && md < new Date(al.from + "T00:00:00Z")) return false;
        if (al.to   && md > new Date(al.to   + "T00:00:00Z")) return false;
        return true;
      });
      const frac = +(alloc || {}).fraction || 0;

      // Resolve base
      const history = Array.isArray(p.salaryHistory) ? p.salaryHistory : [];
      const activeRate = history.find((h) => {
        if (!h || !h.base) return false;
        if (h.from && md < new Date(h.from + "T00:00:00Z")) return false;
        if (h.to   && md > new Date(h.to   + "T00:00:00Z")) return false;
        return true;
      });
      const baseThisMonth = activeRate ? (+activeRate.base || 0) : (+p.baseMonthly || 0);

      const isStudent = ["PhD Student","MSc Student"].includes(p.role);
      const isPostdoc = p.role === "Postdoc";
      const benRate   = (activeRate && activeRate.benefitsRate) ? +activeRate.benefitsRate : (+p.benefitsRate || 0.21);
      const sc        = baseThisMonth;

      const tuition  = getTuitionMonthly(p, md, D.settings);
      const felOff   = getFellowshipOffset(p, md, D.fellowships || []);
      const grantStipend = Math.max(0, sc - felOff.stipend);
      const grantTuition = felOff.coversTuition ? Math.max(0, tuition - felOff.tuitionAmount) : tuition;
      const grossCost    = isStudent
        ? (grantStipend + grantTuition)
        : sc * (p.benefits ? 1 + benRate : 1);
      const costThisGrant = Math.round(grossCost * frac);

      // Build breakdown label
      const parts = [];
      if (!isStudent && p.benefits) parts.push("incl. " + fp(benRate) + " benefits");
      if (tuition > 0 && grantTuition > 0) parts.push("incl. " + f$(Math.round(grantTuition)) + " tuition");
      if (felOff.stipend > 0) parts.push("–" + f$(felOff.stipend) + " fellowship");

      return { name: p.name || p.role, cost: costThisGrant, parts, frac };
    })
    .filter((p) => p.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs" style={{minWidth:220, maxWidth:300}}>
      <div className="font-medium text-gray-700 mb-2 border-b border-gray-100 pb-1">{label}</div>
      {bal !== undefined && (
        <div className="flex justify-between gap-4 mb-2">
          <span className="text-gray-500">Balance</span>
          <span className={"font-medium " + (bal < 0 ? "text-red-600" : "text-gray-800")}>{f$(bal)}</span>
        </div>
      )}
      <div className="border-t border-gray-100 pt-1">
        <div className="text-gray-400 mb-1 uppercase tracking-wide" style={{fontSize:10}}>This month spend</div>
        {spend !== undefined && (
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-gray-600 font-medium">Total</span>
            <span className="font-medium text-gray-800">{f$(spend)}</span>
          </div>
        )}
        {pers !== undefined && (
          <div className="mb-1">
            <div className="flex justify-between gap-4 mb-0.5">
              <span className="text-gray-500">↳ Personnel</span>
              <span className="text-gray-700 font-medium">{f$(pers)}</span>
            </div>
            {personBreakdown.map((p, i) => (
              <div key={i} className="flex justify-between gap-2 pl-3 mb-0.5">
                <div>
                  <span className="text-gray-400">{p.name}</span>
                  {p.frac < 1 && <span className="text-gray-300 ml-1">({(p.frac*100).toFixed(0)}%)</span>}
                  {p.parts.length > 0 && (
                    <div className="text-gray-300" style={{fontSize:9}}>{p.parts.join(" · ")}</div>
                  )}
                </div>
                <span className="text-gray-500 flex-shrink-0">{f$(p.cost)}</span>
              </div>
            ))}
          </div>
        )}
        {res !== undefined && (
          <div className="flex justify-between gap-4 mb-0.5">
            <span className="text-gray-400">↳ Research</span>
            <span className="text-gray-600">{f$(res)}</span>
          </div>
        )}
        {idc !== undefined && idc > 0 && (
          <div className="flex justify-between gap-4 mb-0.5">
            <span className="text-gray-400">↳ IDC</span>
            <span className="text-gray-600">{f$(idc)}</span>
          </div>
        )}
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

function PerGrantChart({ ag, fc, data }) {
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

  // Build actuals running balance per grant
  const D = safe(data);
  const chartData = fc.map((row, idx) => {
    const r = { label: row.label };
    ag.forEach((g, gi) => {
      if (sel === "all" || sel === g.id) r["b"+gi] = row["b"+gi];
    });
    // Add actuals running balance for selected grant
    if (sel !== "all" && selIdx >= 0) {
      const g = ag[selIdx];
      if (g) {
        // Sum all actuals up to and including this month
        const fc0 = new Date(FC0 + "T00:00:00Z");
        const md = addMo(FC0, idx);
        const monthKey = md.toISOString().slice(0, 7); // YYYY-MM
        const cumulativeActuals = (D.actuals || [])
          .filter((a) => a.grantId === g.id && a.month <= monthKey)
          .reduce((s, a) => s + (+a.amount || 0), 0);
        if (cumulativeActuals > 0) {
          r["actualBal"+selIdx] = Math.round(+g.totalAward - cumulativeActuals);
        }
      }
    }
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
              ? <PerGrantTooltip fc={fc} gi={selIdx} data={data} grantId={ag[selIdx] ? ag[selIdx].id : ""} />
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
          {sel !== "all" && selIdx >= 0 && (
            <Line type="monotone" dataKey={"actualBal"+selIdx} name="Actual balance" stroke="#276221" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
      {sel !== "all" && selIdx >= 0 && <GrantSummary g={ag[selIdx]} gi={selIdx} fc={fc} />}
    </div>
  );
}


// ── Scenario Panel ────────────────────────────────────────────────────────────
const SC_PERSON_BLANK = { id:"", name:"", role:"PhD Student", studentStatus:"Domestic", startDate:"", baseMonthly:"", grantId:"", fraction:"1", fellowshipId:"", notes:"" };

function ScenarioPanel({ data, fc, scenarioPeople, setScenarioPeople, scenarioLabel, setScenarioLabel }) {
  const D = safe(data);
  const [form, setForm] = useState(null);

  function saveScPerson() {
    if (!form.role || !form.startDate || !form.baseMonthly) return alert("Role, start date and base monthly required.");
    const entry = {...form, id: form.id || uid()};
    if (form.id && scenarioPeople.find((p) => p.id === form.id)) {
      setScenarioPeople(scenarioPeople.map((p) => p.id === form.id ? entry : p));
    } else {
      setScenarioPeople([...scenarioPeople, entry]);
    }
    setForm(null);
  }

  function removeScPerson(id) {
    setScenarioPeople(scenarioPeople.filter((p) => p.id !== id));
  }

  // Merge scenario people into data for forecast
  const scData = {
    ...safe(data),
    people: [
      ...safe(data).people,
      ...scenarioPeople.map((p) => ({
        ...p,
        active: true,
        benefits: ["Postdoc","Research Staff"].includes(p.role),
        benefitsRate: p.benefitsRate || 0.21,
        salaryHistory: [],
        allocations: p.grantId ? [{ grantId: p.grantId, fraction: +p.fraction || 1, from:"", to:"" }] : [],
      })),
    ],
  };
  const fcSc = forecast(scData);

  // Build combined chart data for overlay
  const chartData = fc.map((row, i) => ({
    ...row,
    scPortBal: fcSc[i] ? fcSc[i].portBal : null,
    scSpend:   fcSc[i] ? fcSc[i].tSpend : null,
  }));

  // Diff metrics
  const realEnd  = fc.length   ? fc[fc.length-1].portBal   : 0;
  const scEnd    = fcSc.length ? fcSc[fcSc.length-1].portBal : 0;
  const diff     = scEnd - realEnd;
  const realBurn = fc.length   ? Math.round(fc.reduce((s,r)=>s+r.tSpend,0)/fc.length)   : 0;
  const scBurn   = fcSc.length ? Math.round(fcSc.reduce((s,r)=>s+r.tSpend,0)/fcSc.length) : 0;

  function handlePrint() {
    window.print();
  }

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-medium text-amber-900">Scenario mode — back of envelope</div>
          <div className="text-xs text-amber-700 mt-0.5">Hypothetical people below are overlaid on real forecast. Nothing is saved.</div>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={scenarioLabel}
            onChange={(e) => setScenarioLabel(e.target.value)}
            placeholder="Label this scenario..."
            className="border border-amber-300 rounded-md px-3 py-1.5 text-xs bg-white w-48 focus:outline-none"
          />
          <button onClick={handlePrint}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-700 text-white hover:bg-amber-800 no-print">
            Print
          </button>
          <button onClick={() => setScenarioPeople([])}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 no-print">
            Clear all
          </button>
        </div>
      </div>

      {/* Comparison metrics */}
      <div id="scenario-print-area">
        {scenarioLabel && (
          <div className="text-sm font-medium text-amber-900 mb-2 print-only" style={{display:"none"}}>{scenarioLabel} — {new Date().toLocaleDateString()}</div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))"}}>
          {[
            ["Real burn/mo",     f$(realBurn),  false],
            ["Scenario burn/mo", f$(scBurn),    scBurn > realBurn],
            ["Real balance (36mo)",     f$(realEnd), realEnd < 0],
            ["Scenario balance (36mo)", f$(scEnd),   scEnd < 0],
            ["Impact",          (diff >= 0 ? "+" : "") + f$(Math.round(diff)), diff < 0],
          ].map(([lbl, val, warn]) => (
            <div key={lbl} className={"rounded-lg p-3 text-center " + (warn ? "bg-red-50 border border-red-200" : "bg-white border border-amber-200")}>
              <div className="text-xs text-gray-400 mb-1">{lbl}</div>
              <div className={"text-sm font-medium " + (warn ? "text-red-600" : "text-gray-800")}>{val}</div>
            </div>
          ))}
        </div>

        {/* Overlay chart */}
        <div className="bg-white rounded-lg border border-amber-200 p-3">
          <div className="text-xs text-gray-500 mb-2">
            <span className="inline-block w-8 border-t-2 border-blue-500 mr-1" style={{verticalAlign:"middle"}}></span>Real portfolio &nbsp;
            <span className="inline-block w-8 border-t-2 border-dashed border-amber-500 mr-1" style={{verticalAlign:"middle"}}></span>Scenario
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{top:4,right:8,left:8,bottom:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{fontSize:10}} interval={5} />
              <YAxis tickFormatter={fk} tick={{fontSize:10}} width={52} />
              <Tooltip content={<TT />} />
              <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5} />
              <Legend iconType="line" iconSize={10} wrapperStyle={{fontSize:11}} />
              <Line type="monotone" dataKey="portBal" name="Real" stroke="#185FA5" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="scPortBal" name="Scenario" stroke="#BA7517" strokeWidth={2} strokeDasharray="6 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Add hypothetical people */}
      <div className="no-print">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-amber-900">Hypothetical people ({scenarioPeople.length})</div>
          <button onClick={() => setForm({...SC_PERSON_BLANK})}
            className="px-3 py-1 rounded text-xs font-medium bg-amber-700 text-white hover:bg-amber-800">
            + Add person
          </button>
        </div>

        {form && (
          <div className="bg-white border border-amber-300 rounded-lg p-3 mb-3">
            <div className="text-xs font-medium text-amber-800 mb-2">{form.id ? "Edit" : "New hypothetical person"}</div>
            <div className="grid gap-2 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))"}}>
              <div><label className="block text-xs text-gray-500 mb-1">Label (optional)</label>
                <input className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none" value={form.name} onChange={(e)=>setForm((f)=>({...f,name:e.target.value}))} placeholder="e.g. New postdoc"/></div>
              <div><label className="block text-xs text-gray-500 mb-1">Role</label>
                <select className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none" value={form.role} onChange={(e)=>setForm((f)=>({...f,role:e.target.value}))}>
                  {ROLES.map((r)=><option key={r}>{r}</option>)}
                </select></div>
              {["PhD Student","MSc Student"].includes(form.role) && (
                <div><label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none" value={form.studentStatus||"Domestic"} onChange={(e)=>setForm((f)=>({...f,studentStatus:e.target.value}))}>
                    <option>Domestic</option><option>International</option>
                  </select></div>
              )}
              <div><label className="block text-xs text-gray-500 mb-1">Start date *</label>
                <input type="date" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none" value={form.startDate} onChange={(e)=>setForm((f)=>({...f,startDate:e.target.value}))}/></div>
              <div><label className="block text-xs text-gray-500 mb-1">Base monthly ($) *</label>
                <input type="number" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none" value={form.baseMonthly} onChange={(e)=>setForm((f)=>({...f,baseMonthly:e.target.value}))}/></div>
              <div><label className="block text-xs text-gray-500 mb-1">Charge to grant</label>
                <select className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none" value={form.grantId} onChange={(e)=>setForm((f)=>({...f,grantId:e.target.value}))}>
                  <option value="">Select grant...</option>
                  {D.grants.filter((g)=>g.active).map((g)=><option key={g.id} value={g.id}>{g.code}</option>)}
                </select></div>
              <div><label className="block text-xs text-gray-500 mb-1">Fraction</label>
                <input type="number" min="0" max="1" step="0.1" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none" value={form.fraction} onChange={(e)=>setForm((f)=>({...f,fraction:e.target.value}))}/></div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveScPerson} className="px-4 py-2 rounded-md text-sm font-medium bg-amber-700 text-white hover:bg-amber-800">Add to scenario</button>
              <button onClick={()=>setForm(null)} className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        )}

        {scenarioPeople.length > 0 && (
          <div className="space-y-2">
            {scenarioPeople.map((p) => {
              const g = D.grants.find((g)=>g.id===p.grantId);
              const tui = getTuitionMonthly({...p, active:true}, new Date(), D.settings);
              const cost = +p.baseMonthly + tui;
              return (
                <div key={p.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <div className="text-xs">
                    <span className="font-medium text-gray-800">{p.name||p.role}</span>
                    <span className="text-gray-500 ml-2">{p.role}</span>
                    {["PhD Student","MSc Student"].includes(p.role) && <span className="text-amber-700 ml-1">({p.studentStatus||"Domestic"})</span>}
                    <span className="text-gray-500 ml-2">from {p.startDate}</span>
                    <span className="text-gray-500 ml-2">{f$(cost)}/mo{tui>0?" (incl. tuition)":""}</span>
                    {g && <span className="text-blue-600 ml-2">→ {g.code} ({(+p.fraction*100).toFixed(0)}%)</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={()=>setForm({...p})} className="text-xs text-blue-500 hover:text-blue-700 px-2">Edit</button>
                    <button onClick={()=>removeScPerson(p.id)} className="text-xs text-red-400 hover:text-red-600 px-2">x</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {scenarioPeople.length === 0 && !form && (
          <div className="text-center py-4 text-xs text-amber-600">No hypothetical people added yet. Click "+ Add person" to model hiring scenarios.</div>
        )}
      </div>
    </div>
  );
}

function Dashboard({ data, fc, fcMonths, setFcMonths }) {
  const [tab, setTab] = useState("portfolio");
  const [scenarioOn, setScenarioOn] = useState(false);
  const [scenarioPeople, setScenarioPeople] = useState([]);
  const [scenarioLabel, setScenarioLabel] = useState("");
  const [excludedGrants, setExcludedGrants] = useState([]);

  function toggleExclude(id) {
    setExcludedGrants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  const D = safe(data);
  const ag = D.grants.filter((g) => g && g.active);
  // Filter metrics by visible grants (respects excludedGrants toggle)
  const visibleAg = ag.filter((g) => !excludedGrants.includes(g.id));
  const totalAward = visibleAg.reduce((s, g) => s + (+g.totalAward || 0), 0);

  // Per-grant index lookup for visible grants
  const lastBal = fc.length
    ? Math.round(visibleAg.reduce((s, g) => {
        const gi = ag.indexOf(g);
        return s + (fc[fc.length-1]["b"+gi] || 0);
      }, 0))
    : 0;

  const avgPersonnel = fc.length ? Math.round(
    fc.reduce((s, r) => s + visibleAg.reduce((gs, g) => gs + (r["p"+ag.indexOf(g)] || 0), 0), 0) / fc.length
  ) : 0;
  const avgResearch = fc.length ? Math.round(
    fc.reduce((s, r) => s + visibleAg.reduce((gs, g) => gs + (r["r"+ag.indexOf(g)] || 0), 0), 0) / fc.length
  ) : 0;
  const avgIDC = fc.length ? Math.round(
    fc.reduce((s, r) => s + visibleAg.reduce((gs, g) => gs + (r["idc"+ag.indexOf(g)] || 0), 0), 0) / fc.length
  ) : 0;

  const biIdx = fc.findIndex((r) =>
    visibleAg.reduce((s, g) => s + (r["b"+ag.indexOf(g)] || 0), 0) < 0
  );
  const tabs = [["portfolio","Portfolio balance"],["pergrant","Per-grant"],["burn","Monthly burn"],["idc","IDC breakdown"],["cashflow","Cash flow"]];
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-start">
        <Metric label="Total portfolio" value={f$(totalAward)} sub={visibleAg.length + " of " + ag.length + " grant" + (ag.length!==1?"s":"") + (excludedGrants.length > 0 ? " shown" : "")} />
        <Metric label="Avg monthly personnel" value={f$(avgPersonnel)} sub="salaries + benefits + tuition" />
        <Metric label="Avg monthly research" value={f$(avgResearch)} sub="non-personnel direct costs" />
        <Metric label="Avg monthly IDC" value={f$(avgIDC)} sub="overhead charged" />
        <Metric label={"Balance at " + fc.length + "mo"} value={f$(lastBal)} sub="end of forecast" warn={lastBal<0} />
        <div className="flex-shrink-0 pt-1 space-y-1">
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Forecast</span>
            <input
              type="range"
              min="6"
              max="60"
              step="6"
              value={fcMonths}
              onChange={(e) => setFcMonths(+e.target.value)}
              className="w-28"
            />
            <span className="text-xs font-medium text-blue-700 min-w-[32px]">{fcMonths}mo</span>
          </div>
          <button
            onClick={() => setScenarioOn((v) => !v)}
            className={"w-full px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors no-print " +
              (scenarioOn
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-white text-amber-700 border-amber-400 hover:bg-amber-50")}
          >
            {scenarioOn ? "Exit scenario mode" : "Scenario mode"}
          </button>
        </div>
      </div>
      <Card>
        <div className="flex gap-2 flex-wrap mb-4">
          {tabs.map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} className={"px-3 py-1.5 rounded-md text-xs font-medium " + (tab===k?"bg-blue-700 text-white":"bg-gray-100 text-gray-600 hover:bg-gray-200")}>{l}</button>
          ))}
        </div>
        {tab==="portfolio" && (() => {
          // Build filtered chart data excluding unchecked grants
          // visibleAg defined above in Dashboard scope
          const filteredData = fc.map((row) => {
            const filteredBal = ag.reduce((s, g, gi) => {
              if (excludedGrants.includes(g.id)) return s;
              return s + (row["b"+gi] || 0);
            }, 0);
            return { ...row, filteredPortBal: Math.round(filteredBal) };
          });
          const filteredBankrupt = filteredData.findIndex((r) => r.filteredPortBal < 0);
          return (
            <div>
              {/* Grant filter toggles */}
              <div className="flex gap-2 flex-wrap mb-3 items-center">
                <span className="text-xs text-gray-400">Include:</span>
                {ag.map((g, gi) => {
                  const excluded = excludedGrants.includes(g.id);
                  return (
                    <button key={g.id} onClick={() => toggleExclude(g.id)}
                      className={"px-3 py-1 rounded text-xs font-medium border transition-colors " +
                        (excluded
                          ? "bg-white text-gray-400 border-gray-200 line-through"
                          : "text-white border-transparent")}
                      style={excluded ? {} : { background: GC[gi%GC.length], borderColor: GC[gi%GC.length] }}>
                      {g.code}
                    </button>
                  );
                })}
                {excludedGrants.length > 0 && (
                  <button onClick={() => setExcludedGrants([])}
                    className="text-xs text-blue-500 hover:text-blue-700 ml-1">
                    Show all
                  </button>
                )}
                {excludedGrants.length > 0 && (
                  <span className="text-xs text-amber-600 ml-1">
                    Portfolio without {excludedGrants.map((id) => ag.find((g) => g.id===id)?.code).filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={filteredData} margin={{ top:4, right:8, left:8, bottom:4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize:10 }} interval={5} />
                  <YAxis tickFormatter={fk} tick={{ fontSize:10 }} width={52} />
                  <Tooltip content={<TT />} />
                  <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="5 3" strokeWidth={1.5} />
                  {filteredBankrupt > 0 && (
                    <ReferenceLine x={filteredData[filteredBankrupt]?.label}
                      stroke="#E24B4A" strokeWidth={2}
                      label={{ value: "Zero", position: "insideTopLeft", fontSize: 9, fill: "#E24B4A" }} />
                  )}
                  {(() => {
                    const withEnd = visibleAg
                      .map((g) => ({ g, gi: ag.indexOf(g) }))
                      .filter(({ g }) => g.endDate)
                      .sort((a, b) => a.g.endDate > b.g.endDate ? 1 : -1);
                    const fc0 = new Date(FC0 + "T00:00:00Z");
                    const offsets = [10, 28, 46, 64, 82];
                    return withEnd.map(({ g, gi }, idx) => {
                      const end = new Date(g.endDate + "T00:00:00Z");
                      const mi = Math.round((end - fc0) / (1000 * 60 * 60 * 24 * 30.4));
                      const clamped = Math.max(0, Math.min(fc.length - 1, mi));
                      const lbl = fc[clamped] ? fc[clamped].label : null;
                      if (!lbl) return null;
                      return (
                        <ReferenceLine key={"pend-"+g.id} x={lbl}
                          stroke={GC[gi%GC.length]} strokeDasharray="6 3" strokeWidth={1.5}
                          label={{ value: g.code, position: "insideTopRight", fontSize: 9,
                            fill: GC[gi%GC.length], fontWeight: 500, dy: offsets[idx%offsets.length] }} />
                      );
                    });
                  })()}
                  <Area type="monotone" dataKey="filteredPortBal" name="Portfolio balance" stroke="#185FA5" fill="#E6F1FB" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
        {tab==="pergrant" && <PerGrantChart ag={ag} fc={fc} data={data} />}
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
      {scenarioOn && (
        <ScenarioPanel
          data={data}
          fc={fc}
          scenarioPeople={scenarioPeople}
          setScenarioPeople={setScenarioPeople}
          scenarioLabel={scenarioLabel}
          setScenarioLabel={setScenarioLabel}
        />
      )}
    </div>
  );
}

// ── Grants ───────────────────────────────────────────────────────────────────
// ── Fiscal year breakdown helper (Apr–Mar) ───────────────────────────────────
function getFYBreakdown(data, grantId, fc) {
  const D = safe(data);
  const g = D.grants.find((g) => g.id === grantId);
  if (!g || !fc.length) return [];
  const gi = D.grants.filter((g) => g.active).findIndex((g) => g.id === grantId);
  if (gi < 0) return [];

  // Group fc rows into fiscal years (Apr = month 3 in JS, 0-indexed)
  const fyMap = {};
  fc.forEach((row) => {
    // Parse label back to date via FC0 offset
    const idx = fc.indexOf(row);
    const md = addMo(FC0, idx);
    const month = md.getUTCMonth(); // 0-indexed
    const year  = md.getUTCFullYear();
    // FY starts April (month 3) — FY2026 = Apr 2025 – Mar 2026
    const fyYear = month >= 3 ? year + 1 : year;
    const fyKey  = "FY" + fyYear;
    if (!fyMap[fyKey]) fyMap[fyKey] = { fy: fyKey, personnel: 0, research: 0, idc: 0, inflows: 0 };
    fyMap[fyKey].personnel += row["p"+gi]   || 0;
    fyMap[fyKey].research  += row["r"+gi]   || 0;
    fyMap[fyKey].idc       += row["idc"+gi] || 0;
    fyMap[fyKey].inflows   += row.tI > 0 ? (
      D.inflows.filter((i) => {
        if (i.grantId !== grantId || !i.date) return false;
        const id = new Date(i.date + "T00:00:00Z");
        return id.getUTCFullYear() === md.getUTCFullYear() && id.getUTCMonth() === md.getUTCMonth();
      }).reduce((s, i) => s + (+i.amount || 0), 0)
    ) : 0;
  });

  // Research by category per FY
  const cats = {};
  D.research.filter((r) => r.grantId === grantId).forEach((r) => {
    fc.forEach((row, idx) => {
      const md = addMo(FC0, idx);
      if (r.from && md < new Date(r.from + "-01T00:00:00Z")) return;
      if (r.to   && md > new Date(r.to   + "-01T00:00:00Z")) return;
      const month = md.getUTCMonth();
      const year  = md.getUTCFullYear();
      const fyYear = month >= 3 ? year + 1 : year;
      const fyKey  = "FY" + fyYear;
      if (!cats[fyKey]) cats[fyKey] = {};
      if (!cats[fyKey][r.category]) cats[fyKey][r.category] = 0;
      const base = (+r.monthlyBase || 0) * Math.pow(1 + (+r.escalation || 0), Math.floor(Math.max(0, yrs(g.startDate || FC0, md))));
      cats[fyKey][r.category] += base;
    });
  });

  // Personnel by person per FY
  const people = {};
  D.people.forEach((p) => {
    const allocs = (p.allocations || []).filter((a) => a.grantId === grantId);
    if (!allocs.length) return;
    fc.forEach((row, idx) => {
      const md = addMo(FC0, idx);
      if (!active(p, md)) return;
      const payFrac = payRunFrac(null, p, md, grantId, p.allocations || []);
      if (!payFrac) return;
      const history = Array.isArray(p.salaryHistory) ? p.salaryHistory : [];
      const activeRate = history.find((h) => {
        if (!h || !h.base) return false;
        if (h.from && md < new Date(h.from + "T00:00:00Z")) return false;
        if (h.to   && md > new Date(h.to   + "T00:00:00Z")) return false;
        return true;
      });
      const base = activeRate ? (+activeRate.base || 0) : (+p.baseMonthly || 0);
      const isStudent = ["PhD Student","MSc Student"].includes(p.role);
      const isPostdoc = p.role === "Postdoc";
      const benRate   = +p.benefitsRate || 0.21;
      const tuition   = getTuitionMonthly(p, md, D.settings);
      const felOff    = getFellowshipOffset(p, md, D.fellowships || []);
      const grantStipend = Math.max(0, base - felOff.stipend);
      const grantTuition = felOff.coversTuition ? Math.max(0, tuition - felOff.tuitionAmount) : tuition;
      const cost = isStudent ? (grantStipend + grantTuition) : base * (p.benefits ? 1 + benRate : 1);
      const month = md.getUTCMonth();
      const year  = md.getUTCFullYear();
      const fyYear = month >= 3 ? year + 1 : year;
      const fyKey  = "FY" + fyYear;
      if (!people[fyKey]) people[fyKey] = {};
      if (!people[fyKey][p.name||p.role]) people[fyKey][p.name||p.role] = 0;
      people[fyKey][p.name||p.role] += cost * payFrac;
    });
  });

  return Object.values(fyMap).map((fy) => ({
    ...fy,
    personnel: Math.round(fy.personnel),
    research:  Math.round(fy.research),
    idc:       Math.round(fy.idc),
    inflows:   Math.round(fy.inflows),
    total:     Math.round(fy.personnel + fy.research + fy.idc),
    net:       Math.round(fy.inflows - fy.personnel - fy.research - fy.idc),
    cats:      cats[fy.fy] || {},
    people:    people[fy.fy] || {},
  }));
}

function Grants({ data, setData, fc }) {
  const D = safe(data);
  const [form, setForm] = useState(null);
  const [infForm, setInfForm] = useState(null);
  const [expandedGrant, setExpandedGrant] = useState(null);
  const [expandedFYSection, setExpandedFYSection] = useState({});
  const [actualsGrant, setActualsGrant] = useState(null); // {fyKey: "personnel"|"research"|null}
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
        {expandedGrant && (() => {
          const g = D.grants.find((g) => g.id === expandedGrant);
          if (!g) return null;
          const fyRows = getFYBreakdown(data, expandedGrant, fc || []);
          return (
            <div className="mb-4 border border-blue-200 rounded-lg overflow-hidden">
              <div className="bg-blue-700 text-white px-4 py-2 flex items-center justify-between">
                <span className="text-sm font-medium">{g.code} — Fiscal Year Breakdown (Apr–Mar)</span>
                <button onClick={() => { setExpandedGrant(null); setExpandedFYSection({}); }} className="text-blue-200 hover:text-white text-xs px-2 py-0.5 border border-blue-500 rounded">Close</button>
              </div>
              {fyRows.length === 0 && <div className="p-4 text-xs text-gray-400">No forecast data available.</div>}
              {fyRows.map((fy) => (
                <div key={fy.fy} className="border-b border-blue-100 last:border-0">
                  <div className="flex gap-2 flex-wrap items-center px-4 py-2 bg-blue-50">
                    <span className="text-xs font-medium text-blue-800 w-16">{fy.fy}</span>
                    <button onClick={() => setExpandedFYSection((prev) => ({...prev, [expandedGrant+fy.fy]: prev[expandedGrant+fy.fy]==="personnel"?null:"personnel"}))}
                      className={"text-xs px-2 py-1 rounded border " + (expandedFYSection[expandedGrant+fy.fy]==="personnel" ? "bg-blue-700 text-white border-blue-700" : "bg-white text-blue-600 border-blue-300")}>
                      Personnel {f$(fy.personnel)}
                    </button>
                    <button onClick={() => setExpandedFYSection((prev) => ({...prev, [expandedGrant+fy.fy]: prev[expandedGrant+fy.fy]==="research"?null:"research"}))}
                      className={"text-xs px-2 py-1 rounded border " + (expandedFYSection[expandedGrant+fy.fy]==="research" ? "bg-green-700 text-white border-green-700" : "bg-white text-green-600 border-green-300")}>
                      Research {f$(fy.research)}
                    </button>
                    <span className="text-xs text-gray-500">IDC {f$(fy.idc)}</span>
                    <span className="text-xs font-medium text-gray-800">Total {f$(fy.total)}</span>
                    <span className="text-xs text-green-700">Inflows {f$(fy.inflows)}</span>
                    <span className={"text-xs font-medium " + (fy.net>=0?"text-green-700":"text-red-600")}>Net {fy.net>=0?"+":""}{f$(fy.net)}</span>
                  </div>
                  {expandedFYSection[expandedGrant+fy.fy] === "personnel" && (
                    <div className="px-6 py-2 bg-white">
                      {Object.entries(fy.people).sort((a,b)=>b[1]-a[1]).map(([name,cost]) => (
                        <div key={name} className="flex justify-between py-1 border-b border-gray-50 text-xs">
                          <span className="text-blue-700">&#8627; {name}</span>
                          <span className="font-medium text-blue-800">{f$(Math.round(cost))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {expandedFYSection[expandedGrant+fy.fy] === "research" && (
                    <div className="px-6 py-2 bg-white">
                      {Object.entries(fy.cats).sort((a,b)=>b[1]-a[1]).map(([cat,cost]) => (
                        <div key={cat} className="flex justify-between py-1 border-b border-gray-50 text-xs">
                          <span className="text-green-700">&#8627; {cat}</span>
                          <span className="font-medium text-green-800">{f$(Math.round(cost))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
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
                    <Btn onClick={() => setExpandedGrant(expandedGrant===g.id?null:g.id)} v="secondary" sm>{expandedGrant===g.id?"▲ Hide":"▼ FY"}</Btn>
                    <Btn onClick={() => setActualsGrant(actualsGrant===g.id?null:g.id)} v="secondary" sm>{actualsGrant===g.id?"▲ Actuals":"▼ Actuals"}</Btn>
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
        {actualsGrant && (() => {
          const g = D.grants.find((g) => g.id === actualsGrant);
          if (!g) return null;
          // Get last 12 months + next 3 months
          const months = [];
          const today = new Date();
          for (let i = -11; i <= 2; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
            months.push(d.toISOString().slice(0, 7));
          }
          return (
            <div className="mt-4 border border-green-200 rounded-lg overflow-hidden">
              <div className="bg-green-700 text-white px-4 py-2 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{g.code} — Actuals vs Forecast</span>
                  <span className="text-xs text-green-200 ml-3">Enter total spend per month from Workday</span>
                </div>
                <button onClick={() => setActualsGrant(null)} className="text-green-200 hover:text-white text-xs px-2 py-0.5 border border-green-500 rounded">Close</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100 bg-gray-50">
                    {["Month","Actual spend (Workday)","Forecast spend","Variance","Notes"].map((h) => (
                      <th key={h} className="py-2 px-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {months.map((month) => {
                      const existing = (D.actuals||[]).find((a) => a.grantId === g.id && a.month === month);
                      const actualAmt = existing ? +existing.amount : null;
                      // Get forecast spend for this month
                      const fc0 = new Date(FC0 + "T00:00:00Z");
                      const gi = D.grants.filter((g) => g.active).findIndex((gr) => gr.id === g.id);
                      const monthIdx = Math.round((new Date(month + "-01T00:00:00Z") - fc0) / (1000*60*60*24*30.4));
                      const fcRow = fc && fc[monthIdx];
                      const fcSpend = fcRow ? (fcRow["p"+gi]||0) + (fcRow["r"+gi]||0) + (fcRow["idc"+gi]||0) : null;
                      const variance = (actualAmt !== null && fcSpend !== null) ? actualAmt - fcSpend : null;
                      const isFuture = month > today.toISOString().slice(0,7);
                      return (
                        <tr key={month} className={"border-b border-gray-50 " + (isFuture ? "opacity-40" : "")}>
                          <td className="py-2 px-3 font-medium text-gray-700">{month}</td>
                          <td className="py-2 px-3">
                            {!isFuture && (
                              <input
                                type="number"
                                className="border border-gray-200 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:border-green-400"
                                placeholder="Enter amount"
                                defaultValue={actualAmt||""}
                                onBlur={(e) => {
                                  const val = e.target.value;
                                  setData((prev) => {
                                    const s = safe(prev);
                                    const others = (s.actuals||[]).filter((a) => !(a.grantId===g.id && a.month===month));
                                    if (val) {
                                      s.actuals = [...others, { grantId: g.id, month, amount: +val, notes: existing?.notes||"" }];
                                    } else {
                                      s.actuals = others;
                                    }
                                    return s;
                                  });
                                }}
                              />
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-600">{fcSpend !== null ? f$(Math.round(fcSpend)) : "—"}</td>
                          <td className="py-2 px-3">
                            {variance !== null ? (
                              <span className={"font-medium " + (Math.abs(variance) < 200 ? "text-green-600" : variance > 0 ? "text-red-600" : "text-amber-600")}>
                                {variance > 0 ? "+" : ""}{f$(Math.round(variance))}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-3">
                            {!isFuture && (
                              <input
                                type="text"
                                className="border border-gray-200 rounded px-2 py-1 text-xs w-40 focus:outline-none"
                                placeholder="Optional note"
                                defaultValue={existing?.notes||""}
                                onBlur={(e) => {
                                  const val = e.target.value;
                                  setData((prev) => {
                                    const s = safe(prev);
                                    const idx = (s.actuals||[]).findIndex((a) => a.grantId===g.id && a.month===month);
                                    if (idx >= 0) s.actuals[idx] = {...s.actuals[idx], notes: val};
                                    return s;
                                  });
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-400 border-t border-gray-100">
                Variance = Actual minus Forecast. Green = within $200. Red = over forecast. Amber = under forecast. Small variances are normal (payroll timing, rounding).
              </div>
            </div>
          );
        })()}
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
  const BP = { name:"",role:"PhD Student",studentStatus:"Domestic",startDate:"",endDate:"",baseMonthly:"",benefits:false,benefitsRate:0.21,allocations:[{grantId:"",fraction:""}],fellowship:"",fellowshipId:"",fellowshipStart:"",notes:"" };

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
              <FL label="Benefits">
                <Sel value={form.benefits?"YES":"NO"} onChange={(e) => setForm((f) => ({...f,benefits:e.target.value==="YES",benefitsRate:e.target.value==="YES"?(f.benefitsRate||0.21):0}))}>
                  <option>YES</option><option>NO</option>
                </Sel>
              </FL>
              {form.benefits && (
                <FL label="Benefits rate">
                  <div className="flex items-center gap-2">
                    <Inp type="number" step="0.01" min="0" max="0.5"
                      value={form.benefitsRate||0.21}
                      onChange={(e) => setForm((f) => ({...f,benefitsRate:+e.target.value}))}
                      className="w-24"
                    />
                    <span className="text-xs text-gray-400">{Math.round((+form.benefitsRate||0.21)*100)}% — M&P: 21%, Tech/RA: 24%</span>
                  </div>
                </FL>
              )}
              {["PhD Student","MSc Student"].includes(form.role) && (
                <FL label="Student status">
                  <Sel value={form.studentStatus||"Domestic"} onChange={(e) => setForm((f) => ({...f,studentStatus:e.target.value}))}>
                    <option>Domestic</option>
                    <option>International</option>
                    <option>N/A</option>
                  </Sel>
                </FL>
              )}
              {["PhD Student","MSc Student"].includes(form.role) && (
                <FL label="Active fellowship (from registry)">
                  <Sel value={form.fellowshipId||""} onChange={(e) => setForm((f) => ({...f,fellowshipId:e.target.value}))}>
                    <option value="">None</option>
                    {(D.fellowships||[]).map((f) => <option key={f.id} value={f.id}>{f.name} (${(+f.stipendMonthly||0).toLocaleString()}/mo{f.coversTuition?" + tuition":""})</option>)}
                  </Sel>
                </FL>
              )}
              {["PhD Student","MSc Student"].includes(form.role) && form.fellowshipId && (
                <FL label="Fellowship start date">
                  <Inp type="date" value={form.fellowshipStart||""} onChange={(e) => setForm((f) => ({...f,fellowshipStart:e.target.value}))} />
                </FL>
              )}
              <FL label="Fellowship notes / status"><Inp value={form.fellowship||""} onChange={(e) => setForm((f) => ({...f,fellowship:e.target.value}))} placeholder="None / Applying CGS-D / Held Vanier" /></FL>
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
              <div className="text-xs text-gray-500 mb-1">Salary / stipend timeline <span className="text-gray-400">(optional — past and future periods)</span></div>
              <div className="text-xs text-gray-400 mb-2">Add a row for each period where the salary or benefits rate differs. Leave blank to use the current base monthly and benefits rate for the full forecast. Future dates are treated as upcoming changes.</div>
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
                  {form.benefits && (
                    <div className="w-28">
                      <div className="text-xs text-gray-400 mb-1">Benefits rate (blank = inherit)</div>
                      <Inp type="number" step="0.01" min="0" max="0.5"
                        value={h.benefitsRate||""}
                        onChange={(e) => updSalaryHistory(i, "benefitsRate", e.target.value)}
                        placeholder={String(Math.round((+form.benefitsRate||0.21)*100)) + "%"}
                      />
                    </div>
                  )}
                  <button onClick={() => removeSalaryHistory(i)} className="text-red-400 hover:text-red-600 px-2 pb-1">x</button>
                </div>
              ))}
              <Btn onClick={addSalaryHistory} v="secondary" sm>+ Add salary period</Btn>
              <span className="text-xs text-gray-400 ml-2">Leave benefits rate blank to inherit from the person's current rate</span>
            </div>
            <div className="flex gap-2"><Btn onClick={savePerson}>Save</Btn><Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">{["Active","Name","Role","Status","Yr","Start","Base/mo","Grant charge/mo","Allocations","Fellowship",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
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
                    <td className="py-2 pr-3 font-medium">
                      {p.name}
                      {(() => {
                        const gap = firstUnallocatedDate(p);
                        if (!gap) return null;
                        return <div className="text-xs text-yellow-600 font-normal mt-0.5">⚠ Unallocated from {gap}</div>;
                      })()}
                    </td>
                    <td className="py-2 pr-3"><Badge c={p.role==="Postdoc"?"blue":p.role==="Research Staff"?"gray":"green"}>{p.role}</Badge></td>
                    <td className={"py-2 pr-3 text-sm font-medium " + (late?"text-red-600":"text-gray-600")}>{yrStr}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.startDate}</td>
                    <td className="py-2 pr-3 font-medium">{f$(p.baseMonthly)}</td>
                    <td className="py-2 pr-3">
                      {["PhD Student","MSc Student"].includes(p.role)
                        ? <Badge c={p.studentStatus==="International"?"amber":"blue"}>{p.studentStatus||"Domestic"}</Badge>
                        : <Badge c="gray">N/A</Badge>}
                    </td>
                    <td className="py-2 pr-3 font-medium text-xs">
                      {["PhD Student","MSc Student"].includes(p.role) ? (() => {
                        const now = new Date();
                        const tui = getTuitionMonthly(p, now, D.settings);
                        const felOff = getFellowshipOffset(p, now, D.fellowships||[]);
                        const grantPays = Math.max(0, +p.baseMonthly - felOff.stipend) + (felOff.coversTuition ? Math.max(0, tui - felOff.tuitionAmount) : tui);
                        return (
                          <div>
                            <div className="text-gray-800">{f$(Math.round(grantPays))}/mo</div>
                            {tui > 0 && <div className="text-gray-400">incl. {f$(Math.round(tui))} tuition</div>}
                            {felOff.stipend > 0 && <div className="text-green-600">–{f$(felOff.stipend)} fellowship</div>}
                          </div>
                        );
                      })() : p.benefits ? (
                        <div>
                          <div className="text-gray-800">{f$(Math.round(+p.baseMonthly * (1 + (+p.benefitsRate||0.21))))}/mo</div>
                          <div className="text-gray-400">incl. {Math.round((+p.benefitsRate||0.21)*100)}% benefits</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-gray-800">{f$(+p.baseMonthly||0)}/mo</div>
                          <div className="text-gray-400">no benefits</div>
                        </div>
                      )}
                    </td>
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
  const [grantFilter, setGrantFilter] = useState("");
  const BR = { grantId:"",category:"",monthlyBase:"",escalation:0,from:"",to:"",notes:"" };
  // When adding new item, pre-select the currently filtered grant
  function openNewForm() { setForm({...BR, grantId: grantFilter || ""}); }

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
    if (grantFilter && r.grantId !== grantFilter) return false;
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
        <SH title="Research cost items" action={<Btn onClick={openNewForm}>+ Add cost item</Btn>} />
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
        {/* Grant filter buttons */}
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <span className="text-xs text-gray-400">Grant:</span>
          <button onClick={() => setGrantFilter("")}
            className={"px-3 py-1 rounded text-xs font-medium border " + (!grantFilter ? "bg-blue-700 text-white border-blue-700" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50")}>
            All
          </button>
          {D.grants.filter((g) => g.active).map((g) => {
            const count = D.research.filter((r) => r.grantId === g.id).length;
            if (count === 0) return null;
            const active = grantFilter === g.id;
            return (
              <button key={g.id} onClick={() => setGrantFilter(active ? "" : g.id)}
                className={"px-3 py-1 rounded text-xs font-medium border " + (active ? "bg-blue-700 text-white border-blue-700" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50")}>
                {g.code} <span className={active ? "text-blue-200" : "text-gray-400"}>{count}</span>
              </button>
            );
          })}
        </div>
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

  // All role groups
  const GROUPS = [
    { key: "students",    label: "Students",           roles: ["PhD Student","MSc Student"] },
    { key: "postdocs",    label: "Postdocs",            roles: ["Postdoc"] },
    { key: "associates",  label: "Research Associates", roles: ["Research Associate"] },
    { key: "staff",       label: "Staff",               roles: ["Research Staff"] },
    { key: "other",       label: "Other",               roles: ["Undergraduate","Prospective Student"] },
  ];

  const [activeGroups, setActiveGroups] = useState(["students","postdocs","associates","staff","other"]);

  function toggleGroup(key) {
    setActiveGroups((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const activeRoles = GROUPS.filter((g) => activeGroups.includes(g.key)).flatMap((g) => g.roles);
  const people = D.people.filter((p) => p.active !== false && activeRoles.includes(p.role));

  function PersonCard({ p }) {
    const y = yrs(p.startDate, new Date());
    const rec = recForStudent(p);
    const rs = rec ? RS[rec.level] : null;
    const mo = p.endDate ? moLeft(p.endDate) : null;
    const gap = firstUnallocatedDate(p);
    const grants = (p.allocations||[]).filter((a) => a.grantId).map((a) => {
      const g = D.grants.find((g) => g.id===a.grantId);
      return g ? g.code+" ("+(+a.fraction*100).toFixed(0)+"%)" : null;
    }).filter(Boolean);

    const isStudent = ["PhD Student","MSc Student"].includes(p.role);
    const yearLabel = isStudent
      ? "Year " + (Math.floor(y)+1)
      : p.role === "Postdoc" || p.role === "Research Associate"
        ? "PD/RA year " + (Math.floor(y)+1)
        : "—";

    // ── Annual salary calculation ─────────────────────────────────────────────
    const history = Array.isArray(p.salaryHistory) ? p.salaryHistory : [];
    const todayStr = new Date().toISOString().slice(0,10);

    // Current salary = baseMonthly (what they're being paid right now)
    const base = +p.baseMonthly || 0;
    const annualSalary = base * 12;
    const benRate = +p.benefitsRate || 0.21;
    const annualCost = isStudent ? annualSalary : Math.round(annualSalary * (p.benefits ? 1 + benRate : 1));

    // Future raise: earliest history row with a from date in the future
    const futureRaise = history
      .filter((h) => h.base && h.from && h.from > todayStr)
      .sort((a, b) => a.from < b.from ? -1 : 1)[0];

    // Past change: most recent history row already in effect
    const pastChange = history
      .filter((h) => h.base && h.from && h.from <= todayStr)
      .sort((a, b) => a.from > b.from ? -1 : 1)[0];

    const isSeptChange = pastChange && pastChange.from && pastChange.from.includes("-09-");
    const salaryLabel = isStudent
      ? (pastChange ? (isSeptChange ? "Updated stipend as of Sep " + pastChange.from.slice(0,4) : "Updated stipend as of " + pastChange.from.slice(0,7)) : null)
      : (pastChange ? "Salary updated " + pastChange.from.slice(0,7) : null);

    const futureBase = futureRaise ? (+futureRaise.base || 0) : 0;
    const futureAnnual = futureBase * 12;
    // Use the period-specific benefits rate if set, otherwise inherit current
    const futureBenRate = (futureRaise && futureRaise.benefitsRate) ? +futureRaise.benefitsRate : benRate;
    const futureCost = Math.round(futureAnnual * (p.benefits ? 1 + futureBenRate : 1));
    const futureLabel = futureRaise
      ? (isStudent
          ? "Stipend changing to " + f$(futureBase) + "/mo from " + futureRaise.from.slice(0,7)
          : "New salary from " + futureRaise.from.slice(0,7) + ": " + f$(futureBase) + "/mo → " + f$(futureAnnual) + "/yr · " + f$(futureCost) + "/yr to lab (incl. " + Math.round(futureBenRate*100) + "% benefits)")
      : null;

    // Card border: unallocated overrides everything
    const cardStyle = gap
      ? "bg-yellow-50 border-yellow-300 border-l-yellow-400"
      : rs ? rs.bg + " " + rs.border
      : "bg-white border-gray-200 border-l-gray-300";

    return (
      <div className={"rounded-lg p-4 border-l-4 border " + cardStyle}>
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div className="flex-1">
            <div className="font-medium text-gray-800">{p.name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {p.role} · {yearLabel} · Started {p.startDate}
              {mo !== null && <span className={"ml-2 " + (mo<12 ? "text-red-600 font-medium" : "")}> · {mo}mo funding left</span>}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Grants: {grants.join(", ")||"none"}
              {isStudent && p.fellowship && <span> · Fellowship: {p.fellowship}</span>}
            </div>
            {gap && (
              <div className="text-xs text-yellow-700 font-medium mt-1">
                ⚠ No allocation from {gap} — add a grant slot in People tab
              </div>
            )}
            {/* Annual salary line */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              {salaryLabel && (
                <div className="text-xs text-blue-600 font-medium mb-0.5">{salaryLabel}</div>
              )}
              <div className="flex gap-4 flex-wrap">
                <div className="text-xs text-gray-500">
                  <span className="text-gray-400">Current: </span>
                  {f$(base)}/mo
                  <span className="text-gray-400 ml-1">→</span>
                  <span className="font-medium text-gray-700 ml-1">{f$(annualSalary)}/yr</span>
                </div>
                {!isStudent && (
                  <div className="text-xs text-gray-400">
                    Total to lab: <span className="font-medium text-gray-600">{f$(annualCost)}/yr</span>
                    {p.benefits && <span className="ml-1">(incl. {Math.round(benRate*100)}% benefits)</span>}
                  </div>
                )}
              </div>
              {futureLabel && (
                <div className="text-xs text-green-600 font-medium mt-1">↑ {futureLabel}</div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {gap && <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Unallocated</span>}
            {rs && !gap && <span className={"px-2 py-1 rounded text-xs font-medium " + rs.badge}>{rs.lbl}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Group toggles */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-gray-400">Show:</span>
        {GROUPS.map((g) => {
          const count = D.people.filter((p) => p.active !== false && g.roles.includes(p.role)).length;
          if (count === 0) return null;
          const on = activeGroups.includes(g.key);
          return (
            <button key={g.key} onClick={() => toggleGroup(g.key)}
              className={"px-3 py-1 rounded text-xs font-medium border transition-colors " +
                (on ? "bg-blue-700 text-white border-blue-700" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50")}>
              {g.label} <span className={"ml-1 " + (on ? "text-blue-200" : "text-gray-400")}>{count}</span>
            </button>
          );
        })}
        <button onClick={() => setActiveGroups(GROUPS.map((g) => g.key))}
          className="text-xs text-blue-500 hover:text-blue-700 ml-1">Show all</button>
      </div>

      {/* Cards per group */}
      {GROUPS.filter((g) => activeGroups.includes(g.key)).map((g) => {
        const groupPeople = D.people.filter((p) => p.active !== false && g.roles.includes(p.role));
        if (groupPeople.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{g.label}</div>
            <div className="space-y-2">
              {groupPeople.map((p) => <PersonCard key={p.id} p={p} />)}
            </div>
          </div>
        );
      })}

      {people.length === 0 && (
        <div className="text-center py-12 text-gray-400">No people in the selected groups.</div>
      )}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
// ── Fellowship Registry ───────────────────────────────────────────────────────
function FellowshipRegistry({ data, setData }) {
  const D = safe(data);
  const [form, setForm] = useState(null);
  const BF = { name:"", stipendMonthly:"", coversTuition:false, tuitionAmount:"", maxMonths:"24", notes:"" };

  function saveFellowship() {
    if (!form.name || !form.stipendMonthly) return alert("Name and monthly stipend required.");
    if (form.id) {
      setData(function(prev) { var s=safe(prev); s.fellowships=s.fellowships.map(function(f){return f.id===form.id?form:f;}); return s; });
    } else {
      setData(function(prev) { var s=safe(prev); s.fellowships=[...s.fellowships,{...form,id:uid()}]; return s; });
    }
    setForm(null);
  }
  function deleteFellowship(id) {
    if (!window.confirm("Delete this fellowship type?")) return;
    setData(function(prev) { var s=safe(prev); s.fellowships=s.fellowships.filter(function(f){return f.id!==id;}); return s; });
  }

  return (
    <Card>
      <SH title="Fellowship registry"
        action={<Btn onClick={() => setForm({...BF})} sm>+ Add fellowship</Btn>} />
      <p className="text-xs text-gray-400 mb-3">
        Define each fellowship type once here. Then assign fellowships to students in the People tab.
        The forecast deducts the fellowship stipend from what the grant pays, and optionally removes tuition charges too.
      </p>
      {form && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
          <div className="font-medium text-purple-800 mb-3 text-sm">{form.id?"Edit fellowship":"New fellowship type"}</div>
          <div className="grid gap-3 mb-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))"}}>
            <FL label="Fellowship name *">
              <Inp value={form.name} onChange={(e) => setForm((f) => ({...f,name:e.target.value}))} placeholder="e.g. NSERC CGS-D" />
            </FL>
            <FL label="Monthly stipend ($) *">
              <Inp type="number" value={form.stipendMonthly} onChange={(e) => setForm((f) => ({...f,stipendMonthly:e.target.value}))} placeholder="e.g. 2083" />
            </FL>
            <FL label="Duration (months)">
              <Inp type="number" value={form.maxMonths} onChange={(e) => setForm((f) => ({...f,maxMonths:e.target.value}))} placeholder="e.g. 24" />
            </FL>
            <FL label="Covers tuition?">
              <Sel value={form.coversTuition?"YES":"NO"} onChange={(e) => setForm((f) => ({...f,coversTuition:e.target.value==="YES"}))}>
                <option>NO</option>
                <option>YES</option>
              </Sel>
            </FL>
            {form.coversTuition && (
              <FL label="Tuition coverage ($/mo, 0 = full)">
                <Inp type="number" value={form.tuitionAmount} onChange={(e) => setForm((f) => ({...f,tuitionAmount:e.target.value}))} placeholder="0 = covers all" />
              </FL>
            )}
            <FL label="Notes">
              <Inp value={form.notes||""} onChange={(e) => setForm((f) => ({...f,notes:e.target.value}))} placeholder="e.g. CIHR doctoral, 2 years" />
            </FL>
          </div>
          <div className="flex gap-2">
            <Btn onClick={saveFellowship}>Save</Btn>
            <Btn onClick={() => setForm(null)} v="secondary">Cancel</Btn>
          </div>
        </div>
      )}
      {D.fellowships.length === 0 && !form && (
        <div className="text-center py-6 text-gray-400 text-sm">No fellowships defined yet. Add common ones like NSERC CGS-D, Vanier, CIHR, Banting.</div>
      )}
      {D.fellowships.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
            {["Name","Stipend/mo","Duration","Tuition coverage","Notes",""].map((h) => <th key={h} className="py-2 pr-3 text-left font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {D.fellowships.map((f) => (
              <tr key={f.id} className="border-b border-gray-50">
                <td className="py-2 pr-3 font-medium text-purple-700">{f.name}</td>
                <td className="py-2 pr-3 font-medium text-green-700">{f$(+f.stipendMonthly||0)}</td>
                <td className="py-2 pr-3 text-gray-600">{f.maxMonths||"—"} mo</td>
                <td className="py-2 pr-3">
                  {f.coversTuition
                    ? <Badge c="green">{+f.tuitionAmount > 0 ? f$(+f.tuitionAmount)+"/mo" : "Full coverage"}</Badge>
                    : <Badge c="gray">Not covered</Badge>}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-400">{f.notes}</td>
                <td className="py-2 whitespace-nowrap">
                  <Btn onClick={() => setForm({...f})} v="ghost" sm>Edit</Btn>
                  <Btn onClick={() => deleteFellowship(f.id)} v="danger" sm>Del</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">Changes here update all forecasts instantly. Base monthly = stipend only (no tuition). Tuition is calculated separately below based on student status and year. PhD & MSc students have flat stipends. Staff and postdocs escalate annually.</div>


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
      <Card>
        <SH title="Tuition rates (monthly — annual divided by 12)"
          action={<span className="text-xs text-gray-400">Applied to PhD & MSc students based on status and year</span>} />
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs text-blue-800">
          Set the monthly tuition amount for each category. International rates are typically 2-3x domestic. Year 3+ rates for PhD are often lower at some universities (e.g. tuition waiver programs). Annual escalation applies to all rates.
        </div>
        <div className="grid gap-0 mb-2">
          <Row label="PhD — Domestic, Year 1-2" desc="Monthly tuition charged to grant" k="domPhDYr12" step="10" min="0" max="5000" fmt={f$} />
          <Row label="PhD — Domestic, Year 3+" desc="Monthly tuition charged to grant" k="domPhDYr3plus" step="10" min="0" max="5000" fmt={f$} />
          <Row label="PhD — International, Year 1-2" desc="Monthly tuition charged to grant" k="intlPhDYr12" step="10" min="0" max="8000" fmt={f$} />
          <Row label="PhD — International, Year 3+" desc="Monthly tuition charged to grant" k="intlPhDYr3plus" step="10" min="0" max="8000" fmt={f$} />
          <Row label="MSc — Domestic, Year 1" desc="Monthly tuition charged to grant" k="domMScYr12" step="10" min="0" max="5000" fmt={f$} />
          <Row label="MSc — Domestic, Year 2+" desc="Monthly tuition charged to grant" k="domMScYr2plus" step="10" min="0" max="5000" fmt={f$} />
          <Row label="MSc — International, Year 1" desc="Monthly tuition charged to grant" k="intlMScYr12" step="10" min="0" max="8000" fmt={f$} />
          <Row label="MSc — International, Year 2+" desc="Monthly tuition charged to grant" k="intlMScYr2plus" step="10" min="0" max="8000" fmt={f$} />
          <Row label="Annual tuition escalation" desc="Applied to all tuition rates year over year" k="tuitionEscalation" step="0.005" min="0" max="0.15" fmt={fp} />
        </div>
      </Card>
      <FellowshipRegistry data={data} setData={setData} />
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
  const [fcMonths, setFcMonths] = useState(FCN_DEFAULT);
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

  const fc = useMemo(function() { return forecast(data, fcMonths); }, [data, fcMonths]);

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
  const TABS = [["dashboard","Dashboard"],["grants","Grants"],["people","People"],["research","Research"],["students","Lab Members"],["settings","Settings"]];

  return (
    <>
      <Head>
        <title>{PAGE_TITLE}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1e3a5f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Yachie Lab GMS" />
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #scenario-print-area, #scenario-print-area * { visibility: visible; }
            #scenario-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 20px; }
            .no-print { display: none !important; }
          }
        `}</style>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="text-white" style={{background: HEADER_COLOR}}>
          <div className="px-5 pt-4">
            <div className="font-medium text-base">{LAB_NAME} — {LAB_SUBTITLE}</div>
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
          {tab==="dashboard" && <Dashboard data={data} fc={fc} fcMonths={fcMonths} setFcMonths={setFcMonths} />}
          {tab==="grants"    && <Grants    data={data} setData={setData} fc={fc} />}
          {tab==="people"    && <People    data={data} setData={setData} />}
          {tab==="research"  && <Research  data={data} setData={setData} />}
          {tab==="students"  && <Students  data={data} />}
          {tab==="settings"  && <Settings  data={data} setData={setData} userName={userName} setUserName={setUserName} />}
        </div>
      </div>
      <div className="text-center py-3 text-xs text-gray-300 border-t border-gray-100 mt-4">
        Built with{" "}
        <a href="https://github.com/madhurangesa/lab-gms" target="_blank" rel="noopener noreferrer"
          className="text-gray-400 hover:text-gray-600 underline">
          Lab GMS
        </a>
        {" "}· Yachie Lab, UBC SBME · CC BY-NC 4.0
      </div>
    </>
  );
}
