import { platform, arch, totalmem } from 'os';
import { execFileSync } from 'child_process';

/**
 * Hardware profiling for the model advisor. Everything here is best-effort:
 * every probe is wrapped so a missing binary, a sandbox, or an unexpected output
 * format degrades to `unknown` instead of throwing. The profile is cached in
 * memory only — never persisted — because the same config can move between
 * machines.
 */

export type MacTier = 'base' | 'pro' | 'max' | 'ultra' | 'unknown';
export type MacGeneration = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'unknown';
export type PowerState = 'plugged' | 'battery' | 'unknown';
/**
 * Primary compute-GPU vendor. `apple` means unified memory (VRAM == system RAM,
 * so the RAM budget already covers it); `none` means no usable discrete GPU was
 * found (CPU inference); `unknown` means we couldn't probe (assume conservative).
 */
export type GpuVendor = 'apple' | 'nvidia' | 'amd' | 'intel' | 'none' | 'unknown';

/** Conservative capability tier — the coarse bucket the advisor ranks against. */
export type PerfTier =
  | 'tiny' // <=8 GB, or non-Apple-Silicon low memory
  | 'cool' // 8-16 GB MacBook
  | 'balanced' // 16-24 GB
  | 'capable' // 24-36 GB Pro/Max
  | 'high_end' // 36-64 GB Max
  | 'workstation' // 64 GB+ Ultra / Studio
  | 'server'; // linux/large non-Mac hosts

export interface HardwareProfile {
  os: 'darwin' | 'linux' | 'win32' | 'other';
  arch: string;
  appleSilicon: boolean;
  totalMemoryGb: number;
  chipName: string | null;
  macTier: MacTier;
  macGeneration: MacGeneration;
  /** true = laptop, false = desktop, null = unknown / not a Mac. */
  isMacBook: boolean | null;
  power: PowerState;
  gpuCores: number | null;
  /** Vendor of the primary compute GPU. Drives whether we budget off VRAM or RAM. */
  gpuVendor: GpuVendor;
  /**
   * Total VRAM (GB) of the primary discrete GPU, or null when unknown or when the
   * GPU shares system memory (Apple Silicon / integrated). This — not total RAM —
   * is the real budget for a discrete-GPU machine: weights that exceed it spill to
   * CPU and run slowly.
   */
  vramGb: number | null;
  gpuName: string | null;
  perfTier: PerfTier;
}

/** Run a command, returning trimmed stdout or null on any failure. Never throws. */
function safeExec(cmd: string, args: string[], timeoutMs = 1500): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** GB rounded from bytes. */
function toGb(bytes: number): number {
  return Math.round(bytes / 1e9);
}

/** Parse the Apple chip class + generation out of a brand string like "Apple M2 Pro". */
export function parseAppleChip(brand: string | null): {
  chipName: string | null;
  tier: MacTier;
  generation: MacGeneration;
} {
  if (!brand) return { chipName: null, tier: 'unknown', generation: 'unknown' };
  const m = brand.match(/Apple\s+(M[1-5])(?:\s+(Pro|Max|Ultra))?/i);
  if (!m) return { chipName: brand.includes('Apple') ? brand : null, tier: 'unknown', generation: 'unknown' };
  const gen = (m[1]!.toUpperCase() as MacGeneration) ?? 'unknown';
  const tierWord = m[2]?.toLowerCase();
  const tier: MacTier =
    tierWord === 'pro' ? 'pro' : tierWord === 'max' ? 'max' : tierWord === 'ultra' ? 'ultra' : 'base';
  const chipName = `Apple ${m[1]}${m[2] ? ' ' + m[2] : ''}`;
  return { chipName, tier, generation: gen };
}

/**
 * Parse `system_profiler SPHardwareDataType` text. Exported for tests: it must
 * cope with M1/M2 Pro/M3 Max/M4 and machines where the Chip line is absent.
 */
