import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiff } from '../ui/diff.js';

test('a brand-new file is all additions', () => {
  const d = summarizeDiff('', 'one\ntwo\nthree');
  assert.equal(d.added, 3);
  assert.equal(d.removed, 0);
  assert.ok(d.rows.every((r) => r.sign === '+'));
});

test('counts a single changed line as one add + one remove', () => {
  const d = summarizeDiff('a\nb\nc', 'a\nB\nc');
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
});

test('identical text yields no changes', () => {
  const d = summarizeDiff('same\ntext', 'same\ntext');
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
});

test('collapses far-apart context into a gap marker', () => {
  const oldText = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
  const newText = oldText.replace('line0', 'CHANGED0').replace('line39', 'CHANGED39');
  const d = summarizeDiff(oldText, newText, 1);
  assert.ok(
    d.rows.some((r) => r.sign === '~'),
    'expected a collapsed gap row',
  );
});

test('caps the number of rows and reports the remainder as truncated', () => {
  const oldText = Array.from({ length: 100 }, (_, i) => `a${i}`).join('\n');
  const newText = Array.from({ length: 100 }, (_, i) => `b${i}`).join('\n');
  const d = summarizeDiff(oldText, newText, 2, 22);
  assert.equal(d.rows.length, 22);
  assert.ok(d.truncated > 0);
});

test('falls back gracefully on pathologically large inputs', () => {
  const oldText = Array.from({ length: 2100 }, (_, i) => `x${i}`).join('\n');
  const d = summarizeDiff(oldText, '');
  assert.equal(d.added, 0);
  assert.equal(d.removed, 2100);
});
