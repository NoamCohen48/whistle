import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadHostConfig, projectRoot, resolvePaths, type Paths } from './config.ts';
import { standalone } from './build-info.ts';
import { installExecutable } from './releases.ts';
import { assetSpecs } from './assets.ts';

const marker = '# Managed by Whistle.';
export function unitQuote(value: string, command = false) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Service paths cannot contain control characters');
  let escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
  if (command) escaped = escaped.replace(/\$/g, '$$$$');
  return `"${escaped}"`;
}
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
// systemd forbids '$' in its executable token, even escaped. Pass the managed
// launcher as a literal shell argument; its exec replaces the shell in-place.
export function serviceUnit(paths: Paths) {
  return `${marker}
[Unit]
Description=Whistle personal terminal remote
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="/bin/sh" ${unitQuote(paths.launcher, true)} "serve"
Environment=${unitQuote(`WHISTLE_CONFIG_DIR=${paths.configDir}`)}
Environment=${unitQuote(`WHISTLE_STATE_DIR=${paths.stateDir}`)}
Restart=on-failure
RestartSec=5
TimeoutStopSec=5
KillMode=control-group
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}
async function ownedFile(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing to replace a symlink: ${path}`);
    const contents = await readFile(path, 'utf8');
    if (!contents.startsWith(marker) && !contents.startsWith(`#!/bin/sh\n${marker}`)) throw new Error(`Not managed by Whistle; refusing to modify ${path}`);
    return true;
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw cause; }
}
async function atomicWrite(path: string, contents: string, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, { mode, flag: 'wx' }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function systemctl(args: string[], allowInactive = false) {
  const child = Bun.spawn(['systemctl', '--user', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0 && !(allowInactive && [3, 4].includes(code))) throw new Error(`systemctl --user ${args[0]} failed: ${stderr.trim() || stdout.trim()}`);
  return stdout.trim();
}
function requireLinuxUser() {
  if (process.platform !== 'linux') throw new Error('User-service installation currently supports Linux/systemd only');
  if (process.getuid?.() === 0) throw new Error('Run Whistle as your regular user, not with sudo');
}
export async function installService(options: { host?: string; port?: string; herdrSocket?: string; publicOrigin?: string; now?: boolean } = {}) {
  requireLinuxUser();
  const paths = resolvePaths();
  const config = loadHostConfig(paths, { ...process.env,
    ...(options.host !== undefined ? { HOST: options.host } : {}),
    ...(options.port !== undefined ? { PORT: options.port } : {}),
    ...(options.publicOrigin !== undefined ? { WHISTLE_PUBLIC_ORIGIN: options.publicOrigin } : {}),
    ...(options.herdrSocket !== undefined ? { HERDR_SOCKET_PATH: options.herdrSocket } : {}),
  });
  if (config.port === 0) throw new Error('An installed service needs a fixed nonzero port');
  await ownedFile(paths.unitFile); await ownedFile(paths.launcher);
  for (const asset of standalone ? [] : Object.values(assetSpecs).map(asset => asset.file)) {
    if (!await Bun.file(join(projectRoot, 'dist', asset)).exists()) throw new Error('Build the frontend first: bun run build');
  }
  await access(config.herdrBinary, constants.X_OK);
  await systemctl(['show-environment']); // Check the user bus before changing files; never print its values.
  const executable = standalone ? await installExecutable(process.execPath, paths.dataDir) : process.execPath;
  await atomicWrite(paths.configFile, JSON.stringify(config, null, 2) + '\n');
  await atomicWrite(paths.unitFile, serviceUnit(paths));
  const command = standalone ? [executable] : [executable, join(projectRoot, 'src/cli.ts')];
  const launcher = `#!/bin/sh\n${marker}\nexec ${command.map(shellQuote).join(' ')} "$@"\n`;
  await atomicWrite(paths.launcher, launcher, 0o700);
  await systemctl(['daemon-reload']);
  await systemctl(['enable', 'whistle.service']);
  if (options.now) await systemctl(['start', 'whistle.service']);
  return { paths, config, executable };
}
export async function serviceAction(action: 'start' | 'stop' | 'restart' | 'status') {
  requireLinuxUser();
  const paths = resolvePaths();
  if (!await ownedFile(paths.unitFile)) {
    if (action === 'status') return 'Whistle user service is not installed.';
    throw new Error('Whistle user service is not installed. Run whistle install first.');
  }
  return systemctl(action === 'status' ? ['status', 'whistle.service', '--no-pager'] : [action, 'whistle.service'], action === 'status');
}
export async function uninstallService() {
  requireLinuxUser();
  const paths = resolvePaths();
  const unit = await ownedFile(paths.unitFile);
  const launcher = await ownedFile(paths.launcher);
  if (unit) await systemctl(['disable', '--now', 'whistle.service']);
  if (unit) await rm(paths.unitFile);
  if (launcher) await rm(paths.launcher);
  if (unit) await systemctl(['daemon-reload']);
  return paths; // Keep configuration, credentials and database unless explicitly removed by the operator.
}
