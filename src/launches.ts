import type { Action, ActionResult } from '../shared/api.ts';

// A phone that lost the reply to "Start agent" may send it again. A repeat with the same
// request ID, from the same phone, for the same action gets the first launch's result instead
// of opening a second pane. Failures are forgotten, so a real retry runs again.
const LIFETIME_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

export const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);

export class Launches {
  private readonly entries = new Map<string, { at: number; result: Promise<ActionResult> }>();
  constructor(private readonly now = Date.now) {}

  run(deviceId: string, requestId: string | undefined, action: Action, perform: () => Promise<ActionResult>) {
    if (!requestId) return perform();
    const time = this.now();
    for (const [key, entry] of this.entries) if (time - entry.at > LIFETIME_MS) this.entries.delete(key);
    const key = JSON.stringify([deviceId, requestId, action]);
    const found = this.entries.get(key);
    if (found) return found.result;
    const result = perform();
    this.entries.set(key, { at: time, result });
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    result.catch(() => { if (this.entries.get(key)?.result === result) this.entries.delete(key); });
    return result;
  }
}
