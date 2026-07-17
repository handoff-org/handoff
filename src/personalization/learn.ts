import type { AdaptiveProfile, ProfilePreference, ScoredValue } from './profile.js';

/**
 * The learning pipeline: pure, deterministic functions (every one takes `now`)
 * that fold new evidence into the profile.
 *
 * v1 scope: capture EXPLICIT stated preferences (high confidence), personalize
 * MODELS, and count a few clean tool/command habits. It deliberately does NOT
 * infer fuzzy things like writing style or workflow shape from behaviour — those
 * fields are only ever set by an explicit statement.
 */

// ── Explicit preference detection ─────────────────────────────────────────────

export interface Detected {
  /** Stable kebab key, e.g. "verbosity", "paper-template", "rejected-model". */
  key: string;
  /** Concise human phrase to store (still passes the privacy gate at the call site). */
  phrase: string;
}

// A standing-preference must be signalled explicitly — we require one of these
// triggers so a one-off request ("write the code first") isn't mistaken for a
// permanent preference. Precision over recall for a persistent store.
const TRIGGER =
  /\b(remember(?: that)?|from now on|going forward|always|never|by default|i prefer|i'd prefer|i like|i don'?t like|i dislike|stop (?:doing|using))\b/i;

export function hasPreferenceTrigger(msg: string): boolean {
  return TRIGGER.test(msg);
}

const VENUE = /\b(neurips|acl|icml|iclr|emnlp|naacl|cvpr|ieee|acm|sigchi)\b/i;

/**
 * Classify a preference-bearing message into a structured key + concise phrase,
 * or null if it carries no standing preference. Only the first strong match is
 * returned; unmatched-but-triggered messages fall through to a generic capture.
 */
