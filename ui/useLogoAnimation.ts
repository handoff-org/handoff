// The logo animation controller: a fixed-timestep hook that advances a phase
// clock and returns the current frame — the `h>` wordmark tinted by a horizontal
// gradient that flows left→right — as coloured rows for the banner to draw.
//
// Motion is time-based (a millisecond clock advanced by a fixed interval), so the
// sweep speed is identical on fast and slow machines. The caller passes a
// `visible` ref that gates advancement, so the loop goes idle — no ticks, no
// re-renders — whenever the banner is scrolled off-screen. When disabled or under
// reduced motion, no timer starts and a calm, static (phase 0) frame is returned.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { renderLogo, labelRow, type Seg } from './ascii/logo.js';
import { colorizeGradient } from './ascii/gradient.js';

export interface LogoAnimationOptions {
  width: number;
  height: number; // canvas rows (a label row is appended when showLabel)
  colors: string[]; // ≥3 theme colours the gradient cycles through
  fps: number;
  color: boolean; // false under NO_COLOR → block glyphs, no colour
  enabled: boolean; // false → static frame, no timer
  reducedMotion?: boolean; // true → static frame, no timer
  showLabel?: boolean;
  label?: string; // caption under the logo (blank keeps the row for layout)
  cycles?: number; // colour cycles across the width (default 1)
  periodMs?: number; // time for one full left→right sweep (default 4200)
  visible: MutableRefObject<boolean>; // advance only while the banner shows
}

/**
 * Returns the current animation frame as `height` (+1 label) rows of coloured
 * segments. Always returns a frame — a calm static logo when not animating — so
 * the banner can render it uniformly.
 */
export function useLogoAnimation(opts: LogoAnimationOptions): Seg[][] {
  const {
    width,
    height,
    colors,
    fps,
    color,
    enabled,
    reducedMotion,
    showLabel = true,
    label = '',
    cycles = 1,
    periodMs = 4200,
    visible,
  } = opts;
  const [timeMs, setTimeMs] = useState(0);
  const animating = enabled && !reducedMotion;

  useEffect(() => {
    if (!animating) return;
    const step = Math.max(1, Math.round(1000 / fps));
    const id = setInterval(() => {
      if (visible.current) setTimeMs((t) => t + step);
    }, step);
    return () => clearInterval(id);
  }, [animating, fps, visible]);

  const palette = colors.length ? colors : ['#888888'];
  const paletteKey = palette.join(',');

  return useMemo(() => {
    const rows = renderLogo(width, height);
    const phase = animating ? (timeMs % periodMs) / periodMs : 0;
    const segs = colorizeGradient(rows, palette, phase, { cycles, color });
    if (showLabel) segs.push(labelRow(label, width, palette[0]!, color));
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, timeMs, width, height, color, showLabel, label, cycles, periodMs, paletteKey]);
}
