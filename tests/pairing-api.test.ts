import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('QR API: protected creation, origin check, cookie issuance and single use', async () => {
  const cwd = await mkdtemp(`${tmpdir()}/whistle-pair-test-`);
  const token = crypto.randomUUID();
  const child = Bun.spawn([process.execPath, resolve('src/server.ts')], {
    cwd, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', WHISTLE_TOKEN: token,
      WHISTLE_STATE_DIR: resolve(cwd, 'state'), WHISTLE_CONFIG_DIR: resolve(cwd, 'config') },
    stdout: 'pipe', stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  try {
    let output = '';
    const base = await Promise.race([
      (async () => {
        while (true) {
          const next = await reader.read();
          if (next.done) throw new Error('Test server exited before starting');
          output += new TextDecoder().decode(next.value);
          const match = output.match(/Whistle: (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) return match[1];
        }
      })(),
      Bun.sleep(5000).then(() => { throw new Error('Test server startup timed out'); }),
    ]);
    const post = (path: string, body?: unknown, extra: Record<string, string> = {}) => fetch(base + path, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect((await post('/api/pairing-ticket')).status).toBe(401);
    const created = await post('/api/pairing-ticket', undefined, { Authorization: `Bearer ${token}` });
    expect(created.status).toBe(200);
    const pairing = await created.json() as { url: string; expiresAt: number };
    const url = new URL(pairing.url);
    expect(url.origin).toBe(base);
    expect(url.search).toBe('');
    expect(pairing.url).not.toContain(token);
    const ticket = new URLSearchParams(url.hash.slice(1)).get('pair');
    expect(ticket).toBeTruthy();
    expect((await post('/api/redeem-pairing', { ticket }, { Origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await post('/api/redeem-pairing', { ticket: 'invalid' })).status).toBe(401);
    const redeemed = await post('/api/redeem-pairing', { ticket });
    expect(redeemed.status).toBe(200);
    expect(redeemed.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect((await post('/api/redeem-pairing', { ticket })).status).toBe(401);
  } finally {
    reader.releaseLock();
    child.kill();
    await child.exited;
    await rm(cwd, { recursive: true, force: true });
  }
}, 10_000);
