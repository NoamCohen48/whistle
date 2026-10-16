# Personal daemon deployment

## Current standalone deployment

The existing user daemon was upgraded from source mode to the verified standalone executable on 2026-10-16 with operator approval. The address, socket, configuration and private state paths below are unchanged.

- Build: `Whistle 0.0.1 (b374b65, linux-x64, standalone)`.
- Artifact SHA-256: `69ba2641fbed6ad798ca3a85c057b0ee16731ffc8f706e206d0774be8ecf1921`.
- Executable: `~/.local/share/whistle/releases/<sha256>/whistle`; installed CLI remains `~/.local/bin/whistle`.
- The unit starts the managed launcher via `/bin/sh`; the launcher immediately execs the native binary. No Bun, checkout, `node_modules` or `dist/` is needed at runtime. Herdr remains external.
- The old managed unit/launcher/config were backed up privately. The live SQLite database and access-token file were not copied, replaced or reset.

### Standalone upgrade verification

- TypeScript/LSP checks, **38 unit/process tests, 6 artifact tests and 30 browser checks passed**. The explicitly mutating real-Herdr test remained skipped.
- The native artifact passed with the entire checkout/node_modules hidden and the system Bun executable masked in an isolated mount namespace. Packaging tests also exercised installed execution after removal of the original download and source-to-binary pairing retention.
- A fresh Android-emulated Chromium browser redeemed a real QR **before** the live upgrade and opened a real terminal in watch mode.
- Installing the verified release did not interrupt the original daemon: its PID stayed unchanged until the explicit restart. Saved bind/socket/config and access-token bytes were unchanged.
- After the actual systemd restart, `/proc/<main-pid>/exe` and its SHA-256 confirmed the installed native executable was running, not Bun/source.
- The original browser cookie/device survived the source-to-binary cutover, automatically reconnected in watch mode and survived a full reload with exactly one QR redemption.
- All 14 pre-upgrade pane/terminal identities survived; the watched desktop row count was unchanged. No text, keys, control requests, PTY resizes or history-scroll commands were sent, and no browser script errors occurred.
- Every pre-existing authorization, including the existing Android device, retained its ID, creation and expiry. Only the independent verification device was revoked; the authorized-device set returned to its original state.
- The live embedded frontend bytes matched the verified Vite assets. State remained 0700; config/token/SQLite remained 0600; executable remained 0700. Service was active/enabled with zero automatic crash restarts and successful main-process status.
- A fresh fallback QR was saved privately after verification. No tickets, cookies, terminal content, screenshots or browser storage exports were logged or committed.

No Herdr/agent lifecycle, firewall, Tailscale, shell-profile or lingering settings were changed. Existing durable phones do **not** need a new pairing. Physical-phone IME/lifecycle and actual logout/login startup remain unverified.

## Initial user-daemon cutover

The Linux systemd user service was first installed and cut over on 2026-10-16 with operator approval.

- Service: `whistle.service`, enabled and active under the existing user manager.
- Address: `http://100.68.36.94:8790`, unchanged from the foreground PoC; no wildcard bind.
- Herdr socket: `/home/noamc/.config/herdr/herdr.sock`, unchanged.
- CLI: `~/.local/bin/whistle`.
- Config: `~/.config/whistle/config.json`.
- Private state: `~/.local/state/whistle/`.
- Initial packaging was checkout-based; the standalone upgrade above removed that runtime dependency.

Before stopping the legacy listener, its owner, command, working directory and PID identity were verified. Only that Whistle process received SIGTERM; the Herdr daemon and agent processes were not stopped or signaled.

## Initial cutover checks

- Production build, TypeScript check and 34 unit/process tests passed; the explicitly mutating real-Herdr test remained skipped.
- All 14 original pane/terminal identities were present after cutover and after an actual service restart.
- A temporary paired device authenticated to the new service.
- The real Herdr observe stream delivered a terminal frame; desktop viewport row count was unchanged. No terminal text, keys, control requests or model calls were sent.
- The same cookie and device identity remained valid after `whistle restart` through the actual user manager.
- The temporary verification device was revoked, and its cookie then returned 401. It was not left authorized.
- Service was enabled/active with zero automatic crash restarts and a successful main-process status after verification.
- State directory permissions were 0700; token, SQLite database and config permissions were 0600.

No firewall, Tailscale, shell profile or lingering settings were modified. **Lingering was already enabled before installation and remains enabled.** Consequently the user service may continue running after logout under the account's pre-existing policy; this deployment did not enable that policy.

## Live QR/browser verification

After cutover, the actual daemon-generated PNG was decoded with zbar and opened in a fresh Chromium context emulating a Pixel 7. This was the deployed service and real Herdr inventory, not the isolated browser fixture.

- The decoded QR origin/fragment format was correct; automatic redemption succeeded and the fragment disappeared from browser history/address state.
- The browser received an independent paired-device identity and accessed the real agent list using its HttpOnly cookie.
- Selecting an agent opened watch mode, rendered terminal text in xterm at mobile dimensions, and kept page-level horizontal overflow and desktop row changes absent.
- Following an actual systemd restart, the browser established a new watch connection automatically. A full page reload also returned to watch mode without a pairing screen or second ticket redemption; the device identity was unchanged.
- Client WebSocket traffic was checked: no input, keys, control requests, resizes or history-scroll commands were sent. No browser script errors occurred.
- Revoking only the test device returned that browser to the pairing screen. All pre-existing authorized devices, including the Android pairing already present, were retained.
- No cookies, QR URLs/tickets, terminal text, browser storage exports or terminal screenshots were committed or logged as verification evidence.

This proves the deployed browser flow and restart persistence, not physical-camera scanning, Android IME behavior, lock/unlock or mobile-network handoff.

## Phone pairing and operation

The first upgrade from the original memory-only process required one new pairing. Existing durable pairings survive the standalone upgrade. For a fresh device, generate a QR with:

```sh
~/.local/bin/whistle pair
```

The QR is `~/.local/state/whistle/pair.png`, valid once for five minutes. Do not commit or share it. Normal subsequent service restarts retain the pairing until expiry/revocation.

```sh
~/.local/bin/whistle status
~/.local/bin/whistle restart
~/.local/bin/whistle devices
~/.local/bin/whistle revoke DEVICE_ID
```

The systemd unit is now the source of process lifecycle truth, not the old `.runtime/server.pid`. Physical-phone IME, lock/unlock and network-handoff validation is still needed; browser emulation does not prove it. Actual logout/login startup was not tested by ending the operator's session.
