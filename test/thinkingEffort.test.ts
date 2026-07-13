import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THINKING_EFFORTS,
  effortToParams,
  cycleEffort,
  parseEffort,
  effortLabel,
  type ThinkingEffort,
} from '../src/agent/thinkingEffort.js';

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
  assert.equal(cycleEffort('low', 1), 'medium');
  assert.equal(cycleEffort('medium', 1), 'high');
  assert.equal(cycleEffort('high', 1), 'max');
});

test('cycleEffort steps backward through the dial', () => {
  assert.equal(cycleEffort('max', -1), 'high');
  assert.equal(cycleEffort('high', -1), 'medium');
  assert.equal(cycleEffort('medium', -1), 'low');
});

test('cycleEffort wraps around both ends ("loop through")', () => {
  assert.equal(cycleEffort('max', 1), 'low'); // right past the end → wraps to start
  assert.equal(cycleEffort('low', -1), 'max'); // left before the start → wraps to end
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
