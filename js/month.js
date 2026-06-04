// Month page: categories, edit, weekly breakdown, pie chart, +/- buttons, exports.

const CATEGORIES = {
  food:          { label: "Food",       emoji: "🍔", color: "#f59e0b" },
  rent:          { label: "Rent",       emoji: "🏠", color: "#8b5cf6" },
  transport:     { label: "Transport",  emoji: "🚗", color: "#3b82f6" },
  shopping:      { label: "Shopping",   emoji: "🛍️", color: "#ec4899" },
  bills:         { label: "Bills",      emoji: "📄", color: "#06b6d4" },
  health:        { label: "Health",     emoji: "💊", color: "#10b981" },
  entertainment: { label: "Fun",        emoji: "🎬", color: "#f97316" },
  salary:        { label: "Salary",     emoji: "💰", color: "#22c55e" },
  other:         { label: "Other",      emoji: "📌", color: "#6b7280" }
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const DEFAULT_CATEGORY = "other";

const PAYMENT_METHODS = {
  gpay:    { label: "GPay",     emoji: "📱" },
  phonepe: { label: "PhonePe",  emoji: "💜" },
  paytm:   { label: "Paytm",    emoji: "🅿️" },
  cash:    { label: "Cash",     emoji: "💵" },
  card:    { label: "Card",     emoji: "💳" },
  other:   { label: "Other",    emoji: "❓" }
};
const PAYMENT_KEYS = Object.keys(PAYMENT_METHODS);
const DEFAULT_PAYMENT = "cash";

let searchTerm = "";
let typeFilter = "all";
let selectedPayment = DEFAULT_PAYMENT;

let userId = null;
let userName = "";
let userSalary = 0;       // for type=month, this is the user's salary; for type=budget, this is the budget amount
let monthCurrentBalance = 0; // cash on hand entered at month creation (months only)
let monthSpent = 0;       // latest computed spend, so the total can be recomputed after edits
let monthId = null;
let monthName = "";
let trackerType = "month"; // "month" or "budget"
let expensesRef = null;
let currentExpenses = []; // newest first
let knownExpenseIds = new Set();

// Long-press multi-select state
let selectMode = false;
let selectedIds = new Set();

// Saved calculations (per-month Firestore subcollection)
let savedCalcsRef = null;
let currentSavedCalcs = [];

// Plans subcollection (months only) — used by "Add to plan" from select mode
let monthPlansRef = null;

// State for forms
let selectedCategory = DEFAULT_CATEGORY;
let editing = null; // { id, type, category }

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="3 6 5 6 21 6"/>' +
  '<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>' +
  '<path d="M10 11v6"/><path d="M14 11v6"/>' +
  '<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

const EDIT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
  '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

const PLUS_MINI =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const MINUS_MINI =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function getParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return { id: params.get("id"), type: params.get("type") || "month" };
}

async function loadMonth() {
  const params = getParamsFromUrl();
  monthId = params.id;
  trackerType = params.type;
  if (!monthId) return (window.location.href = "dashboard.html");

  const user = await waitForAuth();
  if (!user) return (window.location.href = "index.html");
  userId = user.uid;

  const userDoc = await db.collection("users").doc(userId).get();
  userName = (userDoc.data() && userDoc.data().name) || "";

  const collectionName = trackerType === "budget" ? "budgets" : "months";
  const itemDoc = await db.collection("users").doc(userId)
    .collection(collectionName).doc(monthId).get();

  if (!itemDoc.exists) {
    showToast((trackerType === "budget" ? "Budget" : "Month") + " not found.", "error");
    setTimeout(function () { window.location.href = "dashboard.html"; }, 800);
    return;
  }

  const data = itemDoc.data();
  monthName = data.name;
  // For monthly: limit = user salary. For budgets: limit = budget amount.
  userSalary = trackerType === "budget"
    ? Number(data.amount) || 0
    : Number(userDoc.data().salary) || 0;
  // Cash on hand entered when the month was created (months only). Added on top
  // of salary for the month's total remaining.
  monthCurrentBalance = trackerType === "budget" ? 0 : Number(data.currentBalance) || 0;

  document.getElementById("month-name").textContent = monthName;

  // Hide weekly breakdown for budgets (only relevant for months)
  if (trackerType === "budget") {
    document.getElementById("weekly-card").classList.add("hidden");
    document.getElementById("weekly-card").style.display = "none";
  }

  // Build the category picker (for the add-expense form)
  buildCategoryPicker("category-picker", function (key) { selectedCategory = key; });
  setActiveChip("category-picker", DEFAULT_CATEGORY);

  // Build the category picker (for the edit modal)
  buildCategoryPicker("edit-category-picker", function (key) {
    if (editing) editing.category = key;
  });

  // Build payment method pickers
  buildPaymentPicker("payment-picker", function (key) { selectedPayment = key; });
  setActiveChip("payment-picker", DEFAULT_PAYMENT);
  buildPaymentPicker("edit-payment-picker", function (key) {
    if (editing) editing.paymentMethod = key;
  });

  // Tap the Current balance cell to edit it (months only).
  const balanceCell = document.getElementById("tb-balance-cell");
  if (balanceCell && trackerType !== "budget") {
    balanceCell.addEventListener("click", editCurrentBalance);
  }

  // Default the Add Expense date to today.
  const dateInput = document.getElementById("expense-date");
  if (dateInput) dateInput.value = todayStr();

  expensesRef = itemDoc.ref.collection("expenses");
  expensesRef.orderBy("createdAt", "desc").onSnapshot(function (snap) {
    renderExpenses(snap);
  });

  savedCalcsRef = itemDoc.ref.collection("savedCalculations");
  savedCalcsRef.orderBy("createdAt", "desc").onSnapshot(function (snap) {
    currentSavedCalcs = snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    renderSavedCalcs();
  });

  monthPlansRef = itemDoc.ref.collection("plans");
  if (trackerType === "budget") {
    const pb = document.getElementById("select-plan");
    if (pb) pb.style.display = "none"; // budgets have no plans
  }
}

// Edit the month's current balance (cash on hand). Updates the doc + total live.
function editCurrentBalance() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Current balance</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="cb-input">Cash on hand (₹)</label>' +
          '<input type="number" id="cb-input" min="0" placeholder="e.g. 5000">' +
          '<p style="margin:6px 0 0;font-size:0.8rem;color:var(--text-muted);">Added on top of your salary for this month\'s total remaining.</p>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Save</button>' +
      '</div>' +
    '</div>';

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  const input = backdrop.querySelector("#cb-input");
  input.value = monthCurrentBalance || 0;

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const val = Number(input.value);
    if (input.value === "" || isNaN(val) || val < 0) return showToast("Enter a valid amount.", "error");
    cleanup();
    monthCurrentBalance = val;
    await db.collection("users").doc(userId)
      .collection("months").doc(monthId)
      .update({ currentBalance: val });
    updateTotal(monthSpent); // refresh the header with the new balance
    showToast("Current balance updated.", "success");
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { input.focus(); input.select(); }, 50);
}

// ============================================================
// Category picker
// ============================================================

function buildCategoryPicker(elementId, onPick) {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  CATEGORY_KEYS.forEach(function (key) {
    const cat = CATEGORIES[key];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.dataset.key = key;
    chip.innerHTML = '<span class="chip-emoji">' + cat.emoji + '</span><span>' + cat.label + '</span>';
    chip.addEventListener("click", function () {
      setActiveChip(elementId, key);
      onPick(key);
    });
    el.appendChild(chip);
  });
}

