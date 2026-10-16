import type { Snapshot } from '../src/herdr.ts';

export class PairingRequired extends Error {
  constructor() { super('Pair this browser first'); }
}
export async function loadPanes(signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch('/api/panes', { signal, cache: 'no-store' });
  if (response.status === 401) throw new PairingRequired();
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
export async function pairBrowser(path: '/api/login' | '/api/redeem-pairing', credential: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credential),
  });
  if (!response.ok) throw new Error(await response.text());
}
export interface Startup { snapshot?: Snapshot; error: string }
// Called once before React mounts: Strict Mode must not redeem a single-use ticket twice.
export async function prepareSession(ticket: string | null): Promise<Startup> {
  let error = '';
  if (ticket) {
    try { await pairBrowser('/api/redeem-pairing', { ticket }); }
    catch (cause) { error = (cause as Error).message; }
  }
  try { return { snapshot: await loadPanes(), error }; }
  catch (cause) { return { error: error || (cause instanceof PairingRequired ? '' : (cause as Error).message) }; }
}
