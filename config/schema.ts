import { z } from 'zod';
import { homedir, platform } from 'os';
import { readStore, writeStore } from './store.js';
import { detectHardware } from '../src/system/hardware.js';
import { defaultContextForHardware } from '../src/agent/advisor.js';

const FavouriteSchema = z.object({
  backend: z.enum(['ollama', 'hf', 'vllm', 'llama_cpp', 'mlx']),
  modelId: z.string(),
});

export const ConfigSchema = z.object({
  backend: z.enum(['hf', 'ollama', 'vllm', 'llama_cpp', 'mlx']).default('ollama'),
  modelId: z.string().default('qwen3:8b'),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  // Native /api/chat tuning (Ollama only). keep_alive avoids reloading the model
  // between turns; num_ctx sets the context window (KV cache) — tuneable in Settings.
  ollamaKeepAlive: z.union([z.string(), z.number()]).default('30m'),
  ollamaNumCtx: z.number().default(64000),
  // Ollama SERVER-startup flags — applied when handoff launches `ollama serve`
  // (they can't be changed on a running server). Toggle them in /settings.
  ollamaFlashAttention: z.boolean().default(true),
  ollamaKvCacheType: z.enum(['f16', 'q8_0', 'q4_0']).default('q8_0'),
  vllmBaseUrl: z.string().default('http://localhost:8000'),
  llamaCppBaseUrl: z.string().default('http://localhost:8080'),
  mlxBaseUrl: z.string().default('http://localhost:8080'),
  hfToken: z.string().optional(),
  // Whether the user has explicitly consented to sending context to the HF cloud.
  hfConsent: z.boolean().default(false),
  theme: z.string().default('synthwave'),
  // 'permissions' = ask before sensitive tools; 'auto' = hands-off, run freely.
  mode: z.enum(['permissions', 'auto']).default('permissions'),
  // 'research' loads the active project's context; 'general' is off-work.
  focus: z.enum(['research', 'general']).default('research'),
  // animate the banner mascot. false (or a non-tty / reduced-motion env) → static.
  bannerAnimation: z.boolean().default(true),
  // Optional output cap. Unset = no limit; the model generates until it's done.
  maxNewTokens: z.number().optional(),
  // User-saved favourite models.
  favourites: z.array(FavouriteSchema).default([]),
  // Advisor performance mode. 'cool' is the safe MacBook default.
  modelPerformanceMode: z.enum(['cool', 'balanced', 'max']).default('cool'),
  // Laptop inference preset (bundles context + max output + keep-alive + prompt
  // budget). 'manual' leaves the individual knobs exactly as set. See src/agent/presets.ts.
  inferencePreset: z
    .enum(['cool', 'fast', 'balanced', 'deep', 'long_context', 'manual'])
    .default('manual'),
  // Prompt-token budget for context compaction. Unset → derived from the preset
  // and context window at send time.
  maxPromptTokens: z.number().optional(),
  // Trim the history sent to the model each turn to the prompt budget (old tool
  // output capped, oldest turns dropped). Full history is still saved to disk.
  contextCompaction: z.boolean().default(true),
  // Local adaptive personalization. Off until the user opts in (first-run wizard
  // or /settings). See src/personalization/. Cloud-prompt inclusion is off by default.
  personalizationEnabled: z.boolean().default(false),
  personalizationIncludeInPrompt: z.boolean().default(true),
  personalizationAllowCloudPrompt: z.boolean().default(false),
  personalizationLearnFromProjects: z.boolean().default(true),
  personalizationLearnFromPerformance: z.boolean().default(true),
  // Preferred quantization; 'auto' defers to the advisor.
  modelQuantizationPreference: z
    .enum(['q4_K_M', 'q5_K_M', 'q8_0', 'fp16', 'default', 'auto'])
    .default('auto'),
  modelAdvisorDismissedWarnings: z.array(z.string()).default([]),
  modelBenchmarkCachePath: z.string().optional(),
  systemPrompt: z
    .string()
    .default(
      'You are a helpful coding assistant with access to tools. ' +
        'Use tools when needed. Be concise.',
    ),
  toolDirs: z.array(z.string()).default([]),
  // Two-tier model routing: auto-select a fast or think model per turn.
  routerEnabled: z.boolean().default(false),
  routerFastModelId: z.string().default('qwen3:4b'),
  // undefined → falls back to config.modelId (zero extra setup to activate).
  routerThinkModelId: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function environmentContext(): string {
  return (
    `\n\nEnvironment:\n` +
    `- OS: ${platform()}\n` +
    `- Home directory: ${homedir()}\n` +
    `- Current working directory: ${process.cwd()}\n` +
    `Always use real, absolute paths based on this environment. ` +
    `Never invent placeholder paths like /Users/your_username.`
  );
}

export async function loadConfig(): Promise<Config> {
  const store = await readStore();

  // Hardware-aware context window. The old build shipped a fixed 64000 default,
  // which forces CPU offload on most MacBooks. Resolve a safe value:
  //   - explicit env override wins;
  //   - an unset value → the hardware-aware default;
  //   - a stored 64000 that predates this migration → treated as the OLD default
  //     and migrated down (a deliberate 64000 gets a `contextMigrated` flag so we
  //     never touch it again);
  //   - any other stored value is an explicit user choice — keep it.
  const mode = (store.modelPerformanceMode ?? 'cool') as 'cool' | 'balanced' | 'max';
  const hw = detectHardware();
  const hwDefaultCtx = defaultContextForHardware(hw, mode);
  let resolvedCtx: number;
  if (process.env['HANDOFF_OLLAMA_NUM_CTX']) {
    resolvedCtx = Number(process.env['HANDOFF_OLLAMA_NUM_CTX']);
  } else if (store.ollamaNumCtx == null) {
    resolvedCtx = hwDefaultCtx;
  } else if (store.ollamaNumCtx === 64000 && !store.contextMigrated) {
    resolvedCtx = hwDefaultCtx; // legacy default → migrate down
    void writeStore({ ollamaNumCtx: hwDefaultCtx, contextMigrated: true });
  } else {
    resolvedCtx = store.ollamaNumCtx; // explicit choice, respected
  }

  const input = {
    backend: process.env['HANDOFF_BACKEND'] ?? store.backend,
    modelId: process.env['HANDOFF_MODEL'] ?? store.modelId,
    ollamaBaseUrl: store.ollamaBaseUrl,
    ollamaKeepAlive: process.env['HANDOFF_OLLAMA_KEEP_ALIVE'] ?? store.ollamaKeepAlive,
    ollamaNumCtx: resolvedCtx,
    ollamaFlashAttention: store.ollamaFlashAttention,
    ollamaKvCacheType: store.ollamaKvCacheType,
    vllmBaseUrl: process.env['HANDOFF_VLLM_URL'] ?? store.vllmBaseUrl,
    llamaCppBaseUrl: process.env['HANDOFF_LLAMACPP_URL'] ?? store.llamaCppBaseUrl,
    mlxBaseUrl: process.env['HANDOFF_MLX_URL'] ?? store.mlxBaseUrl,
    hfToken: process.env['HF_TOKEN'] ?? store.hfToken,
    hfConsent: store.hfConsent,
    theme: process.env['HANDOFF_THEME'] ?? store.theme,
    mode: process.env['HANDOFF_MODE'] ?? store.mode,
    focus: store.focus,
    bannerAnimation: process.env['HANDOFF_NO_ANIM'] != null ? false : store.bannerAnimation,
    maxNewTokens: process.env['HANDOFF_MAX_TOKENS']
      ? Number(process.env['HANDOFF_MAX_TOKENS'])
      : store.maxNewTokens,
    favourites: store.favourites,
    modelPerformanceMode: store.modelPerformanceMode,
    inferencePreset: store.inferencePreset,
    maxPromptTokens: store.maxPromptTokens,
    contextCompaction: store.contextCompaction,
    personalizationEnabled: store.personalizationEnabled,
    personalizationIncludeInPrompt: store.personalizationIncludeInPrompt,
    personalizationAllowCloudPrompt: store.personalizationAllowCloudPrompt,
    personalizationLearnFromProjects: store.personalizationLearnFromProjects,
    personalizationLearnFromPerformance: store.personalizationLearnFromPerformance,
    modelQuantizationPreference: store.modelQuantizationPreference,
    modelAdvisorDismissedWarnings: store.modelAdvisorDismissedWarnings,
    modelBenchmarkCachePath: store.modelBenchmarkCachePath,
    routerEnabled: store.routerEnabled,
    routerFastModelId: store.routerFastModelId,
    routerThinkModelId: store.routerThinkModelId,
  };
  // A corrupt or hand-edited config.json (e.g. a wrong-typed value that survives
  // JSON.parse) must never brick startup. safeParse + fall back to all-defaults.
  const result = ConfigSchema.safeParse(input);
  const config = result.success ? result.data : ConfigSchema.parse({});
  config.systemPrompt += environmentContext();
  return config;
}