export function parseHardwareProfilerText(text: string): {
  chipName: string | null;
  tier: MacTier;
  generation: MacGeneration;
  isMacBook: boolean | null;
  memoryGb: number | null;
  totalCores: number | null;
} {
  const chipLine = text.match(/^\s*(?:Chip|Processor Name):\s*(.+)$/im)?.[1]?.trim() ?? null;
  const { chipName, tier, generation } = parseAppleChip(chipLine);

  const modelLine = text.match(/^\s*Model Name:\s*(.+)$/im)?.[1]?.trim() ?? null;
  const modelId = text.match(/^\s*Model Identifier:\s*(.+)$/im)?.[1]?.trim() ?? null;
  let isMacBook: boolean | null = null;
  const modelHay = `${modelLine ?? ''} ${modelId ?? ''}`;
  if (/MacBook/i.test(modelHay)) isMacBook = true;
  else if (/(iMac|Mac\s?Studio|Mac\s?Pro|Mac\s?mini|Macmini|MacPro|iMacPro)/i.test(modelHay)) isMacBook = false;

  const memMatch = text.match(/^\s*Memory:\s*(\d+)\s*GB/im);
  const memoryGb = memMatch ? Number(memMatch[1]) : null;

  // "Total Number of Cores: 12 (8 performance and 4 efficiency)" → 12
  const coresMatch = text.match(/Total Number of Cores:\s*(\d+)/i);
  const totalCores = coresMatch ? Number(coresMatch[1]) : null;

  return { chipName, tier, generation, isMacBook, memoryGb, totalCores };
}

/** Parse `pmset -g batt` output into a power state. Exported for tests. */
export function parsePmsetBatt(text: string | null): PowerState {
  if (!text) return 'unknown';
  if (/AC Power/i.test(text)) return 'plugged';
  if (/Battery Power/i.test(text)) return 'battery';
  // Fallback: the per-battery line ends in "; charging/discharging".
  if (/discharging/i.test(text)) return 'battery';
  if (/charging|charged/i.test(text)) return 'plugged';
  return 'unknown';
}

/** Parse GPU core count from `system_profiler SPDisplaysDataType`. */
export function parseGpuCores(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/Total Number of Cores:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Parse `nvidia-smi --query-gpu=memory.total,name --format=csv,noheader[,nounits]`.
 * Returns the largest GPU by VRAM (the real compute card when an iGPU is also
 * present). Copes with "12227 MiB, RTX 5070" and "12227, RTX 5070". Exported for
 * tests. Never throws.
 */
export function parseNvidiaSmi(text: string | null): { vramGb: number; name: string } | null {
  if (!text) return null;
  let best: { vramGb: number; name: string } | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s*(MiB|GiB|MB|GB)?\s*,\s*(.+)$/i);
    if (!m) continue;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const mib = /^g/i.test(m[2] ?? '') ? value * 1024 : value; // default unit is MiB
    const vramGb = Math.round(mib / 1024);
    const name = m[3]!.trim();
    if (!best || vramGb > best.vramGb) best = { vramGb, name };
  }
  return best;
}

/**
 * Largest AMD VRAM (GB) from sysfs `mem_info_vram_total` values (each in bytes).
 * Used only as an NVIDIA fallback on Linux. Exported for tests.
 */
export function parseAmdVramBytes(values: (string | null)[]): number | null {
  let maxBytes = 0;
  for (const v of values) {
    if (!v) continue;
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > maxBytes) maxBytes = n;
  }
  return maxBytes > 0 ? Math.round(maxBytes / 1e9) : null;
}

/**
 * Map a profile to a conservative capability tier. This intentionally biases
 * toward the safer (lower) tier — a MacBook is never treated as a workstation.
 */
