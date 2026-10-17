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
    { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'tab1', label: 'First agent', agent: 'pi', agent_status: 'idle', cwd: '/home/dev/Work/tap' },
    { pane_id: 'w2:p1', terminal_id: 't2', workspace_id: 'w2', tab_id: 'tab2', label: 'Second agent', agent: 'pi', agent_status: 'working', cwd: '/home/dev/.herdr/worktrees/tap/explorer' },
  ],
};
interface Peer { pane: string; control: boolean; width: number; height: number; timer?: ReturnType<typeof setInterval> }
let inventory = structuredClone(initial);
let messages: Record<string, unknown>[] = [];
let pairings = 0;
let acknowledge = true;
let workerRevision = 1;
let failNextAction = '';
let pushSubscribed = false;
let failPushTest = false;
const pushKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString('base64url');
let created = 0;
const peers = new Set<ServerWebSocket<Peer>>();
// Mirrors src/actions.ts results: new panes are reported back by id and open watch-only.
function addPane(workspace_id: string, extra: Partial<Snapshot['panes'][number]> = {}) {
  const pane_id = `${workspace_id}:n${++created}`;
  inventory.panes.push({ pane_id, terminal_id: `new${created}`, workspace_id, tab_id: `tab-new${created}`, cwd: '/fixture', ...extra });
  return pane_id;
}
function addWorkspace(label: string, linkedTo?: string) {
  const workspace_id = `wn${++created}`;
  const repo = inventory.workspaces.find(item => item.workspace_id === linkedTo)?.worktree;
  inventory.workspaces.push({ workspace_id, label, ...(repo ? { worktree: { repo_key: repo.repo_key, is_linked_worktree: true } } : {}) });
  return workspace_id;
}
function applyAction(body: Record<string, string>): { paneId?: string; warning?: string } {
  switch (body.type) {
    case 'terminal': return { paneId: addPane(body.workspaceId) };
    case 'agent': return { paneId: addPane(body.workspaceId, { agent: body.kind, agent_status: 'idle', label: body.kind }) };
    case 'workspace': return { paneId: addPane(addWorkspace(body.label || body.cwd.split('/').pop() || 'workspace')) };
    case 'worktree-create': return { paneId: addPane(addWorkspace(body.branch, body.workspaceId)) };
    case 'worktree-open': return { paneId: addPane(addWorkspace(body.path.split('/').pop()!, body.workspaceId)) };
    case 'close-pane': inventory.panes = inventory.panes.filter(pane => pane.pane_id !== body.paneId); return {};
    case 'remove-worktree':
      inventory.workspaces = inventory.workspaces.filter(item => item.workspace_id !== body.workspaceId);
      inventory.panes = inventory.panes.filter(pane => pane.workspace_id !== body.workspaceId); return {};
    case 'rename-pane': {
      const pane = inventory.panes.find(item => item.pane_id === body.paneId);
      if (pane) pane.label = body.label || undefined; return {};
    }
    case 'rename-workspace': {
      const workspace = inventory.workspaces.find(item => item.workspace_id === body.workspaceId);
      if (workspace) workspace.label = body.label; return {};
    }
    default: throw new Error('Unknown action');
  }
}
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
      inventory = structuredClone(initial); messages = []; pushSubscribed = false; failPushTest = false; pairings = 0; acknowledge = true; workerRevision = 1; failNextAction = ''; created = 0;
      return new Response('reset');
    }
    if (path === '/__test/worker-update') { workerRevision++; return new Response('updated'); }
    if (path === '/__test/fail-action') { failNextAction = url.searchParams.get('message') || 'Fixture action failed'; return new Response('armed'); }
    if (path === '/__test/fail-push') { failPushTest = true; return new Response('armed'); }
    if (path === '/__test/unconfirmed') { acknowledge = false; return new Response('ACKs disabled'); }
    if (path === '/__test/messages') return Response.json(messages);
    if (path === '/__test/pairings') return Response.json(pairings);
    if (path === '/__test/disconnect') { for (const peer of peers) peer.close(); return new Response('closed'); }
    if (path === '/__test/status') {
      const pane = inventory.panes.find(item => item.pane_id === url.searchParams.get('pane'));
      if (pane) pane.agent_status = url.searchParams.get('status') || 'idle';
      return new Response(pane ? 'updated' : 'missing', { status: pane ? 200 : 404 });
    }
    if (path === '/__test/add-panes') {
      const names = ['Docs writer', 'Test runner', 'Release notes', 'Lint fixer'];
      for (const label of names) addPane('w1', { label, agent: 'claude', agent_status: 'idle', cwd: '/home/dev/Work/tap' });
      return new Response('added');
    }
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
    if (path === '/api/panes' || path === '/terminal' || path === '/api/agents' || path === '/api/worktrees' || path === '/api/actions'
      || path === '/api/push' || path === '/api/push/test') {
      if (!request.headers.get('cookie')?.includes('whistle_session=fixture')) return new Response('Pair first', { status: 401 });
      if (path === '/api/panes') return Response.json(inventory);
      if (path === '/api/agents') return Response.json({ kinds: ['pi', 'claude', 'codex'] });
      if (path === '/api/worktrees') return Response.json({ worktrees: [
        { path: '/tap-worktrees/docs', label: 'docs', branch: 'docs' },
        { path: '/explorer', label: 'app-explorer', branch: 'explorer', openPaneId: 'w2:p1' },
      ] });
      if (path === '/api/push' && request.method === 'GET') return Response.json({ publicKey: pushKey, subscribed: pushSubscribed });
      if (path.startsWith('/api/push')) {
        if (request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        const body = request.method === 'PUT' ? await request.json() : undefined;
        messages.push({ type: 'push', method: request.method, path, ...(body ? { endpoint: body.endpoint } : {}) });
        if (request.method === 'PUT') pushSubscribed = true;
        if (request.method === 'DELETE') pushSubscribed = false;
        if (path === '/api/push/test' && failPushTest) return new Response('Could not reach the push service: Push service answered 500', { status: 502 });
        return new Response('ok');
      }
      if (path === '/api/actions') {
        if (request.method !== 'POST' || request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        const body = await request.json();
        messages.push({ ...body, action: body.type, type: 'action' });
        if (body.type === 'workspace' && !/^~?\//.test(body.cwd)) return new Response('Use an absolute path or ~/…', { status: 400 });
        if (failNextAction) { const message = failNextAction; failNextAction = ''; return new Response(message, { status: 400 }); }
        return Response.json(applyAction(body));
      }
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
