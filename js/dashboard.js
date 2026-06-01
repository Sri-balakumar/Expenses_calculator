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

  await Promise.all([renderMonths(), renderBudgets(), renderPlans()]);

  // Hide loading skeletons, show real content (active tab only)
  const loadingEl = document.getElementById("dash-loading");
  if (loadingEl) loadingEl.classList.add("hidden");
  switchDashTab(currentTab); // re-applies hidden/visible to the right view
}

async function renderMonths() {
  const listEl = document.getElementById("months-list");
  const emptyEl = document.getElementById("months-empty");
  listEl.innerHTML = "";

  const monthsSnap = await db.collection("users").doc(userId)
    .collection("months")
    .orderBy("createdAt", "desc")
    .get();

  if (monthsSnap.empty) {
    emptyEl.classList.remove("hidden");
    document.getElementById("comparison-card").classList.add("hidden");
    document.getElementById("trends-card").classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  // Fetch every month's expenses in parallel (one round trip instead of N).
  const monthExpenseSnaps = await Promise.all(
    monthsSnap.docs.map(function (d) { return d.ref.collection("expenses").get(); })
  );

  // Compute spend + category totals for each month (order preserved).
  const monthsData = [];
  monthsSnap.docs.forEach(function (monthDoc, idx) {
    const month = monthDoc.data();
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
      remaining: userSalary - spent,
      byCategory: byCategory
    });
  });

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
// Plans — forecast ledgers (start balance → subtract each item)
// ============================================================

async function renderPlans() {
  const listEl = document.getElementById("plans-list");
  const emptyEl = document.getElementById("plans-empty");
  listEl.innerHTML = "";

  const plansSnap = await db.collection("users").doc(userId)
    .collection("plans")
    .orderBy("createdAt", "desc")
    .get();

  if (plansSnap.empty) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  // Completed plans sink to the bottom; active ones keep their createdAt-desc order.
  // Array.sort is stable, so order within each group is preserved.
  const docs = plansSnap.docs.slice().sort(function (a, b) {
    const ad = a.data().status === "done" ? 1 : 0;
    const bd = b.data().status === "done" ? 1 : 0;
    return ad - bd;
  });

  // Fetch every plan's items in parallel (one round trip instead of N).
  const planItemSnaps = await Promise.all(
    docs.map(function (d) { return d.ref.collection("items").get(); })
  );

  docs.forEach(function (planDoc, i) {
    const p = planDoc.data();
    const startBalance = Number(p.startBalance) || 0;
    const isPlanDone = p.status === "done";
    const itemsSnap = planItemSnaps[i];

    let usedUp = 0;     // sum of effective costs (actual if done, else planned)
    let doneCount = 0;
    itemsSnap.forEach(function (it) {
      const item = it.data();
      const effective = item.status === "done"
        ? (Number(item.actual) || 0)
        : (Number(item.planned) || 0);
      usedUp += effective;
      if (item.status === "done") doneCount++;
    });

    const remaining = startBalance - usedUp;
    const total = itemsSnap.size;
    // For a completed plan: starting balance minus what was actually spent.
    const planDiff = startBalance - (Number(p.actualSpent) || 0);

    // List view only — the card is not a link; tapping it does nothing.
    const card = document.createElement("div");
    card.className = "budget-card plan-card-static" + (isPlanDone ? " is-plan-done" : "");
    card.style.animationDelay = (i * 50) + "ms";

    const monthTag = (isPlanDone && p.pushedTo && p.pushedTo.monthName)
      ? ' <span class="plan-card-month-tag">→ ' + escapeHtml(p.pushedTo.monthName) + '</span>'
      : '';

    card.innerHTML =
      '<div class="budget-row-top">' +
        '<div class="budget-name">' + escapeHtml(p.name) +
          (isPlanDone ? ' <span class="plan-card-done-tag">✓ Done</span>' + monthTag : '') +
        '</div>' +
        '<div class="budget-amount-tag">Start ' + formatMoney(startBalance) + '</div>' +
      '</div>' +
      '<div class="budget-stats">' +
        (isPlanDone && p.actualSpent != null
          ? '<span>Spent <strong>' + formatMoney(Number(p.actualSpent) || 0) + '</strong></span>' +
            '<span>Difference <strong style="color:' + (planDiff < 0 ? "var(--danger)" : "var(--success)") + ';">' + formatMoney(planDiff) + '</strong></span>'
          : '<span>' + doneCount + '/' + total + ' done</span>' +
            '<span>Remaining <strong style="color:' + (remaining < 0 ? "var(--danger)" : "var(--success)") + ';">' + formatMoney(remaining) + '</strong></span>') +
      '</div>' +
      '<div class="plan-card-foot">' +
        (isPlanDone
          ? '<button class="plan-card-reopen" data-plan-reopen="' + planDoc.id + '">Reopen</button>'
          : '<button class="plan-card-done" data-plan-done="' + planDoc.id + '">✓ Mark done</button>') +
      '</div>';

    // The card is a link; keep the Done/Reopen button from navigating into the plan.
    const doneBtn = card.querySelector("[data-plan-done]");
    if (doneBtn) {
      doneBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        markPlanDone(planDoc.id, p.name, startBalance);
      });
    }
    const reopenBtn = card.querySelector("[data-plan-reopen]");
    if (reopenBtn) {
      reopenBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        reopenPlan(planDoc.id);
      });
    }

    listEl.appendChild(card);
  });
}

