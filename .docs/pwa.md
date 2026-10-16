# Installable PWA and private HTTPS

## Install shell

Whistle has a stable manifest ID, scope and launch URL (`/`), standalone display, theme/background color, and real 192/512px PNG icons. The larger icon's glyph fits Android's maskable safe zone. Regenerate/check deterministic assets with `python3 scripts/pwa-icons.py [--check]`.

Production registers `/sw.js` once, outside React's lifecycle, with `updateViaCache: none`. Vite development does not register a worker.

**Online only:** the worker has no fetch handler, runtime cache, IndexedDB, background sync, input queue or credential storage. All shell/assets/API requests use the network; server responses use `Cache-Control: no-store`. WebSockets remain direct. Offline reloads fail rather than presenting a saved terminal or authentication response. Already rendered terminal text can remain in the open page's memory as before; it is not an offline transcript.

The worker never calls `skipWaiting` or `clients.claim`, and nothing automatically reloads the page. A changed worker waits behind controlled pages. A user-initiated navigation loads the current shell. No update takes control, changes PTY geometry or replays input. Browser/OS tab restoration still needs physical-phone validation.

All PWA files use the host's explicit static allowlist and are embedded in the standalone binary. PNGs use base64 only inside the executable metadata and are served as original binary bytes with `image/png`. No filesystem directory or credential file is served.

## Explicit HTTPS proxy mode

A private TLS reverse proxy terminates HTTPS/WSS and forwards to a **loopback-only** Whistle backend. Do not expose this backend or use a public relay/Funnel.

```sh
# Example only: choose/approve the real HTTPS endpoint and proxy separately.
./dist/whistle install --host 127.0.0.1 --port 8790 \
  --public-origin https://your-pc.your-tailnet.ts.net:8443
# Installation does not restart the running daemon.
~/.local/bin/whistle restart
```

`publicOrigin` is saved in the private JSON config. `WHISTLE_PUBLIC_ORIGIN` is its explicit runtime override. It must be a canonical HTTPS origin with no path, trailing slash, query, fragment or credentials. Non-loopback listeners are rejected while proxy mode is configured. To deliberately return to direct HTTP, clear it with `--public-origin ''` when installing and explicitly restore the desired listener.

Configured public origin controls:

- Exact Origin validation for pairing, revocation and WebSocket upgrades.
- Public QR URLs (fragments remain single-use and are removed before app requests).
- `Secure; HttpOnly; SameSite=Strict; Path=/` session cookies, including deletion.

`Forwarded`, `X-Forwarded-Host` and `X-Forwarded-Proto` are **never trusted** to enable HTTPS or choose QR/CSRF origins. Unconfigured direct HTTP retains its existing behavior. The PC CLI connects to the private recorded backend URL but sends the configured public Origin; the PC token is never put in a URL. Keep configuration, proxy and daemon restart coordinated: a newly configured CLI cannot administer an old still-running daemon under a different origin policy.

## Existing devices and cutover

Moving from an IP/HTTP URL to a DNS/HTTPS origin requires **fresh pairing at the new origin**. Browsers do not transfer host-scoped cookies between them. Existing device rows and the PC token are preserved; no old device is automatically revoked. A restart releases active control, and reconnect remains watch-only.

The existing personal machine's Tailscale Serve HTTPS root proxies another service and was preserved. On 2026-10-17 the operator explicitly selected the simpler shared-hostname deployment: **https://noam-pc.tailf888b6.ts.net:8443** → `http://127.0.0.1:8790`. Only that tailnet-only Serve endpoint and the Whistle listener/origin/release were changed; no Funnel, firewall, DNS, node identity, policy or lingering changes were made.

**Separate ports are reasonable for trusted personal apps, but cookies are not port-isolated** ([RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)). Reusing the existing hostname on port 8443 would send Whistle's host-scoped Secure cookie to the existing HTTPS application when that application is visited. HttpOnly/SameSite/Origin checks do not prevent that backend from receiving/replaying it. Only choose this simpler deployment if every HTTPS backend on that hostname is trusted with Whistle's session credential.

A dedicated Tailscale Service hostname avoids this shared-cookie namespace, but [Tailscale Services](https://tailscale.com/docs/features/tailscale-services) requires admin-defined service/host approval and a tag-based host identity. Do not retag the personal PC, alter policy or create service/DNS configuration without separate concrete approval. No dedicated Service or retagging was needed for the approved :8443 deployment.

## Validation status

- 42 unit/process checks pass; the mutating real-Herdr integration stays skipped.
- Six detached-native artifact checks pass, including exact bytes for every icon/manifest/worker outside the checkout.
- 36 browser checks pass across desktop, Android emulation and Vite development (three intentional project-specific skips). Chromium reports no manifest or installability errors for the production fixture.
- Worker-update tests retain active control without reload, leave CacheStorage/IndexedDB empty, and prove navigation/assets/API requests fail offline.
- Explicit-origin tests cover invalid configuration, loopback restriction, forwarding-header spoofing, QR origin, Secure cookies/deletion, CSRF rejection, direct-HTTP compatibility and PC CLI administration.

The [guest HTTPS/WSS/browser matrix](../vm_tests/README.md) passed **17 scenarios per OS across Debian/nftables, Ubuntu/UFW and Fedora/firewalld (51 results)**, including Android-emulated installability against the actual native app, real reboot/login, Secure cookies, WSS and offline/no-storage behavior. All clients use test-local certificate trust; the browser's synthetic-certificate exception is isolated to its temporary process. All 26 fast harness tests and project Pyright checks pass.

Tested/deployed clean native build: `033b1c1`, SHA-256 `72e48b09cd44b916dc9a0734daef3358d44eb219052011b5726731ffbfc0183f`. All guests shut down. After operator approval, installation preserved the old daemon until an explicit Whistle-only restart; the new native daemon is enabled/active with zero crash restarts.

Live verification used normal trusted HTTPS and a fresh Android-emulated browser, with **no certificate-ignore flags**: the actual CLI-generated QR decoded and redeemed once, its fragment disappeared, its Secure cookie/device survived reload, installability passed, WSS remained watch-only, and persistent cache/storage stayed empty. All 14 original pane/terminal identities, watched desktop rows, PC token and pre-existing authorizations were preserved; only independent test devices were revoked. The existing :443 Serve root was unchanged. A fresh private phone QR is available via `~/.local/bin/whistle pair`.

See [live deployment evidence](deployment.md). Physical Android camera scanning, installation/standalone launch, IME and lifecycle remain operator validations; browser emulation does not establish those.
