import { createHash } from 'node:crypto';
import type { AlertSettings, Pane, Snapshot } from '../shared/api.ts';
import { PushGone, type PushSend, type PushSubscription } from './webpush.ts';

// "Needs you" alerts: the PC polls Herdr and, when an agent turns blocked or done, sends each
// subscribed phone an alert over Web Push.

// `replies` become buttons on the alert; `since` names the wait they answer, so a reply sent
// after the agent moved on is refused rather than typed into whatever it does next.
export interface Alert { title: string; body: string; paneId: string; quiet?: boolean; replies?: string[]; since?: number }

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export function parseSettings(input: unknown): AlertSettings {
  const body = input as Partial<AlertSettings> | null;
  if (!body || typeof body !== 'object' || typeof body.finished !== 'boolean') throw new Error('Invalid alert settings');
  if (body.replies !== undefined && typeof body.replies !== 'boolean') throw new Error('Invalid alert settings');
  // Reply buttons are on unless turned off, so only "off" is stored.
  const replies = body.replies === false ? { replies: false } : {};
  if (body.quiet === undefined || body.quiet === null) return { finished: body.finished, ...replies };
  const { start, end, timeZone } = body.quiet;
  if (typeof start !== 'string' || typeof end !== 'string' || !CLOCK.test(start) || !CLOCK.test(end) || start === end) throw new Error('Invalid quiet hours');
  if (typeof timeZone !== 'string' || timeZone.length > 64) throw new Error('Invalid time zone');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new Error('Invalid time zone'); }
  return { finished: body.finished, ...replies, quiet: { start, end, timeZone } };
}
export function isQuiet(settings: AlertSettings, now = new Date()) {
  if (!settings.quiet) return false;
  const { start, end, timeZone } = settings.quiet;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  // Overnight ranges such as 22:00–07:00 wrap past midnight.
  return start < end ? clock >= start && clock < end : clock >= start || clock < end;
}

export type AlertSender = (deviceId: string, alert: Alert) => Promise<void>;
// Sends to a device's saved subscription; alerts for the same pane replace each other if undelivered.
export function alertSender(subscription: (deviceId: string) => PushSubscription | undefined, send: PushSend): AlertSender {
  return async (deviceId, alert) => {
    const saved = subscription(deviceId);
    if (!saved) throw new PushGone('Not subscribed');
    await send(saved, alert, createHash('sha256').update(alert.paneId).digest('base64url').slice(0, 32));
  };
}

// A phone's quick replies, as alert buttons: short single lines only.
export const MAX_REPLIES = 12;
export function parseReplies(input: unknown): string[] {
  const replies = (input as { replies?: unknown } | null)?.replies;
  if (!Array.isArray(replies) || replies.length > MAX_REPLIES
    || !replies.every(reply => typeof reply === 'string' && reply.trim() && reply.length <= 500 && !/[\x00-\x1f\x7f]/.test(reply))) {
    throw new Error('Invalid quick replies');
  }
  return replies.map(reply => reply.trim());
}

const waiting = (pane: Pane) => pane.agent && (pane.agent_status === 'blocked' || pane.agent_status === 'done') ? pane.agent_status : undefined;
function alertFor(state: Snapshot, pane: Pane, question: string): Alert {
  const name = pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id;
  const workspace = state.workspaces.find(item => item.workspace_id === pane.workspace_id);
  const where = [workspace?.label || workspace?.name, pane.agent].filter(Boolean).join(' · ');
  return {
    title: waiting(pane) === 'blocked' ? `${name} needs you` : `${name} finished`,
    // What the agent asks (or last said) comes first: a phone shows the first line folded.
    body: question ? `${question}\n${where}` : where,
    paneId: pane.pane_id,
    ...(pane.status_since === undefined ? {} : { since: pane.status_since }),
  };
}

// Edge-triggered: an alert fires when a known agent changes into blocked/done, never for
// panes already waiting when the watcher starts, and never twice for the same wait.
export class AgentWatcher {
  private previous?: Map<string, string | undefined>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly options: {
    snapshot: () => Promise<Snapshot>; subscribers: () => string[]; send: AlertSender;
    isActive: (deviceId: string) => boolean; isWatching: (deviceId: string, paneId: string) => boolean;
    onGone: (deviceId: string) => void; onError?: (error: Error) => void;
    settings?: (deviceId: string) => AlertSettings; now?: () => Date;
    // What a pane asks or last said, for the alert's text; and a device's quick replies.
    question?: (pane: Pane) => Promise<string>; replies?: (deviceId: string) => string[];
  }) {}

  // Ticks every `intervalMs`, skipping a tick while the previous one is still running.
  // A failed tick (Herdr briefly unavailable) is reported to `onError` and retried next time.
  start(intervalMs: number) {
    let running = false;
    this.timer = setInterval(() => {
      if (running) return;
      running = true;
      void this.tick().catch(error => this.options.onError?.(error as Error)).finally(() => { running = false; });
    }, intervalMs);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  async tick() {
    const devices = this.options.subscribers();
    if (!devices.length) { this.previous = undefined; return; }
    const state = await this.options.snapshot();
    const current = new Map(state.panes.map(pane => [`${pane.pane_id}:${pane.terminal_id}`, waiting(pane)]));
    const previous = this.previous;
    this.previous = current;
    if (!previous) return;
    const changed = state.panes.filter(pane => {
      const key = `${pane.pane_id}:${pane.terminal_id}`;
      return waiting(pane) && previous.has(key) && previous.get(key) !== waiting(pane);
    });
    // An unreadable pane still alerts, just without its text.
    const alerts = await Promise.all(changed.map(async pane => ({
      alert: alertFor(state, pane, await this.options.question?.(pane).catch(() => '') ?? ''), finished: waiting(pane) === 'done',
    })));
    const now = this.options.now?.() ?? new Date();
    await Promise.all(devices.flatMap(deviceId => {
      if (!this.options.isActive(deviceId)) { this.options.onGone(deviceId); return []; }
      const settings = this.options.settings?.(deviceId) ?? { finished: true };
      const quiet = isQuiet(settings, now);
      // Reply buttons need the wait's start, which the host knows for every change it saw.
      const replies = settings.replies === false ? [] : this.options.replies?.(deviceId) ?? [];
      return alerts.filter(({ alert, finished }) => (settings.finished || !finished) && !this.options.isWatching(deviceId, alert.paneId)).map(({ alert }) =>
        this.options.send(deviceId, { ...alert, ...(quiet ? { quiet } : {}), ...(replies.length && alert.since !== undefined ? { replies } : {}) }).catch(error => {
          if (error instanceof PushGone) this.options.onGone(deviceId);
          else this.options.onError?.(error as Error);
        }));
    }));
  }
}
