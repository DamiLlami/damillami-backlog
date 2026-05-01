
// Register service worker + detect updates
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(registration => {

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            showUpdateBanner();
          }
        });
      });

    });
}

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  const button = document.getElementById('refresh-btn');

  if (!banner || !button) return;

  banner.hidden = false;

  button.onclick = () => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  };
}

// Reload when new SW takes control
let refreshing = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (refreshing) return;
  refreshing = true;
  window.location.reload();
});
``
