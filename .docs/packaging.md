# Standalone executable

## Build and verify

```sh
bun install
bun run package
./dist/whistle --version
bun run test:package
```

The native build produces `dist/whistle` and `dist/whistle.sha256` for the build machine's OS/architecture. This is currently a personal Linux build, not a tested cross-platform release matrix. Verify a copied download with `sha256sum -c whistle.sha256` from its directory; this detects corruption, not an untrusted publisher.

The executable embeds Bun, the host/CLI, QR generation, SQLite support and the three fixed Vite assets (`/`, `/app.js`, `/app.css`). Herdr remains an independently installed external program. Build identity includes package version, Git revision/dirty state and platform/architecture; it does not capture host configuration, environment values, devices, credentials or tickets.

Copy the executable anywhere and use `whistle install`, `serve`, `pair`, `devices` or `revoke`. Foreground config/state retain their XDG paths and explicit environment overrides. Startup does not autoload `.env`, `bunfig.toml`, `tsconfig.json` or `package.json` from the current directory. Standalone mode never falls back to checkout `.runtime/` credentials. A fresh machine creates its own state/token; copying an executable does not authorize a phone.

The build first bundles the host and an explicit asset payload, then compiles that bundle. Only the allowlisted frontend files are embedded; no runtime directory or directory glob is included. Assets remain public, non-cached files with the same HTTP security headers. There is no dynamic asset-path filesystem access in standalone mode.

## Verification boundaries

`bun run test:package` builds first and explicitly runs the artifact suite outside ordinary unit-test discovery. It copies the native executable to an unrelated temporary home, supplies a PATH containing neither Bun nor Node, verifies checksum/build identity, compares all served frontend bytes, checks authentication and real PNG generation, and restarts the binary with a persistent paired cookie. A hostile current-directory `.env` and Bun preload are not loaded.

On Linux with bubblewrap, an additional private-mount-namespace check hides the entire checkout (including `node_modules`) and masks the system Bun executable. Only the temporary home is writable; `/dev` and `/proc` are mounted for the native runtime. The binary still serves the embedded app and authenticates normally. This check does not move or hide files from the operator's session.

The artifact suite also checks native installation using a fake user manager, validates the actual generated unit with systemd's parser, removes the original download, executes the installed launcher, repeats installation from the installed executable, exercises lifecycle commands, and uninstalls without purging state/releases. A source-to-binary process transition preserves an already-issued cookie and device ID. Paths deliberately include spaces, apostrophes, dollar signs and percent signs.

## Install / upgrade

```sh
./dist/whistle install --host "$(tailscale ip -4)" --port 8790
~/.local/bin/whistle start   # fresh host only; do not compete with a listener
~/.local/bin/whistle --version
```

For an existing user daemon, use `./dist/whistle install` to retain saved settings, then explicitly `~/.local/bin/whistle restart`. Do not start a second foreground copy. Existing durable devices remain paired; no database migration or credential reset occurs.

Installation copies the executable to an owner-only, SHA-256-addressed release directory under `$XDG_DATA_HOME/whistle/releases/`, verifies the copy and publishes it exclusively. A small managed shell launcher selects that immutable release; systemd invokes the launcher via `/bin/sh`, whose `exec` preserves the main PID. This also handles executable paths that systemd cannot accept directly. The original download/checkout can subsequently be removed. Native artifacts are about 96 MiB on the verified Linux x64 host because the Bun runtime is included.

Release files are reused only after content verification; symlinks, foreign contents and foreign unit/launcher files are refused. Existing executables are never overwritten in place, including self-installation. Old releases are retained for compatible rollback; uninstall removes the managed unit/launcher, not config, devices or releases. Automatic release garbage collection is deferred.

Building or testing never switches the deployed service. See [lifecycle details](host.md) and [the deployment record](deployment.md).
