/**
 * SciCode adapter (arXiv:2407.13168)
 * Scientific sub-problem solving: natural-science research questions decomposed into
 * step-by-step Python coding subproblems.
 * https://github.com/scicode-bench/scicode
 *
 * Usage:
 *   npx tsx src/adapters/scicode.ts --bench-dir ~/code/scicode
 *   SCICODE_DIR=~/code/scicode npm run bench:scicode
 *
 * Flags:
 *   --bench-dir   Path to cloned repo (or $SCICODE_DIR)
 *   --topic       physics | math | chemistry | biology | materials  (default: all)
 *   --limit       Max subproblems to run
 *   --problem-id  Run all subproblems of a single problem (e.g. "23")
 *   --output      Output JSONL path
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  runTask,
  scoreAnswer,
  buildRunSummary,
  writeResults,
  printSummary,
  parseArgs,
  loadModelAndConfig,
  ts,
} from './runner.js';
import type { BenchTask } from './types.js';

const BENCH_NAME = 'SciCode';

// ── Task format ───────────────────────────────────────────────────────────────
// Problems at: <bench-dir>/data/problems/
//   Each problem is a .json file (named by problem id, e.g. "1.json")
// Fields:
//   problem_id          number | string
//   problem_name        string
//   topic               string
//   sub_steps           SubStep[]
//   background          string
//   dependencies        string[]  — helper code already provided
//
// SubStep:
//   step_number         number
//   step_description    string
//   function_name       string
//   expected_output     string | null
//   expected_output_alt string | null  — alternative acceptable answer
//   test_cases          TestCase[]
//
// TestCase:
//   input               unknown
//   expected_output     unknown

interface SciCodeSubStep {
  step_number: number;
  step_description: string;
  function_name: string;
  expected_output?: string | null;
  expected_output_alt?: string | null;
  test_cases?: { input: unknown; expected_output: unknown }[];
}

interface SciCodeProblem {
  problem_id: string | number;
  problem_name: string;
  topic?: string;
  background?: string;
  sub_steps: SciCodeSubStep[];
  dependencies?: string[];
}

function stepId(problemId: string | number, stepNum: number): string {
  return `${problemId}.${stepNum}`;
}

function loadTasks(benchDir: string, topic?: string): BenchTask[] {
  const problemsDir = join(benchDir, 'data', 'problems');
  if (!existsSync(problemsDir)) {
    throw new Error(
      `data/problems/ not found at ${problemsDir}\n` +
        `Clone: git clone https://github.com/scicode-bench/scicode ~/code/scicode`,
    );
  }

  const files = readdirSync(problemsDir).filter((f) => f.endsWith('.json'));
  const tasks: BenchTask[] = [];

  for (const file of files) {
    let prob: SciCodeProblem;
    try {
      prob = JSON.parse(readFileSync(join(problemsDir, file), 'utf-8')) as SciCodeProblem;
    } catch {
      continue;
    }
    if (topic && prob.topic?.toLowerCase() !== topic.toLowerCase()) continue;

    const background = prob.background?.trim() ?? '';
    const depCode = (prob.dependencies ?? []).join('\n');

    for (const step of prob.sub_steps) {
      const expected = String(step.expected_output ?? step.expected_output_alt ?? '').trim();

      // Build test cases hint (first 2 only, to keep prompt short)
      const testHint = (step.test_cases ?? [])
        .slice(0, 2)
        .map((tc, i) => `  Test ${i + 1}: input=${JSON.stringify(tc.input)}, expected=${JSON.stringify(tc.expected_output)}`)
        .join('\n');

      const prompt =
        `You are solving a SciCode subproblem (scientific research programming).\n\n` +
        `Problem: ${prob.problem_name}  [${prob.topic ?? 'science'}]\n` +
        `Subproblem ${step.step_number}: ${step.step_description}\n\n` +
        (background ? `Background:\n${background}\n\n` : '') +
        (depCode ? `Provided helper code:\n\`\`\`python\n${depCode}\n\`\`\`\n\n` : '') +
        `Function to implement: \`${step.function_name}\`\n` +
        (testHint ? `Sample test cases:\n${testHint}\n\n` : '') +
        `Instructions:\n` +
        `1. Write the Python function \`${step.function_name}\`.\n` +
        `2. Use write_file to save the code and run_shell to test it.\n` +
        `3. Call submit_answer with the function's output for the first test case ` +
        `(or the computed value if no test cases are given).`;

      tasks.push({
        id: stepId(prob.problem_id, step.step_number),
        prompt,
        expected,
        domain: prob.topic,
        meta: {
          problem_id: prob.problem_id,
          step_number: step.step_number,
          function_name: step.function_name,
          expected_output_alt: step.expected_output_alt,
        },
      });
    }
  }
  return tasks;
}

/** SciCode has exact or alt expected outputs; accept either. */
function sciCodeScorer(predicted: string | null, expected: string): boolean {
  return scoreAnswer(predicted, expected);
}

const SYSTEM_PROMPT =
  'You are a scientific programming agent solving SciCode subproblems. ' +
  'You will be given a science research programming task and must implement the specified Python function. ' +
  'Use write_file to save your implementation and run_shell to test it. ' +
  'When you have the function working and know the output, call submit_answer with the computed value. ' +
  'Be precise — answers are scientific quantities; report them with full numeric precision.';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchDir = resolve(args['bench-dir'] ?? process.env['SCICODE_DIR'] ?? '');
  if (!benchDir) {
    process.stderr.write(
      'Usage: tsx src/adapters/scicode.ts --bench-dir <path>\n' +
        '       or set SCICODE_DIR environment variable\n',
    );
    process.exit(1);
  }

  let tasks = loadTasks(benchDir, args['topic']);
  if (args['problem-id']) {
    tasks = tasks.filter((t) => String((t.meta?.['problem_id'] as unknown) ?? '') === args['problem-id']);
  }
  if (args['limit']) tasks = tasks.slice(0, Number(args['limit']));

  process.stdout.write(`${BENCH_NAME}: ${tasks.length} subproblem(s)\n`);

  const { model, config } = await loadModelAndConfig();
  const runId = ts();
  const outputPath = args['output'] ?? join('benchmarks', 'results', `scicode-${runId}.jsonl`);

  const results = [];
  for (const task of tasks) {
    process.stdout.write(`  [${task.domain ?? '?'}] ${task.id} … `);
    const result = await runTask({
      task,
      benchmarkName: BENCH_NAME,
      model,
      systemPrompt: SYSTEM_PROMPT,
    });
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
