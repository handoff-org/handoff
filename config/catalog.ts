import type { BackendId } from '../src/system/types.js';
import type { HandoffModelEntry, QuantId } from './catalog-types.js';
import { OLLAMA_CATALOG } from './catalog-ollama.js';
import { HF_CATALOG } from './catalog-remote.js';
import { LLAMA_CPP_CATALOG, MLX_CATALOG } from './catalog-local.js';

export * from './catalog-types.js';
export { CATALOG_VERSION } from './catalog-types.js';

/** All catalog entries across every backend. */
export const FULL_CATALOG: HandoffModelEntry[] = [
  ...OLLAMA_CATALOG,
  ...HF_CATALOG,
  ...LLAMA_CPP_CATALOG,
  ...MLX_CATALOG,
];

/** Entries for one backend (hf and vllm share the HF repo-id catalog). */
export function catalogForBackend(backend: BackendId): HandoffModelEntry[] {
  switch (backend) {
    case 'ollama':
      return OLLAMA_CATALOG;
    case 'hf':
    case 'vllm':
      return HF_CATALOG;
    case 'llama_cpp':
      return LLAMA_CPP_CATALOG;
    case 'mlx':
      return MLX_CATALOG;
    default:
      return [];
  }
}

/**
 * Find a catalog entry by exact id or by alias (e.g. `ornith:latest` → ornith:9b).
 * Returns undefined when nothing matches — the caller marks it "unchecked".
 */
export function findCatalogEntry(backend: BackendId, id: string): HandoffModelEntry | undefined {
  const list = catalogForBackend(backend);
  return list.find((e) => e.id === id) ?? list.find((e) => e.aliases?.includes(id));
}

/**
 * True when an Ollama id is an ambiguous/drifting tag we should nudge away from:
 * an explicit `:latest`, or a bare Ollama name with no tag at all (e.g. `ornith`).
 * HF repo ids (which contain "/") are never treated as ambiguous here.
 */
export function isAmbiguousTag(id: string): boolean {
  if (id.includes('/')) return false;
  if (/:latest$/.test(id)) return true;
  return !id.includes(':'); // bare family name like "ornith" or "qwen3"
}

/** Resolve a base id + quant preference into a concrete Ollama tag when possible. */
export function resolveOllamaTag(entry: HandoffModelEntry, quant: QuantId): string {
  if (entry.backend !== 'ollama') return entry.id;
  const opt = entry.quantOptions.find((q) => q.id === quant);
  const suffix = opt?.tagSuffixes?.[0];
  if (!suffix || quant === 'default') return entry.id;
  // Only append a quant suffix when the base id has no explicit quant already.
  if (/-(q\d|fp16|f16|bf16)/i.test(entry.id)) return entry.id;
  // Ollama tags look like base:size — append the quant with a dash.
  return `${entry.id}-${suffix}`;
}

/** Minimal runtime validation guard used by tests and defensive callers. */
export function isValidCatalogEntry(e: unknown): e is HandoffModelEntry {
  if (!e || typeof e !== 'object') return false;
  const m = e as Record<string, unknown>;
  const scores = [
    'toolUseScore',
    'codingScore',
    'reasoningScore',
    'writingScore',
    'speedScore',
  ] as const;
  return (
    typeof m['id'] === 'string' &&
    typeof m['backend'] === 'string' &&
    typeof m['label'] === 'string' &&
    typeof m['family'] === 'string' &&
    Array.isArray(m['roles']) &&
    Array.isArray(m['quantOptions']) &&
    typeof m['defaultContextTokens'] === 'number' &&
    typeof m['safeContextTokens'] === 'number' &&
    typeof m['heatRisk'] === 'string' &&
    typeof m['maturity'] === 'string' &&
    scores.every((s) => typeof m[s] === 'number' && (m[s] as number) >= 1 && (m[s] as number) <= 5)
  );
}
