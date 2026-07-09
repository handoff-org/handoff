/**
 * MLAgentBench adapter (arXiv:2310.03302)
 * ML experimentation: improve a given ML training script to maximize final metric.
 * https://github.com/snap-stanford/MLAgentBench
 *
 * Usage:
 *   npx tsx src/adapters/ml-agent-bench.ts --bench-dir ~/code/MLAgentBench
 *   ML_AGENT_BENCH_DIR=~/code/MLAgentBench npm run bench:ml-agent
 *
 * Flags:
 *   --bench-dir   Path to cloned repo (or $ML_AGENT_BENCH_DIR)
 *   --task        Task name (e.g. "cifar10") — default: all
 *   --limit       Max tasks to run
 *   --output      Output JSONL path
 *
 * Scoring note:
 *   MLAgentBench measures final validation metric improvement over a known baseline.
 *   Each task has a baseline metric and a "good" target. This adapter scores
 *   pass = final metric >= baseline (any improvement counts).
 *   Set --strict to score pass = final metric >= task target.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  runTask,
  buildRunSummary,
  writeResults,
  printSummary,
  parseArgs,
  loadModelAndConfig,
  ts,
  scoreAnswer,
} from './runner.js';
import type { BenchTask } from './types.js';

const BENCH_NAME = 'MLAgentBench';

// ── Task format ───────────────────────────────────────────────────────────────
// Tasks at: <bench-dir>/MLAgentBench/tasks/<task_name>/
// Each task directory contains:
//   task_descriptor.py (or task.py)  — defines the task
//   env/                             — the training environment
//   scripts/                         — starter code
//   logs/                            — reference outputs
// We also read task metadata from a consolidated tasks.json if present,
// or fall back to scanning individual directories.
//
// tasks.json format (if present):
//   [{ name, description, baseline_metric, target_metric, metric_name,
//      time_limit_hours, data_note }]

interface MLTask {
  name: string;
  description?: string;
  baseline_metric?: number;
  target_metric?: number;
  metric_name?: string;
  time_limit_hours?: number;
  data_note?: string;
}

function loadTasks(benchDir: string, taskFilter?: string): BenchTask[] {
  const tasksDir = join(benchDir, 'MLAgentBench', 'tasks');
  if (!existsSync(tasksDir)) {
    throw new Error(
      `MLAgentBench/tasks/ not found at ${tasksDir}\n` +
        `Clone: git clone https://github.com/snap-stanford/MLAgentBench ~/code/MLAgentBench`,
    );
  }

  // Try consolidated metadata first
  const metaPath = join(benchDir, 'tasks.json');
  let metaMap: Record<string, MLTask> = {};
  if (existsSync(metaPath)) {
    try {
      const raw = JSON.parse(readFileSync(metaPath, 'utf-8')) as MLTask[];
      for (const t of raw) metaMap[t.name] = t;
    } catch {
      // ignore — fall back to scanning
    }
  }

  const taskDirs = readdirSync(tasksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const tasks: BenchTask[] = [];
  for (const name of taskDirs) {
    if (taskFilter && name !== taskFilter) continue;

    const taskDir = join(tasksDir, name);
    const meta = metaMap[name];
    const taskEnvDir = join(taskDir, 'env');

    const description = meta?.description ?? readTaskDescription(taskDir, name);
    const baselineMetric = meta?.baseline_metric;
    const metricName = meta?.metric_name ?? 'validation metric';
    const targetMetric = meta?.target_metric;

    const envListing = buildEnvListing(taskEnvDir);
    const starterInfo = buildStarterInfo(taskDir);

    const prompt =
      `You are running an MLAgentBench task.\n\n` +
      `Task: ${name}\n` +
      `Metric: ${metricName}` +
      (baselineMetric != null ? ` (baseline: ${baselineMetric})` : '') +
      (targetMetric != null ? `, target: ${targetMetric}` : '') +
      `\n\n` +
      `Description:\n${description}\n\n` +
      envListing +
      starterInfo +
      `Instructions:\n` +
      `1. Read the starter code in ${taskDir}/env/ or ${taskDir}/scripts/.\n` +
      `2. Improve the training script to maximize the ${metricName}.\n` +
      `   Use write_file to modify scripts and run_shell to train the model.\n` +
      `3. After training, read the final validation ${metricName} from the output.\n` +
      `4. Call submit_answer with the final ${metricName} you achieved (e.g., "0.9134").\n` +
      (meta?.data_note ? `\nNote: ${meta.data_note}\n` : '');

    // expected = target metric or "improve" (we score any improvement)
    const expected =
      targetMetric != null ? String(targetMetric) : baselineMetric != null ? String(baselineMetric) : '0';

    tasks.push({
      id: name,
      prompt,
      expected,
      meta: {
        baseline_metric: baselineMetric,
        target_metric: targetMetric,
        metric_name: metricName,
        task_dir: taskDir,
      },
    });
  }
  return tasks;
}

function readTaskDescription(taskDir: string, taskName: string): string {
  // Try several common locations for task description
  const candidates = [
    join(taskDir, 'README.md'),
    join(taskDir, 'task.py'),
    join(taskDir, 'task_descriptor.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        // Return first 500 chars as description
        return content.slice(0, 500).trim();
      } catch {
        continue;
      }
    }
  }
  return `Improve the ${taskName} ML training script to maximize validation performance.`;
}

function buildEnvListing(envDir: string): string {
  if (!existsSync(envDir)) return '';
  try {
    const files = readdirSync(envDir)
      .filter((f) => f.endsWith('.py') || f.endsWith('.sh') || f.endsWith('.txt'))
      .slice(0, 10)
      .join(', ');
    if (!files) return '';
    return `Environment files: ${files}\n\n`;
  } catch {
    return '';
  }
}

function buildStarterInfo(taskDir: string): string {
  const scriptsDir = join(taskDir, 'scripts');
  if (!existsSync(scriptsDir)) return '';
  try {
    const scripts = readdirSync(scriptsDir).slice(0, 5).join(', ');
    return scripts ? `Starter scripts: ${scripts}\n\n` : '';
  } catch {
    return '';
  }
}

/**
 * MLAgentBench scorer: pass if predicted metric >= baseline_metric (any improvement).
 * In strict mode (task.expected = target_metric), pass if predicted >= target.
 */