export function computePerfTier(p: {
  os: HardwareProfile['os'];
  appleSilicon: boolean;
  totalMemoryGb: number;
  macTier: MacTier;
  isMacBook: boolean | null;
  gpuVendor?: GpuVendor;
  vramGb?: number | null;
}): PerfTier {
  if (p.os !== 'darwin') {
    // Discrete GPU: tier by VRAM — that's what actually runs the model fast.
    if ((p.gpuVendor === 'nvidia' || p.gpuVendor === 'amd') && p.vramGb) {
      const v = p.vramGb;
      if (v >= 40) return 'server';
      if (v >= 24) return 'workstation';
      if (v >= 12) return 'high_end';
      if (v >= 8) return 'capable';
      if (v >= 6) return 'balanced';
      return 'cool';
    }
    // No usable discrete GPU (CPU inference): bucket by system memory, as before.
    if (p.totalMemoryGb >= 48) return 'server';
    if (p.totalMemoryGb >= 24) return 'capable';
    if (p.totalMemoryGb >= 12) return 'balanced';
    return 'tiny';
  }
  if (!p.appleSilicon) {
    // Intel Mac — old, conservative.
    return p.totalMemoryGb >= 16 ? 'balanced' : 'tiny';
  }
  const desktop = p.isMacBook === false;
  const gb = p.totalMemoryGb;
  // Desktops (Studio/Ultra) get a bump because thermals are not laptop-bound.
  if (desktop && (p.macTier === 'ultra' || gb >= 96)) return 'workstation';
  if (gb <= 8) return 'tiny';
  if (gb <= 16) return 'cool';
  if (gb <= 24) return 'balanced';
  if (gb <= 36) return 'capable';
  if (gb <= 64) return desktop ? 'workstation' : 'high_end';
  return desktop ? 'workstation' : 'high_end';
}

let cached: HardwareProfile | null = null;

/** Detect the current machine. Cached in memory for the process lifetime. */
export function detectHardware(force = false): HardwareProfile {
  if (cached && !force) return cached;

  const os = (['darwin', 'linux', 'win32'].includes(platform()) ? platform() : 'other') as HardwareProfile['os'];
  const architecture = arch();
  const appleSilicon = os === 'darwin' && architecture === 'arm64';

  let totalMemoryGb = toGb(totalmem());
  let chipName: string | null = null;
  let macTier: MacTier = 'unknown';
  let macGeneration: MacGeneration = 'unknown';
  let isMacBook: boolean | null = null;
  let power: PowerState = 'unknown';
  let gpuCores: number | null = null;
  let gpuVendor: GpuVendor = 'unknown';
  let vramGb: number | null = null;
  let gpuName: string | null = null;

  if (os === 'darwin') {
    // Prefer the sysctl brand string (fast, always present) for chip parsing.
    const brand = safeExec('sysctl', ['-n', 'machdep.cpu.brand_string']);
    const parsed = parseAppleChip(brand);
    chipName = parsed.chipName;
    macTier = parsed.tier;
    macGeneration = parsed.generation;

    // sysctl hw.memsize is authoritative for unified memory.
    const memRaw = safeExec('sysctl', ['-n', 'hw.memsize']);
    if (memRaw && /^\d+$/.test(memRaw)) totalMemoryGb = toGb(Number(memRaw));

    // system_profiler fills in model (MacBook vs desktop) + refines the chip.
    const spHw = safeExec('system_profiler', ['SPHardwareDataType']);
    if (spHw) {
      const hw = parseHardwareProfilerText(spHw);
      if (hw.chipName) chipName = hw.chipName;
      if (hw.tier !== 'unknown') macTier = hw.tier;
      if (hw.generation !== 'unknown') macGeneration = hw.generation;
      if (hw.isMacBook !== null) isMacBook = hw.isMacBook;
      if (hw.memoryGb) totalMemoryGb = hw.memoryGb;
    }

    power = parsePmsetBatt(safeExec('pmset', ['-g', 'batt']));
    gpuCores = parseGpuCores(safeExec('system_profiler', ['SPDisplaysDataType'], 2500));

    // If system_profiler didn't resolve MacBook vs desktop, guess from power:
    // a battery means a laptop.
    if (isMacBook === null && power !== 'unknown') isMacBook = power === 'battery' || power === 'plugged' ? true : null;
  }

  // GPU / VRAM. Apple Silicon shares memory with the CPU, so the RAM budget
  // already covers it (vramGb stays null). On Linux/Windows the discrete GPU's
  // VRAM is the real budget, so probe it — best-effort, degrading to no-GPU.
  if (os === 'darwin') {
    gpuVendor = appleSilicon ? 'apple' : 'intel';
    gpuName = chipName;
  } else {
    // nvidia-smi is reliable on Linux & Windows and reports the true compute GPU
    // even when an integrated GPU is also present.
    const smi = parseNvidiaSmi(
      safeExec('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits']),
    );
    if (smi) {
      gpuVendor = 'nvidia';
      vramGb = smi.vramGb;
      gpuName = smi.name;
    } else if (os === 'linux') {
      // AMD discrete GPUs (ROCm) expose total VRAM in sysfs, in bytes.
      const raw = safeExec('sh', ['-c', 'cat /sys/class/drm/card*/device/mem_info_vram_total 2>/dev/null']);
      const amd = parseAmdVramBytes(raw ? raw.split('\n') : []);
      // Integrated GPUs carve out <2 GB; only count a real discrete card.
      if (amd != null && amd >= 2) {
        gpuVendor = 'amd';
        vramGb = amd;
      } else {
        gpuVendor = 'none';
      }
    } else {
      // Windows without nvidia-smi: VRAM is unreliable via WMI for >4 GB cards,
      // so leave it unknown rather than report a wrong number.
      gpuVendor = 'unknown';
    }
  }

  const perfTier = computePerfTier({ os, appleSilicon, totalMemoryGb, macTier, isMacBook, gpuVendor, vramGb });

  cached = {
    os,
    arch: architecture,
    appleSilicon,
    totalMemoryGb,
    chipName,
    macTier,
    macGeneration,
    isMacBook,
    power,
    gpuCores,
    gpuVendor,
    vramGb,
    gpuName,
    perfTier,
  };
  return cached;
}

