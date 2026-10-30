import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadHostConfig, projectRoot, resolvePaths } from './config.ts';
import { standalone } from './build-info.ts';
import { stateFiles, validateToken } from './token.ts';

// How the whistle command reaches the host running on this PC: its address and the PC access
// token, from the files the host wrote at startup (or WHISTLE_URL and WHISTLE_TOKEN).
export interface HostConnection { origin: string; requestOrigin: string; token: string; directory: string }

export async function hostConnection(paths = resolvePaths()): Promise<HostConnection> {
  let directory = paths.stateDir;
  let base = process.env.WHISTLE_URL;
  if (!base) {
    try { base = await readFile(join(directory, stateFiles.serverUrl), 'utf8'); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || process.env.WHISTLE_STATE_DIR || standalone) throw cause;
      directory = join(projectRoot, '.runtime');
      base = await readFile(join(directory, stateFiles.serverUrl), 'utf8');
    }
  }
  try {
    const url = new URL(base.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== '/') {
      throw new Error('Use an HTTP(S) server origin without credentials, path, query or fragment');
    }
    const token = validateToken(process.env.WHISTLE_TOKEN || (await readFile(join(directory, stateFiles.accessToken), 'utf8')).trim());
    return { origin: url.origin, requestOrigin: loadHostConfig(paths).publicOrigin || url.origin, token, directory };
  } catch (cause) { throw new Error('Cannot read Whistle host connection. Start the host or check WHISTLE_URL and its state directory.', { cause }); }
}

// A request to the host with the PC access token. Throws with the host's answer when refused.
export async function adminRequest(path: string, method = 'GET', connection?: HostConnection) {
  const { origin, requestOrigin, token } = connection ?? await hostConnection();
  const response = await fetch(origin + path, {
    method, headers: { Origin: requestOrigin, Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
