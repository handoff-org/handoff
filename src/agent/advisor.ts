import type { HardwareProfile } from '../system/hardware.js';
import type { BackendId } from '../system/types.js';
import type {
  HandoffModelEntry,
  ModelRole,
  QuantId,
  QuantOption,
} from '../../config/catalog-types.js';
import { catalogForBackend, findCatalogEntry, isAmbiguousTag } from '../../config/catalog.js';

export type PerformanceMode = 'cool' | 'balanced' | 'max';

/** A prior benchmark result, keyed by model, used to override static ranking. */
export interface BenchmarkRecord {
  backend: BackendId;
  modelId: string;
  quant: string;
  contextTokens: number;
  hardwareFingerprint: string;
  tokensPerSec: number;
  fullGpu: boolean; // Ollama reported 100% GPU
  toolCallOk: boolean;
  timedOut?: boolean;
}

export type BenchmarkTier = 'excellent' | 'good' | 'usable' | 'slow' | 'bad';

export function classifyThroughput(tps: number, fullGpu = true): BenchmarkTier {
  if (!fullGpu) return 'bad'; // CPU spill: unusable regardless of raw speed
  if (tps >= 20) return 'excellent';
  if (tps >= 10) return 'good';
  if (tps >= 5) return 'usable';
  if (tps >= 2) return 'slow';
  return 'bad';
}

export interface AdvisorInput {
  hardware: HardwareProfile;
  backend: BackendId;
  installedModels?: string[]; // ollama list ids, or server-loaded ids
  goalRole?: ModelRole;
  performanceMode: PerformanceMode;
  currentModelId?: string;
  currentContextTokens?: number;
  benchmarks?: BenchmarkRecord[];
  /** Cloud consent already granted (only then may cloud models be recommended). */
  cloudConsent?: boolean;
  /** Learned model preferences from the local profile (see src/personalization/). */
  personalization?: {
    preferredModels?: string[];
    rejectedModels?: string[];
    prefersFastSmallModels?: boolean;
  };
}

export interface ScoredModel {
  entry: HandoffModelEntry;
  score: number;
  quant: QuantId;
  contextTokens: number;
  risk: 'safe' | 'warm' | 'hot' | 'server';
  breakdown: Record<string, number>;
}

