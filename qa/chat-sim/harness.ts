import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, isAbsolute } from 'path';
import { homedir } from 'os';

import { runAgentLoop, type AgentEvent } from '../../src/agent/loop.js';
import { buildSystem } from '../../src/agent/systemPrompt.js';
import { loadConfig } from '../../config/schema.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerBuiltins } from '../../src/tools/builtin.js';
import { registerResearchTools } from '../../src/research/tools.js';
import { registerSkillTools } from '../../src/skills/tools.js';
import { registerWorkspaceTools } from '../../src/workspace/tools.js';
import { registerOverleafTools } from '../../src/workspace/overleaf.js';
import { registerRunnerTools } from '../../src/workspace/runner.js';
import { registerReportTools } from '../../src/workspace/report.js';
import {
  getActiveProject,
  resolveWorkspacePath,
  projectPaths,
} from '../../src/workspace/project.js';
import { createModel, type ChatModel, type Message } from '../../src/agent/model.js';

import { MockChatModel } from './mockModel.js';
import { QaLogger, truncate } from './logger.js';
import { executeCommand } from './commands.js';
import type {
  AssertionResult,
  CheckApi,
  FileSnapshot,
  QaLogEvent,
  Scenario,
  ScenarioContext,
} from './types.js';

const DEFAULT_TURN_TIMEOUT_MS = 15_000;

export interface ScenarioOutcome {
  scenarioId: string;
  passed: boolean;
  failures: number;
  warnings: number;
  errors: number;
  timeouts: number;
}

/**
 * How to drive the model. Default (mock) is deterministic and offline. In
 * `real` mode the scenarios run against an actual local model built from the
 * user's config, so the agent generates its own responses + tool calls; the
 * scripted mock steps are ignored, and content assertions become warnings
 * (only crashes / uncaught errors / timeouts fail the run).
 */
export interface RunOptions {
  realModel?: boolean;
  modelBackend?: string;
  modelId?: string;
  ollamaBaseUrl?: string;
}

function buildRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  registerBuiltins(r);
  registerResearchTools(r);
  registerSkillTools(r);
  registerWorkspaceTools(r);
  registerOverleafTools(r);
  registerRunnerTools(r);
  registerReportTools(r);
  return r;
}

/** Race a promise against a wall-clock timeout; resolves to 'timeout' if it wins. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), ms))]);
}

function snapshotFile(absPath: string): FileSnapshot {
  if (!existsSync(absPath)) return { path: absPath, exists: false };
  try {
    const st = statSync(absPath);
    const buf = readFileSync(absPath);
    const snap: FileSnapshot = {
      path: absPath,
      exists: true,
      sizeBytes: st.size,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
    if (st.size <= 4096) snap.preview = truncate(buf.toString('utf-8'));
    return snap;
  } catch {
    return { path: absPath, exists: true };
  }
}

/** Build the read-only CheckApi over the scenario's captured events + filesystem. */
function makeCheckApi(homeDir: string, events: QaLogEvent[]): CheckApi {
  const resolvePath = (p: string): string => (isAbsolute(p) ? p : resolveWorkspacePath(p));
  return {
    homeDir,
    events,
    fileExists: (p) => existsSync(resolvePath(p)),
    readFile: (p) => {
      try {
        return readFileSync(resolvePath(p), 'utf-8');
      } catch {
        return null;
      }
    },
    activeProjectSlug: () => getActiveProject()?.slug ?? null,
    projectPath: (sub) => {
      const meta = getActiveProject();
      if (!meta) return null;
      return sub ? join(projectPaths(meta.slug).root, sub) : projectPaths(meta.slug).root;
    },
    toolResults: (name) =>
      events
        .filter((e) => e.kind === 'tool_result' && (!name || e.toolCall?.name === name))
        .map((e) => ({
          name: e.toolCall?.name ?? '',
          ok: e.toolResult?.ok ?? false,
          ...(e.toolResult?.outputPreview !== undefined
            ? { output: e.toolResult.outputPreview }
            : {}),
          ...(e.toolResult?.error ? { error: e.toolResult.error } : {}),
        })),
    assistantTexts: () =>
      events.filter((e) => e.kind === 'assistant_text').map((e) => e.message ?? ''),
    errors: () => events.filter((e) => e.kind === 'error' || e.kind === 'timeout'),
  };
}

