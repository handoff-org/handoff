import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOllamaPs, psRowFor } from '../src/agent/ollama.js';
import { approxTokens, loadBenchmarks, saveBenchmark, type BenchmarkResult } from '../src/agent/benchmark.js';
import { classifyThroughput } from '../src/agent/advisor.js';
import { freshHome } from './helpers.js';
import { join } from 'path';

const PS_FULL_GPU = `NAME              ID              SIZE      PROCESSOR    UNTIL
qwen3:8b          abc123          5.2 GB    100% GPU     4 minutes from now
`;

const PS_SPILL = `NAME                    ID              SIZE      PROCESSOR          UNTIL
qwen3-coder:30b         def456          19 GB     43%/57% CPU/GPU    4 minutes from now
`;

const PS_EMPTY = `NAME    ID    SIZE    PROCESSOR    UNTIL
`;

test('parseOllamaPs: a 100% GPU row is not a spill', () => {
  const rows = parseOllamaPs(PS_FULL_GPU);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, 'qwen3:8b');
  assert.equal(rows[0]!.fullGpu, true);
  assert.equal(rows[0]!.cpuSpill, false);
  assert.equal(rows[0]!.size, '5.2 GB');
});

test('parseOllamaPs: a CPU/GPU split is a spill', () => {
  const rows = parseOllamaPs(PS_SPILL);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.fullGpu, false);
  assert.equal(rows[0]!.cpuSpill, true);
  assert.match(rows[0]!.processor!, /CPU/);
});

test('parseOllamaPs: empty table yields no rows', () => {
  assert.deepEqual(parseOllamaPs(PS_EMPTY), []);
  assert.deepEqual(parseOllamaPs(''), []);
});

test('psRowFor matches bare and :latest forms', () => {
  const rows = parseOllamaPs(PS_FULL_GPU);
  assert.ok(psRowFor(rows, 'qwen3:8b'));
});

test('classifyThroughput marks a spilling model bad even if fast-ish', () => {
  assert.equal(classifyThroughput(9, false), 'bad');
});

test('approxTokens estimates ~4 chars/token', () => {
  assert.equal(approxTokens(''), 1);
  assert.ok(approxTokens('a'.repeat(40)) === 10);
});

test('benchmark cache round-trips and upserts by key', async () => {
  const home = freshHome();
  const path = join(home, 'bench.json');
  const rec: BenchmarkResult = {
    backend: 'ollama', modelId: 'qwen3:8b', quant: 'q4_K_M', contextTokens: 8192,
    hardwareFingerprint: 'fp', tokensPerSec: 22, fullGpu: true, toolCallOk: true,
    handoffVersion: 'test', ttftMs: 120, totalMs: 1000, outputTokensApprox: 22, tier: 'excellent',
  };
  await saveBenchmark(rec, path);
  await saveBenchmark({ ...rec, tokensPerSec: 25, tier: 'excellent' }, path); // same key → replace
  const all = await loadBenchmarks(path);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.tokensPerSec, 25);
});

test('loadBenchmarks returns [] for a missing file', async () => {
  assert.deepEqual(await loadBenchmarks('/nonexistent/path/x.json'), []);
});
