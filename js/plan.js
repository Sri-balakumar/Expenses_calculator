// Plan page: a forecast ledger. Start balance, then items that subtract from it.
// Each item can be marked "Done" — you enter the real amount, pick a month + category,
// and it pushes a real expense into that month while showing the planned-vs-actual diff.

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
let planId = null;
let planName = "";
let planStartBalance = 0;
let planRef = null;
let itemsRef = null;

function planParams() {
  const params = new URLSearchParams(window.location.search);
  return { id: params.get("id") };
}

function escapeHtmlPlan(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : s;
  return d.innerHTML;
}

async function loadPlan() {
  const user = await waitForAuth();
  if (!user) return (window.location.href = "index.html");
  if (typeof isAdmin === "function" && isAdmin(user)) return (window.location.href = "admin.html");
  planUserId = user.uid;

  planId = planParams().id;
  if (!planId) return (window.location.href = "dashboard.html");

  planRef = db.collection("users").doc(planUserId).collection("plans").doc(planId);
  itemsRef = planRef.collection("items");

  const planDoc = await planRef.get();
  if (!planDoc.exists) {
    showToast("Plan not found.", "error");
    return (window.location.href = "dashboard.html");
  }

  const data = planDoc.data();
  planName = data.name || "Plan";
  planStartBalance = Number(data.startBalance) || 0;

  document.getElementById("plan-name").textContent = planName;
  document.getElementById("loading-card").classList.add("hidden");
  document.getElementById("plan-summary-card").classList.remove("hidden");
  document.getElementById("plan-body").classList.remove("hidden");

  document.getElementById("add-item-btn").addEventListener("click", openAddItem);
  document.getElementById("edit-start-btn").addEventListener("click", editStartBalance);

  // Live ledger
  itemsRef.orderBy("createdAt", "asc").onSnapshot(function (snap) {
    renderItems(snap);
  });
}

function renderItems(snap) {
  const listEl = document.getElementById("plan-items");
  const emptyEl = document.getElementById("plan-items-empty");
  listEl.innerHTML = "";

  if (snap.empty) {
    emptyEl.classList.remove("hidden");
    updateSummary(planStartBalance, 0);
    return;
  }
  emptyEl.classList.add("hidden");

  let running = planStartBalance;
  let totalDiff = 0;

  snap.forEach(function (docSnap) {
    const item = docSnap.data();
    const id = docSnap.id;
    const planned = Number(item.planned) || 0;
    const isDone = item.status === "done";
    const actual = Number(item.actual) || 0;
    const effective = isDone ? actual : planned;

    running -= effective;

    let diffBadge = "";
    if (isDone) {
      const diff = actual - planned;
      totalDiff += diff;
      if (diff > 0) {
        diffBadge = '<span class="diff-badge diff-over">+' + formatMoney(diff) + '</span>';
      } else if (diff < 0) {
        diffBadge = '<span class="diff-badge diff-saved">−' + formatMoney(Math.abs(diff)) + '</span>';
      } else {
        diffBadge = '<span class="diff-badge diff-exact">on plan</span>';
      }
    }

    const row = document.createElement("div");
    row.className = "plan-row" + (isDone ? " is-done" : "");

    const monthTag = (isDone && item.pushedTo && item.pushedTo.monthName)
      ? '<span class="plan-month-tag">→ ' + escapeHtmlPlan(item.pushedTo.monthName) + '</span>'
      : "";

    const costLine = isDone
      ? '<span class="plan-actual">Spent ' + formatMoney(actual) + '</span> ' +
        '<span class="plan-planned-muted">(planned ' + formatMoney(planned) + ')</span> ' + diffBadge
      : '<span class="plan-planned">Planned ' + formatMoney(planned) + '</span>';

    const actionBtn = isDone
      ? '<span class="plan-done-chip">✓ Done</span>'
      : '<button class="plan-done-btn" data-done="' + id + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          'Done' +
        '</button>';

    row.innerHTML =
      '<div class="plan-row-top">' +
        '<div class="plan-row-name">' + escapeHtmlPlan(item.name) + ' ' + monthTag + '</div>' +
        '<div class="plan-running">' + formatMoney(running) + '</div>' +
      '</div>' +
      '<div class="plan-row-bottom">' +
        '<div class="plan-row-cost">' + costLine + '</div>' +
        '<div class="plan-row-actions">' +
          actionBtn +
          '<button class="btn-icon-only" data-edit="' + id + '" title="Edit">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button class="btn-icon-only" data-del="' + id + '" title="Delete">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    listEl.appendChild(row);
  });

  // Wire row actions
  listEl.querySelectorAll("[data-done]").forEach(function (btn) {
    btn.addEventListener("click", function () { markItemDone(btn.dataset.done); });
  });
  listEl.querySelectorAll("[data-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () { editItem(btn.dataset.edit); });
  });
  listEl.querySelectorAll("[data-del]").forEach(function (btn) {
    btn.addEventListener("click", function () { deleteItem(btn.dataset.del); });
  });

  updateSummary(running, totalDiff);
}

