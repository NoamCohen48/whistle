import { clearDrafts } from './drafts.ts';

export class PairingRequired extends Error {
  constructor() {
    super('This browser’s pairing expired or was revoked. Pair again from your PC.');
    clearDrafts();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('whistle-pairing-lost'));
  }
}

export class RequestError extends Error {
  constructor(message: string, public readonly status = 0) { super(message); }
}

export const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'The request failed. Try again.';

// Never automatically retry mutations: a lost reply does not mean the PC did not act.
export async function request(path: string, options: RequestInit = {}, pairing = true): Promise<Response> {
  const mutation = Boolean(options.method && options.method !== 'GET');
  const timeout = AbortSignal.timeout(mutation ? 30_000 : 12_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(path, { cache: 'no-store', ...options, signal }); }
  catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new RequestError(timeout.aborted
      ? mutation ? 'The PC did not reply in time. The action may have completed. Refresh and check before trying again.' : 'The PC did not reply in time. Check Tailscale and retry.'
      : mutation ? 'Connection lost. The action may have completed. Refresh and check before trying again.' : 'Cannot reach your PC. Check its connection and that Tailscale is on, then retry.');
  }
  if (response.status === 401 && pairing) throw new PairingRequired();
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim();
    throw new RequestError(detail || (response.status >= 500 ? 'The PC could not complete this request. Try again shortly.' : `Request refused (${response.status}). Refresh and try again.`), response.status);
  }
  return response;
}
