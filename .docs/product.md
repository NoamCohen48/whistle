# Whistle: remote Herdr

## Goal

Use the actual coding agents already running on the PC, from a phone. This is a remote Herdr client, not a remote-agent service or replacement harness.

The operator has tried Telegram bots, T3 Code, and other tools. Collie's Herdr integration is promising, but its agent UI is unhelpful (especially with Pi), and typing/submission/deletion feel disconnected. Raw terminal interaction is preferred.

The operator reports much faster Claude subscription consumption through T3 than through the terminal. The cause is unverified. Whistle's architectural constraint is to keep the same CLI process and session, without additional model calls, reconstructed prompts, or a replacement harness; it cannot guarantee a subscription duration.

## Agreed direction

- Android first; keep iPhone support in scope. The production stack is undecided.
- Existing Herdr spaces, tabs, and panes are authoritative.
- Terminal-first; no required chat abstraction or agent-specific dialog parsing.
- Live input by default: typing, deletion, arrows, and Enter act on the real terminal. Desktop changes should be visible on the phone.
- Optional Compose editor for long prompts, dictation, selection, and multiline editing. Distinct Paste and Paste + Enter actions.
- Compact immediate-action keyboard row: Enter, Esc, Tab, arrows, Ctrl/interrupt. No queued-key composer.
- Watching must not change desktop geometry or focus.
- Explicit Take control should offer phone-fit geometry, with an Original width override and restoration on release. This is a desired behavior, not a verified Herdr capability yet.
- Preserve pane identity across reconnects. Show connection state clearly. Never silently replay input after a connection failure or submit into a newly selected pane.
- Existing Tailscale is solved infrastructure. No WebRTC, Cloudflare, gateway, or networking redesign. Do not change the operator's existing ingress setup.

## Initial milestone

Find a pane → open it → type and edit reliably → submit → lock the phone → reconnect to the same pane.

The first success criterion is a comfortable real Pi session from Android, not a polished dashboard. Test with a separate Pi pane using gpt-5.3-codex-spark where available.

## PoC scope

- List existing panes with workspace context.
- Live terminal rendering and direct keyboard input.
- Explicit watch/control modes.
- Compose, immediate special keys, scrolling, and reconnect.
- Probe sizing/restoration rather than promising unsupported behavior.
- Test in the browser and against a disposable pane; do not write into the operator's unrelated sessions.

Not initially: agent-chat rendering, inferred approval buttons, transcript parsing, full file/Git UI, multi-machine orchestration, polished launcher flows, or native app packaging.

## Research

- Collie: https://github.com/AltanS/collie — attach to existing Herdr sessions. Its raw view uses rendered rows; input delivery uses agent-aware inference. Its ADR 0008 deliberately rejects terminal emulators and documents tradeoffs of snapshot mirroring versus observe/control.
- VibeTunnel: https://github.com/amantus-ai/vibetunnel — terminal-first interaction reference, but normally forwards wrapped sessions rather than discovering existing Herdr panes.
- ttyd: https://github.com/tsl0922/ttyd — straightforward browser terminal reference.
- Happy: https://github.com/slopus/happy — mobile interaction reference, but harness/wrapper direction is not this product's goal.
- Mosh: https://mosh.org — reference for reconnection expectations, not a proposed transport.

## Local findings before implementation

Installed Herdr 0.9.3, protocol schema 22; Collie 1.20.2. Collie is on loopback port 8787, already behind private Tailscale Serve. Playwright's browser is not paired with Collie, so the reported Collie input issue has not been reproduced. No existing agent panes were modified during that inspection.
