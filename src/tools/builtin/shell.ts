import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolRegistry } from '../registry.js';
import { resolveWorkspacePath } from '../../workspace/project.js';

const execAsync = promisify(exec);

/**
 * Shell tool: run a command inside the active project. `sensitive: true` so it
 * is approval-gated, and the cwd is the project root (not handoff's launch dir)
 * so relative paths and redirects land in the project.
 */
export function registerShellTools(registry: ToolRegistry): void {
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
}
