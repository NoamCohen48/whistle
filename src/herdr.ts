import { createConnection } from 'node:net';
import { loadHostConfig } from './config.ts';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

const hostConfig = loadHostConfig();
export const socketPath = hostConfig.herdrSocketPath;

export interface Pane {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  label?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  terminal_title_stripped?: string;
  scroll?: { viewport_rows: number };
}
export interface Workspace {
  workspace_id: string;
  label?: string;
  name?: string;
  worktree?: {
    repo_key: string;
    repo_name?: string;
    repo_root?: string;
    checkout_path?: string;
    is_linked_worktree: boolean;
  };
}
export interface Snapshot {
  panes: Pane[];
  workspaces: Workspace[];
  tabs: { tab_id: string; label?: string }[];
}
export interface Frame {
  type: 'terminal.frame';
  bytes: string;
  width: number;
  height: number;
  seq: number;
  full: boolean;
}

export class HerdrError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setTimeout(5000, () => fail(new Error('Herdr request timed out')));
    socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify({ id: crypto.randomUUID(), method, params }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 8 * 1024 * 1024) return fail(new Error('Herdr response too large'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        socket.destroy();
        if (response.error) reject(new HerdrError(response.error.code, response.error.message));
        else resolve(response.result);
      } catch (error) { fail(error as Error); }
    });
    socket.on('end', () => { if (!buffer.includes('\n')) fail(new Error('Herdr closed without a response')); });
  });
}

export async function snapshot(): Promise<Snapshot> {
  return (await rpc('session.snapshot')).snapshot;
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
  const child = spawn(hostConfig.herdrBinary, ['terminal', 'session', mode, paneId, '--cols', String(cols), '--rows', String(rows)], {
    env: { ...process.env, HERDR_SOCKET_PATH: socketPath },
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
      } else if (frame.type === 'terminal.closed') onClose(frame.reason || 'Terminal closed');
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
