// The morph-mascot animation controller: a fixed-timestep hook that advances a
// timeline and returns the current frame as colored rows for the banner to draw.
//
// Motion is time-based (a millisecond clock advanced by a fixed interval), so the
// spin/morph speed is identical on fast and slow machines. The caller passes a
// `visible` ref that gates advancement, so the loop goes idle — no ticks, no
// re-renders — whenever the banner is scrolled off-screen. When disabled or under
// reduced motion, no timer starts and a calm, static mascot frame is returned.

import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { getShapeTransition, labelFor, renderMorph } from './ascii/AsciiMorphRenderer.js';
import { colorizeFrame, labelRow, type Seg } from './ascii/colorize.js';

export interface MorphMascotOptions {
  width: number;
  height: number; // canvas rows (a label row is appended when showLabel)
  base: string; // mascot color (already matte-adjusted by the caller)
  fps: number;
  color: boolean; // false under NO_COLOR → monochrome, same motion
  enabled: boolean; // false → static frame, no timer
  reducedMotion?: boolean; // true → static calm frame, no timer
  showLabel?: boolean;
  visible: MutableRefObject<boolean>; // advance only while the banner shows
}

/**
 * Returns the current animation frame as `height` (+1 label) rows of colored
 * segments. Always returns a frame — a calm static mascot when not animating —
 * so the banner can render it uniformly.
 */
export function useMorphMascot(opts: MorphMascotOptions): Seg[][] {
  const { width, height, base, fps, color, enabled, reducedMotion, showLabel = true, visible } = opts;
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

  return useMemo(() => {
    const rows = renderMorph({
      width,
      height,
      timeMs: animating ? timeMs : 0,
      reducedMotion: !animating,
    });
    const segs = colorizeFrame(rows, base, color);
    if (showLabel) {
      const shape = animating ? getShapeTransition(timeMs).from : 'mascot';
      segs.push(labelRow(labelFor(shape), width, base, color));
    }
    return segs;
  }, [animating, timeMs, width, height, base, color, showLabel]);
}
