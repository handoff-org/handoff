import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECTS_DIR = join(homedir(), '.handoff', 'projects');

function projectDir(slug: string): string {
  return join(PROJECTS_DIR, slug);
}

export type NotebookEntryType =
  'experiment-run' | 'literature-find' | 'insight' | 'draft-section' | 'note';

export interface NotebookEntry {
  type: NotebookEntryType;
  summary: string;
  details?: string;
}

const NOTEBOOK_FILE = 'NOTEBOOK.md';

const TYPE_LABEL: Record<NotebookEntryType, string> = {
  'experiment-run': '🧪 Experiment',
  'literature-find': '📄 Literature',
  insight: '💡 Insight',
  'draft-section': '✍️  Draft',
  note: '📝 Note',
};

/** Stamp a YYYY-MM-DD HH:mm string in local time. */
function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function notebookPath(slug: string): string {
  return join(projectDir(slug), NOTEBOOK_FILE);
}

/** Create an empty NOTEBOOK.md for a project (called during scaffolding). */
export function initNotebook(slug: string, title: string): void {
  const path = notebookPath(slug);
  if (existsSync(path)) return;
  const header =
    `# Lab Notebook — ${title}\n\n` +
    `Auto-kept research journal. handoff appends here whenever an experiment\n` +
    `runs, papers are found, sections are drafted, or insights are recorded.\n\n` +
    `---\n`;
  writeFileSync(path, header, 'utf-8');
}

/**
 * Append a timestamped entry to the active project's NOTEBOOK.md.
 * Silently no-ops if the project doesn't exist or the write fails.
 */
export function appendNotebook(slug: string, entry: NotebookEntry): void {
  try {
    const path = notebookPath(slug);
    // If notebook was never initialised (old project), seed it now.
    if (!existsSync(path)) initNotebook(slug, slug);
    const label = TYPE_LABEL[entry.type] ?? entry.type;
    let block = `\n## ${stamp()} — ${label}\n\n${entry.summary}\n`;
    if (entry.details) block += `\n${entry.details}\n`;
    block += `\n---\n`;
    const current = readFileSync(path, 'utf-8');
    writeFileSync(path, current + block, 'utf-8');
  } catch {
    // Non-fatal: notebook is a convenience, never block the main flow.
  }
}

/**
 * Split a NOTEBOOK.md into its entry blocks. Each entry the writer emits is a
 * `## <stamp> — <label>` heading followed by body, separated by `---` lines.
 * The leading file header (everything before the first `## ` heading) is dropped.
 * Returns entries oldest→newest, each a trimmed markdown block.
 */
export function parseBlocks(md: string): string[] {
  const blocks: string[] = [];
  // Split on lines that are exactly a horizontal rule.
  for (const chunk of md.split(/\n---\n/)) {
    const idx = chunk.indexOf('## ');
    if (idx === -1) continue; // header preamble or empty tail
    const block = chunk.slice(idx).trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Read the most recent notebook entries for a project. Returns them
 * newest-first, capped to `limit` (default 10). Never throws — returns [] if the
 * notebook is missing or unreadable.
 */
export function readNotebook(slug: string, opts: { limit?: number } = {}): string[] {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 10;
  try {
    const path = notebookPath(slug);
    if (!existsSync(path)) return [];
    const blocks = parseBlocks(readFileSync(path, 'utf-8'));
    return blocks.slice(-limit).reverse();
  } catch {
    return [];
  }
}

/**
 * Return notebook entries containing `term` (case-insensitive), newest-first.
 * Never throws.
 */
export function searchNotebook(slug: string, term: string): string[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  try {
    const path = notebookPath(slug);
    if (!existsSync(path)) return [];
    const blocks = parseBlocks(readFileSync(path, 'utf-8'));
    return blocks.filter((b) => b.toLowerCase().includes(needle)).reverse();
  } catch {
    return [];
  }
}
