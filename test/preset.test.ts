import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPreset } from '../src/agent/presets.js';
import type { HardwareProfile } from '../src/system/hardware.js';

/** A 16 GB M-series MacBook, plugged in unless overridden. */
function mac(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    os: 'darwin',
    arch: 'arm64',
    appleSilicon: true,
    totalMemoryGb: 16,
    chipName: 'Apple M2 Pro',
    macTier: 'pro',
    macGeneration: 'M2',
    isMacBook: true,
    power: 'plugged',
    gpuCores: 16,
    gpuVendor: 'apple',
    vramGb: null,
    gpuName: 'Apple M2 Pro',
    perfTier: 'balanced',
    ...overrides,
  };
}

test('manual returns no changes', () => {
  assert.equal(applyPreset('manual', mac()), null);
});

test('cool bundles a tight context/output/keep-alive/budget', () => {
  const r = applyPreset('cool', mac())!;
  assert.equal(r.modelPerformanceMode, 'cool');
  assert.equal(r.maxNewTokens, 1024);
  assert.equal(r.ollamaKeepAlive, '5m');
  assert.equal(r.ollamaNumCtx, 8192); // 16GB Mac, cool
  // Budget is the preset nominal (5000) clamped to 60% of the context window.
  assert.equal(r.maxPromptTokens, Math.min(5000, Math.floor(8192 * 0.6)));
  assert.equal(r.warning, undefined);
});

test('fast clamps context to 4096', () => {
  const r = applyPreset('fast', mac())!;
  assert.equal(r.modelPerformanceMode, 'cool');
  assert.equal(r.ollamaNumCtx, 4096);
  assert.equal(r.maxPromptTokens, Math.min(4000, Math.floor(4096 * 0.6)));
});

test('balanced uses balanced mode and roomier output', () => {
  const r = applyPreset('balanced', mac())!;
  assert.equal(r.modelPerformanceMode, 'balanced');
  assert.equal(r.maxNewTokens, 2048);
  assert.equal(r.ollamaKeepAlive, '15m');
});

test('deep uses max mode', () => {
  const r = applyPreset('deep', mac({ totalMemoryGb: 32 }))!;
  assert.equal(r.modelPerformanceMode, 'max');
  assert.equal(r.maxNewTokens, 4096);
});

test('long_context pushes context to at least 32K and warns', () => {
  const r = applyPreset('long_context', mac())!;
  assert.ok(r.ollamaNumCtx >= 32768);
  assert.match(r.warning ?? '', /prefill latency/);
});

test('battery shortens keep-alive and warns for heavy presets', () => {
  const cool = applyPreset('cool', mac({ power: 'battery' }))!;
  assert.equal(cool.ollamaKeepAlive, '3m');

  const deep = applyPreset('deep', mac({ power: 'battery', totalMemoryGb: 32 }))!;
  assert.equal(deep.ollamaKeepAlive, '10m');
  assert.match(deep.warning ?? '', /battery/i);
});
