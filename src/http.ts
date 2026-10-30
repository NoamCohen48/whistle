import { HerdrError, HerdrUnavailable } from './herdr.ts';
import { HttpError } from './http-error.ts';

export const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...securityHeaders, ...headers } });
export const json = (value: unknown) => Response.json(value, { headers: securityHeaders });

// The phone's session cookie: never readable by scripts, never sent with requests from other
// sites, and HTTPS-only when Whistle is served over HTTPS.
export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean) {
  return `whistle_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
export function sessionFrom(request: Request) {
  return request.headers.get('cookie')?.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith('whistle_session='))?.slice(16);
}
export const bearerToken = (request: Request) => request.headers.get('authorization')?.replace(/^Bearer /, '');

// Runs a check of the phone's input; whatever it rejects answers 400 with its message.
export function checkInput<T>(check: () => T): T {
  try { return check(); }
  catch (error) { throw error instanceof HttpError ? error : new HttpError((error as Error).message); }
}
export async function readJson<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try { value = await request.json(); }
  catch { throw new HttpError('The request body is not valid JSON.'); }
  return checkInput(() => parse(value));
}

// What the phone sees when a request fails. Only messages written for the phone are passed on;
// anything unexpected is logged on the PC and answered with a generic 500.
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return text(error.message, error.status);
  if (error instanceof HerdrUnavailable) return text(error.message, 503);
  if (error instanceof HerdrError) return text(error.message, 422);
  console.error('Whistle request failed:', error);
  return text('Whistle could not complete this request. The log on the PC has the details.', 500);
}
