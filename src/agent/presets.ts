import type { HardwareProfile } from '../system/hardware.js';
import { defaultContextForHardware, type PerformanceMode } from './advisor.js';
import { promptBudgetFor, type InferencePreset } from './contextBudget.js';

export type { InferencePreset } from './contextBudget.js';

/**
 * Inference presets bundle the four knobs that actually govern laptop feel —
 * context window, max output, keep-alive, and prompt budget — into one choice.
 *
 * The advisor already reasons in three `PerformanceMode`s (cool/balanced/max);
 * presets map onto those so the recommendation scorer is untouched. `cool` and
 * `fast` both use the cool mode (fast just clamps context lower for latency);
 * `deep` and `long_context` use max (long_context pushes context far past the
 * safe default and warns). `manual` changes nothing.
 */

export interface PresetResult {
  modelPerformanceMode: PerformanceMode;
  ollamaNumCtx: number;
  maxNewTokens: number;
  ollamaKeepAlive: string;
  maxPromptTokens: number;
  /** Non-fatal advisory (battery, long-context heat) to surface to the user. */
  warning?: string;
}

interface PresetSpec {
  mode: PerformanceMode;
  /** Derive the context window from hardware + mode. */
  context: (hw: HardwareProfile, mode: PerformanceMode) => number;
  maxNewTokens: number;
  keepAlivePlugged: string;
  keepAliveBattery: string;
}

const SPECS: Record<Exclude<InferencePreset, 'manual'>, PresetSpec> = {
  cool: {
    mode: 'cool',
    context: (hw, m) => defaultContextForHardware(hw, m),
    maxNewTokens: 1024,
    keepAlivePlugged: '5m',
    keepAliveBattery: '3m',
  },
  fast: {
    mode: 'cool',
    context: (hw, m) => Math.min(4096, defaultContextForHardware(hw, m)),
    maxNewTokens: 1024,
    keepAlivePlugged: '5m',
    keepAliveBattery: '3m',
  },
  balanced: {
    mode: 'balanced',
    context: (hw, m) => defaultContextForHardware(hw, m),
    maxNewTokens: 2048,
    keepAlivePlugged: '15m',
    keepAliveBattery: '5m',
  },
  deep: {
    mode: 'max',
    context: (hw, m) => defaultContextForHardware(hw, m),
    maxNewTokens: 4096,
    keepAlivePlugged: '30m',
    keepAliveBattery: '10m',
  },
  long_context: {
    mode: 'max',
    context: (hw, m) => Math.max(32768, defaultContextForHardware(hw, m)),
    maxNewTokens: 4096,
    keepAlivePlugged: '30m',
    keepAliveBattery: '10m',
  },
};

/** Human labels + one-line hints for the settings menu and `/model` notes. */
export const PRESET_LABELS: Record<InferencePreset, { label: string; hint: string }> = {
  cool: { label: 'Cool', hint: 'lowest heat, battery-friendly · small context, short output' },
  fast: { label: 'Fast', hint: 'lowest latency · 4K context, short output' },
  balanced: { label: 'Balanced', hint: 'the everyday laptop default' },
  deep: { label: 'Deep', hint: 'longer reasoning · bigger context/output · prefer plugged in' },
  long_context: {
    label: 'Long context',
    hint: '≥32K context · costly prefill & heat · not on battery',
  },
  manual: { label: 'Manual', hint: "leave context/output/keep-alive exactly as you've set them" },
};

/**
 * Resolve a preset into the concrete config field bundle for the current
 * hardware. `manual` returns no changes. Battery state shortens keep-alive and
 * adds a warning; `long_context` warns about prefill/heat (more so on battery).
 */
export function applyPreset(preset: InferencePreset, hw: HardwareProfile): PresetResult | null {
  if (preset === 'manual') return null;
  const spec = SPECS[preset];
  const onBattery = hw.power === 'battery';
  const ctx = spec.context(hw, spec.mode);

  const warnings: string[] = [];
  if (preset === 'long_context') {
    warnings.push(
      'Long context raises prefill latency, memory use, and heat — best plugged in, and overkill for most work.',
    );
  }
  if (onBattery && (preset === 'deep' || preset === 'long_context')) {
    warnings.push(
      'On battery: keep-alive shortened, and this preset is heavy — consider plugging in.',
    );
  }

  return {
    modelPerformanceMode: spec.mode,
    ollamaNumCtx: ctx,
    maxNewTokens: spec.maxNewTokens,
    ollamaKeepAlive: onBattery ? spec.keepAliveBattery : spec.keepAlivePlugged,
    maxPromptTokens: promptBudgetFor(preset, ctx),
    ...(warnings.length ? { warning: warnings.join(' ') } : {}),
  };
}
