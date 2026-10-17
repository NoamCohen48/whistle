import { useEffect, useState } from 'react';
import type { Pane } from '../../src/herdr.ts';
import { loadChanges, loadFileDiff, type Changes, type FileDiff } from '../api.ts';
import { Sheet } from './Actions.tsx';
import { Icon } from './Icon.tsx';

// Read-only: what the pane's working tree changed since the last commit, to decide what to tell
// the agent next. Nothing here stages, commits or reverts.
type FileChange = Changes['files'][number];
const statusNames: Record<FileChange['status'], [string, string]> = {
  modified: ['M', 'Modified'], added: ['A', 'Added'], deleted: ['D', 'Deleted'], renamed: ['R', 'Renamed'], untracked: ['U', 'New, not added'],
};

function DiffLines({ diff }: { diff: FileDiff | string | undefined }) {
  if (diff === undefined) return <p className="sheet-status" role="status">Loading…</p>;
  if (typeof diff === 'string') return <p className="sheet-error" role="alert">{diff}</p>;
  if (diff.binary) return <p className="sheet-status">Binary file, not shown</p>;
  if (!diff.diff) return <p className="sheet-status">Only the file mode changed</p>;
  return <>
    <pre className="diff">{diff.diff.replace(/\n$/, '').split('\n').map((line, index) =>
      <span key={index} data-line={line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line[0] === '\\' ? 'note' : undefined}>{line}{'\n'}</span>)}</pre>
    {diff.truncated ? <p className="sheet-status">Shortened: the rest of this file is not shown</p> : null}
  </>;
}

export function ChangesSheet({ pane, open, onClose }: { pane?: Pane; open: boolean; onClose: () => void }) {
  const [changes, setChanges] = useState<Changes>();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const [diffs, setDiffs] = useState<Record<string, FileDiff | string>>({});
  const [generation, setGeneration] = useState(0);
  const paneId = pane?.pane_id;
  useEffect(() => {
    if (!open || !paneId) return;
    let current = true;
    setChanges(undefined); setError(''); setExpanded(undefined); setDiffs({});
    loadChanges(paneId).then(value => { if (current) setChanges(value); }, cause => { if (current) setError((cause as Error).message); });
    return () => { current = false; };
  }, [open, paneId, generation]);
  const toggle = (file: FileChange) => {
    if (expanded === file.path) { setExpanded(undefined); return; }
    setExpanded(file.path);
    if (!paneId || diffs[file.path] !== undefined) return;
    loadFileDiff(paneId, file.path).then(
      diff => setDiffs(previous => ({ ...previous, [file.path]: diff })),
      cause => setDiffs(previous => ({ ...previous, [file.path]: (cause as Error).message })));
  };
  const added = changes?.files.reduce((sum, file) => sum + file.added, 0) ?? 0;
  const removed = changes?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0;
  return <Sheet id="changes" open={open} title="Changes" onClose={onClose}>
    <div className="changes-summary">
      <p role="status">{error ? 'Could not load changes' : !changes ? 'Loading changes…' : <>
        {changes.branch ? <><Icon name="branch" size={16} /><strong>{changes.branch}</strong></> : null}
        <span>{changes.files.length} {changes.files.length === 1 ? 'file' : 'files'}</span>
        {changes.files.length ? <span className="counts"><ins>+{added}</ins> <del>−{removed}</del></span> : null}
      </>}</p>
      <button type="button" id="changes-refresh" className="icon-button" aria-label="Refresh changes"
        onClick={() => setGeneration(value => value + 1)}><Icon name="refresh" size={18} /></button>
    </div>
    {error ? <p className="sheet-error" role="alert">{error}</p> : null}
    {changes && !changes.files.length ? <p className="empty-changes">No changes since the last commit.</p> : null}
    {changes?.files.length ? <ul className="change-list">
      {changes.files.map(file => {
        const [letter, name] = statusNames[file.status];
        const slash = file.path.lastIndexOf('/');
        return <li key={file.path}>
          <button type="button" className="change-file" aria-expanded={expanded === file.path} onClick={() => toggle(file)}>
            <abbr className="change-status" data-status={file.status} title={name} aria-label={name}>{letter}</abbr>
            <span className="change-path">
              {file.from ? <small>{file.from} →</small> : null}
              <span><span className="dir">{file.path.slice(0, slash + 1)}</span><strong>{file.path.slice(slash + 1)}</strong></span>
            </span>
            <span className="counts">{file.binary ? 'binary' : <>{file.added ? <ins>+{file.added}</ins> : null} {file.removed ? <del>−{file.removed}</del> : null}</>}</span>
          </button>
          {expanded === file.path ? <DiffLines diff={diffs[file.path]} /> : null}
        </li>;
      })}
    </ul> : null}
    {changes?.truncated ? <p className="sheet-status">Showing the first {changes.files.length} files</p> : null}
  </Sheet>;
}
