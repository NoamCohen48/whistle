import { request as httpRequest } from './request.ts';
import type { AlertSettings } from '../src/alerts.ts';

export type { AlertSettings };

// "Needs you" alerts. Production builds only: they need the install-support service worker,
// which Vite development deliberately never registers.
export type AlertState = 'unsupported' | 'off' | 'on' | 'blocked';

export function alertsSupported() {
  return import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

async function request(method: string, path = '/api/push', body?: unknown) {
  const response = await httpRequest(path, {
    method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  return response;
}
const sameKey = (subscription: PushSubscription, publicKey: string) => {
  const key = subscription.options.applicationServerKey;
  return Boolean(key) && btoa(String.fromCharCode(...new Uint8Array(key!))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === publicKey;
};
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

export async function alertState(): Promise<AlertState> {
  if (!alertsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const { subscribed } = await (await request('GET')).json() as { subscribed: boolean };
  const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  return subscribed && subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enableAlerts() {
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notifications are blocked for this site. Allow them in your browser’s site settings.');
  }
  const { publicKey } = await (await request('GET')).json() as { publicKey: string };
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A new PC key (state reset) invalidates the old subscription.
  if (subscription && !sameKey(subscription, publicKey)) { await subscription.unsubscribe(); subscription = null; }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
  await request('PUT', '/api/push', subscription.toJSON());
  // A real alert through the whole path, so a broken route shows up now rather than when it matters.
  await request('POST', '/api/push/test');
}

export async function loadAlertSettings(): Promise<AlertSettings> {
  return ((await (await request('GET')).json()) as { settings: AlertSettings }).settings;
}
export async function saveAlertSettings(settings: AlertSettings) {
  await request('PUT', '/api/push/settings', settings);
}

export async function disableAlerts() {
  await request('DELETE');
  await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe();
}
