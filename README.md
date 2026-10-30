# Whistle

Keep up with your coding agents from your phone.

Whistle is a phone remote for the agents you already run in [Herdr](https://github.com/herdrdev/herdr) on your PC. See which agent needs you, open its pane, and answer it in the real terminal. You can also start new agents and worktrees, get alerts, review changes, and read back through the terminal history. Whistle runs on your own computer and reaches your phone over your private [Tailscale](https://tailscale.com) network. There is no cloud service and no account, and Whistle makes no model calls of its own.

**[Website](https://noamcohen48.github.io/whistle/)** · **[Download](https://github.com/NoamCohen48/whistle/releases/latest)** · **[Changelog](CHANGELOG.md)**

## What you need

- A Linux PC with systemd, on x86-64 or ARM64.
- [Herdr](https://github.com/herdrdev/herdr) running your agents and terminals.
- [Tailscale](https://tailscale.com) on the PC and on your phone. Any private network you trust works, but the examples use Tailscale.
- A current phone browser. Whistle is built and tested mostly with Chrome on Android.

## Install

### One command

```sh
curl -fsSL https://github.com/NoamCohen48/whistle/releases/latest/download/install.sh | sh
```

The script downloads the build for your processor and checks it against the release checksums. It then installs Whistle for your user and starts it on your Tailscale address. It never uses root. Run it again later to upgrade.

### Packages

Download from the [latest release](https://github.com/NoamCohen48/whistle/releases/latest). ARM64 builds use `arm64` or `aarch64` in place of `amd64` or `x86_64`.

| System | Install |
| --- | --- |
| Debian, Ubuntu | `sudo apt install ./whistle_amd64.deb` |
| Fedora, openSUSE | `sudo dnf install ./whistle.x86_64.rpm` |
| Arch Linux | `sudo pacman -U ./whistle-x86_64.pkg.tar.zst` |
| Any Linux | `whistle-linux-x64.tar.gz` (archive), or `whistle-linux-x64` (single file) |

Then start the service once, as your regular user:

```sh
whistle install --host "$(tailscale ip -4)" --now
```

With the archive or the single file, run that same command with the downloaded program, for example `./whistle-linux-x64 install --host "$(tailscale ip -4)" --now`. Whistle copies itself into `~/.local/share/whistle/` and puts a `whistle` command in `~/.local/bin`, so you can delete the download afterwards.

Every release lists SHA-256 checksums in `SHA256SUMS` and carries GitHub build provenance. Check a download with:

```sh
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify whistle_amd64.deb --repo NoamCohen48/whistle
```

### From source

You need [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/NoamCohen48/whistle.git
cd whistle
bun install
bun run package                    # builds dist/whistle for this PC
./dist/whistle install --host "$(tailscale ip -4)" --now
```

## Pair your phone

```sh
whistle pair
```

Scan the QR code with your phone's camera while Tailscale is on. Whistle opens and pairs, with no password to type. Each code works once and expires after five minutes. Treat it like a key to your shell, and don't share it. A pairing lasts 90 days.

## HTTPS with Tailscale Serve

Plain HTTP on your Tailscale address works for watching and typing. Two features need HTTPS: alerts, and installing Whistle as an app on your phone's home screen. Tailscale Serve can provide HTTPS on your tailnet, with Whistle listening only on the PC itself:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8790
whistle install --host 127.0.0.1 --port 8790 --public-origin https://YOUR-PC.YOUR-TAILNET.ts.net:8443
whistle restart
whistle pair
```

Use your PC's name from `tailscale status`. Phones need to pair again after switching from HTTP to HTTPS, because browsers keep cookies separate per address.

Browsers share cookies between ports on the same host name. If another HTTPS site on that host name is not yours to trust, give Whistle its own name instead. See [HTTPS and the installable app](docs/pwa.md). Never expose Whistle with Tailscale Funnel or on the public internet: a paired phone can type into your shell.

## Using Whistle

- **Your herd.** The home screen lists every Herdr pane, grouped by workspace, with linked worktrees nested under their project. Agents waiting on you come first. Filter by status, search, pin panes, or collapse workspaces.
- **Watch first.** Opening a pane only watches it. It never resizes or focuses the terminal on your desktop.
- **Take control** to type into the real terminal. Herdr fits the width to your phone while you control it and restores it when you release. **Keys** opens Esc, Tab, arrows, Ctrl, Alt and Shift, plus any chord, such as `ctrl+shift+p`.
- **Compose** is a local editor for longer prompts, dictation and pictures. While you are in control, **Send** pastes the text and presses Enter. Each pane keeps its own draft, and nothing is sent until you tap Send.
- **History.** Swipe through everything the pane printed, use the drag handle to jump, and tap **Latest** to return to the cursor. **Terminal text** lets you search and copy output.
- **New** starts an agent, a terminal, a workspace in a folder on your PC, or a Git worktree. The ⋯ menu renames, closes, reviews the pane's Git changes, or removes a worktree.
- **Alerts** (with HTTPS) tell you when an agent needs an answer and, if you like, when one finishes. Quiet hours are supported.
- **Reconnects are safe.** After a dropped connection, Whistle comes back in watch mode and never resends input.

## Commands

| Command | What it does |
| --- | --- |
| `whistle install [--host IP] [--port PORT] [--public-origin URL] [--herdr-socket PATH] [--now]` | Save settings and enable the user service at login. `--now` also starts it. |
| `whistle start`, `stop`, `restart`, `status` | Control the service. |
| `whistle pair` | Show a single-use QR code for pairing a phone. |
| `whistle devices` | List paired phones. |
| `whistle revoke DEVICE_ID` | Unpair a phone and close its connections at once. |
| `whistle uninstall` | Remove the service. Settings and pairings are kept. |
| `whistle serve` | Run in the foreground instead of as a service. |
| `whistle version` | Show the version. |

Logs: `journalctl --user -u whistle.service`. Settings are saved in `~/.config/whistle/config.json`, and private state such as pairings and keys in `~/.local/state/whistle/`. See [host details](docs/host.md) for every path and environment variable.

**Upgrade:** run the one-line installer again, or install the new package and run `whistle restart`. Paired phones stay paired.

**Uninstall:** `whistle uninstall`, then remove the package. To delete settings and pairings too, also remove `~/.config/whistle`, `~/.local/state/whistle` and `~/.local/share/whistle`.

## Security

Whistle gives a paired phone the same shell access as your user account. It is built for a private network:

- It refuses to listen on all addresses. Bind it to your Tailscale address, or to `127.0.0.1` behind Tailscale Serve.
- Phones pair with single-use, five-minute QR codes. Only hashes of their credentials are stored, and you can revoke any phone at once.
- Requests from other sites are rejected by exact origin checks, and responses are never cached.
- Whistle does not log terminal contents. Alerts carry only the pane name, and are end-to-end encrypted to your phone.

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Development

```sh
bun install
bun run dev            # the phone app with hot reload; needs a running host (bun start)
bun start              # build the app and run the host from source on 127.0.0.1:8790
bun run pair           # QR code for the source host
```

Checks. None of them touch your real Herdr, service or phone pairings: they use temporary folders and a fake Herdr.

```sh
bun run typecheck
bun test                          # unit and host tests
bunx playwright install chromium  # once
bun run test:e2e                  # browser tests against a fake host
bun run test:site                 # the website
bun run test:package              # the standalone executable
```

`bun run release` builds every download into `dist/release/` (it needs [nfpm](https://nfpm.goreleaser.com)). [Releasing](docs/ci.md) explains CI and how to publish a version. An opt-in test that types into a real, disposable Herdr pane, and a QEMU matrix for Debian, Ubuntu and Fedora, are described in [tests/integration.test.ts](tests/integration.test.ts) and [vm_tests](vm_tests/README.md).

Further reading: [architecture](docs/architecture.md), [design principles](docs/product.md), [frontend](docs/frontend.md), [host](docs/host.md), [HTTPS and the installable app](docs/pwa.md), and [packaging](docs/packaging.md).

## License

[MIT](LICENSE)
