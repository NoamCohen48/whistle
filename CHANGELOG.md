# Changelog

Whistle follows [semantic versioning](https://semver.org). Each release's notes on GitHub come from its section here.

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
