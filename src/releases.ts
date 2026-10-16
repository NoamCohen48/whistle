import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error(`Refusing a non-directory or symlink release directory: ${path}`);
  await chmod(path, 0o700);
}
async function verifyExisting(path: string, checksum: string) {
  const info = await lstat(path);
  if (!info.isFile() || await digest(path) !== checksum) throw new Error(`Not a matching Whistle release; refusing to modify ${path}`);
  await chmod(path, 0o700);
}
/** Publish a verified immutable release without overwriting a running executable. */
export async function installExecutable(source: string, dataDir: string) {
  const checksum = await digest(source);
  const releases = join(dataDir, 'releases');
  const directory = join(releases, checksum);
  for (const path of [dataDir, releases, directory]) await privateDirectory(path);
  const destination = join(directory, 'whistle');
  try {
    await verifyExisting(destination, checksum);
    return destination; // Includes re-installation from this very executable.
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  const temporary = join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await chmod(temporary, 0o700);
    if (await digest(temporary) !== checksum) throw new Error('Executable changed during installation; retry from a stable download');
    // Exclusive publication: even concurrent installs cannot replace a foreign file.
    try { await link(temporary, destination); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      await verifyExisting(destination, checksum);
    }
    return destination;
  } finally { await rm(temporary, { force: true }); }
}
