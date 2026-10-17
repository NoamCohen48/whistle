import { PairingRequired } from './api.ts';

// Pictures for an agent. Re-encoding on the phone keeps uploads small over the tailnet and
// drops camera metadata (location, device) before anything leaves the phone.
const MAX_SIDE = 1920;
const THUMB_SIDE = 96;
// Previews of pictures attached in this page, keyed by their path on the PC. A path typed or
// restored from an earlier visit just shows without a preview.
const previews = new Map<string, string>();
export const previewFor = (path: string) => previews.get(path);

function canvasFor(image: ImageBitmap, side: number) {
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
const blob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('This picture could not be read.')), type, quality));

async function shrink(file: Blob) {
  let image: ImageBitmap;
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This file is not a picture Whistle can read.'); }
  try {
    const canvas = canvasFor(image, MAX_SIDE);
    // Screenshots stay sharp as PNG; photos are far smaller as JPEG.
    let body = file.type === 'image/png' ? await blob(canvas, 'image/png') : await blob(canvas, 'image/jpeg', .86);
    if (body.size > 4 * 1024 * 1024) body = await blob(canvas, 'image/jpeg', .86);
    return { body, thumbnail: canvasFor(image, THUMB_SIDE).toDataURL('image/jpeg', .7) };
  } finally { image.close(); }
}

export async function attachPicture(file: Blob): Promise<string> {
  const { body, thumbnail } = await shrink(file);
  const response = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': body.type }, body });
  if (response.status === 401) throw new PairingRequired();
  if (!response.ok) throw new Error(await response.text());
  const { path } = await response.json() as { path: string };
  previews.set(path, thumbnail);
  return path;
}

// Paths Whistle saved, as they appear in a draft. Used to show what is attached.
export const attachedPaths = (draft: string) => [...new Set(draft.match(/(?:^|\s)(\/\S+\/uploads\/\d{8}-\d{6}-[0-9a-f]{8}\.(?:png|jpg|webp|gif))(?=\s|$)/g)
  ?.map(match => match.trim()) ?? [])];
