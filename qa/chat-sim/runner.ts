import { spawnSync } from 'child_process';
import { mkdirSync, rmSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { allScenarios, smokeScenarios, scenarioById, fuzzScenario } from './scenarios.js';
import { writeReports } from './summarize.js';
import type { Scenario } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CHILD = join(HERE, 'runScenario.ts');
const LOG_DIR = join(REPO_ROOT, 'qa', 'logs');
const TMP_ROOT = join(REPO_ROOT, 'tmp', 'qa-home');
const PER_SCENARIO_TIMEOUT_MS = 60_000;

interface Flags {
  mode: 'all' | 'smoke' | 'scenario' | 'fuzz';
  scenarioId?: string;
  seed: number;
  iterations: number;
  keepTemp: boolean;
  realModel: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { mode: 'all', seed: 1, iterations: 50, keepTemp: false, realModel: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') flags.mode = 'all';
    else if (a === '--smoke') flags.mode = 'smoke';
    else if (a === '--random' || a === '--fuzz') flags.mode = 'fuzz';
    else if (a === '--scenario') {
      flags.mode = 'scenario';
      flags.scenarioId = argv[++i];
    } else if (a === '--seed') flags.seed = Number(argv[++i]);
    else if (a === '--iterations') flags.iterations = Number(argv[++i]);
    else if (a === '--keep-temp') flags.keepTemp = true;
    else if (a === '--real-model') flags.realModel = true;
  }
  return flags;
}

function selectScenarios(flags: Flags): Scenario[] {
  if (flags.mode === 'smoke') return smokeScenarios();
  if (flags.mode === 'fuzz') return [fuzzScenario(flags.iterations)];
  if (flags.mode === 'scenario') {
    const id = flags.scenarioId ?? '';
    if (id === 'fuzz' || id === 'random') return [fuzzScenario(flags.iterations)];
    const s = scenarioById(id);
    if (!s) {
      process.stderr.write(
        `Unknown scenario "${id}". Available: ${allScenarios()
          .map((x) => x.id)
          .join(', ')}, fuzz\n`,
      );
      process.exit(2);
    }
    return [s];
  }
  return allScenarios();
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.realModel) {
    process.stderr.write(
      'note: --real-model is not wired into the default harness; running with the mock model.\n',
    );
  }
  const scenarios = selectScenarios(flags);
  const runId = ts();
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `chat-sim-${runId}.jsonl`);
  // Ensure the file exists even if a child never writes.
  appendFileSync(logPath, '', 'utf-8');

  process.stdout.write(`\nQA chat simulation — run ${runId}\n`);
  process.stdout.write(`Scenarios: ${scenarios.map((s) => s.id).join(', ')}\n`);
  process.stdout.write(`Seed: ${flags.seed}  ·  log: ${logPath}\n\n`);

  let anyFailed = false;
  for (const scenario of scenarios) {
    const home = join(TMP_ROOT, scenario.id);
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });

    // Build a clean child env: isolated HOME + scenario params, with any
    // HANDOFF_*/HF_TOKEN overrides stripped so the developer's shell can't
    // perturb the deterministic config the harness writes.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      QA_SCENARIO_ID: scenario.id,
      QA_SEED: String(flags.seed),
      QA_LOG_PATH: logPath,
      QA_RUN_ID: runId,
      QA_ITERATIONS: String(flags.iterations),
    };
    for (const k of Object.keys(childEnv)) if (k.startsWith('HANDOFF_')) delete childEnv[k];
    delete childEnv['HF_TOKEN'];

    const res = spawnSync(process.execPath, ['--import', 'tsx', CHILD], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: PER_SCENARIO_TIMEOUT_MS,
      env: childEnv,
    });

    // Parse the child's final stdout line for its outcome.
    const lastLine = (res.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
    let outcome: { passed?: boolean; crashed?: boolean } = {};
    try {
      outcome = JSON.parse(lastLine);
    } catch {
      /* child died before printing */
    }

    const timedOut =
      (res.signal === 'SIGTERM' && res.error?.message?.includes('ETIMEDOUT')) ||
      res.signal === 'SIGTERM';
    const hardCrash = res.status !== 0 || res.error != null;

    if (hardCrash && outcome.passed === undefined) {
      // The child crashed before it could log anything — synthesize an event so
      // the summary sees it.
      const stderrTail = (res.stderr ?? '').split('\n').slice(-8).join(' ').slice(0, 1500);
      appendFileSync(
        logPath,
        JSON.stringify({
          runId,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          timestamp: new Date().toISOString(),
          seq: 0,
          kind: 'error',
          error: {
            name: 'child_crash',
            message: `child exited status=${res.status} signal=${res.signal}: ${stderrTail}`,
          },
        }) + '\n',
        'utf-8',
      );
    }

    const passed = outcome.passed === true && !outcome.crashed;
    if (!passed) anyFailed = true;
    const mark = passed ? '✓' : timedOut ? '⏱' : '✗';
    process.stdout.write(`  ${mark} ${scenario.id}\n`);

    if (!flags.keepTemp) rmSync(home, { recursive: true, force: true });
  }

  const summary = writeReports(logPath, runId);
  process.stdout.write(`\nSummary: ${summary.passed}/${summary.totalScenarios} passed`);
  if (summary.failed) process.stdout.write(`  ·  ${summary.failed} failed`);
  process.stdout.write('\n');
  if (Object.keys(summary.errorsByCategory).length) {
    process.stdout.write(`Failures by category: ${JSON.stringify(summary.errorsByCategory)}\n`);
  }
  const base = logPath.replace(/\.jsonl$/, '');
  process.stdout.write(`Reports:\n  ${base}.summary.json\n  ${base}.failures.md\n`);
  if (existsSync(TMP_ROOT) && !flags.keepTemp) rmSync(TMP_ROOT, { recursive: true, force: true });

  process.exit(anyFailed ? 1 : 0);
}

void main();
