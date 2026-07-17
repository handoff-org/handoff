import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenarios } from '../evals/runners/load.js';
import { runScenarioInstance } from '../evals/runners/engine.js';
import { scoreAssertion, type ScoreContext } from '../evals/scorers/index.js';
import { fingerprint } from '../evals/scorers/taxonomy.js';
import { expandScenario, expandAll } from '../evals/generators/generate.js';
import { Rng } from '../evals/generators/prng.js';
import { writeRun } from '../evals/reporters/report.js';
import type { Scenario, ScenarioResult, ToolTraceEntry } from '../evals/schema/types.js';

const baseCtx = (over: Partial<ScoreContext>): ScoreContext => ({
  scenario: { groundTruth: {} } as Scenario,
  finalAnswer: '',
  transcript: [],
  toolTrace: [],
  sandboxDir: '/tmp/nonexistent',
  ...over,
});

// ── loader + schema validation ────────────────────────────────────────────────

test('evals: canonical library loads with zero integrity issues', () => {
  const { scenarios, issues } = loadScenarios();
  assert.ok(scenarios.length >= 20, `expected >=20 canonical scenarios, got ${scenarios.length}`);
  assert.deepEqual(issues, [], `unexpected issues: ${JSON.stringify(issues)}`);
});

test('evals: schema validator rejects a malformed scenario', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-schema-'));
  writeFileSync(join(dir, 'bad.yaml'), 'id: not-a-valid-id\nversion: 1\n'); // missing required fields, bad id
  const { scenarios, issues } = loadScenarios([dir]);
  assert.equal(scenarios.length, 0);
  assert.ok(
    issues.some((i) => i.message.startsWith('schema:')),
    'should report a schema issue',
  );
  rmSync(dir, { recursive: true, force: true });
});

test('evals: duplicate scenario ids are detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-dup-'));
  const body = (n: string) =>
    `id: DUP-TEST-001\nversion: 1\ntitle: ${n}\nlayer: direct\ncategory: smoke\ndifficulty: easy\nturns:\n  - user: hi\nexpected:\n  assertions:\n    - type: contains\n      value: x\n`;
  writeFileSync(join(dir, 'a.yaml'), body('Alpha copy'));
  writeFileSync(join(dir, 'b.yaml'), body('Beta copy'));
  const { issues } = loadScenarios([dir]);
  assert.ok(issues.some((i) => i.message.includes('duplicate scenario id')));
  rmSync(dir, { recursive: true, force: true });
});

// ── seeded determinism ────────────────────────────────────────────────────────

test('evals: PRNG is deterministic per seed', () => {
  const a = new Rng(123);
  const b = new Rng(123);
  const seqA = Array.from({ length: 5 }, () => a.int(0, 1000));
  const seqB = Array.from({ length: 5 }, () => b.int(0, 1000));
  assert.deepEqual(seqA, seqB);
  const c = new Rng(124);
  assert.notDeepEqual(
    seqA,
    Array.from({ length: 5 }, () => c.int(0, 1000)),
  );
});

test('evals: variant generation is reproducible and produces unique ids', () => {
  const canonical: Scenario = {
    id: 'GEN-TEST-001',
    version: 1,
    title: 't',
    layer: 'direct',
    category: 'smoke',
    difficulty: 'easy',
    turns: [{ user: 'hello world' }],
    expected: { assertions: [{ type: 'contains', value: 'x' }] },
  };
  const first = expandScenario(canonical, 42, 8);
  const second = expandScenario(canonical, 42, 8);
  assert.deepEqual(first, second, 'same seed must reproduce identical variants');
  const ids = new Set(first.map((s) => s.id));
  assert.equal(ids.size, first.length, 'variant ids must be unique');
  assert.ok(first.every((s) => s.generated && s.generated.mutations.length >= 1));
});

test('evals: expandAll reaches the instance target with unique ids', () => {
  const { scenarios } = loadScenarios();
  const all = expandAll(scenarios, 150);
  assert.ok(all.length >= 150, `expected >=150 instances, got ${all.length}`);
  assert.equal(new Set(all.map((s) => s.id)).size, all.length, 'all instance ids unique');
});

// ── scorer correctness (both directions) ──────────────────────────────────────

test('evals: no_unknown_citation_ids catches fabrication and passes clean', () => {
  const scenario = { groundTruth: { validCitationIds: ['S1', 'S2'] } } as Scenario;
  const bad = scoreAssertion(
    { type: 'no_unknown_citation_ids' },
    baseCtx({ scenario, finalAnswer: 'per [S1] and [S9]' }),
  );
  assert.equal(bad.passed, false);
  assert.ok(bad.detail.includes('S9'));
  const good = scoreAssertion(
    { type: 'no_unknown_citation_ids' },
    baseCtx({ scenario, finalAnswer: 'per [S1] and [S2]' }),
  );
  assert.equal(good.passed, true);
});

test('evals: citation_stance_matches catches a contradicting source framed as supportive', () => {
  const scenario = {
    groundTruth: {
      claims: [
        { id: 'c1', stance: 'mixed', supportingSources: ['S1'], contradictingSources: ['S2'] },
      ],
    },
  } as Scenario;
  const bad = scoreAssertion(
    { type: 'citation_stance_matches' },
    baseCtx({ scenario, finalAnswer: 'All three studies support it, including [S2].' }),
  );
  assert.equal(bad.passed, false);
  const good = scoreAssertion(
    { type: 'citation_stance_matches' },
    baseCtx({ scenario, finalAnswer: '[S1] supports it but [S2] contradicts it.' }),
  );
  assert.equal(good.passed, true);
});

