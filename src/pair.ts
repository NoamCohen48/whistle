import { chmod, readFile } from 'node:fs/promises';
import QRCode from 'qrcode';

try {
  const base = (process.env.WHISTLE_URL || await readFile('.runtime/server-url', 'utf8')).trim();
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WHISTLE_URL must use HTTP or HTTPS');
  const token = process.env.WHISTLE_TOKEN || (await readFile('.runtime/access-token', 'utf8')).trim();
  const response = await fetch(`${url.origin}/api/pairing-ticket`, {
    method: 'POST',
    headers: { Origin: url.origin, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(await response.text());
  const pairing: { url: string; expiresAt: number } = await response.json();
  await QRCode.toFile('.runtime/pair.png', pairing.url, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
  await chmod('.runtime/pair.png', 0o600);
  // This terminal output intentionally contains a temporary credential as a QR, not the PC token.
  console.log(await QRCode.toString(pairing.url, { type: 'terminal', small: true }));
  console.log('Scan with your phone camera to pair. Valid for 5 minutes, one use only.');
  console.log('Image: .runtime/pair.png');
  console.log(`Expires: ${new Date(pairing.expiresAt).toLocaleTimeString()}. Creating a new QR invalidates the previous one.`);
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    console.log('This server is loopback-only. For phone pairing, start it bound to your existing Tailscale IP.');
  }
} catch (error) {
  console.error(`Could not create pairing QR: ${(error as Error).message}. Make sure Whistle is running.`);
  process.exitCode = 1;
}
