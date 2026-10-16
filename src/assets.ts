import { join } from 'node:path';
import { embeddedBuild } from './build-info.ts';
import { projectRoot } from './config.ts';

export const assetSpecs: Record<string, { file: string; type: string; encoding?: 'base64' }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
  '/icon-192.png': { file: 'icon-192.png', type: 'image/png', encoding: 'base64' },
  '/icon-512.png': { file: 'icon-512.png', type: 'image/png', encoding: 'base64' },
};
export function assetResponse(path: string, headers: Record<string, string>): Response | undefined {
  // Own-property lookup keeps prototype names/traversal out of the allowlist.
  if (!Object.hasOwn(assetSpecs, path)) return undefined;
  const asset = assetSpecs[path];
  if (embeddedBuild && !Object.hasOwn(embeddedBuild.assets, path)) throw new Error('Executable is missing a bundled asset');
  const body = embeddedBuild
    ? asset.encoding ? Buffer.from(embeddedBuild.assets[path], asset.encoding) : embeddedBuild.assets[path]
    : Bun.file(join(projectRoot, 'dist', asset.file));
  return new Response(body, { headers: { ...headers, 'Content-Type': asset.type } });
}
