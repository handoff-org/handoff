// Renders the handoff `h>` wordmark into a fixed grid of block characters — a
// pure, deterministic function with no React/Ink/terminal side effects. The glyph
// is described in a normalized 0..1 square (u = left→right, v = top→bottom) as a
// set of thick strokes, then rasterized into the canvas so it stays crisp and
// visually SQUARE at any size (terminal cells are ~twice as tall as wide, so the
// vertical axis is scaled by ASPECT). Colour is applied separately by the gradient
// layer — this module only decides which cells are ink and how solid each is.

export interface Seg {
  text: string;
  color?: string;
}

// A terminal cell is roughly twice as tall as it is wide; scaling the vertical
// axis by this keeps the rasterized logo a true visual square (not stretched).
const ASPECT = 2.0;
// Fraction of the available square the glyph fills (leaves a small margin).
const FILL = 0.92;
// Stroke half-width and edge softness, both as a fraction of the square's side
// (in column-width units), so thickness scales with the logo.
const HALF_WIDTH_FRAC = 0.033;
const EDGE_AA = 1.1;

/** A stroke segment in normalized logo space: [u0, v0, u1, v1]. */
type Stroke = [number, number, number, number];

/** Sample the top half of an ellipse into a polyline of stroke segments. */
function arch(cx: number, cyv: number, rx: number, ry: number, steps: number): Stroke[] {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const th = Math.PI * (1 - i / steps); // π → 0, sweeping over the top
    pts.push([cx + rx * Math.cos(th), cyv - ry * Math.sin(th)]);
  }
  const segs: Stroke[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
  }
  return segs;
}

// The `h>` wordmark. A lowercase monoline "h" (full-height stem, a rounded bowl
// arching over to a right leg) followed by a ">" play chevron whose tip points
// right, vertically centred against the h.
const STROKES: Stroke[] = [
  // h — stem (full height) and right leg (from the bowl down to the baseline)
  [0.14, 0.05, 0.14, 0.95],
  [0.45, 0.46, 0.45, 0.95],
  // h — bowl: the top half of an ellipse joining stem to right leg
  ...arch(0.295, 0.46, 0.155, 0.2, 16),
  // > — chevron: two strokes meeting at the tip on the right, vertically
  // centred against the h (kept within the baseline so nothing dangles below).
  [0.60, 0.33, 0.95, 0.6],
  [0.60, 0.87, 0.95, 0.6],
];

/** Distance from point (px,py) to segment (x0,y0)-(x1,y1), all in column units. */
function distToSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Render the logo into exactly `height` strings, each exactly `width` chars.
 * Ink cells are solid/near-solid block glyphs (with a lighter shade at the
 * anti-aliased edge); everything else is a space. Deterministic.
 */
export function renderLogo(width: number, height: number): string[] {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));

  // Fit a square (in column-width units) inside the canvas and centre it.
  const side = Math.min(W, H * ASPECT) * FILL;
  const originX = (W - side) / 2;
  const originYcu = (H * ASPECT - side) / 2;

  // Project the normalized strokes into canvas column-units once.
  const segs = STROKES.map(([u0, v0, u1, v1]) => [
    originX + u0 * side,
    originYcu + v0 * side,
    originX + u1 * side,
    originYcu + v1 * side,
  ] as const);

  const hw = HALF_WIDTH_FRAC * side;

  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let line = '';
    const cy = (r + 0.5) * ASPECT;
    for (let c = 0; c < W; c++) {
      const cx = c + 0.5;
      let d = Infinity;
      for (const s of segs) {
        const dd = distToSeg(cx, cy, s[0], s[1], s[2], s[3]);
        if (dd < d) d = dd;
        if (d <= 0) break;
      }
      // Coverage: fully inside the stroke → 1, fading to 0 across EDGE_AA beyond.
      const cov = d <= hw ? 1 : Math.max(0, 1 - (d - hw) / EDGE_AA);
      line += cov >= 0.55 ? '█' : cov >= 0.18 ? '▓' : ' ';
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
