import type { ActiveTask } from './systemPrompt.js';

export type RouteTier = 'fast' | 'think' | 'keep';

export interface RouterContext {
  focus: 'research' | 'general';
  activeTask?: ActiveTask;
  lastTier: 'fast' | 'think' | null;
  hadToolCalls: boolean;
  historyLength: number;
}

const THINK_KEYWORDS = [
  'abstract',
  'introduction',
  'related work',
  'methodology',
  'literature',
  'paper',
  'draft',
  'outline',
  'synthesize',
  'analyze',
  'evaluate',
  'reasoning',
  'hypothesis',
  'results',
  'conclusion',
];

function hasThinkKeywords(message: string): boolean {
  const lower = message.toLowerCase();
  return THINK_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Classify a user message into a routing tier. Rules are evaluated top-to-bottom;
 * first match wins. Returns 'keep' to continue the last tier, 'fast' for the
 * lightweight model, or 'think' for the reasoning model.
 */
export function classifyTurn(message: string, ctx: RouterContext): RouteTier {
  // 1. Tool-call chain continuity — stay on current model for the follow-up.
  if (ctx.hadToolCalls) return 'keep';

  // 2. Short follow-up with no research keywords — keep the current tier.
  if (
    ctx.lastTier !== null &&
    message.trim().split(/\s+/).length <= 6 &&
    !hasThinkKeywords(message)
  ) {
    return 'keep';
  }

  // 3. Slash commands — don't route on commands, keep current tier.
  if (message.startsWith('/')) return 'keep';

  // 4. Project context signals paper work → think (checked before short-message
  //    heuristic so a brief question in paper context still uses the think model).
  if (ctx.focus === 'research' && (ctx.activeTask === 'paper' || ctx.activeTask === 'literature')) {
    return 'think';
  }

  // 5. Very short message with no research keywords → fast (general focus only).
  //    In research focus the default is think (rule 8), so skip this shortcut there
  //    to avoid silently routing brief navigational questions to the weaker model.
  if (ctx.focus !== 'research' && message.trim().length <= 30 && !hasThinkKeywords(message)) {
    return 'fast';
  }

  // 6. Explicit research/paper keywords → think.
  if (hasThinkKeywords(message)) return 'think';

  // 7. Long message → think (likely a detailed research prompt).
  if (message.length > 280) return 'think';

  // 8. Research focus default → think.
  //    In research mode, use the capable model unless a prior rule already
  //    returned fast/keep. This avoids silently downgrading turns that have no
  //    keywords but are still part of a research session (e.g. "what's in the
  //    project?", "run it"). Hysteresis (app.tsx) prevents unnecessary switches.
  if (ctx.focus === 'research') return 'think';

  // 9. General focus default → fast.
  return 'fast';
}

/**
 * Resolve a RouteTier to a concrete 'fast' | 'think' tier.
 * 'keep' falls back to lastTier, defaulting to 'think' if no history.
 */
export function resolveModel(tier: RouteTier, lastTier: 'fast' | 'think' | null): 'fast' | 'think' {
  if (tier === 'keep') return lastTier ?? 'think';
  return tier;
}

/** Short human-readable note shown in the chat after each routed turn. */
export function formatTierNote(tier: 'fast' | 'think', modelId: string): string {
  return `${tier} model · ${modelId}`;
}

/** How often the per-turn routing note is shown. */
export type RouterNotesMode = 'off' | 'changes' | 'always';

/**
 * Decide whether to show the per-turn tier note. Default ('changes') keeps the
 * chat quiet by only announcing when the model tier actually switches, or when
 * the user forced a tier this turn (so the override is acknowledged). 'always'
 * shows every turn (debugging); 'off' never shows it.
 */
export function shouldShowTierNote(
  mode: RouterNotesMode,
  prevShownTier: 'fast' | 'think' | null,
  nextTier: 'fast' | 'think',
  forced: boolean,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  // 'changes': show on a tier switch or an explicit override.
  return forced || prevShownTier !== nextTier;
}
