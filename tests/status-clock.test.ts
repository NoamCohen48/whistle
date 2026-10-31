import { describe, expect, test } from 'bun:test';
import { StatusClock } from '../src/status-clock.ts';
import type { Pane, Snapshot } from '../shared/api.ts';

const pane = (pane_id: string, agent_status: string): Pane => ({ pane_id, terminal_id: `t-${pane_id}`, workspace_id: 'w1', tab_id: 'tab1', agent: 'pi', agent_status });
const state = (...panes: Pane[]): Snapshot => ({ panes, workspaces: [], tabs: [] });

describe('status clock', () => {
  test('a status already there at the first look has no start time', () => {
    const clock = new StatusClock(() => 1000);
    const stamped = clock.stamp(state(pane('w1:p1', 'blocked')));
    expect(stamped.panes[0].status_since).toBeUndefined();
    expect(stamped.now).toBe(1000);
  });

  test('a change is dated when the host sees it, and the date holds while the status stays', () => {
    let now = 1000;
    const clock = new StatusClock(() => now);
    clock.stamp(state(pane('w1:p1', 'working')));
    now = 5000;
    expect(clock.stamp(state(pane('w1:p1', 'blocked'))).panes[0].status_since).toBe(5000);
    now = 9000;
    const later = clock.stamp(state(pane('w1:p1', 'blocked')));
    expect(later.panes[0].status_since).toBe(5000);
    expect(later.now).toBe(9000);
  });

  test('a pane that appears later is dated from when it appeared', () => {
    let now = 1000;
    const clock = new StatusClock(() => now);
    clock.stamp(state());
    now = 2000;
    expect(clock.stamp(state(pane('w1:p2', 'idle'))).panes[0].status_since).toBe(2000);
  });
});
