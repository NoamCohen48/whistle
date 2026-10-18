import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pane, Snapshot, Workspace } from '../../src/herdr.ts';
import { groupWorkspaces } from '../../src/workspaces.ts';
import { loadPreviews } from '../api.ts';
import { Icon } from './Icon.tsx';
import { readPreference, writePreference } from '../preferences.ts';

export function paneName(pane: Pane) { return pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id; }
export function workspaceName(snapshot: Snapshot | undefined, pane: Pane) {
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id);
  return workspace?.label || workspace?.name || pane.workspace_id;
}

// Herdr reports idle, working, blocked, done or unknown; older builds used free-form strings,
// so map loosely to a few visual tones without parsing agent output.
type Tone = 'busy' | 'attention' | 'done' | 'idle' | 'shell';
export function statusTone(pane: Pane): Tone {
  const status = pane.agent_status?.toLowerCase() || '';
  if (!pane.agent) return 'shell';
  if (status === 'done') return 'done';
  if (/work|run|busy|think|stream|generat/.test(status)) return 'busy';
  if (/block|wait|input|attention|approv|error|fail|ask/.test(status)) return 'attention';
  return 'idle';
}
// Blocked agents wait for an answer; done agents finished a turn nobody has looked at yet.
export function needsYou(pane: Pane) { const tone = statusTone(pane); return tone === 'attention' || tone === 'done'; }
function statusText(pane: Pane) {
  if (!pane.agent) return 'shell';
  const tone = statusTone(pane);
  return tone === 'attention' ? 'needs you' : tone === 'done' ? 'finished' : pane.agent_status || 'unknown';
}
function StatusDot({ pane }: { pane: Pane }) {
  return <i className="dot" data-tone={statusTone(pane)} aria-hidden="true" />;
}

export function AgentSwitcher({ snapshot, selected, onSelect }: {
  snapshot?: Snapshot; selected?: Pane; onSelect: (pane: Pane) => void;
}) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    bar.current?.querySelector('[aria-current=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.pane_id, selected?.terminal_id]);
  const agents = snapshot?.panes.filter(pane => pane.agent) || [];
  return <nav id="agent-switcher" ref={bar} aria-label="Live agents" hidden={!agents.length}>
    {agents.map(pane => {
      const workspace = workspaceName(snapshot, pane);
      return <button type="button" key={pane.pane_id} data-pane={pane.pane_id}
        aria-label={`${workspace} · ${paneName(pane)}, ${pane.agent_status || 'status unknown'}`}
        aria-current={pane.pane_id === selected?.pane_id} onClick={() => onSelect(pane)}>
        <StatusDot pane={pane} /><span className="chip-workspace">{workspace}</span><span className="chip-name">{paneName(pane)}</span>
      </button>;
    })}
  </nav>;
}

const shortPath = (path: string) => path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');

