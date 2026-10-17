import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { HerdrError, rpc, snapshot } from './herdr.ts';

// Phone-initiated Herdr lifecycle actions. Every request is reduced to a fixed set of
// validated fields: no commands, agent arguments or environment ever come from the browser.
// New panes are created without desktop focus; worktree removal is never forced.
export type Action =
  | { type: 'terminal'; workspaceId: string }
  | { type: 'agent'; workspaceId: string; kind: string }
  | { type: 'workspace'; cwd: string; label?: string }
  | { type: 'worktree-create'; workspaceId: string; branch: string; base?: string }
  | { type: 'worktree-open'; workspaceId: string; path: string }
  | { type: 'close-pane'; paneId: string }
  | { type: 'remove-worktree'; workspaceId: string }
  | { type: 'rename-pane'; paneId: string; label?: string }
  | { type: 'rename-workspace'; workspaceId: string; label: string };
export interface ActionResult { paneId?: string; warning?: string }

const AGENT_START_MS = 30_000;
const WORKTREE_MS = 60_000;

function field(body: Record<string, unknown>, name: string, optional: true): string | undefined;
function field(body: Record<string, unknown>, name: string, optional?: false): string;
function field(body: Record<string, unknown>, name: string, optional = false) {
  const value = body[name];
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  const trimmed = value.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed)) throw new Error(`Invalid ${name}`);
  return trimmed;
}
function id(body: Record<string, unknown>, name: string) {
  const value = field(body, name);
  if (!/^[A-Za-z0-9:_.-]{1,128}$/.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function label(body: Record<string, unknown>) {
  const value = field(body, 'label', true);
  if (value !== undefined && value.length > 64) throw new Error('Name is too long');
  return value;
}
// git check-ref-format, conservatively: no option-like, traversal, reflog or lock names.
export function validRef(value: string) {
  return /^[A-Za-z0-9._/-]{1,200}$/.test(value) && !value.startsWith('-') && !value.startsWith('/')
    && !value.endsWith('/') && !value.endsWith('.') && !value.endsWith('.lock')
    && !value.includes('..') && !value.includes('//') && !value.split('/').some(part => part.startsWith('.'));
}
function ref(body: Record<string, unknown>, name: string, optional = false) {
  const value = optional ? field(body, name, true) : field(body, name);
  if (value !== undefined && !validRef(value)) throw new Error(`Invalid ${name === 'base' ? 'base' : 'branch'} name`);
  return value;
}
export function hostPath(value: string, home = homedir()) {
  if (value.length > 1024) throw new Error('Path is too long');
  const expanded = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('Use an absolute path or ~/…');
  return expanded;
}

export function parseAction(input: unknown, home = homedir()): Action {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid action');
  const body = input as Record<string, unknown>;
  switch (body.type) {
    case 'terminal': return { type: 'terminal', workspaceId: id(body, 'workspaceId') };
    case 'agent': {
      const kind = field(body, 'kind');
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw new Error('Invalid agent');
      return { type: 'agent', workspaceId: id(body, 'workspaceId'), kind };
    }
    case 'workspace': {
      const name = label(body);
      return { type: 'workspace', cwd: hostPath(field(body, 'cwd'), home), ...(name ? { label: name } : {}) };
    }
    case 'worktree-create': {
      const base = ref(body, 'base', true);
      return { type: 'worktree-create', workspaceId: id(body, 'workspaceId'), branch: ref(body, 'branch')!, ...(base ? { base } : {}) };
    }
    case 'worktree-open': return { type: 'worktree-open', workspaceId: id(body, 'workspaceId'), path: hostPath(field(body, 'path'), home) };
    case 'close-pane': return { type: 'close-pane', paneId: id(body, 'paneId') };
    case 'remove-worktree': return { type: 'remove-worktree', workspaceId: id(body, 'workspaceId') };
    case 'rename-pane': {
      const name = label(body);
      return { type: 'rename-pane', paneId: id(body, 'paneId'), ...(name ? { label: name } : {}) };
    }
    case 'rename-workspace': {
      const name = label(body);
      if (!name) throw new Error('Name is required');
      return { type: 'rename-workspace', workspaceId: id(body, 'workspaceId'), label: name };
    }
    default: throw new Error('Unknown action');
  }
}

async function workspace(workspaceId: string) {
  const found = (await snapshot()).workspaces.find(item => item.workspace_id === workspaceId);
  if (!found) throw new Error('Workspace no longer exists');
  return found;
}
const rootPane = (result: { root_pane?: { pane_id?: string } }) => result.root_pane?.pane_id;

// Herdr/git messages suggest CLI flags the phone deliberately cannot send.
const friendly: Record<string, string> = {
  dirty_worktree_requires_force: 'This worktree has uncommitted or untracked files. Commit or clean them on your PC first.',
  not_git_worktree: 'This workspace is not in a Git repository.',
};
export async function runAction(action: Action): Promise<ActionResult> {
  try { return await perform(action); }
  catch (error) {
    if (error instanceof HerdrError && friendly[error.code]) throw new Error(friendly[error.code]);
    throw error;
  }
}
async function perform(action: Action): Promise<ActionResult> {
  switch (action.type) {
    case 'terminal':
      return { paneId: rootPane(await rpc('tab.create', { workspace_id: action.workspaceId, focus: false })) };
    case 'agent': {
      const paneId = rootPane(await rpc('tab.create', { workspace_id: action.workspaceId, focus: false }));
      if (!paneId) throw new Error('Herdr did not return the new pane');
      try {
        await rpc('agent.start', { pane_id: paneId, kind: action.kind, name: action.kind, timeout_ms: AGENT_START_MS }, AGENT_START_MS + 5000);
        return { paneId };
      } catch (error) {
        // Keep the new shell rather than closing a pane that may hold a half-started agent.
        return { paneId, warning: `${action.kind} did not start: ${(error as Error).message}` };
      }
    }
    case 'workspace':
      return { paneId: rootPane(await rpc('workspace.create', { cwd: action.cwd, label: action.label ?? null, focus: false })) };
    case 'worktree-create':
      return { paneId: rootPane(await rpc('worktree.create', {
        workspace_id: action.workspaceId, branch: action.branch, base: action.base ?? null, focus: false,
      }, WORKTREE_MS)) };
    case 'worktree-open':
      return { paneId: rootPane(await rpc('worktree.open', { workspace_id: action.workspaceId, path: action.path, focus: false }, WORKTREE_MS)) };
    case 'close-pane':
      if (!(await snapshot()).panes.some(pane => pane.pane_id === action.paneId)) throw new Error('Pane no longer exists');
      await rpc('pane.close', { pane_id: action.paneId });
      return {};
    case 'remove-worktree':
      if (!(await workspace(action.workspaceId)).worktree?.is_linked_worktree) throw new Error('Only linked worktrees can be removed');
      await rpc('worktree.remove', { workspace_id: action.workspaceId, force: false }, WORKTREE_MS);
      return {};
    case 'rename-pane': // An empty name clears the label, so Herdr falls back to the terminal title.
      await rpc('pane.rename', { pane_id: action.paneId, label: action.label ?? null });
      return {};
    case 'rename-workspace':
      await workspace(action.workspaceId);
      await rpc('workspace.rename', { workspace_id: action.workspaceId, label: action.label });
      return {};
  }
}

// Herdr names each kind after its canonical executable. Offer the ones installed on this PC;
// if none are found on the service PATH, offer all rather than hide a working agent.
export async function agentKinds(installed = (kind: string) => Boolean(Bun.which(kind, { PATH: searchPath() }))): Promise<string[]> {
  const result = await rpc<{ manifests?: { agent?: string }[] }>('server.agent_manifests');
  const kinds = [...new Set((result.manifests || []).map(item => item.agent).filter((kind): kind is string => Boolean(kind)))];
  const found = kinds.filter(installed);
  return found.length ? found : kinds;
}
function searchPath() {
  const home = homedir();
  return [process.env.PATH, join(home, '.local', 'bin'), join(home, '.bun', 'bin')].filter(Boolean).join(':');
}
export interface WorktreeChoice { path: string; label: string; branch?: string; openPaneId?: string }
export async function worktrees(workspaceId: string): Promise<WorktreeChoice[]> {
  const [state, result] = await Promise.all([snapshot(), rpc('worktree.list', { workspace_id: workspaceId }, WORKTREE_MS)]);
  return (result.worktrees as { path: string; label: string; branch?: string | null; is_bare: boolean; is_prunable: boolean;
    is_linked_worktree: boolean; open_workspace_id?: string | null }[])
    .filter(item => item.is_linked_worktree && !item.is_bare && !item.is_prunable)
    .map(item => ({
      path: item.path, label: item.label, ...(item.branch ? { branch: item.branch } : {}),
      ...(item.open_workspace_id ? { openPaneId: state.panes.find(pane => pane.workspace_id === item.open_workspace_id)?.pane_id } : {}),
    }));
}
