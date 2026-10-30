import { timingSafeEqual } from 'node:crypto';

const LIMIT = 10;
const WINDOW_MS = 60_000;

// Checks the PC access token, for the whistle command and for logging in with the token.
// Ten wrong tokens from one address within a minute pause token checks from that address for
// a minute. Behind an HTTPS proxy every request comes from the proxy's address, so the pause
// applies to everyone; pairing with a QR code does not use the token and keeps working.
export class AccessTokenGuard {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly token: string, private readonly now = Date.now) {}

  check(address: string, candidate: unknown): 'ok' | 'wrong' | 'paused' {
    const failure = this.failures.get(address);
    const recent = failure && failure.until > this.now() ? failure : undefined;
    if (recent && recent.count >= LIMIT) return 'paused';
    if (this.matches(candidate)) { this.failures.delete(address); return 'ok'; }
    const count = (recent?.count ?? 0) + 1;
    this.failures.set(address, { count, until: this.now() + WINDOW_MS });
    if (count === LIMIT) console.warn(`Whistle: ${LIMIT} wrong access tokens from ${address} within a minute; token checks from there are paused for a minute.`);
    return 'wrong';
  }

  sweep() {
    for (const [address, failure] of this.failures) if (failure.until < this.now()) this.failures.delete(address);
  }

  private matches(candidate: unknown) {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate), b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
