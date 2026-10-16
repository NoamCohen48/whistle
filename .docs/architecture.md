# Production architecture decisions

## Confirmed scope

- Web/PWA first, Android-first with iPhone support in scope.
- First production release is the operator's personal daily driver.
- Terminal-first control of existing Herdr processes, not a replacement harness.
- Minimal functional UI; a separate UI/UX agent owns visual refinement.
- Existing Tailscale is infrastructure. Do not silently change firewall rules; the operator explicitly prefers temporary exceptions, not permanent ones.

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

Use a systemd user service, running as the operator rather than root. Start after login and restart on crashes. Do not silently enable user lingering/running after logout. Do not install a service or change system settings until implementing the agreed lifecycle explicitly.

Proposed CLI commands (not implemented):

```text
whistle install
whistle status
whistle pair
whistle restart
whistle uninstall
```

The service should discover multiple running Herdr sessions rather than depend permanently on the inherited `HERDR_SOCKET_PATH` of the pane that launched it. Session discovery, selection and compatibility checks still need detailed design. Identifiers must be scoped by session; two sessions may contain identical public pane IDs.

## Accepted frontend stack

React + Vite + TypeScript for application UI, with xterm.js in a dedicated imperative terminal controller outside React's frame-rendering loop. This replaces the vanilla PoC frontend; there are not two maintained frontends.

The migration is implemented. See [frontend boundaries and checks](frontend.md). Existing styling is retained deliberately for a later UI/UX pass.

## Host direction and remaining proposals

- Retain the existing Bun + TypeScript host while implementing the companion-service lifecycle.
- SQLite is implemented for durable, revocable device pairings with hashed credentials. No Herdr transcripts are duplicated; settings persistence is separate.
- HTTP for setup/settings and a versioned WebSocket protocol for terminal/control traffic.
- Shared protocol schemas/types at browser/host boundaries.
- Keep the existing CSS variables and baseline CSS for now. A CSS framework or component library is not selected; that can be decided during the UI/UX pass.

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

- Packaging/install mechanism (a single executable with bundled frontend is the preferred direction, not yet implemented).
- Host lifecycle, configuration/state directories and updates.
- Multi-session discovery and stable session-scoped identity.
- Control lease revocation guarantees across the Herdr adapter.
- Live inventory subscriptions, reconnection and resource bounds.
- Service packaging and cutover from the old memory-only PoC (one re-pair is required at that first cutover).
