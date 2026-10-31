# React frontend

## Status

The phone app is React + Vite + TypeScript, served by the Bun host and embedded in the standalone executable. Pairing and revocation live in the host; see [host authentication](host.md). The app is installable over HTTPS; see [HTTPS and the installable app](pwa.md).

## Layout

The top of the screen is navigation (back, pane name/workspace/id, refresh, ⋯, agent chips); the bottom **dock** is action, within thumb reach and directly above the Android keyboard. While watching, the dock is one row: state pill, Text size, Terminal text and Take control (a hand icon). While controlling, that row goes away so the terminal keeps the space: Release (the slashed hand) moves into the header (in place of Refresh and Review changes), Text size, Terminal text and the width choice move into the ⋯ menu, and the dock is just the toolbar (Compose, Keys | Esc, Enter ↵). Tapping the terminal brings up the phone keyboard; a scroll swipe does not. The orange frame shows control. Compose is offered only while controlling, and opens and closes from its toolbar button; Compose and Keys are never open together. While Compose is open the toolbar's Enter becomes **Send** (Paste + Enter), so there is only ever one Enter action on screen.

- **Back navigation**: Android/system/browser Back from a pane returns to the dashboard and releases control, just like the header Back button. Switching panes replaces one history entry rather than stacking agents. Restored panes and cold launches from shortcuts/alerts also get a dashboard beneath them. Browser Forward can reopen an existing pane only in watch mode; terminal identity is checked so a replaced pane cannot be reopened from stale history. Returning to the dashboard preserves drafts and does not trap Back there. Where the browser supports `CloseWatcher` (Chrome on Android), Back first closes an open Keys drawer or Compose, as it closes sheets, without releasing control; the next Back leaves the pane. Opening Keys dismisses the phone keyboard and Type closes the drawer, so the two never stack.
- **State** is never colour-only: a labelled pill (Watching = steel, Controlling = amber, Disconnected = rose). Controlling also draws an amber ring around the terminal; it eases in and disappears instantly when control is lost. Where the browser supports it, the phone vibrates once when control starts and twice when it ends for any reason (release, disconnect, switching).
- **Overlays never resize the PTY**: the Keys drawer, the armed-modifier chip and error banners are positioned layers. The Keys drawer is height-capped so it covers only the terminal, never the agent switcher. It shows modifiers and the common keys; the custom chord field and the full key pad are folded under **All keys and chords** (stays open once expanded). Compose is the one panel that deliberately takes layout space.
- **Local history**: quick swipes glide with speed-dependent momentum and time-based decay; slow drags stay 1:1. A new touch, wheel, pane switch, reconnect, or Latest stops the glide. Reduced motion disables momentum. Fling scrolling stops at the phone's local history edge; only a deliberate drag or wheel beyond the edge can request PC history while controlling.
- **History handle**: a thin right-edge thumb with a 44 px target appears during scrolling and fades after 1.5 seconds. Drag or use Home/End, arrows or Page Up/Down to browse the entire local buffer, including xterm scrollback (up to 1500 lines). It never sends PC commands. **↓ Latest** floats above the bottom-right of the terminal while reading older content; it returns to the actual input cursor and resumes following without focusing or resizing the PC. The old session-bar jump button is removed.
- **Short viewports** (`.short-viewport`, set by the engine below 600 px of visible height): landscape puts the header and chips on one row and the dock status and toolbar on one row; portrait with the keyboard open hides the chips while controlling. Landscape is how the device is held (`.landscape`, from `screen.orientation`), not the viewport's shape: an upright small phone with the keyboard open has a wider-than-tall viewport and must keep the portrait dock. Below 420 px (`.tiny-viewport`, a small phone typing) the session bar and Compose's status and history step aside while controlling. The dock may shrink, but only the draft gives way and scrolls; the toolbar with Send never leaves the screen.
- **New** (inventory, bottom right) opens a bottom sheet for an agent, a terminal tab, a workspace or a worktree (new branch or existing checkout). The ⋯ menu in the terminal header adds an agent/terminal to the current workspace, renames the pane or its workspace (an empty pane name falls back to the terminal title), closes the pane or removes the current linked worktree; destructive items need a confirm step. Created panes open watch-only like any other. A failed close/remove reopens the pane watch-only.
- **Folder browser** (New → Workspace): the folder field starts at the parent folder of the projects already open (chips offer the others, skipping Herdr-managed worktrees). Below it, the PC's folders at that path are listed, Git projects marked; typing narrows the list to the text after the last slash, tapping a folder goes into it, and breadcrumbs go back up. Taps never focus the field, so the keyboard stays down. The workspace is created from the field, without its trailing slash.
- **Review changes** (direct header shortcut and ⋯ menu, panes with a folder): a read-only sheet of what the pane's checkout changed since the last commit: branch, files with status and +/− counts, and a tap-to-expand diff per file. It never stages, commits or reverts, and opening it does not touch the terminal. Changed pictures show as pictures; tapping one opens the full-screen viewer (tap the picture for actual size, ↓ saves it to the phone).
- **Terminal text** (lines button in the session bar while watching, ⋯ menu while controlling): a copy of the terminal's scrollback and screen as plain, selectable text, newest at the bottom. Literal, case-insensitive search highlights matches and provides Previous/Next (Enter/Shift+Enter). The view is explicitly a snapshot, not a live transcript. Copy takes the selection or everything; without a secure context it falls back to the legacy copy command. Picture paths in the text open the picture viewer (resolved against the pane folder, project-only like Review changes). Reading text never sends input or resizes the terminal.
- **Pictures** (Compose → Picture, or paste an image into the draft): the phone shrinks each picture to at most 1920 px and re-encodes it (PNG stays PNG, everything else becomes JPEG), which also drops camera metadata, then uploads it to the PC. The saved path is appended to the draft with a removable thumbnail below; it reaches the agent only when the draft is sent. An upload that finishes after switching panes is dropped. Video is not supported.
- **Files** (Compose → paperclip): text and code files up to 1 MB are checked on the phone (UTF-8, no NUL bytes) and uploaded as they are. The chip shows the saved name.
- **File paths** an agent prints (`src/app.ts:42`, `./notes.md`, `/home/…/plan.md`) are links in Terminal text and in the live terminal (underlined under a mouse, opened by a tap). Pictures open in the picture viewer; anything else opens read-only with line numbers, scrolled to the named line. Paths need a slash or a known code extension, and `~/` paths are left alone. `web/paths.ts` finds them; nothing is parsed beyond that.
- **Web links**: `http` and `https` addresses printed in the terminal, and links a program embeds with OSC 8 (Herdr keeps these in its frames), open in a new browser tab with `noopener`. Every other scheme (`javascript:`, `file:`, `data:` and so on) stays plain text.
- **Two-finger swipe** sideways on the terminal moves to the next or previous agent in the switcher's order (or the next pane, for a plain terminal), watch-only, and stops at the ends.
- **Settings**: a left-hand option mirrors the dock and toolbar rows; **Report a problem** opens a prefilled GitHub issue (app version, browser, HTTPS, screen size, last message shown) that the person reviews before submitting.
- **Herd rows never move** when a status changes. An agent that needs you gets a tinted row and an edge mark, and the Needs you filter shows the count in the alert colour.
- **Alerts** (bell on the pane list, production HTTPS only): turns "needs you" Web Push alerts on for this device and checks delivery. Once on, the bell opens this phone's settings, saved on the PC as they change: also alert when an agent finishes, quiet hours (delivered silently) and turning alerts off; see [PWA](pwa.md#needs-you-alerts). Tapping an alert opens its pane watch-only.
- **Pane previews**: the list polls authenticated, no-store `GET /api/previews` every ten seconds only while visible. The host reads six recent lines with `pane.read` (Herdr protocol 22 schema verified), strips ANSI, and returns the last nonempty line, at most 120 Unicode characters. Up to eight reads run concurrently with a shared 1.5-second read budget; unavailable panes are omitted. No text is logged, and no focus, status, resize or scroll command is issued. Search also matches preview text.
- **Search** appears above the pane list once there are six or more panes. Every word must match the pane name, workspace, agent, status, folder or pane id; results replace the grouped list until the search is cleared (Escape or ✕).
- **Needs you**: agents Herdr reports as `blocked` (waiting for an answer, rose) or `done` (finished a turn, blue) stay in their place in their workspace and are marked there with a tint and an edge line, so a row never moves while you are about to tap it. The Needs you filter lists only them. The agent strip keeps its order too.
- **Dashboard**: no page title; a long press (or right click) on a row opens that pane's menu (new agent or terminal here, rename, close, remove worktree) without opening it; search (once there are six or more panes) above status-count filters (All, Needs you, Working, Idle), two-line previews, home-relative paths, per-browser pins/recent panes, and persistent workspace collapse (a chevron; a collapsed workspace shows how many panes it hides, its worktrees' included). Raw pane IDs stay in terminal details and search, not dashboard rows. Update times are not shown while the list is current; failed refreshes label the list as saved state, with its last update time, and offer Retry. Empty lists offer Open a project.
- **Drafts**: Compose opens while controlling and keeps its draft across release and pane switches. The status line appears only when browser storage fails and the draft is kept in memory. Up to ten recent prompts per pane are stored for seven days when Send is tapped (not proof of delivery). Restoring a prompt never sends it; replacing a draft requires confirmation and can be undone. Pairing loss clears drafts and prompt history.
- **Text size**: 10–22 px, saved per browser: in the session bar while watching, in the ⋯ menu while controlling. Watch sizing never changes the PC geometry.
- **Devices**: Settings lists paired browsers with last-seen and expiry dates. Revocation requires confirmation; revoking this browser clears pairing/local drafts. Settings explains blocked notification permissions and unsupported contexts, and otherwise carries no explanatory notes.
- **Recovery**: startup network/server errors show Cannot reach your PC with Tailscale/host guidance, not pairing instructions. Only a 401 requires pairing. HTTP reads time out after 12 seconds, mutations after 30 seconds; ambiguous mutations are never automatically retried. Successful creation is separate from inventory refresh, so a failed follow-up read cannot invite duplicate creation. Renaming likewise closes after mutation success and refreshes separately.
- **Connection health**: 5-second checks send pings and reconnect watch-only after 25 seconds without any server response (including connections that never open). Browser offline/online events stop input and recover watch-only. Input is never replayed.
- Errors are dismissible and contextual; load failures have recovery actions. The pairing screen keeps the token fallback collapsed. Opening a used or expired QR on a browser that is still paired just opens Whistle, without an error.

