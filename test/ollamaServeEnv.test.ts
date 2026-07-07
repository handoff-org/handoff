import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaServeEnv } from '../src/agent/ollama.js';

test('ollamaServeEnv defaults to flash attention on + q8_0 KV cache', () => {
  const env = ollamaServeEnv({ PATH: '/bin' });
  assert.equal(env['OLLAMA_FLASH_ATTENTION'], '1');
  assert.equal(env['OLLAMA_KV_CACHE_TYPE'], 'q8_0');
  assert.equal(env['PATH'], '/bin'); // base env preserved
});

test('ollamaServeEnv pins num_parallel to 1 by default (single-user TUI)', () => {
  // Ollama sizes the KV cache as num_ctx × num_parallel; its multi-slot default
  // makes a single user pay several times the KV memory. 1 is a pure win here.
  assert.equal(ollamaServeEnv({})['OLLAMA_NUM_PARALLEL'], '1');
});

test('ollamaServeEnv honors an inherited OLLAMA_NUM_PARALLEL, else an explicit opt', () => {
  // A power user who exported their own value keeps it…
  assert.equal(ollamaServeEnv({ OLLAMA_NUM_PARALLEL: '3' })['OLLAMA_NUM_PARALLEL'], '3');
  // …but an explicit option wins over the inherited env.
  assert.equal(
    ollamaServeEnv({ OLLAMA_NUM_PARALLEL: '3' }, { numParallel: 1 })['OLLAMA_NUM_PARALLEL'],
    '1',
  );
});

test('ollamaServeEnv turns flash attention off when disabled', () => {
  const env = ollamaServeEnv({}, { flashAttention: false });
  assert.equal(env['OLLAMA_FLASH_ATTENTION'], '0');
});

test('ollamaServeEnv applies the chosen KV-cache type', () => {
  assert.equal(ollamaServeEnv({}, { kvCacheType: 'f16' })['OLLAMA_KV_CACHE_TYPE'], 'f16');
  assert.equal(ollamaServeEnv({}, { kvCacheType: 'q4_0' })['OLLAMA_KV_CACHE_TYPE'], 'q4_0');
});

test('ollamaServeEnv explicit flags override an inherited base env', () => {
  // The installer may export OLLAMA_FLASH_ATTENTION=1 in the shell; a user who
  // toggles it OFF in /settings must win for the server handoff spawns.
  const env = ollamaServeEnv(
    { OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' },
    { flashAttention: false, kvCacheType: 'f16' },
  );
  assert.equal(env['OLLAMA_FLASH_ATTENTION'], '0');
  assert.equal(env['OLLAMA_KV_CACHE_TYPE'], 'f16');
});