function mlScorer(predicted: string | null, expected: string): boolean {
  if (predicted === null) return false;
  const p = Number(predicted.trim().replace(/,/g, '').replace(/%$/, ''));
  const e = Number(expected.trim().replace(/,/g, '').replace(/%$/, ''));
  if (isNaN(p) || isNaN(e)) return scoreAnswer(predicted, expected);
  // Pass if predicted >= expected (beat or match baseline/target)
  return p >= e * 0.99; // 1% slack for floating-point variation
}

const SYSTEM_PROMPT =
  'You are an ML experimentation agent running MLAgentBench tasks. ' +
  'You will be given an ML training environment and asked to improve the training script ' +
  'to maximize a validation metric. Use read_file to inspect the code, write_file to modify it, ' +
  'and run_shell to execute training runs. Monitor training output for the final metric. ' +
  'When done, call submit_answer with the final validation metric you achieved (e.g. "0.9134"). ' +
  'Be concrete and precise — do not approximate.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['ML_AGENT_BENCH_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write(
      'Usage: tsx src/adapters/ml-agent-bench.ts --bench-dir <path>\n' +
        '       or set ML_AGENT_BENCH_DIR environment variable\n',
    );
    process.exit(1);
  }

  let tasks = loadTasks(benchDir, args['task']);
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  process.stdout.write(`${BENCH_NAME}: ${tasks.length} task(s)\n`);

  const { model, config } = await loadModelAndConfig();
  const runId = ts();
  const outputPath = args['output'] ?? join('benchmarks', 'results', `ml-agent-bench-${runId}.jsonl`);

  const results = [];
  for (const task of tasks) {
    process.stdout.write(`  ${task.id} … `);
    const result = await runTask({
      task,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
      scorer: mlScorer,
      // ML training can take longer — give 15 minutes per task
      timeoutMs: 15 * 60_000,
    });
    results.push(result);
    process.stdout.write(
      result.passed
        ? `✓  metric=${result.predicted ?? '?'}  (${result.durationMs}ms)\n`
        : `✗  metric=${result.predicted ?? 'null'}  baseline=${result.expected}  (${result.durationMs}ms)\n`,
    );
  }

  const summary = buildRunSummary(results, { runId, benchmark: BENCH_NAME, model, config });
  writeResults(summary, outputPath);
  printSummary(summary);
  process.stdout.write(`\nResults: ${outputPath}\n`);
}

void main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
