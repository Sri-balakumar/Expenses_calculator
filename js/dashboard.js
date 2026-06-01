// Dashboard: monthly tab (salary-based) + budgets tab (arbitrary amount).

let userId = null;
let userSalary = 0;
let trendsChart = null;
let currentTab = (function () {
  try { return localStorage.getItem("dashTab") || "monthly"; } catch (e) { return "monthly"; }
})();

// Local copy of categories so the dashboard YTD pie can color slices.
const CATEGORY_COLORS = {
  food: "#f59e0b", rent: "#8b5cf6", transport: "#3b82f6", shopping: "#ec4899",
  bills: "#06b6d4", health: "#10b981", entertainment: "#f97316", salary: "#22c55e", other: "#6b7280"
};
const CATEGORY_LABELS = {
  food: "Food", rent: "Rent", transport: "Transport", shopping: "Shopping",
  bills: "Bills", health: "Health", entertainment: "Fun", salary: "Salary", other: "Other"
};

function switchDashTab(tab) {
  currentTab = tab;
  try { localStorage.setItem("dashTab", tab); } catch (e) {}
  const views = {
    monthly: document.getElementById("monthly-view"),
    budgets: document.getElementById("budgets-view"),
    plans: document.getElementById("plans-view")
  };
  const tabs = {
    monthly: document.getElementById("tab-monthly"),
    budgets: document.getElementById("tab-budgets"),
    plans: document.getElementById("tab-plans")
  };

  Object.keys(views).forEach(function (key) {
    const isActive = key === tab;
    views[key].classList.toggle("hidden", !isActive);
    tabs[key].classList.toggle("active", isActive);
  });
}

async function loadDashboard() {
  const user = await waitForAuth();
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  if (isAdmin(user)) {
    window.location.href = "admin.html";
    return;
  }
  userId = user.uid;

  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    window.location.href = "index.html";
    return;
  }

  const data = userDoc.data();
  userSalary = Number(data.salary) || 0;

  document.getElementById("greeting").textContent = "Hi, " + data.name;
  document.getElementById("salary").innerHTML = "Monthly salary: <strong>" + formatMoney(userSalary) + "</strong>";

  // Fetch months (+ their expenses) once and share with both the Monthly and
  // Plans tabs; run budgets in parallel.
  const [monthsData] = await Promise.all([fetchMonthsData(), renderBudgets()]);
  renderMonths(monthsData);
  renderPlanMonths(monthsData);

  // Hide loading skeletons, show real content (active tab only)
  const loadingEl = document.getElementById("dash-loading");
  if (loadingEl) loadingEl.classList.add("hidden");
  switchDashTab(currentTab); // re-applies hidden/visible to the right view
}

// Load every month + its expenses (in parallel) and compute the figures both the
// Monthly and Plans tabs need: spent, currentBalance, totalRemaining (= currentBalance
// − spent), salary-based remaining, and per-category totals. Newest first.
async function fetchMonthsData() {
  const monthsSnap = await db.collection("users").doc(userId)
    .collection("months")
    .orderBy("createdAt", "desc")
    .get();

  if (monthsSnap.empty) return [];

  const monthExpenseSnaps = await Promise.all(
    monthsSnap.docs.map(function (d) { return d.ref.collection("expenses").get(); })
  );

  const monthsData = [];
  monthsSnap.docs.forEach(function (monthDoc, idx) {
    const month = monthDoc.data();
    const currentBalance = Number(month.currentBalance) || 0;
    let spent = 0;
    const byCategory = {};
    monthExpenseSnaps[idx].forEach(function (expDoc) {
      const exp = expDoc.data();
      const amt = Number(exp.amount) || 0;
      const isMinus = exp.type !== "plus";
      spent += isMinus ? amt : -amt;
      if (isMinus) {
        const c = exp.category || "other";
        byCategory[c] = (byCategory[c] || 0) + amt;
      }
    });

    monthsData.push({
      id: monthDoc.id,
      name: month.name,
      spent: spent,
      currentBalance: currentBalance,
      totalRemaining: currentBalance - spent,
      remaining: userSalary - spent,
      byCategory: byCategory
    });
  });

  return monthsData;
}

