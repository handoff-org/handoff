import { readFileSync, writeFileSync } from 'fs';
import type { QaLogEvent } from './types.js';

// Reads a run's JSONL, classifies failures, and writes the summary JSON + a
// human-readable failures Markdown report. Robust to malformed lines (they are
// counted as their own failure category rather than throwing).

export interface ScenarioSummary {
  scenarioId: string;
  scenarioName: string;
  seed?: number;
  passed: boolean;
  category?: string;
  failedAssertions: { name: string; expected?: unknown; actual?: unknown; notes?: string }[];
  errors: string[];
  timeouts: string[];
  durationMs?: number;
}

export interface RunSummary {
  runId: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  timeouts: number;
  malformedLogLines: number;
  errorsByCategory: Record<string, number>;
  topFailures: { scenarioId: string; category: string; message: string }[];
  scenarios: ScenarioSummary[];
}

/** Bucket a failing scenario into a coarse category for the summary. */
function classify(scenarioId: string, events: QaLogEvent[]): string {
  const errText = events
    .filter((e) => e.kind === 'error')
    .map((e) => `${e.error?.name ?? ''} ${e.error?.message ?? ''} ${e.error?.stack ?? ''}`)
    .join(' ')
    .toLowerCase();

  if (/uncaughtexception|unhandledrejection|harness_error/.test(errText)) return 'crash';
  if (/render|ink|react/.test(errText)) return 'tui_crash';
  if (events.some((e) => e.kind === 'timeout')) return 'timeout';
  if (scenarioId.includes('path')) return 'path_safety';
  if (scenarioId.includes('paper') || scenarioId.includes('cite')) return 'latex';
  if (scenarioId.includes('malformed') || scenarioId.includes('duplicate')) return 'tool_call';
  if (scenarioId.includes('corrupt')) return 'state_recovery';
  if (
    scenarioId.includes('settings') ||
    scenarioId.includes('model') ||
    scenarioId.includes('perf')
  )
    return 'settings';
  if (/command_error/i.test(errText)) return 'command_crash';
  return 'assertion';
}

export function summarizeRun(jsonlPath: string, runId: string): RunSummary {
  const raw = readFileSync(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  let malformed = 0;
  const byScenario = new Map<string, QaLogEvent[]>();
  for (const line of lines) {
    let ev: QaLogEvent;
    try {
      ev = JSON.parse(line) as QaLogEvent;
    } catch {
      malformed++;
      continue;
    }
    const arr = byScenario.get(ev.scenarioId) ?? [];
    arr.push(ev);
    byScenario.set(ev.scenarioId, arr);
  }

  const scenarios: ScenarioSummary[] = [];
  for (const [scenarioId, events] of byScenario) {
    const name = events[0]?.scenarioName ?? scenarioId;
    const seed = events.find((e) => e.seed != null)?.seed;
    const end = events.find((e) => e.kind === 'scenario_end');
    const failedAssertions = events
      .filter(
        (e) =>
          e.kind === 'assertion' &&
          e.assertion &&
          !e.assertion.passed &&
          e.assertion.severity === 'failure',
      )
      .map((e) => ({
        name: e.assertion!.name,
        expected: e.assertion!.expected,
        actual: e.assertion!.actual,
        notes: e.assertion!.notes,
      }));
    const errors = events
      .filter((e) => e.kind === 'error')
      .map((e) => e.error?.message ?? '(error)');
    const timeouts = events
      .filter((e) => e.kind === 'timeout')
      .map((e) => e.message ?? '(timeout)');
    const passed = failedAssertions.length === 0 && errors.length === 0 && timeouts.length === 0;
    scenarios.push({
      scenarioId,
      scenarioName: name,
      ...(seed != null ? { seed } : {}),
      passed,
      ...(passed ? {} : { category: classify(scenarioId, events) }),
      failedAssertions,
      errors,
      timeouts,
      ...(end?.metrics?.durationMs != null ? { durationMs: end.metrics.durationMs } : {}),
    });
  }

  const failedScenarios = scenarios.filter((s) => !s.passed);
  const errorsByCategory: Record<string, number> = {};
  for (const s of failedScenarios) {
    const cat = s.category ?? 'assertion';
    errorsByCategory[cat] = (errorsByCategory[cat] ?? 0) + 1;
  }
  if (malformed > 0) errorsByCategory['malformed_log'] = malformed;

  const topFailures = failedScenarios.map((s) => ({
    scenarioId: s.scenarioId,
    category: s.category ?? 'assertion',
    message: s.failedAssertions[0]?.name ?? s.errors[0] ?? s.timeouts[0] ?? 'failed',
  }));

  return {
    runId,
    totalScenarios: scenarios.length,
    passed: scenarios.filter((s) => s.passed).length,
    failed: failedScenarios.length,
    timeouts: scenarios.filter((s) => s.timeouts.length > 0).length,
    malformedLogLines: malformed,
    errorsByCategory,
    topFailures,
    scenarios,
  };
}

export function renderFailuresMarkdown(summary: RunSummary): string {
  const lines: string[] = [`# QA Chat Simulation Failures`, '', `Run: ${summary.runId}`, ''];
  lines.push(
    `Scenarios: ${summary.totalScenarios} · passed ${summary.passed} · failed ${summary.failed}` +
      (summary.malformedLogLines ? ` · malformed log lines ${summary.malformedLogLines}` : ''),
    '',
  );
  const failed = summary.scenarios.filter((s) => !s.passed);
  if (failed.length === 0) {
    lines.push('No failures. 🎉');
    return lines.join('\n') + '\n';
  }
  lines.push('## Failures by category', '');
  for (const [cat, n] of Object.entries(summary.errorsByCategory)) lines.push(`- ${cat}: ${n}`);
  lines.push('');
  let i = 1;
  for (const s of failed) {
    lines.push(`## ${i}. ${s.scenarioId} — ${s.scenarioName}`, '');
    lines.push(`Category: ${s.category ?? 'assertion'}`);
    if (s.seed != null) lines.push(`Seed: ${s.seed}`);
    lines.push('');
    if (s.failedAssertions.length) {
      lines.push('Failed assertions:');
      for (const a of s.failedAssertions) {
        lines.push(`- ${a.name}` + (a.notes ? ` — ${a.notes}` : ''));
        if (a.expected !== undefined) lines.push(`  - expected: ${JSON.stringify(a.expected)}`);
        if (a.actual !== undefined) lines.push(`  - actual: ${JSON.stringify(a.actual)}`);
      }
      lines.push('');
    }
    if (s.errors.length) {
      lines.push('Errors:');
      for (const e of s.errors) lines.push(`- ${e}`);
      lines.push('');
    }
    if (s.timeouts.length) {
      lines.push('Timeouts:');
      for (const t of s.timeouts) lines.push(`- ${t}`);
      lines.push('');
    }
    lines.push(
      `Reproduce: \`npm run qa:chat -- --scenario ${s.scenarioId}${s.seed != null ? ` --seed ${s.seed}` : ''}\``,
      '',
    );
    i++;
  }
  return lines.join('\n') + '\n';
}

export function writeReports(jsonlPath: string, runId: string): RunSummary {
  const summary = summarizeRun(jsonlPath, runId);
  const base = jsonlPath.replace(/\.jsonl$/, '');
  writeFileSync(`${base}.summary.json`, JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(`${base}.failures.md`, renderFailuresMarkdown(summary), 'utf-8');
  return summary;
}