function setActiveChip(elementId, key) {
  const el = document.getElementById(elementId);
  el.querySelectorAll(".category-chip").forEach(function (c) {
    c.classList.toggle("active", c.dataset.key === key);
  });
}

function buildPaymentPicker(elementId, onPick) {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  PAYMENT_KEYS.forEach(function (key) {
    const pm = PAYMENT_METHODS[key];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.dataset.key = key;
    chip.innerHTML = '<span class="chip-emoji">' + pm.emoji + '</span><span>' + pm.label + '</span>';
    chip.addEventListener("click", function () {
      setActiveChip(elementId, key);
      onPick(key);
    });
    el.appendChild(chip);
  });
}

// ============================================================
// Render expense list, weekly summary, pie chart
// ============================================================

function renderExpenses(snap) {
  const listEl = document.getElementById("expenses-list");
  const emptyEl = document.getElementById("empty-expenses");
  listEl.innerHTML = "";
  currentExpenses = [];

  let spent = 0;
  const seenIds = new Set();
  const sorted = []; // chronological for week grouping (oldest first)

  snap.forEach(function (expDoc) {
    const exp = expDoc.data();
    const amt = Number(exp.amount) || 0;
    const category = exp.category || DEFAULT_CATEGORY;
    spent += exp.type === "plus" ? -amt : amt;

    const obj = {
      id: expDoc.id,
      name: exp.name,
      amount: amt,
      type: exp.type,
      category: category,
      paymentMethod: exp.paymentMethod || null,
      notes: exp.notes || "",
      createdAt: exp.createdAt && exp.createdAt.toDate ? exp.createdAt.toDate() : null
    };
    currentExpenses.push(obj);
    sorted.push(obj);
    seenIds.add(expDoc.id);
  });

  // sorted is already newest-first; flip for week order
  sorted.reverse();

  if (currentExpenses.length === 0) {
    emptyEl.classList.remove("hidden");
    document.getElementById("weekly-card").classList.add("hidden");
    setDownloadEnabled(false);
  } else {
    emptyEl.classList.add("hidden");
    renderWeeklyBreakdown(currentExpenses);
    renderCategoryBudgets(currentExpenses);
    applyFilters();
    setDownloadEnabled(true);
  }

  knownExpenseIds = seenIds;
  updateTotal(spent);
}

function applyFilters() {
  const listEl = document.getElementById("expenses-list");
  const emptyEl = document.getElementById("empty-expenses");
  if (!listEl) return;
  listEl.innerHTML = "";

  const filtered = currentExpenses.filter(function (e) {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (searchTerm) {
      const haystack = (e.name + " " + (e.notes || "")).toLowerCase();
      if (haystack.indexOf(searchTerm) === -1) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    if (currentExpenses.length === 0) {
      emptyEl.classList.remove("hidden");
      emptyEl.querySelector("p").innerHTML = "No expenses yet. Add one above.";
    } else {
      emptyEl.classList.remove("hidden");
      emptyEl.querySelector("p").innerHTML = "No matches. Try a different search or filter.";
    }
    return;
  }
  emptyEl.classList.add("hidden");

  if (trackerType === "budget" || typeFilter !== "all" || searchTerm) {
    // Skip week grouping for budgets or when filtered
    filtered.forEach(function (exp) { listEl.appendChild(buildRow(exp)); });
  } else {
    renderRowsByWeek(listEl, filtered);
  }

  listEl.classList.toggle("select-mode", selectMode);
}

function renderRowsByWeek(listEl, expenses) {
  // Group by week-of-month using createdAt
  const groups = {}; // weekNumber -> [expenses]
  const order = [];
  expenses.forEach(function (e) {
    const wk = weekOfMonth(e.createdAt);
    if (!groups[wk]) {
      groups[wk] = [];
      order.push(wk);
    }
    groups[wk].push(e);
  });

  order.forEach(function (wk) {
    const divider = document.createElement("div");
    divider.className = "week-divider";
    divider.textContent = "Week " + wk;
    listEl.appendChild(divider);
    groups[wk].forEach(function (exp) {
      listEl.appendChild(buildRow(exp));
    });
  });
}

function buildRow(exp) {
  const row = document.createElement("div");
  row.className = "expense-row";
  row.dataset.id = exp.id;
  if (!knownExpenseIds.has(exp.id) && knownExpenseIds.size > 0) {
    row.classList.add("slide-down");
  }
  if (selectMode && selectedIds.has(exp.id)) row.classList.add("selected");

  const cat = CATEGORIES[exp.category] || CATEGORIES.other;
  const iconClass = exp.type === "plus" ? "plus" : "minus";
  const iconSvg = exp.type === "plus" ? PLUS_MINI : MINUS_MINI;
  const sign = exp.type === "plus" ? "+" : "−";

  const badgeStyle =
    "background:" + hexToRgba(cat.color, 0.15) + ";color:" + cat.color + ";";

  const pmBadge = (exp.type === "minus" && exp.paymentMethod && PAYMENT_METHODS[exp.paymentMethod])
    ? '<span class="category-badge" style="background:var(--chip-bg);color:var(--text-muted);">' +
        PAYMENT_METHODS[exp.paymentMethod].emoji + ' ' + PAYMENT_METHODS[exp.paymentMethod].label +
      '</span>'
    : '';

  const notesHint = exp.notes
    ? '<div class="muted" style="font-size:0.78rem;margin-top:2px;">📝 ' + escapeHtml(exp.notes.slice(0, 60)) + (exp.notes.length > 60 ? '…' : '') + '</div>'
    : '';

  row.innerHTML =
    '<div class="expense-info">' +
      '<div class="expense-name">' +
        '<span class="expense-name-icon ' + iconClass + '">' + iconSvg + '</span>' +
        escapeHtml(exp.name) +
        '<span class="category-badge" style="' + badgeStyle + '">' + cat.emoji + ' ' + cat.label + '</span>' +
        pmBadge +
      '</div>' +
      '<div class="expense-amount ' + iconClass + '">' +
        sign + ' ' + formatMoney(exp.amount) +
      '</div>' +
      notesHint +
    '</div>';

  // Multi-select checkbox (hidden via CSS unless the list is in select mode).
  const check = document.createElement("div");
  check.className = "row-check";
  check.textContent = (selectMode && selectedIds.has(exp.id)) ? "✅" : "";
  row.insertBefore(check, row.firstChild);

  // Tap to open details; long-press (~500ms) enters multi-select mode.
  let lpTimer = null, lpFired = false, lpX = 0, lpY = 0;
  function clearLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }

  row.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".row-actions")) return;
    lpFired = false; lpX = e.clientX; lpY = e.clientY;
    lpTimer = setTimeout(function () {
      lpFired = true;
      if (!selectMode) enterSelectMode(exp.id);
      else toggleSelect(exp.id);
    }, 500);
  });
  row.addEventListener("pointermove", function (e) {
    if (lpTimer && (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10)) clearLp();
  });
  row.addEventListener("pointerup", clearLp);
  row.addEventListener("pointercancel", clearLp);
  row.addEventListener("pointerleave", clearLp);

  row.addEventListener("click", function (e) {
    // Ignore clicks on action buttons
    if (e.target.closest(".row-actions")) return;
    if (lpFired) { lpFired = false; return; }   // long-press already handled it
    if (selectMode) { toggleSelect(exp.id); return; }
    openDetailsModal(exp);
  });

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn-icon-only edit-btn";
  editBtn.title = "Edit";
  editBtn.innerHTML = EDIT_SVG;
  editBtn.addEventListener("click", function (e) { e.stopPropagation(); openEditModal(exp); });
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn-icon-only";
  delBtn.title = "Delete";
  delBtn.innerHTML = TRASH_SVG;
  delBtn.addEventListener("click", async function (e) {
    e.stopPropagation();
    const ok = await showConfirm({
      title: "Delete this expense?",
      message: '"' + exp.name + '" — ' + formatMoney(exp.amount),
      confirmText: "Delete"
    });
    if (ok) {
      await expensesRef.doc(exp.id).delete();
      showToast("Expense deleted", "success");
    }
  });
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

