// Minimal OpenAlex client (https://docs.openalex.org) — free, keyless, broad
// coverage across every field. Used by the research tools.

import { retryFetch } from '../util/http.js';

const BASE = 'https://api.openalex.org/works';
// OpenAlex's "polite pool" just wants a contact; no personal data embedded.
const MAILTO = 'handoff-cli@users.noreply.github.com';

export interface Paper {
  id: string; // short OpenAlex id, e.g. "W2741809807"
  title: string;
  year: number;
  venue: string;
  citations: number;
  doi: string;
  oaUrl: string;
  authors: string[];
  abstract: string;
}

interface OAWork {
  id: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  doi?: string | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  open_access?: { oa_url?: string | null };
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** OpenAlex returns abstracts as an inverted index; rebuild the text. */
function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter((w) => w !== undefined).join(' ');
}

const shortId = (url: string): string => url.replace('https://openalex.org/', '');

function toPaper(w: OAWork): Paper {
  return {
    id: shortId(w.id),
    title: w.display_name ?? '(untitled)',
    year: w.publication_year ?? 0,
    venue: w.primary_location?.source?.display_name ?? '',
    citations: w.cited_by_count ?? 0,
    doi: (w.doi ?? '').replace('https://doi.org/', ''),
    oaUrl: w.open_access?.oa_url ?? '',
    authors: (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 4),
    abstract: reconstructAbstract(w.abstract_inverted_index),
  };
}

async function fetchWithRetry(url: string, maxAttempts = 3): Promise<Response> {
  return retryFetch(url, {}, maxAttempts);
}

export async function searchWorks(
  query: string,
  opts: { yearFrom?: number; limit?: number; sort?: 'relevance' | 'date' } = {},
): Promise<Paper[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    mailto: MAILTO,
  });

  // Filters join with commas in a single `filter` param.
  const filters: string[] = [];
  if (opts.yearFrom) filters.push(`from_publication_date:${opts.yearFrom}-01-01`);

  if (opts.sort === 'date') {
    // Newest first. OpenAlex has known future-dated junk records (e.g.
    // 2050-01-01) that a naive date sort floats to the top; cap the upper
    // bound at today's date so only real, already-published work is returned.
    const today = new Date().toISOString().slice(0, 10);
    filters.push(`to_publication_date:${today}`);
    params.set('sort', 'publication_date:desc');
  } else {
    params.set('sort', 'relevance_score:desc');
  }
  if (filters.length) params.set('filter', filters.join(','));

  const res = await fetchWithRetry(`${BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`OpenAlex search failed (HTTP ${res.status})`);
  const data = (await res.json()) as { results?: OAWork[] };
  return (data.results ?? []).map(toPaper);
}

export async function getWork(id: string): Promise<Paper> {
  const clean = shortId(id.trim());
  const res = await fetchWithRetry(`${BASE}/${clean}?mailto=${MAILTO}`);
  if (!res.ok) throw new Error(`OpenAlex lookup failed for ${clean} (HTTP ${res.status})`);
  return toPaper((await res.json()) as OAWork);
}

/**
 * Return the papers this work cites (its reference list).
 * Fetches the `referenced_works` URI list then batch-resolves up to `limit` of them.
 */
export async function getReferencedWorks(id: string, limit = 15): Promise<Paper[]> {
  const clean = shortId(id.trim());
  const res = await fetchWithRetry(
    `${BASE}/${clean}?select=referenced_works&mailto=${MAILTO}`,
  );
  if (!res.ok) throw new Error(`OpenAlex referenced_works failed for ${clean} (HTTP ${res.status})`);
  const data = (await res.json()) as { referenced_works?: string[] };
  const refs = (data.referenced_works ?? []).slice(0, Math.min(limit, 25));
  if (!refs.length) return [];
  const ids = refs.map(shortId).join('|');
  const batchRes = await fetchWithRetry(
    `${BASE}?filter=openalex_id:${ids}&per_page=${refs.length}&mailto=${MAILTO}`,
  );
  if (!batchRes.ok) return [];
  const batchData = (await batchRes.json()) as { results?: OAWork[] };
  return (batchData.results ?? []).map(toPaper);
}

/**
 * Return papers that cite this work, sorted by citation count descending.
 * Uses `GET /works?filter=cites:{id}`.
 */
export async function getCitingWorks(id: string, limit = 15): Promise<Paper[]> {
  const clean = shortId(id.trim());
  const params = new URLSearchParams({
    filter: `cites:${clean}`,
    sort: 'cited_by_count:desc',
    per_page: String(Math.min(limit, 25)),
    mailto: MAILTO,
  });
  const res = await fetchWithRetry(`${BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`OpenAlex citing-works failed for ${clean} (HTTP ${res.status})`);
  const data = (await res.json()) as { results?: OAWork[] };
  return (data.results ?? []).map(toPaper);
}
