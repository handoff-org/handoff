import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolRegistry } from '../tools/registry.js';
import { getActiveProject, projectDir } from './project.js';
import { appendRun } from './ledger.js';
import { appendNotebook } from '../research/notebook.js';
import { gitState } from '../util/git.js';
import {
  captureEnv,
  diffSnapshots,
  parseMetrics,
  parseSeeds,
  snapshotDir,
  writeCapsule,
  type Capsule,
} from './capsule.js';

type Language = 'python' | 'r' | 'julia' | 'shell';
const LANGUAGES: Language[] = ['python', 'r', 'julia', 'shell'];

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n… (truncated)' : s;
}

let idSeq = 0;
function shortId(): string {
  idSeq = (idSeq + 1) % 1296; // two base-36 digits, avoids same-ms collisions
  return Date.now().toString(36) + idSeq.toString(36).padStart(2, '0');
}

// ── Python environment setup ──────────────────────────────────────────────────

let _uvAvail: boolean | null = null;
export function uvAvailable(): boolean {
  if (_uvAvail === null) {
    _uvAvail = spawnSync('uv', ['--version'], { encoding: 'utf-8' }).status === 0;
  }
  return _uvAvail;
}

function toSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'experiment'
  );
}

/**
 * Create or reuse a per-experiment uv project at experiments/<expName>/.
 * Workflow: uv init (if new) → uv add <deps> → returns project dir + script name.
 * The project directory is a self-contained Python project that can be pushed
 * to GitHub and reproduced with `uv sync && uv run <script>`.
 */
function ensureUvProject(
  root: string,
  expName: string,
  deps: string[],
): { expDir: string; scriptName: string } {
  const experimentsDir = join(root, 'experiments');
  const expDir = join(experimentsDir, expName);

  if (!existsSync(expDir)) {
    mkdirSync(experimentsDir, { recursive: true });
    const r = spawnSync('uv', ['init', expName], {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: experimentsDir,
    });
    if (r.status !== 0) {
      throw new Error(`uv init ${expName} failed: ${(r.stderr ?? '').slice(0, 300)}`);
    }
  }

  if (deps.length > 0) {
    spawnSync('uv', ['add', ...deps], {
      encoding: 'utf-8',
      timeout: 120_000,
      cwd: expDir,
    });
  }

  return { expDir, scriptName: `${expName}.py` };
}

/**
 * Fallback Python environment (plain venv) for when uv is not available.
 */
interface PythonEnv {
  python: string;
  expDir: string;
}

function ensurePlainVenv(projectSlug: string): PythonEnv {
  const root = projectDir(projectSlug);
  const expDir = join(root, 'experiments');
  const venvDir = join(expDir, '.venv');
  const python =
    process.platform === 'win32'
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python');

  if (existsSync(python)) return { python, expDir };

  if (!existsSync(expDir)) mkdirSync(expDir, { recursive: true });

  const found = ['python3', 'python'].find((bin) => {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf-8' });
    return r.status === 0 && /Python 3/.test(r.stdout + r.stderr);
  });
  if (!found) {
    throw new Error(
      'Python 3 not found. Install it from https://python.org, or install uv: https://docs.astral.sh/uv/',
    );
  }
  const r = spawnSync(found, ['-m', 'venv', venvDir], { encoding: 'utf-8', timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(`venv creation failed: ${(r.stderr ?? '').slice(0, 300)}`);
  }
  return { python, expDir };
}

/**
 * pip-install missing packages from a ModuleNotFoundError stderr (plain venv fallback).
 */
function pipInstall(env: PythonEnv, stderr: string): string[] {
  const missing = new Set<string>();
  for (const m of stderr.matchAll(/ModuleNotFoundError: No module named '([^'.]+)/g)) {
    missing.add(m[1]!);
  }
  if (!missing.size) return [];
  const pip = env.python.endsWith('.exe')
    ? env.python.replace(/python\.exe$/i, 'pip.exe')
    : env.python.replace(/python$/, 'pip');
  const installed: string[] = [];
  for (const pkg of missing) {
    const r = spawnSync(pip, ['install', '--quiet', pkg], { encoding: 'utf-8', timeout: 120_000 });
    if (r.status === 0) installed.push(pkg);
  }
  return installed;
}

