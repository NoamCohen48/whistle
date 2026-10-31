import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http-error.ts';
import { pictureTypes } from './picture-types.ts';
import { decodeText } from './text-files.ts';

// Pictures and text files sent from the phone for an agent to read. The PC only stores them:
// the phone puts the saved path into the draft, and the person still sends that draft themselves.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024;
const UPLOAD_LIFETIME_MS = 3 * 24 * 3600 * 1000;
// Names this module gives: a stamp, a random part, then a picture extension or the file's own name.
export const UPLOAD_NAME = /^\d{8}-\d{6}-[0-9a-f]{8}(?:\.(?:png|jpg|webp|gif)|-[A-Za-z0-9._-]{1,80})$/;

// A file name from the phone, reduced to letters, digits, dots, dashes and underscores so the
// saved path is one word in a draft. Its extension is kept, so the agent knows what it reads.
export function safeFileName(name: string | null) {
  const base = (name || '').split(/[\\/]/).pop()!.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+/, '');
  if (!base.replace(/[._-]/g, '')) return 'file.txt';
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot, dot + 16) : '';
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, 80 - extension.length) + extension;
}

export async function saveUpload(directory: string, contentType: string, bytes: Buffer, now = new Date(), name: string | null = null) {
  const type = contentType.split(';')[0].trim().toLowerCase();
  let suffix: string;
  if (type === 'text/plain') {
    if (!bytes.length) throw new HttpError('The file is empty.');
    if (bytes.length > MAX_TEXT_UPLOAD_BYTES) throw new HttpError('The file is larger than 1 MB.', 413);
    if (decodeText(bytes) === undefined) throw new HttpError('Only text and code files can be attached; this one is not UTF-8 text.', 415);
    suffix = `-${safeFileName(name)}`;
  } else {
    if (!bytes.length) throw new HttpError('The picture is empty.');
    if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError('The picture is larger than 10 MB.', 413);
    // The declared type must match the bytes.
    const kind = pictureTypes.find(item => item.type === type);
    if (!kind || !kind.magic(bytes)) throw new HttpError('Only pictures and text files can be attached.', 415);
    suffix = `.${kind.ext}`;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const path = join(directory, `${stamp}-${randomBytes(4).toString('hex')}${suffix}`);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  return path;
}

// Removes uploads older than the lifetime. Only files this module names are touched.
export async function sweepUploads(directory: string, now = Date.now(), lifetime = UPLOAD_LIFETIME_MS) {
  let names: string[];
  try { names = await readdir(directory); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!UPLOAD_NAME.test(name)) continue;
    const path = join(directory, name);
    try {
      if (now - (await stat(path)).mtimeMs > lifetime) { await unlink(path); removed++; }
    } catch { /* Already gone. */ }
  }
  return removed;
}
