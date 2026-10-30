// Explicit artifact suite: bun run test:package. Not part of ordinary bun test discovery.
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { projectRoot, resolvePaths } from '../src/config.ts';
import { serviceUnit, unitQuote } from '../src/service.ts';
import { assetSpecs } from '../src/assets.ts';
import { startHost, testToken } from './helpers/host.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "whistle-standalone %u $cash's-"));
  const executable = join(home, 'download', 'whistle');
  await mkdir(join(home, 'download'));
  await mkdir(join(home, 'bin'));
  await mkdir(join(home, '.runtime'), { mode: 0o700 });
  await copyFile(join(projectRoot, 'dist', 'whistle'), executable); await chmod(executable, 0o700);
  await writeFile(join(home, '.runtime/access-token'), testToken, { mode: 0o600 });
  await writeFile(join(home, '.env'), 'WHISTLE_TOKEN=untrusted-cwd-token-do-not-load-this\n');
  await writeFile(join(home, 'bunfig.toml'), 'preload = ["./evil.js"]\n');
  await writeFile(join(home, 'evil.js'), `Bun.write(${JSON.stringify(join(home, 'preload-executed'))}, 'unexpected');`);
  await writeFile(join(home, 'bin/herdr'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  await writeFile(join(home, 'bin/systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WHISTLE_TEST_SYSTEMCTL_LOG"\n', { mode: 0o700 });
  const env = { ...process.env, HOME: home, PATH: join(home, 'bin'), HOST: '127.0.0.1', PORT: '0',
    XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_STATE_HOME: join(home, 'xdg-state'), XDG_DATA_HOME: join(home, 'xdg-data'),
    HERDR_SOCKET_PATH: join(home, 'herdr.sock'), WHISTLE_TEST_SYSTEMCTL_LOG: join(home, 'systemctl.log'),
    WHISTLE_STATE_DIR: join(home, '.runtime'), WHISTLE_CONFIG_DIR: join(home, 'config'),
    WHISTLE_TOKEN: undefined, WHISTLE_URL: undefined, WHISTLE_HERDR_BIN: join(home, 'bin/herdr') };
  return { home, executable, env };
}
async function run(executable: string, args: string[], home: string, env: Record<string, string | undefined>) {
  const child = Bun.spawn([executable, ...args], { cwd: home, env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

test('detached executable has its own runtime, build identity and verified checksum', async () => {
  const { home, executable, env } = await fixture();
  try {
    const version = await run(executable, ['--version'], home, env);
    expect(version.code).toBe(0); expect(version.stderr).toBe(''); expect(version.stdout).toContain('standalone');
    const help = await run(executable, ['--help'], home, env);
    expect(help.code).toBe(0); expect(help.stdout).toContain('whistle serve');
    const expected = (await readFile(join(projectRoot, 'dist/whistle.sha256'), 'utf8')).split(' ')[0];
    expect(hash(await readFile(executable))).toBe(expected);
    expect((await stat(executable)).mode & 0o777).toBe(0o700);
    expect(await Bun.file(join(home, 'preload-executed')).exists()).toBe(false);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 15_000);

test('detached host embeds exact frontend bytes, refuses cwd autoload, and preserves pairing across restart', async () => {
  const { home, executable, env } = await fixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(home, env, [executable, 'serve']);
    for (const [path, asset] of Object.entries(assetSpecs)) {
      const response = await host.request(path); expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(asset.type);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(hash(new Uint8Array(await response.arrayBuffer()))).toBe(hash(await readFile(join(projectRoot, 'dist', asset.file))));
    }
    expect((await host.request('/api/devices')).status).toBe(401);
    expect((await host.request('/constructor')).status).toBe(404);
    expect((await host.request('/access-token')).status).toBe(404);
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken, deviceName: 'Detached binary test' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    await host.stop(); host = await startHost(home, env, [executable, 'serve']);
    const listing = await host.request('/api/devices', { headers: { Cookie: cookie } });
    expect(listing.status).toBe(200); expect((await listing.json()).devices[0].name).toBe('Detached binary test');
    expect(await Bun.file(join(home, 'preload-executed')).exists()).toBe(false);
    const qr = await run(executable, ['pair'], home, env);
    expect(qr.stderr).toBe(''); expect(qr.code).toBe(0); expect(qr.stdout).not.toContain(testToken);
    expect([...new Uint8Array(await readFile(join(home, '.runtime/pair.png'))).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }); }
}, 15_000);

const bwrap = Bun.which('bwrap');
test.skipIf(process.platform !== 'linux' || !bwrap)('binary serves with checkout/node_modules hidden and system Bun unavailable in a private mount namespace', async () => {
  const { home, executable, env } = await fixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(home, env, [bwrap!, '--die-with-parent', '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--bind', home, home,
      '--tmpfs', projectRoot, '--ro-bind', '/dev/null', process.execPath, '--chdir', home, executable, 'serve']);
    expect((await host.request('/')).status).toBe(200);
    const response = await host.request('/app.js');
    expect(hash(await response.text())).toBe(hash(await readFile(join(projectRoot, 'dist/app.js'), 'utf8')));
    expect((await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) })).status).toBe(200);
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }); }
}, 15_000);

