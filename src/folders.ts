import { homedir } from 'node:os';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { hostPath } from './actions.ts';

// Folder names for picking a new workspace's folder on the phone. Read-only and limited to the
// home folder: only directory names are listed, never files, hidden folders or anything outside home.
export const MAX_FOLDERS = 400;
export interface FolderEntry { name: string; repo: boolean }
export interface FolderList { path: string; folders: FolderEntry[]; truncated: boolean }

export class FolderError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

export async function listFolders(input: string, home = homedir()): Promise<FolderList> {
  let path: string;
  try { path = resolve(hostPath(input.trim() || '~', home)); }
  catch (error) { throw new FolderError((error as Error).message); }
  const root = await realpath(home);
  let real: string;
  try {
    real = await realpath(path);
    if (!(await stat(real)).isDirectory()) throw new FolderError('This is a file, not a folder.');
  } catch (error) {
    if (error instanceof FolderError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES') throw new FolderError('This folder cannot be read.', 403);
    throw new FolderError('This folder does not exist.', 404);
  }
  if (!inside(real, root)) throw new FolderError('Only folders inside your home folder can be browsed.', 403);
  let entries;
  try { entries = await readdir(real, { withFileTypes: true }); }
  catch { throw new FolderError('This folder cannot be read.', 403); }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) { names.push(entry.name); continue; }
    if (!entry.isSymbolicLink()) continue;
    try { // A link counts only when it leads to a folder that is also inside home.
      const target = await realpath(join(real, entry.name));
      if (inside(target, root) && (await stat(target)).isDirectory()) names.push(entry.name);
    } catch { /* Broken link. */ }
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  const shown = names.slice(0, MAX_FOLDERS);
  const folders = await Promise.all(shown.map(async name => ({
    name, repo: await lstat(join(real, name, '.git')).then(() => true, () => false),
  })));
  return { path, folders, truncated: names.length > shown.length };
}
