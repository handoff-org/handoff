import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { projectDir } from '../workspace/project.js';
import { stripLatex, findTexFiles } from '../workspace/auditor.js';
import { parseBibKeys } from './bibtex.js';
import { readLitNotes, formatLitNote } from './litNotes.js';
import { searchNotebook } from './notebook.js';

/**
 * Local, dependency-free prose/quality checks for a paper's LaTeX. Complements
 * the claim auditor (which finds *unsupported* claims) and provenance (stale
 * numbers) with everyday writing hygiene: weasel words, passive-voice hints,
 * duplicated words, leftover TODO markers, and — highest signal — dangling
 * cross-references (`\ref` with no `\label`) and `\cite` keys missing from
 * refs.bib. All detectors are pure so they can be unit-tested with fixtures.
 */

// ── Pure detectors (operate on a single line/string) ────────────────────────

// Hedge/filler words that usually weaken scientific prose.
const WEASEL_WORDS = [
  'very',
  'quite',
  'fairly',
  'rather',
  'somewhat',
  'really',
  'basically',
  'actually',
  'simply',
  'just',
  'clearly',
  'obviously',
  'essentially',
  'arguably',
  'relatively',
  'virtually',
  'effectively',
  'largely',
  'various',
  'several',
  'numerous',
  'a number of',
  'a variety of',
];
const WEASEL_RE = new RegExp(
  `\\b(${WEASEL_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

// Passive-voice heuristic: a "be" verb followed by a past participle. Curated
// irregular participles + the regular "-ed" pattern. Labelled a *hint* because
// this over-triggers (e.g. "is based on" is often fine).
const PARTICIPLES =
  'shown|done|made|given|taken|seen|known|found|used|based|proposed|derived|' +
  'obtained|performed|trained|evaluated|computed|defined|described|presented|' +
  'introduced|considered|achieved|observed|reported|applied|generated|measured';
const PASSIVE_RE = new RegExp(
  `\\b(is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(\\w+ed|${PARTICIPLES})\\b`,
  'gi',
);

// Doubled words: "the the", "is is". Case-insensitive, whitespace-separated.
const DUP_RE = /\b(\w+)\s+\1\b/gi;

// Leftover authoring markers (checked on RAW lines, before LaTeX stripping).
const TODO_RE = /\b(TODO|FIXME|XXX|HACK|WIP)\b/g;

// Cross-reference commands.
const LABEL_RE = /\\label\{([^}]+)\}/g;
const REF_RE = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref)\{([^}]+)\}/g;
// \cite, \citep, \citet, \citeauthor, … with optional [..] options; keys may be comma-separated.
const CITE_RE = /\\[a-zA-Z]*cite[a-zA-Z]*\s*(?:\[[^\]]*\])*\s*\{([^}]+)\}/g;

function uniqueMatches(re: RegExp, text: string, group = 1): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const v = (m[group] ?? '').trim();
    if (v) out.push(v);
  }
  return out;
}

/** Weasel/hedge words found in a line of prose (already LaTeX-stripped). */
export function weaselHits(text: string): string[] {
  return uniqueMatches(WEASEL_RE, text, 1).map((w) => w.toLowerCase());
}

/** Passive-voice hints (the matched "be + participle" spans). */
export function passiveHits(text: string): string[] {
  return Array.from(text.matchAll(PASSIVE_RE)).map((m) => m[0].replace(/\s+/g, ' ').toLowerCase());
}

/** Adjacent duplicated words ("the the"). Returns the doubled word. */
export function dupWordHits(text: string): string[] {
  return uniqueMatches(DUP_RE, text, 1).map((w) => w.toLowerCase());
}

/** All `\label{}` keys in a chunk of LaTeX. */
export function labelsIn(text: string): string[] {
  return uniqueMatches(LABEL_RE, text).flatMap((k) => k.split(',').map((s) => s.trim()));
}

/** All `\ref`-family target keys in a chunk of LaTeX. */
export function refsIn(text: string): string[] {
  return uniqueMatches(REF_RE, text).flatMap((k) => k.split(',').map((s) => s.trim()));
}

/** All `\cite`-family keys in a chunk of LaTeX (comma lists expanded). */
export function citeKeysIn(text: string): string[] {
  return uniqueMatches(CITE_RE, text)
    .flatMap((k) => k.split(',').map((s) => s.trim()))
    .filter(Boolean);
}

// ── Report ──────────────────────────────────────────────────────────────────

export type ProseSeverity = 'warn' | 'hint';

export interface ProseIssue {
  kind: 'weasel' | 'passive' | 'dup-word' | 'todo' | 'dangling-ref' | 'missing-cite';
  severity: ProseSeverity;
  message: string;
  file: string; // basename
  line: number; // 1-based; 0 when file-level
}

export interface ProseReport {
  issues: ProseIssue[];
  filesScanned: number;
  bibFound: boolean;
}

/** Scan the active project's paper/*.tex for writing issues. Read-only. */
export function checkProse(slug: string): ProseReport {
  const paperDir = join(projectDir(slug), 'paper');
  const texFiles = findTexFiles(paperDir);
  const bibPath = join(paperDir, 'refs.bib');
  const bibFound = existsSync(bibPath);
  const bibKeys = bibFound ? parseBibKeys(readFileSync(bibPath, 'utf-8')) : new Set<string>();

  const issues: ProseIssue[] = [];
  const labels = new Set<string>();
  const refUses: { key: string; file: string; line: number }[] = [];
  const citeUses: { key: string; file: string; line: number }[] = [];

  for (const filePath of texFiles) {
    const file = basename(filePath);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    lines.forEach((raw, i) => {
      const line = i + 1;
      // Cross-ref collection (from raw line — commands survive stripping anyway).
      for (const k of labelsIn(raw)) labels.add(k);
      for (const k of refsIn(raw)) refUses.push({ key: k, file, line });
      for (const k of citeKeysIn(raw)) citeUses.push({ key: k, file, line });

      // TODO markers on the raw line (comments included).
      for (const m of raw.matchAll(TODO_RE)) {
        issues.push({
          kind: 'todo',
          severity: 'warn',
          message: `leftover ${m[1]} marker`,
          file,
          line,
        });
      }

      // Prose checks on stripped text.
      const prose = stripLatex(raw);
      if (!prose) return;
      for (const w of weaselHits(prose)) {
        issues.push({
          kind: 'weasel',
          severity: 'hint',
          message: `weasel/hedge word "${w}"`,
          file,
          line,
        });
      }
      for (const p of passiveHits(prose)) {
        issues.push({
          kind: 'passive',
          severity: 'hint',
          message: `possible passive voice "${p}"`,
          file,
          line,
        });
      }
      for (const d of dupWordHits(prose)) {
        issues.push({
          kind: 'dup-word',
          severity: 'warn',
          message: `doubled word "${d} ${d}"`,
          file,
          line,
        });
      }
    });
  }

  // Dangling \ref → no matching \label.
  for (const r of refUses) {
    if (!labels.has(r.key)) {
      issues.push({
        kind: 'dangling-ref',
        severity: 'warn',
        message: `\\ref{${r.key}} has no matching \\label`,
        file: r.file,
        line: r.line,
      });
    }
  }
  // \cite keys missing from refs.bib (only meaningful when a bib exists).
  if (bibFound) {
    for (const c of citeUses) {
      if (!bibKeys.has(c.key)) {
        issues.push({
          kind: 'missing-cite',
          severity: 'warn',
          message: `\\cite{${c.key}} not found in refs.bib`,
          file: c.file,
          line: c.line,
        });
      }
    }
  }

  issues.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { issues, filesScanned: texFiles.length, bibFound };
}

const KIND_LABEL: Record<ProseIssue['kind'], string> = {
  weasel: 'Hedge words',
  passive: 'Passive voice',
  'dup-word': 'Doubled words',
  todo: 'TODO markers',
  'dangling-ref': 'Dangling \\ref',
  'missing-cite': 'Missing citations',
};

/** Render a scannable writing report (mirrors formatAuditReport's tone). */
export function formatWritingReport(report: ProseReport, projectTitle: string): string {
  const lines: string[] = [`Writing check — ${projectTitle}`];
  if (report.filesScanned === 0) {
    lines.push('', 'No .tex files found in paper/. Add your LaTeX there and re-run.');
    return lines.join('\n');
  }
  if (report.issues.length === 0) {
    lines.push('', `✓ No issues found across ${report.filesScanned} file(s).`);
    return lines.join('\n');
  }

  const warns = report.issues.filter((i) => i.severity === 'warn').length;
  const hints = report.issues.length - warns;
  lines.push('', `${warns} issue(s) + ${hints} hint(s) across ${report.filesScanned} file(s):`);

  // Group by kind for a scannable summary.
  const byKind = new Map<ProseIssue['kind'], ProseIssue[]>();
  for (const i of report.issues) {
    if (!byKind.has(i.kind)) byKind.set(i.kind, []);
    byKind.get(i.kind)!.push(i);
  }
  for (const [kind, items] of byKind) {
    lines.push('', `${KIND_LABEL[kind]} (${items.length}):`);
    for (const it of items.slice(0, 12)) {
      lines.push(`  ${it.file}:${it.line}  ${it.message}`);
    }
    if (items.length > 12) lines.push(`  … and ${items.length - 12} more`);
  }
  if (!report.bibFound) {
    lines.push('', '(no refs.bib found — citation checks skipped)');
  }
  lines.push('', "Hints (passive voice, hedge words) are heuristic — review, don't auto-fix.");
  return lines.join('\n');
}

// ── Lit-review context builder ───────────────────────────────────────────────

/**
 * Build a structured context block for draft_lit_review.
 * Combines structured lit notes (optionally filtered by tag) with any
 * literature-find entries recorded in the project notebook.
 * The returned string is passed verbatim to the model as evidence to draw on.
 */
export function buildLitReviewContext(slug: string, tags?: string[]): string {
  const allNotes = readLitNotes(slug);
  const notes = tags?.length
    ? allNotes.filter((n) => tags.some((t) => n.tags.includes(t)))
    : allNotes;

  // Notebook literature-find entries are stored as markdown blocks with the
  // "📄 Literature" label — search captures them all.
  const nbEntries = searchNotebook(slug, '📄 Literature').slice(0, 20);

  const parts: string[] = [];

  if (notes.length) {
    parts.push(`=== Structured Notes (${notes.length} paper${notes.length !== 1 ? 's' : ''}) ===`);
    for (const n of notes) parts.push(formatLitNote(n));
  }

  if (nbEntries.length) {
    parts.push(`\n=== Notebook Literature Finds (${nbEntries.length}) ===`);
    for (const e of nbEntries) parts.push(e);
  }

  if (!parts.length) {
    return '(no literature notes found — use note_paper to annotate papers first)';
  }

  return parts.join('\n\n');
}

// ── Section scaffolding ─────────────────────────────────────────────────────

export type ScaffoldKind = 'default' | 'empirical';

/** A standard section skeleton to drop into main.tex (before \end{document}). */
export function scaffoldSections(kind: ScaffoldKind = 'default'): string {
  const sections =
    kind === 'empirical'
      ? [
          'Introduction',
          'Related Work',
          'Method',
          'Experimental Setup',
          'Results',
          'Discussion',
          'Conclusion',
        ]
      : ['Introduction', 'Related Work', 'Method', 'Experiments', 'Results', 'Conclusion'];
  return sections
    .map((title) => {
      const label = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      return `\\section{${title}}\n\\label{sec:${label}}\n\n% TODO: write ${title}\n`;
    })
    .join('\n');
}
