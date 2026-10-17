import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Pane } from '../../src/herdr.ts';
import { modifierOrder, namedKeys } from '../../src/keys.ts';
import { TerminalSession, type SessionState } from '../terminal/session.ts';
import { Icon } from './Icon.tsx';
import { attachPicture, attachedPaths, previewFor } from '../attach.ts';

const keyGroups = [
  ['Editing and navigation', namedKeys],
  ['Letters and digits', [...'abcdefghijklmnopqrstuvwxyz0123456789']],
  ['Symbols', [...'`~!@#$%^&*()_={}[]|\\:;"\',.<>/?']],
  ['Function keys', Array.from({ length: 24 }, (_, i) => `f${i + 1}`)],
] as const;
const quickKeys = [
  ['Tab', 'Tab'], ['Backspace', '⌫'], ['Interrupt', '^C'], ['EOF', '^D'],
  ['Up', '↑'], ['Down', '↓'], ['Left', '←'], ['Right', '→'],
] as const;
const phaseLabels: Record<SessionState['phase'], string> = {
  idle: 'Connected', connecting: 'Connecting', 'requesting-control': 'Connecting',
  watching: 'Watching', controlling: 'Controlling', disconnected: 'Disconnected', paused: 'Paused',
};
const notices: Record<SessionState['phase'], string> = {
  idle: '', connecting: '', 'requesting-control': '', watching: '', controlling: '',
  disconnected: 'Reconnecting…', paused: '',
};
const title = (modifier: string) => modifier[0].toUpperCase() + modifier.slice(1);
// Felt, not just seen: one short pulse when input starts reaching the PC, two when it stops
// (released, lost to a disconnect or switched away). Silently absent where unsupported.
const CONTROL_START = 18;
const CONTROL_END = [12, 70, 12];
function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* Blocked by the browser or no user activation yet. */ }
}

// Paths go at the end of the draft so the text written so far stays as it was.
const withPath = (draft: string, path: string) => `${draft.trimEnd()}${draft.trim() ? ' ' : ''}${path} `;
const withoutPath = (draft: string, path: string) => draft.split(path).join('').replace(/[ \t]{2,}/g, ' ').replace(/^ /, '');

function TerminalHistory({ engine, active }: { engine?: TerminalSession; active: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ pointer: number; offset: number } | undefined>(undefined);
  const fade = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [shown, setShown] = useState(false);
  const [away, setAway] = useState(false);
  const hideLater = useCallback(() => {
    clearTimeout(fade.current);
    if (!drag.current) fade.current = setTimeout(() => setShown(false), 1500);
  }, []);
  const sync = useCallback((reveal = true) => {
    if (!engine || !track.current || !thumb.current) return;
    const { top, max, viewportHeight, awayFromInput } = engine.scrollInfo();
    setAway(active && awayFromInput);
    const height = track.current.clientHeight;
    const size = Math.min(height, Math.max(32, height * viewportHeight / (max + viewportHeight || 1)));
    thumb.current.style.height = `${size}px`;
    thumb.current.style.transform = `translateY(${max ? top / max * (height - size) : 0}px)`;
    track.current.setAttribute('aria-valuenow', String(Math.round(max ? top / max * 100 : 0)));
    if (!max || !active) setShown(false);
    else if (reveal) { setShown(true); hideLater(); }
  }, [engine, active, hideLater]);
  useEffect(() => {
    sync(false);
    if (!active) return;
    const unsubscribe = engine?.onScroll(() => sync());
    const observer = new ResizeObserver(() => sync(false));
    if (track.current) observer.observe(track.current);
    return () => { unsubscribe?.(); observer.disconnect(); clearTimeout(fade.current); drag.current = undefined; };
  }, [engine, active, sync]);
  const move = (y: number) => {
    if (!track.current || !thumb.current || !drag.current) return;
    const rect = track.current.getBoundingClientRect();
    const travel = rect.height - thumb.current.offsetHeight;
    engine?.scrollToFraction(travel > 0 ? (y - rect.top - drag.current.offset) / travel : 0);
    sync();
  };
  return <><div id="terminal-history" ref={track} role="scrollbar" aria-label="Terminal history" aria-controls="terminal-viewport"
    aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-hidden={!shown} tabIndex={shown ? 0 : -1} data-visible={shown}
    onPointerDown={event => {
      if (!shown || !thumb.current) return;
      event.preventDefault(); event.stopPropagation(); clearTimeout(fade.current);
      const rect = thumb.current.getBoundingClientRect();
      drag.current = { pointer: event.pointerId, offset: event.clientY >= rect.top && event.clientY <= rect.bottom ? event.clientY - rect.top : rect.height / 2 };
      event.currentTarget.setPointerCapture(event.pointerId); move(event.clientY);
    }} onPointerMove={event => { if (drag.current?.pointer === event.pointerId) { event.preventDefault(); move(event.clientY); } }}
    onLostPointerCapture={() => { drag.current = undefined; hideLater(); }}
    onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); hideLater(); } }}
    onPointerCancel={() => { drag.current = undefined; hideLater(); }}
    onKeyDown={event => {
      if (!engine) return;
      const { top, max, viewportHeight } = engine.scrollInfo();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? max
        : event.key === 'ArrowUp' ? top - 17 : event.key === 'ArrowDown' ? top + 17
        : event.key === 'PageUp' ? top - viewportHeight : event.key === 'PageDown' ? top + viewportHeight : undefined;
      if (next === undefined) return;
      event.preventDefault(); engine.scrollToFraction(max ? next / max : 0); sync();
    }}><span ref={thumb} /></div>
    <button type="button" id="latest" hidden={!away} onClick={() => { engine?.jumpToInput(); sync(false); }}>↓ Latest</button>
  </>;
}

