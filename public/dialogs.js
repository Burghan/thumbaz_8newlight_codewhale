// Shared in-app replacements for window.confirm/alert/prompt — used across
// every page so a native "example.com says" browser dialog never shows up.
// Self-contained: injects its own modal markup/styles on first use, so any
// page just needs this one script tag, no per-page HTML/CSS required.
// API (all Promise-based, unlike the native blocking versions):
//   await appConfirm(message, { title, confirmText, cancelText, danger })  -> boolean
//   await appAlert(message, { title })                                    -> void
//   await appPrompt(message, defaultValue, { title, placeholder })        -> string | null
(function () {
  'use strict';
  if (window.appConfirm) return; // already loaded on this page

  let root = null, card = null, titleEl = null, msgEl = null, bodyExtra = null, actionsEl = null;

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'appDialogBackdrop';
    root.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,45,.45);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px;box-sizing:border-box;';
    card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#fff);color:var(--ink,#222);border-radius:16px;padding:20px;width:min(360px,92vw);box-shadow:0 24px 64px rgba(0,0,0,.28);font-family:var(--font-ui,inherit);';
    titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0 0 8px;font-family:var(--font-brand,inherit);color:var(--brand-ink,#222);font-size:17px;';
    msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:0 0 14px;color:var(--muted,#666);font-size:14px;white-space:pre-wrap;';
    bodyExtra = document.createElement('div');
    bodyExtra.style.cssText = 'margin:0 0 14px;';
    actionsEl = document.createElement('div');
    actionsEl.style.cssText = 'display:grid;gap:10px;';
    card.appendChild(titleEl);
    card.appendChild(msgEl);
    card.appendChild(bodyExtra);
    card.appendChild(actionsEl);
    root.appendChild(card);
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) closeWithNull(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.style.display === 'flex') closeWithNull(); });
  }

  let pendingResolve = null;
  function closeWithNull() {
    root.style.display = 'none';
    const r = pendingResolve; pendingResolve = null;
    if (r) r(null);
  }
  function open(resolve) {
    pendingResolve = resolve;
    root.style.display = 'flex';
  }

  function button(label, style) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'padding:10px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;border:1px solid var(--border,#ccc);' + style;
    return b;
  }

  window.appConfirm = function (message, opts) {
    opts = opts || {};
    ensureRoot();
    titleEl.textContent = opts.title || 'Please confirm';
    msgEl.textContent = message || '';
    bodyExtra.innerHTML = '';
    actionsEl.innerHTML = '';
    actionsEl.style.gridTemplateColumns = '1fr 1fr';
    const no = button(opts.cancelText || 'Cancel', 'background:var(--card,#fff);color:var(--ink,#222);');
    const yes = button(opts.confirmText || 'OK', opts.danger
      ? 'background:var(--danger,#c1584e);border-color:var(--danger,#c1584e);color:#fff;'
      : 'background:var(--accent,var(--brand,#5c7da6));border-color:var(--accent,var(--brand,#5c7da6));color:#fff;');
    actionsEl.appendChild(no);
    actionsEl.appendChild(yes);
    return new Promise((resolve) => {
      no.onclick = () => { root.style.display = 'none'; pendingResolve = null; resolve(false); };
      yes.onclick = () => { root.style.display = 'none'; pendingResolve = null; resolve(true); };
      open((v) => resolve(v === null ? false : v));
    });
  };

  window.appAlert = function (message, opts) {
    opts = opts || {};
    ensureRoot();
    titleEl.textContent = opts.title || 'Notice';
    msgEl.textContent = message || '';
    bodyExtra.innerHTML = '';
    actionsEl.innerHTML = '';
    actionsEl.style.gridTemplateColumns = '1fr';
    const ok = button('OK', 'background:var(--accent,var(--brand,#5c7da6));border-color:var(--accent,var(--brand,#5c7da6));color:#fff;');
    actionsEl.appendChild(ok);
    return new Promise((resolve) => {
      ok.onclick = () => { root.style.display = 'none'; pendingResolve = null; resolve(); };
      open(() => resolve());
    });
  };

  window.appPrompt = function (message, defaultValue, opts) {
    opts = opts || {};
    ensureRoot();
    titleEl.textContent = opts.title || 'Enter a value';
    msgEl.textContent = message || '';
    bodyExtra.innerHTML = '';
    const input = document.createElement('input');
    input.type = opts.type || 'text';
    input.value = defaultValue != null ? String(defaultValue) : '';
    input.placeholder = opts.placeholder || '';
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:40px;padding:8px 12px;border:1px solid var(--border,#ccc);border-radius:8px;font-size:14px;background:var(--bg,#fff);color:var(--ink,#222);';
    bodyExtra.appendChild(input);
    actionsEl.innerHTML = '';
    actionsEl.style.gridTemplateColumns = '1fr 1fr';
    const no = button('Cancel', 'background:var(--card,#fff);color:var(--ink,#222);');
    const yes = button(opts.confirmText || 'OK', 'background:var(--accent,var(--brand,#5c7da6));border-color:var(--accent,var(--brand,#5c7da6));color:#fff;');
    actionsEl.appendChild(no);
    actionsEl.appendChild(yes);
    return new Promise((resolve) => {
      no.onclick = () => { root.style.display = 'none'; pendingResolve = null; resolve(null); };
      yes.onclick = () => { root.style.display = 'none'; pendingResolve = null; resolve(input.value); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') yes.onclick(); });
      open((v) => resolve(v));
      setTimeout(() => input.focus(), 0);
    });
  };
})();
