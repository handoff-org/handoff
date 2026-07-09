/**
 * ScienceAgentBench adapter (arXiv:2410.05080)
 * Data-driven science tasks: write Python to answer a scientific question from a dataset.
 * https://github.com/OSU-NLP-Group/ScienceAgentBench
 *
 * Usage:
 *   npx tsx src/adapters/science-agent-bench.ts --bench-dir ~/code/science-agent-bench
 *   SCIENCE_AGENT_BENCH_DIR=~/code/science-agent-bench npm run bench:science-agent
 *
 * Flags:
 *   --bench-dir   Path to cloned repo (or $SCIENCE_AGENT_BENCH_DIR)
 *   --domain      bioinformatics | chemistry | gis | psychology  (default: all)
 *   --limit       Max tasks to run
 *   --task-id     Run a single task by instance_id
 *   --output      Output JSONL path
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

const BENCH_NAME = 'ScienceAgentBench';

// ── Task format ───────────────────────────────────────────────────────────────
// Tasks at: <bench-dir>/benchmark/data/<instance_id>.json  (one file per task)
// Datasets at: <bench-dir>/benchmark/datasets/<domain>/<instance_id>/
// Each task JSON:
//   instance_id          string
//   instructions         string — what the Python program should compute
//   dataset_folder_tree  string — directory listing of the dataset
//   dataset_preview      object — first few rows of key files
//   expected_output      string — expected result (file, value, or description)
//   domain               string — "Bioinformatics" | "Computational Chemistry" | "GIS" | "Psychology"
//   paper_name           string

interface SciAgentTask {
  instance_id: string;
  instructions: string;
  dataset_folder_tree?: string;
  dataset_preview?: Record<string, string>;
  expected_output?: string;
  domain?: string;
  paper_name?: string;
}

function loadTasks(benchDir: string, domain?: string): BenchTask[] {
  const dataDir = join(benchDir, 'benchmark', 'data');
  if (!existsSync(dataDir)) {
    throw new Error(
      `benchmark/data/ not found at ${dataDir}\n` +
        `Clone: git clone https://github.com/OSU-NLP-Group/ScienceAgentBench ~/code/science-agent-bench`,
    );
  }

  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  const tasks: BenchTask[] = [];
  for (const file of files) {
    let raw: SciAgentTask;
    try {
      raw = JSON.parse(readFileSync(join(dataDir, file), 'utf-8')) as SciAgentTask;
    } catch {
      continue;
    }
    if (domain && raw.domain?.toLowerCase() !== domain.toLowerCase()) continue;

    const datasetDir = join(benchDir, 'benchmark', 'datasets', raw.domain ?? '', raw.instance_id);
    const preview = buildDatasetPreview(raw, datasetDir);

    const prompt =
      `You are completing a ScienceAgentBench task.\n\n` +
      `Domain: ${raw.domain ?? 'unknown'}\n` +
      (raw.paper_name ? `Paper: ${raw.paper_name}\n` : '') +
      `Dataset directory: ${datasetDir}\n\n` +
      (raw.dataset_folder_tree ? `Dataset structure:\n${raw.dataset_folder_tree}\n\n` : '') +
      preview +
      `Task instructions:\n${raw.instructions}\n\n` +
      `Instructions:\n` +
      `1. Read and explore the dataset files.\n` +
      `2. Write Python code (write_file → save to ${datasetDir}/solution.py) and run it with run_shell.\n` +
      `3. Call submit_answer with your result (the value, file path, or output as specified).`;

    tasks.push({
      id: raw.instance_id,
      prompt,
      expected: raw.expected_output ?? '',
      domain: raw.domain,
      meta: { paper_name: raw.paper_name },
    });
  }
  return tasks;
}

function buildDatasetPreview(raw: SciAgentTask, datasetDir: string): string {
  if (raw.dataset_preview && Object.keys(raw.dataset_preview).length) {
    const lines = Object.entries(raw.dataset_preview)
      .slice(0, 3)
      .map(([f, preview]) => `  ${f}:\n${preview
        .split('\n')
        .slice(0, 5)
        .map((l) => `    ${l}`)
        .join('\n')}`)
      .join('\n');
    return `Dataset preview:\n${lines}\n\n`;
  }
  if (existsSync(datasetDir)) {
    try {
      const entries = readdirSync(datasetDir).slice(0, 10).join(', ');
      return `Dataset files: ${entries}\n\n`;
    } catch {
      return '';
    }
  }
  return '';
}

const SYSTEM_PROMPT =
  'You are a scientific programming agent running ScienceAgentBench tasks. ' +
  'For each task you will be given a scientific dataset and asked to write Python code to answer ' +
  'a research question. Use read_file to inspect data, write_file to save Python scripts, ' +
  'and run_shell to execute them. When you have the final result, call submit_answer. ' +
  'Write clean, reproducible code. Report numeric results with full precision.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['SCIENCE_AGENT_BENCH_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write(
      'Usage: tsx src/adapters/science-agent-bench.ts --bench-dir <path>\n' +
        '       or set SCIENCE_AGENT_BENCH_DIR environment variable\n',
    );
    process.exit(1);
  }

  let tasks = loadTasks(benchDir, args['domain']);
  if (args['task-id']) tasks = tasks.filter((t) => t.id === args['task-id']);
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  process.stdout.write(`${BENCH_NAME}: ${tasks.length} task(s)\n`);

  const { model, config } = await loadModelAndConfig();
  const runId = ts();
  const outputPath =
    args['output'] ?? join('benchmarks', 'results', `science-agent-bench-${runId}.jsonl`);

  const results = [];
  for (const task of tasks) {
    process.stdout.write(`  [${task.domain ?? '?'}] ${task.id} … `);
    const result = await runTask({ task, benchmarkName: BENCH_NAME, model, systemPrompt: SYSTEM_PROMPT });
    results.push(result);
    process.stdout.write(
      result.passed
        ? `✓  (${result.durationMs}ms)\n`
        : `✗  predicted="${result.predicted ?? 'null'}"  (${result.durationMs}ms)\n`,
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
