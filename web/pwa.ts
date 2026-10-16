// No service worker during Vite development, no runtime caches, no automatic
// reload/update activation. Register once, outside React's Strict Mode lifecycle.
export function registerInstallSupport() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      console.warn('Whistle install support unavailable; the online terminal is unaffected.');
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
