import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import type { HostConfig } from './config.ts';
import type { Snapshot } from '../shared/api.ts';

// whistle doctor: walks the chain a phone needs, from Herdr to the address the phone opens,
// and says plainly what is missing. It only reads; it never changes configuration or services.
export type Status = 'ok' | 'warn' | 'fail';
export interface Check { status: Status; name: string; detail: string }

export interface DoctorProbes {
  config: () => HostConfig;
  herdr: (config: HostConfig) => Promise<Snapshot>;
  // The running host's own address and how many phones are paired with it.
  host: () => Promise<{ origin: string; devices: number }>;
  // Whether a URL answers from this PC.
  reaches: (url: string) => Promise<boolean>;
  addresses: () => string[];
}

const loopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);
// Tailscale hands out 100.64.0.0/10 and fd7a:115c:a1e0::/48.
const tailscale = (host: string) => {
  const [a, b] = host.split('.').map(Number);
  return (isIP(host) === 4 && a === 100 && b >= 64 && b <= 127) || host.toLowerCase().startsWith('fd7a:115c:a1e0:');
};
// The cause as a full sentence, to put advice after it.
const why = (cause: unknown) => { const text = (cause as Error).message || String(cause); return /[.!?]$/.test(text) ? text : `${text}.`; };

export async function diagnose(probes: DoctorProbes): Promise<Check[]> {
  const checks: Check[] = [];
  let config: HostConfig;
  try { config = probes.config(); }
  catch (cause) { return [{ status: 'fail', name: 'Configuration', detail: `${why(cause)} Run whistle install again with the right flags.` }]; }
  checks.push({ status: 'ok', name: 'Configuration', detail: `Listens on ${config.host}:${config.port}${config.publicOrigin ? `, phones use ${config.publicOrigin}` : ''}` });

  try {
    const state = await probes.herdr(config);
    const agents = state.panes.filter(pane => pane.agent).length;
    checks.push({ status: 'ok', name: 'Herdr', detail: `Answers at ${config.herdrSocketPath}: ${state.panes.length} panes, ${agents} agents` });
  } catch (cause) {
    checks.push({ status: 'fail', name: 'Herdr', detail: `${why(cause)} Socket: ${config.herdrSocketPath}. Start Herdr, or set --herdr-socket.` });
  }

  try {
    const { origin, devices } = await probes.host();
    checks.push({ status: 'ok', name: 'Whistle host', detail: `Running at ${origin}` });
    checks.push(devices ? { status: 'ok', name: 'Paired phones', detail: `${devices} paired` }
      : { status: 'warn', name: 'Paired phones', detail: 'None yet. Run whistle pair and scan the code.' });
  } catch {
    checks.push({ status: 'fail', name: 'Whistle host', detail: 'Not answering. Run whistle start, then whistle status if it stops again.' });
  }

  if (config.publicOrigin) {
    checks.push(await probes.reaches(`${config.publicOrigin}/manifest.webmanifest`)
      ? { status: 'ok', name: 'Phone address', detail: `${config.publicOrigin} answers from this PC` }
      : { status: 'fail', name: 'Phone address', detail: `${config.publicOrigin} does not answer. Check that Tailscale Serve (or your proxy) points at http://${config.host}:${config.port}.` });
    checks.push({ status: 'ok', name: 'HTTPS', detail: 'On, so alerts and installing the app work' });
    checks.push({ status: 'ok', name: 'Alerts', detail: 'Available. Turn them on from the phone with the bell.' });
    return checks;
  }

  if (loopback(config.host)) {
    checks.push({ status: 'fail', name: 'Phone address', detail: `${config.host} is only reachable from this PC. Use --host "$(tailscale ip -4)", or put Tailscale Serve in front and set --public-origin.` });
  } else if (config.host !== 'localhost' && !probes.addresses().includes(config.host)) {
    checks.push({ status: 'fail', name: 'Phone address', detail: `${config.host} is not an address of this PC any more. Is Tailscale up? Reinstall with --host "$(tailscale ip -4)".` });
  } else {
    const url = `http://${isIP(config.host) === 6 ? `[${config.host}]` : config.host}:${config.port}`;
    checks.push(tailscale(config.host)
      ? { status: 'ok', name: 'Phone address', detail: `${url} on your Tailscale network` }
      : { status: 'warn', name: 'Phone address', detail: `${url} is not a Tailscale address. Phones reach it only on this network.` });
  }
  checks.push({ status: 'warn', name: 'HTTPS', detail: 'Off. Watching and typing work; alerts and installing the app need HTTPS. See "HTTPS with Tailscale Serve" in the README.' });
  checks.push({ status: 'warn', name: 'Alerts', detail: 'Unavailable until HTTPS is set up.' });
  return checks;
}

export function report(checks: Check[]) {
  const mark: Record<Status, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const width = Math.max(...checks.map(check => check.name.length));
  return checks.map(check => `${mark[check.status]}  ${check.name.padEnd(width)}  ${check.detail}`).join('\n');
}

// The real probes, for the whistle command.
export async function runDoctor() {
  const { loadHostConfig, resolvePaths } = await import('./config.ts');
  const { useHerdr, snapshot } = await import('./herdr.ts');
  const { adminRequest, hostConnection } = await import('./host-client.ts');
  const checks = await diagnose({
    config: () => loadHostConfig(resolvePaths()),
    herdr: config => { useHerdr(config); return snapshot(); },
    host: async () => {
      const connection = await hostConnection();
      const { devices } = await (await adminRequest('/api/devices', 'GET', connection)).json() as { devices: unknown[] };
      return { origin: connection.origin, devices: devices.length };
    },
    reaches: async url => {
      try { return (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })).ok; }
      catch { return false; }
    },
    addresses: () => Object.values(networkInterfaces()).flat().flatMap(item => item ? [item.address] : []),
  });
  console.log(report(checks));
  if (checks.some(check => check.status === 'fail')) process.exitCode = 1;
}
