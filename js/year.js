// Yearly summary: tiles for each month + total spend chart for one calendar year.

let yearUserId = null;
let yearUserSalary = 0;
let yearChart = null;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

function getYearFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const y = Number(params.get("year"));
  return y || new Date().getFullYear();
}

async function loadYear() {
  const user = await waitForAuth();
  if (!user) return (window.location.href = "index.html");
  yearUserId = user.uid;

  const userDoc = await db.collection("users").doc(yearUserId).get();
  yearUserSalary = Number(userDoc.data().salary) || 0;

  const year = getYearFromUrl();
  document.getElementById("year-title").textContent = "Year " + year;
  document.getElementById("year-label").textContent = year;
  document.getElementById("year-prev").onclick = function () { window.location.search = "?year=" + (year - 1); };
  document.getElementById("year-next").onclick = function () { window.location.search = "?year=" + (year + 1); };

  // Fetch all months
  const monthsSnap = await db.collection("users").doc(yearUserId)
    .collection("months").get();

  // Index by month-of-year
  const dataByMonth = {};
  const ids = {};
  for (let m = 0; m < 12; m++) dataByMonth[m] = 0;

  let totalSpend = 0;
  let totalIncome = 0;

  for (const monthDoc of monthsSnap.docs) {
    const month = monthDoc.data();
    if (!month.name) continue;
    const idx = MONTH_NAMES.findIndex(function (n) {
      return month.name.startsWith(n) && month.name.indexOf(String(year)) !== -1;
    });
    if (idx === -1) continue;

    const expensesSnap = await monthDoc.ref.collection("expenses").get();
    let spent = 0;
    expensesSnap.forEach(function (expDoc) {
      const exp = expDoc.data();
      const amt = Number(exp.amount) || 0;
      if (exp.type === "plus") totalIncome += amt;
      else { spent += amt; totalSpend += amt; }
    });

    dataByMonth[idx] += spent;
    ids[idx] = monthDoc.id;
  }

  renderTiles(dataByMonth, ids);
  renderChart(dataByMonth);
  renderStats(totalSpend, totalIncome);

  document.getElementById("year-loading").classList.add("hidden");
  document.getElementById("year-content").classList.remove("hidden");
}

function renderStats(spend, income) {
  document.getElementById("stat-total-spend").textContent = formatMoney(spend);
  document.getElementById("stat-total-income").textContent = formatMoney(income);
  document.getElementById("stat-avg-month").textContent = formatMoney(Math.round(spend / 12));
  const yearlySalary = yearUserSalary * 12;
  document.getElementById("stat-yearly-salary").textContent = formatMoney(yearlySalary);
}

function renderTiles(dataByMonth, ids) {
  const grid = document.getElementById("year-grid");
  grid.innerHTML = "";
  MONTH_NAMES.forEach(function (m, i) {
    const tile = document.createElement("a");
    const hasData = dataByMonth[i] > 0;
    tile.className = "month-card";
    tile.style.cursor = ids[i] ? "pointer" : "default";
    if (ids[i]) tile.href = "month.html?id=" + ids[i];
    tile.style.opacity = hasData ? "1" : "0.5";

    const calIcon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
      '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>' +
      '<line x1="3" y1="10" x2="21" y2="10"/></svg>';

    tile.innerHTML =
      '<div class="month-card-icon">' + calIcon + '</div>' +
      '<div class="month-card-body">' +
        '<div class="month-name">' + m + '</div>' +
        '<div class="month-summary">' +
          (hasData
            ? 'Spent: <span class="spent">' + formatMoney(dataByMonth[i]) + '</span>'
            : '<span class="muted">No data</span>') +
        '</div>' +
      '</div>';

    grid.appendChild(tile);
  });
}

function renderChart(dataByMonth) {
  if (!window.Chart) return;
  const labels = MONTH_NAMES.map(function (m) { return m.slice(0, 3); });
  const data = MONTH_NAMES.map(function (_, i) { return dataByMonth[i] || 0; });

  const ctx = document.getElementById("year-chart").getContext("2d");
  if (yearChart) yearChart.destroy();
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, "rgba(99, 102, 241, 0.85)");
  gradient.addColorStop(1, "rgba(139, 92, 246, 0.4)");

  yearChart = new Chart(ctx, {
    type: "bar",
    data: { labels: labels, datasets: [{ data: data, backgroundColor: gradient, borderRadius: 6, maxBarThickness: 36 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return formatMoney(ctx.parsed.y); } } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--text-muted") } },
        y: {
          beginAtZero: true,
          ticks: {
            color: getComputedStyle(document.documentElement).getPropertyValue("--text-muted"),
            callback: function (v) { return v >= 1000 ? "₹" + (v/1000) + "k" : "₹" + v; }
          },
          grid: { color: "rgba(128,128,128,0.1)" }
        }
      }
    }
  });
}
