import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMorph,
  getShapeTransition,
  SHAPE_SEQUENCE,
  labelFor,
  PALETTE,
} from '../ui/ascii/AsciiMorphRenderer.js';

test('renderMorph returns exactly `height` lines, each exactly `width` wide', () => {
  const rows = renderMorph({ width: 36, height: 15, timeMs: 1234 });
  assert.equal(rows.length, 15);
  for (const line of rows) assert.equal(line.length, 36);
});

test('renderMorph is deterministic for identical inputs', () => {
  const a = renderMorph({ width: 40, height: 16, timeMs: 7777 });
  const b = renderMorph({ width: 40, height: 16, timeMs: 7777 });
  assert.deepEqual(a, b);
});

test('renderMorph only emits palette characters (or spaces)', () => {
  const rows = renderMorph({ width: 30, height: 14, timeMs: 26000 });
  const allowed = new Set([...PALETTE, ' ']);
  for (const line of rows) for (const ch of line) assert.ok(allowed.has(ch), `unexpected char ${JSON.stringify(ch)}`);
});

test('the shape sequence advances every 5 seconds and loops', () => {
  assert.equal(getShapeTransition(0).from, 'mascot');
  assert.equal(getShapeTransition(0).to, 'web');
  assert.equal(getShapeTransition(4000).from, 'mascot'); // still on segment 0
  assert.equal(getShapeTransition(5000).from, 'web'); // next segment
  assert.equal(getShapeTransition(10000).from, 'book');
  assert.equal(getShapeTransition(5000 * SHAPE_SEQUENCE.length).from, 'mascot'); // loops
});

test('the morph starts near 3.8s and completes by 5.0s', () => {
  assert.equal(getShapeTransition(3800).morphT, 0, 'holds until 3.8s');
  assert.equal(getShapeTransition(2000).morphT, 0);
  const mid = getShapeTransition(4400).morphT;
  assert.ok(mid > 0 && mid < 1, `mid-morph should be partial, got ${mid}`);
  assert.ok(getShapeTransition(4990).morphT > 0.98, 'nearly complete by 5.0s');
});

test('reduced-motion frame is stable across timestamps', () => {
  const a = renderMorph({ width: 36, height: 15, timeMs: 0, reducedMotion: true });
  const b = renderMorph({ width: 36, height: 15, timeMs: 123456, reducedMotion: true });
  assert.deepEqual(a, b, 'reduced motion must ignore time');
});

test('tiny and minimum sizes do not throw', () => {
  assert.doesNotThrow(() => renderMorph({ width: 40, height: 12, timeMs: 3000 }));
  assert.doesNotThrow(() => renderMorph({ width: 10, height: 5, timeMs: 3000 }));
  assert.doesNotThrow(() => renderMorph({ width: 1, height: 1, timeMs: 0 }));
});

test('every shape in the sequence has a label', () => {
  for (const s of SHAPE_SEQUENCE) assert.ok(labelFor(s).length > 0);
  assert.equal(labelFor('mascot'), 'Tilde');
});
