import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Pane } from '../../shared/api.ts';
import { chord, inputKey, validateChord, type Modifier } from '../../shared/keys.ts';
import type { ClientCommand, ServerMessage } from '../../shared/protocol.ts';
import { controlSize, inputScrollTop, pageScroll } from './viewport.ts';
import { readPreference, writePreference } from '../preferences.ts';
import { findLinks, openUrl, type PathMatch } from '../paths.ts';

export type Phase = 'idle' | 'connecting' | 'requesting-control' | 'watching' | 'controlling' | 'disconnected' | 'paused';
export interface SessionState {
  phase: Phase;
  fitWidth: boolean;
  fontSize: number;
  modifiers: Modifier[];
  error: string;
}
export const INITIAL_SESSION: SessionState = { phase: 'idle', fitWidth: true, fontSize: 13, modifiers: [], error: '' };

// This class owns all high-frequency terminal state. React receives only UI transitions,
// never terminal frames, cursor positions, scroll offsets, pending ACKs or typed bytes.
export class TerminalSession {
  private readonly terminal: Terminal;
  private readonly fit = new FitAddon();
  private readonly listeners = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private state: SessionState = { ...INITIAL_SESSION, fontSize: Math.max(10, Math.min(22, readPreference('terminal-font-size', 13))), modifiers: [] };
  private pane?: Pane;
  private socket?: WebSocket;
  private generation = 0;
  private sequence = 0;
  private watchCols = 120;
  private watchRows = 40;
  private reconnectDelay = 1000;
  private lastResponse = 0;
  private connectedAt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<number, number>();
  private followInput = true;
  private expectedScrollTop?: number;
  private touchY?: number;
  private touchMoved = false;
  private touchSamples: { y: number; time: number }[] = [];
  private flingFrame?: number;
  // Two fingers moved sideways switch panes: where they started and where they are now.
  private swipe?: { x: number; y: number; dx: number; dy: number };
  private linkOpenedAt = 0;
  private readonly swipeListeners = new Set<(direction: 'next' | 'previous') => void>();
  private disposed = false;

