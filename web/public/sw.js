'use strict';
// Install support and "needs you" alerts only: deliberately NO fetch handler, CacheStorage,
// IndexedDB, background sync, credentials, terminal state, skipWaiting or clients.claim.
// Every navigation/asset/API request goes directly to the network. Offline
// reloads fail closed; an update never reloads or takes over an active terminal.
// Revision 3: change this revision when the worker's own behavior changes.

// Push payloads are encrypted end to end by the PC: { title, body, paneId, quiet? }. Nothing is stored.
// During the phone's quiet hours the PC marks alerts quiet: shown, without sound or vibration.
self.addEventListener('push', event => {
  let alert = {};
  try { alert = event.data ? event.data.json() : {}; } catch { /* Show a generic alert instead. */ }
  const paneId = typeof alert.paneId === 'string' ? alert.paneId : '';
  event.waitUntil(self.registration.showNotification(typeof alert.title === 'string' ? alert.title : 'An agent needs you', {
    body: typeof alert.body === 'string' ? alert.body : '',
    tag: paneId ? `pane:${paneId}` : 'whistle', renotify: alert.quiet !== true, silent: alert.quiet === true,
    icon: '/icon-192.png', data: { paneId },
  }));
});

// Opening an alert shows that pane watch-only, like any other way of opening it.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const paneId = event.notification.data && event.notification.data.paneId || '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      if (paneId) open.postMessage({ type: 'open-pane', paneId });
      return open.focus();
    }
    return self.clients.openWindow(paneId ? `/#pane=${encodeURIComponent(paneId)}` : '/');
  }));
});
