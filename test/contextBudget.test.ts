import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens,
  estimateMessagesTokens,
  promptBudgetFor,
  reasoningOutputReserve,
  assessTurn,
} from '../src/agent/contextBudget.js';
import type { Message } from '../src/agent/model.js';

test('estimateTokens uses ceil(chars/4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2); // 5/4 → 2
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('estimateMessagesTokens counts content, framing, and tool-call payloads', () => {
  const msgs: Message[] = [
    { role: 'user', content: 'a'.repeat(400) }, // 100 + 4
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'run', arguments: '{}' } }],
    },
  ];
  // 104 (user) + 4 (assistant framing) + name(1) + args(1) + 4 = 114
  assert.equal(estimateMessagesTokens(msgs), 114);
});

test('reasoningOutputReserve floors at 8192, capped at half of numCtx', () => {
  assert.equal(reasoningOutputReserve(64000), 8192);
  assert.equal(reasoningOutputReserve(16384), 8192);
  assert.equal(reasoningOutputReserve(8192), 4096); // half, since half < 8192
  assert.equal(reasoningOutputReserve(4096), 2048);
});

test('promptBudgetFor: calm presets stay tight, roomy presets scale with the window', () => {
  const safe = (n: number) => Math.max(1024, Math.floor((n - reasoningOutputReserve(n)) * 0.85));

  // Ample context: calm presets keep their tight nominal budgets…
  assert.equal(promptBudgetFor('cool', 64000), 5000);
  assert.equal(promptBudgetFor('fast', 64000), 4000);
  assert.equal(promptBudgetFor('balanced', 64000), 10000);
  // …while the roomy presets use most of the window (minus the output reserve + margin).
  assert.equal(promptBudgetFor('deep', 64000), safe(64000));
  assert.equal(promptBudgetFor('long_context', 64000), safe(64000));
  assert.equal(promptBudgetFor('manual', 64000), safe(64000));

  // Roomy presets genuinely scale: a bigger window keeps more history.
  assert.ok(promptBudgetFor('deep', 64000) > promptBudgetFor('deep', 32768));
  assert.ok(promptBudgetFor('deep', 32768) > promptBudgetFor('deep', 16384));

  // Small context clamps every preset to the safe ceiling.
  assert.equal(promptBudgetFor('balanced', 8192), safe(8192));
  assert.equal(promptBudgetFor('cool', 8192), safe(8192));
});

test('promptBudgetFor + reasoning reserve can never overflow the window', () => {
  for (const numCtx of [4096, 8192, 16384, 32768, 64000]) {
    for (const preset of ['cool', 'fast', 'balanced', 'deep', 'long_context', 'manual'] as const) {
      const budget = promptBudgetFor(preset, numCtx);
      assert.ok(
        budget + reasoningOutputReserve(numCtx) <= numCtx,
        `${preset}@${numCtx}: ${budget} + reserve > ${numCtx}`,
      );
    }
  }
});

test('assessTurn flags CPU spill first and unconditionally', () => {
  const a = assessTurn({ promptTokens: 100, totalMs: 1000, outputTokens: 10, budget: 5000, cpuSpill: true });
  assert.equal(a.slow, true);
  assert.match(a.message ?? '', /CPU\/GPU mixed/);
});

test('assessTurn flags an over-budget prompt', () => {
  const a = assessTurn({ promptTokens: 9000, totalMs: 1000, outputTokens: 10, budget: 5000 });
  assert.equal(a.slow, true);
  assert.match(a.message ?? '', /trimmed automatically/);
});

test('assessTurn flags slow generation only with enough output and elapsed time', () => {
  // 30 output tokens over 10s = 3 tok/s, but under the 40-token floor → not slow.
  assert.equal(assessTurn({ promptTokens: 100, totalMs: 10000, outputTokens: 30, budget: 5000 }).slow, false);
  // 60 tokens over 20s = 3 tok/s → slow.
  const slow = assessTurn({ promptTokens: 100, totalMs: 20000, outputTokens: 60, budget: 5000 });
  assert.equal(slow.slow, true);
  assert.match(slow.message ?? '', /tok\/s/);
});

test('assessTurn stays quiet on a fast, in-budget turn', () => {
  assert.equal(
    assessTurn({ promptTokens: 100, totalMs: 2000, ttftMs: 300, outputTokens: 200, budget: 5000 }).slow,
    false,
  );
});
