/**
 * Lab Grant Management System — Configuration
 * ─────────────────────────────────────────────
 * Edit this file to customise the app for your lab.
 * Do NOT edit pages/index.jsx unless you are adding new features.
 *
 * Original system: Yachie Lab, UBC SBME (2025)
 * github.com/madhurangesa/lab-gms
 */

const LAB_CONFIG = {

  // ── Identity ──────────────────────────────────────────────────────────
  labName:     "Demo Lab",
  labSubtitle: "Grant Management System",
  pageTitle:   "Demo Lab GMS",

  // ── Header colour (hex) ───────────────────────────────────────────────
  headerColor: "#6b21a8",

  // ── Forecast start date ───────────────────────────────────────────────
  forecastStart: "2025-04-01",

  // ── Research cost categories ──────────────────────────────────────────
  categories: null,

  // ── Personnel roles ───────────────────────────────────────────────────
  roles: null,

};

if (typeof module !== "undefined") module.exports = LAB_CONFIG;
