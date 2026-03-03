/*  sw.js — Service Worker for offline-first PWA
    ─────────────────────────────────────────────────
    Cache-first strategy: serves from cache instantly,
    then updates the cache in the background when online.
    The app works with ZERO network access once cached.
    ───────────────────────────────────────────────── */
const CACHE_NAME = 'ps-attendance-v2';

const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/browser-api.js',
  '/styles.css',
  '/data/laa-reference-data.json',
  '/data/police-stations-laa.json',
  '/manifest.json',
  'https://sql.js.org/dist/sql-wasm.js',
  'https://sql.js.org/dist/sql-wasm.wasm',
];

/* ── Install: pre-cache all assets ── */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ── Activate: clean up old caches ── */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ── Fetch: cache-first, falling back to network ── */
self.addEventListener('fetch', function (event) {
  /* Skip non-GET requests */
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        /* Return cached version immediately, update cache in background */
        event.waitUntil(
          fetch(event.request).then(function (response) {
            if (response && response.status === 200) {
              var clone = response.clone();
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(event.request, clone);
              });
            }
          }).catch(function () { /* offline — ignore */ })
        );
        return cached;
      }
      /* Not in cache — try network and cache the result */
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