function renderMonths(monthsData) {
  const listEl = document.getElementById("months-list");
  const emptyEl = document.getElementById("months-empty");
  listEl.innerHTML = "";

  if (!monthsData.length) {
    emptyEl.classList.remove("hidden");
    document.getElementById("comparison-card").classList.add("hidden");
    document.getElementById("trends-card").classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  renderComparisonCard(monthsData);
  renderInsights(monthsData);
  renderTrendsChart(monthsData);
  renderMonthCards(listEl, monthsData);
}

function renderInsights(monthsData) {
  const card = document.getElementById("insights-card");
  const list = document.getElementById("insights-list");
  if (monthsData.length === 0) { card.classList.add("hidden"); return; }

  const items = [];
  const current = monthsData[0];

  // Insight 1: top category this month
  const cats = current.byCategory || {};
  const top = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
  if (top && cats[top] > 0) {
    const totalSpend = Object.values(cats).reduce(function (s, v) { return s + v; }, 0);
    const pct = Math.round((cats[top] / totalSpend) * 100);
    items.push({ emoji: "🏆", text: "Top category in <strong>" + escapeHtml(current.name) + "</strong>: <strong>" + escapeHtml(CATEGORY_LABELS[top] || top) + "</strong> (" + pct + "% of spending — " + formatMoney(cats[top]) + ")" });
  }

  // Insight 2: vs last month per top category
  if (monthsData.length >= 2 && top) {
    const prevCats = monthsData[1].byCategory || {};
    const prev = prevCats[top] || 0;
    if (prev > 0) {
      const diff = cats[top] - prev;
      const pct = Math.round(Math.abs(diff) / prev * 100);
      if (diff > 0) {
        items.push({ emoji: "📈", text: "You spent <strong>" + pct + "% more</strong> on " + escapeHtml(CATEGORY_LABELS[top] || top) + " vs last month." });
      } else if (diff < 0) {
        items.push({ emoji: "📉", text: "You spent <strong>" + pct + "% less</strong> on " + escapeHtml(CATEGORY_LABELS[top] || top) + " vs last month — nice!" });
      }
    }
  }

  // Insight 3: budget health
  if (userSalary > 0) {
    const used = current.spent;
    const pct = Math.round((used / userSalary) * 100);
    if (pct >= 100) {
      items.push({ emoji: "🚨", text: "You've used <strong>" + pct + "%</strong> of your salary this month." });
    } else if (pct >= 80) {
      items.push({ emoji: "⚠️", text: "<strong>" + pct + "%</strong> of your salary used. Slow down a bit." });
    } else if (pct >= 0 && pct < 50) {
      items.push({ emoji: "✅", text: "Only <strong>" + pct + "%</strong> of your salary used. Looking good!" });
    }
  }

  if (items.length === 0) { card.classList.add("hidden"); return; }
  list.innerHTML = items.map(function (i) {
    return '<div class="insight-item"><span class="insight-emoji">' + i.emoji + '</span><span class="insight-text">' + i.text + '</span></div>';
  }).join("");
  card.classList.remove("hidden");
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderMonthCards(listEl, monthsData) {
  const calendarIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
    '<line x1="16" y1="2" x2="16" y2="6"/>' +
    '<line x1="8" y1="2" x2="8" y2="6"/>' +
    '<line x1="3" y1="10" x2="21" y2="10"/></svg>';

  monthsData.forEach(function (m, i) {
    const card = document.createElement("a");
    card.className = "month-card";
    card.href = "month.html?id=" + m.id;
    card.style.animationDelay = (i * 50) + "ms";

    card.innerHTML =
      '<div class="month-card-icon">' + calendarIcon + '</div>' +
      '<div class="month-card-body">' +
        '<div class="month-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="month-summary">' +
          'Spent: <span class="spent">' + formatMoney(m.spent) + '</span> · ' +
          'Remaining: <span class="remaining">' + formatMoney(m.remaining) + '</span>' +
        '</div>' +
      '</div>';

    listEl.appendChild(card);
  });
}

function renderComparisonCard(monthsData) {
  const card = document.getElementById("comparison-card");
  if (monthsData.length === 0) {
    card.classList.add("hidden");
    return;
  }

  const current = monthsData[0]; // newest
  animateCount(document.getElementById("this-month-amount"), current.spent, formatMoney);
  document.getElementById("this-month-name").textContent = current.name;

  const pill = document.getElementById("comparison-pill");

  if (monthsData.length < 2) {
    pill.innerHTML = '<span class="muted" style="font-size:0.85rem;">First month tracked!</span>';
    card.classList.remove("hidden");
    return;
  }

  const prev = monthsData[1];
  const diff = current.spent - prev.spent;
  const pct = prev.spent === 0 ? null : Math.round((diff / prev.spent) * 100);

  let arrow, color, label;
  if (diff > 0) {
    arrow = "↑"; color = "var(--danger)"; label = "more than last month";
  } else if (diff < 0) {
    arrow = "↓"; color = "var(--success)"; label = "less than last month";
  } else {
    arrow = "·"; color = "var(--text-muted)"; label = "same as last month";
  }

  const pctText = pct === null ? "—" : Math.abs(pct) + "%";

  pill.innerHTML =
    '<div style="font-size:1.2rem;font-weight:800;color:' + color + ';line-height:1;">' +
      arrow + ' ' + pctText +
    '</div>' +
    '<div class="muted" style="font-size:0.78rem;margin-top:4px;">' + label + '</div>' +
    '<div class="muted" style="font-size:0.72rem;margin-top:2px;">vs ' + escapeHtml(prev.name) + '</div>';

  card.classList.remove("hidden");
}

function renderTrendsChart(monthsData) {
  const card = document.getElementById("trends-card");
  if (!window.Chart || monthsData.length === 0) {
    card.classList.add("hidden");
    return;
  }

  // Take last 6 months (chronological — oldest first for the chart)
  const last6 = monthsData.slice(0, 6).reverse();
  if (last6.length < 2) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const labels = last6.map(function (m) { return m.name; });
  const data = last6.map(function (m) { return Math.max(0, m.spent); });

  const ctx = document.getElementById("trends-chart").getContext("2d");
  if (trendsChart) trendsChart.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, "rgba(99, 102, 241, 0.85)");
  gradient.addColorStop(1, "rgba(139, 92, 246, 0.55)");

  trendsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Spent",
        data: data,
        backgroundColor: gradient,
        borderRadius: 8,
        maxBarThickness: 48
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) { return formatMoney(ctx.parsed.y); }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (v) {
              if (v >= 1000) return "₹" + (v / 1000) + "k";
              return "₹" + v;
            }
          },
          grid: { color: "rgba(0,0,0,0.04)" }
        }
      }
    }
  });
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

