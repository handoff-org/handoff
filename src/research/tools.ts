import type { ToolRegistry } from '../tools/registry.js';
import { searchWorks, getWork, type Paper } from './openalex.js';
import { cachePaper } from './cache.js';
import { fetchArxivPaper, searchArxiv, type ArxivPaper } from './arxiv.js';
import { appendNotebook } from './notebook.js';
import { getActiveProject } from '../workspace/project.js';

function snippet(text: string, n: number): string {
  if (!text) return '(no abstract available)';
  return text.length > n ? text.slice(0, n).trimEnd() + '…' : text;
}

function formatResult(p: Paper): string {
  const meta = [p.year || '?', p.venue, `${p.citations} cites`].filter(Boolean).join(' · ');
  return `[${p.id}] ${p.title} (${meta})\n  ${snippet(p.abstract, 220)}`;
}

function formatFull(p: Paper): string {
  const head = [
    p.title,
    [p.authors.join(', '), p.year || '?', p.venue, `${p.citations} citations`]
      .filter(Boolean)
      .join(' · '),
    p.doi ? `DOI: ${p.doi}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${head}\n\n${snippet(p.abstract, 1500)}`;
}

function formatArxivResult(p: ArxivPaper): string {
  const authors =
    p.authors.length > 4 ? p.authors.slice(0, 4).join(', ') + ' et al.' : p.authors.join(', ');
  const meta = [p.published, p.categories.slice(0, 3).join(', '), authors]
    .filter(Boolean)
    .join(' · ');
  return `[arxiv:${p.id}] ${p.title} (${meta})\n  ${snippet(p.abstract, 220)}`;
}

/** Register the broad-literature research tools (OpenAlex-backed, read-only). */
export function registerResearchTools(registry: ToolRegistry): void {
  registry.register({
    name: 'search_papers',
    description:
      'Search the scholarly literature live via OpenAlex (all fields, peer-reviewed + preprints, ' +
      'queried in real time — not limited by any training cutoff). ' +
      'Returns each result as "[id] title (year · venue · citations)" plus an abstract snippet. ' +
      'Use the id with get_paper to read the full abstract. ' +
      'Set sort="date" to get the most recent papers first (for "latest work on X" questions); ' +
      'the default sort="relevance" gets the most on-topic papers. ' +
      'Note: OpenAlex indexing lags new preprints by days-to-weeks — for the very freshest ' +
      'CS/ML/physics/math work, use search_arxiv instead.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms or a research question' },
        year_from: { type: 'string', description: 'Only papers published from this year onward (optional)' },
        sort: {
          type: 'string',
          enum: ['relevance', 'date'],
          description: 'relevance (default) = most on-topic; date = newest first (latest papers)',
        },
        limit: { type: 'string', description: 'Max results, 1-25 (default 8)' },
      },
      required: ['query'],
    },
    async execute({ query, year_from, sort, limit }) {
      const papers = await searchWorks(String(query), {
        yearFrom: year_from ? Number(year_from) : undefined,
        sort: sort === 'date' ? 'date' : 'relevance',
        limit: limit ? Number(limit) : 8,
      });
      if (papers.length === 0) return 'No papers found. Try broader or different terms.';
      return papers.map(formatResult).join('\n\n');
    },
  });

  registry.register({
    name: 'search_arxiv',
    description:
      'Search arXiv live for the freshest preprints (CS, ML, physics, math, stats, econ, bio). ' +
      'This is the fastest source for recent work: papers are indexed within a day of ' +
      'submission — often weeks before OpenAlex or Crossref pick them up. Queried in real ' +
      'time, so there is no training-data cutoff. ' +
      'Results are sorted newest-first by default (sort="submittedDate") — ideal for ' +
      '"what came out this week/month on X". Returns "[arxiv:id] title (date · categories · authors)" ' +
      'plus a snippet; pass the id to fetch_arxiv for full metadata and source links. ' +
      'A plain query is matched as a phrase; you can also pass raw arXiv syntax, e.g. ' +
      '`cat:cs.LG` (category), `au:Vaswani` (author), `ti:transformer` (title), or boolean ' +
      'groups like `all:diffusion AND cat:cs.CV`.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search terms (matched as a phrase) or raw arXiv query syntax ' +
            '(cat:/au:/ti:/abs:/all: fields, AND/OR/ANDNOT operators)',
        },
        sort: {
          type: 'string',
          enum: ['submittedDate', 'relevance'],
          description: 'submittedDate (default) = newest first; relevance = best match',
        },
        limit: { type: 'string', description: 'Max results, 1-25 (default 8)' },
      },
      required: ['query'],
    },
    async execute({ query, sort, limit }) {
      const papers = await searchArxiv(String(query), {
        sort: sort === 'relevance' ? 'relevance' : 'submittedDate',
        limit: limit ? Number(limit) : 8,
      });
      if (papers.length === 0) return 'No arXiv preprints found. Try broader terms or a category (e.g. cat:cs.LG).';
      return papers.map(formatArxivResult).join('\n\n');
    },
  });

  registry.register({
    name: 'get_paper',
    description:
      'Fetch the full abstract and metadata for one paper by its OpenAlex id (e.g. W2741809807). ' +
      'Caches it to the local research corpus. Read it before citing a paper.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'OpenAlex work id, e.g. W2741809807' },
      },
      required: ['id'],
    },
    async execute({ id }) {
      const paper = await getWork(String(id));
      await cachePaper(paper);
      // Journal: record the find in the active project's notebook.
      const meta = getActiveProject();
      if (meta) {
        appendNotebook(meta.slug, {
          type: 'literature-find',
          summary: `**${paper.title}** (${paper.year ?? '?'}, ${paper.citations} cites)\n${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ' et al.' : ''}`,
          details: paper.abstract ? `> ${snippet(paper.abstract, 400)}` : undefined,
        });
      }
      return formatFull(paper);
    },
  });

  registry.register({
    name: 'fetch_arxiv',
    description:
      'Fetch the full abstract, metadata, and source links for an arXiv preprint. ' +
      'Accepts any arXiv ID form: "2301.07041", "arxiv:2301.07041", or an arxiv.org URL. ' +
      'Caches the result locally and logs it to the project notebook. ' +
      'Use this before search_papers for any paper the user references by arXiv ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'arXiv paper ID or URL, e.g. "2301.07041" or "https://arxiv.org/abs/2301.07041"',
        },
      },
      required: ['id'],
    },
    async execute({ id }) {
      const paper = await fetchArxivPaper(String(id));

      // Cache as a Paper so the rest of the research pipeline can use it.
      await cachePaper({
        id: `arxiv:${paper.id}`,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        year: Number(paper.published.slice(0, 4)) || 0,
        venue: 'arXiv',
        doi: '',
        oaUrl: paper.absUrl,
        citations: 0,
      });

      // Journal.
      const meta = getActiveProject();
      if (meta) {
        appendNotebook(meta.slug, {
          type: 'literature-find',
          summary:
            `**${paper.title}** (arXiv:${paper.id}, ${paper.published})\n` +
            `${paper.authors.slice(0, 4).join(', ')}${paper.authors.length > 4 ? ' et al.' : ''}`,
          details: `> ${snippet(paper.abstract, 400)}\n\nPDF: ${paper.pdfUrl}`,
        });
      }

      const authorStr =
        paper.authors.length > 5
          ? paper.authors.slice(0, 5).join(', ') + ' et al.'
          : paper.authors.join(', ');

      return [
        `arXiv:${paper.id}`,
        `Title: ${paper.title}`,
        `Authors: ${authorStr}`,
        `Published: ${paper.published}` +
          (paper.updated !== paper.published ? `  (updated ${paper.updated})` : ''),
        `Categories: ${paper.categories.join(', ')}`,
        `PDF: ${paper.pdfUrl}`,
        `Source (LaTeX .tar.gz): ${paper.sourceUrl}`,
        ``,
        `Abstract:`,
        paper.abstract,
      ].join('\n');
    },
  });
}
