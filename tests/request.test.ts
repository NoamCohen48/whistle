import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { PairingRequired, RequestError, request } from '../web/request.ts';

afterEach(() => { mock.restore(); });
function mockFetch(implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(implementation, { preconnect: globalThis.fetch.preconnect }));
}

test('read errors explain connection recovery and mutations never auto-retry', async () => {
  let attempts = 0;
  mockFetch(() => { attempts++; return Promise.reject(new TypeError('Failed to fetch')); });
  await expect(request('/api/panes')).rejects.toThrow('Check its connection and that Tailscale is on');
  await expect(request('/api/actions', { method: 'POST' })).rejects.toThrow('The action may have completed');
  expect(attempts).toBe(2);
});

test('caller cancellation is preserved rather than shown as a connection error', async () => {
  const controller = new AbortController();
  const reason = new DOMException('Closed sheet', 'AbortError'); controller.abort(reason);
  mockFetch(() => Promise.reject(reason));
  try { await request('/api/panes', { signal: controller.signal }); throw new Error('Expected cancellation'); }
  catch (cause) { expect(cause).toBe(reason); }
});

test('unauthorized API requests require pairing, but incorrect token entry does not revoke local drafts', async () => {
  mockFetch(() => Promise.resolve(new Response('Incorrect access token', { status: 401 })));
  await expect(request('/api/panes')).rejects.toBeInstanceOf(PairingRequired);
  await expect(request('/api/login', { method: 'POST' }, false)).rejects.toBeInstanceOf(RequestError);
  await expect(request('/api/login', { method: 'POST' }, false)).rejects.toThrow('Incorrect access token');
});

test('read and mutation requests have bounded deadlines with distinct recovery guidance', async () => {
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
  mockFetch((_input, init) => Promise.reject(init?.signal?.reason));
  try {
    await expect(request('/api/panes')).rejects.toThrow('The PC did not reply in time. Check Tailscale and retry.');
    await expect(request('/api/actions', { method: 'POST' })).rejects.toThrow('The action may have completed');
    expect(timeout.mock.calls.map(call => call[0])).toEqual([12_000, 30_000]);
  } finally { timeout.mockRestore(); }
});

test('a caller signal still works in browsers without AbortSignal.any', async () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;
  delete (AbortSignal as { any?: unknown }).any;
  try {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    mockFetch((_input, init) => { seen = init!.signal!; return Promise.resolve(new Response('{}')); });
    await request('/api/panes', { signal: controller.signal });
    expect(seen!.aborted).toBe(false);
    controller.abort();
    expect(seen!.aborted).toBe(true);
  } finally { Object.defineProperty(AbortSignal, 'any', any); }
});
