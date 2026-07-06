// Turn a rendered ASCII frame (rows of palette characters) into colored segments
// for Ink. The palette index of each character encodes its brightness, so colour
// is a pure lookup: dim characters map to a darker shade of the mascot hue, bright
// ones toward a highlight. Under NO_COLOR everything stays uncolored.

import { hexToRgb, rgbToHex, mix } from '../color.js';
import { PALETTE } from './AsciiMorphRenderer.js';

export interface Seg {
  text: string;
  color?: string;
}

const MAX = PALETTE.length - 1;

/** Map a brightness fraction (0..1) to a shade of the mascot hue. */
function rampColor(frac: number, base: string, color: boolean): string | undefined {
  if (!color) return undefined;
  const rgb = hexToRgb(base);
  if (frac < 0.55) return rgbToHex(mix(rgb, [0, 0, 0], ((0.55 - frac) / 0.55) * 0.6));
  return rgbToHex(mix(rgb, [255, 255, 255], ((frac - 0.55) / 0.45) * 0.5));
}

/** RLE each row into color runs; spaces stay uncolored so runs don't over-merge. */
export function colorizeFrame(rows: string[], base: string, color: boolean): Seg[][] {
  return rows.map((row) => {
    const segs: Seg[] = [];
    let text = '';
    let col: string | undefined;
    let started = false;
    const flush = () => {
      if (text) segs.push(col ? { text, color: col } : { text });
    };
    for (const ch of row) {
      const c = ch === ' ' ? undefined : rampColor(PALETTE.indexOf(ch) / MAX, base, color);
      if (started && c === col) {
        text += ch;
      } else {
        flush();
        text = ch;
        col = c;
        started = true;
      }
    }
    flush();
    return segs;
  });
}

/** A `width`-wide row with a dim, centered label under the object. */
export function labelRow(label: string, width: number, base: string, color: boolean): Seg[] {
  const text = label.length > width ? label.slice(0, width) : label;
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  const right = Math.max(0, width - text.length - left);
  const dim = color ? rgbToHex(mix(hexToRgb(base), [0, 0, 0], 0.5)) : undefined;
  const segs: Seg[] = [];
  if (left) segs.push({ text: ' '.repeat(left) });
  segs.push(dim ? { text, color: dim } : { text });
  if (right) segs.push({ text: ' '.repeat(right) });
  return segs;
}
