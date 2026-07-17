import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentLoop } from '../../src/agent/loop.js';
import { buildSystem, SYSTEM_PROMPT_VERSION } from '../../src/agent/systemPrompt.js';
import type { ChatModel, Message } from '../../src/agent/model.js';
import type {
  Assertion,
  AssertionResult,
  Scenario,
  ScenarioResult,
  Severity,
  Taxonomy,
  ToolTraceEntry,
} from '../schema/types.js';
import { ScenarioMockModel } from './mockModel.js';
import { buildMockRegistry, isNetworkTool } from './mockTools.js';
import { scoreAssertion, type ScoreContext } from '../scorers/index.js';
import { fingerprint, worstSeverity } from '../scorers/taxonomy.js';

export const BASE_SYSTEM_PROMPT =
  'You are Handoff, a local-first research companion. Help the user read papers, ' +
  'validate claims, run reproducible experiments, write and cite LaTeX, manage ' +
  'evidence, and trace every claim to its source. Use tools for all file and search ' +
  'operations. Be concise and evidence-aware.';

export const RUNNER_VERSION = 1;

export interface RunOptions {
  model?: ChatModel; // inject a real model for live runs; defaults to the scenario mock
  repeatIndex?: number;
  keepSandbox?: boolean;
}

/** Implicit assertions derived from required/forbidden tool lists. */
function effectiveAssertions(s: Scenario): Assertion[] {
  const list = [...(s.expected.assertions ?? [])];
  const types = new Set(list.map((a) => a.type));
  if ((s.expected.requiredTools?.length ?? 0) > 0 && !types.has('required_tools_called')) {
    list.push({ type: 'required_tools_called' });
  }
  if ((s.expected.forbiddenTools?.length ?? 0) > 0 && !types.has('forbidden_tools_not_called')) {
    list.push({ type: 'forbidden_tools_not_called' });
  }
  return list;
}

/**
 * Run a single scenario instance through the real headless agent loop
 * (src/agent/loop.ts) and score it deterministically. For the mocked smoke suite
 * the model and tools are deterministic, so the whole run is reproducible from
 * (scenario id, version, seed). No real workspace, HOME, credentials, or network
 * are touched: file-writing tools operate inside a throwaway sandbox dir.
 */
export async function runScenarioInstance(
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<ScenarioResult> {
  const repeatIndex = opts.repeatIndex ?? 0;
  const seed = scenario.seed ?? 0;
  const sandboxDir = await mkdtemp(
    join(tmpdir(), `handoff-eval-${scenario.id.replace(/[^A-Za-z0-9]/g, '_')}-`),
  );

  const model: ChatModel = opts.model ?? new ScenarioMockModel(scenario.mockModel ?? []);
  const registry = buildMockRegistry(scenario, sandboxDir);
  const system = buildSystem(BASE_SYSTEM_PROMPT, null, {});

  const transcript: { role: string; content: string }[] = [{ role: 'system', content: system }];
  const toolTrace: ToolTraceEntry[] = [];
  let history: Message[] = [];
  let finalAnswer = '';
  let ttft: number | null = null;
  let promptTokens = 0;
  let outputTokens = 0;

  const started = performance.now();
  const perfLimit = scenario.performance?.maximumWallTimeMs;
  const controller = new AbortController();
  const timer = perfLimit ? setTimeout(() => controller.abort(), perfLimit) : null;

  try {
    for (const turn of scenario.turns) {
      transcript.push({ role: 'user', content: turn.user });
      let pendingCall: { name: string; args: string } | null = null;
      for await (const ev of runAgentLoop(turn.user, history, model, registry, {
        signal: controller.signal,
        approve: async () => true,
        askUser: async () => '',
      })) {
        if (ev.type === 'message_delta' && ttft === null) ttft = performance.now() - started;
        else if (ev.type === 'message_end') {
          finalAnswer = ev.content;
          transcript.push({ role: 'assistant', content: ev.content });
        } else if (ev.type === 'tool_call') {
          pendingCall = { name: ev.name, args: ev.args };
        } else if (ev.type === 'tool_result') {
          toolTrace.push({
            name: pendingCall?.name ?? ev.name,
            args: pendingCall?.args ?? '',
            ok: !ev.result.startsWith('Error:'),
            result: ev.result.slice(0, 2000),
            network: isNetworkTool(scenario, ev.name),
          });
          pendingCall = null;
        } else if (ev.type === 'token_stats') {
          promptTokens = ev.promptTokens;
          outputTokens = ev.outputTokens;
        } else if (ev.type === 'done') {
          history = ev.messages;
        } else if (ev.type === 'error') {
          transcript.push({ role: 'error', content: ev.message });
        }
      }
    }

    const wallMs = performance.now() - started;
    const ctx: ScoreContext = { scenario, finalAnswer, transcript, toolTrace, sandboxDir };
    const assertions: AssertionResult[] = effectiveAssertions(scenario).map((a) =>
      scoreAssertion(a, ctx),
    );

    // Performance limit as an implicit assertion.
    if (perfLimit && wallMs > perfLimit) {
      assertions.push({
        type: 'regex',
        passed: false,
        hardGate: false,
        severity: 'medium',
        taxonomy: 'PERFORMANCE_REGRESSION' as Taxonomy,
        detail: `wall time ${Math.round(wallMs)}ms exceeded limit ${perfLimit}ms`,
      });
    }

    const failed = assertions.filter((a) => !a.passed);
    const passed = failed.length === 0;
    const hardGateFailed = failed.some((a) => a.hardGate);
    const severity: Severity | null = worstSeverity(failed.map((a) => a.severity));
    const taxonomy = [...new Set(failed.map((a) => a.taxonomy))];
    const fp = passed
      ? undefined
      : fingerprint(
          scenario.id,
          failed.map((a) => a.type),
          (taxonomy[0] ?? 'NONE') as Taxonomy | 'NONE',
        );

    return {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      seed,
      layer: scenario.layer,
      category: scenario.category,
      difficulty: scenario.difficulty,
      repeatIndex,
      passed,
      skipped: false,
      assertions,
      hardGateFailed,
      severity,
      taxonomy,
      finalAnswer,
      transcript,
      toolTrace,
      artifacts: [],
      timings: { wallMs, timeToFirstTokenMs: ttft },
      tokens: { prompt: promptTokens, output: outputTokens },
      fingerprint: fp,
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (!opts.keepSandbox && scenario.cleanup !== false) {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export { SYSTEM_PROMPT_VERSION };
