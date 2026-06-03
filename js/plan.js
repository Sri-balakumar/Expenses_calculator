// Month-scoped plans. A "plan" is a planned spend row under a month:
//   users/{uid}/months/{monthId}/plans/{planId}
// The page shows the month's Current balance + Total remaining (= current balance
// − spent, computed from the month's expenses), a table of plan rows with an inline
// add row, a Done flow that records a real expense in this month, and a Transfer
// flow that moves PENDING plans to another month (done plans never transfer).

const PLAN_CATEGORIES = {
  food:          { label: "Food",       emoji: "🍔" },
  rent:          { label: "Rent",       emoji: "🏠" },
  transport:     { label: "Transport",  emoji: "🚗" },
  shopping:      { label: "Shopping",   emoji: "🛍️" },
  bills:         { label: "Bills",      emoji: "📄" },
  health:        { label: "Health",     emoji: "💊" },
  entertainment: { label: "Fun",        emoji: "🎬" },
  other:         { label: "Other",      emoji: "📌" }
};
const PLAN_DEFAULT_CATEGORY = "other";

let planUserId = null;
let monthId = null;
let monthName = "";
let monthCurrentBalance = 0;
let monthSpent = 0;
let planPlanned = 0;   // sum of all plan rows' planned amounts
let planSpent = 0;     // sum of done rows' actual amounts
let planPending = 0;   // sum of pending rows' planned amounts
let plansRef = null;
let expensesRef = null;
let currentPlans = []; // latest plan docs [{ id, ...data }]

function planMonthIdFromUrl() {
  return new URLSearchParams(window.location.search).get("month");
}

