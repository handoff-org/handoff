import { mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { runAgentLoop } from '../agent/loop.js';
import { buildSystem } from '../agent/systemPrompt.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerBuiltins } from '../tools/builtin.js';
import { loadConfig, type Config } from '../../config/schema.js';
import { createModel, type ChatModel } from '../agent/model.js';
import type { BenchTask, BenchmarkRun, TaskResult } from './types.js';

export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60_000;
export const MAX_OUTER_TURNS = 3; // each outer turn = up to 10 tool-call rounds

// ── Answer scorer ─────────────────────────────────────────────────────────────

/**
 * Compare predicted vs expected. Tries exact string match first, then
 * numeric comparison within 5% relative tolerance (handles "0.892" vs "89.2%"
 * and rounding in table values).
 */
export function scoreAnswer(predicted: string | null, expected: string): boolean {
  if (predicted === null) return false;
  const p = predicted.trim().toLowerCase().replace(/\s+/g, ' ');
  const e = expected.trim().toLowerCase().replace(/\s+/g, ' ');
  if (p === e) return true;
  const pn = Number(p.replace(/,/g, '').replace(/%$/, ''));
  const en = Number(e.replace(/,/g, '').replace(/%$/, ''));
  if (!isNaN(pn) && !isNaN(en) && en !== 0) {
    // Percent-aware: also test p/100 vs e and p vs e/100
    const candidates = [
      [pn, en],
      [pn / 100, en],
      [pn, en / 100],
    ] as [number, number][];
    return candidates.some(([a, b]) => Math.abs(a - b) / Math.abs(b) <= 0.05);
  }
  return false;
}

// ── Agent driver ──────────────────────────────────────────────────────────────

export interface RunTaskOpts {
  task: BenchTask;
  benchmarkName: string;
  model: ChatModel;
  systemPrompt: string;
  timeoutMs?: number;
  /** Scorer; defaults to scoreAnswer. Pass custom logic per benchmark. */
  scorer?: (predicted: string | null, expected: string) => boolean;
}

export async function runTask(opts: RunTaskOpts): Promise<TaskResult> {
  const {
    task,
    benchmarkName,
    model,
    systemPrompt,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    scorer = scoreAnswer,
  } = opts;

  const started = Date.now();
  let submittedAnswer: string | null = null;
  let totalTurns = 0;
  let totalToolCalls = 0;
  let runError: string | undefined;

  const registry = new ToolRegistry();
  registerBuiltins(registry);
  registry.register({
    name: 'submit_answer',
    description:
      'Submit your final answer once you have computed it. ' +
      'Call this exactly once when you are confident in your result.',
    parameters: {
      type: 'object',
      properties: {
        answer: {
          type: 'string',
          description: 'Your final answer as precisely as possible (e.g. "0.892" not "~90%")',
        },
      },
      required: ['answer'],
    },
    async execute({ answer }) {
      submittedAnswer = String(answer ?? '').trim();
      return `Answer recorded: ${submittedAnswer}`;
    },
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const sysContent = buildSystem(systemPrompt, null, {});

  try {
    // Outer loop: re-enter the agent if it hits the 10-round tool-call cap
    // without submitting. At most MAX_OUTER_TURNS re-entries.
    let history: import('../agent/model.js').Message[] = [];
    for (let outer = 0; outer < MAX_OUTER_TURNS; outer++) {
      if (ac.signal.aborted || submittedAnswer !== null) break;
      const userMsg = outer === 0 ? task.prompt : 'Continue. Call submit_answer when you have the answer.';
      for await (const ev of runAgentLoop(userMsg, history, model, registry, {
        signal: ac.signal,
        approve: () => Promise.resolve(true),
        think: false,
      })) {
        if (ev.type === 'tool_call') totalToolCalls++;
        if (ev.type === 'done') {
          totalTurns++;
          // Prepend system to the returned messages for next outer turn
          history = [{ role: 'system', content: sysContent }, ...ev.messages];
        }
        if (ev.type === 'error' && !ac.signal.aborted) {
          runError = ev.message;
        }
      }
      if (submittedAnswer !== null) break;
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  if (ac.signal.aborted && !runError) runError = 'task timed out';

  const passed = scorer(submittedAnswer, task.expected);
  return {
    taskId: task.id,
    benchmark: benchmarkName,
    ...(task.difficulty ? { difficulty: task.difficulty } : {}),
    ...(task.domain ? { domain: task.domain } : {}),
    passed,
    predicted: submittedAnswer,
    expected: task.expected,
    turns: totalTurns,
    toolCalls: totalToolCalls,
    durationMs: Date.now() - started,
    ...(runError ? { error: runError } : {}),
  };
}

// ── Results writer ────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function buildRunSummary(
  results: TaskResult[],
  opts: { runId: string; benchmark: string; model: ChatModel; config: Config },
): BenchmarkRun {
  const { runId, benchmark, model, config } = opts;
  const passed = results.filter((r) => r.passed).length;
  const byDifficulty: BenchmarkRun['byDifficulty'] = {};
  const byDomain: BenchmarkRun['byDomain'] = {};
  for (const r of results) {
    if (r.difficulty) {
      byDifficulty[r.difficulty] ??= { total: 0, passed: 0 };
      byDifficulty[r.difficulty].total++;
      if (r.passed) byDifficulty[r.difficulty].passed++;
    }
    if (r.domain) {
      byDomain[r.domain] ??= { total: 0, passed: 0 };
      byDomain[r.domain].total++;
      if (r.passed) byDomain[r.domain].passed++;
    }
  }
  return {
    runId,
    benchmark,
    model: model.modelId,
    backend: config.backend,
    timestamp: new Date().toISOString(),
    totalTasks: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    avgTurns: avg(results.map((r) => r.turns)),
    avgToolCalls: avg(results.map((r) => r.toolCalls)),
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    byDifficulty,
    byDomain,
    results,
  };
}

export function writeResults(summary: BenchmarkRun, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  // Append one JSON line per result + a final summary line
  for (const r of summary.results) {
    appendFileSync(outputPath, JSON.stringify(r) + '\n', 'utf-8');
  }
  const summaryPath = outputPath.replace(/\.jsonl$/, '.summary.json');
  const { results: _, ...meta } = summary;
  appendFileSync(summaryPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

export function printSummary(summary: BenchmarkRun): void {
  const { benchmark, model, totalTasks, passed, passRate, byDifficulty, byDomain } = summary;
  process.stdout.write(`\n${benchmark} — ${model}\n`);
  process.stdout.write(`Pass: ${passed}/${totalTasks} (${(passRate * 100).toFixed(1)}%)\n`);
  if (Object.keys(byDifficulty).length) {
    process.stdout.write('By difficulty:\n');
    for (const [d, s] of Object.entries(byDifficulty)) {
      process.stdout.write(`  ${d}: ${s.passed}/${s.total}\n`);
    }
  }
  if (Object.keys(byDomain).length) {
    process.stdout.write('By domain:\n');
    for (const [d, s] of Object.entries(byDomain)) {
      process.stdout.write(`  ${d}: ${s.passed}/${s.total}\n`);
    }
  }
}

// ── CLI helpers ───────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = argv[i + 1]?.startsWith('--') ? 'true' : (argv[++i] ?? 'true');
    }
  }
  return out;
}

export function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

export async function loadModelAndConfig(): Promise<{ model: ChatModel; config: Config }> {
  const config = await loadConfig();
  const model = createModel(config);
  return { model, config };
}
