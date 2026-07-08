import { test } from 'node:test';
import assert from 'node:assert/strict';
import { killToStart, killToEnd, deleteWordBack, pushHistory, HistoryCursor } from '../ui/input.js';

test('killToStart deletes from cursor back to start', () => {
  assert.deepEqual(killToStart('hello world', 6), { text: 'world', cursor: 0 });
  assert.deepEqual(killToStart('hello', 0), { text: 'hello', cursor: 0 });
  assert.deepEqual(killToStart('hello', 5), { text: '', cursor: 0 });
});

test('killToEnd deletes from cursor to end', () => {
  assert.deepEqual(killToEnd('hello world', 5), { text: 'hello', cursor: 5 });
  assert.deepEqual(killToEnd('hello', 5), { text: 'hello', cursor: 5 });
  assert.deepEqual(killToEnd('hello', 0), { text: '', cursor: 0 });
});

test('deleteWordBack removes the previous word and its leading spaces', () => {
  assert.deepEqual(deleteWordBack('hello world', 11), { text: 'hello ', cursor: 6 });
  // repeated: from "hello " deletes "hello"
  assert.deepEqual(deleteWordBack('hello ', 6), { text: '', cursor: 0 });
  // mid-string: only affects text before the cursor
  assert.deepEqual(deleteWordBack('foo bar baz', 7), { text: 'foo  baz', cursor: 4 });
});

test('deleteWordBack at start is a no-op', () => {
  assert.deepEqual(deleteWordBack('abc', 0), { text: 'abc', cursor: 0 });
});

test('editing helpers clamp out-of-range cursors', () => {
  assert.deepEqual(killToEnd('abc', 99), { text: 'abc', cursor: 3 });
  assert.deepEqual(killToStart('abc', -5), { text: 'abc', cursor: 0 });
});

test('editing helpers handle multi-byte content by code unit', () => {
  // "café" — cursor after the é (index 4). killToStart clears all.
  assert.deepEqual(killToStart('café', 4), { text: '', cursor: 0 });
});

test('pushHistory appends, skips empties and consecutive dupes, bounds size', () => {
  let h: string[] = [];
  h = pushHistory(h, 'a');
  h = pushHistory(h, '  '); // empty after trim → skipped
  h = pushHistory(h, 'a'); // consecutive dupe → skipped
  h = pushHistory(h, 'b');
  assert.deepEqual(h, ['a', 'b']);
  // bound
  let big: string[] = [];
  for (let i = 0; i < 150; i++) big = pushHistory(big, `cmd${i}`, 100);
  assert.equal(big.length, 100);
  assert.equal(big[0], 'cmd50');
  assert.equal(big[99], 'cmd149');
});

test('HistoryCursor walks older with prev and back to draft with next', () => {
  const hc = new HistoryCursor(['one', 'two', 'three'], 'draft');
  assert.equal(hc.atDraft(), true);
  assert.equal(hc.prev(), 'three');
  assert.equal(hc.prev(), 'two');
  assert.equal(hc.prev(), 'one');
  assert.equal(hc.prev(), 'one'); // clamped at oldest
  assert.equal(hc.next(), 'two');
  assert.equal(hc.next(), 'three');
  assert.equal(hc.next(), 'draft'); // back to the live draft
  assert.equal(hc.atDraft(), true);
  assert.equal(hc.next(), null); // already at draft
});

test('HistoryCursor with empty history returns null', () => {
  const hc = new HistoryCursor([], 'draft');
  assert.equal(hc.prev(), null);
  assert.equal(hc.next(), null);
  assert.equal(hc.atDraft(), true);
});
