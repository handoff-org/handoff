import type { BackendId as Backend } from '../src/system/types.js';

/**
 * Strongly-typed model catalog for the hardware-aware advisor. This is the new
 * source of truth for recommendations; the legacy tier arrays in models.ts are
 * kept for backward compatibility with the existing menu rendering.
 */

export type PrivacyLevel = 'local' | 'self_hosted' | 'cloud_opt_in';

export type ModelFamily =
  'qwen' | 'gemma' | 'deepseek' | 'gpt_oss' | 'glm' | 'kimi' | 'ornith' | 'legacy';

export type ModelRole =
  | 'default'
  | 'fast_cool'
  | 'coding_agent'
  | 'tool_use'
  | 'structured_output'
  | 'research_synthesis'
  | 'research_writing'
  | 'reasoning_verifier'
  | 'reviewer'
  | 'multimodal'
  | 'long_context'
  | 'server_frontier'
  | 'experimental';

export type QuantId =
  'q4_K_M' | 'q5_K_M' | 'q8_0' | 'fp16' | 'default' | 'mlx_4bit' | 'mlx_8bit' | 'server_selected';

export interface QuantOption {
  id: QuantId;
  label: string;
  quality: 'low' | 'balanced' | 'high' | 'max';
  speed: 'fast' | 'medium' | 'slow';
  heat: 'cool' | 'warm' | 'hot';
  estimatedBytesPerParam?: number;
  tagSuffixes?: string[];
  notes?: string;
}

export type SizeClass = 'micro' | 'small' | 'medium' | 'large' | 'xl' | 'frontier';
export type MacTierReq = 'any' | 'apple_silicon' | 'pro' | 'max' | 'ultra' | 'server';
export type Maturity = 'recommended' | 'advanced' | 'experimental' | 'server_only' | 'cloud_only';
export type LocalAvailability = 'installed' | 'available_to_pull' | 'unknown' | 'unavailable';

export interface HandoffModelEntry {
  id: string;
  backend: Backend;
  label: string;
  family: ModelFamily;
  roles: ModelRole[];
  privacy: PrivacyLevel;
  sizeClass: SizeClass;
  totalParamsB?: number;
  activeParamsB?: number;
  quantOptions: QuantOption[];
  defaultQuant?: QuantId;
  defaultContextTokens: number;
  safeContextTokens: number;
  maxContextTokens?: number;
  minUnifiedMemoryGb?: number;
  recommendedUnifiedMemoryGb?: number;
  minimumMacTier?: MacTierReq;
  heatRisk: 'low' | 'medium' | 'high' | 'extreme';
  maturity: Maturity;
  toolUseScore: 1 | 2 | 3 | 4 | 5;
  codingScore: 1 | 2 | 3 | 4 | 5;
  reasoningScore: 1 | 2 | 3 | 4 | 5;
  writingScore: 1 | 2 | 3 | 4 | 5;
  speedScore: 1 | 2 | 3 | 4 | 5;
  localAvailability?: LocalAvailability;
  notes: string;
  /** Alias tags that map to this entry (e.g. ornith:latest → ornith:9b). */
  aliases?: string[];
}

// ── Reusable quantization option presets ────────────────────────────────────

export const Q4: QuantOption = {
  id: 'q4_K_M',
  label: 'Q4_K_M · Cool/Fast',
  quality: 'balanced',
  speed: 'fast',
  heat: 'cool',
  estimatedBytesPerParam: 0.55,
  tagSuffixes: ['q4_K_M', 'q4_0'],
  notes: 'Best MacBook starting point: small footprint, fast, cool.',
};
export const Q5: QuantOption = {
  id: 'q5_K_M',
  label: 'Q5_K_M · Balanced',
  quality: 'high',
  speed: 'medium',
  heat: 'warm',
  estimatedBytesPerParam: 0.7,
  tagSuffixes: ['q5_K_M'],
};
export const Q8: QuantOption = {
  id: 'q8_0',
  label: 'Q8_0 · Quality',
  quality: 'high',
  speed: 'slow',
  heat: 'warm',
  estimatedBytesPerParam: 1.05,
  tagSuffixes: ['q8_0'],
};
export const FP16: QuantOption = {
  id: 'fp16',
  label: 'fp16 · Max/Hot',
  quality: 'max',
  speed: 'slow',
  heat: 'hot',
  estimatedBytesPerParam: 2.0,
  tagSuffixes: ['fp16', 'f16'],
};
export const DEFAULT_QUANT: QuantOption = {
  id: 'default',
  label: 'Default',
  quality: 'balanced',
  speed: 'medium',
  heat: 'warm',
  estimatedBytesPerParam: 0.6,
  notes: 'Ollama picks the tag; usually a Q4 build.',
};
export const MLX4: QuantOption = {
  id: 'mlx_4bit',
  label: '4-bit · Cool/Fast',
  quality: 'balanced',
  speed: 'fast',
  heat: 'cool',
  estimatedBytesPerParam: 0.55,
};
export const MLX8: QuantOption = {
  id: 'mlx_8bit',
  label: '8-bit · Quality',
  quality: 'high',
  speed: 'slow',
  heat: 'warm',
  estimatedBytesPerParam: 1.05,
};
export const SERVER_QUANT: QuantOption = {
  id: 'server_selected',
  label: 'Server-selected',
  quality: 'high',
  speed: 'medium',
  heat: 'warm',
  notes: 'Quantization is chosen by the server/provider, not handoff.',
};

/** Ollama quant set: real, per-model tags exist for these; fall back to default. */
const OLLAMA_QUANTS: QuantOption[] = [Q4, Q5, Q8, DEFAULT_QUANT];
const MLX_QUANTS: QuantOption[] = [MLX4, MLX8];
const GGUF_QUANTS: QuantOption[] = [Q4, Q5, Q8, FP16];
const SERVER_QUANTS: QuantOption[] = [SERVER_QUANT];

export const CATALOG_VERSION = '2026-07-03';
