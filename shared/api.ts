// The JSON shapes the host's HTTP API sends to and accepts from the phone app.

// Herdr's own snapshot, passed through as Herdr reports it.
export interface Pane {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  label?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  terminal_title_stripped?: string;
  scroll?: { viewport_rows: number };
  // Added by Whistle: when the host saw this status start, by the host's clock. Missing when the
  // status was already there when the host first looked.
  status_since?: number;
}
export interface Workspace {
  workspace_id: string;
  label?: string;
  name?: string;
  worktree?: {
    repo_key: string;
    repo_name?: string;
    repo_root?: string;
    checkout_path?: string;
    is_linked_worktree: boolean;
  };
}
export interface Snapshot {
  panes: Pane[];
  workspaces: Workspace[];
  tabs: { tab_id: string; label?: string }[];
  // Added by Whistle: the host's clock when it answered, so the phone can turn status_since into an age.
  now?: number;
}

// Herdr lifecycle actions the phone can ask for.
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
// Actions that open something return its pane; a warning means it opened but did not fully start.
export interface ActionResult { paneId?: string; warning?: string }
export interface WorktreeChoice { path: string; label: string; branch?: string; openPaneId?: string }

// A pane's Git changes since the last commit.
export interface FileChange {
  path: string; from?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  added: number; removed: number; binary: boolean;
}
export interface Changes { root: string; branch?: string; files: FileChange[]; truncated: boolean }
export interface FileDiff { diff: string; binary: boolean; truncated: boolean }

// Folders on the PC, for picking a new workspace's folder.
export interface FolderEntry { name: string; repo: boolean }
export interface FolderList { path: string; folders: FolderEntry[]; truncated: boolean }

// Per device. Quiet hours deliver alerts without sound or vibration, in the phone's own time zone.
export interface AlertSettings { finished: boolean; quiet?: { start: string; end: string; timeZone: string } }

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}
