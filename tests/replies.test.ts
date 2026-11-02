import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../src/http-error.ts';
import { AlertReplies, parseAlertReply } from '../src/replies.ts';
import type { Pane } from '../shared/api.ts';
import { startHost, testToken } from './helpers/host.ts';

test('an alert reply is typed once, only while the agent still waits on the same thing and nobody controls it', async () => {
  let pane: Pane | undefined = { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'a', agent: 'claude', agent_status: 'blocked', status_since: 5000 };
  let controlled = false;
  const typed: [string, string][] = [];
  const replies = new AlertReplies({
    pane: async paneId => { if (!pane || pane.pane_id !== paneId) throw new HttpError('Pane no longer exists', 404); return pane; },
    isControlled: () => controlled, type: async (paneId, text) => { typed.push([paneId, text]); },
  });
  const refused = async (since: number, message: string, status = 409) => {
    const error = await replies.send({ paneId: 'w1:p1', since, text: 'Continue' }).then(() => undefined, cause => cause as HttpError);
    expect(error).toBeInstanceOf(HttpError); expect(error!.message).toBe(message); expect(error!.status).toBe(status);
  };

  await refused(4000, 'The agent moved on since this alert. Nothing was sent.'); // An older wait.
  controlled = true;
  await refused(5000, 'Someone is typing in this pane from Whistle. Nothing was sent.');
  controlled = false;
  await replies.send({ paneId: 'w1:p1', since: 5000, text: 'Continue' });
  expect(typed).toEqual([['w1:p1', 'Continue']]);
  await refused(5000, 'This alert was already answered. Nothing more was sent.'); // A second tap.
  pane = { ...pane!, agent_status: 'working', status_since: 6000 };
  await refused(6000, 'The agent moved on since this alert. Nothing was sent.');
  pane = undefined;
  await refused(7000, 'This agent is no longer open. Nothing was sent.', 404);
  expect(typed).toHaveLength(1);
});

test('alert replies are checked before anything is typed', () => {
  expect(parseAlertReply({ paneId: 'w1:p1', since: 5000, text: 'Yes, go ahead' })).toEqual({ paneId: 'w1:p1', since: 5000, text: 'Yes, go ahead' });
  for (const bad of [null, {}, { paneId: '../x', since: 1, text: 'a' }, { paneId: 'w1:p1', since: '1', text: 'a' },
    { paneId: 'w1:p1', since: 1, text: ' ' }, { paneId: 'w1:p1', since: 1, text: 'two\nlines' }, { paneId: 'w1:p1', since: 1, text: 'x'.repeat(501) }]) {
    expect(() => parseAlertReply(bad)).toThrow();
  }
});

test('the reply route types the text, then Enter, into the pane the alert was about', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whistle-replies-'));
  const socketPath = join(dir, 'herdr.sock');
  const calls: [string, unknown][] = [];
  let status = 'working';
  const server = createServer(socket => {
    let buffer = '';
    socket.on('data', data => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      const { id, method, params } = JSON.parse(buffer);
      if (method !== 'session.snapshot') calls.push([method, params]);
      const result = method === 'session.snapshot' ? { snapshot: { panes: [{ pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'a', agent: 'claude', agent_status: status }], workspaces: [], tabs: [] } } : {};
      socket.end(JSON.stringify({ id, result }) + '\n');
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const host = await startHost(dir, { HERDR_SOCKET_PATH: socketPath });
  try {
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const panes = async () => (await (await host.request('/api/panes', { headers: { Cookie: cookie } })).json()).panes[0];
    await panes();
    status = 'blocked';
    const since = (await panes()).status_since;
    expect(typeof since).toBe('number');
    const reply = (headers: Record<string, string> = {}) => host.request('/api/reply', { method: 'POST', headers: { Cookie: cookie, ...headers },
      body: JSON.stringify({ paneId: 'w1:p1', since, text: 'Continue' }) });
    expect((await reply({ Origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await reply()).status).toBe(200);
    expect(calls).toEqual([['pane.send_text', { pane_id: 'w1:p1', text: 'Continue' }], ['pane.send_keys', { pane_id: 'w1:p1', keys: ['enter'] }]]);
    const again = await reply();
    expect(again.status).toBe(409); expect(await again.text()).toBe('This alert was already answered. Nothing more was sent.');
  } finally {
    await host.stop(); server.close(); await rm(dir, { recursive: true, force: true });
  }
});
