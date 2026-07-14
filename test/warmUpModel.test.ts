import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmUpModel } from '../src/agent/ollama.js';

/** Swap in a fetch stub for the duration of `fn`, always restoring the original. */
async function withFetch(
  stub: (url: string, init: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    stub(String(url), init ?? {})) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

test('warmUpModel POSTs an empty-prompt /api/generate with keep_alive', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  await withFetch(
    async (url, init) => {
      calls.push({ url, body: bodyOf(init) });
      return { ok: true } as Response;
    },
    async () => {
      await warmUpModel('http://localhost:11434', 'qwen3:8b', '30m');
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'http://localhost:11434/api/generate');
  assert.equal(calls[0]!.body['model'], 'qwen3:8b');
  assert.equal(calls[0]!.body['keep_alive'], '30m');
  assert.equal(calls[0]!.body['stream'], false);
  // No prompt → Ollama loads the model without generating any tokens.
  assert.equal(calls[0]!.body['prompt'], undefined);
});

test('warmUpModel omits keep_alive when not provided', async () => {
  const bodies: Record<string, unknown>[] = [];
  await withFetch(
    async (_url, init) => {
      bodies.push(bodyOf(init));
      return { ok: true } as Response;
    },
    async () => {
      await warmUpModel('http://x', 'm');
    },
  );
  assert.ok(!('keep_alive' in bodies[0]!));
});

test('warmUpModel is best-effort: a fetch failure never throws', async () => {
  await withFetch(
    async () => {
      throw new Error('connection refused');
    },
    async () => {
      await assert.doesNotReject(warmUpModel('http://localhost:11434', 'm', '5m'));
    },
  );
});
