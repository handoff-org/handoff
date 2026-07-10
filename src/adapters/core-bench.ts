/**
 * CORE-Bench adapter (arXiv:2409.11363)
 * Computational reproducibility of research papers.
 * https://github.com/siegelz/core-bench
 *
 * Usage:
 *   npx tsx src/adapters/core-bench.ts --bench-dir ~/code/core-bench
 *   CORE_BENCH_DIR=~/code/core-bench npm run bench:core
 *
 * Flags:
 *   --bench-dir   Path to the cloned core-bench repo (or $CORE_BENCH_DIR)
 *   --difficulty  easy | medium | hard  (default: all)
 *   --limit       Max tasks to run
 *   --task-id     Run a single task by id
 *   --output      Output JSONL path (default: benchmarks/results/core-bench-<ts>.jsonl)
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
} from './runner.js';
import type { BenchTask } from './types.js';

const BENCH_NAME = 'CORE-Bench';

// ── Task format ───────────────────────────────────────────────────────────────
// Expected at: <bench-dir>/benchmark/tasks.json
// Each entry:
//   capsule_id        string — directory under <bench-dir>/capsules/
//   task_id           string
//   question          string — what to answer about the paper's results
//   expected_answer   string — ground truth (usually a number from a table)
//   task_difficulty   "easy" | "medium" | "hard"

interface CoreTask {
  task_id: string;
  capsule_id: string;
  question: string;
  expected_answer: string;
  task_difficulty?: 'easy' | 'medium' | 'hard';
  paper_title?: string;
}

function loadTasks(benchDir: string, difficulty?: string): BenchTask[] {
  const tasksPath = join(benchDir, 'benchmark', 'tasks.json');
  if (!existsSync(tasksPath)) {
    throw new Error(
      `tasks.json not found at ${tasksPath}\n` +
        `Clone the repo: git clone https://github.com/siegelz/core-bench ~/code/core-bench`,
    );
  }
  const raw: CoreTask[] = JSON.parse(readFileSync(tasksPath, 'utf-8'));
  const filtered = difficulty ? raw.filter((t) => t.task_difficulty === difficulty) : raw;

  return filtered.map((t) => {
    const capsuleDir = join(benchDir, 'capsules', t.capsule_id);
    const capsuleContext = buildCapsuleContext(capsuleDir, t.capsule_id);
    const prompt =
      `You are evaluating the computational reproducibility of a research paper.\n\n` +
      (t.paper_title ? `Paper: ${t.paper_title}\n\n` : '') +
      `Capsule directory: ${capsuleDir}\n\n` +
      capsuleContext +
      `\nTask: ${t.question}\n\n` +
      `Instructions:\n` +
      `1. Read the capsule code and data using read_file and list_dir.\n` +
      `2. Run the code with run_shell if needed (working directory: ${capsuleDir}).\n` +
      `3. Find the answer in the output or results files.\n` +
      `4. Call submit_answer with the precise numeric or string value (e.g., "0.892", not "~89%").`;
    return {
      id: t.task_id,
      prompt,
      expected: t.expected_answer,
      difficulty: t.task_difficulty,
      meta: { capsule_id: t.capsule_id, paper_title: t.paper_title },
    };
  });
}

function buildCapsuleContext(capsuleDir: string, capsuleId: string): string {
  if (!existsSync(capsuleDir)) {
    return `(Capsule directory not yet downloaded: ${capsuleId})\n`;
  }
  try {
    const entries = readdirSync(capsuleDir, { withFileTypes: true })
      .slice(0, 20)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join('\n  ');
    return `Capsule contents:\n  ${entries}\n`;
  } catch {
    return '';
  }
}

const SYSTEM_PROMPT =
  'You are a scientific reproducibility agent running CORE-Bench tasks. ' +
  'For each task you will be given a research paper capsule (code + data) and asked a specific ' +
  'question about its computational results. Use read_file to inspect files, run_shell to execute ' +
  'code, and submit_answer to record your answer. Be precise — answers are usually numbers ' +
  'from a table (e.g., "0.892") or specific strings. Do not approximate or hedge.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['CORE_BENCH_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write(
      'Usage: tsx src/adapters/core-bench.ts --bench-dir <path>\n' +
        '       or set CORE_BENCH_DIR environment variable\n',
    );
    process.exit(1);
  }

  let tasks = loadTasks(benchDir, args['difficulty']);
  if (args['task-id']) tasks = tasks.filter((t) => t.id === args['task-id']);
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  process.stdout.write(`${BENCH_NAME}: ${tasks.length} task(s)\n`);

  const { model, config } = await loadModelAndConfig(args);
  const runId = ts();
  const outputPath = args['output'] ?? join('benchmarks', 'results', `core-bench-${runId}.jsonl`);

  const results = [];
  for (const task of tasks) {
    process.stdout.write(`  [${task.difficulty ?? '?'}] ${task.id} … `);
    const result = await runTask({
      task,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
    });
    results.push(result);
    process.stdout.write(
      result.passed ? `✓  (${result.durationMs}ms)\n` : `✗  predicted="${result.predicted ?? 'null'}"  expected="${result.expected}"  (${result.durationMs}ms)\n`,
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