// Mark a whole plan complete — ask how much was actually spent and which month
// to record it in, push the spend into that month as a real expense, compare it
// against the starting balance, and store the difference. Reversible.
async function markPlanDone(planId, planName, startBalance) {
  startBalance = Number(startBalance) || 0;

  // Load the user's months so the spend can be saved into one (like a real expense).
  const monthsSnap = await db.collection("users").doc(userId)
    .collection("months").orderBy("createdAt", "desc").get();

  if (monthsSnap.empty) {
    showToast("Create a month first (Monthly tab) to record this spend.", "error", 3500);
    return;
  }

  let monthOptions = "";
  monthsSnap.forEach(function (m) {
    monthOptions += '<option value="' + m.id + '">' + escapeHtml(m.data().name) + '</option>';
  });

  // Category + payment options — keys match month.js so the month page renders them correctly.
  const PLAN_CATS = {
    food: "🍔 Food", rent: "🏠 Rent", transport: "🚗 Transport", shopping: "🛍️ Shopping",
    bills: "📄 Bills", health: "💊 Health", entertainment: "🎬 Fun", salary: "💰 Salary", other: "📌 Other"
  };
  const PLAN_PAYS = {
    gpay: "📱 GPay", phonepe: "💜 PhonePe", paytm: "🅿️ Paytm", cash: "💵 Cash", card: "💳 Card", other: "❓ Other"
  };
  let catOptions = "";
  Object.keys(PLAN_CATS).forEach(function (k) {
    catOptions += '<option value="' + k + '"' + (k === "other" ? " selected" : "") + '>' + PLAN_CATS[k] + '</option>';
  });
  let payOptions = "";
  Object.keys(PLAN_PAYS).forEach(function (k) {
    payOptions += '<option value="' + k + '"' + (k === "cash" ? " selected" : "") + '>' + PLAN_PAYS[k] + '</option>';
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>Mark "' + escapeHtml(planName || "plan") + '" done</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="plan-spent-input">How much did you spend? (₹)</label>' +
          '<input type="number" id="plan-spent-input" placeholder="e.g. 12000" min="0">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="plan-month-select">Save to month</label>' +
          '<select id="plan-month-select" class="plan-select">' + monthOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="plan-cat-select">Category</label>' +
          '<select id="plan-cat-select" class="plan-select">' + catOptions + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="plan-pay-select">Payment method</label>' +
          '<select id="plan-pay-select" class="plan-select">' + payOptions + '</select>' +
        '</div>' +
        '<div class="plan-done-compare">' +
          '<div class="pdc-cell">' +
            '<span class="pdc-label">Starting balance</span>' +
            '<span class="pdc-val">' + formatMoney(startBalance) + '</span>' +
          '</div>' +
          '<div class="pdc-cell">' +
            '<span class="pdc-label">Spent</span>' +
            '<span class="pdc-val" id="pdc-spent">' + formatMoney(0) + '</span>' +
          '</div>' +
          '<div class="pdc-cell">' +
            '<span class="pdc-label">Difference</span>' +
            '<span class="pdc-val" id="pdc-diff" style="color:var(--success);">' + formatMoney(startBalance) + '</span>' +
          '</div>' +
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

  const spentInput = backdrop.querySelector("#plan-spent-input");
  const monthSel = backdrop.querySelector("#plan-month-select");
  const spentEl = backdrop.querySelector("#pdc-spent");
  const diffEl = backdrop.querySelector("#pdc-diff");

  // Live preview of spent + difference as the user types.
  function refresh() {
    const spent = Number(spentInput.value) || 0;
    const diff = startBalance - spent;
    spentEl.textContent = formatMoney(spent);
    diffEl.textContent = formatMoney(diff);
    diffEl.style.color = diff < 0 ? "var(--danger)" : "var(--success)";
  }
  spentInput.addEventListener("input", refresh);

  backdrop.querySelector('[data-act="ok"]').addEventListener("click", async function () {
    if (spentInput.value === "" || isNaN(Number(spentInput.value))) {
      return showToast("Enter how much you spent.", "error");
    }
    const spent = Number(spentInput.value);
    if (spent < 0) return showToast("Amount can't be negative.", "error");
    const monthId = monthSel.value;
    const monthName = monthSel.options[monthSel.selectedIndex].textContent;
    if (!monthId) return showToast("Pick a month.", "error");
    const category = backdrop.querySelector("#plan-cat-select").value;
    const paymentMethod = backdrop.querySelector("#plan-pay-select").value;

    const diff = startBalance - spent;
    cleanup();

    // 1) Record the real spend in the chosen month (same shape as month.js expenses).
    const expRef = await db.collection("users").doc(userId)
      .collection("months").doc(monthId).collection("expenses").add({
        name: planName || "Plan",
        amount: spent,
        type: "minus",
        category: category,
        paymentMethod: paymentMethod,
        notes: "From plan: " + (planName || ""),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    // 2) Mark the plan done with the actual spend, difference, and where it went
    //    (incl. the expense id so Reopen can remove it from the month later).
    await db.collection("users").doc(userId)
      .collection("plans").doc(planId)
      .update({
        status: "done",
        actualSpent: spent,
        difference: diff,
        pushedTo: { monthId: monthId, monthName: monthName, expenseId: expRef.id },
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    let msg = "Plan done — " + formatMoney(spent) + " added to " + monthName;
    if (diff > 0) msg += " (" + formatMoney(diff) + " left over)";
    else if (diff < 0) msg += " (over by " + formatMoney(Math.abs(diff)) + ")";
    showToast(msg, "success", 3500);
    renderPlans();
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { spentInput.focus(); }, 50);
}

// Reopen a completed plan — back to the active list. Also removes the expense it
// pushed into the month, so that month's spent recalculates without it.
async function reopenPlan(planId) {
  const planRef = db.collection("users").doc(userId).collection("plans").doc(planId);
  const snap = await planRef.get();
  const pushed = snap.exists && snap.data() ? snap.data().pushedTo : null;

  if (pushed && pushed.monthId && pushed.expenseId) {
    await db.collection("users").doc(userId)
      .collection("months").doc(pushed.monthId)
      .collection("expenses").doc(pushed.expenseId)
      .delete().catch(function () {});
  }

  await planRef.update({
    status: "active",
    completedAt: firebase.firestore.FieldValue.delete(),
    actualSpent: firebase.firestore.FieldValue.delete(),
    difference: firebase.firestore.FieldValue.delete(),
    pushedTo: firebase.firestore.FieldValue.delete()
  });
  showToast("Plan reopened — removed from " + (pushed && pushed.monthName ? pushed.monthName : "the month") + ".", "success", 3500);
  renderPlans();
}

async function createNewPlan() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h3>New Plan</h3>' +
      '<div class="add-expense-form">' +
        '<div class="form-group">' +
          '<label for="plan-name-input">Plan name</label>' +
          '<input type="text" id="plan-name-input" placeholder="e.g. May Planning">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="plan-balance-input">Starting balance (₹)</label>' +
          '<input type="number" id="plan-balance-input" placeholder="e.g. 13980" min="0">' +
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
    const name = backdrop.querySelector("#plan-name-input").value.trim();
    const startBalance = Number(backdrop.querySelector("#plan-balance-input").value);
    if (!name) return showToast("Enter a plan name.", "error");
    if (!startBalance || startBalance <= 0) return showToast("Enter a valid starting balance.", "error");

    await db.collection("users").doc(userId)
      .collection("plans").add({
        name: name,
        startBalance: startBalance,
        status: "active",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    cleanup();
    // List view only — stay on the Plans list instead of opening the plan detail.
    showToast("Plan created.", "success");
    renderPlans();
  });

  document.body.appendChild(backdrop);
  setTimeout(function () { backdrop.querySelector("#plan-name-input").focus(); }, 50);
}
