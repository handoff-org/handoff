import type { ChatModel, Message, StreamPart } from '../../src/agent/model.js';
import type { ToolSchema } from '../../src/tools/registry.js';
import type { MockStep } from '../schema/types.js';

let callCounter = 0;

/**
 * Deterministic ChatModel driven by a scenario's scripted `mockModel` steps — one
 * step consumed per chatStream call (i.e. per agent-loop round). Mirrors the proven
 * qa/chat-sim MockChatModel but reads its script from the scenario file so smoke
 * evaluations need no Ollama, GPU, or network. When the script is exhausted it
 * returns a short benign final so the loop always terminates.
 *
 * Scenario authors deliberately script BOTH good and bad behaviors here (e.g. a
 * fabricated citation) so the scorers are exercised in both directions; that is the
 * point of the mocked smoke suite — it validates the harness, not a real model.
 */
export class ScenarioMockModel implements ChatModel {
  readonly modelId = 'mock:eval';
  private queue: MockStep[];

  constructor(steps: MockStep[] = []) {
    this.queue = steps.map((s) => ({ ...s }));
  }

  async *chatStream(
    _messages: Message[],
    _tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
    _opts?: unknown,
  ): AsyncGenerator<StreamPart> {
    const step: MockStep = this.queue.shift() ?? { kind: 'text', text: 'Done.' };
    switch (step.kind) {
      case 'text': {
        const text = step.text ?? '';
        if (!signal?.aborted) yield { type: 'delta', text };
        yield { type: 'final', content: text };
        return;
      }
      case 'tools': {
        if (step.text) yield { type: 'delta', text: step.text };
        yield {
          type: 'final',
          content: step.text ?? '',
          tool_calls: (step.calls ?? []).map((c) => ({
            id: `mock_call_${callCounter++}`,
            function: {
              name: c.name,
              arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}),
            },
          })),
        };
        return;
      }
      case 'malformed_tool': {
        yield {
          type: 'final',
          content: step.text ?? '',
          tool_calls: [
            {
              id: `mock_call_${callCounter++}`,
              function: { name: step.name ?? 'unknown', arguments: step.rawArgs ?? '{bad json' },
            },
          ],
        };
        return;
      }
      case 'duplicate_tool': {
        const call = {
          id: `mock_call_${callCounter++}`,
          function: {
            name: step.calls?.[0]?.name ?? step.name ?? 'noop',
            arguments: JSON.stringify(step.calls?.[0]?.args ?? {}),
          },
        };
        yield {
          type: 'final',
          content: step.text ?? '',
          tool_calls: [call, { ...call, id: `${call.id}_dup` }],
        };
        return;
      }
      case 'slow': {
        for (const ch of (step.text ?? '').split(' ')) {
          if (signal?.aborted) return;
          yield { type: 'delta', text: ch + ' ' };
        }
        if (!signal?.aborted) yield { type: 'final', content: step.text ?? '' };
        return;
      }
      case 'throw':
        throw new Error(step.message ?? 'mock model error');
      case 'overlong': {
        const big = 'x'.repeat(Math.max(1, step.sizeChars ?? 100000));
        yield { type: 'final', content: big };
        return;
      }
      case 'truncated_reasoning':
        yield { type: 'reasoning' };
        yield { type: 'final', content: '', truncated: true };
        return;
      case 'empty':
        yield { type: 'final', content: '' };
        return;
    }
  }
}
