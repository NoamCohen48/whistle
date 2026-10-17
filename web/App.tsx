import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Pane, Snapshot } from '../src/herdr.ts';
import { loadPanes, pairBrowser, PairingRequired, runAction, type Action, type Startup } from './api.ts';
import { CreateSheet, PaneMenu, type CreateRequest } from './components/Actions.tsx';
import { ChangesSheet } from './components/Changes.tsx';
import { AlertsSheet } from './components/AlertsSheet.tsx';
import { PictureViewer, type PictureRequest } from './components/PictureViewer.tsx';
import { TerminalTextSheet } from './components/TerminalText.tsx';
import { Icon } from './components/Icon.tsx';
import { AgentSwitcher, Inventory, needsYou, paneName, statusTone, workspaceName } from './components/Inventory.tsx';
import { Pairing } from './components/Pairing.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { INITIAL_SESSION, TerminalSession } from './terminal/session.ts';
import { readDrafts, saveDraft, flushDrafts } from './drafts.ts';
import { alertState, disableAlerts, enableAlerts, type AlertState } from './push.ts';

// Per-browser memory for home-screen shortcuts; blocked storage just means no shortcut target.
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Not remembered. */ } };
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

const paneKey = (pane: Pane) => `${pane.pane_id}:${pane.terminal_id}`;

