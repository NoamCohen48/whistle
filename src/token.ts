import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot, type Paths } from './config.ts';
import { standalone } from './build-info.ts';

// Files the running host leaves in the state directory for the whistle command on the same PC.
export const stateFiles = { accessToken: 'access-token', serverUrl: 'server-url' };

export function validateToken(token: string) {
  if (token.length < 24 || token.length > 1024) throw new Error('PC access token must contain between 24 and 1024 characters');
  return token;
}

// The PC access token: from WHISTLE_TOKEN, or created once in the state directory.
export async function ensureToken(paths: Paths) {
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await chmod(paths.stateDir, 0o700);
  if (process.env.WHISTLE_TOKEN) return validateToken(process.env.WHISTLE_TOKEN);
  const path = join(paths.stateDir, stateFiles.accessToken);
  try { const token = validateToken((await readFile(path, 'utf8')).trim()); await chmod(path, 0o600); return token; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  let token: string | undefined;
  // Migrate only the old PC token, never pretend memory-only browser cookies can be imported.
  if (!standalone && !process.env.WHISTLE_STATE_DIR) {
    try { token = validateToken((await readFile(join(projectRoot, '.runtime', stateFiles.accessToken), 'utf8')).trim()); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  token ||= crypto.randomUUID() + crypto.randomUUID();
  try { await writeFile(path, token, { mode: 0o600, flag: 'wx' }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; return validateToken((await readFile(path, 'utf8')).trim()); }
  return token;
}

export async function writeServerUrl(paths: Paths, url: string) {
  await writeFile(join(paths.stateDir, stateFiles.serverUrl), url, { mode: 0o600 });
}
