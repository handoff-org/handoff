// Colour layer for the logo: turns the rasterized `h>` grid into Ink segments
// tinted by a smooth, cyclic gradient that flows horizontally. The gradient is
// sampled per COLUMN from a ring of theme colours; advancing `phase` over time
// slides the whole ramp left→right. Pure and deterministic — the animation clock
// lives in the hook, this just maps (column, phase) → colour.

import { hexToRgb, rgbToHex, mix } from '../color.js';
import type { Theme } from '../../config/theme.js';
import type { Seg } from './logo.js';

/**
 * Sample a cyclic gradient across `colors` at position `t`. The ring wraps
 * seamlessly (…→last→first→…) and each hop is eased with smoothstep so the sweep
 * reads as a continuous rainbow rather than banded steps.
 */
export function sampleCycle(colors: string[], t: number): string {
  const k = colors.length;
  if (k === 1) return colors[0]!;
  const x = (((t % 1) + 1) % 1) * k; // wrap into [0, k)
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f); // smoothstep easing
  return rgbToHex(mix(hexToRgb(colors[i % k]!), hexToRgb(colors[(i + 1) % k]!), s));
}

export interface GradientOptions {
  /** How many full colour cycles span the logo's width (default 1). */
  cycles?: number;
  /** false (NO_COLOR) → no colours, just the block characters. */
  color?: boolean;
}

/**
 * Colour a rendered logo. Every non-space cell takes its column's gradient
 * colour; spaces stay uncoloured. Adjacent same-colour cells merge into runs so
 * Ink draws few segments per row.
 */
export function colorizeGradient(
  rows: string[],
  colors: string[],
  phase: number,
  opts?: GradientOptions,
): Seg[][] {
  const cycles = opts?.cycles ?? 1;
  const color = opts?.color ?? true;
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1);

  // Per-column colour is shared by every row, so compute it once. Subtracting
  // `phase` makes a given hue travel toward higher columns (left→right) as phase
  // grows.
  const colColor: (string | undefined)[] = new Array(width);
  for (let c = 0; c < width; c++) {
    colColor[c] = color ? sampleCycle(colors, (c / width) * cycles - phase) : undefined;
  }

  return rows.map((row) => {
    const segs: Seg[] = [];
    let text = '';
    let col: string | undefined;
    let started = false;
    const flush = () => {
      if (text) segs.push(col ? { text, color: col } : { text });
    };
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      const cc = ch === ' ' ? undefined : colColor[c];
      if (started && cc === col) {
        text += ch;
      } else {
        flush();
        text = ch;
        col = cc;
        started = true;
      }
    }
    flush();
    return segs;
  });
}

/**
 * A ring of at least three theme colours for the gradient. Pulls the theme's
 * distinct accent hues (so the sweep always "matches the theme"); if a theme is
 * too monochrome to yield three, it's padded with light/dark shades of its base.
 */
export function themePalette(theme: Theme): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hex of [theme.mascot, theme.user, theme.note, theme.assistant, theme.tool]) {
    const key = hex.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(hex);
    }
  }
  if (out.length < 3) {
    const base = hexToRgb(out[0] ?? theme.mascot);
    out.push(rgbToHex(mix(base, [255, 255, 255], 0.45)));
    out.push(rgbToHex(mix(base, [0, 0, 0], 0.4)));
  }
  return out;
}
