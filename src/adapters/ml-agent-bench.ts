/**
 * MLAgentBench adapter (arXiv:2310.03302)
 * ML experimentation: improve a given ML training script to maximize a metric.
 * https://github.com/snap-stanford/MLAgentBench
 *
 * Usage:
 *   npx tsx src/adapters/ml-agent-bench.ts --bench-dir ~/Desktop/benchmarks/MLAgentBench --task cifar10
 *   ML_AGENT_BENCH_DIR=~/Desktop/benchmarks/MLAgentBench npm run bench:ml-agent -- --task cifar10
 *
 * Flags:
 *   --bench-dir   Path to cloned repo (or $ML_AGENT_BENCH_DIR)
 *   --task        Task name (e.g. "cifar10") — default: all
 *   --limit       Max tasks to run
 *   --baseline    Reference metric to beat (pass = final >= baseline). Omit → any
 *                 valid numeric metric the agent reports counts as pass (smoke mode).
 *   --output      Output JSONL path
 *   --model       Model id to use (e.g. qwen3:14b)  [default: from config]
 *   --backend     Backend (ollama | vllm | llama_cpp | mlx | hf)
 *   --base-url    Backend base URL (e.g. http://localhost:11434)
 *
 * Layout (real repo):
 *   <bench-dir>/MLAgentBench/benchmarks/<task>/
 *     env/      train.py, task_descriptor.txt, (data/ after prepare.py)
 *     scripts/  research_problem.txt, prepare.py, read_only_files.txt
 *
 * Each run gets an ISOLATED copy of the task's env/ under benchmarks/work/ so the
 * agent's edits + training output never touch the pristine clone, and repeat runs
 * start clean. The agent operates via absolute paths; the benchmark run_shell runs
 * inside the work dir with a long timeout (real training needs minutes, not 30s).
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import {
  runTask,
  buildRunSummary,
  writeResults,
  printSummary,
  parseArgs,
  loadModelAndConfig,
  ts,
  isEntrypoint,
} from './runner.js';
import type { BenchTask } from './types.js';

const BENCH_NAME = 'MLAgentBench';
const TASK_TIMEOUT_MS = 20 * 60_000; // ML training can take a while on CPU

function benchmarksDir(benchDir: string): string {
  // Repo nests the package: <bench-dir>/MLAgentBench/benchmarks/<task>
  return join(benchDir, 'MLAgentBench', 'benchmarks');
}

interface LoadedTask {
  task: BenchTask;
  envDir: string; // pristine source env for this task
}

function loadTasks(benchDir: string, taskFilter?: string): LoadedTask[] {
  const tasksRoot = benchmarksDir(benchDir);
  if (!existsSync(tasksRoot)) {
    throw new Error(
      `benchmarks/ not found at ${tasksRoot}\n` +
        `Clone: git clone https://github.com/snap-stanford/MLAgentBench ${benchDir}`,
    );
  }

  const taskDirs = readdirSync(tasksRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const loaded: LoadedTask[] = [];
  for (const name of taskDirs) {
    if (taskFilter && name !== taskFilter) continue;

    const taskDir = join(tasksRoot, name);
    const envDir = join(taskDir, 'env');
    const scriptsDir = join(taskDir, 'scripts');
    if (!existsSync(envDir)) continue; // not a runnable task dir

    const problem = readText(join(scriptsDir, 'research_problem.txt'));
    const descriptor = readText(join(envDir, 'task_descriptor.txt'));
    const readOnly = readText(join(scriptsDir, 'read_only_files.txt'));
    const envFiles = safeList(envDir);

    // Prompt is filled in per-run once the work dir exists (needs its absolute
    // path). Store the raw pieces on meta and build the final prompt in setup.
    loaded.push({
      envDir,
      task: {
        id: name,
        prompt: '', // set in prepareRun()
        expected: '0', // overridden by --baseline; 0 = smoke (any real metric passes)
        meta: {
          problem,
          descriptor,
          readOnly,
          envFiles,
          task_dir: taskDir,
        },
      },
    });
  }
  return loaded;
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8').trim() : '';
  } catch {
    return '';
  }
}

function safeList(dir: string): string {
  try {
    return readdirSync(dir).slice(0, 20).join(', ');
  } catch {
    return '';
  }
}

/**
 * Copy the pristine env/ into an isolated work dir and build the task prompt with
 * that absolute path baked in. Returns the work dir (the shell cwd for this run).
 */
