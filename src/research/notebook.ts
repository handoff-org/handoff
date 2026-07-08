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