// Details modal
function openDetailsModal(exp) {
  window.__detailsCurrent = exp;
  const cat = CATEGORIES[exp.category] || CATEGORIES.other;
  const pm = exp.paymentMethod ? PAYMENT_METHODS[exp.paymentMethod] : null;
  const dateStr = exp.createdAt
    ? exp.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  const rows = [
    ["Type", exp.type === "plus" ? "+ Income" : "− Spend"],
    ["Amount", formatMoney(exp.amount)],
    ["Category", cat.emoji + " " + cat.label],
  ];
  if (exp.type === "minus" && pm) rows.push(["Payment method", pm.emoji + " " + pm.label]);
  if (trackerType !== "budget" && exp.createdAt) rows.push(["Week", "Week " + weekOfMonth(exp.createdAt)]);
  rows.push(["Date", dateStr]);
  if (exp.notes) rows.push(["Notes", exp.notes]);

  document.getElementById("details-title").textContent = exp.name;
  const content = document.getElementById("details-content");
  content.innerHTML = rows.map(function (r) {
    return '<div class="details-row">' +
      '<div class="details-label">' + escapeHtml(r[0]) + '</div>' +
      '<div class="details-value">' + escapeHtml(r[1]) + '</div>' +
    '</div>';
  }).join("");

  document.getElementById("details-modal").classList.remove("hidden");
}

function closeDetailsModal() {
  document.getElementById("details-modal").classList.add("hidden");
  window.__detailsCurrent = null;
}

// --- Long-press calculator -------------------------------------------
var calc = { acc: 0, op: null, operand: "", waiting: true };

function openCalcModal(exp) {
  calc.acc = exp.amount;
  calc.op = exp.type === "plus" ? "+" : "-";
  calc.operand = "";
  calc.waiting = true;                 // next digit starts a fresh operand
  document.getElementById("calc-title").textContent = exp.name + " — Calculator";
  renderCalc();
  document.getElementById("calc-modal").classList.remove("hidden");
}

function closeCalcModal() {
  document.getElementById("calc-modal").classList.add("hidden");
}

// --- Long-press multi-select ----------------------------------------
function enterSelectMode(id) {
  selectMode = true;
  selectedIds = new Set([id]);
  document.getElementById("expenses-list").classList.add("select-mode");
  updateRowSelection(id);            // in-place, no re-render (keeps long-press click guard intact)
  updateSelectBar();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds = new Set();
  const listEl = document.getElementById("expenses-list");
  listEl.classList.remove("select-mode");
  listEl.querySelectorAll(".expense-row.selected").forEach(function (r) {
    r.classList.remove("selected");
    const c = r.querySelector(".row-check");
    if (c) c.textContent = "";
  });
  updateSelectBar();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  if (selectedIds.size === 0) { exitSelectMode(); return; }
  updateRowSelection(id);
  updateSelectBar();
}

function updateRowSelection(id) {
  const row = document.querySelector('#expenses-list .expense-row[data-id="' + id + '"]');
  if (!row) return;
  const on = selectedIds.has(id);
  row.classList.toggle("selected", on);
  const check = row.querySelector(".row-check");
  if (check) check.textContent = on ? "✅" : "";
}

function selectionTotal() {           // signed: spends subtract, income adds
  let total = 0;
  selectedIds.forEach(function (id) {
    const e = currentExpenses.find(function (x) { return x.id === id; });
    if (e) total += e.type === "plus" ? e.amount : -e.amount;
  });
  return total;
}

function updateSelectBar() {
  const bar = document.getElementById("select-bar");
  if (!bar) return;
  if (selectMode && selectedIds.size > 0) {
    bar.classList.remove("hidden");
    document.getElementById("select-count").textContent =
      selectedIds.size + " selected · " + formatMoney(selectionTotal());
  } else {
    bar.classList.add("hidden");
  }
}

function openCalcFromSelection() {
  const items = [];
  selectedIds.forEach(function (id) {
    const e = currentExpenses.find(function (x) { return x.id === id; });
    if (e) items.push(e);
  });
  if (items.length === 0) return;
  // Signed total: spends subtract, income adds.
  calc.acc = items.reduce(function (s, e) {
    return s + (e.type === "plus" ? e.amount : -e.amount);
  }, 0);
  calc.op = null; calc.operand = ""; calc.waiting = true;
  document.getElementById("calc-title").textContent = items.length + " items — Total";
  renderCalc();
  // Show the breakdown (e.g. "− ₹1,000  − ₹60  + ₹3"); clears once the user starts typing.
  document.getElementById("calc-expr").textContent =
    items.map(function (e) {
      return (e.type === "plus" ? "+ " : "− ") + formatMoney(e.amount);
    }).join("  ");
  document.getElementById("calc-modal").classList.remove("hidden");
}

// --- Add selected expenses to an existing plan ----------------------
function addSelectionToPlan() {
  if (selectedIds.size === 0) return;
  // Only spends count toward a plan payment.
  const spends = [];
  let skippedIncome = 0;
  selectedIds.forEach(function (id) {
    const e = currentExpenses.find(function (x) { return x.id === id; });
    if (!e) return;
    if (e.type === "minus") {
      spends.push({ id: e.id, name: e.name, amount: e.amount, category: e.category, paymentMethod: e.paymentMethod });
    } else {
      skippedIncome++;
    }
  });
  if (spends.length === 0) {
    return showToast(
      skippedIncome > 0
        ? "Only spends can be added to a plan — your selection is all income."
        : "Select one or more spends to add to a plan.",
      "error", 3500);
  }
  openAddToPlanModal(spends, skippedIncome, exitSelectMode);
}

