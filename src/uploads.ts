import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Pictures sent from the phone for an agent to read. The PC only stores them: the phone puts
// the saved path into the draft, and the person still sends that draft themselves.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_LIFETIME_MS = 3 * 24 * 3600 * 1000;

// Checked against the bytes, never the client's file name or Content-Type alone.
const kinds = [
  { type: 'image/png', ext: 'png', magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: 'jpg', magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', ext: 'webp', magic: (b: Buffer) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { type: 'image/gif', ext: 'gif', magic: (b: Buffer) => /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)) },
];

export class UploadError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function saveUpload(directory: string, contentType: string, bytes: Buffer, now = new Date()) {
  if (!bytes.length) throw new UploadError('The picture is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError('The picture is larger than 10 MB.', 413);
  const kind = kinds.find(item => item.type === contentType.split(';')[0].trim().toLowerCase());
  if (!kind || !kind.magic(bytes)) throw new UploadError('Only PNG, JPEG, WebP and GIF pictures can be attached.', 415);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const path = join(directory, `${stamp}-${randomBytes(4).toString('hex')}.${kind.ext}`);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  return path;
}

// Removes pictures older than the lifetime. Only files this module names are touched.
export async function sweepUploads(directory: string, now = Date.now(), lifetime = UPLOAD_LIFETIME_MS) {
  let names: string[];
  try { names = await readdir(directory); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!/^\d{8}-\d{6}-[0-9a-f]{8}\.(png|jpg|webp|gif)$/.test(name)) continue;
    const path = join(directory, name);
    try {
      if (now - (await stat(path)).mtimeMs > lifetime) { await unlink(path); removed++; }
    } catch { /* Already gone. */ }
  }
  return removed;
}
