/// <reference types="bun" />
// The AUR package, whistle-herdr-bin, made from a release's SHA256SUMS. ("whistle" on the
// AUR is an unrelated program.) It installs the released executable as it is.
//
//   bun run scripts/aur.ts VERSION SHA256SUMS OUT_DIR
//
// scripts/release.ts runs this for every release; the release workflow pushes the result
// to the AUR when an AUR_SSH_KEY secret is set.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const AUR_NAME = 'whistle-herdr-bin';
const arches = { x86_64: 'linux-x64', aarch64: 'linux-arm64' } as const;
const description = 'Phone remote for the coding agents you run in Herdr';
const optdepends = ['herdr: the terminal workspace Whistle controls', 'tailscale: the private network your phone uses', 'git: reviewing changes from the phone'];

export function parseSums(text: string) {
  return new Map(text.trim().split('\n').map(line => {
    const [sum, name] = line.split(/\s+\*?/);
    return [name, sum] as const;
  }));
}

export function aurFiles(version: string, repository: string, sums: Map<string, string>) {
  // Prereleases like 1.0.0-rc.1 are not valid pkgver values.
  const pkgver = version.replace(/-/g, '_');
  const url = `https://github.com/${repository}`;
  const sources = Object.entries(arches).map(([arch, target]) => {
    const file = `whistle-${target}.tar.gz`;
    const sum = sums.get(file);
    if (!sum) throw new Error(`SHA256SUMS has no ${file}`);
    return { arch, source: `whistle-${version}-${target}.tar.gz::${url}/releases/download/v${version}/${file}`, sum };
  });
  const list = (values: string[]) => `(${values.map(value => `'${value}'`).join(' ')})`;
  const pkgbuild = `# Maintainer: Noam Cohen <92931230+NoamCohen48@users.noreply.github.com>
# Made by scripts/aur.ts in ${url}; changes belong there.
pkgname=${AUR_NAME}
pkgver=${pkgver}
pkgrel=1
pkgdesc='${description}'
arch=${list(Object.keys(arches))}
url='${url}'
license=('MIT')
optdepends=${list(optdepends)}
provides=('whistle-herdr')
conflicts=('whistle')
# The executable carries its own Bun runtime and app; stripping it breaks it.
options=('!strip' '!debug')
${sources.map(({ arch, source }) => `source_${arch}=('${source}')`).join('\n')}
${sources.map(({ arch, sum }) => `sha256sums_${arch}=('${sum}')`).join('\n')}

package() {
  local target
  case "$CARCH" in
    x86_64) target=linux-x64 ;;
    aarch64) target=linux-arm64 ;;
  esac
  cd "whistle-${version}-$target"
  install -Dm755 whistle "$pkgdir/usr/bin/whistle"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
  install -Dm644 README.md "$pkgdir/usr/share/doc/$pkgname/README.md"
}
`;
  const srcinfo = [
    `pkgbase = ${AUR_NAME}`,
    `\tpkgdesc = ${description}`,
    `\tpkgver = ${pkgver}`,
    '\tpkgrel = 1',
    `\turl = ${url}`,
    ...Object.keys(arches).map(arch => `\tarch = ${arch}`),
    '\tlicense = MIT',
    ...optdepends.map(value => `\toptdepends = ${value}`),
    '\tprovides = whistle-herdr',
    '\tconflicts = whistle',
    '\toptions = !strip',
    '\toptions = !debug',
    ...sources.flatMap(({ arch, source, sum }) => [`\tsource_${arch} = ${source}`, `\tsha256sums_${arch} = ${sum}`]),
    '',
    `pkgname = ${AUR_NAME}`,
    '',
  ].join('\n');
  return { PKGBUILD: pkgbuild, '.SRCINFO': srcinfo };
}

export async function writeAur(version: string, repository: string, sums: Map<string, string>, out: string) {
  await mkdir(out, { recursive: true });
  for (const [name, text] of Object.entries(aurFiles(version, repository, sums))) await writeFile(join(out, name), text);
}

if (import.meta.main) {
  const [version, sumsPath, out] = process.argv.slice(2);
  if (!version || !sumsPath || !out) throw new Error('Usage: bun run scripts/aur.ts VERSION SHA256SUMS OUT_DIR');
  const pkg = JSON.parse(await readFile(join(import.meta.dir, '..', 'package.json'), 'utf8')) as { repository: { url: string } };
  const repository = process.env.GITHUB_REPOSITORY || pkg.repository.url.replace(/^https:\/\/github\.com\/|\.git$/g, '');
  await writeAur(version, repository, parseSums(await readFile(sumsPath, 'utf8')), out);
}
