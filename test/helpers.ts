import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

/**
 * Create an isolated, throwaway HOME and point the process at it. Must be called
 * BEFORE importing any module that reads `homedir()` at load time (e.g.
 * `src/workspace/project.ts` computes PROJECTS_DIR at import), so do it at the
 * top of a test file and use a dynamic `import()` afterwards.
 *
 * Also writes a git identity (and pins GIT_CONFIG_GLOBAL to it) so the Overleaf
 * tests can commit without depending on the host's git config.
 */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'handoff-home-'));
  process.env['HOME'] = home;
  const gitconfig = join(home, '.gitconfig');
  writeFileSync(
    gitconfig,
    '[user]\n  name = Handoff Test\n  email = test@handoff.local\n[init]\n  defaultBranch = main\n',
  );
  process.env['GIT_CONFIG_GLOBAL'] = gitconfig;
  return home;
}

/** A bare git repo to stand in for the Overleaf remote, with HEAD on main. */
export function makeBareRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-remote-'));
  spawnSync('git', ['init', '--bare', dir]);
  spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  return dir;
}

/** Run a git command in `cwd`, returning trimmed stdout (test convenience). */
export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return `${r.stdout ?? ''}`.trim();
}

/** True if `git` is on PATH — Overleaf tests skip when it isn't. */
export function hasGit(): boolean {
  return spawnSync('git', ['--version']).status === 0;
}
