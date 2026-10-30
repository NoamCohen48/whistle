import { validateChord } from './keys.ts';

// The terminal WebSocket between the phone and the host, as JSON text messages.

// Phone to host. Input and keys carry an increasing id that the host acknowledges.
export type ClientCommand =
  | { type: 'input'; id: number; text: string; submit?: boolean }
  | { type: 'key'; id: number; key: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'scroll'; direction: 'up' | 'down'; lines: number }
  | { type: 'ping' };

// Host to phone. After an error the host closes the connection.
export type ServerMessage =
  | { type: 'terminal.frame'; bytes: string; width: number; height: number; seq: number; full: boolean; mode: 'observe' | 'control' }
  | { type: 'ack'; id: number }
  | { type: 'key-rejected'; id: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || Number(cols) < 2 || Number(cols) > 500 || Number(rows) < 2 || Number(rows) > 200) {
    throw new Error('Terminal size must be 2–500 columns and 2–200 rows');
  }
  return { cols: Number(cols), rows: Number(rows) };
}

export function parseCommand(raw: string): ClientCommand {
  if (raw.length > 128 * 1024) throw new Error('Input exceeds 128 KiB');
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Malformed JSON command'); }
  if (!value || typeof value !== 'object') throw new Error('Invalid command');
  if (value.type === 'ping') return { type: 'ping' };
  if (value.type === 'resize') return { type: 'resize', ...dimensions(value.cols, value.rows) };
  if (value.type === 'scroll' && ['up', 'down'].includes(value.direction) && Number.isInteger(value.lines) && value.lines > 0 && value.lines <= 100) {
    return { type: 'scroll', direction: value.direction, lines: value.lines };
  }
  if (value.type === 'key' && Number.isSafeInteger(value.id) && value.id > 0) {
    return { type: 'key', id: value.id, key: validateChord(value.key) };
  }
  if (value.type === 'input' && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.text === 'string' && value.text.length <= 64 * 1024) {
    return { type: 'input', id: value.id, text: value.text, ...(value.submit === true ? { submit: true } : {}) };
  }
  throw new Error('Invalid command');
}
