// Dami Media Book — Service Worker
// Caches the app shell so it works offline after first visit.
// Bump APP_VERSION on every release to force installed PWAs to update.

const APP_VERSION = 'v63';

const CACHE_NAME = `dami-media-book-${APP_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// On install: pre-cache the app shell
// We do NOT call skipWaiting() here — we let the user trigger it via the
// "Refresh" button in the update banner so they aren't disrupted mid-task.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

// On activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Allow the app to trigger activation of a waiting worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// On fetch: network-first for HTML (so users always get the latest UI),
// cache-first for static assets like icons and fonts.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Don't cache POST requests (API calls) or non-GET methods
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API calls — always go to network for fresh data
  if (url.hostname === 'api.anthropic.com') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // Network-first for HTML documents (navigation requests, index.html, root).
  // This guarantees that PWA users always see the latest UI on next refresh
  // — no more being stuck on a cached version of index.html for ages.
  const isHtmlRequest =
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.endsWith('/index.html');

  if (isHtmlRequest) {
    event.respondWith(
      fetch(request).then((response) => {
        // Cache the fresh HTML for offline fallback
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline: serve the cached copy
        return caches.match(request).then(cached => cached || caches.match('./index.html'));
      })
    );
    return;
  }

  // Cache-first for static assets (icons, fonts, etc.)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
