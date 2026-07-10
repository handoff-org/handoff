/**
 * CORE-Bench adapter (arXiv:2409.11363) — computational reproducibility.
 * https://github.com/siegelz/core-bench
 *
 * The agent is given a research paper's Code Ocean capsule (code + data) and a
 * task prompt describing what to run, then must report specific numeric results.
 *
 * Data: <bench-dir>/benchmark/dataset/core_train.json ships in the clear (45
 * capsules with gold answers). The test set (core_test.json) is GPG-encrypted
 * (password "reproducibility") — decrypt it and pass --dataset test to use it.
 * Capsule code/data is NOT in the repo; this adapter auto-downloads each capsule
 * tarball from corebench.cs.princeton.edu and extracts it with `tar`.
 *
 * ⚠ Faithful reproduction generally needs the capsule's environment. The official
 * harness runs each capsule in Docker; on the bare host, `run_shell` may hit
 * missing dependencies. Use a machine with the deps (or Docker) for real scores.
 *
 * Usage:
 *   npx tsx src/adapters/core-bench.ts --bench-dir ~/Desktop/benchmarks/core-bench --limit 1
 *   CORE_BENCH_DIR=~/Desktop/benchmarks/core-bench npm run bench:core -- --limit 1
 *
 * Flags:
 *   --bench-dir   Path to the cloned core-bench repo (or $CORE_BENCH_DIR)
 *   --dataset     train (default) | test   (test requires decrypting the .gpg)
 *   --field       Filter by field (e.g. "Computer Science")
 *   --capsule     Run only a given capsule_id
 *   --task-id     Run a single task by id (capsule_id#qN)
 *   --limit       Max tasks to run
 *   --no-download Skip capsule download (assume already staged under --capsule-dir)
 *   --capsule-dir Where capsules are downloaded/extracted (default: benchmarks/work/core-bench)
 *   --model / --backend / --base-url   Model overrides
 *   --output      Output JSONL path
 */

import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
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
import type { BenchTask, TaskResult } from './types.js';

const BENCH_NAME = 'CORE-Bench';
const CAPSULE_BASE = 'https://corebench.cs.princeton.edu/capsules';
const TASK_TIMEOUT_MS = 20 * 60_000;

// ── Real train/test schema ──────────────────────────────────────────────────
// { field, language, capsule_title, capsule_id, task_prompt, results, capsule_doi }
// results: list of per-run dicts, each { "<question>": <value> }. Values vary
// slightly across runs (reproducibility variance) → aggregate per question.
interface CoreCapsule {
  field: string;
  language: string;
  capsule_title: string;
  capsule_id: string;
  task_prompt: string;
  results: Record<string, unknown>[];
  capsule_doi?: string;
}

/** Mean of numeric values, or the first value stringified when non-numeric. */
function aggregateAnswer(values: unknown[]): string {
  const nums = values.map((v) => Number(v)).filter((n) => isFinite(n));
  if (nums.length === values.length && nums.length > 0) {
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return String(Number(mean.toFixed(6))); // trim trailing zeros
  }
  return String(values[0] ?? '');
}

function loadTasks(
  benchDir: string,
  dataset: string,
): { tasks: BenchTask[]; capsules: Map<string, CoreCapsule> } {
  const file = dataset === 'test' ? 'core_test.json' : 'core_train.json';
  const path = join(benchDir, 'benchmark', 'dataset', file);
  if (!existsSync(path)) {
    const hint =
      dataset === 'test'
        ? `Decrypt it first: gpg --output ${path} --decrypt ${path}.gpg  (password: reproducibility)`
        : `Clone: git clone https://github.com/siegelz/core-bench ${benchDir}`;
    throw new Error(`${file} not found at ${path}\n${hint}`);
  }
  const raw: CoreCapsule[] = JSON.parse(readFileSync(path, 'utf-8'));

  const tasks: BenchTask[] = [];
  const capsules = new Map<string, CoreCapsule>();
  for (const cap of raw) {
    capsules.set(cap.capsule_id, cap);
    // Collect values per distinct question across the results runs.
    const byQuestion = new Map<string, unknown[]>();
    for (const run of cap.results ?? []) {
      for (const [q, v] of Object.entries(run)) {
        if (!byQuestion.has(q)) byQuestion.set(q, []);
        byQuestion.get(q)!.push(v);
      }
    }
    let qIdx = 0;
    for (const [question, values] of byQuestion) {
      qIdx++;
      tasks.push({
        id: `${cap.capsule_id}#q${qIdx}`,
        prompt: '', // built per-run once the capsule dir exists
        expected: aggregateAnswer(values),
        domain: cap.field,
        meta: { capsule_id: cap.capsule_id, question, language: cap.language, doi: cap.capsule_doi },
      });
    }
  }
  return { tasks, capsules };
}

// ── Capsule staging ─────────────────────────────────────────────────────────

