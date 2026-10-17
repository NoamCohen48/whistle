import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Pane } from '../../src/herdr.ts';
import { chord, inputKey, validateChord, type Modifier } from '../../src/keys.ts';
import { controlSize, inputScrollTop, pageScroll } from '../../src/viewport.ts';

export type Phase = 'idle' | 'connecting' | 'requesting-control' | 'watching' | 'controlling' | 'disconnected' | 'paused';
export interface SessionState {
  phase: Phase;
  fitWidth: boolean;
  modifiers: Modifier[];
  error: string;
}
export const INITIAL_SESSION: SessionState = { phase: 'idle', fitWidth: true, modifiers: [], error: '' };

// This class owns all high-frequency terminal state. React receives only UI transitions,
// never terminal frames, cursor positions, scroll offsets, pending ACKs or typed bytes.
export class TerminalSession {
  private readonly terminal: Terminal;
  private readonly fit = new FitAddon();
  private readonly listeners = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private state: SessionState = { ...INITIAL_SESSION, modifiers: [] };
  private pane?: Pane;
  private socket?: WebSocket;
  private generation = 0;
  private sequence = 0;
  private watchCols = 120;
  private watchRows = 40;
  private reconnectDelay = 1000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<number, number>();
  private followInput = true;
  private expectedScrollTop?: number;
  private touchY?: number;
  private disposed = false;

