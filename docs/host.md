# Host authentication and lifecycle

## Durable pairing

The Bun host stores paired devices in SQLite at `$XDG_STATE_HOME/whistle/devices.sqlite` (default `~/.local/state/whistle/devices.sqlite`). Credentials are 256-bit random values delivered only as HttpOnly, SameSite=Strict cookies; only their SHA-256 hashes enter SQLite. Pairing lasts 90 days, survives host restarts and is not silently renewed forever. Database files are owner-readable/writable, with WAL and full synchronous commits.

The PC access token is an owner-only `access-token` file in the same private state directory. It can issue ephemeral QR tickets and administer devices; it is never placed in a URL or browser storage. QR tickets remain five-minute, single-use and memory-only. Restarting invalidates outstanding QRs, not paired devices.

Development and tests never restart a running host or install its unit.

## CLI and user service

Use the installed `whistle` command, a downloaded executable (`./whistle-linux-x64 <command>`), or build one with `bun run package` when working from source. After `whistle install`, the launcher is `~/.local/bin/whistle`; add that directory to PATH if needed. `bun run whistle <command>` remains available for source-mode development. Supported commands:

```text
whistle install [--host IP] [--port PORT] [--herdr-socket PATH] [--public-origin HTTPS_ORIGIN] [--now]
whistle start
whistle stop
whistle restart
whistle status
whistle uninstall
whistle serve
whistle pair
whistle devices
whistle revoke DEVICE_ID
whistle version
```

`install` builds no files implicitly. The standalone executable already contains its frontend and runtime; source-mode installation requires `bun install` and `bun run build` first. It captures the selected bind address/port, Herdr socket and resolved Herdr executable in a private config file. Default bind is loopback; phone access needs an explicit existing tailnet IP. Wildcard listeners are rejected. No Tailscale, firewall, gateway, login-shell or lingering changes are performed.

Installation checks the user systemd bus, writes a managed unit and launcher, reloads the manager and enables `whistle.service` at login. **It does not start/restart the service unless `--now` requests a start.** Even `--now` does not restart an already-running service; apply upgrades with an explicit `whistle restart`. A root/sudo install is rejected. Existing unrelated files and symlinks at the unit/launcher locations are not replaced or removed.

The service runs as the user with `UMask=0077`, restarts on failure and retries if its configured tailnet address is temporarily unavailable. No `PartOf`/stop dependency is attached to Herdr. On stop, Whistle disconnects its streams, flushes `terminal.release` to its own controller CLI children, waits briefly for them, closes SQLite and exits. systemd's control group contains only Whistle and its own terminal CLI children, not the pre-existing Herdr daemon or agents.

`uninstall` disables/stops only Whistle, removes only its managed unit/launcher and reloads the user manager. Configuration, pairings and executable releases are preserved. There is deliberately no automatic purge, agent shutdown, PID-file kill or logout-lingering enablement.

### Installation

```sh
whistle install --host "$(tailscale ip -4)" --now
whistle status
whistle pair
```

Scan the QR once. Later `whistle restart` keeps the pairing and reconnects phones in watch mode. If another process already listens on the port, stop it first: installation never finds or kills other processes. To troubleshoot: `journalctl --user -u whistle.service -n 50 --no-pager`.

### Standalone installation and upgrades

The binary installer verifies and publishes its executable at `$XDG_DATA_HOME/whistle/releases/<sha256>/whistle` (default `~/.local/share/whistle/releases/`). Existing releases are never overwritten; partial copies are not published. It then atomically replaces its managed launcher/unit files, reloads systemd and enables login startup. Marker-based ownership checks also recognize the old checkout installation, but refuse unrelated files and symlinks.

The unit invokes `/bin/sh` with the managed launcher as a literal argument; the launcher immediately `exec`s the selected native executable. This avoids systemd's prohibition on dollar signs in executable paths and retains one main process. Bun, the checkout, dependencies and built frontend are no longer runtime dependencies. The OS shell, Linux/systemd for lifecycle management, and the separately installed Herdr executable remain prerequisites.

To upgrade, verify the new executable, run `./whistle install` (saved settings are kept), then `whistle restart`. No new pairing is needed. Installation does not stop the current process or touch the pairing database or token. Old releases remain for manual rollback and are not garbage-collected automatically (about 100 MiB each). Do not delete the release the launcher points at.

