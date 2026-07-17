import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import type { ToolRegistry } from '../tools/registry.js';
import { loadConfig } from '../../config/schema.js';
import { getActiveProject, projectPaths } from '../workspace/project.js';
import { runPymupdf, pymupdfAvailable } from '../tools/pymupdf.js';
import { retryFetch } from '../util/http.js';

/**
 * Zotero connector: read the user's library over the Zotero Web API and annotate
 * a paper's PDF with highlights + comments (the primary output), so the agent's
 * commentary shows up right in Zotero's PDF reader. `zotero_add_note` is also
 * available for a standalone written summary when asked.
 *
 * The API key is read from config (captured by the /zotero link form, never
 * through the model). Pure helpers are exported for unit tests; network calls
 * are thin wrappers over retryFetch with the Zotero auth header.
 */

const ZOTERO_API = 'https://api.zotero.org';
const NOT_LINKED =
  'Zotero is not linked. Run /zotero to connect your library (needs a Web API key ' +
  'from https://www.zotero.org/settings/keys and your numeric user id).';

// ── Credentials ─────────────────────────────────────────────────────────────

export interface ZoteroCreds {
  apiKey: string;
  userId: string;
}

/** Read Zotero credentials from config (env override applied by loadConfig). */
export async function zoteroCreds(): Promise<ZoteroCreds | null> {
  const cfg = await loadConfig();
  if (cfg.zoteroApiKey && cfg.zoteroUserId) {
    return { apiKey: cfg.zoteroApiKey, userId: cfg.zoteroUserId };
  }
  return null;
}

// ── Pure helpers (unit-tested; no network) ──────────────────────────────────

export interface ZoteroItemSummary {
  key: string;
  title: string;
  creators: string;
  itemType: string;
  year?: string;
}

interface RawItem {
  key?: string;
  data?: Record<string, unknown>;
}

/** Parse the /items(/top) response into compact summaries. */
export function parseZoteroItems(json: unknown): ZoteroItemSummary[] {
  const arr = Array.isArray(json) ? (json as RawItem[]) : [];
  return arr
    .map((it) => {
      const d = it.data ?? {};
      const creators = Array.isArray(d['creators'])
        ? (d['creators'] as Record<string, unknown>[])
            .map((c) => String(c['lastName'] ?? c['name'] ?? c['firstName'] ?? ''))
            .filter(Boolean)
            .slice(0, 3)
            .join(', ')
        : '';
      const date = String(d['date'] ?? '');
      return {
        key: String(it.key ?? ''),
        title: String(d['title'] ?? '(untitled)'),
        creators,
        itemType: String(d['itemType'] ?? ''),
        year: date.match(/\d{4}/)?.[0],
      };
    })
    .filter((s) => s.key);
}

export interface ZoteroChildren {
  notes: { key: string; text: string }[];
  annotations: { key: string; type: string; text: string; comment: string }[];
  pdfAttachmentKey?: string;
}

/** Parse an item's /children response into notes, annotations, and PDF key. */
export function parseChildren(json: unknown): ZoteroChildren {
  const arr = Array.isArray(json) ? (json as RawItem[]) : [];
  const notes: ZoteroChildren['notes'] = [];
  const annotations: ZoteroChildren['annotations'] = [];
  let pdfAttachmentKey: string | undefined;
  for (const it of arr) {
    const d = it.data ?? {};
    const t = d['itemType'];
    if (t === 'note') {
      notes.push({ key: String(it.key ?? ''), text: stripHtml(String(d['note'] ?? '')) });
    } else if (t === 'annotation') {
      annotations.push({
        key: String(it.key ?? ''),
        type: String(d['annotationType'] ?? ''),
        text: String(d['annotationText'] ?? ''),
        comment: String(d['annotationComment'] ?? ''),
      });
    } else if (t === 'attachment' && d['contentType'] === 'application/pdf' && !pdfAttachmentKey) {
      pdfAttachmentKey = String(it.key ?? '') || undefined;
    }
  }
  return { notes, annotations, pdfAttachmentKey };
}

