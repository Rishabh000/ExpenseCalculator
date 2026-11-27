// ═══════════════════════════════════════════════════════════════════════════
//  app.js  –  UI layer for Monthly Expense Calculator
//  All data/storage logic lives in backend.js (Backend.*).
//  This file only handles DOM interaction and rendering.
// ═══════════════════════════════════════════════════════════════════════════

"use strict";

// ── Category emoji map (UI concern only) ────────────────────────────────────
const CATEGORY_EMOJI = {
  Housing:       "🏠",
  Groceries:     "🛒",
  Insurance:     "🛡️",
  Transport:     "🚗",
  Utilities:     "💡",
  Health:        "❤️",
  Education:     "📚",
  Entertainment: "🎬",
  Dining:        "🍔",
  Savings:       "💳",
  Other:         "📦",
};

// ── Sort state ───────────────────────────────────────────────────────────────
let _sortBy  = "date";
let _sortDir = "desc";

// ── Undo toast timer ─────────────────────────────────────────────────────────
let _undoTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Format a number as a dollar string, e.g. 1234.5 → "$1,234.50" */
function fmt(n) {
  return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Escape user-supplied strings before inserting into innerHTML. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADD EXPENSE
// ═══════════════════════════════════════════════════════════════════════════

function addExpense() {
  const category = document.getElementById("expense-category").value;
  const name     = document.getElementById("expense-name").value.trim();
  const amount   = document.getElementById("expense-amount").value;
  const errorEl  = document.getElementById("error-msg");

  const result = Backend.addExpense({ category, name, amount });

  if (!result.success) {
    errorEl.textContent = "⚠️ " + result.error;
    document.getElementById("expense-amount").focus();
    return;
  }

  errorEl.textContent = "";
  document.getElementById("expense-name").value   = "";
  document.getElementById("expense-amount").value = "";
  render(true); // true = animate the newest row
}

// ═══════════════════════════════════════════════════════════════════════════
//  REMOVE / UNDO / CLEAR
// ═══════════════════════════════════════════════════════════════════════════

function removeExpense(id) {
  Backend.removeExpense(id);
  render();
  showUndoToast(id);
}

function showUndoToast() {
  const toast = document.getElementById("undo-toast");
  if (!toast) return;
  toast.classList.add("visible");
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
}

function hideUndoToast() {
  const toast = document.getElementById("undo-toast");
  if (toast) toast.classList.remove("visible");
  clearTimeout(_undoTimer);
}

function undoDelete() {
  const result = Backend.undoRemove();
  if (result && result.success) {
    render();
    hideUndoToast();
  }
}

function clearAll() {
  if (!confirm("Remove all expenses? This cannot be undone.")) return;
  Backend.clearAllExpenses(true);
  render();
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUDGET
// ═══════════════════════════════════════════════════════════════════════════

function saveMonthlyBudget() {
  const input  = document.getElementById("monthly-budget");
  const notice = document.getElementById("budget-notice");
  const result = Backend.setMonthlyBudget(input.value);

  if (!result.success) {
    if (notice) notice.textContent = "⚠️ " + result.error;
    return;
  }
  if (notice) {
    notice.textContent = "✅ Budget saved!";
    setTimeout(() => { if (notice) notice.textContent = ""; }, 2500);
  }
  render();
}

// ═══════════════════════════════════════════════════════════════════════════
//  SORT  (called by column-header clicks in HTML)
// ═══════════════════════════════════════════════════════════════════════════

function sortBy(col) {
  if (_sortBy === col) {
    _sortDir = _sortDir === "asc" ? "desc" : "asc";
  } else {
    _sortBy  = col;
    _sortDir = col === "date" ? "desc" : "asc";
  }
  _updateSortHeaders();
  render();
}

function _updateSortHeaders() {
  document.querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === _sortBy) {
      th.classList.add(_sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  FILTER  (search box + category dropdown)
// ═══════════════════════════════════════════════════════════════════════════

function getFilter() {
  const searchEl   = document.getElementById("filter-search");
  const categoryEl = document.getElementById("filter-category");
  return {
    search:   searchEl   ? searchEl.value.trim()   : "",
    category: categoryEl ? categoryEl.value.trim() : "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER (top-level — calls all sub-renderers)
// ═══════════════════════════════════════════════════════════════════════════

function render(animateLatest = false) {
  renderTable(animateLatest);
  renderSummary();
  renderStats();
  renderBudgetBanner();
}

// ── Expense table ────────────────────────────────────────────────────────────
function renderTable(animateLatest = false) {
  const tbody    = document.getElementById("expense-body");
  const emptyRow = document.getElementById("empty-row");
  if (!tbody) return;

  // Remove all rows except the placeholder
  Array.from(tbody.querySelectorAll("tr:not(#empty-row)")).forEach((r) => r.remove());

  const { search, category } = getFilter();
  const expenses = Backend.getExpenses({
    sortBy:   _sortBy,
    sortDir:  _sortDir,
    search:   search   || undefined,
    category: category || undefined,
  });

  if (expenses.length === 0) {
    if (emptyRow) emptyRow.style.display = "";
    return;
  }
  if (emptyRow) emptyRow.style.display = "none";

  expenses.forEach((exp, idx) => {
    const emoji   = CATEGORY_EMOJI[exp.category] || "📦";
    const label   = exp.name ? escHtml(exp.name) : "<span class='no-label'>—</span>";
    const dateStr = exp.createdAt
      ? new Date(exp.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";

    const tr = document.createElement("tr");

    // Animate only the newest row when animateLatest is true
    if (animateLatest && idx === 0 && _sortDir === "desc" && _sortBy === "date") {
      tr.classList.add("new-row");
    }

    tr.innerHTML = `
      <td><span class="category-badge">${emoji} ${escHtml(exp.category)}</span></td>
      <td class="label-cell">${label}</td>
      <td class="amount-cell">${fmt(exp.amount)}</td>
      <td class="date-cell">${dateStr}</td>
      <td class="action-cell">
        <button class="btn-delete" title="Remove expense" onclick="removeExpense(${exp.id})">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Summary cards ────────────────────────────────────────────────────────────
function renderSummary() {
  const grid     = document.getElementById("category-summary");
  const totalEl  = document.getElementById("grand-total");
  if (!grid) return;

  const stats = Backend.getStats();

  if (totalEl) totalEl.textContent = fmt(stats.total);

  grid.innerHTML = "";

  if (stats.total === 0) {
    grid.innerHTML = `<p class="summary-empty">Add expenses above to see your breakdown.</p>`;
    return;
  }

  Object.entries(stats.byCategory)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([cat, data]) => {
      const emoji  = CATEGORY_EMOJI[cat] || "📦";
      const budget = Backend.getCategoryBudget(cat);
      const over   = budget > 0 && data.total > budget;

      const item = document.createElement("div");
      item.className = "summary-item" + (over ? " over-budget" : "");
      item.innerHTML = `
        <div class="cat-header">
          <span class="cat-name">${emoji} ${escHtml(cat)}</span>
          <span class="cat-pct">${data.pct}% of total</span>
        </div>
        <span class="cat-amount">${fmt(data.total)}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:0%"></div>
        </div>
        ${budget > 0 ? `
          <span class="cat-budget ${over ? "over" : "ok"}">
            ${over
              ? `⚠️ Over by ${fmt(data.total - budget)}`
              : `✅ ${fmt(budget - data.total)} left of ${fmt(budget)}`}
          </span>` : ""}
      `;
      grid.appendChild(item);

      // Animate bar width in next frame so CSS transition fires
      requestAnimationFrame(() => {
        const fill = item.querySelector(".cat-bar-fill");
        if (fill) fill.style.width = data.pct + "%";
      });
    });
}

// ── Stats strip ──────────────────────────────────────────────────────────────
function renderStats() {
  const stats   = Backend.getStats();
  const countEl = document.getElementById("stat-count");
  const avgEl   = document.getElementById("stat-avg");
  const highEl  = document.getElementById("stat-high");

  if (countEl) countEl.textContent = stats.count;
  if (avgEl)   avgEl.textContent   = fmt(stats.average);
  if (highEl)  highEl.textContent  = stats.highest ? fmt(stats.highest.amount) : "—";
}

// ── Overall budget banner ────────────────────────────────────────────────────
function renderBudgetBanner() {
  const stats         = Backend.getStats();
  const overallBudget = stats.overallBudget;
  const summaryCard   = document.querySelector(".summary-card");

  // Remove any existing banner
  const existing = document.getElementById("budget-banner");
  if (existing) existing.remove();

  if (!summaryCard || !overallBudget || overallBudget.budget === 0) return;

  const over = overallBudget.over;
  const pct  = Math.min(100, Math.round((overallBudget.spent / overallBudget.budget) * 100));

  const banner = document.createElement("div");
  banner.id        = "budget-banner";
  banner.className = "budget-banner" + (over ? " over" : "");
  banner.innerHTML = `
    <div class="budget-banner-top">
      <span class="budget-label">Monthly Budget</span>
      <span class="budget-status ${over ? "over" : "ok"}">
        ${over
          ? `⚠️ Over by ${fmt(overallBudget.spent - overallBudget.budget)}`
          : `✅ ${fmt(overallBudget.remaining)} remaining of ${fmt(overallBudget.budget)}`}
      </span>
    </div>
    <div class="budget-bar-track">
      <div class="budget-bar-fill ${over ? "over" : ""}" style="width:0%"></div>
    </div>
    <div class="budget-pct">${pct}% used</div>
  `;

  // Insert before the summary grid
  const grid = document.getElementById("category-summary");
  if (grid) {
    summaryCard.insertBefore(banner, grid);
  } else {
    summaryCard.appendChild(banner);
  }

  // Animate fill
  requestAnimationFrame(() => {
    const fill = banner.querySelector(".budget-bar-fill");
    if (fill) fill.style.width = pct + "%";
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVENT LISTENERS  (wired after DOM is ready)
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  // Enter on amount field → add expense
  const amountInput = document.getElementById("expense-amount");
  if (amountInput) {
    amountInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addExpense();
    });
  }

  // Enter on name field → jump to amount
  const nameInput = document.getElementById("expense-name");
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("expense-amount").focus();
    });
  }

  // Live search/filter
  const filterSearch   = document.getElementById("filter-search");
  const filterCategory = document.getElementById("filter-category");
  if (filterSearch)   filterSearch.addEventListener("input",  () => render());
  if (filterCategory) filterCategory.addEventListener("change", () => render());

  // Export CSV button — calls Backend.downloadCSV() directly
  const exportBtn = document.getElementById("btn-export");
  if (exportBtn) exportBtn.addEventListener("click", () => Backend.downloadCSV());

  // Monthly budget save button
  const saveBudgetBtn = document.getElementById("btn-save-budget");
  if (saveBudgetBtn) saveBudgetBtn.addEventListener("click", saveMonthlyBudget);

  // Allow Enter to save budget
  const budgetInput = document.getElementById("monthly-budget");
  if (budgetInput) {
    budgetInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveMonthlyBudget();
    });
    // Pre-fill with existing saved budget
    const existing = Backend.getMonthlyBudget();
    if (existing > 0) budgetInput.value = existing.toFixed(2);
  }

  // Undo toast button
  const undoBtn = document.getElementById("btn-undo");
  if (undoBtn) undoBtn.addEventListener("click", undoDelete);

  // Sort header clicks — also set initial arrow state
  _updateSortHeaders();

  // Initial render
  render();
});
