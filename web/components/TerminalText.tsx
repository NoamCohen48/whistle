import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Actions.tsx';
import { Icon } from './Icon.tsx';
import type { FileRequest } from './FileViewer.tsx';
import { findLinks } from '../paths.ts';

// The terminal's text as plain, selectable text: xterm's canvas is hard to select on a phone.
// A copy taken when the sheet opens; reading it never sends anything to the terminal.

function markMatches(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase(), needle = query.toLowerCase();
  const parts = []; let start = 0, index: number;
  while ((index = lower.indexOf(needle, start)) !== -1) {
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + query.length)}</mark>);
    start = index + query.length;
  }
  parts.push(text.slice(start)); return parts;
}

function linkLine(line: string, onPath: (path: string, line?: number) => void, query = '') {
  const parts: (string | ReturnType<typeof findLinks>[number])[] = [];
  let last = 0;
  for (const match of findLinks(line)) {
    parts.push(line.slice(last, match.start), match);
    last = match.end;
  }
  parts.push(line.slice(last));
  return parts.map((part, index) => typeof part === 'string' ? markMatches(part, query)
    : part.kind === 'url' ? <a key={index} className="path-link" href={part.url} target="_blank" rel="noopener noreferrer">{markMatches(line.slice(part.start, part.end), query)}</a>
    : <button type="button" key={index} className="path-link" onClick={() => onPath(part.path, part.line)}>{markMatches(line.slice(part.start, part.end), query)}</button>);
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Not a secure context or blocked: fall back. */ }
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  area.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.append(area); area.select();
  try { if (!document.execCommand('copy')) throw new Error(); }
  finally { area.remove(); }
}

export function TerminalTextSheet({ text, paneId, onClose, onPath }: {
  text?: string; paneId?: string; onClose: () => void; onPath: (file: FileRequest) => void;
}) {
  const body = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const matches = query && text ? text.toLowerCase().split(query.toLowerCase()).length - 1 : 0;
  useEffect(() => { setQuery(''); setActiveMatch(0); }, [text]);
  useLayoutEffect(() => {
    const marks = body.current?.querySelectorAll('mark');
    marks?.forEach((mark, index) => mark.toggleAttribute('data-current', index === activeMatch));
    marks?.[activeMatch]?.scrollIntoView({ block: 'nearest' });
  }, [query, activeMatch, text]);
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
    <div className="text-search" role="search"><label className="sr-only" htmlFor="terminal-search">Find in terminal text</label>
      <input id="terminal-search" type="search" placeholder="Find in terminal text…" autoComplete="off" spellCheck={false} value={query} maxLength={200}
        onChange={event => { setQuery(event.target.value); setActiveMatch(0); }} onKeyDown={event => {
          if (event.key === 'Enter' && matches) { event.preventDefault(); setActiveMatch(index => (index + (event.shiftKey ? matches - 1 : 1)) % matches); }
        }} />
      <button type="button" aria-label="Previous match" disabled={!matches} onClick={() => setActiveMatch(index => (index + matches - 1) % matches)}>↑</button>
      <button type="button" aria-label="Next match" disabled={!matches} onClick={() => setActiveMatch(index => (index + 1) % matches)}>↓</button></div>
    <p className="sheet-status" aria-live="polite">{query ? matches ? `${activeMatch + 1} of ${matches} matches` : 'No matches' : ''}</p>
    {text ? <pre id="terminal-text-body" ref={body}>{text.split('\n').map((line, index) =>
      <span key={index}>{paneId ? linkLine(line, (path, line) => onPath({ paneId, path, line }), query) : markMatches(line, query)}{'\n'}</span>)}</pre>
      : <p className="sheet-status">Nothing on screen yet</p>}
    <div className="text-actions">
      <p className="sheet-status" role="status">{status}</p>
      <button type="button" id="copy-text" className="primary" disabled={!text} onPointerDown={event => event.preventDefault()} onClick={() => {
        const part = selected();
        void copy(part || text || '').then(() => setStatus(part ? 'Copied selection' : 'Copied'), () => setStatus('Copy is blocked here; select the text instead'));
      }}><Icon name="copy" size={18} />Copy</button>
    </div>
  </Sheet>;
}
