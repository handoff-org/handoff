import { readFile, writeFile, mkdir, readdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolRegistry } from './registry.js';
import { overleafWriteGuard } from '../workspace/overleaf.js';
import { resolveWorkspacePath } from '../workspace/project.js';
import { grepFiles, globFiles } from './search.js';

const execAsync = promisify(exec);

/**
 * Guard outbound fetches: only http(s), and never link-local / cloud-metadata
 * hosts (SSRF). Returns an error string to show instead of fetching, or null if OK.
 */
function checkFetchUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `Refused: not a valid URL: ${raw}`;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `Refused: only http(s) URLs are allowed (got "${u.protocol}").`;
  }
  const host = u.hostname.toLowerCase();
  if (host.startsWith('169.254.') || host === 'metadata.google.internal' || host === '[::ffff:169.254.169.254]') {
    return `Refused: ${host} is a link-local / cloud-metadata address.`;
  }
  return null;
}

export function registerBuiltins(registry: ToolRegistry): void {
  registry.register({
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
      },
      required: ['path'],
    },
    async execute({ path }) {
      const content = await readFile(resolveWorkspacePath(String(path)), 'utf-8');
      return content;
    },
  });

  registry.register({
    name: 'write_file',
    description:
      'Write content to a file, creating it if it does not exist. Set append=true to add to the end instead of overwriting (e.g. NOTEBOOK.md notes).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'string', description: 'Set to "true" to append instead of overwrite' },
      },
      required: ['path', 'content'],
    },
    async execute({ path, content, append }) {
      // Relative paths resolve into the active research project, not the CWD.
      const target = resolveWorkspacePath(String(path));
      const isAppend = append === true || append === 'true';
      // In an Overleaf-linked paper, force edits into the single main document
      // and reject fragment overwrites that would break LaTeX compilation.
      const blocked = overleafWriteGuard(target, String(content));
      if (blocked) return blocked;
      // Create any missing parent directories so writes never fail on ENOENT.
      const dir = dirname(target);
      if (dir) await mkdir(dir, { recursive: true });
      if (isAppend) {
        await appendFile(target, String(content), 'utf-8');
        return `Appended to ${target}`;
      }
      await writeFile(target, String(content), 'utf-8');
      return `Written to ${target}`;
    },
  });

  registry.register({
    name: 'edit_file',
    description:
      'Make a targeted edit to an existing file by replacing an exact string, ' +
      'without rewriting the whole file. `old_string` must appear exactly once ' +
      '(include enough surrounding context to make it unique) unless replace_all=true. ' +
      'Prefer this over write_file for changing part of a large file (a paper, a script).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_string: { type: 'string', description: 'The exact text to replace' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'string', description: 'Set to "true" to replace every occurrence' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute({ path, old_string, new_string, replace_all }) {
      const target = resolveWorkspacePath(String(path));
      const oldStr = String(old_string);
      const newStr = String(new_string);
      if (oldStr === newStr) return 'No change: old_string and new_string are identical.';
      let current: string;
      try {
        current = await readFile(target, 'utf-8');
      } catch {
        return `Cannot edit ${target}: file not found. Use write_file to create it.`;
      }
      const all = replace_all === true || replace_all === 'true';
      const count = current.split(oldStr).length - 1;
      if (count === 0) return `old_string not found in ${target}. Read the file and copy the exact text (including whitespace).`;
      if (count > 1 && !all) {
        return `old_string appears ${count} times in ${target}. Add surrounding context to make it unique, or set replace_all="true".`;
      }
      const updated = all ? current.split(oldStr).join(newStr) : current.replace(oldStr, newStr);
      const blocked = overleafWriteGuard(target, updated);
      if (blocked) return blocked;
      await writeFile(target, updated, 'utf-8');
      return `Edited ${target}${all && count > 1 ? ` (${count} occurrences)` : ''}`;
    },
  });

  registry.register({
    name: 'make_dir',
    description: 'Create a directory (and any missing parent directories).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to create' },
      },
      required: ['path'],
    },
    async execute({ path }) {
      const target = resolveWorkspacePath(String(path));
      await mkdir(target, { recursive: true });
      return `Created directory ${target}`;
    },
  });

  registry.register({
    name: 'list_dir',
    description: 'List the entries in a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default ".")' },
      },
    },
    async execute({ path }) {
      const target = resolveWorkspacePath(path ? String(path) : '.');
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    },
  });

  registry.register({
    name: 'search_files',
    description:
      'Search file contents across the project for a regular expression, returning ' +
      'matching "path:line: text" lines. Much cheaper than reading whole files to find ' +
      'something. Case-insensitive by default; optionally restrict to files matching a ' +
      'glob (e.g. "**/*.py"). Skips node_modules/.git/.venv, binaries, and large files.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default: whole project)' },
        glob: { type: 'string', description: 'Only search files matching this glob (e.g. "**/*.tex")' },
        case_sensitive: { type: 'string', description: 'Set to "true" for a case-sensitive search' },
      },
      required: ['pattern'],
    },
    async execute({ pattern, path, glob, case_sensitive }) {
      const root = resolveWorkspacePath(path ? String(path) : '.');
      const { matches, capped } = grepFiles(root, String(pattern), {
        ...(glob ? { glob: String(glob) } : {}),
        caseSensitive: case_sensitive === true || case_sensitive === 'true',
      });
      if (matches.length === 0) return `No matches for /${pattern}/.`;
      const body = matches.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`).join('\n');
      return capped ? `${body}\n… (more matches — narrow the pattern or glob)` : body;
    },
  });

  registry.register({
    name: 'find_files',
    description:
      'List project files whose path matches a glob. Use `**` for any depth, `*` within a ' +
      'path segment (e.g. "**/*.py", "results/*.png", "**/refs.bib"). Cheaper than repeated ' +
      'list_dir calls for locating files.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob to match against project-relative paths' },
        path: { type: 'string', description: 'Subdirectory to search within (default: whole project)' },
      },
      required: ['pattern'],
    },
    async execute({ pattern, path }) {
      const root = resolveWorkspacePath(path ? String(path) : '.');
      const { files, capped } = globFiles(root, String(pattern));
      if (files.length === 0) return `No files match "${pattern}".`;
      return capped ? `${files.join('\n')}\n… (more — narrow the glob)` : files.join('\n');
    },
  });

  registry.register({
    name: 'run_shell',
    description: 'Run a shell command and return its stdout/stderr.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
    async execute({ command }) {
      // Run inside the active project (like run_code), not wherever handoff was
      // launched — a bare `>` redirect or relative path should land in the project.
      const { stdout, stderr } = await execAsync(String(command), {
        timeout: 30_000,
        cwd: resolveWorkspacePath('.'),
      });
      return [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n');
    },
  });

  registry.register({
    name: 'web_fetch',
    description: 'Fetch the text content of a URL.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
    async execute({ url }) {
      const bad = checkFetchUrl(String(url));
      if (bad) return bad;
      const res = await fetch(String(url));
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
      return await res.text();
    },
  });

  registry.register({
    name: 'read_pdf',
    description:
      'Extract text from a PDF — local file path or a direct URL. ' +
      'Requires pdftotext (part of poppler): `brew install poppler` on macOS. ' +
      'Use for reading papers, reports, or any PDF the user provides.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Absolute path to a local PDF file, or a direct PDF URL',
        },
        max_chars: {
          type: 'string',
          description: 'Truncate output to this many characters (default 12000)',
        },
      },
      required: ['source'],
    },
    async execute({ source, max_chars }) {
      const src = String(source);
      const limit = max_chars ? Number(max_chars) : 12_000;
      let localPath = src;

      // Download if URL.
      if (src.startsWith('http://') || src.startsWith('https://')) {
        const bad = checkFetchUrl(src);
        if (bad) return bad;
        const { tmpdir } = await import('os');
        const { join: pathJoin } = await import('path');
        const { writeFileSync } = await import('fs');
        const res = await fetch(src);
        if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
        const buf = await res.arrayBuffer();
        localPath = pathJoin(tmpdir(), `handoff-pdf-${Date.now()}.pdf`);
        writeFileSync(localPath, Buffer.from(buf));
      }

      // Use pdftotext (poppler) — widely available on macOS/Linux.
      try {
        const { execSync } = await import('child_process');
        const text = execSync(`pdftotext "${localPath}" -`, {
          timeout: 30_000,
          encoding: 'utf-8',
          maxBuffer: 8 * 1024 * 1024,
        }) as string;
        return text.length > limit
          ? text.slice(0, limit) + `\n… (truncated at ${limit} chars)`
          : text;
      } catch {
        return (
          'pdftotext not available. Install with: brew install poppler\n' +
          'Then retry — handoff will extract the text directly.'
        );
      }
    },
  });

  registry.register({
    name: 'ask_user',
    description:
      'Ask the user to choose between concrete options instead of asking in free ' +
      'text. Use this whenever you need a decision, preference, or clarification — ' +
      'e.g. which approach to take, which file to edit, or a yes/no confirmation. ' +
      'Provide 2-5 short, specific options. Do NOT add an "other"/"type your own" ' +
      'option: the user is always offered that automatically. Returns the chosen text.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to put to the user.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-5 short answer options for the user to pick from.',
        },
      },
      required: ['question', 'options'],
    },
    async execute({ question }) {
      // Reached only without an interactive UI (e.g. headless). The agent loop
      // normally intercepts ask_user and routes it to the on-screen picker.
      return (
        `(No interactive prompt is available to ask: "${String(question)}".) ` +
        `Proceed with the most reasonable assumption and state it explicitly.`
      );
    },
  });
}
