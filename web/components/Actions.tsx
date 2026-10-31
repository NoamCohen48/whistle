import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pane, Snapshot, Workspace } from '../../shared/api.ts';
import { loadAgentKinds, loadWorktrees, newRequestId, runAction, type Action, type WorktreeChoice } from '../api.ts';
import { FolderPicker, folderValue } from './FolderPicker.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { paneName } from './Inventory.tsx';

export type CreateKind = 'terminal' | 'agent' | 'workspace' | 'worktree';
const kinds: [CreateKind, IconName, string][] = [
  ['agent', 'agent', 'Agent'], ['terminal', 'terminal', 'Terminal'], ['workspace', 'folder', 'Workspace'], ['worktree', 'branch', 'Worktree'],
];
const label = (workspace: Workspace) => workspace.label || workspace.name || workspace.workspace_id;

// Bottom sheet on a native modal <dialog>: focus trap, Escape and back gesture come for free.
export function Sheet({ open, title, onClose, children, id }: { open: boolean; title: string; onClose: () => void; children: ReactNode; id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog id={id} ref={dialog} className="sheet" aria-label={title} onClose={onClose}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="sheet-body">
      <div className="sheet-head"><h2 tabIndex={-1} autoFocus>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </dialog>;
}

// Parent folders of the projects already open, most used first: a new project usually sits beside them.
// Labels shorten the home folder to ~ for display only; the input receives the absolute path.
export function folderSuggestions(snapshot?: Snapshot, limit = 4) {
  const counts = new Map<string, number>();
  for (const workspace of snapshot?.workspaces || []) {
    if (workspace.worktree?.is_linked_worktree) continue; // Herdr-managed checkouts, not project folders.
    const cwd = snapshot!.panes.find(pane => pane.workspace_id === workspace.workspace_id && pane.cwd?.startsWith('/'))?.cwd;
    const parent = cwd?.replace(/\/+$/, '').replace(/\/[^/]+$/, '');
    if (parent) counts.set(parent, (counts.get(parent) || 0) + 1);
  }
  const home = [...counts.keys()].map(path => /^\/(home|Users)\/[^/]+/.exec(path)?.[0]).find(Boolean);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([path]) => ({
    path: `${path}/`,
    label: `${home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path}/`,
  }));
}

export interface CreateRequest { kind: CreateKind; workspaceId?: string }

