import { mkdirSync, appendFileSync, realpathSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runAgentLoop } from '../agent/loop.js';
import { buildSystem } from '../agent/systemPrompt.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerBuiltins } from '../tools/builtin.js';
import { loadConfig, type Config } from '../../config/schema.js';
import { createModel, type ChatModel } from '../agent/model.js';
import type { BenchTask, BenchmarkRun, TaskResult } from './types.js';

const execAsync = promisify(exec);

/** BENCH_VERBOSE=1 → stream each tool call / result / assistant message to stderr. */
const VERBOSE = !!process.env['BENCH_VERBOSE'];

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
  /**
   * Working directory for shell commands. When set, the benchmark overrides the
   * builtin `run_shell` (which runs in the active project with a 30s cap) with one
   * that runs here — so the agent's `python train.py` resolves relative data paths
   * correctly and its output lands in the task's isolated work dir.
   */
  workDir?: string;
  /**
   * Timeout (ms) for a single shell command. The builtin run_shell caps at 30s,
   * which kills real training/experiment commands. Benchmarks that run models need
   * minutes; defaults to `timeoutMs` when `workDir` is set. Ignored without workDir.
   */
  shellTimeoutMs?: number;
}

export async function runTask(opts: RunTaskOpts): Promise<TaskResult> {
  const {
    task,
    benchmarkName,
    model,
    systemPrompt,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    scorer = scoreAnswer,
    workDir,
    shellTimeoutMs,
  } = opts;

  const started = Date.now();
  let submittedAnswer: string | null = null;
  let totalTurns = 0;
  let totalToolCalls = 0;
  let runError: string | undefined;

  const registry = new ToolRegistry();
  registerBuiltins(registry);

  // Benchmark shell: the builtin run_shell runs in the active project and caps at
  // 30s — too short for training/experiment commands, and the wrong cwd for a task
  // work dir. When workDir is set, override it with a task-scoped, long-timeout shell
  // (bigger output buffer too, since training logs are verbose). Interactive handoff
  // is untouched; this only affects this benchmark registry.
  if (workDir) {
    const shellTimeout = shellTimeoutMs ?? timeoutMs;
    registry.register({
      name: 'run_shell',
      description: 'Run a shell command and return its stdout/stderr.',
      sensitive: true,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
      async execute({ command }) {
        try {
          const { stdout, stderr } = await execAsync(String(command), {
            timeout: shellTimeout,
            cwd: workDir,
            maxBuffer: 32 * 1024 * 1024,
          });
          return [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n');
        } catch (err) {
          // Surface timeouts/non-zero exits to the agent as tool output (not a throw)
          // so it can read the error and adapt, matching the builtin's forgiving shape.
          const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
          const parts = [e.stdout, e.stderr].filter(Boolean).join('\n--- stderr ---\n');
          const note = e.killed
            ? `(command exceeded ${shellTimeout}ms and was killed)`
            : (e.message ?? 'command failed');
          return parts ? `${parts}\n--- error ---\n${note}` : note;
        }
      },
    });
  }

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
      const userMsg =
        outer === 0 ? task.prompt : 'Continue. Call submit_answer when you have the answer.';
      for await (const ev of runAgentLoop(userMsg, history, model, registry, {
        signal: ac.signal,
        approve: () => Promise.resolve(true),
        think: false,
      })) {
        if (ev.type === 'tool_call') {
          totalToolCalls++;
          if (VERBOSE) {
            const preview = String(ev.args ?? '')
              .replace(/\s+/g, ' ')
              .slice(0, 120);
            process.stderr.write(`    → ${ev.name}(${preview})\n`);
          }
        }
        if (VERBOSE && ev.type === 'tool_result') {
          const out = String(ev.result ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 160);
          process.stderr.write(`      ⇐ ${out}\n`);
        }
        if (VERBOSE && ev.type === 'message_end' && ev.content?.trim()) {
          process.stderr.write(`    💬 ${ev.content.replace(/\s+/g, ' ').slice(0, 160)}\n`);
        }
        if (ev.type === 'done') {
          totalTurns++;
          // Prepend system to the returned messages for next outer turn
          history = [{ role: 'system', content: sysContent }, ...ev.messages];
        }
        if (ev.type === 'error' && !ac.signal.aborted) {
          runError = ev.message;
          if (VERBOSE) process.stderr.write(`    ⚠ error: ${ev.message}\n`);
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

/**
 * Load config, then apply any CLI overrides for --model and --backend.
 *
 * Supported flags (all optional):
 *   --model    <id>       Override the model id (e.g. qwen3:14b, llama3.1:8b)
 *   --backend  <name>     Override the backend (ollama | vllm | llama_cpp | mlx | hf)
 *   --base-url <url>      Override the backend's base URL (e.g. http://host:11434)
 *
 * These can also be set via environment variables:
 *   HANDOFF_MODEL, HANDOFF_BACKEND, HANDOFF_OLLAMA_URL / HANDOFF_VLLM_URL etc.
 * (env vars are already handled by loadConfig; CLI flags take precedence over both).
 */
export async function loadModelAndConfig(
  args?: Record<string, string | undefined>,
): Promise<{ model: ChatModel; config: Config }> {
  const config = await loadConfig();

  if (args?.['model']) config.modelId = args['model'];
  if (args?.['backend']) {
    const b = args['backend'] as Config['backend'];
    config.backend = b;
  }
  if (args?.['base-url']) {
    // Apply to whichever backend is active
    switch (config.backend) {
      case 'ollama':
        config.ollamaBaseUrl = args['base-url'];
        break;
      case 'vllm':
        config.vllmBaseUrl = args['base-url'];
        break;
      case 'llama_cpp':
        config.llamaCppBaseUrl = args['base-url'];
        break;
      case 'mlx':
        config.mlxBaseUrl = args['base-url'];
        break;
    }
  }

  const model = createModel(config);
  return { model, config };
}

/**
 * True when the given module (pass `import.meta.url`) is the script node was
 * invoked with. Adapters guard their top-level `main()` with this so that
 * IMPORTING one (e.g. a test importing its scorer) never kicks off the whole
 * benchmark run — that dangling async main() would keep the process alive.
 */
export function isEntrypoint(metaUrl: string): boolean {
  try {
    const arg = process.argv[1];
    return !!arg && realpathSync(arg) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
