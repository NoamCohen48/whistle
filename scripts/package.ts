/// <reference types="bun" />
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assetSpecs } from '../src/assets.ts';
import { projectRoot } from '../src/config.ts';
import type { EmbeddedBuild } from '../src/build-info.ts';

async function revision() {
  const head = Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { cwd: projectRoot, stdout: 'pipe', stderr: 'ignore' });
  const value = (await new Response(head.stdout).text()).trim();
  if (await head.exited !== 0) return 'unknown';
  const status = Bun.spawn(['git', 'status', '--porcelain'], { cwd: projectRoot, stdout: 'pipe', stderr: 'ignore' });
  const dirty = (await new Response(status.stdout).text()).trim();
  if (await status.exited !== 0) return value;
  return value + (dirty ? '-dirty' : '');
}
// --target linux-arm64 cross-compiles; the default is the machine running the build.
const targetFlag = process.argv.indexOf('--target');
const target = targetFlag === -1 ? `${process.platform}-${process.arch}` : process.argv[targetFlag + 1];
if (!/^linux-(?:x64|arm64)$/.test(target)) throw new Error(`Unsupported target: ${target}. Use linux-x64 or linux-arm64.`);
await mkdir(join(projectRoot, '.runtime'), { recursive: true, mode: 0o700 });
const staging = await mkdtemp(join(projectRoot, '.runtime', 'package-'));
try {
  const assets: Record<string, string> = {};
  for (const [path, asset] of Object.entries(assetSpecs)) assets[path] = (await readFile(join(projectRoot, 'dist', asset.file))).toString(asset.encoding || 'utf8');
  if (!assets['/'].includes('src="/app.js"') || !assets['/'].includes('href="/app.css"')) throw new Error('Build the Vite frontend before packaging');
  const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { version: string };
  const info: EmbeddedBuild = { version: pkg.version, revision: await revision(), target, assets };
  const bundle = await Bun.build({
    entrypoints: [join(projectRoot, 'src/cli.ts')], outdir: staging, target: 'bun',
    packages: 'bundle', splitting: false, minify: true,
    define: { WHISTLE_BUILD: JSON.stringify(info) },
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, 'Standalone host bundling failed');
  const executable = join(staging, 'whistle');
  const compile = Bun.spawn([process.execPath, 'build', join(staging, 'cli.js'), '--compile', '--minify', '--reject-unresolved',
    '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--no-compile-autoload-tsconfig',
    '--no-compile-autoload-package-json', '--env=disable', `--target=bun-${target}`, '--outfile', executable], { cwd: projectRoot, stdout: 'inherit', stderr: 'inherit' });
  if (await compile.exited !== 0) throw new Error('Standalone compilation failed');
  await chmod(executable, 0o755);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  const checksum = hash.digest('hex');
  const outputDir = targetFlag === -1 ? join(projectRoot, 'dist') : join(projectRoot, 'dist', target);
  await mkdir(outputDir, { recursive: true });
  const output = join(outputDir, 'whistle');
  await rename(executable, output);
  await writeFile(output + '.sha256', `${checksum}  whistle\n`, { mode: 0o644 });
  console.log(`Standalone executable: ${output}\nBuild: ${info.version} ${info.revision} ${info.target}\nSHA-256: ${checksum}`);
} finally { await rm(staging, { recursive: true, force: true }); }
