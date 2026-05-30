// Toast notifications + custom confirm modal (replaces browser alert/confirm).

// Smoothly animate a number from current to target. el should have a data-value attr (or 0).
function animateCount(el, target, formatter, durationMs) {
  if (!el) return;
  const duration = durationMs || 600;
  const start = Number(el.dataset.value) || 0;
  const change = target - start;
  if (change === 0) {
    el.textContent = (formatter || String)(target);
    return;
  }
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    const v = start + change * eased;
    el.textContent = (formatter || function (x) { return String(Math.round(x)); })(v);
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = (formatter || String)(target);
      el.dataset.value = target;
    }
  }
  requestAnimationFrame(step);
}

function getToastContainer() {
  let c = document.getElementById("toast-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "toast-container";
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  return c;
}

function showToast(message, type, durationMs) {
  const t = type || "info";
  const duration = durationMs || (t === "error" ? 3500 : 2500);

  const toast = document.createElement("div");
  toast.className = "toast " + t;

  const iconChar = t === "error" ? "!" : t === "success" ? "✓" : "i";
  toast.innerHTML =
    '<div class="toast-icon">' + iconChar + '</div>' +
    '<div class="toast-body"></div>' +
    '<button class="toast-close" aria-label="Close">&times;</button>';

  toast.querySelector(".toast-body").textContent = message;

  const close = function () {
    toast.classList.add("exit");
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
  };
  toast.querySelector(".toast-close").addEventListener("click", close);

  getToastContainer().appendChild(toast);
  setTimeout(close, duration);
}

function showPrompt(opts) {
  const title = (opts && opts.title) || "Enter value";
  const placeholder = (opts && opts.placeholder) || "";
  const defaultValue = (opts && opts.defaultValue) || "";
  const confirmText = (opts && opts.confirmText) || "OK";
  const cancelText = (opts && opts.cancelText) || "Cancel";

  return new Promise(function (resolve) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    backdrop.innerHTML =
      '<div class="confirm-card" style="text-align:left;">' +
        '<div class="confirm-title" style="text-align:center;"></div>' +
        '<input type="text" class="prompt-input" />' +
        '<div class="confirm-actions" style="margin-top:18px;">' +
          '<button class="btn-secondary" data-act="cancel"></button>' +
          '<button class="btn-primary" data-act="ok"></button>' +
        '</div>' +
      '</div>';

    backdrop.querySelector(".confirm-title").textContent = title;
    const input = backdrop.querySelector(".prompt-input");
    input.placeholder = placeholder;
    input.value = defaultValue;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelText;
    backdrop.querySelector('[data-act="ok"]').textContent = confirmText;

    function cleanup(result) {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      resolve(result);
    }

    backdrop.querySelector('[data-act="cancel"]').addEventListener("click", function () { cleanup(null); });
    backdrop.querySelector('[data-act="ok"]').addEventListener("click", function () {
      const val = input.value.trim();
      cleanup(val || null);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        const val = input.value.trim();
        cleanup(val || null);
      } else if (e.key === "Escape") {
        cleanup(null);
      }
    });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(null); });

    document.body.appendChild(backdrop);
    setTimeout(function () { input.focus(); }, 50);
  });
}

function showConfirm(opts) {
  const title = (opts && opts.title) || "Are you sure?";
  const message = (opts && opts.message) || "";
  const confirmText = (opts && opts.confirmText) || "Delete";
  const cancelText = (opts && opts.cancelText) || "Cancel";
  const danger = !opts || opts.danger !== false;

  return new Promise(function (resolve) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const iconSvg = danger
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
        '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    backdrop.innerHTML =
      '<div class="confirm-card">' +
        '<div class="confirm-icon">' + iconSvg + '</div>' +
        '<div class="confirm-title"></div>' +
        '<div class="confirm-text"></div>' +
        '<div class="confirm-actions">' +
          '<button class="btn-secondary" data-act="cancel"></button>' +
          '<button class="' + (danger ? "btn-danger" : "btn-primary") + '" data-act="ok"></button>' +
        '</div>' +
      '</div>';

    backdrop.querySelector(".confirm-title").textContent = title;
    backdrop.querySelector(".confirm-text").textContent = message;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelText;
    backdrop.querySelector('[data-act="ok"]').textContent = confirmText;

    function cleanup(result) {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      resolve(result);
    }

    backdrop.querySelector('[data-act="cancel"]').addEventListener("click", function () { cleanup(false); });
    backdrop.querySelector('[data-act="ok"]').addEventListener("click", function () { cleanup(true); });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cleanup(false); });

    document.body.appendChild(backdrop);
  });
}

// ============================================================
// Show / hide password toggle — auto-enhances every password
// field that sits inside an .input-wrap (login, signup, profile).
// ============================================================

var PW_EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
var PW_EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
  '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

function enhancePasswordToggles(root) {
  var scope = root || document;
  var inputs = scope.querySelectorAll('input[type="password"]');
  Array.prototype.forEach.call(inputs, function (input) {
    var wrap = input.closest(".input-wrap");
    if (!wrap || wrap.querySelector(".pw-toggle")) return;

    wrap.classList.add("has-pw-toggle");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.title = "Show password";
    btn.setAttribute("aria-label", "Show password");
    btn.innerHTML = PW_EYE_SVG;

    btn.addEventListener("click", function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = showing ? PW_EYE_SVG : PW_EYE_OFF_SVG;
      btn.title = showing ? "Show password" : "Hide password";
      btn.setAttribute("aria-label", btn.title);
      input.focus();
    });

    wrap.appendChild(btn);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { enhancePasswordToggles(); });
} else {
  enhancePasswordToggles();
}
