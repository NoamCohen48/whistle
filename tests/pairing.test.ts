import { describe, expect, test } from 'bun:test';
import { PairingTickets } from '../src/pairing.ts';

describe('QR pairing tickets', () => {
  test('works once, never twice', () => {
    const tickets = new PairingTickets();
    const { ticket } = tickets.create();
    expect(tickets.redeem(ticket)).toBe(true);
    expect(tickets.redeem(ticket)).toBe(false);
  });
  test('expires in five minutes', () => {
    let now = 0;
    const tickets = new PairingTickets(() => now);
    const { ticket, expiresAt } = tickets.create();
    expect(expiresAt).toBe(300_000);
    now = 300_000;
    expect(tickets.redeem(ticket)).toBe(false);
  });
  test('generating a new QR invalidates the previous one', () => {
    const tickets = new PairingTickets();
    const first = tickets.create();
    const second = tickets.create();
    expect(tickets.redeem(first.ticket)).toBe(false);
    expect(tickets.redeem(second.ticket)).toBe(true);
  });
  test('invalid input does not consume a valid ticket', () => {
    const tickets = new PairingTickets();
    const { ticket } = tickets.create();
    for (const invalid of [undefined, null, {}, 42, 'invalid']) expect(tickets.redeem(invalid)).toBe(false);
    expect(tickets.redeem(ticket)).toBe(true);
  });
});
