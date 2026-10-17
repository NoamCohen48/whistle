import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPicture } from '../src/pictures.ts';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);

test('pictures are readable inside the pane project only, and only real pictures', async () => {
  const base = await mkdtemp(join(tmpdir(), 'whistle-pictures-'));
  try {
    const project = join(base, 'project');
    await mkdir(join(project, 'shots'), { recursive: true });
    await Bun.spawn(['git', 'init', '-q', project]).exited;
    await writeFile(join(project, 'shots', 'home.png'), png);
    await writeFile(join(project, 'fake.png'), '<script>alert(1)</script>');
    await writeFile(join(project, 'notes.txt'), 'secret');
    await writeFile(join(base, 'outside.png'), png);
    await symlink(join(base, 'outside.png'), join(project, 'link.png'));

    // Relative to the pane folder, or absolute; a subfolder pane can reach the whole repository.
    expect(await readPicture(project, 'shots/home.png')).toEqual({ bytes: png, type: 'image/png' });
    expect((await readPicture(join(project, 'shots'), join(project, 'shots', 'home.png'))).type).toBe('image/png');
    expect((await readPicture(join(project, 'shots'), '../shots/home.png')).type).toBe('image/png');

    await expect(readPicture(project, 'notes.txt')).rejects.toMatchObject({ status: 415 });
    await expect(readPicture(project, 'fake.png')).rejects.toMatchObject({ status: 415 });
    await expect(readPicture(project, '../outside.png')).rejects.toMatchObject({ status: 403 });
    await expect(readPicture(project, join(base, 'outside.png'))).rejects.toMatchObject({ status: 403 });
    await expect(readPicture(project, 'link.png')).rejects.toMatchObject({ status: 403 });
    await expect(readPicture(project, 'missing.png')).rejects.toMatchObject({ status: 404 });
    await expect(readPicture(project, 'a\0.png')).rejects.toMatchObject({ status: 400 });
    await expect(readPicture(project, '')).rejects.toMatchObject({ status: 400 });

    // Outside Git the pane folder itself is the boundary.
    const plain = join(base, 'plain');
    await mkdir(plain);
    await writeFile(join(plain, 'chart.png'), png);
    expect((await readPicture(plain, 'chart.png')).type).toBe('image/png');
    await expect(readPicture(plain, '../outside.png')).rejects.toMatchObject({ status: 403 });
  } finally { await rm(base, { recursive: true, force: true }); }
});
