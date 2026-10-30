import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessTokenGuard } from '../src/auth.ts';
import { startHost, testToken } from './helpers/host.ts';

test('without Herdr the host answers 503 without its socket path, and keeps running', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-errors-'));
  const socket = join(directory, 'missing.sock');
  const host = await startHost(directory, { HERDR_SOCKET_PATH: socket });
  try {
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    for (const path of ['/api/panes', '/api/agents', '/terminal?pane=w1:p1']) {
      const response = await host.request(path, { headers: { Cookie: cookie } });
      expect(response.status).toBe(503);
      const message = await response.text();
      expect(message).toContain('Herdr is not reachable');
      expect(message).not.toContain(socket);
    }
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await host.request('/api/actions', { method: 'POST', headers: { Cookie: cookie }, body: '{"type":"nope"}' })).status).toBe(400);
    expect((await host.request('/api/devices', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(405);
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('ten wrong access tokens pause token checks from that address for a minute', () => {
  let now = 0;
  const guard = new AccessTokenGuard(testToken, () => now);
  for (let attempt = 0; attempt < 10; attempt++) expect(guard.check('a', 'wrong')).toBe('wrong');
  expect(guard.check('a', testToken)).toBe('paused');
  expect(guard.check('b', testToken)).toBe('ok');
  now += 60_001;
  expect(guard.check('a', testToken)).toBe('ok');
  expect(guard.check('a', undefined)).toBe('wrong');
});
