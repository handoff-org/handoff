import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenarios, filterScenarios, EVALS_ROOT, type Filter } from './runners/load.js';
import { runScenarioInstance } from './runners/engine.js';
import { expandAll } from './generators/generate.js';
import { makeRunMeta, environmentInfo, gitCommit, newRunId } from './reporters/env.js';
import {
  writeRun,
  aggregate,
  terminalSummary,
  issueBlocks,
  type Aggregate,
} from './reporters/report.js';
import { toBaseline, loadBaseline, compareRuns, compareMarkdown } from './reporters/compare.js';
import { coverageMarkdown } from './reporters/coverage.js';
import type { Scenario, ScenarioResult } from './schema/types.js';
import type { ChatModel } from '../src/agent/model.js';

const REPORTS = join(EVALS_ROOT, 'reports');
const BASELINES = join(EVALS_ROOT, 'baselines');

/**
 * Resolve a real local model for --live runs. Loads the user's config, creates the
 * backend model, and pings it. Returns null (→ scenarios reported as SKIPPED, never
 * failed) when the backend is unreachable, so missing Ollama/GPU is never confused
 * with a model-quality failure. Uses the deterministic MOCK tool registry, so only
 * the MODEL is live — tool results stay controlled.
 */
async function makeLiveModel(
  modelOverride?: string,
): Promise<{ model: ChatModel; modelId: string } | null> {
  try {
    const { loadConfig } = await import('../config/schema.js');
    const { createModel } = await import('../src/agent/model.js');
    const config = await loadConfig();
    if (modelOverride) config.modelId = modelOverride;
    if (config.backend === 'ollama') {
      const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      }).catch(() => null);
      if (!res || !res.ok) return null;
      // If we can read the installed models, verify the requested one is present
      // so a typo/missing model is a clear SKIP rather than a cryptic per-run error.
      try {
        const tags = (await res.json()) as { models?: { name: string }[] };
        const names = (tags.models ?? []).map((m) => m.name);
        if (
          names.length &&
          !names.some((n) => n === config.modelId || n.startsWith(config.modelId))
        ) {
          process.stderr.write(
            `model "${config.modelId}" not installed in Ollama (have: ${names.join(', ')}).\n`,
          );
          return null;
        }
      } catch {
        /* couldn't parse tags; proceed and let the run surface any error */
      }
    }
    return { model: createModel(config), modelId: `${config.backend}:${config.modelId}` };
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    }
  }
  return out;
}

function filterFromArgs(a: Record<string, string | boolean>): Filter {
  return {
    id: a['id'] as string | undefined,
    category: a['category'] as string | undefined,
    tag: a['tag'] as string | undefined,
    difficulty: a['difficulty'] as string | undefined,
    layer: a['layer'] as string | undefined,
  };
}

async function runSuite(
  scenarios: Scenario[],
  suite: string,
  args: Record<string, string | boolean>,
): Promise<{ results: ScenarioResult[]; runDir: string }> {
  const repeatOverride = args['repeat'] ? Number(args['repeat']) : undefined;
  const results: ScenarioResult[] = [];
  const failFast = !!args['fail-fast'];

  // Live model resolution (only when --live is passed).
  let live: { model: ChatModel; modelId: string } | null = null;
  let liveUnavailable = false;
  if (args['live']) {
    live = await makeLiveModel(args['model'] as string | undefined);
    if (!live) {
      liveUnavailable = true;
      process.stderr.write(
        'live model unavailable (backend unreachable) — scenarios will be SKIPPED, not failed.\n',
      );
    }
  }
  const modelLabel =
    live?.modelId ?? (args['live'] ? 'live:unavailable' : (args['model'] as string) || 'mock:eval');

  for (const s of scenarios) {
    const repeats = repeatOverride ?? s.repeat ?? 1;
    for (let i = 0; i < repeats; i++) {
      let r: ScenarioResult;
      if (liveUnavailable) {
        r = skippedResult(s, i, 'live model backend unreachable');
      } else {
        r = await runScenarioInstance(s, { repeatIndex: i, model: live?.model });
      }
      results.push(r);
      if (args['verbose']) {
        process.stdout.write(
          `${r.passed ? '✓' : '✗'} ${r.scenarioId}${repeats > 1 ? `#${i}` : ''} ${r.passed ? '' : '(' + r.severity + ')'}\n`,
        );
      }
      if (failFast && !r.passed) break;
    }
    if (failFast && results.some((r) => !r.passed)) break;
  }
  const meta = makeRunMeta(suite, modelLabel, filterFromArgs(args));
  const runDir = writeRun(REPORTS, meta, environmentInfo(), results);
  const agg = aggregate(results);
  process.stdout.write('\n' + terminalSummary(meta, agg) + '\n');
  const issues = issueBlocks(results);
  if (issues) process.stdout.write('\nIssue-ready (high/critical):\n' + issues + '\n');
  process.stdout.write(`\nReport: ${runDir}\n`);
  return { results, runDir };
}