// Shared "Add to plan" flow. `spends` = [{ amount, name, [id], [category], [paymentMethod] }].
async function openAddToPlanModal(spends, skippedIncome, onSuccess) {
  if (!monthPlansRef || !spends || !spends.length) return;
  const total = spends.reduce(function (s, e) { return s + e.amount; }, 0);

  // This month's open plans only.
  let plans;
  try {
    const snap = await monthPlansRef.orderBy("createdAt", "asc").get();
    plans = snap.docs
      .map(function (d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function (p) { return p.status !== "done"; });
  } catch (e) {
    return showToast("Couldn't load plans.", "error");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const card = document.createElement("div");
  card.className = "modal-card";
  backdrop.appendChild(card);

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  // Append this selection's spends as plan payments onto `existing`.
  function buildPayments(existing) {
    const payments = Array.isArray(existing) ? existing.slice() : [];
    spends.forEach(function (s) {
      const entry = {
        amount: s.amount,
        category: s.category || "other",
        paymentMethod: s.paymentMethod || "other",
        paidAt: new Date(),
        linked: true
      };
      if (s.id) entry.expenseId = s.id;
      payments.push(entry);
    });
    return payments;
  }

  function renderPick() {
    const rows = plans.map(function (p) {
      const planned = Number(p.planned) || 0;
      const paid = Number(p.paid) || 0;
      const remaining = Math.max(0, planned - paid);
      const newPaid = paid + total;
      const newRemaining = Math.max(0, planned - newPaid);
      return '<button class="plan-pick-row" data-plan="' + p.id + '">' +
          '<span class="plan-pick-name">' + escapeHtml(p.name) + ' · ' + formatMoney(planned) + ' planned</span>' +
          '<span class="plan-pick-amt">Now: ' + formatMoney(paid) + ' paid · ' + formatMoney(remaining) + ' left</span>' +
          '<span class="plan-pick-after">After +' + formatMoney(total) + ': ' +
            formatMoney(newPaid) + ' paid · ' + formatMoney(newRemaining) + ' left</span>' +
        '</button>';
    }).join("");
    const emptyNote = plans.length ? '' :
      '<p class="muted" style="font-size:0.85rem;margin:0 0 14px;">No open plans yet — create one below.</p>';
    card.innerHTML =
      '<h3>Add to a plan</h3>' +
      '<p class="muted" style="margin:-6px 0 14px;font-size:0.88rem;">Adding <strong>' +
        formatMoney(total) + '</strong> from ' + spends.length + ' spend' + (spends.length > 1 ? "s" : "") + '</p>' +
      emptyNote +
      '<div class="plan-pick-list">' + rows + '</div>' +
      '<button class="plan-pick-new" data-act="new">＋ Create new plan</button>' +
      '<div class="modal-actions"><button class="btn-secondary" data-act="cancel">Cancel</button></div>';
    card.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
    card.querySelector('[data-act="new"]').addEventListener("click", renderNewPlan);
    card.querySelectorAll("[data-plan]").forEach(function (b) {
      b.addEventListener("click", function () {
        const plan = plans.find(function (p) { return p.id === b.dataset.plan; });
        if (plan) renderSummary(plan);
      });
    });
  }

  function renderNewPlan() {
    let catOptions = "";
    CATEGORY_KEYS.forEach(function (k) {
      const c = CATEGORIES[k];
      catOptions += '<option value="' + k + '"' + (k === DEFAULT_CATEGORY ? " selected" : "") +
        '>' + c.emoji + " " + c.label + '</option>';
    });
    card.innerHTML =
      '<h3>New plan</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group"><label for="np-name">Name</label>' +
          '<input type="text" id="np-name" placeholder="e.g. Grocery"></div>' +
        '<div class="form-group"><label for="np-amount">Planned amount (₹)</label>' +
          '<input type="number" id="np-amount" min="0" placeholder="e.g. 3000"></div>' +
        '<div class="form-group"><label for="np-cat">Category</label>' +
          '<select id="np-cat" class="plan-select">' + catOptions + '</select></div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="back">Back</button>' +
        '<button class="btn-primary" data-act="create">Create & continue</button>' +
      '</div>';
    const nameInput = card.querySelector("#np-name");
    const amtInput = card.querySelector("#np-amount");
    amtInput.value = total; // sensible default: at least what you're adding
    card.querySelector('[data-act="back"]').addEventListener("click", renderPick);
    card.querySelector('[data-act="create"]').addEventListener("click", async function () {
      const name = nameInput.value.trim();
      const planned = Number(amtInput.value);
      if (!name) return showToast("Enter a plan name.", "error");
      if (!planned || planned <= 0) return showToast("Enter a valid planned amount.", "error");
      const category = card.querySelector("#np-cat").value;
      // Don't write yet — carry the details into the summary; commit on confirm.
      renderSummary({ isNew: true, name: name, planned: planned, category: category, paid: 0, payments: [] });
    });
    setTimeout(function () { nameInput.focus(); }, 50);
  }

  function renderSummary(plan) {
    const planned = Number(plan.planned) || 0;
    const paid = Number(plan.paid) || 0;
    const newPaid = paid + total;
    const remaining = Math.max(0, planned - newPaid);
    const skipNote = skippedIncome > 0
      ? '<p class="muted" style="font-size:0.8rem;margin-top:10px;">' + skippedIncome +
        ' income item' + (skippedIncome > 1 ? "s" : "") + ' skipped (only spends are added).</p>'
      : '';
    card.innerHTML =
      '<h3>' + escapeHtml(plan.name) + '</h3>' +
      '<div class="details-row"><div class="details-label">Planned</div><div class="details-value">' + formatMoney(planned) + '</div></div>' +
      '<div class="details-row"><div class="details-label">Already paid</div><div class="details-value">' + formatMoney(paid) + '</div></div>' +
      '<div class="details-row"><div class="details-label">Adding</div><div class="details-value">' + formatMoney(total) + ' (' + spends.length + ' item' + (spends.length > 1 ? "s" : "") + ')</div></div>' +
      '<div class="details-row"><div class="details-label">New paid</div><div class="details-value"><strong>' + formatMoney(newPaid) + '</strong></div></div>' +
      '<div class="details-row"><div class="details-label">Remaining</div><div class="details-value">' + formatMoney(remaining) + '</div></div>' +
      skipNote +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="back">Back</button>' +
        '<button class="btn-primary" data-act="confirm">Add to plan</button>' +
      '</div>';
    // New plans: go Back to the create form. Existing: back to the picker.
    card.querySelector('[data-act="back"]').addEventListener("click", plan.isNew ? renderNewPlan : renderPick);
    card.querySelector('[data-act="confirm"]').addEventListener("click", async function () {
      cleanup();
      if (plan.isNew) {
        // Create the plan now, with this selection as its first payment.
        await monthPlansRef.add({
          name: plan.name,
          planned: plan.planned,
          category: plan.category || DEFAULT_CATEGORY,
          status: "partial",
          actual: null,
          paid: total,
          payments: buildPayments([]),
          pushedExpenseId: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await monthPlansRef.doc(plan.id).update({
          paid: (Number(plan.paid) || 0) + total,
          payments: buildPayments(plan.payments),
          status: "partial"
        });
      }
      showToast(formatMoney(total) + " added to " + plan.name, "success", 3000);
      if (typeof onSuccess === "function") onSuccess();
    });
  }

  renderPick();
  document.body.appendChild(backdrop);
}

// --- Saved calculations ---------------------------------------------
async function saveSelection() {
  if (!savedCalcsRef || selectedIds.size === 0) return;
  const items = [];
  selectedIds.forEach(function (id) {
    const e = currentExpenses.find(function (x) { return x.id === id; });
    if (e) items.push({ name: e.name, amount: e.amount, type: e.type });
  });
  if (items.length === 0) return;

  const total = items.reduce(function (s, e) {
    return s + (e.type === "plus" ? e.amount : -e.amount);
  }, 0);

  const defaultName = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const name = await showPrompt({
    title: "Name this calculation",
    placeholder: "e.g. June recharges",
    defaultValue: defaultName,
    confirmText: "Save"
  });
  if (name === null) return; // cancelled

  await savedCalcsRef.add({
    name: name,
    total: total,
    items: items,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  showToast("Calculation saved", "success");
  exitSelectMode();
  switchMonthTab("saved");
}

function renderSavedCalcs() {
  const listEl = document.getElementById("saved-calcs-list");
  const emptyEl = document.getElementById("empty-saved");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!currentSavedCalcs.length) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");
  currentSavedCalcs.forEach(function (c) {
    listEl.appendChild(buildSavedCalcCard(c));
  });
}

function buildSavedCalcCard(c) {
  const card = document.createElement("div");
  card.className = "saved-calc";

  const dateStr = c.createdAt && c.createdAt.toDate
    ? c.createdAt.toDate().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "";
  const items = Array.isArray(c.items) ? c.items : [];
  const itemsHtml = items.map(function (it) {
    const cls = it.type === "plus" ? "plus" : "minus";
    const op = it.type === "plus" ? "+" : "−";
    return '<div class="saved-calc-item">' +
        '<span>' + escapeHtml(it.name || "") + '</span>' +
        '<span class="' + cls + '">' + op + ' ' + formatMoney(it.amount) + '</span>' +
      '</div>';
  }).join("");

  card.innerHTML =
    '<div class="saved-calc-head">' +
      '<div class="saved-calc-meta">' +
        '<div class="saved-calc-name">' + escapeHtml(c.name || "Untitled") + '</div>' +
        '<div class="saved-calc-date">' + escapeHtml(dateStr) + ' · ' + items.length + ' items</div>' +
      '</div>' +
      '<div class="saved-calc-total">' + formatMoney(c.total) + '</div>' +
    '</div>' +
    '<div class="saved-calc-items">' + itemsHtml + '</div>';

  const del = document.createElement("button");
  del.className = "btn-icon-only saved-calc-del";
  del.title = "Delete";
  del.innerHTML = TRASH_SVG;
  del.addEventListener("click", async function () {
    const ok = await showConfirm({
      title: "Delete this calculation?",
      message: (c.name || "Untitled") + " — " + formatMoney(c.total),
      confirmText: "Delete"
    });
    if (ok) {
      await savedCalcsRef.doc(c.id).delete();
      showToast("Calculation deleted", "success");
    }
  });
  card.querySelector(".saved-calc-head").appendChild(del);

  // "Add to plan" — apply this calc's spends to a plan (months only).
  const spendItems = items.filter(function (it) { return it.type !== "plus"; });
  if (trackerType !== "budget" && spendItems.length > 0) {
    const footer = document.createElement("div");
    footer.className = "saved-calc-actions";
    const addBtn = document.createElement("button");
    addBtn.className = "plan-mini-btn primary";
    addBtn.textContent = "📋 Add to plan";
    addBtn.addEventListener("click", function () {
      const spends = spendItems.map(function (it) {
        return { name: it.name, amount: it.amount };
      });
      const skippedIncome = items.length - spendItems.length;
      openAddToPlanModal(spends, skippedIncome, null);
    });
    footer.appendChild(addBtn);
    card.appendChild(footer);
  }

  return card;
}

function switchMonthTab(tab) {
  ["expenses", "saved"].forEach(function (t) {
    const panel = document.getElementById("tab-" + t);
    const btn = document.getElementById("tabbtn-" + t);
    if (panel) panel.classList.toggle("hidden", t !== tab);
    if (btn) btn.classList.toggle("active", t === tab);
  });
}

function renderCalc() {
  var opSym = { "+": "+", "-": "−", "*": "×", "/": "÷" };
  var shown = calc.operand !== "" ? calc.operand : formatMoney(calc.acc);
  document.getElementById("calc-result").textContent = shown;
  document.getElementById("calc-expr").textContent =
    calc.op ? formatMoney(calc.acc) + " " + opSym[calc.op] : "";
}

function applyOp() {                   // fold the pending op into the accumulator
  var b = parseFloat(calc.operand);
  if (isNaN(b)) return;
  switch (calc.op) {
    case "+": calc.acc += b; break;
    case "-": calc.acc -= b; break;
    case "*": calc.acc *= b; break;
    case "/": calc.acc = b === 0 ? 0 : calc.acc / b; break;
    default:  calc.acc = b;
  }
}

function calcInput(key) {
  if (/^[0-9]$/.test(key)) {
    calc.operand = (calc.waiting ? "" : calc.operand) + key;
    calc.waiting = false;
  } else if (key === ".") {
    if (calc.waiting) { calc.operand = "0"; calc.waiting = false; }
    if (calc.operand.indexOf(".") === -1) calc.operand += calc.operand === "" ? "0." : ".";
  } else if (key === "back") {
    if (!calc.waiting) calc.operand = calc.operand.slice(0, -1);
  } else if (key === "clear") {
    calc.acc = 0; calc.op = null; calc.operand = ""; calc.waiting = true;
  } else if (key === "+" || key === "-" || key === "*" || key === "/") {
    if (calc.operand !== "") { applyOp(); calc.operand = ""; }
    calc.op = key; calc.waiting = true;
  } else if (key === "=") {
    if (calc.operand !== "") { applyOp(); calc.operand = ""; calc.op = null; calc.waiting = true; }
  }
  renderCalc();
}

function weekOfMonth(date) {
  if (!date) return 1;
  const day = date.getDate();
  return Math.min(5, Math.floor((day - 1) / 7) + 1);
}

function renderWeeklyBreakdown(expenses) {
  const card = document.getElementById("weekly-card");
  if (trackerType === "budget") {
    card.classList.add("hidden");
    return;
  }
  const grid = document.getElementById("weekly-grid");
  grid.innerHTML = "";

  // Sum spend (minus type) per week; ignore income
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  expenses.forEach(function (e) {
    if (e.type === "minus") {
      totals[weekOfMonth(e.createdAt)] += e.amount;
    }
  });

  let any = false;
  for (let w = 1; w <= 5; w++) {
    if (totals[w] === 0 && w === 5) continue; // hide empty week 5
    any = true;
    const tile = document.createElement("div");
    tile.className = "week-tile";
    const range = weekRange(w);
    tile.innerHTML =
      '<div class="week-tile-label">Week ' + w + '</div>' +
      '<div class="week-tile-amount">' + formatMoney(totals[w]) + '</div>' +
      '<div class="week-tile-range">Days ' + range + '</div>';
    grid.appendChild(tile);
  }

  if (any) card.classList.remove("hidden");
  else card.classList.add("hidden");
}

function weekRange(w) {
  const start = (w - 1) * 7 + 1;
  const end = w === 5 ? 31 : start + 6;
  return start + "–" + end;
}

async function renderCategoryBudgets(expenses) {
  const card = document.getElementById("cat-budgets-card");
  const listEl = document.getElementById("cat-budgets-list");
  if (!card || trackerType === "budget") {
    if (card) card.classList.add("hidden");
    return;
  }

  const budgetsSnap = await db.collection("users").doc(userId)
    .collection("categoryBudgets").get();
  if (budgetsSnap.empty) { card.classList.add("hidden"); return; }

  // Aggregate spending by category
  const spentBy = {};
  expenses.forEach(function (e) {
    if (e.type !== "minus") return;
    const c = e.category || DEFAULT_CATEGORY;
    spentBy[c] = (spentBy[c] || 0) + e.amount;
  });

  listEl.innerHTML = "";
  budgetsSnap.forEach(function (budgetDoc) {
    const limit = Number(budgetDoc.data().limit) || 0;
    if (limit <= 0) return;
    const key = budgetDoc.id;
    const spent = spentBy[key] || 0;
    const pct = Math.min(100, Math.max(0, (spent / limit) * 100));
    const fillClass = spent > limit ? "over" : (pct > 80 ? "warn" : "");
    const cat = CATEGORIES[key] || CATEGORIES.other;

    const row = document.createElement("div");
    row.style.padding = "10px 0";
    row.innerHTML =
      '<div style="display:flex;justify-content:space-between;font-size:0.92rem;font-weight:600;margin-bottom:6px;">' +
        '<span>' + cat.emoji + ' ' + cat.label + '</span>' +
        '<span class="muted">' + formatMoney(spent) + ' / ' + formatMoney(limit) + '</span>' +
      '</div>' +
      '<div class="budget-progress-bar">' +
        '<div class="budget-progress-fill ' + fillClass + '" style="width:' + pct.toFixed(1) + '%;"></div>' +
      '</div>';
    listEl.appendChild(row);
  });

  if (listEl.children.length > 0) {
    card.classList.remove("hidden");
  } else {
    card.classList.add("hidden");
  }
}

function updateTotal(spent) {
  monthSpent = spent; // remember so edits to current balance can recompute
  const totalEl = document.getElementById("total-display");
  const amountEl = document.getElementById("total-amount");
  const labelEl = document.getElementById("total-label");
  const breakdownEl = document.getElementById("total-breakdown");

  if (trackerType === "budget") {
    // Budgets: single figure (amount − spent), no breakdown.
    const remaining = userSalary - spent;
    if (breakdownEl) breakdownEl.classList.add("hidden");
    labelEl.textContent = remaining >= 0 ? "Remaining" : "Over budget by";
    animateCount(amountEl, Math.abs(remaining), formatMoney);
    totalEl.classList.remove("under", "over");
    totalEl.classList.add(remaining >= 0 ? "under" : "over");
    return;
  }

  // Months: the current balance already includes salary, so the total is simply
  // current balance − spent. Breakdown shows Current balance and Spent.
  const totalRemaining = monthCurrentBalance - spent;
  labelEl.textContent = totalRemaining >= 0 ? "Total remaining" : "Over budget by";
  animateCount(amountEl, Math.abs(totalRemaining), formatMoney);

  totalEl.classList.remove("under", "over");
  totalEl.classList.add(totalRemaining >= 0 ? "under" : "over");

  if (breakdownEl) {
    breakdownEl.classList.remove("hidden");
    document.getElementById("tb-salary").textContent = formatMoney(userSalary);
    document.getElementById("tb-balance").textContent = formatMoney(monthCurrentBalance);
    document.getElementById("tb-spent").textContent = formatMoney(spent);
  }
}

function setDownloadEnabled(enabled) {
  document.getElementById("btn-download-pdf").disabled = !enabled;
  document.getElementById("btn-download-excel").disabled = !enabled;
}

// ============================================================
// Add expense
// ============================================================

// Local today as a YYYY-MM-DD string (for the date input default).
function todayStr() {
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mo + "-" + day;
}

// Turn the date-input value into a createdAt for Firestore. Empty → server time.
// A chosen day keeps the current time-of-day so same-day entries still order well.
function dateValueToCreatedAt(value) {
  if (!value) return firebase.firestore.FieldValue.serverTimestamp();
  const p = value.split("-");
  const now = new Date();
  const chosen = new Date(
    Number(p[0]), Number(p[1]) - 1, Number(p[2]),
    now.getHours(), now.getMinutes(), now.getSeconds()
  );
  if (isNaN(chosen.getTime())) return firebase.firestore.FieldValue.serverTimestamp();
  return firebase.firestore.Timestamp.fromDate(chosen);
}

async function addExpense(type) {
  const nameInput = document.getElementById("expense-name");
  const amountInput = document.getElementById("expense-amount");
  const notesInput = document.getElementById("expense-notes");
  const dateInput = document.getElementById("expense-date");

  const name = nameInput.value.trim();
  const amount = Number(amountInput.value);
  const notes = notesInput.value.trim();

  if (!name) return showToast("Enter an expense name.", "error");
  if (!amount || amount <= 0) return showToast("Enter a valid amount.", "error");

  // Warn if a spend goes past what's left (months: currentBalance − spent; budgets: amount − spent).
  if (type === "minus") {
    const remaining = (trackerType === "budget" ? userSalary : monthCurrentBalance) - monthSpent;
    if (amount > remaining) {
      const ok = await showConfirm({
        title: "Over your balance",
        message: "This spend of " + formatMoney(amount) + " is " + formatMoney(amount - remaining) +
          " more than what's left (" + formatMoney(remaining) + "). Add it anyway?",
        confirmText: "Add anyway",
        danger: true
      });
      if (!ok) return;
    }
  }

  const payload = {
    name: name,
    amount: amount,
    type: type,
    category: selectedCategory,
    notes: notes,
    createdAt: dateValueToCreatedAt(dateInput ? dateInput.value : "")
  };
  if (type === "minus") payload.paymentMethod = selectedPayment;

  await expensesRef.add(payload);

  showToast(
    (type === "plus" ? "Income" : "Expense") + " added: " + name,
    "success"
  );

  nameInput.value = "";
  amountInput.value = "";
  notesInput.value = "";
  if (dateInput) dateInput.value = todayStr();
  selectedCategory = DEFAULT_CATEGORY;
  setActiveChip("category-picker", DEFAULT_CATEGORY);
  selectedPayment = DEFAULT_PAYMENT;
  setActiveChip("payment-picker", DEFAULT_PAYMENT);
  nameInput.focus();
}

// ============================================================
// Edit modal
// ============================================================

function openEditModal(exp) {
  editing = {
    id: exp.id,
    type: exp.type,
    category: exp.category || DEFAULT_CATEGORY,
    paymentMethod: exp.paymentMethod || DEFAULT_PAYMENT
  };
  document.getElementById("edit-name").value = exp.name;
  document.getElementById("edit-amount").value = exp.amount;
  document.getElementById("edit-notes").value = exp.notes || "";
  document.getElementById("edit-error").className = "status-msg error hidden";
  setEditType(exp.type);
  setActiveChip("edit-category-picker", editing.category);
  setActiveChip("edit-payment-picker", editing.paymentMethod);
  document.getElementById("edit-modal").classList.remove("hidden");
}

function closeEditModal() {
  document.getElementById("edit-modal").classList.add("hidden");
  editing = null;
}

function setEditType(type) {
  if (!editing) editing = { type: type, category: DEFAULT_CATEGORY, paymentMethod: DEFAULT_PAYMENT };
  else editing.type = type;
  const minusBtn = document.getElementById("edit-type-minus");
  const plusBtn = document.getElementById("edit-type-plus");
  minusBtn.classList.toggle("active", type === "minus");
  plusBtn.classList.toggle("active", type === "plus");

  // Hide payment method when type=plus
  const pmGroup = document.getElementById("edit-payment-method-group");
  if (pmGroup) pmGroup.style.display = type === "plus" ? "none" : "";
}

async function saveEdit() {
  if (!editing) return;
  const name = document.getElementById("edit-name").value.trim();
  const amount = Number(document.getElementById("edit-amount").value);
  const errEl = document.getElementById("edit-error");

  if (!name) {
    errEl.textContent = "Please enter a name.";
    errEl.className = "status-msg error";
    return;
  }
  if (!amount || amount <= 0) {
    errEl.textContent = "Please enter a valid amount.";
    errEl.className = "status-msg error";
    return;
  }

  const notes = document.getElementById("edit-notes").value.trim();

  const update = {
    name: name,
    amount: amount,
    type: editing.type,
    category: editing.category,
    notes: notes
  };
  if (editing.type === "minus") update.paymentMethod = editing.paymentMethod || DEFAULT_PAYMENT;
  else update.paymentMethod = firebase.firestore.FieldValue.delete();

  await expensesRef.doc(editing.id).update(update);
  showToast("Expense updated", "success");
  closeEditModal();
}

// ============================================================
// Helpers
// ============================================================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function hexToRgba(hex, alpha) {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

// ============================================================
// PDF + Excel export (now with category column)
// ============================================================

// weekFilter: a Set of week numbers to include, or null/undefined for all.
function buildExportRows(weekFilter) {
  let totalSpent = 0;
  let totalIncome = 0;
  const source = (weekFilter instanceof Set)
    ? currentExpenses.filter(function (e) { return e.createdAt && weekFilter.has(weekOfMonth(e.createdAt)); })
    : currentExpenses;
  const rows = source.map(function (e) {
    if (e.type === "plus") totalIncome += e.amount;
    else totalSpent += e.amount;
    const cat = CATEGORIES[e.category] || CATEGORIES.other;
    const pm = e.paymentMethod && PAYMENT_METHODS[e.paymentMethod] ? PAYMENT_METHODS[e.paymentMethod].label : "";
    return {
      Name: e.name,
      Category: cat.label,
      Type: e.type === "plus" ? "Income (+)" : "Spend (-)",
      Payment: e.type === "minus" ? pm : "",
      Notes: e.notes || "",
      Amount: e.amount,
      Week: e.createdAt ? "Week " + weekOfMonth(e.createdAt) : ""
    };
  });
  // Budgets: amount − net. Months: current balance − net (balance already
  // includes salary, so salary is not added).
  const netSpent = totalSpent - totalIncome;
  const remaining = (trackerType === "budget")
    ? userSalary - netSpent
    : monthCurrentBalance - netSpent;
  return {
    rows: rows,
    totalSpent: totalSpent,
    totalIncome: totalIncome,
    remaining: remaining
  };
}

// Load a script once, on demand. Cached so repeat exports are instant.
const _loadedScripts = {};
function loadScript(src) {
  if (_loadedScripts[src]) return _loadedScripts[src];
  _loadedScripts[src] = new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = function () { delete _loadedScripts[src]; reject(new Error("load failed: " + src)); };
    document.head.appendChild(s);
  });
  return _loadedScripts[src];
}

// jspdf-autotable depends on jspdf, so load jspdf first.
async function ensurePdfLibs() {
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.1/dist/jspdf.plugin.autotable.min.js");
}
function ensureXlsx() {
  return loadScript("https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js");
}

// Weeks that actually have expenses ("attended"), sorted ascending.
function attendedWeeks() {
  const weeks = new Set();
  currentExpenses.forEach(function (e) {
    if (e.createdAt) weeks.add(weekOfMonth(e.createdAt));
  });
  return Array.from(weeks).sort(function (a, b) { return a - b; });
}

// Ask which weeks to include before exporting. Resolves with:
//   null      → include all (no filtering)
//   Set<num>  → include only these weeks
//   false     → user cancelled
function pickWeeks() {
  return new Promise(function (resolve) {
    const weeks = attendedWeeks();
    // Budgets have no week grouping, and a single/zero week needs no choice.
    if (trackerType === "budget" || weeks.length <= 1) { resolve(null); return; }

    const checks = weeks.map(function (w) {
      return '<label class="week-pick-row"><input type="checkbox" class="week-cb" value="' + w + '" checked>' +
        '<span>Week ' + w + '</span></label>';
    }).join("");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h3>Which weeks to include?</h3>' +
        '<div class="week-pick-list">' +
          '<label class="week-pick-row week-pick-all"><input type="checkbox" id="week-all" checked><span><strong>All weeks</strong></span></label>' +
          checks +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
          '<button class="btn-primary" data-act="ok">Download</button>' +
        '</div>' +
      '</div>';

    function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }

    const allCb = backdrop.querySelector("#week-all");
    const weekCbs = Array.prototype.slice.call(backdrop.querySelectorAll(".week-cb"));

    allCb.addEventListener("change", function () {
      weekCbs.forEach(function (cb) { cb.checked = allCb.checked; });
    });
    weekCbs.forEach(function (cb) {
      cb.addEventListener("change", function () {
        allCb.checked = weekCbs.every(function (c) { return c.checked; });
      });
    });

    backdrop.querySelector('[data-act="cancel"]').addEventListener("click", function () { cleanup(); resolve(false); });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) { cleanup(); resolve(false); } });
    backdrop.querySelector('[data-act="ok"]').addEventListener("click", function () {
      const selected = weekCbs.filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); });
      if (selected.length === 0) { showToast("Pick at least one week.", "error"); return; }
      cleanup();
      // All selected → null (include everything, incl. expenses without a week).
      resolve(selected.length === weeks.length ? null : new Set(selected));
    });

    document.body.appendChild(backdrop);
  });
}

