import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pane, Snapshot } from '../src/herdr.ts';
import { loadPanes, pairBrowser, PairingRequired, runAction, type Action, type Startup } from './api.ts';
import { CreateSheet, PaneMenu, type CreateRequest } from './components/Actions.tsx';
import { Icon } from './components/Icon.tsx';
import { AgentSwitcher, Inventory, paneName, workspaceName } from './components/Inventory.tsx';
import { Pairing } from './components/Pairing.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { INITIAL_SESSION, TerminalSession } from './terminal/session.ts';

const paneKey = (pane: Pane) => `${pane.pane_id}:${pane.terminal_id}`;

export function App({ startup }: { startup: Promise<Startup> }) {
  const [paired, setPaired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selection, setSelection] = useState<Pane>();
  const [error, setError] = useState('');
  const [engine, setEngine] = useState<TerminalSession>();
  const [session, setSession] = useState(INITIAL_SESSION);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [createRequest, setCreateRequest] = useState<CreateRequest>();
  const [menuOpen, setMenuOpen] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const selected = paired && selection ? snapshot?.panes.find(pane =>
    pane.pane_id === selection.pane_id && pane.terminal_id === selection.terminal_id) : undefined;

  useEffect(() => {
    let active = true;
    void startup.then(result => {
      if (!active) return;
      setSnapshot(result.snapshot); setPaired(Boolean(result.snapshot)); setError(result.error); setLoading(false);
      const previous = sessionStorage.getItem('whistle-pane');
      if (previous && result.snapshot) setSelection(result.snapshot.panes.find(pane => pane.pane_id === previous));
    });
    return () => { active = false; };
  }, [startup]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController(); inFlight.current = controller;
    try { setSnapshot(await loadPanes(controller.signal)); setPaired(true); }
    catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof PairingRequired) setPaired(false);
      else setError((cause as Error).message);
    } finally { if (inFlight.current === controller) inFlight.current = null; }
  }, []);
  useEffect(() => {
    if (!paired) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer); document.removeEventListener('visibilitychange', visible);
      inFlight.current?.abort(); inFlight.current = null;
    };
  }, [paired, refresh]);
  useEffect(() => {
    if (paired && selection && snapshot && !selected) {
      setSelection(undefined); sessionStorage.removeItem('whistle-pane');
      setError('This pane was closed or replaced. Choose another agent.');
    }
  }, [paired, selection, snapshot, selected]);

  const clearError = () => { setError(''); engine?.clearError(); };
  const select = (pane: Pane) => {
    if (selection && paneKey(selection) === paneKey(pane)) return;
    clearError(); engine?.close(); setSelection(pane); sessionStorage.setItem('whistle-pane', pane.pane_id);
    sessionStorage.setItem('whistle-workspace', pane.workspace_id);
  };
  // New panes open like any other: watch-only, without focusing the desktop.
  const created = async (paneId?: string, warning?: string) => {
    const next = await loadPanes(); setSnapshot(next);
    setCreateRequest(undefined); setMenuOpen(false);
    const pane = next.panes.find(item => item.pane_id === paneId);
    if (pane) select(pane);
    if (warning) setError(warning);
  };
  const destroy = async (action: Action) => {
    engine?.close(); // Release control before Herdr removes the pane.
    try { await runAction(action); }
    catch (cause) { if (selected) engine?.open(selected); throw cause; }
    setMenuOpen(false); setSelection(undefined); sessionStorage.removeItem('whistle-pane'); void refresh();
  };
  const pair = async (token: string) => {
    setError('');
    try {
      await pairBrowser('/api/login', { token });
      setSnapshot(await loadPanes()); setPaired(true);
    } catch (cause) { setError((cause as Error).message); }
  };
  const draftKey = selected ? paneKey(selected) : '';
  const message = error || session.error;
  const banner = <div id="error" role="alert" hidden={!message}>
    <span>{message}</span>
    <button type="button" className="icon-button" aria-label="Dismiss" onClick={clearError}><Icon name="close" size={18} /></button>
  </div>;
  return <>
    <Pairing hidden={paired} loading={loading} error={error} onPair={pair} onRetry={() => { setError(''); void refresh(); }} />
    <div id="app" hidden={!paired} data-view={selected ? 'terminal' : 'inventory'} data-phase={selected ? session.phase : undefined}>
      <header>
        {selected ? <button type="button" id="back" className="icon-button" aria-label="Back to panes" onClick={() => {
          engine?.close(); setSelection(undefined); sessionStorage.removeItem('whistle-pane'); void refresh();
        }}><Icon name="back" /></button> : null}
        {selected ? <div className="title">
          <strong id="heading">{paneName(selected)}</strong>
          <small>{workspaceName(snapshot, selected)} · {selected.agent || 'terminal'} · <code id="pane-info">{selected.pane_id}</code></small>
        </div> : <strong id="heading" className="wordmark">whistle</strong>}
        <button type="button" id="refresh" className="icon-button" aria-label="Refresh"
          onClick={() => { clearError(); void refresh(); engine?.reconnect(); }}><Icon name="refresh" /></button>
        {selected ? <button type="button" id="pane-actions" className="icon-button" aria-label="Pane actions"
          aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><Icon name="more" /></button> : null}
      </header>
      <AgentSwitcher snapshot={snapshot} selected={selected} onSelect={select} />
      <Inventory snapshot={snapshot} hidden={Boolean(selected)} onSelect={select} banner={selected ? null : banner} />
      <TerminalPanel pane={selected} state={session} onState={setSession} engine={engine} onEngine={setEngine}
        banner={selected ? banner : null}
        draft={drafts[draftKey] || ''} onDraft={value => { if (draftKey) setDrafts(previous => ({ ...previous, [draftKey]: value })); }} />
      {selected ? null : <button type="button" id="new" className="primary fab" aria-haspopup="dialog"
        onClick={() => setCreateRequest({ kind: 'agent', workspaceId: sessionStorage.getItem('whistle-workspace') || undefined })}>
        <Icon name="plus" />New</button>}
      <CreateSheet request={createRequest} snapshot={snapshot} onClose={() => setCreateRequest(undefined)} onCreated={created} />
      <PaneMenu open={menuOpen} pane={selected} snapshot={snapshot} onClose={() => setMenuOpen(false)}
        onNew={request => { setMenuOpen(false); setCreateRequest(request); }} onDone={destroy} />
    </div>
  </>;
}
