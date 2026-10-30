import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileBoundary } from './changes.ts';
import { HttpError } from './http-error.ts';
import { isInside } from './paths.ts';
import { sniffPicture } from './picture-types.ts';

// Pictures an agent made (screenshots, charts), shown on the phone. Only picture files inside
// the pane's project are readable, checked by their bytes; nothing else on the PC is served.
const MAX_PICTURE_BYTES = 15 * 1024 * 1024;
const EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

export async function readPicture(cwd: string, path: string) {
  if (!path || path.length > 4096 || path.includes('\0')) throw new HttpError('Invalid path');
  if (!EXTENSIONS.test(path)) throw new HttpError('Only PNG, JPEG, WebP and GIF pictures can be shown.', 415);
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  const root = await realpath(await fileBoundary(cwd));
  let real: string, info: Awaited<ReturnType<typeof lstat>>;
  try { real = await realpath(full); info = await lstat(real); }
  catch { throw new HttpError('That picture does not exist.', 404); }
  if (real === root || !isInside(real, root)) throw new HttpError('Only pictures inside this pane’s project can be shown.', 403);
  if (!info.isFile()) throw new HttpError('That picture does not exist.', 404);
  if (info.size > MAX_PICTURE_BYTES) throw new HttpError('That picture is larger than 15 MB.', 413);
  const handle = await open(real, 'r');
  try {
    const bytes = Buffer.alloc(info.size);
    await handle.read(bytes, 0, info.size, 0);
    const kind = sniffPicture(bytes);
    if (!kind) throw new HttpError('That file is not a picture.', 415);
    return { bytes, type: kind.type };
  } finally { await handle.close(); }
}