/** Download + extract a capsule tarball into workRoot/<capsule_id>/. Returns the dir. */
function stageCapsule(capsuleId: string, workRoot: string, allowDownload: boolean): string {
  const dir = join(workRoot, capsuleId);
  const tarName = `${capsuleId}.tar.gz`;
  // Staged if the dir has extracted content beyond the tarball itself.
  if (existsSync(dir) && readdirSync(dir).some((n) => n !== tarName)) return dir;
  if (!allowDownload) {
    throw new Error(`capsule ${capsuleId} not staged in ${dir} and --no-download is set`);
  }
  mkdirSync(dir, { recursive: true });
  const tarPath = join(dir, tarName);
  if (!existsSync(tarPath)) {
    process.stdout.write(`    downloading ${tarName} … `);
    execFileSync('curl', ['-fsSL', '-o', tarPath, `${CAPSULE_BASE}/${tarName}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    process.stdout.write('done\n');
  }
  process.stdout.write('    extracting … ');
  execFileSync('tar', ['xzf', tarPath, '-C', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  process.stdout.write('done\n');
  return dir;
}

function buildPrompt(task: BenchTask, capsule: CoreCapsule, capsuleDir: string): string {
  let files = '(unreadable)';
  try {
    files = readdirSync(capsuleDir).slice(0, 25).join(', ');
  } catch {
    /* keep default */
  }
  const question = String((task.meta as Record<string, unknown>)?.['question'] ?? '');
  return (
    `You are reproducing a result from a research paper's Code Ocean capsule.\n\n` +
    `Paper: ${capsule.capsule_title}  [${capsule.field}, ${capsule.language}]\n` +
    `Capsule directory (your working directory): ${capsuleDir}\n` +
    `Contents: ${files}\n\n` +
    `Task: ${capsule.task_prompt}\n\n` +
    `Question to answer: ${question}\n\n` +
    `Instructions:\n` +
    `1. Explore the capsule (list_dir/read_file). Code is usually under code/; data under data/.\n` +
    `2. Run the code with run_shell (it runs in the capsule dir). Install missing dependencies ` +
    `if needed. ${capsule.language === 'R' ? 'This capsule uses R.' : ''}\n` +
    `3. Read the produced result and call submit_answer with the precise numeric value ` +
    `(e.g. "0.892", not "~89%").`
  );
}

const SYSTEM_PROMPT =
  'You are a computational-reproducibility agent running CORE-Bench tasks. You are given a ' +
  'research paper capsule (code + data) and must run it to answer a specific question about its ' +
  'results. Use list_dir/read_file to explore, run_shell to execute code (it runs in the capsule ' +
  'directory; install dependencies as needed), and submit_answer for the precise value. Answers ' +
  'are usually numbers from a table — do not approximate or hedge.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['CORE_BENCH_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write('Usage: tsx src/adapters/core-bench.ts --bench-dir <path>  (or $CORE_BENCH_DIR)\n');
    process.exit(1);
  }
  const dataset = args['dataset'] === 'test' ? 'test' : 'train';
  const workRoot = resolve(args['capsule-dir'] ?? join('benchmarks', 'work', 'core-bench'));
  const allowDownload = args['no-download'] == null;
  mkdirSync(workRoot, { recursive: true });

  const { tasks: allTasks, capsules } = loadTasks(benchDir, dataset);
  let tasks = allTasks;
  if (args['field']) tasks = tasks.filter((t) => t.domain === args['field']);
  if (args['capsule'])
    tasks = tasks.filter((t) => (t.meta as Record<string, unknown>)['capsule_id'] === args['capsule']);
  if (args['task-id']) tasks = tasks.filter((t) => t.id === args['task-id']);
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  process.stdout.write(`${BENCH_NAME}: ${tasks.length} task(s) [dataset=${dataset}]\n`);
  process.stdout.write('⚠ capsule reproduction may need the capsule environment (Docker/deps).\n');

  const { model, config } = await loadModelAndConfig(args);
  const runId = ts();
  const outputPath = args['output'] ?? join('benchmarks', 'results', `core-bench-${dataset}-${runId}.jsonl`);

  const results: TaskResult[] = [];
  for (const task of tasks) {
    const capsuleId = String((task.meta as Record<string, unknown>)['capsule_id']);
    const capsule = capsules.get(capsuleId)!;
    process.stdout.write(`  ${task.id} [${task.domain}] …\n`);
    let capsuleDir: string;
    try {
      capsuleDir = stageCapsule(capsuleId, workRoot, allowDownload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`    ✗ staging failed: ${msg}\n`);
      results.push({
        taskId: task.id,
        benchmark: BENCH_NAME,
        ...(task.domain ? { domain: task.domain } : {}),
        passed: false,
        predicted: null,
        expected: task.expected,
        turns: 0,
        toolCalls: 0,
        durationMs: 0,
        error: `capsule staging failed: ${msg}`,
      });
      continue;
    }
    task.prompt = buildPrompt(task, capsule, capsuleDir);
    const result = await runTask({
      task,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: TASK_TIMEOUT_MS,
      workDir: capsuleDir,
      shellTimeoutMs: TASK_TIMEOUT_MS,
    });
    results.push(result);
    process.stdout.write(
      result.passed
        ? `    ✓  "${result.predicted}"  (${(result.durationMs / 1000).toFixed(0)}s)\n`
        : `    ✗  got "${result.predicted ?? 'null'}" want "${task.expected}"  (${(result.durationMs / 1000).toFixed(0)}s)${result.error ? ` — ${result.error}` : ''}\n`,
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
