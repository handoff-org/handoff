// The ASCII morph renderer: a pure, deterministic function that renders one frame
// of the spinning, morphing mascot into a grid of characters. No React, no Ink, no
// terminal side effects — just `renderMorph(opts) -> string[]`.

import { clamp01, dot, lerpVec3, normalize, project, rotateX, rotateY, smoothstep, type Vec3 } from './math.js';
import { getResampled, SHAPE_NAMES, type ShapeName, type ShapePoint } from './shapes.js';

// Luminance ramp: index 0 = darkest/empty-ish, last = brightest/closest. The index
// itself encodes brightness, which the Ink layer reuses to pick a colour.
export const PALETTE = ' .,-~:;=!*#$@';

export const SHAPE_SEQUENCE: ShapeName[] = SHAPE_NAMES;

const SEGMENT_MS = 5000;
const MORPH_START_MS = 3800;
const MORPH_DURATION_MS = SEGMENT_MS - MORPH_START_MS; // 1200

const LABELS: Record<ShapeName, string> = {
  mascot: 'Tilde',
  web: 'web',
  book: 'papers',
  computer: 'terminal',
  brain: 'ideas',
  lightbulb: 'insight',
  user: 'you',
};

export function labelFor(shape: ShapeName): string {
  return LABELS[shape];
}

export interface ShapeTransition {
  from: ShapeName;
  to: ShapeName;
  morphT: number; // 0 while holding, ramps to 1 across the morph window
  segment: number;
}

/** Which shape we're on and how far into a morph, from a timestamp. */
export function getShapeTransition(timeMs: number): ShapeTransition {
  const t = Math.max(0, timeMs);
  const segment = Math.floor(t / SEGMENT_MS);
  const local = t % SEGMENT_MS;
  const from = SHAPE_SEQUENCE[segment % SHAPE_SEQUENCE.length]!;
  const to = SHAPE_SEQUENCE[(segment + 1) % SHAPE_SEQUENCE.length]!;
  const raw = local <= MORPH_START_MS ? 0 : (local - MORPH_START_MS) / MORPH_DURATION_MS;
  return { from, to, morphT: smoothstep(clamp01(raw)), segment };
}

export interface RenderOptions {
  width: number;
  height: number;
  timeMs: number;
  reducedMotion?: boolean;
  /** Override the point budget; otherwise derived from canvas size. */
  points?: number;
}

const LIGHT: Vec3 = normalize({ x: -0.4, y: 0.7, z: 0.8 });

function pointBudget(width: number, height: number): number {
  // Scale density with canvas area so a larger canvas stays defined (not sparse),
  // capped so a big terminal can't make a frame expensive.
  return Math.max(500, Math.min(1600, Math.round(width * height * 1.25)));
}

// depth factor needs recalibration when zOffset changes (see project()).
const DEPTH_BASE = 0.18;

/**
 * Render one frame. Returns exactly `height` strings, each exactly `width`
 * characters. Deterministic: same options → same output.
 *
 * reducedMotion → a fixed, non-spinning three-quarter view of the mascot (no
 * rotation over time, no morph), so the frame is stable across timestamps.
 */
export function renderMorph(opts: RenderOptions): string[] {
  const width = Math.max(1, Math.floor(opts.width));
  const height = Math.max(1, Math.floor(opts.height));
  const n = Math.max(60, Math.min(1600, opts.points ?? pointBudget(width, height)));

  let from: ShapeName, to: ShapeName, morphT: number, spin: number, tilt: number;
  if (opts.reducedMotion) {
    from = 'mascot'; to = 'mascot'; morphT = 0;
    spin = -0.5; tilt = 0.18; // a calm, fixed three-quarter pose
  } else {
    const tr = getShapeTransition(opts.timeMs);
    from = tr.from; to = tr.to; morphT = tr.morphT;
    spin = (opts.timeMs / 1000) * 1.1; // ~1.1 rad/s
    tilt = 0.35 * Math.sin(opts.timeMs / 1400); // gentle nod
  }

  const a = getResampled(from, n);
  const b = morphT > 0 ? getResampled(to, n) : a;

  // char + depth buffers (z-buffer), reused per row via flat arrays.
  const cells = new Array<number>(width * height).fill(-1); // palette index, -1 = empty
  const zbuf = new Array<number>(width * height).fill(-Infinity);

  for (let i = 0; i < n; i++) {
    const pa = a[i]!;
    const p: ShapePoint = morphT > 0 ? morphPoint(pa, b[i]!, morphT) : pa;

    let pos = rotateY(p.position, spin);
    pos = rotateX(pos, tilt);
    const pr = project(pos, width, height);
    const col = Math.round(pr.sx);
    const row = Math.round(pr.sy);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;

    const idx = row * width + col;
    if (pr.depth <= zbuf[idx]!) continue;
    zbuf[idx] = pr.depth;

    // shading: light on the (rotated) normal if present, plus depth and bias.
    let lightDot = 0.6;
    if (p.normal) {
      let nrm = rotateY(p.normal, spin);
      nrm = rotateX(nrm, tilt);
      lightDot = clamp01(dot(nrm, LIGHT) * 0.5 + 0.5);
    }
    const depthFactor = clamp01((pr.depth - DEPTH_BASE) * 2.0);
    const bias = p.brightnessBias ?? 0;
    const brightness = clamp01(0.32 + 0.42 * lightDot + 0.2 * depthFactor + bias);
    cells[idx] = Math.min(PALETTE.length - 1, Math.max(1, Math.round(brightness * (PALETTE.length - 1))));
  }

  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const v = cells[r * width + c]!;
      line += v < 0 ? ' ' : PALETTE[v];
    }
    rows.push(line);
  }
  return rows;
}

function morphPoint(a: ShapePoint, b: ShapePoint, t: number): ShapePoint {
  const point: ShapePoint = { position: lerpVec3(a.position, b.position, t) };
  if (a.normal && b.normal) point.normal = normalize(lerpVec3(a.normal, b.normal, t));
  else if (a.normal) point.normal = a.normal;
  else if (b.normal) point.normal = b.normal;
  const ba = a.brightnessBias ?? 0;
  const bb = b.brightnessBias ?? 0;
  if (ba || bb) point.brightnessBias = ba + (bb - ba) * t;
  return point;
}
