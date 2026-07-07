import { InferenceClient } from '@huggingface/inference';
import type { Config } from '../../config/schema.js';
import type { ToolSchema } from '../tools/registry.js';
import { reasoningOutputReserve } from './contextBudget.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** An assistant's tool-call request, in OpenAI chat format. */
export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content: string;
  /** On a tool message: which assistant tool_call this answers. */
  tool_call_id?: string;
  /** On an assistant message: the tool calls it made this turn. */
  tool_calls?: ToolCallRequest[];
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}


export type StreamPart =
  | { type: 'delta'; text: string }
  | { type: 'reasoning' } // model is inside a <think> block; no visible text this chunk
  | { type: 'final'; content: string; tool_calls?: ToolCall[]; truncated?: boolean };

/** Per-call overrides for a single chatStream request. */
export interface ChatOptions {
  /**
   * Ask the backend to emit hidden reasoning (default true, honored by the native
   * Ollama path). Set false to force a direct answer — used to retry a turn that
   * spent its whole output budget inside `<think>` and returned nothing.
   */
  think?: boolean;
}

export interface ChatModel {
  readonly modelId: string;
  chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
    opts?: ChatOptions,
  ): AsyncGenerator<StreamPart>;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** A tool call as Ollama's native /api/chat returns it (arguments is an object). */
interface OllamaNativeToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

/** One streamed line from Ollama's native /api/chat endpoint. */
interface OllamaNativeChunk {
  message?: {
    role?: string;
    content?: string;
    /** Reasoning models emit this separately from content — do NOT append it. */
    thinking?: string;
    tool_calls?: OllamaNativeToolCall[];
  };
  done?: boolean;
  /** Ollama's stop reason: "stop" (natural), "length" (hit num_predict), … */
  done_reason?: string;
  error?: string;
}

/** Accumulate OpenAI-style streamed tool_call fragments (keyed by index). */
class ToolCallAccumulator {
  private byIndex = new Map<number, { id: string; name: string; args: string }>();

  add(deltas: ToolCallDelta[]): void {
    deltas.forEach((d, i) => {
      const idx = d.index ?? i;
      const cur = this.byIndex.get(idx) ?? { id: '', name: '', args: '' };
      if (d.id) cur.id = d.id;
      if (d.function?.name) cur.name = d.function.name;
      if (d.function?.arguments) cur.args += d.function.arguments;
      this.byIndex.set(idx, cur);
    });
  }

  result(): ToolCall[] {
    return Array.from(this.byIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([idx, c]) => ({
        id: c.id || `call_${idx}`,
        function: { name: c.name, arguments: c.args || '{}' },
      }));
  }
}

/** Read an SSE byte stream, yielding the JSON payload of each `data:` line. */
async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload) yield payload;
    }
  }
  // Flush a final `data:` line that arrived without a closing newline (a server
  // that closes the socket right after the last event) — otherwise the last
  // delta or the [DONE] sentinel is silently dropped.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload) yield payload;
  }
}

/**
 * Read a newline-delimited-JSON byte stream, yielding each non-empty line. Used
 * by Ollama's native /api/chat endpoint, which streams one complete JSON object
 * per line (no `data:` prefix and no `[DONE]` sentinel, unlike SSE).
 */
export async function* readNDJSON(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }
  // Flush a trailing line that had no closing newline (defensive; Ollama's
  // native stream normally ends each object with '\n').
  const tail = buffer.trim();
  if (tail) yield tail;
}

/**
 * Turn a raw backend HTTP-error body into a short, actionable message. Some
 * servers (notably Ollama) parse tool calls server-side and return a 500 with
 * the model's entire malformed payload inline when the model emits invalid JSON
 * — e.g. a LaTeX accent like `\'e`, where `\'` is not a legal JSON escape. Dump-
 * ing that whole blob at the user is noise; collapse it to one clear line.
 */
