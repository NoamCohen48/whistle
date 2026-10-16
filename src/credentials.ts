import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot, resolvePaths, type Paths } from './config.ts';
import { standalone } from './build-info.ts';

function validateToken(token: string) {
  if (token.length < 24 || token.length > 1024) throw new Error('PC access token must contain between 24 and 1024 characters');
  return token;
}
export async function ensureToken(paths: Paths) {
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await chmod(paths.stateDir, 0o700);
  if (process.env.WHISTLE_TOKEN) return validateToken(process.env.WHISTLE_TOKEN);
  const path = join(paths.stateDir, 'access-token');
  try { const token = validateToken((await readFile(path, 'utf8')).trim()); await chmod(path, 0o600); return token; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  let token: string | undefined;
  // Migrate only the old PC token, never pretend memory-only browser cookies can be imported.
  if (!standalone && !process.env.WHISTLE_STATE_DIR) {
    try { token = validateToken((await readFile(join(projectRoot, '.runtime', 'access-token'), 'utf8')).trim()); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  }
  token ||= crypto.randomUUID() + crypto.randomUUID();
  try { await writeFile(path, token, { mode: 0o600, flag: 'wx' }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; return validateToken((await readFile(path, 'utf8')).trim()); }
  return token;
}

export async function hostConnection(paths = resolvePaths()) {
  let directory = paths.stateDir;
  let base = process.env.WHISTLE_URL;
  if (!base) {
    try { base = await readFile(join(directory, 'server-url'), 'utf8'); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || process.env.WHISTLE_STATE_DIR || standalone) throw cause;
      directory = join(projectRoot, '.runtime');
      base = await readFile(join(directory, 'server-url'), 'utf8');
    }
  }
  try {
    const url = new URL(base.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== '/') {
      throw new Error('Use an HTTP(S) server origin without credentials, path, query or fragment');
    }
    const token = validateToken(process.env.WHISTLE_TOKEN || (await readFile(join(directory, 'access-token'), 'utf8')).trim());
    return { origin: url.origin, token, directory };
  } catch (cause) { throw new Error('Cannot read Whistle host connection. Start the host or check WHISTLE_URL and its state directory.', { cause }); }
}

export async function adminRequest(path: string, method = 'GET') {
  const { origin, token } = await hostConnection();
  const response = await fetch(origin + path, {
    method, headers: { Origin: origin, Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
