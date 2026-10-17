# CI, build artifacts and GitHub Pages

## What runs

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatches. It uses a GitHub-hosted Ubuntu 22.04 x64 runner, Bun 1.3.11, Node 24 for Vite/Playwright tooling, Python 3.11 for the VM harness, and the committed lockfile. Python is explicitly configured because Ubuntu 22.04's system Python 3.10 lacks `hashlib.file_digest`. Third-party actions are pinned to full commit IDs (version comments identify the intended update stream).

The required job is **Validate, test and package**:

1. Install locked dependencies and Chromium with its OS dependencies.
2. Typecheck the app, host, tests and site configuration, then build private app assets for the temporary host fixtures.
3. Run Bun unit/API tests against temporary fake hosts. The opt-in real-pane test stays disabled.
4. Run Python VM-harness unit tests, without starting VMs.
5. Build the private app and run all browser projects against the isolated fake backend on loopback.
6. Build and smoke-test the public site at both `/` and `/whistle/`, in light/dark modes and desktop/emulated-phone layouts.
7. Compile the standalone Linux executable and run packaging/install-isolation tests.

No Herdr installation, agents, real push credentials, Tailscale access, PC secrets, or SSH deploy keys are needed. A deliberately nonexistent Herdr socket and `/bin/false` binary prevent accidental real-Herdr access; tests that need Herdr provide their own explicit fake binary/socket. Browser traces are uploaded only on failure and contain fixture data only (seven-day retention).

The runner creates a private `XDG_RUNTIME_DIR` for offline `systemd-analyze --user verify`; it does not start or modify a user daemon. Bubblewrap enables the optional detached-binary namespace check. Ubuntu 22.04 avoids Ubuntu 24.04's additional unprivileged-user-namespace restrictions. Installation tests use temporary homes and fake `systemctl`, never the owner's service.

## What publishes

Only a successful **main-branch push or main-branch manual run** publishes:

- **Linux build artifact:** `whistle-linux-x64-<full commit SHA>`, retained for 14 days. It contains `whistle-linux-x64.tar.gz` and that archive's SHA-256 file. The tar preserves executable permissions and contains only the verified `whistle` binary and `whistle.sha256`. It contains no runtime state, credentials, database, uploads, or repository checkout.
- **GitHub Pages:** only `site-dist/`, produced from `site/`, is uploaded as the Pages artifact. A separate deployment job waits for all checks, then publishes it using GitHub's `github-pages` environment and OIDC. It does not publish `dist/`, the private phone app, or a terminal server.

PRs receive read-only repository permissions, with checkout credential persistence disabled. They cannot publish Pages or executable artifacts. The Pages job alone has `pages: write` and `id-token: write`; it does not check out or execute repository code. No `pull_request_target`, self-hosted runner, or PC deployment is used. Superseded PR runs can be cancelled; main runs are not interrupted during deployment.

Actions artifacts are CI downloads, not permanent GitHub Releases. Downloading usually requires a GitHub login with repository access. A private repository's Pages availability/public visibility depends on your GitHub plan and Pages settings. This workflow intentionally does not create a release or expose an authenticated download URL as a permanent public link.

## Activate on GitHub

The repository is now private at `NoamCohen48/whistle`. `main` is intentionally empty; PR #1 (`initial-import`) contains the complete original history plus the empty-base merge and CI fixes. Existing commit IDs were preserved. New local commits use the account's GitHub noreply address to satisfy email-privacy protection.

1. Review PR #1 and wait for its validation job. Merge with **Create a merge commit**, not squash/rebase, if preserving the imported history is required.
2. Keep repository visibility private unless deliberately reviewed. Making it public also publishes tracked source/docs/history, which may contain personal deployment details. The Pages upload boundary does not sanitize Git history. Do not commit `.runtime/`, `.env`, databases, QR images, or build output.
3. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The workflow does not automatically change this setting.
4. Enable Actions if disabled, and allow the pinned GitHub actions plus `oven-sh/setup-bun` under your organization policy.
5. Configure the **github-pages** environment to accept deployments from `main` only; add a reviewer if desired.
6. Run **CI and Pages** manually on `main`, or push a commit. The deployment job reports the actual public URL, typically `https://<owner>.github.io/<repository>/`. No owner/repository URL is hard-coded.
7. Once the first run succeeds, make **Validate, test and package** a required check in your `main` branch ruleset. Protect workflow changes with review as appropriate.

If checks pass but Pages fails, confirm the Pages source, repository/plan eligibility, environment branch rules, and organization action permissions. No PC configuration needs changing. A failed validation job prevents Pages deployment; a failed Pages deployment does not invalidate an already verified downloadable build.

## Download and verify an artifact

Open the successful main run under **Actions**, download its `whistle-linux-x64-<SHA>` artifact, and unzip it. In that extracted directory:

```sh
sha256sum --check whistle-linux-x64.tar.gz.sha256
tar -xzf whistle-linux-x64.tar.gz
sha256sum --check whistle.sha256
./whistle --version
```

This does not install anything. Installation or restart on the owner's PC remains a separate, explicitly approved operation. Compare the version/revision with the run's commit before using the executable.

## Site design handoff

See [`site/README.md`](../site/README.md). The UI/UX agent can replace the mock without touching host/authentication/terminal code. Keep the separate build output, relative asset URLs, and public/private safety tests.

```sh
bun run dev:site
bun run test:site
```

Workflow syntax is checked locally with actionlint, and PR #1 runs the checks on GitHub-hosted runners before merge. Pages publication remains separately gated to `main` and requires owner activation; a passing PR does not prove that Pages account-side settings are correct.
