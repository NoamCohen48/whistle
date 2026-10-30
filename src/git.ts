import { HttpError } from './http-error.ts';

// Runs git read-only in a pane's folder. No optional locks (never touches the index), no fsmonitor hook, no external diff or textconv
// programs, no colour and no prompts.
export async function git(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', '-C', cwd, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args], {
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
  });
  const timer = setTimeout(() => child.kill(), 10_000);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  if (code !== 0 && !allowFailure) throw new HttpError(stderr.trim().split('\n')[0] || `git exited with ${code}`, 422);
  return { stdout, code };
}

export async function topLevel(cwd: string) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], true);
  return top.code === 0 ? top.stdout.trim() : undefined;
}

// The repository root, or the folder itself outside Git: the boundary for reading a pane's files.
export async function fileBoundary(cwd: string) {
  return await topLevel(cwd) ?? cwd;
}
