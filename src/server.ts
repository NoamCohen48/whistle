import { join } from 'node:path';
import { AgentWatcher, alertSender } from './alerts.ts';
import { AccessTokenGuard } from './auth.ts';
import { pairCommand } from './build-info.ts';
import { loadHostConfig, resolvePaths } from './config.ts';
import { DeviceStore } from './devices.ts';
import { HerdrUnavailable, snapshot, useHerdr } from './herdr.ts';
import { PairingTickets } from './pairing-tickets.ts';
import { PushStore } from './push-store.ts';
import { createRequestHandler } from './routes.ts';
import { TerminalSockets, type Peer } from './terminal-socket.ts';
import { ensureToken, prepareStateDir, stateFiles, writeServerUrl } from './state-files.ts';
import { MAX_UPLOAD_BYTES, sweepUploads } from './uploads.ts';
import { VapidKeys, webPushSender } from './webpush.ts';

// The Whistle host: serves the phone app and its API, streams terminals, and sends alerts,
// until SIGTERM or SIGINT.
export async function startServer() {
  const paths = resolvePaths();
  const config = loadHostConfig(paths);
  useHerdr(config);
  await prepareStateDir(paths);
  const tokens = new AccessTokenGuard(await ensureToken(paths));
  const devices = new DeviceStore(join(paths.stateDir, 'devices.sqlite'));
  const pushStore = new PushStore(join(paths.stateDir, 'push.sqlite'));
  const vapid = new VapidKeys(join(paths.stateDir, 'push-vapid.json'), config.publicOrigin || 'mailto:whistle@localhost.invalid');
  const sendAlert = alertSender(deviceId => pushStore.get(deviceId), webPushSender(vapid));
  const sockets = new TerminalSockets(deviceId => devices.isActive(deviceId));
  const uploadDir = join(paths.stateDir, 'uploads');

  const server = Bun.serve<Peer>({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: MAX_UPLOAD_BYTES,
    fetch: createRequestHandler({ config, devices, tickets: new PairingTickets(), tokens, pushStore, vapid, sendAlert, sockets, uploadDir }),
    websocket: sockets.handlers,
  });

  const sweeper = setInterval(() => {
    devices.sweep();
    sockets.closeInactive();
    tokens.sweep();
    void sweepUploads(uploadDir);
  }, 60_000);
  sweeper.unref();
  // Polls Herdr only while at least one device has alerts on.
  const watcher = new AgentWatcher({
    snapshot, subscribers: () => pushStore.all(), send: sendAlert,
    isActive: deviceId => devices.isActive(deviceId),
    isWatching: (deviceId, paneId) => sockets.isWatching(deviceId, paneId),
    onGone: deviceId => pushStore.remove(deviceId),
    settings: deviceId => pushStore.settings(deviceId),
    onError: error => {
      // Herdr restarting is routine; the next tick tries again.
      if (!(error instanceof HerdrUnavailable)) console.error(`Whistle alert not delivered: ${error.message}`);
    },
  });
  watcher.start(3000);

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const released = sockets.closeAll();
    clearInterval(sweeper);
    watcher.stop();
    await server.stop(true);
    // Let controller CLI children flush terminal.release before the host exits.
    // These are Whistle streams, never the Herdr daemon or agent processes.
    await Promise.race([released, Bun.sleep(1500)]);
    devices.close();
    pushStore.close();
    process.exit(0);
  }
  const stop = () => { void shutdown().catch(cause => { console.error(`Whistle shutdown: ${(cause as Error).message}`); process.exit(1); }); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const boundHost = server.hostname || config.host;
  const serverUrl = `http://${boundHost.includes(':') ? `[${boundHost}]` : boundHost}:${server.port}`;
  await writeServerUrl(paths, serverUrl);
  console.log(`Whistle: ${serverUrl}`);
  console.log(`Pair your phone: ${pairCommand} (single-use QR, valid for 5 minutes)`);
  console.log(`Access token: ${process.env.WHISTLE_TOKEN ? 'provided by WHISTLE_TOKEN' : join(paths.stateDir, stateFiles.accessToken)} (not included in URLs or logs)`);
}

if (import.meta.main) await startServer();