/**
 * Run a single scenario to completion in the current (already-isolated) process.
 * Drives the real agent loop with the mock model for chat turns and the headless
 * command executor for slash turns, enforcing a per-turn timeout, logging every
 * event, and running the scenario's assertions at the end.
 */
export async function runScenario(
  scenario: Scenario,
  ctx: ScenarioContext,
  logger: QaLogger,
  runOpts: RunOptions = {},
): Promise<ScenarioOutcome> {
  const started = Date.now();
  const realModel = runOpts.realModel === true;

  // Seed a deterministic config for this scenario. `backend` must be a valid
  // enum value or loadConfig's safeParse discards the whole stored config and
  // reverts to defaults. In mock mode the model is injected directly (backend is
  // cosmetic); in real mode we point config at the user's actual backend/model
  // so createModel() builds a live client.
  const cfgDir = join(homedir(), '.handoff');
  mkdirSync(cfgDir, { recursive: true });
  const baseConfig = {
    backend: realModel ? (runOpts.modelBackend ?? 'ollama') : 'ollama',
    modelId: realModel ? (runOpts.modelId ?? 'qwen3:8b') : 'mock:chat-sim',
    mode: 'auto',
    ...(realModel && runOpts.ollamaBaseUrl ? { ollamaBaseUrl: runOpts.ollamaBaseUrl } : {}),
    ...(scenario.config ?? {}),
  };
  // Only pre-write config when the scenario didn't seed its own (corrupt-state
  // scenarios write their own config.json in setup()).
  if (!scenario.config || !('__rawConfig' in scenario.config)) {
    try {
      writeFileSync(join(cfgDir, 'config.json'), JSON.stringify(baseConfig, null, 2), 'utf-8');
    } catch {
      /* setup may recreate it */
    }
  }

  if (scenario.setup) await scenario.setup(ctx);

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    logger.error({
      message: `loadConfig threw: ${err instanceof Error ? err.message : String(err)}`,
    });
    config = null;
  }

  logger.scenarioStart(ctx.seed, ctx.homeDir, {
    backend: config?.backend,
    modelId: config?.modelId,
    mode: config?.mode,
    activeProject: getActiveProject()?.slug ?? null,
    theme: config?.theme,
  });

  const registry = buildRegistry();
  const mock = realModel ? null : new MockChatModel();
  const model: ChatModel = mock ?? createModel(config!);
  const approve = (name: string, args: string): Promise<boolean> =>
    Promise.resolve(scenario.approve ? scenario.approve(name, args) : true);
  const askUser = (question: string, options: string[]): Promise<string> =>
    Promise.resolve(scenario.askUser ? scenario.askUser(question, options) : (options[0] ?? ''));

  const turns = scenario.turns ?? scenario.build?.(ctx) ?? [];
  const systemPrompt = config?.systemPrompt ?? 'You are handoff.';
  let history: Message[] = [
    { role: 'system', content: buildSystem(systemPrompt, getActiveProject(), {}) },
  ];
  const turnTimeout = scenario.turnTimeoutMs ?? (realModel ? 120_000 : DEFAULT_TURN_TIMEOUT_MS);

  let toolCalls = 0;
  let writes = 0;

  for (const turn of turns) {
    if (turn.type === 'command') {
      logger.command(turn.command);
      const res = await withTimeout(executeCommand(turn.command), turnTimeout);
      if (res === 'timeout') {
        logger.timeout(`command timed out: ${turn.command}`);
        continue;
      }
      logger.assistantText(res.output);
      if (res.output.startsWith('COMMAND_ERROR')) logger.error({ message: res.output });
      continue;
    }

    // Chat turn. In mock mode, enqueue the scenario's planned steps (default to
    // a short reply). In real mode the model generates its own response, so the
    // scripted steps are ignored.
    if (mock) {
      mock.enqueue(
        turn.steps && turn.steps.length ? turn.steps : [{ kind: 'text', text: 'Understood.' }],
      );
    }
    logger.userMessage(turn.text);

    const ac = new AbortController();
    let assistantText = '';
    // A scenario may deliberately interrupt a turn (e.g. Esc during a slow
    // stream). That abort is expected — it yields a 'cancelled' event, not a
    // timeout failure.
    const interruptTimer =
      turn.interruptAfterMs != null ? setTimeout(() => ac.abort(), turn.interruptAfterMs) : null;
    const drain = (async () => {
      // Rebuild the system prompt each turn so project context reflects state.
      history[0] = { role: 'system', content: buildSystem(systemPrompt, getActiveProject(), {}) };
      for await (const ev of runAgentLoop(turn.text, history.slice(1), model, registry, {
        signal: ac.signal,
        approve,
        askUser,
        // Disable extended thinking in real-model mode: qwen3 and similar
        // reasoning models spend minutes in <think> between tool calls and
        // time out before answering. The QA harness only needs tool calls +
        // answers, not chain-of-thought quality.
        think: !realModel,
      })) {
        handleEvent(ev);
      }
    })();

    function handleEvent(ev: AgentEvent): void {
      switch (ev.type) {
        case 'message_delta':
          assistantText += ev.text;
          break;
        case 'message_end':
          if (ev.content.trim()) logger.assistantText(ev.content);
          break;
        case 'tool_call': {
          toolCalls++;
          let parsed: unknown = ev.args;
          try {
            parsed = JSON.parse(ev.args);
          } catch {
            /* keep raw string */
          }
          logger.toolCall(ev.name, parsed);
          break;
        }
        case 'tool_result': {
          const ok = !/^Error:|^Denied|^Blocked|^Refused/i.test(ev.result.trim());
          if (/^(Wrote|Created|Edited|Appended|Added)/i.test(ev.result)) writes++;
          logger.toolResult(ev.name, ok, ev.result, ok ? undefined : ev.result);
          break;
        }
        case 'reasoning':
          logger.appEvent('reasoning');
          break;
        case 'error':
          logger.error({ message: ev.message });
          break;
        case 'cancelled':
          logger.appEvent('cancelled');
          break;
        case 'done':
          history = [history[0]!, ...ev.messages];
          break;
        case 'message_start':
          break;
      }
    }

    const result = await withTimeout(
      drain.catch((err) => {
        logger.error({
          name: err instanceof Error ? err.name : 'Error',
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
        });
      }),
      turnTimeout,
    );
    if (result === 'timeout') {
      ac.abort();
      logger.timeout(`turn timed out after ${turnTimeout}ms: ${turn.text}`);
    }
    if (interruptTimer) clearTimeout(interruptTimer);
    void assistantText;
  }

  // File snapshots.
  if (scenario.snapshot?.length) {
    const snaps = scenario.snapshot.map((p) =>
      snapshotFile(isAbsolute(p) ? p : resolveWorkspacePath(p)),
    );
    logger.fileSnapshot(snaps);
  }

  // Scenario-specific assertions.
  const api = makeCheckApi(ctx.homeDir, logger.events);
  let assertions: AssertionResult[] = [];
  if (scenario.check) {
    try {
      assertions = scenario.check(api);
    } catch (err) {
      assertions = [
        {
          name: 'check() threw',
          passed: false,
          severity: 'failure',
          notes: err instanceof Error ? err.message : String(err),
        },
      ];
    }
  }
  // In real-model mode the agent generates its own responses, so content
  // assertions (e.g. "the model wrote this file") are advisory — downgrade them
  // to warnings. Crashes, uncaught errors, and timeouts still fail the run.
  if (realModel) {
    assertions = assertions.map((a) => (a.passed ? a : { ...a, severity: 'warning' as const }));
  }
  for (const a of assertions) logger.assertion(a);

  const errorEvents = logger.events.filter((e) => e.kind === 'error');
  const timeoutEvents = logger.events.filter((e) => e.kind === 'timeout');
  const warningEvents = logger.events.filter((e) => e.kind === 'warning');
  const failedAssertions = assertions.filter((a) => !a.passed && a.severity === 'failure');
  const warnAssertions = assertions.filter((a) => !a.passed && a.severity === 'warning');

  logger.scenarioEnd(
    {
      durationMs: Date.now() - started,
      turns: turns.length,
      toolCalls,
      writes,
      warnings: warningEvents.length + warnAssertions.length,
      errors: errorEvents.length,
    },
    { activeProject: getActiveProject()?.slug ?? null },
  );

  const passed =
    failedAssertions.length === 0 && errorEvents.length === 0 && timeoutEvents.length === 0;
  return {
    scenarioId: scenario.id,
    passed,
    failures: failedAssertions.length,
    warnings: warningEvents.length + warnAssertions.length,
    errors: errorEvents.length,
    timeouts: timeoutEvents.length,
  };
}
