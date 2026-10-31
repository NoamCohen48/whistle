// Isolated browser fixture. Never imports the Herdr adapter or opens a real pane.
import type { ServerWebSocket } from 'bun';
import type { Snapshot } from '../../shared/api.ts';
import { deflateSync } from 'node:zlib';
import { assetResponse } from '../../src/assets.ts';

const initial: Snapshot = {
  workspaces: [
    { workspace_id: 'w1', label: 'atlas', worktree: { repo_key: '/atlas/.git', is_linked_worktree: false } },
    { workspace_id: 'w2', label: 'atlas-search', worktree: { repo_key: '/atlas/.git', is_linked_worktree: true } },
  ],
  tabs: [],
  panes: [
    { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'tab1', label: 'First agent', agent: 'pi', agent_status: 'idle', cwd: '/home/sam/projects/atlas' },
    { pane_id: 'w2:p1', terminal_id: 't2', workspace_id: 'w2', tab_id: 'tab2', label: 'Second agent', agent: 'pi', agent_status: 'working', cwd: '/home/sam/.herdr/worktrees/atlas/search' },
  ],
};
// A real PNG so pictures render: a striped test card.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4); return out;
}
function testCard(width: number, height: number) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 3 + 1) + 1 + x * 3, band = Math.floor(x / (width / 6));
    rows.set(y < height * .7 ? [[186, 215, 161], [233, 179, 91], [96, 140, 200], [220, 110, 90], [160, 120, 200], [230, 230, 230]][band] ?? [0, 0, 0] : [35, 43, 44], i);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const picture = testCard(360, 240);
