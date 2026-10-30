import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAction, validRef } from '../src/actions.ts';
import { hostPath } from '../src/paths.ts';
import { startHost, testToken } from './helpers/host.ts';

test('actions accept only fixed, validated fields', () => {
  expect(parseAction({ type: 'terminal', workspaceId: 'w1', command: 'rm -rf /' })).toEqual({ type: 'terminal', workspaceId: 'w1' });
  expect(parseAction({ type: 'agent', workspaceId: 'w1', kind: 'claude', args: ['--dangerous'] }))
    .toEqual({ type: 'agent', workspaceId: 'w1', kind: 'claude' });
  expect(() => parseAction({ type: 'agent', workspaceId: 'w1', kind: 'claude; rm' })).toThrow('Invalid agent');
  expect(parseAction({ type: 'workspace', cwd: '~/projects/app', label: ' App ', env: { A: '1' } }, '/home/u'))
    .toEqual({ type: 'workspace', cwd: '/home/u/projects/app', label: 'App' });
  expect(() => parseAction({ type: 'workspace', cwd: 'relative/dir' })).toThrow('absolute');
  expect(() => parseAction({ type: 'workspace', cwd: '/tmp\nx' })).toThrow('Invalid cwd');
  expect(parseAction({ type: 'worktree-create', workspaceId: 'w1', branch: 'feat/phone', base: '' }))
    .toEqual({ type: 'worktree-create', workspaceId: 'w1', branch: 'feat/phone' });
  expect(() => parseAction({ type: 'worktree-create', workspaceId: 'w1', branch: '--upload-pack=x' })).toThrow('Invalid branch');
  expect(parseAction({ type: 'remove-worktree', workspaceId: 'w2', force: true })).toEqual({ type: 'remove-worktree', workspaceId: 'w2' });
  expect(() => parseAction({ type: 'close-pane', paneId: 'w1 p1' })).toThrow('Invalid paneId');
  expect(parseAction({ type: 'rename-pane', paneId: 'w1:p1', label: ' Reviewer ' })).toEqual({ type: 'rename-pane', paneId: 'w1:p1', label: 'Reviewer' });
  expect(parseAction({ type: 'rename-pane', paneId: 'w1:p1', label: '' })).toEqual({ type: 'rename-pane', paneId: 'w1:p1' });
  expect(() => parseAction({ type: 'rename-workspace', workspaceId: 'w1', label: ' ' })).toThrow('Invalid label');
  expect(() => parseAction({ type: 'rename-workspace', workspaceId: 'w1' })).toThrow('Name is required');
  expect(() => parseAction({ type: 'rename-pane', paneId: 'w1:p1', label: 'x'.repeat(65) })).toThrow('too long');
  expect(() => parseAction({ type: 'shell', command: 'id' })).toThrow('Unknown action');
  expect(() => parseAction([])).toThrow('Invalid action');
});

test('branch names and host paths are conservative', () => {
  for (const ok of ['main', 'feat/phone-ui', 'v1.2', 'user_x/fix-3']) expect(validRef(ok)).toBe(true);
  for (const bad of ['-x', 'a..b', 'a//b', 'a/', 'x.lock', '.hidden', 'a/.b', 'a b', 'a@{1}', '']) expect(validRef(bad)).toBe(false);
  expect(hostPath('~', '/home/u')).toBe('/home/u');
  expect(() => hostPath('~other/x', '/home/u')).toThrow();
});