function prepareRun(lt: LoadedTask, workRoot: string): string {
  const workDir = join(workRoot, lt.task.id);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  cpSync(lt.envDir, workDir, { recursive: true });

  const m = lt.task.meta as Record<string, string>;
  lt.task.prompt =
    `You are running the MLAgentBench "${lt.task.id}" task.\n\n` +
    `Working directory (all files are here; use these absolute paths):\n  ${workDir}\n\n` +
    (m.problem ? `Research problem:\n${m.problem}\n\n` : '') +
    (m.descriptor ? `Task details:\n${m.descriptor}\n\n` : '') +
    (m.envFiles ? `Files in the working directory: ${m.envFiles}\n` : '') +
    (m.readOnly ? `Read-only files (do not modify): ${m.readOnly}\n` : '') +
    `\nInstructions:\n` +
    `1. Read ${join(workDir, 'train.py')} with read_file to understand the baseline.\n` +
    `2. Run it first with run_shell ("python train.py") to get the baseline metric.\n` +
    `3. Improve the script with edit_file (better model, hyperparameters, features),\n` +
    `   then re-run it. Keep epochs small to stay within the time budget.\n` +
    `4. When you have your best result, call submit_answer with the final metric\n` +
    `   printed by the script (a bare number, e.g. "62.34" or "0.6234").`;
  return workDir;
}

/**
 * Smoke scorer: with no --baseline (expected "0"), pass = the agent reported a
 * valid, positive numeric metric (i.e. it actually ran the task and read a result).
 * With a --baseline, pass = final metric >= baseline (beat the reference).
 */
function makeScorer(baseline: number | null) {
  return (predicted: string | null, expected: string): boolean => {
    if (predicted === null) return false;
    const p = Number(predicted.trim().replace(/,/g, '').replace(/%$/, ''));
    if (!isFinite(p)) return false;
    const floor = baseline ?? Number(expected);
    if (!isFinite(floor) || floor <= 0) return p > 0; // smoke: any real metric
    return p >= floor * 0.99; // 1% slack
  };
}

const SYSTEM_PROMPT =
  'You are an ML experimentation agent running MLAgentBench tasks. ' +
  'You are given a training script and must improve it to maximize a validation metric. ' +
  'Use read_file to inspect code, edit_file to modify it, and run_shell to execute training runs ' +
  '(run_shell already runs inside the task working directory, so "python train.py" works directly). ' +
  'Read the metric from the script output. When done, call submit_answer with the final metric ' +
  'as a bare number. Keep training epochs modest so runs finish within the time budget.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['ML_AGENT_BENCH_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write(
      'Usage: tsx src/adapters/ml-agent-bench.ts --bench-dir <path> [--task cifar10]\n' +
        '       or set ML_AGENT_BENCH_DIR environment variable\n',
    );
    process.exit(1);
  }

  let loaded = loadTasks(benchDir, args['task']);
  if (args['limit']) loaded = loaded.slice(0, Number(args['limit']));
  if (loaded.length === 0) {
    process.stderr.write(
      `No tasks matched${args['task'] ? ` "${args['task']}"` : ''} under ${benchmarksDir(benchDir)}\n`,
    );
    process.exit(1);
  }

  const baseline = args['baseline'] != null ? Number(args['baseline']) : null;
  const scorer = makeScorer(baseline);
  const workRoot = resolve('benchmarks', 'work', 'mlagentbench');
  mkdirSync(workRoot, { recursive: true });

  process.stdout.write(`${BENCH_NAME}: ${loaded.length} task(s)\n`);

  const { model, config } = await loadModelAndConfig(args);
  const runId = ts();
  const outputPath =
    args['output'] ?? join('benchmarks', 'results', `ml-agent-bench-${runId}.jsonl`);

  const results = [];
  for (const lt of loaded) {
    const workDir = prepareRun(lt, workRoot);
    if (baseline != null) lt.task.expected = String(baseline);
    process.stdout.write(`  ${lt.task.id} … (work: ${workDir})\n`);
    const result = await runTask({
      task: lt.task,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
      scorer,
      timeoutMs: TASK_TIMEOUT_MS,
      workDir,
      shellTimeoutMs: TASK_TIMEOUT_MS,
    });
    results.push(result);
    process.stdout.write(
      result.passed
        ? `    ✓  metric=${result.predicted ?? '?'}  (${(result.durationMs / 1000).toFixed(0)}s, ${result.toolCalls} tool calls)\n`
        : `    ✗  metric=${result.predicted ?? 'null'}  (${(result.durationMs / 1000).toFixed(0)}s, ${result.toolCalls} tool calls)${result.error ? ` — ${result.error}` : ''}\n`,
    );
  }

  const summary = buildRunSummary(results, { runId, benchmark: BENCH_NAME, model, config });
  writeResults(summary, outputPath);
  printSummary(summary);
  process.stdout.write(`\nResults: ${outputPath}\n`);
}

if (isEntrypoint(import.meta.url)) {
  void main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