test.skipIf(process.platform !== 'linux' || process.getuid?.() === 0)('native installation survives download removal, repeats safely and uninstalls without purging state or releases', async () => {
  const { home, executable, env } = await fixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const installed = await run(executable, ['install', '--port', '8799'], home, env);
    expect(installed.stderr).toBe(''); expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('no start/restart requested');
    expect(installed.stdout).toContain('No checkout or Bun required');
    const paths = resolvePaths(env);
    const checksum = (await readFile(join(projectRoot, 'dist/whistle.sha256'), 'utf8')).split(' ')[0];
    const release = join(paths.dataDir, 'releases', checksum, 'whistle');
    const unit = await readFile(paths.unitFile, 'utf8');
    expect(unit).toContain(`ExecStart="/bin/sh" ${unitQuote(paths.launcher, true)} "serve"`);
    expect(await readFile(paths.launcher, 'utf8')).toContain(release.replace(/'/g, "'\\''"));
    expect(unit).not.toContain(projectRoot); expect(unit).not.toContain(process.execPath);
    expect((await stat(release)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(home, 'systemctl.log'), 'utf8')).toBe('--user show-environment\n--user daemon-reload\n--user enable whistle.service\n');
    const analyze = Bun.which('systemd-analyze');
    if (analyze) {
      const runtime = join(home, 'runtime'); await mkdir(runtime, { mode: 0o700 });
      const parsed = await run(analyze, ['--user', 'verify', paths.unitFile], home, { ...process.env, XDG_RUNTIME_DIR: runtime });
      expect(parsed.stderr).toBe(''); expect(parsed.code).toBe(0);
    }
    await rm(join(home, 'download'), { recursive: true });
    expect((await run(paths.launcher, ['--version'], home, env)).stdout).toContain('standalone');
    expect((await run(paths.launcher, ['install', '--port', '8799', '--now'], home, env)).code).toBe(0);
    expect(await readFile(paths.unitFile, 'utf8')).toBe(unit);
    for (const command of ['start', 'restart', 'stop', 'status']) expect((await run(paths.launcher, [command], home, env)).code).toBe(0);
    host = await startHost(home, env, [release, 'serve']);
    expect((await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) })).status).toBe(200);
    await host.stop(); host = undefined;
    expect((await run(paths.launcher, ['uninstall'], home, env)).code).toBe(0);
    expect(await Bun.file(paths.unitFile).exists()).toBe(false); expect(await Bun.file(paths.launcher).exists()).toBe(false);
    expect(await Bun.file(join(paths.stateDir, 'devices.sqlite')).exists()).toBe(true);
    expect(await readFile(join(paths.stateDir, 'access-token'), 'utf8')).toBe(testToken);
    expect(await Bun.file(release).exists()).toBe(true);
    const log = await readFile(join(home, 'systemctl.log'), 'utf8');
    expect(log).toContain('--user disable --now whistle.service');
    expect(log).not.toContain('herdr'); expect(log).not.toContain('linger'); expect(log).not.toContain('firewall');
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }); }
}, 20_000);

test.skipIf(process.platform !== 'linux' || process.getuid?.() === 0)('source-to-binary upgrade retains the original paired cookie and device identity', async () => {
  const { home, executable, env } = await fixture();
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    // The legacy source runtime normally autoloads Bun project files; this test
    // isolates the pairing upgrade, not that separately tested native policy.
    await rm(join(home, '.env')); await rm(join(home, 'bunfig.toml'));
    const paths = resolvePaths(env);
    await mkdir(dirname(paths.unitFile), { recursive: true }); await mkdir(dirname(paths.launcher), { recursive: true });
    const legacyUnit = serviceUnit(paths).replace(/^ExecStart=.*$/m,
      `ExecStart=${unitQuote(process.execPath, true)} ${unitQuote(join(projectRoot, 'src/server.ts'), true)}`);
    await writeFile(paths.unitFile, legacyUnit);
    await writeFile(paths.launcher, '#!/bin/sh\n# Managed by Whistle.\nexit 0\n', { mode: 0o700 });
    host = await startHost(home, env);
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken, deviceName: 'Before binary upgrade' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const before = (await (await host.request('/api/devices', { headers: { Cookie: cookie } })).json()).devices[0];
    const installed = await run(executable, ['install', '--port', '8799'], home, env);
    expect(installed.stderr).toBe(''); expect(installed.code).toBe(0);
    // Merely installing never stops/restarts the existing process.
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(200);
    await host.stop(); host = undefined;
    await rm(join(home, 'download'), { recursive: true });
    host = await startHost(home, env, [paths.launcher, 'serve']);
    const after = await host.request('/api/devices', { headers: { Cookie: cookie } });
    expect(after.status).toBe(200);
    expect((await after.json()).devices[0].id).toBe(before.id);
    expect((await run(paths.launcher, ['devices'], home, env)).stdout).toContain('Before binary upgrade');
    expect(await readFile(join(paths.stateDir, 'access-token'), 'utf8')).toBe(testToken);
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }); }
}, 20_000);

test.skipIf(process.platform !== 'linux' || process.getuid?.() === 0)('native install/uninstall preserve unrelated launchers and symlinks before making changes', async () => {
  const { home, executable, env } = await fixture();
  try {
    const paths = resolvePaths(env); await mkdir(dirname(paths.launcher), { recursive: true });
    await writeFile(paths.launcher, 'unrelated program');
    for (const command of ['install', 'uninstall']) {
      const result = await run(executable, command === 'install' ? [command, '--port', '8799'] : [command], home, env);
      expect(result.code).toBe(1); expect(result.stderr).toContain('Not managed by Whistle');
    }
    expect(await readFile(paths.launcher, 'utf8')).toBe('unrelated program');
    await rm(paths.launcher); await symlink(executable, paths.launcher);
    const result = await run(executable, ['install', '--port', '8799'], home, env);
    expect(result.code).toBe(1); expect(result.stderr).toContain('symlink');
    expect(await Bun.file(paths.configFile).exists()).toBe(false); expect(await Bun.file(join(home, 'systemctl.log')).exists()).toBe(false);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 15_000);
