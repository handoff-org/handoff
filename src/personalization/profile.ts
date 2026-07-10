import { z } from 'zod';

/**
 * The local adaptive profile: a compact, inspectable record of the user's
 * preferences and habits, stored at ~/.handoff/profile.json. It is never sent
 * anywhere; it only ever shapes handoff's behaviour on this machine. See
 * src/personalization/{store,learn,prompt,redaction}.ts for the pieces that
 * read and write it.
 *
 * Design rules encoded in the shape below:
 *  - Explicit (user-stated) preferences are high-confidence; inferred ones are
 *    lower and easy to revise.
 *  - Everything carries confidence + evidence so `/profile why` can explain it.
 *  - Sub-sections are all optional so a nearly-empty profile still validates.
 */

export const PROFILE_VERSION = 1;

const ScoredValueSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: inner,
    confidence: z.number().min(0).max(1),
    evidenceCount: z.number().int().min(0),
    updatedAt: z.string(),
  });

export type ScoredValue<T> = {
  value: T;
  confidence: number;
  evidenceCount: number;
  updatedAt: string;
};

const ProfilePreferenceSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['explicit', 'inferred', 'system']),
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  evidenceCount: z.number().int().min(0),
  lastEvidence: z.string().optional(),
});
export type ProfilePreference = z.infer<typeof ProfilePreferenceSchema>;

const ProfileNoteSchema = z.object({
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  source: z.enum(['explicit', 'benchmark', 'inferred']),
});
export type ProfileNote = z.infer<typeof ProfileNoteSchema>;

const sv = ScoredValueSchema;

export const AdaptiveProfileSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),

  explicitPreferences: z.array(ProfilePreferenceSchema).default([]),
  inferredPreferences: z.array(ProfilePreferenceSchema).default([]),

  interactionStyle: z
    .object({
      verbosity: sv(z.enum(['concise', 'balanced', 'detailed'])).optional(),
      tone: sv(z.enum(['direct', 'friendly', 'technical', 'academic'])).optional(),
      prefersBullets: sv(z.boolean()).optional(),
      prefersCodeFirst: sv(z.boolean()).optional(),
      prefersExplanationsBeforeEdits: sv(z.boolean()).optional(),
      prefersAskUserChoices: sv(z.boolean()).optional(),
    })
    .default({}),

  researchStyle: z
    .object({
      preferredPaperTemplates: sv(z.array(z.string())).optional(),
      preferredCitationStyle: sv(z.string()).optional(),
      preferredOutputFormats: sv(z.array(z.string())).optional(),
      commonProjectTypes: sv(z.array(z.string())).optional(),
      commonResearchDomains: sv(z.array(z.string())).optional(),
    })
    .default({}),

  codingStyle: z
    .object({
      preferredLanguages: sv(z.array(z.string())).optional(),
      preferredPackageManagers: sv(z.array(z.string())).optional(),
      preferredTestCommands: sv(z.array(z.string())).optional(),
    })
    .default({}),

  modelAndPerformance: z
    .object({
      preferredBackend: sv(z.string()).optional(),
      preferredModels: sv(z.array(z.string())).optional(),
      rejectedModels: sv(z.array(z.string())).optional(),
      laptopPerformanceNotes: z.array(ProfileNoteSchema).default([]),
      safeDefaultContextTokens: sv(z.number()).optional(),
      prefersCoolMode: sv(z.boolean()).optional(),
      prefersFastSmallModels: sv(z.boolean()).optional(),
    })
    .default({ laptopPerformanceNotes: [] }),

  toolHabits: z
    .object({
      frequentCommands: sv(z.array(z.string())).optional(),
      preferredMode: sv(z.enum(['permissions', 'auto'])).optional(),
      oftenUsesOverleaf: sv(z.boolean()).optional(),
      oftenUsesResearch: sv(z.boolean()).optional(),
    })
    .default({}),

  projectDefaults: z
    .object({
      defaultPaperTemplate: sv(z.string()).optional(),
      defaultExperimentLanguage: sv(z.string()).optional(),
    })
    .default({}),

  privacy: z
    .object({
      allowProfileInCloudPrompts: z.boolean().default(false),
      allowDomainInference: z.boolean().default(true),
      allowProjectPatternLearning: z.boolean().default(true),
      redactionEnabled: z.boolean().default(true),
    })
    .default({
      allowProfileInCloudPrompts: false,
      allowDomainInference: true,
      allowProjectPatternLearning: true,
      redactionEnabled: true,
    }),

  /** Raw counters for the threshold model, keyed by "<kind>:<value>". Not shown to the user. */
  counters: z.record(z.string(), z.number()).default({}),

  ignoredSuggestions: z.array(z.string()).default([]),
});

export type AdaptiveProfile = z.infer<typeof AdaptiveProfileSchema>;