export interface Advice {
  recommended: ScoredModel | null;
  alternatives: { role: string; model: ScoredModel }[];
  warnings: string[];
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

// ── Memory-budget model (conservative) ──────────────────────────────────────

/** Usable model-weight budget in GB after reserving for OS/Node/browser/GPU. */
export function modelBudgetGb(totalGb: number): number {
  if (totalGb <= 8) return 3.5;
  if (totalGb <= 16) return 7;
  if (totalGb <= 24) return 11;
  if (totalGb <= 32) return 15;
  if (totalGb <= 48) return 24;
  if (totalGb <= 64) return 30;
  return Math.round(totalGb * 0.6);
}

/**
 * The weight budget for the machine's *primary compute memory* — the number the
 * advisor must actually rank against:
 *   • discrete GPU (NVIDIA/AMD): VRAM, minus ~2 GB reserved for the KV cache and
 *     driver/runtime overhead. A 12 GB card ⇒ ~10 GB of weights, regardless of
 *     how much system RAM the box has.
 *   • Apple Silicon: unified memory, so the RAM-based budget is already correct.
 *   • CPU-only / undetected GPU: bounded by RAM but capped, because CPU inference
 *     of a large model is slow enough that recommending one is a disservice.
 */
export function effectiveBudgetGb(hw: HardwareProfile): number {
  if ((hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') && hw.vramGb) {
    return Math.max(1.5, hw.vramGb - 2);
  }
  if (hw.os === 'darwin') return modelBudgetGb(hw.totalMemoryGb);
  return Math.min(modelBudgetGb(hw.totalMemoryGb), 12);
}

/** Estimated weight footprint (GB) for an entry at a given quant. */
export function estimateWeightGb(entry: HandoffModelEntry, quant: QuantOption): number {
  const params = entry.totalParamsB ?? 8;
  const bpp = quant.estimatedBytesPerParam ?? 0.6;
  return params * bpp * 1.12; // +12% runtime overhead
}

/** KV-cache footprint (GB) — grows with context; used to penalize large ctx. */
export function estimateKvGb(entry: HandoffModelEntry, contextTokens: number): number {
  const params = entry.activeParamsB ?? entry.totalParamsB ?? 8;
  // Rough: ~1.2 MB per 1k tokens per active-B (q8 KV). Enough to make big ctx cost.
  return (contextTokens / 1000) * params * 0.0012;
}

// ── Hardware-aware context defaults ─────────────────────────────────────────

export function defaultContextForHardware(hw: HardwareProfile, mode: PerformanceMode): number {
  // Discrete GPU: the KV cache lives in VRAM too, so scale context off VRAM.
  if (hw.os !== 'darwin' && (hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') && hw.vramGb) {
    const v = hw.vramGb;
    let base = v >= 24 ? 32768 : v >= 16 ? 16384 : v >= 10 ? 8192 : v >= 6 ? 6144 : 4096;
    if (mode === 'max') base = Math.min(base * 2, 32768);
    else if (mode === 'cool') base = Math.min(base, 8192);
    return base;
  }
  const gb = hw.totalMemoryGb;
  const desktop = hw.isMacBook === false;
  if (hw.perfTier === 'workstation' || hw.perfTier === 'server') {
    return mode === 'max' ? 32768 : 16384;
  }
  let base: number;
  if (gb <= 8) base = 4096;
  else if (gb <= 16) base = 8192;
  else if (gb <= 24) base = mode === 'cool' ? 8192 : 12288;
  else if (gb <= 32) base = mode === 'cool' ? 8192 : 16384;
  else base = 16384; // 64 GB MacBook
  if (mode === 'cool' && !desktop) base = Math.min(base, 8192);
  return base;
}

// ── Quantization preference ─────────────────────────────────────────────────

export function preferredQuant(
  entry: HandoffModelEntry,
  mode: PerformanceMode,
): QuantId {
  const has = (id: QuantId) => entry.quantOptions.some((q) => q.id === id);
  if (entry.backend === 'hf' || entry.backend === 'vllm') return 'server_selected';
  if (entry.backend === 'mlx') return mode === 'max' && has('mlx_8bit') ? 'mlx_8bit' : 'mlx_4bit';
  // Ollama / llama.cpp
  if (mode === 'cool') return has('q4_K_M') ? 'q4_K_M' : (entry.defaultQuant ?? 'default');
  if (mode === 'balanced') return has('q5_K_M') ? 'q5_K_M' : has('q4_K_M') ? 'q4_K_M' : 'default';
  // max
  if (has('q8_0')) return 'q8_0';
  if (has('fp16')) return 'fp16';
  return has('q4_K_M') ? 'q4_K_M' : 'default';
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const MAC_TIER_RANK: Record<string, number> = { any: 0, apple_silicon: 1, pro: 2, max: 3, ultra: 4, server: 5 };
const HW_TIER_RANK: Record<string, number> = { base: 1, unknown: 1, pro: 2, max: 3, ultra: 4 };

function benchmarkFor(input: AdvisorInput, entry: HandoffModelEntry, ctx: number): BenchmarkRecord | undefined {
  const fp = hwFp(input.hardware);
  return input.benchmarks?.find(
    (b) => b.backend === entry.backend && b.modelId === entry.id && b.hardwareFingerprint === fp && Math.abs(b.contextTokens - ctx) <= 2048,
  );
}

// Local import to avoid a cycle at module top.
function hwFp(hw: HardwareProfile): string {
  return [hw.os, hw.arch, hw.chipName ?? 'cpu', `${hw.totalMemoryGb}gb`].join('|').replace(/\s+/g, '');
}

export function scoreModel(input: AdvisorInput, entry: HandoffModelEntry): ScoredModel {
  const { hardware: hw, performanceMode: mode } = input;
  const isLocal = entry.backend === 'ollama' || entry.backend === 'llama_cpp' || entry.backend === 'mlx';

  let quantOpt =
    entry.quantOptions.find((q) => q.id === preferredQuant(entry, mode)) ?? entry.quantOptions[0]!;
  // On a memory-bound local run, if the mode-preferred quant overflows the budget,
  // step down to the largest quant that still fits rather than shrinking the model.
  // This keeps "max" from ironically picking a *smaller* model than "balanced" on a
  // VRAM-limited GPU (q8 of a 9B won't fit 12 GB, but q5 will).
  if (isLocal) {
    const budget0 = effectiveBudgetGb(hw);
    if (estimateWeightGb(entry, quantOpt) > budget0) {
      const fitting = [...entry.quantOptions]
        .filter((q) => estimateWeightGb(entry, q) <= budget0)
        .sort((a, b) => estimateWeightGb(entry, b) - estimateWeightGb(entry, a))[0];
      if (fitting) quantOpt = fitting;
    }
  }
  const quant = quantOpt.id;
  const ctx = Math.min(defaultContextForHardware(hw, mode), entry.maxContextTokens ?? 32768);

  const breakdown: Record<string, number> = {};

  // fitScore: how comfortably weights+KV fit the machine's primary compute
  // memory — VRAM on a discrete-GPU box, unified RAM on a Mac.
  const budget = effectiveBudgetGb(hw);
  const weightGb = estimateWeightGb(entry, quantOpt);
  const need = weightGb + estimateKvGb(entry, ctx);
  const headroom = budget - need;
  let fit = 0;
  if (isLocal) {
    if (headroom >= budget * 0.25) fit = 30;
    else if (headroom >= 0) fit = 12;
    else if (headroom >= -budget * 0.15) fit = -25; // borderline: likely spill
    else fit = -80; // will not fit / heavy spill
  } else {
    fit = 20; // remote: memory not the local constraint
  }
  breakdown['fit'] = fit;

  // gpuScore: reward models that fit the accelerator, punish ones that won't.
  const active = entry.activeParamsB ?? entry.totalParamsB ?? 8;
  let gpu = 0;
  if (isLocal) {
    if (hw.os === 'darwin') {
      // Apple Silicon: bigger active params reward higher chip tiers.
      const hwRank = HW_TIER_RANK[hw.macTier] ?? 1;
      gpu = Math.max(-20, 10 - Math.max(0, active - hwRank * 8) * 1.2);
    } else if (hw.vramGb != null) {
      // Discrete GPU: fits VRAM (with headroom) → boost; else it will spill.
      gpu = weightGb <= hw.vramGb - 1.5 ? 8 : -18;
    } else {
      // CPU-only / undetected GPU: only small models stay responsive.
      gpu = active <= 8 ? 4 : active <= 14 ? -6 : -18;
    }
  }
  breakdown['gpu'] = gpu;

  // speedScore from catalog, adjusted by quant heat. Weighted modestly so a tiny
  // model's speed edge doesn't outrank a better-fitting mid model on a capable Mac.
  let speed = entry.speedScore * 3;
  if (quantOpt.heat === 'hot') speed -= 6;
  else if (quantOpt.heat === 'cool') speed += 2;
  breakdown['speed'] = speed;

  // heatPenalty: MacBook + battery + large params + hot quant + big ctx.
  let heat = 0;
  const macbook = hw.isMacBook !== false && hw.os === 'darwin';
  const totalB = entry.totalParamsB ?? 8;
  if (macbook) {
    if (totalB >= 20) heat -= 18;
    else if (totalB >= 14) heat -= 6;
    if (entry.heatRisk === 'high') heat -= 12;
    else if (entry.heatRisk === 'extreme') heat -= 40;
    if (hw.power === 'battery') heat -= 10;
    if (ctx > 8192) heat -= 6;
  }
  breakdown['heat'] = heat;

  // roleScore: match the requested goal. Tool use is weighted a little higher so
  // the strongest tool-capable model that fits wins the no-goal default.
  let role = 0;
  if (input.goalRole && entry.roles.includes(input.goalRole)) role += 14;
  if (input.goalRole === 'coding_agent') role += (entry.codingScore - 3) * 4;
  if (input.goalRole === 'tool_use' || !input.goalRole) role += (entry.toolUseScore - 3) * 4;
  if (input.goalRole === 'research_writing') role += (entry.writingScore - 3) * 3;
  if (input.goalRole === 'reasoning_verifier' || input.goalRole === 'reviewer') role += (entry.reasoningScore - 3) * 3;
  breakdown['role'] = role;

  // maturity: recommended > advanced > experimental/server/cloud.
  const maturity =
    entry.maturity === 'recommended' ? 16 : entry.maturity === 'advanced' ? -4 : -30;
  breakdown['maturity'] = maturity;

  // Mac-tier gating: model needs a higher chip class than we have → big penalty.
  // Only meaningful on Apple Silicon; on a discrete-GPU box VRAM fit governs.
  let tierPenalty = 0;
  if (isLocal && hw.os === 'darwin' && entry.minimumMacTier) {
    const needRank = MAC_TIER_RANK[entry.minimumMacTier] ?? 0;
    const haveRank = hw.perfTier === 'workstation' || hw.perfTier === 'server' ? 5 : (HW_TIER_RANK[hw.macTier] ?? 1);
    if (needRank > haveRank + 1) tierPenalty = -40;
    else if (needRank > haveRank) tierPenalty = -14;
  }
  breakdown['tier'] = tierPenalty;

  // benchmarkBoost / spillPenalty: real local data overrides static guesses.
  let bench = 0;
  const rec = benchmarkFor(input, entry, ctx);
  if (rec) {
    const t = classifyThroughput(rec.tokensPerSec, rec.fullGpu);
    bench += t === 'excellent' ? 28 : t === 'good' ? 16 : t === 'usable' ? 2 : t === 'slow' ? -30 : -70;
    if (!rec.fullGpu) bench -= 40; // CPU spill observed
    if (!rec.toolCallOk) bench -= 20; // fast but can't tool-call → not a good default
  }
  breakdown['benchmark'] = bench;

  // personalization: learned user preferences from the local profile. Explicit
  // rejections dominate (the user told us no); a preferred model gets a boost;
  // a stated preference for small/fast models penalises large ones.
  let personalization = 0;
  const pz = input.personalization;
  if (pz) {
    if (pz.rejectedModels?.includes(entry.id)) personalization -= 60;
    if (pz.preferredModels?.includes(entry.id)) personalization += 24;
    if (pz.prefersFastSmallModels && totalB >= 20) personalization -= 12;
  }
  breakdown['personalization'] = personalization;

  const score = fit + gpu + speed + heat + role + maturity + tierPenalty + bench + personalization;

  // On a discrete GPU, "hot" means the weights won't fit VRAM and will spill to
  // CPU (the desktop-GPU equivalent of a MacBook running hot).
  const spillsVram = isLocal && hw.vramGb != null && weightGb > hw.vramGb - 1.0;

  const risk: ScoredModel['risk'] =
    entry.maturity === 'server_only' || entry.maturity === 'cloud_only'
      ? 'server'
      : spillsVram
        ? 'hot'
        : macbook && (totalB >= 20 || entry.heatRisk === 'high' || entry.heatRisk === 'extreme')
          ? 'hot'
          : totalB >= 14 || entry.heatRisk === 'medium'
            ? 'warm'
            : 'safe';

  return { entry, score, quant, contextTokens: ctx, risk, breakdown };
}

// ── Candidate filtering ──────────────────────────────────────────────────────

function eligible(input: AdvisorInput, entry: HandoffModelEntry): boolean {
  // Cloud models require explicit cloud backend + consent.
  if (entry.privacy === 'cloud_opt_in' || entry.maturity === 'cloud_only') {
    if (input.backend !== 'hf' || !input.cloudConsent) return false;
  }
  // Server-only models are never a *default* local suggestion.
  if (entry.maturity === 'server_only' && input.performanceMode !== 'max') {
    if (input.hardware.perfTier !== 'workstation' && input.hardware.perfTier !== 'server') return false;
  }
  return true;
}

/** Rank all candidates for the backend. */
export function rankCandidates(input: AdvisorInput): ScoredModel[] {
  const list = catalogForBackend(input.backend).filter((e) => eligible(input, e));
  const installed = new Set(input.installedModels ?? []);
  return list
    .map((e) => {
      const s = scoreModel(input, e);
      // Small nudge toward already-installed local models (no pull needed).
      if (installed.has(e.id) || e.aliases?.some((a) => installed.has(a))) s.score += 6;
      return s;
    })
    .sort((a, b) => b.score - a.score);
}

// ── Public advisor ────────────────────────────────────────────────────────────

export function advise(input: AdvisorInput): Advice {
  const ranked = rankCandidates(input);
  const warnings: string[] = [];

  // The recommendation: highest score that is not server/hot in cool mode.
  const smoothFirst = ranked.filter((s) => {
    if (input.performanceMode === 'max') return true;
    if (input.performanceMode === 'balanced') return s.risk !== 'server';
    return s.risk === 'safe' || s.risk === 'warm'; // cool
  });
  const recommended = smoothFirst[0] ?? ranked[0] ?? null;

  // Alternatives by role — best coding/writing/reasoning that are eligible.
  const byRole = (role: ModelRole, label: string) => {
    const m = ranked.find((s) => s.entry.roles.includes(role) && s !== recommended);
    return m ? { role: label, model: m } : null;
  };
  const alternatives = [
    byRole('coding_agent', 'coding/tools'),
    byRole('research_writing', 'research writing'),
    byRole('reasoning_verifier', 'reasoning/audit'),
  ].filter((x): x is { role: string; model: ScoredModel } => x != null);

  // Warn about the current model if it looks too big/hot or the context is unsafe.
  if (input.currentModelId) {
    const cur = findCatalogEntry(input.backend, input.currentModelId);
    if (cur) {
      const scored = scoreModel(input, cur);
      if (scored.risk === 'hot' || scored.risk === 'server') {
        const hw = input.hardware;
        const lead =
          hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd'
            ? `${cur.label} likely exceeds your ${hw.vramGb ?? '?'} GB of VRAM and will spill to CPU.`
            : hw.os === 'darwin'
              ? `${cur.label} may run hot or spill to CPU on this Mac.`
              : `${cur.label} may be too large for this machine and spill to CPU.`;
        warnings.push(
          `${lead} ` + (recommended ? `Try ${recommended.entry.label} ${labelQuant(recommended)} instead.` : ''),
        );
      }
      const bench = input.benchmarks?.find(
        (b) => b.modelId === cur.id && b.hardwareFingerprint === hwFp(input.hardware),
      );
      if (bench && !bench.fullGpu) {
        warnings.push('Ollama reports this model is not fully on GPU. Choose a smaller model or lower quantization.');
      }
    }
    if (isAmbiguousTag(input.currentModelId)) {
      warnings.push('Use an explicit tag (e.g. ornith:9b or ornith:35b) so recommendations stay stable.');
    }
    if (input.currentContextTokens && recommended && input.currentContextTokens > recommended.contextTokens * 2) {
      warnings.push(
        `Your context window (${input.currentContextTokens}) is large and may force CPU offload. Try ${recommended.contextTokens}.`,
      );
    }
  }

  const explanation = recommended
    ? `Suggested for ${machineNoun(input.hardware)}: ${recommended.entry.label}, ${labelQuant(recommended)}, ${recommended.contextTokens} context. ` +
      riskSentence(recommended, input.hardware)
    : 'No suitable model found for this backend and hardware.';

  const confidence: Advice['confidence'] = input.benchmarks?.length ? 'high' : recommended ? 'medium' : 'low';

  return { recommended, alternatives, warnings, explanation, confidence };
}

function labelQuant(s: ScoredModel): string {
  return s.quant === 'server_selected' ? 'server-selected' : s.quant === 'default' ? 'default tag' : s.quant;
}

/** Hardware-appropriate noun for the recommendation sentence. */
function machineNoun(hw: HardwareProfile): string {
  if (hw.os === 'darwin') return hw.isMacBook === false ? 'this Mac' : 'this MacBook';
  if (hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd') return 'your GPU';
  return 'this machine';
}

function riskSentence(s: ScoredModel, hw: HardwareProfile): string {
  const discrete = hw.gpuVendor === 'nvidia' || hw.gpuVendor === 'amd';
  switch (s.risk) {
    case 'safe':
      return 'Fast, cool, good tool use.';
    case 'warm':
      return 'Balanced; may warm up under load.';
    case 'hot':
      return discrete
        ? 'May exceed VRAM and spill to CPU — benchmark before relying on it.'
        : hw.os === 'darwin'
          ? 'May run hot on MacBooks — benchmark before making it your default.'
          : 'Large for this machine — benchmark before relying on it.';
    case 'server':
      return 'Recommended for servers/cloud, not local use.';
  }
}
