# CI and releases

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main` and manual runs. It uses a GitHub-hosted Ubuntu 22.04 x64 runner, Bun 1.3.11, Node 24 for Vite and Playwright tooling, Python 3.11 for the VM harness, and the committed lockfile. Third-party actions are pinned to full commit IDs, with comments naming the version.

The job **Validate, test and package**:

1. Installs locked dependencies, Chromium and bubblewrap.
2. Typechecks the app, host, tests and website, and builds the app assets that the host tests serve.
3. Runs the Bun unit and host tests against temporary fake hosts. The opt-in real-pane test stays off.
4. Runs the VM harness unit tests, without starting VMs.
5. Runs every browser project against the fake backend on loopback.
6. Builds the website and tests it at `/` and `/whistle/`, light and dark, desktop and phone.
7. Compiles the standalone executable and runs the packaging and install-isolation tests.

No Herdr, agents, push credentials, Tailscale access or secrets are needed. A nonexistent Herdr socket and `/bin/false` as the Herdr binary make accidental real-Herdr access fail; tests that need Herdr bring their own fake. Browser traces are uploaded only on failure and contain fixture data only.

Pull requests get a read-only token and no publishing rights. There is no `pull_request_target` and no self-hosted runner.

## Releasing

`.github/workflows/release.yml` runs when a version tag is pushed. To release:

1. Set `version` in `package.json`, and add a matching `## X.Y.Z (date)` section to `CHANGELOG.md`. That section becomes the release notes.
2. Commit, merge to `main`, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The workflow then:

1. **Validate:** runs the whole CI job above.
2. **Build:** checks that the tag matches `package.json` and that the changelog has a section for it. It installs a pinned, checksum-verified [nfpm](https://nfpm.goreleaser.com) and runs `bun run release` (x86-64 and ARM64).
3. **Check packages:** installs each package in a clean container and runs `whistle --version`: `.deb` on Debian and Ubuntu, `.rpm` on Fedora, the archive on Debian, all on both architectures (ARM64 through QEMU), plus the Arch package on Arch Linux x86-64. It also verifies `SHA256SUMS` and the installer script's syntax.
4. **Publish:** records [build provenance](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) for every file and creates the GitHub Release with all downloads. Versions with a hyphen, such as `0.2.0-rc.1`, are marked as pre-releases.
5. **Website:** builds `site/` with this release's version and repository, and deploys it to GitHub Pages.

Only the publish job can write to the repository, and only the Pages job can deploy the site. Each job checks out code without persisting credentials.

### Download names

Release files have no version in their names, so `https://github.com/OWNER/REPO/releases/latest/download/NAME` always points at the newest release:

| File | Contents |
| --- | --- |
| `install.sh` | One-line installer, pinned to its release's version |
| `whistle-linux-x64`, `whistle-linux-arm64` | Single executable |
| `whistle-linux-x64.tar.gz`, `whistle-linux-arm64.tar.gz` | Executable, README and LICENSE |
| `whistle_amd64.deb`, `whistle_arm64.deb` | Debian and Ubuntu |
| `whistle.x86_64.rpm`, `whistle.aarch64.rpm` | Fedora and openSUSE |
| `whistle-x86_64.pkg.tar.zst`, `whistle-aarch64.pkg.tar.zst` | Arch Linux (and Arch Linux ARM) |
| `SHA256SUMS` | Checksums of every file above |

The website links to these names, and fills in the repository at build time. A fork's release workflow therefore publishes a site that points at the fork's own releases.

## One-time GitHub setup

1. **Repository visibility.** Release downloads, the install script and the website must be public for other people to use them. Making the repository public also publishes its full history.
2. **Pages.** In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. **Environment.** Limit the `github-pages` environment to tags matching `v*`. Add a required reviewer if you want to approve each release.
4. **Rulesets.** Require the **Validate, test and package** check on `main`. Optionally protect `v*` tags so only maintainers can create them.
5. **Security reporting.** Turn on private vulnerability reporting (**Settings → Security**). [SECURITY.md](../SECURITY.md) points reporters there.

## Building downloads locally

```sh
bun install
NFPM=/path/to/nfpm bun run release
ls dist/release
```

`bun run release` builds the app, cross-compiles both architectures, and writes everything into `dist/release/`. Only executables for the machine's own architecture can be run locally. To try a package, install it in a container, for example:

```sh
docker run --rm -v "$PWD/dist/release:/r:ro" debian:stable-slim \
  sh -c 'apt-get update -qq && apt-get install -y -qq /r/whistle_amd64.deb && whistle --version'
```
