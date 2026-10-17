import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pane, Snapshot, Workspace } from '../../src/herdr.ts';
import { loadAgentKinds, loadWorktrees, runAction, type Action, type WorktreeChoice } from '../api.ts';
import { Icon, type IconName } from './Icon.tsx';
import { paneName } from './Inventory.tsx';

export type CreateKind = 'terminal' | 'agent' | 'workspace' | 'worktree';
const kinds: [CreateKind, IconName, string][] = [
  ['agent', 'agent', 'Agent'], ['terminal', 'terminal', 'Terminal'], ['workspace', 'folder', 'Workspace'], ['worktree', 'branch', 'Worktree'],
];
const label = (workspace: Workspace) => workspace.label || workspace.name || workspace.workspace_id;

// Bottom sheet on a native modal <dialog>: focus trap, Escape and back gesture come for free.
function Sheet({ open, title, onClose, children, id }: { open: boolean; title: string; onClose: () => void; children: ReactNode; id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog id={id} ref={dialog} className="sheet" aria-label={title} onClose={onClose}
    onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="sheet-body">
      <div className="sheet-head"><h2 tabIndex={-1} autoFocus>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </dialog>;
}

export interface CreateRequest { kind: CreateKind; workspaceId?: string }

export function CreateSheet({ request, snapshot, onClose, onCreated }: {
  request?: CreateRequest; snapshot?: Snapshot; onClose: () => void;
  onCreated: (paneId: string | undefined, warning?: string) => Promise<void>;
}) {
  const workspaces = snapshot?.workspaces || [];
  // Herdr reports Git metadata only once a repository has worktrees, so offer every main workspace.
  const repositories = workspaces.filter(workspace => !workspace.worktree?.is_linked_worktree);
  const [kind, setKind] = useState<CreateKind>('agent');
  const [workspaceId, setWorkspaceId] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [agents, setAgents] = useState<string[]>();
  const [agent, setAgent] = useState('');
  const [existing, setExisting] = useState(false);
  const [choices, setChoices] = useState<WorktreeChoice[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folder = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const branch = useRef<HTMLInputElement>(null);
  const base = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    setKind(request.kind); setError(''); setBusy(false); setExisting(false); setChoices(undefined);
    const preferred = request.workspaceId && workspaces.some(item => item.workspace_id === request.workspaceId)
      ? request.workspaceId : workspaces[0]?.workspace_id || '';
    setWorkspaceId(preferred);
    const parent = workspaces.find(item => item.workspace_id === preferred);
    const repository = repositories.find(item => item.workspace_id === preferred)
      || repositories.find(item => item.worktree?.repo_key === parent?.worktree?.repo_key) || repositories[0];
    setRepositoryId(repository?.workspace_id || '');
    // Workspaces are read once per opening; inventory polling must not reset a half-filled form.
  }, [request]);
  useEffect(() => {
    if (!request || agents) return;
    loadAgentKinds().then(list => {
      setAgents(list);
      const used = snapshot?.panes.map(pane => pane.agent).filter(Boolean) as string[] | undefined;
      const common = used?.sort((a, b) => used.filter(x => x === b).length - used.filter(x => x === a).length)
        .find(item => list.includes(item));
      setAgent(current => current || common || list[0] || '');
    }).catch(cause => setError((cause as Error).message));
  }, [request, agents, snapshot]);
  useEffect(() => {
    if (!request || kind !== 'worktree' || !existing || !repositoryId) return;
    let active = true;
    setChoices(undefined);
    loadWorktrees(repositoryId).then(list => { if (active) setChoices(list); })
      .catch(cause => { if (active) { setChoices([]); setError((cause as Error).message); } });
    return () => { active = false; };
  }, [request, kind, existing, repositoryId]);

  const submit = async (action: Action) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await runAction(action);
      await onCreated(result.paneId, result.warning);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const create = () => {
    if (kind === 'terminal') return submit({ type: 'terminal', workspaceId });
    if (kind === 'agent') return submit({ type: 'agent', workspaceId, kind: agent });
    if (kind === 'workspace') return submit({ type: 'workspace', cwd: folder.current?.value || '', label: name.current?.value || undefined });
    return submit({ type: 'worktree-create', workspaceId: repositoryId, branch: branch.current?.value || '', base: base.current?.value || undefined });
  };
  const verb = busy ? (kind === 'agent' ? `Starting ${agent}…` : 'Creating…')
    : kind === 'agent' ? `Start ${agent || 'agent'}` : kind === 'terminal' ? 'Open terminal'
      : kind === 'workspace' ? 'Create workspace' : 'Create worktree';
  const workspacePicker = <label className="field">Workspace
    <select id="new-workspace" value={workspaceId} disabled={busy} onChange={event => setWorkspaceId(event.target.value)}>
      {workspaces.map(item => <option key={item.workspace_id} value={item.workspace_id}>
        {item.worktree?.is_linked_worktree ? `${label(item)} (worktree)` : label(item)}</option>)}
    </select></label>;

  return <Sheet id="create-sheet" open={Boolean(request)} title="New" onClose={() => { if (!busy) onClose(); }}>
    <div className="segments" role="group" aria-label="What to create">
      {kinds.map(([value, icon, text]) => <button type="button" key={value} data-kind={value} aria-pressed={kind === value}
        disabled={busy} onClick={() => { setKind(value); setError(''); }}><Icon name={icon} />{text}</button>)}
    </div>
    <form className="sheet-form" onSubmit={event => { event.preventDefault(); void create(); }}>
      {kind === 'terminal' ? workspacePicker : null}
      {kind === 'agent' ? <>
        {workspacePicker}
        <fieldset className="field"><legend>Agent</legend>
          {!agents ? <p className="sheet-status" role="status">Loading agents…</p>
            : agents.length ? <div className="choice-chips">{agents.map(item => <button type="button" key={item} data-agent={item}
              aria-pressed={agent === item} disabled={busy} onClick={() => setAgent(item)}>{item}</button>)}</div>
              : <p className="sheet-status">Herdr reports no supported agents</p>}
        </fieldset>
      </> : null}
      {kind === 'workspace' ? <>
        <label className="field">Folder on your PC
          <input id="new-folder" ref={folder} required disabled={busy} placeholder="~/Work/project"
            autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={1024} /></label>
        <label className="field">Name <span className="optional">optional</span>
          <input id="new-label" ref={name} disabled={busy} placeholder="Folder name" autoComplete="off" maxLength={64} /></label>
      </> : null}
      {kind === 'worktree' ? <>
        {repositories.length ? <label className="field">Repository
          <select id="new-repository" value={repositoryId} disabled={busy} onChange={event => setRepositoryId(event.target.value)}>
            {repositories.map(item => <option key={item.workspace_id} value={item.workspace_id}>{label(item)}</option>)}
          </select></label> : <p className="sheet-status">Open a Git repository as a workspace first</p>}
        <div className="toggle" role="group" aria-label="Branch">
          <button type="button" id="worktree-new" aria-pressed={!existing} disabled={busy} onClick={() => setExisting(false)}>New branch</button>
          <button type="button" id="worktree-existing" aria-pressed={existing} disabled={busy || !repositories.length}
            onClick={() => setExisting(true)}>Existing</button>
        </div>
        {existing ? <div className="worktree-choices">
          {!choices ? <p className="sheet-status" role="status">Loading worktrees…</p>
            : !choices.length ? <p className="sheet-status">No other worktrees</p>
              : <ul>{choices.map(choice => <li key={choice.path}>
                <button type="button" className="worktree-choice" disabled={busy} onClick={() => void (choice.openPaneId
                  ? onCreated(choice.openPaneId) : submit({ type: 'worktree-open', workspaceId: repositoryId, path: choice.path }))}>
                  <Icon name="branch" size={18} />
                  <span><strong>{choice.branch || choice.label}</strong><small>{choice.path}</small></span>
                  <em>{choice.openPaneId ? 'Go to' : 'Open'}</em>
                </button></li>)}</ul>}
        </div> : <>
          <label className="field">Branch
            <input id="new-branch" ref={branch} required disabled={busy || !repositories.length} placeholder="feature/name"
              autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={200} /></label>
          <label className="field">Based on <span className="optional">optional</span>
            <input id="new-base" ref={base} disabled={busy || !repositories.length} placeholder="main"
              autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={200} /></label>
        </>}
      </> : null}
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      {kind === 'worktree' && existing ? null : <button type="submit" id="create-submit" className="primary"
        disabled={busy || (kind === 'agent' && !agent) || ((kind === 'terminal' || kind === 'agent') && !workspaceId)
          || (kind === 'worktree' && !repositoryId)}>{verb}</button>}
    </form>
  </Sheet>;
}

