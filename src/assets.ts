import { join } from 'node:path';
import { embeddedBuild } from './build-info.ts';
import { projectRoot } from './config.ts';

export const assetSpecs: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
};
export function assetResponse(path: string, headers: Record<string, string>): Response | undefined {
  // Own-property lookup keeps prototype names/traversal out of the allowlist.
  if (!Object.hasOwn(assetSpecs, path)) return undefined;
  const asset = assetSpecs[path];
  if (embeddedBuild && !Object.hasOwn(embeddedBuild.assets, path)) throw new Error('Executable is missing a bundled asset');
  const body = embeddedBuild ? embeddedBuild.assets[path] : Bun.file(join(projectRoot, 'dist', asset.file));
  return new Response(body, { headers: { ...headers, 'Content-Type': asset.type } });
}