A package-managed executable under `/usr/` or `/opt/` is not copied: the launcher runs it in place, so a package upgrade followed by `whistle restart` runs the new version.

An explicit `bun run whistle install` still creates a source-mode installation requiring its checkout and Bun; use the native binary for standalone upgrades. See [build and artifact verification](packaging.md).

Multi-Herdr-session discovery also remains separate. The service currently uses one configured socket; installation records it so the host is no longer dependent on the launching pane's current directory or shell lifetime.

## Paths and overrides

| Purpose | Default |
| --- | --- |
| Host config | `~/.config/whistle/config.json` |
| Private state | `~/.local/state/whistle/` |
| Cookie hashes / device metadata | `~/.local/state/whistle/devices.sqlite` |
| Alert key / subscriptions | `push-vapid.json`, `push.sqlite` in private state |
| Attached pictures (kept 3 days) | `uploads/` in private state |
| PC access token / last URL / QR | `access-token`, `server-url`, `pair.png` in private state |
| User unit | `~/.config/systemd/user/whistle.service` |
| CLI launcher | `~/.local/bin/whistle` |
| Native releases | `~/.local/share/whistle/releases/<sha256>/whistle` |

`XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_DATA_HOME` are honored. `WHISTLE_CONFIG_DIR` and `WHISTLE_STATE_DIR` select dedicated absolute Whistle directories. `HOST`, `PORT`, `HERDR_SOCKET_PATH` and `WHISTLE_HERDR_BIN` override saved settings for foreground use. `WHISTLE_TOKEN` is a foreground/test credential override; user-service installation does not embed it in a unit. Normal installed use relies on the private token file.

Standalone assets are embedded; source-mode assets are resolved relative to the checkout, never the caller's working directory. Normal state/config paths are outside Git. SQLite, token and QR artifacts are also explicitly ignored as a defense against accidental custom state paths inside a checkout.

Only the source-mode QR CLI can still use the original `.runtime/server-url` and matching token when no new host metadata exists. A source-mode default foreground first start may import the old PC token; it cannot import memory-only cookie sessions. Never copy an active SQLite database without its WAL; this cutover starts a new durable store, not a fabricated migration of old in-memory credentials.

## Device API

- `GET /api/devices`: list IDs, names, creation/expiry/last-seen times and which device is current. Requires a paired cookie or PC bearer token. Never returns credential hashes or cookies.
- `DELETE /api/devices/:id`: revoke a device, including the current one. Requires the same authentication plus exact Origin validation. Unknown IDs return 404. Revoking the current browser clears its cookie.
- Login/QR redemption may include a bounded printable `deviceName`. Otherwise the host chooses a platform-based label without persisting the full user-agent header.

`whistle devices` and `whistle revoke <id>` administer these endpoints using the private PC token, including when your phone is lost. Requests use fixed-origin credentials and refuse redirects.

The PC access token (the `whistle` command, and logging in with the token) is checked in constant time. Ten wrong tokens from one address within a minute pause token checks from that address for a minute, and the host logs it. Behind Tailscale Serve every request comes from the proxy's loopback address, so a pause applies to everyone using the token; pairing with a QR code does not use the token and keeps working.

Revocation commits before live streams close. The host releases every controller/observer belonging to that device. It checks validity at WebSocket open, on every message, before queued input executes, and periodically for idle streams. Other devices are not revoked. Already accepted writes cannot be undone; nothing is replayed.

## Errors

A refused request answers with a status and a plain-text message meant for the phone: 400 for malformed input, 401 to pair first, 403 for a foreign Origin, 404 for a pane, folder or file that no longer exists, 409 for a conflict (a pane already controlled, a worktree with uncommitted files), 413/415 for pictures, 422 when Herdr or Git refuses, 429 while token checks are paused, and 503 when Herdr is not reachable. Anything unexpected answers 500 with a generic message, and the details, which can include local paths, go only to the host's log.

## Pane and worktree API

Paired-cookie only (the PC token is not accepted). `src/actions.ts` reduces each request to fixed, validated fields; the browser never supplies commands, agent arguments or environment variables.

