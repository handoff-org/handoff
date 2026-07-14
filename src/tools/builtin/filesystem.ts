import { readFile, writeFile, mkdir, readdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import type { ToolRegistry } from '../registry.js';
import { overleafWriteGuard } from '../../workspace/overleaf.js';
import { resolveWorkspacePath, isWithinProject } from '../../workspace/project.js';

/**
 * Filesystem tools: read/write/edit files, make/list directories. Writes are
 * confined to the active project workspace (isWithinProject) and pass through
 * the Overleaf single-document guard so a linked paper stays compilable.
 */
export function registerFilesystemTools(registry: ToolRegistry): void {
  registry.register({
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    parallelSafe: true,
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
      if (!isWithinProject(target)) {
        return `Refused: "${path}" resolves outside the project workspace. Write files inside the active project.`;
      }
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
      if (!isWithinProject(target)) {
        return `Refused: "${path}" resolves outside the project workspace. Edit files inside the active project.`;
      }
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
      if (count === 0)
        return `old_string not found in ${target}. Read the file and copy the exact text (including whitespace).`;
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
      if (!isWithinProject(target)) {
        return `Refused: "${path}" resolves outside the project workspace. Create directories inside the active project.`;
      }
      await mkdir(target, { recursive: true });
      return `Created directory ${target}`;
    },
  });

  registry.register({
    name: 'list_dir',
    description: 'List the entries in a directory.',
    parallelSafe: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default ".")' },
      },
    },
    async execute({ path }) {
      const target = resolveWorkspacePath(path ? String(path) : '.');
      const entries = await readdir(target, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
    },
  });
}