## Boundaries

- `web/main.tsx`: strips the one-time QR fragment, prepares authentication once, then mounts React in Strict Mode. Single-use redemption is outside React effects so a development remount cannot redeem twice.
- `web/api.ts`, `web/request.ts`: pairing/inventory requests and shared bounded HTTP error handling. No long-lived credentials in React state, local storage, or URLs. Authentication errors centrally clear local prompts and notify React. Mutations never retry automatically.
- `web/preferences.ts`: validated, non-sensitive per-browser display preferences with storage-denial fallbacks.
- `web/App.tsx`: authentication screen, inventory polling, selected pane, error presentation and per-pane drafts. Drafts persist per pane in `localStorage` (`whistle-draft:<paneId>`) for seven days, at most once per 300 ms with a page-hide flush. Only the draft text is restored; attachment previews remain memory-only. Pairing loss clears all drafts, including pending writes. Restoration never sends input.
- `web/components/Pairing.tsx`: QR instructions and collapsed token fallback.
- `web/components/Inventory.tsx`: agent strip, workspace list and metadata-based worktree nesting. React renders pane names as text, not HTML.
- `web/components/TerminalPanel.tsx`: UI controls and the terminal host element. Connect effects depend on pane/terminal identity, not refreshed metadata objects.
- `web/terminal/session.ts`: imperative xterm instance, ordered WebSocket writes/ACK tracking, generation guards, reconnects, modifiers, paste, cursor-follow and local/remote scrolling. React receives only discrete UI transitions/errors. Terminal frames, typed terminal bytes and scroll positions do not enter React state. `text()` returns the buffer as plain text; `scrollInfo()` reads local position/range and whether older content is being read; `scrollToFraction()` explicitly moves only the local buffer; `onScroll()` subscribes to local scroll notifications. The history UI keeps positions in DOM styles/refs and only visibility booleans in React state.
- `web/components/Actions.tsx`: create sheet and pane menu on native modal `<dialog>` bottom sheets.
- `web/push.ts`: alert support detection, subscribe/unsubscribe and the delivery check.
- `web/attach.ts`: shrinking, re-encoding and uploading attached pictures, and checking and uploading text files.
- `web/paths.ts`: finding file paths in terminal text.
- `web/report.ts`: the Report a problem issue link.
- `web/components/Changes.tsx`, `PictureViewer.tsx`, `TerminalText.tsx`, `AlertsSheet.tsx`, `Settings.tsx`: the review, picture, terminal-text, alert-settings and paired-device sheets.
- `web/components/Icon.tsx`: inline decorative SVG icons (no icon font or extra assets).
- `web/style.css`: token-based styling and compact visual-viewport rules. `--bg` must match the xterm theme and manifest theme color.
- `vite.config.ts`: production output compatible with the host's explicit asset allowlist, plus a loopback-only development server with API/WebSocket proxies.

