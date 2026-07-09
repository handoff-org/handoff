import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { redactSecrets } from '../../src/util/redact.js';
import type {
  AppStateSnapshot,
  AssertionResult,
  FileSnapshot,
  QaLogEvent,
  QaLogKind,
} from './types.js';

/** Max characters kept for any free-text preview in the log. */
export const PREVIEW_CAP = 2000;

export function truncate(s: string, cap = PREVIEW_CAP): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap) + `\n… [truncated ${s.length - cap} chars]`;
}

/**
 * Redact secrets from a string and report whether anything changed. Reuses the
 * app's own `redactSecrets` (OpenAI/GitHub/AWS/HF keys, bearer tokens, creds in
 * URLs) so the harness logs never leak a token even if a scenario produces one.
 */
function scrub(s: string | undefined): { text: string | undefined; redacted: boolean } {
  if (s == null) return { text: s, redacted: false };
  const out = redactSecrets(s);
  return { text: out, redacted: out !== s };
}

/**
 * Append-only JSONL logger for one run. Stamps every event with runId, scenario,
 * a monotonic seq, and a timestamp, scrubs secrets, and writes exactly one JSON
 * object per line. `time()` is injectable so tests are deterministic.
 */
export class QaLogger {
  private seq = 0;
  /** In-memory mirror of every event written, for end-of-scenario assertions. */
  readonly events: QaLogEvent[] = [];
  constructor(
    private readonly logPath: string,
    private readonly runId: string,
    private readonly scenarioId: string,
    private readonly scenarioName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    mkdirSync(dirname(logPath), { recursive: true });
  }

  private write(
    partial: Omit<QaLogEvent, 'runId' | 'scenarioId' | 'scenarioName' | 'timestamp' | 'seq'>,
  ): QaLogEvent {
    const redactions: string[] = [];
    const patch: Partial<QaLogEvent> = {};

    if (partial.message !== undefined) {
      const r = scrub(partial.message);
      patch.message = r.text ? truncate(r.text) : r.text;
      if (r.redacted) redactions.push('message');
    }
    if (partial.toolResult?.outputPreview !== undefined) {
      const r = scrub(partial.toolResult.outputPreview);
      patch.toolResult = {
        ...partial.toolResult,
        outputPreview: r.text ? truncate(r.text) : r.text,
      };
      if (r.redacted) redactions.push('toolResult.outputPreview');
    }
    if (partial.error) {
      const msg = scrub(partial.error.message);
      const stack = scrub(partial.error.stack);
      patch.error = {
        ...partial.error,
        message: msg.text ? truncate(msg.text) : (msg.text ?? ''),
        ...(stack.text ? { stack: truncate(stack.text) } : {}),
      };
      if (msg.redacted || stack.redacted) redactions.push('error');
    }
    if (partial.files) {
      patch.files = partial.files.map((f) => {
        if (f.preview === undefined) return f;
        const r = scrub(f.preview);
        if (r.redacted) redactions.push(`file:${f.path}`);
        return { ...f, preview: r.text ? truncate(r.text) : r.text };
      });
    }

    const event: QaLogEvent = {
      runId: this.runId,
      scenarioId: this.scenarioId,
      scenarioName: this.scenarioName,
      timestamp: this.now(),
      seq: this.seq++,
      ...partial,
      ...patch,
      ...(redactions.length ? { redactions } : {}),
    };
    appendFileSync(this.logPath, JSON.stringify(event) + '\n', 'utf-8');
    this.events.push(event);
    return event;
  }

  log(kind: QaLogKind, partial: Partial<QaLogEvent> = {}): QaLogEvent {
    return this.write({ kind, ...partial });
  }

  scenarioStart(seed: number, homeDir: string, appState?: AppStateSnapshot): void {
    this.write({ kind: 'scenario_start', seed, homeDir, ...(appState ? { appState } : {}) });
  }
  scenarioEnd(metrics: QaLogEvent['metrics'], appState?: AppStateSnapshot): void {
    this.write({
      kind: 'scenario_end',
      ...(metrics ? { metrics } : {}),
      ...(appState ? { appState } : {}),
    });
  }
  userMessage(message: string): void {
    this.write({ kind: 'user_message', message });
  }
  command(command: string): void {
    this.write({ kind: 'command', command });
  }
  assistantText(message: string): void {
    this.write({ kind: 'assistant_text', message });
  }
  toolCall(name: string, args: unknown, id?: string): void {
    this.write({ kind: 'assistant_tool_call', toolCall: { name, args, ...(id ? { id } : {}) } });
  }
  toolResult(name: string, ok: boolean, outputPreview?: string, error?: string): void {
    this.write({
      kind: 'tool_result',
      toolCall: { name },
      toolResult: {
        ok,
        ...(outputPreview !== undefined ? { outputPreview } : {}),
        ...(error ? { error } : {}),
      },
    });
  }
  appEvent(type: string, detail?: string): void {
    this.write({ kind: 'app_event', appEvent: { type, ...(detail ? { detail } : {}) } });
  }
  warning(message: string): void {
    this.write({ kind: 'warning', message });
  }
  error(err: { name?: string; message: string; stack?: string; code?: string }): void {
    this.write({ kind: 'error', error: err });
  }
  timeout(message: string): void {
    this.write({ kind: 'timeout', message });
  }
  assertion(a: AssertionResult): void {
    this.write({ kind: 'assertion', assertion: a });
  }
  fileSnapshot(files: FileSnapshot[]): void {
    this.write({ kind: 'file_snapshot', files });
  }
}
