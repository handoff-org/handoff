import type { HardwareProfile } from '../system/hardware.js';
import { describeHardware } from '../system/hardware.js';
import type { OllamaPsRow } from './ollama.js';
import { psRowFor } from './ollama.js';
import type { Advice, BenchmarkRecord, PerformanceMode } from './advisor.js';
import { findCatalogEntry } from '../../config/catalog.js';
import type { BackendId } from '../system/types.js';

export interface DoctorInput {
  backend: BackendId;
  modelId: string;
  contextTokens: number;
  keepAlive: string | number;
  flashAttention: boolean;
  kvCacheType: string;
  performanceMode: PerformanceMode;
  hardware: HardwareProfile;
  installedModels?: string[];
  psRows?: OllamaPsRow[];
  benchmarks?: BenchmarkRecord[];
  advice?: Advice;
}

/**
 * Build the `/model doctor` diagnostic report as plain multi-line text. Pure and
 * deterministic (all live probes are passed in), so it is unit-testable with
 * mocked `ollama ps` output.
 */
export function buildDoctorReport(d: DoctorInput): string {
  const lines: string[] = [];
  const L = (label: string, value: string) => lines.push(`  ${label.padEnd(16)} ${value}`);

  lines.push('handoff · model doctor');
  lines.push('');
  L('Backend', d.backend);
  L('Model', d.modelId);
  const entry = findCatalogEntry(d.backend, d.modelId);
  if (entry) {
    L('Family', entry.family);
    L('Quant/tag', entry.defaultQuant ?? 'default');
  } else {
    L('Catalog', 'unchecked (not in catalog — availability unknown)');
  }
  L('Context', String(d.contextTokens));
  L('keep_alive', String(d.keepAlive));
  L('Flash attn', d.flashAttention ? 'on' : 'off');
  L('KV cache', d.kvCacheType);
  L('Perf mode', d.performanceMode);
  lines.push('');
  L('Hardware', describeHardware(d.hardware));
  L('Perf tier', d.hardware.perfTier);
  if (d.hardware.power !== 'unknown') L('Power', d.hardware.power);

  // Installed models (Ollama).
  if (d.backend === 'ollama' && d.installedModels) {
    lines.push('');
    L(
      'Installed',
      d.installedModels.length ? d.installedModels.slice(0, 12).join(', ') : '(none found)',
    );
  }

  // Live `ollama ps` — the first-class spill check.
  const row = d.psRows ? psRowFor(d.psRows, d.modelId) : undefined;
  if (row) {
    lines.push('');
    L('Loaded now', row.name);
    if (row.size) L('Size', row.size);
    if (row.processor) L('Processor', row.processor);
    if (row.until) L('Until', row.until);
    if (!row.fullGpu) {
      lines.push('');
      lines.push('  ⚠ Ollama reports this model is NOT fully on GPU (CPU spill).');
      lines.push(
        '    Choose a smaller model or a lower quantization, or reduce the context window.',
      );
    }
  }

  // Last local benchmark for this model.
  const bench = d.benchmarks?.find((b) => b.backend === d.backend && b.modelId === d.modelId);
  if (bench) {
    lines.push('');
    L(
      'Last benchmark',
      `${bench.tokensPerSec} tok/s${bench.fullGpu ? '' : ' · CPU spill'}${bench.toolCallOk ? '' : ' · tool-call FAILED'}`,
    );
  }

  // Advisor risk + suggestion.
  if (d.advice) {
    lines.push('');
    if (d.advice.warnings.length) {
      for (const w of d.advice.warnings) lines.push(`  ⚠ ${w}`);
    }
    if (d.advice.recommended) {
      lines.push('');
      lines.push(`  ➜ ${d.advice.explanation}`);
      for (const alt of d.advice.alternatives) {
        lines.push(
          `     · for ${alt.role}: ${alt.model.entry.label} (${alt.model.quant}, ctx ${alt.model.contextTokens})`,
        );
      }
    }
  }

  return lines.join('\n');
}
