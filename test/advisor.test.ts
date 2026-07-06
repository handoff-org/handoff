import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HardwareProfile } from '../src/system/hardware.js';
import {
  advise,
  rankCandidates,
  defaultContextForHardware,
  effectiveBudgetGb,
  preferredQuant,
  classifyThroughput,
  type AdvisorInput,
  type BenchmarkRecord,
} from '../src/agent/advisor.js';
import { catalogForBackend, findCatalogEntry } from '../config/catalog.js';

function macbook(gb: number, tier: HardwareProfile['macTier'] = 'base', power: HardwareProfile['power'] = 'plugged'): HardwareProfile {
  const perfTier =
    gb <= 8 ? 'tiny' : gb <= 16 ? 'cool' : gb <= 24 ? 'balanced' : gb <= 36 ? 'capable' : 'high_end';
  return {
    os: 'darwin', arch: 'arm64', appleSilicon: true, totalMemoryGb: gb,
    chipName: `Apple M2${tier === 'base' ? '' : ' ' + tier[0]!.toUpperCase() + tier.slice(1)}`,
    macTier: tier, macGeneration: 'M2', isMacBook: true, power, gpuCores: 16,
    gpuVendor: 'apple', vramGb: null, gpuName: null,
    perfTier: perfTier as HardwareProfile['perfTier'],
  };
}

/** A Linux/Windows desktop with a discrete NVIDIA GPU: lots of RAM, bounded VRAM. */
function gpuPc(vramGb: number, ramGb = 64): HardwareProfile {
  const perfTier =
    vramGb >= 24 ? 'workstation' : vramGb >= 12 ? 'high_end' : vramGb >= 8 ? 'capable' : 'balanced';
  return {
    os: 'linux', arch: 'x64', appleSilicon: false, totalMemoryGb: ramGb,
    chipName: null, macTier: 'unknown', macGeneration: 'unknown', isMacBook: null, power: 'plugged',
    gpuCores: null, gpuVendor: 'nvidia', vramGb, gpuName: `NVIDIA RTX (${vramGb}GB)`,
    perfTier: perfTier as HardwareProfile['perfTier'],
  };
}

function input(hw: HardwareProfile, over: Partial<AdvisorInput> = {}): AdvisorInput {
  return { hardware: hw, backend: 'ollama', performanceMode: 'cool', ...over };
}

test('16 GB MacBook Cool mode never recommends a 30B as default', () => {
  const rec = advise(input(macbook(16))).recommended!;
  assert.ok(rec, 'should have a recommendation');
  assert.ok((rec.entry.totalParamsB ?? 0) <= 8, `expected <=8B, got ${rec.entry.label}`);
});

test('16 GB MacBook Cool recommends a small/fast model, not 20B+', () => {
  const rec = advise(input(macbook(16))).recommended!;
  assert.ok((rec.entry.totalParamsB ?? 99) < 14);
});

test('ornith:35b is never the default on 16/24/32 GB MacBooks', () => {
  for (const gb of [16, 24, 32]) {
    for (const mode of ['cool', 'balanced'] as const) {
      const rec = advise(input(macbook(gb, gb >= 32 ? 'pro' : 'base'), { performanceMode: mode, goalRole: 'coding_agent' })).recommended!;
      assert.notEqual(rec.entry.id, 'ornith:35b', `ornith:35b was default on ${gb}GB ${mode}`);
    }
  }
});

test('ornith:9b is an eligible coding candidate on MacBooks', () => {
  const ranked = rankCandidates(input(macbook(24, 'pro'), { goalRole: 'coding_agent' }));
  const ids = ranked.map((r) => r.entry.id);
  assert.ok(ids.includes('ornith:9b'));
  // and it should rank above ornith:35b
  assert.ok(ids.indexOf('ornith:9b') < ids.indexOf('ornith:35b'));
});

test('120B / frontier is never a default local suggestion on any MacBook', () => {
  for (const gb of [16, 32, 64]) {
    const rec = advise(input(macbook(gb, 'max'), { performanceMode: 'balanced' })).recommended!;
    assert.ok((rec.entry.totalParamsB ?? 0) < 70, `${rec.entry.label} on ${gb}GB`);
  }
});

test('24 GB MacBook default is 8-14B class, not 30B+', () => {
  const rec = advise(input(macbook(24, 'pro'))).recommended!;
  assert.ok((rec.entry.totalParamsB ?? 99) <= 14, `got ${rec.entry.label}`);
});

