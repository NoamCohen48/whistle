import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installExecutable } from '../src/releases.ts';

const checksum = (body: string) => createHash('sha256').update(body).digest('hex');
test('release publication is content-addressed, private, repeatable and never overwrites a previous build', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-release-'));
  try {
    const source = join(home, 'download'); const data = join(home, 'data');
    await writeFile(source, 'first build', { mode: 0o755 });
    const first = await installExecutable(source, data);
    expect(first).toBe(join(data, 'releases', checksum('first build'), 'whistle'));
    expect(await readFile(first, 'utf8')).toBe('first build');
    expect((await stat(first)).mode & 0o777).toBe(0o700);
    expect((await stat(dirname(first))).mode & 0o777).toBe(0o700);
    expect(await installExecutable(first, data)).toBe(first);
    await writeFile(source, 'second build');
    const second = await installExecutable(source, data);
    expect(second).not.toBe(first); expect(await readFile(first, 'utf8')).toBe('first build');
    expect(await readFile(second, 'utf8')).toBe('second build');
    expect(await readdir(dirname(second))).toEqual(['whistle']);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('concurrent publication reuses the same verified release without temporary files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-release-race-'));
  try {
    const source = join(home, 'download'); await writeFile(source, 'same build');
    const paths = await Promise.all([installExecutable(source, join(home, 'data')), installExecutable(source, join(home, 'data'))]);
    expect(paths[0]).toBe(paths[1]); expect(await readdir(dirname(paths[0]))).toEqual(['whistle']);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('release installation refuses foreign contents or symlinks without replacing them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-release-foreign-'));
  try {
    const source = join(home, 'download'); await writeFile(source, 'selected build');
    const destination = join(home, 'data/releases', checksum('selected build'), 'whistle');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, 'unrelated program', { mode: 0o644 });
    await expect(installExecutable(source, join(home, 'data'))).rejects.toThrow('refusing to modify');
    expect(await readFile(destination, 'utf8')).toBe('unrelated program');
    expect((await stat(destination)).mode & 0o777).toBe(0o644);
    await rm(destination); await symlink(source, destination);
    await expect(installExecutable(source, join(home, 'data'))).rejects.toThrow('refusing to modify');
    expect(await readFile(source, 'utf8')).toBe('selected build');
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('release directories cannot redirect installation through symlinks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-release-directory-'));
  try {
    const source = join(home, 'download'); await writeFile(source, 'selected build');
    const other = join(home, 'other'); await mkdir(other); await chmod(other, 0o755);
    const data = join(home, 'data'); await symlink(other, data);
    await expect(installExecutable(source, data)).rejects.toThrow('symlink release directory');
    expect(await readdir(other)).toEqual([]); expect((await stat(other)).mode & 0o777).toBe(0o755);
    await rm(data); await mkdir(data); await symlink(other, join(data, 'releases'));
    await expect(installExecutable(source, data)).rejects.toThrow('symlink release directory');
    expect(await readdir(other)).toEqual([]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
