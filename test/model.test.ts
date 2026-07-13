import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInlineToolCalls,
  cleanBackendError,
  nativeToolCallsToToolCalls,
  readNDJSON,
  ThinkFilter,
  stripReasoning,
  OllamaModel,
  VLLMModel,
} from '../src/agent/model.js';
import { reasoningOutputReserve } from '../src/agent/contextBudget.js';

// --- ThinkFilter ------------------------------------------------------------

test('ThinkFilter passes through content with no think tags', () => {
  const f = new ThinkFilter();
  assert.equal(f.push('hello world').visible, 'hello world');
  assert.equal(f.flush(), '');
});

test('ThinkFilter strips a complete <think>...</think> block', () => {
  const f = new ThinkFilter();
  assert.equal(f.push('<think>some reasoning</think>answer').visible, 'answer');
  assert.equal(f.flush(), '');
});

test('ThinkFilter tracks an unclosed think block across chunks', () => {
  const f = new ThinkFilter();
  assert.equal(f.push('preamble<think>reasoning').visible, 'preamble');
  // Second chunk closes the block and has more content
  assert.equal(f.push('more reasoning</think>answer').visible, 'answer');
  assert.equal(f.flush(), '');
});

test('ThinkFilter does not emit think content at all', () => {
  const f = new ThinkFilter();
  assert.equal(f.push('<think>do not show this</think>').visible, '');
  assert.equal(f.flush(), '');
});

test('ThinkFilter reassembles an OPENING tag split across chunks (the MLX bug)', () => {
  // Reasoning models tokenize <think> as several tokens: `<`, `think`, `>`.
  const f = new ThinkFilter();
  let out = '';
  for (const piece of ['<', 'think', '>', 'secret reasoning', '</', 'think', '>', 'Hello!']) {
    out += f.push(piece).visible;
  }
  out += f.flush();
  assert.equal(out, 'Hello!'); // none of the reasoning or the tags leaked through
});

test('ThinkFilter reassembles a CLOSING tag split across chunks', () => {
  const f = new ThinkFilter();
  let out = '';
  for (const piece of ['<think>reasoning</', 'think', '>visible']) {
    out += f.push(piece).visible;
  }
  out += f.flush();
  assert.equal(out, 'visible');
});

test('ThinkFilter reports reasoning=true while inside a block with no visible text', () => {
  const f = new ThinkFilter();
  f.push('<think>');
  const r = f.push('still thinking');
  assert.equal(r.visible, '');
  assert.equal(r.reasoning, true);
});

test('ThinkFilter does not hold back a literal </div> as a partial tag', () => {
  const f = new ThinkFilter();
  assert.equal(f.push('see </div> here').visible, 'see </div> here');
  assert.equal(f.flush(), '');
});

// --- stripReasoning ---------------------------------------------------------

test('stripReasoning removes a complete <think>...</think> block', () => {
  assert.equal(stripReasoning('<think>reasoning</think>Answer'), 'Answer');
});

test('stripReasoning removes a leading orphan </think> (template-prefilled open)', () => {
  assert.equal(stripReasoning('lots of reasoning\n</think>\n\nAnswer here'), 'Answer here');
});

test('stripReasoning leaves plain content untouched', () => {
  assert.equal(stripReasoning('Just a normal answer.'), 'Just a normal answer.');
});

// --- parseInlineToolCalls ---------------------------------------------------

test('returns nothing for plain prose', () => {
  assert.deepEqual(parseInlineToolCalls('Here is your answer.'), []);
});

test('recovers a Llama-style <function=name><parameter=key>value</parameter></function>', () => {
  const content = '<function=start_paper>\n<parameter=template>\nacl\n</parameter>\n</function>';
  const calls = parseInlineToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.name, 'start_paper');
  assert.deepEqual(JSON.parse(calls[0]!.function.arguments), { template: 'acl' });
});

test('recovers multiple parameters from a Llama-style function tag', () => {
  const content =
    '<function=write_file><parameter=path>paper/main.tex</parameter><parameter=content>hello</parameter></function>';
  const calls = parseInlineToolCalls(content);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]!.function.arguments), {
    path: 'paper/main.tex',
    content: 'hello',
  });
});

test('recovers a Qwen-style <tool_call> tag', () => {
  const calls = parseInlineToolCalls(
    '<tool_call>{"name": "write_file", "arguments": {"path": "a.txt", "content": "hi"}}</tool_call>',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.name, 'write_file');
  assert.deepEqual(JSON.parse(calls[0]!.function.arguments), { path: 'a.txt', content: 'hi' });
});

test('recovers a bare ```json-fenced object using "parameters"', () => {
  const calls = parseInlineToolCalls(
    '```json\n{"name": "make_dir", "parameters": {"path": "runs"}}\n```',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.name, 'make_dir');
  assert.deepEqual(JSON.parse(calls[0]!.function.arguments), { path: 'runs' });
});

