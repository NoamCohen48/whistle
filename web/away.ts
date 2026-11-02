import type { Activity, ActivityKind, ActivityList } from '../shared/api.ts';
import { request } from './request.ts';

// "While you were away": what agents did since this phone last looked at the herd. The phone
// keeps when it last looked, by the PC's clock (for asking the PC) and its own (for how long).
const KEY = 'whistle:last-look';
// Shorter breaks than this are just glancing away.
export const AWAY_MS = 2 * 60_000;
export interface Look { hostNow: number; localAt: number }

export function readLastLook(): Look | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Look> | null;
    return typeof value?.hostNow === 'number' && typeof value.localAt === 'number' ? { hostNow: value.hostNow, localAt: value.localAt } : undefined;
  } catch { return undefined; }
}
export function saveLastLook(look: Look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* Not remembered: no summary next time. */ }
}

// Events after `after` (PC clock), with times moved to this phone's clock.
export async function loadActivity(after: number, signal?: AbortSignal): Promise<Activity[]> {
  const response = await request(`/api/activity?after=${after}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(await response.text());
  const { events, now } = await response.json() as ActivityList;
  const local = Date.now();
  return events.map(event => ({ ...event, at: local - Math.max(0, now - event.at) }));
}

const WORDS: Record<ActivityKind, string> = { asked: 'needed you', finished: 'finished', started: 'started', closed: 'closed' };
export interface AwayRow { paneId: string; name: string; workspace?: string; what: string; last: number; closed: boolean }
// One row per agent, newest first: what it did, in order, with repeats counted.
export function summarise(events: Activity[]): AwayRow[] {
  const rows = new Map<string, { row: AwayRow; kinds: Map<ActivityKind, number> }>();
  for (const event of events) {
    const entry = rows.get(event.pane_id) ?? { row: { paneId: event.pane_id, name: event.name, workspace: event.workspace, what: '', last: 0, closed: false }, kinds: new Map() };
    entry.kinds.set(event.kind, (entry.kinds.get(event.kind) ?? 0) + 1);
    entry.row.last = Math.max(entry.row.last, event.at);
    entry.row.closed = event.kind === 'closed';
    rows.set(event.pane_id, entry);
  }
  return [...rows.values()].map(({ row, kinds }) => ({
    ...row, what: [...kinds].map(([kind, count]) => count > 1 ? `${WORDS[kind]} ${count}×` : WORDS[kind]).join(', '),
  })).sort((a, b) => b.last - a.last);
}