function escapeHtmlPlan(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

async function loadPlan() {
  monthId = planMonthIdFromUrl();
  if (!monthId) return window.location.replace("dashboard.html");

  const user = await waitForAuth();
  if (!user) return window.location.replace("index.html");
  if (typeof isAdmin === "function" && isAdmin(user)) return window.location.replace("admin.html");
  planUserId = user.uid;

  const monthDoc = await db.collection("users").doc(planUserId)
    .collection("months").doc(monthId).get();
  if (!monthDoc.exists) {
    showToast("Month not found.", "error");
    setTimeout(function () { window.location.replace("dashboard.html"); }, 800);
    return;
  }

  const data = monthDoc.data();
  monthName = data.name || "Plan";
  monthCurrentBalance = Number(data.currentBalance) || 0;
  document.getElementById("plan-month-name").textContent = monthName;

  document.getElementById("loading-card").classList.add("hidden");
  document.getElementById("plan-figures").classList.remove("hidden");
  document.getElementById("plan-table-card").classList.remove("hidden");

  // Populate the add-row category select once.
  const catSel = document.getElementById("add-cat");
  catSel.innerHTML = Object.keys(PLAN_CATEGORIES).map(function (k) {
    const c = PLAN_CATEGORIES[k];
    return '<option value="' + k + '"' + (k === PLAN_DEFAULT_CATEGORY ? " selected" : "") +
      '>' + c.emoji + " " + c.label + '</option>';
  }).join("");

  document.getElementById("add-plan-btn").addEventListener("click", addPlan);
  document.getElementById("add-name").addEventListener("keydown", function (e) {
    if (e.key === "Enter") addPlan();
  });
  document.getElementById("add-amount").addEventListener("keydown", function (e) {
    if (e.key === "Enter") addPlan();
  });
  document.getElementById("transfer-all-btn").addEventListener("click", function () {
    transferPlans(null); // null = all pending
  });

  expensesRef = db.collection("users").doc(planUserId).collection("months").doc(monthId).collection("expenses");
  plansRef = db.collection("users").doc(planUserId).collection("months").doc(monthId).collection("plans");

  // Live figures from the month's expenses.
  expensesRef.onSnapshot(function (snap) {
    let spent = 0;
    snap.forEach(function (d) {
      const e = d.data();
      const amt = Number(e.amount) || 0;
      spent += e.type === "plus" ? -amt : amt;
    });
    monthSpent = spent;
    renderFigures();
  });

  // Live plan rows.
  plansRef.orderBy("createdAt", "asc").onSnapshot(function (snap) {
    currentPlans = snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    renderRows();
  });
}

function renderFigures() {
  document.getElementById("pf-balance").textContent = formatMoney(monthCurrentBalance);

  const remaining = monthCurrentBalance - monthSpent;
  const remEl = document.getElementById("pf-remaining");
  remEl.textContent = formatMoney(remaining);
  remEl.style.color = remaining < 0 ? "var(--danger)" : "var(--success)";

  // "After plans" = what's left once every still-pending plan is paid.
  // Done plans are already reflected in `remaining` (they created expenses),
  // so only the pending planned amounts are subtracted here.
  const afterPlans = remaining - planPending;
  const apEl = document.getElementById("pf-afterplans");
  if (apEl) {
    apEl.textContent = formatMoney(afterPlans);
    apEl.style.color = afterPlans < 0 ? "var(--danger)" : "var(--success)";
  }

  const plannedEl = document.getElementById("pf-planned");
  if (plannedEl) plannedEl.textContent = formatMoney(planPlanned);
  const spentEl = document.getElementById("pf-spent");
  if (spentEl) spentEl.textContent = formatMoney(planSpent);
  const pendEl = document.getElementById("pf-pending");
  if (pendEl) pendEl.textContent = formatMoney(planPending);
}

function renderRows() {
  const tbody = document.getElementById("plan-rows");
  tbody.innerHTML = "";

  let totalPlanned = 0;
  let totalSpent = 0;
  let totalPending = 0;

  currentPlans.forEach(function (p) {
    const isDone = p.status === "done";
    const isPartial = p.status === "partial";
    const cat = PLAN_CATEGORIES[p.category] || PLAN_CATEGORIES.other;
    const planned = Number(p.planned) || 0;
    const actual = Number(p.actual) || 0;
    const paid = Number(p.paid) || 0;
    const remaining = Math.max(0, planned - paid);
    totalPlanned += planned;
    if (isDone) totalSpent += actual;
    else if (isPartial) { totalSpent += paid; totalPending += remaining; }
    else totalPending += planned;

    const transferTag = p.transferredFrom
      ? ' <span class="plan-from-tag">↪ ' + escapeHtmlPlan(p.transferredFrom) + '</span>'
      : '';

    // Amount cell: pending shows planned; partial shows planned → paid · left;
    // done shows planned → paid + the extra/saved.
    let amountCell;
    if (isDone) {
      const diff = actual - planned; // + = paid more than planned
      let badge = "";
      if (diff > 0) badge = ' <span class="plan-diff over">+' + formatMoney(diff) + '</span>';
      else if (diff < 0) badge = ' <span class="plan-diff under">−' + formatMoney(Math.abs(diff)) + '</span>';
      amountCell = '<span class="plan-amt-planned">' + formatMoney(planned) + '</span>' +
        ' <span class="plan-amt-arrow">→</span> <strong>' + formatMoney(actual) + '</strong>' + badge;
    } else if (isPartial) {
      amountCell = '<span class="plan-amt-planned">' + formatMoney(planned) + '</span>' +
        ' <span class="plan-amt-arrow">→</span> <strong>' + formatMoney(paid) + ' paid</strong>' +
        ' <span class="plan-diff under">' + formatMoney(remaining) + ' left</span>';
    } else {
      amountCell = formatMoney(planned);
    }

    const statusCell = isDone
      ? '<span class="plan-done-chip">✓ Done</span>'
      : isPartial
        ? '<span class="plan-partial-chip">◐ Partial</span>'
        : '<span class="plan-pending-chip">Pending</span>';

    let actions;
    if (isDone) {
      actions =
        '<button class="plan-mini-btn" data-undo="' + p.id + '">Undo</button>' +
        '<button class="plan-mini-btn danger" data-del="' + p.id + '">Delete</button>';
    } else if (isPartial) {
      actions =
        '<button class="plan-mini-btn primary" data-part="' + p.id + '">Part done</button>' +
        '<button class="plan-mini-btn" data-done="' + p.id + '">Done</button>' +
        '<button class="plan-mini-btn danger" data-del="' + p.id + '">Delete</button>';
    } else {
      actions =
        '<button class="plan-mini-btn primary" data-done="' + p.id + '">Done</button>' +
        '<button class="plan-mini-btn" data-part="' + p.id + '">Part done</button>' +
        '<button class="plan-mini-btn" data-transfer="' + p.id + '">Transfer</button>' +
        '<button class="plan-mini-btn danger" data-del="' + p.id + '">Delete</button>';
    }

    const tr = document.createElement("tr");
    if (isDone) tr.className = "plan-row-done";
    tr.innerHTML =
      '<td>' + escapeHtmlPlan(p.name) + transferTag + '</td>' +
      '<td>' + amountCell + '</td>' +
      '<td>' + cat.emoji + ' ' + cat.label + '</td>' +
      '<td>' + statusCell + '</td>' +
      '<td><div class="plan-row-actions">' + actions + '</div></td>';
    tbody.appendChild(tr);
  });

  // Stash the plan totals and refresh the figures (incl. "After plans"). This runs
  // on every plans snapshot — so after a transfer adds/removes rows here, the
  // pending total and "After plans" recalculate automatically.
  planPlanned = totalPlanned;
  planSpent = totalSpent;
  planPending = totalPending;
  renderFigures();

  tbody.querySelectorAll("[data-done]").forEach(function (b) {
    b.addEventListener("click", function () { markPlanRowDone(b.dataset.done); });
  });
  tbody.querySelectorAll("[data-part]").forEach(function (b) {
    b.addEventListener("click", function () { partPayPlan(b.dataset.part); });
  });
  tbody.querySelectorAll("[data-undo]").forEach(function (b) {
    b.addEventListener("click", function () { undoPlanRow(b.dataset.undo); });
  });
  tbody.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () { deletePlanRow(b.dataset.del); });
  });
  tbody.querySelectorAll("[data-transfer]").forEach(function (b) {
    b.addEventListener("click", function () { transferPlans([b.dataset.transfer]); });
  });
}

