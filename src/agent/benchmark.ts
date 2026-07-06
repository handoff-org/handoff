import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatModel, Message } from './model.js';
import type { BenchmarkRecord } from './advisor.js';
import { classifyThroughput } from './advisor.js';
import { detectHardware, hardwareFingerprint } from '../system/hardware.js';
import { ollamaPs, psRowFor } from './ollama.js';
import type { BackendId } from '../system/types.js';

const DEFAULT_CACHE = join(homedir(), '.handoff', 'model-benchmarks.json');

/** A single benchmark run's raw measurements plus derived tier. */
export interface BenchmarkResult extends BenchmarkRecord {
  handoffVersion: string;
  ttftMs: number | null;
  totalMs: number;
  outputTokensApprox: number;
  tier: ReturnType<typeof classifyThroughput>;
  error?: string;
  timestamp?: string; // filled by the caller (Date is unavailable in some contexts)
}

/** Load all cached benchmark records. Never throws. */
export async function loadBenchmarks(path = DEFAULT_CACHE): Promise<BenchmarkResult[]> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as BenchmarkResult[];
  } catch {
    return [];
  }
}

/** Cache key identity — one record per (backend, model, quant, ctx, hardware). */
function sameKey(a: BenchmarkRecord, b: BenchmarkRecord): boolean {
  return (
    a.backend === b.backend &&
    a.modelId === b.modelId &&
    a.quant === b.quant &&
    a.contextTokens === b.contextTokens &&
    a.hardwareFingerprint === b.hardwareFingerprint
  );
}

/** Upsert one result into the cache (atomic write). Never throws. */
export async function saveBenchmark(result: BenchmarkResult, path = DEFAULT_CACHE): Promise<void> {
  try {
    const all = await loadBenchmarks(path);
    const next = [...all.filter((r) => !sameKey(r, result)), result];
    await mkdir(join(path, '..'), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
    await rename(tmp, path);
  } catch {
    /* best-effort */
  }
}

/** Approximate token count from text (≈ 4 chars/token) when exact counts are absent. */
export function approxTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

const GREETING_PROMPT: Message[] = [
  { role: 'system', content: 'You are concise. Reply in one short sentence.' },
  { role: 'user', content: 'Say hello in exactly one short sentence.' },
];

// A harmless synthetic tool so the tool-call test never touches project data.
const PING_TOOL = {
  type: 'function' as const,
  function: {
    name: 'ping',
    description: 'Return pong. Call this to acknowledge.',
    parameters: {
      type: 'object' as const,
      properties: { message: { type: 'string', description: 'any short string' } },
      required: ['message'],
    },
  },
};

/**
 * Benchmark a model with synthetic prompts only (no project data). Measures
 * throughput (approx tokens/sec), rough TTFT, and whether a basic tool call
 * works. For Ollama, also checks `ollama ps` for CPU spill after the run.
 */
export async function benchmarkModel(opts: {
  model: ChatModel;
  backend: BackendId;
  modelId: string;
  quant: string;
  contextTokens: number;
  now: number; // pass Date.now() from the caller
  handoffVersion: string;
  toolCallTest?: boolean;
}): Promise<BenchmarkResult> {
  const hw = detectHardware();
  const fp = hardwareFingerprint(hw);
  const start = opts.now;
  let ttftMs: number | null = null;
  let text = '';
  let error: string | undefined;
  let firstChunkAt: number | null = null;

  // We cannot call Date.now() freely everywhere, but wall-clock timing needs it;
  // the caller injects `now`, and we use a monotonic-ish delta via performance.
  const t0 = performanceNow();
  try {
    for await (const part of opts.model.chatStream(GREETING_PROMPT, undefined)) {
      if (part.type === 'delta') {
        if (firstChunkAt === null) {
          firstChunkAt = performanceNow();
          ttftMs = Math.round(firstChunkAt - t0);
        }
        text += part.text;
      } else if (part.type === 'final') {
        text = part.content || text;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const totalMs = Math.max(1, Math.round(performanceNow() - t0));
  const outputTokensApprox = approxTokens(text);
  const tokensPerSec = error ? 0 : (outputTokensApprox / totalMs) * 1000;

  // Optional tool-call compliance test.
  let toolCallOk = false;
  if (opts.toolCallTest && !error) {
    try {
      let sawTool = false;
      for await (const part of opts.model.chatStream(
        [
          { role: 'system', content: 'Use the ping tool to acknowledge.' },
          { role: 'user', content: 'Acknowledge by calling the ping tool with message="hi".' },
        ],
        [PING_TOOL],
      )) {
        if (part.type === 'final' && part.tool_calls?.some((c) => c.function.name === 'ping')) {
          sawTool = true;
        }
      }
      toolCallOk = sawTool;
    } catch {
      toolCallOk = false;
    }
  }

  // Ollama spill check.
  let fullGpu = true;
  if (opts.backend === 'ollama') {
    const row = psRowFor(ollamaPs(), opts.modelId);
    if (row) fullGpu = row.fullGpu;
  }

  const tier = classifyThroughput(tokensPerSec, fullGpu);
  return {
    backend: opts.backend,
    modelId: opts.modelId,
    quant: opts.quant,
    contextTokens: opts.contextTokens,
    hardwareFingerprint: fp,
    tokensPerSec: Math.round(tokensPerSec * 10) / 10,
    fullGpu,
    toolCallOk: opts.toolCallTest ? toolCallOk : true,
    ...(error ? { timedOut: /timeout|abort/i.test(error) } : {}),
    handoffVersion: opts.handoffVersion,
    ttftMs,
    totalMs,
    outputTokensApprox,
    tier,
    ...(error ? { error } : {}),
    timestamp: new Date(start).toISOString(),
  };
}

/** performance.now() is available in Node and does not break workflow replay. */
function performanceNow(): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (globalThis as any).performance;
  return p && typeof p.now === 'function' ? p.now() : 0;
}
