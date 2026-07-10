/**
 * DABStep adapter (Adyen + Hugging Face) — https://huggingface.co/blog/dabstep
 * Multi-step data-analysis agent benchmark: answer questions over a shared set of
 * payments datasets (CSV/JSON) + documentation, using code.
 *
 * Data is openly available on HF (adyen/DABstep). No clone needed — this adapter
 * downloads the shared context files and pulls tasks over HTTP.
 *
 * Usage:
 *   npx tsx src/adapters/dabstep.ts --split dev --model qwen3:8b
 *   npm run bench:dabstep -- --split dev --limit 5
 *
 * Flags:
 *   --split       dev (10 tasks, WITH answers → scored)  |  default (450 tasks,
 *                 answers held out → writes a leaderboard submission). Default: dev.
 *   --level       easy | hard  (filter)
 *   --limit       Max tasks to run
 *   --task-id     Run a single task by id
 *   --model       Model id (e.g. qwen3:8b)  [default: from config]
 *   --backend     ollama | vllm | llama_cpp | mlx | hf
 *   --base-url    Backend base URL
 *   --output      Output JSONL path
 *
 * Scoring: the dev split ships gold answers; guidelines pin the exact format
 * ("just a number rounded to 2 decimals", "just the country code", …), so the
 * scorer is exact-match after light normalization + a tight numeric tolerance.
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
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

const BENCH_NAME = 'DABStep';
const REPO = 'adyen/DABstep';
const RESOLVE_BASE = `https://huggingface.co/datasets/${REPO}/resolve/main/data/context`;
const ROWS_API = 'https://datasets-server.huggingface.co/rows';
const TASK_TIMEOUT_MS = 10 * 60_000;

// The 7 shared context files every task analyzes.
const CONTEXT_FILES = [
  'acquirer_countries.csv',
  'fees.json',
  'manual.md',
  'merchant_category_codes.csv',
  'merchant_data.json',
  'payments-readme.md',
  'payments.csv',
];

interface DabTask {
  task_id: string;
  question: string;
  answer: string;
  guidelines: string;
  level: string;
}

// ── Data access (HTTP, no Python) ───────────────────────────────────────────

/** Download the shared context files into `dir` (skips ones already present). */
async function ensureContext(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const name of CONTEXT_FILES) {
    const dest = join(dir, name);
    if (existsSync(dest) && statSync(dest).size > 0) continue;
    process.stdout.write(`  downloading context/${name} … `);
    const res = await fetch(`${RESOLVE_BASE}/${name}`); // trusted HF host; follows redirects
    if (!res.ok) throw new Error(`failed to download ${name}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    process.stdout.write(`${(buf.length / 1024).toFixed(0)} KB\n`);
  }
}

/** Pull tasks for a split via the HF datasets-server rows API (paginated). */
async function fetchTasks(split: string, max?: number): Promise<DabTask[]> {
  const out: DabTask[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${ROWS_API}?dataset=${encodeURIComponent(REPO)}&config=tasks&split=${split}&offset=${offset}&length=${pageSize}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`datasets-server HTTP ${res.status} for split "${split}"`);
    const data = (await res.json()) as { rows?: { row: DabTask }[]; num_rows_total?: number };
    const rows = data.rows ?? [];
    for (const r of rows) out.push(r.row);
    const total = data.num_rows_total ?? out.length;
    if (out.length >= total || rows.length === 0) break;
    if (max && out.length >= max) break;
  }
  return out;
}

// ── Prompt + scorer ─────────────────────────────────────────────────────────

function buildPrompt(task: DabTask, contextDir: string): string {
  return (
    `You are answering a DABStep data-analysis question about a payments dataset.\n\n` +
    `Question: ${task.question}\n\n` +
    `Answer guidelines (follow EXACTLY): ${task.guidelines}\n\n` +
    `The data is in your working directory (${contextDir}):\n` +
    `  payments.csv            — the transactions table (main data)\n` +
    `  payments-readme.md      — column definitions for payments.csv\n` +
    `  fees.json               — fee rules\n` +
    `  merchant_data.json      — per-merchant info\n` +
    `  merchant_category_codes.csv, acquirer_countries.csv — lookups\n` +
    `  manual.md               — domain manual (fee logic, definitions) — READ THIS for hard questions\n\n` +
    `Instructions:\n` +
    `1. read_file the manual.md and payments-readme.md first to understand the schema and rules.\n` +
    `2. Write and run Python (pandas) with run_shell to compute the answer, e.g.\n` +
    `   run_shell("python -c \\"import pandas as pd; df=pd.read_csv('payments.csv'); ...\\"").\n` +
    `3. Call submit_answer with ONLY the value in the exact format the guidelines require ` +
    `(no explanation, no units unless asked).`
  );
}

const NOT_APPLICABLE = /^(not\s*applicable|n\/?a|none)$/i;

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[,$%\s]/g, '')
    .replace(/\.$/, '');
}

/** DABStep scorer: normalized exact match, tight numeric tolerance, or set match. */
export function dabstepScorer(predicted: string | null, expected: string): boolean {
  if (predicted === null) return false;
  const e = expected.trim();
  if (!e) return false; // held-out (test) answers can't be scored locally
  const p = predicted.trim();

  // "Not Applicable" family.
  if (NOT_APPLICABLE.test(p) && NOT_APPLICABLE.test(e)) return true;

  if (normalize(p) === normalize(e)) return true;

  // Numeric: DABStep answers are precise (often 2 decimals) → tight tolerance.
  // Guard on an actual digit so non-numeric strings don't collapse to Number("")===0.
  if (/\d/.test(p) && /\d/.test(e)) {
    const pn = Number(p.replace(/[^0-9.eE+-]/g, ''));
    const en = Number(e.replace(/[^0-9.eE+-]/g, ''));
    if (isFinite(pn) && isFinite(en)) {
      return Math.abs(pn - en) <= Math.max(0.01, Math.abs(en) * 0.001);
    }
  }

  // Comma/semicolon list → compare as normalized sets.
  const toSet = (s: string) =>
    new Set(
      s
        .split(/[;,]/)
        .map((x) => normalize(x))
        .filter(Boolean),
    );
  const ps = toSet(p);
  const es = toSet(e);
  if (es.size > 1 && ps.size === es.size) {
    return [...es].every((x) => ps.has(x));
  }
  return false;
}

const SYSTEM_PROMPT =
  'You are a data-analysis agent solving DABStep tasks over a payments dataset. ' +
  'Use read_file to read the CSVs/JSON and the domain manual, and run_shell to run Python ' +
  '(pandas is available; run_shell already runs in the data directory). Reason step by step ' +
  'across multiple queries when needed. When you have the answer, call submit_answer with ONLY ' +
  'the value in the exact format the guidelines require — no prose, no units unless requested.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const split = args['split'] === 'default' ? 'default' : 'dev';
  const contextDir = resolve(
    args['context-dir'] ?? join('benchmarks', 'data', 'dabstep', 'context'),
  );

  process.stdout.write(`${BENCH_NAME}: preparing context in ${contextDir}\n`);
  await ensureContext(contextDir);

  let tasks = await fetchTasks(split, args['limit'] ? Number(args['limit']) : undefined);
  if (args['level']) tasks = tasks.filter((t) => t.level === args['level']);
  if (args['task-id']) tasks = tasks.filter((t) => t.task_id === args['task-id']);
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  const scored = split === 'dev'; // dev ships gold answers
  process.stdout.write(
    `${BENCH_NAME}: ${tasks.length} task(s) [split=${split}, ${scored ? 'scored' : 'submission'}]\n`,
  );

  const { model, config } = await loadModelAndConfig(args);
  const runId = ts();
  const outputPath =
    args['output'] ?? join('benchmarks', 'results', `dabstep-${split}-${runId}.jsonl`);

  const results = [];
  const submission: { task_id: string; answer: string }[] = [];
  for (const t of tasks) {
    const bench: BenchTask = {
      id: t.task_id,
      prompt: buildPrompt(t, contextDir),
      expected: t.answer ?? '',
      difficulty: t.level,
    };
    process.stdout.write(`  [${t.level}] task ${t.task_id} … `);
    const result = await runTask({
      task: bench,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
      scorer: dabstepScorer,
      timeoutMs: TASK_TIMEOUT_MS,
      workDir: contextDir,
      shellTimeoutMs: TASK_TIMEOUT_MS,
    });
    results.push(result);
    submission.push({ task_id: t.task_id, answer: result.predicted ?? '' });
    if (scored) {
      process.stdout.write(
        result.passed
          ? `✓  "${result.predicted}"  (${(result.durationMs / 1000).toFixed(0)}s)\n`
          : `✗  got "${result.predicted ?? 'null'}" want "${t.answer}"  (${(result.durationMs / 1000).toFixed(0)}s)\n`,
      );
    } else {
      process.stdout.write(
        `answered "${result.predicted ?? 'null'}"  (${(result.durationMs / 1000).toFixed(0)}s)\n`,
      );
    }
  }

  const summary = buildRunSummary(results, { runId, benchmark: BENCH_NAME, model, config });
  writeResults(summary, outputPath);
  if (scored) {
    printSummary(summary);
  } else {
    const subPath = outputPath.replace(/\.jsonl$/, '.submission.jsonl');
    writeFileSync(subPath, submission.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf-8');
    process.stdout.write(
      `\nSubmission written: ${subPath}\n(default split answers are held out; submit to the DABStep leaderboard to score)\n`,
    );
  }
  process.stdout.write(`\nResults: ${outputPath}\n`);
}

if (isEntrypoint(import.meta.url)) {
  void main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
