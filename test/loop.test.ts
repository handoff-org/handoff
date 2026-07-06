import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop, type AgentEvent } from '../src/agent/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { ChatModel, Message, StreamPart, ToolCall } from '../src/agent/model.js';

interface Turn {
  content: string;
  tool_calls?: ToolCall[];
}

/** A ChatModel that replays a fixed script — one Turn per loop iteration. */
class FakeModel implements ChatModel {
  readonly modelId = 'fake';
  private turns: Turn[];
  constructor(turns: Turn[]) {
    this.turns = [...turns];
  }
  async *chatStream(): AsyncGenerator<StreamPart> {
    const turn = this.turns.shift() ?? { content: '' };
    yield { type: 'final', content: turn.content, ...(turn.tool_calls ? { tool_calls: turn.tool_calls } : {}) };
  }
}

function call(id: string, name: string, args: object): ToolCall {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

async function collect(
  userMessage: string,
  history: Message[],
  model: ChatModel,
  registry: ToolRegistry,
  opts: Parameters<typeof runAgentLoop>[4],
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of runAgentLoop(userMessage, history, model, registry, opts)) out.push(e);
  return out;
}

const signal = new AbortController().signal;
const sys: Message[] = [{ role: 'system', content: 'sys' }];

function echoRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register({
    name: 'write_file',
    description: 'write',
    sensitive: true,
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute(args) {
      return `Written to ${String(args['path'])}`;
    },
  });
  return r;
}

test('ask_user is routed to the UI, not executed as a tool', async () => {
  const model = new FakeModel([
    { content: '', tool_calls: [call('1', 'ask_user', { question: 'Pick', options: ['A', 'B'] })] },
    { content: 'all done' },
  ]);
  const asked: { q: string; options: string[] }[] = [];
  const events = await collect('go', sys, model, new ToolRegistry(), {
    signal,
    approve: async () => true,
    askUser: async (q, options) => {
      asked.push({ q, options });
      return 'A';
    },
  });
  assert.deepEqual(asked, [{ q: 'Pick', options: ['A', 'B'] }]);
  const result = events.find((e) => e.type === 'tool_result');
  assert.equal(result && result.type === 'tool_result' && result.result, 'The user selected: A');
});

test('a skipped ask_user reports the skip', async () => {
  const model = new FakeModel([
    { content: '', tool_calls: [call('1', 'ask_user', { question: 'Pick', options: [] })] },
    { content: 'ok' },
  ]);
  const events = await collect('go', sys, model, new ToolRegistry(), {
    signal,
    approve: async () => true,
    askUser: async () => '',
  });
  const result = events.find((e) => e.type === 'tool_result');
  assert.match(result && result.type === 'tool_result' ? result.result : '', /skipped/);
});

test('duplicate identical tool calls in one turn run only once', async () => {
  const model = new FakeModel([
    {
      content: '',
      tool_calls: [
        call('1', 'write_file', { path: 'a.txt' }),
        call('2', 'write_file', { path: 'a.txt' }),
      ],
    },
    { content: 'done' },
  ]);
  const events = await collect('go', sys, model, echoRegistry(), {
    signal,
    approve: async () => true,
  });
  const calls = events.filter((e) => e.type === 'tool_call');
  assert.equal(calls.length, 1, 'the duplicate call should have been dropped');
});

test('a denied tool yields the denial message and does not execute', async () => {
  const model = new FakeModel([
    { content: '', tool_calls: [call('1', 'write_file', { path: 'a.txt' })] },
    { content: 'done' },
  ]);
  const events = await collect('go', sys, model, echoRegistry(), {
    signal,
    approve: async () => false,
  });
  const result = events.find((e) => e.type === 'tool_result');
  assert.match(result && result.type === 'tool_result' ? result.result : '', /Denied by the user/);
});

