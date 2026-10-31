import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost, testToken } from './helpers/host.ts';
import { MAX_TEXT_UPLOAD_BYTES, MAX_UPLOAD_BYTES, safeFileName, saveUpload, sweepUploads } from '../src/uploads.ts';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);

test('pictures are saved privately under a generated name after their bytes are checked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-uploads-'));
  try {
    const uploads = join(directory, 'uploads');
    const path = await saveUpload(uploads, 'image/png', png, new Date('2026-10-17T14:32:10Z'));
    expect(path).toMatch(new RegExp(`^${uploads}/20261017-143210-[0-9a-f]{8}\\.png$`));
    expect(await readFile(path)).toEqual(png);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(uploads)).mode & 0o777).toBe(0o700);
    expect(await saveUpload(uploads, 'image/jpeg; charset=binary', jpeg)).toEndWith('.jpg');

    await expect(saveUpload(uploads, 'image/png', jpeg)).rejects.toMatchObject({ status: 415 });
    await expect(saveUpload(uploads, 'image/svg+xml', Buffer.from('<svg/>'))).rejects.toMatchObject({ status: 415 });
    await expect(saveUpload(uploads, 'text/html', png)).rejects.toMatchObject({ status: 415 });
    await expect(saveUpload(uploads, 'image/png', Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
    await expect(saveUpload(uploads, 'image/png', Buffer.concat([png, Buffer.alloc(MAX_UPLOAD_BYTES)]))).rejects.toMatchObject({ status: 413 });
    expect(await readdir(uploads)).toHaveLength(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('text files are saved under their cleaned-up name, and only real UTF-8 text is accepted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-uploads-'));
  try {
    const code = Buffer.from('fn main() {\n    println!("héllo");\n}\n');
    const path = await saveUpload(directory, 'text/plain; charset=utf-8', code, new Date('2026-10-17T14:32:10Z'), 'my main.rs');
    expect(path).toMatch(new RegExp(`^${directory}/20261017-143210-[0-9a-f]{8}-my-main\\.rs$`));
    expect(await readFile(path)).toEqual(code);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await expect(saveUpload(directory, 'text/plain', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1]), new Date(), 'a.out')).rejects.toMatchObject({ status: 415 });
    await expect(saveUpload(directory, 'text/plain', Buffer.from([0x63, 0x61, 0x66, 0xe9]), new Date(), 'latin1.txt')).rejects.toMatchObject({ status: 415 });
    await expect(saveUpload(directory, 'text/plain', Buffer.alloc(0), new Date(), 'empty.txt')).rejects.toMatchObject({ status: 400 });
    await expect(saveUpload(directory, 'text/plain', Buffer.alloc(MAX_TEXT_UPLOAD_BYTES + 1, 'a'), new Date(), 'big.txt')).rejects.toMatchObject({ status: 413 });
    expect(await readdir(directory)).toHaveLength(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('file names become one safe word that keeps the extension', () => {
  expect(safeFileName('notes.md')).toBe('notes.md');
  expect(safeFileName('../../etc/passwd')).toBe('passwd');
  expect(safeFileName('C:\\Users\\sam\\Café Plan (v2).txt')).toBe('Cafe-Plan-v2-.txt');
  expect(safeFileName('.env')).toBe('env');
  expect(safeFileName('$(rm -rf).sh')).toBe('rm-rf-.sh');
  expect(safeFileName('日本語')).toBe('file.txt');
  expect(safeFileName(null)).toBe('file.txt');
  const long = safeFileName(`${'a'.repeat(200)}.tsx`);
  expect(long).toHaveLength(80);
  expect(long).toEndWith('.tsx');
});

test('old pictures are swept and nothing else in the folder is touched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-uploads-'));
  try {
    const fresh = await saveUpload(directory, 'image/png', png);
    const old = await saveUpload(directory, 'image/jpeg', jpeg);
    const oldText = await saveUpload(directory, 'text/plain', Buffer.from('log'), new Date(), 'build.log');
    const other = join(directory, 'notes.png');
    await writeFile(other, 'kept');
    const longAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000);
    await utimes(old, longAgo, longAgo); await utimes(oldText, longAgo, longAgo); await utimes(other, longAgo, longAgo);
    expect(await sweepUploads(directory)).toBe(2);
    expect((await readdir(directory)).sort()).toEqual([fresh.split('/').pop()!, 'notes.png'].sort());
    expect(await sweepUploads(join(directory, 'missing'))).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('host accepts pictures only from paired same-origin browsers and keeps other bodies small', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-uploads-host-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory, { HERDR_SOCKET_PATH: join(directory, 'missing.sock') });
    const send = (body: BodyInit, headers: Record<string, string> = {}, path = '/api/uploads') =>
      host!.request(path, { method: 'POST', body, headers: { 'Content-Type': 'image/png', ...headers } });
    expect((await send(png)).status).toBe(401);
    const cookie = (await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) }))
      .headers.get('set-cookie')!.split(';')[0];

    const saved = await send(png, { Cookie: cookie });
    expect(saved.status).toBe(200);
    const { path } = await saved.json() as { path: string };
    expect(path.startsWith(join(directory, '.runtime', 'uploads') + '/')).toBe(true);
    expect(await readFile(path)).toEqual(png);

    expect((await send(png, { Cookie: cookie, Origin: 'https://evil.test' })).status).toBe(403);
    expect((await send(Buffer.from('<script>'), { Cookie: cookie, 'Content-Type': 'text/html' })).status).toBe(415);
    expect((await send(new Uint8Array(MAX_UPLOAD_BYTES + 1), { Cookie: cookie })).status).toBe(413);
    // Pairing, login and actions keep their 4 KB limit even though pictures may be larger.
    const big = JSON.stringify({ token: 'x'.repeat(8000) });
    expect((await send(big, { 'Content-Type': 'application/json' }, '/api/login')).status).toBe(413);
    expect((await send(big, { Cookie: cookie, 'Content-Type': 'application/json' }, '/api/actions')).status).toBe(413);
  } finally {
    await host?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
