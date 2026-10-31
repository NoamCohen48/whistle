import { describe, expect, test } from 'bun:test';
import { isRequestId, Launches } from '../src/launches.ts';
import type { Action } from '../shared/api.ts';

const agent: Action = { type: 'agent', workspaceId: 'w1', kind: 'claude' };

describe('launches', () => {
  test('a repeat with the same request ID returns the first result without running again', async () => {
    const launches = new Launches();
    let runs = 0;
    const perform = async () => ({ paneId: `w1:p${++runs}` });
    expect(await launches.run('phone', 'abcdef12', agent, perform)).toEqual({ paneId: 'w1:p1' });
    expect(await launches.run('phone', 'abcdef12', agent, perform)).toEqual({ paneId: 'w1:p1' });
    expect(runs).toBe(1);
  });

  test('a repeat while the first is still running waits for it', async () => {
    const launches = new Launches();
    let runs = 0;
    let finish = (_: { paneId: string }) => {};
    const perform = () => { runs++; return new Promise<{ paneId: string }>(resolve => { finish = resolve; }); };
    const first = launches.run('phone', 'abcdef12', agent, perform);
    const second = launches.run('phone', 'abcdef12', agent, perform);
    finish({ paneId: 'w1:p1' });
    expect(await second).toEqual(await first);
    expect(runs).toBe(1);
  });

  test('another phone, another ID or another action runs on its own', async () => {
    const launches = new Launches();
    let runs = 0;
    const perform = async () => ({ paneId: `w1:p${++runs}` });
    await launches.run('phone', 'abcdef12', agent, perform);
    await launches.run('tablet', 'abcdef12', agent, perform);
    await launches.run('phone', 'abcdef13', agent, perform);
    await launches.run('phone', 'abcdef12', { ...agent, kind: 'codex' }, perform);
    await launches.run('phone', undefined, agent, perform);
    await launches.run('phone', undefined, agent, perform);
    expect(runs).toBe(6);
  });

  test('a failure is forgotten, so trying again really runs again', async () => {
    const launches = new Launches();
    let runs = 0;
    const perform = async () => { if (++runs === 1) throw new Error('Herdr is not running'); return { paneId: 'w1:p2' }; };
    await expect(launches.run('phone', 'abcdef12', agent, perform)).rejects.toThrow('Herdr is not running');
    expect(await launches.run('phone', 'abcdef12', agent, perform)).toEqual({ paneId: 'w1:p2' });
    expect(runs).toBe(2);
  });

  test('results are forgotten after ten minutes', async () => {
    let now = 0;
    const launches = new Launches(() => now);
    let runs = 0;
    const perform = async () => ({ paneId: `w1:p${++runs}` });
    await launches.run('phone', 'abcdef12', agent, perform);
    now = 10 * 60 * 1000 + 1;
    expect(await launches.run('phone', 'abcdef12', agent, perform)).toEqual({ paneId: 'w1:p2' });
  });

  test('request IDs are short letters, digits and dashes', () => {
    expect(isRequestId('0f'.repeat(16))).toBe(true);
    expect(isRequestId('00000000-0000-4000-8000-000000000001')).toBe(true);
    for (const value of ['short', 'a'.repeat(65), 'has space1', '../../etc', 42, undefined]) expect(isRequestId(value)).toBe(false);
  });
});
