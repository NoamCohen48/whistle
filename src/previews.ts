import { stripVTControlCharacters } from 'node:util';
import { rpc } from './herdr.ts';
import type { Pane } from '../shared/api.ts';

export function previewLine(text: string): string {
  const lines = stripVTControlCharacters(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').split(/[\r\n]/);
  const line = lines.reverse().find(line => line.trim())?.trim() || '';
  return Array.from(line).slice(0, 120).join('');
}

// A bounded parallel read batch. Slow/missing panes are omitted, never allowed to hold
// up the list indefinitely. pane.read does not claim an agent, focus, resize or scroll.
export async function panePreviews(panes: Pane[], read = rpc, budgetMs = 1500): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const deadline = Date.now() + budgetMs;
  let index = 0;
  async function worker() {
    while (index < panes.length && Date.now() < deadline) {
      const pane = panes[index++];
      try {
        const response = await read<{ text: string }>('pane.read', {
          pane_id: pane.pane_id, source: 'recent', lines: 6, format: 'text', strip_ansi: true,
        }, Math.max(1, deadline - Date.now()));
        result[pane.pane_id] = previewLine(response.text);
      } catch { /* A closed or busy pane need not prevent the rest of the list. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, panes.length) }, () => worker()));
  return result;
}
