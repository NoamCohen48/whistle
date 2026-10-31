# Standalone executable

## Build and verify

```sh
bun install
bun run package
./dist/whistle --version
bun run test:package
```

The native build produces `dist/whistle` and `dist/whistle.sha256` for the build machine's architecture. `bun run scripts/package.ts --target linux-arm64` (or `linux-x64`) cross-compiles into `dist/<target>/whistle`. Linux x86-64 and ARM64 are the supported targets. A checksum file detects corruption, not an untrusted publisher; releases also carry GitHub build provenance (see [releasing](ci.md)).

The executable embeds Bun, the host/CLI, QR generation, SQLite support and the three fixed Vite assets (`/`, `/app.js`, `/app.css`). Herdr remains an independently installed external program. Build identity includes package version, Git revision/dirty state and platform/architecture; it does not capture host configuration, environment values, devices, credentials or tickets.

Copy the executable anywhere and use `whistle install`, `serve`, `pair`, `devices` or `revoke`. Foreground config/state retain their XDG paths and explicit environment overrides. Startup does not autoload `.env`, `bunfig.toml`, `tsconfig.json` or `package.json` from the current directory. Standalone mode never falls back to checkout `.runtime/` credentials. A fresh machine creates its own state/token; copying an executable does not authorize a phone.

The build first bundles the host and an explicit asset payload, then compiles that bundle. Only the allowlisted frontend files are embedded; no runtime directory or directory glob is included. Assets remain public, non-cached files with the same HTTP security headers. There is no dynamic asset-path filesystem access in standalone mode.

## Verification boundaries

`bun run test:package` builds first and explicitly runs the artifact suite outside ordinary unit-test discovery. It copies the native executable to an unrelated temporary home, supplies a PATH containing neither Bun nor Node, verifies checksum/build identity, compares all served frontend bytes, checks authentication and real PNG generation, and restarts the binary with a persistent paired cookie. A hostile current-directory `.env` and Bun preload are not loaded.

On Linux with bubblewrap, an additional private-mount-namespace check hides the entire checkout (including `node_modules`) and masks the system Bun executable. Only the temporary home is writable; `/dev` and `/proc` are mounted for the native runtime. The binary still serves the embedded app and authenticates normally. This check does not move or hide files from your session.

The artifact suite also checks native installation using a fake user manager, validates the actual generated unit with systemd's parser, removes the original download, executes the installed launcher, repeats installation from the installed executable, exercises lifecycle commands, and uninstalls without purging state/releases. A source-to-binary process transition preserves an already-issued cookie and device ID. Paths deliberately include spaces, apostrophes, dollar signs and percent signs.

## Release downloads

`bun run release` builds both architectures and turns them into `dist/release/`: raw executables, tarballs, `.deb`, `.rpm` and Arch packages (with [nfpm](https://nfpm.goreleaser.com), from `packaging/nfpm.yaml`), the `install.sh` one-line installer and `SHA256SUMS`, plus the AUR files in `dist/aur/` (see below). File names carry no version, so `releases/latest/download/<name>` links stay valid. Archive and package timestamps come from the last commit, so rebuilding the same commit gives the same archives.

Packages install `/usr/bin/whistle` and print how to start the service; they never start or restart a service themselves, because Whistle runs per user. A package-managed executable (anything under `/usr/` or `/opt/`) runs in place: its launcher points at `/usr/bin/whistle`, so after a package upgrade `whistle restart` runs the new version. Downloaded executables are copied into private releases, as below.

## AUR

Whistle is not published to the AUR yet: the release workflow's `aur` job is turned off with `if: false`. The files are still generated with every release, and everything below applies once that line is removed.

The AUR package is `whistle-herdr-bin` (`whistle` on the AUR is an unrelated program). It installs the released executable, checked against the release's SHA-256 sums, as `/usr/bin/whistle`, like the Arch package from nfpm, and conflicts with it. `scripts/aur.ts` writes its `PKGBUILD` and `.SRCINFO` from `SHA256SUMS`; `bun run release` puts them in `dist/aur/`. After publishing a release, the release workflow builds and installs that package on Arch Linux from the published downloads, then pushes it to the AUR if the `AUR_SSH_KEY` secret holds the private key of the AUR account that maintains it. Without the secret, the check still runs and the push is skipped with a notice. The AUR's host key is checked against its published fingerprint.

To regenerate the files for a published release by hand:

```sh
curl -fsSLO https://github.com/NoamCohen48/whistle/releases/download/v0.2.0/SHA256SUMS
bun run scripts/aur.ts 0.2.0 SHA256SUMS aur/
cd aur && makepkg -si
```

## Nix

`flake.nix` builds Whistle from source for `x86_64-linux` and `aarch64-linux` (`packages.default`, `apps.default` and `overlays.default`), so `nix run github:NoamCohen48/whistle` gives the same standalone executable as the downloads. `packaging/nix/package.nix` installs the locked dependencies for every platform in one fixed-output derivation, patches the native Vite build parts for this machine, runs the Vite build and `scripts/package.ts` with the flake's revision (`WHISTLE_REVISION`, since the build has no Git), and checks `whistle --version`. The executable is never stripped or patched, because the app is appended to Bun.

When `bun.lock` changes, the dependency hash in `package.nix` must change too: the CI job "Build the Nix package" fails and prints the new hash. `nix flake update` moves nixpkgs forward. The flake uses nixpkgs' Bun, which may be newer than the 1.3.11 used for releases.

## Install / upgrade

```sh
./dist/whistle install --host "$(tailscale ip -4)" --port 8790 --now
whistle --version
```

To upgrade, run `install` with the new executable to keep saved settings, then `whistle restart`. Paired devices stay paired; no database migration or credential reset occurs. `--now` starts a stopped service but never restarts a running one.

Installation copies the executable to an owner-only, SHA-256-addressed release directory under `$XDG_DATA_HOME/whistle/releases/`, verifies the copy and publishes it exclusively. A small managed shell launcher selects that immutable release; systemd invokes the launcher via `/bin/sh`, whose `exec` preserves the main PID. This also handles executable paths that systemd cannot accept directly. The original download/checkout can subsequently be removed. Native executables are about 100 MiB because the Bun runtime is included.

Release files are reused only after content verification; symlinks, foreign contents and foreign unit/launcher files are refused. Existing executables are never overwritten in place, including self-installation. Old releases are retained for compatible rollback; uninstall removes the managed unit/launcher, not config, devices or releases. Automatic release garbage collection is deferred.

Building or testing never touches an installed service. See [lifecycle details](host.md).
