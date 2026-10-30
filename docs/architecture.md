# Production architecture decisions

## Confirmed scope

- Web/PWA first, Android-first with iPhone support in scope.
- Terminal-first control of existing Herdr processes, not a replacement harness.
- Minimal, functional UI.
- The user's private network (such as Tailscale) is infrastructure. Whistle never changes firewall rules or network settings.

## Accepted: standalone PC companion service

Phone PWA → Whistle companion service → Herdr → existing agents.

Whistle runs as a separate process, not inside Herdr. This permits independent updates and restarts without interrupting Herdr or its agents. A future official Herdr integration is possible, but an upstream fork or modification is not required for the first release.

Responsibilities:

- Serve the bundled frontend and pair/authenticate devices.
- Discover running Herdr sessions, panes, and agent state.
- Manage subscriptions, phone control ownership, ordered input, resizing and release.
- Persist paired devices and settings.
- Open terminal streams for viewed panes; do not continuously stream every agent.
- Make no model calls and do not own agent lifecycles.

Stopping, restarting, updating, or uninstalling the Whistle service must not stop Herdr or its agents. Disconnecting a phone must release its control lease, not terminate its target process.

### Linux lifecycle

Use a systemd user service, running as the user rather than root. Start after login and restart on crashes. Do not silently enable user lingering/running after logout.

The companion CLI and standalone native packaging are implemented; installation is always explicit. See [host lifecycle](host.md) and [packaging](packaging.md):

```text
whistle install
whistle start
whistle stop
whistle status
whistle pair
whistle devices
whistle revoke DEVICE_ID
whistle restart
whistle uninstall
whistle version
```

The service should discover multiple running Herdr sessions rather than depend permanently on the inherited `HERDR_SOCKET_PATH` of the pane that launched it. Session discovery, selection and compatibility checks still need detailed design. Identifiers must be scoped by session; two sessions may contain identical public pane IDs.

## Accepted frontend stack

React + Vite + TypeScript for application UI, with xterm.js in a dedicated imperative terminal controller outside React's frame-rendering loop.

See [frontend boundaries and checks](frontend.md).

## Host direction and remaining proposals

- Bun + TypeScript host with a systemd user-service CLI, XDG config/state/data paths and graceful stream release is implemented. A standalone executable embeds Bun and the frontend, installs private immutable releases, and preserves durable pairings across source-to-binary upgrades.
- SQLite is implemented for durable, revocable device pairings with hashed credentials. No Herdr transcripts are duplicated; host settings live in an owner-only config JSON outside the checkout.
- HTTP for setup/settings and a versioned WebSocket protocol for terminal/control traffic.
- Shared protocol schemas/types at browser/host boundaries.
- Plain CSS with variables; no CSS framework or component library.

No need for Next.js/SSR, native mobile packaging, cloud relay infrastructure, a Rust rewrite, or a multi-multiplexer plugin system in the initial release.

## Required safety boundaries

- Herdr owns processes, workspaces, panes and terminal state.
- Whistle owns authentication, subscriptions and phone control leases.
- The browser owns navigation, drafts, modifiers and local viewport behavior.
- Input must be bound to a session, pane, connection and control lease. No replay after reconnect and no carry-over to another pane.
- Text and logical key events must remain ordered. A write acknowledgement is not proof that the target application acted on it.
- Preserve the validated tall-terminal/cursor-aligned local viewport; do not infer and reconstruct agent UIs.
- Pairings must survive normal Whistle restarts and be revocable. Persist hashed session credentials rather than raw cookie secrets.
- Cache only the application shell for PWA use, not sensitive terminal output or credentials. Do not log terminal contents by default.

## Next architecture questions

- Release garbage collection for `~/.local/share/whistle/releases/`, and a schema-compatible rollback policy.
- Multi-session discovery and stable session-scoped identity.
- Control lease revocation guarantees across the Herdr adapter.
- Live inventory subscriptions, reconnection and resource bounds.
- More physical-phone validation: Android keyboards, lock/unlock and network handoff.