  constructor(private readonly viewport: HTMLElement, private readonly host: HTMLElement,
    private readonly onState: (state: SessionState) => void) {
    this.terminal = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", "DejaVu Sans Mono", monospace',
      fontSize: 13, lineHeight: 1.18, cursorBlink: true, scrollback: 1500,
      allowProposedApi: false, allowTransparency: false, convertEol: false, disableStdin: true,
      theme: { background: '#141819', foreground: '#e5ebea', cursor: '#bad7a1', selectionBackground: '#4b665a' },
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.open(host);
    const textarea = this.terminal.textarea;
    textarea?.setAttribute('aria-label', 'Live terminal input');
    textarea?.setAttribute('autocapitalize', 'off');
    textarea?.setAttribute('autocorrect', 'off');
    textarea?.setAttribute('spellcheck', 'false');
    this.terminal.onData(data => {
      if (!this.state.modifiers.length) { this.send({ type: 'input', text: data }); return; }
      const key = inputKey(data);
      if (key) this.sendKey(key);
      else { this.clearModifiers(); this.fail('Modified paste was not sent. Use Keys to choose the exact chord.'); }
    });
    const signal = this.listeners.signal;
    viewport.addEventListener('scroll', () => {
      if (this.expectedScrollTop !== undefined && Math.abs(viewport.scrollTop - this.expectedScrollTop) < 1) {
        this.expectedScrollTop = undefined; return;
      }
      this.followInput = false;
    }, { passive: true, signal });
    viewport.addEventListener('wheel', event => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault(); event.stopPropagation();
      let scale = 1;
      if (event.deltaMode === 1) scale = 17;
      if (event.deltaMode === 2) scale = viewport.clientHeight;
      this.scroll(event.deltaY < 0 ? 'up' : 'down', Math.abs(event.deltaY) * scale);
    }, { passive: false, capture: true, signal });
    viewport.addEventListener('touchstart', event => { this.touchY = event.touches[0]?.clientY; }, { passive: true, signal });
    viewport.addEventListener('touchmove', event => {
      if (this.touchY === undefined || event.touches.length !== 1) return;
      const delta = this.touchY - event.touches[0].clientY;
      if (Math.abs(delta) < 8) return;
      event.preventDefault(); event.stopPropagation(); this.touchY = event.touches[0].clientY;
      this.scroll(delta < 0 ? 'up' : 'down', Math.abs(delta));
    }, { passive: false, capture: true, signal });
    viewport.addEventListener('touchend', () => { this.touchY = undefined; }, { passive: true, signal });
    window.addEventListener('resize', this.resize, { signal });
    window.visualViewport?.addEventListener('resize', this.resize, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.disconnect(); this.update({ phase: 'paused' }); }
      else if (this.pane) this.connect(false);
    }, { signal });
    window.addEventListener('pagehide', () => this.disconnect(), { signal });
    window.addEventListener('pageshow', event => { if (event.persisted && this.pane) this.connect(false); }, { signal });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(viewport);
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('{"type":"ping"}');
      if (this.pending.size && Date.now() - Math.min(...this.pending.values()) > 5000) {
        this.fail('Input write not confirmed. Check the pane before retrying; nothing will be replayed.');
        this.socket?.close();
      }
    }, 10_000);
    this.resize();
  }

  private update(patch: Partial<SessionState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.terminal.options.disableStdin = this.state.phase !== 'controlling';
    this.onState(this.state);
  }
  private fail(message: string) { this.update({ error: message }); }
  clearError() { this.update({ error: '' }); }
  clearModifiers() { if (this.state.modifiers.length) this.update({ modifiers: [] }); }
  toggleModifier(modifier: Modifier) {
    if (this.state.phase !== 'controlling') return;
    const armed = new Set(this.state.modifiers);
    if (armed.has(modifier)) armed.delete(modifier); else armed.add(modifier);
    this.update({ modifiers: [...armed] });
  }
  open(pane: Pane) {
    if (this.pane?.pane_id === pane.pane_id && this.pane.terminal_id === pane.terminal_id) return;
    this.disconnect(); this.pane = pane; this.connect(false);
  }
  close() { this.disconnect(); this.pane = undefined; }
  reconnect() { if (this.pane) this.connect(false); }
  toggleControl() {
    if (this.state.phase === 'requesting-control' || this.state.phase === 'connecting') return;
    this.clearError(); this.connect(this.state.phase !== 'controlling');
  }
  toggleWidth() { this.update({ fitWidth: !this.state.fitWidth }); this.resize(); }

  private disconnect() {
    this.generation++;
    clearTimeout(this.reconnectTimer);
    const old = this.socket; this.socket = undefined;
    old?.close(1000, 'Leaving pane');
    if (this.pending.size) this.fail('Some input writes were not confirmed. Check the pane before retrying; nothing will be replayed.');
    this.pending.clear();
    this.update({ phase: 'idle', modifiers: [] });
  }
  private connect(control: boolean) {
    const pane = this.pane;
    if (!pane || document.hidden || this.disposed) return;
    this.disconnect();
    const epoch = this.generation;
    this.followInput = true; this.expectedScrollTop = undefined;
    const size = this.fittedSize();
    const cols = control && this.state.fitWidth ? size.cols : this.watchCols;
    const rows = control ? size.rows : this.watchRows;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ pane: pane.pane_id, mode: control ? 'control' : 'observe', cols: String(cols), rows: String(rows) });
    const ws = new WebSocket(`${protocol}//${location.host}/terminal?${query}`);
    this.socket = ws;
    this.update({ phase: control ? 'requesting-control' : 'connecting' });
    this.terminal.reset();
    let received = false;
    ws.onmessage = event => {
      if (epoch !== this.generation || this.disposed) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'terminal.frame') {
          if (!received) {
            received = true; this.reconnectDelay = 1000;
            this.update({ phase: control ? 'controlling' : 'watching' });
          }
          if (!control) { this.watchCols = message.width; this.watchRows = message.height; }
          this.terminal.resize(message.width, message.height);
          this.terminal.write(Uint8Array.from(atob(message.bytes), c => c.charCodeAt(0)), () => {
            if (epoch === this.generation && !this.disposed && this.followInput) this.revealInput();
          });
        } else if (message.type === 'ack') this.pending.delete(message.id);
        else if (message.type === 'key-rejected') { this.pending.delete(message.id); this.fail(message.message); }
        else if (message.type === 'error') this.fail(message.message);
      } catch { this.fail('Could not decode terminal data.'); ws.close(); }
    };
    ws.onerror = () => { if (epoch === this.generation) this.fail('Connection failed. Pane may be unavailable or already controlled.'); };
    ws.onclose = () => {
      if (epoch !== this.generation || this.disposed) return;
      this.update({ phase: 'disconnected', modifiers: [] });
      if (this.pending.size) this.fail('Input delivery is uncertain. Check the pane before retrying. Nothing is replayed.');
      this.pending.clear();
      if (!document.hidden) {
        this.reconnectTimer = setTimeout(() => this.connect(false), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
      }
    };
  }
  private send(command: { type: 'input'; text: string } | { type: 'key'; key: string }) {
    if (this.state.phase !== 'controlling' || this.socket?.readyState !== WebSocket.OPEN) {
      this.fail('Not controlling this pane. Input was not sent.'); return;
    }
    if (this.socket.bufferedAmount > 64 * 1024) {
      this.fail('Connection is too slow. Input was not sent.'); this.socket.close(); return;
    }
    const id = ++this.sequence;
    this.pending.set(id, Date.now());
    this.socket.send(JSON.stringify({ ...command, id }));
  }
  sendKey(key: string) {
    try {
      const parts = validateChord(key).split('+');
      const base = parts.pop() || '';
      this.send({ type: 'key', key: chord(base, new Set<Modifier>([...this.state.modifiers, ...parts as Modifier[]])) });
      this.clearModifiers();
    } catch (error) { this.fail((error as Error).message); }
  }
  shortcut(key: string) { this.clearModifiers(); this.sendKey(key); }
  paste(value: string, submit: boolean) {
    if (!value || this.state.phase !== 'controlling') return;
    this.clearModifiers();
    const text = value.replace(/\r?\n/g, '\r');
    const bracketed = this.terminal.modes.bracketedPasteMode;
    if (!bracketed && /[\r\n]/.test(text)) { this.fail('Multiline paste requires bracketed-paste support; nothing was sent.'); return; }
    this.send({ type: 'input', text: (bracketed ? '\x1b[200~' + text.replace(/\x1b/g, '') + '\x1b[201~' : text) + (submit ? '\r' : '') });
  }
  private fittedSize() {
    const size = this.fit.proposeDimensions();
    return controlSize(size?.cols || 45, size?.rows || 20);
  }
  resize = () => {
    if (this.disposed) return;
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    document.documentElement.classList.toggle('short-viewport', height < 600);
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (this.disposed) return;
      if (this.followInput) this.revealInput();
      if (this.state.phase !== 'controlling' || this.socket?.readyState !== WebSocket.OPEN) return;
      const size = this.fittedSize();
      this.socket.send(JSON.stringify({ type: 'resize', cols: this.state.fitWidth ? size.cols : this.watchCols, rows: size.rows }));
    }, 180);
  };
  private setViewTop(top: number) { this.viewport.scrollTop = top; this.expectedScrollTop = this.viewport.scrollTop; }
  private revealInput() {
    const screen = this.host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return;
    this.setViewTop(inputScrollTop(this.terminal.buffer.active.cursorY, this.terminal.rows, screen.offsetHeight,
      this.viewport.clientHeight, Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight)));
  }
  jumpToInput() { this.followInput = true; this.revealInput(); }
  focusKeyboard() { this.jumpToInput(); this.terminal.focus(); }
  scroll(direction: 'up' | 'down', pixels = 8 * 17) {
    this.followInput = false;
    const result = pageScroll(this.viewport.scrollTop, Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight), direction, pixels);
    if (!result.remote) this.setViewTop(result.top);
    else if (this.state.phase === 'controlling' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'scroll', direction, lines: Math.min(30, Math.max(1, Math.ceil(pixels / 17))) }));
    }
  }
  // Read-only: the terminal's text (scrollback and screen) for selecting and copying on the
  // phone. Wrapped rows are joined back into their logical line. Sends nothing, changes nothing.
  text() {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row);
      if (!line) continue;
      if (line.isWrapped && lines.length) lines[lines.length - 1] += line.translateToString(false);
      else lines.push(line.translateToString(false));
    }
    const trimmed = lines.map(line => line.trimEnd());
    while (trimmed.length && !trimmed.at(-1)) trimmed.pop();
    return trimmed.join('\n');
  }
  dispose() {
    if (this.disposed) return;
    this.disconnect(); this.disposed = true;
    clearTimeout(this.resizeTimer); clearInterval(this.heartbeat);
    this.listeners.abort(); this.observer.disconnect(); this.terminal.dispose();
  }
}
