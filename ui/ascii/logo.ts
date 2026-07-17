// Serves the handoff `h>` wordmark from the fixed source art in `logoArt.ts`
// (copied verbatim from the brand ASCII art). Pure and deterministic, no
// React/Ink/terminal side effects — this module only lays out the ink cells;
// colour is applied separately by the gradient layer.

import { LOGO_ART, LOGO_ART_WIDTH } from './logoArt.js';

export interface Seg {
  text: string;
  color?: string;
}

/**
 * Render the fixed `h>` art (from logoArt.ts) scaled to exactly `height` rows of
 * `width` chars via nearest-neighbour resampling, so the banner can show it at
 * any size (e.g. 0.8× the intrinsic art). At the art's native size it's a 1:1
 * copy. Ink cells are the block char `0`; everything else is a space.
 * Deterministic; colour is applied separately by the gradient layer.
 */
export function renderLogo(width: number, height: number): string[] {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  const srcH = LOGO_ART.length;
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / H));
    const src = LOGO_ART[sy] ?? '';
    let line = '';
    for (let x = 0; x < W; x++) {
      const sx = Math.floor((x * LOGO_ART_WIDTH) / W);
      line += (src[sx] ?? ' ') === ' ' ? ' ' : '0';
    }
    rows.push(line);
  }
  return rows;
}

/** A `width`-wide row with a dim, centered label under the logo (blank if empty). */
export function labelRow(label: string, width: number, base: string, color: boolean): Seg[] {
  const text = label.length > width ? label.slice(0, width) : label;
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  const right = Math.max(0, width - text.length - left);
  const segs: Seg[] = [];
  if (left) segs.push({ text: ' '.repeat(left) });
  segs.push(color && text.trim() ? { text, color: base } : { text });
  if (right) segs.push({ text: ' '.repeat(right) });
  return segs;
}
