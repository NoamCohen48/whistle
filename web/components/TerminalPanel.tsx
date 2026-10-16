import { useEffect, useEffectEvent, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Pane } from '../../src/herdr.ts';
import { modifierOrder, namedKeys } from '../../src/keys.ts';
import { TerminalSession, type SessionState } from '../terminal/session.ts';

const allKeys = [...namedKeys, ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  ...'abcdefghijklmnopqrstuvwxyz0123456789', ...'`~!@#$%^&*()_={}[]|\\:;"\',.<>/?'];
const extraKeys = [
  ['Tab', 'Tab'], ['Backspace', '⌫'], ['Interrupt', 'Ctrl+C'], ['EOF', 'Ctrl+D'],
  ['Up', '↑'], ['Down', '↓'], ['Left', '←'], ['Right', '→'],
] as const;
const notices: Record<SessionState['phase'], string> = {
  idle: '', connecting: 'Watching. Your desktop is unchanged.',
  'requesting-control': 'Requesting control. No takeover of another controller.',
  watching: 'Watching. Your desktop is unchanged.',
  controlling: 'Live input. Edits and Enter go directly to this pane.',
  disconnected: 'Disconnected. Control released; reconnecting in watch mode.',
  paused: 'Paused. Control released; resume in watch mode.',
};

function KeyPicker({ engine, state, open }: { engine?: TerminalSession; state: SessionState; open: boolean }) {
  const customKey = useRef<HTMLInputElement>(null);
  const disabled = state.phase !== 'controlling';
  const sendKey = (key: string) => {
    if (key === 'Interrupt') engine?.shortcut('ctrl+c');
    else if (key === 'EOF') engine?.shortcut('ctrl+d');
    else engine?.sendKey(key);
  };
  return <div id="keypad" hidden={!open}>
    <div className="keys modifiers" aria-label="Modifiers">
      {modifierOrder.map(modifier => <button type="button" key={modifier} data-modifier={modifier} disabled={disabled}
        aria-pressed={state.modifiers.includes(modifier)} onPointerDown={event => event.preventDefault()}
        onClick={() => engine?.toggleModifier(modifier)}>{modifier[0].toUpperCase() + modifier.slice(1)}</button>)}
      <button type="button" id="clear-modifiers" disabled={disabled} onClick={() => engine?.clearModifiers()}>Clear</button>
    </div>
    <p className="hint">Modifiers apply to one key, then reset. The app decides what a shortcut does.</p>
    <div id="key-grid" aria-label="All terminal keys">
      {allKeys.map(key => <button type="button" key={key} data-key={key} disabled={disabled}
        onPointerDown={event => event.preventDefault()} onClick={() => sendKey(key)}>{key}</button>)}
    </div>
    <form id="custom-key-form" onSubmit={event => { event.preventDefault(); engine?.sendKey(customKey.current?.value || ''); }}>
      <label htmlFor="custom-key">Key or chord (e.g. ctrl+shift+p)</label>
      <div className="key-entry"><input id="custom-key" ref={customKey} autoComplete="off" autoCapitalize="off"
        spellCheck={false} maxLength={80} disabled={disabled} /><button type="submit" disabled={disabled}>Send key</button></div>
    </form>
    <div className="keys extra-keys">
      {extraKeys.map(([key, label]) => <button type="button" key={key} data-key={key} disabled={disabled}
        aria-label={['Up', 'Down', 'Left', 'Right'].includes(key) ? `Arrow ${key.toLowerCase()}` : undefined}
        onPointerDown={event => event.preventDefault()} onClick={() => sendKey(key)}>{label}</button>)}
      <button type="button" id="scroll-up" aria-label="Scroll terminal up" disabled={disabled} onClick={() => engine?.scroll('up')}>PgUp</button>
      <button type="button" id="scroll-down" aria-label="Scroll terminal down" disabled={disabled} onClick={() => engine?.scroll('down')}>PgDn</button>
    </div>
  </div>;
}

export function TerminalPanel({ pane, state, onState, engine, onEngine, draft, onDraft }: {
  pane?: Pane; state: SessionState; onState: Dispatch<SetStateAction<SessionState>>;
  engine?: TerminalSession; onEngine: Dispatch<SetStateAction<TerminalSession | undefined>>;
  draft: string; onDraft: (value: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [compose, setCompose] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
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
    setCompose(false); setKeysOpen(false); syncPane();
  }, [engine, paneId, terminalId]);
  useEffect(() => {
    engine?.resize();
    if (compose) editor.current?.focus();
  }, [compose, engine]);
  const controlling = state.phase === 'controlling';
  const ready = controlling || state.phase === 'watching';
  const switching = state.phase === 'connecting' || state.phase === 'requesting-control';
  return <section id="session" hidden={!pane} aria-label="Terminal session">
    <div className="session-bar">
      <span id="pane-info">{pane?.pane_id}</span>
      <button type="button" id="control" className="primary" disabled={switching || !engine}
        onClick={() => engine?.toggleControl()}>{controlling ? 'Release control' : 'Take control'}</button>
      <button type="button" id="sizing" hidden={!controlling} onClick={() => engine?.toggleWidth()}>
        {state.fitWidth ? 'Width: fit' : 'Width: original'}</button>
    </div>
    <div id="notice" role="status">{notices[state.phase]}</div>
    <div id="terminal-viewport" ref={viewport}><div id="terminal" ref={host} /></div>
    <div id="compose" hidden={!compose}>
      <label htmlFor="draft">Compose · local draft, not sent yet</label>
      <textarea id="draft" ref={editor} rows={3} spellCheck={false} autoCapitalize="off" value={draft}
        onChange={event => onDraft(event.target.value)} />
      <div className="compose-actions">
        <button type="button" id="paste" disabled={!controlling} onClick={() => engine?.paste(draft, false)}>Paste</button>
        <button type="button" id="submit" className="primary" disabled={!controlling} onClick={() => engine?.paste(draft, true)}>Paste + Enter</button>
      </div>
    </div>
    <div id="keyboard" aria-label="Terminal controls">
      <div id="armed-keys" role="status" hidden={!state.modifiers.length}>
        {modifierOrder.filter(modifier => state.modifiers.includes(modifier)).join(' + ')} · next key only
      </div>
      <KeyPicker engine={engine} state={state} open={keysOpen} />
      <div className="keys main-keys">
        <button type="button" id="jump-input" disabled={!ready} onClick={() => engine?.jumpToInput()}>Input</button>
        <button type="button" id="focus-keyboard" aria-label="Keyboard" disabled={!controlling} onClick={() => engine?.focusKeyboard()}>Type</button>
        <button type="button" id="compose-toggle" disabled={!controlling} onClick={() => {
          engine?.clearModifiers(); setKeysOpen(false); setCompose(value => !value);
        }}>Compose</button>
        <button type="button" id="more-keys" aria-label="More keys" aria-expanded={keysOpen} disabled={!ready}
          onClick={() => setKeysOpen(value => !value)}>Keys</button>
        {['Escape', 'Enter'].map(key => <button type="button" key={key} data-key={key}
          className={key === 'Enter' ? 'primary' : undefined} disabled={!controlling}
          onPointerDown={event => event.preventDefault()} onClick={() => engine?.sendKey(key)}>{key === 'Escape' ? 'Esc' : key}</button>)}
      </div>
    </div>
  </section>;
}
