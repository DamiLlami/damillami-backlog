// DamiLlami Backlog — Service Worker
// Caches the app shell so it works offline after first visit.
// Bump APP_VERSION on every release to force installed PWAs to update.

const APP_VERSION = 'v4';
const CACHE_NAME = `damillami-backlog-${APP_VERSION}`;

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

// On fetch: cache-first for app shell, network for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Don't cache POST requests (API calls) or non-GET methods
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API calls — always go to network for fresh data
  if (url.hostname === 'api.anthropic.com') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // Cache-first for everything else (including Google Fonts after first load)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful responses
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
