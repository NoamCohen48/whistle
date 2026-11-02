import type { Pane, Snapshot } from '../shared/api.ts';
import { activityKind, type ActivityLog } from './activity.ts';

// Herdr says what each agent is doing but not since when, so the host notes when it saw each
// status change. A status already there when the host first looked has no start time: the phone
// shows no age for it rather than a wrong one.
export class StatusClock {
  private seen = new Map<string, { status: string; since?: number; pane: Pane }>();
  private looked = false;
  // The log, when given, gets each agent's changes as the clock sees them.
  constructor(private readonly now = Date.now, private readonly log?: ActivityLog) {}

  stamp(state: Snapshot): Snapshot {
    const now = this.now();
    const first = !this.looked;
    this.looked = true;
    const next = new Map<string, { status: string; since?: number; pane: Pane }>();
    const panes = state.panes.map(pane => {
      const key = `${pane.pane_id}:${pane.terminal_id}`;
      const status = pane.agent_status || '';
      const previous = this.seen.get(key);
      // A pane that appears after the first look started then, so its age is known.
      const since = previous ? previous.status === status ? previous.since : now : first ? undefined : now;
      next.set(key, { status, since, pane });
      if (pane.agent && !first) {
        const kind = previous ? previous.status !== status && activityKind(status) : 'started';
        if (kind) this.log?.record(now, kind, pane, state);
      }
      return since === undefined ? pane : { ...pane, status_since: since };
    });
    for (const [key, { pane }] of this.seen) if (pane.agent && !next.has(key)) this.log?.record(now, 'closed', pane, state);
    this.seen = next;
    return { ...state, panes, now };
  }
}
