import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { embeddedBuild } from './build-info.ts';
import { projectRoot } from './config.ts';

export const assetSpecs: Record<string, { file: string; type: string; encoding?: 'base64' }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/terminal.js': { file: 'terminal.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
  '/icon-192.png': { file: 'icon-192.png', type: 'image/png', encoding: 'base64' },
  '/icon-512.png': { file: 'icon-512.png', type: 'image/png', encoding: 'base64' },
};
// Text files go out compressed when the browser accepts it: the phone app is several hundred
// kB, and phones are often on a slow connection. Each file is compressed once per build.
const compressed = new Map<string, { key: string; br: Uint8Array<ArrayBuffer>; gzip: Uint8Array<ArrayBuffer> }>();
function compress(path: string, key: string, read: () => Buffer) {
  let entry = compressed.get(path);
  if (entry?.key !== key) {
    const bytes = read();
    entry = { key, br: new Uint8Array(brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })), gzip: Bun.gzipSync(new Uint8Array(bytes), { level: 9 }) };
    compressed.set(path, entry);
  }
  return entry;
}
export function encodingFor(acceptEncoding: string | null) {
  const accepted = (acceptEncoding || '').toLowerCase().split(',').map(item => item.split(';')[0].trim());
  return accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : undefined;
}

export function assetResponse(path: string, headers: Record<string, string>, acceptEncoding: string | null = null): Response | undefined {
  // Own-property lookup keeps prototype names/traversal out of the allowlist.
  if (!Object.hasOwn(assetSpecs, path)) return undefined;
  const asset = assetSpecs[path];
  if (embeddedBuild && !Object.hasOwn(embeddedBuild.assets, path)) throw new Error('Executable is missing a bundled asset');
  const file = join(projectRoot, 'dist', asset.file);
  if (asset.encoding) {
    const body = embeddedBuild ? Buffer.from(embeddedBuild.assets[path], asset.encoding) : Bun.file(file);
    return new Response(body, { headers: { ...headers, 'Content-Type': asset.type } });
  }
  const encoding = encodingFor(acceptEncoding);
  const varied = { ...headers, 'Content-Type': asset.type, Vary: 'Accept-Encoding' };
  if (!encoding) return new Response(embeddedBuild ? embeddedBuild.assets[path] : Bun.file(file), { headers: varied });
  // A source checkout serves dist/ as it is now, so a rebuild there is picked up.
  const key = embeddedBuild ? 'embedded' : String(statSync(file).mtimeMs);
  const entry = compress(path, key, () => embeddedBuild ? Buffer.from(embeddedBuild.assets[path]) : readFileSync(file));
  return new Response(entry[encoding], { headers: { ...varied, 'Content-Encoding': encoding } });
}