type Pending = 'close-pane' | 'remove-worktree' | undefined;
export function PaneMenu({ open, pane, snapshot, onClose, onNew, onDone }: {
  open: boolean; pane?: Pane; snapshot?: Snapshot; onClose: () => void;
  onNew: (request: CreateRequest) => void;
  onDone: (action: Action) => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setPending(undefined); setError(''); setBusy(false); } }, [open]);
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane?.workspace_id);
  const worktree = workspace?.worktree?.is_linked_worktree ? workspace : undefined;
  const confirm = async () => {
    if (!pane || busy) return;
    setBusy(true); setError('');
    try {
      await onDone(pending === 'remove-worktree' && worktree
        ? { type: 'remove-worktree', workspaceId: worktree.workspace_id } : { type: 'close-pane', paneId: pane.pane_id });
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  const name = pane ? paneName(pane) : '';
  return <Sheet id="pane-menu" open={open} title={pending === 'close-pane' ? `Close ${name}?`
    : pending === 'remove-worktree' ? `Remove ${worktree ? label(worktree) : 'worktree'}?` : name} onClose={() => { if (!busy) onClose(); }}>
    {!pending ? <ul className="menu">
      <li><button type="button" id="menu-new-agent" onClick={() => onNew({ kind: 'agent', workspaceId: pane?.workspace_id })}>
        <Icon name="agent" />New agent here</button></li>
      <li><button type="button" id="menu-new-terminal" onClick={() => onNew({ kind: 'terminal', workspaceId: pane?.workspace_id })}>
        <Icon name="terminal" />New terminal here</button></li>
      <li className="danger"><button type="button" id="menu-close-pane" onClick={() => setPending('close-pane')}>
        <Icon name="close" />Close pane</button></li>
      {worktree ? <li className="danger"><button type="button" id="menu-remove-worktree" onClick={() => setPending('remove-worktree')}>
        <Icon name="trash" />Remove worktree</button></li> : null}
    </ul> : <div className="confirm">
      <p>{pending === 'close-pane' ? 'Whatever runs in this pane on your PC is ended.'
        : 'Its panes close and the checkout is deleted from disk; the branch is kept. Removal is refused if it has uncommitted or untracked files.'}</p>
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      <div className="confirm-actions">
        <button type="button" disabled={busy} onClick={() => { setPending(undefined); setError(''); }}>Cancel</button>
        <button type="button" id="confirm-destructive" className="danger" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Working…' : pending === 'close-pane' ? 'Close pane' : 'Remove worktree'}</button>
      </div>
    </div>}
  </Sheet>;
}
