import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { errorMessage, request } from '../request.ts';

// Shows a text file from the pane's project on the PC, read-only, opened at the line the agent
// named. The PC refuses anything outside the project or not text.
export interface FileRequest { paneId: string; path: string; line?: number }

export function FileViewer({ file, onClose }: { file?: FileRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLPreElement>(null);
  const [text, setText] = useState<string>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (file && !element.open) element.showModal();
    if (!file && element.open) element.close();
  }, [file]);
  useEffect(() => {
    setText(undefined); setError('');
    if (!file) return;
    let current = true;
    request(`/api/file?pane=${encodeURIComponent(file.paneId)}&path=${encodeURIComponent(file.path)}`)
      .then(response => response.text()).then(value => { if (current) setText(value); }, cause => { if (current) setError(errorMessage(cause)); });
    return () => { current = false; };
  }, [file, revision]);
  useLayoutEffect(() => {
    if (text === undefined || !body.current) return;
    const target = file?.line ? body.current.querySelector<HTMLElement>(`[data-line="${file.line}"]`) : undefined;
    if (target) target.scrollIntoView({ block: 'center' }); else body.current.scrollTop = 0;
  }, [text, file]);
  const name = file?.path.split('/').pop() || '';
  const lines = text?.replace(/\n$/, '').split('\n');
  return <dialog id="file-viewer" ref={dialog} aria-label={name || 'File'} onClose={onClose}>
    <div className="viewer-head">
      <strong title={file?.path}>{name}{file?.line ? <span className="viewer-line">:{file.line}</span> : null}</strong>
      <button type="button" className="icon-button" aria-label="Close" autoFocus onClick={onClose}><Icon name="close" /></button>
    </div>
    <p className="viewer-path">{file?.path}</p>
    {error ? <div className="picture-error"><p className="sheet-error" role="alert">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry file</button></div>
      : lines ? <pre id="file-body" ref={body} tabIndex={0} aria-label={`Contents of ${name}`}>{lines.map((line, index) =>
        <span key={index} data-line={index + 1} data-current={file?.line === index + 1 || undefined}>{line}{'\n'}</span>)}</pre>
      : file ? <p className="sheet-status" role="status">Loading…</p> : null}
  </dialog>;
}
