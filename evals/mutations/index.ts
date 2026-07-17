import type { Scenario } from '../schema/types.js';
import { Rng } from '../generators/prng.js';

/**
 * A mutation deterministically transforms a scenario given an Rng. Each declares
 * the capability it stresses. Mutations here are MEANING-PRESERVING with respect
 * to the scenario's ground truth and expected behaviors: they change surface
 * conditions (wording, distractors, persona, requested length) so the SAME
 * expected outcome is tested under harder inputs. Under the deterministic mock
 * model these mainly validate instance plumbing/scale; against a live model they
 * genuinely stress robustness (paraphrase invariance, distractor resistance, etc).
 *
 * Mutations that would change the correct answer (e.g. injecting a new required
 * behavior) are intentionally NOT included — those must be authored as distinct
 * canonical scenarios so ground truth stays correct.
 */
export interface Mutation {
  name: string;
  stresses: string;
  apply: (s: Scenario, rng: Rng) => Scenario;
}

function editFirstUser(s: Scenario, fn: (t: string) => string): Scenario {
  const turns = s.turns.map((t, i) => (i === 0 ? { user: fn(t.user) } : t));
  return { ...s, turns };
}

const PARAPHRASE_PREFIXES = [
  'Quick question: ',
  'I need your help. ',
  'Please help me here. ',
  'Here is what I need. ',
];

function typo(word: string, rng: Rng): string {
  if (word.length < 4) return word;
  const i = rng.int(1, word.length - 2);
  return word.slice(0, i) + word[i + 1]! + word[i]! + word.slice(i + 2);
}

export const MUTATIONS: Mutation[] = [
  {
    name: 'paraphrase_request',
    stresses: 'instruction-following invariance to phrasing',
    apply: (s, rng) => editFirstUser(s, (t) => rng.pick(PARAPHRASE_PREFIXES) + t),
  },
  {
    name: 'add_distractor',
    stresses: 'resistance to irrelevant-but-plausible context',
    apply: (s, rng) =>
      editFirstUser(
        s,
        (t) =>
          t +
          '\n\n' +
          rng.pick([
            '(Unrelated: my coffee is cold.)',
            '(Aside: remember I like concise answers in general.)',
            '(Note: the weather today is irrelevant to this.)',
          ]),
      ),
  },
  {
    name: 'insert_typos',
    stresses: 'robustness to noisy user input',
    apply: (s, rng) =>
      editFirstUser(s, (t) =>
        t
          .split(' ')
          .map((w) => (rng.bool(0.15) ? typo(w, rng) : w))
          .join(' '),
      ),
  },
  {
    name: 'vary_expertise',
    stresses: 'adaptation to user expertise',
    apply: (s, rng) => ({
      ...s,
      persona: {
        ...(s.persona ?? {}),
        expertise: rng.pick(['novice', 'intermediate', 'advanced', 'expert'] as const),
      },
    }),
  },
  {
    name: 'vary_length',
    stresses: 'honoring requested answer length',
    apply: (s, rng) =>
      editFirstUser(
        s,
        (t) => t + ' ' + rng.pick(['Be brief.', 'Give full detail.', 'One paragraph, please.']),
      ),
  },
];

export function mutationByName(name: string): Mutation | undefined {
  return MUTATIONS.find((m) => m.name === name);
}
