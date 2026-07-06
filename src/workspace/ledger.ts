import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { projectDir } from './project.js';
import { parseJsonl } from '../util/jsonl.js';

export interface RunEntry {
  id: string;
  timestamp: string;
  language: string;
  description: string;
  exitCode: number;
  durationMs: number;
  stdoutPreview: string;
  stderrPreview?: string;
  /** Id of the reproducible capsule written under runs/<id>/ (optional for old entries). */
  capsuleId?: string;
  /** Metrics parsed from the run (results/metrics.json or METRIC lines). */
  metrics?: Record<string, number>;
}

const LEDGER = 'runs/ledger.jsonl';

function ledgerPath(slug: string): string {
  return join(projectDir(slug), LEDGER);
}

/** Append one run record to the project's append-only ledger. */
export function appendRun(slug: string, entry: RunEntry): void {
  try {
    const dir = join(projectDir(slug), 'runs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(ledgerPath(slug), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Non-fatal.
  }
}

/** Read all run records for a project (oldest first). */
export function readLedger(slug: string): RunEntry[] {
  try {
    const path = ledgerPath(slug);
    if (!existsSync(path)) return [];
    return parseJsonl<RunEntry>(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}
