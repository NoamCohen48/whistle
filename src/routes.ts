import type { Server } from 'bun';
import { agentKinds, isId, parseAction, runAction, worktrees } from './actions.ts';
import { parseSettings, type AlertSender } from './alerts.ts';
import { assetResponse } from './assets.ts';
import type { AccessTokenGuard } from './auth.ts';
import { pairCommand } from './build-info.ts';
import { changes, fileDiff } from './changes.ts';
import type { HostConfig } from './config.ts';
import { stat } from 'node:fs/promises';
import { DEVICE_LIFETIME_MS, deviceName, type DeviceStore } from './devices.ts';
import { listFolders } from './folders.ts';
import { findPane, snapshot, watchSize } from './herdr.ts';
import { isRequestId, Launches } from './launches.ts';
import { HttpError } from './http-error.ts';
import { bearerToken, checkInput, errorResponse, json, readJson, securityHeaders, sessionCookie, sessionFrom, text } from './http.ts';
import type { PairingTickets } from './pairing-tickets.ts';
import { requestPath } from './paths.ts';
import { readPicture } from './pictures.ts';
import { readTextFile } from './text-files.ts';
import { panePreviews } from './previews.ts';
import type { PushStore } from './push-store.ts';
import { TerminalSockets, type Peer } from './terminal-socket.ts';
import { MAX_UPLOAD_BYTES, saveUpload } from './uploads.ts';
import { PushFailed, PushGone, parseSubscription, type VapidKeys } from './webpush.ts';
import type { Device, Snapshot } from '../shared/api.ts';
import { dimensions } from '../shared/protocol.ts';

export interface Services {
  config: HostConfig;
  devices: DeviceStore;
  tickets: PairingTickets;
  tokens: AccessTokenGuard;
  pushStore: PushStore;
  vapid: VapidKeys;
  sendAlert: AlertSender;
  sockets: TerminalSockets;
  uploadDir: string;
  // Herdr's snapshot with each status's start time; tests may leave it out.
  panes?: () => Promise<Snapshot>;
}

// Who may call a route: anyone (pairing itself), the whistle command on the PC with the access
// token, a paired phone, or either of the last two.
type Access = 'public' | 'token' | 'device' | 'device-or-token';
// The paired phone is known for device routes, and may be for device-or-token routes.
interface Context { request: Request; url: URL; server: Server<Peer>; device: Device | null; publicOrigin: string; secure: boolean }
interface DeviceContext extends Context { device: Device }
type Result = Promise<Response | undefined> | Response | undefined;
type Route = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string | RegExp;
  // Requests that change something must come from Whistle's own page.
  sameOrigin: boolean;
} & ({ access: 'device'; handle(context: DeviceContext): Result } | { access: Exclude<Access, 'device'>; handle(context: Context): Result });

const DEVICE_PATH = /^\/api\/devices\/([0-9a-f-]{36})$/;