test('ignores objects without a name field', () => {
  assert.deepEqual(parseInlineToolCalls('{"arguments": {"x": 1}}'), []);
});

test('does NOT hijack prose that merely quotes a {"name":...} object', () => {
  // Regression: the bare-JSON fallback must only fire when the whole message is
  // essentially the object, not when prose explains a tool schema.
  const calls = parseInlineToolCalls(
    'Sure — a tool call looks like {"name":"write_file","arguments":{"path":"a"}} in JSON.',
  );
  assert.deepEqual(calls, []);
});

test('still recovers a bare, JSON-only object', () => {
  const calls = parseInlineToolCalls('{"name":"make_dir","arguments":{"path":"runs"}}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.name, 'make_dir');
});

test('cleanBackendError turns a tool-call parse 500 into an actionable line', () => {
  // The real payload is huge (the model's entire malformed .bib inline).
  const payload = "@article{levine2020,\\n title={x}, author={Levine, S. and J\\'erome}}".repeat(
    20,
  );
  const raw =
    `error parsing tool call: raw='{"content":"${payload}"}', ` +
    "err=invalid character '\\'' in string escape code";
  const msg = cleanBackendError(500, raw);
  assert.match(msg, /malformed tool call/i);
  assert.match(msg, /500/);
  // Must NOT echo the whole raw payload back at the user.
  assert.ok(!msg.includes('levine2020'));
  assert.ok(msg.length < raw.length);
});

test('cleanBackendError passes through and trims an ordinary error', () => {
  const msg = cleanBackendError(400, '  bad   request  ');
  assert.equal(msg, '400: bad request');
});

test('cleanBackendError truncates a very long body', () => {
  const msg = cleanBackendError(500, 'x'.repeat(500));
  assert.ok(msg.length < 300);
  assert.match(msg, /…$/);
});

// --- Ollama native /api/chat streaming --------------------------------------

/** Build a ReadableStream that emits the given string chunks, then closes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

/** Minimal Response-shaped object (streamOllamaNative only uses these fields). */
function fakeRes(opts: { status?: number; body?: unknown; text?: string }) {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: opts.body ?? null,
    text: async () => opts.text ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const CFG = {
  ollamaBaseUrl: 'http://localhost:11434',
  modelId: 'qwen3:8b',
  ollamaNumCtx: 4096,
  ollamaKeepAlive: '30m',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collect(model: OllamaModel): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  for await (const p of model.chatStream([{ role: 'user', content: 'hi' }], undefined)) {
    parts.push(p);
  }
  return parts;
}

test('readNDJSON reassembles an object split across chunks and flushes a no-newline tail', async () => {
  const lines: string[] = [];
  for await (const l of readNDJSON(
    streamOf(['{"message":{"con', 'tent":"hi"},"done":false}\n', '{"done":true}']),
  )) {
    lines.push(l);
  }
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), { message: { content: 'hi' }, done: false });
  assert.deepEqual(JSON.parse(lines[1]!), { done: true }); // trailing line, no closing \n
});

test('nativeToolCallsToToolCalls stringifies object arguments', () => {
  const calls = nativeToolCallsToToolCalls([
    { function: { name: 'write_file', arguments: { path: 'a.txt', content: 'hi' } } },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.name, 'write_file');
  assert.equal(typeof calls[0]!.function.arguments, 'string');
  assert.deepEqual(JSON.parse(calls[0]!.function.arguments), { path: 'a.txt', content: 'hi' });
});

test('nativeToolCallsToToolCalls keeps a string argument and skips nameless calls', () => {
  const calls = nativeToolCallsToToolCalls([
    { function: { name: 'x', arguments: '{"a":1}' } },
    { function: {} },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.function.arguments, '{"a":1}');
});

test('OllamaModel streams native deltas then a final (no spurious empty delta on done)', async (t) => {
  const body = streamOf([
    '{"message":{"role":"assistant","content":"he"},"done":false}\n',
    '{"message":{"content":"llo"},"done":false}\n',
    '{"message":{"content":""},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collect(new OllamaModel(CFG));
  assert.deepEqual(
    parts.filter((p) => p.type === 'delta').map((p) => p.text),
    ['he', 'llo'],
  );
  const final = parts.at(-1);
  assert.equal(final.type, 'final');
  assert.equal(final.content, 'hello');
  assert.equal(final.tool_calls, undefined);
});

test('OllamaModel sends keep_alive and options to /api/chat', async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    captured = { url, init };
    return fakeRes({ body: streamOf(['{"message":{"content":"x"},"done":true}\n']) });
  });
  await collect(
    new OllamaModel({ ...CFG, ollamaNumCtx: 8192, ollamaKeepAlive: '30m', maxNewTokens: 256 }),
  );
  assert.match(captured.url, /\/api\/chat$/);
  const sent = JSON.parse(captured.init.body);
  assert.equal(sent.stream, true);
  assert.equal(sent.think, true); // native thinking on → reasoning lands in its own field
  assert.equal(sent.keep_alive, '30m');
  assert.equal(sent.options.num_ctx, 8192);
  // num_predict is floored (via reasoningOutputReserve): `think:true` reasoning
  // counts against it, so a tight cap (256) would be spent inside <think> and
  // return an empty answer. The floor is half of numCtx here (4096), not a flat
  // 8192, so it can never by itself exceed the context window.
  assert.equal(sent.options.num_predict, reasoningOutputReserve(8192));
});

test('OllamaModel forwards a think:false override to /api/chat (retry path)', async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    captured = { url, init };
    return fakeRes({ body: streamOf(['{"message":{"content":"answer"},"done":true}\n']) });
  });
  const model = new OllamaModel(CFG);
  for await (const _ of model.chatStream([{ role: 'user', content: 'hi' }], undefined, undefined, {
    think: false,
  })) {
    void _;
  }
  assert.equal(JSON.parse(captured.init.body).think, false);
});

