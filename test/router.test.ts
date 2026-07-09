import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTurn,
  resolveModel,
  formatTierNote,
  shouldShowTierNote,
} from '../src/agent/router.js';
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

// ── Edge cases (P2.1) ────────────────────────────────────────────────────────

test('hadToolCalls overrides think keywords (chain continuity wins)', () => {
  // A keyword-heavy follow-up during a tool chain must still keep the tier.
  const ctx: RouterContext = { ...base, hadToolCalls: true, lastTier: 'fast' };
  assert.equal(classifyTurn('now synthesize the results and conclusion', ctx), 'keep');
});

test('long-prompt boundary: 280 chars stays fast, 281 routes to think', () => {
  assert.equal(classifyTurn('a'.repeat(280), base), 'fast');
  assert.equal(classifyTurn('a'.repeat(281), base), 'think');
});

test('keyword false-positive: a word merely containing a keyword substring', () => {
  // "papers" contains "paper" — current behavior treats it as a hit (substring
  // match). This test pins that behavior so any future tightening is deliberate.
  assert.equal(classifyTurn('where are my papers stored', base), 'think');
  // A clearly unrelated short message with no keyword stays fast.
  assert.equal(classifyTurn('thanks that works', base), 'fast');
});

test('slash command keeps tier even with think keywords', () => {
  const ctx: RouterContext = { ...base, lastTier: 'think' };
  assert.equal(classifyTurn('/audit-paper abstract methodology', ctx), 'keep');
});

test('literature task in research focus routes to think', () => {
  const ctx: RouterContext = { ...base, focus: 'research', activeTask: 'literature' };
  assert.equal(classifyTurn('anything new?', ctx), 'think');
});

test('short follow-up with keywords does not keep — routes to think', () => {
  // Even a short message routes to think when it carries a research keyword.
  const ctx: RouterContext = { ...base, lastTier: 'fast' };
  assert.equal(classifyTurn('draft it', ctx), 'think');
});

// ── Research-focus default (rule 8) ─────────────────────────────────────────
// In research focus, classifyTurn defaults to 'think' instead of 'fast' so the
// session stays on the capable model between keyword-free turns (e.g. "run it",
// "what's in the project?"). Hysteresis (app.tsx) then prevents a rapid switch
// back to fast on the first navigational message.

test('research focus + no keywords + short message → think (not fast)', () => {
  // A short navigational question in research mode should stay on think.
  const ctx: RouterContext = { ...base, focus: 'research' };
  assert.equal(classifyTurn('what files are in the project?', ctx), 'think');
});

test('research focus + no keywords + medium message → think', () => {
  const ctx: RouterContext = { ...base, focus: 'research' };
  assert.equal(classifyTurn('run the experiment again', ctx), 'think');
});

test('general focus + no keywords + short message → fast (unchanged)', () => {
  const ctx: RouterContext = { ...base, focus: 'general' };
  assert.equal(classifyTurn('what time is it', ctx), 'fast');
});

test('general focus + 280-char message + no keywords → fast (boundary unchanged)', () => {
  const ctx: RouterContext = { ...base, focus: 'general' };
  assert.equal(classifyTurn('a'.repeat(280), ctx), 'fast');
});

// ── shouldShowTierNote (P2.3) ────────────────────────────────────────────────

test('shouldShowTierNote off never shows', () => {
  assert.equal(shouldShowTierNote('off', null, 'fast', false), false);
  assert.equal(shouldShowTierNote('off', 'fast', 'think', true), false);
});

test('shouldShowTierNote always shows', () => {
  assert.equal(shouldShowTierNote('always', 'fast', 'fast', false), true);
  assert.equal(shouldShowTierNote('always', null, 'think', false), true);
});

test('shouldShowTierNote changes: only on switch or forced', () => {
  // First turn (no prior shown tier) → show.
  assert.equal(shouldShowTierNote('changes', null, 'fast', false), true);
  // Same tier as last shown → quiet.
  assert.equal(shouldShowTierNote('changes', 'fast', 'fast', false), false);
  // Tier switched → show.
  assert.equal(shouldShowTierNote('changes', 'fast', 'think', false), true);
  // Same tier but forced by /model → show (acknowledge the override).
  assert.equal(shouldShowTierNote('changes', 'think', 'think', true), true);
});
