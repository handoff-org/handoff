import { cachePaper, loadCachedPaper } from './cache.js';
import { getCitingWorks, getReferencedWorks, type Paper } from './openalex.js';
import { appendNotebook } from './notebook.js';

export type SnowballDirection = 'forward' | 'backward' | 'both';

export interface SnowballResult {
  paperId: string;
  direction: SnowballDirection;
  papers: Paper[];
}

/**
 * Expand citations from a seed paper using OpenAlex.
 *
 * backward = papers this work cites (its reference list)
 * forward  = papers that cite this work (its citing papers, by impact)
 * both     = backward first, then forward
 *
 * Papers already in the local cache are considered "known" and skipped —
 * only genuinely new discoveries are returned and logged to the notebook.
 * Depth 2 recurses once into each first-layer paper found; cap is enforced
 * across the entire traversal so depth-2 won't exceed `limit`.
 */
export async function snowball(
  slug: string,
  paperId: string,
  direction: SnowballDirection,
  depth = 1,
  limit = 15,
): Promise<SnowballResult> {
  const clampedDepth = Math.max(1, Math.min(depth, 2));
  const clampedLimit = Math.max(1, Math.min(limit, 20));
  const seen = new Set<string>([paperId]);
  const results: Paper[] = [];

  async function expand(id: string, dir: 'forward' | 'backward', currentDepth: number): Promise<void> {
    if (results.length >= clampedLimit) return;

    const candidates = dir === 'backward'
      ? await getReferencedWorks(id, clampedLimit)
      : await getCitingWorks(id, clampedLimit);

    const fresh: Paper[] = [];
    for (const p of candidates) {
      if (results.length >= clampedLimit) break;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const already = await loadCachedPaper(p.id);
      if (already) continue;
      results.push(p);
      fresh.push(p);
      await cachePaper(p);
    }

    if (fresh.length > 0) {
      appendNotebook(slug, {
        type: 'literature-find',
        summary: `Snowball ${dir} depth ${currentDepth}: ${fresh.length} new paper${fresh.length !== 1 ? 's' : ''} from ${id}`,
        details: fresh
          .map((p) => `${p.id}  "${p.title}" — ${p.authors[0] ?? '?'} (${p.year})`)
          .join('\n'),
      });
    }

    if (currentDepth > 1) {
      for (const p of fresh) {
        if (results.length >= clampedLimit) break;
        await expand(p.id, dir, currentDepth - 1);
      }
    }
  }

  if (direction === 'backward' || direction === 'both') {
    await expand(paperId, 'backward', clampedDepth);
  }
  if (direction === 'forward' || direction === 'both') {
    await expand(paperId, 'forward', clampedDepth);
  }

  return { paperId, direction, papers: results };
}
