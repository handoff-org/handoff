import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { searchWorks, getWork, type Paper } from './openalex.js';
import { cachePaper, loadCachedPaper } from './cache.js';
import { fetchArxivPaper, searchArxiv, normalizeArxivId, type ArxivPaper } from './arxiv.js';
import { appendNotebook, readNotebook, searchNotebook } from './notebook.js';
import { readableFromArchive } from './arxivSource.js';
import { checkFetchUrl } from '../tools/ssrf.js';
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
import {
  readLitNotes,
  writeLitNote,
  searchLitNotes,
  formatLitNote,
  formatLitNotesSummary,
  type LitNote,
} from './litNotes.js';
import { snowball, type SnowballDirection } from './snowball.js';

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
    name: 'read_arxiv_source',
    description:
      "Read an arXiv paper's actual LaTeX source (not the abstract, not the flattened PDF). " +
      'Downloads the source archive from arxiv.org, extracts the main .tex, and returns readable ' +
      'text with equations and section structure preserved — far better than read_pdf for ' +
      'understanding a paper\'s method and math. Accepts any arXiv ID form ("2301.07041", ' +
      '"arxiv:2301.07041", or an arxiv.org URL). Output is capped; raise max_chars for more.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'arXiv paper ID or URL, e.g. "1706.03762"' },
        max_chars: {
          type: 'string',
          description: 'Truncate output to this many characters (default 16000)',
        },
      },
      required: ['id'],
    },
    async execute({ id, max_chars }) {
      const arxivId = normalizeArxivId(String(id));
      if (!arxivId) return 'Provide an arXiv ID, e.g. 1706.03762.';
      const limit = max_chars ? Number(max_chars) : 16_000;
      const url = `https://arxiv.org/src/${arxivId}`;

      // Follow redirects manually, re-checking each hop against the SSRF guard
      // (mirrors web_fetch), then read the archive bytes.
      let current = url;
      let buf: Buffer | null = null;
      for (let hop = 0; hop <= 5; hop++) {
        const bad = checkFetchUrl(current);
        if (bad) return bad;
        let res: Response;
        try {
          res = await fetch(current, {
            redirect: 'manual',
            headers: { 'User-Agent': 'handoff/0.1 (research agent)' },
          });
        } catch (err) {
          return `Failed to fetch arXiv source: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return `HTTP ${res.status} with no Location header.`;
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) {
          return `Could not fetch arXiv source for ${arxivId} (HTTP ${res.status}). Some papers have no source; try read_pdf on the PDF URL.`;
        }
        buf = Buffer.from(await res.arrayBuffer());
        break;
      }
      if (!buf) return 'Too many redirects fetching arXiv source.';

      let result: { name: string; text: string } | null;
      try {
        result = readableFromArchive(buf);
      } catch (err) {
        return `Failed to extract LaTeX source: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!result || !result.text.trim()) {
        return `No readable LaTeX found in the source for ${arxivId} (it may be PDF-only or an unusual format). Try read_pdf on the PDF.`;
      }

      const meta = getActiveProject();
      if (meta) {
        appendNotebook(meta.slug, {
          type: 'literature-find',
          summary: `Read LaTeX source of arXiv:${arxivId} (${result.name})`,
        });
      }

      const body =
        result.text.length > limit
          ? result.text.slice(0, limit) +
            `\n\n… [truncated ${result.text.length - limit} more chars — raise max_chars]`
          : result.text;
      return `arXiv:${arxivId} — LaTeX source (${result.name}):\n\n${body}`;
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

  // ── Note-taking ─────────────────────────────────────────────────────────────
  // The lab notebook (NOTEBOOK.md) is auto-appended by experiments, citations, and
  // literature finds. These tools let the agent (and, via /note, the user) record
  // free-form notes and read/search the journal — the missing manual half.

  registry.register({
    name: 'take_note',
    description:
      "Record a free-form note or insight in the active project's lab notebook " +
      '(NOTEBOOK.md). Use this to capture an idea, a decision, a TODO, or an ' +
      "observation worth keeping — anything that isn't already logged automatically " +
      'by running an experiment or citing a paper. Set kind="insight" for a key ' +
      'realization (💡), otherwise it is filed as a note (📝).',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note text to record' },
        kind: {
          type: 'string',
          enum: ['note', 'insight'],
          description: 'note (default) or insight (a key realization)',
        },
      },
      required: ['text'],
    },
    async execute({ text, kind }) {
      const note = String(text ?? '').trim();
      if (!note) return 'Nothing to record — provide the note text.';
      const meta = getActiveProject();
      if (!meta)
        return 'No active project. Open or create one first (open_project / create_project).';
      appendNotebook(meta.slug, {
        type: kind === 'insight' ? 'insight' : 'note',
        summary: note,
      });
      return `Recorded ${kind === 'insight' ? 'insight' : 'note'} in ${meta.title}'s notebook.`;
    },
  });

  registry.register({
    name: 'read_notebook',
    description:
      "Read the most recent entries from the active project's lab notebook " +
      '(NOTEBOOK.md) — experiments, literature finds, citations, notes, and insights, ' +
      'newest first. Use to recall what has been done or found in this project.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'How many recent entries to show (default 10)' },
      },
    },
    async execute({ limit }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Open or create one first.';
      const n = limit ? Number(limit) : 10;
      const entries = readNotebook(meta.slug, { limit: Number.isFinite(n) ? n : 10 });
      if (entries.length === 0) return `${meta.title}'s notebook is empty.`;
      return `Recent entries in ${meta.title}'s notebook (newest first):\n\n${entries.join('\n\n---\n\n')}`;
    },
  });

  registry.register({
    name: 'search_notes',
    description:
      "Search the active project's lab notebook (NOTEBOOK.md) for entries " +
      'containing a term (case-insensitive) — across notes, insights, experiments, ' +
      'and literature finds. Use to look up an earlier decision, result, or idea.',
    parameters: {
      type: 'object',
      properties: {
        term: { type: 'string', description: 'Text to search for in the notebook' },
      },
      required: ['term'],
    },
    async execute({ term }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project. Open or create one first.';
      const q = String(term ?? '').trim();
      if (!q) return 'Provide a search term.';
      const hits = searchNotebook(meta.slug, q);
      if (hits.length === 0) return `No notebook entries mention "${q}".`;
      return `${hits.length} entr${hits.length === 1 ? 'y' : 'ies'} mentioning "${q}":\n\n${hits.join('\n\n---\n\n')}`;
    },
  });

  // ── Structured lit notes ─────────────────────────────────────────────────────

  registry.register({
    name: 'note_paper',
    description:
      "Create or update a structured literature note for a paper in the project's " +
      'lit notes (literature/notes.jsonl). Records key passages, relevance, tags, ' +
      'and reading status — a searchable, structured record you can draw on when ' +
      'drafting Related Work with draft_lit_review. Call after reading a paper.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        paper_id: {
          type: 'string',
          description: 'Paper id — OpenAlex W…, arxiv:…, or DOI',
        },
        relevance: {
          type: 'string',
          description: 'One-sentence summary of why this paper is relevant to the project',
        },
        key_passages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Key quotes or findings verbatim. Use "quote :: your comment" to attach a gloss, ' +
            'e.g. "achieves 94.2% on CIFAR-10 :: state-of-the-art at time of writing".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Topic tags for grouping and filtering (e.g. ["methodology", "baseline"])',
        },
        status: {
          type: 'string',
          enum: ['skimmed', 'read', 'summarized'],
          description: 'How thoroughly you have read this paper (default: read)',
        },
      },
      required: ['paper_id', 'relevance'],
    },
    async execute({ paper_id, relevance, key_passages, tags, status }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      const id = String(paper_id ?? '').trim();
      if (!id) return 'Provide a paper_id.';

      const cached = await loadCachedPaper(id);
      const existing = readLitNotes(meta.slug).find((n) => n.paperId === id);
      const now = new Date().toISOString();

      const note: LitNote = {
        paperId: id,
        title: cached?.title ?? existing?.title ?? id,
        authors: cached?.authors ?? existing?.authors ?? [],
        year: cached?.year ?? existing?.year ?? 0,
        citeKey: existing?.citeKey,
        keyPassages: Array.isArray(key_passages)
          ? (key_passages as string[]).map((p) => {
              const sep = String(p).indexOf(' :: ');
              if (sep === -1) return { quote: String(p) };
              return { quote: String(p).slice(0, sep), comment: String(p).slice(sep + 4) };
            })
          : (existing?.keyPassages ?? []),
        relevanceSummary: String(relevance),
        tags: Array.isArray(tags) ? tags.map(String) : (existing?.tags ?? []),
        status: status === 'skimmed' || status === 'summarized' ? status : 'read',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      writeLitNote(meta.slug, note);
      appendNotebook(meta.slug, {
        type: 'literature-find',
        summary: `Noted: **${note.title}** (${note.year || '?'}) — ${note.relevanceSummary}`,
      });
      return `Saved lit note for ${id}.\n\n${formatLitNote(note)}`;
    },
  });

  registry.register({
    name: 'read_paper_notes',
    description:
      'Read structured literature notes for the active project. ' +
      'Omit paper_id to list all notes; provide one to show full detail for that paper.',
    parameters: {
      type: 'object',
      properties: {
        paper_id: {
          type: 'string',
          description: 'Paper id to show in detail (omit to list all notes)',
        },
      },
    },
    async execute({ paper_id }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      if (paper_id) {
        const id = String(paper_id).trim();
        const note = readLitNotes(meta.slug).find((n) => n.paperId === id);
        if (!note) return `No note found for "${id}". Use note_paper to create one.`;
        return formatLitNote(note);
      }
      return formatLitNotesSummary(readLitNotes(meta.slug), meta.title);
    },
  });

  registry.register({
    name: 'search_paper_notes',
    description:
      'Search structured literature notes for a term (matches title, relevance summary, tags, and key passages).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
      required: ['query'],
    },
    async execute({ query }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      const q = String(query ?? '').trim();
      if (!q) return 'Provide a search query.';
      const hits = searchLitNotes(meta.slug, q);
      if (hits.length === 0) return `No lit notes match "${q}".`;
      const label = `${hits.length} note${hits.length !== 1 ? 's' : ''} matching "${q}"`;
      return `${label}:\n\n${hits.map(formatLitNote).join('\n\n')}`;
    },
  });

  // ── Citation snowballing ──────────────────────────────────────────────────────

  registry.register({
    name: 'snowball_citations',
    description:
      'Expand the citation graph from a seed paper using OpenAlex. ' +
      'backward = papers it cites (its reference list); ' +
      'forward = papers that cite it (its citing papers, sorted by impact); ' +
      'both = backward first, then forward. ' +
      'Only returns papers NOT already in the local cache (truly new finds), ' +
      'and logs each to the notebook. Use after finding a key paper to discover related work.',
    parameters: {
      type: 'object',
      properties: {
        paper_id: {
          type: 'string',
          description: 'OpenAlex id of the seed paper (W…)',
        },
        direction: {
          type: 'string',
          enum: ['forward', 'backward', 'both'],
          description:
            'backward (default) = its reference list; forward = papers citing it; both = both directions',
        },
        depth: {
          type: 'string',
          description: '1 (default) or 2 — recurse one extra hop into each new paper found',
        },
        limit: {
          type: 'string',
          description: 'Max new papers to surface (default 15, max 20)',
        },
      },
      required: ['paper_id'],
    },
    async execute({ paper_id, direction, depth, limit }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      const id = String(paper_id ?? '').trim();
      if (!id) return 'Provide a paper_id.';

      const dir: SnowballDirection =
        direction === 'forward' ? 'forward' : direction === 'both' ? 'both' : 'backward';
      const result = await snowball(
        meta.slug,
        id,
        dir,
        depth ? Math.max(1, Math.min(Number(depth) || 1, 2)) : 1,
        limit ? Math.max(1, Math.min(Number(limit) || 15, 20)) : 15,
      );

      if (result.papers.length === 0) {
        return (
          `Snowball (${dir}) from ${id} found no new papers. ` +
          `All candidates are already cached, or the paper has no indexed citations in OpenAlex.`
        );
      }

      const lines = result.papers.map(formatResult);
      return (
        `Snowball (${dir}) from ${id}: ${result.papers.length} new paper${result.papers.length !== 1 ? 's' : ''}.\n\n` +
        lines.join('\n\n')
      );
    },
  });
}
