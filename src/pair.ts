import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { hostConnection } from './credentials.ts';

export async function showPairing() {
  const { origin, token, directory } = await hostConnection();
  const response = await fetch(`${origin}/api/pairing-ticket`, {
    method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(await response.text());
  const pairing: { url: string; expiresAt: number } = await response.json();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const image = join(directory, 'pair.png');
  await QRCode.toFile(image, pairing.url, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
  await chmod(image, 0o600);
  console.log(await QRCode.toString(pairing.url, { type: 'terminal', small: true }));
  console.log('Scan with your phone camera to pair. Valid for 5 minutes, one use only.');
  console.log(`Image: ${image}`);
  console.log(`Expires: ${new Date(pairing.expiresAt).toLocaleTimeString()}. Creating a new QR invalidates the previous one.`);
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(origin)) {
    console.log('Loopback-only host. For phone access, bind explicitly to your existing Tailscale IP.');
  }
}
if (import.meta.main) {
  try { await showPairing(); }
  catch (cause) { console.error(`Could not create pairing QR: ${(cause as Error).message}. Make sure Whistle is running.`); process.exitCode = 1; }
}
