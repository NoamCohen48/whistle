'use strict';
// Install support only: deliberately NO fetch handler, CacheStorage, IndexedDB,
// background sync, credentials, terminal state, skipWaiting or clients.claim.
// Every navigation/asset/API request goes directly to the network. Offline
// reloads fail closed; an update never reloads or takes over an active terminal.
// Revision 1: change this revision when the worker's own behavior changes.
