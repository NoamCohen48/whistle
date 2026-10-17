import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { projectRoot } from './changes.ts';
import { sniffPicture } from './uploads.ts';

// Pictures an agent made (screenshots, charts), shown on the phone. Only picture files inside
// the pane's project are readable, checked by their bytes; nothing else on the PC is served.
export const MAX_PICTURE_BYTES = 15 * 1024 * 1024;
const EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

export class PictureError extends Error {
  constructor(message: string, readonly status = 404) { super(message); }
}

export async function readPicture(cwd: string, path: string) {
  if (!path || path.length > 4096 || path.includes('\0')) throw new PictureError('Invalid path', 400);
  if (!EXTENSIONS.test(path)) throw new PictureError('Only PNG, JPEG, WebP and GIF pictures can be shown.', 415);
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  const root = await realpath(await projectRoot(cwd));
  let real: string, info: Awaited<ReturnType<typeof lstat>>;
  try { real = await realpath(full); info = await lstat(real); }
  catch { throw new PictureError('That picture does not exist.'); }
  if (!real.startsWith(root + sep)) throw new PictureError('Only pictures inside this pane’s project can be shown.', 403);
  if (!info.isFile()) throw new PictureError('That picture does not exist.');
  if (info.size > MAX_PICTURE_BYTES) throw new PictureError('That picture is larger than 15 MB.', 413);
  const handle = await open(real, 'r');
  try {
    const bytes = Buffer.alloc(info.size);
    await handle.read(bytes, 0, info.size, 0);
    const kind = sniffPicture(bytes);
    if (!kind) throw new PictureError('That file is not a picture.', 415);
    return { bytes, type: kind.type };
  } finally { await handle.close(); }
}
