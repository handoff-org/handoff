import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaServeEnv } from '../src/agent/ollama.js';

test('ollamaServeEnv defaults to flash attention on + q8_0 KV cache', () => {
  const env = ollamaServeEnv({ PATH: '/bin' });
  assert.equal(env['OLLAMA_FLASH_ATTENTION'], '1');
  assert.equal(env['OLLAMA_KV_CACHE_TYPE'], 'q8_0');
  assert.equal(env['PATH'], '/bin'); // base env preserved
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