export function cleanBackendError(status: number, detail: string): string {
  const oneLine = detail.replace(/\s+/g, ' ').trim();
  if (
    /error parsing tool call/i.test(oneLine) ||
    /invalid character.*in string escape/i.test(oneLine)
  ) {
    return (
      `${status} — the model produced a malformed tool call (invalid JSON escape). ` +
      `This happens when it writes a stray backslash, such as a LaTeX accent like \\'e. ` +
      `Try again; if it keeps happening, ask it to use plain accented characters (é, not \\'e).`
    );
  }
  return `${status}: ${oneLine.length > 240 ? oneLine.slice(0, 240) + '…' : oneLine}`;
}

/** The reasoning-block delimiters we strip from streamed content. */
const THINK_TAGS = ['<think>', '</think>'] as const;

/**
 * Length of the longest suffix of `buf` that is a strict prefix of any think
 * tag — i.e. text we must hold back because the next chunk might complete a tag.
 * Reasoning models tokenize `<think>` into several pieces (`<`, `think`, `>`),
 * so a tag routinely arrives split across streamed deltas.
 */
function partialTagSuffix(buf: string): number {
  let best = 0;
  for (const tag of THINK_TAGS) {
    const max = Math.min(buf.length, tag.length - 1);
    for (let n = max; n > best; n--) {
      if (buf.slice(buf.length - n) === tag.slice(0, n)) {
        best = n;
        break;
      }
    }
  }
  return best;
}

/**
 * Stateful, streaming-safe filter that removes `<think>…</think>` reasoning
 * blocks from a model's content stream. Feed each delta to `push()`; it returns
 * the visible (answer) text and tracks whether we're currently inside a think
 * block. Handles tags split across chunk boundaries via an internal carry.
 */
export class ThinkFilter {
  private inThink = false;
  private carry = '';

  push(chunk: string): { visible: string; reasoning: boolean } {
    let buf = this.carry + chunk;
    this.carry = '';
    let out = '';
    for (;;) {
      const target = this.inThink ? '</think>' : '<think>';
      const idx = buf.indexOf(target);
      if (idx !== -1) {
        if (!this.inThink) out += buf.slice(0, idx); // text before an opening tag is visible
        this.inThink = !this.inThink;
        buf = buf.slice(idx + target.length);
        continue;
      }
      // No complete tag — emit the safe prefix, hold a possible partial tag back.
      const hold = partialTagSuffix(buf);
      const safe = buf.slice(0, buf.length - hold);
      if (!this.inThink) out += safe; // inside a think block, safe text is reasoning → drop it
      this.carry = buf.slice(buf.length - hold);
      break;
    }
    // We consumed reasoning this chunk if we're inside a block, or produced none.
    return { visible: out, reasoning: this.inThink && out === '' };
  }

  /** Emit any buffered tail at end-of-stream (a tag that never completed). */
  flush(): string {
    const rest = this.inThink ? '' : this.carry;
    this.carry = '';
    return rest;
  }
}

/**
 * Final-content safety net for reasoning that slipped past the streaming filter.
 * Removes complete `<think>…</think>` blocks, and — for models whose chat
 * template prefills the opening `<think>` so only a closing `</think>` appears in
 * the output — strips everything up to and including a leading orphan `</think>`.
 */
export function stripReasoning(s: string): string {
  let out = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const close = out.indexOf('</think>');
  if (close !== -1 && !out.slice(0, close).includes('<think>')) {
    out = out.slice(close + '</think>'.length);
  }
  return out.trimStart();
}

