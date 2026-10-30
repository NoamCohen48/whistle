# Public landing page

The public website introducing Whistle. It is not Whistle's private phone app, and it never connects to one.

## Commands

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:site       # http://127.0.0.1:5175
bun run build:site     # site-dist/, never dist/
bun run test:site      # built desktop + emulated phone; root + /whistle/ paths, and the download links
```

The site is plain HTML and CSS plus one small module (`demo.ts`), built by a separate Vite configuration. No new dependencies are required.

Design:

- **Type:** Bricolage Grotesque (display and body) and Martian Mono (commands), self-hosted from `site/fonts/` under the SIL Open Font License (licence files alongside). No font CDN.
- **Colour:** neutrals from the phone app's green-slate family. Colours follow the app: amber means input reaches the PC (controlling) and steel blue means watching. Light and dark follow the system setting.
- **Download:** the one-line installer on the dark terminal surface, then a table of packages with an x86-64/ARM64 switch. Monospace is used only for file names and commands.
- **Story:** the page leads with the premise (keep up with your coding agents from your phone): the herd overview, alerts, answering in the real terminal, and starting new work. Watch-first control, pairing and self-hosting are listed as things Whistle does, not as comparisons with other tools.
- **Hero illustration:** an HTML recreation of the phone app's herd screen and session screen (header, agent strip, terminal, dock), using the app's dark tokens and labels with sample data only. `demo.ts` lets a visitor open a pane, go back, and switch locally between Watching, Controlling and Disconnected; it makes no requests and stores nothing. The four premise tiles reuse the same `.app-ui` pieces as decorative fragments. If the app's look changes, update the `.app-ui` tokens and markup to match. Never replace them with a capture of a real terminal, token, pairing code or private repository.
- **Shape:** site blocks 8px, site controls full pill; the phone mock keeps the app's own 10px radius.
- **Motion:** state changes in the illustration only, disabled under reduced motion.

## Keep this contract

- Public source lives in `site/`; output goes only to `site-dist/`.
- `bun run build:site` and `bun run test:site` remain the build and verification entry points.
- URLs work both at `/` and `/whistle/` (and other repository names). Relative asset paths are intentional. Do not hard-code the GitHub owner or repository name; use the `__WHISTLE_REPOSITORY__` and `__WHISTLE_VERSION__` placeholders in `index.html`.
- Never import `web/`, `src/`, `.runtime/`, or private app assets. Do not copy the root app manifest, service worker, pairing UI, or compiled executable into this site.
- No private hostname, authentication, API/WebSocket calls, analytics, tracking, or live session data. An interactive demo, if added later, must use static fake data only.
- Add static images/fonts under `site/` and reference them from HTML/CSS so Vite includes them. `publicDir` is disabled to prevent accidental copying of the app's public assets.
- Keep headings, keyboard focus, readable contrast, mobile layout, reduced-motion support for any future animation, and light/dark modes accessible.
- Downloads are plain links to `https://github.com/OWNER/REPO/releases/latest/download/NAME`. `vite.config.ts` fills in the repository (from `GITHUB_REPOSITORY`, else `package.json`) and the version at build time, so the page itself never calls GitHub. `download.ts` switches the links between x86-64 and ARM64. Keep the file names in `download.ts`, `index.html` and `scripts/release.ts` in step.
- Keep or update `site/site.browser.ts` as the design changes. Its safety checks must remain: no private connections or service-worker registration, no horizontal overflow, and correct assets at a repository subpath.

GitHub Pages publishes only `site-dist/`, from the release workflow, so the site always matches the latest release. The private phone frontend builds to `dist/` and is served by the PC host. See [CI and releases](../docs/ci.md).
