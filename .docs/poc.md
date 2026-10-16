# Terminal PoC

## Original implementation choice

The original validation stack was Bun + TypeScript + xterm.js and its Fit addon, with native HTML/CSS UI and no React or agent SDK. The frontend has since migrated to the approved React + Vite + TypeScript stack; see [frontend boundaries and checks](frontend.md) and [production architecture](architecture.md). The Bun bridge and the terminal behavior documented below remain in use. This document records the original PoC checks; they are not claims that every physical-device scenario has been reverified after migration.

The server reads Herdr's inherited `HERDR_SOCKET_PATH`. `session.snapshot` lists panes. Each open browser pane starts one CLI child:

- Watch: `herdr terminal session observe <pane> --cols N --rows N`
- Control: `herdr terminal session control <pane> --cols N --rows N`

Herdr emits newline-delimited `terminal.frame` envelopes: base64 ANSI bytes, width, height, sequence and full-frame flag. The bridge forwards them through an authenticated WebSocket; xterm renders them. This is Herdr's ANSI terminal-session output, not a direct tap of the application's original PTY output. Graphics support and all terminal modes are not guaranteed.

The controller CLI handles sizing, scroll and release. Raw text now uses `pane.send_text`, and logical chords use `pane.send_keys`, on one serialized RPC lane while the controller stream is live. This avoids cross-transport reordering between typed text and shortcuts. Herdr encodes chords using the pane's actual terminal keyboard mode. No `--takeover` is used. Control is explicitly requested, not implicit on viewing or reconnecting. Desktop input remains owned by the existing Herdr session; Whistle does not replace the agent process.

## Verified locally

Host: Herdr 0.9.3, protocol 22; Bun 1.3.11.

- A separate test shell pane was created in this workspace with `--no-focus`; unrelated panes were not typed into.
- Control changed the real shell PTY to 45 columns × 18 rows (`stty size`). Release returned its viewport to the desktop layout.
- Observing did not change pane viewport rows.
- Integration test: pairing, unauthenticated rejection, cross-origin login rejection, ANSI frames, ordered input, Backspace, Enter, resize, release/restoration, watch-mode write rejection.
- Playwright at 393×852: pane listing, watch, control, direct typing, accessory Backspace and Enter produced `WHISTLE_BROWSER_123` in the actual shell.
- Original-width control rendered 185 columns with horizontal panning; fit rendered approximately 46 columns at 393px.
- Pi was started in the test pane using the requested `openai-codex/gpt-5.3-codex-spark`. A Compose → Paste + Enter prompt reached Pi and started a provider request.
- Direct Pi editing through the browser, including Backspace, arrow-left, and insertion, produced `WHISTLE_LIVE_12_3` in Pi's actual input editor. The draft was then cleared without submitting another model request.
- Reload reconnects to the remembered pane in watch mode, not control mode.
- Final build/typecheck passed. All six tests (including the opt-in real-Herdr integration test) passed with 26 assertions against the server bound to the existing tailnet IP. Default `bun test` skips the mutating integration test.
- Final Playwright check on the tailnet URL: 46×32 control view at 393px width, no page-level horizontal overflow, reload returned to watch mode. This is desktop Chromium at mobile dimensions, not a physical Android test.

## Model smoke-test blocker

The provider rejected the response smoke test:

> The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.

The model is listed by local Pi, but the account/provider rejected its use. Input submission is verified; a successful agent response is not. No fallback model was silently selected.

The test Pi runs with `--no-session --no-tools --no-context-files --no-approve` to avoid test prompts changing files or loading project-local agent instructions. Normal user panes are not modified by those flags.

## Input and lifecycle rules

- xterm's native input/composition handling, autocorrect and capitalization disabled. There is no fabricated mirror of the terminal's prompt in an editable local field.
- All control messages on a connection are serialized. Input IDs must increase. Rejected, disconnected, or uncertain input is never replayed.
- An ACK means Herdr accepted the input write, not that the agent acted on it. Verify the visible screen. The geometry and delivery-status footer was removed at the operator's request; uncertain-input and rejection errors remain visible.
- Compose retains per-pane in-memory drafts. It sends one ordered input transaction. Multiline paste requires xterm's bracketed-paste mode; otherwise it is refused instead of risking multiple shell commands. Drafts survive pane switching, but not page reload.
- On page hide, the browser releases control. On return/reload, it observes. Dropped network connections release through socket close/idle timeout. The agent keeps running.
- Herdr handles geometry restoration when its controller disconnects. Whistle does not snapshot/reapply the desktop layout or focus.

## Baseline controls and navigation

