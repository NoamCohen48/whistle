/// <reference types="bun" />
// Turns standalone executables into release downloads in dist/release/:
// raw binaries, tarballs, .deb, .rpm and Arch packages, install.sh and SHA256SUMS, plus the
// AUR package's PKGBUILD and .SRCINFO in dist/aur/.
//
//   bun run package -- --target linux-x64 && bun run package -- --target linux-arm64
//   bun run scripts/release.ts linux-x64 linux-arm64
//
// Needs nfpm (https://nfpm.goreleaser.com) on PATH or in $NFPM. File names carry no
// version, so https://github.com/OWNER/REPO/releases/latest/download/NAME always works.
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from '../src/config.ts';
import { parseSums, writeAur } from './aur.ts';

const architectures = {
  'linux-x64': { deb: 'amd64', rpm: 'x86_64', arch: 'x86_64', nfpm: 'amd64' },
  'linux-arm64': { deb: 'arm64', rpm: 'aarch64', arch: 'aarch64', nfpm: 'arm64' },
} as const;
type Target = keyof typeof architectures;

export const releaseFiles = (target: Target) => {
  const names = architectures[target];
  return {
    binary: `whistle-${target}`,
    tarball: `whistle-${target}.tar.gz`,
    deb: `whistle_${names.deb}.deb`,
    rpm: `whistle.${names.rpm}.rpm`,
    archlinux: `whistle-${names.arch}.pkg.tar.zst`,
  };
};

async function run(command: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(command, { cwd: projectRoot, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error(`${command[0]} failed`);
}
async function output(command: string[]) {
  const child = Bun.spawn(command, { cwd: projectRoot, stdout: 'pipe', stderr: 'inherit' });
  const text = (await new Response(child.stdout).text()).trim();
  if (await child.exited !== 0) throw new Error(`${command[0]} failed`);
  return text;
}
async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

if (import.meta.main) {
  const targets = process.argv.slice(2) as Target[];
  if (!targets.length || targets.some(target => !(target in architectures))) {
    throw new Error(`Usage: bun run scripts/release.ts ${Object.keys(architectures).join(' ')}`);
  }
  const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { version: string; repository: { url: string } };
  const repository = process.env.GITHUB_REPOSITORY || pkg.repository.url.replace(/^https:\/\/github\.com\/|\.git$/g, '');
  // Reproducible timestamps inside archives and packages: the commit time, not the build time.
  const epoch = process.env.SOURCE_DATE_EPOCH || await output(['git', 'log', '-1', '--format=%ct']);
  const nfpm = process.env.NFPM || 'nfpm';
  const out = join(projectRoot, 'dist', 'release');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const target of targets) {
    const executable = join(projectRoot, 'dist', target, 'whistle');
    if (target === `${process.platform}-${process.arch}`) {
      const version = await output([executable, '--version']);
      if (!version.startsWith(`Whistle ${pkg.version} `)) throw new Error(`${executable} reports "${version}", expected Whistle ${pkg.version}`);
    }
    const files = releaseFiles(target);
    await copyFile(executable, join(out, files.binary));
    await chmod(join(out, files.binary), 0o755);

    const folder = `whistle-${pkg.version}-${target}`;
    const staging = join(projectRoot, '.runtime', folder);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    for (const name of ['LICENSE', 'README.md']) await copyFile(join(projectRoot, name), join(staging, name));
    await copyFile(executable, join(staging, 'whistle'));
    await chmod(join(staging, 'whistle'), 0o755);
    await run(['tar', '--sort=name', `--mtime=@${epoch}`, '--owner=0', '--group=0', '--numeric-owner',
      '-czf', join(out, files.tarball), '-C', join(projectRoot, '.runtime'), folder], { GZIP: '-n' });
    await rm(staging, { recursive: true, force: true });

    // nfpm reads file paths literally, so each architecture is staged at the same place.
    await mkdir(join(projectRoot, '.runtime', 'nfpm'), { recursive: true });
    await copyFile(executable, join(projectRoot, '.runtime', 'nfpm', 'whistle'));
    for (const packager of ['deb', 'rpm', 'archlinux'] as const) {
      await run([nfpm, 'package', '--config', 'packaging/nfpm.yaml', '--packager', packager, '--target', join(out, files[packager])], {
        VERSION: pkg.version, ARCH: architectures[target].nfpm, SOURCE_DATE_EPOCH: epoch,
      });
    }
  }

  const installer = (await readFile(join(projectRoot, 'packaging', 'install.sh'), 'utf8'))
    .replaceAll('__REPOSITORY__', repository).replaceAll('__VERSION__', pkg.version);
  await writeFile(join(out, 'install.sh'), installer, { mode: 0o755 });

  const names = (await readdir(out)).filter(name => name !== 'SHA256SUMS').sort();
  const sums = await Promise.all(names.map(async name => `${await sha256(join(out, name))}  ${name}`));
  await writeFile(join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  if (targets.length === Object.keys(architectures).length) await writeAur(pkg.version, repository, parseSums(sums.join('\n')), join(projectRoot, 'dist', 'aur'));
  console.log(`Whistle ${pkg.version} for ${repository}:\n${sums.join('\n')}`);
}
