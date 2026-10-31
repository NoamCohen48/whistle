# Changelog

Whistle follows [semantic versioning](https://semver.org). Each release's notes on GitHub come from its section here.

## 0.3.0 (2026-10-31)

- Agents that need you are marked where they are on the home screen, so rows never move under your finger.
- Swipe sideways with two fingers on the terminal to move to the next or previous agent.
- A left-hand layout for the dock, in Settings.
- Tapping Start again after a lost reply opens the agent it already started, not a second one.
- Report a problem, in Settings, opens a GitHub issue filled in with your app and browser versions. You read it and submit it yourself.
- Attach text and code files in Compose, as well as pictures.
- Tap a file path an agent printed, like `src/app.ts:42`, to read that file at that line. Only files inside the pane's project open.
- Tap a web link in the terminal to open it in a new tab, including links a program embeds in its text.
- Install with Nix: `nix profile install github:NoamCohen48/whistle`.
- Herd rows say how long an agent has been in its state, such as "needs you · 4m". A finished agent you haven't opened on this phone is marked unseen; once you open it, it no longer counts as needing you.
- Quick replies: phrases you keep in Settings, sent with one tap from Compose, like Send.
- Save chords you use often to the top of Keys, and lock Ctrl, Alt or Shift on for a run of keys.
- `whistle doctor` checks Herdr, the host, the address your phone opens, HTTPS and alerts, and says what to fix.
- On tablets and desktops, the herd stays beside the open terminal.
- Fixed: the herd list and actions failed with "AbortSignal.any is not a function" in Chrome before version 116.

## 0.2.0 (2026-10-31)

- A cleaner phone screen: icon buttons in the header and dock, and status filter chips on the home screen.
- Take control with the hand button, then tap the terminal to type. The slashed hand at the top releases control. While you only watch, tapping the terminal never opens the keyboard.
- Long-press a pane on the home screen for its menu: rename, close, or start another agent beside it.
- Settings has its own button in the header.
- Picking several pictures at once attaches all of them, even when one cannot be read.
- If an agent fails to start, its warning now stays on screen.
- The website shows the new phone screen and explains that your phone needs its own way to reach the PC, such as Tailscale or Cloudflare Tunnel.

## 0.1.0 (2026-10-30)

The first public release.

- See every Herdr pane on your phone, grouped by workspace, with linked worktrees nested and agents that need you listed first.
- Watch a pane without changing your desktop, then take control to type into the real terminal, with a Keys drawer for modifiers and chords.
- Compose longer prompts, attach pictures, and keep a separate draft for each pane. Send pastes the draft and presses Enter.
- Start agents, terminals, workspaces and worktrees from the phone, with a folder browser for the PC. Rename and close panes, review a pane's Git changes, and show pictures from its project.
- Alerts over Web Push when an agent needs you or finishes, with quiet hours.
- Scroll through terminal history with touch fling, a drag handle and a Latest button. Search and copy terminal text.
- Install as a phone app, with home-screen shortcuts, when served over HTTPS.
- Pair phones with single-use QR codes. Pairings last 90 days and can be revoked from the PC or the phone.
- Runs as a systemd user service from a single executable. Downloads for x86-64 and ARM64: `.deb`, `.rpm`, Arch package, archive, single file and a one-line installer.
