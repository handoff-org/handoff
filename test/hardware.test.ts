import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAppleChip,
  parseHardwareProfilerText,
  parsePmsetBatt,
  parseGpuCores,
  parseNvidiaSmi,
  parseAmdVramBytes,
  computePerfTier,
  describeHardware,
  hardwareFingerprint,
  detectHardware,
} from '../src/system/hardware.js';

test('parseAppleChip reads M1/M2 Pro/M3 Max/M4', () => {
  assert.deepEqual(parseAppleChip('Apple M1'), {
    chipName: 'Apple M1',
    tier: 'base',
    generation: 'M1',
  });
  assert.deepEqual(parseAppleChip('Apple M2 Pro'), {
    chipName: 'Apple M2 Pro',
    tier: 'pro',
    generation: 'M2',
  });
  assert.deepEqual(parseAppleChip('Apple M3 Max'), {
    chipName: 'Apple M3 Max',
    tier: 'max',
    generation: 'M3',
  });
  assert.deepEqual(parseAppleChip('Apple M4'), {
    chipName: 'Apple M4',
    tier: 'base',
    generation: 'M4',
  });
  assert.deepEqual(parseAppleChip('Apple M2 Ultra'), {
    chipName: 'Apple M2 Ultra',
    tier: 'ultra',
    generation: 'M2',
  });
});

test('parseAppleChip degrades gracefully on unknown', () => {
  assert.deepEqual(parseAppleChip('Intel(R) Core(TM) i7'), {
    chipName: null,
    tier: 'unknown',
    generation: 'unknown',
  });
  assert.deepEqual(parseAppleChip(null), {
    chipName: null,
    tier: 'unknown',
    generation: 'unknown',
  });
});

const M2_PRO_MBP = `Hardware:

    Hardware Overview:

      Model Name: MacBook Pro
      Model Identifier: Mac14,9
      Chip: Apple M2 Pro
      Total Number of Cores: 12 (8 performance and 4 efficiency)
      Memory: 16 GB
      System Firmware Version: 10151.101.3
`;

const M3_MAX_STUDIO = `Hardware:

    Hardware Overview:

      Model Name: Mac Studio
      Model Identifier: Mac14,13
      Chip: Apple M3 Max
      Total Number of Cores: 16 (12 performance and 4 efficiency)
      Memory: 64 GB
`;

const M4_MINI = `Hardware:

    Hardware Overview:

      Model Name: Mac mini
      Model Identifier: Mac16,10
      Chip: Apple M4
      Memory: 24 GB
`;

const UNKNOWN = `Hardware:

    Hardware Overview:

      Model Name: Some Future Mac
      Memory: 32 GB
`;

test('parseHardwareProfilerText: M2 Pro MacBook', () => {
  const p = parseHardwareProfilerText(M2_PRO_MBP);
  assert.equal(p.chipName, 'Apple M2 Pro');
  assert.equal(p.tier, 'pro');
  assert.equal(p.generation, 'M2');
  assert.equal(p.isMacBook, true);
  assert.equal(p.memoryGb, 16);
  assert.equal(p.totalCores, 12);
});

test('parseHardwareProfilerText: M3 Max Studio is a desktop', () => {
  const p = parseHardwareProfilerText(M3_MAX_STUDIO);
  assert.equal(p.tier, 'max');
  assert.equal(p.generation, 'M3');
  assert.equal(p.isMacBook, false);
  assert.equal(p.memoryGb, 64);
});

test('parseHardwareProfilerText: M4 mini is a desktop', () => {
  const p = parseHardwareProfilerText(M4_MINI);
  assert.equal(p.generation, 'M4');
  assert.equal(p.tier, 'base');
  assert.equal(p.isMacBook, false);
  assert.equal(p.memoryGb, 24);
});

test('parseHardwareProfilerText: unknown machine degrades', () => {
  const p = parseHardwareProfilerText(UNKNOWN);
  assert.equal(p.chipName, null);
  assert.equal(p.tier, 'unknown');
  assert.equal(p.isMacBook, null);
  assert.equal(p.memoryGb, 32);
});

test('parsePmsetBatt', () => {
  assert.equal(parsePmsetBatt("Now drawing from 'AC Power'"), 'plugged');
  assert.equal(
    parsePmsetBatt(
      "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=...)  82%; discharging",
    ),
    'battery',
  );
  assert.equal(parsePmsetBatt(null), 'unknown');
  assert.equal(parsePmsetBatt('garbage'), 'unknown');
});

test('parseGpuCores', () => {
  assert.equal(parseGpuCores('Chipset Model: Apple M2 Pro\n      Total Number of Cores: 19'), 19);
  assert.equal(parseGpuCores(null), null);
});

test('computePerfTier: 16 GB MacBook is cool, 8 GB is tiny', () => {
  assert.equal(
    computePerfTier({
      os: 'darwin',
      appleSilicon: true,
      totalMemoryGb: 16,
      macTier: 'base',
      isMacBook: true,
    }),
    'cool',
  );
  assert.equal(
    computePerfTier({
      os: 'darwin',
      appleSilicon: true,
      totalMemoryGb: 8,
      macTier: 'base',
      isMacBook: true,
    }),
    'tiny',
  );
});

test('computePerfTier: 64 GB MacBook stays high_end, not workstation', () => {
  assert.equal(
    computePerfTier({
      os: 'darwin',
      appleSilicon: true,
      totalMemoryGb: 64,
      macTier: 'max',
      isMacBook: true,
    }),
    'high_end',
  );
});

