// Minimal service worker — exists mainly to satisfy PWA installability.
// Deliberately does NOT cache HTML pages or /api/* responses: this is a live
// business system (inventory, sales, prices), and a stale cached page showing
// wrong stock or old prices would be actively harmful. Only the static shell
// (css/js/icons/manifest) is cached, so those load instantly while every page
// navigation and every API call always goes straight to the network.
const CACHE = 'newlight-shell-v10';
const SHELL_ASSETS = [
  '/sidebar.css',
  '/theme.css',
  '/sidebar.js',
  '/auth.js',
  '/newlight-logo.jpeg',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return; // everything else: normal network fetch

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
      return res;
    }))
  );
});
