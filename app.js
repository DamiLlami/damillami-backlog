// DamiLlami Backlog — App Bootstrap
// Handles service worker registration, auto-update detection, and install prompt

// --- Service worker registration with auto-update banner ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        // Watch for new SW versions becoming available
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // A new SW has installed AND there's an existing controller
            // (meaning this is an update, not a first install)
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              showUpdateBanner();
            }
          });
        });

        // Check for updates every time the app is opened/refocused
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });
      })
      .catch(err => {
        console.log('Service worker registration failed:', err);
      });
  });

  // When the new SW takes control, reload the page so users get the new code
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  const button = document.getElementById('refresh-btn');
  if (!banner || !button) return;

  banner.hidden = false;
  // Add a class for entrance animation (CSS handles the rest)
  requestAnimationFrame(() => banner.classList.add('show'));

  button.onclick = () => {
    button.disabled = true;
    button.textContent = 'Updating…';
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg?.waiting) {
        // Tell the waiting SW to take over; the controllerchange listener above
        // will trigger a reload as soon as it does
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // Fallback: just reload if there's no waiting worker for some reason
        window.location.reload();
      }
    });
  };
}

// --- Install prompt handling ---
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Could surface a custom "Install" button here in the future
});
