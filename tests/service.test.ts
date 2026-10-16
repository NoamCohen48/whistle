import { expect, test } from 'bun:test';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectRoot, resolvePaths } from '../src/config.ts';
import { startHost, testToken } from './helpers/host.ts';

async function cli(home: string, args: string[], extra: Record<string, string> = {}) {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_STATE_HOME: join(home, 'xdg-state'),
    WHISTLE_CONFIG_DIR: join(home, 'config'), WHISTLE_STATE_DIR: join(home, '.runtime'),
    HERDR_SOCKET_PATH: join(home, 'herdr.sock'), PATH: `${join(home, 'bin')}:${process.env.PATH}`,
    WHISTLE_TEST_SYSTEMCTL_LOG: join(home, 'systemctl.log'), ...extra };
  const child = Bun.spawn([process.execPath, join(projectRoot, 'src/cli.ts'), ...args], { cwd: home, env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code, paths: resolvePaths(env), env };
}

test('install/start/restart/stop/uninstall use only systemctl --user and preserve paired-device data', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-service-'));
  try {
    if (!await Bun.file(join(projectRoot, 'dist/index.html')).exists()) {
      const build = Bun.spawn([process.execPath, 'run', 'build'], { cwd: projectRoot });
      expect(await build.exited).toBe(0);
    }
    await mkdir(join(home, 'bin'));
    await writeFile(join(home, 'bin/systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WHISTLE_TEST_SYSTEMCTL_LOG"\n', { mode: 0o700 });
    await writeFile(join(home, 'bin/herdr'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    const installed = await cli(home, ['install', '--host', '100.68.36.94', '--port', '8799']);
    expect(installed.stderr).toBe(''); expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('not started yet');
    const { paths } = installed;
    const config = JSON.parse(await readFile(paths.configFile, 'utf8'));
    expect(config.host).toBe('100.68.36.94'); expect(config.port).toBe(8799);
    expect(config.herdrBinary).toBe(join(home, 'bin/herdr'));
    expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.launcher)).mode & 0o777).toBe(0o700);
    expect(await readFile(join(home, 'systemctl.log'), 'utf8')).toBe('--user show-environment\n--user daemon-reload\n--user enable whistle.service\n');
    const launcher = Bun.spawn([paths.launcher, 'status'], { cwd: home, env: installed.env, stdout: 'ignore', stderr: 'pipe' });
    expect(await launcher.exited).toBe(0);
    expect((await cli(home, ['install', '--now'])).stdout).toContain('and started it');
    for (const command of ['start', 'restart', 'stop', 'status']) expect((await cli(home, [command])).code).toBe(0);
    await mkdir(paths.stateDir, { recursive: true }); await writeFile(join(paths.stateDir, 'keep'), 'paired devices');
    expect((await cli(home, ['uninstall'])).code).toBe(0);
    expect(await readFile(join(paths.stateDir, 'keep'), 'utf8')).toBe('paired devices');
    expect(JSON.parse(await readFile(paths.configFile, 'utf8')).port).toBe(8799);
    await expect(access(paths.unitFile)).rejects.toThrow(); await expect(access(paths.launcher)).rejects.toThrow();
    const log = await readFile(join(home, 'systemctl.log'), 'utf8');
    expect(log).toContain('--user disable --now whistle.service');
    expect(log).not.toContain('linger'); expect(log).not.toContain('firewall');
  } finally { await rm(home, { recursive: true, force: true }); }
}, 15_000);

test('service management refuses to overwrite or uninstall unrelated launchers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-foreign-'));
  try {
    const initial = await cli(home, ['status']);
    await mkdir(join(home, 'bin'));
    await writeFile(join(home, 'bin/herdr'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await mkdir(join(home, '.local/bin'), { recursive: true });
    await writeFile(initial.paths.launcher, 'unrelated program');
    expect((await cli(home, ['install'])).stderr).toContain('Not managed by Whistle');
    expect((await cli(home, ['uninstall'])).stderr).toContain('Not managed by Whistle');
    expect(await readFile(initial.paths.launcher, 'utf8')).toBe('unrelated program');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('device CLI lists and revokes against the real host from outside its checkout', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whistle-device-cli-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(home);
    expect(await (await host.request('/')).text()).toContain('id="root"');
    expect((await host.request('/app.js')).status).toBe(200);
    const login = await host.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken, deviceName: 'CLI test phone' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const listing = await cli(home, ['devices'], { WHISTLE_TOKEN: testToken });
    expect(listing.code).toBe(0); expect(listing.stdout).toContain('CLI test phone'); expect(listing.stdout).not.toContain(testToken);
    const id = listing.stdout.split(' ')[0];
    expect((await cli(home, ['revoke', id], { WHISTLE_TOKEN: testToken })).code).toBe(0);
    expect((await host.request('/api/devices', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await cli(home, ['revoke', '../../bad'], { WHISTLE_TOKEN: testToken })).code).toBe(1);
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }); }
}, 10_000);