test('32 GB Pro Balanced may surface 20B but labelled warm/hot, not cool-safe', () => {
  const ranked = rankCandidates(input(macbook(32, 'pro'), { performanceMode: 'balanced', goalRole: 'tool_use' }));
  const gptoss = ranked.find((r) => r.entry.id === 'gpt-oss:20b');
  assert.ok(gptoss, 'gpt-oss:20b should be a candidate');
  assert.ok(gptoss!.risk === 'hot' || gptoss!.risk === 'warm');
});

test('a slow benchmark demotes a model below a fast alternative', () => {
  const hw = macbook(24, 'pro');
  const fp = ['darwin', 'arm64', hw.chipName, `${hw.totalMemoryGb}gb`].join('|').replace(/\s+/g, '');
  const bench: BenchmarkRecord[] = [
    { backend: 'ollama', modelId: 'qwen3:14b', quant: 'q4_K_M', contextTokens: 8192, hardwareFingerprint: fp, tokensPerSec: 1.5, fullGpu: true, toolCallOk: true },
  ];
  const withBench = rankCandidates(input(hw, { benchmarks: bench, goalRole: 'coding_agent' }));
  const without = rankCandidates(input(hw, { goalRole: 'coding_agent' }));
  const rankWith = withBench.findIndex((r) => r.entry.id === 'qwen3:14b');
  const rankWithout = without.findIndex((r) => r.entry.id === 'qwen3:14b');
  assert.ok(rankWith > rankWithout, 'slow benchmark should push qwen3:14b down the ranking');
});

test('a CPU-spill benchmark demotes a model and warns', () => {
  const hw = macbook(32, 'pro');
  const fp = ['darwin', 'arm64', hw.chipName, `${hw.totalMemoryGb}gb`].join('|').replace(/\s+/g, '');
  const bench: BenchmarkRecord[] = [
    { backend: 'ollama', modelId: 'gpt-oss:20b', quant: 'q4_K_M', contextTokens: 8192, hardwareFingerprint: fp, tokensPerSec: 12, fullGpu: false, toolCallOk: true },
  ];
  const adv = advise(input(hw, { benchmarks: bench, currentModelId: 'gpt-oss:20b', performanceMode: 'max' }));
  assert.ok(adv.warnings.some((w) => /not fully on GPU|CPU/i.test(w)));
});

test('context defaults are conservative and hardware-aware', () => {
  assert.equal(defaultContextForHardware(macbook(8), 'cool'), 4096);
  assert.equal(defaultContextForHardware(macbook(16), 'cool'), 8192);
  assert.ok(defaultContextForHardware(macbook(24), 'cool') <= 8192);
  assert.ok(defaultContextForHardware(macbook(64, 'max'), 'cool') <= 16384);
});

test('quant preference resolves to Q4_K_M on MacBook Cool mode (Ollama)', () => {
  const entry = findCatalogEntry('ollama', 'qwen3:8b')!;
  assert.equal(preferredQuant(entry, 'cool'), 'q4_K_M');
});

test('MLX Cool mode prefers 4-bit', () => {
  const entry = catalogForBackend('mlx')[0]!;
  assert.equal(preferredQuant(entry, 'cool'), 'mlx_4bit');
});

test('cloud models are not recommended without cloud backend + consent', () => {
  // On Ollama, cloud entries are not even in the backend catalog.
  const ranked = rankCandidates(input(macbook(16)));
  assert.ok(ranked.every((r) => r.entry.privacy !== 'cloud_opt_in'));
  // On HF without consent, cloud models are filtered out.
  const hf = rankCandidates({ hardware: macbook(16), backend: 'hf', performanceMode: 'balanced', cloudConsent: false });
  assert.ok(hf.every((r) => r.entry.privacy !== 'cloud_opt_in'));
});

test('HF with consent allows cloud models', () => {
  const hf = rankCandidates({ hardware: macbook(16), backend: 'hf', performanceMode: 'max', cloudConsent: true });
  assert.ok(hf.some((r) => r.entry.privacy === 'cloud_opt_in'));
});

test('classifyThroughput buckets and CPU-spill override', () => {
  assert.equal(classifyThroughput(25), 'excellent');
  assert.equal(classifyThroughput(12), 'good');
  assert.equal(classifyThroughput(6), 'usable');
  assert.equal(classifyThroughput(3), 'slow');
  assert.equal(classifyThroughput(1), 'bad');
  assert.equal(classifyThroughput(6, false), 'bad'); // spill forces bad
});

test('advisor warns about an ambiguous :latest tag', () => {
  const adv = advise(input(macbook(16), { currentModelId: 'ornith:latest' }));
  assert.ok(adv.warnings.some((w) => /explicit tag/i.test(w)));
});

