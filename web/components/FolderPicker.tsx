import { useEffect, useState } from 'react';
import { loadFolders, type FolderList } from '../api.ts';
import { Icon } from './Icon.tsx';

// Browses folders on the PC while a path is typed: the part up to the last slash is the folder
// being listed, the rest narrows its list. Tapping a folder goes into it.
export function splitPath(value: string) {
  const slash = value.lastIndexOf('/');
  if (slash < 0) return { dir: '~/', filter: value === '~' ? '' : value };
  return { dir: value.slice(0, slash + 1), filter: value.slice(slash + 1) };
}

// '~/Work/' → ~ › Work; '/srv/app/' → / › srv › app. Each step's path ends with a slash.
export function crumbs(dir: string) {
  const absolute = dir.startsWith('/');
  const steps = absolute ? [{ label: '/', path: '/' }] : [];
  let path = absolute ? '/' : '';
  for (const part of dir.split('/').filter(Boolean)) { path += `${part}/`; steps.push({ label: part, path }); }
  return steps;
}

// The value to create a workspace from: no trailing slash, except for the roots themselves.
export const folderValue = (value: string) => value.trim().replace(/(.)\/+$/, '$1').replace(/^~\/$/, '~');

export function FolderPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const { dir, filter } = splitPath(value);
  const [listing, setListing] = useState<{ dir: string; list?: FolderList; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    // Typing a long path should list only where it stops.
    const timer = setTimeout(() => loadFolders(dir, controller.signal).then(
      list => setListing({ dir, list }),
      cause => { if (!controller.signal.aborted) setListing({ dir, error: (cause as Error).message }); }), 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [dir]);
  const current = listing?.dir === dir ? listing : undefined;
  const needle = filter.toLowerCase();
  const folders = (current?.list?.folders || []).filter(folder => folder.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)));
  return <div className="folder-browser" aria-busy={!current}>
    <nav className="crumbs" aria-label="Folder path">
      {crumbs(dir).map((step, index, all) => <button type="button" key={step.path} disabled={disabled}
        aria-current={index === all.length - 1 && !filter ? 'location' : undefined} onClick={() => onChange(step.path)}>{step.label}</button>)}
    </nav>
    {!current ? <p className="sheet-status" role="status">Loading folders…</p>
      : current.error ? <p className="sheet-status folder-error" role="status">{current.error}</p>
        : !folders.length ? <p className="sheet-status" role="status">{filter
          ? `No folder named “${filter}” here` : 'No folders inside'}</p>
          : <ul className="folder-list" aria-label="Folders">
            {folders.map(folder => <li key={folder.name}>
              <button type="button" className="folder-row" data-folder={folder.name} disabled={disabled}
                onClick={() => onChange(`${dir}${folder.name}/`)}>
                <Icon name={folder.repo ? 'branch' : 'folder'} size={18} />
                <span>{folder.name}</span>
                {folder.repo ? <small>Git</small> : null}
                <Icon name="forward" size={16} />
              </button></li>)}
          </ul>}
    {current?.list?.truncated ? <p className="sheet-status">Showing the first {current.list.folders.length}; type to narrow</p> : null}
  </div>;
}
