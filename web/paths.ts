// File paths an agent prints, like src/app.ts:42 or ./docs/notes.md, and web addresses, found in terminal text so
// they can be opened. Only the text is read; nothing an agent prints is run or sent anywhere.
const PATH = /(?<![\w/.~:@-])((?:\.{0,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.([A-Za-z][A-Za-z0-9]{0,9}))(?::(\d{1,7})(?::\d{1,7})?)?(?=$|[\s'"`)\],;]|[.:,](?:\s|$))/g;
// Without a slash, a word like "Node.js" or "example.com" is more likely than a file: only
// these extensions count on their own.
const KNOWN = new Set(('ts tsx js jsx mjs cjs json jsonc md mdx txt log py rs go java kt c h cc cpp hpp cs rb php sh bash zsh fish toml yaml yml '
  + 'css scss html vue svelte sql lua swift zig nix ex exs png jpg jpeg webp gif lock conf ini xml csv').split(' '));

export interface PathMatch { start: number; end: number; path: string; line?: number }

export function findPaths(text: string): PathMatch[] {
  const found: PathMatch[] = [];
  for (const match of text.matchAll(PATH)) {
    const [whole, path, extension, line] = match;
    if (!path.includes('/') && !KNOWN.has(extension.toLowerCase())) continue;
    found.push({ start: match.index, end: match.index + whole.length, path, ...(line ? { line: Number(line) } : {}) });
  }
  return found;
}

// Web addresses printed as text. Closing punctuation that ends a sentence or wraps the link,
// like "(see https://example.com/a)." is not part of it.
const URL_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/g;

export interface UrlMatch { start: number; end: number; url: string }

export function findUrls(text: string): UrlMatch[] {
  const found: UrlMatch[] = [];
  for (const match of text.matchAll(URL_TEXT)) {
    let url = match[0];
    for (;;) {
      const last = url.at(-1)!;
      const open = { ')': '(', ']': '[', '}': '{' }[last];
      if (/[.,;:!?'"]/.test(last) || (open && url.split(open).length <= url.split(last).length - 1)) url = url.slice(0, -1);
      else break;
    }
    if (webUrl(url)) found.push({ start: match.index, end: match.index + url.length, url });
  }
  return found;
}

// Only http and https addresses are opened; anything else a program prints stays text.
export function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch { return undefined; }
}

export function openUrl(value: string) {
  const url = webUrl(value);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(url);
}

export type LinkMatch = (PathMatch & { kind: 'path' }) | (UrlMatch & { kind: 'url' });

// Paths and web addresses in one line of terminal text, in order.
export const findLinks = (text: string): LinkMatch[] => [
  ...findPaths(text).map(match => ({ ...match, kind: 'path' as const })),
  ...findUrls(text).map(match => ({ ...match, kind: 'url' as const })),
].sort((a, b) => a.start - b.start);
