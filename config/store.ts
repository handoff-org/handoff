import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.handoff');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface StoredConfig {
  backend?: 'hf' | 'ollama' | 'vllm' | 'llama_cpp' | 'mlx';
  hfToken?: string;
  /** Whether the user has consented to sending context to the HuggingFace cloud. */
  hfConsent?: boolean;
  modelId?: string;
  ollamaBaseUrl?: string;
  /** How long Ollama keeps the model resident after a request. Duration string ("30m") or -1 to pin. */
  ollamaKeepAlive?: string | number;
  /** Context window (num_ctx) passed to Ollama's native /api/chat endpoint. */
  ollamaNumCtx?: number;
  /** Ollama server flag: enable flash attention (applied when handoff starts the server). */
  ollamaFlashAttention?: boolean;
  /** Ollama server flag: KV-cache type (applied when handoff starts the server). */
  ollamaKvCacheType?: 'f16' | 'q8_0' | 'q4_0';
  vllmBaseUrl?: string;
  llamaCppBaseUrl?: string;
  mlxBaseUrl?: string;
  theme?: string;
  mode?: 'permissions' | 'auto';
  /** Work focus: 'research' loads the active project; 'general' is off-work. */
  focus?: 'research' | 'general';
  /** Animate the banner mascot (default true). */
  bannerAnimation?: boolean;
  /** User-saved favourite models, grouped by backend. */
  favourites?: Array<{ backend: 'ollama' | 'hf' | 'vllm' | 'llama_cpp' | 'mlx'; modelId: string }>;
  /** Advisor performance mode: cool (default on MacBooks) / balanced / max. */
  modelPerformanceMode?: 'cool' | 'balanced' | 'max';
  /** Laptop inference preset (bundles context + output + keep-alive + prompt budget). */
  inferencePreset?: 'cool' | 'fast' | 'balanced' | 'deep' | 'long_context' | 'manual';
  /** Prompt-token budget for context compaction (unset → derived from preset). */
  maxPromptTokens?: number;
  /** Max output tokens (num_predict). Set by presets; env HANDOFF_MAX_TOKENS overrides. */
  maxNewTokens?: number;
  /** Trim history sent to the model each turn to the prompt budget (default true). */
  contextCompaction?: boolean;
  /** Local adaptive personalization (off until opted in). */
  personalizationEnabled?: boolean;
  personalizationIncludeInPrompt?: boolean;
  personalizationAllowCloudPrompt?: boolean;
  personalizationLearnFromProjects?: boolean;
  personalizationLearnFromPerformance?: boolean;
  /** Preferred quantization; 'auto' lets the advisor pick per hardware/mode. */
  modelQuantizationPreference?: 'q4_K_M' | 'q5_K_M' | 'q8_0' | 'fp16' | 'default' | 'auto';
  /** Advisor warnings the user has explicitly dismissed (keyed by warning id). */
  modelAdvisorDismissedWarnings?: string[];
  /** Override path for the benchmark cache (defaults to ~/.handoff/model-benchmarks.json). */
  modelBenchmarkCachePath?: string;
  /** True once the hardware-aware context migration has run (so we set num_ctx once). */
  contextMigrated?: boolean;
}


export async function readStore(): Promise<StoredConfig> {
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as StoredConfig;
  } catch {
    return {};
  }
}

// Serialize all writes through one chain: the app fires many independent
// `writeStore({...})` calls (mode, theme, favourites, …), and an unserialized
// read-modify-write would let concurrent calls clobber each other's keys.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Merge `update` into the stored config. Writes are serialized (no lost updates),
 * atomic (temp file + rename, so a crash mid-write can't truncate config.json),
 * and best-effort: this never rejects, so the many fire-and-forget `void
 * writeStore(...)` call sites can't produce an unhandled rejection.
 */
export function writeStore(update: Partial<StoredConfig>): Promise<void> {
  writeChain = writeChain.then(async () => {
    try {
      const existing = await readStore();
      await mkdir(CONFIG_DIR, { recursive: true });
      const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ ...existing, ...update }, null, 2), 'utf-8');
      await rename(tmp, CONFIG_FILE); // atomic on the same filesystem
    } catch {
      // Persisting settings is best-effort; never crash the app over it.
    }
  });
  return writeChain;
}
