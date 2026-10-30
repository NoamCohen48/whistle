import type { Workspace } from '../shared/api.ts';

export function groupWorkspaces(workspaces: Workspace[]) {
  const children = new Map<string, Workspace[]>();
  const nested = new Set<string>();
  for (const workspace of workspaces) {
    const worktree = workspace.worktree;
    if (!worktree?.is_linked_worktree || !worktree.repo_key) continue;
    const parent = workspaces.find(candidate => candidate.workspace_id !== workspace.workspace_id
      && candidate.worktree?.is_linked_worktree === false
      && candidate.worktree.repo_key === worktree.repo_key);
    if (!parent) continue; // Keep orphan worktrees visible; never infer parenthood from names.
    const siblings = children.get(parent.workspace_id) || [];
    siblings.push(workspace); children.set(parent.workspace_id, siblings);
    nested.add(workspace.workspace_id);
  }
  return workspaces.filter(w => !nested.has(w.workspace_id)).map(workspace => ({
    workspace, children: children.get(workspace.workspace_id) || [],
  }));
}