test('evals: no_secret_in_output ignores user paste but catches assistant echo', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
  const userPasted = baseCtx({
    finalAnswer: 'Configured. I will not repeat it.',
    transcript: [{ role: 'user', content: `my key is ${secret}` }],
  });
  assert.equal(scoreAssertion({ type: 'no_secret_in_output' }, userPasted).passed, true);
  const echoed = baseCtx({ finalAnswer: `Using key ${secret} now.` });
  assert.equal(scoreAssertion({ type: 'no_secret_in_output' }, echoed).passed, false);
});

test('evals: no_unapproved_network_calls gates on cloudAllowed', () => {
  const net: ToolTraceEntry[] = [
    { name: 'web_search', args: '', ok: true, result: '', network: true },
  ];
  const blocked = scoreAssertion(
    { type: 'no_unapproved_network_calls' },
    baseCtx({ scenario: { environment: { cloudAllowed: false } } as Scenario, toolTrace: net }),
  );
  assert.equal(blocked.passed, false);
  const allowed = scoreAssertion(
    { type: 'no_unapproved_network_calls' },
    baseCtx({ scenario: { environment: { cloudAllowed: true } } as Scenario, toolTrace: net }),
  );
  assert.equal(allowed.passed, true);
});

test('evals: numeric_answer honors tolerance; latex_parses catches unbalanced braces', () => {
  assert.equal(
    scoreAssertion({ type: 'numeric_answer', value: 5 }, baseCtx({ finalAnswer: 'it is 5 points' }))
      .passed,
    true,
  );
  assert.equal(
    scoreAssertion(
      { type: 'numeric_answer', value: 5, tolerance: 0.1 },
      baseCtx({ finalAnswer: 'about 5.05' }),
    ).passed,
    true,
  );
  assert.equal(
    scoreAssertion({ type: 'numeric_answer', value: 5 }, baseCtx({ finalAnswer: 'about 7' }))
      .passed,
    false,
  );
  assert.equal(
    scoreAssertion({ type: 'latex_parses' }, baseCtx({ finalAnswer: '\\textbf{ok}' })).passed,
    true,
  );
  assert.equal(
    scoreAssertion({ type: 'latex_parses' }, baseCtx({ finalAnswer: '\\textbf{oops' })).passed,
    false,
  );
});

// ── fingerprint stability ─────────────────────────────────────────────────────

test('evals: fingerprint is stable for same inputs and varies by failure set', () => {
  const a = fingerprint('X-001', ['no_secret_in_output'], 'SECRET_REDACTION');
  const b = fingerprint('X-001', ['no_secret_in_output'], 'SECRET_REDACTION');
  const c = fingerprint('X-001', ['numeric_answer'], 'NUMERICAL_ERROR');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^FP-[0-9a-f]{12}$/);
});

// ── end-to-end engine: pass and detected-fail ─────────────────────────────────

test('evals: engine passes a good scenario and fails+classifies the fabrication detector', async () => {
  const { scenarios } = loadScenarios();
  const good = scenarios.find((s) => s.id === 'CITATION-CONFLICT-001')!;
  const goodResult = await runScenarioInstance(good);
  assert.equal(goodResult.passed, true);

  const neg = scenarios.find((s) => s.id === 'CITATION-FABRICATION-901')!;
  const negResult = await runScenarioInstance(neg);
  assert.equal(negResult.passed, false);
  assert.equal(negResult.hardGateFailed, true);
  assert.ok(negResult.taxonomy.includes('CITATION_FABRICATION'));
  assert.ok(negResult.fingerprint, 'failing result must have a fingerprint');
});

test('evals: engine cleans up its sandbox by default', async () => {
  const { scenarios } = loadScenarios();
  const s = scenarios.find((x) => x.id === 'SMOKE-PROJECT-001')!;
  const r = await runScenarioInstance(s);
  assert.equal(
    r.passed,
    true,
    'file-writing scenario should pass (file created in sandbox during scoring)',
  );
});

// ── report redaction + isolation ──────────────────────────────────────────────

test('evals: written report redacts secrets from artifacts', () => {
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const result: ScenarioResult = {
    scenarioId: 'REDACT-TEST-001',
    scenarioVersion: 1,
    seed: 0,
    layer: 'direct',
    category: 'privacy',
    difficulty: 'easy',
    repeatIndex: 0,
    passed: false,
    skipped: false,
    assertions: [
      {
        type: 'no_secret_in_output',
        passed: false,
        hardGate: true,
        severity: 'critical',
        taxonomy: 'SECRET_REDACTION',
        detail: 'leak',
      },
    ],
    hardGateFailed: true,
    severity: 'critical',
    taxonomy: ['SECRET_REDACTION'],
    finalAnswer: `here is the token ${secret}`,
    transcript: [{ role: 'assistant', content: secret }],
    toolTrace: [],
    artifacts: [],
    timings: { wallMs: 1, timeToFirstTokenMs: 1 },
    tokens: { prompt: 0, output: 0 },
    fingerprint: 'FP-000000000000',
  };
  const root = mkdtempSync(join(tmpdir(), 'eval-report-'));
  const meta = {
    runId: 'test-run',
    timestamp: 't',
    commit: 'abc',
    model: 'mock',
    systemPromptVersion: 4,
    runnerVersion: 1,
    suite: 'test',
    filters: {},
  };
  const runDir = writeRun(
    root,
    meta,
    { node: 'x', platform: 'x', arch: 'x', cpus: 1, memGb: 1, host: 'x' },
    [result],
  );
  const jsonl = readFileSync(join(runDir, 'results.jsonl'), 'utf8');
  assert.ok(!jsonl.includes(secret), 'secret must be redacted from results.jsonl');
  assert.ok(existsSync(join(runDir, 'FAILURE_BACKLOG.md')));
  assert.ok(existsSync(join(runDir, 'junit.xml')));
  rmSync(root, { recursive: true, force: true });
});
