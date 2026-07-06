// Point-cloud generators for each mascot shape. Every generator returns points in
// a normalized, centered box (roughly [-1, 1]); the renderer rotates, projects, and
// shades them. Shapes are procedural (parametric loops), so they're deterministic
// without any runtime randomness.

import type { Vec3 } from './math.js';
import { normalize } from './math.js';

export type ShapeName =
  | 'mascot'
  | 'web'
  | 'book'
  | 'computer'
  | 'brain'
  | 'lightbulb'
  | 'user';

export interface ShapePoint {
  position: Vec3;
  /** Surface normal for light shading; omitted → shaded by depth only. */
  normal?: Vec3;
  /** Adds to computed brightness (glow, highlights). */
  brightnessBias?: number;
}

export const SHAPE_NAMES: ShapeName[] = ['mascot', 'web', 'book', 'computer', 'brain', 'lightbulb', 'user'];

// ── small point emitters ──────────────────────────────────────────────────────

type Out = ShapePoint[];

/** A full or partial ellipsoid surface, normals pointing outward from its center. */
function ellipsoid(
  out: Out,
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  nLat: number, nLon: number,
  opts: { latFrom?: number; latTo?: number; bias?: number; fold?: number } = {},
): void {
  const latFrom = opts.latFrom ?? -Math.PI / 2;
  const latTo = opts.latTo ?? Math.PI / 2;
  for (let i = 0; i <= nLat; i++) {
    const lat = latFrom + ((latTo - latFrom) * i) / nLat;
    for (let j = 0; j < nLon; j++) {
      const lon = (2 * Math.PI * j) / nLon;
      const fold = opts.fold ? 1 + opts.fold * Math.sin(6 * lon) * Math.sin(5 * lat) : 1;
      const nx = Math.cos(lat) * Math.cos(lon);
      const ny = Math.sin(lat);
      const nz = Math.cos(lat) * Math.sin(lon);
      out.push({
        position: { x: cx + rx * nx * fold, y: cy + ry * ny * fold, z: cz + rz * nz * fold },
        normal: normalize({ x: nx, y: ny, z: nz }),
        ...(opts.bias != null ? { brightnessBias: opts.bias } : {}),
      });
    }
  }
}

/** A ring (circle) in the plane whose axis is 'x' | 'y' | 'z'. */
function ring(
  out: Out,
  cx: number, cy: number, cz: number,
  r: number, axis: 'x' | 'y' | 'z', n: number, bias = 0,
): void {
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    const p =
      axis === 'z' ? { x: cx + u, y: cy + v, z: cz }
      : axis === 'y' ? { x: cx + u, y: cy, z: cz + v }
      : { x: cx, y: cy + u, z: cz + v };
    out.push({ position: p, brightnessBias: bias });
  }
}

/** A straight segment of `n` points from a → b. */
function segment(out: Out, a: Vec3, b: Vec3, n: number, bias = 0): void {
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    out.push({
      position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
      brightnessBias: bias,
    });
  }
}

/** A filled quad surface (grid), with a constant normal. */
function quad(
  out: Out,
  origin: Vec3, uVec: Vec3, vVec: Vec3,
  nu: number, nv: number,
  normalV: Vec3, bias = 0,
): void {
  const nrm = normalize(normalV);
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu;
      const v = j / nv;
      out.push({
        position: {
          x: origin.x + uVec.x * u + vVec.x * v,
          y: origin.y + uVec.y * u + vVec.y * v,
          z: origin.z + uVec.z * u + vVec.z * v,
        },
        normal: nrm,
        brightnessBias: bias,
      });
    }
  }
}

// ── shapes ──────────────────────────────────────────────────────────────────