React creates the terminal host element; xterm exclusively owns its contents. The terminal controller is disposed on unmount, including socket, timers, ResizeObserver and event listeners. Inventory refreshes, draft edits and opening Keys must not recreate xterm or reconnect a terminal stream.

The development proxy matches `/api/` and exactly `/terminal`, not similarly named source modules such as `/api.ts` or `/terminal/session.ts`. It rewrites upstream Origin/Host only for local development; production keeps the original same-origin host checks.

## Preserved behavior

- Read-only watch, explicit control, original-width or fitted-width sizing, and minimum 64-row controlled PTY.
- Live text and logical chords in one ordered lane; no input replay after reconnect or switching.
- One-shot modifiers and full key picker/custom chords.
- Separate Compose with Paste / Paste + Enter and bracketed-paste safety. Herdr frames are rendered screens, so a phone that attaches mid-session may never see a program turn bracketed paste on: multiline text is sent bracketed when the mirror saw the mode or Herdr reports the pane as an agent, and refused for other panes rather than risk running each line. Compose is one card: a draft box that grows with its text (up to about a quarter of the screen), attached pictures, and a small row inside it (Picture and Clear icons, **Paste only**); the toolbar's Send is Paste + Enter. This keeps Compose to one extra row so the terminal stays visible. Paste + Enter sends the text, then the host presses Enter as its own key 250 ms later in the same serial lane: an Enter in the same write as a paste is taken as part of the paste (Claude Code only pasted). Drafts are never cleared just because a write was sent; instead, until the draft is edited, Send reads **Sent**.
- Agent switching preserves separate drafts, clears modifiers, closes overlays and returns to watch mode.
- Local-first wheel/touch scrolling, application history at edges, manual reading without snap-back and Latest to return to the actual cursor.
- Keys overlays do not resize the viewport/PTY; short visual viewports compact chrome.
- Visibility changes release control. Reconnection, reload and back/forward-cache restoration are watch-only.
- Unconfirmed-write warnings survive switching; stale callbacks from old connections cannot affect a new target.

