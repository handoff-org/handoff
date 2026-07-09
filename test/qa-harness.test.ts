import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { freshHome } from './helpers.js';

// The QA harness modules read homedir() at import (they pull in workspace/config
// modules), so isolate HOME before importing them.
freshHome();
const { QaLogger } = await import('../qa/chat-sim/logger.js');
const { MockChatModel } = await import('../qa/chat-sim/mockModel.js');
const { summarizeRun } = await import('../qa/chat-sim/summarize.js');
const { fuzzScenario, scenarioById } = await import('../qa/chat-sim/scenarios.js');
const { runScenario } = await import('../qa/chat-sim/harness.js');
import type { StreamPart } from '../src/agent/model.js';

function tmpLog(): string {
  return join(mkdtempSync(join(tmpdir(), 'qa-log-')), 'run.jsonl');
}

function readLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('logger writes one valid JSON object per line', () => {
  const path = tmpLog();
  const log = new QaLogger(path, 'run1', 'sc1', 'Scenario One', () => '2026-01-01T00:00:00.000Z');
  log.scenarioStart(1, '/tmp/home');
  log.userMessage('hello');
  log.assistantText('hi');
  log.scenarioEnd({ turns: 1 });
  const lines = readLines(path);
  assert.equal(lines.length, 4);
  for (const l of lines) {
    assert.equal(l['runId'], 'run1');
    assert.equal(l['scenarioId'], 'sc1');
    assert.equal(typeof l['seq'], 'number');
  }
  assert.equal(lines[0]!['kind'], 'scenario_start');
});

test('logger redacts secrets and records which field was scrubbed', () => {
  const path = tmpLog();
  const log = new QaLogger(path, 'r', 's', 'S');
  log.assistantText('my key is sk-abcdefghijklmnopqrstuvwx and a token');
  const line = readLines(path)[0]!;
  assert.doesNotMatch(String(line['message']), /sk-abcdefghijklmnopqrstuvwx/);
  assert.match(String(line['message']), /•••/);
  assert.deepEqual(line['redactions'], ['message']);
});

test('mock model realizes text, tool, malformed, and duplicate steps deterministically', async () => {
  const drain = async (m: InstanceType<typeof MockChatModel>): Promise<StreamPart[]> => {
    const out: StreamPart[] = [];
    for await (const p of m.chatStream([], undefined)) out.push(p);
    return out;
  };

  const m = new MockChatModel();
  m.enqueue([{ kind: 'text', text: 'hello' }]);
  const textParts = await drain(m);
  assert.deepEqual(textParts.at(-1), { type: 'final', content: 'hello' });

  m.enqueue([
    { kind: 'tools', calls: [{ name: 'write_file', args: { path: 'a.md', content: 'x' } }] },
  ]);
  const toolParts = await drain(m);
  const final = toolParts.at(-1) as Extract<StreamPart, { type: 'final' }>;
  assert.equal(final.tool_calls?.[0]?.function.name, 'write_file');
  assert.equal(
    final.tool_calls?.[0]?.function.arguments,
    JSON.stringify({ path: 'a.md', content: 'x' }),
  );

  m.enqueue([{ kind: 'malformed_tool', name: 'write_file', rawArgs: '{bad json' }]);
  const badParts = await drain(m);
  const badFinal = badParts.at(-1) as Extract<StreamPart, { type: 'final' }>;
  assert.equal(badFinal.tool_calls?.[0]?.function.arguments, '{bad json');

  m.enqueue([
    { kind: 'duplicate_tool', call: { name: 'write_file', args: { path: 'b.md', content: 'y' } } },
  ]);
  const dupParts = await drain(m);
  const dupFinal = dupParts.at(-1) as Extract<StreamPart, { type: 'final' }>;
  assert.equal(dupFinal.tool_calls?.length, 2);

  // Empty queue falls back to a benign reply rather than hanging.
  const fallback = await drain(m);
  assert.equal((fallback.at(-1) as Extract<StreamPart, { type: 'final' }>).content, 'Okay.');
});

test('summarize groups failures by category and counts malformed lines', () => {
  const path = tmpLog();
  const ev = (o: Record<string, unknown>) =>
    JSON.stringify({ runId: 'r', scenarioName: 'X', timestamp: 't', seq: 0, ...o });
  writeFileSync(
    path,
    [
      ev({ scenarioId: 'path-safety', kind: 'scenario_start' }),
      ev({
        scenarioId: 'path-safety',
        kind: 'assertion',
        assertion: { name: 'no escape', passed: false, severity: 'failure' },
      }),
      ev({ scenarioId: 'path-safety', kind: 'scenario_end', metrics: { durationMs: 5 } }),
      ev({ scenarioId: 'ok-one', kind: 'scenario_start' }),
      ev({ scenarioId: 'ok-one', kind: 'scenario_end' }),
      'this is not json',
    ].join('\n') + '\n',
    'utf-8',
  );
  const summary = summarizeRun(path, 'r');
  assert.equal(summary.totalScenarios, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.errorsByCategory['path_safety'], 1);
  assert.equal(summary.malformedLogLines, 1);
});

test('seeded fuzz scenarios are reproducible', () => {
  const a = fuzzScenario(12).build!({ seed: 99, homeDir: '' });
  const b = fuzzScenario(12).build!({ seed: 99, homeDir: '' });
  assert.deepEqual(a, b);
  const c = fuzzScenario(12).build!({ seed: 100, homeDir: '' });
  assert.notDeepEqual(a, c);
});

test('a corrupt-state scenario runs without crashing the harness', async () => {
  const scenario = scenarioById('corrupt-state')!;
  const log = new QaLogger(tmpLog(), 'r', scenario.id, scenario.name);
  // Should complete and return an outcome even though config/claims/profile are
  // corrupt — recovery is graceful, so no error events either.
  const outcome = await runScenario(scenario, { seed: 1, homeDir: freshHome() }, log);
  assert.equal(outcome.scenarioId, 'corrupt-state');
  assert.equal(outcome.errors, 0);
  assert.equal(outcome.passed, true);
});