interface Runner {
  cmd: string;
  args: string[];
  note?: string;
}

function resolveRunner(lang: Language): Runner {
  switch (lang) {
    case 'r':
      return { cmd: 'Rscript', args: ['-e'] };
    case 'julia':
      return { cmd: 'julia', args: ['-e'] };
    case 'shell':
      return { cmd: 'sh', args: ['-c'] };
    default:
      return { cmd: 'sh', args: ['-c'] };
  }
}

export interface RunRequest {
  language: Language;
  code: string;
  description?: string;
  /** Experiment project name (slug-ified). Creates experiments/<name>/ as a uv project. */
  name?: string;
  /** Python dependencies to pre-install with `uv add` before running. */
  deps?: string[];
}

export interface RunResult {
  capsuleId: string;
  language: Language;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  setupNote: string;
  metrics: Record<string, number>;
  spawnError?: string;
  /** New/changed figure files under results/ (paths relative to the project root). */
  artifacts?: string[];
}

/** Figure/artifact extensions worth surfacing so the agent can view_image them. */
const FIGURE_EXT = /\.(png|jpe?g|gif|webp|svg|pdf)$/i;

/**
 * Execute a run and capture it as a reproducible capsule: snapshot results/
 * before and after (to record output hashes), run the code, parse metrics, and
 * write runs/<id>/{capsule.json, run.<ext>, stdout.txt, stderr.txt, repro.sh}.
 * Also appends the lightweight ledger entry and a NOTEBOOK.md journal line.
 * Shared by the run_code tool and the /rerun command. Throws only on setup
 * failure (e.g. Python 3 / venv not available); execution failures come back in
 * the result's exitCode/stderr.
 */
