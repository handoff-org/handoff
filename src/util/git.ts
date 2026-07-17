import { spawnSync } from 'child_process';

export interface GitState {
  commit: string;
  dirty: boolean;
  /** Uncommitted diff of tracked files (empty when clean). */
  diff: string;
}

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    // Never block on a pager or credential prompt inside a tool call.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.error || r.status !== 0) return { ok: false, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  return { ok: true, out: (r.stdout ?? '').trim() };
}

/**
 * Read-only snapshot of the git state at `cwd`: the current commit, whether the
 * working tree is dirty, and the uncommitted diff of tracked files. Returns
 * `null` when git is unavailable or `cwd` is not inside a repository — common for
 * the project workspace, and treated as "no git provenance", not an error. The
 * captured code snapshot still makes the run reproducible. Never throws.
 */
export function gitState(cwd: string): GitState | null {
  try {
    const head = git(['rev-parse', 'HEAD'], cwd);
    if (!head.ok || !head.out) return null;
    const status = git(['status', '--porcelain'], cwd);
    const dirty = status.ok && status.out.length > 0;
    const diff = dirty ? git(['diff'], cwd).out : '';
    return { commit: head.out, dirty, diff };
  } catch {
    return null;
  }
}