/** Build Zotero note HTML from structured commentary. */
export function buildNoteHtml(opts: {
  title?: string;
  summary?: string;
  passages?: { quote: string; comment: string }[];
  related?: string[];
}): string {
  const parts: string[] = [];
  if (opts.title) parts.push(`<h1>${escapeHtml(opts.title)}</h1>`);
  if (opts.summary) parts.push(`<p>${escapeHtml(opts.summary)}</p>`);
  if (opts.passages?.length) {
    parts.push('<h2>Key passages</h2>');
    parts.push(
      '<ul>' +
        opts.passages
          .map(
            (p) =>
              `<li>“${escapeHtml(p.quote)}”${p.comment ? ` — ${escapeHtml(p.comment)}` : ''}</li>`,
          )
          .join('') +
        '</ul>',
    );
  }
  if (opts.related?.length) {
    parts.push('<h2>Related work</h2>');
    parts.push('<ul>' + opts.related.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>');
  }
  parts.push('<p><em>Added by handoff.</em></p>');
  return parts.join('\n');
}

/** Zotero annotationSortIndex: "PPPPP|OOOOOO|TTTTT" (page | char offset | top). */
export function computeSortIndex(pageIndex: number, y: number): string {
  const p = String(Math.max(0, Math.floor(pageIndex))).padStart(5, '0');
  const top = String(Math.max(0, Math.floor(y))).padStart(5, '0');
  return `${p}|000000|${top}`;
}

export interface HighlightSpec {
  attachmentKey: string;
  text: string;
  comment?: string;
  color?: string;
  pageIndex: number;
  /** Page height in PDF points — used to flip PyMuPDF's top-left Y to Zotero's bottom-left. */
  pageHeight?: number;
  rects: number[][];
}

/** Build a Zotero annotation item payload for a highlight. */
export function buildAnnotationPayload(h: HighlightSpec): Record<string, unknown> {
  // Zotero stores annotation rects in PDF coordinates (origin BOTTOM-left);
  // PyMuPDF's search_for returns TOP-left rects. Flip Y about the page height so
  // the highlight lands on the actual line instead of its mirror position.
  const ph = h.pageHeight && h.pageHeight > 0 ? h.pageHeight : 0;
  const rects = ph
    ? h.rects.map((r) => [r[0] ?? 0, ph - (r[3] ?? 0), r[2] ?? 0, ph - (r[1] ?? 0)])
    : h.rects;
  // sortIndex orders annotations top-to-bottom, so key it off the top-left top edge.
  const topY = h.rects.length ? Math.min(...h.rects.map((r) => r[1] ?? 0)) : 0;
  return {
    itemType: 'annotation',
    parentItem: h.attachmentKey,
    annotationType: 'highlight',
    annotationText: h.text,
    annotationComment: h.comment ?? '',
    annotationColor: h.color ?? '#ffd400',
    annotationPageLabel: String(h.pageIndex + 1),
    annotationSortIndex: computeSortIndex(h.pageIndex, topY),
    annotationPosition: JSON.stringify({ pageIndex: h.pageIndex, rects }),
    tags: [],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

/** Split "quote :: comment" strings into structured passages. */
export function parsePassages(v: unknown): { quote: string; comment: string }[] {
  return toStringArray(v)
    .map((s) => {
      const idx = s.indexOf('::');
      return idx >= 0
        ? { quote: s.slice(0, idx).trim(), comment: s.slice(idx + 2).trim() }
        : { quote: s.trim(), comment: '' };
    })
    .filter((p) => p.quote);
}

/**
 * The longest contiguous, verbatim fragment of a quote to search for in the PDF.
 * Models routinely elide long quotes with an ellipsis ("A … B"), which PyMuPDF's
 * `search_for` can never match (it needs contiguous text). Splitting on the
 * ellipsis and taking the longest surviving fragment — with surrounding quote
 * marks stripped — recovers a searchable span so highlights land instead of all
 * failing. Returns '' when nothing substantial remains.
 */
export function bestSearchFragment(quote: string): string {
  return quote
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((f) =>
      f
        .trim()
        .replace(/^["“”']+|["“”']+$/g, '')
        .trim(),
    )
    .reduce((best, f) => (f.length > best.length ? f : best), '');
}

/** A 32-char idempotency token for POST /items (Zotero-Write-Token). */
function writeToken(): string {
  return randomBytes(16).toString('hex');
}

// ── Network (thin wrappers over retryFetch with the Zotero auth header) ───────

async function zFetch(url: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  return retryFetch(url, {
    ...init,
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': '3',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

/** Base `users/<userId>` URL with the id URL-encoded. */
function userBase(creds: ZoteroCreds): string {
  return `${ZOTERO_API}/users/${encodeURIComponent(creds.userId)}`;
}

/** List/search top-level library items. */
export async function listItems(
  creds: ZoteroCreds,
  opts: { q?: string; limit?: number } = {},
): Promise<ZoteroItemSummary[]> {
  const n = Number(opts.limit);
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 25;
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts.q) params.set('q', opts.q);
  const res = await zFetch(`${userBase(creds)}/items/top?${params}`, creds.apiKey);
  if (!res.ok) throw new Error(`Zotero list failed (HTTP ${res.status})`);
  return parseZoteroItems(await res.json());
}

/** Fetch an item's children (notes, annotations, attachments). */
export async function getChildren(creds: ZoteroCreds, key: string): Promise<ZoteroChildren> {
  const res = await zFetch(
    `${userBase(creds)}/items/${encodeURIComponent(key)}/children?limit=100`,
    creds.apiKey,
  );
  if (!res.ok) throw new Error(`Zotero children failed (HTTP ${res.status})`);
  return parseChildren(await res.json());
}

/** Download an attachment's file to `destPath`. */
export async function downloadFile(
  creds: ZoteroCreds,
  attachmentKey: string,
  destPath: string,
): Promise<void> {
  const res = await zFetch(
    `${userBase(creds)}/items/${encodeURIComponent(attachmentKey)}/file`,
    creds.apiKey,
  );
  if (!res.ok) throw new Error(`Zotero file download failed (HTTP ${res.status})`);
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

interface WriteResponse {
  success?: Record<string, string>;
  failed?: Record<string, { message?: string }>;
}

/** Create a child note. Returns the new item key or an error string. */
export async function createNote(
  creds: ZoteroCreds,
  parentKey: string,
  html: string,
): Promise<{ ok: boolean; key?: string; error?: string }> {
  const body = [
    { itemType: 'note', parentItem: parentKey, note: html, tags: [{ tag: 'handoff' }] },
  ];
  const res = await zFetch(`${userBase(creds)}/items`, creds.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': writeToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json()) as WriteResponse;
  const key = data.success?.['0'];
  if (key) return { ok: true, key };
  return { ok: false, error: data.failed?.['0']?.message ?? 'unknown failure' };
}

export interface AnnotationOutcome {
  created: number;
  failed: { text: string; reason: string }[];
  apiRejected: boolean;
}

/** Create highlight annotation items (best-effort; may be refused wholesale). */
export async function createAnnotations(
  creds: ZoteroCreds,
  specs: HighlightSpec[],
): Promise<AnnotationOutcome> {
  if (specs.length === 0) return { created: 0, failed: [], apiRejected: false };
  const res = await zFetch(`${userBase(creds)}/items`, creds.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': writeToken() },
    body: JSON.stringify(specs.map(buildAnnotationPayload)),
  });
  if (!res.ok) {
    return {
      created: 0,
      failed: specs.map((s) => ({ text: s.text, reason: `HTTP ${res.status}` })),
      apiRejected: true,
    };
  }
  const data = (await res.json()) as WriteResponse;
  const created = Object.keys(data.success ?? {}).length;
  const failed = Object.entries(data.failed ?? {}).map(([i, v]) => ({
    text: specs[Number(i)]?.text ?? '',
    reason: v.message ?? 'failed',
  }));
  return { created, failed, apiRejected: created === 0 && failed.length > 0 };
}

// ── PyMuPDF via ephemeral uv (no poppler dependency) ─────────────────────────

/** Extract plain text from a PDF (capped). */
export function pdfTextViaPymupdf(
  path: string,
  maxChars = 15_000,
): { text: string } | { error: string } {
  const script =
    'import sys, fitz\n' +
    'doc = fitz.open(sys.argv[1])\n' +
    'sys.stdout.write("\\n".join(p.get_text() for p in doc))\n';
  const r = runPymupdf(script, [path]);
  if ('error' in r) return r;
  const text = r.stdout;
  return {
    text:
      text.length > maxChars
        ? text.slice(0, maxChars) + `\n… (truncated at ${maxChars} chars)`
        : text,
  };
}

export interface LocatedPassage {
  passage: string;
  pageIndex: number;
  pageHeight: number;
  rects: number[][];
}

/** Find each passage's page + rect coordinates in the PDF (for highlights). */
export function locateRects(
  path: string,
  passages: string[],
): { results: LocatedPassage[] } | { error: string } {
  const script = [
    'import sys, json, fitz',
    'doc = fitz.open(sys.argv[1])',
    'targets = json.loads(sys.argv[2])',
    'res = []',
    'for t in targets:',
    '    for pno in range(doc.page_count):',
    '        rects = doc[pno].search_for(t)',
    '        if rects:',
    '            res.append({"passage": t, "pageIndex": pno, "pageHeight": doc[pno].rect.height, "rects": [[r.x0, r.y0, r.x1, r.y1] for r in rects]})',
    '            break',
    'sys.stdout.write(json.dumps(res))',
  ].join('\n');
  const r = runPymupdf(script, [path, JSON.stringify(passages)]);
  if ('error' in r) return r;
  try {
    return { results: JSON.parse(r.stdout || '[]') as LocatedPassage[] };
  } catch {
    return { error: 'could not parse pymupdf output' };
  }
}

/** Where to cache downloaded PDFs: the active project's literature/, else tmp. */
function cacheDir(): string {
  const meta = getActiveProject();
  if (meta) {
    const dir = projectPaths(meta.slug).literature;
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return tmpdir();
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function registerZoteroTools(registry: ToolRegistry): void {
  // ── zotero_list_papers ─────────────────────────────────────────────────────
  registry.register({
    name: 'zotero_list_papers',
    description:
      'List or search papers in the linked Zotero library (top-level items). Returns each ' +
      "item's key, title, authors, and year — use the key with zotero_read_paper / " +
      'zotero_add_note. Requires a linked Zotero library (/zotero).',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Optional search text (title / creator / year)' },
        limit: { type: 'string', description: 'Max items (default 25, max 100)' },
      },
    },
    async execute({ q, limit }) {
      const creds = await zoteroCreds();
      if (!creds) return NOT_LINKED;
      try {
        const items = await listItems(creds, {
          q: q ? String(q) : undefined,
          limit: limit ? Number(limit) : undefined,
        });
        if (!items.length) {
          return q ? `No Zotero items match "${String(q)}".` : 'No items in your Zotero library.';
        }
        return items
          .map(
            (i) =>
              `[${i.key}] ${i.title}${i.year ? ` (${i.year})` : ''}${
                i.creators ? ` — ${i.creators}` : ''
              }`,
          )
          .join('\n');
      } catch (e) {
        return `Zotero error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  // ── zotero_read_paper ──────────────────────────────────────────────────────
  registry.register({
    name: 'zotero_read_paper',
    description:
      'Read a Zotero item: existing notes/annotations (so you avoid duplicating commentary) ' +
      'plus the extracted text of its PDF attachment. Call this before zotero_add_note / ' +
      'zotero_add_highlights.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Zotero item key (from zotero_list_papers)' },
        max_chars: { type: 'string', description: 'Cap on extracted PDF text (default 15000)' },
      },
      required: ['key'],
    },
    async execute({ key, max_chars }) {
      const creds = await zoteroCreds();
      if (!creds) return NOT_LINKED;
      const k = String(key);
      try {
        const children = await getChildren(creds, k);
        const parts: string[] = [];
        if (children.notes.length) {
          parts.push(
            `Existing notes (${children.notes.length}):\n` +
              children.notes.map((n) => `- ${truncate(n.text, 160)}`).join('\n'),
          );
        }
        if (children.annotations.length) {
          parts.push(
            `Existing annotations (${children.annotations.length}):\n` +
              children.annotations
                .map(
                  (a) =>
                    `- ${a.type}: ${truncate(a.text, 100)}${
                      a.comment ? ` // ${truncate(a.comment, 100)}` : ''
                    }`,
                )
                .join('\n'),
          );
        }
        if (!children.pdfAttachmentKey) {
          parts.unshift('No PDF attachment found on this item.');
          return parts.join('\n\n');
        }
        if (!pymupdfAvailable()) {
          parts.unshift(
            'PDF present but uv is required to read it (PyMuPDF). Install uv: https://docs.astral.sh/uv/',
          );
          return parts.join('\n\n');
        }
        const dest = join(cacheDir(), `zotero-${k}.pdf`);
        await downloadFile(creds, children.pdfAttachmentKey, dest);
        const capN = Number(max_chars);
        const cap = Number.isFinite(capN) && capN > 0 ? capN : 15_000;
        const ex = pdfTextViaPymupdf(dest, cap);
        if ('error' in ex) {
          parts.unshift(`PDF present but text extraction failed: ${ex.error}`);
          return parts.join('\n\n');
        }
        parts.push(
          `PDF text (attachment ${children.pdfAttachmentKey}, cached ${dest}):\n\n${ex.text}`,
        );
        return parts.join('\n\n');
      } catch (e) {
        return `Zotero error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  // ── zotero_add_note (reliable) ─────────────────────────────────────────────
  registry.register({
    name: 'zotero_add_note',
    description:
      'Attach a note to a Zotero item so your commentary appears under the paper in the ' +
      'reader. Provide structured passages ("quote :: why it matters"), a summary, and ' +
      'related work — or raw html. This is the reliable way to add comments.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Parent item key' },
        title: { type: 'string', description: 'Optional note heading' },
        summary: { type: 'string', description: 'Optional 1-2 sentence summary' },
        passages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key passages, each as "quote :: why it matters"',
        },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related-work notes or paper titles',
        },
        html: { type: 'string', description: 'Raw note HTML (overrides the structured fields)' },
      },
      required: ['key'],
    },
    async execute(args) {
      const creds = await zoteroCreds();
      if (!creds) return NOT_LINKED;
      const key = String(args['key']);
      const html = args['html']
        ? String(args['html'])
        : buildNoteHtml({
            title: args['title'] ? String(args['title']) : undefined,
            summary: args['summary'] ? String(args['summary']) : undefined,
            passages: parsePassages(args['passages']),
            related: toStringArray(args['related']),
          });
      if (!stripHtml(html)) {
        return 'Nothing to write — provide passages / summary / related, or html.';
      }
      try {
        const r = await createNote(creds, key, html);
        return r.ok
          ? `Added note ${r.key} to item ${key}. It will appear under the paper in Zotero.`
          : `Failed to add note: ${r.error}`;
      } catch (e) {
        return `Zotero error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  // ── zotero_add_highlights (experimental) ───────────────────────────────────
  registry.register({
    name: 'zotero_add_highlights',
    description:
      'Add in-PDF highlight annotations to a Zotero item: highlight the important sentences ' +
      'directly on the PDF and attach a comment explaining why each matters. This is the primary ' +
      'way to annotate a paper. Each passage is located in the PDF with PyMuPDF (requires uv). ' +
      'Quotes must be SHORT, CONTIGUOUS, verbatim phrases from the PDF — no "…", no stitching ' +
      'distant sentences.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Zotero item key' },
        highlights: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Each as "exact quote :: comment". The quote must be a SHORT, CONTIGUOUS, ' +
            'verbatim phrase copied from the PDF — no "…"/ellipsis and no joining of ' +
            "distant sentences (those can't be located). One clean phrase per highlight.",
        },
        color: { type: 'string', description: 'Highlight color hex (default #ffd400)' },
      },
      required: ['key', 'highlights'],
    },
    async execute(args) {
      const creds = await zoteroCreds();
      if (!creds) return NOT_LINKED;
      if (!pymupdfAvailable()) {
        return 'uv is required (PyMuPDF) to locate highlight positions. Install uv: https://docs.astral.sh/uv/';
      }
      const key = String(args['key']);
      const specsIn = parsePassages(args['highlights']);
      if (!specsIn.length) return 'Provide highlights as "quote :: comment" strings.';
      try {
        const children = await getChildren(creds, key);
        if (!children.pdfAttachmentKey) return 'No PDF attachment on this item to annotate.';
        const dest = join(cacheDir(), `zotero-${key}.pdf`);
        await downloadFile(creds, children.pdfAttachmentKey, dest);
        // Search for the longest verbatim fragment of each quote (models elide long
        // quotes with "…", which never matches PyMuPDF's contiguous search).
        const withTerms = specsIn
          .map((s) => ({ ...s, term: bestSearchFragment(s.quote) }))
          .filter((s) => s.term.length >= 12);
        if (!withTerms.length) {
          return 'Highlight quotes need a verbatim phrase of at least ~12 characters (avoid "…"). Or use zotero_add_note.';
        }
        const located = locateRects(
          dest,
          withTerms.map((s) => s.term),
        );
        if ('error' in located) return `Could not locate passages: ${located.error}`;
        const byTerm = new Map(located.results.map((r) => [r.passage, r]));
        const specs: HighlightSpec[] = [];
        const notFound: string[] = [];
        for (const s of withTerms) {
          const loc = byTerm.get(s.term);
          if (!loc) {
            notFound.push(s.term);
            continue;
          }
          specs.push({
            attachmentKey: children.pdfAttachmentKey,
            text: s.term,
            comment: s.comment,
            color: args['color'] ? String(args['color']) : undefined,
            pageIndex: loc.pageIndex,
            pageHeight: loc.pageHeight,
            rects: loc.rects,
          });
        }
        if (!specs.length) {
          return `None of the passages were found verbatim in the PDF (${notFound
            .map((t) => `"${truncate(t, 40)}"`)
            .join(', ')}). Try shorter exact quotes, or use zotero_add_note.`;
        }
        const result = await createAnnotations(creds, specs);
        const lines = [`Highlights: ${result.created} created`];
        if (notFound.length) lines.push(`${notFound.length} passage(s) not found in the PDF`);
        if (result.failed.length) {
          lines.push(
            `${result.failed.length} rejected by Zotero${
              result.apiRejected
                ? ' (check the quotes are short, verbatim phrases from the PDF)'
                : ''
            }`,
          );
        }
        return lines.join('. ') + '.';
      } catch (e) {
        return `Zotero error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });
}