async function createNewMonth() {
  // Fetch existing month names so we can mark tiles as "open"
  const snap = await db.collection("users").doc(userId)
    .collection("months").get();
  const existing = {};
  snap.forEach(function (d) {
    existing[d.data().name] = d.id;
  });

  let year = new Date().getFullYear();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  function render() {
    backdrop.innerHTML =
      '<div class="picker-card">' +
        '<div class="picker-header">' +
          '<div class="picker-title">Pick a month</div>' +
          '<div class="year-nav">' +
            '<button class="year-prev" aria-label="Previous year">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
            '</button>' +
            '<span class="year-label">' + year + '</span>' +
            '<button class="year-next" aria-label="Next year">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</button>' +
            '<button class="picker-close" aria-label="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="month-grid">' +
          MONTH_NAMES.map(function (m) {
            const fullName = m + " " + year;
            const isExisting = !!existing[fullName];
            return '<button class="month-tile ' + (isExisting ? "exists" : "") + '" data-month="' + m + '">' +
              '<span>' + m.slice(0, 3) + '</span>' +
              '<span class="month-tile-badge">' +
                (isExisting ? "Open" : "Create") +
              '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
      '</div>';

    backdrop.querySelectorAll(".month-tile").forEach(function (tile) {
      tile.addEventListener("click", function () {
        const monthName = tile.dataset.month;
        const fullName = monthName + " " + year;
        if (existing[fullName]) {
          cleanup();
          window.location.href = "month.html?id=" + existing[fullName];
          return;
        }
        confirmAndCreate(fullName);
      });
    });

    backdrop.querySelector(".year-prev").addEventListener("click", function () { year--; render(); });
    backdrop.querySelector(".year-next").addEventListener("click", function () { year++; render(); });
    backdrop.querySelector(".picker-close").addEventListener("click", cleanup);
  }

  function cleanup() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  function confirmAndCreate(fullName) {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML =
      '<div class="modal-card">' +
        '<h3>Create ' + escapeHtml(fullName) + '?</h3>' +
        '<div class="add-expense-form">' +
          '<div class="form-group">' +
            '<label for="month-balance-input">Current balance (₹)</label>' +
            '<input type="number" id="month-balance-input" placeholder="e.g. 5000" min="0">' +
            '<p style="margin:6px 0 0;font-size:0.8rem;color:var(--text-muted);">Cash you have on hand now. It\'s added on top of your salary for this month\'s total.</p>' +
          '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
          '<button class="btn-primary" data-act="ok">Create</button>' +
        '</div>' +
      '</div>';

    function closeModal() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    modal.querySelector('[data-act="cancel"]').addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

    modal.querySelector('[data-act="ok"]').addEventListener("click", async function () {
      const currentBalance = Number(modal.querySelector("#month-balance-input").value) || 0;
      if (currentBalance < 0) return showToast("Balance can't be negative.", "error");
      closeModal();

      const ref = await db.collection("users").doc(userId)
        .collection("months").add({
          name: fullName,
          currentBalance: currentBalance,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      // Auto-add recurring expenses
      const recurringSnap = await db.collection("users").doc(userId)
        .collection("recurring").get();
      if (!recurringSnap.empty) {
        const batch = db.batch();
        recurringSnap.forEach(function (rec) {
          const r = rec.data();
          const expRef = ref.collection("expenses").doc();
          batch.set(expRef, {
            name: r.name,
            amount: Number(r.amount) || 0,
            type: "minus",
            category: r.category || "other",
            paymentMethod: "other",
            notes: "Recurring",
            recurring: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      }

      cleanup();
      window.location.href = "month.html?id=" + ref.id;
    });

    document.body.appendChild(modal);
    setTimeout(function () { modal.querySelector("#month-balance-input").focus(); }, 50);
  }

  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) cleanup();
  });

  render();
  document.body.appendChild(backdrop);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Budgets (arbitrary-amount tracking — trips, events, projects)
// ============================================================

async function renderBudgets() {
  const listEl = document.getElementById("budgets-list");
  const emptyEl = document.getElementById("budgets-empty");
  listEl.innerHTML = "";

  const budgetsSnap = await db.collection("users").doc(userId)
    .collection("budgets")
    .orderBy("createdAt", "desc")
    .get();

  if (budgetsSnap.empty) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  // Fetch every budget's expenses in parallel (one round trip instead of N).
  const budgetExpenseSnaps = await Promise.all(
    budgetsSnap.docs.map(function (d) { return d.ref.collection("expenses").get(); })
  );

  budgetsSnap.docs.forEach(function (budgetDoc, i) {
    const b = budgetDoc.data();
    const amount = Number(b.amount) || 0;

    let spent = 0;
    budgetExpenseSnaps[i].forEach(function (e) {
      const exp = e.data();
      const amt = Number(exp.amount) || 0;
      spent += exp.type === "plus" ? -amt : amt;
    });

    const remaining = amount - spent;
    const pct = amount > 0 ? Math.min(100, Math.max(0, (spent / amount) * 100)) : 0;
    const fillClass = remaining < 0 ? "over" : (pct > 80 ? "warn" : "");

    const card = document.createElement("a");
    card.className = "budget-card";
    card.href = "month.html?type=budget&id=" + budgetDoc.id;
    card.style.animationDelay = (i * 50) + "ms";

    card.innerHTML =
      '<div class="budget-row-top">' +
        '<div class="budget-name">' + escapeHtml(b.name) + '</div>' +
        '<div class="budget-amount-tag">' + formatMoney(amount) + '</div>' +
      '</div>' +
      '<div class="budget-progress-bar">' +
        '<div class="budget-progress-fill ' + fillClass + '" style="width:' + pct.toFixed(1) + '%;"></div>' +
      '</div>' +
      '<div class="budget-stats">' +
        '<span>Spent <strong>' + formatMoney(spent) + '</strong></span>' +
        '<span>Remaining <strong style="color:' + (remaining < 0 ? "var(--danger)" : "var(--success)") + ';">' + formatMoney(remaining) + '</strong></span>' +
      '</div>';

    listEl.appendChild(card);
  });
}

async function createNewBudget() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>New Budget</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="budget-name-input">Budget name</label>' +
          '<input type="text" id="budget-name-input" placeholder="e.g. Goa Trip">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="budget-amount-input">Total amount (₹)</label>' +
          '<input type="number" id="budget-amount-input" placeholder="e.g. 10000" min="0">' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" data-act="cancel">Cancel</button>' +
        '<button class="btn-primary" data-act="ok">Create</button>' +
      '</div>' +
    '</div>';

  function cleanup() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", cleanup);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(); });

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    const name = backdrop.querySelector("#budget-name-input").value.trim();
    const amount = Number(backdrop.querySelector("#budget-amount-input").value);
    if (!name) return showToast("Enter a budget name.", "error");
    if (!amount || amount <= 0) return showToast("Enter a valid amount.", "error");

    const ok = await showConfirm({
      title: "Create budget?",
      message: name + " — " + formatMoney(amount),
      confirmText: "Create",
      danger: false
    });
    if (!ok) return;

    const ref = await db.collection("users").doc(userId)
      .collection("budgets").add({
        name: name,
        amount: amount,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    cleanup();
    window.location.href = "month.html?type=budget&id=" + ref.id;
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { backdrop.querySelector("#budget-name-input").focus(); }, 50);
}

// ============================================================
// Plans — now month-scoped. The Plans tab lists the existing months with each
// month's current balance + total remaining; tapping one opens its plan table
// (plan.html?month=<id>). Plan rows live under months/{id}/plans.
// ============================================================

function renderPlanMonths(monthsData) {
  const listEl = document.getElementById("plans-list");
  const emptyEl = document.getElementById("plans-empty");
  listEl.innerHTML = "";

  if (!monthsData.length) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  monthsData.forEach(function (m, i) {
    const tr = m.totalRemaining;
    const card = document.createElement("a");
    card.className = "budget-card";
    card.href = "plan.html?month=" + m.id;
    card.style.animationDelay = (i * 50) + "ms";

    card.innerHTML =
      '<div class="budget-row-top">' +
        '<div class="budget-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="budget-amount-tag">Plan →</div>' +
      '</div>' +
      '<div class="budget-stats">' +
        '<span>Current balance <strong>' + formatMoney(m.currentBalance) + '</strong></span>' +
        '<span>Total remaining <strong style="color:' + (tr < 0 ? "var(--danger)" : "var(--success)") + ';">' + formatMoney(tr) + '</strong></span>' +
      '</div>';

    listEl.appendChild(card);
  });
}
