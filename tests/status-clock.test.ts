import { describe, expect, test } from 'bun:test';
import { ActivityLog } from '../src/activity.ts';
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

  test('agents asking, finishing, starting and closing are logged from the second look on', () => {
    let now = 1000;
    const log = new ActivityLog();
    const clock = new StatusClock(() => now, log);
    const named = (pane_id: string, status: string) => ({ ...pane('w1:' + pane_id, status), label: pane_id.toUpperCase() });
    const shell = { ...pane('w1:sh', 'idle'), agent: undefined };
    const look = (...panes: Pane[]) => clock.stamp({ panes, workspaces: [{ workspace_id: 'w1', label: 'atlas' }], tabs: [] });
    look(named('p1', 'blocked'), named('p2', 'working'), shell); // Already there: nothing to report.
    now = 2000; look(named('p1', 'blocked'), named('p2', 'blocked'), named('p3', 'working'), shell);
    now = 3000; look(named('p1', 'working'), named('p2', 'done'), named('p3', 'working'));
    now = 4000; look(named('p2', 'done'), named('p3', 'working'));
    expect(log.since(0).map(event => [event.at, event.kind, event.name])).toEqual([
      [2000, 'asked', 'P2'], [2000, 'started', 'P3'], [3000, 'finished', 'P2'], [4000, 'closed', 'P1'],
    ]);
    expect(log.since(3000)).toEqual([{ at: 4000, kind: 'closed', pane_id: 'w1:p1', name: 'P1', workspace: 'atlas', agent: 'pi' }]);
  });

  test('the log keeps a day of events', () => {
    const log = new ActivityLog();
    const item = pane('w1:p1', 'blocked');
    log.record(1000, 'asked', item, state(item));
    log.record(1000 + 25 * 3600 * 1000, 'finished', item, state(item));
    expect(log.since(0).map(event => event.kind)).toEqual(['finished']);
  });
});
