import { expect, test } from 'bun:test';
import WebSocket from 'ws';
import { hostConnection } from '../src/host-client.ts';
import { loadHostConfig } from '../src/config.ts';
import { rpc, useHerdr } from '../src/herdr.ts';

// Explicit opt-in: this test types commands into a disposable shell pane.
// Never point WHISTLE_TEST_PANE at a real agent or the calling pane.
const paneId = process.env.WHISTLE_TEST_PANE;
const base = process.env.WHISTLE_TEST_URL || 'http://127.0.0.1:8790';
const integration = paneId ? test : test.skip;

integration('real Herdr: auth, watch, ordered edits + Enter, resize, release, watch write rejection', async () => {
  useHerdr(loadHostConfig());
  const unauth = await fetch(`${base}/api/panes`);
  expect(unauth.status).toBe(401);
  const { token } = await hostConnection();
  const badOrigin = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  expect(badOrigin.status).toBe(403);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  const before = await rpc('pane.get', { pane_id: paneId });
  const connect = (mode: string) => new WebSocket(`${base.replace('http', 'ws')}/terminal?pane=${encodeURIComponent(paneId!)}&mode=${mode}&cols=45&rows=18`, { headers: { Cookie: cookie!, Origin: base } });
  const frame = (ws: WebSocket) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Frame timeout')), 6000);
    ws.addEventListener('message', function listener(event) {
      try {
        const value = JSON.parse(String(event.data));
        if (value.type === 'error') { clearTimeout(timer); reject(new Error(value.message)); }
        if (value.type === 'terminal.frame') { clearTimeout(timer); ws.removeEventListener('message', listener); resolve(value); }
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket failed')); }, { once: true });
  });
  const watch = connect('observe');
  try {
    await frame(watch);
    const unchanged = await rpc('pane.get', { pane_id: paneId });
    expect(unchanged.pane.scroll.viewport_rows).toBe(before.pane.scroll.viewport_rows);
  } finally { watch.close(); }
  await Bun.sleep(250);
  const control = connect('control');
  try {
    const first = await frame(control);
    expect([first.width, first.height]).toEqual([45, 18]);
    const marker = `WHISTLE_TEST_${Date.now()}`;
    control.send(JSON.stringify({ type: 'input', id: 1, text: `printf '${marker}_12x` }));
    control.send(JSON.stringify({ type: 'key', id: 2, key: 'backspace' }));
    control.send(JSON.stringify({ type: 'input', id: 3, text: "3\\n'" }));
    control.send(JSON.stringify({ type: 'key', id: 4, key: 'enter' }));
    let output = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      await Bun.sleep(100);
      const result = await rpc('pane.read', { pane_id: paneId, source: 'visible', lines: 100, format: 'text' });
      output = result.read.text;
      if (output.split('\n').some((line: string) => line.trim() === `${marker}_123`)) break;
    }
    expect(output.split('\n').map(line => line.trim())).toContain(`${marker}_123`);
    const rejected = new Promise<string>(resolve => {
      control.addEventListener('message', event => {
        try { const value = JSON.parse(String(event.data)); if (value.type === 'key-rejected') resolve(value.message); }
        catch { resolve('Malformed response'); }
      });
    });
    control.send('{"type":"key","id":5,"key":"not-a-real-key"}');
    expect(await Promise.race([rejected, Bun.sleep(2000).then(() => 'timeout')])).toContain('unsupported key');
    expect(control.readyState).toBe(WebSocket.OPEN);
    control.send('{"type":"resize","cols":50,"rows":20}');
    await Bun.sleep(250);
    const resized = await rpc('pane.get', { pane_id: paneId });
    expect(resized.pane.scroll.viewport_rows).toBe(20);
  } finally { control.close(); }
  await Bun.sleep(1000);
  const restored = await rpc('pane.get', { pane_id: paneId });
  expect(restored.pane.scroll.viewport_rows).toBe(before.pane.scroll.viewport_rows);
  const readOnly = connect('observe');
  try {
    await frame(readOnly);
    const denied = new Promise<string>(resolve => {
      readOnly.addEventListener('message', event => {
        try { const value = JSON.parse(String(event.data)); if (value.type === 'error') resolve(value.message); }
        catch { resolve('Malformed response'); }
      });
    });
    readOnly.send('{"type":"input","id":1,"text":"DO_NOT_SEND"}');
    expect(await Promise.race([denied, Bun.sleep(2000).then(() => 'timeout')])).toContain('Take control');
  } finally { readOnly.close(); }
}, 20_000);
