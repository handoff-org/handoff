/**
 * Pure geometry + color math for the animated "border beam" that laps the prompt
 * box while the model is responding. No React here so it can be unit-tested and
 * reused; the renderer (BeamBox.tsx) is a thin wrapper over these helpers.
 *
 * Perimeter model. For an outer box `w` columns wide with `h` content rows, the
 * border is walked CLOCKWISE starting at the top-left corner, so the beam travels
 * left→right along the top, down the right, right→left along the bottom, and up
 * the left back to the start. Cells are indexed 0..P-1 with P = 2w + 2h:
 *
 *   top    col c  (0..w-1)         → k = c
 *   right  row r  (0..h-1)         → k = w + r
 *   bottom col c  (0..w-1), R→L    → k = 2w + h - 1 - c
 *   left   row r  (0..h-1), B→T    → k = 2w + 2h - 1 - r
 */

import { hexToRgb, rgbToHex, mix } from './color.js';

/** Ease-in-out (Hermite smoothstep). Slow at the ends, fast in the middle. */
export function smoothstep(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return x * x * (3 - 2 * x);
}

/** Number of border cells around the perimeter of a `w`×`h` (content-rows) box. */
export function perimeterLength(w: number, h: number): number {
  return 2 * w + 2 * h;
}

// ── cell → perimeter index (clockwise from top-left) ──────────────────────────

export function topIndex(col: number): number {
  return col;
}
export function rightIndex(w: number, row: number): number {
  return w + row;
}
export function bottomIndex(w: number, h: number, col: number): number {
  return 2 * w + h - 1 - col;
}
export function leftIndex(w: number, h: number, row: number): number {
  return 2 * w + 2 * h - 1 - row;
}

/**
 * Brightness (0..1) of the cell at perimeter `index` given the beam head at the
 * float position `head` (0..P). The comet tail trails BEHIND the head in travel
 * order: the head cell is brightest (≈1) and brightness fades linearly to 0 over
 * `tailLen` cells behind it; everything else is 0. Distance wraps around P.
 */
export function beamBrightness(index: number, head: number, P: number, tailLen: number): number {
  if (P <= 0 || tailLen <= 0) return 0;
  // Distance from the head walking backwards to this cell, wrapped into [0, P).
  const d = (((head - index) % P) + P) % P;
  if (d >= tailLen) return 0;
  return 1 - d / tailLen;
}

/**
 * Color for the cell at perimeter `index`: the base border color, lifted toward
 * white by an amount that grows with beam brightness. Cells outside the tail
 * render the exact base color (so the border is continuous, with a bright comet
 * riding over it).
 */
export function beamColorAt(
  index: number,
  head: number,
  P: number,
  baseHex: string,
  tailLen = 8,
): string {
  const b = beamBrightness(index, head, P, tailLen);
  if (b <= 0) return baseHex;
  return rgbToHex(mix(hexToRgb(baseHex), [255, 255, 255], 0.15 + 0.6 * b));
}
