import { expect, test } from 'bun:test';
import type { Workspace } from '../src/herdr.ts';
import { groupWorkspaces } from '../src/workspaces.ts';

const main: Workspace = { workspace_id: 'main', label: 'tap', worktree: { repo_key: 'tap/.git', is_linked_worktree: false } };
const child: Workspace = { workspace_id: 'child', label: 'app-explorer', worktree: { repo_key: 'tap/.git', is_linked_worktree: true } };

test('nests app-explorer under tap using repository provenance, not order', () => {
  const groups = groupWorkspaces([child, main]);
  expect(groups).toEqual([{ workspace: main, children: [child] }]);
});
test('preserves orphan worktrees and does not group unrelated repositories', () => {
  const other: Workspace = { workspace_id: 'other', label: 'tap', worktree: { repo_key: 'another/.git', is_linked_worktree: false } };
  expect(groupWorkspaces([other, child])).toEqual([{ workspace: other, children: [] }, { workspace: child, children: [] }]);
});
test('preserves parent and child ordering, never duplicates worktrees', () => {
  const plain: Workspace = { workspace_id: 'plain' };
  const second = { ...child, workspace_id: 'second' };
  expect(groupWorkspaces([plain, main, child, second])).toEqual([
    { workspace: plain, children: [] }, { workspace: main, children: [child, second] },
  ]);
});
