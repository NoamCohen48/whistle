import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pane, Snapshot, Workspace } from '../../src/herdr.ts';
import { groupWorkspaces } from '../../src/workspaces.ts';
import { Icon } from './Icon.tsx';

export function paneName(pane: Pane) { return pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id; }
export function workspaceName(snapshot: Snapshot | undefined, pane: Pane) {
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id);
  return workspace?.label || workspace?.name || pane.workspace_id;
}

// Herdr reports idle, working, blocked, done or unknown; older builds used free-form strings,
// so map loosely to a few visual tones without parsing agent output.
type Tone = 'busy' | 'attention' | 'done' | 'idle' | 'shell';
function statusTone(pane: Pane): Tone {
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

function PaneRow({ pane, detail, onSelect }: { pane: Pane; detail?: string; onSelect: (pane: Pane) => void }) {
  return <button type="button" className="pane" onClick={() => onSelect(pane)}>
    <StatusDot pane={pane} />
    <span className="pane-copy">
      <strong>{paneName(pane)}</strong>
      <small><span className="state" data-tone={statusTone(pane)}>{statusText(pane)}</span>
        <span>{pane.agent || 'terminal'}</span>
        {detail !== undefined ? <span>{detail}</span> : pane.cwd ? <span className="cwd">{pane.cwd}</span> : null}</small>
    </span>
    <code className="pane-id">{pane.pane_id}</code>
    <Icon name="forward" size={18} />
  </button>;
}

function WorkspaceGroup({ workspace, snapshot, nested = false, children, onSelect }: {
  workspace: Workspace; snapshot: Snapshot; nested?: boolean; children?: ReactNode; onSelect: (pane: Pane) => void;
}) {
  const Heading = nested ? 'h3' : 'h2';
  const panes = snapshot.panes.filter(pane => pane.workspace_id === workspace.workspace_id);
  return <section data-workspace={workspace.workspace_id} className={nested ? 'worktree-group' : 'workspace-group'}>
    <Heading className="workspace">
      {nested ? <Icon name="branch" size={16} /> : null}
      <span className="workspace-name">{workspace.label || workspace.name || workspace.workspace_id}</span>
      {workspace.worktree?.is_linked_worktree ? <span className="worktree-badge">Worktree</span> : null}
      <span className="workspace-count">{panes.length}</span>
    </Heading>
    {panes.length ? <ul className="pane-list">{panes.map(pane => <li key={pane.pane_id}>
      <PaneRow pane={pane} onSelect={onSelect} />
    </li>)}</ul> : null}
    {children}
  </section>;
}

// Search appears once the list is long enough to need it.
export const SEARCH_THRESHOLD = 6;
function matches(snapshot: Snapshot, pane: Pane, words: string[]) {
  const text = [paneName(pane), workspaceName(snapshot, pane), pane.agent, statusText(pane), pane.cwd, pane.pane_id]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

export function Inventory({ snapshot, hidden, banner, onSelect }: {
  snapshot?: Snapshot; hidden: boolean; banner?: ReactNode; onSelect: (pane: Pane) => void;
}) {
  const count = snapshot?.panes.length || 0;
  const [query, setQuery] = useState('');
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  const searchable = count >= SEARCH_THRESHOLD;
  const results = snapshot && searchable && words.length ? snapshot.panes.filter(pane => matches(snapshot, pane, words)) : undefined;
  // Blocked agents are waiting on an answer, so they come before finished ones.
  const waiting = (snapshot?.panes.filter(needsYou) || [])
    .sort((a, b) => Number(statusTone(b) === 'attention') - Number(statusTone(a) === 'attention'));
  return <main id="panes" hidden={hidden} aria-busy={!snapshot}>
    {banner}
    <div className="intro"><h1>Your herd</h1></div>
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
        <PaneRow pane={pane} detail={workspaceName(snapshot!, pane)} onSelect={onSelect} />
      </li>)}</ul> : null}
    </section> : null}
    {!results && snapshot && waiting.length ? <section id="needs-you" className="workspace-group" aria-labelledby="needs-you-heading">
      <h2 className="workspace" id="needs-you-heading"><span className="workspace-name">Needs you</span>
        <span className="workspace-count">{waiting.length}</span></h2>
      <ul className="pane-list">{waiting.map(pane => <li key={pane.pane_id}>
        <PaneRow pane={pane} detail={workspaceName(snapshot, pane)} onSelect={onSelect} />
      </li>)}</ul>
    </section> : null}
    <div id="pane-list" hidden={Boolean(results)}>{!snapshot ? <div className="skeleton" role="status" aria-label="Loading panes…">
      {[0, 1, 2].map(row => <span key={row} />)}</div>
      : count ? groupWorkspaces(snapshot.workspaces).map(group =>
        <WorkspaceGroup key={group.workspace.workspace_id} workspace={group.workspace} snapshot={snapshot} onSelect={onSelect}>
          {group.children.map(workspace => <WorkspaceGroup key={workspace.workspace_id} workspace={workspace}
            nested snapshot={snapshot} onSelect={onSelect} />)}
        </WorkspaceGroup>)
      : <div className="empty"><strong>No panes</strong></div>}</div>
  </main>;
}