/** Shared streaming logic for OpenAI-compatible SSE endpoints (Ollama + vLLM). */
async function* streamOpenAICompat(
  url: string,
  config: Config,
  messages: Message[],
  tools: ToolSchema[] | undefined,
  signal: AbortSignal | undefined,
  backendLabel: string,
  unreachableHint: string,
): AsyncGenerator<StreamPart> {
  const baseUrl = url.replace(/\/v1\/chat\/completions$/, '');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        tools,
        ...(config.maxNewTokens ? { max_tokens: config.maxNewTokens } : {}),
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    // A thrown fetch means we never reached the server — the "is it running?"
    // hint belongs here, and ONLY here.
    throw new Error(
      `Cannot reach ${backendLabel} at ${baseUrl}. ${unreachableHint} ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    // Extract a clean message from a JSON error envelope, if present.
    let detail = body;
    try {
      const j = JSON.parse(body) as { error?: string | { message?: string } };
      if (typeof j.error === 'string') detail = j.error;
      else if (j.error && typeof (j.error as { message?: string }).message === 'string')
        detail = (j.error as { message: string }).message;
    } catch { /* keep raw body as fallback */ }

    // 404 "model not found" → actionable pull hint, not a misleading "cannot reach" message.
    if (res.status === 404 && /model .* not found/i.test(detail)) {
      const m = detail.match(/model ['"]?([^'"]+)['"]? not found/i);
      const modelId = m?.[1] ?? detail;
      throw new Error(
        `Model '${modelId}' is not installed in Ollama.\n` +
        `Download it with:  ollama pull ${modelId}`,
      );
    }

    // The server responded, so this is NOT a connectivity problem — don't tell
    // the user to check whether it's running.
    throw new Error(`${backendLabel}: ${cleanBackendError(res.status, detail)}`);
  }

  let content = '';
  const think = new ThinkFilter();
  const acc = new ToolCallAccumulator();
  for await (const payload of readSSE(res.body)) {
    if (signal?.aborted) return; // honor abort even if the socket keeps dribbling
    if (payload === '[DONE]') break;
    let obj;
    try {
      obj = JSON.parse(payload) as {
        choices?: { delta?: { content?: string; tool_calls?: ToolCallDelta[] } }[];
        error?: string | { message?: string };
      };
    } catch {
      continue;
    }
    // Some OpenAI-compat servers (vLLM, llama.cpp) emit an error object mid-stream
    // after a 200 header (e.g. context-length exceeded). Surface it instead of
    // silently ending with an empty/truncated reply.
    if (obj.error) {
      const detail = typeof obj.error === 'string' ? obj.error : (obj.error.message ?? 'stream error');
      throw new Error(`${backendLabel}: ${cleanBackendError(res.status, detail)}`);
    }
    const delta = obj.choices?.[0]?.delta;
    if (delta?.content) {
      const { visible, reasoning } = think.push(delta.content);
      if (visible) {
        content += visible;
        yield { type: 'delta', text: visible };
      } else if (reasoning) {
        yield { type: 'reasoning' };
      }
    }
    if (delta?.tool_calls) acc.add(delta.tool_calls);
  }
  const tail = think.flush();
  if (tail) { content += tail; yield { type: 'delta', text: tail }; }
  content = stripReasoning(content);

  let toolCalls = acc.result();
  let finalContent = content;
  if (toolCalls.length === 0) {
    const recovered = parseInlineToolCalls(content);
    if (recovered.length > 0) {
      toolCalls = recovered;
      finalContent = '';
    }
  }
  yield {
    type: 'final',
    content: finalContent,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
}

/**
 * Convert Ollama-native tool calls into the OpenAI-style `ToolCall` shape the
 * rest of handoff expects. The critical difference: native `arguments` is a JSON
 * *object*, but `loop.ts` (and the OpenAI protocol) require it as a *string* — so
 * we `JSON.stringify` it. Native calls carry no id, so we synthesize one.
 */
export function nativeToolCallsToToolCalls(tcs: OllamaNativeToolCall[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const tc of tcs) {
    const fn = tc.function;
    if (!fn?.name) continue;
    const rawArgs = fn.arguments;
    calls.push({
      id: `call_${calls.length}`,
      function: {
        name: fn.name,
        arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {}),
      },
    });
  }
  return calls;
}

/**
 * Ollama's native /api/chat expects an assistant message's tool-call arguments
 * as a JSON *object*, whereas handoff stores them as a string (OpenAI style, so
 * `loop.ts` can `JSON.parse` them). When we replay the conversation — which
 * happens on every turn after a tool call, e.g. `ask_user` — those string
 * arguments must be parsed back into objects, or Ollama 400s with
 * "Value looks like object, but can't find closing '}' symbol". This is the
 * request-side mirror of `nativeToolCallsToToolCalls`.
 */
function toOllamaMessages(messages: Message[]): unknown[] {
  return messages.map((m) => {
    if (!m.tool_calls?.length) return m;
    return {
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          /* leave args as {} — a malformed replay shouldn't kill the request */
        }
        // Native shape: { function: { name, arguments: <object> } } — no id/type.
        return { function: { name: tc.function.name, arguments: args } };
      }),
    };
  });
}

/**
 * Streaming logic for Ollama's NATIVE /api/chat endpoint. Unlike the OpenAI-compat
 * endpoint, this one honours `keep_alive` (so the model stays resident between
 * turns instead of cold-reloading) and `options.num_ctx` (the context window). The
 * response is newline-delimited JSON rather than SSE.
 */
async function* streamOllamaNative(
  baseUrl: string,
  config: Config,
  messages: Message[],
  tools: ToolSchema[] | undefined,
  signal: AbortSignal | undefined,
  enableThinking = true,
): AsyncGenerator<StreamPart> {
  const url = `${baseUrl}/api/chat`;
  const options: Record<string, unknown> = { num_ctx: config.ollamaNumCtx };
  // max_tokens → native num_predict. IMPORTANT: `think` (below) makes the model
  // emit hidden reasoning that ALSO counts against num_predict, so a tight preset
  // cap (e.g. "cool" = 1024) can be spent entirely inside the <think> block,
  // leaving no visible answer — the model then returns empty. Keep a floor so
  // reasoning models always have room to finish; short answers still stop early on
  // their own, so this costs nothing on typical turns. The floor is scaled to
  // numCtx (via the same reserve promptBudgetFor subtracts out) so it can never
  // itself exceed the context window on a small preset.
  if (config.maxNewTokens) {
    options.num_predict = Math.max(config.maxNewTokens, reasoningOutputReserve(config.ollamaNumCtx));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        messages: toOllamaMessages(messages),
        ...(tools ? { tools } : {}),
        stream: true,
        // Native thinking separates reasoning into its own `thinking` field
        // (leaving `content` clean). We pass it explicitly so a caller can disable
        // it: sending false is normally worse (some models, e.g. qwen3, ignore it
        // and dump the monologue into `content`), but it's exactly what we want on
        // a retry — a model that spent its whole budget reasoning gets one more
        // chance to answer directly.
        think: enableThinking,
        keep_alive: config.ollamaKeepAlive,
        options,
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    // A thrown fetch means we never reached the server — the only place the
    // "is it running?" hint belongs.
    throw new Error(
      `Cannot reach Ollama at ${baseUrl}. Is it running? Try: ollama serve ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const j = JSON.parse(body) as { error?: string | { message?: string } };
      if (typeof j.error === 'string') detail = j.error;
      else if (j.error && typeof (j.error as { message?: string }).message === 'string')
        detail = (j.error as { message: string }).message;
    } catch { /* keep raw body as fallback */ }

    // 404 "model not found" → actionable pull hint, not a misleading connectivity error.
    if (res.status === 404 && /model .* not found/i.test(detail)) {
      const m = detail.match(/model ['"]?([^'"]+)['"]? not found/i);
      const modelId = m?.[1] ?? detail;
      throw new Error(
        `Model '${modelId}' is not installed in Ollama.\n` +
        `Download it with:  ollama pull ${modelId}`,
      );
    }

    // Some models don't declare tool support in their Modelfile. Retry without
    // the tools field and fall back to inline JSON parsing on the response.
    if (res.status === 400 && tools && /does not support tools/i.test(detail)) {
      yield* streamOllamaNative(baseUrl, config, messages, undefined, signal, enableThinking);
      return;
    }

    // The server responded, so this is NOT a connectivity problem.
    throw new Error(`Ollama: ${cleanBackendError(res.status, detail)}`);
  }

  let content = '';
  const think = new ThinkFilter();
  let nativeCalls: ToolCall[] = [];
  let doneReason: string | undefined;
  for await (const line of readNDJSON(res.body)) {
    if (signal?.aborted) return; // honor abort even if the socket keeps dribbling
    let obj: OllamaNativeChunk;
    try {
      obj = JSON.parse(line) as OllamaNativeChunk;
    } catch {
      continue;
    }
    // Native errors can arrive mid-stream as a lone {"error":"..."} object.
    if (obj.error) throw new Error(`Ollama: ${cleanBackendError(res.status, obj.error)}`);

    const msg = obj.message;
    // Reasoning arrives in a separate `thinking` field (think:true) — surface a
    // status but never add it to the visible content.
    if (msg?.thinking) yield { type: 'reasoning' };
    if (msg?.content) {
      // Belt-and-suspenders: a model that still inlines <think>...</think> in
      // content gets stripped here too.
      const { visible, reasoning } = think.push(msg.content);
      if (visible) {
        content += visible;
        yield { type: 'delta', text: visible };
      } else if (reasoning) {
        yield { type: 'reasoning' };
      }
    }
    // Native tool_calls arrive complete in one chunk (not fragmented like the
    // OpenAI-compat deltas), so no accumulator is needed.
    if (msg?.tool_calls?.length) {
      nativeCalls = nativeCalls.concat(nativeToolCallsToToolCalls(msg.tool_calls));
    }
    if (obj.done) { doneReason = obj.done_reason; break; }
  }
  const tail = think.flush();
  if (tail) { content += tail; yield { type: 'delta', text: tail }; }
  content = stripReasoning(content);

  let toolCalls = nativeCalls;
  let finalContent = content;
  if (toolCalls.length === 0) {
    const recovered = parseInlineToolCalls(content);
    if (recovered.length > 0) {
      toolCalls = recovered;
      finalContent = '';
    }
  }
  yield {
    type: 'final',
    content: finalContent,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    truncated: doneReason === 'length',
  };
}

