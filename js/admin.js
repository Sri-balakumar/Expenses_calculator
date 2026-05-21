// Admin dashboard: lists all users + their stats.

async function loadAdmin() {
  const user = await waitForAuth();
  if (!user) {
    window.location.href = "admin-login.html";
    return;
  }
  if (!isAdmin(user)) {
    showToast("Admin access required.", "error");
    setTimeout(function () { window.location.href = "index.html"; }, 800);
    return;
  }

  document.getElementById("admin-name").textContent = user.email;

  await renderUsers();
}

async function renderUsers() {
  const listEl = document.getElementById("users-list");
  const emptyEl = document.getElementById("users-empty");
  listEl.innerHTML = "";

  const usersSnap = await db.collection("users").orderBy("createdAt", "desc").get();

  if (usersSnap.empty) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  let i = 0;
  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const monthsSnap = await userDoc.ref.collection("months").get();
    const monthCount = monthsSnap.size;

    const card = document.createElement("div");
    card.className = "user-card";
    card.style.animationDelay = (i * 40) + "ms";

    const name = u.name || "Unnamed";
    const email = u.email || "";
    const initials = name.split(" ").map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase() || "?";
    const adminBadge = isAdminEmail(email)
      ? '<span class="role-badge">Admin</span>'
      : '';
    const signupDate = formatDate(u.createdAt);

    card.innerHTML =
      '<div class="user-avatar">' + escapeHtml(initials) + '</div>' +
      '<div class="user-body">' +
        '<div class="user-name">' + escapeHtml(name) + adminBadge + '</div>' +
        '<div class="user-email">' + escapeHtml(email) + '</div>' +
        '<div class="user-stats">' +
          '<span class="user-stat">Salary <strong>' + formatMoney(u.salary || 0) + '</strong></span>' +
          '<span class="user-stat">Months <strong>' + monthCount + '</strong></span>' +
          (signupDate ? '<span class="user-stat">Joined <strong>' + signupDate + '</strong></span>' : '') +
        '</div>' +
      '</div>';

    listEl.appendChild(card);
    i++;
  }
}

function formatDate(ts) {
  if (!ts || !ts.toDate) return "";
  const d = ts.toDate();
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
