// PWA helper — registers the service worker + shows an Install button when eligible.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(function (err) { console.warn("SW register failed:", err); });
  });
}

// Listen for the install prompt and show a floating install button
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

window.addEventListener("appinstalled", function () {
  removeInstallButton();
  deferredPrompt = null;
  if (typeof showToast === "function") {
    showToast("App installed! Open it from your home screen.", "success");
  }
});

function showInstallButton() {
  if (document.getElementById("pwa-install-btn")) return;

  const btn = document.createElement("button");
  btn.id = "pwa-install-btn";
  btn.className = "pwa-install-fab";
  btn.title = "Install app";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
    '<span>Install</span>';

  btn.addEventListener("click", async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      removeInstallButton();
    }
    deferredPrompt = null;
  });

  document.body.appendChild(btn);
}

function removeInstallButton() {
  const el = document.getElementById("pwa-install-btn");
  if (el) el.remove();
}
