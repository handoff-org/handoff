import type { ChatModel, Message, StreamPart } from '../../src/agent/model.js';
import type { ToolSchema } from '../../src/tools/registry.js';
import type { MockStep, MockToolCall } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let callCounter = 0;
function toToolCall(
  c: MockToolCall,
  rawArgs?: string,
): { id: string; function: { name: string; arguments: string } } {
  const args =
    rawArgs !== undefined ? rawArgs : typeof c.args === 'string' ? c.args : JSON.stringify(c.args);
  return { id: `mock_call_${callCounter++}`, function: { name: c.name, arguments: args } };
}

/**
 * A deterministic ChatModel for QA. It consumes a queue of planned steps — one
 * per `chatStream` call — so a scenario can script a multi-round tool-using
 * conversation, malformed/duplicate tool calls, slow/interrupted streams,
 * thrown errors, over-long output, and reasoning-only truncation. When the queue
 * is empty it falls back to a short benign reply so the loop never hangs.
 */
export class MockChatModel implements ChatModel {
  readonly modelId = 'mock:chat-sim';
  private queue: MockStep[] = [];

  /** Add the steps for the next user turn (consumed across loop iterations). */
  enqueue(steps: MockStep[]): void {
    this.queue.push(...steps);
  }

  pendingSteps(): number {
    return this.queue.length;
  }

  async *chatStream(
    _messages: Message[],
    _tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
    _opts?: { think?: boolean },
  ): AsyncGenerator<StreamPart> {
    const step: MockStep = this.queue.shift() ?? { kind: 'text', text: 'Okay.' };

    switch (step.kind) {
      case 'text': {
        yield* this.streamText(step.text, signal);
        yield { type: 'final', content: step.text };
        return;
      }
      case 'tools': {
        if (step.text) yield { type: 'delta', text: step.text };
        yield {
          type: 'final',
          content: step.text ?? '',
          tool_calls: step.calls.map((c) => toToolCall(c)),
        };
        return;
      }
      case 'malformed_tool': {
        // Emit a tool call whose arguments are not valid JSON — exercises the
        // loop's JSON.parse guard and the tool's missing-args handling.
        yield {
          type: 'final',
          content: step.text ?? '',
          tool_calls: [toToolCall({ name: step.name, args: '' }, step.rawArgs)],
        };
        return;
      }
      case 'duplicate_tool': {
        const tc = toToolCall(step.call);
        const dup = { ...tc, id: `${tc.id}_dup` };
        yield { type: 'final', content: step.text ?? '', tool_calls: [tc, dup] };
        return;
      }
      case 'slow': {
        const delay = step.chunkDelayMs ?? 20;
        for (const ch of step.text.split(' ')) {
          if (signal?.aborted) return; // interrupted — stop mid-stream
          yield { type: 'delta', text: ch + ' ' };
          await sleep(delay);
        }
        if (signal?.aborted) return;
        yield { type: 'final', content: step.text };
        return;
      }
      case 'throw':
        throw new Error(step.message);
      case 'overlong': {
        const big = 'x'.repeat(Math.max(1, step.sizeChars));
        yield { type: 'final', content: big };
        return;
      }
      case 'truncated_reasoning': {
        // Reasoned the whole budget away and produced no answer.
        yield { type: 'reasoning' };
        yield { type: 'final', content: '', truncated: true };
        return;
      }
      case 'empty': {
        yield { type: 'final', content: '' };
        return;
      }
    }
  }

  private async *streamText(text: string, signal?: AbortSignal): AsyncGenerator<StreamPart> {
    if (signal?.aborted) return;
    yield { type: 'delta', text };
  }
}
