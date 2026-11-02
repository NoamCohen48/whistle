import type { Activity, ActivityKind, Pane, Snapshot } from '../shared/api.ts';

// What agents did, as the host saw it: the "while you were away" summary on the phone. Kept in
// memory only, for a day and at most a few hundred events, so a restarted host starts empty.
const KEEP_MS = 24 * 3600 * 1000;
const KEEP_EVENTS = 500;

export class ActivityLog {
  private events: Activity[] = [];

  record(at: number, kind: ActivityKind, pane: Pane, state: Snapshot) {
    const workspace = state.workspaces.find(item => item.workspace_id === pane.workspace_id);
    this.events.push({ at, kind, pane_id: pane.pane_id, name: pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id,
      ...(workspace?.label || workspace?.name ? { workspace: workspace.label || workspace.name } : {}), ...(pane.agent ? { agent: pane.agent } : {}) });
    const oldest = at - KEEP_MS;
    this.events = this.events.filter(event => event.at >= oldest).slice(-KEEP_EVENTS);
  }

  // Events strictly after `after`, by the host's clock, oldest first.
  since(after: number) { return this.events.filter(event => event.at > after); }
}

// Which change a status move is, for an agent: waiting on you, finishing a turn, or neither.
export function activityKind(status: string): ActivityKind | undefined {
  return status === 'blocked' ? 'asked' : status === 'done' ? 'finished' : undefined;
}
