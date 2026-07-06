import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { freshHome } from './helpers.js';

// Isolate HOME before importing — CONFIG_DIR is fixed at module load.
const home = freshHome();
const { readStore, writeStore } = await import('../config/store.js');
const { loadConfig } = await import('../config/schema.js');

const cfgDir = join(home, '.handoff');
const cfgFile = join(cfgDir, 'config.json');

test('loadConfig falls back to defaults on a wrong-typed stored value (no throw)', async () => {
  await mkdir(cfgDir, { recursive: true });
  await writeFile(
    cfgFile,
    JSON.stringify({ backend: 'not-a-backend', ollamaNumCtx: 'huge' }),
    'utf-8',
  );
  const cfg = await loadConfig();
  assert.equal(cfg.backend, 'ollama'); // default, not the corrupt value
  assert.equal(cfg.ollamaNumCtx, 64000); // default
});

test('loadConfig tolerates invalid JSON in config.json', async () => {
  await writeFile(cfgFile, '{ this is not json', 'utf-8');
  const cfg = await loadConfig();
  assert.equal(cfg.backend, 'ollama');
  assert.equal(cfg.theme, 'synthwave');
});

test('writeStore serializes concurrent updates without losing keys and leaves no temp files', async () => {
  await writeFile(cfgFile, '{}', 'utf-8');
  await Promise.all([
    writeStore({ theme: 'ocean' }),
    writeStore({ mode: 'auto' }),
    writeStore({ modelId: 'qwen3:8b' }),
    writeStore({ ollamaNumCtx: 8192 }),
  ]);
  const store = await readStore();
  assert.equal(store.theme, 'ocean');
  assert.equal(store.mode, 'auto');
  assert.equal(store.modelId, 'qwen3:8b');
  assert.equal(store.ollamaNumCtx, 8192);
  const files = await readdir(cfgDir);
  assert.ok(!files.some((f) => f.endsWith('.tmp')), `leftover temp files: ${files.join(', ')}`);
});

test('writeStore resolves (never rejects) even for an odd update', async () => {
  await assert.doesNotReject(writeStore({ favourites: [] }));
});

test('legacy ollamaNumCtx=64000 is migrated down to a hardware-aware value', async () => {
  await writeFile(cfgFile, JSON.stringify({ ollamaNumCtx: 64000 }), 'utf-8');
  const cfg = await loadConfig();
  assert.ok(cfg.ollamaNumCtx < 64000, `expected a smaller ctx, got ${cfg.ollamaNumCtx}`);
  // The migration write is fire-and-forget through the serialized chain; flush it.
  await writeStore({});
  const store = await readStore();
  assert.equal(store.contextMigrated, true);
});

test('an explicit ollamaNumCtx (not the legacy default) is preserved', async () => {
  await writeFile(cfgFile, JSON.stringify({ ollamaNumCtx: 12288 }), 'utf-8');
  const cfg = await loadConfig();
  assert.equal(cfg.ollamaNumCtx, 12288);
});

test('a deliberate 64000 with contextMigrated set is respected', async () => {
  await writeFile(cfgFile, JSON.stringify({ ollamaNumCtx: 64000, contextMigrated: true }), 'utf-8');
  const cfg = await loadConfig();
  assert.equal(cfg.ollamaNumCtx, 64000);
});

test('modelPerformanceMode defaults to cool and quant preference to auto', async () => {
  await writeFile(cfgFile, '{}', 'utf-8');
  const cfg = await loadConfig();
  assert.equal(cfg.modelPerformanceMode, 'cool');
  assert.equal(cfg.modelQuantizationPreference, 'auto');
});