/** A fresh, empty profile stamped with `now` (ISO string). */
export function defaultProfile(now: string): AdaptiveProfile {
  return AdaptiveProfileSchema.parse({
    version: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Bring a parsed-but-untrusted object up to the current schema. Unknown/older
 * versions we can't confidently migrate become a fresh profile (callers back up
 * the original file first). Returns null when the input can't be salvaged.
 */
export function migrate(raw: unknown, _now: string): AdaptiveProfile | null {
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { version?: unknown }).version === PROFILE_VERSION
  ) {
    const parsed = AdaptiveProfileSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  // No older versions exist yet; anything else is unsalvageable.
  return null;
}

// ── Formatting for /profile show and /profile why ──────────────────────────────

function fmtScored(label: string, s?: ScoredValue<unknown>): string | null {
  if (!s) return null;
  const v = Array.isArray(s.value) ? (s.value as unknown[]).join(', ') : String(s.value);
  if (!v) return null;
  const conf = Math.round(s.confidence * 100);
  return `  ${label}: ${v}  (${conf}%)`;
}

/** A readable, compact summary of everything learned — for `/profile show`. */
export function formatProfileSummary(p: AdaptiveProfile): string {
  const lines: string[] = [`Personalization profile (local · ~/.handoff/profile.json)`, ''];

  if (p.explicitPreferences.length) {
    lines.push('Stated preferences:');
    for (const pref of p.explicitPreferences) {
      lines.push(`  • ${pref.value ? String(pref.value) : pref.key}  [${pref.key}]`);
    }
    lines.push('');
  }

  const style: (string | null)[] = [
    fmtScored('verbosity', p.interactionStyle.verbosity),
    fmtScored('tone', p.interactionStyle.tone),
    fmtScored('bullets', p.interactionStyle.prefersBullets),
    fmtScored('code-first', p.interactionStyle.prefersCodeFirst),
  ];
  if (style.some(Boolean)) {
    lines.push('Interaction style:', ...style.filter((x): x is string => !!x), '');
  }

  const research: (string | null)[] = [
    fmtScored('paper templates', p.researchStyle.preferredPaperTemplates),
    fmtScored('citation style', p.researchStyle.preferredCitationStyle),
    fmtScored('domains', p.researchStyle.commonResearchDomains),
  ];
  if (research.some(Boolean)) {
    lines.push('Research style:', ...research.filter((x): x is string => !!x), '');
  }

  const coding: (string | null)[] = [
    fmtScored('languages', p.codingStyle.preferredLanguages),
    fmtScored('experiment language', p.projectDefaults.defaultExperimentLanguage),
  ];
  if (coding.some(Boolean)) {
    lines.push('Coding:', ...coding.filter((x): x is string => !!x), '');
  }

  const model: (string | null)[] = [
    fmtScored('preferred backend', p.modelAndPerformance.preferredBackend),
    fmtScored('preferred models', p.modelAndPerformance.preferredModels),
    fmtScored('rejected models', p.modelAndPerformance.rejectedModels),
    fmtScored('prefers fast/small', p.modelAndPerformance.prefersFastSmallModels),
  ];
  if (model.some(Boolean)) {
    lines.push('Models & performance:', ...model.filter((x): x is string => !!x), '');
  }

  const habits: (string | null)[] = [
    fmtScored('frequent commands', p.toolHabits.frequentCommands),
    fmtScored('preferred mode', p.toolHabits.preferredMode),
    fmtScored('uses Overleaf', p.toolHabits.oftenUsesOverleaf),
    fmtScored('uses /research', p.toolHabits.oftenUsesResearch),
  ];
  if (habits.some(Boolean)) {
    lines.push('Habits:', ...habits.filter((x): x is string => !!x), '');
  }

  if (lines.length <= 2) {
    lines.push('(nothing learned yet — state a preference like "from now on, always use NeurIPS")');
  }
  lines.push(
    '',
    'Manage: /profile disable · /profile forget <key> · /profile reset · /profile export',
  );
  return lines.join('\n');
}

/** Explain one preference (source, confidence, evidence) — for `/profile why <key>`. */
export function explainPreference(p: AdaptiveProfile, key: string): string {
  const all = [...p.explicitPreferences, ...p.inferredPreferences];
  const pref = all.find((x) => x.key === key || x.key.endsWith(`:${key}`));
  if (!pref) return `No preference found for "${key}". See /profile show for keys.`;
  return [
    `${pref.key}`,
    `  value:      ${pref.value ? String(pref.value) : '(structured)'}`,
    `  source:     ${pref.source}`,
    `  confidence: ${Math.round(pref.confidence * 100)}%`,
    `  evidence:   ${pref.evidenceCount} observation(s)`,
    ...(pref.lastEvidence ? [`  last:       ${pref.lastEvidence}`] : []),
    `  updated:    ${pref.updatedAt}`,
  ].join('\n');
}