async function downloadPDF() {
  if (currentExpenses.length === 0) {
    showToast("Add at least one expense before downloading.", "error");
    return;
  }
  const weekFilter = await pickWeeks();
  if (weekFilter === false) return; // cancelled

  try {
    await ensurePdfLibs();
  } catch (e) {
    showToast("PDF library failed to load. Check your internet and try again.", "error");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast("PDF library failed to load. Check your internet and try again.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const data = buildExportRows(weekFilter);
  const isBudget = trackerType === "budget";
  const limitLabel = isBudget ? "Budget Amount" : "Salary";
  const reportTitle = (isBudget ? "Budget Report" : "Expense Report") + " - " + monthName;

  // ---- Title (Times New Roman, centered) with an accent rule underneath ----
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(35, 35, 60);
  doc.text(reportTitle, pageW / 2, 20, { align: "center" });

  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.8);
  doc.line(14, 25, pageW - 14, 25);

  // ---- Summary block inside a bordered box ----
  // Budgets show Budget Amount. Months show Salary (info) + Current Balance.
  const summary = [["Name", userName || "-"]];
  if (isBudget) {
    summary.push([limitLabel, "Rs. " + userSalary.toLocaleString("en-IN")]);
  } else {
    summary.push(["Salary", "Rs. " + userSalary.toLocaleString("en-IN")]);
    summary.push(["Current Balance", "Rs. " + monthCurrentBalance.toLocaleString("en-IN")]);
  }
  summary.push(["Total Spend", "Rs. " + data.totalSpent.toLocaleString("en-IN")]);
  summary.push(["Total Income", "Rs. " + data.totalIncome.toLocaleString("en-IN")]);
  summary.push([isBudget ? "Remaining" : "Total Remaining", "Rs. " + data.remaining.toLocaleString("en-IN")]);

  const boxX = 14, boxTop = 31, rowH = 7;
  const boxH = summary.length * rowH + 6;
  doc.setDrawColor(210, 212, 225);
  doc.setLineWidth(0.3);
  doc.setFillColor(247, 248, 255);
  doc.roundedRect(boxX, boxTop, pageW - 28, boxH, 2, 2, "FD");

  let y = boxTop + 8;
  doc.setFontSize(11);
  summary.forEach(function (s) {
    doc.setFont("times", "bold");
    doc.setTextColor(55, 48, 120);
    doc.text(s[0] + ":", boxX + 5, y);
    doc.setFont("times", "normal");
    doc.setTextColor(40, 40, 50);
    doc.text(String(s[1]), boxX + 55, y);
    y += rowH;
  });

  // ---- Table with grid borders + zebra striping ----
  const headRow = isBudget
    ? [["#", "Name", "Category", "Type", "Payment", "Notes", "Amount (Rs.)"]]
    : [["#", "Week", "Name", "Category", "Type", "Payment", "Notes", "Amount (Rs.)"]];
  const bodyRows = data.rows.map(function (r, i) {
    return isBudget
      ? [i + 1, r.Name, r.Category, r.Type, r.Payment, r.Notes, r.Amount.toLocaleString("en-IN")]
      : [i + 1, r.Week, r.Name, r.Category, r.Type, r.Payment, r.Notes, r.Amount.toLocaleString("en-IN")];
  });
  const amountCol = isBudget ? 6 : 7;
  const columnStyles = {};
  columnStyles[0] = { halign: "center", cellWidth: 10 };
  columnStyles[amountCol] = { halign: "right", fontStyle: "bold", textColor: [35, 35, 60] };

  doc.autoTable({
    startY: boxTop + boxH + 6,
    head: headRow,
    body: bodyRows,
    theme: "grid",
    styles: { font: "times", fontSize: 10, cellPadding: 2.5, lineColor: [205, 207, 220], lineWidth: 0.2, textColor: [35, 35, 45] },
    headStyles: { font: "times", fontStyle: "bold", fillColor: [99, 102, 241], textColor: [255, 255, 255], halign: "center", lineColor: [99, 102, 241], lineWidth: 0.2 },
    alternateRowStyles: { fillColor: [243, 244, 255] },
    columnStyles: columnStyles,
    margin: { left: 14, right: 14 },
    didDrawPage: function () {
      doc.setFont("times", "italic");
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 160);
      doc.text("Generated by Expense Calculator", 14, pageH - 8);
      doc.text("Page " + doc.internal.getNumberOfPages(), pageW - 14, pageH - 8, { align: "right" });
    }
  });

  doc.save(safeFilename(monthName) + ".pdf");
  showToast("PDF downloaded", "success");
}

