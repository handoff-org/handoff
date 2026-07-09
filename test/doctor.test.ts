import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDoctorReport } from '../src/agent/doctor.js';
import { parseOllamaPs } from '../src/agent/ollama.js';
import { advise } from '../src/agent/advisor.js';
import {
  FULL_CATALOG,
  catalogForBackend,
  findCatalogEntry,
  isValidCatalogEntry,
  isAmbiguousTag,
  resolveOllamaTag,
} from '../config/catalog.js';
import type { HardwareProfile } from '../src/system/hardware.js';

function mac(gb: number): HardwareProfile {
  return {
    os: 'darwin',
    arch: 'arm64',
    appleSilicon: true,
    totalMemoryGb: gb,
    chipName: 'Apple M2 Pro',
    macTier: 'pro',
    macGeneration: 'M2',
    isMacBook: true,
    power: 'battery',
    gpuCores: 16,
    gpuVendor: 'apple',
    vramGb: null,
    gpuName: 'Apple M2 Pro',
    perfTier: gb <= 16 ? 'cool' : 'capable',
  };
}

// ── Catalog validation ────────────────────────────────────────────────────────

test('every catalog entry validates against the type guard', () => {
  for (const e of FULL_CATALOG) {
    assert.ok(isValidCatalogEntry(e), `invalid entry: ${(e as { id?: string }).id}`);
  }
});

test('catalog contains all required families', () => {
  const fams = new Set(FULL_CATALOG.map((e) => e.family));
  for (const f of ['qwen', 'gemma', 'deepseek', 'gpt_oss', 'glm', 'kimi', 'ornith', 'legacy']) {
    assert.ok(fams.has(f as never), `missing family ${f}`);
  }
});

test('Ornith is a first-class Ollama family with explicit 9b and 35b, :latest is an alias only', () => {
  const ollama = catalogForBackend('ollama').filter((e) => e.family === 'ornith');
  const ids = ollama.map((e) => e.id);
  assert.ok(ids.includes('ornith:9b'));
  assert.ok(ids.includes('ornith:35b'));
  // :latest resolves to 9b via alias, and is never a saved preferred id.
  assert.ok(!ids.includes('ornith:latest'));
  assert.equal(findCatalogEntry('ollama', 'ornith:latest')?.id, 'ornith:9b');
  assert.ok(isAmbiguousTag('ornith:latest'));
  assert.ok(isAmbiguousTag('ornith'));
  assert.ok(!isAmbiguousTag('ornith:9b'));
});

test('cloud/frontier models are marked cloud_opt_in or server_only, never plain local', () => {
  const kimi = findCatalogEntry('hf', 'moonshotai/Kimi-K2.7-Code')!;
  assert.equal(kimi.privacy, 'cloud_opt_in');
  const gptoss120 = findCatalogEntry('hf', 'openai/gpt-oss-120b')!;
  assert.equal(gptoss120.maturity, 'server_only');
});

test('resolveOllamaTag never invents a quant suffix on an id that already has one', () => {
  const e = findCatalogEntry('ollama', 'qwen3:8b')!;
  // default → the base id, no suffix (avoids inventing a non-existent tag)
  assert.equal(resolveOllamaTag(e, 'default'), 'qwen3:8b');
});

// ── Doctor report ─────────────────────────────────────────────────────────────

const PS_SPILL = `NAME                    ID              SIZE      PROCESSOR          UNTIL
qwen3-coder:30b         def456          19 GB     43%/57% CPU/GPU    4 minutes from now
`;

test('doctor warns when ollama ps shows a CPU spill', () => {
  const hw = mac(16);
  const psRows = parseOllamaPs(PS_SPILL);
  const report = buildDoctorReport({
    backend: 'ollama',
    modelId: 'qwen3-coder:30b',
    contextTokens: 64000,
    keepAlive: '30m',
    flashAttention: true,
    kvCacheType: 'q8_0',
    performanceMode: 'cool',
    hardware: hw,
    installedModels: ['qwen3-coder:30b', 'qwen3:8b'],
    psRows,
    advice: advise({
      hardware: hw,
      backend: 'ollama',
      performanceMode: 'cool',
      currentModelId: 'qwen3-coder:30b',
      currentContextTokens: 64000,
    }),
  });
  assert.match(report, /NOT fully on GPU|CPU spill/i);
  assert.match(report, /Detected|Hardware/);
  assert.match(report, /Suggested for your Mac|➜/);
});

test('doctor marks an out-of-catalog model as unchecked', () => {
  const report = buildDoctorReport({
    backend: 'ollama',
    modelId: 'some-unknown-model:99b',
    contextTokens: 8192,
    keepAlive: '30m',
    flashAttention: true,
    kvCacheType: 'q8_0',
    performanceMode: 'cool',
    hardware: mac(16),
  });
  assert.match(report, /unchecked/i);
});

test('doctor flags a large context window as risky via the advisor', () => {
  const hw = mac(16);
  const advice = advise({
    hardware: hw,
    backend: 'ollama',
    performanceMode: 'cool',
    currentModelId: 'qwen3:8b',
    currentContextTokens: 64000,
  });
  // The advisor should warn about the oversized context.
  assert.ok(advice.warnings.some((w) => /context/i.test(w)));
});