export function detectExplicitPreference(msg: string): Detected | null {
  const m = msg.trim();
  const low = m.toLowerCase();

  // Model rejections are a standing signal even without a "from now on" trigger —
  // the strict model-id shape (contains ':' or a digit) keeps false positives low.
  const reject = low.match(/(?:don'?t|never|stop)\s+us\w*\s+([\w.:-]+)/);
  const hot = low.match(
    /([\w.:]+:[\w.-]+|[\w.-]+:\d+\w*)\s+(?:overheats|runs hot|is too (?:slow|hot)|too slow|too hot)/,
  );
  if (reject && /[:\d]/.test(reject[1]!))
    return { key: 'rejected-model', phrase: `avoid model ${reject[1]}` };
  if (hot) return { key: 'rejected-model', phrase: `avoid model ${hot[1]}` };

  // Everything else must be signalled explicitly as a standing preference, so a
  // one-off request isn't mistaken for a permanent one.
  if (!hasPreferenceTrigger(m)) return null;

  // Verbosity
  if (
    /\b(short|concise|brief|terse)\b/.test(low) &&
    /\b(answer|response|repl|explanation)/.test(low)
  ) {
    return { key: 'verbosity', phrase: 'prefers concise answers' };
  }
  if (/\b(detailed|thorough|in[- ]depth|verbose|elaborate)\b/.test(low)) {
    return { key: 'verbosity', phrase: 'prefers detailed answers' };
  }

  // Local-only / no cloud
  if (
    /\b(no cloud|don'?t use cloud|never use cloud|keep (everything )?local|local[- ]only)\b/.test(
      low,
    )
  ) {
    return { key: 'avoid-cloud', phrase: 'prefers local-only models (no cloud)' };
  }

  // Paper template / venue
  if (VENUE.test(low) && /\b(format|template|style|paper)\b/.test(low)) {
    const v = (low.match(VENUE)?.[1] ?? '').toUpperCase();
    return { key: 'paper-template', phrase: `prefers the ${v} paper template` };
  }

  // Citation style
  const cite = low.match(/\b(apa|mla|ieee|chicago|natbib|bibtex)\b/);
  if (cite && /\b(cite|citation|reference|bib)/.test(low)) {
    return { key: 'citation-style', phrase: `prefers ${cite[1]!.toUpperCase()} citations` };
  }

  // Experiment / coding language
  const lang = low.match(/\b(python|r|julia|typescript|javascript|rust|go)\b/);
  if (lang && /\b(experiment|code|script|language|write)/.test(low)) {
    return { key: 'experiment-language', phrase: `prefers ${lang[1]} for experiments/code` };
  }

  // Prefer a specific model ("use X by default")
  const useDefault =
    low.match(/\buse\s+([\w.:-]+)\s+by default\b/) ??
    low.match(/\bdefault(?:\s+model)?\s+(?:to|is)\s+([\w.:-]+)/);
  if (useDefault && /[:\d]/.test(useDefault[1]!)) {
    return { key: 'preferred-model', phrase: `prefers model ${useDefault[1]}` };
  }

  // Fast/small models for laptop comfort
  if (
    /\b(small|fast|light|smaller|quantiz)\w*\b/.test(low) &&
    /\b(model|laptop|heat|hot|battery)\b/.test(low)
  ) {
    return { key: 'fast-small-models', phrase: 'prefers small/fast models for laptop comfort' };
  }

  // Interaction style toggles
  if (/\bbullet/.test(low)) return { key: 'bullets', phrase: 'prefers bulleted answers' };
  if (
    /\bcode (first|immediately)\b/.test(low) ||
    /\bjust (write|give me) (the )?code\b/.test(low)
  ) {
    return { key: 'code-first', phrase: 'prefers code first, prose after' };
  }
  if (
    /\b(explain|plan)\b.*\b(before|first)\b/.test(low) &&
    /\b(edit|chang|code|implement)/.test(low)
  ) {
    return { key: 'explain-first', phrase: 'prefers an explanation/plan before edits' };
  }
  const tone = low.match(/\b(direct|blunt|academic|technical|friendly)\b/);
  if (tone && /\b(tone|answer|be|keep it|response|style)\b/.test(low)) {
    const t = tone[1] === 'blunt' ? 'direct' : (tone[1] as string);
    return { key: 'tone', phrase: `prefers a ${t} tone` };
  }

  // Generic capture: a triggered statement we couldn't classify. Keep the clause
  // itself (sanitized at the call site) so "remember that ..." is never lost.
  const clause = m
    .replace(/^.*?\b(remember(?: that)?|from now on|going forward)\b[:,]?\s*/i, '')
    .trim();
  return { key: `note-${slug(clause).slice(0, 24) || 'pref'}`, phrase: clause || m };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Applying explicit preferences ──────────────────────────────────────────────

function scored<T>(
  value: T,
  confidence: number,
  now: string,
  prev?: ScoredValue<T>,
): ScoredValue<T> {
  return {
    value,
    confidence: Math.max(confidence, prev?.confidence ?? 0),
    evidenceCount: (prev?.evidenceCount ?? 0) + 1,
    updatedAt: now,
  };
}

function mergeUnique(prev: string[] | undefined, add: string, drop?: string): string[] {
  const set = new Set(prev ?? []);
  if (drop) set.delete(drop);
  set.add(add);
  return [...set];
}

/**
 * Fold a detected explicit preference into the profile: record it in
 * explicitPreferences (confidence 0.9) and set the mapped structured field.
 * `phrase` is the already-sanitized value to store. Returns a new profile.
 */
export function applyExplicit(
  profile: AdaptiveProfile,
  d: Detected,
  phrase: string,
  now: string,
): AdaptiveProfile {
  const p: AdaptiveProfile = structuredClone(profile);

  // 1. The explicit preference record (source of truth for /profile show/why).
  const existing = p.explicitPreferences.find((x) => x.key === d.key);
  if (existing) {
    existing.value = phrase;
    existing.confidence = 0.9;
    existing.evidenceCount += 1;
    existing.updatedAt = now;
    existing.lastEvidence = phrase;
  } else {
    const pref: ProfilePreference = {
      key: d.key,
      value: phrase,
      source: 'explicit',
      confidence: 0.9,
      createdAt: now,
      updatedAt: now,
      evidenceCount: 1,
      lastEvidence: phrase,
    };
    p.explicitPreferences.push(pref);
  }

  // 2. The mapped structured field, so the rest of the app can act on it.
  const prevOf = <T>(v: ScoredValue<T> | undefined) => v;
  switch (d.key) {
    case 'verbosity':
      p.interactionStyle.verbosity = scored(
        /detailed/.test(phrase) ? 'detailed' : 'concise',
        0.9,
        now,
        prevOf(p.interactionStyle.verbosity),
      );
      break;
    case 'avoid-cloud':
      p.privacy.allowProfileInCloudPrompts = false;
      break;
    case 'paper-template': {
      const v = phrase.match(VENUE)?.[1]?.toUpperCase() ?? phrase;
      p.researchStyle.preferredPaperTemplates = scored(
        mergeUnique(p.researchStyle.preferredPaperTemplates?.value, v),
        0.9,
        now,
        p.researchStyle.preferredPaperTemplates,
      );
      p.projectDefaults.defaultPaperTemplate = scored(
        v,
        0.9,
        now,
        p.projectDefaults.defaultPaperTemplate,
      );
      break;
    }
    case 'citation-style': {
      const v =
        phrase.match(/\b(APA|MLA|IEEE|CHICAGO|NATBIB|BIBTEX)\b/i)?.[1]?.toUpperCase() ?? phrase;
      p.researchStyle.preferredCitationStyle = scored(
        v,
        0.9,
        now,
        p.researchStyle.preferredCitationStyle,
      );
      break;
    }
    case 'experiment-language': {
      const v =
        phrase.match(/\b(python|r|julia|typescript|javascript|rust|go)\b/i)?.[1]?.toLowerCase() ??
        phrase;
      p.projectDefaults.defaultExperimentLanguage = scored(
        v,
        0.9,
        now,
        p.projectDefaults.defaultExperimentLanguage,
      );
      p.codingStyle.preferredLanguages = scored(
        mergeUnique(p.codingStyle.preferredLanguages?.value, v),
        0.9,
        now,
        p.codingStyle.preferredLanguages,
      );
      break;
    }
    case 'preferred-model': {
      const v = phrase.match(/model\s+([\w.:-]+)/)?.[1] ?? phrase;
      p.modelAndPerformance.preferredModels = scored(
        mergeUnique(p.modelAndPerformance.preferredModels?.value, v),
        0.9,
        now,
        p.modelAndPerformance.preferredModels,
      );
      // A newly preferred model is no longer rejected.
      if (p.modelAndPerformance.rejectedModels) {
        p.modelAndPerformance.rejectedModels.value =
          p.modelAndPerformance.rejectedModels.value.filter((x) => x !== v);
      }
      break;
    }
    case 'rejected-model': {
      const v = phrase.match(/model\s+([\w.:-]+)/)?.[1] ?? phrase;
      p.modelAndPerformance.rejectedModels = scored(
        mergeUnique(p.modelAndPerformance.rejectedModels?.value, v),
        0.9,
        now,
        p.modelAndPerformance.rejectedModels,
      );
      if (p.modelAndPerformance.preferredModels) {
        p.modelAndPerformance.preferredModels.value =
          p.modelAndPerformance.preferredModels.value.filter((x) => x !== v);
      }
      break;
    }
    case 'fast-small-models':
      p.modelAndPerformance.prefersFastSmallModels = scored(
        true,
        0.9,
        now,
        p.modelAndPerformance.prefersFastSmallModels,
      );
      break;
    case 'bullets':
      p.interactionStyle.prefersBullets = scored(true, 0.9, now, p.interactionStyle.prefersBullets);
      break;
    case 'code-first':
      p.interactionStyle.prefersCodeFirst = scored(
        true,
        0.9,
        now,
        p.interactionStyle.prefersCodeFirst,
      );
      break;
    case 'explain-first':
      p.interactionStyle.prefersExplanationsBeforeEdits = scored(
        true,
        0.9,
        now,
        p.interactionStyle.prefersExplanationsBeforeEdits,
      );
      break;
    case 'tone': {
      const t = (phrase.match(/\b(direct|academic|technical|friendly)\b/)?.[1] ?? 'direct') as
        'direct' | 'academic' | 'technical' | 'friendly';
      p.interactionStyle.tone = scored(t, 0.9, now, p.interactionStyle.tone);
      break;
    }
    default:
      break; // generic note — the explicit pref record above is enough
  }

  p.updatedAt = now;
  return p;
}

/** Remove a preference (explicit or inferred) by key. Returns a new profile. */
export function forgetPreference(profile: AdaptiveProfile, key: string): AdaptiveProfile {
  const p: AdaptiveProfile = structuredClone(profile);
  p.explicitPreferences = p.explicitPreferences.filter((x) => x.key !== key);
  p.inferredPreferences = p.inferredPreferences.filter((x) => x.key !== key);
  p.updatedAt = new Date(0).toISOString(); // caller re-stamps on save; keep deterministic here
  return p;
}

// ── Inferred habits (light counting) ───────────────────────────────────────────

export interface PersonalizationEvent {
  type:
    | 'user_message'
    | 'tool_use'
    | 'model_selected'
    | 'model_benchmark'
    | 'settings_changed'
    | 'project_created'
    | 'paper_template_selected'
    | 'artifact_created'
    | 'command_used';
  timestamp: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Inferred confidence from an evidence count, damped by opposing evidence. */
export function confFor(count: number, opposing = 0): number {
  if (count < 3) return 0;
  const c = 0.55 + 0.1 * (count - 3) - 0.05 * opposing;
  return Math.max(0.4, Math.min(0.85, c));
}

function bump(counters: Record<string, number>, key: string): number {
  counters[key] = (counters[key] ?? 0) + 1;
  return counters[key];
}

function topByPrefix(counters: Record<string, number>, prefix: string, min = 3, n = 5): string[] {
  return Object.entries(counters)
    .filter(([k, v]) => k.startsWith(prefix) && v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k.slice(prefix.length));
}

/**
 * Record a low-confidence behavioural event. Uses raw counters + thresholds
 * (3+ observations → an inferred preference @0.55, rising with more evidence;
 * a competing choice damps confidence and can overtake). Never touches explicit
 * (0.9) fields with weaker inferred values. Returns a new profile.
 */
export function recordEvent(
  profile: AdaptiveProfile,
  e: PersonalizationEvent,
  now: string,
): AdaptiveProfile {
  const p: AdaptiveProfile = structuredClone(profile);
  const c = p.counters;
  const md = e.metadata ?? {};

  const setInferredScored = <T>(
    cur: ScoredValue<T> | undefined,
    value: T,
    conf: number,
  ): ScoredValue<T> | undefined => {
    if (conf <= 0) return cur;
    if (cur && cur.confidence > conf) return cur; // don't weaken a stronger (e.g. explicit) value
    return {
      value,
      confidence: conf,
      evidenceCount: (cur?.evidenceCount ?? 0) + 1,
      updatedAt: now,
    };
  };

  switch (e.type) {
    case 'command_used': {
      const cmd = String(md.command ?? '').trim();
      if (cmd) {
        bump(c, `cmd:${cmd}`);
        const freq = topByPrefix(c, 'cmd:');
        if (freq.length) {
          const top = c[`cmd:${freq[0]}`] ?? 0;
          p.toolHabits.frequentCommands = setInferredScored(
            p.toolHabits.frequentCommands,
            freq,
            confFor(top),
          );
        }
        if ((c['cmd:/research'] ?? 0) >= 3) {
          p.toolHabits.oftenUsesResearch = setInferredScored(
            p.toolHabits.oftenUsesResearch,
            true,
            confFor(c['cmd:/research']!),
          );
        }
        if ((c['cmd:/overleaf'] ?? 0) >= 3) {
          p.toolHabits.oftenUsesOverleaf = setInferredScored(
            p.toolHabits.oftenUsesOverleaf,
            true,
            confFor(c['cmd:/overleaf']!),
          );
        }
      }
      break;
    }
    case 'model_selected': {
      const id = String(md.modelId ?? '').trim();
      const backend = String(md.backend ?? '').trim();
      if (id) {
        const n = bump(c, `model:${id}`);
        const rejected = p.modelAndPerformance.rejectedModels?.value ?? [];
        if (n >= 3 && !rejected.includes(id)) {
          p.modelAndPerformance.preferredModels = setInferredScored(
            p.modelAndPerformance.preferredModels,
            mergeUnique(p.modelAndPerformance.preferredModels?.value, id),
            confFor(n),
          );
        }
      }
      if (backend) {
        const n = bump(c, `backend:${backend}`);
        p.modelAndPerformance.preferredBackend = setInferredScored(
          p.modelAndPerformance.preferredBackend,
          backend,
          confFor(n),
        );
      }
      break;
    }
    case 'model_benchmark': {
      const id = String(md.modelId ?? '').trim();
      const tier = String(md.tier ?? '');
      const fullGpu = md.fullGpu !== false;
      if (id && (tier === 'slow' || tier === 'bad' || !fullGpu)) {
        const text = `${id} ran ${!fullGpu ? 'CPU/GPU mixed (spill)' : tier} on this machine`;
        const notes = p.modelAndPerformance.laptopPerformanceNotes;
        if (!notes.some((nte) => nte.text === text)) {
          notes.push({ text, createdAt: now, source: 'benchmark' });
          if (notes.length > 20) notes.splice(0, notes.length - 20);
        }
      }
      break;
    }
    case 'settings_changed': {
      const key = String(md.key ?? '');
      const value = md.value;
      if (key === 'mode' && (value === 'auto' || value === 'permissions')) {
        const n = bump(c, `mode:${value}`);
        const other = value === 'auto' ? (c['mode:permissions'] ?? 0) : (c['mode:auto'] ?? 0);
        p.toolHabits.preferredMode = setInferredScored(
          p.toolHabits.preferredMode,
          value,
          confFor(n, other),
        );
      }
      if (key === 'performanceMode' && value === 'cool') {
        const n = bump(c, 'perf:cool');
        p.modelAndPerformance.prefersCoolMode = setInferredScored(
          p.modelAndPerformance.prefersCoolMode,
          true,
          confFor(n),
        );
      }
      break;
    }
    case 'project_created':
    case 'paper_template_selected': {
      const t = String(md.template ?? '').trim();
      if (t) {
        const n = bump(c, `template:${t}`);
        // Templates recur less often; use a lower threshold (2+).
        if (n >= 2) {
          const conf = Math.min(0.8, 0.5 + 0.1 * (n - 2));
          p.projectDefaults.defaultPaperTemplate = setInferredScored(
            p.projectDefaults.defaultPaperTemplate,
            t,
            conf,
          );
        }
      }
      break;
    }
    default:
      break;
  }

  p.updatedAt = now;
  return p;
}
