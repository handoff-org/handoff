// arXiv public API: https://info.arxiv.org/help/api/index.html
// endpoint: https://export.arxiv.org/api/query?id_list=<id>

export interface ArxivPaper {
  id: string; // e.g. "2301.07041"
  title: string;
  abstract: string;
  authors: string[];
  published: string; // "YYYY-MM-DD"
  updated: string; // "YYYY-MM-DD"
  categories: string[];
  pdfUrl: string;
  absUrl: string;
  sourceUrl: string; // .tar.gz LaTeX source on arxiv.org
}

const USER_AGENT = 'handoff-research-companion/0.1 (https://github.com/ownhandoff/handoff)';

/** Extract the text content of an XML tag (first match). */
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  return m ? m[1]!.trim() : '';
}

function parseEntry(entry: string): ArxivPaper {
  // Canonical arXiv ID from the <id> URL, version-stripped.
  const rawId = tag(entry, 'id');
  const idMatch = rawId.match(/abs\/([\w./]+?)(?:v\d+)?$/);
  const id = idMatch ? idMatch[1]! : rawId;

  const title = tag(entry, 'title').replace(/\s+/g, ' ');
  const summary = tag(entry, 'summary').replace(/\s+/g, ' ');
  const published = tag(entry, 'published').slice(0, 10);
  const updated = tag(entry, 'updated').slice(0, 10);

  const authorMatches = [
    ...entry.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g),
  ];
  const authors = authorMatches.map((m) => m[1]!.trim());

  const catMatches = [...entry.matchAll(/term="([^"]+)"/g)];
  const categories = catMatches.map((m) => m[1]!).filter((c) => /^\w+\.\w+$/.test(c)); // e.g. "cs.LG"

  return {
    id,
    title,
    abstract: summary,
    authors,
    published,
    updated,
    categories,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    absUrl: `https://arxiv.org/abs/${id}`,
    sourceUrl: `https://arxiv.org/src/${id}`,
  };
}

/**
 * Fetch metadata for an arXiv paper from the public Atom API.
 * Accepts IDs in any common form: "2301.07041", "arxiv:2301.07041",
 * "https://arxiv.org/abs/2301.07041", "2301.07041v2".
 */
export async function fetchArxivPaper(rawId: string): Promise<ArxivPaper> {
  // Normalise: strip arxiv: prefix, URL, and version suffix.
  const normalized = rawId
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf|src)\//i, '')
    .replace(/v\d+$/, '')
    .trim();

  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(normalized)}&max_results=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`arXiv API error ${res.status}: ${res.statusText}`);

  const xml = await res.text();
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  if (totalMatch && totalMatch[1] === '0') {
    throw new Error(
      `arXiv paper "${normalized}" not found — check the ID format (e.g. 2301.07041)`,
    );
  }

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) throw new Error(`Unexpected arXiv API response for "${normalized}"`);

  return parseEntry(entryMatch[1]!);
}

/**
 * Search arXiv for preprints, live. This is the freshest source for CS / ML /
 * physics / math work: papers are indexed within a day of submission, often
 * weeks before they appear in OpenAlex or Crossref.
 *
 * `sort` defaults to 'submittedDate' (newest first) — the right choice for
 * "what's the latest on X". Multi-word queries are matched as a phrase for
 * precision (arXiv's default splits terms with OR, which is noisy). A raw
 * arXiv query syntax string (e.g. `cat:cs.LG`, `au:hinton`, boolean groups) is
 * passed through untouched so callers can target categories or authors.
 */
export async function searchArxiv(
  query: string,
  opts: { limit?: number; sort?: 'submittedDate' | 'relevance' } = {},
): Promise<ArxivPaper[]> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  const sortBy = opts.sort ?? 'submittedDate';

  // If the caller already used arXiv field syntax (all:, cat:, au:, ti:, abs:,
  // or a boolean operator), pass it through. Otherwise wrap a plain query as a
  // phrase over all fields so multi-word terms stay together.
  const trimmed = query.trim();
  const isFieldQuery =
    /\b(all|ti|abs|au|cat|co|jr|rn|id):/i.test(trimmed) || /\b(AND|OR|ANDNOT)\b/.test(trimmed);
  const searchQuery = isFieldQuery ? trimmed : `all:"${trimmed.replace(/"/g, '')}"`;

  const params = new URLSearchParams({
    search_query: searchQuery,
    sortBy,
    sortOrder: 'descending',
    max_results: String(limit),
  });

  const res = await fetch(`https://export.arxiv.org/api/query?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`arXiv API error ${res.status}: ${res.statusText}`);

  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((m) => parseEntry(m[1]!));
}