- `POST /api/actions` (exact Origin required) with `type`:
  - `terminal` (`workspaceId`) → `tab.create`.
  - `agent` (`workspaceId`, `kind`) → `tab.create`, then `agent.start` (30 s readiness wait). If the agent fails to start, the new shell is kept and a warning is returned.
  - `workspace` (`cwd`: absolute or `~/…`, optional `label`) → `workspace.create`.
  - `worktree-create` (`workspaceId`, `branch`, optional `base`; conservative ref names only) / `worktree-open` (`workspaceId`, `path`).
  - `close-pane` (`paneId`) → `pane.close`.
  - `remove-worktree` (`workspaceId`) → `worktree.remove` with `force: false`, refused for anything that is not a linked worktree.
  - `rename-pane` (`paneId`, optional `label`) → `pane.rename`; an empty label clears it so Herdr shows the terminal title.
  - `rename-workspace` (`workspaceId`, non-empty `label`) → `workspace.rename`. Herdr itself accepts an empty workspace label, so the host refuses one.
  Every create call passes `focus: false`, so the desktop's focused pane does not change. The response carries the new `paneId`, which the phone opens watch-only.
- `GET /api/agents`: agent kinds from Herdr's detection manifests whose executable is on the service `PATH` (plus `~/.local/bin`, `~/.bun/bin`); all kinds if none are found.
- `GET /api/worktrees?workspace=ID`: linked, non-bare, non-prunable worktrees of that repository, with the pane to go to when one is already open.
- `GET /api/folders?path=~/…` → `{path, folders: [{name, repo}], truncated}`: the folder names at an absolute or `~/` path, for picking a new workspace's folder. Read-only and home-only: the real path (after symlinks) must be inside the home folder, hidden folders and files are never listed, links count only when they lead to a folder inside home, and at most 400 names return. `repo` means the folder holds a `.git`. Errors: 400 bad path, 403 outside home or unreadable, 404 missing.
- `GET /api/changes?pane=ID` → `{root, branch, files, truncated}`: what the pane's working tree changed against `HEAD` (staged and unstaged, renames, plus untracked files that are not ignored), up to 300 files. `GET /api/changes/file?pane=ID&path=…` → `{diff, binary, truncated}` for one listed file, capped at 256 KB. The folder is the pane's `cwd` as Herdr reports it, never a browser-supplied path, and a path must be in the current change list, so this cannot read other files; untracked files are read only if they are regular files inside the repository (no symlinks out). `src/changes.ts` only runs read-only git commands with `GIT_OPTIONAL_LOCKS=0`, `core.fsmonitor=false`, `--no-ext-diff` and `--no-textconv`.
- `GET /api/picture?pane=ID&path=…` returns a PNG, JPEG, WebP or GIF (by its bytes, at most 15 MB) so the phone can show pictures an agent made. A relative path resolves against the pane's `cwd`. After resolving symlinks, the file must be inside the pane's repository root (or the pane folder outside Git), so a pane opened in a project cannot reach pictures elsewhere on the PC. A pane opened in a broad folder such as `~` allows pictures anywhere under it. SVG is never served.

Phone-side close and removal are behind a confirm step. Removal is never forced (`force: false`): Herdr refuses a checkout with modified or untracked files (`dirty_worktree_requires_force`, shown as a plain message). A successful removal closes the worktree's workspace and panes and deletes the checkout; the branch is kept. Herdr reports a repository's Git metadata only once it has worktrees, so the phone offers every main workspace as a repository and reports non-Git ones (`not_git_worktree`) on submit.

## Needs-you alerts

`src/webpush.ts` implements standard Web Push (RFC 8030 delivery, RFC 8291 `aes128gcm` encryption, RFC 8292 VAPID) with Node crypto; there is no extra dependency or third-party relay.

