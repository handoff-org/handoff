import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurn, resolveModel, formatTierNote } from '../src/agent/router.js';
import type { RouterContext } from '../src/agent/router.js';

const base: RouterContext = {
  focus: 'general',
  lastTier: null,
  hadToolCalls: false,
  historyLength: 0,
};

test('short greeting routes to fast', () => {
  assert.equal(classifyTurn('hi', { ...base, focus: 'general' }), 'fast');
});

test('paper-keyword message routes to think', () => {
  assert.equal(classifyTurn('write an abstract for my paper', base), 'think');
});

test('short follow-up keeps last tier', () => {
  const ctx: RouterContext = { ...base, lastTier: 'think' };
  assert.equal(classifyTurn('ok', ctx), 'keep');
});

test('hadToolCalls always keeps tier', () => {
  const ctx: RouterContext = { ...base, hadToolCalls: true };
  assert.equal(classifyTurn('yes go ahead', ctx), 'keep');
  assert.equal(classifyTurn('write an abstract', ctx), 'keep');
});

test('related work keyword routes to think', () => {
  assert.equal(classifyTurn('what is related work on attention?', base), 'think');
});

test('research focus + paper task routes to think', () => {
  const ctx: RouterContext = { ...base, focus: 'research', activeTask: 'paper' };
  assert.equal(classifyTurn('what should we do next?', ctx), 'think');
});

test('long message (>280 chars) without keywords routes to think', () => {
  const long = 'a'.repeat(281);
  assert.equal(classifyTurn(long, base), 'think');
});

test('empty string does not crash and routes to fast', () => {
  assert.equal(classifyTurn('', base), 'fast');
});

test('resolveModel keep with null lastTier falls back to think', () => {
  assert.equal(resolveModel('keep', null), 'think');
});

test('resolveModel keep with fast lastTier resolves to fast', () => {
  assert.equal(resolveModel('keep', 'fast'), 'fast');
});

test('resolveModel fast resolves to fast regardless of lastTier', () => {
  assert.equal(resolveModel('fast', null), 'fast');
  assert.equal(resolveModel('fast', 'think'), 'fast');
});

test('slash command keeps tier', () => {
  const ctx: RouterContext = { ...base, lastTier: 'fast' };
  assert.equal(classifyTurn('/research attention', ctx), 'keep');
});

test('formatTierNote produces expected string', () => {
  assert.equal(formatTierNote('fast', 'qwen3:4b'), 'fast model · qwen3:4b');
  assert.equal(formatTierNote('think', 'qwen3:8b'), 'think model · qwen3:8b');
});