// Tilde — a rounded research raven with glasses and a tilde crest.
function mascot(): Out {
  const out: Out = [];
  ellipsoid(out, 0, -0.18, 0, 0.62, 0.66, 0.6, 12, 20);            // body
  ellipsoid(out, 0, 0.52, 0.05, 0.44, 0.42, 0.44, 10, 18);        // head
  // beak: a short cone pointing forward (+z)
  for (let i = 0; i < 5; i++) {
    const r = 0.16 * (1 - i / 5);
    ring(out, 0, 0.46, 0.45 + i * 0.06, r, 'z', 8, 0.15);
  }
  // glasses: two bright rings on the face
  ring(out, -0.17, 0.56, 0.4, 0.13, 'z', 14, 0.5);
  ring(out, 0.17, 0.56, 0.4, 0.13, 'z', 14, 0.5);
  segment(out, { x: -0.04, y: 0.56, z: 0.42 }, { x: 0.04, y: 0.56, z: 0.42 }, 3, 0.4); // bridge
  // tilde crest across the top of the head
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = -0.34 + 0.68 * t;
    out.push({ position: { x, y: 0.94 + 0.09 * Math.sin(t * Math.PI * 2), z: 0.06 }, brightnessBias: 0.35 });
  }
  // little tail feathers
  segment(out, { x: -0.1, y: -0.75, z: -0.35 }, { x: -0.35, y: -0.55, z: -0.55 }, 6);
  segment(out, { x: 0.1, y: -0.75, z: -0.35 }, { x: 0.35, y: -0.55, z: -0.55 }, 6);
  return out;
}

// Spinning wireframe globe: meridians + parallels (the "web").
function web(): Out {
  const out: Out = [];
  const R = 0.95;
  for (let m = 0; m < 10; m++) {
    const lon = (Math.PI * m) / 10;
    for (let i = 0; i <= 30; i++) {
      const lat = -Math.PI / 2 + (Math.PI * i) / 30;
      const nx = Math.cos(lat) * Math.cos(lon);
      const ny = Math.sin(lat);
      const nz = Math.cos(lat) * Math.sin(lon);
      out.push({ position: { x: R * nx, y: R * ny, z: R * nz }, normal: normalize({ x: nx, y: ny, z: nz }), brightnessBias: 0.1 });
    }
  }
  for (let p = 1; p < 7; p++) {
    const lat = -Math.PI / 2 + (Math.PI * p) / 7;
    const r = R * Math.cos(lat);
    const y = R * Math.sin(lat);
    ring(out, 0, y, 0, r, 'y', 34, lat === 0 ? 0.3 : 0.1);
  }
  return out;
}

// Open book: two page surfaces meeting at a spine, with ruled text lines.
function book(): Out {
  const out: Out = [];
  const nx = { x: 0, y: 0.4, z: 0.9 };
  // right + left pages, fanning up-and-back from the spine at bottom center
  quad(out, { x: 0.02, y: -0.5, z: 0.18 }, { x: 0.92, y: 0.12, z: -0.28 }, { x: 0, y: 1.02, z: 0 }, 9, 10, nx, 0.05);
  quad(out, { x: -0.02, y: -0.5, z: 0.18 }, { x: -0.92, y: 0.12, z: -0.28 }, { x: 0, y: 1.02, z: 0 }, 9, 10, { x: 0, y: 0.4, z: 0.9 }, 0.05);
  // spine
  segment(out, { x: 0, y: -0.5, z: 0.2 }, { x: 0, y: 0.55, z: 0.2 }, 12, 0.25);
  // ruled lines (text) on each page
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;
    segment(out, { x: 0.12, y: -0.34 + t * 0.9, z: 0.14 - t * 0.24 }, { x: 0.8, y: -0.24 + t * 0.9, z: -0.12 - t * 0.24 }, 6, 0.3);
    segment(out, { x: -0.12, y: -0.34 + t * 0.9, z: 0.14 - t * 0.24 }, { x: -0.8, y: -0.24 + t * 0.9, z: -0.12 - t * 0.24 }, 6, 0.3);
  }
  return out;
}

// Laptop: a screen plane with an "h>" prompt, hinged to a keyboard base.
function computer(): Out {
  const out: Out = [];
  // screen (tilted slightly back), bright border + faint fill
  quad(out, { x: -0.72, y: -0.02, z: -0.05 }, { x: 1.44, y: 0, z: 0 }, { x: 0, y: 0.78, z: -0.22 }, 12, 7, { x: 0, y: 0.28, z: 0.96 }, 0.05);
  // prompt "h>" near the screen's upper-left
  segment(out, { x: -0.5, y: 0.34, z: -0.12 }, { x: -0.5, y: 0.6, z: -0.16 }, 4, 0.6); // h stem
  segment(out, { x: -0.5, y: 0.47, z: -0.14 }, { x: -0.36, y: 0.47, z: -0.14 }, 3, 0.6);
  segment(out, { x: -0.36, y: 0.34, z: -0.12 }, { x: -0.36, y: 0.47, z: -0.14 }, 3, 0.6);
  segment(out, { x: -0.22, y: 0.34, z: -0.12 }, { x: -0.08, y: 0.47, z: -0.14 }, 3, 0.6); // >
  segment(out, { x: -0.08, y: 0.47, z: -0.14 }, { x: -0.22, y: 0.6, z: -0.16 }, 3, 0.6);
  // keyboard base coming toward the viewer, with key dots
  quad(out, { x: -0.8, y: -0.05, z: 0.02 }, { x: 1.6, y: 0, z: 0 }, { x: 0, y: -0.42, z: 0.5 }, 14, 5, { x: 0, y: 0.9, z: -0.2 });
  return out;
}

