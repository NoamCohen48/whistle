import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFile } from '../src/text-files.ts';
import { findLinks, findPaths, findUrls, webUrl } from '../web/paths.ts';

test('text files are readable inside the pane project only, and only as text', async () => {
  const base = await mkdtemp(join(tmpdir(), 'whistle-text-'));
  try {
    const project = join(base, 'project');
    await mkdir(join(project, 'src'), { recursive: true });
    await Bun.spawn(['git', 'init', '-q', project]).exited;
    await writeFile(join(project, 'src', 'app.ts'), 'export const answer = 42; // ✓\n');
    await writeFile(join(project, 'build.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1]));
    await writeFile(join(project, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    await writeFile(join(project, 'huge.log'), 'x'.repeat(512 * 1024 + 1));
    await writeFile(join(base, 'secret.txt'), 'outside');
    await symlink(join(base, 'secret.txt'), join(project, 'link.txt'));

    expect(await readTextFile(project, 'src/app.ts')).toBe('export const answer = 42; // ✓\n');
    expect(await readTextFile(join(project, 'src'), join(project, 'src', 'app.ts'))).toContain('answer');
    await expect(readTextFile(project, 'build.bin')).rejects.toMatchObject({ status: 415 });
    await expect(readTextFile(project, 'latin1.txt')).rejects.toMatchObject({ status: 415 });
    await expect(readTextFile(project, 'huge.log')).rejects.toMatchObject({ status: 413, message: 'That file is larger than 512 KB.' });
    await expect(readTextFile(project, '../secret.txt')).rejects.toMatchObject({ status: 403 });
    await expect(readTextFile(project, 'link.txt')).rejects.toMatchObject({ status: 403 });
    await expect(readTextFile(project, 'src')).rejects.toMatchObject({ status: 404 });
    await expect(readTextFile(project, 'missing.ts')).rejects.toMatchObject({ status: 404 });
    await expect(readTextFile(project, '')).rejects.toMatchObject({ status: 400 });
  } finally { await rm(base, { recursive: true, force: true }); }
});

describe('paths in terminal text', () => {
  const paths = (text: string) => findPaths(text).map(({ path, line }) => line ? `${path}:${line}` : path);

  test('finds relative and absolute paths, with the line an agent named', () => {
    expect(paths('Updated src/routes.ts:148 and ./web/App.tsx:12:5.')).toEqual(['src/routes.ts:148', './web/App.tsx:12']);
    expect(paths('Wrote /home/sam/projects/atlas/notes.md, then ../shared/api.ts')).toEqual(['/home/sam/projects/atlas/notes.md', '../shared/api.ts']);
    expect(paths('see (docs/plan.md) and "README.md"')).toEqual(['docs/plan.md', 'README.md']);
    expect(paths('● Read(package.json)')).toEqual(['package.json']);
  });

  test('leaves out URLs, home paths, versions and words that only look like files', () => {
    expect(paths('https://example.com/guide.md and file:///tmp/a.ts')).toEqual([]);
    expect(paths('~/notes.md user@example.com v1.2.3 example.com')).toEqual([]);
    expect(paths('src/routes')).toEqual([]);
  });

  test('reports where each path starts and ends', () => {
    expect(findPaths('at src/a.ts:3 x')).toEqual([{ start: 3, end: 13, path: 'src/a.ts', line: 3 }]);
  });
});

describe('web addresses in terminal text', () => {
  const urls = (text: string) => findUrls(text).map(match => match.url);

  test('finds http and https addresses without the punctuation around them', () => {
    expect(urls('Open https://example.com/docs.')).toEqual(['https://example.com/docs']);
    expect(urls('(see http://localhost:5173/app?x=1&y=2), then "https://a.io/b"')).toEqual(['http://localhost:5173/app?x=1&y=2', 'https://a.io/b']);
    expect(urls('https://en.wikipedia.org/wiki/Fish_(disambiguation) is kept whole')).toEqual(['https://en.wikipedia.org/wiki/Fish_(disambiguation)']);
    expect(urls('ftp://example.com javascript:alert(1) file:///etc/passwd example.com')).toEqual([]);
  });

  test('paths and addresses come back in order, and a path inside an address is not a path', () => {
    expect(findLinks('Edited src/a.ts:3, see https://x.io/src/b.ts').map(match => match.kind === 'url' ? match.url : match.path))
      .toEqual(['src/a.ts', 'https://x.io/src/b.ts']);
  });

  test('only http and https are ever opened', () => {
    expect(webUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url']) expect(webUrl(value)).toBeUndefined();
  });
});
