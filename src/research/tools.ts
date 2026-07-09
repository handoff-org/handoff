import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { searchWorks, getWork, type Paper } from './openalex.js';
import { cachePaper, loadCachedPaper } from './cache.js';
import { fetchArxivPaper, searchArxiv, type ArxivPaper } from './arxiv.js';
import { appendNotebook } from './notebook.js';
import { getActiveProject, projectPaths } from '../workspace/project.js';
import { bibFileIn, mainTexFile } from '../workspace/overleaf.js';
import { starterBib } from '../workspace/templates.js';
import {
  citeKey,
  disambiguateKey,
  toBibEntry,
  parseBibKeys,
  mergeBibEntry,
  findExistingKey,
} from './bibtex.js';

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

/** Map an arXiv paper into the unified Paper shape used across the research pipeline. */
function arxivToPaper(a: ArxivPaper): Paper {
  return {
    id: `arxiv:${a.id}`,
    title: a.title,
    abstract: a.abstract,
    authors: a.authors,
    year: Number(a.published.slice(0, 4)) || 0,
    venue: 'arXiv',
    doi: '',
    oaUrl: a.absUrl,
    citations: 0,
  };
}

/** Which source an id points at, plus the canonical cache id to look it up under. */
function classifyPaperId(raw: string): { kind: 'arxiv' | 'doi' | 'openalex'; cacheId: string } {
  const id = raw.trim();
  if (/^arxiv:/i.test(id) || /arxiv\.org/i.test(id) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) {
    const bare = id
      .replace(/^arxiv:/i, '')
      .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf|src)\//i, '')
      .replace(/v\d+$/, '')
      .trim();
    return { kind: 'arxiv', cacheId: `arxiv:${bare}` };
  }
  if (/^10\.\d{4,}\//.test(id) || /doi\.org/i.test(id)) {
    return { kind: 'doi', cacheId: '' }; // only known after it resolves to a W-id
  }
  return { kind: 'openalex', cacheId: id.replace('https://openalex.org/', '') };
}

/** Resolve a paper by id for citing: cache first, then a live fetch (which caches). */
async function resolvePaperForCite(rawId: string): Promise<Paper> {
  const { kind, cacheId } = classifyPaperId(rawId);
  if (cacheId) {
    const cached = await loadCachedPaper(cacheId);
    if (cached) return cached;
  }
  if (kind === 'arxiv') {
    const paper = arxivToPaper(await fetchArxivPaper(rawId));
    await cachePaper(paper);
    return paper;
  }
  // OpenAlex accepts a W-id directly or a doi.org URL as the work path.
  const lookup =
    kind === 'doi' && !/^https?:/i.test(rawId) ? `https://doi.org/${rawId.trim()}` : rawId;
  const paper = await getWork(lookup);
  await cachePaper(paper);
  return paper;
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
        year_from: {
          type: 'string',
          description: 'Only papers published from this year onward (optional)',
        },
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
      if (papers.length === 0)
        return 'No arXiv preprints found. Try broader terms or a category (e.g. cat:cs.LG).';
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
          description:
            'arXiv paper ID or URL, e.g. "2301.07041" or "https://arxiv.org/abs/2301.07041"',
        },
      },
      required: ['id'],
    },
    async execute({ id }) {
      const paper = await fetchArxivPaper(String(id));

      // Cache as a Paper so the rest of the research pipeline can use it.
      await cachePaper(arxivToPaper(paper));

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

  registry.register({
    name: 'cite_paper',
    description:
      "Add a paper to the current project's bibliography and get back the \\cite{} command to " +
      'drop into the prose. Give it an OpenAlex id (e.g. W2741809807), an arXiv id ' +
      '(2301.07041 or arxiv:2301.07041), or a DOI (10.1234/...). It generates a valid BibTeX ' +
      'entry with a stable cite key, appends it to paper/refs.bib (creating it if needed), and ' +
      'keeps it in sync — calling it twice for the same paper is a no-op, never a duplicate. ' +
      'In an Overleaf-linked project the .bib syncs automatically on the next turn. ' +
      'Requires an initialized paper (run start_paper first). After this, insert the returned ' +
      '\\cite{key} into main.tex with edit_file.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'OpenAlex work id (W…), arXiv id (2301.07041 / arxiv:2301.07041), or DOI (10.…/…)',
        },
      },
      required: ['id'],
    },
    async execute({ id }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Use create_project and start_paper before citing.';

      const paperDir = projectPaths(meta.slug).paper;
      if (!mainTexFile(paperDir)) {
        return 'No paper yet in this project. Run start_paper to create paper/main.tex before adding citations.';
      }

      let paper: Paper;
      try {
        paper = await resolvePaperForCite(String(id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `Could not resolve "${id}": ${msg}. Look it up first with get_paper or fetch_arxiv, then cite by that id.`;
      }

      // Target the .bib the paper already loads, or seed refs.bib (matches the
      // blank template's \bibliography{refs}). The .bib stays inside paper/ so
      // an Overleaf-linked project syncs it.
      const bibPath = bibFileIn(paperDir) ?? join(paperDir, 'refs.bib');
      const bibText = existsSync(bibPath) ? readFileSync(bibPath, 'utf-8') : starterBib(meta.title);

      // Already cited? Reuse its key — idempotent, no duplicate entry.
      const existingKey = findExistingKey(bibText, paper);
      if (existingKey) {
        return `Already in ${bibPath} as \\cite{${existingKey}}. Insert it with edit_file — no bibliography change needed.`;
      }

      const key = disambiguateKey(citeKey(paper), parseBibKeys(bibText));
      const { text } = mergeBibEntry(bibText, key, toBibEntry(paper, key));
      writeFileSync(bibPath, text, 'utf-8');

      appendNotebook(meta.slug, {
        type: 'literature-find',
        summary: `Added citation \\cite{${key}} — **${paper.title}**`,
      });

      return (
        `Added \\cite{${key}} to ${bibPath}.\n\n` +
        `Insert it where the paper is discussed, e.g. edit_file main.tex to add "\\cite{${key}}".`
      );
    },
  });
}
