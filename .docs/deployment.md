# Personal daemon deployment

## Verified cutover

The Linux systemd user service was installed and cut over on 2026-10-16 with operator approval.

- Service: `whistle.service`, enabled and active under the existing user manager.
- Address: `http://100.68.36.94:8790`, unchanged from the foreground PoC; no wildcard bind.
- Herdr socket: `/home/noamc/.config/herdr/herdr.sock`, unchanged.
- CLI: `~/.local/bin/whistle`.
- Config: `~/.config/whistle/config.json`.
- Private state: `~/.local/state/whistle/`.
- Packaging remains checkout-based; keep this checkout, Bun, dependencies and `dist/` available.

Before stopping the legacy listener, its owner, command, working directory and PID identity were verified. Only that Whistle process received SIGTERM; the Herdr daemon and agent processes were not stopped or signaled.

## Checks performed

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

The first upgrade from the old memory-only process needs one new phone pairing. Generate it with:

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

The systemd unit is now the source of process lifecycle truth, not the old `.runtime/server.pid`. Operator confirmation of physical-phone re-pairing, lock/unlock and network handoff is still needed. Actual logout/login startup was not tested by ending the operator's session.
