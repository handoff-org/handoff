import { resolve, sep, dirname, basename } from 'path';
import { realpathSync } from 'fs';
import { getActiveProject, projectPaths, resolveWorkspacePath } from '../workspace/project.js';

/**
 * Resolve symlinks on the deepest EXISTING ancestor of `p` (the target itself may
 * not exist yet), then re-attach the not-yet-created tail. Without this, a purely
 * lexical prefix check can be defeated by a symlinked subdirectory that points
 * outside the project (e.g. `results -> /etc`).
 */
function realpathBestEffort(p: string): string {
  let dir = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(dir);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve(p); // hit the root, nothing exists — lexical fallback
      tail.push(basename(dir));
      dir = parent;
    }
  }
}

/**
 * True if a write_file/make_dir call targets a path inside the active project.
 * Used to auto-approve the constant file edits of the research loop while still
 * gating writes that escape the project — including via `..` (normalized by
 * resolve) and symlinked subdirectories (resolved by realpathBestEffort).
 */
export function writeTargetsProject(argsJson: string): boolean {
  try {
    const { path } = JSON.parse(argsJson) as { path?: string };
    if (!path) return false;
    const meta = getActiveProject();
    if (!meta) return false;
    const target = realpathBestEffort(resolveWorkspacePath(String(path)));
    const root = realpathBestEffort(projectPaths(meta.slug).root);
    return target === root || target.startsWith(root + sep);
  } catch {
    return false;
  }
}
