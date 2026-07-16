import { InferenceClient } from '@huggingface/inference';
import type { Config } from '../../config/schema.js';
import type { ToolSchema } from '../tools/registry.js';
import { reasoningOutputReserve } from './contextBudget.js';
import { resolveOllamaUrl } from '../network/peerRouter.js';

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
  /**
   * Base64-encoded images attached to this message (no `data:` prefix — Ollama's
   * native format). Set by vision tools; only honored by multimodal models. The
   * OpenAI-compat/HF backends re-wrap these into `content` image_url blocks.
   */
  images?: string[];
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export type StreamPart =
  | { type: 'delta'; text: string }
  | { type: 'reasoning' } // model is inside a <think> block; no visible text this chunk
  | { type: 'final'; content: string; tool_calls?: ToolCall[]; truncated?: boolean }
  | { type: 'token_stats'; promptTokens: number; outputTokens: number };

/** Per-call overrides for a single chatStream request. */
export interface ChatOptions {
  /**
   * How the backend should reason this turn. Honored by the native Ollama path,
   * which accepts a boolean or a graduated level ('low'|'medium'|'high'):
   *   - true (default) — emit hidden reasoning in its own field
   *   - false — answer directly (fastest; also the retry when a turn reasoned
   *     itself out of an answer)
   *   - a level string — passed verbatim; models built for graduated reasoning
   *     (gpt-oss) honor it, others coerce to full thinking.
   * Set by the thinking-effort dial (src/agent/thinkingEffort.ts).
   */
  think?: boolean | 'low' | 'medium' | 'high';
  /**
   * Remove the output-token cap for this turn (max effort). A long reasoning +
   * answer then runs to the context limit instead of being truncated by
   * num_predict. Honored by the native Ollama path.
   */
  uncapOutput?: boolean;
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
  /** Input tokens used this turn (present on the final done:true chunk). */
  prompt_eval_count?: number;
  /** Output tokens generated this turn (present on the final done:true chunk). */
  eval_count?: number;
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
async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
export async function* readNDJSON(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
 *
 * Pass `assumeThinking = true` when the model's chat template prefills `<think>`
 * as the assistant prefix, so the opening tag is never in the stream. In this
 * "speculative" mode the filter buffers content and waits for `</think>` before
 * emitting any visible text. If `flush()` is called without ever seeing `</think>`,
 * the buffer is returned as visible content (the model replied directly, no thinking).
 */
export class ThinkFilter {
  private inThink: boolean;
  private carry = '';
  private specBuf = '';
  private speculative: boolean;

  constructor(assumeThinking = false) {
    this.inThink = assumeThinking;
    this.speculative = assumeThinking;
  }

  /**
   * Called when a native `thinking` field is detected in the stream, which means
   * Ollama is separating reasoning from content — `msg.content` is always visible
   * text, so speculative buffering is not needed. Returns any content that was
   * erroneously buffered (should be empty in practice).
   */
  exitSpeculative(): string {
    if (!this.speculative) return '';
    const buf = this.specBuf;
    this.specBuf = '';
    this.speculative = false;
    this.inThink = false;
    return buf;
  }

  push(chunk: string): { visible: string; reasoning: boolean } {
    if (this.speculative) {
      // Buffer everything until we find a </think> (confirms the template-prefilled
      // case) or a <think> (the model included an explicit opening tag — preamble
      // before it was visible text).
      this.specBuf += chunk;
      const openIdx = this.specBuf.indexOf('<think>');
      const closeIdx = this.specBuf.indexOf('</think>');
      if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
        // Explicit <think> appears before any </think> — content before it was visible.
        const preamble = this.specBuf.slice(0, openIdx);
        const afterOpen = this.specBuf.slice(openIdx + '<think>'.length);
        this.specBuf = '';
        this.speculative = false;
        this.inThink = true;
        const rest = afterOpen ? this.push(afterOpen) : { visible: '', reasoning: false };
        return { visible: preamble + rest.visible, reasoning: rest.reasoning };
      }
      if (closeIdx !== -1) {
        // </think> found (no prior <think>) — template-prefilled case confirmed.
        const after = this.specBuf.slice(closeIdx + '</think>'.length);
        this.specBuf = '';
        this.speculative = false;
        this.inThink = false;
        return after ? this.push(after) : { visible: '', reasoning: false };
      }
      return { visible: '', reasoning: true };
    }

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
    if (this.speculative) {
      // Never saw </think> — the model replied directly without thinking.
      const rest = this.specBuf;
      this.specBuf = '';
      this.speculative = false;
      this.inThink = false;
      return rest;
    }
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
  thinkMode: ChatOptions['think'] = true,
): AsyncGenerator<StreamPart> {
  const baseUrl = url.replace(/\/v1\/chat\/completions$/, '');
  // OpenAI-style reasoning control. Servers that support it (vLLM, newer
  // llama-server builds) read `reasoning_effort`; others ignore the field.
  // false → omit (let the server default, usually off); true → 'medium'.
  const reasoningEffort =
    thinkMode === false ? undefined : thinkMode === true ? 'medium' : thinkMode;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        messages: messages.map(toOpenAIContent),
        tools,
        ...(config.maxNewTokens ? { max_tokens: config.maxNewTokens } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
    } catch {
      /* keep raw body as fallback */
    }

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
      const detail =
        typeof obj.error === 'string' ? obj.error : (obj.error.message ?? 'stream error');
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
  if (tail) {
    content += tail;
    yield { type: 'delta', text: tail };
  }
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
    // No tool calls: pass the message through as-is. Ollama's native /api/chat
    // reads `images` (base64, no data: prefix) directly off any message, so a
    // plain `return m` already carries attachments.
    if (!m.tool_calls?.length) return m;
    return {
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
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
 * Guess the image MIME from the head of a base64 string, so the OpenAI-compat
 * `data:` URI declares the right type. Most vision servers sniff the bytes
 * anyway, but a correct label costs nothing.
 */
function b64ImageMime(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/png'; // PNG (iVBOR…) and default
}

/**
 * Serialize a message for the OpenAI-compatible backends (OpenAI-compat SSE, HF,
 * vLLM, llama.cpp, MLX). Messages without images pass through unchanged; a
 * message with `images` becomes the multimodal content-array form
 * (`[{type:'text'}, {type:'image_url', image_url:{url:'data:…'}}]`). Role and
 * tool linkage fields are preserved.
 */
export function toOpenAIContent(m: Message): unknown {
  if (!m.images?.length) return m;
  const parts: unknown[] = [];
  if (m.content) parts.push({ type: 'text', text: m.content });
  for (const b64 of m.images) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${b64ImageMime(b64)};base64,${b64}` },
    });
  }
  const out: Record<string, unknown> = { role: m.role, content: parts };
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  return out;
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
  thinkMode: ChatOptions['think'] = true,
  uncapOutput = false,
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
  //
  // uncapOutput (max effort) skips the cap entirely: generation runs to the
  // context limit so a long reasoning + answer is never truncated mid-thought.
  if (config.maxNewTokens && !uncapOutput) {
    options.num_predict = Math.max(
      config.maxNewTokens,
      reasoningOutputReserve(config.ollamaNumCtx),
    );
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
        // (leaving `content` clean). We pass it explicitly so a caller can tune
        // it: false forces a direct answer (fastest, and the retry path when a
        // model reasoned itself out of an answer); a level string ('low'|'high')
        // is honored by models built for graduated reasoning (gpt-oss) and
        // coerced to full thinking by others.
        think: thinkMode,
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
    } catch {
      /* keep raw body as fallback */
    }

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
      yield* streamOllamaNative(
        baseUrl,
        config,
        messages,
        undefined,
        signal,
        thinkMode,
        uncapOutput,
      );
      return;
    }

    // The server responded, so this is NOT a connectivity problem.
    throw new Error(`Ollama: ${cleanBackendError(res.status, detail)}`);
  }

  let content = '';
  // Always start in speculative mode: qwen3's Ollama template prefills `<think>`
  // when thinking is enabled (so the opening tag is never in the stream), and when
  // think:false is passed some variants still output untagged reasoning before the
  // answer. Speculative mode buffers content until `</think>` is seen (stripping the
  // reasoning) then switches to normal streaming. If `</think>` never arrives the
  // buffer is returned as visible text at flush() — acceptable for direct-reply turns.
  const think = new ThinkFilter(true);
  let sawNativeThinking = false;
  let nativeCalls: ToolCall[] = [];
  let doneReason: string | undefined;
  let promptEvalCount: number | undefined;
  let evalCount: number | undefined;
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
    if (msg?.thinking) {
      if (!sawNativeThinking) {
        // First native-thinking chunk confirms Ollama is separating reasoning from
        // content. Cancel speculative mode (buffer is empty in practice — content
        // chunks are empty while thinking) so the visible response streams normally.
        const flushed = think.exitSpeculative();
        if (flushed) {
          content += flushed;
          yield { type: 'delta', text: flushed };
        }
        sawNativeThinking = true;
      }
      yield { type: 'reasoning' };
    }
    if (msg?.content) {
      if (sawNativeThinking) {
        // Native thinking confirmed: content is always visible — bypass the filter.
        content += msg.content;
        yield { type: 'delta', text: msg.content };
      } else {
        // No native thinking (or not confirmed yet): run through the filter.
        // Speculative mode handles the template-prefilled-<think> case.
        const { visible, reasoning } = think.push(msg.content);
        if (visible) {
          content += visible;
          yield { type: 'delta', text: visible };
        } else if (reasoning) {
          yield { type: 'reasoning' };
        }
      }
    }
    // Native tool_calls arrive complete in one chunk (not fragmented like the
    // OpenAI-compat deltas), so no accumulator is needed.
    if (msg?.tool_calls?.length) {
      nativeCalls = nativeCalls.concat(nativeToolCallsToToolCalls(msg.tool_calls));
    }
    if (obj.done) {
      doneReason = obj.done_reason;
      promptEvalCount = obj.prompt_eval_count;
      evalCount = obj.eval_count;
      break;
    }
  }
  const tail = think.flush();
  if (tail) {
    content += tail;
    yield { type: 'delta', text: tail };
  }
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
  if (promptEvalCount !== undefined) {
    yield { type: 'token_stats', promptTokens: promptEvalCount, outputTokens: evalCount ?? 0 };
  }
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
    opts?: ChatOptions,
  ): AsyncGenerator<StreamPart> {
    // OpenAI-style reasoning control for providers that support it (ignored
    // elsewhere). false → omit; true → 'medium'; a level string → verbatim.
    const t = opts?.think ?? true;
    const reasoningEffort = t === false ? undefined : t === true ? 'medium' : t;
    let stream;
    try {
      stream = this.client.chatCompletionStream(
        {
          provider: 'auto',
          model: this.config.modelId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: messages.map(toOpenAIContent) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: tools as any,
          ...(this.config.maxNewTokens ? { max_tokens: this.config.maxNewTokens } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
    if (tail) {
      content += tail;
      yield { type: 'delta', text: tail };
    }
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
    // resolveOllamaUrl() may return the peer relay URL when local Ollama is
    // unreachable and peer network is enabled — the relay speaks the same API.
    const baseUrl = await resolveOllamaUrl(this.config);
    yield* streamOllamaNative(
      baseUrl,
      this.config,
      messages,
      tools,
      signal,
      opts?.think ?? true,
      opts?.uncapOutput ?? false,
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
    opts?: ChatOptions,
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
      opts?.think ?? true,
    );
  }

  get modelId(): string {
    return this.config.modelId;
  }
}

/**
 * mlx_lm.server rejects `{ role: 'system' }` messages with a 404. Merge all
 * system messages into the first user message so the conversation is valid.
 */
function mergeSystemMessages(messages: Message[]): Message[] {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content);
    else rest.push(m);
  }
  if (systemParts.length === 0) return messages;
  const prefix = systemParts.join('\n\n');
  const firstUser = rest.findIndex((m) => m.role === 'user');
  if (firstUser < 0) {
    return [{ role: 'user', content: prefix }, ...rest];
  }
  return rest.map((m, i) => (i === firstUser ? { ...m, content: `${prefix}\n\n${m.content}` } : m));
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
    opts?: ChatOptions,
  ): AsyncGenerator<StreamPart> {
    const url = `${this.config.mlxBaseUrl}/v1/chat/completions`;
    yield* streamOpenAICompat(
      url,
      this.config,
      mergeSystemMessages(messages),
      tools,
      signal,
      'MLX server',
      'Is the server running? Try: python -m mlx_lm.server --model <model>',
      opts?.think ?? true,
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
    opts?: ChatOptions,
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
      opts?.think ?? true,
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
    for (const m of content.matchAll(
      /<function=([a-zA-Z_][a-zA-Z0-9_]*)[^>]*>([\s\S]*?)<\/function>/g,
    )) {
      const name = m[1];
      if (!name) continue;
      const args: Record<string, string> = {};
      for (const p of (m[2] ?? '').matchAll(
        /<parameter=([a-zA-Z_][a-zA-Z0-9_]*)[^>]*>([\s\S]*?)<\/parameter>/g,
      )) {
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
  if (config.backend === 'vllm') return new VLLMModel(config);
  if (config.backend === 'llama_cpp') return new LlamaCppModel(config);
  if (config.backend === 'mlx') return new MlxModel(config);
  return config.backend === 'ollama' ? new OllamaModel(config) : new HFModel(config);
}
