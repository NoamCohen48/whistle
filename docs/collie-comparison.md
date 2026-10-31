# Whistle and Collie compared

Written on 2026-10-31, comparing [Collie](https://github.com/AltanS/collie) v1.25.2 (commit `039adc5`) with Whistle 0.2.0. Sources: Collie's code, docs, decision records (ADRs) and README screenshots.

Collie is a much bigger product built on a different idea of what the phone should show. Whistle is a small, real remote terminal.

## At a glance

| | **Collie** (v1.25.2) | **Whistle** (v0.2.0) |
|---|---|---|
| Size | About 415k lines of TypeScript excluding tests, 125 ADRs, 30+ docs | About 5.6k lines excluding tests |
| Popularity and pace | About 1.5k stars and 196 forks, started June 2026, releases almost daily | New |
| What the phone shows | By default, a **chat view** rebuilt from the agent's own session logs. Otherwise, a text copy of the screen, refreshed by polling | The **real terminal** (xterm), streamed live |
| How screen updates arrive | The host reads Herdr every **1.5 s** by default (`COLLIE_POLL_MS`), and the phone polls the host. Herdr's events make the reads come sooner | A live stream |
| How you type | A text box and **Send**, after which Collie checks the text landed. Optional "Type" mode sends keys straight to the terminal | Take control, then every key goes to the real terminal at once. Compose is optional |
| Agent prompts | Parsed into tappable buttons, with rules written separately for about 10 agents (Claude, Codex, OpenCode, Pi, omp, Grok, Hermes, Kiro and others) | Nothing is parsed. Every agent works the same way |
| Supported systems | Herdr; Herdr core, tmux and zellij experimental. Linux, macOS, Windows | Herdr on Linux |
| Number of machines | Several PCs behind one address ("crews") | One PC |

## The basic difference

Collie decided on purpose not to show the real terminal. Its ADR 0008, "Collie does not run a terminal emulator", argues that a raw screenful is the wrong thing to show on a phone.

- It reads Herdr's already-drawn screen as plain styled text, rows of words with colours. There's no real terminal emulator in the browser.
- It looks for known prompt shapes in that text: permission dialogs, menus and wizards. It turns them into buttons.
- Since 1.17 the default view for an agent pane is **Chat** (ADR 0082). Collie reads the agent's own conversation log files and draws them as chat messages.

Whistle does the reverse. [Design principles](product.md) says "Terminal first: no required chat layer and no parsing of agent-specific dialogs."

This one choice explains most of the other differences:

- **Collie's strength:** answering is a tap, and history goes back further than the terminal's scrollback.
- **Collie's cost:** each agent needs its own rules, which break when the agent changes its UI. Collie tracks verified agent versions, keeps recorded screen captures, and runs a "harness canary" to catch these breaks. A pane it can't read falls back to the text copy, which updates about every 1.5 seconds.
- **Whistle's strength:** it works the same for any program in the pane, is exactly what's on the desktop, and typing is instant.

## What Collie has that Whistle doesn't

### Answering agents

- Permission prompts, menus and `AskUserQuestion` dialogs become tappable buttons.
- **Quick** replies: one-tap phrases you define in `quick-replies.toml`, such as yes, no, continue, "commit and push", retry, skip.
- **Agent** tab: slash commands set up per agent.
- After Send, a "Sent ✓" confirmation, and the row switches from blocked to working.
- Chat view rebuilt from the agent's own session logs.
- Its own voice input, off until you set it up, with a choice of engine. One engine runs on the phone itself; Collie calls that engine **"whistle"**, which clashes with our name.
- Attachments beyond pictures: Markdown, text and code files.
- File paths the agent prints become links (ADR 0088).

### Dashboard

- A summary line: "1 needs you · 2 unseen · 5 working · 1 done · 1 idle". The **unseen** status, a finished result you haven't looked at yet, has no equivalent in Whistle.
- How long each pane has been in its state (2m, 26m, "cold").
- Agent icons per row, a SHELL badge, workspace filter chips, and per-workspace counts.
- Rows never move when their status changes (ADR 0063). Urgency is a mark on the row, not a new position. Whistle moves agents that need you to the top.
- Pins, rename and close by long-press, and "show in my desktop terminal".
- Footer tabs: Panes, Needs you, Changes.

### Inside a pane

- A bottom bar with Keys, Type, Quick and Agent tabs. A reply field and a large Send button are always visible.
- The Keys board can be rearranged by the user (ADR 0092):
  - wider keys, your own chords and sequences;
  - sticky Ctrl, Alt and Shift;
  - presets for Claude Code, prefix keys and Vim, and F-keys;
  - a code to share a layout.
- **Type** mode sends keys straight into the terminal. While it's on, a red "typing into the terminal" banner with a Stop button is shown, added after someone left it on by mistake.
- Swipe with two fingers to move between panes (ADR 0121).
- On large screens the pane screen becomes a strip (ADR 0120).
- A left-handed layout option.

### Files and Git

- A Files screen for the workspace folder, with changed files marked and image previews.
- A Changes view that reads Git only, never writes: coloured diffs and the last commit.

### Starting agents

- One New page: machine, agent or command, folder, optional new worktree.
- You can add your own launchers from the phone, and there's a history of one-off commands.
- Each launch has a request ID, so a lost reply never opens a second pane (ADR 0091).

### Settings and appearance

- 12 languages.
- 4 themes, plus importing your own theme file (43 colour tokens).
- A choice of app font and terminal font, per device.
- Dark, light or follow the phone.
- An idle lock and haptics settings.

### Running it

- Update from the phone, roll back, two release lines.
- `collie doctor`, `collie skill` (instructions an agent can follow to install it), and a "Report a problem" issue filled in for you after three failed sends.
- Packages: Nix, AUR, a Windows zip, a Herdr plugin, and five deployment variants. Cloudflare Access sign-ins are checked directly.
- Tailscale identity check (`COLLIE_TRUSTED_USER`) layered under pairing.

### Larger systems

- **Crews:** several machines behind one address, with manual failover.
- **Walky talky:** agents send each other messages, with receipts.
- **Durable agents:** your own long-running agent programs shown as sessions, with an SDK on npm.
- Usage numbers taken from the agent's statusline or the vendor's usage endpoint.

## What Whistle has that Collie doesn't

- **The real terminal, live.** Full xterm with colours and cursor, streamed rather than refreshed every 1.5 s. Every TUI works, not only the ones with rules written for them.
- **Live typing while in control.** Backspace, arrows and Enter act at once, and desktop changes appear right away. Collie's normal path is type, Send, then check it landed.
- **Watch first, then take control.** Opening a pane never changes the desktop. Taking control fits the width to the phone and restores it on release. Collie's ADR 0008 lists "pane stuck narrow" and "pans on nearly every line" as width problems it doesn't control.
- **Nothing to update per agent.** A new version of Claude or Codex can't break Whistle's input. Collie needs per-agent rules, version pinning and a canary.
- **Terminal history:** swipe through it, a drag handle, a Latest button, and search and copy of terminal text.
- **A Compose draft per pane**, with Paste and Paste + Enter kept separate.
- **Simpler pairing:** one QR scan, single-use, valid for 5 minutes, nothing to type. Collie needs `collie qr`, then `collie pair`, then typing a code in Settings.
- **Alerts are end-to-end encrypted** and carry only the pane name.
- **Native packages** (.deb, .rpm, Arch) with release checksums and build provenance, plus tests on a real Android emulator.
- **Small and easy to audit.** About 1/75 of Collie's code, for a tool that gives a phone shell access.

## UI comparison

| | Collie | Whistle |
|---|---|---|
| Look | Dark, terminal-flavoured. A rounded tech font (Aldrich), coloured status dots, bordered cards. All-caps section labels (SPACES, KEYS, QUICK) | Calmer, with icon buttons. The terminal fills the screen, and the toolbar appears only while you're in control |
| Home | Status summary line, workspace chips, cards grouped by workspace, timers and agent icons on each row | Status filter chips (All, Needs you, Working), grouped by workspace, waiting agents first, pins |
| Pane screen | Header, then tab and pane pills, then the screen or chat, then the four-tab bar, then a reply field that's always visible | Header, then the terminal, then a dock that shows the hand button while you watch, and Compose, Keys, Esc and Enter while you control |
| Input | Always offered. A message box is the main path | Hidden until you take control |
| Density | A lot of UI at once: about 6 rows of controls under the terminal when Keys is open | Less on screen, so more terminal shows |
| Customising | Very deep: themes, fonts, languages, hand, key layout | Little: font size, PC width |

Collie's `DESIGN.md` is about 1,000 lines of strict rules, such as "no state may move content", "red marks harm, never emphasis", and "back goes up one level". Several are worth reading even without copying the UI.

## What to borrow, and what not to

These fit Whistle's principles, because none of them parse the agent's screen. In rough order of value:

1. **Quick replies** you define yourself, sent the same way Paste + Enter works.
2. **Time in state** on herd rows ("needs you · 4m"), and possibly an **unseen** status for "finished, not looked at yet".
3. **Saved custom chords** in Keys, and maybe sticky modifiers.
4. **Rows stay where they are when their status changes**, with urgency shown as a mark. Reordering can move a row while you're about to tap it.
5. **A two-finger swipe between panes** and a **left-hand option** for the dock.
6. **Duplicate-safe launches** (a request ID on New) and a **Report a problem** shortcut.
7. **Text and code file attachments** in Compose.

Leave out the parsed prompt buttons, Chat view, crews, walky talky and durable agents. [Design principles](product.md) puts those deliberately out of scope, and they're the source of most of Collie's size and maintenance work.

Separately, Collie's built-in speech engine is called "whistle", which is worth knowing if Whistle becomes more visible.