async function downloadExcel() {
  if (currentExpenses.length === 0) {
    showToast("Add at least one expense before downloading.", "error");
    return;
  }
  const weekFilter = await pickWeeks();
  if (weekFilter === false) return; // cancelled

  try {
    await ensureXlsx();
  } catch (e) {
    showToast("Excel library failed to load. Check your internet and try again.", "error");
    return;
  }
  if (!window.XLSX) {
    showToast("Excel library failed to load. Check your internet and try again.", "error");
    return;
  }

  const data = buildExportRows(weekFilter);
  const isBudget = trackerType === "budget";
  const limitLabel = isBudget ? "Budget Amount (₹)" : "Salary (₹)";
  const reportTitle = (isBudget ? "Budget Report — " : "Expense Report — ") + monthName;

  // Summary rows (label, value) — order mirrors the PDF.
  // Budgets show Budget Amount. Months show Salary (info) + Current Balance.
  const summary = [["Name", userName || "-"]];
  if (isBudget) {
    summary.push([limitLabel, userSalary]);
  } else {
    summary.push(["Salary (₹)", userSalary]);
    summary.push(["Current Balance (₹)", monthCurrentBalance]);
  }
  summary.push(["Total Spend (₹)", data.totalSpent]);
  summary.push(["Total Income (₹)", data.totalIncome]);
  summary.push([isBudget ? "Remaining (₹)" : "Total Remaining (₹)", data.remaining]);

  const colHeader = isBudget
    ? ["#", "Name", "Category", "Type", "Payment", "Notes", "Amount (₹)"]
    : ["#", "Week", "Name", "Category", "Type", "Payment", "Notes", "Amount (₹)"];
  const ncols = colHeader.length;

  const headerRows = [[reportTitle]].concat(summary).concat([[]]).concat([colHeader]);
  const headerRowIdx = headerRows.length - 1;          // the column-header row
  const bodyRows = data.rows.map(function (r, i) {
    return isBudget
      ? [i + 1, r.Name, r.Category, r.Type, r.Payment, r.Notes, r.Amount]
      : [i + 1, r.Week, r.Name, r.Category, r.Type, r.Payment, r.Notes, r.Amount];
  });
  const all = headerRows.concat(bodyRows);

  const ws = XLSX.utils.aoa_to_sheet(all);
  ws["!cols"] = isBudget
    ? [{ wch: 6 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 14 }]
    : [{ wch: 6 }, { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 14 }];

  // ---- Styling (xlsx-js-style) ----
  const FONT = "Times New Roman";
  const thin = { style: "thin", color: { rgb: "D1D5DB" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  function style(r, c, s) {
    const addr = XLSX.utils.encode_cell({ r: r, c: c });
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = s;
  }

  // Title — merged across all columns, indigo banner.
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } }];
  style(0, 0, {
    font: { name: FONT, sz: 16, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "6366F1" } },
    alignment: { horizontal: "center", vertical: "center" }
  });

  // Summary rows (label bold on tint, value plain). Highlight the last (remaining).
  for (let i = 0; i < summary.length; i++) {
    const r = 1 + i;
    const isLast = i === summary.length - 1;
    style(r, 0, {
      font: { name: FONT, bold: true, color: { rgb: isLast ? "FFFFFF" : "3730A3" } },
      fill: { fgColor: { rgb: isLast ? "10B981" : "EEF2FF" } },
      border: border
    });
    style(r, 1, {
      font: { name: FONT, bold: isLast, color: { rgb: isLast ? "FFFFFF" : "1F2937" } },
      fill: { fgColor: { rgb: isLast ? "10B981" : "FFFFFF" } },
      border: border
    });
  }

  // Column header row — indigo, white, centered, bordered.
  for (let c = 0; c < ncols; c++) {
    style(headerRowIdx, c, {
      font: { name: FONT, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "6366F1" } },
      alignment: { horizontal: "center" },
      border: border
    });
  }

  // Body rows — Times font, zebra striping, amount right-aligned & bold.
  for (let i = 0; i < bodyRows.length; i++) {
    const r = headerRowIdx + 1 + i;
    const zebra = i % 2 === 1;
    for (let c = 0; c < ncols; c++) {
      style(r, c, {
        font: { name: FONT, bold: c === ncols - 1, color: { rgb: "1F2937" } },
        fill: { fgColor: { rgb: zebra ? "F3F4FF" : "FFFFFF" } },
        alignment: { horizontal: c === 0 ? "center" : (c === ncols - 1 ? "right" : "left") },
        border: border
      });
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Expenses");
  XLSX.writeFile(wb, safeFilename(monthName) + ".xlsx");
  showToast("Excel downloaded", "success");
}

function safeFilename(name) {
  return (name || "month").replace(/[^a-z0-9_\- ]/gi, "_").trim() || "month";
}
