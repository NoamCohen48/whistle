import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

// Paths typed on the phone: absolute, or relative to the home folder with ~/.
export function hostPath(value: string, home = homedir()) {
  if (value.length > 1024) throw new Error('Path is too long');
  const expanded = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('Use an absolute path or ~/…');
  return expanded;
}

// Whether a resolved path is the folder itself or something inside it. Both must already be
// real paths (no symlinks), or a link could lead outside.
export function isInside(path: string, folder: string) {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}
