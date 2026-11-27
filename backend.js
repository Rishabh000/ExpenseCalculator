// ═══════════════════════════════════════════════════════════════════════════
//  backend.js  –  Data / business-logic layer for Monthly Expense Calculator
//  Owns: persistence, CRUD, filtering, sorting, budgets, stats, CSV export.
//  The UI (app.js) calls these functions; it never touches localStorage directly.
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

// ── Storage keys ────────────────────────────────────────────────────────────
const KEYS = {
  EXPENSES: "expenses",
  NEXT_ID:  "nextId",
  BUDGETS:  "budgets",
  SETTINGS: "settings",
};

// ── Default settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  currency: "USD",   // future-proof; UI currently shows $ only
  monthlyBudget: 0,  // 0 = not set
};

// ═══════════════════════════════════════════════════════════════════════════
//  1.  LOW-LEVEL PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

function _load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function _save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── In-memory state (single source of truth) ────────────────────────────────
let _expenses = _load(KEYS.EXPENSES, []);
let _nextId   = _load(KEYS.NEXT_ID,  1);
let _budgets  = _load(KEYS.BUDGETS,  {});   // { Category: number }
let _settings = Object.assign({}, DEFAULT_SETTINGS, _load(KEYS.SETTINGS, {}));

function _persist() {
  _save(KEYS.EXPENSES, _expenses);
  _save(KEYS.NEXT_ID,  _nextId);
  _save(KEYS.BUDGETS,  _budgets);
  _save(KEYS.SETTINGS, _settings);
}

// ═══════════════════════════════════════════════════════════════════════════
//  2.  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates a raw expense input object.
 * @param {{ category: string, name: string, amount: string|number }} input
 * @returns {{ valid: boolean, error: string, amount: number }}
 */
function validateExpense(input) {
  const amount = parseFloat(input.amount);

  if (!input.category || typeof input.category !== "string") {
    return { valid: false, error: "Category is required.", amount: NaN };
  }
  if (input.amount === "" || input.amount === null || input.amount === undefined) {
    return { valid: false, error: "Please enter an amount.", amount: NaN };
  }
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Please enter a valid amount greater than 0.", amount: NaN };
  }
  if (amount > 1_000_000) {
    return { valid: false, error: "Amount cannot exceed $1,000,000.", amount: NaN };
  }

  return { valid: true, error: "", amount: parseFloat(amount.toFixed(2)) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  3.  CRUD — Expenses
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a new expense.
 * @param {{ category: string, name?: string, amount: number|string }} input
 * @returns {{ success: boolean, error?: string, expense?: object }}
 */
function addExpense(input) {
  const { valid, error, amount } = validateExpense(input);
  if (!valid) return { success: false, error };

  const expense = {
    id:        _nextId++,
    category:  input.category.trim(),
    name:      (input.name || "").trim(),
    amount,
    createdAt: Date.now(),
  };

  _expenses.push(expense);
  _persist();
  return { success: true, expense };
}

/**
 * Remove an expense by id.
 * @param {number} id
 * @returns {{ success: boolean, error?: string }}
 */
function removeExpense(id) {
  const before = _expenses.length;
  _expenses = _expenses.filter((e) => e.id !== id);

  if (_expenses.length === before) {
    return { success: false, error: `No expense found with id ${id}.` };
  }

  _persist();
  return { success: true };
}

/**
 * Update an existing expense (partial update — only supply fields to change).
 * @param {number} id
 * @param {{ category?: string, name?: string, amount?: number|string }} changes
 * @returns {{ success: boolean, error?: string, expense?: object }}
 */
function updateExpense(id, changes) {
  const idx = _expenses.findIndex((e) => e.id === id);
  if (idx === -1) return { success: false, error: `No expense found with id ${id}.` };

  const merged = Object.assign({}, _expenses[idx], changes);
  const { valid, error, amount } = validateExpense(merged);
  if (!valid) return { success: false, error };

  _expenses[idx] = Object.assign({}, merged, {
    amount,
    updatedAt: Date.now(),
  });

  _persist();
  return { success: true, expense: _expenses[idx] };
}

/**
 * Remove all expenses (requires explicit confirmation flag).
 * @param {boolean} confirmed
 * @returns {{ success: boolean, error?: string, removed: number }}
 */
function clearAllExpenses(confirmed) {
  if (!confirmed) return { success: false, error: "Not confirmed.", removed: 0 };
  const removed = _expenses.length;
  _expenses = [];
  _nextId   = 1;
  _persist();
  return { success: true, removed };
}

// ═══════════════════════════════════════════════════════════════════════════
//  4.  QUERY — Filter & Sort
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Return expenses, optionally filtered and sorted.
 *
 * @param {{
 *   category?:  string,          // exact category match, or omit for all
 *   search?:    string,          // substring match on name (case-insensitive)
 *   minAmount?: number,
 *   maxAmount?: number,
 *   sortBy?:    "date"|"amount"|"category"|"name",
 *   sortDir?:   "asc"|"desc",
 * }} opts
 * @returns {object[]}  shallow copies of matching expenses
 */
function getExpenses(opts = {}) {
  let list = _expenses.slice(); // never expose the internal array

  // — Filter —
  if (opts.category) {
    list = list.filter((e) => e.category === opts.category);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q));
  }
  if (opts.minAmount !== undefined) {
    list = list.filter((e) => e.amount >= opts.minAmount);
  }
  if (opts.maxAmount !== undefined) {
    list = list.filter((e) => e.amount <= opts.maxAmount);
  }

  // — Sort —
  const dir = opts.sortDir === "asc" ? 1 : -1;
  switch (opts.sortBy) {
    case "amount":
      list.sort((a, b) => dir * (a.amount - b.amount));
      break;
    case "category":
      list.sort((a, b) => dir * a.category.localeCompare(b.category));
      break;
    case "name":
      list.sort((a, b) => dir * a.name.localeCompare(b.name));
      break;
    case "date":
    default:
      list.sort((a, b) => dir * (a.createdAt - b.createdAt));
      break;
  }

  return list;
}

