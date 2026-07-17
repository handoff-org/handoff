import type { Paper } from './openalex.js';
import { escapeLatex } from '../agent/latex.js';

// Pure, I/O-free BibTeX generation. Turns a cached `Paper` (OpenAlex- or
// arXiv-sourced) into a valid BibTeX entry with a stable, human-readable cite
// key, and merges it into an existing .bib without duplicating. No network, no
// filesystem — everything here is deterministic and unit-testable.

// Skipped when picking the title word for a cite key so `vaswani2017attention`
// wins over `vaswani2017the`.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'on',
  'of',
  'for',
  'and',
  'to',
  'in',
  'is',
  'with',
  'via',
]);

/** Fold accents to ASCII and keep only [a-z0-9] (lowercased). */
function asciiSlug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Family name = last whitespace-separated token of a display name. */
function familyName(author: string): string {
  const parts = author.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1]! : '';
}

/**
 * A stable, readable cite key: firstAuthorFamily + year + firstSignificantTitleWord,
 * e.g. "Attention Is All You Need" by Vaswani (2017) → `vaswani2017attention`.
 * Degrades gracefully: no author → `anon`, no year → `nd`, no usable title word → ''.
 */
export function citeKey(p: { authors: string[]; year: number; title: string }): string {
  const author = asciiSlug(familyName(p.authors?.[0] ?? '')) || 'anon';
  const year = p.year && p.year > 0 ? String(p.year) : 'nd';
  let word = '';
  for (const raw of (p.title ?? '').split(/\s+/)) {
    const w = asciiSlug(raw);
    if (w.length >= 2 && !STOPWORDS.has(w)) {
      word = w;
      break;
    }
  }
  return `${author}${year}${word}`;
}

/**
 * Ensure `base` is unique against `existing` keys by appending a, b, c, …
 * (BibTeX/natbib convention). Returns `base` unchanged when there's no clash.
 */
export function disambiguateKey(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(97 + i); // a..z
    if (!existing.has(candidate)) return candidate;
  }
  // Exhausted a-z (extraordinarily unlikely) — fall back to a numeric suffix.
  let n = 1;
  while (existing.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

const isArxiv = (p: Paper): boolean => p.venue === 'arXiv' || p.id.startsWith('arxiv:');

/** Bare arXiv id from a cached Paper id like "arxiv:2301.07041". */
const arxivId = (p: Paper): string => p.id.replace(/^arxiv:/, '');

/** Render `field = {value}` with LaTeX-escaped value, or '' to omit an empty field. */
function field(name: string, value: string): string {
  const v = value.trim();
  return v ? `  ${name} = {${escapeLatex(v)}},\n` : '';
}

/**
 * A valid BibTeX entry for a cached paper. `@misc` with eprint fields for arXiv
 * preprints, `@article` when a venue is known, `@misc` otherwise. The title is
 * double-braced so BibTeX preserves its capitalization, and every free-text
 * value is LaTeX-escaped so a stray `&`/`_`/`%` can't break compilation.
 */
export function toBibEntry(p: Paper, key: string): string {
  const authors = (p.authors ?? []).map((a) => escapeLatex(a)).join(' and ');
  const year = p.year && p.year > 0 ? String(p.year) : '';
  // Title: escape first, then wrap in an extra pair of braces to hold case.
  const title = `  title = {{${escapeLatex(p.title ?? '')}}},\n`;

  const lines: string[] = [];
  if (isArxiv(p)) {
    lines.push(`@misc{${key},\n`);
    lines.push(title);
    if (authors) lines.push(`  author = {${authors}},\n`);
    lines.push(field('year', year));
    lines.push(field('eprint', arxivId(p)));
    lines.push(`  archivePrefix = {arXiv},\n`);
    lines.push(field('url', p.oaUrl));
  } else {
    const type = p.venue ? 'article' : 'misc';
    lines.push(`@${type}{${key},\n`);
    lines.push(title);
    if (authors) lines.push(`  author = {${authors}},\n`);
    lines.push(field('year', year));
    lines.push(field('journal', p.venue));
    lines.push(field('doi', p.doi));
    if (!p.doi) lines.push(field('url', p.oaUrl));
  }
  // Drop the trailing comma+newline of the last present field for tidiness.
  const body = lines.filter(Boolean).join('').replace(/,\n$/, '\n');
  return `${body}}\n`;
}

/** Every entry key already declared in a .bib file (e.g. from `@article{key,`). */
export function parseBibKeys(bibText: string): Set<string> {
  const keys = new Set<string>();
  for (const m of bibText.matchAll(/@\w+\s*\{\s*([^,\s}]+)/g)) {
    if (m[1]) keys.add(m[1]);
  }
  return keys;
}

/**
 * If this paper is already in the .bib — matched by DOI, arXiv eprint, or exact
 * (escaped) title — return the key of that entry, so re-citing the same paper
 * reuses its key instead of creating a suffixed duplicate. Null when absent.
 * The identifier strings mirror exactly what `toBibEntry` emits.
 */
export function findExistingKey(bibText: string, p: Paper): string | null {
  const identifiers: string[] = [];
  if (p.doi) identifiers.push(`doi = {${escapeLatex(p.doi)}}`);
  if (isArxiv(p)) identifiers.push(`eprint = {${escapeLatex(arxivId(p))}}`);
  identifiers.push(`title = {{${escapeLatex(p.title ?? '')}}}`);
  // Split into @-delimited blocks, each beginning with its own key.
  for (const block of bibText.split(/(?=@\w+\s*\{)/)) {
    const km = block.match(/@\w+\s*\{\s*([^,\s}]+)/);
    if (km && identifiers.some((id) => block.includes(id))) return km[1]!;
  }
  return null;
}

/**
 * Append `entry` to `bibText` unless `key` is already present (idempotent).
 * Preserves existing content and ends the file with exactly one trailing
 * newline plus a blank-line separator before the new entry.
 */
export function mergeBibEntry(
  bibText: string,
  key: string,
  entry: string,
): { text: string; added: boolean } {
  if (parseBibKeys(bibText).has(key)) return { text: bibText, added: false };
  const base = bibText.replace(/\s*$/, ''); // trim trailing whitespace
  const text = base.length ? `${base}\n\n${entry}` : entry;
  return { text, added: true };
}