interface Peer { pane: string; control: boolean; width: number; height: number; silent?: boolean; timer?: ReturnType<typeof setInterval> }
let inventory = structuredClone(initial);
const initialDevices = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Fixture browser', current: true, createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 86400000 },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Old phone', current: false, createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 86400000 },
];
let devices = structuredClone(initialDevices);
let messages: Record<string, unknown>[] = [];
let pairings = 0;
let acknowledge = true;
let workerRevision = 1;
let failNextAction = '';
let agentFails = false;
// Like the host: a repeated request ID gets the first result. Armed, the next reply is lost after the action ran.
let launches = new Map<string, unknown>();
let loseReply = false;
// Off: frames never turn bracketed paste on, like a Herdr render of a pane attached mid-session.
let bracketedFrames = true;
let pushSubscribed = false;
let failPushTest = false;
let pushSettings: Record<string, unknown> = { finished: true };
const pushKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString('base64url');
let created = 0;
let uploads = 0;
// Review data for w1:p1 only; any other pane reports a folder outside Git.
// Folders a fixture home contains; * marks a Git repository.
const folderTree: Record<string, string[]> = {
  '/home/sam': ['Documents', 'Downloads', 'projects'],
  '/home/sam/projects': ['atlas*', 'notes', 'site', 'whistle*'],
  '/home/sam/projects/atlas': ['docs', 'src', 'web'],
  '/home/sam/projects/whistle': ['src', 'web'],
  '/home/sam/projects/site': [], '/home/sam/projects/notes': [], '/home/sam/Documents': [], '/home/sam/Downloads': [],
};
const changes = { root: '/home/sam/projects/atlas', branch: 'feature/review', truncated: false, files: [
  { path: 'assets/logo.png', status: 'modified', added: 0, removed: 0, binary: true },
  { path: 'docs/home-screen.png', status: 'untracked', added: 0, removed: 0, binary: true },
  { path: 'src/old.ts', status: 'deleted', added: 0, removed: 8, binary: false },
  { path: 'web/App.tsx', status: 'modified', added: 12, removed: 3, binary: false },
  { path: 'web/components/Changes.tsx', status: 'untracked', added: 40, removed: 0, binary: false },
] };
const appDiff = '@@ -10,6 +10,7 @@ export function App() {\n   const [menuOpen, setMenuOpen] = useState(false);\n-  const [old, setOld] = useState();\n+  const [changesFor, setChangesFor] = useState<string>();\n+  const [review, setReview] = useState(false);\n   return null;\n';
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
    case 'agent': {
      // Like the host, an agent that fails to start keeps its shell and reports why.
      if (agentFails) return { paneId: addPane(body.workspaceId, {}), warning: `${body.kind} did not start: ${body.kind} exited` };
      return { paneId: addPane(body.workspaceId, { agent: body.kind, agent_status: 'idle', label: body.kind }) };
    }
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
  if (ws.data.silent) return;
  const { width, height, pane } = ws.data;
  const screen = (bracketedFrames ? '\x1b[?2004h' : '') + '\x1b[2J\x1b[H' + `Whistle fixture ${pane}\r\n` + 'Saved screenshot to docs/home-screen.png\r\n' +
    'Edited src/routes.ts:3 via http://x.io/a.md\r\n' +
    // A link the program embeds (OSC 8): the text shows, the address does not.
    '\x1b]8;;https://example.com/docs\x1b\\Read the docs\x1b]8;;\x1b\\\r\n' +
    Array.from({ length: height - 5 }, (_, row) => `row ${row + 5}\r\n`).join('') +
    `\x1b[${Math.min(height - 2, 48)};1Hinput> `;
  ws.send(JSON.stringify({ type: 'terminal.frame', width, height, bytes: Buffer.from(screen).toString('base64') }));
}
const server = Bun.serve<Peer>({
  hostname: '127.0.0.1', port: Number(process.env.FIXTURE_PORT || 8792),
  async fetch(request, server) {
    try {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/__test/health') return new Response('ok');
    if (path === '/__test/reset') {
      for (const peer of peers) peer.close();
      inventory = structuredClone(initial); devices = structuredClone(initialDevices); messages = []; pushSubscribed = false; failPushTest = false; pushSettings = { finished: true }; pairings = 0; acknowledge = true; workerRevision = 1; failNextAction = ''; agentFails = false; launches = new Map(); loseReply = false; bracketedFrames = true; created = 0; uploads = 0;
      return new Response('reset');
    }
    if (path === '/__test/worker-update') { workerRevision++; return new Response('updated'); }
    if (path === '/__test/fail-action') { failNextAction = url.searchParams.get('message') || 'Fixture action failed'; return new Response('armed'); }
    if (path === '/__test/agent-fails') { agentFails = true; return new Response('armed'); }
    if (path === '/__test/lose-reply') { loseReply = true; return new Response('armed'); }
    if (path === '/__test/no-bracketed') { bracketedFrames = false; return new Response('off'); }
    if (path === '/__test/fail-push') { failPushTest = true; return new Response('armed'); }
    if (path === '/__test/unconfirmed') { acknowledge = false; return new Response('ACKs disabled'); }
    if (path === '/__test/messages') return Response.json(messages);
    if (path === '/__test/pairings') return Response.json(pairings);
    if (path === '/__test/history') {
      for (const peer of peers) {
        const bytes = '\x1b[2J\x1b[H' + Array.from({ length: 200 }, (_, i) => `history ${i + 1}\r\n`).join('');
        peer.send(JSON.stringify({ type: 'terminal.frame', width: peer.data.width, height: peer.data.height, bytes: Buffer.from(bytes).toString('base64') }));
      }
      return new Response('history');
    }
    if (path === '/__test/silent') { for (const peer of peers) peer.data.silent = true; return new Response('silenced'); }
    if (path === '/__test/empty') { inventory.panes = []; return new Response('empty'); }
    if (path === '/__test/disconnect') { for (const peer of peers) peer.close(); return new Response('closed'); }
    if (path === '/__test/status') {
      const pane = inventory.panes.find(item => item.pane_id === url.searchParams.get('pane'));
      if (pane) pane.agent_status = url.searchParams.get('status') || 'idle';
      return new Response(pane ? 'updated' : 'missing', { status: pane ? 200 : 404 });
    }
    if (path === '/__test/add-panes') {
      const names = ['Docs writer', 'Test runner', 'Release notes', 'Lint fixer'];
      for (const label of names) addPane('w1', { label, agent: 'claude', agent_status: 'idle', cwd: '/home/sam/projects/atlas' });
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
    if (path.startsWith('/api/devices')) {
      if (!request.headers.get('cookie')?.includes('whistle_session=fixture')) return new Response('Pair first', { status: 401 });
      if (request.method === 'GET') return Response.json({ devices });
      if (request.method === 'DELETE' && request.headers.get('origin') === url.origin) {
        const id = path.split('/').at(-1);
        const device = devices.find(item => item.id === id);
        if (!device) return new Response('Device not found', { status: 404 });
        devices = devices.filter(item => item !== device);
        messages.push({ type: 'revoke', id });
        return new Response('Revoked', { headers: device.current ? { 'Set-Cookie': 'whistle_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' } : {} });
      }
      return new Response('Refused', { status: 403 });
    }
    if (path === '/api/previews' || path === '/api/panes' || path === '/terminal' || path === '/api/agents' || path === '/api/worktrees' || path === '/api/actions'
      || path === '/api/push' || path === '/api/push/test' || path === '/api/push/settings' || path === '/api/uploads'
      || path === '/api/changes' || path === '/api/changes/file' || path === '/api/picture' || path === '/api/file' || path === '/api/folders') {
      if (!request.headers.get('cookie')?.includes('whistle_session=fixture')) return new Response('Pair first', { status: 401 });
      if (path === '/api/previews') return Response.json(Object.fromEntries(inventory.panes.map(pane => [pane.pane_id, `${pane.label || pane.pane_id}: checking the fixture`])), { headers: { 'Cache-Control': 'no-store' } });
      if (path === '/api/panes') return Response.json(inventory);
      if (path === '/api/agents') return Response.json({ kinds: ['pi', 'claude', 'codex'] });
      if (path === '/api/worktrees') return Response.json({ worktrees: [
        { path: '/atlas-worktrees/docs', label: 'docs', branch: 'docs' },
        { path: '/search', label: 'atlas-search', branch: 'search', openPaneId: 'w2:p1' },
      ] });
      if (path === '/api/push' && request.method === 'GET') return Response.json({ publicKey: pushKey, subscribed: pushSubscribed, settings: pushSettings });
      if (path === '/api/push/settings') {
        if (request.method !== 'PUT' || request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        pushSettings = await request.json();
        messages.push({ type: 'push-settings', settings: pushSettings });
        return Response.json({ settings: pushSettings });
      }
      if (path.startsWith('/api/push')) {
        if (request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        const body = request.method === 'PUT' ? await request.json() : undefined;
        messages.push({ type: 'push', method: request.method, path, ...(body ? { endpoint: body.endpoint } : {}) });
        if (request.method === 'PUT') pushSubscribed = true;
        if (request.method === 'DELETE') pushSubscribed = false;
        if (path === '/api/push/test' && failPushTest) return new Response('Could not reach the push service: Push service answered 500', { status: 502 });
        return new Response('ok');
      }
      if (path === '/api/folders') {
        const asked = url.searchParams.get('path') || '~';
        const full = asked.replace(/^~(?=\/|$)/, '/home/sam').replace(/\/+$/, '') || '/';
        messages.push({ type: 'folders', path: asked });
        if (!full.startsWith('/')) return new Response('Use an absolute path or ~/…', { status: 400 });
        if (full !== '/home/sam' && !full.startsWith('/home/sam/')) return new Response('Only folders inside your home folder can be browsed.', { status: 403 });
        const list = folderTree[full];
        if (!list) return new Response('This folder does not exist.', { status: 404 });
        return Response.json({ path: full, truncated: false, folders: list.map(name => ({ name: name.replace(/\*$/, ''), repo: name.endsWith('*') })) });
      }
      if (path === '/api/picture') {
        const file = url.searchParams.get('path') || '';
        messages.push({ type: 'picture', pane: url.searchParams.get('pane'), path: file });
        if (!file.startsWith('/home/sam/projects/atlas/') && !/^[^/]/.test(file)) return new Response('Only pictures inside this pane’s project can be shown.', { status: 403 });
        return new Response(picture, { headers: { 'Content-Type': 'image/png' } });
      }
      if (path === '/api/file') {
        const file = url.searchParams.get('path') || '';
        messages.push({ type: 'file', pane: url.searchParams.get('pane'), path: file });
        if (file === 'src/routes.ts') return new Response(Array.from({ length: 80 }, (_, line) => `// routes line ${line + 1}`).join('\n') + '\n');
        if (file.startsWith('/') && !file.startsWith('/home/sam/projects/atlas/')) return new Response('Only files inside this pane’s project can be shown.', { status: 403 });
        return new Response('That file does not exist.', { status: 404 });
      }
      if (path.startsWith('/api/changes')) {
        const pane = url.searchParams.get('pane');
        messages.push({ type: 'changes', pane, path: url.searchParams.get('path') || undefined });
        if (pane !== 'w1:p1') return new Response('This folder is not a Git repository.', { status: 422 });
        if (path === '/api/changes') return Response.json(changes);
        const file = changes.files.find(item => item.path === url.searchParams.get('path'));
        if (!file) return new Response('That file has no changes any more.', { status: 422 });
        return Response.json({ diff: file.binary ? '' : file.path === 'web/App.tsx' ? appDiff : '@@ -0,0 +1,1 @@\n+export {};\n', binary: file.binary, truncated: false });
      }
      if (path === '/api/uploads') {
        if (request.method !== 'POST' || request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        const type = request.headers.get('content-type') || '';
        const bytes = new Uint8Array(await request.arrayBuffer());
        messages.push({ type: 'upload', contentType: type, size: bytes.length, png: bytes[0] === 0x89, jpeg: bytes[0] === 0xff });
        const stamp = `/home/sam/.local/state/whistle/uploads/20261017-143210-${(uploads + 1).toString(16).padStart(8, '0')}`;
        if (type.startsWith('text/plain')) {
          messages.push({ type: 'upload-text', name: url.searchParams.get('name'), text: new TextDecoder().decode(bytes) });
          uploads++; return Response.json({ path: `${stamp}-${(url.searchParams.get('name') || 'file.txt').replace(/[^A-Za-z0-9._-]+/g, '-')}` });
        }
        if (!/^image\/(png|jpeg)$/.test(type)) return new Response('Only pictures and text files can be attached.', { status: 415 });
        uploads++; return Response.json({ path: `${stamp}.${type === 'image/png' ? 'png' : 'jpg'}` });
      }
      if (path === '/api/actions') {
        if (request.method !== 'POST' || request.headers.get('origin') !== url.origin) return new Response('Origin rejected', { status: 403 });
        const body = await request.json();
        messages.push({ ...body, action: body.type, type: 'action' });
        if (body.type === 'workspace' && !/^~?\//.test(body.cwd)) return new Response('Use an absolute path or ~/…', { status: 400 });
        if (failNextAction) { const message = failNextAction; failNextAction = ''; return new Response(message, { status: 400 }); }
        const { requestId, ...action } = body;
        const key = requestId && JSON.stringify([requestId, action]);
        const result = key && launches.has(key) ? launches.get(key) : applyAction(action);
        if (key) launches.set(key, result);
        if (loseReply) { loseReply = false; return new Response('The connection dropped before the PC answered.', { status: 502 }); }
        return Response.json(result);
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
        if (command.type === 'ping') { if (!ws.data.silent) ws.send('{"type":"pong"}'); return; }
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
