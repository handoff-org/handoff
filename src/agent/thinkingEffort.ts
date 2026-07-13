/**
 * Thinking-effort dial: a single manual control for how hard the model reasons
 * per turn. `low` turns reasoning off for fast, direct replies; higher levels
 * escalate; `max` also removes the output cap so a long reasoning + answer is
 * never truncated. This is the primary latency lever, replacing the two-model
 * router as the default way to trade speed for depth.
 *
 * Backend mapping (see effortToParams): the `think` value is sent to Ollama's
 * native /api/chat `think` field, which accepts a boolean OR a string level
 * ('low'|'medium'|'high'). Models built for graduated reasoning (gpt-oss) honor
 * the string levels distinctly; others coerce any truthy value to full thinking.
 */

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

/** Dial positions in ascending order — the ←/→ cycle order and display order. */
export const THINKING_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'max'];

export interface EffortParams {
  /** Sent verbatim to the backend's think field (Ollama native accepts either). */
  think: boolean | 'low' | 'medium' | 'high';
  /** max → drop the num_predict cap so long reasoning + answer never truncates. */
  uncapOutput: boolean;
}

/** Map a dial position to the concrete backend parameters. */
export function effortToParams(effort: ThinkingEffort): EffortParams {
  switch (effort) {
    case 'low':
      return { think: false, uncapOutput: false }; // fastest — no reasoning
    case 'medium':
      return { think: true, uncapOutput: false }; // default reasoning
    case 'high':
      return { think: 'high', uncapOutput: false }; // deep reasoning
    case 'max':
      return { think: 'high', uncapOutput: true }; // deep + never truncate
  }
}

/**
 * Cycle the dial one step, wrapping around ("loop through" per the ←/→ keys).
 * dir=1 moves toward max (right arrow); dir=-1 toward low (left arrow).
 */
export function cycleEffort(effort: ThinkingEffort, dir: 1 | -1): ThinkingEffort {
  const i = THINKING_EFFORTS.indexOf(effort);
  const base = i === -1 ? 0 : i;
  const n = THINKING_EFFORTS.length;
  return THINKING_EFFORTS[(base + dir + n) % n]!;
}

/** Parse a user-typed effort (e.g. from /effort), or null if unrecognized. */
export function parseEffort(raw: string): ThinkingEffort | null {
  const v = raw.trim().toLowerCase();
  return (THINKING_EFFORTS as string[]).includes(v) ? (v as ThinkingEffort) : null;
}

/** Compact display label for the dial, e.g. "‹ medium ›". */
export function effortLabel(effort: ThinkingEffort): string {
  return `‹ ${effort} ›`;
}
