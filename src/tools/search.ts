import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Dependency-free file search for the search_files (grep) and find_files (glob)
 * tools. A bounded recursive walk — skips noise dirs, big files, and binaries —
 * so it's safe on any project without shelling out to ripgrep. Bounds keep a
 * runaway search from flooding the model's context.
 */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  'dist',
  'build',
  '.next',
  '.cache',
  '.pytest_cache',
  '.ipynb_checkpoints',
]);
const MAX_FILES = 4000; // files visited before we stop walking
const MAX_FILE_BYTES = 1_000_000; // skip files larger than ~1 MB
const BINARY_SNIFF = 8192; // bytes to check for a NUL (binary marker)

/** Walk `root` depth-first, yielding project-relative file paths (bounded). */
export function* walkFiles(root: string): Generator<string> {
  let visited = 0;
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (++visited > MAX_FILES) return;
        yield relative(root, full);
      }
    }
  }
}

/**
 * Convert a glob (`**` = any depth, `*` = within a segment, `?` = one char) to an
 * anchored RegExp matched against a path with `/` separators.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

const toPosix = (p: string): string => (sep === '/' ? p : p.split(sep).join('/'));

export interface GlobResult {
  files: string[];
  capped: boolean;
}

/** List project-relative files matching `pattern`, sorted, capped at `limit`. */
export function globFiles(root: string, pattern: string, limit = 200): GlobResult {
  const re = globToRegExp(pattern);
  const out: string[] = [];
  let capped = false;
  for (const rel of walkFiles(root)) {
    if (re.test(toPosix(rel))) {
      if (out.length >= limit) {
        capped = true;
        break;
      }
      out.push(toPosix(rel));
    }
  }
  out.sort();
  return { files: out, capped };
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  capped: boolean;
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Search file contents for `pattern` (a RegExp; falls back to a literal match if
 * the pattern is invalid). `glob` optionally restricts which files are scanned.
 * Case-insensitive by default. Bounded by `limit` matches.
 */
export function grepFiles(
  root: string,
  pattern: string,
  opts: { glob?: string; caseSensitive?: boolean; limit?: number } = {},
): GrepResult {
  const limit = opts.limit ?? 100;
  const flags = opts.caseSensitive ? 'g' : 'gi';
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
  const globRe = opts.glob ? globToRegExp(opts.glob) : null;

  const matches: GrepMatch[] = [];
  let capped = false;
  for (const rel of walkFiles(root)) {
    if (globRe && !globRe.test(toPosix(rel))) continue;
    const full = join(root, rel);
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      const buf = readFileSync(full);
      if (isBinary(buf)) continue;
      const lines = buf.toString('utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i]!)) {
          if (matches.length >= limit) return { matches, capped: true };
          matches.push({ file: toPosix(rel), line: i + 1, text: lines[i]!.slice(0, 300) });
        }
      }
    } catch {
      /* unreadable file — skip */
    }
  }
  return { matches, capped };
}
