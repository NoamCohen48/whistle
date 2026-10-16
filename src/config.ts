import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type Environment = Record<string, string | undefined>;
export interface Paths { configDir: string; configFile: string; stateDir: string; dataDir: string; unitFile: string; launcher: string }
export interface HostConfig { host: string; port: number; herdrSocketPath: string; herdrBinary: string }
const absolute = (value: string, label: string) => {
  if (!isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label} must be an absolute path without control characters`);
  return resolve(value);
};
export function resolvePaths(env: Environment = process.env): Paths {
  const home = absolute(env.HOME || homedir(), 'HOME');
  const configHome = absolute(env.XDG_CONFIG_HOME || join(home, '.config'), 'XDG_CONFIG_HOME');
  const stateHome = absolute(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'XDG_STATE_HOME');
  const dataHome = absolute(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'XDG_DATA_HOME');
  const configDir = absolute(env.WHISTLE_CONFIG_DIR || join(configHome, 'whistle'), 'WHISTLE_CONFIG_DIR');
  return {
    configDir, configFile: join(configDir, 'config.json'), dataDir: join(dataHome, 'whistle'),
    stateDir: absolute(env.WHISTLE_STATE_DIR || join(stateHome, 'whistle'), 'WHISTLE_STATE_DIR'),
    unitFile: join(configHome, 'systemd', 'user', 'whistle.service'),
    launcher: join(home, '.local', 'bin', 'whistle'),
  };
}
export function loadHostConfig(paths = resolvePaths(), env: Environment = process.env): HostConfig {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.configFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
    saved = parsed as Record<string, unknown>;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read Whistle configuration at ${paths.configFile}`, { cause });
  }
  const host = env.HOST ?? saved.host ?? '127.0.0.1';
  const port = env.PORT !== undefined ? Number(env.PORT) : saved.port ?? 8790;
  const herdrSocketPath = env.HERDR_SOCKET_PATH ?? saved.herdrSocketPath ?? join(env.HOME || homedir(), '.config', 'herdr', 'herdr.sock');
  const herdrBinary = env.WHISTLE_HERDR_BIN ?? saved.herdrBinary ?? Bun.which('herdr') ?? 'herdr';
  if (typeof host !== 'string' || (!isIP(host) && host !== 'localhost') || ['0.0.0.0', '::'].includes(host)) {
    throw new Error('HOST must be a specific IP address or localhost, not a wildcard listener');
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  if (typeof herdrSocketPath !== 'string') throw new Error('herdrSocketPath must be an absolute path');
  if (typeof herdrBinary !== 'string' || (herdrBinary !== 'herdr' && !isAbsolute(herdrBinary))) throw new Error('herdrBinary must be an absolute path');
  return { host, port, herdrSocketPath: absolute(herdrSocketPath, 'HERDR_SOCKET_PATH'),
    herdrBinary: herdrBinary === 'herdr' ? herdrBinary : absolute(herdrBinary, 'WHISTLE_HERDR_BIN') };
}