function PaneRow({ pane, detail, preview, onSelect, pinned, onPin }: { pane: Pane; detail?: string; preview?: string; onSelect: (pane: Pane) => void; pinned?: boolean; onPin?: (pane: Pane) => void }) {
  return <div className="pane-entry"><button type="button" className="pane" onClick={() => onSelect(pane)}>
    <StatusDot pane={pane} />
    <span className="pane-copy">
      <strong>{paneName(pane)}</strong>
      <small><span className="state" data-tone={statusTone(pane)}>{statusText(pane)}</span>
        <span>{pane.agent || 'terminal'}</span>
        {detail !== undefined ? <span>{detail}</span> : pane.cwd ? <span className="cwd" title={pane.cwd}>{shortPath(pane.cwd)}</span> : null}</small>
      {preview ? <span className="pane-preview">{Array.from(preview).slice(0, 120).join('')}</span> : null}
    </span>
    <Icon name="forward" size={18} />
  </button>{onPin ? <button type="button" className="pin-pane" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${paneName(pane)}`} aria-pressed={Boolean(pinned)} onClick={() => onPin(pane)}>{pinned ? 'Pinned' : 'Pin'}</button> : null}</div>;
}

function WorkspaceGroup({ workspace, snapshot, previews, nested = false, nestedPanes = 0, children, onSelect, pinned, onPin }: {
  workspace: Workspace; snapshot: Snapshot; previews: Record<string, string>; nested?: boolean; nestedPanes?: number; children?: ReactNode; onSelect: (pane: Pane) => void;
  pinned: string[]; onPin: (pane: Pane) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => readPreference<string[]>('collapsed-workspaces', []).includes(workspace.workspace_id));
  const Heading = nested ? 'h3' : 'h2';
  const panes = snapshot.panes.filter(pane => pane.workspace_id === workspace.workspace_id);
  return <section data-workspace={workspace.workspace_id} className={nested ? 'worktree-group' : 'workspace-group'} data-collapsed={collapsed}>
    <Heading className="workspace"><button type="button" className="workspace-toggle quiet" aria-expanded={!collapsed} onClick={() => {
      const next = !collapsed; setCollapsed(next);
      const ids = readPreference<string[]>('collapsed-workspaces', []).filter(id => id !== workspace.workspace_id);
      writePreference('collapsed-workspaces', next ? [...ids, workspace.workspace_id] : ids);
    }}>
      {nested ? <Icon name="branch" size={16} /> : null}
      <span className="workspace-name">{workspace.label || workspace.name || workspace.workspace_id}</span>
      {workspace.worktree?.is_linked_worktree ? <span className="worktree-badge">Worktree</span> : null}
      <span className="workspace-count">{collapsed ? `${panes.length + nestedPanes} hidden` : panes.length}</span><Icon name="chevron" size={18} />
    </button></Heading>
    {panes.length ? <ul className="pane-list" hidden={collapsed}>{panes.map(pane => <li key={pane.pane_id}>
      <PaneRow pane={pane} preview={previews[pane.pane_id]} onSelect={onSelect} pinned={pinned.includes(pane.pane_id)} onPin={onPin} />
    </li>)}</ul> : null}
    {children}
  </section>;
}

// Search appears once the list is long enough to need it.
export const SEARCH_THRESHOLD = 6;
function matches(snapshot: Snapshot, pane: Pane, words: string[], preview?: string) {
  const text = [paneName(pane), workspaceName(snapshot, pane), pane.agent, statusText(pane), pane.cwd, pane.pane_id, preview]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

export function Inventory({ snapshot, hidden, banner, onSelect, recent = [], lastUpdated, stale = false, refreshing = false, onCreate }: {
  snapshot?: Snapshot; hidden: boolean; banner?: ReactNode; onSelect: (pane: Pane) => void;
  recent?: string[]; lastUpdated?: number; stale?: boolean; refreshing?: boolean; onCreate?: () => void;
}) {
  const [pinned, setPinned] = useState<string[]>(() => readPreference('pinned-panes', []));
  const [filter, setFilter] = useState('all');
  const onPin = (pane: Pane) => setPinned(previous => {
    const next = previous.includes(pane.pane_id) ? previous.filter(id => id !== pane.pane_id) : [...previous, pane.pane_id];
    writePreference('pinned-panes', next); return next;
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    if (hidden || !snapshot) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const next = await loadPreviews(controller.signal);
        if (!controller.signal.aborted) setPreviews(next);
      } catch { /* PairingRequired is handled centrally; transient failures keep the list usable. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    const visible = () => { void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [hidden, Boolean(snapshot)]);
  const count = snapshot?.panes.length || 0;
  const [query, setQuery] = useState('');
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  const searchable = count >= SEARCH_THRESHOLD;
  const results = snapshot && ((searchable && words.length) || filter !== 'all') ? snapshot.panes.filter(pane =>
    (filter === 'all' || (filter === 'needs' ? needsYou(pane) : filter === 'busy' ? statusTone(pane) === 'busy' : statusTone(pane) === 'idle'))
    && matches(snapshot, pane, searchable ? words : [], previews[pane.pane_id])) : undefined;
  const shortcuts = (ids: string[]) => ids.map(id => snapshot?.panes.find(pane => pane.pane_id === id)).filter((pane): pane is Pane => Boolean(pane));
  const pinnedPanes = shortcuts(pinned);
  const recentPanes = shortcuts(recent).filter(pane => !pinned.includes(pane.pane_id)).slice(0, 3);
  // Blocked agents are waiting on an answer, so they come before finished ones.
  const waiting = (snapshot?.panes.filter(needsYou) || [])
    .sort((a, b) => Number(statusTone(b) === 'attention') - Number(statusTone(a) === 'attention'));
  return <main id="panes" hidden={hidden} aria-busy={!snapshot}>
    {banner}
    <div className="intro"><h1>Your herd</h1><p className="inventory-freshness" role="status">{refreshing ? 'Refreshing…' : lastUpdated
      ? `${stale ? 'Showing saved state. Last updated' : 'Updated'} ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(lastUpdated)}` : 'Connecting…'}</p></div>
    {count ? <div className="herd-filters" role="group" aria-label="Filter panes">{[
      ['all', 'All', count], ['needs', 'Needs you', snapshot!.panes.filter(needsYou).length],
      ['busy', 'Working', snapshot!.panes.filter(pane => statusTone(pane) === 'busy').length],
      ['idle', 'Idle', snapshot!.panes.filter(pane => statusTone(pane) === 'idle').length],
    ].map(([value, name, total]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(String(value))}>{name}<span>{total}</span></button>)}</div> : null}
    {searchable ? <div className="search" role="search">
      <Icon name="search" size={18} />
      <input id="pane-search" type="search" value={query} placeholder="Search panes" aria-label="Search panes"
        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
      {query ? <button type="button" id="clear-search" className="icon-button" aria-label="Clear search"
        onClick={() => setQuery('')}><Icon name="close" size={18} /></button> : null}
    </div> : null}
    {results ? <section id="search-results" className="workspace-group" aria-live="polite">
      <h2 className="workspace"><span className="workspace-name">
        {results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'}</span></h2>
      {results.length ? <ul className="pane-list">{results.map(pane => <li key={pane.pane_id}>
        <PaneRow pane={pane} preview={previews[pane.pane_id]} detail={workspaceName(snapshot!, pane)} onSelect={onSelect} />
      </li>)}</ul> : <div className="empty"><p>Try another name, workspace, or status.</p><button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button></div>}
    </section> : null}
    {!results && pinnedPanes.length ? <section className="workspace-group" id="pinned-panes"><h2 className="workspace">Pinned</h2>
      <ul className="pane-list">{pinnedPanes.map(pane => <li key={pane.pane_id}><PaneRow pane={pane} preview={previews[pane.pane_id]} detail={workspaceName(snapshot, pane)} onSelect={onSelect} pinned onPin={onPin} /></li>)}</ul></section> : null}
    {!results && recentPanes.length ? <details className="recent-panes"><summary>Recent panes<Icon name="chevron" size={18} /></summary><ul className="pane-list">{recentPanes.map(pane => <li key={pane.pane_id}><PaneRow pane={pane} preview={previews[pane.pane_id]} detail={workspaceName(snapshot, pane)} onSelect={onSelect} /></li>)}</ul></details> : null}
    {!results && snapshot && waiting.length ? <section id="needs-you" className="workspace-group" aria-labelledby="needs-you-heading">
      <h2 className="workspace" id="needs-you-heading"><span className="workspace-name">Needs you</span>
        <span className="workspace-count">{waiting.length}</span></h2>
      <ul className="pane-list">{waiting.map(pane => <li key={pane.pane_id}>
        <PaneRow pane={pane} preview={previews[pane.pane_id]} detail={workspaceName(snapshot, pane)} onSelect={onSelect} />
      </li>)}</ul>
    </section> : null}
    <div id="pane-list" hidden={Boolean(results)}>{!snapshot ? <div className="skeleton" role="status" aria-label="Loading panes…">
      {[0, 1, 2].map(row => <span key={row} />)}</div>
      : count ? groupWorkspaces(snapshot.workspaces).map(group =>
        <WorkspaceGroup key={group.workspace.workspace_id} workspace={group.workspace} snapshot={snapshot} previews={previews} onSelect={onSelect} pinned={pinned} onPin={onPin}
          nestedPanes={snapshot.panes.filter(pane => group.children.some(child => child.workspace_id === pane.workspace_id)).length}>
          {group.children.map(workspace => <WorkspaceGroup key={workspace.workspace_id} workspace={workspace}
            nested snapshot={snapshot} previews={previews} onSelect={onSelect} pinned={pinned} onPin={onPin} />)}
        </WorkspaceGroup>)
      : <div className="empty"><strong>No panes yet</strong><p>Open a workspace on your PC, or choose a project folder to create one here. Then start an agent or terminal.</p><button type="button" onClick={onCreate}>Open a project</button></div>}</div>
  </main>;
}