test('8 GB MacBook default is a 3-4B class model', () => {
  const rec = advise(input(macbook(8))).recommended!;
  assert.ok((rec.entry.totalParamsB ?? 99) <= 4, `got ${rec.entry.label}`);
});

// ── Discrete-GPU (Linux/Windows) recommendations ────────────────────────────

test('effectiveBudgetGb keys off VRAM for a discrete GPU, not system RAM', () => {
  // 12 GB card in a 64 GB box → ~10 GB weight budget, NOT the 30+ GB RAM would imply.
  assert.equal(effectiveBudgetGb(gpuPc(12, 64)), 10);
  assert.equal(effectiveBudgetGb(gpuPc(24, 128)), 22);
});

test('12 GB GPU (with 64 GB RAM) never defaults to a 30B+ model', () => {
  for (const mode of ['cool', 'balanced', 'max'] as const) {
    const rec = advise(input(gpuPc(12), { performanceMode: mode, goalRole: 'coding_agent' })).recommended!;
    assert.ok(rec, `should recommend something in ${mode}`);
    assert.ok(
      (rec.entry.totalParamsB ?? 99) <= 15,
      `12 GB GPU ${mode} recommended ${rec.entry.label} (${rec.entry.totalParamsB}B) — too big for VRAM`,
    );
  }
});

test('a bigger GPU unlocks bigger models than a small one', () => {
  const small = advise(input(gpuPc(8), { performanceMode: 'balanced', goalRole: 'coding_agent' })).recommended!;
  const big = advise(input(gpuPc(24), { performanceMode: 'balanced', goalRole: 'coding_agent' })).recommended!;
  assert.ok(
    (big.entry.totalParamsB ?? 0) >= (small.entry.totalParamsB ?? 0),
    `24 GB (${big.entry.label}) should allow >= params than 8 GB (${small.entry.label})`,
  );
});

test('a model that overflows VRAM is flagged hot (spill), not safe', () => {
  // gpt-oss:20b (~13 GB at q4) cannot fit a 12 GB card.
  const ranked = rankCandidates(input(gpuPc(12), { performanceMode: 'max', goalRole: 'tool_use' }));
  const big = ranked.find((r) => (r.entry.totalParamsB ?? 0) >= 20);
  if (big) assert.equal(big.risk, 'hot', `${big.entry.label} should be hot (VRAM spill) on a 12 GB card`);
});

test('context defaults scale with VRAM on a discrete GPU', () => {
  assert.ok(defaultContextForHardware(gpuPc(8), 'cool') <= 8192);
  assert.ok(defaultContextForHardware(gpuPc(24), 'balanced') >= 16384);
});

// ── Personalization signals ────────────────────────────────────────────────────

test('a rejected model is scored down and never recommended', () => {
  const base = rankCandidates(input(macbook(24, 'pro'), { goalRole: 'coding_agent' }));
  const topId = base[0]!.entry.id;
  const withReject = advise(input(macbook(24, 'pro'), {
    goalRole: 'coding_agent',
    personalization: { rejectedModels: [topId] },
  }));
  assert.notEqual(withReject.recommended?.entry.id, topId, 'rejected model must not be recommended');
});

test('a preferred model gets a scoring boost', () => {
  // Pick an eligible-but-not-top model, then prefer it and check it climbs.
  const ranked = rankCandidates(input(macbook(24, 'pro'), { goalRole: 'coding_agent' }));
  const target = ranked[Math.min(2, ranked.length - 1)]!.entry.id;
  const before = ranked.findIndex((r) => r.entry.id === target);
  const after = rankCandidates(input(macbook(24, 'pro'), {
    goalRole: 'coding_agent',
    personalization: { preferredModels: [target] },
  })).findIndex((r) => r.entry.id === target);
  assert.ok(after <= before, `preferred model should not rank lower (${before} → ${after})`);
});

test('prefersFastSmallModels penalizes large models', () => {
  const plain = rankCandidates(input(macbook(64, 'max'), { performanceMode: 'max' }));
  const fastSmall = rankCandidates(input(macbook(64, 'max'), {
    performanceMode: 'max',
    personalization: { prefersFastSmallModels: true },
  }));
  const big = plain.find((r) => (r.entry.totalParamsB ?? 0) >= 20)?.entry.id;
  if (big) {
    const rankPlain = plain.findIndex((r) => r.entry.id === big);
    const rankFast = fastSmall.findIndex((r) => r.entry.id === big);
    assert.ok(rankFast >= rankPlain, 'a 20B+ model should not rank higher when fast/small is preferred');
  }
});
