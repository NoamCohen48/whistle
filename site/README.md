# Public landing-page mock

This directory is a deliberately small placeholder for the UI/UX agent. Replace its visual design and content freely, while preserving the publishing boundary below. It is not Whistle's private phone app.

## Commands

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:site       # http://127.0.0.1:5175
bun run build:site     # site-dist/, never dist/
bun run test:site      # built desktop + emulated phone; root + /whistle/ paths
```

The site is plain HTML and CSS, built by a separate Vite configuration. No new dependencies are required. The explicit product-image slot is intentional: replace it with an original illustration or an approved, sanitized product image. Do not capture a real terminal, token, pairing code, or private repository to make a screenshot.

Design baseline: native CSS, system sans-serif, one green accent, six-pixel corner radius, system light/dark mode. Design variance 3, motion intensity 1, visual density 3. This is scaffolding, not a finished brand direction.

## Keep this contract

- Public source lives in `site/`; output goes only to `site-dist/`.
- `bun run build:site` and `bun run test:site` remain the build and verification entry points.
- URLs work both at `/` and `/whistle/` (and other repository names). Relative asset paths are intentional. Do not hard-code the GitHub owner or repository name.
- Never import `web/`, `src/`, `.runtime/`, or private app assets. Do not copy the root app manifest, service worker, pairing UI, or compiled executable into this site.
- No private hostname, authentication, API/WebSocket calls, analytics, tracking, or live session data. An interactive demo, if added later, must use static fake data only.
- Add static images/fonts under `site/` and reference them from HTML/CSS so Vite includes them. `publicDir` is disabled to prevent accidental copying of the app's public assets.
- Keep headings, keyboard focus, readable contrast, mobile layout, reduced-motion support for any future animation, and light/dark modes accessible.
- This mock intentionally has no download button pointing to a made-up release. CI builds are available from the repository's Actions page, subject to GitHub login and artifact retention. Add permanent release links only when a release workflow actually exists.
- Keep or update `site/site.browser.ts` as the design changes. Its safety checks must remain: no private connections or service-worker registration, no horizontal overflow, and correct assets at a repository subpath.

GitHub Pages publishes only `site-dist/`. The private phone frontend still builds to `dist/` and is served by the PC host. See [CI/CD setup](../.docs/ci.md) for deployment and GitHub-side activation.