export function createRequestHandler(services: Services) {
  const { config, devices, tickets, tokens, pushStore, vapid, sendAlert, sockets, uploadDir } = services;

  const paired = (name: string, secure: boolean) => {
    const { credential } = devices.issue(name);
    return text('Paired', 200, { 'Set-Cookie': sessionCookie(credential, DEVICE_LIFETIME_MS / 1000, secure) });
  };
  // The folder Herdr reports for a pane: the only folder a pane's pictures and changes come from.
  const paneFolder = async (paneId: string | null) => {
    const { cwd } = await findPane(paneId);
    if (!cwd?.startsWith('/')) throw new HttpError('Herdr does not report a folder for this pane.', 422);
    if (!(await stat(cwd).then(info => info.isDirectory(), () => false))) throw new HttpError('This pane’s folder no longer exists.', 404);
    return cwd;
  };
  // The access token check for login and for the whistle command; a refusal is thrown.
  const checkToken = (context: Context, candidate: unknown, wrongMessage: string) => {
    const result = tokens.check(context.server.requestIP(context.request)?.address || 'unknown', candidate);
    if (result === 'paused') throw new HttpError('Too many attempts; wait one minute', 429);
    if (result === 'wrong') throw new HttpError(wrongMessage, 401);
  };
  const credentials = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const launches = new Launches();

  const routes: Route[] = [
    // Pairing.
    { method: 'POST', path: '/api/pairing-ticket', access: 'token', sameOrigin: true, handle: ({ publicOrigin }) => {
      const { ticket, expiresAt } = tickets.create();
      // A fragment is not sent in HTTP requests; the phone removes it immediately.
      return json({ url: `${publicOrigin}/#pair=${ticket}`, expiresAt });
    } },
    { method: 'POST', path: '/api/redeem-pairing', access: 'public', sameOrigin: true, handle: async ({ request, secure }) => {
      const body = await readJson(request, credentials);
      const name = checkInput(() => deviceName(body.deviceName, request.headers.get('user-agent') || ''));
      if (!tickets.redeem(body.ticket)) throw new HttpError(`QR expired or already used. Run ${pairCommand} on the PC for a new one.`, 401);
      return paired(name, secure);
    } },
    { method: 'POST', path: '/api/login', access: 'public', sameOrigin: true, handle: async context => {
      const body = await readJson(context.request, credentials);
      const name = checkInput(() => deviceName(body.deviceName, context.request.headers.get('user-agent') || ''));
      checkToken(context, body.token, 'Incorrect access token');
      return paired(name, context.secure);
    } },

    // Paired devices.
    { method: 'GET', path: '/api/devices', access: 'device-or-token', sameOrigin: false, handle: ({ device }) =>
      json({ devices: devices.list().map(item => ({ ...item, current: item.id === device?.id })) }) },
    { method: 'DELETE', path: DEVICE_PATH, access: 'device-or-token', sameOrigin: true, handle: ({ url, device, secure }) => {
      const id = DEVICE_PATH.exec(url.pathname)![1];
      if (!devices.revoke(id)) throw new HttpError('Device not found', 404);
      pushStore.remove(id);
      sockets.disconnect(id, 'This device was revoked. Pair again to reconnect.');
      return text('Revoked', 200, id === device?.id ? { 'Set-Cookie': sessionCookie('', 0, secure) } : {});
    } },

    // Herdr.
    { method: 'GET', path: '/api/panes', access: 'device', sameOrigin: false, handle: async () => json(await (services.panes ?? snapshot)()) },
    { method: 'GET', path: '/api/previews', access: 'device', sameOrigin: false, handle: async () => json(await panePreviews((await snapshot()).panes)) },
    { method: 'GET', path: '/api/agents', access: 'device', sameOrigin: false, handle: async () => json({ kinds: await agentKinds() }) },
    { method: 'GET', path: '/api/worktrees', access: 'device', sameOrigin: false, handle: async ({ url }) => {
      const workspaceId = url.searchParams.get('workspace') || '';
      if (!isId(workspaceId)) throw new HttpError('Invalid workspace');
      return json({ worktrees: await worktrees(workspaceId) });
    } },
    { method: 'POST', path: '/api/actions', access: 'device', sameOrigin: true, handle: async ({ request, device }) => {
      const { action, requestId } = await readJson(request, body => ({
        action: parseAction(body), requestId: isRequestId(credentials(body).requestId) ? credentials(body).requestId as string : undefined,
      }));
      return json(await launches.run(device.id, requestId, action, () => runAction(action)));
    } },
    { method: 'GET', path: '/terminal', access: 'device', sameOrigin: true, handle: async ({ request, url, server, device }) => {
      const paneId = url.searchParams.get('pane') || '';
      const mode = url.searchParams.get('mode') === 'control' ? 'control' : 'observe';
      const pane = await findPane(paneId);
      if (mode === 'control' && sockets.isControlled(paneId)) throw new HttpError('Already controlled by another Whistle browser', 409);
      const size = mode === 'control'
        ? checkInput(() => dimensions(Number(url.searchParams.get('cols')), Number(url.searchParams.get('rows'))))
        : await watchSize(pane);
      const upgraded = server.upgrade(request, { data: TerminalSockets.peer(device.id, paneId, mode, size) });
      return upgraded ? undefined : text('WebSocket upgrade required', 400);
    } },

    // Files on the PC.
    { method: 'GET', path: '/api/folders', access: 'device', sameOrigin: false, handle: async ({ url }) =>
      json(await listFolders(url.searchParams.get('path') || '~')) },
    { method: 'GET', path: '/api/picture', access: 'device', sameOrigin: false, handle: async ({ url }) => {
      const picture = await readPicture(await paneFolder(url.searchParams.get('pane')), url.searchParams.get('path'));
      return new Response(picture.bytes, { headers: { ...securityHeaders, 'Content-Type': picture.type,
        'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    } },
    { method: 'GET', path: '/api/changes', access: 'device', sameOrigin: false, handle: async ({ url }) =>
      json(await changes(await paneFolder(url.searchParams.get('pane')))) },
    { method: 'GET', path: '/api/changes/file', access: 'device', sameOrigin: false, handle: async ({ url }) =>
      json(await fileDiff(await paneFolder(url.searchParams.get('pane')), requestPath(url.searchParams.get('path')))) },
    { method: 'GET', path: '/api/file', access: 'device', sameOrigin: false, handle: async ({ url }) =>
      new Response(await readTextFile(await paneFolder(url.searchParams.get('pane')), url.searchParams.get('path')), { headers: { ...securityHeaders,
        'Content-Type': 'text/plain; charset=utf-8', 'Cross-Origin-Resource-Policy': 'same-origin' } }) },
    { method: 'POST', path: '/api/uploads', access: 'device', sameOrigin: true, handle: async ({ request, url }) =>
      json({ path: await saveUpload(uploadDir, request.headers.get('content-type') || '', Buffer.from(await request.arrayBuffer()), new Date(), url.searchParams.get('name')) }) },

    // Alerts.
    { method: 'GET', path: '/api/push', access: 'device', sameOrigin: false, handle: ({ device }) =>
      json({ publicKey: vapid.publicKey, subscribed: Boolean(pushStore.get(device.id)), settings: pushStore.settings(device.id) }) },
    { method: 'PUT', path: '/api/push', access: 'device', sameOrigin: true, handle: async ({ request, device }) => {
      pushStore.save(device.id, await readJson(request, parseSubscription));
      return text('Subscribed');
    } },
    { method: 'DELETE', path: '/api/push', access: 'device', sameOrigin: true, handle: ({ device }) => {
      pushStore.remove(device.id);
      return text('Unsubscribed');
    } },
    { method: 'PUT', path: '/api/push/settings', access: 'device', sameOrigin: true, handle: async ({ request, device }) => {
      const settings = await readJson(request, parseSettings);
      if (!pushStore.saveSettings(device.id, settings)) throw new HttpError('Turn on alerts first', 409);
      return json({ settings });
    } },
    { method: 'POST', path: '/api/push/test', access: 'device', sameOrigin: true, handle: async ({ device }) => {
      if (!pushStore.get(device.id)) throw new HttpError('Turn on alerts first', 409);
      try {
        await sendAlert(device.id, { title: 'Alerts are on', body: 'Whistle will tell you when an agent needs you.', paneId: '' });
      } catch (error) {
        if (error instanceof PushGone) {
          pushStore.remove(device.id);
          throw new HttpError('This phone’s alert subscription has expired. Turn alerts on again.', 410);
        }
        if (error instanceof PushFailed) throw new HttpError(`Could not reach the push service: ${error.message}`, 502);
        throw error;
      }
      return text('Sent');
    } },
  ];

  // Whether the request may use the route, and the paired phone making it if there is one.
  // A refusal is thrown as an HttpError.
  const authorize = (route: Route, context: Context): Device | null => {
    if (route.sameOrigin && context.request.headers.get('origin') !== context.publicOrigin) throw new HttpError('Origin rejected', 403);
    if (route.access === 'public') return null;
    if (route.access !== 'token') {
      const device = devices.authenticate(sessionFrom(context.request));
      if (device) return device;
      if (route.access === 'device' || !context.request.headers.has('authorization')) throw new HttpError('Pair this browser first', 401);
    }
    checkToken(context, bearerToken(context.request), route.access === 'token' ? 'PC access token required' : 'Pair this browser first');
    return null;
  };

  return async function handle(request: Request, server: Server<Peer>) {
    try {
      const url = new URL(request.url);
      // Pictures are the only large bodies; every other route keeps the small limit, and a
      // body must declare its length so it can be refused before it is read.
      const bodyLimit = url.pathname === '/api/uploads' ? MAX_UPLOAD_BYTES : 4096;
      if (request.headers.has('transfer-encoding') || Number(request.headers.get('content-length') || 0) > bodyLimit) {
        return text('Request too large', 413);
      }
      const atPath = routes.filter(route => typeof route.path === 'string' ? route.path === url.pathname : route.path.test(url.pathname));
      if (!atPath.length) {
        // Everything else is the phone app's own files.
        return (request.method === 'GET' && assetResponse(url.pathname, securityHeaders)) || text('Not found', 404);
      }
      const route = atPath.find(item => item.method === request.method);
      if (!route) return text('Method not allowed', 405);
      // Explicit operator configuration, never client-supplied Forwarded headers.
      const publicOrigin = config.publicOrigin || url.origin;
      const context: Context = { request, url, server, device: null, publicOrigin, secure: publicOrigin.startsWith('https:') };
      const device = authorize(route, context);
      if (route.access === 'device') return await route.handle({ ...context, device: device! }); // authorize refused it otherwise.
      return await route.handle({ ...context, device });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
