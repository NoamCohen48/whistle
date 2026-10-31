import { describe, expect, test } from 'bun:test';
import { diagnose, report, type DoctorProbes } from '../src/doctor.ts';
import type { HostConfig } from '../src/config.ts';

const config: HostConfig = { host: '100.101.102.103', port: 8790, herdrSocketPath: '/home/sam/.config/herdr/herdr.sock', herdrBinary: 'herdr' };
const probes = (overrides: Partial<DoctorProbes> = {}): DoctorProbes => ({
  config: () => config,
  herdr: async () => ({ panes: [
    { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 't', agent: 'claude' },
    { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', tab_id: 't' },
  ], workspaces: [], tabs: [] }),
  host: async () => ({ origin: 'http://100.101.102.103:8790', devices: 1 }),
  reaches: async () => true,
  addresses: () => ['127.0.0.1', '100.101.102.103'],
  ...overrides,
});
const byName = async (overrides: Partial<DoctorProbes> = {}) => Object.fromEntries((await diagnose(probes(overrides))).map(check => [check.name, check]));

describe('whistle doctor', () => {
  test('a Tailscale address over plain HTTP works, with HTTPS and alerts as warnings', async () => {
    const checks = await byName();
    expect(checks.Herdr).toMatchObject({ status: 'ok', detail: expect.stringContaining('2 panes, 1 agents') });
    expect(checks['Whistle host'].status).toBe('ok');
    expect(checks['Phone address']).toMatchObject({ status: 'ok', detail: expect.stringContaining('Tailscale') });
    expect(checks.HTTPS.status).toBe('warn');
    expect(checks.Alerts.status).toBe('warn');
  });

  test('HTTPS through Tailscale Serve is checked by asking the phone address from this PC', async () => {
    const asked: string[] = [];
    const serve = { ...config, host: '127.0.0.1', publicOrigin: 'https://pc.tail1.ts.net' };
    const checks = await byName({ config: () => serve, reaches: async url => { asked.push(url); return true; } });
    expect(asked).toEqual(['https://pc.tail1.ts.net/manifest.webmanifest']);
    expect([checks['Phone address'].status, checks.HTTPS.status, checks.Alerts.status]).toEqual(['ok', 'ok', 'ok']);
    expect((await byName({ config: () => serve, reaches: async () => false }))['Phone address'].status).toBe('fail');
  });

  test('each broken link in the chain fails with what to do about it', async () => {
    const checks = await byName({
      herdr: async () => { throw new Error('Herdr is not reachable. Check that Herdr is running on the PC.'); },
      host: async () => { throw new Error('ECONNREFUSED'); },
      addresses: () => ['127.0.0.1'],
    });
    expect(checks.Herdr).toMatchObject({ status: 'fail', detail: expect.stringContaining('--herdr-socket') });
    expect(checks['Whistle host']).toMatchObject({ status: 'fail', detail: expect.stringContaining('whistle start') });
    expect(checks['Phone address']).toMatchObject({ status: 'fail', detail: expect.stringContaining('not an address of this PC') });
    expect((await byName({ config: () => ({ ...config, host: '127.0.0.1' }) }))['Phone address'].detail).toContain('only reachable from this PC');
    expect((await byName({ host: async () => ({ origin: 'http://x', devices: 0 }) }))['Paired phones']).toMatchObject({ status: 'warn', detail: expect.stringContaining('whistle pair') });
  });

  test('a configuration that cannot load stops there', async () => {
    const checks = await diagnose(probes({ config: () => { throw new Error('PORT must be an integer between 0 and 65535'); } }));
    expect(checks).toEqual([{ status: 'fail', name: 'Configuration', detail: 'PORT must be an integer between 0 and 65535. Run whistle install again with the right flags.' }]);
  });

  test('the report lines up one check per line', () => {
    expect(report([{ status: 'ok', name: 'Herdr', detail: 'fine' }, { status: 'fail', name: 'HTTPS', detail: 'off' }]))
      .toBe('ok    Herdr  fine\nFAIL  HTTPS  off');
  });
});
