# Host authentication and lifecycle

## Durable pairing

The Bun host stores paired devices in SQLite at `$XDG_STATE_HOME/whistle/devices.sqlite` (default `~/.local/state/whistle/devices.sqlite`). Credentials are 256-bit random values delivered only as HttpOnly, SameSite=Strict cookies; only their SHA-256 hashes enter SQLite. Pairing lasts 90 days, survives host restarts and is not silently renewed forever. Database files are owner-readable/writable, with WAL and full synchronous commits.

The PC access token is an owner-only `access-token` file in the same private state directory. It can issue ephemeral QR tickets and administer devices; it is never placed in a URL or browser storage. QR tickets remain five-minute, single-use and memory-only. Restarting invalidates outstanding QRs, not paired devices.

The first upgrade from the old memory-only process requires pairing once again: that running process cannot export its cookies. Subsequent restarts preserve the new pairings. Development/tests do not silently restart the running host or install its unit.

## CLI and user service

From the checkout, use `bun run whistle <command>`. After installation, the launcher is `~/.local/bin/whistle`; add that directory to PATH yourself if needed. Supported commands:

```text
whistle install [--host IP] [--port PORT] [--herdr-socket PATH] [--now]
whistle start
whistle stop
whistle restart
whistle status
whistle uninstall
whistle serve
whistle pair
whistle devices
whistle revoke DEVICE_ID
```

`install` builds no files implicitly: run `bun install` and `bun run build` first. It captures the selected bind address/port, Herdr socket and resolved Herdr executable in a private config file. Default bind is loopback; phone access needs an explicit existing tailnet IP. Wildcard listeners are rejected. No Tailscale, firewall, gateway, login-shell or lingering changes are performed.

Installation checks the user systemd bus, writes a managed unit and launcher, reloads the manager and enables `whistle.service` at login. **It does not start the service unless `--now` is supplied.** A root/sudo install is rejected. Existing unrelated files and symlinks at the unit/launcher locations are not replaced or removed.

The service runs as the user with `UMask=0077`, restarts on failure and retries if its configured tailnet address is temporarily unavailable. No `PartOf`/stop dependency is attached to Herdr. On stop, Whistle disconnects its streams, flushes `terminal.release` to its own controller CLI children, waits briefly for them, closes SQLite and exits. systemd's control group contains only Whistle and its own terminal CLI children, not the pre-existing Herdr daemon or agents.

`uninstall` disables/stops only Whistle, removes only its managed unit/launcher and reloads the user manager. Configuration and pairings are preserved. There is deliberately no automatic purge, agent shutdown, PID-file kill or logout-lingering enablement.

### Installation / first cutover

```sh
bun install
bun run build
bun run whistle install --host "$(tailscale ip -4)" --port 8790
```

That enables login startup without interrupting the current foreground PoC. When ready, intentionally stop the old Whistle process, **not Herdr**, before starting the new service on its port:

```sh
~/.local/bin/whistle start
~/.local/bin/whistle status
~/.local/bin/whistle pair
```

Scan the new QR once. Later `whistle restart` retains the pairing and reconnects in watch mode. Do not use `--now` on an occupied port. Installation never finds and kills the old process automatically.

For a fresh installation without an existing listener, `install ... --now` enables and starts the unit together. To troubleshoot: `journalctl --user -u whistle.service -n 50 --no-pager`.

### Current packaging limit

This first personal installation is **checkout-based**, not a self-contained binary: the launcher and unit use absolute Bun/source paths and serve `dist/` from that checkout. Keep Bun, dependencies, source and built frontend in place. After updates, run `bun install`, `bun run build`, tests, then `whistle restart`. Re-run install from a moved checkout to update the launcher/unit. A single executable with embedded frontend remains a later packaging increment; do not claim it is shipped.

Multi-Herdr-session discovery also remains separate. The service currently uses one configured socket; installation records it so the host is no longer dependent on the launching pane's current directory or shell lifetime.

## Paths and overrides

| Purpose | Default |
| --- | --- |
| Host config | `~/.config/whistle/config.json` |
| Private state | `~/.local/state/whistle/` |
| Cookie hashes / device metadata | `~/.local/state/whistle/devices.sqlite` |
| PC access token / last URL / QR | `access-token`, `server-url`, `pair.png` in private state |
| User unit | `~/.config/systemd/user/whistle.service` |
| CLI launcher | `~/.local/bin/whistle` |

`XDG_CONFIG_HOME` and `XDG_STATE_HOME` are honored. `WHISTLE_CONFIG_DIR` and `WHISTLE_STATE_DIR` select dedicated absolute Whistle directories. `HOST`, `PORT`, `HERDR_SOCKET_PATH` and `WHISTLE_HERDR_BIN` override saved settings for foreground use. `WHISTLE_TOKEN` is a foreground/test credential override; user-service installation does not embed it in a unit. Normal installed use relies on the private token file.

Static assets are resolved relative to the checkout, never the caller's working directory. Normal state/config paths are outside Git. SQLite, token and QR artifacts are also explicitly ignored as a defense against accidental custom state paths inside a checkout.

The QR CLI can still use the original `.runtime/server-url` and matching token when no new host metadata exists. A default foreground first start may import the old PC token; it cannot import memory-only cookie sessions. Never copy an active SQLite database without its WAL; this cutover starts a new durable store, not a fabricated migration of old in-memory credentials.

## Device API

- `GET /api/devices`: list IDs, names, creation/expiry/last-seen times and which device is current. Requires a paired cookie or PC bearer token. Never returns credential hashes or cookies.
- `DELETE /api/devices/:id`: revoke a device, including the current one. Requires the same authentication plus exact Origin validation. Unknown IDs return 404. Revoking the current browser clears its cookie.
- Login/QR redemption may include a bounded printable `deviceName`. Otherwise the host chooses a platform-based label without persisting the full user-agent header.

`whistle devices` and `whistle revoke <id>` administer these endpoints using the private PC token, including when the operator's phone is lost. Requests use fixed-origin credentials and refuse redirects.

Revocation commits before live streams close. The host releases every controller/observer belonging to that device. It checks validity at WebSocket open, on every message, before queued input executes, and periodically for idle streams. Other devices are not revoked. Already accepted writes cannot be undone; nothing is replayed.

## Checks

Unit/process tests cover restart persistence, hash-only storage, permissions, expiry, throttled last-seen writes, scoped revocation, config precedence, XDG paths, safe quoting and the real systemd unit parser. CLI tests use a fake `systemctl` and temporary home to exercise install, repeat install, explicit start, stop/restart/status, foreign-file refusal, launcher execution, device administration and uninstall with preserved state. They do not install a real service.

Real host process tests restart the HTTP server and verify cookie survival, expired QR rejection and durable revocation. A fake Herdr executable and isolated Unix socket verify that both revocation and host shutdown release controllers while its fake daemon remains running. No real pane is typed into. Browser regressions remain isolated from the user's running server. Actual login/autostart and physical-phone restart/handoff still need operator validation after cutover.
