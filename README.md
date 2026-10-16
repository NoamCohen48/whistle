# Whistle

A terminal-first phone remote for **existing Herdr panes**. No replacement agent harness or additional model calls from the app itself.

React + Vite + TypeScript frontend, an isolated xterm.js terminal engine, and a Bun host. Styling is deliberately baseline. Pairing is durable and revocable; a Linux user-service CLI handles login startup and restarts. See [host authentication and installation](.docs/host.md).

Product decisions: [`.docs/product.md`](.docs/product.md). Production direction: [`.docs/architecture.md`](.docs/architecture.md). Frontend boundaries and development: [`.docs/frontend.md`](.docs/frontend.md). Original PoC verification and remaining limitations: [`.docs/poc.md`](.docs/poc.md).

## Run from source

Requires Bun and Herdr 0.9.3-compatible terminal-session commands. Start from inside the Herdr session you want to access (or explicitly set `HERDR_SOCKET_PATH`).

```sh
bun install
bun start
```

Open `http://127.0.0.1:8790` on the PC for local-only testing. Manual token entry is available under **Use an access token instead** on the pair screen.

For your phone, bind **only** to the PC's existing Tailscale IPv4 address:

```sh
HOST="$(tailscale ip -4)" PORT=8790 bun start
```

With the server running, open another PC terminal in this folder:

```sh
bun run pair
```

Scan the QR with your phone's camera (Tailscale enabled). It opens Whistle and pairs automatically, with no token to copy. The QR is also saved as `pair.png` in Whistle’s private state directory (default `~/.local/state/whistle/`). It expires in five minutes, works once, and creating another QR invalidates the previous one. Treat the displayed QR as a temporary shell-access credential; do not share it.

This does not reconfigure Tailscale, Collie, or any gateway. Do not expose the app publicly: a paired browser has your user's shell access.

## Background service

The personal host has been cut over to the enabled user daemon; see [deployment verification](.docs/deployment.md). The instructions below describe a fresh installation—do not start a second foreground listener on the occupied port.

Build first, then install the user service without interrupting an existing server:

```sh
bun run package
./dist/whistle install --host "$(tailscale ip -4)" --port 8790
```

Installation enables startup at login but does **not** start immediately. After intentionally stopping the old Whistle process (not Herdr), run:

```sh
~/.local/bin/whistle start
~/.local/bin/whistle pair
~/.local/bin/whistle status
```

Durable pairings survive source-to-binary upgrades and subsequent restarts. Only the original memory-only PoC needs one fresh pairing. `whistle devices` lists paired devices; `whistle revoke <id>` revokes one and releases its live streams. `whistle stop`, `restart` and `uninstall` manage only Whistle. Uninstall preserves configuration and devices. No firewall rules or lingering are changed.

The standalone executable embeds Bun and the React app. Installation copies it into private, content-addressed releases; the service no longer needs this checkout, `node_modules` or `dist/`. Herdr remains external. See [packaging and artifact checks](.docs/packaging.md) and [lifecycle, paths and upgrades](.docs/host.md). Building/testing installs no real service.

To update an existing user daemon: verify the new binary, run `./dist/whistle install`, then `~/.local/bin/whistle restart`. Installation alone does not interrupt it; saved settings and devices remain in place.

## Use

1. Pick an existing pane. It opens in **watch** mode without resizing/focusing the desktop.
2. Tap **Take control**, then **Type** to type directly into the real terminal. Herdr fits the width while keeping a taller PTY, so fixed TUI widgets cannot consume all the chat space. Scroll to read; **Input** returns to the actual cursor.
3. **Keys** opens modifiers, special keys and the full key pad above the one-row toolbar. Arm **Ctrl / Alt / Shift** for the next key; combine them as needed, or enter a custom chord (e.g. `ctrl+shift+p`). Unsupported keys show an error. Ctrl+D can exit an empty shell; it is a real terminal key.
4. **Compose** is a separate local editor. Choose **Paste** or **Paste + Enter**. Multiline paste is refused when bracketed paste is unavailable.
5. **Width: fit/original** switches between phone width and horizontal panning.
6. **Release control**, leave the page, or lock the phone to release sizing. Reconnection is watch-only; input is never automatically resent.
7. Switch directly using the **top agent strip**. It includes idle/running agents, keeps local drafts and returns to watch mode on switches.
8. The dashboard nests linked worktrees under their parent workspace (e.g. **tap → app-explorer · Worktree**).

The temporary `whistle-poc-test` pane was closed after testing. The requested Spark model returned an account/provider unsupported-model error; see `.docs/poc.md`. Android IME behavior still needs physical-device testing.

## Installable web app

The production build includes an online-only PWA manifest, icons and install support. Phone installation requires private HTTPS; the existing HTTP/IP URL is not installable. See [PWA safety, explicit proxy origins and cutover notes](.docs/pwa.md). HTTPS deployment and real-phone installation are not yet verified; existing Tailscale Serve routing is unchanged.

## Checks

```sh
bun run typecheck
bun test
bun run build
bunx playwright install chromium # once
bun run test:e2e
bun run test:package
```

For real systemd and firewall testing, see the [reproducible QEMU VM matrix](vm_tests/README.md): Debian/nftables, Ubuntu/UFW and Fedora/firewalld. It runs disposable guests serially, with fake Herdr and loopback-only forwarding; it never installs a host service or changes the host firewall. VM runs require explicit opt-in (`bun run test:vm --all`); fast harness checks use `bun run test:vm:unit`.

The browser suite uses an isolated fake backend, not your Herdr panes. It covers built desktop/Android-emulated Chromium and Vite development with React Strict Mode. Physical-phone IME and lifecycle testing is still needed.

For frontend development, keep the Bun host running and use `bun run dev` in another terminal. If the host is tailnet-bound, set `WHISTLE_API_URL=http://<pc-tailnet-ip>:8790 bun run dev`. The development server binds only to loopback; phone use still goes through the Bun host.

The integration test is opt-in because it **executes shell commands in the chosen pane**. Use only a disposable shell, never an agent or the pane running your current work:

```sh
POC_TEST_PANE='<disposable-pane-id>' bun test
# Set POC_TEST_URL=http://<tailnet-ip>:8790 when not running on loopback.
```

Stop a foreground server with Ctrl+C; stop an installed daemon with `whistle stop`. Configuration defaults to `~/.config/whistle/config.json`; credentials/devices default to `~/.local/state/whistle/`, independent of checkout updates. Source mode retains `.runtime/` only for legacy-host pairing fallback; standalone mode never reads it. Tokens, QR images, SQLite files, logs, browser artifacts, dependencies and builds are Git-ignored.
