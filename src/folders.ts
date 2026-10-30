import { homedir } from 'node:os';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HttpError } from './http-error.ts';
import { hostPath, isInside } from './paths.ts';
import type { FolderList } from '../shared/api.ts';

// Folder names for picking a new workspace's folder on the phone. Read-only and limited to the
// home folder: only directory names are listed, never files, hidden folders or anything outside home.
const MAX_FOLDERS = 400;

export async function listFolders(input: string, home = homedir()): Promise<FolderList> {
  let path: string;
  try { path = resolve(hostPath(input.trim() || '~', home)); }
  catch (error) { throw new HttpError((error as Error).message); }
  const root = await realpath(home);
  let real: string;
  try {
    real = await realpath(path);
    if (!(await stat(real)).isDirectory()) throw new HttpError('This is a file, not a folder.');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES') throw new HttpError('This folder cannot be read.', 403);
    throw new HttpError('This folder does not exist.', 404);
  }
  if (!isInside(real, root)) throw new HttpError('Only folders inside your home folder can be browsed.', 403);
  let entries;
  try { entries = await readdir(real, { withFileTypes: true }); }
  catch { throw new HttpError('This folder cannot be read.', 403); }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) { names.push(entry.name); continue; }
    if (!entry.isSymbolicLink()) continue;
    try { // A link counts only when it leads to a folder that is also inside home.
      const target = await realpath(join(real, entry.name));
      if (isInside(target, root) && (await stat(target)).isDirectory()) names.push(entry.name);
    } catch { /* Broken link. */ }
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  const shown = names.slice(0, MAX_FOLDERS);
  const folders = await Promise.all(shown.map(async name => ({
    name, repo: await lstat(join(real, name, '.git')).then(() => true, () => false),
  })));
  return { path, folders, truncated: names.length > shown.length };
}