/**
 * Return a single expense by id, or null.
 * @param {number} id
 * @returns {object|null}
 */
function getExpenseById(id) {
  return _expenses.find((e) => e.id === id) || null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  5.  STATISTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute summary statistics for the current expense list.
 *
 * @returns {{
 *   total:        number,
 *   count:        number,
 *   average:      number,
 *   highest:      object|null,
 *   lowest:       object|null,
 *   byCategory:   { [cat]: { total: number, count: number, pct: number } },
 *   budgetStatus: { [cat]: { budget: number, spent: number, remaining: number, over: boolean } },
 *   overallBudget:{ budget: number, spent: number, remaining: number, over: boolean }|null
 * }}
 */
function getStats() {
  const list  = _expenses;
  const total = list.reduce((s, e) => s + e.amount, 0);
  const count = list.length;

  // by-category breakdown
  const byCategory = {};
  list.forEach((e) => {
    if (!byCategory[e.category]) {
      byCategory[e.category] = { total: 0, count: 0, pct: 0 };
    }
    byCategory[e.category].total  += e.amount;
    byCategory[e.category].count  += 1;
  });
  if (total > 0) {
    Object.keys(byCategory).forEach((cat) => {
      byCategory[cat].pct = parseFloat(
        ((byCategory[cat].total / total) * 100).toFixed(1)
      );
    });
  }

  // per-category budget status
  const budgetStatus = {};
  Object.keys(_budgets).forEach((cat) => {
    const budget  = _budgets[cat];
    const spent   = byCategory[cat] ? byCategory[cat].total : 0;
    budgetStatus[cat] = {
      budget,
      spent:     parseFloat(spent.toFixed(2)),
      remaining: parseFloat((budget - spent).toFixed(2)),
      over:      spent > budget,
    };
  });

  // overall monthly budget status
  let overallBudget = null;
  if (_settings.monthlyBudget > 0) {
    overallBudget = {
      budget:    _settings.monthlyBudget,
      spent:     parseFloat(total.toFixed(2)),
      remaining: parseFloat((_settings.monthlyBudget - total).toFixed(2)),
      over:      total > _settings.monthlyBudget,
    };
  }

  const sorted = list.slice().sort((a, b) => a.amount - b.amount);

  return {
    total:        parseFloat(total.toFixed(2)),
    count,
    average:      count > 0 ? parseFloat((total / count).toFixed(2)) : 0,
    highest:      sorted.length ? { ...sorted[sorted.length - 1] } : null,
    lowest:       sorted.length ? { ...sorted[0] }                 : null,
    byCategory,
    budgetStatus,
    overallBudget,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  6.  BUDGET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set (or clear) a spending budget for one category.
 * @param {string} category
 * @param {number} amount   Pass 0 or negative to remove the budget.
 * @returns {{ success: boolean, error?: string }}
 */
function setCategoryBudget(category, amount) {
  if (!category) return { success: false, error: "Category required." };
  const n = parseFloat(amount);
  if (isNaN(n) || n < 0) return { success: false, error: "Budget must be ≥ 0." };

  if (n === 0) {
    delete _budgets[category];
  } else {
    _budgets[category] = parseFloat(n.toFixed(2));
  }
  _persist();
  return { success: true };
}

/**
 * Get the budget for a category (0 if not set).
 * @param {string} category
 * @returns {number}
 */
function getCategoryBudget(category) {
  return _budgets[category] || 0;
}

/**
 * Set the overall monthly spending budget.
 * @param {number} amount  Pass 0 to disable.
 * @returns {{ success: boolean, error?: string }}
 */
function setMonthlyBudget(amount) {
  const n = parseFloat(amount);
  if (isNaN(n) || n < 0) return { success: false, error: "Budget must be ≥ 0." };
  _settings.monthlyBudget = parseFloat(n.toFixed(2));
  _persist();
  return { success: true };
}

/**
 * Get the current monthly budget setting (0 = not set).
 * @returns {number}
 */
function getMonthlyBudget() {
  return _settings.monthlyBudget;
}

// ═══════════════════════════════════════════════════════════════════════════
//  7.  IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Export all expenses as a CSV string.
 * @returns {string}
 */
function exportCSV() {
  const header = ["ID", "Category", "Label", "Amount", "Date"];
  const rows   = _expenses.map((e) => [
    e.id,
    _csvCell(e.category),
    _csvCell(e.name || ""),
    e.amount.toFixed(2),
    e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "",
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\n");
}

/**
 * Trigger a browser download of the CSV file.
 */
function downloadCSV() {
  const csv  = exportCSV();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import expenses from a parsed array (e.g. from a JSON file upload).
 * Validates each row; skips invalid ones.
 * @param {object[]} rows
 * @param {{ replace?: boolean }} opts  replace=true clears existing data first
 * @returns {{ imported: number, skipped: number }}
 */
function importExpenses(rows, opts = {}) {
  if (!Array.isArray(rows)) return { imported: 0, skipped: 0 };

  if (opts.replace) {
    _expenses = [];
    _nextId   = 1;
  }

  let imported = 0;
  let skipped  = 0;

  rows.forEach((row) => {
    const { valid, amount } = validateExpense(row);
    if (!valid) { skipped++; return; }

    _expenses.push({
      id:        _nextId++,
      category:  String(row.category).trim(),
      name:      (row.name || "").trim(),
      amount,
      createdAt: row.createdAt ? Number(row.createdAt) : Date.now(),
    });
    imported++;
  });

  _persist();
  return { imported, skipped };
}

// ── CSV helper ───────────────────────────────────────────────────────────────
function _csvCell(val) {
  const s = String(val);
  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ═══════════════════════════════════════════════════════════════════════════
//  8.  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a copy of the current settings object.
 * @returns {object}
 */
function getSettings() {
  return Object.assign({}, _settings);
}

/**
 * Update one or more settings.
 * @param {object} patch
 */
function updateSettings(patch) {
  Object.assign(_settings, patch);
  _persist();
}

// ═══════════════════════════════════════════════════════════════════════════
//  9.  PUBLIC API  (everything the UI may call)
// ═══════════════════════════════════════════════════════════════════════════

const Backend = {
  // Expense CRUD
  addExpense,
  removeExpense,
  updateExpense,
  clearAllExpenses,

  // Querying
  getExpenses,
  getExpenseById,

  // Stats
  getStats,

  // Budgets
  setCategoryBudget,
  getCategoryBudget,
  setMonthlyBudget,
  getMonthlyBudget,

  // Import / Export
  exportCSV,
  downloadCSV,
  importExpenses,

  // Settings
  getSettings,
  updateSettings,

  // Validation (exposed so UI can validate on-the-fly without adding)
  validateExpense,
};
