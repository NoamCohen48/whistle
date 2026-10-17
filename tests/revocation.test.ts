import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { startHost, testToken } from './helpers/host.ts';

const firstFrame = (ws: WebSocket) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('No fixture frame')), 5000);
  ws.once('error', error => { clearTimeout(timer); reject(error); });
  ws.once('message', () => { clearTimeout(timer); resolve(); });
});

test('revocation and host shutdown release fake Herdr controllers without stopping its daemon', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-revoke-'));
  const socketPath = join(directory, 'herdr.sock');
  const released = join(directory, 'released');
  const rpcServer = createServer(socket => {
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString();
      if (!input.includes('\n')) return;
      try {
        const request = JSON.parse(input.split('\n')[0]);
        const result = request.method === 'session.snapshot' ? {
          snapshot: { workspaces: [], tabs: [], panes: [{ pane_id: 'fixture:p1', terminal_id: 'fake', workspace_id: 'fixture', tab_id: 'fake' }] },
        } : { layout: { panes: [{ pane_id: 'fixture:p1', rect: { width: 122 } }] } };
        socket.end(JSON.stringify({ id: request.id, result }) + '\n');
      } catch { socket.destroy(); }
    });
  });
  rpcServer.listen(socketPath); await once(rpcServer, 'listening');
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let ws: WebSocket | undefined;
  try {
    const bin = join(directory, 'bin'); await mkdir(bin);
    await writeFile(join(bin, 'herdr'), `#!${process.execPath}\nimport ${JSON.stringify(resolve('tests/fixtures/herdr.ts'))};\n`, { mode: 0o700 });
    host = await startHost(directory, { HERDR_SOCKET_PATH: socketPath, WHISTLE_HERDR_BIN: join(bin, 'herdr'),
      PATH: `${bin}:${process.env.PATH}`, WHISTLE_TEST_RELEASE_FILE: released });
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const other = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken, deviceName: 'Other device' }) });
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    const listing = await (await host.request('/api/devices', { headers: { Cookie: cookie } })).json();
    const id = listing.devices.find((device: { current: boolean }) => device.current).id;
    ws = new WebSocket(`${host.url.replace('http', 'ws')}/terminal?pane=fixture:p1&mode=control&cols=45&rows=64`, { headers: { Cookie: cookie, Origin: host.url } });
    await firstFrame(ws);
    const closed = once(ws, 'close');
    const response = await host.request(`/api/devices/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${testToken}` } });
    expect(response.status).toBe(200);
    const [code] = await closed; expect(code).toBe(1008);
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await host.request('/api/devices', { headers: { Cookie: otherCookie } })).status).toBe(200);
    let release = '';
    for (let i = 0; i < 50 && !release; i++) {
      try { release = await readFile(released, 'utf8'); } catch { await Bun.sleep(20); }
    }
    expect(release).toBe('released\n');
    ws = new WebSocket(`${host.url.replace('http', 'ws')}/terminal?pane=fixture:p1&mode=control&cols=45&rows=64`, { headers: { Cookie: otherCookie, Origin: host.url } });
    await firstFrame(ws);
    await host.stop(); host = undefined;
    expect(await readFile(released, 'utf8')).toBe('released\nreleased\n');
    expect(rpcServer.listening).toBe(true);
  } finally {
    ws?.terminate(); await host?.stop();
    await new Promise<void>(resolve => rpcServer.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