- **Keys and state:** the VAPID P-256 key is created once in `push-vapid.json` and subscriptions live in `push.sqlite`, both `0600` in the state directory. The VAPID subject is the configured public origin. One subscription per paired device; revoking a device or its expiry removes it, and a push service answering 404/410 removes it too.
- **Endpoints** (paired cookie; writes need the exact Origin): `GET /api/push` → `{publicKey, subscribed}`; `PUT /api/push` stores the browser subscription; `DELETE /api/push` removes it; `PUT /api/push/settings` stores this device's settings (`{finished, quiet?: {start, end, timeZone}}`, 409 before subscribing); `POST /api/push/test` sends "Alerts are on" and reports a delivery failure as 502.
- **Allowed push services only:** subscription endpoints must be HTTPS on the browser vendors' push hosts (Google FCM, Mozilla, Microsoft WNS, Apple), with no port or credentials, and the keys must be well formed. The PC therefore never sends requests to arbitrary tailnet or local addresses on a browser's say-so.
- **When alerts fire:** while at least one device is subscribed, the host polls `session.snapshot` every 3 s. An alert is sent when an agent pane *changes* into Herdr's `blocked` ("needs you") or `done` ("finished") status. Panes already waiting when polling starts, panes that appear already waiting and shells never alert, and a wait alerts once. A device that has that pane open in Whistle is skipped; a hidden or locked phone has no open stream, so it is alerted.
- **Per-device settings:** kept with the subscription in `push.sqlite` (a re-subscription keeps them; older databases gain the column on start). `finished: false` drops "finished" alerts. Quiet hours (`HH:MM` range, may wrap past midnight, evaluated in the phone's IANA time zone) still send alerts but mark them `quiet`, and the worker shows them with `silent: true`.
- **What leaves the PC:** the payload is `{title, body, paneId, quiet?}` (pane name, workspace, agent kind). It is encrypted for the phone, so the vendor's push service sees only ciphertext, the endpoint, size and timing. No terminal content is ever sent. The PC needs outbound HTTPS to the push service; delivery is best effort (`TTL` one hour, `Urgency: high`, one `Topic` per pane so undelivered alerts collapse).

## Attached pictures

`POST /api/uploads` (paired cookie, exact Origin) stores one picture for an agent to read and returns `{path}`; the phone puts that path in the draft and nothing is typed into a terminal until the person sends the draft. `src/uploads.ts` checks the bytes against the declared type (PNG, JPEG, WebP or GIF only; no SVG), caps it at 10 MB and writes it under a generated name as `0600` in `uploads/` (`0700`). The minute sweeper deletes Whistle-named pictures older than three days and leaves anything else in the folder alone.

Request bodies: the server's limit is 10 MB for this route only. Every other route refuses a declared body over 4 KB, and any chunked body, with 413 before reading it, so pairing, login and actions keep their old limit. An agent outside its project folder may ask permission before reading a picture.

## Source layout

- `cli.ts` is the `whistle` command; `service.ts`, `releases.ts` and `config.ts` install and configure the user service. `host-client.ts` and `pair-command.ts` are how the command talks to the running host.
- `server.ts` starts the host and wires the parts together. `routes.ts` is the HTTP API: one table where every route declares who may call it and whether it needs a same-origin request. `http.ts` holds response, cookie and error helpers, and `auth.ts` the access-token check.
- `terminal-socket.ts` is the live terminal connection: watch and control, the serial input lane, and closing on revocation or shutdown.
- `herdr.ts` talks to Herdr. `actions.ts`, `previews.ts`, `folders.ts`, `pictures.ts`, `changes.ts` and `uploads.ts` each serve one feature.
- `devices.ts` and `pairing-tickets.ts` are pairing; `token.ts` the PC access token. `alerts.ts` decides when to alert, `webpush.ts` delivers, and `push-store.ts` stores subscriptions. Both stores open their databases through `database.ts`.
- `../shared/` holds the terminal WebSocket protocol and key-chord rules, used by both the host and the phone app.

## Checks

Unit/process tests cover restart persistence, hash-only storage, permissions, expiry, throttled last-seen writes, scoped revocation, config precedence, XDG paths, safe quoting and the real systemd unit parser. CLI tests use a fake `systemctl` and temporary home to exercise install, repeat install, explicit start, stop/restart/status, foreign-file refusal, launcher execution, device administration and uninstall with preserved state. They do not install a real service. The separate artifact suite tests the copied native binary, hidden-checkout operation, real systemd parsing with unusual paths, repeat/self-installation, removal of the original download, and source-to-binary cookie/device retention. Release unit tests cover private permissions, concurrent publication and foreign-file/symlink refusal.

Real host process tests restart the HTTP server and verify cookie survival, expired QR rejection and durable revocation. A fake Herdr executable and isolated Unix socket verify that both revocation and host shutdown release controllers while its fake daemon remains running. No real pane is typed into. Browser tests use a separate fake host and never touch a running Whistle.
