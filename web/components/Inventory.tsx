import { useEffect, useRef, type ReactNode } from 'react';
import type { Pane, Snapshot, Workspace } from '../../src/herdr.ts';
import { groupWorkspaces } from '../../src/workspaces.ts';
import { Icon } from './Icon.tsx';

export function paneName(pane: Pane) { return pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id; }
export function workspaceName(snapshot: Snapshot | undefined, pane: Pane) {
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id);
  return workspace?.label || workspace?.name || pane.workspace_id;
}

// Herdr status strings are free-form; map them to a few visual tones without parsing agent output.
type Tone = 'busy' | 'attention' | 'idle' | 'shell';
function statusTone(pane: Pane): Tone {
  const status = pane.agent_status?.toLowerCase() || '';
  if (!pane.agent) return 'shell';
  if (/work|run|busy|think|stream|generat/.test(status)) return 'busy';
  if (/block|wait|input|attention|approv|error|fail|ask/.test(status)) return 'attention';
  return 'idle';
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
      <button type="button" className="pane" onClick={() => onSelect(pane)}>
        <StatusDot pane={pane} />
        <span className="pane-copy">
          <strong>{paneName(pane)}</strong>
          <small><span className="state">{pane.agent ? pane.agent_status || 'unknown' : 'shell'}</span>
            <span>{pane.agent || 'terminal'}</span>{pane.cwd ? <span className="cwd">{pane.cwd}</span> : null}</small>
        </span>
        <code className="pane-id">{pane.pane_id}</code>
        <Icon name="forward" size={18} />
      </button>
    </li>)}</ul> : null}
    {children}
  </section>;
}

export function Inventory({ snapshot, hidden, banner, onSelect }: {
  snapshot?: Snapshot; hidden: boolean; banner?: ReactNode; onSelect: (pane: Pane) => void;
}) {
  const count = snapshot?.panes.length || 0;
  return <main id="panes" hidden={hidden} aria-busy={!snapshot}>
    {banner}
    <div className="intro"><h1>Your herd</h1></div>
    <div id="pane-list">{!snapshot ? <div className="skeleton" role="status" aria-label="Loading panes…">
      {[0, 1, 2].map(row => <span key={row} />)}</div>
      : count ? groupWorkspaces(snapshot.workspaces).map(group =>
        <WorkspaceGroup key={group.workspace.workspace_id} workspace={group.workspace} snapshot={snapshot} onSelect={onSelect}>
          {group.children.map(workspace => <WorkspaceGroup key={workspace.workspace_id} workspace={workspace}
            nested snapshot={snapshot} onSelect={onSelect} />)}
        </WorkspaceGroup>)
      : <div className="empty"><strong>No panes</strong></div>}</div>
  </main>;
}
