import type { Action, ActionResult, Changes, FileDiff, FolderList, Snapshot, WorktreeChoice } from '../shared/api.ts';
import { PairingRequired, request } from './request.ts';
export { PairingRequired, errorMessage } from './request.ts';

export type { Action, Changes, FileDiff, FolderList, WorktreeChoice };

export async function loadPanes(signal?: AbortSignal): Promise<Snapshot> {
  const response = await request('/api/panes', { signal });
  return toLocalClock(await json<Snapshot>(response));
}
// The host dates status changes by its own clock; the phone's may differ, so each start time
// is moved to this phone's clock using how long ago it was when the host answered.
export function toLocalClock(state: Snapshot, now = Date.now()): Snapshot {
  if (typeof state.now !== 'number') return state;
  const hostNow = state.now;
  return { ...state, panes: state.panes.map(pane => typeof pane.status_since === 'number'
    ? { ...pane, status_since: now - Math.max(0, hostNow - pane.status_since) } : pane) };
}
export async function pairBrowser(path: '/api/login' | '/api/redeem-pairing', credential: Record<string, string>) {
  await request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credential),
  }, false);
}
export interface Startup { snapshot?: Snapshot; error: string; needsPairing?: boolean }
// Called once before React mounts: Strict Mode must not redeem a single-use ticket twice.
export async function prepareSession(ticket: string | null): Promise<Startup> {
  let error = '';
  if (ticket) {
    try { await pairBrowser('/api/redeem-pairing', { ticket }); }
    catch (cause) { error = (cause as Error).message; }
  }
  // A used or expired QR on a browser that is still paired changes nothing: open normally, no error.
  try { return { snapshot: await loadPanes(), error: '' }; }
  catch (cause) { return { error: error || (cause instanceof PairingRequired ? '' : (cause as Error).message), needsPairing: cause instanceof PairingRequired }; }
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new PairingRequired();
  if (!response.ok) throw new Error(await response.text());
  try { return await response.json(); }
  catch { throw new Error('The PC returned an incomplete response. Refresh and check the result before trying again.'); }
}
// A request ID makes a launch safe to repeat: the PC answers a repeat with the first result.
export async function runAction(action: Action, requestId?: string): Promise<ActionResult> {
  return json(await request('/api/actions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestId ? { ...action, requestId } : action),
  }));
}
// randomUUID needs HTTPS; Whistle also runs over plain HTTP on a private network.
export const newRequestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
export async function loadPreviews(signal?: AbortSignal): Promise<Record<string, string>> {
  return json(await request('/api/previews', { signal, cache: 'no-store' }));
}
export async function loadAgentKinds(): Promise<string[]> {
  return (await json<{ kinds: string[] }>(await request('/api/agents', { cache: 'no-store' }))).kinds;
}
export async function loadWorktrees(workspaceId: string): Promise<WorktreeChoice[]> {
  return (await json<{ worktrees: WorktreeChoice[] }>(
    await request(`/api/worktrees?workspace=${encodeURIComponent(workspaceId)}`, { cache: 'no-store' }))).worktrees;
}
export async function loadFolders(path: string, signal?: AbortSignal): Promise<FolderList> {
  return json(await request(`/api/folders?path=${encodeURIComponent(path)}`, { cache: 'no-store', signal }));
}
export async function loadChanges(paneId: string): Promise<Changes> {
  return json(await request(`/api/changes?pane=${encodeURIComponent(paneId)}`, { cache: 'no-store' }));
}
export async function loadFileDiff(paneId: string, path: string): Promise<FileDiff> {
  return json(await request(`/api/changes/file?pane=${encodeURIComponent(paneId)}&path=${encodeURIComponent(path)}`, { cache: 'no-store' }));
}