test('a plain answer with no tools completes in one turn', async () => {
  const model = new FakeModel([{ content: 'hello there' }]);
  const events = await collect('hi', sys, model, new ToolRegistry(), {
    signal,
    approve: async () => true,
  });
  const end = events.find((e) => e.type === 'message_end');
  assert.equal(end && end.type === 'message_end' && end.content, 'hello there');
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
});

test('an empty response (no content, no tool calls) surfaces a clear error, not a silent stop', async () => {
  const model = new FakeModel([{ content: '   ' }]); // whitespace only
  const events = await collect('hi', sys, model, new ToolRegistry(), {
    signal,
    approve: async () => true,
  });
  const err = events.find((e) => e.type === 'error');
  assert.ok(err && err.type === 'error', 'expected an error event for an empty response');
  assert.match(err.type === 'error' ? err.message : '', /empty response/i);
  assert.equal(events.at(-1)?.type, 'done'); // still completes cleanly
});

test('a max-iterations run ends with the "stopped after N rounds" error', async () => {
  // A model that always asks for a tool never finishes on its own.
  const turns = Array.from({ length: 12 }, () => ({
    content: '',
    tool_calls: [call('x', 'write_file', { path: 'a.txt' })],
  }));
  const events = await collect('go', sys, new FakeModel(turns), echoRegistry(), {
    signal,
    approve: async () => true,
  });
  const err = events.find((e) => e.type === 'error');
  assert.match(err && err.type === 'error' ? err.message : '', /Stopped after \d+ tool-call rounds/);
});

test('budget compacts the SENT history while done.messages stays full', async () => {
  // A model that records exactly what messages it was handed each turn.
  class CapturingModel implements ChatModel {
    readonly modelId = 'capture';
    seen: Message[][] = [];
    async *chatStream(messages: Message[]): AsyncGenerator<StreamPart> {
      this.seen.push(messages.map((m) => ({ ...m })));
      yield { type: 'final', content: 'ok' };
    }
  }
  // A long history with a giant old tool output that must be trimmed.
  const history: Message[] = [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'earlier question ' + 'q'.repeat(2000) },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: '1', type: 'function', function: { name: 'run', arguments: '{}' } }],
    },
    { role: 'tool', content: 'HUGE'.repeat(4000), tool_call_id: '1' },
    { role: 'assistant', content: 'earlier answer' },
  ];
  const model = new CapturingModel();
  const events = await collect('new question', history, model, new ToolRegistry(), {
    signal,
    approve: async () => true,
    budget: { maxPromptTokens: 300, toolCapChars: 100 },
  });

  // The model saw a compacted array: system preserved, giant tool output shrunk.
  const sent = model.seen[0]!;
  assert.equal(sent[0]!.content, 'SYS');
  const sentText = sent.map((m) => m.content).join('\n');
  assert.ok(!sentText.includes('HUGE'.repeat(1000)), 'giant tool output should be trimmed in the sent view');

  // But the persisted transcript keeps every message at full size.
  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  const full = done.type === 'done' ? done.messages : [];
  const huge = full.find((m) => m.role === 'tool');
  assert.ok(huge && huge.content.length >= 16000, 'done.messages must retain the full tool output');
});


test('a truncated, reasoning-only empty response gives an actionable error', async () => {
  // A model that reasons, then ends truncated (num_predict hit) with no content.
  class TruncatedModel implements ChatModel {
    readonly modelId = 'trunc';
    async *chatStream(): AsyncGenerator<StreamPart> {
      yield { type: 'reasoning' };
      yield { type: 'final', content: '', truncated: true };
    }
  }
  const events = await collect('go', sys, new TruncatedModel(), new ToolRegistry(), {
    signal,
    approve: async () => true,
  });
  const err = events.find((e) => e.type === 'error');
  assert.ok(err && err.type === 'error');
  assert.match(err.type === 'error' ? err.message : '', /output limit|reasoning/i);
  assert.match(err.type === 'error' ? err.message : '', /\/model/);
});