- Ctrl, Alt and Shift are one-shot toggles, combinable in any supported chord. They reset after a key, on pane switch, entering Compose, release, disconnect and page hide. No queued or persisted modifier sequences.
- More keys contains letters, digits, punctuation, navigation keys and F1–F24. The custom key/chord field accepts examples such as `ctrl+shift+p`, `shift+enter`, or a single Unicode character. Herdr's parser is the final authority; unsupported key names are rejected without disconnecting or inventing an encoding. Acceptance does not guarantee the target app binds that shortcut. Legacy terminal modes cannot distinguish every modifier combination.
- Armed modifiers can apply to one native-terminal character/special key. Modified multi-character paste/composition is refused with a message; use the explicit key picker for deterministic shortcuts.
- A disposable raw-mode Kitty-protocol probe captured Shift+Enter as `CSI 13;2u`, Ctrl+Alt+Shift+P as `CSI 112;8u`, and Ctrl+O as `CSI 111;5u` through the mobile-sized browser. Mixed raw text and logical Backspace/Enter ordering passed the real-Herdr integration test; unsupported-key rejection leaves the connection usable. The disposable test pane was closed.
- The top strip lists all detected live agents, including idle ones. It refreshes every five seconds while visible. Switching preserves local drafts, clears modifiers/control, and opens in watch mode. Selected agent is highlighted; the strip scrolls horizontally.
- Dashboard worktrees are nested under their main workspace using Herdr's exact `worktree.repo_key` and `is_linked_worktree` metadata. `app-explorer` is shown under `tap`, marked Worktree. Orphans stay visible at the top level; names/path prefixes are never used to guess a parent.
- Browser checks at 393px confirmed agent switching, active-chip highlighting, worktree nesting without duplicate rows, all child panes present, footer removal and no page-level horizontal overflow. Styling remains deliberately minimal for later UI/UX work.

## Phone viewport / fixed TUI footer regression

Reproduced on the actual working Pi pane, without typing: at 393×852, fitting a roughly 27-row PTY caused Pi's wrapped statusline, pi-lens widgets and other fixed UI to occupy most of the terminal. Application-history scrolling did not move the fixed footer. This was distinct from the removed Whistle delivery footer.

Control now keeps a real PTY of at least 64 rows at phone width. The phone locally pans that taller rendered screen. The initial view follows xterm's actual terminal cursor, aligning the input near the lower edge instead of aligning the entire terminal bottom. Nothing is parsed as a Pi-specific footer or discarded; decorations remain reachable by scrolling down.

- Wheel/touch/Page controls browse local offscreen rows first. At an edge they request application-owned history scrolling through Herdr. Manual reading disables cursor-follow, so new frames do not snap back.
- **Input** returns to the actual cursor. **Type** does that and focuses the native keyboard.
- The bottom toolbar is one row. **Keys** opens an overlay with modifiers and the full key pad, without changing the PTY size. Short visual viewports compact the header/agent strip and remove redundant notice text.
- Verified on this pane at 393×852 and 393×450: 64-row PTY, input cursor within the visible terminal, approximately 565px/229px of chat viewport, and a 60px toolbar. Wheel scrolling persisted across new frames. Synthetic touch moved the local viewport. Opening Keys did not resize it. Released control and confirmed restoration to the original 51-row desktop viewport.
- Unit tests cover minimum PTY height, cursor-aligned positioning and local-versus-remote edge scrolling. Physical Android keyboard and momentum behavior still need operator validation. This update is frontend-only; no server restart or re-pairing is needed.

## Security boundary

This is remote shell access. All pane reads and WebSockets require a paired browser. A random access token is created with owner-only permissions in ignored `.runtime/access-token`; successful pairing issues an HttpOnly SameSite=Strict cookie. Origin checks protect login and WebSocket upgrades. Login failures are rate-limited. No terminal input/output is logged by the bridge. The permanent access token never appears in URLs.

### QR pairing

Run `bun run pair` on the PC. The CLI authenticates to `/api/pairing-ticket` with the permanent PC token, then generates a terminal QR and owner-readable `.runtime/pair.png`. The QR contains a random, five-minute, single-use credential in a URL fragment (`/#pair=…`). Only the newest QR is valid. The camera opens the phone browser, which immediately removes the fragment and exchanges the ticket via POST for its HttpOnly cookie. Fragments are not sent in initial HTTP requests or referrer headers, but the QR itself is still a temporary shell-access credential. There is no public endpoint that displays QR credentials to unpaired visitors. Manual token entry remains a collapsed fallback.

Unit/API tests cover expiration, reuse, invalidation, unauthorized QR creation, origin enforcement and cookie issuance. Playwright verified automatic pairing in a fresh mobile-sized browser context, fragment removal and replay rejection. Physical camera scanning remains to be tested by the operator.

Default bind is loopback. For phone testing, explicitly bind to the PC's existing Tailscale IPv4 address. Do not bind to every interface or expose it publicly. Existing Tailscale Serve/Collie settings are unchanged. Direct HTTP over the tailnet relies on Tailscale encryption; this PoC is not an HTTPS PWA installation test. Browser pairings are memory-resident and reset on server restart; the pairing token persists.

## Still needs a real phone

- Gboard/Samsung Keyboard composition, deletion, autocorrect replacement, dictation, Unicode/emoji, selection and paste.
- Keyboard opening/closing, landscape, text size, touch scrolling and long-prompt editing.
- Lock/unlock and Wi-Fi/mobile handoff, reconnect latency, and dropped connection during submission.
- iPhone keyboard and viewport behavior.
- Geometry when no desktop client is attached, simultaneous desktop/mobile input, and other Herdr versions.

Not implemented: native packaging, service worker/installable PWA, launcher, file attachments, multi-machine inventory, transcript/history parsing, mouse selection forwarding, and guaranteed Kitty graphics rendering. Watching supports local xterm buffer scrolling/panning; application-owned history scrolling is an explicit control action via PgUp/PgDn or touch.
