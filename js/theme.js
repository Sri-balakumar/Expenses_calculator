// Theme (light/dark) — runs early to avoid a flash of wrong theme.

(function () {
  const STORAGE_KEY = "expenseTheme";
  const saved = localStorage.getItem(STORAGE_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  window.__currentTheme = theme;
})();

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("expenseTheme", theme);
  window.__currentTheme = theme;
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

// Render a sun/moon toggle button into a container element.
function mountThemeToggle(container) {
  if (!container) return;
  const btn = document.createElement("button");
  btn.className = "logout-link theme-toggle";
  btn.title = "Toggle theme";
  btn.setAttribute("aria-label", "Toggle theme");

  function render() {
    const isDark = getTheme() === "dark";
    btn.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  btn.addEventListener("click", function () { toggleTheme(); render(); });
  render();
  container.appendChild(btn);
}
