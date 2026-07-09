import { homedir } from 'os';
import { join } from 'path';
import { statSync } from 'fs';
import { spawn, execFileSync } from 'child_process';

/** True if the path exists — including when it exists but we lack permission. */
function present(dir: string): boolean {
  try {
    statSync(dir);
    return true;
  } catch (e) {
    // The systemd-service dir is owned by the `ollama` user; statting it as
    // another user throws EACCES/EPERM, which still means it exists.
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM';
  }
}

/**
 * Best-effort path where Ollama stores pulled models. The location depends on
 * the install: a manual `ollama serve` uses ~/.ollama/models, while the Linux
 * systemd-service install runs as the `ollama` user (/usr/share/ollama/...).
 */
export function ollamaModelsDir(): string {
  if (process.env['OLLAMA_MODELS']) return process.env['OLLAMA_MODELS'];
  const candidates = [
    join(homedir(), '.ollama', 'models'),
    '/usr/share/ollama/.ollama/models',
    '/var/lib/ollama/.ollama/models',
  ];
  for (const dir of candidates) {
    if (present(dir)) return dir;
  }
  return candidates[0]!; // sensible default if nothing exists yet
}

/** Server-startup performance flags for `ollama serve`. */
export interface OllamaPerfOptions {
  /** Enable flash attention (default true). */
  flashAttention?: boolean;
  /** KV-cache type (default 'q8_0'). Quantized types need flash attention on. */
  kvCacheType?: 'f16' | 'q8_0' | 'q4_0';
  /**
   * Max concurrent request slots (default 1). Ollama sizes the KV cache as
   * `num_ctx × num_parallel`, so its multi-slot default makes a single-user TUI
   * pay several times the KV-cache memory for concurrency it never uses
   * (measured ~+58% resident memory on an M4). Pinning to 1 is a pure win here.
   */
  numParallel?: number;
}

/**
 * Build the environment for `ollama serve` with the perf flags applied. Pure and
 * testable — the flags are read by the server at startup, so they only take
 * effect for a server WE launch (not one that's already running).
 *
 * Flash attention and KV-cache type are config-driven, so an explicit option
 * always wins over the inherited env. `num_parallel` has no config field: an
 * explicit option wins, otherwise an inherited `OLLAMA_NUM_PARALLEL` is honored,
 * otherwise it defaults to 1 (single-user).
 */
export function ollamaServeEnv(
  base: NodeJS.ProcessEnv,
  opts?: OllamaPerfOptions,
): NodeJS.ProcessEnv {
  const flash = opts?.flashAttention !== false; // default on
  const kv = opts?.kvCacheType ?? 'q8_0';
  const parallel =
    opts?.numParallel ?? (base['OLLAMA_NUM_PARALLEL'] ? Number(base['OLLAMA_NUM_PARALLEL']) : 1);
  return {
    ...base,
    OLLAMA_FLASH_ATTENTION: flash ? '1' : '0',
    OLLAMA_KV_CACHE_TYPE: kv,
    OLLAMA_NUM_PARALLEL: String(parallel),
  };
}

/** Spawn `ollama serve` as a detached background process, with perf flags. */
export function startOllamaServe(opts?: OllamaPerfOptions): void {
  // The flags only take effect for a server WE start — if the macOS Ollama.app
  // (or a manual `ollama serve`) is already running, isOllamaRunning()
  // short-circuits and these never apply. Values come from config (/settings);
  // the defaults are flash attention on + q8_0 KV cache + a single request slot.
  const srv = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: ollamaServeEnv(process.env, opts),
  });
  srv.on('error', () => {}); // swallow ENOENT when ollama is not installed
  srv.unref();
}

export async function isOllamaRunning(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function isModelInstalled(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).some((m) => m.name === model || m.name === `${model}:latest`);
  } catch {
    return false;
  }
}

/** List installed Ollama model names via the HTTP API (preferred). */
export async function listInstalledModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** One row of `ollama ps` — a currently-loaded model and where it runs. */
export interface OllamaPsRow {
  name: string;
  size?: string;
  processor?: string; // e.g. "100% GPU", "43%/57% CPU/GPU"
  until?: string;
  /** True only when the processor column is exactly/only GPU. */
  fullGpu: boolean;
  /** True when any part runs on CPU (a spill). */
  cpuSpill: boolean;
}

/**
 * Parse the tabular output of `ollama ps`. Exported for tests. The columns are
 * whitespace-separated with multi-word cells (SIZE = "5.2 GB", PROCESSOR =
 * "100% GPU" or "43%/57% CPU/GPU", UNTIL = "4 minutes from now"). We anchor on
 * the header positions so multi-word cells don't shift the parse.
 */
export function parseOllamaPs(text: string): OllamaPsRow[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0]!;
  const idx = (col: string) => header.indexOf(col);
  const cName = idx('NAME');
  const cId = idx('ID');
  const cSize = idx('SIZE');
  const cProc = idx('PROCESSOR');
  const cUntil = idx('UNTIL');
  if (cName < 0 || cProc < 0) return [];

  const slice = (line: string, start: number, end: number): string =>
    line.slice(start, end < 0 ? undefined : end).trim();

  const rows: OllamaPsRow[] = [];
  for (const line of lines.slice(1)) {
    const name = slice(line, cName, cId >= 0 ? cId : cSize);
    if (!name) continue;
    const size = cSize >= 0 ? slice(line, cSize, cProc) : undefined;
    const processor = slice(line, cProc, cUntil >= 0 ? cUntil : -1);
    const until = cUntil >= 0 ? slice(line, cUntil, -1) : undefined;
    const proc = processor.toLowerCase();
    const cpuSpill = /cpu/.test(proc);
    const fullGpu = /100%\s*gpu/.test(proc) || (/gpu/.test(proc) && !cpuSpill);
    rows.push({
      name,
      ...(size ? { size } : {}),
      processor,
      ...(until ? { until } : {}),
      fullGpu,
      cpuSpill,
    });
  }
  return rows;
}

/** Run `ollama ps` (CLI) and parse it. Returns [] if the binary is missing. */
export function ollamaPs(): OllamaPsRow[] {
  try {
    const out = execFileSync('ollama', ['ps'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseOllamaPs(out);
  } catch {
    return [];
  }
}

/** Find the ps row for a specific model (matching bare or :latest form). */
export function psRowFor(rows: OllamaPsRow[], model: string): OllamaPsRow | undefined {
  return rows.find(
    (r) =>
      r.name === model || r.name === `${model}:latest` || r.name.replace(/:latest$/, '') === model,
  );
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
}

/** Pull a model, invoking onProgress for each streamed status update. */
export async function pullModel(
  baseUrl: string,
  model: string,
  onProgress: (p: PullProgress) => void,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama pull failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as PullProgress & { error?: string };
        if (obj.error) throw new Error(obj.error);
        onProgress(obj);
      } catch (err) {
        if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
          // Ignore partial-line parse errors; rethrow real ones.
          if (!line.includes('{')) continue;
        }
      }
    }
  }
}
