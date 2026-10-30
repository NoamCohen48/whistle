import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFolders } from '../src/folders.ts';

test('lists only visible folders inside home, marking Git projects', async () => {
  const base = await mkdtemp(join(tmpdir(), 'whistle-folders-'));
  const home = join(base, 'home');
  try {
    await mkdir(join(home, 'projects', 'atlas', '.git'), { recursive: true });
    await mkdir(join(home, 'projects', 'site'));
    await mkdir(join(home, 'projects', '.cache'));
    await mkdir(join(base, 'outside'));
    await writeFile(join(home, 'projects', 'notes.md'), 'x');
    await symlink(join(home, 'projects', 'site'), join(home, 'projects', 'site-link'));
    await symlink(join(base, 'outside'), join(home, 'projects', 'escape'));
    await symlink(join(home, 'missing'), join(home, 'projects', 'broken'));

    const list = await listFolders('~/projects', home);
    expect(list.path).toBe(join(home, 'projects'));
    expect(list.folders).toEqual([
      { name: 'atlas', repo: true }, { name: 'site', repo: false }, { name: 'site-link', repo: false },
    ]);
    expect((await listFolders('~/', home)).folders).toEqual([{ name: 'projects', repo: false }]);
    expect((await listFolders('', home)).folders).toEqual([{ name: 'projects', repo: false }]);

    await expect(listFolders('~/projects/escape', home)).rejects.toThrow('inside your home');
    await expect(listFolders(base, home)).rejects.toThrow('inside your home');
    await expect(listFolders('~/../', home)).rejects.toThrow('inside your home');
    await expect(listFolders('~/projects/nope', home)).rejects.toThrow('does not exist');
    await expect(listFolders('~/projects/notes.md', home)).rejects.toThrow('a file');
    await expect(listFolders('projects', home)).rejects.toThrow('absolute path');
  } finally { await rm(base, { recursive: true, force: true }); }
});
