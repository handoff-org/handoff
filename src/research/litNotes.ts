import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { projectDir } from '../workspace/project.js';
import { parseJsonl } from '../util/jsonl.js';

export interface LitNote {
  paperId: string;
  title: string;
  authors: string[];
  year: number;
  citeKey?: string;
  keyPassages: { quote: string; comment?: string }[];
  relevanceSummary: string;
  tags: string[];
  status: 'skimmed' | 'read' | 'summarized';
  createdAt: string;
  updatedAt: string;
}

export function litNotesPath(slug: string): string {
  return join(projectDir(slug), 'literature', 'notes.jsonl');
}

export function readLitNotes(slug: string): LitNote[] {
  try {
    const p = litNotesPath(slug);
    if (!existsSync(p)) return [];
    return parseJsonl<LitNote>(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

/** Upsert by paperId — replaces existing note if present, appends otherwise. */
export function writeLitNote(slug: string, note: LitNote): void {
  const dir = join(projectDir(slug), 'literature');
  mkdirSync(dir, { recursive: true });
  const path = litNotesPath(slug);
  const existing = readLitNotes(slug);
  const idx = existing.findIndex((n) => n.paperId === note.paperId);
  if (idx === -1) {
    appendFileSync(path, JSON.stringify(note) + '\n', 'utf-8');
  } else {
    existing[idx] = note;
    writeFileSync(path, existing.map((n) => JSON.stringify(n)).join('\n') + '\n', 'utf-8');
  }
}

export function searchLitNotes(slug: string, term: string): LitNote[] {
  const lower = term.toLowerCase();
  return readLitNotes(slug).filter(
    (n) =>
      n.title.toLowerCase().includes(lower) ||
      n.relevanceSummary.toLowerCase().includes(lower) ||
      n.tags.some((t) => t.toLowerCase().includes(lower)) ||
      n.keyPassages.some((p) => p.quote.toLowerCase().includes(lower)),
  );
}

/** Format one note for display in the transcript. */
export function formatLitNote(n: LitNote): string {
  const authors = n.authors.length > 2 ? `${n.authors[0]} et al.` : n.authors.join(', ');
  const lines: string[] = [
    `${n.paperId}  [${n.status}]`,
    `  "${n.title}" — ${authors}, ${n.year}${n.citeKey ? `  \\cite{${n.citeKey}}` : ''}`,
    `  Relevance: ${n.relevanceSummary}`,
  ];
  if (n.tags.length) lines.push(`  Tags: ${n.tags.join(', ')}`);
  for (const p of n.keyPassages) {
    lines.push(
      `  · "${p.quote.slice(0, 100)}${p.quote.length > 100 ? '…' : ''}"${p.comment ? ` — ${p.comment}` : ''}`,
    );
  }
  return lines.join('\n');
}

/** Format a list of notes for /lit-notes. */
export function formatLitNotesSummary(notes: LitNote[], projectTitle: string): string {
  if (notes.length === 0) {
    return `Lit notes — ${projectTitle}\n\nNo notes yet. Use note_paper to annotate papers.`;
  }
  const header = `Lit notes — ${projectTitle}  (${notes.length} paper${notes.length !== 1 ? 's' : ''})`;
  const rule = '─'.repeat(72);
  return [header, '', rule, ...notes.map(formatLitNote), rule].join('\n');
}
