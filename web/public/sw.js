'use strict';
// Install support and "needs you" alerts only: deliberately NO fetch handler, CacheStorage,
// IndexedDB, background sync, credentials, terminal state, skipWaiting or clients.claim.
// Every navigation/asset/API request goes directly to the network. Offline
// reloads fail closed; an update never reloads or takes over an active terminal.
// Its only request of its own is a tapped reply button's, with the browser's own cookie.
// Revision 4: change this revision when the worker's own behavior changes.

// Push payloads are encrypted end to end by the PC: { title, body, paneId, quiet?, since?, replies? }.
// Nothing is stored. During the phone's quiet hours the PC marks alerts quiet: shown, without
// sound or vibration. Replies become buttons that answer the agent without opening Whistle.
self.addEventListener('push', event => {
  let alert = {};
  try { alert = event.data ? event.data.json() : {}; } catch { /* Show a generic alert instead. */ }
  const paneId = typeof alert.paneId === 'string' ? alert.paneId : '';
  const replies = paneId && Number.isSafeInteger(alert.since) && Array.isArray(alert.replies)
    ? alert.replies.filter(reply => typeof reply === 'string' && reply).slice(0, (self.Notification && Notification.maxActions) || 2) : [];
  event.waitUntil(self.registration.showNotification(typeof alert.title === 'string' ? alert.title : 'An agent needs you', {
    body: typeof alert.body === 'string' ? alert.body : '',
    tag: paneId ? `pane:${paneId}` : 'whistle', renotify: alert.quiet !== true, silent: alert.quiet === true,
    icon: '/icon-192.png', data: replies.length ? { paneId, since: alert.since, replies } : { paneId },
    ...(replies.length ? { actions: replies.map((reply, index) => ({ action: `reply:${index}`, title: reply })) } : {}),
  }));
});

// A reply button types that reply into the pane and presses Enter. The PC refuses it if the agent
// moved on, someone is controlling the pane, or the alert was already answered; then this says
// so, and tapping that opens the pane. Nothing is retried.
async function reply(paneId, since, text) {
  let problem;
  try {
    const response = await fetch('/api/reply', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paneId, since, text }),
    });
    if (response.ok) return;
    problem = response.status === 401 ? 'This phone is no longer paired. Nothing was sent.'
      : (await response.text().catch(() => '')) || `The PC answered ${response.status}. Nothing was sent.`;
  } catch (error) {
    problem = error && error.name === 'TimeoutError' ? 'The PC did not answer in time, so the reply may or may not have arrived.'
      : 'The PC could not be reached. Nothing was sent.';
  }
  await self.registration.showNotification(`Not sent: ${text}`, {
    body: `${problem} Tap to open the agent.`, tag: `pane:${paneId}`, icon: '/icon-192.png', data: { paneId },
  });
}

// Opening an alert shows that pane watch-only, like any other way of opening it; a reply button
// sends its reply instead. A plain function, so tests can call it inside the worker.
function clicked(data, action) {
  const paneId = data && data.paneId || '';
  const button = /^reply:(\d+)$/.exec(action || '');
  if (button && paneId && Array.isArray(data.replies) && typeof data.replies[button[1]] === 'string') {
    return reply(paneId, data.since, data.replies[button[1]]);
  }
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      if (paneId) open.postMessage({ type: 'open-pane', paneId });
      return open.focus();
    }
    return self.clients.openWindow(paneId ? `/#pane=${encodeURIComponent(paneId)}` : '/');
  });
}
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clicked(event.notification.data, event.action));
});
