import { parseArgs } from 'node:util';
import { adminRequest } from './credentials.ts';
import { showPairing } from './pair.ts';
import { installService, serviceAction, uninstallService } from './service.ts';
import type { Device } from './devices.ts';

const help = `Whistle — personal Herdr terminal remote

  whistle install [--host IP] [--port PORT] [--herdr-socket PATH] [--now]
  whistle start | stop | restart | status | uninstall
  whistle serve
  whistle pair
  whistle devices
  whistle revoke DEVICE_ID

Install enables a systemd user service at login; --now also starts it immediately.
It never changes firewall rules, enables lingering, or stops Herdr/agents.
Uninstall stops only Whistle and preserves configuration and paired devices.
This checkout-based installation requires its directory and Bun to stay in place.
`;

export async function main(args = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    host: { type: 'string' }, port: { type: 'string' }, 'herdr-socket': { type: 'string' },
    now: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0] || 'help';
  if (values.help || command === 'help') { console.log(help); return; }
  if (command !== 'install' && [values.host, values.port, values['herdr-socket'], values.now].some(value => value !== undefined)) {
    throw new Error('Installation flags apply only to whistle install');
  }
  if (positionals.length !== (command === 'revoke' ? 2 : 1)) throw new Error('Unexpected or missing arguments; use whistle --help');
  switch (command) {
    case 'install': {
      const { paths, config } = await installService({ host: values.host, port: values.port, herdrSocket: values['herdr-socket'], now: values.now });
      console.log(`Installed ${paths.launcher}\nEnabled whistle.service at login${values.now ? ' and started it' : '; not started yet'}.`);
      console.log(`Bind: ${config.host}:${config.port}\nConfig: ${paths.configFile}\nState: ${paths.stateDir}`);
      console.log('No firewall or lingering changes. Keep this checkout and Bun in place.');
      return;
    }
    case 'start': case 'stop': case 'restart': case 'status':
      console.log(await serviceAction(command)); return;
    case 'uninstall': {
      const paths = await uninstallService();
      console.log(`Whistle service removed. Preserved ${paths.configDir} and ${paths.stateDir}.`); return;
    }
    case 'serve': await import('./server.ts'); return;
    case 'pair': await showPairing(); return;
    case 'devices': {
      const { devices } = await (await adminRequest('/api/devices')).json() as { devices: Device[] };
      if (!devices.length) console.log('No paired devices.');
      for (const device of devices) console.log(`${device.id}  ${JSON.stringify(device.name)}  expires ${new Date(device.expiresAt).toISOString()}`);
      return;
    }
    case 'revoke':
      if (!/^[0-9a-f-]{36}$/.test(positionals[1])) throw new Error('Use a device ID from whistle devices');
      await adminRequest(`/api/devices/${positionals[1]}`, 'DELETE');
      console.log('Device revoked; its live terminal connections were released.'); return;
    default: throw new Error(`Unknown command: ${command}. Use whistle --help.`);
  }
}
if (import.meta.main) {
  try { await main(); }
  catch (cause) { console.error(`Whistle: ${(cause as Error).message}`); process.exitCode = 1; }
}