function KeyPicker({ engine, state, open, maxHeight }: { engine?: TerminalSession; state: SessionState; open: boolean; maxHeight?: number }) {
  const customKey = useRef<HTMLInputElement>(null);
  const disabled = state.phase !== 'controlling';
  const sendKey = (key: string) => {
    if (key === 'Interrupt') engine?.shortcut('ctrl+c');
    else if (key === 'EOF') engine?.shortcut('ctrl+d');
    else engine?.sendKey(key);
  };
  return <div id="keypad" hidden={!open} role="group" aria-label="Keys" style={{ maxHeight }}>
    <div className="keypad-head">
      <div className="keys modifiers" aria-label="Modifiers">
        {modifierOrder.map(modifier => <button type="button" key={modifier} data-modifier={modifier} disabled={disabled}
          aria-pressed={state.modifiers.includes(modifier)} onPointerDown={event => event.preventDefault()}
          onClick={() => engine?.toggleModifier(modifier)}>{title(modifier)}</button>)}
        <button type="button" id="clear-modifiers" className="quiet" disabled={disabled || !state.modifiers.length}
          onClick={() => engine?.clearModifiers()}>Clear</button>
      </div>
    </div>
    <div className="keys extra-keys" aria-label="Common keys">
      {quickKeys.map(([key, label]) => <button type="button" key={key} data-key={key} disabled={disabled}
        aria-label={['Up', 'Down', 'Left', 'Right'].includes(key) ? `Arrow ${key.toLowerCase()}`
          : key === 'Interrupt' ? 'Ctrl+C' : key === 'EOF' ? 'Ctrl+D' : undefined}
        onPointerDown={event => event.preventDefault()} onClick={() => sendKey(key)}>{label}</button>)}
      <button type="button" id="scroll-up" aria-label="Scroll terminal up" disabled={disabled} onClick={() => engine?.scroll('up')}>PgUp</button>
      <button type="button" id="scroll-down" aria-label="Scroll terminal down" disabled={disabled} onClick={() => engine?.scroll('down')}>PgDn</button>
    </div>
    <form id="custom-key-form" onSubmit={event => { event.preventDefault(); engine?.sendKey(customKey.current?.value || ''); }}>
      <label htmlFor="custom-key">Key or chord</label>
      <div className="key-entry"><input id="custom-key" ref={customKey} autoComplete="off" autoCapitalize="off"
        placeholder="ctrl+shift+p" spellCheck={false} maxLength={80} disabled={disabled} />
        <button type="submit" disabled={disabled}>Send</button></div>
    </form>
    <div id="key-grid" aria-label="All terminal keys">
      {keyGroups.map(([heading, keys]) => <div className="key-group" key={heading} role="group" aria-label={heading}>
        <p className="group-label">{heading}</p>
        <div className="key-cells">{keys.map(key => <button type="button" key={key} data-key={key} disabled={disabled}
          onPointerDown={event => event.preventDefault()} onClick={() => sendKey(key)}>{key}</button>)}</div>
      </div>)}
    </div>
  </div>;
}

