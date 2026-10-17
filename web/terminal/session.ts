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
  private touchMoved = false;
  private touchSamples: { y: number; time: number }[] = [];
  private flingFrame?: number;
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
      event.preventDefault(); event.stopPropagation(); this.stopFling();
      let scale = 1;
      if (event.deltaMode === 1) scale = 17;
      if (event.deltaMode === 2) scale = viewport.clientHeight;
      this.scroll(event.deltaY < 0 ? 'up' : 'down', Math.abs(event.deltaY) * scale);
    }, { passive: false, capture: true, signal });
    viewport.addEventListener('touchstart', event => {
      this.stopFling(); this.touchSamples = []; this.touchMoved = false;
      this.touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
      if (this.touchY !== undefined) this.sampleTouch(this.touchY);
    }, { passive: true, signal });
    viewport.addEventListener('touchmove', event => {
      if (event.touches.length !== 1) { this.touchY = undefined; this.touchSamples = []; return; }
      if (this.touchY === undefined) return;
      this.sampleTouch(event.touches[0].clientY);
      const delta = this.touchY - event.touches[0].clientY;
      if (Math.abs(delta) < 8) return;
      event.preventDefault(); event.stopPropagation(); this.touchMoved = true; this.touchY = event.touches[0].clientY;
      this.scroll(delta < 0 ? 'up' : 'down', Math.abs(delta));
    }, { passive: false, capture: true, signal });
    viewport.addEventListener('touchend', event => {
      if (this.touchMoved && this.touchY !== undefined && !event.touches.length) {
        this.sampleTouch(event.changedTouches[0]?.clientY ?? this.touchY);
        const first = this.touchSamples[0], last = this.touchSamples.at(-1);
        if (first && last && last.time > first.time) this.startFling((first.y - last.y) / (last.time - first.time));
      }
      this.touchY = undefined; this.touchSamples = [];
    }, { passive: true, signal });
    viewport.addEventListener('touchcancel', () => {
      this.stopFling(); this.touchY = undefined; this.touchSamples = [];
    }, { passive: true, signal });
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

  private sampleTouch(y: number) {
    const time = performance.now();
    this.touchSamples = this.touchSamples.filter(sample => time - sample.time <= 100);
    this.touchSamples.push({ y, time });
  }
  private stopFling() {
    if (this.flingFrame !== undefined) cancelAnimationFrame(this.flingFrame);
    this.flingFrame = undefined;
  }
  private startFling(speed: number) {
    this.stopFling();
    if (Math.abs(speed) < 0.5 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let velocity = Math.sign(speed) * Math.min(Math.abs(speed), 3.5) * Math.min(3, 1.5 + Math.abs(speed) / 3);
    let previous = performance.now();
    this.followInput = false;
    const frame = (now: number) => {
      this.flingFrame = undefined;
      const elapsed = Math.min(32, Math.max(0, now - previous)); previous = now;
      const { top: current, max } = this.scrollInfo();
      const top = Math.max(0, Math.min(max, current + velocity * elapsed));
      this.setLocalTop(top); // Local only: momentum can never request PC history.
      velocity *= Math.pow(0.95, elapsed / 16);
      if (top <= 0 || top >= max || Math.abs(velocity) < 0.03) return;
      this.flingFrame = requestAnimationFrame(frame);
    };
    this.flingFrame = requestAnimationFrame(frame);
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
    this.stopFling(); this.touchY = undefined; this.touchSamples = [];
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
          const firstFrame = !received;
          if (!received) {
            received = true; this.reconnectDelay = 1000;
            this.update({ phase: control ? 'controlling' : 'watching' });
          }
          if (!control) { this.watchCols = message.width; this.watchRows = message.height; }
          this.terminal.resize(message.width, message.height);
          this.terminal.write(Uint8Array.from(atob(message.bytes), c => c.charCodeAt(0)), () => {
            // Resetting the previous pane can queue a native scroll event before this
            // first write finishes. It must not strand a newly opened pane in reading mode.
            if (epoch === this.generation && !this.disposed && (firstFrame || this.followInput)) {
              this.followInput = true; this.revealInput();
            }
          });
        } else if (message.type === 'ack') this.pending.delete(message.id);
        else if (message.type === 'key-rejected') { this.pending.delete(message.id); this.fail(message.message); }
        else if (message.type === 'error') this.fail(message.message);
      } catch { this.fail('Could not decode terminal data.'); ws.close(); }
    };
    ws.onerror = () => { if (epoch === this.generation) this.fail('Connection failed. Pane may be unavailable or already controlled.'); };
    ws.onclose = () => {
      if (epoch !== this.generation || this.disposed) return;
      this.stopFling();
      this.update({ phase: 'disconnected', modifiers: [] });
      if (this.pending.size) this.fail('Input delivery is uncertain. Check the pane before retrying. Nothing is replayed.');
      this.pending.clear();
      if (!document.hidden) {
        this.reconnectTimer = setTimeout(() => this.connect(false), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
      }
    };
  }
  private send(command: { type: 'input'; text: string; submit?: boolean } | { type: 'key'; key: string }) {
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
  // Herdr frames are rendered screens, so a mirror attached mid-session may never see the program
  // turn bracketed paste on. Coding agents always accept it; the caller says when the pane is one.
  paste(value: string, submit: boolean, agent = false) {
    if (!value || this.state.phase !== 'controlling') return;
    this.clearModifiers();
    const text = value.replace(/\r?\n/g, '\r');
    const bracketed = this.terminal.modes.bracketedPasteMode || agent;
    if (!bracketed && /[\r\n]/.test(text)) { this.fail('This terminal did not say it accepts pasted lines, so nothing was sent. Send one line at a time.'); return; }
    this.send({ type: 'input', text: bracketed ? '\x1b[200~' + text.replace(/\x1b/g, '') + '\x1b[201~' : text, ...(submit ? { submit: true } : {}) });
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
  private inputTop() {
    const screen = this.host.querySelector<HTMLElement>('.xterm-screen');
    return inputScrollTop(this.terminal.buffer.active.cursorY, this.terminal.rows, screen?.offsetHeight || 0,
      this.viewport.clientHeight, Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight));
  }
  private revealInput() {
    this.terminal.scrollToBottom();
    this.setViewTop(this.inputTop());
  }
  jumpToInput() { this.stopFling(); this.followInput = true; this.revealInput(); }
  focusKeyboard() { this.jumpToInput(); this.terminal.focus(); }
  scroll(direction: 'up' | 'down', pixels = 8 * 17) {
    this.followInput = false;
    const info = this.scrollInfo();
    const result = pageScroll(info.top, info.max, direction, pixels);
    if (!result.remote) this.setLocalTop(result.top);
    else if (this.state.phase === 'controlling' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'scroll', direction, lines: Math.min(30, Math.max(1, Math.ceil(pixels / 17))) }));
    }
  }
  private rowHeight() {
    const screen = this.host.querySelector<HTMLElement>('.xterm-screen');
    return (screen?.offsetHeight || this.terminal.rows * 17) / this.terminal.rows;
  }
  // One local coordinate spans xterm's scrollback and the tall screen below it.
  scrollInfo() {
    const buffer = this.terminal.buffer.active;
    const row = this.rowHeight();
    return {
      top: buffer.viewportY * row + this.viewport.scrollTop,
      max: buffer.baseY * row + Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight),
      viewportHeight: this.viewport.clientHeight,
      awayFromInput: buffer.viewportY < buffer.baseY || this.viewport.scrollTop < this.inputTop() - row,
    };
  }
  private setLocalTop(top: number) {
    const row = this.rowHeight();
    const line = Math.min(this.terminal.buffer.active.baseY, Math.max(0, Math.floor(top / row)));
    this.terminal.scrollToLine(line);
    this.setViewTop(Math.max(0, top - line * row));
  }
  scrollToFraction(fraction: number) {
    if (!Number.isFinite(fraction)) return;
    this.stopFling(); this.followInput = false;
    this.setLocalTop(Math.max(0, Math.min(1, fraction)) * this.scrollInfo().max);
  }
  // Notifications carry no scroll offsets into React; consumers read them on demand.
  onScroll(listener: () => void) {
    const subscription = this.terminal.onScroll(listener);
    this.viewport.addEventListener('scroll', listener, { passive: true });
    return () => { subscription.dispose(); this.viewport.removeEventListener('scroll', listener); };
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
