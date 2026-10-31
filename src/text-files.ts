import { HttpError } from './http-error.ts';
import { requestPath } from './paths.ts';
import { projectFile } from './pictures.ts';

// Text an agent pointed at (a file path it printed), shown read-only on the phone. The same
// project boundary as pictures applies; files that are not UTF-8 text are refused.
const MAX_TEXT_BYTES = 512 * 1024;

// UTF-8 without NUL bytes: what Whistle treats as text, never the file name.
export function decodeText(bytes: Uint8Array) {
  if (bytes.includes(0)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
}

export async function readTextFile(cwd: string, input: string | null) {
  const path = requestPath(input);
  const text = decodeText(await projectFile(cwd, path, 'file', MAX_TEXT_BYTES));
  if (text === undefined) throw new HttpError('That file is not text, so it cannot be shown here.', 415);
  return text;
}
