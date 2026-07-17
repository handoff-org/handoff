import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { ToolRegistry, type ToolDefinition } from '../../src/tools/registry.js';
import type { Scenario } from '../schema/types.js';

/** Tools that reach the network / cloud. Used by the privacy scorer to detect
 *  unapproved egress even if a scenario didn't explicitly flag the tool. */
export const NETWORK_TOOLS = new Set([
  'web_fetch',
  'web_search',
  'search_arxiv',
  'search_papers',
  'get_paper',
  'fetch_arxiv',
  'cloud_search',
  'zotero_sync',
  'overleaf_sync',
]);

const NOOP_PARAMS: ToolDefinition['parameters'] = {
  type: 'object',
  properties: { input: { type: 'string' } },
};

/**
 * Build a deterministic ToolRegistry for a scenario. Every tool referenced by the
 * scripted model (and every tool with a declared mock response) is registered so
 * the agent loop resolves calls to canned results. A `write_file` tool writes into
 * the scenario's sandbox dir so `expected_file_exists` assertions can be checked;
 * it never touches the real workspace. No tool performs real network I/O.
 */
export function buildMockRegistry(scenario: Scenario, sandboxDir: string): ToolRegistry {
  const reg = new ToolRegistry();
  const names = new Set<string>();
  for (const step of scenario.mockModel ?? []) {
    for (const c of step.calls ?? []) names.add(c.name);
    if (step.name) names.add(step.name);
  }
  for (const n of Object.keys(scenario.mockTools ?? {})) names.add(n);
  for (const n of scenario.expected.requiredTools ?? []) names.add(n);

  for (const name of names) {
    const mock = scenario.mockTools?.[name];
    const sensitive = mock?.sensitive ?? false;
    reg.register({
      name,
      description: `mock tool ${name}`,
      parameters: NOOP_PARAMS,
      sensitive,
      execute: async (args: Record<string, unknown>) => {
        if (mock?.error) throw new Error(mock.error);
        // Real sandboxed write so file-existence assertions are meaningful.
        if (name === 'write_file' || name === 'edit_file') {
          const rel = String(args['path'] ?? args['file'] ?? 'output.txt');
          const abs = resolve(sandboxDir, rel);
          if (!abs.startsWith(resolve(sandboxDir))) {
            throw new Error('path escapes sandbox');
          }
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(
            abs,
            String(args['content'] ?? args['new_string'] ?? mock?.result ?? ''),
            'utf8',
          );
          return mock?.result ?? `wrote ${rel}`;
        }
        return mock?.result ?? `ok:${name}`;
      },
    });
  }
  return reg;
}

/** True if a tool call reached the network (declared or by known-tool heuristic). */
export function isNetworkTool(scenario: Scenario, name: string): boolean {
  return scenario.mockTools?.[name]?.network === true || NETWORK_TOOLS.has(name);
}

export { join as joinPath };
