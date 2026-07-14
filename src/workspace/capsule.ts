import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { projectDir } from './project.js';

/**
 * A reproducible record of one experiment run: the exact code, the environment
 * it ran in, git state, input/output file hashes, parsed metrics, and full
 * output. Written to runs/<id>/capsule.json alongside stdout/stderr, the code
 * file, and a generated repro.sh. This is the unit the provenance layer (later
 * phases) traces back to.
 */
export interface Capsule {
  id: string;
  language: string;
  code: string;
  cwd: string;
  git: { commit: string; dirty: boolean } | null;
  /** Reproducibility-relevant env vars only (allowlisted — never secrets). */
  env: Record<string, string>;
  seeds: Record<string, string>;
  metrics: Record<string, number>;
  inputHashes: Record<string, string>;
  /** sha256 of files created or changed under results/ during the run. */
  outputHashes: Record<string, string>;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  /** Absolute path to the per-experiment uv project directory (experiments/<name>). */
  uvExpDir?: string;
}

/**
 * Env vars that affect reproducibility and are safe to record. Deliberately an
 * allowlist — the full process env may hold tokens/keys and must never be dumped.
 */
export const ENV_ALLOWLIST = [
  'PYTHONHASHSEED',
  'PYTHONDONTWRITEBYTECODE',
  'CUDA_VISIBLE_DEVICES',
  'HF_HOME',
  'OMP_NUM_THREADS',
  'MKL_NUM_THREADS',
] as const;

const LANG_EXT: Record<string, string> = { python: 'py', r: 'R', julia: 'jl', shell: 'sh' };
const LANG_RUN: Record<string, string> = {
  python: 'python',
  r: 'Rscript',
  julia: 'julia',
  shell: 'sh',
};

export function captureEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) if (env[k] != null) out[k] = String(env[k]);
  return out;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir: string, base: string, acc: Record<string, string>, cap: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (Object.keys(acc).length >= cap) return;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, base, acc, cap);
    else if (st.isFile()) {
      try {
        acc[relative(base, full)] = sha256File(full);
      } catch {
        /* skip unreadable */
      }
    }
  }
}

/** sha256 of every file under `dir` (bounded), keyed by path relative to `dir`. */
export function snapshotDir(dir: string, cap = 500): Record<string, string> {
  const acc: Record<string, string> = {};
  if (existsSync(dir)) walk(dir, dir, acc, cap);
  return acc;
}

/** Files whose hash is new or changed between two snapshots. */
export function diffSnapshots(
  before: Record<string, string>,
  after: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, h] of Object.entries(after)) if (before[p] !== h) out[p] = h;
  return out;
}

/**
 * Parse metrics from a run. `results/metrics.json` is authoritative; any
 * `METRIC name=value` (or `name: value`) lines in stdout fill in the rest. This
 * is the documented convention the agent is told to follow.
 */
export function parseMetrics(stdout: string, resultsDir: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  try {
    const p = join(resultsDir, 'metrics.json');
    if (existsSync(p)) {
      const obj = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const n = Number(v);
        if (Number.isFinite(n)) metrics[k] = n;
      }
    }
  } catch {
    /* ignore malformed metrics.json */
  }
  for (const m of stdout.matchAll(/^\s*METRIC\s+([\w.-]+)\s*[=:]\s*(-?\d+(?:\.\d+)?)\s*$/gim)) {
    if (!(m[1]! in metrics)) {
      const n = Number(m[2]);
      if (Number.isFinite(n)) metrics[m[1]!] = n;
    }
  }
  return metrics;
}

/** Seeds recorded for the run: PYTHONHASHSEED plus any `SEED name=value` lines. */
export function parseSeeds(stdout: string, env: Record<string, string>): Record<string, string> {
  const seeds: Record<string, string> = {};
  if (env.PYTHONHASHSEED) seeds.PYTHONHASHSEED = env.PYTHONHASHSEED;
  for (const m of stdout.matchAll(/^\s*SEED\s+([\w.-]+)\s*[=:]\s*(\S+)\s*$/gim))
    seeds[m[1]!] = m[2]!;
  return seeds;
}

