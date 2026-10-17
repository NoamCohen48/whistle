import { useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Actions.tsx';
import { Icon } from './Icon.tsx';
import type { PictureRequest } from './PictureViewer.tsx';

// The terminal's text as plain, selectable text: xterm's canvas is hard to select on a phone.
// A copy taken when the sheet opens; reading it never sends anything to the terminal.
const PICTURE = /[^\s'"`()<>[\]]+\.(?:png|jpe?g|webp|gif)(?=$|[\s'"`)\],:;]|\.(?:\s|$))/gi;

function linkPictures(line: string, onPicture: (path: string) => void) {
  const parts: (string | { path: string })[] = [];
  let last = 0;
  for (const match of line.matchAll(PICTURE)) {
    if (match[0].includes('://') || match[0].startsWith('~')) continue; // URLs and ~ are not PC paths here.
    parts.push(line.slice(last, match.index), { path: match[0] });
    last = match.index + match[0].length;
  }
  parts.push(line.slice(last));
  return parts.map((part, index) => typeof part === 'string' ? part
    : <button type="button" key={index} className="path-link" onClick={() => onPicture(part.path)}>{part.path}</button>);
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Not a secure context or blocked: fall back. */ }
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  area.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.append(area); area.select();
  try { if (!document.execCommand('copy')) throw new Error(); }
  finally { area.remove(); }
}

export function TerminalTextSheet({ text, paneId, onClose, onPicture }: {
  text?: string; paneId?: string; onClose: () => void; onPicture: (picture: PictureRequest) => void;
}) {
  const body = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState('');
  // Newest output first in view, like the terminal itself.
  useLayoutEffect(() => {
    setStatus('');
    if (text !== undefined && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text]);
  const selected = () => {
    const selection = getSelection();
    return selection && body.current?.contains(selection.anchorNode) ? selection.toString() : '';
  };
  return <Sheet id="terminal-text-sheet" open={text !== undefined} title="Terminal text" onClose={onClose}>
    {text ? <pre id="terminal-text" ref={body}>{text.split('\n').map((line, index) =>
      <span key={index}>{paneId ? linkPictures(line, path => onPicture({ paneId, path })) : line}{'\n'}</span>)}</pre>
      : <p className="sheet-status">Nothing on screen yet</p>}
    <div className="text-actions">
      <p className="sheet-status" role="status">{status || 'Select text, or copy it all'}</p>
      <button type="button" id="copy-text" className="primary" disabled={!text} onPointerDown={event => event.preventDefault()} onClick={() => {
        const part = selected();
        void copy(part || text || '').then(() => setStatus(part ? 'Copied selection' : 'Copied'), () => setStatus('Copy is blocked here; select the text instead'));
      }}><Icon name="copy" size={18} />Copy</button>
    </div>
  </Sheet>;
}