test('computePerfTier: Ultra desktop is workstation', () => {
  assert.equal(
    computePerfTier({
      os: 'darwin',
      appleSilicon: true,
      totalMemoryGb: 128,
      macTier: 'ultra',
      isMacBook: false,
    }),
    'workstation',
  );
});

test('describeHardware produces a readable one-liner', () => {
  const s = describeHardware({
    os: 'darwin',
    arch: 'arm64',
    appleSilicon: true,
    totalMemoryGb: 16,
    chipName: 'Apple M2 Pro',
    macTier: 'pro',
    macGeneration: 'M2',
    isMacBook: true,
    power: 'battery',
    gpuCores: 16,
    gpuVendor: 'apple',
    vramGb: null,
    gpuName: 'Apple M2 Pro',
    perfTier: 'cool',
  });
  assert.match(s, /Apple M2 Pro MacBook, 16 GB, on battery/);
});

test('detectHardware never throws and returns a valid shape', () => {
  const p = detectHardware(true);
  assert.ok(['darwin', 'linux', 'win32', 'other'].includes(p.os));
  assert.ok(typeof p.totalMemoryGb === 'number' && p.totalMemoryGb > 0);
  assert.ok(typeof hardwareFingerprint(p) === 'string');
  // New GPU fields are always present.
  assert.ok(['apple', 'nvidia', 'amd', 'intel', 'none', 'unknown'].includes(p.gpuVendor));
  assert.ok(p.vramGb === null || typeof p.vramGb === 'number');
});

test('parseNvidiaSmi reads memory + name, picking the largest GPU', () => {
  // nounits form (memory.total is MiB by default)
  assert.deepEqual(parseNvidiaSmi('12227, NVIDIA GeForce RTX 5070'), {
    vramGb: 12,
    name: 'NVIDIA GeForce RTX 5070',
  });
  // with unit
  assert.deepEqual(parseNvidiaSmi('24564 MiB, NVIDIA GeForce RTX 4090'), {
    vramGb: 24,
    name: 'NVIDIA GeForce RTX 4090',
  });
  // multiple GPUs → largest wins
  const multi = '8188 MiB, NVIDIA A2000\n24564 MiB, NVIDIA RTX 4090';
  assert.deepEqual(parseNvidiaSmi(multi), { vramGb: 24, name: 'NVIDIA RTX 4090' });
});

test('parseNvidiaSmi degrades on empty/garbage', () => {
  assert.equal(parseNvidiaSmi(null), null);
  assert.equal(parseNvidiaSmi(''), null);
  assert.equal(parseNvidiaSmi('no gpu here'), null);
});

test('parseAmdVramBytes takes the largest card and ignores iGPU-sized noise', () => {
  // one big discrete card (16 GB) + a tiny iGPU carve-out
  assert.equal(parseAmdVramBytes(['17163091968', '536870912']), 17);
  assert.equal(parseAmdVramBytes([null, '  ', 'garbage']), null);
  assert.equal(parseAmdVramBytes([]), null);
});

test('computePerfTier: discrete GPU is tiered by VRAM, not system RAM', () => {
  // 12 GB card on a 64 GB box → high_end (not "server" off the 64 GB RAM)
  assert.equal(
    computePerfTier({
      os: 'linux',
      appleSilicon: false,
      totalMemoryGb: 64,
      macTier: 'unknown',
      isMacBook: null,
      gpuVendor: 'nvidia',
      vramGb: 12,
    }),
    'high_end',
  );
  // 24 GB card → workstation
  assert.equal(
    computePerfTier({
      os: 'linux',
      appleSilicon: false,
      totalMemoryGb: 32,
      macTier: 'unknown',
      isMacBook: null,
      gpuVendor: 'nvidia',
      vramGb: 24,
    }),
    'workstation',
  );
  // 8 GB card → capable
  assert.equal(
    computePerfTier({
      os: 'linux',
      appleSilicon: false,
      totalMemoryGb: 32,
      macTier: 'unknown',
      isMacBook: null,
      gpuVendor: 'nvidia',
      vramGb: 8,
    }),
    'capable',
  );
});

test('computePerfTier: no discrete GPU falls back to RAM buckets', () => {
  assert.equal(
    computePerfTier({
      os: 'linux',
      appleSilicon: false,
      totalMemoryGb: 64,
      macTier: 'unknown',
      isMacBook: null,
      gpuVendor: 'none',
      vramGb: null,
    }),
    'server',
  );
  assert.equal(
    computePerfTier({
      os: 'linux',
      appleSilicon: false,
      totalMemoryGb: 16,
      macTier: 'unknown',
      isMacBook: null,
      gpuVendor: 'none',
      vramGb: null,
    }),
    'balanced',
  );
});

test('describeHardware names the GPU + VRAM on a non-Mac', () => {
  const s = describeHardware({
    os: 'linux',
    arch: 'x64',
    appleSilicon: false,
    totalMemoryGb: 61,
    chipName: null,
    macTier: 'unknown',
    macGeneration: 'unknown',
    isMacBook: null,
    power: 'unknown',
    gpuCores: null,
    gpuVendor: 'nvidia',
    vramGb: 12,
    gpuName: 'NVIDIA GeForce RTX 5070',
    perfTier: 'high_end',
  });
  assert.match(s, /Linux x64, 61 GB RAM, NVIDIA GeForce RTX 5070 \(12 GB VRAM\)/);
});
