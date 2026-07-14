import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THINKING_EFFORTS,
  effortToParams,
  resolveAutoEffort,
  cycleEffort,
  parseEffort,
  effortLabel,
  type ThinkingEffort,
} from '../src/agent/thinkingEffort.js';

test('effortToParams: auto falls back to medium params if unresolved', () => {
  assert.deepEqual(effortToParams('auto'), { think: true, uncapOutput: false });
});

test('effortToParams: low turns thinking off, no uncap', () => {
  assert.deepEqual(effortToParams('low'), { think: false, uncapOutput: false });
});

test('effortToParams: medium reasons at the default level', () => {
  assert.deepEqual(effortToParams('medium'), { think: true, uncapOutput: false });
});

test('effortToParams: high sends the "high" native level', () => {
  assert.deepEqual(effortToParams('high'), { think: 'high', uncapOutput: false });
});

test('effortToParams: max is deep reasoning AND uncapped output', () => {
  assert.deepEqual(effortToParams('max'), { think: 'high', uncapOutput: true });
});

test('every effort level is mapped (no missing case)', () => {
  for (const e of THINKING_EFFORTS) {
    const p = effortToParams(e);
    assert.ok('think' in p && 'uncapOutput' in p, `unmapped effort: ${e}`);
  }
});

test('cycleEffort steps forward through the dial', () => {
  assert.equal(cycleEffort('auto', 1), 'low');
  assert.equal(cycleEffort('low', 1), 'medium');
  assert.equal(cycleEffort('medium', 1), 'high');
  assert.equal(cycleEffort('high', 1), 'max');
});

test('cycleEffort steps backward through the dial', () => {
  assert.equal(cycleEffort('max', -1), 'high');
  assert.equal(cycleEffort('high', -1), 'medium');
  assert.equal(cycleEffort('medium', -1), 'low');
  assert.equal(cycleEffort('low', -1), 'auto');
});

test('cycleEffort wraps around both ends ("loop through")', () => {
  assert.equal(cycleEffort('max', 1), 'auto'); // right past the end → wraps to start
  assert.equal(cycleEffort('auto', -1), 'max'); // left before the start → wraps to end
});

test('parseEffort accepts valid levels case-insensitively, rejects junk', () => {
  assert.equal(parseEffort('HIGH'), 'high');
  assert.equal(parseEffort('  medium '), 'medium');
  assert.equal(parseEffort('turbo'), null);
  assert.equal(parseEffort(''), null);
});

test('effortLabel renders a compact chip', () => {
  assert.equal(effortLabel('medium' as ThinkingEffort), '‹ medium ›');
});

test('resolveAutoEffort: tool-call continuation → low (no thinking)', () => {
  assert.equal(resolveAutoEffort('now update the other file', { hadToolCalls: true }), 'low');
});

test('resolveAutoEffort: slash command → low', () => {
  assert.equal(resolveAutoEffort('/model', { hadToolCalls: false }), 'low');
});

test('resolveAutoEffort: short confirmation → low', () => {
  assert.equal(resolveAutoEffort('run it', { hadToolCalls: false }), 'low');
  assert.equal(resolveAutoEffort('yes', { hadToolCalls: false }), 'low');
});

test('resolveAutoEffort: a question keeps thinking on → medium', () => {
  assert.equal(resolveAutoEffort('why does this fail?', { hadToolCalls: false }), 'medium');
});

test('resolveAutoEffort: short message with a reasoning cue → medium', () => {
  assert.equal(resolveAutoEffort('why?', { hadToolCalls: false }), 'medium');
  assert.equal(resolveAutoEffort('explain', { hadToolCalls: false }), 'medium');
});

test('resolveAutoEffort: a normal (non-trivial) message → medium', () => {
  assert.equal(
    resolveAutoEffort('Add a retry with exponential backoff to the fetch helper', {
      hadToolCalls: false,
    }),
    'medium',
  );
});

test('resolveAutoEffort: a tool follow-up wins even over a question', () => {
  // Tool-chain continuity is the strongest signal — mechanical follow-up.
  assert.equal(resolveAutoEffort('why?', { hadToolCalls: true }), 'low');
});
