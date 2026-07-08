import { totalmem } from 'os';
import type { SelectOption } from '../ui/Select.js';
import type { HandoffModelEntry } from './catalog-types.js';
import { OLLAMA_CATALOG } from './catalog-ollama.js';
import { HF_CATALOG } from './catalog-remote.js';
import { LLAMA_CPP_CATALOG, MLX_CATALOG } from './catalog-local.js';
import { CATALOG_VERSION } from './catalog-types.js';

export type Backend = 'ollama' | 'hf' | 'vllm' | 'llama_cpp' | 'mlx';

/** Tiers are the target Mac unified-memory size, not an abstract size class. */
export type ModelTier = 'ram8' | 'ram16' | 'ram24' | 'ram32' | 'ram64';

export interface ModelEntry extends SelectOption<string> {
  tier: ModelTier;
  /** Approximate unified-memory footprint at the listed quant, in GB. */
  vramGb: number;
  /** Whether a separate quantization-picker step is offered (curated = false). */
  hasQuant: boolean;
  /** The default pick for this RAM tier (one per tier per backend). */
  recommended?: boolean;
  /** Model family (for grouping/badges in the picker). */
  family?: HandoffModelEntry['family'];
  /** Maturity badge: recommended / advanced / server_only / cloud_only. */
  maturity?: HandoffModelEntry['maturity'];
  /** Heat risk badge. */
  heatRisk?: HandoffModelEntry['heatRisk'];
  /** Privacy badge: local / self_hosted / cloud_opt_in. */
  privacy?: HandoffModelEntry['privacy'];
}

export interface FavouriteEntry {
  backend: Backend;
  modelId: string;
}

/** Date the model lists were last curated. Shown in the picker footer. */
export const CATALOG_DATE = CATALOG_VERSION;

const TIER_LABELS: Record<ModelTier, string> = {
  ram8: '8 GB',
  ram16: '16 GB',
  ram24: '24 GB',
  ram32: '32 GB',
  ram64: '64 GB+',
};
export { TIER_LABELS };

/** RAM tiers in ascending order — the display + comparison order. */
export const TIER_ORDER: ModelTier[] = ['ram8', 'ram16', 'ram24', 'ram32', 'ram64'];

/** Map a catalog entry's minimum unified memory to a display RAM tier. */
function tierForEntry(e: HandoffModelEntry): ModelTier {
  const gb = e.minUnifiedMemoryGb ?? (e.totalParamsB ?? 8) * 0.8;
  if (gb <= 8) return 'ram8';
  if (gb <= 16) return 'ram16';
  if (gb <= 24) return 'ram24';
  if (gb <= 32) return 'ram32';
  return 'ram64';
}

/**
 * Adapt a rich catalog entry to the legacy ModelEntry shape the picker renders.
 * hasQuant stays false: Ollama controls the concrete tag and the advisor/perf
 * mode pick the quantization, so we never synthesize a tag that may not exist.
 */
function toModelEntry(e: HandoffModelEntry): ModelEntry {
  const vramGb = Math.max(1, Math.round((e.totalParamsB ?? 8) * 0.6));
  return {
    label: e.label,
    value: e.id,
    hint: e.notes,
    tier: tierForEntry(e),
    vramGb,
    hasQuant: false,
    recommended:
      e.maturity === 'recommended' &&
      (e.roles.includes('default') || e.roles.includes('fast_cool')),
    family: e.family,
    maturity: e.maturity,
    heatRisk: e.heatRisk,
    privacy: e.privacy,
  };
}

/** The four backend catalogs, derived from the typed HandoffModelEntry catalog. */
export const OLLAMA_MODELS: ModelEntry[] = OLLAMA_CATALOG.map(toModelEntry);
export const HF_MODELS: ModelEntry[] = HF_CATALOG.map(toModelEntry);
export const LLAMA_CPP_MODELS: ModelEntry[] = LLAMA_CPP_CATALOG.map(toModelEntry);
export const MLX_MODELS: ModelEntry[] = MLX_CATALOG.map(toModelEntry);

export const BACKEND_OPTIONS: SelectOption<Backend>[] = [
  {
    label: '🦙 Ollama',
    value: 'ollama',
    hint: 'Free & local. The easiest way to run models on your machine — pick one and go.',
  },
  {
    label: '🐇 llama.cpp',
    value: 'llama_cpp',
    hint: 'Free & local. Fast GGUF inference via llama-server. Great on modest hardware.',
  },
  {
    label: '🍎 MLX',
    value: 'mlx',
    hint: 'Free & local. Apple Silicon–optimized inference, tuned for M-series Macs.',
  },
  {
    label: '⚡ vLLM',
    value: 'vllm',
    hint: 'Free & self-hosted. High-throughput OpenAI-compatible server for bigger rigs.',
  },
  {
    label: '🤗 HuggingFace',
    value: 'hf',
    hint: 'Cloud & paid. Runs models on HuggingFace servers — needs an access token.',
  },
];

/**
 * Ollama quantization levels, applied as a tag suffix (e.g. qwen3:8b-q8_0).
 * Retained for manual/advanced use; curated models set hasQuant: false so the
 * picker skips this step and the advisor/performance-mode pick the quant.
 */
export const QUANT_OPTIONS: SelectOption<string>[] = [
  { label: 'q4_K_M', value: 'q4_K_M', hint: '~50% size · Cool/Fast — best for MacBooks' },
  { label: 'q5_K_M', value: 'q5_K_M', hint: '~62% size · Balanced quality / speed' },
  { label: 'q8_0', value: 'q8_0', hint: '~83% size · Quality · needs more RAM' },
  { label: 'fp16', value: 'fp16', hint: 'full size · Max/Hot · needs most RAM' },
  { label: 'default', value: '', hint: "Ollama's default build for this model" },
];

/** Combine a base Ollama model tag with an optional quant suffix. */
export function withQuant(model: string, quant: string): string {
  return quant ? `${model}-${quant}` : model;
}

/** Total system RAM in GB (rounded). The catalog tiers are keyed to this. */
export function getSystemRamGb(): number {
  return Math.round(totalmem() / 1e9);
}

/** Map total unified memory (GB) to the RAM tier it can comfortably run. */
export function ramTierForGb(totalGb: number): ModelTier {
  if (totalGb <= 12) return 'ram8';
  if (totalGb <= 20) return 'ram16';
  if (totalGb <= 28) return 'ram24';
  if (totalGb <= 48) return 'ram32';
  return 'ram64';
}

/**
 * Legacy RAM-only recommender. Retained for compatibility, but the model picker
 * now prefers the hardware-aware ModelAdvisor (src/agent/advisor.ts).
 */
export function recommendModel(totalRamGb: number, models: ModelEntry[]): ModelEntry | null {
  if (models.length === 0) return null;
  const maxIdx = TIER_ORDER.indexOf(ramTierForGb(totalRamGb));
  const eligible = models.filter((m) => TIER_ORDER.indexOf(m.tier) <= maxIdx);
  const pool = eligible.length ? eligible : models; // nothing fits → smallest available
  const topIdx = pool.reduce((hi, m) => Math.max(hi, TIER_ORDER.indexOf(m.tier)), -1);
  const top = pool.filter((m) => TIER_ORDER.indexOf(m.tier) === topIdx);
  return top.find((m) => m.recommended) ?? top[0] ?? null;
}