export function CreateSheet({ request, snapshot, onClose, onCreated }: {
  request?: CreateRequest; snapshot?: Snapshot; onClose: () => void;
  onCreated: (paneId: string | undefined, warning?: string) => Promise<void>;
}) {
  const workspaces = snapshot?.workspaces || [];
  // Herdr reports Git metadata only once a repository has worktrees, so offer every main workspace.
  const repositories = workspaces.filter(workspace => !workspace.worktree?.is_linked_worktree);
  const folders = folderSuggestions(snapshot);
  const [kind, setKind] = useState<CreateKind>('agent');
  const [workspaceId, setWorkspaceId] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [agents, setAgents] = useState<string[]>();
  const [agentRevision, setAgentRevision] = useState(0);
  const [agent, setAgent] = useState('');
  const [existing, setExisting] = useState(false);
  const [choices, setChoices] = useState<WorktreeChoice[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [folder, setFolder] = useState('');
  const name = useRef<HTMLInputElement>(null);
  const branch = useRef<HTMLInputElement>(null);
  const base = useRef<HTMLInputElement>(null);
  // One ID per launch, kept across failed attempts: if the reply was lost after the PC already
  // opened the pane, trying again returns that pane instead of a second one.
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!request) return;
    requestId.current = newRequestId();
    setKind(request.kind); setError(''); setBusy(false); setExisting(false); setChoices(undefined);
    setFolder(folders[0]?.label || '~/');
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
    let active = true;
    loadAgentKinds().then(list => {
      if (!active) return;
      setAgents(list);
      const used = snapshot?.panes.map(pane => pane.agent).filter(Boolean) as string[] | undefined;
      const common = used?.sort((a, b) => used.filter(x => x === b).length - used.filter(x => x === a).length)
        .find(item => list.includes(item));
      setAgent(current => current || common || list[0] || '');
    }).catch(cause => { if (active) { setAgents([]); setError((cause as Error).message); } });
    return () => { active = false; };
    // Metadata polling must not restart agent discovery or overwrite a half-filled form.
  }, [request, agents, agentRevision]);
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
      const result = await runAction(action, requestId.current);
      requestId.current = newRequestId();
      await onCreated(result.paneId, result.warning);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const create = () => {
    if (kind === 'terminal') return submit({ type: 'terminal', workspaceId });
    if (kind === 'agent') return submit({ type: 'agent', workspaceId, kind: agent });
    if (kind === 'workspace') return submit({ type: 'workspace', cwd: folderValue(folder), label: name.current?.value || undefined });
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
              : <><p className="sheet-status">No agents available</p><button type="button" onClick={() => { setError(''); setAgents(undefined); setAgentRevision(value => value + 1); }}>Reload agents</button></>}
        </fieldset>
      </> : null}
      {kind === 'workspace' ? <>
        <label className="field">Folder on your PC
          <input id="new-folder" value={folder} onChange={event => setFolder(event.target.value)} required disabled={busy} placeholder="~/Work/project"
            autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={1024} /></label>
        {folders.length ? <div className="choice-chips folder-chips" role="group" aria-label="Start from a folder">
          {folders.map(item => <button type="button" key={item.path} data-folder={item.path} title={item.path} disabled={busy} onClick={() => setFolder(item.label)}><Icon name="folder" size={16} />{item.label}</button>)}
        </div> : null}
        <FolderPicker value={folder} disabled={busy} onChange={setFolder} />
        <label className="field">Name <span className="optional">optional</span>
          <input id="new-label" ref={name} disabled={busy} placeholder={folderValue(folder).split('/').pop() || 'Folder name'} autoComplete="off" maxLength={64} /></label>
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

type Pending = 'close-pane' | 'remove-worktree' | 'rename-pane' | 'rename-workspace' | undefined;
// How the terminal is shown on this phone. Width applies only while controlling.
export interface ViewOptions { onTextSize: () => void; onTerminalText: () => void; fitWidth?: boolean; onWidth?: () => void }

export function PaneMenu({ open, pane, snapshot, onClose, onNew, onDone, onRename, onChanges, view }: {
  // From the dashboard (a long press on a row) there is no open terminal, so no view options or change review.
  open: boolean; pane?: Pane; snapshot?: Snapshot; onClose: () => void; onChanges?: () => void; view?: ViewOptions;
  onNew: (request: CreateRequest) => void;
  onDone: (action: Action) => Promise<void>;
  onRename: (action: Action) => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setPending(undefined); setError(''); setBusy(false); } }, [open]);
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane?.workspace_id);
  const worktree = workspace?.worktree?.is_linked_worktree ? workspace : undefined;
  const run = async (callback: (action: Action) => Promise<void>, action: Action) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await callback(action); } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  const confirm = () => pane && run(onDone, pending === 'remove-worktree' && worktree
    ? { type: 'remove-worktree', workspaceId: worktree.workspace_id } : { type: 'close-pane', paneId: pane.pane_id });
  const rename = () => {
    const value = nameInput.current?.value.trim() || '';
    if (!pane || !workspace) return;
    void run(onRename, pending === 'rename-workspace'
      ? { type: 'rename-workspace', workspaceId: workspace.workspace_id, label: value }
      : { type: 'rename-pane', paneId: pane.pane_id, label: value || undefined });
  };
  const back = () => { setPending(undefined); setError(''); };
  const name = pane ? paneName(pane) : '';
  const renaming = pending === 'rename-pane' || pending === 'rename-workspace';
  const title = pending === 'close-pane' ? `Close ${name}?`
    : pending === 'remove-worktree' ? `Remove ${worktree ? label(worktree) : 'worktree'}?`
      : pending === 'rename-pane' ? 'Rename pane' : pending === 'rename-workspace' ? 'Rename workspace' : name;
  return <Sheet id="pane-menu" open={open} title={title} onClose={() => { if (!busy) onClose(); }}>
    {!pending ? <ul className="menu">
      <li><button type="button" id="menu-new-agent" onClick={() => onNew({ kind: 'agent', workspaceId: pane?.workspace_id })}>
        <Icon name="agent" />New agent here</button></li>
      <li><button type="button" id="menu-new-terminal" onClick={() => onNew({ kind: 'terminal', workspaceId: pane?.workspace_id })}>
        <Icon name="terminal" />New terminal here</button></li>
      {view ? <li className="separated"><button type="button" id="menu-terminal-text" onClick={view.onTerminalText}>
        <Icon name="text" />Terminal text</button></li> : null}
      {pane?.cwd && onChanges ? <li><button type="button" id="menu-changes" onClick={onChanges}>
        <Icon name="diff" />Review changes</button></li> : null}
      {view ? <li><button type="button" id="menu-text-size" onClick={view.onTextSize}>
        <Icon name="font-size" />Text size</button></li> : null}
      {view?.onWidth ? <li><button type="button" id="menu-width" onClick={view.onWidth}>
        <Icon name="width" />{view.fitWidth ? 'Use the PC’s width' : 'Fit width to phone'}</button></li> : null}
      <li className="separated"><button type="button" id="menu-rename-pane" onClick={() => setPending('rename-pane')}>
        <Icon name="compose" />Rename pane</button></li>
      {workspace ? <li><button type="button" id="menu-rename-workspace" onClick={() => setPending('rename-workspace')}>
        <Icon name="folder" />Rename workspace</button></li> : null}
      <li className="danger"><button type="button" id="menu-close-pane" onClick={() => setPending('close-pane')}>
        <Icon name="close" />Close pane</button></li>
      {worktree ? <li className="danger"><button type="button" id="menu-remove-worktree" onClick={() => setPending('remove-worktree')}>
        <Icon name="trash" />Remove worktree</button></li> : null}
    </ul> : renaming ? <form className="sheet-form" onSubmit={event => { event.preventDefault(); rename(); }}>
      <label className="field">{pending === 'rename-pane' ? <>Name <span className="optional">empty uses the terminal title</span></> : 'Name'}
        <input id="rename-input" ref={nameInput} key={pending} autoFocus disabled={busy} maxLength={64} autoComplete="off"
          required={pending === 'rename-workspace'}
          defaultValue={pending === 'rename-pane' ? pane?.label || '' : workspace ? label(workspace) : ''} /></label>
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      <div className="confirm-actions">
        <button type="button" disabled={busy} onClick={back}>Cancel</button>
        <button type="submit" id="rename-save" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form> : <div className="confirm">
      <p>{pending === 'close-pane' ? 'Whatever runs in this pane on your PC is ended.'
        : 'Its panes close and the checkout is deleted from disk; the branch is kept. Removal is refused if it has uncommitted or untracked files.'}</p>
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      <div className="confirm-actions">
        <button type="button" disabled={busy} onClick={back}>Cancel</button>
        <button type="button" id="confirm-destructive" className="danger" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Working…' : pending === 'close-pane' ? 'Close pane' : 'Remove worktree'}</button>
      </div>
    </div>}
  </Sheet>;
}
