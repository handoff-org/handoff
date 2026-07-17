import { useState, useEffect } from 'react';
import { smoothstep } from './beam.js';

/**
 * Drives the prompt-box border beam. While `enabled`, it advances a millisecond
 * accumulator on a fixed ~50 ms tick (~40 steps per 2 s lap — smoother than the
 * 90 ms braille cadence and independent of it) and returns the eased phase of the
 * current lap as a fraction in [0, 1). `smoothstep` gives the requested ease-in-out
 * motion: the beam starts slow, accelerates through the middle, and eases out at
 * the end of each lap. Returns `null` when disabled so callers can fall back to the
 * static border. The caller gates `enabled` on isLoading + TTY + reduced-motion +
 * NO_COLOR + a minimum width.
 */
const STEP_MS = 50;

export function useBorderBeam({
  enabled,
  periodMs = 2000,
}: {
  enabled: boolean;
  periodMs?: number;
}): number | null {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setMs(0);
      return;
    }
    const id = setInterval(() => setMs((t) => t + STEP_MS), STEP_MS);
    return () => clearInterval(id);
  }, [enabled, periodMs]);

  if (!enabled) return null;
  return smoothstep((ms % periodMs) / periodMs);
}
