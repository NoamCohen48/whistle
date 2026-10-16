// Isolated browser fixture. Never imports the Herdr adapter or opens a real pane.
import type { ServerWebSocket } from 'bun';
import type { Snapshot } from '../src/herdr.ts';
import { assetResponse } from '../src/assets.ts';

const initial: Snapshot = {
  workspaces: [
    { workspace_id: 'w1', label: 'tap', worktree: { repo_key: '/tap/.git', is_linked_worktree: false } },
    { workspace_id: 'w2', label: 'app-explorer', worktree: { repo_key: '/tap/.git', is_linked_worktree: true } },
  ],
  tabs: [],
  panes: [
    { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'tab1', label: 'First agent', agent: 'pi', agent_status: 'idle', cwd: '/tap' },
    { pane_id: 'w2:p1', terminal_id: 't2', workspace_id: 'w2', tab_id: 'tab2', label: 'Second agent', agent: 'pi', agent_status: 'working', cwd: '/explorer' },
  ],
};
interface Peer { pane: string; control: boolean; width: number; height: number; timer?: ReturnType<typeof setInterval> }
let inventory = structuredClone(initial);
let messages: Record<string, unknown>[] = [];
let pairings = 0;
let acknowledge = true;
let workerRevision = 1;
const peers = new Set<ServerWebSocket<Peer>>();
function frame(ws: ServerWebSocket<Peer>) {
  const { width, height, pane } = ws.data;
  const screen = '\x1b[?2004h\x1b[2J\x1b[H' + `Whistle fixture ${pane}\r\n` +
    Array.from({ length: height - 2 }, (_, row) => `row ${row + 2}\r\n`).join('') +
    `\x1b[${Math.min(height - 2, 48)};1Hinput> `;
  ws.send(JSON.stringify({ type: 'terminal.frame', width, height, bytes: Buffer.from(screen).toString('base64') }));
}
const server = Bun.serve<Peer>({
  hostname: '127.0.0.1', port: 8792,
  async fetch(request, server) {
    try {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/__test/health') return new Response('ok');
    if (path === '/__test/reset') {
      for (const peer of peers) peer.close();
      inventory = structuredClone(initial); messages = []; pairings = 0; acknowledge = true; workerRevision = 1;
      return new Response('reset');
    }
    if (path === '/__test/worker-update') { workerRevision++; return new Response('updated'); }
    if (path === '/__test/unconfirmed') { acknowledge = false; return new Response('ACKs disabled'); }
    if (path === '/__test/messages') return Response.json(messages);
    if (path === '/__test/pairings') return Response.json(pairings);
    if (path === '/__test/disconnect') { for (const peer of peers) peer.close(); return new Response('closed'); }
    if (path === '/__test/replace') {
      inventory.panes[0].terminal_id = 'replacement'; return new Response('replaced');
    }
    if (path === '/api/login' || path === '/api/redeem-pairing') {
      if (request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
      const body = await request.json();
      if (path === '/api/redeem-pairing') {
        pairings++;
        if (body.ticket !== 'single-use-ticket' || pairings > 1) return new Response('QR expired or already used', { status: 401 });
      } else if (body.token !== 'test-token') return new Response('Incorrect access token', { status: 401 });
      return new Response('paired', { headers: { 'Set-Cookie': 'whistle_session=fixture; HttpOnly; SameSite=Strict; Path=/' } });
    }
    if (path === '/api/panes' || path === '/terminal') {
      if (!request.headers.get('cookie')?.includes('whistle_session=fixture')) return new Response('Pair first', { status: 401 });
      if (path === '/api/panes') return Response.json(inventory);
      if (request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
      const pane = url.searchParams.get('pane') || '';
      const control = url.searchParams.get('mode') === 'control';
      const width = control ? Number(url.searchParams.get('cols')) : 120;
      const height = control ? Number(url.searchParams.get('rows')) : 64;
      messages.push({ type: 'connect', pane, control, width, height });
      return server.upgrade(request, { data: { pane, control, width, height } }) ? undefined : new Response('Upgrade required', { status: 400 });
    }
    const asset = assetResponse(path, { 'Cache-Control': 'no-store' });
    if (path === '/sw.js' && asset) return new Response(await asset.text() + `\n// Fixture revision ${workerRevision}\n`, { headers: asset.headers });
    return asset || new Response('Not found', { status: 404 });
    } catch { return new Response('Invalid fixture request', { status: 400 }); }
  },
  websocket: {
    open(ws) { peers.add(ws); frame(ws); ws.data.timer = setInterval(() => frame(ws), 200); },
    message(ws, raw) {
      try {
        const command = JSON.parse(String(raw));
        if (command.type === 'ping') { ws.send('{"type":"pong"}'); return; }
        messages.push({ ...command, pane: ws.data.pane });
        if (acknowledge && (command.type === 'input' || command.type === 'key')) ws.send(JSON.stringify({ type: 'ack', id: command.id }));
        if (command.type === 'resize') {
          ws.data.width = command.cols; ws.data.height = command.rows; frame(ws);
        }
      } catch { ws.close(1008, 'Invalid test command'); }
    },
    close(ws) { clearInterval(ws.data.timer); peers.delete(ws); messages.push({ type: 'release', pane: ws.data.pane }); },
  },
});
console.log(`Browser fixture: ${server.url}`);