export function executeRun(slug: string, req: RunRequest): RunResult {
  const lang = req.language;
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`Unknown language "${lang}". Supported: ${LANGUAGES.join(', ')}.`);
  }
  const src = req.code;
  const desc = req.description || `${lang} snippet`;
  const root = projectDir(slug);
  const resultsDir = join(root, 'results');
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

  // ── Execution setup: uv project (Python) or direct runner ────────────────
  let execCmd: string;
  let execArgs: string[];
  let execCwd: string = root;
  let noteText = '';
  let uvExpDir: string | undefined;
  let fallbackEnv: PythonEnv | undefined;

  if (lang === 'python' && uvAvailable()) {
    const expName = toSlug(req.name ?? desc);
    const { expDir, scriptName } = ensureUvProject(root, expName, req.deps ?? []);
    writeFileSync(join(expDir, scriptName), src, 'utf-8');
    execCmd = 'uv';
    execArgs = ['run', scriptName];
    execCwd = expDir;
    noteText = `uv: ${expName}`;
    uvExpDir = expDir;
  } else if (lang === 'python') {
    fallbackEnv = ensurePlainVenv(slug);
    execCmd = fallbackEnv.python;
    execArgs = ['-c', src];
    noteText = 'plain venv';
  } else {
    const runner = resolveRunner(lang);
    execCmd = runner.cmd;
    execArgs = [...runner.args, src];
    noteText = runner.note ?? '';
  }

  const before = snapshotDir(resultsDir);
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const runOnce = () =>
    spawnSync(execCmd, execArgs, {
      encoding: 'utf-8',
      timeout: 120_000,
      cwd: execCwd,
      env,
    });

  let r = runOnce();
  let stdout = r.stdout ?? '';
  let stderr = r.stderr ?? '';
  let exitCode = r.status ?? (r.error ? 1 : 0);

  // Auto-install missing packages and retry once
  if (lang === 'python' && exitCode !== 0 && /ModuleNotFoundError/.test(stderr)) {
    const missing = new Set<string>();
    for (const m of stderr.matchAll(/ModuleNotFoundError: No module named '([^'.]+)/g)) {
      missing.add(m[1]!);
    }
    if (missing.size) {
      const pkgs = [...missing];
      if (uvExpDir) {
        // uv add records deps in pyproject.toml + uv.lock
        spawnSync('uv', ['add', ...pkgs], { encoding: 'utf-8', timeout: 120_000, cwd: uvExpDir });
      } else if (fallbackEnv) {
        pipInstall(fallbackEnv, stderr);
      }
      r = runOnce();
      stdout = r.stdout ?? '';
      stderr = r.stderr ?? '';
      exitCode = r.status ?? (r.error ? 1 : 0);
      noteText += `, installed ${pkgs.join(', ')}`;
    }
  }

  const setupNote = noteText ? ` (${noteText})` : '';
  const durationMs = Date.now() - start;
  const finishedAt = new Date().toISOString();

  const outputHashes = diffSnapshots(before, snapshotDir(resultsDir));
  // Figures created/changed this run — surfaced so the agent can view_image them.
  const artifacts = Object.keys(outputHashes)
    .filter((p) => FIGURE_EXT.test(p))
    .map((p) => join('results', p))
    .sort();
  const metrics = parseMetrics(stdout, resultsDir);
  const capsuleEnv = captureEnv(env);
  const seeds = parseSeeds(stdout, capsuleEnv);
  const git = gitState(root);

  const id = shortId();
  const capsule: Capsule = {
    id,
    language: lang,
    code: src,
    cwd: root,
    git: git ? { commit: git.commit, dirty: git.dirty } : null,
    env: capsuleEnv,
    seeds,
    metrics,
    inputHashes: {},
    outputHashes,
    exitCode,
    durationMs,
    startedAt,
    finishedAt,
    ...(uvExpDir ? { uvExpDir } : {}),
  };
  writeCapsule(slug, capsule, { stdout, stderr, gitDiff: git?.dirty ? git.diff : undefined });

  appendRun(slug, {
    id,
    timestamp: startedAt,
    language: lang,
    description: desc,
    exitCode,
    durationMs,
    stdoutPreview: truncate(stdout, 500),
    stderrPreview: stderr ? truncate(stderr, 200) : undefined,
    capsuleId: id,
    metrics,
  });

  const status = exitCode === 0 ? '✓ success' : `✗ exit ${exitCode}`;
  const metricNote = Object.keys(metrics).length
    ? `\n\nmetrics: ${Object.entries(metrics)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`
    : '';
  appendNotebook(slug, {
    type: 'experiment-run',
    summary: `\`${lang}\` — ${desc} — ${status} (${durationMs}ms) · run ${id}`,
    details:
      (stdout.trim() ? `\`\`\`\n${truncate(stdout, 600)}\n\`\`\`` : '') + metricNote || undefined,
  });

  return {
    capsuleId: id,
    language: lang,
    exitCode,
    durationMs,
    stdout,
    stderr,
    setupNote,
    metrics,
    spawnError: r.error?.message,
    ...(artifacts.length ? { artifacts } : {}),
  };
}