test('a large explicit maxNewTokens is respected above the reasoning floor', async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    captured = { url, init };
    return fakeRes({ body: streamOf(['{"message":{"content":"x"},"done":true}\n']) });
  });
  await collect(new OllamaModel({ ...CFG, maxNewTokens: 16384 }));
  assert.equal(JSON.parse(captured.init.body).options.num_predict, 16384);
});

test('OllamaModel strips a think block split across NDJSON chunks, emits reasoning', async (t) => {
  // The server dribbles <think> one token per line, then the real answer.
  const body = streamOf([
    '{"message":{"content":"<"},"done":false}\n',
    '{"message":{"content":"think"},"done":false}\n',
    '{"message":{"content":">"},"done":false}\n',
    '{"message":{"content":"internal reasoning"},"done":false}\n',
    '{"message":{"content":"</think>"},"done":false}\n',
    '{"message":{"content":"Hello!"},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collect(new OllamaModel(CFG));
  // No delta ever leaks the tags or the reasoning text.
  const deltas = parts
    .filter((p) => p.type === 'delta')
    .map((p) => p.text)
    .join('');
  assert.equal(deltas, 'Hello!');
  assert.ok(
    parts.some((p) => p.type === 'reasoning'),
    'should emit at least one reasoning part',
  );
  const final = parts.at(-1);
  assert.equal(final.content, 'Hello!');
});

test('OllamaModel keeps the native thinking field out of content and emits reasoning', async (t) => {
  // think:true streams reasoning in a separate `thinking` field, then clean content.
  const body = streamOf([
    '{"message":{"role":"assistant","thinking":"Okay, the user said hi. "},"done":false}\n',
    '{"message":{"thinking":"I should be brief."},"done":false}\n',
    '{"message":{"content":"Hey! "},"done":false}\n',
    '{"message":{"content":"How can I help?"},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collect(new OllamaModel(CFG));
  const deltas = parts
    .filter((p) => p.type === 'delta')
    .map((p) => p.text)
    .join('');
  assert.equal(deltas, 'Hey! How can I help?');
  assert.ok(
    parts.some((p) => p.type === 'reasoning'),
    'thinking field should emit reasoning',
  );
  const final = parts.at(-1);
  assert.equal(final.content, 'Hey! How can I help?');
  assert.ok(!final.content.includes('user said hi'));
});

test('OllamaModel strips a template-prefilled think block (closing tag, no opening) from final content', async (t) => {
  // qwen3 with the thinking template dumps reasoning into content ending with </think>.
  const body = streamOf([
    '{"message":{"content":"Okay the user said hi. I will greet.\\n</think>\\n\\nHey! How can I help?"},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const final = (await collect(new OllamaModel(CFG))).at(-1);
  assert.equal(final.content, 'Hey! How can I help?');
});

test('OllamaModel converts native tool_calls (object args → JSON string)', async (t) => {
  const body = streamOf([
    '{"message":{"content":"","tool_calls":[{"function":{"name":"write_file","arguments":{"path":"a.txt","content":"hi"}}}]},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const final = (await collect(new OllamaModel(CFG))).at(-1);
  assert.equal(final.tool_calls.length, 1);
  assert.equal(typeof final.tool_calls[0].function.arguments, 'string');
  assert.deepEqual(JSON.parse(final.tool_calls[0].function.arguments), {
    path: 'a.txt',
    content: 'hi',
  });
});

test('OllamaModel recovers inline tool calls when none are native', async (t) => {
  const body = streamOf([
    '{"message":{"content":"<tool_call>{\\"name\\":\\"make_dir\\",\\"arguments\\":{\\"path\\":\\"runs\\"}}</tool_call>"},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const final = (await collect(new OllamaModel(CFG))).at(-1);
  assert.equal(final.content, '');
  assert.equal(final.tool_calls.length, 1);
  assert.equal(final.tool_calls[0].function.name, 'make_dir');
});

test('OllamaModel ignores the thinking field (not appended to content)', async (t) => {
  const body = streamOf([
    '{"message":{"thinking":"let me reason","content":""},"done":false}\n',
    '{"message":{"content":"answer"},"done":true}\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collect(new OllamaModel(CFG));
  assert.deepEqual(
    parts.filter((p) => p.type === 'delta').map((p) => p.text),
    ['answer'],
  );
  assert.equal(parts.at(-1).content, 'answer');
});

test('OllamaModel maps a native 404 to an "ollama pull" hint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    fakeRes({ status: 404, text: '{"error":"model \'llama9\' not found"}' }),
  );
  await assert.rejects(collect(new OllamaModel(CFG)), /ollama pull llama9/);
});

test('OllamaModel replays tool-call arguments as an OBJECT, not a string (native /api/chat)', async (t) => {
  // Regression: after ask_user (or any tool call), the next turn replays the
  // assistant message. Native /api/chat needs `arguments` as an object; sending
  // the stored string 400s with "Value looks like object, but can't find '}'".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    captured = init;
    return fakeRes({ body: streamOf(['{"message":{"content":"ok"},"done":true}\n']) });
  });
  const history = [
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_0',
          type: 'function',
          function: {
            name: 'ask_user',
            arguments: '{"question":"?","options":["Start a new project"]}',
          },
        },
      ],
    },
    { role: 'tool', content: 'The user selected: Start a new project', tool_call_id: 'call_0' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;

  for await (const _p of new OllamaModel(CFG).chatStream(history, undefined)) {
    void _p;
  }

  const sent = JSON.parse(captured.body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asst = sent.messages.find((m: any) => m.role === 'assistant');
  const args = asst.tool_calls[0].function.arguments;
  assert.equal(typeof args, 'object');
  assert.ok(!Array.isArray(args));
  assert.deepEqual(args, { question: '?', options: ['Start a new project'] });
});

// --- OpenAI-compat SSE path (vLLM / llama.cpp / MLX) -----------------------

const VLLM_CFG = {
  vllmBaseUrl: 'http://localhost:8000',
  modelId: 'm',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectModel(model: any): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const p of model.chatStream([{ role: 'user', content: 'hi' }], undefined))
    parts.push(p);
  return parts;
}

test('VLLMModel (OpenAI-compat SSE) streams deltas then a final', async (t) => {
  const body = streamOf([
    'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collectModel(new VLLMModel(VLLM_CFG));
  assert.deepEqual(
    parts.filter((p) => p.type === 'delta').map((p) => p.text),
    ['he', 'llo'],
  );
  assert.equal(parts.at(-1).content, 'hello');
});

test('VLLMModel surfaces a mid-stream SSE error object instead of ending empty', async (t) => {
  const body = streamOf(['data: {"error":{"message":"context length exceeded"}}\n\n']);
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  await assert.rejects(collectModel(new VLLMModel(VLLM_CFG)), /context length exceeded/);
});

test('readSSE flushes a final data: line that has no trailing newline', async (t) => {
  const body = streamOf(['data: {"choices":[{"delta":{"content":"x"}}]}']); // no closing \n
  t.mock.method(globalThis, 'fetch', async () => fakeRes({ body }));
  const parts = await collectModel(new VLLMModel(VLLM_CFG));
  assert.equal(parts.at(-1).content, 'x');
});

test('OllamaModel retries without tools when model does not support tools (400)', async (t) => {
  // First call returns 400 "does not support tools"; second call (without tools) succeeds.
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    if (callCount === 1) {
      // First call with tools — model rejects it.
      return fakeRes({
        status: 400,
        text: '{"error":"registry.ollama.ai/library/phi4:latest does not support tools"}',
      });
    }
    // Second call without tools — succeeds with inline JSON fallback in response.
    return fakeRes({
      body: streamOf([
        '{"message":{"content":"<tool_call>{\\"name\\":\\"make_dir\\",\\"arguments\\":{\\"path\\":\\"runs\\"}}</tool_call>"},"done":true}\n',
      ]),
    });
  });

  const FAKE_TOOL = [{ name: 'make_dir', description: 'x', parameters: {} }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  for await (const p of new OllamaModel(CFG).chatStream(
    [{ role: 'user', content: 'hi' }],
    FAKE_TOOL as any,
  )) {
    parts.push(p);
  }
  assert.equal(callCount, 2, 'should have retried once');
  const final = parts.at(-1);
  assert.equal(final.tool_calls?.length, 1);
  assert.equal(final.tool_calls[0].function.name, 'make_dir');
});
