// Dami Media Book — Service Worker
// Caches the app shell so it works offline after first visit.
// Bump APP_VERSION on every release to force installed PWAs to update.

const APP_VERSION = 'v93';

const CACHE_NAME = `dami-media-book-${APP_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// On install: pre-cache the app shell, then immediately activate.
// skipWaiting() ensures the new version takes over immediately instead of
// waiting for all tabs to close — critical for mobile PWAs where the app
// never fully "closes" and would otherwise stay on old versions forever.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
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

// --- Push notifications ---
// When a push message arrives, show a notification. The payload is a JSON object
// with { title, body, url } sent by the cron/reminder system.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || 'Dami Media Book';
    const options = {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'dami-media-book-reminder', // collapse duplicate notifications
      renotify: true,
      data: { url: data.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // If payload isn't JSON, show a generic notification
    event.waitUntil(
      self.registration.showNotification('Dami Media Book', {
        body: event.data.text() || 'You have updates waiting.',
        icon: './icons/icon-192.png',
        tag: 'dami-media-book-reminder',
      })
    );
  }
});

// When the user clicks a notification, open or focus the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If the app is already open, focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