function planById(id) {
  for (let i = 0; i < currentPlans.length; i++) {
    if (currentPlans[i].id === id) return currentPlans[i];
  }
  return null;
}

// ---- Add a plan row ----
async function addPlan() {
  const nameInput = document.getElementById("add-name");
  const amtInput = document.getElementById("add-amount");
  const catSel = document.getElementById("add-cat");

  const name = nameInput.value.trim();
  const planned = Number(amtInput.value);
  if (!name) return showToast("Enter a plan name.", "error");
  if (!planned || planned <= 0) return showToast("Enter a valid amount.", "error");

  // Warn if planning this would push the after-plans balance below zero.
  const remaining = monthCurrentBalance - monthSpent;
  const afterPlans = remaining - (planPending + planned);
  if (afterPlans < 0) {
    const ok = await showConfirm({
      title: "Plans exceed balance",
      message: "Adding this makes your pending plans " + formatMoney(-afterPlans) +
        " more than your balance (" + formatMoney(remaining) + "). Add it anyway?",
      confirmText: "Add anyway",
      danger: true
    });
    if (!ok) return;
  }

  await plansRef.add({
    name: name,
    planned: planned,
    category: catSel.value || PLAN_DEFAULT_CATEGORY,
    status: "pending",
    actual: null,
    paid: 0,
    payments: [],
    pushedExpenseId: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  nameInput.value = "";
  amtInput.value = "";
  catSel.value = PLAN_DEFAULT_CATEGORY;
  nameInput.focus();
}

// ---- Finish a partially-paid plan → just close it (no new expense) ----
async function finalizePartialDone(p) {
  const planned = Number(p.planned) || 0;
  const paid = Number(p.paid) || 0;
  const ok = await showConfirm({
    title: 'Finish "' + p.name + '"?',
    message: 'Spent ' + formatMoney(paid) + ' of ' + formatMoney(planned) +
      ' planned. The remaining ' + formatMoney(Math.max(0, planned - paid)) + " won't be recorded.",
    confirmText: "Finish",
    danger: false
  });
  if (!ok) return;
  await plansRef.doc(p.id).update({ status: "done", actual: paid });
  showToast(p.name + " closed — " + formatMoney(paid) + " spent", "success", 3000);
}

// ---- Mark a plan done → record a real expense in THIS month ----
function markPlanRowDone(id) {
  const p = planById(id);
  if (!p) return;
  // Already paid in parts → just close it (the partials are the recorded spend).
  if ((Number(p.paid) || 0) > 0) return finalizePartialDone(p);
  const planned = Number(p.planned) || 0;

  let catOptions = "";
  Object.keys(PLAN_CATEGORIES).forEach(function (k) {
    const c = PLAN_CATEGORIES[k];
    const selected = k === (p.category || PLAN_DEFAULT_CATEGORY) ? " selected" : "";
    catOptions += '<option value="' + k + '"' + selected + '>' + c.emoji + " " + c.label + '</option>';
  });

  const PAYS = { gpay: "📱 GPay", phonepe: "💜 PhonePe", paytm: "🅿️ Paytm", cash: "💵 Cash", card: "💳 Card", other: "❓ Other" };
  let payOptions = "";
  Object.keys(PAYS).forEach(function (k) {
    payOptions += '<option value="' + k + '"' + (k === "cash" ? " selected" : "") + '>' + PAYS[k] + '</option>';
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Mark "' + escapeHtmlPlan(p.name) + '" done</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="done-actual">Actual amount spent (₹)</label>' +
          '<input type="number" id="done-actual" min="0">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="done-cat">Category</label>' +
          '<select id="done-cat" class="plan-select">' + catOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="done-pay">Payment method</label>' +
          '<select id="done-pay" class="plan-select">' + payOptions + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Mark done</button>' +
      '</div>' +
    '</div>';

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  const actualInput = backdrop.querySelector("#done-actual");
  actualInput.value = planned;

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const actual = Number(actualInput.value);
    if (actualInput.value === "" || isNaN(actual) || actual < 0) {
      return showToast("Enter a valid amount.", "error");
    }
    const category = backdrop.querySelector("#done-cat").value;
    const paymentMethod = backdrop.querySelector("#done-pay").value;
    cleanup();

    // Warn if paying this goes past what's left in the month.
    const remaining = monthCurrentBalance - monthSpent;
    if (actual > remaining) {
      const ok = await showConfirm({
        title: "Over your balance",
        message: "Paying " + formatMoney(actual) + " is " + formatMoney(actual - remaining) +
          " more than what's left (" + formatMoney(remaining) + "). Record it anyway?",
        confirmText: "Record anyway",
        danger: true
      });
      if (!ok) return;
    }

    // 1) Real expense in this month (same shape as month.js expenses).
    const expRef = await expensesRef.add({
      name: p.name,
      amount: actual,
      type: "minus",
      category: category,
      paymentMethod: paymentMethod,
      notes: "From plan: " + monthName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2) Mark the plan done.
    await plansRef.doc(id).update({
      status: "done",
      actual: actual,
      category: category,
      pushedExpenseId: expRef.id
    });

    const diff = planned - actual;
    let msg = p.name + " done — " + formatMoney(actual) + " recorded";
    if (diff > 0) msg += " (saved " + formatMoney(diff) + ")";
    else if (diff < 0) msg += " (over by " + formatMoney(Math.abs(diff)) + ")";
    showToast(msg, "success", 3000);
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { actualInput.focus(); actualInput.select(); }, 50);
}

// ---- Record a partial payment → real expense + accumulate, keep plan open ----
function partPayPlan(id) {
  const p = planById(id);
  if (!p) return;
  const planned = Number(p.planned) || 0;
  const paid = Number(p.paid) || 0;
  const remaining = Math.max(0, planned - paid);

  let catOptions = "";
  Object.keys(PLAN_CATEGORIES).forEach(function (k) {
    const c = PLAN_CATEGORIES[k];
    const selected = k === (p.category || PLAN_DEFAULT_CATEGORY) ? " selected" : "";
    catOptions += '<option value="' + k + '"' + selected + '>' + c.emoji + " " + c.label + '</option>';
  });

  const PAYS = { gpay: "📱 GPay", phonepe: "💜 PhonePe", paytm: "🅿️ Paytm", cash: "💵 Cash", card: "💳 Card", other: "❓ Other" };
  let payOptions = "";
  Object.keys(PAYS).forEach(function (k) {
    payOptions += '<option value="' + k + '"' + (k === "cash" ? " selected" : "") + '>' + PAYS[k] + '</option>';
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Record payment for "' + escapeHtmlPlan(p.name) + '"</h3>' +
      '<p style="margin:-6px 0 14px;font-size:0.85rem;color:var(--text-muted);">' +
        formatMoney(paid) + ' paid of ' + formatMoney(planned) + ' · ' + formatMoney(remaining) + ' left</p>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="part-amount">Payment amount (₹)</label>' +
          '<input type="number" id="part-amount" min="0">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="part-cat">Category</label>' +
          '<select id="part-cat" class="plan-select">' + catOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="part-pay">Payment method</label>' +
          '<select id="part-pay" class="plan-select">' + payOptions + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Record payment</button>' +
      '</div>' +
    '</div>';

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  const amtInput = backdrop.querySelector("#part-amount");
  amtInput.value = remaining || "";

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const amount = Number(amtInput.value);
    if (amtInput.value === "" || isNaN(amount) || amount <= 0) {
      return showToast("Enter a valid amount.", "error");
    }
    const category = backdrop.querySelector("#part-cat").value;
    const paymentMethod = backdrop.querySelector("#part-pay").value;
    cleanup();

    // Warn if paying this goes past what's left in the month.
    const monthRemaining = monthCurrentBalance - monthSpent;
    if (amount > monthRemaining) {
      const ok = await showConfirm({
        title: "Over your balance",
        message: "Paying " + formatMoney(amount) + " is " + formatMoney(amount - monthRemaining) +
          " more than what's left (" + formatMoney(monthRemaining) + "). Record it anyway?",
        confirmText: "Record anyway",
        danger: true
      });
      if (!ok) return;
    }

    // 1) Real expense in this month.
    const expRef = await expensesRef.add({
      name: p.name,
      amount: amount,
      type: "minus",
      category: category,
      paymentMethod: paymentMethod,
      notes: "Part payment: " + monthName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2) Accumulate onto the plan, keep it open as "partial".
    const payments = Array.isArray(p.payments) ? p.payments.slice() : [];
    payments.push({ amount: amount, expenseId: expRef.id, category: category, paymentMethod: paymentMethod, paidAt: new Date() });
    await plansRef.doc(id).update({
      paid: paid + amount,
      payments: payments,
      status: "partial"
    });

    const left = Math.max(0, planned - (paid + amount));
    showToast(formatMoney(amount) + " paid · " + formatMoney(left) + " left on " + p.name, "success", 3000);
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { amtInput.focus(); amtInput.select(); }, 50);
}

// ---- Undo a done plan → remove its expense, back to pending ----
async function undoPlanRow(id) {
  const p = planById(id);
  if (!p) return;
  // Closed from part-payments → reopen to partial, keep the payments/expenses.
  if (Array.isArray(p.payments) && p.payments.length) {
    await plansRef.doc(id).update({ status: "partial", actual: null });
    showToast("Reopened — part payments kept.", "success", 3000);
    return;
  }
  if (p.pushedExpenseId) {
    await expensesRef.doc(p.pushedExpenseId).delete().catch(function () {});
  }
  await plansRef.doc(id).update({
    status: "pending",
    actual: null,
    pushedExpenseId: null
  });
  showToast("Plan reopened — expense removed from " + monthName + ".", "success", 3000);
}

// ---- Delete a plan (and its expense if it was done) ----
async function deletePlanRow(id) {
  const p = planById(id);
  if (!p) return;
  const payments = Array.isArray(p.payments) ? p.payments : [];
  // Linked payments point at pre-existing expenses (added via "Add to plan") —
  // those belong to the month, so deleting the plan must NOT remove them.
  const toRemove = payments.filter(function (pay) { return pay.expenseId && !pay.linked; });
  const expenseCount = toRemove.length + (p.pushedExpenseId ? 1 : 0);
  const ok = await showConfirm({
    title: 'Delete "' + p.name + '"?',
    message: expenseCount > 0
      ? "This also removes the " +
        (expenseCount > 1 ? expenseCount + " expenses" : "expense") +
        " it recorded in " + monthName + "."
      : "This removes the plan.",
    confirmText: "Delete",
    danger: true
  });
  if (!ok) return;

  for (let i = 0; i < toRemove.length; i++) {
    await expensesRef.doc(toRemove[i].expenseId).delete().catch(function () {});
  }
  if (p.pushedExpenseId) {
    await expensesRef.doc(p.pushedExpenseId).delete().catch(function () {});
  }
  await plansRef.doc(id).delete();
  showToast("Plan deleted.", "success");
}

// ---- Transfer pending plans to another month ----
// ids: array of plan ids to move, or null for "all pending".
async function transferPlans(ids) {
  // Resolve which plans to move (pending only — done never transfers).
  const isMovable = function (p) { return p && p.status !== "done" && p.status !== "partial"; };
  let toMove;
  if (ids) {
    toMove = ids.map(planById).filter(isMovable);
  } else {
    toMove = currentPlans.filter(isMovable);
  }
  if (!toMove.length) {
    showToast("No pending plans to transfer.", "error");
    return;
  }

  // Other months for the destination dropdown.
  const monthsSnap = await db.collection("users").doc(planUserId)
    .collection("months").orderBy("createdAt", "desc").get();
  const others = monthsSnap.docs.filter(function (d) { return d.id !== monthId; });
  if (!others.length) {
    showToast("Create another month first to transfer into.", "error", 3500);
    return;
  }

  let monthOptions = "";
  others.forEach(function (m) {
    monthOptions += '<option value="' + m.id + '">' + escapeHtmlPlan(m.data().name) + '</option>';
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Transfer ' + toMove.length + ' pending plan' + (toMove.length > 1 ? "s" : "") + '</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="transfer-month">Move to month</label>' +
          '<select id="transfer-month" class="plan-select">' + monthOptions + '</select>' +
          '<p style="margin:6px 0 0;font-size:0.8rem;color:var(--text-muted);">Done plans stay here. Only pending plans move.</p>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Transfer</button>' +
      '</div>' +
    '</div>';

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const sel = backdrop.querySelector("#transfer-month");
    const targetId = sel.value;
    const targetName = sel.options[sel.selectedIndex].textContent;
    if (!targetId) return showToast("Pick a month.", "error");
    cleanup();

    const targetPlans = db.collection("users").doc(planUserId)
      .collection("months").doc(targetId).collection("plans");

    // Batched move: create in target, delete from source. No money moves
    // (pending plans carry none), so no balance recalculation is needed.
    const batch = db.batch();
    toMove.forEach(function (p) {
      const newRef = targetPlans.doc();
      batch.set(newRef, {
        name: p.name,
        planned: Number(p.planned) || 0,
        category: p.category || PLAN_DEFAULT_CATEGORY,
        status: "pending",
        actual: null,
        paid: 0,
        payments: [],
        pushedExpenseId: null,
        transferredFrom: monthName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.delete(plansRef.doc(p.id));
    });
    await batch.commit();

    showToast(toMove.length + " plan" + (toMove.length > 1 ? "s" : "") + " moved to " + targetName + ".", "success", 3000);
  });

  document.body.appendChild(backdrop);
}
