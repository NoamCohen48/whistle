// QR credentials are ephemeral and single-use; the long-lived PC token never goes in a URL.
export class PairingTickets {
  private current?: { ticket: string; expiresAt: number };
  constructor(private readonly now = () => Date.now()) {}

  create() {
    const ticket = crypto.randomUUID();
    const expiresAt = this.now() + 5 * 60_000;
    // Only the newest displayed QR can pair a device.
    this.current = { ticket, expiresAt };
    return { ticket, expiresAt };
  }

  redeem(ticket: unknown): boolean {
    const current = this.current;
    if (!current || typeof ticket !== 'string' || ticket !== current.ticket) return false;
    this.current = undefined;
    return current.expiresAt > this.now();
  }
}