function updateSummary(remaining, totalDiff) {
  document.getElementById("sum-start").textContent = formatMoney(planStartBalance);

  const remEl = document.getElementById("sum-remaining");
  remEl.textContent = formatMoney(remaining);
  remEl.style.color = remaining < 0 ? "var(--danger)" : "var(--success)";

  const diffEl = document.getElementById("sum-diff");
  if (totalDiff > 0) {
    diffEl.textContent = "+" + formatMoney(totalDiff);
    diffEl.style.color = "var(--danger)";
  } else if (totalDiff < 0) {
    diffEl.textContent = "−" + formatMoney(Math.abs(totalDiff));
    diffEl.style.color = "var(--success)";
  } else {
    diffEl.textContent = "₹0";
    diffEl.style.color = "var(--text-muted)";
  }
}

// ============================================================
// Add / edit / delete items
// ============================================================

function openAddItem() {
  itemModal({ title: "Add item", name: "", planned: "" }, async function (name, planned) {
    await itemsRef.add({
      name: name,
      planned: planned,
      status: "pending",
      actual: null,
      pushedTo: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast("Item added: " + name, "success");
  });
}

async function editItem(id) {
  const doc = await itemsRef.doc(id).get();
  if (!doc.exists) return;
  const item = doc.data();
  itemModal({ title: "Edit item", name: item.name, planned: item.planned }, async function (name, planned) {
    await itemsRef.doc(id).update({ name: name, planned: planned });
    showToast("Item updated", "success");
  });
}

function itemModal(opts, onSave) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>' + escapeHtmlPlan(opts.title) + '</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="item-name-input">Name</label>' +
          '<input type="text" id="item-name-input" placeholder="e.g. Recharge">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="item-planned-input">Planned cost (₹)</label>' +
          '<input type="number" id="item-planned-input" placeholder="e.g. 900" min="0">' +
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

  backdrop.querySelector("#item-name-input").value = opts.name || "";
  backdrop.querySelector("#item-planned-input").value = (opts.planned === 0 || opts.planned) ? opts.planned : "";

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const name = backdrop.querySelector("#item-name-input").value.trim();
    const planned = Number(backdrop.querySelector("#item-planned-input").value);
    if (!name) return showToast("Enter a name.", "error");
    if (!planned || planned <= 0) return showToast("Enter a valid planned cost.", "error");
    cleanup();
    await onSave(name, planned);
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { backdrop.querySelector("#item-name-input").focus(); }, 50);
}

async function deleteItem(id) {
  const doc = await itemsRef.doc(id).get();
  const item = doc.exists ? doc.data() : {};
  const wasDone = item.status === "done";
  const ok = await showConfirm({
    title: "Delete item?",
    message: wasDone
      ? "This removes it from the plan. The expense already recorded in the month will stay."
      : "This planned item will be removed.",
    confirmText: "Delete"
  });
  if (!ok) return;
  await itemsRef.doc(id).delete();
  showToast("Item removed", "success");
}

