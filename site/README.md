# Public landing page

The public website introducing Whistle. It is not Whistle's private phone app, and it never connects to one.

## Commands

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:site       # http://127.0.0.1:5175
bun run build:site     # site-dist/, never dist/
bun run test:site      # built desktop + emulated phone; root + /whistle/ paths
```

The site is plain HTML and CSS plus one small module (`demo.ts`), built by a separate Vite configuration. No new dependencies are required.

Design:

- **Type:** Bricolage Grotesque (display and body) and Martian Mono (commands), self-hosted from `site/fonts/` under the SIL Open Font License (licence files alongside). No font CDN.
- **Colour:** neutrals from the phone app's green-slate family. Colours follow the app: amber means input reaches the PC (controlling) and steel blue means watching. Light and dark follow the system setting.
- **Story:** the page leads with the premise (keep up with your coding agents from your phone): the herd overview, alerts, answering in the real terminal, and starting new work. Watch-first control, pairing and self-hosting are listed as things Whistle does, not as comparisons with other tools.
- **Hero illustration:** an HTML recreation of the phone app's herd screen and session screen (header, agent strip, terminal, dock), using the app's dark tokens and labels with sample data only. `demo.ts` lets a visitor open a pane, go back, and switch locally between Watching, Controlling and Disconnected; it makes no requests and stores nothing. The four premise tiles reuse the same `.app-ui` pieces as decorative fragments. If the app's look changes, update the `.app-ui` tokens and markup to match. Never replace them with a capture of a real terminal, token, pairing code or private repository.
- **Shape:** site blocks 8px, site controls full pill; the phone mock keeps the app's own 10px radius.
- **Motion:** state changes in the illustration only, disabled under reduced motion.

## Keep this contract

- Public source lives in `site/`; output goes only to `site-dist/`.
- `bun run build:site` and `bun run test:site` remain the build and verification entry points.
- URLs work both at `/` and `/whistle/` (and other repository names). Relative asset paths are intentional. Do not hard-code the GitHub owner or repository name.
- Never import `web/`, `src/`, `.runtime/`, or private app assets. Do not copy the root app manifest, service worker, pairing UI, or compiled executable into this site.
- No private hostname, authentication, API/WebSocket calls, analytics, tracking, or live session data. An interactive demo, if added later, must use static fake data only.
- Add static images/fonts under `site/` and reference them from HTML/CSS so Vite includes them. `publicDir` is disabled to prevent accidental copying of the app's public assets.
- Keep headings, keyboard focus, readable contrast, mobile layout, reduced-motion support for any future animation, and light/dark modes accessible.
- The site intentionally has no download button pointing to a made-up release. CI builds are available from the repository's Actions page, subject to GitHub login and artifact retention. Add permanent release links only when a release workflow actually exists.
- Keep or update `site/site.browser.ts` as the design changes. Its safety checks must remain: no private connections or service-worker registration, no horizontal overflow, and correct assets at a repository subpath.

GitHub Pages publishes only `site-dist/`. The private phone frontend still builds to `dist/` and is served by the PC host. See [CI/CD setup](../.docs/ci.md) for deployment and GitHub-side activation.
