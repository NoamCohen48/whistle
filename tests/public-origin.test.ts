import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHostConfig, parsePublicOrigin, resolvePaths } from '../src/config.ts';
import { startHost, testToken } from './helpers/host.ts';

const publicOrigin = 'https://whistle.example.test:8443';

test('authentication, malformed requests and missing routes are explicitly non-cacheable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-no-store-'));
  const host = await startHost(directory);
  try {
    const cases: [string, RequestInit, number][] = [
      ['/api/login', { method: 'POST', body: JSON.stringify({ token: 'incorrect' }) }, 401],
      ['/api/login', { method: 'POST', headers: { Origin: 'https://wrong.invalid' } }, 403],
      ['/api/login', { method: 'POST', body: '{' }, 400],
      ['/api/panes', {}, 401], ['/terminal', {}, 401], ['/missing', {}, 404], ['/constructor', {}, 404],
      ['/', { method: 'DELETE' }, 404],
    ];
    for (const [path, options, status] of cases) {
      const response = await host.request(path, options);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('proxy origin is explicit canonical HTTPS and requires a loopback backend', () => {
  expect(parsePublicOrigin(publicOrigin)).toBe(publicOrigin);
  for (const value of ['http://host', 'https://host/', 'https://USER:password@host', 'https://host/a', 'https://host?x', 'https://host/#ticket', 'https://HOST', 'bad', null]) {
    expect(() => parsePublicOrigin(value)).toThrow();
  }
  expect(parsePublicOrigin('')).toBeUndefined();
  const paths = resolvePaths({ HOME: '/tmp/whistle-origin-config-does-not-exist' });
  expect(() => loadHostConfig(paths, { HOST: '100.68.36.94', WHISTLE_PUBLIC_ORIGIN: publicOrigin })).toThrow('loopback');
});

test('configured proxy origin pins QR, Secure cookies and CSRF without trusting forwarding headers; PC CLI still works', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-origin-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory, { WHISTLE_PUBLIC_ORIGIN: publicOrigin });
    const spoof = { 'Forwarded': 'host=evil.invalid;proto=https', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.invalid' };
    expect((await host.request('/api/login', { method: 'POST', headers: spoof, body: JSON.stringify({ token: testToken }) })).status).toBe(403);
    const login = await host.request('/api/login', { method: 'POST', headers: { ...spoof, Origin: publicOrigin }, body: JSON.stringify({ token: testToken }) });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('; Secure');
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const ticket = await host.request('/api/pairing-ticket', { method: 'POST', headers: { Origin: publicOrigin, Authorization: `Bearer ${testToken}`, ...spoof } });
    expect((await ticket.json()).url.startsWith(publicOrigin + '/#pair=')).toBe(true);
    const devices = await (await host.request('/api/devices', { headers: { Cookie: cookie } })).json();
    const revoked = await host.request('/api/devices/' + devices.devices[0].id, { method: 'DELETE', headers: { Origin: publicOrigin, Cookie: cookie } });
    expect(revoked.status).toBe(200); expect(revoked.headers.get('set-cookie')).toContain('; Secure');
    const cli = Bun.spawn([process.execPath, resolve('src/cli.ts'), 'devices'], { cwd: directory,
      env: { ...process.env, WHISTLE_STATE_DIR: join(directory, '.runtime'), WHISTLE_CONFIG_DIR: join(directory, 'config'), WHISTLE_PUBLIC_ORIGIN: publicOrigin, WHISTLE_TOKEN: testToken },
      stdout: 'ignore', stderr: 'pipe' });
    expect(await cli.exited).toBe(0); expect(await new Response(cli.stderr).text()).toBe('');
  } finally { await host?.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('unconfigured HTTP ignores spoofed proxy headers rather than enabling Secure cookies or foreign QR origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-direct-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory);
    const headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.invalid' };
    const response = await host.request('/api/login', { method: 'POST', headers, body: JSON.stringify({ token: testToken }) });
    expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).not.toContain('; Secure');
    const ticket = await host.request('/api/pairing-ticket', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${testToken}` } });
    expect((await ticket.json()).url.startsWith(host.url + '/#pair=')).toBe(true);
  } finally { await host?.stop(); await rm(directory, { recursive: true, force: true }); }
});
