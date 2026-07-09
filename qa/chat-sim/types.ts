import type { Message } from '../../src/agent/model.js';

// Shared types for the chat-simulation QA harness. The harness drives handoff's
// real agent loop + workspace/config modules with a deterministic fake model,
// records everything to JSONL, and asserts on the results.

// ── Log schema ────────────────────────────────────────────────────────────────

export type QaLogKind =
  | 'scenario_start'
  | 'scenario_end'
  | 'user_message'
  | 'assistant_text'
  | 'assistant_tool_call'
  | 'tool_result'
  | 'app_event'
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'warning'
  | 'error'
  | 'timeout'
  | 'assertion'
  | 'file_snapshot'
  | 'metric';

export interface AppStateSnapshot {
  backend?: string;
  modelId?: string;
  mode?: string;
  focus?: string;
  activeProject?: string | null;
  theme?: string;
}

export interface FileSnapshot {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  sha256?: string;
  /** Full contents for tiny files only (bounded); omitted for large ones. */
  preview?: string;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  /** 'failure' fails the scenario; 'warning' is recorded but does not fail it. */
  severity: 'failure' | 'warning';
  expected?: unknown;
  actual?: unknown;
  notes?: string;
}

export interface QaLogEvent {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  timestamp: string;
  seq: number;
  kind: QaLogKind;

  message?: string;
  command?: string;
  seed?: number;
  homeDir?: string;

  toolCall?: { id?: string; name: string; args?: unknown };
  toolResult?: { ok: boolean; outputPreview?: string; error?: string };
  appEvent?: { type: string; detail?: string };
  appState?: AppStateSnapshot;
  files?: FileSnapshot[];
  error?: { name?: string; message: string; stack?: string; code?: string };
  assertion?: AssertionResult;
  metrics?: {
    durationMs?: number;
    turns?: number;
    toolCalls?: number;
    writes?: number;
    warnings?: number;
    errors?: number;
  };
  /** Names of the redactors that fired on this event, for transparency. */
  redactions?: string[];
}

// ── Mock model ──────────────────────────────────────────────────────────────

/** A single planned model response (one `chatStream` call = one step). */
export type MockStep =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; calls: MockToolCall[]; text?: string }
  | { kind: 'malformed_tool'; name: string; rawArgs: string; text?: string }
  | { kind: 'duplicate_tool'; call: MockToolCall; text?: string }
  | { kind: 'slow'; text: string; chunkDelayMs?: number }
  | { kind: 'throw'; message: string }
  | { kind: 'overlong'; sizeChars: number }
  | { kind: 'truncated_reasoning' }
  | { kind: 'empty' };

export interface MockToolCall {
  name: string;
  /** Object args are JSON-stringified; a string is passed through verbatim. */
  args: Record<string, unknown> | string;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

/** One turn the simulated user takes: either a chat message or a slash command. */
export type ScenarioTurn =
  | { type: 'chat'; text: string; steps?: MockStep[]; interruptAfterMs?: number }
  | { type: 'command'; command: string };

export interface ScenarioContext {
  seed: number;
  homeDir: string;
}

/** Read-only view of a finished scenario, passed to a scenario's `check`. */
export interface CheckApi {
  homeDir: string;
  events: QaLogEvent[];
  /** True if a path exists. Relative paths resolve inside the active project. */
  fileExists(relOrAbs: string): boolean;
  /** File contents, or null if missing/unreadable. Relative → active project. */
  readFile(relOrAbs: string): string | null;
  activeProjectSlug(): string | null;
  /** Absolute path inside the active project (optionally a subpath), or null. */
  projectPath(sub?: string): string | null;
  /** Tool results captured this scenario, optionally filtered by tool name. */
  toolResults(name?: string): { name: string; ok: boolean; output?: string; error?: string }[];
  /** Assistant text turns captured this scenario. */
  assistantTexts(): string[];
  /** Error + timeout events captured this scenario. */
  errors(): QaLogEvent[];
}

export interface Scenario {
  id: string;
  name: string;
  /** Include in the fast CI smoke suite (no network, no real model, < a few s). */
  smoke?: boolean;
  /**
   * Skip this scenario in --real-model mode. Use for scenarios whose setup
   * patches low-level globals (e.g. fetch) in ways that also break the real
   * model connection, making them unmeaningful against a live backend.
   */
  skipRealModel?: boolean;
  /** Written into the temp config.json before the scenario runs. */
  config?: Record<string, unknown>;
  /** Prepare the temp HOME (e.g. seed corrupt files) before turns run. */
  setup?: (ctx: ScenarioContext) => void | Promise<void>;
  /** The simulated user's turns. `build(seed)` is used for randomized scenarios. */
  turns?: ScenarioTurn[];
  build?: (ctx: ScenarioContext) => ScenarioTurn[];
  /** Approve tool calls? Default true (auto mode). Return false to deny. */
  approve?: (name: string, args: string) => boolean;
  /** Answer for the interactive ask_user tool (default: first option, else ''). */
  askUser?: (question: string, options: string[]) => string;
  /** Files to snapshot into the log at scenario end (project-relative or absolute). */
  snapshot?: string[];
  /** Per-turn timeout override (ms). */
  turnTimeoutMs?: number;
  /** Scenario-specific assertions, run at scenario end over the captured log. */
  check?: (api: CheckApi) => AssertionResult[];
}

export type { Message };
