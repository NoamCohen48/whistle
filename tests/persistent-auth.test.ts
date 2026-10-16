import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost, testToken } from './helpers/host.ts';

test('real host persists pairing and revocation across restarts; QR tickets remain ephemeral', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-persistent-auth-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory);
    const login = await host.request('/api/login', {
      method: 'POST', body: JSON.stringify({ token: testToken, deviceName: 'My phone' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const listing = await (await host.request('/api/devices', { headers: { Cookie: cookie } })).json();
    const device = listing.devices[0];
    expect(device.name).toBe('My phone'); expect(device.current).toBe(true);
    expect(JSON.stringify(listing)).not.toContain(cookie.slice('whistle_session='.length));
    expect(JSON.stringify(listing)).not.toContain('credential_hash');
    const created = await (await host.request('/api/pairing-ticket', { method: 'POST', headers: { Authorization: `Bearer ${testToken}` } })).json();
    const ticket = new URL(created.url).hash.slice('#pair='.length);
    await host.stop(); host = await startHost(directory);
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await host.request('/api/devices')).status).toBe(401);
    expect((await host.request('/api/redeem-pairing', { method: 'POST', body: JSON.stringify({ ticket }) })).status).toBe(401);
    const path = `/api/devices/${device.id}`;
    expect((await host.request(path, { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://evil.invalid' } })).status).toBe(403);
    expect((await host.request(path, { method: 'DELETE' })).status).toBe(401);
    expect((await host.request(path, { method: 'DELETE', headers: { Authorization: `Bearer ${testToken}` } })).status).toBe(200);
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(401);
    await host.stop(); host = await startHost(directory);
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await host.request('/api/devices', { headers: { Authorization: `Bearer ${testToken}` } })).status).toBe(200);
  } finally { await host?.stop(); await rm(directory, { recursive: true, force: true }); }
}, 15_000);