export function registerRunnerTools(registry: ToolRegistry): void {
  // ── run_code ─────────────────────────────────────────────────────────────
  registry.register({
    name: 'run_code',
    description:
      'Execute code in Python, R, Julia, or shell and return the output. ' +
      'For Python experiments, ALWAYS supply `name` (experiment project name) and `deps` ' +
      '(list of required packages). The workflow: ' +
      '1. Reflect on all needed packages. ' +
      '2. Call run_code with name, deps, and code. ' +
      '3. handoff runs: uv init <name> (if new) → uv add <deps> → write script → uv run script. ' +
      'Each experiment gets an isolated uv project at experiments/<name>/ ' +
      '(pyproject.toml + uv.lock), which is GitHub-pushable and reproducible with `uv sync`. ' +
      'If a package is still missing after uv add, handoff installs it automatically and retries; ' +
      'never fall back to run_shell for missing packages. ' +
      'Each run is captured as a reproducible capsule in runs/<id>/ (exact code, ' +
      'env, git state, output-file hashes, and a repro.sh) and logged to the ' +
      'experiment ledger and NOTEBOOK.md. ' +
      'To record metrics, write results/metrics.json (a flat {name: number} object) ' +
      'or print lines like "METRIC accuracy=0.91" — they are parsed into the capsule.',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: LANGUAGES,
          description: 'Language to run the code in',
        },
        code: {
          type: 'string',
          description: 'The code to execute',
        },
        description: {
          type: 'string',
          description: 'One-line description of what this code does (for the run ledger)',
        },
        name: {
          type: 'string',
          description:
            'Experiment project name (e.g. "mnist-cnn", "sentiment-bert"). ' +
            'Creates experiments/<name>/ as an isolated uv project. ' +
            'Required for Python; use a short, descriptive slug.',
        },
        deps: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Python packages to install with `uv add` before running ' +
            '(e.g. ["numpy", "torch", "pandas"]). ' +
            'Reflect on all imports in your code and list them here upfront.',
        },
      },
      required: ['language', 'code'],
    },
    async execute({ language, code, description, name, deps }) {
      const lang = String(language).toLowerCase() as Language;
      if (!LANGUAGES.includes(lang)) {
        return `Unknown language "${lang}". Supported: ${LANGUAGES.join(', ')}.`;
      }
      const meta = getActiveProject();
      if (!meta) return 'No active project. Run `/project new <name>` first.';

      let res: RunResult;
      try {
        res = executeRun(meta.slug, {
          language: lang,
          code: String(code),
          description: description ? String(description) : undefined,
          name: name ? String(name) : undefined,
          deps: Array.isArray(deps) ? deps.map(String) : undefined,
        });
      } catch (e) {
        return `Setup error: ${e instanceof Error ? e.message : String(e)}`;
      }

      const header = `[${res.language}${res.setupNote}] run ${res.capsuleId} · exit ${res.exitCode} · ${res.durationMs}ms`;
      const parts: string[] = [header];
      if (Object.keys(res.metrics).length) {
        parts.push(
          `metrics: ${Object.entries(res.metrics)
            .map(([k, v]) => `${k}=${v}`)
            .join('  ')}`,
        );
      }
      if (res.stdout.trim()) parts.push(`stdout:\n${truncate(res.stdout, 600)}`);
      if (res.stderr.trim()) parts.push(`stderr:\n${truncate(res.stderr, 300)}`);
      if (res.spawnError) parts.push(`spawn error: ${res.spawnError}`);
      if (res.artifacts?.length) {
        parts.push(`figures: ${res.artifacts.join(', ')} — inspect one with view_image`);
      }
      return parts.join('\n\n');
    },
  });

  // ── query_runs ───────────────────────────────────────────────────────────
  registry.register({
    name: 'query_runs',
    description:
      "List recent experiment runs from the active project's ledger. " +
      'Each entry shows the id, timestamp, language, exit code, duration, and description.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max entries to return (default 20)' },
      },
    },
    async execute({ limit }) {
      const meta = getActiveProject();
      if (!meta) return 'No active project.';
      const { readLedger } = await import('./ledger.js');
      const runs = readLedger(meta.slug);
      if (runs.length === 0) return 'No runs logged yet for this project.';
      const n = Math.min(runs.length, limit ? Number(limit) : 20);
      return runs
        .slice(-n)
        .map(
          (r) =>
            `[${r.id}] ${r.timestamp.slice(0, 16)}  ${r.language.padEnd(7)}  ` +
            `exit ${r.exitCode}  ${r.durationMs}ms\n  ${r.description}`,
        )
        .join('\n');
    },
  });
}
