import { spawnSync } from 'child_process';
import { uvAvailable } from '../workspace/runner.js';

/**
 * Run a short PyMuPDF (fitz) script in an ephemeral uv environment
 * (`uv run --with pymupdf python -c …`) — no persistent project and no system
 * poppler dependency. Shared by the vision tools (page rendering) and the Zotero
 * connector (text extraction, highlight-rect location). Arguments are passed as
 * separate argv entries (never a shell string), so adversarial paths or quoted
 * text can't inject a command.
 */

/** True when uv is available to host the ephemeral PyMuPDF environment. */
export function pymupdfAvailable(): boolean {
  return uvAvailable();
}

/** Run `python -c <script> <args…>` with PyMuPDF; return stdout or an error string. */
export function runPymupdf(
  script: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): { stdout: string } | { error: string } {
  const r = spawnSync('uv', ['run', '--with', 'pymupdf', 'python', '-c', script, ...args], {
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    return { error: (r.stderr || r.error?.message || 'pymupdf failed').slice(0, 300) };
  }
  return { stdout: r.stdout ?? '' };
}
