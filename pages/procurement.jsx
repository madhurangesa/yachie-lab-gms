/**
 * Lab Grant Management System — Procurement Module
 * ════════════════════════════════════════════════
 * Yachie Lab · UBC School of Biomedical Engineering · Vancouver, Canada
 * github.com/madhurangesa/lab-gms · 2025
 *
 * Two roles — manager (full access) and member (submit + view).
 * Role is determined client-side by which password is entered.
 * API calls use the lab secret for Upstash authentication.
 * ════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Head from "next/head";

// ── Role passwords ──────────────────────────────────────────────────────────
// NEXT_PUBLIC_ vars are visible in the browser — this is UI-level role separation,
// not cryptographic security. Fine for a lab management tool.
const MGR_PASS    = process.env.NEXT_PUBLIC_LAB_SECRET    || "yachie-lab-2025";
const MEMBER_PASS = process.env.NEXT_PUBLIC_MEMBER_SECRET || "lab-member-2025";
const API_SECRET  = process.env.NEXT_PUBLIC_LAB_SECRET    || "yachie-lab-2025";
const HEADER_COLOR = "#1e3a5f";

// ── Helpers ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const f$ = (n) => (n == null || isNaN(n)) ? "$0" : (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();

function thisMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Auto-categorization keyword map ─────────────────────────────────────────
const KWMAP = [
  ["Reagents — Enzyme",       ["polymerase","ligase","restriction enzyme","kinase","phosphatase","dnase","rnase","proteinase k","t4 dna","t7 rna"]],
  ["Reagents — Oligo / DNA",  ["oligo","primer","grna","guide rna","sgrna","probe","crna","ssodna"]],
  ["Reagents — Cell Culture", ["dmem","rpmi","trypsin","matrigel","serum","fbs","pbs","media","l-glut","penicillin","streptomycin","trypan"]],
  ["Reagents — Mol Bio",      ["buffer","loading dye","agarose","ethanol","isopropanol","chloroform","trizol","sds","pmsf","edta","nacl","iptg"]],
  ["Antibody",                ["antibody"," anti-","igg","ige","primary antibody","secondary antibody","conjugated"]],
  ["Plasticware",             ["plate","tube","dish","tip","pipette","flask","vial","eppendorf","falcon","cryovial","pcr strip","filter unit","syringe","needle","coverslip","slide"]],
  ["Kit",                     ["kit","extraction","purification","cleanup","miniprep","maxiprep","qiagen","macherey","zymo","thermo","invitrogen","wizard"]],
  ["DNA Synthesis",           ["synthesis","gene block","gblock","idt","twist","ultramer","fragment","gene string","eblock"]],
  ["Sequencing",              ["sequencing","sanger","illumina","nanopore","pacbio","ont"]],
  ["Computing / Cloud",       ["aws","gcp","google cloud","hpc","compute","storage","s3","azure","gpu","cpu","ram","ssd"]],
  ["Services — Core",         ["core facility","flow cytometry","imaging","microscopy","facs","lsrii","confocal","tem","sem"]],
  ["PPE / Safety",            ["glove","mask","goggle","lab coat","waste bag","sharps","biosafety","fume"]],
];

function guessCat(name) {
  if (!name) return "General";
  const lo = name.toLowerCase();
  for (const [cat, kws] of KWMAP) {
    if (kws.some((k) => lo.includes(k))) return cat;
  }
  return "General";
}

const ALL_CATS = [
  "Reagents — Enzyme","Reagents — Oligo / DNA","Reagents — Cell Culture","Reagents — Mol Bio",
  "Antibody","Plasticware","Kit","DNA Synthesis","Sequencing","Computing / Cloud",
  "Services — Core","PPE / Safety","General",
];

// ── Data model ───────────────────────────────────────────────────────────────
const BLANK_POOL = {
  monthlyAllocation: 5000,
  consumablesAllocation: 2000,
  currentMonth: "",
  balance: 5000,
  consumablesBalance: 2000,
  topUpRequests: [],
};
const BLANK_SETTINGS = {
  autoApproveThreshold: 500,
  notificationEmail: "",
  memberNames: [],
  usdRate: 1.36,
};
const BLANK = {
  orders: [],
  vendors: [],
  catalogue: [],
  budgetPool: { ...BLANK_POOL },
  settings: { ...BLANK_SETTINGS },
};

function safeData(d) {
  if (!d || typeof d !== "object") return { ...BLANK };
  return {
    orders:    Array.isArray(d.orders)    ? d.orders    : [],
    vendors:   Array.isArray(d.vendors)   ? d.vendors   : [],
    catalogue: Array.isArray(d.catalogue) ? d.catalogue : [],
    budgetPool: { ...BLANK_POOL,     ...(d.budgetPool || {}) },
    settings:   { ...BLANK_SETTINGS, ...(d.settings   || {}) },
  };
}

function maybeResetPool(data) {
  const tm = thisMonth();
  const pool = data.budgetPool;
  if (pool.currentMonth !== tm) {
    return {
      ...data,
      budgetPool: {
        ...pool,
        currentMonth: tm,
        balance: +pool.monthlyAllocation || 5000,
        consumablesBalance: +pool.consumablesAllocation || 2000,
      },
    };
  }
  return data;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function apiLoad() {
  const r = await fetch("/api/procurement?secret=" + API_SECRET);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function apiSave(data, savedBy) {
  const r = await fetch("/api/procurement", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lab-secret": API_SECRET },
    body: JSON.stringify({ data, savedBy }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function apiLoadGrants() {
  const r = await fetch("/api/data?secret=" + API_SECRET);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const json = await r.json();
  return (json.data?.grants || []).filter((g) => g && g.active);
}

// ── Shared UI components ─────────────────────────────────────────────────────
function Btn({ onClick, children, v = "primary", sm, disabled, className = "" }) {
  const base = "inline-flex items-center justify-center rounded font-medium transition-colors focus:outline-none whitespace-nowrap "
    + (sm ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm");
  const variants = {
    primary:   "bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40",
    green:     "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40",
    red:       "bg-red-600 text-white hover:bg-red-700 disabled:opacity-40",
    ghost:     "text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={base + (variants[v] || variants.primary) + " " + className}>
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending:        "bg-amber-100 text-amber-800",
    approved:       "bg-green-100 text-green-800",
    rejected:       "bg-red-100 text-red-800",
    "auto-approved":"bg-blue-100 text-blue-700",
  };
  const labels = {
    pending: "Pending", approved: "Approved", rejected: "Rejected", "auto-approved": "Auto-approved",
  };
  return (
    <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (styles[status] || "bg-gray-100 text-gray-600")}>
      {labels[status] || status}
    </span>
  );
}

function SectionHead({ children }) {
  return <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</div>;
}

function Card({ children, className = "" }) {
  return <div className={"bg-white rounded-xl border border-gray-200 " + className}>{children}</div>;
}

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [step, setStep] = useState("password");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState(null);
  const [name, setName] = useState("");
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState("");
  const [memberNames, setMemberNames] = useState([]);
  const [loadingNames, setLoadingNames] = useState(false);

  async function fetchNames() {
    setLoadingNames(true);
    try {
      const res = await fetch("/api/data?secret=" + API_SECRET);
      const gmsData = await res.json();
      const names = (gmsData.data?.people || [])
        .filter((p) => p.active && p.name)
        .map((p) => p.name);
      setMemberNames(names);
    } catch {}
    setLoadingNames(false);
  }

  function handlePwSubmit() {
    if (pw === MGR_PASS) {
      setRole("manager");
      fetchNames();
      setStep("name");
    } else if (pw === MEMBER_PASS) {
      setRole("member");
      fetchNames();
      setStep("name");
    } else {
      setError("Incorrect password.");
    }
  }

  function handlePwKey(e) {
    if (e.key === "Enter") handlePwSubmit();
  }

  function handleNameSubmit() {
    const finalName = (name === "__custom__" || memberNames.length === 0) ? customName.trim() : name;
    if (!finalName) { setError("Please enter your name."); return; }
    onLogin(role, finalName);
  }

  function handleNameKey(e) {
    if (e.key === "Enter") handleNameSubmit();
  }

  if (step === "password") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Card className="p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-2xl font-semibold text-gray-800">Lab Procurement</div>
            <div className="text-sm text-gray-400 mt-1">Yachie Lab · UBC SBME</div>
          </div>
          <div className="mb-4">
            <label className="block text-sm text-gray-600 mb-1">Password</label>
            <input type="password" autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setError(""); }}
              onKeyDown={handlePwKey}
            />
            {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
          </div>
          <Btn onClick={handlePwSubmit} className="w-full">Continue</Btn>
          <div className="mt-4 text-center">
            <a href="/" className="text-xs text-gray-400 hover:text-gray-600">← Back to Grant Dashboard</a>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Card className="p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-semibold text-gray-800">Who are you?</div>
          <div className="text-sm text-gray-400 mt-1">Signing in as {role === "manager" ? "manager" : "lab member"}</div>
        </div>
        {loadingNames ? (
          <div className="text-center text-gray-400 text-sm py-6">Loading...</div>
        ) : (
          <div className="mb-4">
            {memberNames.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {memberNames.map((n) => (
                  <button key={n} onClick={() => setName(n)}
                    className={"px-4 py-2.5 rounded-lg border text-sm transition-colors text-left "
                      + (name === n ? "border-blue-500 bg-blue-50 text-blue-800 font-medium" : "border-gray-200 hover:border-gray-300 text-gray-700")}>
                    {n}
                  </button>
                ))}
                <button onClick={() => setName("__custom__")}
                  className={"px-4 py-2.5 rounded-lg border text-sm transition-colors "
                    + (name === "__custom__" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-dashed border-gray-300 text-gray-400 hover:text-gray-600")}>
                  + Other
                </button>
              </div>
            )}
            {(name === "__custom__" || memberNames.length === 0) && (
              <input autoFocus type="text" placeholder="Enter your name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={handleNameKey}
              />
            )}
            {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
          </div>
        )}
        <Btn onClick={handleNameSubmit} disabled={loadingNames} className="w-full">
          Enter
        </Btn>
      </Card>
    </div>
  );
}

// ── Item name autocomplete input ─────────────────────────────────────────────
function ItemNameInput({ value, catalogue, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    if (!value || value.length < 2) return [];
    const lo = value.toLowerCase();
    return catalogue.filter((c) => c.name.toLowerCase().includes(lo)).slice(0, 7);
  }, [value, catalogue]);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function handleChange(e) {
    onChange(e.target.value);
    setOpen(true);
  }

  function handleFocus() {
    setOpen(true);
  }

  function handleSelect(c) {
    onSelect(c);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input type="text" value={value} placeholder="Item name"
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        onChange={handleChange}
        onFocus={handleFocus}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 bg-white border border-gray-200 rounded-b shadow-lg max-h-44 overflow-y-auto">
          {matches.map((c) => (
            <button key={c.id} onMouseDown={() => handleSelect(c)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-100 last:border-0">
              <div className="font-medium text-gray-800">{c.name}</div>
              <div className="text-gray-400 mt-0.5">{[c.supplier, c.catNo, c.unit, c.category].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Order Form ───────────────────────────────────────────────────────────────
function OrderForm({ data, setData, userName }) {
  const { vendors, catalogue, settings, budgetPool } = data;
  const usdRate = +settings.usdRate || 1.36;
  const threshold = +settings.autoApproveThreshold || 500;

  function emptyItem() {
    return { id: uid(), name: "", category: "General", fromCat: false, fromCatId: null, supplier: "", catNo: "", unit: "", qty: 1, unitPrice: "", currency: "CAD" };
  }

  const [vendorId, setVendorId] = useState("");
  const [items, setItems] = useState([emptyItem()]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const vendor = vendors.find((v) => v.id === vendorId);

  const total = useMemo(() => {
    return items.reduce((s, it) => {
      const p = +it.unitPrice || 0;
      const q = +it.qty || 1;
      const rate = it.currency === "USD" ? usdRate : 1;
      return s + p * q * rate;
    }, 0);
  }, [items, usdRate]);

  const hasUSD = items.some((it) => it.currency === "USD");
  const freeShipFlag = vendor && +vendor.freeShippingThreshold > 0 && total < +vendor.freeShippingThreshold;
  const estimatedArrival = (vendor && +vendor.leadTimeDays > 0) ? addDays(+vendor.leadTimeDays) : null;

  function updateItemField(id, field, val) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const next = { ...it, [field]: val };
      if (field === "name" && !it.fromCat) {
        next.category = guessCat(val);
      }
      return next;
    }));
  }

  function selectCatalogueItem(itemId, cat) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== itemId) return it;
      return {
        ...it,
        name: cat.name,
        category: cat.category,
        supplier: cat.supplier || "",
        catNo: cat.catNo || "",
        unit: cat.unit || "",
        fromCat: true,
        fromCatId: cat.id,
      };
    }));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleSubmit() {
    const filledItems = items.filter((it) => it.name.trim());
    if (!filledItems.length) { setError("Add at least one item."); return; }
    const missingPrice = filledItems.some((it) => !it.unitPrice && it.unitPrice !== 0);
    if (missingPrice) { setError("Enter a unit price for each item."); return; }

    setSubmitting(true);
    setError("");

    const isAuto = total < threshold;

    const newOrder = {
      id: uid(),
      submittedBy: userName,
      submittedAt: new Date().toISOString(),
      status: isAuto ? "auto-approved" : "pending",
      items: filledItems,
      totalCAD: total,
      vendorId: vendorId || null,
      notes: notes.trim(),
      grantId: null,
      approvedBy: isAuto ? "Auto" : null,
      approvedAt: isAuto ? new Date().toISOString() : null,
      estimatedArrival: estimatedArrival || null,
    };

    // Add any new catalogue entries (items not already catalogued)
    const newCatEntries = [];
    for (const it of filledItems) {
      if (!it.fromCatId) {
        const exists = catalogue.find((c) => c.name.toLowerCase() === it.name.toLowerCase().trim());
        if (!exists) {
          newCatEntries.push({
            id: uid(),
            name: it.name.trim(),
            category: it.category,
            categoryConfirmed: false,
            supplier: it.supplier || "",
            catNo: it.catNo || "",
            unit: it.unit || "",
          });
        }
      }
    }

    const newData = {
      ...data,
      orders: [...data.orders, newOrder],
      catalogue: [...data.catalogue, ...newCatEntries],
    };

    try {
      await apiSave(newData, userName);
      setData(newData);
      setItems([emptyItem()]);
      setVendorId("");
      setNotes("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (e) {
      setError("Save failed: " + e.message);
    }
    setSubmitting(false);
  }

  return (
    <Card className="p-5">
      <SectionHead>New Order Request</SectionHead>

      {/* Budget status */}
      <div className="flex gap-3 mb-5">
        <div className="bg-blue-50 rounded-lg px-3 py-2 flex-1">
          <div className="text-xs text-blue-400 mb-0.5">Monthly pool</div>
          <div className="font-semibold text-blue-800 text-sm">{f$(budgetPool.balance)} remaining</div>
        </div>
        <div className="bg-emerald-50 rounded-lg px-3 py-2 flex-1">
          <div className="text-xs text-emerald-500 mb-0.5">Consumables</div>
          <div className="font-semibold text-emerald-800 text-sm">{f$(budgetPool.consumablesBalance)} remaining</div>
        </div>
      </div>

      {/* Vendor */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Vendor (optional)</label>
        <div className="flex items-center gap-3">
          <select value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-xs">
            <option value="">— Select vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.currency})</option>
            ))}
          </select>
          {estimatedArrival && (
            <span className="text-xs text-gray-400">Est. arrival: {estimatedArrival}</span>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-2">Items</label>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex gap-2 items-center flex-wrap">
              <div className="flex-1 min-w-40">
                <ItemNameInput value={it.name} catalogue={catalogue}
                  onChange={(v) => updateItemField(it.id, "name", v)}
                  onSelect={(c) => selectCatalogueItem(it.id, c)}
                />
              </div>
              <input type="text" placeholder="Supplier · CAT#" value={it.supplier + (it.catNo ? " · " + it.catNo : "")}
                onChange={(e) => updateItemField(it.id, "supplier", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-36" />
              <input type="number" placeholder="Qty" min="1" value={it.qty}
                onChange={(e) => updateItemField(it.id, "qty", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-16 text-right" />
              <input type="number" placeholder="Price" min="0" step="0.01" value={it.unitPrice}
                onChange={(e) => updateItemField(it.id, "unitPrice", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-20 text-right" />
              <select value={it.currency}
                onChange={(e) => updateItemField(it.id, "currency", e.target.value)}
                className="border border-gray-300 rounded px-1.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-16">
                <option>CAD</option>
                <option>USD</option>
              </select>
              {items.length > 1 && (
                <button onClick={() => removeItem(it.id)}
                  className="text-gray-300 hover:text-red-400 text-lg leading-none px-1">×</button>
              )}
            </div>
          ))}
        </div>
        {items[0]?.name && !items[0]?.fromCat && (
          <div className="text-xs text-gray-400 mt-1.5 italic">
            Category guess: <strong className="text-gray-500">{items[0].category}</strong>
          </div>
        )}
        <button onClick={addItem} className="mt-2 text-xs text-blue-500 hover:text-blue-700">
          + Add item
        </button>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Notes</label>
        <textarea rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Context, urgency, link to protocol..."
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
      </div>

      {/* Flags + total */}
      {total > 0 && (
        <div className="mb-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-gray-500">Estimated total:</span>
            <span className="font-semibold text-gray-800">{f$(total)} CAD</span>
            {total >= threshold ? (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Requires manager approval</span>
            ) : (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Will auto-approve (under {f$(threshold)})</span>
            )}
          </div>
          {hasUSD && (
            <div className="text-xs text-orange-500">
              ⚠ Contains USD items — converted at {usdRate} CAD/USD
            </div>
          )}
          {freeShipFlag && (
            <div className="text-xs text-purple-700 bg-purple-50 rounded px-2.5 py-1.5">
              💡 Order is under {f$(+vendor.freeShippingThreshold)} — consider batching to reach free shipping threshold
            </div>
          )}
        </div>
      )}

      {success && (
        <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          Order submitted. {total >= threshold ? "Waiting for manager approval." : "Auto-approved."}
        </div>
      )}
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      <Btn onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting..." : "Submit Order"}
      </Btn>
    </Card>
  );
}

// ── Approval Queue (manager) ──────────────────────────────────────────────────
function ApprovalQueue({ data, setData, userName, grants }) {
  const pending = data.orders.filter((o) => o.status === "pending");
  const [approvingId, setApprovingId] = useState(null);
  const [selectedGrant, setSelectedGrant] = useState("");
  const [saving, setSaving] = useState(false);

  if (pending.length === 0) return null;

  async function handleApprove(orderId) {
    setSaving(true);
    const newData = {
      ...data,
      orders: data.orders.map((o) => o.id !== orderId ? o : {
        ...o,
        status: "approved",
        grantId: selectedGrant || null,
        approvedBy: userName,
        approvedAt: new Date().toISOString(),
      }),
    };
    await apiSave(newData, userName);
    setData(newData);
    setApprovingId(null);
    setSelectedGrant("");
    setSaving(false);
  }

  async function handleReject(orderId) {
    setSaving(true);
    const newData = {
      ...data,
      orders: data.orders.map((o) => o.id !== orderId ? o : {
        ...o,
        status: "rejected",
        approvedBy: userName,
        approvedAt: new Date().toISOString(),
      }),
    };
    await apiSave(newData, userName);
    setData(newData);
    setSaving(false);
  }

  function startApprove(orderId) {
    setApprovingId(orderId);
    setSelectedGrant("");
  }

  function cancelApprove() {
    setApprovingId(null);
    setSelectedGrant("");
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-4">
      <SectionHead>Pending Approval — {pending.length} order{pending.length !== 1 ? "s" : ""}</SectionHead>
      <div className="space-y-3">
        {pending.map((order) => {
          const vendor = data.vendors.find((v) => v.id === order.vendorId);
          return (
            <div key={order.id} className="bg-white rounded-lg border border-amber-100 p-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-medium text-gray-800 text-sm">{order.submittedBy}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">{fmtDate(order.submittedAt)}</span>
                {vendor && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{vendor.name}</span>}
              </div>
              <div className="text-sm text-gray-600 mb-1">
                {order.items.map((it, i) => (
                  <span key={i}>{i > 0 && ", "}{it.qty > 1 ? it.qty + "× " : ""}{it.name}</span>
                ))}
              </div>
              {order.notes && <div className="text-xs text-gray-400 italic mb-1">{order.notes}</div>}
              <div className="font-semibold text-gray-800 text-sm mb-3">{f$(order.totalCAD)} CAD</div>
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
                {approvingId === order.id ? (
                  <>
                    <select value={selectedGrant}
                      onChange={(e) => setSelectedGrant(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none">
                      <option value="">No grant assigned yet</option>
                      {grants.map((g) => (
                        <option key={g.id} value={g.id}>{g.name || g.id}</option>
                      ))}
                    </select>
                    <Btn onClick={() => handleApprove(order.id)} disabled={saving} v="green" sm>Confirm approve</Btn>
                    <Btn onClick={cancelApprove} v="secondary" sm>Cancel</Btn>
                  </>
                ) : (
                  <>
                    <Btn onClick={() => startApprove(order.id)} v="green" sm>Approve</Btn>
                    <Btn onClick={() => handleReject(order.id)} disabled={saving} v="red" sm>Reject</Btn>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ data, setData, role, userName, grants }) {
  const [month, setMonth] = useState(thisMonth());
  const [editingGrantId, setEditingGrantId] = useState(null);
  const [draftGrant, setDraftGrant] = useState("");
  const [saving, setSaving] = useState(false);

  const availableMonths = useMemo(() => {
    const set = new Set(data.orders.map((o) => o.submittedAt.slice(0, 7)));
    set.add(thisMonth());
    return Array.from(set).sort().reverse();
  }, [data.orders]);

  const filtered = useMemo(() => {
    return data.orders
      .filter((o) => o.submittedAt.slice(0, 7) === month)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }, [data.orders, month]);

  async function saveGrantAssignment(orderId) {
    setSaving(true);
    const newData = {
      ...data,
      orders: data.orders.map((o) => o.id !== orderId ? o : { ...o, grantId: draftGrant || null }),
    };
    await apiSave(newData, userName);
    setData(newData);
    setEditingGrantId(null);
    setSaving(false);
  }

  function startEditGrant(order) {
    setEditingGrantId(order.id);
    setDraftGrant(order.grantId || "");
  }

  function cancelEditGrant() {
    setEditingGrantId(null);
    setDraftGrant("");
  }

  return (
    <Card>
      <div className="p-4 border-b border-gray-100 flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Orders</span>
        <div className="ml-auto">
          <select value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:outline-none">
            {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">No orders for {month}</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {filtered.map((order) => {
            const vendor = data.vendors.find((v) => v.id === order.vendorId);
            const grant = grants.find((g) => g.id === order.grantId);
            return (
              <div key={order.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-medium text-sm text-gray-800">{order.submittedBy}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-400">{fmtDate(order.submittedAt)}</span>
                      {vendor && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{vendor.name}</span>}
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="text-sm text-gray-600 mb-1.5">
                      {order.items.map((it, i) => (
                        <span key={i}>{i > 0 && ", "}{it.qty > 1 ? it.qty + "× " : ""}{it.name}
                          {it.unitPrice ? <span className="text-gray-400"> ({f$(+it.unitPrice * +it.qty)} {it.currency})</span> : null}
                        </span>
                      ))}
                    </div>
                    {order.notes && <div className="text-xs text-gray-400 italic mb-1.5">{order.notes}</div>}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{f$(order.totalCAD)}</span>
                      {role === "manager" ? (
                        editingGrantId === order.id ? (
                          <div className="flex items-center gap-2">
                            <select value={draftGrant}
                              onChange={(e) => setDraftGrant(e.target.value)}
                              className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none">
                              <option value="">No grant</option>
                              {grants.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
                            </select>
                            <Btn onClick={() => saveGrantAssignment(order.id)} disabled={saving} v="green" sm>Save</Btn>
                            <Btn onClick={cancelEditGrant} v="secondary" sm>Cancel</Btn>
                          </div>
                        ) : (
                          <button onClick={() => startEditGrant(order)}
                            className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2">
                            {grant ? (grant.name || grant.id) : "Assign grant →"}
                          </button>
                        )
                      ) : (
                        grant && <span className="text-xs text-gray-400">{grant.name || grant.id}</span>
                      )}
                      {order.estimatedArrival && (
                        <span className="text-xs text-gray-400">Est. {order.estimatedArrival}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Spend Tab ────────────────────────────────────────────────────────────────
function SpendTab({ data, grants }) {
  const [mode, setMode] = useState("grant");
  const [fromMonth, setFromMonth] = useState(thisMonth());
  const [toMonth, setToMonth] = useState(thisMonth());

  const availableMonths = useMemo(() => {
    const set = new Set(data.orders.map((o) => o.submittedAt.slice(0, 7)));
    set.add(thisMonth());
    return Array.from(set).sort().reverse();
  }, [data.orders]);

  const approvedOrders = useMemo(() => {
    return data.orders.filter((o) => {
      const m = o.submittedAt.slice(0, 7);
      return (o.status === "approved" || o.status === "auto-approved") && m >= fromMonth && m <= toMonth;
    });
  }, [data.orders, fromMonth, toMonth]);

  const rows = useMemo(() => {
    const map = {};
    for (const o of approvedOrders) {
      const key = mode === "grant" ? (o.grantId || "__unassigned__") : o.submittedBy;
      map[key] = (map[key] || 0) + (+o.totalCAD || 0);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [approvedOrders, mode]);

  const total = approvedOrders.reduce((s, o) => s + (+o.totalCAD || 0), 0);
  const maxVal = rows.length ? rows[0][1] : 1;

  function rowLabel(key) {
    if (mode === "grant") {
      if (key === "__unassigned__") return "Unassigned";
      const g = grants.find((g) => g.id === key);
      return g ? (g.name || g.id) : key;
    }
    return key;
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Spend Tracker</span>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            <button onClick={() => setMode("grant")}
              className={"px-3 py-1.5 text-xs font-medium transition-colors " + (mode === "grant" ? "bg-blue-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50")}>
              By Grant
            </button>
            <button onClick={() => setMode("person")}
              className={"px-3 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors " + (mode === "person" ? "bg-blue-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50")}>
              By Person
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <select value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 focus:outline-none">
              {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-gray-400">to</span>
            <select value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 focus:outline-none">
              {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-10">No approved orders in this range</div>
      ) : (
        <div>
          <div className="text-sm text-gray-500 mb-4">
            Total: <span className="font-semibold text-gray-800">{f$(total)}</span>
            <span className="text-xs text-gray-400 ml-2">({approvedOrders.length} order{approvedOrders.length !== 1 ? "s" : ""})</span>
          </div>
          <div className="space-y-2.5">
            {rows.map(([key, val]) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-40 text-xs text-gray-600 truncate shrink-0 font-medium">{rowLabel(key)}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-blue-500 h-3 rounded-full transition-all"
                    style={{ width: (val / maxVal * 100) + "%" }} />
                </div>
                <div className="text-xs font-semibold text-gray-700 w-20 text-right shrink-0">{f$(val)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Vendors Tab ──────────────────────────────────────────────────────────────
function VendorsTab({ data, setData, role, userName }) {
  const isManager = role === "manager";
  const [section, setSection] = useState("vendors");
  const [editingVendor, setEditingVendor] = useState(null);
  const [saving, setSaving] = useState(false);
  const unconfirmed = data.catalogue.filter((c) => !c.categoryConfirmed);

  // Vendor form
  function emptyVendorForm() {
    return { id: null, name: "", currency: "CAD", taxRate: "", freeShippingThreshold: "", leadTimeDays: "", notes: "" };
  }
  const [vf, setVf] = useState(emptyVendorForm());

  function openNewVendor() {
    setVf(emptyVendorForm());
    setEditingVendor("new");
  }

  function openEditVendor(v) {
    setVf({ ...emptyVendorForm(), ...v });
    setEditingVendor(v);
  }

  function cancelVendorEdit() {
    setEditingVendor(null);
  }

  async function saveVendor() {
    setSaving(true);
    const v = { ...vf, id: vf.id || uid() };
    const vendors = editingVendor === "new"
      ? [...data.vendors, v]
      : data.vendors.map((x) => x.id === v.id ? v : x);
    const newData = { ...data, vendors };
    await apiSave(newData, userName);
    setData(newData);
    setEditingVendor(null);
    setSaving(false);
  }

  async function deleteVendor(id) {
    if (!confirm("Remove this vendor?")) return;
    setSaving(true);
    const newData = { ...data, vendors: data.vendors.filter((v) => v.id !== id) };
    await apiSave(newData, userName);
    setData(newData);
    setSaving(false);
  }

  async function confirmCategory(catId, newCat) {
    const newData = {
      ...data,
      catalogue: data.catalogue.map((c) => c.id !== catId ? c : { ...c, category: newCat, categoryConfirmed: true }),
    };
    await apiSave(newData, userName);
    setData(newData);
  }

  // Settings
  const [sf, setSf] = useState({ ...data.settings });
  const [pf, setPf] = useState({
    monthlyAllocation: data.budgetPool.monthlyAllocation,
    consumablesAllocation: data.budgetPool.consumablesAllocation,
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  async function saveSettings() {
    setSaving(true);
    const newData = {
      ...data,
      settings: { ...data.settings, ...sf },
      budgetPool: {
        ...data.budgetPool,
        monthlyAllocation: +pf.monthlyAllocation || 5000,
        consumablesAllocation: +pf.consumablesAllocation || 2000,
      },
    };
    await apiSave(newData, userName);
    setData(newData);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
    setSaving(false);
  }

  // Top-up
  const [tuAmount, setTuAmount] = useState("");
  const [tuReason, setTuReason] = useState("");
  const [tuSaving, setTuSaving] = useState(false);
  const [tuSuccess, setTuSuccess] = useState(false);

  async function submitTopUp() {
    if (!tuAmount) return;
    setTuSaving(true);
    const req = {
      id: uid(), requestedBy: userName, amount: +tuAmount,
      reason: tuReason.trim(), requestedAt: new Date().toISOString(), status: "pending",
    };
    const newData = {
      ...data,
      budgetPool: { ...data.budgetPool, topUpRequests: [...(data.budgetPool.topUpRequests || []), req] },
    };
    await apiSave(newData, userName);
    setData(newData);
    setTuAmount("");
    setTuReason("");
    setTuSaving(false);
    setTuSuccess(true);
    setTimeout(() => setTuSuccess(false), 4000);
  }

  async function resolveTopUp(reqId, approve) {
    setSaving(true);
    const req = (data.budgetPool.topUpRequests || []).find((r) => r.id === reqId);
    const newBalance = approve && req ? data.budgetPool.balance + (+req.amount || 0) : data.budgetPool.balance;
    const newData = {
      ...data,
      budgetPool: {
        ...data.budgetPool,
        balance: newBalance,
        topUpRequests: (data.budgetPool.topUpRequests || []).map((r) =>
          r.id !== reqId ? r : { ...r, status: approve ? "approved" : "rejected" }
        ),
      },
    };
    await apiSave(newData, userName);
    setData(newData);
    setSaving(false);
  }

  const pendingTopUps = (data.budgetPool.topUpRequests || []).filter((r) => r.status === "pending");
  const sectionTabs = [
    ["vendors", "Vendors"],
    ["catalogue", "Catalogue" + (unconfirmed.length > 0 && isManager ? ` (${unconfirmed.length})` : "")],
    ["settings", "Settings"],
  ];

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-2">
        {sectionTabs.map(([k, l]) => (
          <button key={k} onClick={() => setSection(k)}
            className={"px-3 py-1.5 text-sm rounded-md transition-colors "
              + (section === k ? "bg-blue-700 text-white font-medium" : "text-gray-500 hover:bg-gray-100")}>
            {l}
          </button>
        ))}
      </div>

      {/* Vendors */}
      {section === "vendors" && (
        <div>
          {isManager && (
            <div className="mb-4">
              <Btn onClick={openNewVendor} sm>+ Add vendor</Btn>
            </div>
          )}
          {editingVendor && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-5">
              <SectionHead>{editingVendor === "new" ? "New Vendor" : "Edit Vendor"}</SectionHead>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-gray-500 mb-1">Name</label>
                  <input type="text" value={vf.name}
                    onChange={(e) => setVf((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Currency</label>
                  <select value={vf.currency}
                    onChange={(e) => setVf((p) => ({ ...p, currency: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option>CAD</option>
                    <option>USD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tax rate (0.05 = 5%)</label>
                  <input type="number" step="0.01" min="0" max="1" value={vf.taxRate}
                    onChange={(e) => setVf((p) => ({ ...p, taxRate: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Free shipping over ($)</label>
                  <input type="number" min="0" value={vf.freeShippingThreshold}
                    onChange={(e) => setVf((p) => ({ ...p, freeShippingThreshold: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Lead time (days)</label>
                  <input type="number" min="0" value={vf.leadTimeDays}
                    onChange={(e) => setVf((p) => ({ ...p, leadTimeDays: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  <input type="text" value={vf.notes}
                    onChange={(e) => setVf((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
              </div>
              <div className="flex gap-2">
                <Btn onClick={saveVendor} disabled={saving || !vf.name} v="primary" sm>Save vendor</Btn>
                <Btn onClick={cancelVendorEdit} v="secondary" sm>Cancel</Btn>
              </div>
            </div>
          )}
          {data.vendors.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-10 bg-white rounded-xl border border-gray-200">
              No vendors yet{isManager ? " — add one above" : ""}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.vendors.map((v) => (
                <div key={v.id} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 mb-1.5">{v.name}</div>
                      <div className="flex gap-2 flex-wrap">
                        <span className={"px-1.5 py-0.5 rounded text-xs font-medium " + (v.currency === "USD" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>{v.currency}</span>
                        {+v.taxRate > 0 && <span className="text-xs text-gray-500">Tax {(+v.taxRate * 100).toFixed(0)}%</span>}
                        {+v.freeShippingThreshold > 0 && <span className="text-xs text-gray-500">Free ship {f$(+v.freeShippingThreshold)}+</span>}
                        {+v.leadTimeDays > 0 && <span className="text-xs text-gray-500">~{v.leadTimeDays}d lead</span>}
                      </div>
                      {v.notes && <div className="text-xs text-gray-400 mt-1 italic">{v.notes}</div>}
                    </div>
                    {isManager && (
                      <div className="flex gap-1 ml-2">
                        <Btn onClick={() => openEditVendor(v)} v="ghost" sm>Edit</Btn>
                        <Btn onClick={() => deleteVendor(v.id)} v="ghost" sm>✕</Btn>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Catalogue */}
      {section === "catalogue" && (
        <div className="space-y-4">
          {isManager && unconfirmed.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <SectionHead>Unconfirmed Categories — {unconfirmed.length} item{unconfirmed.length !== 1 ? "s" : ""}</SectionHead>
              <p className="text-xs text-gray-500 mb-3">These were auto-categorized when submitted. Confirm or change the category.</p>
              <div className="space-y-2">
                {unconfirmed.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-amber-100 p-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-800">{c.name}</div>
                      <div className="text-xs text-gray-400">{[c.supplier, c.catNo, c.unit].filter(Boolean).join(" · ")}</div>
                    </div>
                    <select defaultValue={c.category}
                      onChange={(e) => confirmCategory(c.id, e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none">
                      {ALL_CATS.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Card>
            <div className="p-4 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                All Items ({data.catalogue.length})
              </span>
            </div>
            {data.catalogue.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">
                The catalogue builds automatically as orders are submitted
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {data.catalogue.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{c.name}</div>
                      <div className="text-xs text-gray-400">{[c.supplier, c.catNo, c.unit].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-500">{c.category}</span>
                      {!c.categoryConfirmed && (
                        <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">Unconfirmed</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Settings */}
      {section === "settings" && (
        <div className="space-y-4">
          {/* Top-up request (members) */}
          {!isManager && (
            <Card className="p-5">
              <SectionHead>Request Budget Top-up</SectionHead>
              <div className="flex gap-2 items-end flex-wrap">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount ($)</label>
                  <input type="number" min="0" value={tuAmount}
                    onChange={(e) => setTuAmount(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div className="flex-1 min-w-40">
                  <label className="block text-xs text-gray-500 mb-1">Reason</label>
                  <input type="text" value={tuReason}
                    onChange={(e) => setTuReason(e.target.value)}
                    placeholder="e.g. Urgent reagent restock"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <Btn onClick={submitTopUp} disabled={tuSaving || !tuAmount} sm>Request</Btn>
              </div>
              {tuSuccess && <div className="text-xs text-emerald-600 mt-2">Top-up request sent to manager.</div>}
            </Card>
          )}

          {isManager && (
            <>
              {/* Pending top-up requests */}
              {pendingTopUps.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                  <SectionHead>Top-up Requests — {pendingTopUps.length} pending</SectionHead>
                  <div className="space-y-2">
                    {pendingTopUps.map((req) => (
                      <div key={req.id} className="flex items-center justify-between bg-white rounded-lg border border-amber-100 p-3 gap-3 flex-wrap">
                        <div>
                          <span className="font-medium text-sm text-gray-800">{req.requestedBy}</span>
                          <span className="text-gray-300 mx-2">·</span>
                          <span className="font-semibold text-gray-800">{f$(req.amount)}</span>
                          {req.reason && <span className="text-xs text-gray-400 ml-2">— {req.reason}</span>}
                          <div className="text-xs text-gray-400">{fmtDate(req.requestedAt)}</div>
                        </div>
                        <div className="flex gap-2">
                          <Btn onClick={() => resolveTopUp(req.id, true)} disabled={saving} v="green" sm>Approve</Btn>
                          <Btn onClick={() => resolveTopUp(req.id, false)} disabled={saving} v="red" sm>Reject</Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Budget pool */}
              <Card className="p-5">
                <SectionHead>Budget Pool</SectionHead>
                <div className="text-xs text-gray-400 mb-3">
                  Auto-resets on the 1st of each month. Current balance: <strong className="text-gray-600">{f$(data.budgetPool.balance)}</strong>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Monthly allocation ($)</label>
                    <input type="number" min="0" value={pf.monthlyAllocation}
                      onChange={(e) => setPf((p) => ({ ...p, monthlyAllocation: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Consumables allocation ($)</label>
                    <input type="number" min="0" value={pf.consumablesAllocation}
                      onChange={(e) => setPf((p) => ({ ...p, consumablesAllocation: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
              </Card>

              {/* Procurement settings */}
              <Card className="p-5">
                <SectionHead>Procurement Settings</SectionHead>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Auto-approve under ($)</label>
                    <input type="number" min="0" value={sf.autoApproveThreshold}
                      onChange={(e) => setSf((p) => ({ ...p, autoApproveThreshold: +e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">USD → CAD rate</label>
                    <input type="number" min="1" step="0.01" value={sf.usdRate}
                      onChange={(e) => setSf((p) => ({ ...p, usdRate: +e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Notification email (for orders over threshold)</label>
                    <input type="email" value={sf.notificationEmail}
                      onChange={(e) => setSf((p) => ({ ...p, notificationEmail: e.target.value }))}
                      placeholder="e.g. madhu@example.com"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    <div className="text-xs text-gray-400 mt-1">Note: email delivery requires a Resend or SendGrid integration — field saved for future use.</div>
                  </div>
                </div>
              </Card>

              {/* Member names */}
              <Card className="p-5">
                <SectionHead>Lab Member Names</SectionHead>
                <p className="text-xs text-gray-400 mb-2">One name per line. These appear in the name picker at login.</p>
                <textarea rows={7} value={(sf.memberNames || []).join("\n")}
                  onChange={(e) => setSf((p) => ({ ...p, memberNames: e.target.value.split("\n").map((n) => n.trim()).filter(Boolean) }))}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </Card>

              <div className="flex items-center gap-3">
                <Btn onClick={saveSettings} disabled={saving}>Save all settings</Btn>
                {settingsSaved && <span className="text-xs text-emerald-600">Saved.</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function Procurement() {
  const [role, setRole] = useState(null);
  const [userName, setUserName] = useState(null);
  const [data, setData] = useState(BLANK);
  const [grants, setGrants] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("queue");

  const load = useCallback(async function() {
    try {
      const json = await apiLoad();
      if (json.data) {
        setData(maybeResetPool(safeData(json.data)));
      }
    } catch (e) {
      console.error("Load failed:", e);
    }
    setLoaded(true);
  }, []);

  async function loadGrants() {
    try {
      const g = await apiLoadGrants();
      setGrants(g);
    } catch {}
  }

  function handleLogin(r, n) {
    setRole(r);
    setUserName(n);
  }

  useEffect(function() {
    if (role) {
      load();
      if (role === "manager") loadGrants();
    }
  }, [role, load]);

  const pendingCount = data.orders.filter((o) => o.status === "pending").length;

  const TABS = [
    ["queue",   role === "manager" && pendingCount > 0 ? `Queue (${pendingCount})` : "Queue"],
    ["orders",  "Orders"],
    ["spend",   "Spend"],
    ["vendors", "Vendors"],
  ];

  if (!role) return <LoginScreen onLogin={handleLogin} />;

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-400">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-600 mb-2">Lab Procurement</div>
          <div className="text-sm">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Procurement — Yachie Lab</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="text-white" style={{ background: HEADER_COLOR }}>
          <div className="px-5 pt-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-base">Yachie Lab — Procurement</div>
              <div className="text-blue-300 text-xs mt-1">
                {userName} · <span className="capitalize">{role}</span>
                {" "}· Pool remaining: {f$(data.budgetPool.balance)}
              </div>
            </div>
            <a href="/" className="text-blue-300 hover:text-white text-xs transition-colors whitespace-nowrap">← Grant Dashboard</a>
          </div>
          <div className="flex gap-0.5 px-4 pt-3 overflow-x-auto">
            {TABS.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                style={tab !== k ? { color: "rgba(255,255,255,0.75)" } : {}}
                className={"px-4 py-2 text-sm rounded-t-md transition-colors whitespace-nowrap "
                  + (tab === k ? "bg-gray-50 text-blue-900 font-medium" : "hover:bg-black/10")}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 max-w-4xl mx-auto">
          {tab === "queue" && (
            <div className="space-y-4">
              {role === "manager" && pendingCount > 0 && (
                <ApprovalQueue data={data} setData={setData} userName={userName} grants={grants} />
              )}
              <OrderForm data={data} setData={setData} userName={userName} />
            </div>
          )}
          {tab === "orders"  && <OrdersTab  data={data} setData={setData} role={role} userName={userName} grants={grants} />}
          {tab === "spend"   && <SpendTab   data={data} grants={grants} />}
          {tab === "vendors" && <VendorsTab data={data} setData={setData} role={role} userName={userName} />}
        </div>
      </div>
      <div className="text-center py-3 text-xs text-gray-300 border-t border-gray-100 mt-4">
        Yachie Lab GMS · UBC SBME · CC BY-NC 4.0
      </div>
    </>
  );
}
