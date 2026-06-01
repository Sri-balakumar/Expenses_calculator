// Service worker — caches the app shell so it loads instantly + works offline.

const CACHE_NAME = "expense-calc-v14";

const APP_SHELL = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./month.html",
  "./year.html",
  "./plan.html",
  "./profile.html",
  "./admin-login.html",
  "./admin.html",
  "./settings.html",
  "./manifest.json",
  "./icons/icon.svg",
  "./css/style.css",
  "./js/firebase.js",
  "./js/auth.js",
  "./js/ui.js",
  "./js/theme.js",
  "./js/admin-config.js",
  "./js/dashboard.js",
  "./js/month.js",
  "./js/plan.js",
  "./js/year.js",
  "./js/admin.js",
  "./js/pwa.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL).catch(function () {
        // If any single file fails (e.g. during local dev), keep going
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // Only handle GETs
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache Firebase / Google APIs / CDN calls — let the network handle them.
  if (url.hostname.includes("googleapis.com") ||
      url.hostname.includes("firebaseio.com") ||
      url.hostname.includes("firestore.googleapis.com") ||
      url.hostname.includes("gstatic.com") ||
      url.hostname.includes("jsdelivr.net") ||
      url.hostname.includes("cdnjs.cloudflare.com")) {
    return;
  }

  // Same-origin: network-first with cache fallback.
  // This guarantees the latest HTML/CSS/JS loads whenever online, while still
  // working offline by falling back to the cached copy.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function (response) {
        // Refresh the cache with the latest copy for offline use
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
        }
        return response;
      }).catch(function () {
        // Offline → serve the cached copy if we have it
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
      })
    );
  }
});
