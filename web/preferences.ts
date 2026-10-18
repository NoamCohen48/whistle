// Non-sensitive, per-browser display preferences. Storage denial must not break the UI.
export function readPreference<T extends string[] | number | boolean>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`whistle:${key}`) || 'null');
    if (Array.isArray(fallback)) return (Array.isArray(value) && value.every(item => typeof item === 'string') ? value.slice(0, 100) : fallback) as T;
    if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) return value as T;
  } catch { /* Use defaults in restricted browsers. */ }
  return fallback;
}
export function writePreference(key: string, value: string[] | number | boolean) {
  try { localStorage.setItem(`whistle:${key}`, JSON.stringify(value)); return true; }
  catch { return false; }
}
