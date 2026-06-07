// Dami Media Book — App Bootstrap
// Handles service worker registration, auto-update detection, and install prompt

// --- Service worker registration with auto-update banner ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(registration => {
        // --- CASE 1: a new SW is ALREADY waiting when the page loads ---
        // This is the most common real-world case and the one the old code missed:
        // the new service worker installed during a *previous* visit and is sitting
        // in the "waiting" state. Because updatefound already fired before this script
        // attached its listener, we'd never catch it via the event alone. So we check
        // registration.waiting directly, right now, and show the banner if present.
        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }

        // --- CASE 2: a new SW is found and installs while the page is open ---
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            // Installed + there's a controller (or a waiting worker) => this is an
            // update, not a first install. Show the banner.
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller || registration.waiting) {
                showUpdateBanner();
              }
            }
          });
        });

        // Proactively poll for updates on open and on every refocus, so a long-running
        // installed PWA notices new deploys without a manual hard refresh.
        const pollForUpdate = () => registration.update().catch(() => {});
        pollForUpdate();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') pollForUpdate();
        });
      })
      .catch(err => {
        console.log('Service worker registration failed:', err);
      });
  });

  // When the new SW takes control, reload so users run the new code.
  // Guard against the first-install controllerchange (which shouldn't reload the
  // page unnecessarily) by only reloading once, and only after we've had a controller.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// Exposed so it can be called from either the already-waiting check or the
// updatefound path. Idempotent — safe to call more than once.
function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  const button = document.getElementById('refresh-btn');
  if (!banner || !button) return;
  if (banner.dataset.shown === '1') return; // don't double-show
  banner.dataset.shown = '1';

  banner.hidden = false;
  requestAnimationFrame(() => banner.classList.add('show'));

  button.onclick = () => {
    button.disabled = true;
    button.textContent = 'Updating…';
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.waiting) {
        // Tell the waiting SW to take over; the controllerchange listener triggers reload
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // Fallback: no waiting worker (rare) — just hard-reload to fetch latest
        window.location.reload();
      }
    }).catch(() => window.location.reload());

    // Safety net: if controllerchange doesn't fire within 3s (some browsers are
    // flaky about it), force a reload so the user isn't stuck on "Updating…".
    setTimeout(() => { window.location.reload(); }, 3000);
  };
}

// --- Install prompt handling ---
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Could surface a custom "Install" button here in the future
});
