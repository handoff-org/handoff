// Small, dependency-free 3D math for the ASCII morph mascot renderer.
// Pure functions only — no state, no side effects, deterministic.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Smooth Hermite interpolation on [0,1] — eases the morph in and out. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function rotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

export function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export interface Projected {
  sx: number; // screen column (float)
  sy: number; // screen row (float)
  depth: number; // 1/(z+zOffset) — larger = closer
}

/**
 * Perspective projection into a width×height character grid. Terminal cells are
 * about twice as tall as they are wide, so x is scaled ~2× relative to y
 * (`aspect`) to keep shapes from looking squashed.
 */
export function project(
  p: Vec3,
  width: number,
  height: number,
  zOffset = 4,
  aspect = 2.0,
): Projected {
  const inv = 1 / (p.z + zOffset);
  const scale = height * 1.15; // fraction of the canvas the object fills
  const sx = width / 2 + p.x * scale * aspect * inv;
  const sy = height / 2 - p.y * scale * inv;
  return { sx, sy, depth: inv };
}

/** Deterministic PRNG (mulberry32). Seed in, repeatable stream out. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
