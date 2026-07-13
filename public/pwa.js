// Registers the service worker so the app is installable ("Add to Home
// Screen") on phones/tablets. Requires HTTPS (or localhost) — silently no-ops
// otherwise, which is expected on plain-HTTP local dev.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
