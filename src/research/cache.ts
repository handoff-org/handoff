import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { Paper } from './openalex.js';

const PAPERS_DIR = join(homedir(), '.handoff', 'research', 'papers');

/** Cache a fetched paper locally so research is reproducible and offline-reviewable. */
export async function cachePaper(paper: Paper): Promise<void> {
  try {
    await mkdir(PAPERS_DIR, { recursive: true });
    await writeFile(join(PAPERS_DIR, `${paper.id}.json`), JSON.stringify(paper, null, 2), 'utf-8');
  } catch {
    // Caching is best-effort; never fail a lookup over it.
  }
}

/**
 * Read a previously cached paper by id (the same id `cachePaper` wrote — an
 * OpenAlex `W…` or an `arxiv:…`). Returns null when it isn't cached or the file
 * is unreadable/corrupt. Never throws — callers fall back to a live fetch.
 */
export async function loadCachedPaper(id: string): Promise<Paper | null> {
  try {
    const raw = await readFile(join(PAPERS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(raw) as Paper;
  } catch {
    return null;
  }
}
