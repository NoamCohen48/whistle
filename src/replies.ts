import { isId } from './actions.ts';
import { rpc } from './herdr.ts';
import { HttpError } from './http-error.ts';
import { SUBMIT_DELAY_MS } from './terminal-socket.ts';
import type { Pane } from '../shared/api.ts';

// Replies sent from an alert's buttons, without opening Whistle. A reply answers one wait: it is
// typed only while the agent still waits on the same thing the alert was about, nobody controls
// the pane, and that wait has not been answered yet. It is never retried.
export interface AlertReply { paneId: string; since: number; text: string }

export function parseAlertReply(input: unknown): AlertReply {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const { paneId, since, text } = body;
  if (typeof paneId !== 'string' || !isId(paneId)) throw new Error('Invalid pane');
  if (typeof since !== 'number' || !Number.isSafeInteger(since)) throw new Error('Invalid alert');
  if (typeof text !== 'string' || !text.trim() || text.length > 500 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Invalid reply');
  return { paneId, since, text };
}

const DAY = 24 * 3600 * 1000;
export class AlertReplies {
  // Waits already answered, by pane and start time, with when they were answered.
  private readonly answered = new Map<string, number>();
  constructor(private readonly options: {
    pane: (paneId: string) => Promise<Pane>; isControlled: (paneId: string) => boolean;
    type?: (paneId: string, text: string) => Promise<void>; now?: () => number;
  }) {}

  async send({ paneId, since, text }: AlertReply) {
    const now = this.options.now?.() ?? Date.now();
    for (const [key, at] of this.answered) if (now - at > DAY) this.answered.delete(key);
    const wait = `${paneId}@${since}`;
    if (this.answered.has(wait)) throw new HttpError('This alert was already answered. Nothing more was sent.', 409);
    const pane = await this.options.pane(paneId).catch(error => {
      throw error instanceof HttpError && error.status === 404 ? new HttpError('This agent is no longer open. Nothing was sent.', 404) : error;
    });
    if (!pane.agent || (pane.agent_status !== 'blocked' && pane.agent_status !== 'done') || pane.status_since !== since) {
      throw new HttpError('The agent moved on since this alert. Nothing was sent.', 409);
    }
    if (this.options.isControlled(paneId)) throw new HttpError('Someone is typing in this pane from Whistle. Nothing was sent.', 409);
    // Marked before typing, so a second tap cannot send it twice.
    this.answered.set(wait, now);
    await (this.options.type ?? typeAndSubmit)(paneId, text);
  }
}

// Types the text, then presses Enter as its own key once the program has taken it in.
async function typeAndSubmit(paneId: string, text: string) {
  await rpc('pane.send_text', { pane_id: paneId, text });
  await Bun.sleep(SUBMIT_DELAY_MS);
  await rpc('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
}

// The pane as the host's status clock sees it, so its wait's start can be compared.
export const stampedPane = (panes: () => Promise<{ panes: Pane[] }>) => async (paneId: string) => {
  const pane = (await panes()).panes.find(item => item.pane_id === paneId);
  if (!pane) throw new HttpError('Pane no longer exists', 404);
  return pane;
};
