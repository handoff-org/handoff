import type { ToolRegistry } from '../registry.js';
import { resolveWorkspacePath } from '../../workspace/project.js';
import { grepFiles, globFiles } from '../search.js';

/**
 * Search tools: content search (grep) and path search (glob) across the active
 * project. Both delegate to the pure helpers in ../search.ts and cap output so
 * a broad pattern can't flood the model's context.
 */
export function registerSearchTools(registry: ToolRegistry): void {
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
        path: {
          type: 'string',
          description: 'Subdirectory to search within (default: whole project)',
        },
        glob: {
          type: 'string',
          description: 'Only search files matching this glob (e.g. "**/*.tex")',
        },
        case_sensitive: {
          type: 'string',
          description: 'Set to "true" for a case-sensitive search',
        },
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
        path: {
          type: 'string',
          description: 'Subdirectory to search within (default: whole project)',
        },
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
}
