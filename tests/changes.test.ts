import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, fileDiff } from '../src/changes.ts';

async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn(['git', '-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { stdout: 'ignore', stderr: 'pipe' });
  if (await child.exited !== 0) throw new Error(await new Response(child.stderr).text());
}
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'whistle-changes-'));
  await run(root, 'init', '-q', '-b', 'main');
  await writeFile(join(root, 'app.ts'), 'one\ntwo\nthree\n');
  await writeFile(join(root, 'old.ts'), 'gone\n');
  await writeFile(join(root, 'moved.ts'), 'a\nb\nc\nd\ne\n');
  await writeFile(join(root, 'logo.bin'), Buffer.from([0, 1, 2, 3]));
  await run(root, 'add', '.');
  await run(root, 'commit', '-q', '-m', 'start');
  return root;
}

test('lists committed-against changes, renames, binaries and untracked files', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'app.ts'), 'one\n2\nthree\nfour\n');
    await rm(join(root, 'old.ts'));
    await run(root, 'mv', 'moved.ts', 'renamed.ts');
    await writeFile(join(root, 'logo.bin'), Buffer.from([0, 9, 9]));
    await writeFile(join(root, 'notes.md'), '# Notes\nfirst\n');
    await writeFile(join(root, 'debug.log'), 'ignored\n');
    await writeFile(join(root, '.gitignore'), '*.log\n');
    await symlink('/etc/hostname', join(root, 'outside'));
    await run(root, 'checkout', '-q', '-b', 'feature/review');

    const result = await changes(join(root));
    expect(result.branch).toBe('feature/review');
    expect(result.truncated).toBe(false);
    expect(result.files).toEqual([
      { path: '.gitignore', status: 'untracked', added: 1, removed: 0, binary: false },
      { path: 'app.ts', status: 'modified', added: 2, removed: 1, binary: false },
      { path: 'logo.bin', status: 'modified', added: 0, removed: 0, binary: true },
      { path: 'notes.md', status: 'untracked', added: 2, removed: 0, binary: false },
      { path: 'old.ts', status: 'deleted', added: 0, removed: 1, binary: false },
      { path: 'outside', status: 'untracked', added: 0, removed: 0, binary: false },
      { path: 'renamed.ts', from: 'moved.ts', status: 'renamed', added: 0, removed: 0, binary: false },
    ]);

    const app = await fileDiff(root, 'app.ts');
    expect(app.diff).toStartWith('@@ ');
    expect(app.diff).toContain('-two\n+2\n');
    expect(app.diff).toContain('+four\n');
    expect(app.diff).not.toContain('diff --git');
    expect((await fileDiff(root, 'notes.md')).diff).toBe('@@ -0,0 +1,2 @@\n+# Notes\n+first\n');
    expect(await fileDiff(root, 'logo.bin')).toEqual({ diff: '', binary: true, truncated: false });

    // Only listed changes are readable: not ignored files, unchanged files, traversal or symlinks out.
    for (const path of ['debug.log', 'renamed.ts/../../etc/passwd', '../etc/passwd', '/etc/passwd', 'missing.ts']) {
      await expect(fileDiff(root, path)).rejects.toThrow('no changes');
    }
    await expect(fileDiff(root, 'outside')).rejects.toThrow('can no longer be read');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a clean tree, a subfolder, a fresh repository and a plain folder', async () => {
  const root = await repository();
  const plain = await mkdtemp(join(tmpdir(), 'whistle-plain-'));
  const fresh = await mkdtemp(join(tmpdir(), 'whistle-fresh-'));
  try {
    expect((await changes(root)).files).toEqual([]);
    await Bun.write(join(root, 'src', 'deep.ts'), 'x\n');
    expect((await changes(join(root, 'src'))).files.map(file => file.path)).toEqual(['src/deep.ts']);
    await run(fresh, 'init', '-q');
    await writeFile(join(fresh, 'a.txt'), 'hello\n');
    await run(fresh, 'add', 'a.txt');
    expect((await changes(fresh)).files).toEqual([{ path: 'a.txt', status: 'added', added: 1, removed: 0, binary: false }]);
    await expect(changes(plain)).rejects.toThrow('not a Git repository');
  } finally {
    await Promise.all([root, plain, fresh].map(path => rm(path, { recursive: true, force: true })));
  }
});
