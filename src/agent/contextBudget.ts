import type { Message } from './model.js';

/**
 * Lightweight token accounting for laptop context budgeting. We deliberately do
 * NOT pull in a tokenizer dependency: local models vary (Qwen, Gemma, Llama…)
 * and an exact count is not worth the weight. The ~4-chars-per-token heuristic
 * is close enough to keep a prompt off the slow, hot end of a laptop's context.
 */

export type InferencePreset = 'cool' | 'fast' | 'balanced' | 'deep' | 'long_context' | 'manual';

/** Rough token estimate for a string (≈ 4 chars per token). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Rough token estimate for a message list, counting roles + tool-call payloads. */
export function estimateMessagesTokens(msgs: Message[]): number {
  let total = 0;
  for (const m of msgs) {
    total += estimateTokens(m.content ?? '');
    total += 4; // per-message role/framing overhead
    if (m.tool_calls) {
      for (const c of m.tool_calls) {
        total += estimateTokens(c.function.name) + estimateTokens(c.function.arguments) + 4;
      }
    }
  }
  return total;
}

/**
 * The prompt-token budget for a preset — how much conversation we're willing to
 * send the model each turn. Bundled per preset (cool is tight, deep is roomy),
 * but never allowed past ~60% of the context window: the rest is reserved for
 * the model's own output and the backend's KV headroom. `manual` defers to half
 * the context window.
 */
export function promptBudgetFor(preset: InferencePreset, numCtx: number): number {
  const ceiling = Math.max(1024, Math.floor(numCtx * 0.6));
  const byPreset: Record<InferencePreset, number> = {
    cool: 5000,
    fast: 4000,
    balanced: 10000,
    deep: 20000,
    long_context: 24000,
    manual: Math.floor(numCtx * 0.5),
  };
  return Math.min(byPreset[preset], ceiling);
}

export interface TurnStats {
  promptTokens: number;
  totalMs: number;
  ttftMs?: number;
  outputTokens: number;
  budget: number;
  /** Ollama reported the model is not fully GPU-resident (CPU spill). */
  cpuSpill?: boolean;
}

export interface TurnAssessment {
  slow: boolean;
  message?: string;
}

/**
 * Decide whether a completed turn was slow enough to warrant a single,
 * actionable note to the user. Deliberately quiet: only fires on a clear
 * problem (CPU spill, an over-budget prompt, or genuinely sluggish output), and
 * points at the concrete fix rather than just complaining. Never shames.
 */
export function assessTurn(s: TurnStats): TurnAssessment {
  // CPU spill is the single biggest cause of a hot, crawling laptop — flag it
  // first and unconditionally, since throughput will look bad too.
  if (s.cpuSpill) {
    return {
      slow: true,
      message:
        'This model ran CPU/GPU mixed (spilled off the GPU) — the usual cause of heat and slow ' +
        'replies. Try a smaller model or lower context: /model doctor for specifics.',
    };
  }

  // A prompt well past its budget means history/tool-output is inflating prefill.
  if (s.promptTokens > s.budget * 1.5) {
    return {
      slow: true,
      message:
        `This turn's prompt was ~${Math.round(s.promptTokens / 1000)}K tokens (budget ` +
        `~${Math.round(s.budget / 1000)}K). Old tool output is being trimmed automatically; ` +
        'use /model cool for an even tighter budget.',
    };
  }

  // Sluggish output throughput, but only judge it once there's enough output to
  // be meaningful and the turn actually took a while.
  const secs = s.totalMs / 1000;
  const tps = secs > 0 ? s.outputTokens / secs : Infinity;
  if (s.outputTokens >= 40 && secs >= 8 && tps < 5) {
    return {
      slow: true,
      message:
        `Slow generation (~${tps.toFixed(1)} tok/s). Try /model fast or a smaller model; ` +
        'run /model benchmark --quick to measure this machine.',
    };
  }

  return { slow: false };
}
