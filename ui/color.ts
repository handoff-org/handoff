/** Shared RGB/hex color math used by the banner, themes, and the palettes. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(c: RGB): string {
  return `#${c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Move `c` a fraction `amt` of the way toward `target`. */
export function mix(c: RGB, target: RGB, amt: number): RGB {
  return [lerp(c[0], target[0], amt), lerp(c[1], target[1], amt), lerp(c[2], target[2], amt)];
}