  constructor(private readonly viewport: HTMLElement, private readonly host: HTMLElement,
    private readonly onState: (state: SessionState) => void) {
    this.terminal = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", "DejaVu Sans Mono", monospace',
      fontSize: this.state.fontSize, lineHeight: 1.18, cursorBlink: true, scrollback: 1500,
      allowProposedApi: false, allowTransparency: false, convertEol: false, disableStdin: true,
      // Links a program embeds (OSC 8) open in a new tab, web addresses only.
      linkHandler: { allowNonHttpProtocols: false, activate: (_event, url) => { if (openUrl(url)) this.linkOpenedAt = performance.now(); } },
      theme: { background: '#141819', foreground: '#e5ebea', cursor: '#bad7a1', selectionBackground: '#4b665a' },
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.open(host);
    // File paths and web addresses are underlined under a mouse; a tap or click opens them (see openLinkAt).
    this.terminal.registerLinkProvider({ provideLinks: (y, callback) => {
      const text = this.terminal.buffer.active.getLine(y - 1)?.translateToString(true) ?? '';
      callback(findLinks(text).map(match => ({ text: match.kind === 'url' ? match.url : match.path, range: { start: { x: match.start + 1, y }, end: { x: match.end, y } },
        decorations: { underline: true, pointerCursor: true }, activate: () => {} })));
    } });
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
    // xterm focuses its input on any tap; while watching that would only raise the phone keyboard.
    textarea?.addEventListener('focus', () => { if (this.state.phase !== 'controlling') textarea.blur(); }, { signal });
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
    const middle = (touches: TouchList) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
    viewport.addEventListener('touchstart', event => {
      if (event.touches.length === 2) this.swipe = { ...middle(event.touches), dx: 0, dy: 0 };
      else if (event.touches.length > 2) this.swipe = undefined;
      this.stopFling(); this.touchSamples = []; this.touchMoved = false;
      this.touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
      if (this.touchY !== undefined) this.sampleTouch(this.touchY);
    }, { passive: true, signal });
    viewport.addEventListener('touchmove', event => {
      if (event.touches.length === 2 && this.swipe) {
        const point = middle(event.touches);
        this.swipe.dx = point.x - this.swipe.x; this.swipe.dy = point.y - this.swipe.y;
        // A sideways two-finger move is a pane switch, not a page pan or zoom.
        if (Math.abs(this.swipe.dx) > 12 && Math.abs(this.swipe.dx) > Math.abs(this.swipe.dy)) event.preventDefault();
      }
      if (event.touches.length !== 1) { this.touchY = undefined; this.touchSamples = []; return; }
      if (this.touchY === undefined) return;
      this.sampleTouch(event.touches[0].clientY);
      const delta = this.touchY - event.touches[0].clientY;
      if (Math.abs(delta) < 8) return;
      event.preventDefault(); event.stopPropagation(); this.touchMoved = true; this.touchY = event.touches[0].clientY;
      this.scroll(delta < 0 ? 'up' : 'down', Math.abs(delta));
    }, { passive: false, capture: true, signal });
    viewport.addEventListener('touchend', event => {
      if (this.swipe && event.touches.length < 2) {
        const { dx, dy } = this.swipe; this.swipe = undefined;
        if (Math.abs(dx) >= 64 && Math.abs(dx) > 1.5 * Math.abs(dy)) for (const listener of this.swipeListeners) listener(dx < 0 ? 'next' : 'previous');
      }
      if (this.touchMoved && this.touchY !== undefined && !event.touches.length) {
        this.sampleTouch(event.changedTouches[0]?.clientY ?? this.touchY);
        const first = this.touchSamples[0], last = this.touchSamples.at(-1);
        if (first && last && last.time > first.time) this.startFling((first.y - last.y) / (last.time - first.time));
      }
      this.touchY = undefined; this.touchSamples = [];
    }, { passive: true, signal });
    viewport.addEventListener('touchcancel', () => {
      this.swipe = undefined; this.stopFling(); this.touchY = undefined; this.touchSamples = [];
    }, { passive: true, signal });
    window.addEventListener('resize', this.resize, { signal });
    window.visualViewport?.addEventListener('resize', this.resize, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.disconnect(); this.update({ phase: 'paused' }); }
      else if (this.pane) this.connect(false);
    }, { signal });
    window.addEventListener('offline', () => {
      this.disconnect();
      if (this.pane) { this.update({ phase: 'disconnected' }); this.fail('This device is offline. Reconnect to Tailscale; input has stopped.'); }
    }, { signal });
    window.addEventListener('online', () => { if (this.pane) this.connect(false); }, { signal });
    window.addEventListener('pagehide', () => this.disconnect(), { signal });
    window.addEventListener('pageshow', event => { if (event.persisted && this.pane) this.connect(false); }, { signal });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(viewport);
    this.heartbeat = setInterval(() => {
      if (this.socket && !document.hidden && Date.now() - this.lastResponse > 25_000 && Date.now() - this.connectedAt > 25_000) {
        this.fail('The connection stopped responding. Reconnecting watch-only; no input will be replayed.');
        this.connect(false); return;
      }
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('{"type":"ping"}');
      if (this.pending.size && Date.now() - Math.min(...this.pending.values()) > 5000) {
        this.fail('Input write not confirmed. Check the pane before retrying; nothing will be replayed.');
        this.socket?.close();
      }
    }, 5000);
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
    if (this.state.phase !== 'controlling' && document.activeElement === this.terminal.textarea) this.terminal.textarea?.blur();
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
  setFontSize(value: number) {
    if (!Number.isFinite(value)) return;
    const fontSize = Math.max(10, Math.min(22, Math.round(value)));
    this.terminal.options.fontSize = fontSize;
    writePreference('terminal-font-size', fontSize); this.update({ fontSize }); this.resize();
  }

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
    this.connectedAt = this.lastResponse = Date.now();
    const ws = new WebSocket(`${protocol}//${location.host}/terminal?${query}`);
    this.socket = ws;
    this.update({ phase: control ? 'requesting-control' : 'connecting' });
    this.terminal.reset();
    let received = false;
    ws.onmessage = event => {
      if (epoch !== this.generation || this.disposed) return;
      this.lastResponse = Date.now();
      try {
        const message = JSON.parse(event.data) as ServerMessage;
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
      this.fail('Not controlling this pane. Input was not sent.'); return false;
    }
    if (this.socket.bufferedAmount > 64 * 1024) {
      this.fail('Connection is too slow. Input was not sent.'); this.socket.close(); return false;
    }
    const id = ++this.sequence;
    this.pending.set(id, Date.now());
    try { this.socket.send(JSON.stringify({ ...command, id } satisfies ClientCommand)); return true; }
    catch { this.pending.delete(id); this.fail('Input was not sent. The connection closed; reconnect and check the pane.'); this.socket.close(); return false; }
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
    if (!value || this.state.phase !== 'controlling') return false;
    this.clearModifiers();
    const text = value.replace(/\r?\n/g, '\r');
    const bracketed = this.terminal.modes.bracketedPasteMode || agent;
    if (!bracketed && /[\r\n]/.test(text)) { this.fail('This terminal did not say it accepts pasted lines, so nothing was sent. Send one line at a time.'); return; }
    return this.send({ type: 'input', text: bracketed ? '\x1b[200~' + text.replace(/\x1b/g, '') + '\x1b[201~' : text, ...(submit ? { submit: true } : {}) });
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
    // A small phone with the keyboard open: only the essentials of the dock fit.
    document.documentElement.classList.toggle('tiny-viewport', height < 420);
    // How the device is held, not the viewport's shape: the keyboard makes an upright phone's viewport wide.
    const turned = screen.orientation?.type.startsWith('landscape') ?? screen.width > screen.height;
    document.documentElement.classList.toggle('landscape', turned);
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (this.disposed) return;
      if (this.followInput) this.revealInput();
      if (this.state.phase !== 'controlling' || this.socket?.readyState !== WebSocket.OPEN) return;
      const size = this.fittedSize();
      this.socket.send(JSON.stringify({ type: 'resize', cols: this.state.fitWidth ? size.cols : this.watchCols, rows: size.rows } satisfies ClientCommand));
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
  // Blurring first makes Android raise the keyboard again when the terminal already has focus.
  focusKeyboard() { this.jumpToInput(); this.terminal.textarea?.blur(); this.terminal.focus(); }
  scroll(direction: 'up' | 'down', pixels = 8 * 17) {
    this.followInput = false;
    const info = this.scrollInfo();
    const result = pageScroll(info.top, info.max, direction, pixels);
    if (!result.remote) this.setLocalTop(result.top);
    else if (this.state.phase === 'controlling' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'scroll', direction, lines: Math.min(30, Math.max(1, Math.ceil(pixels / 17))) } satisfies ClientCommand));
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
  // A two-finger swipe to the left asks for the next pane, to the right for the previous one.
  // Opens the link under a tap or click: a web address in a new tab, a file path with onPath.
  // True when the tap was on a link, including one xterm itself just opened.
  openLinkAt(clientX: number, clientY: number, onPath: (path: PathMatch) => void) {
    if (performance.now() - this.linkOpenedAt < 500) return true;
    const link = this.linkAt(clientX, clientY);
    if (link?.kind === 'url') return openUrl(link.url);
    if (link) onPath(link);
    return Boolean(link);
  }

  private linkAt(clientX: number, clientY: number) {
    const screen = this.host.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!screen || clientX < screen.left || clientX >= screen.right || clientY < screen.top || clientY >= screen.bottom) return undefined;
    const column = Math.floor((clientX - screen.left) / (screen.width / this.terminal.cols));
    const row = Math.floor((clientY - screen.top) / (screen.height / this.terminal.rows));
    const buffer = this.terminal.buffer.active;
    const text = buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '';
    return findLinks(text).find(match => column >= match.start && column < match.end);
  }

  onSwipe(listener: (direction: 'next' | 'previous') => void) {
    this.swipeListeners.add(listener);
    return () => { this.swipeListeners.delete(listener); };
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
