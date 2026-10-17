const PREFIX = 'whistle-draft:';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const pending = new Map<string, { text: string; savedAt: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function readDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {};
  try {
    for (const key of Object.keys(localStorage)) {
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
    } catch { /* Quota or privacy settings. */ }
  }
  pending.clear();
}

export function saveDraft(pane: string, text: string) {
  pending.set(pane, { text, savedAt: Date.now() });
  if (!text) { // Clearing must not leave a stale draft behind on a quick reload.
    try { localStorage.removeItem(PREFIX + pane); } catch { /* Storage blocked. */ }
  }
  timer ??= setTimeout(flushDrafts, 300);
}

export function clearDrafts() {
  clearTimeout(timer); timer = undefined; pending.clear();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch { /* Storage blocked. */ }
}
