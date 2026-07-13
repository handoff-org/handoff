import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { projectDir } from './project.js';
import { parseJsonl } from '../util/jsonl.js';

// A MetricBinding links a specific number that appears in a paper file (identified
// by file + line) to the run capsule and metric key that produced it. Bindings
// are created explicitly by the user (bind_metric, confidence=1.0) or as
// auto-link suggestions (auto_link_number, confidence<1.0).

export interface MetricBinding {
  id: string;
  file: string;        // project-relative, e.g. "paper/main.tex"
  line: number;
  raw: string;         // "92.1" as it appears in the paper
  value: number;
  runId: string;
  metricKey: string;
  claimId?: string;
  confidence: number;  // 1.0 = user-confirmed; <1 = auto-suggested
  boundAt: string;
}

let _seq = 0;
export function newBindingId(): string {
  return `b_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
}

function bindingsDir(slug: string): string {
  return join(projectDir(slug), 'claims');
}

export function bindingsPath(slug: string): string {
  return join(bindingsDir(slug), 'bindings.jsonl');
}

export function readBindings(slug: string): MetricBinding[] {
  try {
    const p = bindingsPath(slug);
    if (!existsSync(p)) return [];
    return parseJsonl<MetricBinding>(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

export function appendBinding(slug: string, binding: MetricBinding): void {
  mkdirSync(bindingsDir(slug), { recursive: true });
  appendFileSync(bindingsPath(slug), JSON.stringify(binding) + '\n', 'utf-8');
}

export function removeBinding(slug: string, id: string): boolean {
  const all = readBindings(slug);
  const filtered = all.filter((b) => b.id !== id);
  if (filtered.length === all.length) return false;
  const p = bindingsPath(slug);
  writeFileSync(
    p,
    filtered.map((b) => JSON.stringify(b)).join('\n') + (filtered.length ? '\n' : ''),
    'utf-8',
  );
  return true;
}

/** One-line binding row for /list_bindings. */
export function formatBindingRow(b: MetricBinding): string {
  const conf = b.confidence === 1 ? '✓' : `~${Math.round(b.confidence * 100)}%`;
  const claim = b.claimId ? ` → ${b.claimId}` : '';
  return ` ${conf}  ${b.id.padEnd(18)}  ${b.file}:${b.line}  ${b.raw.padEnd(10)}  ${b.runId}  ${b.metricKey}${claim}`;
}

export function formatBindingsSummary(bindings: MetricBinding[], projectTitle: string): string {
  if (bindings.length === 0) {
    return `Metric bindings — ${projectTitle}\n\nNo bindings yet. Use /bind or /auto-link.`;
  }
  const rule = '─'.repeat(80);
  const confirmed = bindings.filter((b) => b.confidence === 1).length;
  return [
    `Metric bindings — ${projectTitle}  (${bindings.length} total, ${confirmed} confirmed)`,
    '',
    rule,
    ...bindings.map(formatBindingRow),
    rule,
  ].join('\n');
}
