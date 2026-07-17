import type { Scenario } from '../schema/types.js';
import { Rng } from './prng.js';
import { MUTATIONS } from '../mutations/index.js';

/**
 * Expand a canonical scenario into `count` deterministic variant instances. The
 * same (canonical scenario, baseSeed, count) always produces identical instances.
 *
 * Each variant: derives a per-variant seed, chooses 1-2 meaning-preserving
 * mutations via the seeded Rng, applies them, and records provenance in
 * `generated` so a variant is reproducible and its stressed capabilities are known.
 * Variant IDs are `${id}#v${n}` and are unique.
 */
export function expandScenario(canonical: Scenario, baseSeed: number, count: number): Scenario[] {
  const out: Scenario[] = [];
  for (let n = 1; n <= count; n++) {
    const seed = baseSeed + n * 1009; // spread seeds deterministically
    const rng = new Rng(seed);
    const nMut = rng.int(1, 2);
    const chosen = rng.shuffle(MUTATIONS).slice(0, nMut);
    let s: Scenario = { ...canonical, turns: canonical.turns.map((t) => ({ ...t })) };
    for (const m of chosen) s = m.apply(s, rng);
    s = {
      ...s,
      id: `${canonical.id}#v${n}`,
      seed,
      generated: {
        from: canonical.id,
        seed,
        mutations: chosen.map((m) => m.name),
      },
    };
    out.push(s);
  }
  return out;
}

/** Expand a whole set of canonical scenarios to reach roughly `targetTotal`
 *  instances (canonical + variants), distributing variants evenly. */
export function expandAll(canonical: Scenario[], targetTotal: number, baseSeed = 42): Scenario[] {
  const perScenario = Math.max(
    0,
    Math.ceil((targetTotal - canonical.length) / Math.max(1, canonical.length)),
  );
  const all: Scenario[] = [];
  for (const c of canonical) {
    all.push(c);
    all.push(...expandScenario(c, baseSeed + hashId(c.id), perScenario));
  }
  return all;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
