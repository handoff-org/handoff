import { homedir } from 'os';
import { QaLogger } from './logger.js';
import { runScenario } from './harness.js';
import { scenarioById, fuzzScenario } from './scenarios.js';

// Child entry point: runs exactly ONE scenario inside an already-isolated HOME
// (the parent sets process.env.HOME before spawning). Everything it logs goes to
// the shared run JSONL passed via env. It prints a single-line JSON outcome on
// stdout for the parent to aggregate, and turns uncaught errors into logged
// failures rather than silent crashes.

const scenarioId = process.env['QA_SCENARIO_ID'] ?? '';
const seed = Number(process.env['QA_SEED'] ?? '1');
const logPath = process.env['QA_LOG_PATH'] ?? '';
const runId = process.env['QA_RUN_ID'] ?? 'run';
const iterations = Number(process.env['QA_ITERATIONS'] ?? '8');

const scenario = scenarioId === 'fuzz' ? fuzzScenario(iterations) : scenarioById(scenarioId);

if (!scenario || !logPath) {
  process.stderr.write(`qa child: unknown scenario "${scenarioId}" or missing log path\n`);
  process.exit(2);
}

const logger = new QaLogger(logPath, runId, scenario.id, scenario.name);

// A crash anywhere is exactly what we want to catch — record it, then exit
// non-zero so the parent flags the scenario.
let crashed = false;
function recordCrash(kind: string, err: unknown): void {
  crashed = true;
  logger.error({
    name: kind,
    message: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  });
}
process.on('uncaughtException', (err) => recordCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => recordCrash('unhandledRejection', err));

async function main(): Promise<void> {
  const outcome = await runScenario(scenario!, { seed, homeDir: homedir() }, logger);
  // Emit the machine-readable outcome as the final stdout line.
  process.stdout.write(JSON.stringify({ ...outcome, crashed }) + '\n');
  process.exit(crashed || !outcome.passed ? 1 : 0);
}

main().catch((err) => {
  recordCrash('harness_error', err);
  process.stdout.write(
    JSON.stringify({
      scenarioId: scenario!.id,
      passed: false,
      failures: 1,
      warnings: 0,
      errors: 1,
      timeouts: 0,
      crashed: true,
    }) + '\n',
  );
  process.exit(1);
});
