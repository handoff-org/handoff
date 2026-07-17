import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  smoothstep,
  perimeterLength,
  topIndex,
  rightIndex,
  bottomIndex,
  leftIndex,
  beamBrightness,
  beamColorAt,
} from '../ui/beam.js';
import { hexToRgb } from '../ui/color.js';

// ── smoothstep ────────────────────────────────────────────────────────────────

test('smoothstep: pinned at the endpoints and midpoint', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5); // symmetric ease at the middle
});

test('smoothstep: clamps out-of-range input', () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(2), 1);
});

test('smoothstep: monotonic increasing and eased at the ends', () => {
  let prev = -1;
  for (let i = 0; i <= 10; i++) {
    const v = smoothstep(i / 10);
    assert.ok(v >= prev, `smoothstep should be non-decreasing at ${i / 10}`);
    prev = v;
  }
  // Ease-in: slope near 0 is gentle, so early progress lags a linear ramp.
  assert.ok(smoothstep(0.1) < 0.1, 'eased start should trail a linear ramp');
  assert.ok(smoothstep(0.9) > 0.9, 'eased end should lead a linear ramp');
});

// ── perimeter geometry ─────────────────────────────────────────────────────────

test('perimeterLength: 2w + 2h', () => {
  assert.equal(perimeterLength(10, 1), 22);
  assert.equal(perimeterLength(40, 3), 86);
});

test('perimeter indices are contiguous and unique clockwise from top-left', () => {
  const w = 6;
  const h = 2;
  const P = perimeterLength(w, h); // 16
  const seen: number[] = [];
  for (let c = 0; c < w; c++) seen.push(topIndex(c));
  for (let r = 0; r < h; r++) seen.push(rightIndex(w, r));
  for (let c = 0; c < w; c++) seen.push(bottomIndex(w, h, c));
  for (let r = 0; r < h; r++) seen.push(leftIndex(w, h, r));

  assert.equal(seen.length, P);
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    Array.from({ length: P }, (_, i) => i),
    'every perimeter slot 0..P-1 is covered exactly once',
  );
  // Corners land where expected.
  assert.equal(topIndex(0), 0); // ╭
  assert.equal(topIndex(w - 1), w - 1); // ╮
  assert.equal(bottomIndex(w, h, w - 1), w + h); // ╯ (first bottom cell, R→L)
  assert.equal(leftIndex(w, h, 0), P - 1); // last cell before wrapping to ╭
});

// ── beamBrightness ─────────────────────────────────────────────────────────────

test('beamBrightness: head cell is brightest, fades over the tail, zero beyond', () => {
  const P = 40;
  const tail = 8;
  const head = 10;
  assert.equal(beamBrightness(10, head, P, tail), 1); // exactly on the head
  assert.ok(beamBrightness(8, head, P, tail) < beamBrightness(9, head, P, tail));
  assert.ok(beamBrightness(9, head, P, tail) < beamBrightness(10, head, P, tail));
  assert.equal(beamBrightness(2, head, P, tail), 0); // 8 cells behind → edge of tail
  assert.equal(beamBrightness(20, head, P, tail), 0); // ahead of the head → dark
});

test('beamBrightness: tail wraps around the 0 / P-1 boundary', () => {
  const P = 20;
  const tail = 6;
  const head = 1; // just past the top-left corner
  // Cells behind the head wrap to the high indices (the left edge / bottom-left).
  assert.ok(beamBrightness(19, head, P, tail) > 0, 'index P-1 trails the head');
  assert.ok(beamBrightness(18, head, P, tail) > 0, 'index P-2 trails the head');
  assert.ok(
    beamBrightness(19, head, P, tail) > beamBrightness(18, head, P, tail),
    'closer trailing cell is brighter across the wrap',
  );
});

test('beamBrightness: degenerate inputs are safe', () => {
  assert.equal(beamBrightness(0, 0, 0, 8), 0);
  assert.equal(beamBrightness(0, 0, 20, 0), 0);
});

// ── beamColorAt ────────────────────────────────────────────────────────────────

test('beamColorAt: base color away from the beam, lighter on the beam', () => {
  const base = '#f59e0b';
  const P = 40;
  // A cell outside the tail renders the exact base color.
  assert.equal(beamColorAt(25, 10, P, base, 8), base);
  // The head cell is lifted toward white (every channel >= base, and brighter).
  const [br, bg, bb] = hexToRgb(base);
  const [hr, hg, hb] = hexToRgb(beamColorAt(10, 10, P, base, 8));
  assert.ok(hr >= br && hg >= bg && hb >= bb);
  assert.ok(hr + hg + hb > br + bg + bb, 'head cell is lighter than the base');
});

test('beamColorAt: brightness gradient — head lighter than mid-tail', () => {
  const base = '#0ea5e9';
  const P = 40;
  const sum = (hex: string) => hexToRgb(hex).reduce((a, b) => a + b, 0);
  const head = sum(beamColorAt(10, 10, P, base, 8));
  const midTail = sum(beamColorAt(6, 10, P, base, 8)); // 4 cells behind
  const base3 = sum(base);
  assert.ok(head > midTail, 'head is lighter than mid-tail');
  assert.ok(midTail > base3, 'mid-tail is still lighter than the base');
});