## Development

Start the Bun host with `bun start`. In a second terminal:

```sh
bun run dev
# If the host is bound only to a tailnet IP:
WHISTLE_API_URL=http://<pc-tailnet-ip>:8790 bun run dev
```

Vite is local development tooling, not the phone-facing production server. `bun start` builds the UI and serves it through Bun. A source host reads the rebuilt assets from `dist/`, so refreshing the phone loads the new UI without restarting the host.

The initial production JavaScript bundle is approximately 576 kB minified (160 kB gzipped as a size estimate; the host does not yet compress responses). Vite reports its default size advisory. It contains React and xterm in one file to preserve the existing fixed asset allowlist. Splitting or lazy-loading xterm, and compression, are possible later improvements; the warning is not a build error.

## Regression checks

```sh
bun run typecheck
bun test
bunx playwright install chromium # once after installing/upgrading Playwright
bun run test:e2e
```

Browser fixtures bind to `127.0.0.1:8792`; Vite tests use `127.0.0.1:5174`. The fixture does not import the Herdr runtime adapter, launch agents, or touch real panes. The suite checks built desktop Chromium, emulated Android Chromium and Vite development with React Strict Mode. Test filenames use `.browser.ts` so `bun test` does not try to execute Playwright suites.

`tests/e2e/improvements.browser.ts` adds regressions for watch-mode composing/minimizing/undo, startup outages, stale list recovery, successful creation followed by a failed refresh, silent socket stalls, filters/pins/collapse, read-only font sizing/search, local prompt reuse, device revocation and empty-state recovery.

The suite runs in each browser configuration: QR redemption/fragment removal and worktree nesting; token fallback; watch/control/release; ordered live input/chords/paste; drafts and switching; reconnect/reload without replay; local/edge scroll and stable Keys geometry; polling without terminal remount and replacement-pane detection; uncertain input warnings; short viewport and synthetic touch scrolling; creating, closing, removing and renaming; Needs you marks; duplicate-safe launches; picture and text file attachments; file path and web links; two-finger swipe; the left-hand layout; Report a problem; reviewing changes and pictures; terminal text and copy; home-screen shortcuts; the folder browser; search; control vibration; and opening a pane from an alert. `tests/e2e/alerts.browser.ts` covers turning alerts on/off and the worker showing a pushed alert; it runs on the full Chromium build because the old headless shell reports granted notifications as denied.

These are browser checks, not physical Android IME, camera, momentum scrolling, lock/unlock or network-handoff validation. The opt-in mutating real-Herdr test remains skipped by default.

### On an Android emulator or phone

`bun run test:android` runs `tests/android/` in the real Chrome app on the one device `adb devices` lists, and skips when there is none (on CI, it fails instead). It taps through Android's input system (`adb shell input tap`), types with `adb shell input text`, and reads whether the Android keyboard is up from `dumpsys input_method`. It checks that tapping the terminal raises the keyboard only while controlling, that the keyboard types live input, that Keys replaces it, and that Release puts it away.

Playwright attaches to Chrome's DevTools socket through `adb forward`, because its own Android mode needs Chrome to read command-line flags, which Google Play images ignore. The fixture runs on `127.0.0.1:8793` and reaches the device through `adb reverse`, so it never shares a fixture with the browser projects. Each test force-stops Chrome and removes both forwards when it finishes. On a fresh device it skips Chrome's welcome screens by making Chrome the debug app, which reads `/data/local/tmp/chrome-command-line`. CI runs these tests in a separate workflow, described in [CI and releases](ci.md#android).