function loadAll(): Scenario[] {
  const { scenarios, issues } = loadScenarios();
  if (issues.length) {
    process.stderr.write(
      'Scenario issues:\n' +
        issues.map((i) => `  ${i.file} ${i.scenarioId ?? ''} — ${i.message}`).join('\n') +
        '\n',
    );
  }
  return scenarios;
}

/** Negative "detector" scenarios (scripted bad behavior) are tagged `selftest`.
 *  They prove the scorers fire and drive the failure/report/replay demo, but are
 *  excluded from the health suites (smoke/core/extended) so those measure a
 *  healthy harness. They remain runnable by --id / --category. */
function healthSuite(scenarios: Scenario[]): Scenario[] {
  return scenarios.filter((s) => !(s.tags ?? []).includes('selftest'));
}

/** A clearly-marked skipped result (distinct from pass and fail). */
function skippedResult(s: Scenario, repeatIndex: number, reason: string): ScenarioResult {
  return {
    scenarioId: s.id,
    scenarioVersion: s.version,
    seed: s.seed ?? 0,
    layer: s.layer,
    category: s.category,
    difficulty: s.difficulty,
    repeatIndex,
    passed: false,
    skipped: true,
    skipReason: reason,
    assertions: [],
    hardGateFailed: false,
    severity: null,
    taxonomy: [],
    finalAnswer: '',
    transcript: [],
    toolTrace: [],
    artifacts: [],
    timings: { wallMs: 0, timeToFirstTokenMs: null },
    tokens: { prompt: 0, output: 0 },
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (cmd) {
    case 'validate': {
      const { scenarios, issues } = loadScenarios();
      process.stdout.write(`Validated ${scenarios.length} scenarios; ${issues.length} issue(s).\n`);
      for (const i of issues)
        process.stdout.write(`  ${i.file} ${i.scenarioId ?? ''} — ${i.message}\n`);
      process.exit(issues.length ? 1 : 0);
      break;
    }
    case 'list': {
      const s = filterScenarios(loadAll(), filterFromArgs(args));
      for (const sc of s)
        process.stdout.write(
          `${sc.id}  [${sc.layer}/${sc.category}/${sc.difficulty}]  ${sc.title}\n`,
        );
      process.stdout.write(`\n${s.length} scenario(s).\n`);
      break;
    }
    case 'smoke': {
      const s = filterScenarios(healthSuite(loadAll()), { category: 'smoke' });
      await runSuite(s, 'smoke', args);
      break;
    }
    case 'core': {
      await runSuite(healthSuite(loadAll()), 'core', args);
      break;
    }
    case 'extended': {
      const canonical = healthSuite(loadAll());
      const all = expandAll(canonical, Number(args['target'] ?? 150));
      await runSuite(all, 'extended', args);
      break;
    }
    case 'stress': {
      const s = filterScenarios(loadAll(), { category: 'stress' });
      if (!s.length) process.stdout.write('No stress scenarios authored yet (see COVERAGE.md).\n');
      await runSuite(s, 'stress', args);
      break;
    }
    case 'scenario': {
      const s = filterScenarios(loadAll(), { id: args['id'] as string });
      if (!s.length) {
        process.stderr.write(`No scenario with id ${args['id']}\n`);
        process.exit(1);
      }
      if (args['seed']) s[0]!.seed = Number(args['seed']);
      await runSuite(s, `scenario:${args['id']}`, args);
      break;
    }
    case 'category': {
      const s = filterScenarios(loadAll(), { category: args['category'] as string });
      await runSuite(s, `category:${args['category']}`, args);
      break;
    }
    case 'replay': {
      const id = (args['id'] as string) || '';
      const s = filterScenarios(loadAll(), { id });
      if (!s.length) {
        process.stderr.write(`Provide --id <scenarioId> [--seed N] to replay.\n`);
        process.exit(1);
      }
      if (args['seed']) s[0]!.seed = Number(args['seed']);
      const r = await runScenarioInstance(s[0]!, { keepSandbox: true });
      process.stdout.write(replayView(r));
      break;
    }
    case 'report': {
      const runId = args['run'] as string;
      const p = join(REPORTS, runId, 'summary.json');
      if (!existsSync(p)) {
        process.stderr.write(`No run at ${p}\n`);
        process.exit(1);
      }
      process.stdout.write(readFileSync(join(REPORTS, runId, 'summary.md'), 'utf8'));
      break;
    }
    case 'compare': {
      const baselineArg = args['baseline'] as string;
      const candidate = args['candidate'] as string;
      const baselinePath = existsSync(baselineArg)
        ? baselineArg
        : join(BASELINES, `${baselineArg}.json`);
      if (!existsSync(baselinePath)) {
        process.stderr.write(`No baseline at ${baselinePath}\n`);
        process.exit(1);
      }
      const base = loadBaseline(baselinePath);
      const candPath = join(REPORTS, candidate, 'results.jsonl');
      const results = readFileSync(candPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as ScenarioResult);
      const cmp = compareRuns(base, results);
      const md = compareMarkdown(base, cmp);
      const outDir = join(REPORTS, candidate, 'comparison');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `vs-${base.name}.md`), md);
      process.stdout.write(md + `\nWritten: ${join(outDir, `vs-${base.name}.md`)}\n`);
      break;
    }
    case 'baseline': {
      const runId = args['run'] as string;
      const name = (args['name'] as string) || 'default';
      const force = !!args['force'];
      const candPath = join(REPORTS, runId, 'results.jsonl');
      if (!existsSync(candPath)) {
        process.stderr.write(`No run at ${candPath}\n`);
        process.exit(1);
      }
      mkdirSync(BASELINES, { recursive: true });
      const dest = join(BASELINES, `${name}.json`);
      if (existsSync(dest) && !force) {
        process.stderr.write(
          `Baseline "${name}" exists. Re-run with --force to overwrite (baselines are never overwritten implicitly).\n`,
        );
        process.exit(1);
      }
      const results = readFileSync(candPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as ScenarioResult);
      const meta = JSON.parse(readFileSync(join(REPORTS, runId, 'config.json'), 'utf8'));
      const baseline = toBaseline(
        name,
        runId,
        meta.commit ?? gitCommit(),
        meta.model ?? 'mock:eval',
        results,
      );
      writeFileSync(dest, JSON.stringify(baseline, null, 2));
      process.stdout.write(`Promoted run ${runId} to baseline "${name}" → ${dest}\n`);
      break;
    }
    case 'coverage': {
      const canonical = loadAll();
      const generated = expandAll(canonical, 150).length - canonical.length;
      const md = coverageMarkdown(canonical, generated);
      writeFileSync(join(EVALS_ROOT, 'COVERAGE.md'), md);
      process.stdout.write(`Wrote ${join(EVALS_ROOT, 'COVERAGE.md')}\n`);
      break;
    }
    case 'model': {
      // Run the (filtered) canonical suite against ONE real model.
      const scenarios = filterScenarios(healthSuite(loadAll()), filterFromArgs(args));
      await runSuite(scenarios, `model:${args['model'] ?? 'default'}`, { ...args, live: true });
      break;
    }
    case 'matrix': {
      // Run the same (filtered) suite against several real models and compare.
      const models = String(args['models'] ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      if (!models.length) {
        process.stderr.write('Provide --models a,b,c (comma-separated installed model names).\n');
        process.exit(1);
      }
      const scenarios = filterScenarios(healthSuite(loadAll()), filterFromArgs(args));
      const perModel: { model: string; agg: Aggregate; runDir: string }[] = [];
      for (const m of models) {
        process.stdout.write(`\n===== model: ${m} =====\n`);
        const { results, runDir } = await runSuite(scenarios, `matrix:${m}`, {
          ...args,
          model: m,
          live: true,
        });
        perModel.push({ model: m, agg: aggregate(results), runDir });
      }
      const md = matrixMarkdown(perModel);
      const dir = join(REPORTS, `matrix-${newRunId()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'matrix.md'), md);
      process.stdout.write('\n' + md + `\nMatrix report: ${join(dir, 'matrix.md')}\n`);
      break;
    }
    default:
      process.stdout.write(
        `Handoff eval CLI. Commands:\n` +
          `  validate | list | smoke | core | extended | stress | coverage\n` +
          `  scenario --id ID [--seed N] | category --category C | replay --id ID [--seed N]\n` +
          `  model --model NAME [--category C]           run one real model (add nothing else; implies --live)\n` +
          `  matrix --models A,B,C [--category C]         run several real models and compare\n` +
          `  report --run RUNID | compare --baseline NAME --candidate RUNID | baseline --run RUNID [--name N] [--force]\n` +
          `Flags: --id --category --tag --difficulty --layer --seed --repeat --model --live --verbose --fail-fast\n`,
      );
  }
}

function matrixMarkdown(perModel: { model: string; agg: Aggregate; runDir: string }[]): string {
  const cats = [...new Set(perModel.flatMap((p) => Object.keys(p.agg.byCategory)))].sort();
  const head = `| capability | ${perModel.map((p) => p.model).join(' | ')} |`;
  const sep = `|---|${perModel.map(() => '---').join('|')}|`;
  const rows = cats.map((c) => {
    const cells = perModel.map((p) => {
      const v = p.agg.byCategory[c];
      return v ? `${v.passed}/${v.total}` : '—';
    });
    return `| ${c} | ${cells.join(' | ')} |`;
  });
  const pct = (p: { agg: Aggregate }) => `${Math.round(p.agg.passRate * 100)}%`;
  const overall = `| **overall** | ${perModel.map((p) => `**${pct(p)}** (${p.agg.passed}/${p.agg.total})`).join(' | ')} |`;
  const gate = `| hard-gate fails | ${perModel.map((p) => p.agg.hardGateFailures).join(' | ')} |`;
  const lat = `| p95 latency ms | ${perModel.map((p) => p.agg.latency.p95).join(' | ')} |`;
  return [
    `# Model matrix`,
    '',
    `Models: ${perModel.map((p) => p.model).join(', ')}`,
    '',
    head,
    sep,
    ...rows,
    overall,
    gate,
    lat,
    '',
    ...perModel.map((p) => `- ${p.model}: ${p.runDir}`),
    '',
  ].join('\n');
}

function replayView(r: ScenarioResult): string {
  const lines: string[] = [];
  lines.push(`\n=== Replay ${r.scenarioId} (seed ${r.seed}) ===`);
  lines.push(
    `Result: ${r.passed ? 'PASS' : 'FAIL'}  severity=${r.severity ?? '-'}  fingerprint=${r.fingerprint ?? '-'}`,
  );
  lines.push(`\n1. Messages sent (roles): ${r.transcript.map((t) => t.role).join(' → ')}`);
  lines.push(`\n2. Tool calls:`);
  for (const t of r.toolTrace)
    lines.push(
      `   - ${t.name}(${t.args.slice(0, 80)}) → ${t.ok ? 'ok' : 'ERROR'}${t.network ? ' [network]' : ''}`,
    );
  if (!r.toolTrace.length) lines.push('   (none)');
  lines.push(`\n3. Final answer:\n${(r.finalAnswer || '(empty)').slice(0, 800)}`);
  lines.push(`\n4. Assertions:`);
  for (const a of r.assertions)
    lines.push(
      `   [${a.passed ? 'PASS' : 'FAIL'}] ${a.type} (${a.severity}${a.hardGate ? ', hard-gate' : ''}) — ${a.detail}`,
    );
  lines.push(
    `\n5. Timing: wall ${Math.round(r.timings.wallMs)}ms, ttft ${r.timings.timeToFirstTokenMs == null ? 'n/a' : Math.round(r.timings.timeToFirstTokenMs) + 'ms'}`,
  );
  lines.push(`\n6. Taxonomy: ${r.taxonomy.join(', ') || 'none'}\n`);
  return lines.join('\n');
}

main().catch((e) => {
  process.stderr.write(`eval CLI error: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
