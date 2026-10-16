import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { HerdrError, rpc, snapshot, terminalStream, watchSize } from './herdr.ts';
import { dimensions, parseCommand } from './protocol.ts';
import { PairingTickets } from './pairing.ts';
import { DeviceStore, DEVICE_LIFETIME_MS, deviceName } from './devices.ts';

await mkdir('.runtime', { recursive: true, mode: 0o700 });
const tokenPath = '.runtime/access-token';
let token = process.env.WHISTLE_TOKEN;
if (!token) {
  try { token = (await readFile(tokenPath, 'utf8')).trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    token = crypto.randomUUID() + crypto.randomUUID();
    await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' });
  }
}
if (token.length < 24) throw new Error('WHISTLE_TOKEN must be at least 24 characters');
const accessToken = token;
const devices = new DeviceStore('.runtime/devices.sqlite');
const pairingTickets = new PairingTickets();
const failures = new Map<string, { count: number; until: number }>();
const controllers = new Map<string, ServerWebSocket<Peer>>();
const peers = new Set<ServerWebSocket<Peer>>();
interface Peer {
  deviceId: string;
  paneId: string;
  mode: 'observe' | 'control';
  cols: number;
  rows: number;
  stream?: ReturnType<typeof terminalStream>;
  queue: Promise<void>;
  pending: number;
  lastId: number;
  closed: boolean;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try { return origin !== null && origin === new URL(request.url).origin; }
  catch { return false; }
}
function authenticated(request: Request) {
  const cookie = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('whistle_session='))?.slice(16);
  return devices.authenticate(cookie);
}
function equalToken(candidate: unknown) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate), b = Buffer.from(accessToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
function message(ws: ServerWebSocket<Peer>, value: unknown) {
  if (!ws.data.closed) ws.send(JSON.stringify(value));
}
function cleanup(ws: ServerWebSocket<Peer>) {
  ws.data.closed = true;
  ws.data.stream?.stop();
  if (controllers.get(ws.data.paneId) === ws) controllers.delete(ws.data.paneId);
  peers.delete(ws);
}

const assets: Record<string, { file: string; type: string }> = {
  '/': { file: 'dist/index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'dist/app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'dist/app.css', type: 'text/css' },
  '/style.css': { file: 'dist/style.css', type: 'text/css' },
};
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function pairedResponse(url: URL, name: string) {
  const { credential } = devices.issue(name);
  return new Response('Paired', { headers: {
    ...headers,
    'Set-Cookie': `whistle_session=${credential}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DEVICE_LIFETIME_MS / 1000}${url.protocol === 'https:' ? '; Secure' : ''}`,
  } });
}
const server = Bun.serve<Peer>({
  hostname: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8790),
  maxRequestBodySize: 4096,
  async fetch(request, server) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/pairing-ticket' && request.method === 'POST') {
        if (!sameOrigin(request)) return new Response('Origin rejected', { status: 403, headers });
        if (!equalToken(request.headers.get('authorization')?.replace(/^Bearer /, ''))) {
          return new Response('PC access token required', { status: 401, headers });
        }
        const { ticket, expiresAt } = pairingTickets.create();
        // A fragment is not sent in HTTP requests; the phone removes it immediately.
        return Response.json({ url: `${url.origin}/#pair=${ticket}`, expiresAt }, { headers });
      }
      if (url.pathname === '/api/redeem-pairing' && request.method === 'POST') {
        if (!sameOrigin(request)) return new Response('Origin rejected', { status: 403, headers });
        const body = await request.json();
        const name = deviceName(body?.deviceName, request.headers.get('user-agent') || '');
        if (!pairingTickets.redeem(body?.ticket)) {
          return new Response('QR expired or already used. Run bun run pair on the PC for a new one.', { status: 401, headers });
        }
        return pairedResponse(url, name);
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        if (!sameOrigin(request)) return new Response('Origin rejected', { status: 403 });
        const ip = server.requestIP(request)?.address || 'unknown';
        const failure = failures.get(ip);
        if (failure && failure.until > Date.now() && failure.count >= 10) return new Response('Too many attempts; wait one minute', { status: 429 });
        const body = await request.json();
        const name = deviceName(body?.deviceName, request.headers.get('user-agent') || '');
        if (!equalToken(body?.token)) {
          const count = failure && failure.until > Date.now() ? failure.count + 1 : 1;
          failures.set(ip, { count, until: Date.now() + 60_000 });
          return new Response('Incorrect access token', { status: 401 });
        }
        failures.delete(ip);
        return pairedResponse(url, name);
      }
      const deviceRoute = url.pathname === '/api/devices' || /^\/api\/devices\/[0-9a-f-]{36}$/.test(url.pathname);
      if (deviceRoute) {
        const current = authenticated(request);
        const pcAdmin = equalToken(request.headers.get('authorization')?.replace(/^Bearer /, ''));
        if (!current && !pcAdmin) return new Response('Pair this browser first', { status: 401, headers });
        if (url.pathname === '/api/devices' && request.method === 'GET') {
          return Response.json({ devices: devices.list().map(device => ({ ...device, current: device.id === current?.id })) }, { headers });
        }
        if (url.pathname !== '/api/devices' && request.method === 'DELETE') {
          if (!sameOrigin(request)) return new Response('Origin rejected', { status: 403, headers });
          const id = url.pathname.slice('/api/devices/'.length);
          if (!devices.revoke(id)) return new Response('Device not found', { status: 404, headers });
          for (const peer of peers) if (peer.data.deviceId === id) {
            message(peer, { type: 'error', message: 'This device was revoked. Pair again to reconnect.' });
            cleanup(peer); peer.close(1008, 'Device revoked');
          }
          return new Response('Revoked', { headers: { ...headers, ...(id === current?.id ? {
            'Set-Cookie': `whistle_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`,
          } : {}) } });
        }
        return new Response('Method not allowed', { status: 405, headers });
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/terminal') {
        const current = authenticated(request);
        if (!current) return new Response('Pair this browser first', { status: 401, headers });
        if (url.pathname === '/api/panes' && request.method === 'GET') {
          return Response.json(await snapshot(), { headers });
        }
        if (url.pathname === '/terminal') {
          if (!sameOrigin(request)) return new Response('Origin rejected', { status: 403 });
          const paneId = url.searchParams.get('pane') || '';
          const mode = url.searchParams.get('mode') === 'control' ? 'control' : 'observe';
          const state = await snapshot();
          const pane = state.panes.find(p => p.pane_id === paneId);
          if (!pane) return new Response('Pane no longer exists', { status: 404 });
          if (mode === 'control' && controllers.has(paneId)) return new Response('Already controlled by another Whistle browser', { status: 409 });
          const size = mode === 'control'
            ? dimensions(Number(url.searchParams.get('cols')), Number(url.searchParams.get('rows')))
            : await watchSize(pane);
          const upgraded = server.upgrade(request, { data: {
            deviceId: current.id, paneId, mode, ...size, queue: Promise.resolve(), pending: 0, lastId: 0, closed: false,
          } });
          return upgraded ? undefined : new Response('WebSocket upgrade required', { status: 400 });
        }
        return new Response('Not found', { status: 404 });
      }
      const asset = assets[url.pathname];
      if (!asset || request.method !== 'GET') return new Response('Not found', { status: 404 });
      return new Response(Bun.file(asset.file), { headers: { ...headers, 'Content-Type': asset.type } });
    } catch (error) {
      return new Response((error as Error).message, { status: 400, headers });
    }
  },
  websocket: {
    idleTimeout: 30,
    maxPayloadLength: 128 * 1024,
    backpressureLimit: 2 * 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws) {
      const peer = ws.data;
      if (!devices.isActive(peer.deviceId)) { cleanup(ws); ws.close(1008, 'Device expired or revoked'); return; }
      if (peer.mode === 'control') {
        if (controllers.has(peer.paneId)) { ws.close(1008, 'Pane already controlled'); return; }
        controllers.set(peer.paneId, ws);
      }
      peers.add(ws);
      peer.stream = terminalStream(peer.paneId, peer.mode, peer.cols, peer.rows,
        frame => message(ws, { ...frame, mode: peer.mode }),
        reason => { message(ws, { type: 'error', message: reason }); cleanup(ws); ws.close(1011, 'Herdr stream ended'); },
      );
    },
    message(ws, raw) {
      const peer = ws.data;
      try {
        if (!devices.isActive(peer.deviceId)) throw new Error('Device expired or revoked');
        const command = parseCommand(typeof raw === 'string' ? raw : raw.toString());
        if (command.type === 'ping') { message(ws, { type: 'pong' }); return; }
        if (peer.mode !== 'control') throw new Error('Take control before sending input');
        if (peer.pending >= 100) throw new Error('Too many pending inputs; stopped rather than replaying');
        peer.pending++;
        peer.queue = peer.queue.then(async () => {
          if (peer.closed) return;
          if (!devices.isActive(peer.deviceId)) throw new Error('Device expired or revoked');
          const stream = peer.stream;
          if (!stream) throw new Error('Terminal stream is not open');
          if (command.type === 'input' || command.type === 'key') {
            if (!stream.controlled) throw new Error('Terminal is not controlled');
            if (command.id <= peer.lastId) throw new Error('Duplicate or out-of-order input');
            peer.lastId = command.id;
            // All text and chords use this one serial RPC lane. Mixing CLI stdin
            // and key RPCs could let a shortcut overtake previously typed text.
            try {
              if (command.type === 'input') await rpc('pane.send_text', { pane_id: peer.paneId, text: command.text });
              else await rpc('pane.send_keys', { pane_id: peer.paneId, keys: [command.key] });
              message(ws, { type: 'ack', id: command.id });
            } catch (error) {
              if (command.type === 'key' && error instanceof HerdrError && error.code === 'invalid_key') {
                message(ws, { type: 'key-rejected', id: command.id, message: error.message });
              } else throw error;
            }
          } else if (command.type === 'resize') {
            await stream.send({ type: 'terminal.resize', cols: command.cols, rows: command.rows });
          } else {
            await stream.send({ type: 'terminal.scroll', direction: command.direction, lines: command.lines });
          }
        }).catch(error => {
          message(ws, { type: 'error', message: error.message });
          cleanup(ws); ws.close(1011, 'Input failed; not retried');
        }).finally(() => { peer.pending--; });
      } catch (error) {
        message(ws, { type: 'error', message: (error as Error).message });
        cleanup(ws); ws.close(1008, 'Invalid command');
      }
    },
    close(ws) { cleanup(ws); },
  },
});
const sweeper = setInterval(() => {
  devices.sweep();
  for (const peer of peers) if (!devices.isActive(peer.data.deviceId)) {
    cleanup(peer); peer.close(1008, 'Device expired or revoked');
  }
  for (const [ip, failure] of failures) if (failure.until < Date.now()) failures.delete(ip);
}, 60_000);
sweeper.unref();
function shutdown() {
  for (const peer of peers) { cleanup(peer); peer.close(1001, 'Server stopping'); }
  clearInterval(sweeper);
  server.stop(true);
  devices.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
const serverUrl = `http://${server.hostname}:${server.port}`;
await writeFile('.runtime/server-url', serverUrl, { mode: 0o600 });
console.log(`Whistle PoC: ${serverUrl}`);
console.log('Pair your phone: bun run pair (single-use QR, valid for 5 minutes)');
console.log(`Access token: ${process.env.WHISTLE_TOKEN ? 'provided by WHISTLE_TOKEN' : tokenPath} (not included in URLs or logs)`);
