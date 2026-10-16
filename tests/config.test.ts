import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHostConfig, resolvePaths } from '../src/config.ts';
import { serviceUnit, unitQuote } from '../src/service.ts';

test('state/config/unit paths follow XDG and never depend on the working directory', () => {
  const paths = resolvePaths({ HOME: '/tmp/person', XDG_STATE_HOME: '/tmp/state', XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data' });
  expect(paths.stateDir).toBe('/tmp/state/whistle');
  expect(paths.dataDir).toBe('/tmp/data/whistle');
  expect(resolvePaths({ HOME: '/tmp/person' }).dataDir).toBe('/tmp/person/.local/share/whistle');
  expect(() => resolvePaths({ HOME: '/tmp/person', XDG_DATA_HOME: 'relative' })).toThrow();
  expect(paths.configFile).toBe('/tmp/config/whistle/config.json');
  expect(paths.unitFile).toBe('/tmp/config/systemd/user/whistle.service');
  expect(paths.launcher).toBe('/tmp/person/.local/bin/whistle');
  expect(() => resolvePaths({ HOME: '/tmp/person', WHISTLE_STATE_DIR: 'relative' })).toThrow();
});

test('host config is validated, saved values survive and environment overrides are explicit', () => {
  const home = mkdtempSync(join(tmpdir(), 'whistle-config-'));
  try {
    const paths = resolvePaths({ HOME: home }); mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.configFile, JSON.stringify({ host: '100.68.36.94', port: 8799, herdrSocketPath: '/tmp/herdr.sock' }));
    const loaded = loadHostConfig(paths, { HOME: home });
    expect(loaded.host).toBe('100.68.36.94'); expect(loaded.port).toBe(8799);
    expect(loadHostConfig(paths, { HOME: home, HOST: '127.0.0.1', PORT: '0' }).port).toBe(0);
    for (const host of ['0.0.0.0', '::', '*', 'example.com']) expect(() => loadHostConfig(paths, { HOME: home, HOST: host })).toThrow();
    for (const port of ['-1', 'NaN', '65536', '1.5']) expect(() => loadHostConfig(paths, { HOME: home, PORT: port })).toThrow();
    writeFileSync(paths.configFile, 'not JSON'); expect(() => loadHostConfig(paths, { HOME: home })).toThrow('configuration');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== 'linux' || !Bun.which('systemd-analyze'))('generated service passes the real systemd unit parser without installation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'whistle-unit-'));
  try {
    const path = join(home, 'whistle.service');
    writeFileSync(path, serviceUnit(resolvePaths({ HOME: home })));
    const child = Bun.spawn(['systemd-analyze', '--user', 'verify', path], { stdout: 'pipe', stderr: 'pipe' });
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(error).toBe(''); expect(code).toBe(0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('user unit quotes paths and manages only its own companion process tree', () => {
  const paths = resolvePaths({ HOME: '/tmp/person %u $user' });
  const unit = serviceUnit(paths);
  expect(unit).toContain('%%u'); expect(unit).toContain('$$user');
  expect(unit).toContain('WHISTLE_STATE_DIR=/tmp/person %%u $user');
  expect(unit).toContain('WantedBy=default.target');
  expect(unit).toContain('KillMode=control-group');
  expect(unit).toContain('ExecStart="/bin/sh" "/tmp/person %%u $$user/.local/bin/whistle" "serve"');
  expect(unit).not.toContain('src/server.ts');
  expect(unit).not.toContain('sudo'); expect(unit).not.toContain('linger');
  expect(unit).not.toContain('PartOf='); expect(unit).not.toContain('ExecStop=herdr');
  expect(unitQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
  expect(() => unitQuote('a\nb')).toThrow();
});
