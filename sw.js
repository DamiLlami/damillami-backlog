// DamiLlami Backlog — Service Worker
// Caches the app shell so it works offline after first visit


const APP_VERSION = 'v7'; // change this on every release
const CACHE_NAME = `'damillami-backlog-${APP_VERSION}`;

  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// On install: pre-cache the app shell
self.addEventListener('install', event => {
  self.skipWaiting(); // allow update to reach "waiting" faster
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        '/',
        '/index.html',
        '/style.css',
        '/app.js'
      ])
    )
  );
});

// On activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});


// On fetch: cache-first for app shell, network-first for everything else
// (API calls to api.anthropic.com and Google Fonts will hit the network)
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Don't cache POST requests (API calls) or cross-origin requests we don't control
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip Anthropic API — always fresh
  if (url.hostname === 'api.anthropic.com') return;

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
