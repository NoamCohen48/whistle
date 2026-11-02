import { stripVTControlCharacters } from 'node:util';
import { rpc } from './herdr.ts';
import type { Pane } from '../shared/api.ts';

const plain = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
const clip = (line: string, length: number) => Array.from(line).slice(0, length).join('');

export function previewLine(text: string): string {
  const lines = plain(text).split(/[\r\n]/);
  return clip(lines.reverse().find(line => line.trim())?.trim() || '', 120);
}

// Box drawing and block characters: the frame agents draw around a prompt, which says nothing.
const FRAME = /[\u2500-\u259f]/g;
// "❯ 1. Yes": one choice in a numbered menu, with or without the cursor beside it.
const CHOICE = /^(?:[❯›>▶►→*•]\s*)?(\d{1,2})[.)]\s+(.+)$/;
// "Esc to cancel · Tab to amend": key hints under a prompt.
const HINT = /^(?:esc|enter|return|tab|ctrl|shift|alt|space|↑|↓|←|→)\b.*\b(?:to|for)\b/i;

// What a waiting agent is asking: its last few lines without the frame around them, with a
// numbered menu folded onto one line, so a phone can show it in a row or an alert.
export function questionText(text: string, maxLines = 3): string {
  const lines: { text: string; choice: boolean }[] = [];
  for (const raw of plain(text).split(/[\r\n]/)) {
    const line = raw.replace(FRAME, ' ').replace(/\s+/g, ' ').trim();
    if (!line || HINT.test(line)) continue;
    const choice = CHOICE.exec(line);
    const previous = lines.at(-1);
    if (choice && previous?.choice) previous.text += ` · ${choice[1]}. ${choice[2]}`;
    else lines.push({ text: choice ? `${choice[1]}. ${choice[2]}` : line, choice: Boolean(choice) });
  }
  return lines.slice(-maxLines).map(line => clip(line.text, 160)).join('\n');
}

const asking = (pane: Pane) => Boolean(pane.agent) && pane.agent_status === 'blocked';
// A pane's preview: what it asks if it waits for an answer, otherwise its last line.
// pane.read does not claim an agent, focus, resize or scroll.
export async function panePreview(pane: Pane, read = rpc, timeoutMs = 1500) {
  const response = await read<{ text: string }>('pane.read', {
    pane_id: pane.pane_id, source: 'recent', lines: asking(pane) ? 24 : 6, format: 'text', strip_ansi: true,
  }, timeoutMs);
  return asking(pane) ? questionText(response.text) : previewLine(response.text);
}

// A bounded parallel read batch. Slow/missing panes are omitted, never allowed to hold
// up the list indefinitely.
export async function panePreviews(panes: Pane[], read = rpc, budgetMs = 1500): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const deadline = Date.now() + budgetMs;
  let index = 0;
  async function worker() {
    while (index < panes.length && Date.now() < deadline) {
      const pane = panes[index++];
      try {
        result[pane.pane_id] = await panePreview(pane, read, Math.max(1, deadline - Date.now()));
      } catch { /* A closed or busy pane need not prevent the rest of the list. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, panes.length) }, () => worker()));
  return result;
}
