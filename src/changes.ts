import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http-error.ts';
import { isInside } from './paths.ts';
import { git, topLevel } from './git.ts';
import type { Changes, FileChange, FileDiff } from '../shared/api.ts';

// Read-only review of a pane's working tree: what changed since the last commit. Nothing here
// stages, commits, checks out or writes; paths come from Herdr's pane cwd, never the browser.
const MAX_FILES = 300;
const MAX_DIFF_BYTES = 256 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// The repository a pane is in, and what its changes are compared with: the last commit, or
// an empty tree before the first one.
interface Repository { root: string; base: string }
async function repository(cwd: string): Promise<Repository> {
  const root = await topLevel(cwd);
  if (!root) throw new HttpError('This folder is not a Git repository.', 422);
  const head = await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], true);
  return { root, base: head.code === 0 ? 'HEAD' : EMPTY_TREE };
}

const diffArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '-M'];

export async function changes(cwd: string): Promise<Changes> {
  return listChanges(await repository(cwd));
}

async function listChanges({ root, base }: Repository): Promise<Changes> {
  const branch = (await git(root, ['branch', '--show-current'], true)).stdout.trim() || undefined;
  const files: FileChange[] = [];
  const status = (await git(root, ['diff', base, '--name-status', '-z', ...diffArgs])).stdout.split('\0');
  for (let i = 0; i < status.length - 1;) {
    const code = status[i++];
    if (code.startsWith('R') || code.startsWith('C')) {
      const from = status[i++], path = status[i++];
      files.push({ path, from, status: code.startsWith('R') ? 'renamed' : 'added', added: 0, removed: 0, binary: false });
    } else {
      files.push({ path: status[i++], status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', added: 0, removed: 0, binary: false });
    }
  }
  const numbers = (await git(root, ['diff', base, '--numstat', '-z', ...diffArgs])).stdout.split('\0');
  for (let i = 0, n = 0; i < numbers.length - 1; n++) {
    const [added, removed, path] = numbers[i++].split('\t');
    if (!path) i += 2; // Renames: "a\tr\t" then from and to.
    const file = files[n];
    if (!file) break;
    file.binary = added === '-';
    file.added = Number(added) || 0; file.removed = Number(removed) || 0;
  }
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean);
  for (const path of untracked.slice(0, MAX_FILES)) {
    const content = await readInside(root, path);
    files.push({ path, status: 'untracked', added: content && !content.binary ? lineCount(content.text) : 0, removed: 0, binary: content?.binary ?? false });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, branch, files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES || untracked.length > MAX_FILES };
}

const lineCount = (text: string) => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;

// Reads a regular file inside the repository only: no symlinks out, no traversal.
async function readInside(root: string, path: string) {
  const full = join(root, path);
  try {
    const real = await realpath(full);
    if (!isInside(real, await realpath(root)) || !(await lstat(full)).isFile()) return undefined;
    const handle = await open(real, 'r');
    try {
      const buffer = Buffer.alloc(MAX_DIFF_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      return { binary: bytes.includes(0), text: bytes.subarray(0, MAX_DIFF_BYTES).toString('utf8'), truncated: bytesRead > MAX_DIFF_BYTES };
    } finally { await handle.close(); }
  } catch { return undefined; }
}

// Only files that are in the current change list can be shown, so this never becomes a way
// to read arbitrary files from the PC.
export async function fileDiff(cwd: string, path: string): Promise<FileDiff> {
  const repo = await repository(cwd);
  const { root, base } = repo;
  const listed = (await listChanges(repo)).files.find(file => file.path === path);
  if (!listed) throw new HttpError('That file has no changes any more.', 404);
  if (listed.binary) return { diff: '', binary: true, truncated: false };
  if (listed.status === 'untracked') {
    const content = await readInside(root, path);
    if (!content) throw new HttpError('That file can no longer be read.', 404);
    if (content.binary) return { diff: '', binary: true, truncated: false };
    const lines = content.text.replace(/\n$/, '').split('\n');
    return { diff: `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`, binary: false, truncated: content.truncated };
  }
  const paths = listed.from ? [listed.from, listed.path] : [listed.path];
  const { stdout } = await git(root, ['diff', base, ...diffArgs, '--', ...paths.map(item => `:(literal)${item}`)]);
  // Drop git's header lines; the sheet already names the file.
  const body = stdout.slice(Math.max(0, stdout.indexOf('\n@@') + 1));
  const truncated = Buffer.byteLength(body) > MAX_DIFF_BYTES;
  return { diff: truncated ? Buffer.from(body).subarray(0, MAX_DIFF_BYTES).toString('utf8').replace(/\n[^\n]*$/, '\n') : body, binary: false, truncated };
}
