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
 * Native Ollama calls always float `num_predict` up to at least this many
 * tokens (see model.ts) so a thinking model has room to close its `<think>`
 * block before hitting the cap — a tight preset cap alone can be spent
 * entirely on hidden reasoning, leaving no visible answer. Capped at half of
 * numCtx so the reserve itself never crowds out all room for the prompt on a
 * small context window. Shared with promptBudgetFor below so the two numbers
 * can never together add up to more than numCtx and overflow mid-turn.
 */
export function reasoningOutputReserve(numCtx: number): number {
  return Math.min(8192, Math.floor(numCtx / 2));
}

/**
 * The prompt-token budget for a preset — how much conversation we're willing to
 * send the model each turn. The roomy presets (`deep`, `long_context`, and the
 * user-controlled `manual`) scale with the context window so a capable machine
 * keeps long conversations coherent instead of dropping old turns early; the
 * calm presets (`cool`, `fast`, `balanced`) stay tight to keep a laptop cool.
 *
 * Every result is clamped to a `safeCeiling`: the window minus the reasoning
 * output reserve, times 0.85 as a margin against the rough ~4-chars/token
 * estimate and the backend's KV headroom. So `budget + reasoningOutputReserve`
 * can never sum past `numCtx` and overflow mid-turn, even if the estimate runs a
 * little low.
 */
export function promptBudgetFor(preset: InferencePreset, numCtx: number): number {
  // The usable prompt space is the window minus the output reserve, times 0.85
  // as a margin against the rough ~4-chars/token estimate and KV headroom.
  // Clamp the floor to `usable` itself so that on a very small window (e.g.
  // numCtx=1024, reserve=512) the invariant budget + reserve <= numCtx still
  // holds — a fixed 1024 floor used to overshoot there.
  const usable = Math.max(0, numCtx - reasoningOutputReserve(numCtx));
  const safeCeiling = Math.max(1, Math.min(usable, Math.floor(usable * 0.85)));
  const byPreset: Record<InferencePreset, number> = {
    cool: 5000,
    fast: 4000,
    balanced: 10000,
    deep: safeCeiling,
    long_context: safeCeiling,
    manual: safeCeiling,
  };
  return Math.min(byPreset[preset], safeCeiling);
}

export interface TurnStats {
  promptTokens: number;
  totalMs: number;
  ttftMs?: number;
  outputTokens: number;
  budget: number;
  /** Ollama reported the model is not fully GPU-resident (CPU spill). */
  cpuSpill?: boolean;
  /** The model emitted at least one reasoning (thinking) event this turn. */
  hadReasoning?: boolean;
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

  // Sluggish decode throughput — measure only the generation phase (after TTFT)
  // so thinking time doesn't inflate the denominator. Reasoning models appear
  // fine once TTFT is subtracted; truly slow hardware still shows up.
  const decodeMs = Math.max(1, s.totalMs - (s.ttftMs ?? 0));
  const decodeSecs = decodeMs / 1000;
  const tps = s.outputTokens / decodeSecs;
  if (s.outputTokens >= 40 && decodeSecs >= 4 && tps < 5) {
    // If the model was thinking, the slowness is expected — give a different,
    // non-alarmist message that points at the root cause.
    if (s.hadReasoning) {
      return {
        slow: true,
        message:
          `Model thought for ~${Math.round((s.ttftMs ?? 0) / 1000)}s before replying ` +
          `(${tps.toFixed(1)} tok/s decode). For faster conversational replies, switch to a ` +
          'non-thinking model: /model → change model.',
      };
    }
    return {
      slow: true,
      message:
        `Slow generation (~${tps.toFixed(1)} tok/s). Try /model fast or a smaller model; ` +
        'run /model benchmark --quick to measure this machine.',
    };
  }

  return { slow: false };
}
