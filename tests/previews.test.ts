import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { panePreviews, previewLine } from '../src/previews.ts';
import type { Pane } from '../shared/api.ts';
import { startHost, testToken } from './helpers/host.ts';

test('preview uses the last nonempty plain line and limits Unicode characters', () => {
  expect(previewLine('old\n\x1b[31mready\x1b[0m\n  ')).toBe('ready');
  expect(previewLine('\x1b]0;title\x07\n😀'.repeat(140))).toBe('😀');
  expect(Array.from(previewLine('😀'.repeat(140)))).toHaveLength(120);
  expect(previewLine('\r\n  ')).toBe('');
});

test('previews use only bounded read-only RPCs; failures are omitted', async () => {
  const panes = Array.from({ length: 24 }, (_, i) => ({ pane_id: `p${i}` } as Pane));
  let active = 0, max = 0;
  const result = await panePreviews(panes, async <T>(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<T> => {
    expect(method).toBe('pane.read');
    expect(params).toMatchObject({ source: 'recent', lines: 6, strip_ansi: true });
    expect(timeout).toBeLessThanOrEqual(1500);
    max = Math.max(max, ++active);
    await Bun.sleep(5); active--;
    if (params.pane_id === 'p1') throw new Error('closed');
    return { text: 'working\n' } as T;
  });
  expect(max).toBe(8);
  expect(Object.keys(result)).toHaveLength(23);
  expect(result.p0).toBe('working');
});

test('authenticated previews endpoint is no-store and reads fake panes without mutation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whistle-previews-'));
  const socketPath = join(dir, 'herdr.sock');
  const calls: string[] = [];
  const server = createServer(socket => {
    let buffer = '';
    socket.on('data', data => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      const { id, method, params } = JSON.parse(buffer);
      calls.push(method);
      const result = method === 'session.snapshot' ? { snapshot: { panes: [{ pane_id: 'p1', agent_status: 'working' }], workspaces: [], tabs: [] } }
        : { text: '\x1b[32mfixture ready\x1b[0m\n', pane_id: params.pane_id };
      socket.end(JSON.stringify({ id, result }) + '\n');
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const host = await startHost(dir, { HERDR_SOCKET_PATH: socketPath });
  try {
    expect((await host.request('/api/previews')).status).toBe(401);
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const response = await host.request('/api/previews', { headers: { Cookie: cookie } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ p1: 'fixture ready' });
    expect(calls).toEqual(['session.snapshot', 'pane.read']);
  } finally {
    await host.stop(); server.close(); await rm(dir, { recursive: true, force: true });
  }
});
