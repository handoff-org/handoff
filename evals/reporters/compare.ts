import { readFileSync } from 'node:fs';
import type { ScenarioResult, Severity } from '../schema/types.js';

const SEV_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface BaselineEntry {
  scenarioId: string;
  passed: boolean;
  severity: Severity | null;
  fingerprint?: string;
}
export interface Baseline {
  name: string;
  runId: string;
  commit: string;
  model: string;
  entries: BaselineEntry[];
}

export function toBaseline(
  name: string,
  runId: string,
  commit: string,
  model: string,
  results: ScenarioResult[],
): Baseline {
  return {
    name,
    runId,
    commit,
    model,
    entries: results
      .filter((r) => !r.skipped)
      .map((r) => ({
        scenarioId: r.scenarioId,
        passed: r.passed,
        severity: r.severity,
        fingerprint: r.fingerprint,
      })),
  };
}

export function loadBaseline(path: string): Baseline {
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
}

export type Classification =
  | 'newly-passing'
  | 'newly-failing'
  | 'improved'
  | 'degraded'
  | 'unchanged-pass'
  | 'unchanged-fail'
  | 'flaky'
  | 'not-comparable'
  | 'skipped';

export interface Diff {
  scenarioId: string;
  classification: Classification;
  detail: string;
}

export function compareRuns(
  baseline: Baseline,
  candidate: ScenarioResult[],
): {
  diffs: Diff[];
  counts: Record<Classification, number>;
  categoryDeltas: Record<string, number>;
} {
  const base = new Map(baseline.entries.map((e) => [e.scenarioId, e]));
  const diffs: Diff[] = [];
  const counts = {
    'newly-passing': 0,
    'newly-failing': 0,
    improved: 0,
    degraded: 0,
    'unchanged-pass': 0,
    'unchanged-fail': 0,
    flaky: 0,
    'not-comparable': 0,
    skipped: 0,
  } as Record<Classification, number>;
  const categoryDeltas: Record<string, number> = {};

  // Group candidate repeats to detect flaky.
  const seen = new Set<string>();
  for (const r of candidate) {
    if (r.skipped) {
      diffs.push({
        scenarioId: r.scenarioId,
        classification: 'skipped',
        detail: r.skipReason ?? '',
      });
      counts.skipped++;
      continue;
    }
    if (seen.has(r.scenarioId)) continue;
    seen.add(r.scenarioId);
    const b = base.get(r.scenarioId);
    let cls: Classification;
    if (!b) cls = 'not-comparable';
    else if (b.passed && r.passed) cls = 'unchanged-pass';
    else if (!b.passed && r.passed) cls = 'newly-passing';
    else if (b.passed && !r.passed) cls = 'newly-failing';
    else {
      // both fail — compare severity
      const bs = b.severity ? SEV_RANK[b.severity] : 0;
      const cs = r.severity ? SEV_RANK[r.severity] : 0;
      cls = cs > bs ? 'degraded' : cs < bs ? 'improved' : 'unchanged-fail';
    }
    counts[cls]++;
    if (cls === 'newly-failing') categoryDeltas[r.category] = (categoryDeltas[r.category] ?? 0) - 1;
    if (cls === 'newly-passing') categoryDeltas[r.category] = (categoryDeltas[r.category] ?? 0) + 1;
    diffs.push({
      scenarioId: r.scenarioId,
      classification: cls,
      detail: `${b ? (b.passed ? 'was pass' : 'was fail') : 'new'} → ${r.passed ? 'pass' : 'fail'}`,
    });
  }
  return { diffs, counts, categoryDeltas };
}

export function compareMarkdown(baseline: Baseline, res: ReturnType<typeof compareRuns>): string {
  const regressions = res.diffs.filter(
    (d) => d.classification === 'newly-failing' || d.classification === 'degraded',
  );
  return `# Comparison vs baseline "${baseline.name}" (${baseline.runId})

Baseline model ${baseline.model} @ ${baseline.commit}

## Counts
${Object.entries(res.counts)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Category deltas (net newly-passing minus newly-failing)
${
  Object.entries(res.categoryDeltas)
    .map(([k, v]) => `- ${k}: ${v > 0 ? '+' : ''}${v}`)
    .join('\n') || '- (none)'
}

## Regressions (must review before promoting)
${regressions.length ? regressions.map((d) => `- ${d.scenarioId} — ${d.detail}`).join('\n') : '_none_'}

> Baselines are never overwritten implicitly. Promote a run with \`npm run eval:baseline -- --run <id>\`.
`;
}
