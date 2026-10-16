import { useEffect, useRef } from 'react';
import type { Pane, Snapshot, Workspace } from '../../src/herdr.ts';
import { groupWorkspaces } from '../../src/workspaces.ts';

export function paneName(pane: Pane) { return pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id; }

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
      const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane.workspace_id);
      const label = `${workspace?.label || pane.workspace_id} · ${paneName(pane)}`;
      return <button type="button" key={pane.pane_id} data-pane={pane.pane_id} aria-label={label}
        aria-current={pane.pane_id === selected?.pane_id} onClick={() => onSelect(pane)}>
        <span>{label}</span><small>{pane.agent_status || 'unknown'}</small>
      </button>;
    })}
  </nav>;
}

function WorkspaceGroup({ workspace, snapshot, nested = false, children, onSelect }: {
  workspace: Workspace; snapshot: Snapshot; nested?: boolean; children?: React.ReactNode; onSelect: (pane: Pane) => void;
}) {
  const Heading = nested ? 'h3' : 'h2';
  return <section data-workspace={workspace.workspace_id} className={nested ? 'worktree-group' : 'workspace-group'}>
    <Heading className="workspace">{workspace.label || workspace.name || workspace.workspace_id}
      {workspace.worktree?.is_linked_worktree ? <span className="worktree-badge">Worktree</span> : null}
    </Heading>
    {snapshot.panes.filter(pane => pane.workspace_id === workspace.workspace_id).map(pane =>
      <button type="button" className="pane" key={pane.pane_id} onClick={() => onSelect(pane)}>
        <span className="state">{pane.agent_status || 'shell'}</span>
        <span className="pane-copy"><strong>{paneName(pane)}</strong>
          <small>{pane.pane_id} · {pane.agent || 'terminal'} · {pane.cwd || ''}</small></span>
        <span className="pane-arrow">›</span>
      </button>)}
    {children}
  </section>;
}

export function Inventory({ snapshot, hidden, onSelect }: {
  snapshot?: Snapshot; hidden: boolean; onSelect: (pane: Pane) => void;
}) {
  return <main id="panes" hidden={hidden}>
    <div className="intro"><h1>Your herd</h1><p>Existing sessions. Nothing relaunched.</p></div>
    <div id="pane-list">{snapshot ? snapshot.panes.length ? groupWorkspaces(snapshot.workspaces).map(group =>
      <WorkspaceGroup key={group.workspace.workspace_id} workspace={group.workspace} snapshot={snapshot} onSelect={onSelect}>
        {group.children.map(workspace => <WorkspaceGroup key={workspace.workspace_id} workspace={workspace}
          nested snapshot={snapshot} onSelect={onSelect} />)}
      </WorkspaceGroup>) : 'No panes in this Herdr session. Open a pane on your PC, then refresh.' : 'Loading panes…'}</div>
  </main>;
}