// Brain: two wrinkled lobes.
function brain(): Out {
  const out: Out = [];
  ellipsoid(out, -0.28, 0.05, 0, 0.46, 0.52, 0.56, 12, 20, { fold: 0.14, bias: 0.05 });
  ellipsoid(out, 0.28, 0.05, 0, 0.46, 0.52, 0.56, 12, 20, { fold: 0.14, bias: 0.05 });
  // brain stem
  segment(out, { x: 0, y: -0.5, z: 0.1 }, { x: 0, y: -0.85, z: 0.1 }, 5);
  return out;
}

// Lightbulb: glowing bulb, filament, screw base.
function lightbulb(): Out {
  const out: Out = [];
  ellipsoid(out, 0, 0.28, 0, 0.6, 0.66, 0.6, 12, 20, { latFrom: -Math.PI / 4, bias: 0.12 });
  // filament — a bright squiggle inside the bulb
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    out.push({ position: { x: -0.22 + 0.44 * t, y: 0.2 + 0.16 * Math.sin(t * Math.PI * 3), z: 0.05 }, brightnessBias: 0.9 });
  }
  // neck + screw base
  ring(out, 0, -0.34, 0, 0.26, 'y', 16, 0.1);
  ring(out, 0, -0.5, 0, 0.27, 'y', 16, 0.2);
  ring(out, 0, -0.66, 0, 0.24, 'y', 16, 0.1);
  ring(out, 0, -0.82, 0, 0.18, 'y', 12, 0.05);
  return out;
}

// Researcher avatar: head + shoulders silhouette, with glasses.
function user(): Out {
  const out: Out = [];
  ellipsoid(out, 0, 0.5, 0, 0.36, 0.4, 0.36, 10, 18);                        // head
  ring(out, -0.14, 0.52, 0.32, 0.1, 'z', 12, 0.5);                            // glasses
  ring(out, 0.14, 0.52, 0.32, 0.1, 'z', 12, 0.5);
  ellipsoid(out, 0, -0.72, 0, 0.9, 0.7, 0.6, 10, 22, { latTo: 0.35, bias: 0.05 }); // shoulders
  return out;
}

const GENERATORS: Record<ShapeName, () => Out> = {
  mascot, web, book, computer, brain, lightbulb, user,
};

// ── normalization, memoization, resampling ─────────────────────────────────────

/** Center a cloud on its bounding-box midpoint and scale it to fit [-1, 1]. */
function normalizeShape(pts: Out): Out {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.position.x); maxX = Math.max(maxX, p.position.x);
    minY = Math.min(minY, p.position.y); maxY = Math.max(maxY, p.position.y);
    minZ = Math.min(minZ, p.position.z); maxZ = Math.max(maxZ, p.position.z);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 1;
  const s = 1 / half;
  return pts.map((p) => ({
    ...p,
    position: { x: (p.position.x - cx) * s, y: (p.position.y - cy) * s, z: (p.position.z - cz) * s },
  }));
}

const rawCache = new Map<ShapeName, Out>();
const resampleCache = new Map<string, Out>();

/** The normalized point cloud for a shape (memoized). */
export function getShape(name: ShapeName): Out {
  let s = rawCache.get(name);
  if (!s) {
    s = normalizeShape(GENERATORS[name]());
    rawCache.set(name, s);
  }
  return s;
}

/**
 * A shape resampled to exactly `n` points by even fractional sampling — so every
 * shape has matching indices for morphing. Deterministic; memoized per (name, n).
 */
export function getResampled(name: ShapeName, n: number): Out {
  const key = `${name}:${n}`;
  let r = resampleCache.get(key);
  if (r) return r;
  const src = getShape(name);
  const len = src.length;
  r = new Array<ShapePoint>(n);
  for (let i = 0; i < n; i++) r[i] = src[Math.floor((i * len) / n) % len]!;
  resampleCache.set(key, r);
  return r;
}
