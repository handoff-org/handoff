import { writeFile, mkdir } from 'fs/promises';
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