/** A short, stable fingerprint for keying benchmark results per machine. */
export function hardwareFingerprint(p: HardwareProfile): string {
  return [p.os, p.arch, p.chipName ?? 'cpu', `${p.totalMemoryGb}gb`].join('|').replace(/\s+/g, '');
}

/**
 * A one-line human description, e.g. "Apple M2 Pro MacBook, 16 GB, on battery"
 * or "Linux x64, 61 GB RAM, NVIDIA GeForce RTX 5070 (12 GB VRAM)".
 */
export function describeHardware(p: HardwareProfile): string {
  if (p.os !== 'darwin') {
    const osLabel = p.os === 'win32' ? 'Windows' : p.os === 'linux' ? 'Linux' : p.os;
    let gpu: string;
    if (p.gpuName && p.vramGb) gpu = `, ${p.gpuName} (${p.vramGb} GB VRAM)`;
    else if (p.gpuName) gpu = `, ${p.gpuName}`;
    else if (p.vramGb) gpu = `, GPU ${p.vramGb} GB VRAM`;
    else if (p.gpuVendor === 'none') gpu = ', no discrete GPU (CPU)';
    else gpu = '';
    return `${osLabel} ${p.arch}, ${p.totalMemoryGb} GB RAM${gpu}`;
  }
  const chip = p.chipName ?? (p.appleSilicon ? 'Apple Silicon' : 'Intel Mac');
  const form = p.isMacBook === true ? 'MacBook' : p.isMacBook === false ? 'desktop Mac' : 'Mac';
  const power = p.power === 'battery' ? ', on battery' : p.power === 'plugged' ? ', plugged in' : '';
  return `${chip} ${form}, ${p.totalMemoryGb} GB${power}`;
}

/** Reset the in-memory cache — used by tests. */
export function _resetHardwareCache(): void {
  cached = null;
}
