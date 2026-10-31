# Design principles

## Goal

Use the coding agents already running on a PC from a phone. Whistle is a remote client for Herdr, not a remote-agent service or a replacement harness. It keeps the same CLI processes and sessions, and adds no model calls, reconstructed prompts or wrappers of its own.

## Principles

- Android first, with iPhone support in scope.
- Herdr's workspaces, tabs and panes are the source of truth.
- Terminal first: no required chat layer and no parsing of agent-specific dialogs.
- Live input while controlling: typing, deletion, arrows and Enter act on the real terminal, and desktop changes show on the phone.
- An optional Compose editor for long prompts, dictation, selection and multiline editing, with separate Paste and Paste + Enter.
- A compact row of immediate keys: Enter, Esc, Tab, arrows and Ctrl. Keys are sent at once, never queued.
- Watching must not change desktop geometry or focus. Taking control explicitly may fit the width to the phone, with an Original width override in the pane menu, and restores it on release.
- Pane identity survives reconnects, and connection state is always visible. Input is never replayed after a connection failure, and never carried over into another pane.
- The network is the user's existing private network, such as Tailscale. Whistle adds no relay, tunnel or cloud service, and does not change the user's network setup.

## Not in scope

Agent-chat rendering, inferred approval buttons, transcript parsing, a full file or Git client, multi-machine orchestration, and native app packaging.

## Related projects

- [Collie](https://github.com/AltanS/collie) attaches to existing Herdr sessions. Its raw view uses rendered rows, and its input delivery infers agent behaviour. Its ADR 0008 discusses snapshot mirroring against observe/control. See the [full comparison](collie-comparison.md).
- [VibeTunnel](https://github.com/amantus-ai/vibetunnel) is terminal first, but forwards wrapped sessions rather than discovering existing Herdr panes.
- [ttyd](https://github.com/tsl0922/ttyd) is a straightforward browser terminal.
- [Happy](https://github.com/slopus/happy) is a mobile interaction reference built around a harness, which is not this project's direction.
- [Mosh](https://mosh.org) sets expectations for reconnection; it is not a proposed transport.