/** HuggingFace router backend (paid providers). */
export class HFModel implements ChatModel {
  private client: InferenceClient;
  private config: Config;

  constructor(config: Config) {
    this.client = new InferenceClient(config.hfToken);
    this.config = config;
  }

  async *chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamPart> {
    let stream;
    try {
      stream = this.client.chatCompletionStream(
        {
          provider: 'auto',
          model: this.config.modelId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: messages as any,
          tools: tools as any,
          ...(this.config.maxNewTokens ? { max_tokens: this.config.maxNewTokens } : {}),
        },
        { signal },
      );
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }

    let content = '';
    const think = new ThinkFilter();
    const acc = new ToolCallAccumulator();
    for await (const chunk of stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delta = (chunk as any).choices?.[0]?.delta;
      if (delta?.content) {
        const { visible, reasoning } = think.push(delta.content);
        if (visible) {
          content += visible;
          yield { type: 'delta', text: visible };
        } else if (reasoning) {
          yield { type: 'reasoning' };
        }
      }
      if (delta?.tool_calls) acc.add(delta.tool_calls as ToolCallDelta[]);
    }
    const tail = think.flush();
    if (tail) { content += tail; yield { type: 'delta', text: tail }; }
    content = stripReasoning(content);

    let toolCalls = acc.result();
    let finalContent = content;
    if (toolCalls.length === 0) {
      const recovered = parseInlineToolCalls(content);
      if (recovered.length > 0) {
        toolCalls = recovered;
        finalContent = '';
      }
    }
    yield {
      type: 'final',
      content: finalContent,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    };
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/** Local Ollama backend (free, runs on your machine). */
export class OllamaModel implements ChatModel {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async *chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
    opts?: ChatOptions,
  ): AsyncGenerator<StreamPart> {
    // Use Ollama's NATIVE /api/chat endpoint (not the OpenAI-compat one) so we
    // can pass keep_alive and options.num_ctx — the OpenAI endpoint ignores both.
    yield* streamOllamaNative(
      this.config.ollamaBaseUrl,
      this.config,
      messages,
      tools,
      signal,
      opts?.think ?? true,
    );
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/** Local llama.cpp server (llama-server) — OpenAI-compatible endpoint. */
export class LlamaCppModel implements ChatModel {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async *chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamPart> {
    const url = `${this.config.llamaCppBaseUrl}/v1/chat/completions`;
    yield* streamOpenAICompat(
      url,
      this.config,
      messages,
      tools,
      signal,
      'llama.cpp',
      'Is the server running? Try: llama-server -m <model.gguf>',
    );
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/** Apple Silicon MLX backend (mlx_lm.server) — OpenAI-compatible endpoint. */
export class MlxModel implements ChatModel {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async *chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamPart> {
    const url = `${this.config.mlxBaseUrl}/v1/chat/completions`;
    yield* streamOpenAICompat(
      url,
      this.config,
      messages,
      tools,
      signal,
      'MLX server',
      'Is the server running? Try: python -m mlx_lm.server --model <model>',
    );
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/** Local vLLM backend — serves an OpenAI-compatible /v1/chat/completions endpoint. */
export class VLLMModel implements ChatModel {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async *chatStream(
    messages: Message[],
    tools: ToolSchema[] | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamPart> {
    const url = `${this.config.vllmBaseUrl}/v1/chat/completions`;
    yield* streamOpenAICompat(
      url,
      this.config,
      messages,
      tools,
      signal,
      'vLLM',
      'Is the server running? Try: vllm serve <model>',
    );
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/**
 * Query a vLLM server's /v1/models endpoint and return the available model IDs.
 * Returns an empty array if the server is unreachable or returns an error.
 */
export async function fetchVllmModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Recover tool calls that a model printed into its text content instead of
 * returning via the OpenAI `tool_calls` field. Handles:
 *   1. Llama-style `<function=name><parameter=key>value</parameter></function>`
 *   2. Qwen-style `<tool_call>{"name":"...","arguments":{...}}</tool_call>`
 *   3. Bare / ```json-fenced JSON objects `{"name":"...","arguments":{...}}`
 */
export function parseInlineToolCalls(content: string): ToolCall[] {
  if (!content) return [];

  const calls: ToolCall[] = [];

  // ── 1. <function=name><parameter=key>value</parameter></function> ──────────
  // Used by Llama 3.x and other models in prompt-based fallback mode.
  if (content.includes('<function=')) {
    for (const m of content.matchAll(/<function=([a-zA-Z_][a-zA-Z0-9_]*)[^>]*>([\s\S]*?)<\/function>/g)) {
      const name = m[1];
      if (!name) continue;
      const args: Record<string, string> = {};
      for (const p of (m[2] ?? '').matchAll(/<parameter=([a-zA-Z_][a-zA-Z0-9_]*)[^>]*>([\s\S]*?)<\/parameter>/g)) {
        if (p[1] && p[2] !== undefined) args[p[1]] = p[2].trim();
      }
      calls.push({
        id: `inline_${calls.length}`,
        function: { name, arguments: JSON.stringify(args) },
      });
    }
    if (calls.length > 0) return calls;
  }

  // Remaining formats all embed a JSON object with a "name" field.
  if (!content.includes('"name"')) return calls;

  // ── 2. <tool_call>{...}</tool_call> ─────────────────────────────────────────
  const candidates: string[] = [];
  for (const m of content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    if (m[1]) candidates.push(m[1]);
  }

  // ── 3. Bare / fenced JSON object ────────────────────────────────────────────
  if (candidates.length === 0) {
    // Strip ```json fences, then grab the first balanced {...} block — BUT only
    // when the message is essentially just that object. Otherwise ordinary prose
    // that merely quotes a `{"name": ...}` example (e.g. explaining a tool schema)
    // would be hijacked into a spurious tool call and the real text discarded.
    const cleaned = content.replace(/```(?:json)?/g, '').trim();
    if (cleaned.startsWith('{')) {
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}' && --depth === 0) {
          candidates.push(cleaned.slice(0, i + 1));
          break;
        }
      }
    }
  }

  for (const raw of candidates) {
    try {
      const obj = JSON.parse(raw) as {
        name?: string;
        arguments?: unknown;
        parameters?: unknown;
      };
      if (!obj.name) continue;
      const args = obj.arguments ?? obj.parameters ?? {};
      calls.push({
        id: `inline_${calls.length}`,
        function: {
          name: obj.name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args),
        },
      });
    } catch {
      // Not valid JSON — skip this candidate.
    }
  }
  return calls;
}

export function createModel(config: Config): ChatModel {
  if (config.backend === 'vllm')      return new VLLMModel(config);
  if (config.backend === 'llama_cpp') return new LlamaCppModel(config);
  if (config.backend === 'mlx')       return new MlxModel(config);
  return config.backend === 'ollama' ? new OllamaModel(config) : new HFModel(config);
}
