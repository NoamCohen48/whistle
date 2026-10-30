import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { HerdrError, rpc, terminalStream } from './herdr.ts';
import { parseCommand, type ClientCommand, type ServerMessage } from '../shared/protocol.ts';

// Pause between a pasted draft and its Enter, so the program has taken the paste in first.
const SUBMIT_DELAY_MS = 250;
const MAX_PENDING = 100;

export interface Peer {
  deviceId: string;
  paneId: string;
  mode: 'observe' | 'control';
  cols: number;
  rows: number;
  stream?: ReturnType<typeof terminalStream>;
  queue: Promise<void>;
  pending: number;
  lastId: number;
  closed: boolean;
}
type Socket = ServerWebSocket<Peer>;
type Command = Exclude<ClientCommand, { type: 'ping' }>;

// Live terminal connections from phones. A phone watches a pane or controls it, and only one
// phone controls a pane at a time. Each connection's commands run one after another, and input
// is never retried or replayed: after any failure the connection closes.
export class TerminalSockets {
  private readonly controllers = new Map<string, Socket>();
  private readonly peers = new Set<Socket>();
  constructor(private readonly isActive: (deviceId: string) => boolean) {}

  // The state of a connection that is about to be upgraded.
  static peer(deviceId: string, paneId: string, mode: Peer['mode'], size: { cols: number; rows: number }): Peer {
    return { deviceId, paneId, mode, ...size, queue: Promise.resolve(), pending: 0, lastId: 0, closed: false };
  }

  isControlled(paneId: string) { return this.controllers.has(paneId); }

  // A phone with the pane open is already looking at it.
  isWatching(deviceId: string, paneId: string) {
    return [...this.peers].some(peer => peer.data.deviceId === deviceId && peer.data.paneId === paneId && !peer.data.closed);
  }

  // Closes a revoked device's connections at once.
  disconnect(deviceId: string, message: string) {
    for (const peer of this.peers) if (peer.data.deviceId === deviceId) this.fail(peer, message, 1008, 'Device revoked');
  }

  closeInactive() {
    for (const peer of this.peers) if (!this.isActive(peer.data.deviceId)) { this.end(peer); peer.close(1008, 'Device expired or revoked'); }
  }

  // Resolves once every Herdr stream has exited, so controllers have released their panes.
  closeAll() {
    return Promise.all([...this.peers].map(peer => {
      const closed = peer.data.stream?.closed;
      this.end(peer); peer.close(1001, 'Server stopping');
      return closed;
    }));
  }

  readonly handlers: WebSocketHandler<Peer> = {
    idleTimeout: 30,
    maxPayloadLength: 128 * 1024,
    backpressureLimit: 2 * 1024 * 1024,
    closeOnBackpressureLimit: true,
    open: ws => this.open(ws),
    message: (ws, raw) => this.receive(ws, typeof raw === 'string' ? raw : raw.toString()),
    close: ws => this.end(ws),
  };

  private open(ws: Socket) {
    const peer = ws.data;
    if (!this.isActive(peer.deviceId)) { this.end(ws); ws.close(1008, 'Device expired or revoked'); return; }
    if (peer.mode === 'control') {
      if (this.controllers.has(peer.paneId)) { ws.close(1008, 'Pane already controlled'); return; }
      this.controllers.set(peer.paneId, ws);
    }
    this.peers.add(ws);
    peer.stream = terminalStream(peer.paneId, peer.mode, peer.cols, peer.rows,
      frame => this.send(ws, { ...frame, mode: peer.mode }),
      reason => this.fail(ws, reason, 1011, 'Herdr stream ended'),
    );
  }

  private receive(ws: Socket, raw: string) {
    const peer = ws.data;
    let command: Command;
    try {
      if (!this.isActive(peer.deviceId)) throw new Error('Device expired or revoked');
      const parsed = parseCommand(raw);
      if (parsed.type === 'ping') { this.send(ws, { type: 'pong' }); return; }
      if (peer.mode !== 'control') throw new Error('Take control before sending input');
      if (peer.pending >= MAX_PENDING) throw new Error('Too many pending inputs; stopped rather than replaying');
      command = parsed;
    } catch (error) { this.fail(ws, (error as Error).message, 1008, 'Invalid command'); return; }
    peer.pending++;
    peer.queue = peer.queue
      .then(() => this.run(ws, command))
      .catch(error => this.fail(ws, (error as Error).message, 1011, 'Input failed; not retried'))
      .finally(() => { peer.pending--; });
  }

  // One command, after every command before it on this connection has finished.
  private async run(ws: Socket, command: Command) {
    const peer = ws.data;
    if (peer.closed) return;
    if (!this.isActive(peer.deviceId)) throw new Error('Device expired or revoked');
    const stream = peer.stream;
    if (!stream) throw new Error('Terminal stream is not open');
    if (command.type === 'resize') return stream.send({ type: 'terminal.resize', cols: command.cols, rows: command.rows });
    if (command.type === 'scroll') return stream.send({ type: 'terminal.scroll', direction: command.direction, lines: command.lines });
    if (!stream.controlled) throw new Error('Terminal is not controlled');
    if (command.id <= peer.lastId) throw new Error('Duplicate or out-of-order input');
    peer.lastId = command.id;
    // Text and chords share this one serial lane. Mixing CLI stdin and key RPCs could let a
    // shortcut overtake previously typed text.
    try {
      if (command.type === 'key') await rpc('pane.send_keys', { pane_id: peer.paneId, keys: [command.key] });
      else {
        await rpc('pane.send_text', { pane_id: peer.paneId, text: command.text });
        // Enter in the same write as a paste is read as part of it (Claude Code just pastes), so it
        // follows as its own key once the paste has landed.
        if (command.submit) {
          await Bun.sleep(SUBMIT_DELAY_MS);
          if (peer.closed || !stream.controlled) throw new Error('Control ended before Enter; the text was pasted but not submitted');
          await rpc('pane.send_keys', { pane_id: peer.paneId, keys: ['enter'] });
        }
      }
      this.send(ws, { type: 'ack', id: command.id });
    } catch (error) {
      // An unknown chord is refused without ending control; nothing was typed.
      if (command.type === 'key' && error instanceof HerdrError && error.code === 'invalid_key') {
        this.send(ws, { type: 'key-rejected', id: command.id, message: error.message });
      } else throw error;
    }
  }

  private send(ws: Socket, message: ServerMessage) {
    if (!ws.data.closed) ws.send(JSON.stringify(message));
  }

  private fail(ws: Socket, message: string, code: number, reason: string) {
    this.send(ws, { type: 'error', message });
    this.end(ws); ws.close(code, reason);
  }

  private end(ws: Socket) {
    ws.data.closed = true;
    ws.data.stream?.stop();
    if (this.controllers.get(ws.data.paneId) === ws) this.controllers.delete(ws.data.paneId);
    this.peers.delete(ws);
  }
}
