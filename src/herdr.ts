import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { HostConfig } from './config.ts';
import { HttpError } from './http-error.ts';
import type { Pane, Snapshot } from '../shared/api.ts';
import type { ServerMessage } from '../shared/protocol.ts';

// Where Herdr is. Set once at startup from the host's configuration.
type HerdrLocation = Pick<HostConfig, 'herdrSocketPath' | 'herdrBinary'>;
let location: HerdrLocation | undefined;
export function useHerdr(config: HerdrLocation) { location = config; }
function herdrConfig() {
  if (!location) throw new Error('useHerdr() must be called before talking to Herdr');
  return location;
}

// One terminal frame from Herdr; the host adds the mode before sending it to the phone.
type Frame = Omit<Extract<ServerMessage, { type: 'terminal.frame' }>, 'mode'>;

// Herdr answered and refused the request.
export class HerdrError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
// Herdr could not be reached, or did not answer properly. A connection error names the socket
// path, so it is kept as the cause for the host's log rather than shown on the phone.
export class HerdrUnavailable extends Error {
  constructor(message = 'Herdr is not reachable. Check that Herdr is running on the PC.', options?: ErrorOptions) { super(message, options); }
}

// One request to Herdr's socket. Uses Bun's own socket API: a failed node:net connection to a
// Unix socket inside Bun.serve crashes the process (Bun 1.3) instead of emitting 'error'.
export function rpc<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let buffer = '';
    let settled = false;
    let connection: { terminate(): void } | undefined;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection?.terminate();
      finish();
    };
    const fail = (error: HerdrUnavailable) => settle(() => reject(error));
    const timer = setTimeout(() => fail(new HerdrUnavailable('Herdr did not answer in time.')), timeoutMs);
    let path: string;
    try { path = herdrConfig().herdrSocketPath; } catch (error) { settle(() => reject(error)); return; }
    Bun.connect({ unix: path, socket: {
      open(socket) {
        connection = socket;
        if (settled) socket.terminate();
        else socket.write(JSON.stringify({ id: crypto.randomUUID(), method, params }) + '\n');
      },
      data(_socket, chunk) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 8 * 1024 * 1024) return fail(new HerdrUnavailable('Herdr sent an answer that is too large.'));
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        let response;
        try { response = JSON.parse(buffer.slice(0, newline)); }
        catch (cause) { return fail(new HerdrUnavailable('Herdr sent an answer Whistle cannot read.', { cause })); }
        settle(() => response.error ? reject(new HerdrError(response.error.code, response.error.message)) : resolve(response.result));
      },
      close() { fail(new HerdrUnavailable('Herdr closed the connection without answering.')); },
      error(_socket, cause) { fail(new HerdrUnavailable(undefined, { cause })); },
      connectError(_socket, cause) { fail(new HerdrUnavailable(undefined, { cause })); },
    } }).catch(cause => fail(new HerdrUnavailable(undefined, { cause })));
  });
}

export async function snapshot(): Promise<Snapshot> {
  return (await rpc('session.snapshot')).snapshot;
}

// A pane that is still open, or a 404.
export async function findPane(paneId: string | null) {
  const pane = (await snapshot()).panes.find(item => item.pane_id === paneId);
  if (!pane) throw new HttpError('Pane no longer exists', 404);
  return pane;
}

export async function watchSize(pane: Pane) {
  const result = await rpc('pane.layout', { pane_id: pane.pane_id });
  const rect = result.layout.panes.find((p: any) => p.pane_id === pane.pane_id)?.rect;
  return { cols: Math.max(2, (rect?.width ?? 122) - 2), rows: pane.scroll?.viewport_rows ?? 40 };
}

// CLI arguments are separate argv entries, never interpolated into a shell.
export function terminalStream(
  paneId: string, mode: 'observe' | 'control', cols: number, rows: number,
  onFrame: (frame: Frame) => void, onClose: (reason: string) => void,
) {
  const { herdrBinary, herdrSocketPath } = herdrConfig();
  const child = spawn(herdrBinary, ['terminal', 'session', mode, paneId, '--cols', String(cols), '--rows', String(rows)], {
    env: { ...process.env, HERDR_SOCKET_PATH: herdrSocketPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let stopped = false;
  let stderr = '';
  let firstFrame = false;
  const deadline = setTimeout(() => {
    if (!firstFrame) { onClose(stderr || 'Herdr did not open the terminal stream'); stop(); }
  }, 5000);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const frame = JSON.parse(line);
      if (frame.type === 'terminal.frame') {
        firstFrame = true;
        clearTimeout(deadline);
        onFrame(frame);
      } else if (frame.type === 'terminal.closed') { onClose(frame.reason || 'Terminal closed'); stop(); }
    } catch { onClose('Invalid terminal frame'); stop(); }
  });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-2000); });
  // Always consume pipe errors, including release racing a process exit.
  child.stdin.on('error', () => {});
  child.on('error', error => { if (!stopped) onClose(error.message); });
  child.on('exit', () => {
    clearTimeout(deadline);
    if (!stopped) onClose(stderr || 'Terminal stream ended');
  });
  function stop() {
    if (stopped) return closed;
    stopped = true;
    clearTimeout(deadline);
    lines.close();
    if (mode === 'control' && child.stdin.writable) child.stdin.end('{"type":"terminal.release"}\n');
    else child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGTERM'), 750);
    timer.unref();
    void closed.then(() => clearTimeout(timer));
    return closed;
  }
  return {
    stop, closed,
    get controlled() { return !stopped && mode === 'control' && firstFrame && child.stdin.writable; },
    async send(command: Record<string, unknown>) {
      if (stopped || mode !== 'control' || !firstFrame || !child.stdin.writable) throw new Error('Terminal is not controlled');
      if (!child.stdin.write(JSON.stringify(command) + '\n')) await once(child.stdin, 'drain');
    },
  };
}
