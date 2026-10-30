const PREFIX = 'whistle-draft:';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const HISTORY_PREFIX = 'whistle-prompts:';
const failed = new Set<string>();
const pending = new Map<string, { text: string; savedAt: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function readDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {};
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(HISTORY_PREFIX)) { readPrompts(key.slice(HISTORY_PREFIX.length)); continue; }
      if (!key.startsWith(PREFIX)) continue;
      try {
        const item = JSON.parse(localStorage.getItem(key) || 'null');
        if (!item || typeof item.text !== 'string' || !item.text || typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt) || Date.now() - item.savedAt > MAX_AGE) {
          localStorage.removeItem(key); continue;
        }
        drafts[key.slice(PREFIX.length)] = item.text;
      } catch { localStorage.removeItem(key); }
    }
  } catch { /* Storage may be unavailable. Drafts still work in memory. */ }
  return drafts;
}

export function flushDrafts() {
  clearTimeout(timer); timer = undefined;
  for (const [pane, item] of pending) {
    try {
      if (item.text) localStorage.setItem(PREFIX + pane, JSON.stringify(item));
      else localStorage.removeItem(PREFIX + pane);
      failed.delete(pane);
    } catch { failed.add(pane); }
  }
  pending.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('whistle-drafts-saved'));
}

export function draftStatus(pane: string, text: string) {
  if (failed.has(pane)) return 'Kept in this page only; browser storage is unavailable';
  return '';
}

function promptEntries(pane: string): { text: string; savedAt: number }[] {
  try {
    const key = HISTORY_PREFIX + pane;
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    const items = Array.isArray(stored) ? stored.filter(item => typeof item?.text === 'string' && typeof item.savedAt === 'number' && Number.isFinite(item.savedAt) && Date.now() - item.savedAt <= MAX_AGE).slice(0, 10) : [];
    if (!items.length) localStorage.removeItem(key);
    else if (items.length !== stored.length) localStorage.setItem(key, JSON.stringify(items));
    return items;
  } catch { return []; }
}
export function readPrompts(pane: string): string[] { return promptEntries(pane).map(item => item.text); }
export function rememberPrompt(pane: string, text: string) {
  const items = [{ text, savedAt: Date.now() }, ...promptEntries(pane).filter(item => item.text !== text)].slice(0, 10);
  try { localStorage.setItem(HISTORY_PREFIX + pane, JSON.stringify(items)); } catch { /* Optional history. */ }
  return items.map(item => item.text);
}
export function clearPrompts(pane: string) { try { localStorage.removeItem(HISTORY_PREFIX + pane); } catch { /* Storage blocked. */ } }

export function saveDraft(pane: string, text: string) {
  pending.set(pane, { text, savedAt: Date.now() });
  if (!text) { // Clearing must not leave a stale draft behind on a quick reload.
    try { localStorage.removeItem(PREFIX + pane); } catch { /* Storage blocked. */ }
  }
  timer ??= setTimeout(flushDrafts, 300);
}

export function clearDrafts() {
  clearTimeout(timer); timer = undefined; pending.clear(); failed.clear();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX) || key.startsWith(HISTORY_PREFIX)) localStorage.removeItem(key);
  } catch { /* Storage blocked. */ }
}
