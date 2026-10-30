# Installable PWA and private HTTPS

## Install shell

Whistle has a stable manifest ID, scope and launch URL (`/`), standalone display, theme/background color, and real 192/512px PNG icons. The larger icon's glyph fits Android's maskable safe zone. Regenerate/check deterministic assets with `python3 scripts/pwa-icons.py [--check]`.

Production registers `/sw.js` once, outside React's lifecycle, with `updateViaCache: none`. Vite development does not register a worker.

**Online only:** apart from showing "needs you" alerts (below), the worker has no fetch handler, runtime cache, IndexedDB, background sync, input queue or credential storage. All shell/assets/API requests use the network; server responses use `Cache-Control: no-store`. WebSockets remain direct. Offline reloads fail rather than presenting a saved terminal or authentication response. Already rendered terminal text can remain in the open page's memory as before; it is not an offline transcript.

The worker never calls `skipWaiting` or `clients.claim`, and nothing automatically reloads the page. A changed worker waits behind controlled pages. A user-initiated navigation loads the current shell. No update takes control, changes PTY geometry or replays input. Browser/OS tab restoration still needs physical-phone validation.

## Needs-you alerts

The bell on the pane list turns on Web Push alerts for this device. It appears only where they can work: a production build in a secure context with service worker, Push and Notification support (so HTTPS mode on a phone; not Vite development). Turning alerts on asks for notification permission, subscribes with the PC's VAPID key, stores the subscription on the PC and sends an "Alerts are on" message through the whole path; a delivery failure is shown at once.

The worker's `push` handler only shows the notification (tagged per pane, so a newer alert replaces an older one; an alert marked quiet during the phone's quiet hours is shown with `silent: true`). Tapping it sends an open message to an open Whistle window, or opens `/#pane=ID`, which is stripped from the URL before any request and opens that pane **watch-only**, exactly like a restored selection. Nothing is cached or stored by the worker. Host-side details are in [host authentication](host.md#needs-you-alerts).

All PWA files use the host's explicit static allowlist and are embedded in the standalone binary. PNGs use base64 only inside the executable metadata and are served as original binary bytes with `image/png`. No filesystem directory or credential file is served.

## Explicit HTTPS proxy mode

A private TLS reverse proxy terminates HTTPS/WSS and forwards to a **loopback-only** Whistle backend. Do not expose this backend or use a public relay such as Tailscale Funnel. With Tailscale Serve:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8790
whistle install --host 127.0.0.1 --port 8790 \
  --public-origin https://your-pc.your-tailnet.ts.net:8443
# Installation does not restart a running service.
whistle restart
```

`publicOrigin` is saved in the private JSON config. `WHISTLE_PUBLIC_ORIGIN` is its explicit runtime override. It must be a canonical HTTPS origin with no path, trailing slash, query, fragment or credentials. Non-loopback listeners are rejected while proxy mode is configured. To deliberately return to direct HTTP, clear it with `--public-origin ''` when installing and explicitly restore the desired listener.

Configured public origin controls:

- Exact Origin validation for pairing, revocation and WebSocket upgrades.
- Public QR URLs (fragments remain single-use and are removed before app requests).
- `Secure; HttpOnly; SameSite=Strict; Path=/` session cookies, including deletion.

`Forwarded`, `X-Forwarded-Host` and `X-Forwarded-Proto` are **never trusted** to enable HTTPS or choose QR/CSRF origins. Unconfigured direct HTTP retains its existing behavior. The PC CLI connects to the private recorded backend URL but sends the configured public Origin; the PC token is never put in a URL. Keep configuration, proxy and service restart coordinated: a newly configured CLI cannot administer an old still-running service under a different origin policy.

## Switching from HTTP to HTTPS

Moving from an IP/HTTP URL to a DNS/HTTPS origin requires **fresh pairing at the new origin**. Browsers do not transfer host-scoped cookies between them. Existing device rows and the PC token are preserved; no old device is automatically revoked. A restart releases active control, and reconnect remains watch-only.

## Choosing a host name

**Cookies are not isolated by port** ([RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)). Serving Whistle on port 8443 of a host name that already serves another HTTPS site on 443 sends Whistle's Secure session cookie to that other site whenever it is visited. HttpOnly, SameSite and Origin checks do not stop that backend from receiving and replaying the cookie. Share a host name only when every HTTPS service on it is yours to trust.

A dedicated host name avoids this. With Tailscale, a [Tailscale Service](https://tailscale.com/docs/features/tailscale-services) gives Whistle its own name, but needs admin approval and a tag-based host identity.

## Checks

- Unit and process tests cover invalid configuration, the loopback restriction, forwarding-header spoofing, QR origins, Secure cookies and their deletion, CSRF rejection, direct-HTTP compatibility and PC CLI administration.
- Browser tests check that Chromium reports no manifest or installability errors, that worker updates keep active control without a reload, that CacheStorage and IndexedDB stay empty, and that navigation, assets and API requests fail offline.
- The packaged executable serves the exact icon, manifest and worker bytes outside the checkout.
- The [VM matrix](../vm_tests/README.md) runs HTTPS/WSS, Android-emulated installability, reboots and logins against the native executable on Debian, Ubuntu and Fedora guests, with test-local certificate trust only.

Physical-phone camera scanning, standalone launch, Android keyboards and lifecycle behaviour are checked by hand; browser emulation does not establish those.

## Home-screen shortcuts

Long-pressing the installed icon offers three manifest shortcuts: **Last pane** (`/#open=last`), **Needs you** (`/#open=needs-you`, the first agent asking for input, else one that finished, else the pane list) and **New agent** (`/#open=new-agent`, the New sheet for the last workspace). The fragment is checked against that fixed list and stripped before any request. Panes open **watch-only**, exactly like any other way of opening them. The last pane and workspace are remembered in this browser's `localStorage` only; unknown values are ignored.
