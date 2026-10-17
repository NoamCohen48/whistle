import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFolders } from '../src/folders.ts';

test('lists only visible folders inside home, marking Git projects', async () => {
  const base = await mkdtemp(join(tmpdir(), 'whistle-folders-'));
  const home = join(base, 'home');
  try {
    await mkdir(join(home, 'Work', 'tap', '.git'), { recursive: true });
    await mkdir(join(home, 'Work', 'site'));
    await mkdir(join(home, 'Work', '.cache'));
    await mkdir(join(base, 'outside'));
    await writeFile(join(home, 'Work', 'notes.md'), 'x');
    await symlink(join(home, 'Work', 'site'), join(home, 'Work', 'site-link'));
    await symlink(join(base, 'outside'), join(home, 'Work', 'escape'));
    await symlink(join(home, 'missing'), join(home, 'Work', 'broken'));

    const list = await listFolders('~/Work', home);
    expect(list.path).toBe(join(home, 'Work'));
    expect(list.folders).toEqual([
      { name: 'site', repo: false }, { name: 'site-link', repo: false }, { name: 'tap', repo: true },
    ]);
    expect((await listFolders('~/', home)).folders).toEqual([{ name: 'Work', repo: false }]);
    expect((await listFolders('', home)).folders).toEqual([{ name: 'Work', repo: false }]);

    await expect(listFolders('~/Work/escape', home)).rejects.toThrow('inside your home');
    await expect(listFolders(base, home)).rejects.toThrow('inside your home');
    await expect(listFolders('~/../', home)).rejects.toThrow('inside your home');
    await expect(listFolders('~/Work/nope', home)).rejects.toThrow('does not exist');
    await expect(listFolders('~/Work/notes.md', home)).rejects.toThrow('a file');
    await expect(listFolders('Work', home)).rejects.toThrow('absolute path');
  } finally { await rm(base, { recursive: true, force: true }); }
});
