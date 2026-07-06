import type { AdaptiveProfile, ScoredValue } from './profile.js';

/**
 * Render the profile into a compact "User preferences" block for the system
 * prompt. Kept short and high-confidence on purpose: a giant memory dump would
 * crowd out the actual task on a small local model. Deterministic output so it
 * caches well and is easy to test.
 */

export interface PromptContext {
  enabled: boolean;
  includeInPrompt: boolean;
  /** True for a cloud backend (hf). Gates whether the profile may be sent. */
  isCloudBackend: boolean;
  allowCloud: boolean;
  /** 'general' / off-work drops project- and research-specific lines. */
  focus: 'research' | 'general';
}

const EXPLICIT_MIN = 0.9;
const INFERRED_MIN = 0.6;
const MAX_LINES = 8;
const MAX_CHARS = 1200; // ≈300 tokens

function strong(s?: ScoredValue<unknown>, min = INFERRED_MIN): boolean {
  return !!s && s.confidence >= min;
}

function asList(v: unknown): string {
  return Array.isArray(v) ? (v as unknown[]).join(', ') : String(v);
}

/**
 * Build the block, or '' when disabled, gated, or empty. `ctx` decides whether
 * the profile may appear at all (cloud gate) and which lines are appropriate
 * (focus gate).
 */
export function buildPersonalizationPrompt(profile: AdaptiveProfile, ctx: PromptContext): string {
  if (!ctx.enabled || !ctx.includeInPrompt) return '';
  // Cloud gate: never send the profile to a cloud backend unless explicitly allowed.
  if (ctx.isCloudBackend && !ctx.allowCloud) return '';

  const global: string[] = []; // style/model lines, safe in any focus
  const project: string[] = []; // research/project-pattern lines, research focus only

  const s = profile.interactionStyle;
  if (strong(s.verbosity, EXPLICIT_MIN)) global.push(`Prefers ${s.verbosity!.value} answers.`);
  if (strong(s.tone, EXPLICIT_MIN)) global.push(`Prefers a ${s.tone!.value} tone.`);
  if (strong(s.prefersBullets, EXPLICIT_MIN) && s.prefersBullets!.value) global.push('Prefers bulleted answers.');
  if (strong(s.prefersCodeFirst, EXPLICIT_MIN) && s.prefersCodeFirst!.value) global.push('Prefers code first, prose after.');
  if (strong(s.prefersExplanationsBeforeEdits, EXPLICIT_MIN) && s.prefersExplanationsBeforeEdits!.value)
    global.push('Prefers a short plan/explanation before edits.');

  const mp = profile.modelAndPerformance;
  if (!ctx.allowCloud && profile.explicitPreferences.some((p) => p.key === 'avoid-cloud'))
    global.push('Prefers local-only models; do not suggest cloud backends.');
  if (strong(mp.prefersFastSmallModels, EXPLICIT_MIN) && mp.prefersFastSmallModels!.value)
    global.push('Prefers small/fast models for laptop comfort (heat-sensitive).');
  if (strong(mp.prefersCoolMode) && mp.prefersCoolMode!.value)
    global.push('Tends to run in cool/low-heat mode.');

  const cs = profile.codingStyle;
  if (strong(cs.preferredLanguages, EXPLICIT_MIN))
    project.push(`Prefers ${asList(cs.preferredLanguages!.value)} for experiments/code.`);

  const rs = profile.researchStyle;
  if (strong(rs.preferredPaperTemplates, EXPLICIT_MIN))
    project.push(`Prefers the ${asList(rs.preferredPaperTemplates!.value)} paper template.`);
  if (strong(rs.preferredCitationStyle, EXPLICIT_MIN))
    project.push(`Prefers ${rs.preferredCitationStyle!.value} citations.`);

  const th = profile.toolHabits;
  if (strong(th.oftenUsesResearch) && th.oftenUsesResearch!.value)
    project.push('Often fact-checks against the literature before writing.');

  // Any remaining generic explicit notes (unclassified "remember that ...").
  for (const pref of profile.explicitPreferences) {
    if (pref.key.startsWith('note-') && pref.confidence >= EXPLICIT_MIN && typeof pref.value === 'string') {
      global.push(String(pref.value).replace(/\.*$/, '.'));
    }
  }

  let lines = ctx.focus === 'general' ? global : [...global, ...project];
  if (!lines.length) return '';
  lines = lines.slice(0, MAX_LINES);

  let block = ['User preferences (local profile — adapt to these; the user can edit them):', ...lines.map((l) => `- ${l}`)].join('\n');
  if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS).replace(/\n- [^\n]*$/, '');
  return block;
}
