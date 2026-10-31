// When this browser last had each pane open, to tell a finished agent nobody here has looked at
// yet ("unseen") from one already read. Per browser; blocked storage just means all are unseen.
const KEY = 'whistle:seen-panes';
export type Seen = Record<string, number>;

export function readSeen(): Seen {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, time]) => typeof time === 'number' && Number.isFinite(time)));
  } catch { return {}; }
}
export function markSeen(seen: Seen, paneId: string, now = Date.now()): Seen {
  // The newest 200 panes are plenty; closed panes fall off the end.
  const next = Object.fromEntries([[paneId, now] as const, ...Object.entries(seen).filter(([id]) => id !== paneId)]
    .sort((a, b) => b[1] - a[1]).slice(0, 200));
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Not remembered. */ }
  return next;
}

// "4m", "2h", "3d": how long a status has held, short enough for a row.
export function age(since: number, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