export function App({ startup }: { startup: Promise<Startup> }) {
  const [paired, setPaired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selection, setSelection] = useState<Pane>();
  const [error, setError] = useState('');
  const [engine, setEngine] = useState<TerminalSession>();
  const [session, setSession] = useState(INITIAL_SESSION);
  const [drafts, setDrafts] = useState<Record<string, string>>(readDrafts);
  const [createRequest, setCreateRequest] = useState<CreateRequest>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changesFor, setChangesFor] = useState<string>();
  const [picture, setPicture] = useState<PictureRequest>();
  const [terminalText, setTerminalText] = useState<{ paneId: string; text: string }>();
  const [alerts, setAlerts] = useState<AlertState>('unsupported');
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsGeneration = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const selected = paired && selection ? snapshot?.panes.find(pane =>
    pane.pane_id === selection.pane_id && pane.terminal_id === selection.terminal_id) : undefined;

  useEffect(() => {
    const lost = () => { setDrafts({}); setPaired(false); };
    const hidden = () => { if (document.hidden) flushDrafts(); };
    window.addEventListener('whistle-pairing-lost', lost);
    window.addEventListener('pagehide', flushDrafts);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('whistle-pairing-lost', lost);
      window.removeEventListener('pagehide', flushDrafts);
      document.removeEventListener('visibilitychange', hidden);
      flushDrafts();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void startup.then(result => {
      if (!active) return;
      // Startup's 401 can arrive before the pairing-loss listener mounts.
      setDrafts(readDrafts());
      setSnapshot(result.snapshot); setPaired(Boolean(result.snapshot)); setError(result.error); setLoading(false);
      const shortcut = sessionStorage.getItem('whistle-shortcut');
      sessionStorage.removeItem('whistle-shortcut');
      const previous = shortcut ? undefined : sessionStorage.getItem('whistle-pane');
      if (previous && result.snapshot) setSelection(result.snapshot.panes.find(pane => pane.pane_id === previous));
      if (shortcut && result.snapshot) startFrom(shortcut, result.snapshot);
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

  useEffect(() => {
    if (!paired) return;
    let active = true;
    const generation = alertsGeneration.current;
    alertState().then(state => { if (active && generation === alertsGeneration.current) setAlerts(state); }, () => {});
    return () => { active = false; };
  }, [paired]);
  const toggleAlerts = async () => {
    if (alertsBusy) return;
    // A slow startup check must not overwrite the result of this tap.
    alertsGeneration.current++;
    setAlertsBusy(true); clearError();
    try {
      if (alerts === 'on') await disableAlerts(); else await enableAlerts();
    } catch (cause) {
      if (cause instanceof PairingRequired) setPaired(false); else setError((cause as Error).message);
    } finally {
      setAlerts(await alertState().catch(() => alerts)); setAlertsBusy(false);
    }
  };
  // Tapping an alert while Whistle is open: the worker asks this page to show the pane (watch-only).
  const openFromAlert = useEffectEvent((paneId: string) => {
    const pane = snapshot?.panes.find(item => item.pane_id === paneId);
    if (pane) select(pane); else void refresh();
  });
  useEffect(() => {
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!worker) return;
    const listener = (event: MessageEvent) => {
      if (event.data?.type === 'open-pane' && typeof event.data.paneId === 'string') openFromAlert(event.data.paneId);
    };
    worker.addEventListener('message', listener);
    worker.startMessages();
    return () => worker.removeEventListener('message', listener);
  }, []);

  const clearError = () => { setError(''); engine?.clearError(); };
  const select = (pane: Pane) => {
    if (selection && paneKey(selection) === paneKey(pane)) return;
    clearError(); engine?.close(); setSelection(pane); sessionStorage.setItem('whistle-pane', pane.pane_id);
    sessionStorage.setItem('whistle-workspace', pane.workspace_id);
    remember('whistle-last-pane', pane.pane_id); remember('whistle-last-workspace', pane.workspace_id);
  };
  // Home-screen shortcuts. Every pane they open starts watch-only, like any other way of opening it.
  const startFrom = useEffectEvent((shortcut: string, state: Snapshot) => {
    const find = (paneId: string | null) => state.panes.find(pane => pane.pane_id === paneId);
    if (shortcut === 'last') {
      const pane = find(recall('whistle-last-pane'));
      if (pane) select(pane); else setError('The last pane you opened is closed. Choose another.');
    } else if (shortcut === 'needs-you') {
      const waiting = state.panes.filter(needsYou).sort((a, b) => Number(statusTone(b) === 'attention') - Number(statusTone(a) === 'attention'));
      if (waiting[0]) select(waiting[0]);
    } else if (shortcut === 'new-agent') {
      const workspaceId = recall('whistle-last-workspace');
      setCreateRequest({ kind: 'agent', workspaceId: state.workspaces.some(item => item.workspace_id === workspaceId) ? workspaceId! : undefined });
    }
  });
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
  const rename = async (action: Action) => {
    await runAction(action);
    setSnapshot(await loadPanes()); setMenuOpen(false);
  };
  const pair = async (token: string) => {
    setError('');
    try {
      await pairBrowser('/api/login', { token });
      setSnapshot(await loadPanes()); setPaired(true);
    } catch (cause) { setError((cause as Error).message); }
  };
  const draftKey = selected?.pane_id || '';
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
        {!selected && alerts !== 'unsupported' ? <button type="button" id="alerts" className="icon-button" disabled={alertsBusy}
          aria-pressed={alerts === 'on'} aria-label={alerts === 'on' ? 'Alerts on' : alerts === 'blocked' ? 'Alerts blocked' : 'Turn on alerts'}
          title={alerts === 'on' ? 'Alert settings' : 'Alert me when an agent needs me'} aria-haspopup={alerts === 'on' ? 'dialog' : undefined}
          onClick={() => { if (alerts === 'on') setAlertsOpen(true); else void toggleAlerts(); }}><Icon name={alerts === 'on' ? 'bell' : 'bell-off'} /></button> : null}
        <button type="button" id="refresh" className="icon-button" aria-label="Refresh"
          onClick={() => { clearError(); void refresh(); engine?.reconnect(); }}><Icon name="refresh" /></button>
        {selected ? <button type="button" id="pane-actions" className="icon-button" aria-label="Pane actions"
          aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><Icon name="more" /></button> : null}
      </header>
      <AgentSwitcher snapshot={snapshot} selected={selected} onSelect={select} />
      <Inventory snapshot={snapshot} hidden={Boolean(selected)} onSelect={select} banner={selected ? null : banner} />
      <TerminalPanel pane={selected} state={session} onState={setSession} engine={engine} onEngine={setEngine}
        banner={selected ? banner : null} onText={text => { if (selected) setTerminalText({ paneId: selected.pane_id, text }); }}
        draft={drafts[draftKey] || ''} onDraft={value => { if (draftKey) { saveDraft(draftKey, value); setDrafts(previous => ({ ...previous, [draftKey]: value })); } }} />
      {selected ? null : <button type="button" id="new" className="primary fab" aria-haspopup="dialog"
        onClick={() => setCreateRequest({ kind: 'agent', workspaceId: sessionStorage.getItem('whistle-workspace') || undefined })}>
        <Icon name="plus" />New</button>}
      <AlertsSheet open={alertsOpen && alerts === 'on'} onClose={() => setAlertsOpen(false)}
        onTurnOff={async () => { await toggleAlerts(); setAlertsOpen(false); }} />
      <CreateSheet request={createRequest} snapshot={snapshot} onClose={() => setCreateRequest(undefined)} onCreated={created} />
      <PaneMenu open={menuOpen} pane={selected} snapshot={snapshot} onClose={() => setMenuOpen(false)}
        onNew={request => { setMenuOpen(false); setCreateRequest(request); }} onDone={destroy} onRename={rename}
        onChanges={() => { setMenuOpen(false); setChangesFor(selected?.pane_id); }} />
      <ChangesSheet pane={selected} open={Boolean(selected) && changesFor === selected?.pane_id} onClose={() => setChangesFor(undefined)}
        onPicture={setPicture} />
      <TerminalTextSheet text={terminalText?.paneId === selected?.pane_id ? terminalText?.text : undefined} paneId={selected?.pane_id}
        onClose={() => setTerminalText(undefined)} onPicture={setPicture} />
      <PictureViewer picture={picture?.paneId === selected?.pane_id ? picture : undefined} onClose={() => setPicture(undefined)} />
    </div>
  </>;
}