export function TerminalPanel({ pane, state, onState, engine, onEngine, draft, onDraft, banner, onText }: {
  pane?: Pane; state: SessionState; onState: Dispatch<SetStateAction<SessionState>>;
  engine?: TerminalSession; onEngine: Dispatch<SetStateAction<TerminalSession | undefined>>;
  draft: string; onDraft: (value: string) => void; banner?: ReactNode; onText: (text: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [keypadMax, setKeypadMax] = useState<number>();
  const [compose, setCompose] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState('');
  useEffect(() => {
    const session = new TerminalSession(viewport.current!, host.current!, onState);
    onEngine(session);
    return () => { session.dispose(); onEngine(undefined); };
  }, [onState, onEngine]);
  // Inventory polls replace metadata objects. Only identity changes may reconnect the terminal.
  const paneId = pane?.pane_id;
  const terminalId = pane?.terminal_id;
  const syncPane = useEffectEvent(() => {
    if (pane) engine?.open(pane);
    else engine?.close();
  });
  useEffect(() => {
    setCompose(false); setKeysOpen(false); setAttachError(''); syncPane();
  }, [engine, paneId, terminalId]);
  // An upload can finish after the person switched panes or kept typing: it lands in the
  // newest draft of the pane it was attached for, or nowhere.
  const latest = useRef({ paneId, draft });
  useLayoutEffect(() => { latest.current = { paneId, draft }; });
  const attach = async (files: File[]) => {
    const pictures = files.filter(file => file.type.startsWith('image/'));
    if (!pictures.length) return;
    const forPane = paneId;
    setAttaching(true); setAttachError('');
    try {
      for (const file of pictures) {
        const path = await attachPicture(file);
        if (latest.current.paneId !== forPane) return;
        onDraft(withPath(latest.current.draft, path));
      }
    } catch (error) {
      if (latest.current.paneId === forPane) setAttachError((error as Error).message);
    } finally { setAttaching(false); }
  };
  const attached = attachedPaths(draft);
  useEffect(() => {
    engine?.resize();
    if (compose) editor.current?.focus();
  }, [compose, engine]);
  // The Keys drawer overlays only the terminal: it must never cover the agent switcher or header.
  useLayoutEffect(() => {
    if (!keysOpen) return;
    const measure = () => {
      if (!section.current || !dock.current) return;
      const room = dock.current.getBoundingClientRect().top - section.current.getBoundingClientRect().top - 8;
      setKeypadMax(Math.max(140, Math.min(400, room)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [keysOpen, compose]);
  const controlling = state.phase === 'controlling';
  const wasControlling = useRef(false);
  useEffect(() => {
    if (controlling !== wasControlling.current) vibrate(controlling ? CONTROL_START : CONTROL_END);
    wasControlling.current = controlling;
  }, [controlling]);
  const ready = controlling || state.phase === 'watching';
  const switching = state.phase === 'connecting' || state.phase === 'requesting-control';
  const armed = modifierOrder.filter(modifier => state.modifiers.includes(modifier));
  return <section id="session" ref={section} hidden={!pane} aria-label="Terminal session" data-phase={state.phase}>
    <div className="terminal-frame">
      <div id="terminal-viewport" ref={viewport}><div id="terminal" ref={host} /></div>
      <TerminalHistory key={`${paneId}:${terminalId}`} engine={engine} active={ready} />
      {banner}
    </div>
    <div className="dock" ref={dock}>
      <div className="session-bar">
        <div className="session-state" role="status">
          <span id="connection">{phaseLabels[state.phase]}</span>
          <span id="notice">{notices[state.phase]}</span>
        </div>
        <button type="button" id="sizing" className="quiet" hidden={!controlling} aria-label={state.fitWidth ? 'Width: fit' : 'Width: original'}
          onClick={() => engine?.toggleWidth()}><Icon name="width" size={18} />{state.fitWidth ? 'Fit' : 'Full'}</button>
        <button type="button" id="terminal-text" className="icon-button" aria-label="Terminal text" aria-haspopup="dialog"
          disabled={!ready} onClick={() => engine && onText(engine.text())}><Icon name="text" /></button>
        <button type="button" id="control" className={controlling ? 'release' : 'primary'} disabled={switching || !engine}
          onClick={() => engine?.toggleControl()}>{controlling ? 'Release control' : 'Take control'}</button>
      </div>
      <div id="compose" hidden={!compose}>
        <textarea id="draft" ref={editor} rows={3} aria-label="Draft" spellCheck={false} autoCapitalize="off" value={draft}
          placeholder="Write a prompt or paste text…" onChange={event => onDraft(event.target.value)}
          onPaste={event => {
            const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
            if (files.length) { event.preventDefault(); void attach(files); }
          }} />
        {attachError ? <p id="attach-error" role="alert">{attachError}</p> : null}
        {attached.length ? <ul id="attachments" aria-label="Attached pictures">
          {attached.map((path, index) => <li key={path}>
            {previewFor(path) ? <img src={previewFor(path)} alt="" width={40} height={40} /> : <span className="no-preview"><Icon name="image" size={18} /></span>}
            <span>Picture {index + 1}</span>
            <button type="button" className="quiet" aria-label={`Remove picture ${index + 1}`}
              onClick={() => onDraft(withoutPath(draft, path))}><Icon name="close" size={16} /></button>
          </li>)}
        </ul> : null}
        <div className="compose-actions">
          <button type="button" id="attach" className="quiet" disabled={attaching} aria-busy={attaching}
            onClick={() => picker.current?.click()}><Icon name="image" size={18} />{attaching ? 'Attaching…' : 'Picture'}</button>
          <input type="file" id="picture-input" ref={picker} accept="image/*" multiple hidden onChange={event => {
            void attach([...event.target.files || []]); event.target.value = '';
          }} />
          <button type="button" id="clear-draft" className="quiet" disabled={!draft} onClick={() => { onDraft(''); editor.current?.focus(); }}>Clear</button>
          <button type="button" id="paste" disabled={!controlling || !draft} onClick={() => engine?.paste(draft, false, Boolean(pane?.agent))}>Paste</button>
          <button type="button" id="submit" className="primary" disabled={!controlling || !draft} onClick={() => engine?.paste(draft, true, Boolean(pane?.agent))}>Paste + Enter</button>
        </div>
      </div>
      <div id="keyboard" aria-label="Terminal controls" hidden={!controlling}>
        <div id="armed-keys" role="status" hidden={!armed.length}>
          <span className="armed-chord">{armed.map(title).join(' + ')} + …</span>
        </div>
        <KeyPicker engine={engine} state={state} open={keysOpen} maxHeight={keypadMax} />
        <div className="keys main-keys">
          <div className="tool-group">
            <button type="button" id="focus-keyboard" className="tool" aria-label="Keyboard" disabled={!controlling}
              onClick={() => engine?.focusKeyboard()}><Icon name="keyboard" /><span>Type</span></button>
            <button type="button" id="compose-toggle" className="tool" aria-pressed={compose} disabled={!controlling} onClick={() => {
              engine?.clearModifiers(); setKeysOpen(false); setCompose(value => !value);
            }}><Icon name="compose" /><span>Compose</span></button>
            <button type="button" id="more-keys" className="tool" aria-label="More keys" aria-expanded={keysOpen}
              data-armed={armed.length > 0} disabled={!controlling}
              onClick={() => setKeysOpen(value => !value)}><Icon name="keys" /><span>Keys</span></button>
          </div>
          <div className="key-pair">
            {['Escape', 'Enter'].map(key => <button type="button" key={key} data-key={key}
              className={key === 'Enter' ? 'primary keycap' : 'keycap'} disabled={!controlling}
              onPointerDown={event => event.preventDefault()} onClick={() => engine?.sendKey(key)}>{key === 'Escape' ? 'Esc' : key}</button>)}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
