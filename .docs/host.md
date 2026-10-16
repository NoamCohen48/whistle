# Host authentication and lifecycle

## Durable pairing

The Bun host stores paired devices in SQLite (`.runtime/devices.sqlite` until the XDG-path lifecycle increment). Device credentials are 256-bit random values delivered only as HttpOnly, SameSite=Strict cookies; only their SHA-256 hashes enter SQLite. Pairing lasts 90 days, survives host restarts, and is not silently renewed forever. Database files are owner-readable/writable, with WAL and full synchronous commits.

The PC access token remains an owner-only file. It can issue ephemeral QR tickets and administer devices; it is never placed in a URL or browser storage. QR tickets remain five-minute, single-use and memory-only, so restarting invalidates outstanding QRs without invalidating paired devices.

The first upgrade from the old memory-only host requires pairing once again: the old running process cannot export its cookies. Subsequent restarts preserve the new pairings. Existing running hosts are not silently restarted during development.

## Device API

- `GET /api/devices`: list device IDs, names, creation/expiry/last-seen times and which device is current. Requires a paired cookie or PC bearer token. Never returns credential hashes or cookies.
- `DELETE /api/devices/:id`: revoke a device, including the current one. Requires the same authentication plus exact Origin validation. Unknown IDs return 404. Revoking the current browser clears its cookie.
- Login/QR redemption may include a bounded printable `deviceName`. Otherwise the host chooses a platform-based label, without persisting the complete user-agent header.

Revocation commits before live streams are closed. The host releases every controller/observer belonging to the revoked device. It checks device validity at WebSocket open, on every message, before queued input executes, and periodically for idle streams. Other devices are not revoked. Previously accepted writes cannot be undone; no pending input is replayed.

## Checks

Unit tests cover restart persistence, hash-only storage, permissions, expiry, label validation, throttled last-seen writes and scoped revocation. Host process tests restart the actual HTTP server and verify cookie survival, expired QR rejection, origin checks and durable revocation. A fake Herdr executable and isolated Unix socket verify that revoking a live device closes its WebSocket and releases its controller without using any real pane.

The user-service lifecycle and device-management CLI are the next implementation increment. No firewall changes or user lingering are part of installation.