export function capsuleDir(slug: string, id: string): string {
  return join(projectDir(slug), 'runs', id);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A standalone bash script that reproduces the run from the saved code file. */
export function generateReproSh(c: Capsule): string {
  const ext = LANG_EXT[c.language] ?? 'txt';
  const codeFile = `run.${ext}`;
  const lines = [
    '#!/usr/bin/env bash',
    `# Auto-generated by handoff — reproduces run ${c.id} (recorded ${c.startedAt}).`,
    '# Run from inside this directory: bash repro.sh',
    'set -euo pipefail',
    '',
  ];
  if (c.git) {
    lines.push(
      `# Code was at git commit ${c.git.commit}${c.git.dirty ? ' with uncommitted changes (see git.diff)' : ''}.`,
      `#   git checkout ${c.git.commit}`,
    );
    if (c.git.dirty) lines.push('#   git apply git.diff   # restore the uncommitted changes');
    lines.push('');
  }
  for (const [k, v] of Object.entries(c.env)) lines.push(`export ${k}=${shellQuote(v)}`);
  for (const [k, v] of Object.entries(c.seeds))
    if (!(k in c.env)) lines.push(`export ${k}=${shellQuote(v)}`);
  if (Object.keys(c.env).length || Object.keys(c.seeds).length) lines.push('');
  if (c.uvExpDir) {
    lines.push(
      `# Experiment uv project: ${c.uvExpDir}`,
      `# Dependencies are tracked in that project's pyproject.toml + uv.lock`,
      `uv run --project ${shellQuote(c.uvExpDir)} ${shellQuote(codeFile)}`,
      '',
    );
  } else {
    lines.push(`${LANG_RUN[c.language] ?? 'sh'} ${shellQuote(codeFile)}`, '');
  }
  return lines.join('\n');
}

/** Persist a capsule: capsule.json, the code file, stdout/stderr, git.diff, repro.sh. */
export function writeCapsule(
  slug: string,
  capsule: Capsule,
  io: { stdout: string; stderr: string; gitDiff?: string },
): string {
  const dir = capsuleDir(slug, capsule.id);
  mkdirSync(dir, { recursive: true });
  const ext = LANG_EXT[capsule.language] ?? 'txt';
  writeFileSync(join(dir, 'capsule.json'), JSON.stringify(capsule, null, 2), 'utf-8');
  writeFileSync(join(dir, `run.${ext}`), capsule.code, 'utf-8');
  writeFileSync(join(dir, 'stdout.txt'), io.stdout, 'utf-8');
  writeFileSync(join(dir, 'stderr.txt'), io.stderr, 'utf-8');
  if (io.gitDiff) writeFileSync(join(dir, 'git.diff'), io.gitDiff, 'utf-8');
  writeFileSync(join(dir, 'repro.sh'), generateReproSh(capsule), 'utf-8');
  return dir;
}

export function readCapsule(slug: string, id: string): Capsule | null {
  try {
    const p = join(capsuleDir(slug, id), 'capsule.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as Capsule;
  } catch {
    return null;
  }
}

/** All capsules for a project, oldest first. */
export function listCapsules(slug: string): Capsule[] {
  const runsDir = join(projectDir(slug), 'runs');
  let ids: string[];
  try {
    ids = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return ids
    .map((id) => readCapsule(slug, id))
    .filter((c): c is Capsule => c !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// ── Promotion (canonical runs) ────────────────────────────────────────────────

function promotedPath(slug: string): string {
  return join(projectDir(slug), 'runs', 'promoted.json');
}

export function getPromoted(slug: string): string[] {
  try {
    const p = promotedPath(slug);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as string[]) : [];
  } catch {
    return [];
  }
}

export function isPromoted(slug: string, id: string): boolean {
  return getPromoted(slug).includes(id);
}

/** Mark a run canonical. Returns false if the run has no capsule. */
export function promoteRun(slug: string, id: string): boolean {
  if (!readCapsule(slug, id)) return false;
  const cur = getPromoted(slug);
  if (!cur.includes(id)) cur.push(id);
  try {
    mkdirSync(join(projectDir(slug), 'runs'), { recursive: true });
    writeFileSync(promotedPath(slug), JSON.stringify(cur, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ── Formatting for the transcript ─────────────────────────────────────────────

export function formatReproPreview(slug: string, c: Capsule): string {
  const dir = capsuleDir(slug, c.id);
  const script = generateReproSh(c);
  return `repro.sh for run ${c.id} → ${join(dir, 'repro.sh')}\n\n${script}`;
}

/** Diff two runs' metrics, env, and code for /compare-runs. */
export function formatCompare(a: Capsule, b: Capsule): string {
  const out: string[] = [`compare ${a.id} → ${b.id}`, ''];

  const keys = Array.from(new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])).sort();
  if (keys.length) {
    out.push('metrics:');
    for (const k of keys) {
      const av = a.metrics[k];
      const bv = b.metrics[k];
      let delta = '';
      if (typeof av === 'number' && typeof bv === 'number') {
        const d = bv - av;
        delta = `  (${d >= 0 ? '+' : ''}${Number(d.toFixed(6))})`;
      }
      out.push(`  ${k}: ${av ?? '—'} → ${bv ?? '—'}${delta}`);
    }
  } else {
    out.push('metrics: (none recorded on either run)');
  }

  out.push('');
  out.push(`code: ${a.code === b.code ? 'identical' : 'DIFFERENT'}`);
  const envA = JSON.stringify(a.env);
  const envB = JSON.stringify(b.env);
  out.push(`env:  ${envA === envB ? 'identical' : 'DIFFERENT'}`);
  const gitA = a.git?.commit ?? 'none';
  const gitB = b.git?.commit ?? 'none';
  if (gitA !== gitB) out.push(`git:  ${gitA.slice(0, 8)} → ${gitB.slice(0, 8)}`);
  return out.join('\n');
}
