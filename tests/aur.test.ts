import { expect, test } from 'bun:test';
import { aurFiles, parseSums } from '../scripts/aur.ts';

const sums = parseSums(`${'a'.repeat(64)}  whistle-linux-x64.tar.gz\n${'b'.repeat(64)}  whistle-linux-arm64.tar.gz\n${'c'.repeat(64)}  install.sh\n`);

test('the AUR package installs the released executable of that version, checked by its release checksum', () => {
  const { PKGBUILD, '.SRCINFO': srcinfo } = aurFiles('1.2.0', 'NoamCohen48/whistle', sums);
  expect(PKGBUILD).toContain('pkgname=whistle-herdr-bin\npkgver=1.2.0\n');
  expect(PKGBUILD).toContain("source_x86_64=('whistle-1.2.0-linux-x64.tar.gz::https://github.com/NoamCohen48/whistle/releases/download/v1.2.0/whistle-linux-x64.tar.gz')");
  expect(PKGBUILD).toContain(`sha256sums_aarch64=('${'b'.repeat(64)}')`);
  expect(PKGBUILD).toContain("options=('!strip' '!debug')");
  expect(PKGBUILD).toContain('cd "whistle-1.2.0-$target"');
  expect(srcinfo).toContain(`\tsha256sums_x86_64 = ${'a'.repeat(64)}\n`);
  expect(srcinfo.endsWith('pkgname = whistle-herdr-bin\n')).toBe(true);
});

test('prereleases get a valid pkgver, and a missing download is an error', () => {
  expect(aurFiles('1.3.0-rc.1', 'o/r', sums).PKGBUILD).toContain('pkgver=1.3.0_rc.1\n');
  expect(() => aurFiles('1.2.0', 'o/r', parseSums(`${'a'.repeat(64)}  whistle-linux-x64.tar.gz`))).toThrow('SHA256SUMS has no whistle-linux-arm64.tar.gz');
});