// ============================================================
// Done flow — enter actual amount, pick month + category, push to month
// ============================================================

async function markItemDone(id) {
  const doc = await itemsRef.doc(id).get();
  if (!doc.exists) return;
  const item = doc.data();
  const planned = Number(item.planned) || 0;

  // Load the user's months for the dropdown
  const monthsSnap = await db.collection("users").doc(planUserId)
    .collection("months").orderBy("createdAt", "desc").get();

  if (monthsSnap.empty) {
    showToast("Create a month first (Monthly tab) to record this spend.", "error", 3500);
    return;
  }

  let monthOptions = "";
  monthsSnap.forEach(function (m) {
    monthOptions += '<option value="' + m.id + '">' + escapeHtmlPlan(m.data().name) + '</option>';
  });

  let catOptions = "";
  Object.keys(PLAN_CATEGORIES).forEach(function (key) {
    const c = PLAN_CATEGORIES[key];
    catOptions += '<option value="' + key + '"' + (key === PLAN_DEFAULT_CATEGORY ? " selected" : "") +
      '>' + c.emoji + " " + c.label + '</option>';
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Mark "' + escapeHtmlPlan(item.name) + '" done</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="actual-input">Actual amount spent (₹)</label>' +
          '<input type="number" id="actual-input" min="0">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="month-select">Add to month</label>' +
          '<select id="month-select" class="plan-select">' + monthOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="cat-select">Category</label>' +
          '<select id="cat-select" class="plan-select">' + catOptions + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Confirm</button>' +
      '</div>' +
    '</div>';

  function cleanup() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  backdrop.querySelector("#actual-input").value = planned;

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const actual = Number(backdrop.querySelector("#actual-input").value);
    const monthSel = backdrop.querySelector("#month-select");
    const monthId = monthSel.value;
    const monthName = monthSel.options[monthSel.selectedIndex].textContent;
    const category = backdrop.querySelector("#cat-select").value;

    if (!actual || actual <= 0) return showToast("Enter a valid amount.", "error");
    if (!monthId) return showToast("Pick a month.", "error");

    cleanup();

    // 1) Record the real expense in the chosen month (same shape as month.js addExpense)
    await db.collection("users").doc(planUserId)
      .collection("months").doc(monthId).collection("expenses").add({
        name: item.name,
        amount: actual,
        type: "minus",
        category: category,
        paymentMethod: "cash",
        notes: "From plan: " + planName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    // 2) Mark the plan item done with the actual + where it went
    await itemsRef.doc(id).update({
      status: "done",
      actual: actual,
      pushedTo: { monthId: monthId, monthName: monthName, category: category }
    });

    const diff = actual - planned;
    let msg = item.name + " done — added to " + monthName;
    if (diff > 0) msg += " (+" + formatMoney(diff) + " over)";
    else if (diff < 0) msg += " (saved " + formatMoney(Math.abs(diff)) + ")";
    showToast(msg, "success", 3000);
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { backdrop.querySelector("#actual-input").focus(); }, 50);
}

// ============================================================
// Edit starting balance
// ============================================================

function editStartBalance() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Edit starting balance</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="start-input">Starting balance (₹)</label>' +
          '<input type="number" id="start-input" min="0">' +
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

  backdrop.querySelector("#start-input").value = planStartBalance;

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const value = Number(backdrop.querySelector("#start-input").value);
    if (!value || value <= 0) return showToast("Enter a valid balance.", "error");
    planStartBalance = value;
    await planRef.update({ startBalance: value });
    cleanup();
    showToast("Starting balance updated", "success");
    // Re-render with the latest items
    const snap = await itemsRef.orderBy("createdAt", "asc").get();
    renderItems(snap);
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { backdrop.querySelector("#start-input").focus(); }, 50);
}