test('action API: paired, same-origin, no-focus Herdr calls and never-forced worktree removal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-actions-'));
  const socketPath = join(directory, 'herdr.sock');
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const workspaces = [
    { workspace_id: 'w1', label: 'repo', worktree: { repo_key: 'k', is_linked_worktree: false } },
    { workspace_id: 'w2', label: 'branch', worktree: { repo_key: 'k', is_linked_worktree: true } },
  ];
  const results: Record<string, unknown> = {
    'session.snapshot': { snapshot: { workspaces, tabs: [], panes: [{ pane_id: 'w1:p1', terminal_id: 't', workspace_id: 'w1', tab_id: 'x' }] } },
    'tab.create': { type: 'tab_created', root_pane: { pane_id: 'w1:p9' } },
    'agent.start': { type: 'agent_started' },
    'workspace.create': { type: 'workspace_created', root_pane: { pane_id: 'w3:p1' } },
    'worktree.create': { type: 'worktree_created', root_pane: { pane_id: 'w4:p1' } },
    'worktree.list': { type: 'worktree_list', worktrees: [
      { path: '/repo', label: 'repo', branch: 'main', is_bare: false, is_prunable: false, is_linked_worktree: false },
      { path: '/wt/a', label: 'a', branch: 'a', is_bare: false, is_prunable: false, is_linked_worktree: true, open_workspace_id: 'w1' },
      { path: '/wt/gone', label: 'gone', is_bare: false, is_prunable: true, is_linked_worktree: true },
    ] },
    'server.agent_manifests': { manifests: [{ agent: 'claude' }, { agent: 'pi' }, { agent: 'claude' }] },
    'pane.close': { type: 'ok' }, 'worktree.remove': { type: 'worktree_removed' },
    'pane.rename': { type: 'ok' }, 'workspace.rename': { type: 'workspace_renamed' },
  };
  const failures: { code: string; message: string }[] = [];
  const rpcServer = createServer(socket => {
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString();
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.split('\n')[0]);
      if (request.method !== 'session.snapshot') calls.push({ method: request.method, params: request.params });
      const error = request.method === 'worktree.remove' ? failures.shift() : undefined;
      socket.end(JSON.stringify(error ? { id: request.id, error }
        : { id: request.id, result: results[request.method] ?? {} }) + '\n');
    });
  });
  rpcServer.listen(socketPath); await once(rpcServer, 'listening');
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory, { HERDR_SOCKET_PATH: socketPath });
    const action = (body: unknown, extra: Record<string, string> = {}) =>
      host!.request('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    expect((await action({ type: 'terminal', workspaceId: 'w1' })).status).toBe(401);
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await action({ type: 'terminal', workspaceId: 'w1' }, { Cookie: cookie, Origin: 'https://evil.invalid' })).status).toBe(403);
    expect(calls).toEqual([]);

    const ok = async (body: unknown) => {
      const response = await action(body, { Cookie: cookie });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await ok({ type: 'terminal', workspaceId: 'w1' })).toEqual({ paneId: 'w1:p9' });
    expect(await ok({ type: 'agent', workspaceId: 'w1', kind: 'claude' })).toEqual({ paneId: 'w1:p9' });
    expect(await ok({ type: 'workspace', cwd: '/srv/app', label: 'App' })).toEqual({ paneId: 'w3:p1' });
    expect(await ok({ type: 'worktree-create', workspaceId: 'w1', branch: 'feat/x' })).toEqual({ paneId: 'w4:p1' });
    expect(await ok({ type: 'close-pane', paneId: 'w1:p1' })).toEqual({});
    failures.push({ code: 'dirty_worktree_requires_force', message: "fatal: contains modified or untracked files, use --force to delete it" });
    const dirty = await action({ type: 'remove-worktree', workspaceId: 'w2' }, { Cookie: cookie });
    expect(dirty.status).toBe(409);
    expect(await dirty.text()).toBe('This worktree has uncommitted or untracked files. Commit or clean them on your PC first.');
    expect(await ok({ type: 'remove-worktree', workspaceId: 'w2', force: true })).toEqual({});
    expect(await ok({ type: 'rename-pane', paneId: 'w1:p1', label: 'Reviewer' })).toEqual({});
    expect(await ok({ type: 'rename-pane', paneId: 'w1:p1' })).toEqual({});
    expect(await ok({ type: 'rename-workspace', workspaceId: 'w2', label: 'Docs' })).toEqual({});
    const refused = await action({ type: 'remove-worktree', workspaceId: 'w1' }, { Cookie: cookie });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('Only linked worktrees');

    expect(calls).toEqual([
      { method: 'tab.create', params: { workspace_id: 'w1', focus: false } },
      { method: 'tab.create', params: { workspace_id: 'w1', focus: false } },
      { method: 'agent.start', params: { pane_id: 'w1:p9', kind: 'claude', name: 'claude', timeout_ms: 30000 } },
      { method: 'workspace.create', params: { cwd: '/srv/app', label: 'App', focus: false } },
      { method: 'worktree.create', params: { workspace_id: 'w1', branch: 'feat/x', base: null, focus: false } },
      { method: 'pane.close', params: { pane_id: 'w1:p1' } },
      { method: 'worktree.remove', params: { workspace_id: 'w2', force: false } },
      { method: 'worktree.remove', params: { workspace_id: 'w2', force: false } },
      { method: 'pane.rename', params: { pane_id: 'w1:p1', label: 'Reviewer' } },
      { method: 'pane.rename', params: { pane_id: 'w1:p1', label: null } },
      { method: 'workspace.rename', params: { workspace_id: 'w2', label: 'Docs' } },
    ]);

    const kinds = await (await host.request('/api/agents', { headers: { Cookie: cookie } })).json();
    // Installed kinds only; when none are on the test PATH, all are offered.
    expect(kinds.kinds.length).toBeGreaterThan(0);
    expect(['claude', 'pi']).toEqual(expect.arrayContaining(kinds.kinds));
    const listing = await (await host.request('/api/worktrees?workspace=w1', { headers: { Cookie: cookie } })).json();
    expect(listing).toEqual({ worktrees: [{ path: '/wt/a', label: 'a', branch: 'a', openPaneId: 'w1:p1' }] });
  } finally {
    await host?.stop();
    await new Promise<void>(resolve => rpcServer.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
