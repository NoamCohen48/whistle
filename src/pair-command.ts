import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { adminRequest, hostConnection } from './host-client.ts';

// whistle pair: asks the running host for a single-use pairing link and shows it as a QR code.
export async function showPairing() {
  const connection = await hostConnection();
  const { origin, requestOrigin, directory } = connection;
  const pairing: { url: string; expiresAt: number } = await (await adminRequest('/api/pairing-ticket', 'POST', connection)).json();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const image = join(directory, 'pair.png');
  await QRCode.toFile(image, pairing.url, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
  await chmod(image, 0o600);
  console.log(await QRCode.toString(pairing.url, { type: 'terminal', small: true }));
  console.log('Scan with your phone camera to pair. Valid for 5 minutes, one use only.');
  console.log(`Image: ${image}`);
  console.log(`Expires: ${new Date(pairing.expiresAt).toLocaleTimeString()}. Creating a new QR invalidates the previous one.`);
  if (requestOrigin === origin && /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(origin)) {
    console.log('Loopback-only host. For phone access, bind explicitly to your existing Tailscale IP.');
  }
}
if (import.meta.main) {
  try { await showPairing(); }
  catch (cause) { console.error(`Could not create pairing QR: ${(cause as Error).message}. Make sure Whistle is running.`); process.exitCode = 1; }
}
