import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const testToken = 'whistle-test-token-not-a-production-secret';
export async function startHost(directory: string, extra: Record<string, string | undefined> = {},
  command = [process.execPath, resolve('src/server.ts')]) {
  const stateDir = join(directory, '.runtime');
  await mkdir(stateDir, { recursive: true });
  await rm(join(stateDir, 'server-url'), { force: true });
  const child = Bun.spawn(command, {
    cwd: directory,
    env: { ...process.env, WHISTLE_STATE_DIR: stateDir, WHISTLE_CONFIG_DIR: join(directory, 'config'),
      WHISTLE_TOKEN: testToken, PORT: '0', HOST: '127.0.0.1', ...extra },
    stdout: 'ignore', stderr: 'pipe',
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const url = (await readFile(join(stateDir, 'server-url'), 'utf8')).trim();
      return {
        url,
        async stop() { child.kill('SIGTERM'); await child.exited; },
        request(path: string, options: RequestInit = {}) {
          return fetch(url + path, { ...options, headers: { Origin: url, ...options.headers } });
        },
      };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') { child.kill(); await child.exited; throw cause; }
    }
    if (child.exitCode !== null) break;
    await Bun.sleep(100);
  }
  child.kill(); await child.exited;
  throw new Error(`Test host failed to start: ${await new Response(child.stderr).text()}`);
}
