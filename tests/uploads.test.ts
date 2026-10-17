import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost, testToken } from './helpers/host.ts';
import { MAX_UPLOAD_BYTES, saveUpload, sweepUploads } from '../src/uploads.ts';

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

test('old pictures are swept and nothing else in the folder is touched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-uploads-'));
  try {
    const fresh = await saveUpload(directory, 'image/png', png);
    const old = await saveUpload(directory, 'image/jpeg', jpeg);
    const other = join(directory, 'notes.png');
    await writeFile(other, 'kept');
    const longAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000);
    await utimes(old, longAgo, longAgo); await utimes(other, longAgo, longAgo);
    expect(await sweepUploads(directory)).toBe(1);
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
