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
  const el = document.getElementById("pf-remaining");
  el.textContent = formatMoney(remaining);
  el.style.color = remaining < 0 ? "var(--danger)" : "var(--success)";
}

function renderRows() {
  const tbody = document.getElementById("plan-rows");
  tbody.innerHTML = "";

  let totalPlanned = 0;
  let totalSpent = 0;

  currentPlans.forEach(function (p) {
    const isDone = p.status === "done";
    const cat = PLAN_CATEGORIES[p.category] || PLAN_CATEGORIES.other;
    const planned = Number(p.planned) || 0;
    const actual = Number(p.actual) || 0;
    totalPlanned += planned;
    if (isDone) totalSpent += actual;

    const transferTag = p.transferredFrom
      ? ' <span class="plan-from-tag">↪ ' + escapeHtmlPlan(p.transferredFrom) + '</span>'
      : '';

    // Amount cell: pending shows planned; done shows planned → paid + the extra/saved.
    let amountCell;
    if (isDone) {
      const diff = actual - planned; // + = paid more than planned
      let badge = "";
      if (diff > 0) badge = ' <span class="plan-diff over">+' + formatMoney(diff) + '</span>';
      else if (diff < 0) badge = ' <span class="plan-diff under">−' + formatMoney(Math.abs(diff)) + '</span>';
      amountCell = '<span class="plan-amt-planned">' + formatMoney(planned) + '</span>' +
        ' <span class="plan-amt-arrow">→</span> <strong>' + formatMoney(actual) + '</strong>' + badge;
    } else {
      amountCell = formatMoney(planned);
    }

    const statusCell = isDone
      ? '<span class="plan-done-chip">✓ Done</span>'
      : '<span class="plan-pending-chip">Pending</span>';

    const actions = isDone
      ? '<button class="plan-mini-btn" data-undo="' + p.id + '">Undo</button>' +
        '<button class="plan-mini-btn danger" data-del="' + p.id + '">Delete</button>'
      : '<button class="plan-mini-btn primary" data-done="' + p.id + '">Done</button>' +
        '<button class="plan-mini-btn" data-transfer="' + p.id + '">Transfer</button>' +
        '<button class="plan-mini-btn danger" data-del="' + p.id + '">Delete</button>';

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

  // Totals under the figures: total planned across all rows, total actually spent (done).
  const plannedEl = document.getElementById("pf-planned");
  if (plannedEl) plannedEl.textContent = formatMoney(totalPlanned);
  const spentEl = document.getElementById("pf-spent");
  if (spentEl) spentEl.textContent = formatMoney(totalSpent);

  tbody.querySelectorAll("[data-done]").forEach(function (b) {
    b.addEventListener("click", function () { markPlanRowDone(b.dataset.done); });
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

  await plansRef.add({
    name: name,
    planned: planned,
    category: catSel.value || PLAN_DEFAULT_CATEGORY,
    status: "pending",
    actual: null,
    pushedExpenseId: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  nameInput.value = "";
  amtInput.value = "";
  catSel.value = PLAN_DEFAULT_CATEGORY;
  nameInput.focus();
}

// ---- Mark a plan done → record a real expense in THIS month ----
function markPlanRowDone(id) {
  const p = planById(id);
  if (!p) return;
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

// ---- Undo a done plan → remove its expense, back to pending ----
async function undoPlanRow(id) {
  const p = planById(id);
  if (!p) return;
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
  const wasDone = p.status === "done";
  const ok = await showConfirm({
    title: 'Delete "' + p.name + '"?',
    message: wasDone
      ? "This also removes the expense it recorded in " + monthName + "."
      : "This removes the plan.",
    confirmText: "Delete",
    danger: true
  });
  if (!ok) return;

  if (wasDone && p.pushedExpenseId) {
    await expensesRef.doc(p.pushedExpenseId).delete().catch(function () {});
  }
  await plansRef.doc(id).delete();
  showToast("Plan deleted.", "success");
}

// ---- Transfer pending plans to another month ----
// ids: array of plan ids to move, or null for "all pending".
async function transferPlans(ids) {
  // Resolve which plans to move (pending only — done never transfers).
  let toMove;
  if (ids) {
    toMove = ids.map(planById).filter(function (p) { return p && p.status !== "done"; });
  } else {
    toMove = currentPlans.filter(function (p) { return p.status !== "done"; });
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
