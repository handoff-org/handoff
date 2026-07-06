import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  type Backend,
  type ModelEntry,
  type ModelTier,
  type FavouriteEntry,
  OLLAMA_MODELS,
  HF_MODELS,
  LLAMA_CPP_MODELS,
  MLX_MODELS,
  CATALOG_DATE,
  TIER_LABELS,
  TIER_ORDER,
} from '../config/models.js';
import { detectHardware, describeHardware } from '../src/system/hardware.js';
import { advise, type PerformanceMode } from '../src/agent/advisor.js';
import { sanitizeTyped } from './input.js';

const VELVET = '#a855f7';

type DisplayRow =
  | { kind: 'header'; label: string; tier?: ModelTier }
  | { kind: 'model'; entry: ModelEntry; isFav: boolean }
  | { kind: 'vllm-item'; modelId: string; isFav: boolean }
  | { kind: 'manual' };

interface Props {
  backend: Backend;
  vllmModels: string[];
  llamaCppModels: string[];
  mlxModels: string[];
  /** Installed Ollama model IDs from `ollama list` — powers the Downloaded section. */
  ollamaModels?: string[];
  favourites: FavouriteEntry[];
  currentModelId: string;
  performanceMode?: PerformanceMode;
  cloudConsent?: boolean;
  /** Learned model preferences from the local profile — drive scoring + badges. */
  preferredModels?: string[];
  rejectedModels?: string[];
  /** Model ids a prior benchmark flagged slow / CPU-spilled (from the benchmark cache). */
  slowModels?: string[];
  prefersFastSmallModels?: boolean;
  onSelect: (modelId: string, hasQuant: boolean) => void;
  onToggleFavourite: (modelId: string) => void;
  onCancel?: () => void;
}

function catalogFor(backend: Backend): ModelEntry[] {
  return backend === 'ollama' ? OLLAMA_MODELS
    : backend === 'hf' || backend === 'vllm' ? HF_MODELS
    : backend === 'llama_cpp' ? LLAMA_CPP_MODELS
    : backend === 'mlx' ? MLX_MODELS
    : [];
}

function buildRows(
  backend: Backend,
  vllmModels: string[],
  llamaCppModels: string[],
  mlxModels: string[],
  favourites: FavouriteEntry[],
  ollamaModels?: string[],
): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const curatedModels = catalogFor(backend);
  const curatedValues = new Set(curatedModels.map((m) => m.value));

  const serverModels: string[] =
    backend === 'vllm' ? vllmModels
    : backend === 'llama_cpp' ? llamaCppModels
    : backend === 'mlx' ? mlxModels
    : [];

  const safeFavs = favourites ?? [];
  const thisFavSet = new Set(
    safeFavs.filter((f) => f.backend === backend).map((f) => f.modelId),
  );
  const thisFavs = safeFavs.filter((f) => f.backend === backend);

  // Track model values already shown (Favourites + Downloaded) to avoid
  // repeating them in the tier groups.
  const shownValues = new Set<string>();

  // ── 1. Favourites ─────────────────────────────────────────────────
  if (thisFavs.length > 0) {
    rows.push({ kind: 'header', label: 'Favourites' });
    for (const fav of thisFavs) {
      const entry = curatedModels.find((m) => m.value === fav.modelId);
      if (entry) rows.push({ kind: 'model', entry, isFav: true });
      else rows.push({ kind: 'vllm-item', modelId: fav.modelId, isFav: true });
      shownValues.add(fav.modelId);
    }
  }

  // ── 2. Downloaded (Ollama only) ───────────────────────────────────
  if (backend === 'ollama' && ollamaModels && ollamaModels.length > 0) {
    const installedSet = new Set(ollamaModels);
    const installedCurated = curatedModels.filter(
      (m) => installedSet.has(m.value) && !shownValues.has(m.value),
    );
    const installedExtra = ollamaModels.filter(
      (id) => !curatedValues.has(id) && !shownValues.has(id),
    );
    if (installedCurated.length + installedExtra.length > 0) {
      rows.push({ kind: 'header', label: 'Downloaded' });
      for (const m of installedCurated) {
        rows.push({ kind: 'model', entry: m, isFav: false });
        shownValues.add(m.value);
      }
      for (const id of installedExtra) {
        rows.push({ kind: 'vllm-item', modelId: id, isFav: false });
        shownValues.add(id);
      }
    }
  }

  // ── 3. Curated catalog by RAM tier — only models not yet shown ────
  for (const tier of TIER_ORDER) {
    const inTier = curatedModels.filter(
      (m) => m.tier === tier && !shownValues.has(m.value),
    );
    if (inTier.length === 0) continue;
    rows.push({ kind: 'header', label: TIER_LABELS[tier], tier });
    for (const m of inTier) {
      rows.push({ kind: 'model', entry: m, isFav: thisFavSet.has(m.value) });
    }
  }

  // ── 4. Server-fetched models not in catalog ───────────────────────
  const extraServerModels = serverModels.filter(
    (id) => !curatedValues.has(id) && !shownValues.has(id),
  );
  if (extraServerModels.length > 0) {
    rows.push({ kind: 'header', label: 'Running on server' });
    for (const id of extraServerModels) {
      rows.push({ kind: 'vllm-item', modelId: id, isFav: thisFavSet.has(id) });
    }
  }

  // Manual entry for local-server backends.
  if (backend !== 'ollama' && backend !== 'hf') {
    rows.push({ kind: 'manual' });
  }

  return rows;
}

const backendLabel = (b: Backend): string =>
  b === 'ollama' ? 'Ollama'
  : b === 'hf' ? 'HuggingFace'
  : b === 'llama_cpp' ? 'llama.cpp'
  : b === 'mlx' ? 'MLX'
  : 'vLLM';

export function ModelMenu({
  backend,
  vllmModels,
  llamaCppModels,
  mlxModels,
  ollamaModels,
  favourites,
  currentModelId,
  performanceMode = 'cool',
  cloudConsent = false,
  preferredModels,
  rejectedModels,
  slowModels,
  prefersFastSmallModels,
  onSelect,
  onToggleFavourite,
  onCancel,
}: Props) {
  const [cursor, setCursor] = useState(0);
  const [isManual, setIsManual] = useState(false);
  const [manualInput, setManualInput] = useState('');
  // After pressing F the list reorders; track which model to keep focused.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const isLocal = backend === 'ollama' || backend === 'llama_cpp' || backend === 'mlx';
  const hw = useMemo(() => detectHardware(), []);
  // Hardware-aware advice replaces the old RAM-only recommendation.
  const advice = useMemo(
    () =>
      advise({
        hardware: hw,
        backend,
        performanceMode,
        currentModelId,
        cloudConsent,
        ...((preferredModels?.length || rejectedModels?.length || prefersFastSmallModels)
          ? {
              personalization: {
                ...(preferredModels ? { preferredModels } : {}),
                ...(rejectedModels ? { rejectedModels } : {}),
                ...(prefersFastSmallModels ? { prefersFastSmallModels } : {}),
              },
            }
          : {}),
      }),
    [hw, backend, performanceMode, currentModelId, cloudConsent, preferredModels, rejectedModels, prefersFastSmallModels],
  );
  const recommendedValue = advice.recommended?.entry.id;

  // Per-model personalization flags for the row badges (cheap; recomputed each render).
  const personalOf = (id: string) => ({
    preferred: preferredModels?.includes(id) ?? false,
    rejected: rejectedModels?.includes(id) ?? false,
    slow: slowModels?.includes(id) ?? false,
  });

  const displayRows = useMemo(
    () => buildRows(backend, vllmModels, llamaCppModels, mlxModels, favourites, ollamaModels),
    [backend, vllmModels, llamaCppModels, mlxModels, favourites, ollamaModels],
  );

  // Fixed label column width so hints line up. Capped for very long ids.
  const labelWidth = useMemo(() => {
    const lens = displayRows.map((r) =>
      r.kind === 'model' ? r.entry.label.length : r.kind === 'vllm-item' ? r.modelId.length : 0,
    );
    return Math.min(30, Math.max(12, ...lens, 0));
  }, [displayRows]);

  // Fixed badge column width so hints/keywords all start at the same column,
  // whether or not a row has a [tag]. Includes the leading space in badge().
  const badgeWidth = useMemo(() => {
    let max = 0;
    for (const r of displayRows) {
      if (r.kind === 'model') max = Math.max(max, badges(r.entry, personalOf(r.entry.value)).length);
    }
    return max;
  }, [displayRows, preferredModels, rejectedModels, slowModels]);

  // Max hint chars before truncation — keeps every row on a single line.
  const maxHintWidth = useMemo(() => {
    const cols = process.stdout.columns ?? 100;
    // overhead: cursor(2) + fav(2) + label + badge + spacing(2) + indicator(~12)
    return Math.max(20, Math.min(60, cols - labelWidth - badgeWidth - 18));
  }, [labelWidth, badgeWidth]);

  // Indices in displayRows that are navigable (non-header rows).
  const selectableIndices = useMemo(
    () =>
      displayRows.reduce<number[]>((acc, row, i) => {
        if (row.kind !== 'header') acc.push(i);
        return acc;
      }, []),
    [displayRows],
  );

  // After pressing F the list reorders (Favourites section inserted/removed at top).
  // Re-anchor the cursor to the same model in its new position.
  useEffect(() => {
    if (!pendingFocusId) return;
    const newIdx = selectableIndices.findIndex((i) => {
      const row = displayRows[i];
      const id =
        row?.kind === 'model' ? row.entry.value
        : row?.kind === 'vllm-item' ? row.modelId
        : null;
      return id === pendingFocusId;
    });
    if (newIdx !== -1) {
      setCursor(newIdx);
      setPendingFocusId(null);
    }
  }, [pendingFocusId, displayRows, selectableIndices]);

  const safeCursor = Math.min(cursor, Math.max(0, selectableIndices.length - 1));
  const currentRowIdx = selectableIndices[safeCursor] ?? 0;
  const currentRow = displayRows[currentRowIdx];

  useInput((char, key) => {
    if (isManual) {
      if (key.return) {
        const id = manualInput.trim();
        if (id) onSelect(id, false);
      } else if (key.escape) {
        setIsManual(false);
        setManualInput('');
      } else if (key.backspace || key.delete) {
        setManualInput((v) => v.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        const clean = sanitizeTyped(char);
        if (clean) setManualInput((v) => v + clean);
      }
      return;
    }

    if (key.escape && onCancel) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + selectableIndices.length) % selectableIndices.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % selectableIndices.length);
      return;
    }

    // Favourite toggle. Trim/normalise the char so a stray CR/space or an
    // uppercase 'F' from a shift-combo still matches on every terminal.
    if (char && char.trim().toLowerCase() === 'f') {
      const modelId =
        currentRow?.kind === 'model' ? currentRow.entry.value
        : currentRow?.kind === 'vllm-item' ? currentRow.modelId
        : null;
      if (modelId) {
        onToggleFavourite(modelId);
        setPendingFocusId(modelId);
      }
      return;
    }

    if (key.return) {
      if (currentRow?.kind === 'model') {
        onSelect(currentRow.entry.value, currentRow.entry.hasQuant);
      } else if (currentRow?.kind === 'vllm-item') {
        onSelect(currentRow.modelId, false);
      } else if (currentRow?.kind === 'manual') {
        setIsManual(true);
        setManualInput('');
      }
    }
  });

  if (isManual) {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color="cyan">Enter model ID — {backendLabel(backend)}</Text>
        <Text dimColor>Type the model ID exactly as loaded in your server.</Text>
        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="round" paddingX={1}>
            <Text color="green">{manualInput || ' '}</Text>
            <Text color="green" dimColor>|</Text>
          </Box>
          <Text dimColor>Enter to confirm · Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  const recTier = advice.recommended
    ? TIER_ORDER.find((t) => t === tierOfValue(recommendedValue, backend))
    : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Select model · {backendLabel(backend)}</Text>

      {/* Hardware-aware suggestion + risk warnings for local backends. */}
      {isLocal && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text dimColor>{hw.os === 'darwin' ? 'Your Mac: ' : 'Your machine: '}</Text>
            <Text>{describeHardware(hw)}</Text>
          </Box>
          {advice.recommended && (
            <Text color="cyan">➜ {advice.explanation}</Text>
          )}
          {advice.warnings.slice(0, 2).map((w, wi) => (
            <Text key={wi} color="yellow">⚠ {w}</Text>
          ))}
        </Box>
      )}

      {/* Model rows */}
      <Box flexDirection="column">
        {displayRows.map((row, i) => {
          const selIdx = selectableIndices.indexOf(i);
          const active = selIdx !== -1 && selIdx === safeCursor;

          if (row.kind === 'header') {
            const isRecTier = row.tier && row.tier === recTier;
            return (
              <Box key={i} marginTop={i === 0 ? 0 : 1}>
                <Text dimColor bold>{row.label}</Text>
                {isRecTier && <Text color="cyan"> · suggested tier</Text>}
              </Box>
            );
          }

          const label = row.kind === 'model' ? row.entry.label : row.kind === 'vllm-item' ? row.modelId : '';
          const value = row.kind === 'model' ? row.entry.value : row.kind === 'vllm-item' ? row.modelId : '';
          const rawHint = row.kind === 'model' ? (row.entry.hint ?? '') : '';
          const hint = rawHint.length > maxHintWidth ? rawHint.slice(0, maxHintWidth - 1) + '…' : rawHint;
          const isFav = row.kind === 'model' ? row.isFav : row.kind === 'vllm-item' ? row.isFav : false;
          const isCurrent = value !== '' && value === currentModelId;
          const isRecommended = value !== '' && value === recommendedValue;
          const entry = row.kind === 'model' ? row.entry : undefined;

          if (row.kind === 'manual') {
            return (
              <Box key={i}>
                <Text color={active ? 'green' : undefined} dimColor={!active}>
                  {active ? '❯ ' : '  '}{'  '}✎ Enter model ID manually
                </Text>
              </Box>
            );
          }

          const rowAccent = isFav ? VELVET : active ? 'green' : undefined;
          // Reserve a fixed badge column (badge text + trailing pad) so the
          // keyword hint always begins at the same column across every row.
          const badgeText = (entry ? badges(entry, personalOf(entry.value)) : '').padEnd(badgeWidth);
          return (
            <Box key={i}>
              <Text color={active ? 'green' : undefined}>{active ? '❯ ' : '  '}</Text>
              <Text color={isFav ? VELVET : undefined}>{isFav ? '★ ' : '  '}</Text>
              <Text color={rowAccent} bold={active || isFav}>
                {label.padEnd(labelWidth)}
              </Text>
              {badgeWidth > 0 && <Text color={isFav ? VELVET : undefined}>{badgeText}</Text>}
              {hint && <Text color={isFav ? VELVET : undefined} dimColor={!isFav}>  {hint}</Text>}
              {isCurrent && <Text color="green"> ●</Text>}
              {isRecommended && !isCurrent && <Text color="cyan"> · suggested</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑/↓ navigate · Enter select · F favourite{onCancel ? ' · Esc back' : ''}
        </Text>
        <Text dimColor>Catalog {CATALOG_DATE} · /model doctor for diagnostics · perf mode: {performanceMode}</Text>
      </Box>
    </Box>
  );
}

/** Compact badge for a model row — maturity + heat + learned personalization. */
function badges(e: ModelEntry, pz?: { preferred?: boolean; rejected?: boolean; slow?: boolean }): string {
  const parts: string[] = [];
  if (e.maturity === 'server_only') parts.push('srv');
  else if (e.maturity === 'cloud_only') parts.push('cld');
  else if (e.maturity === 'advanced') parts.push('adv');
  else if (e.maturity === 'experimental') parts.push('exp');
  if (e.heatRisk === 'high') parts.push('hot');
  else if (e.heatRisk === 'extreme') parts.push('v.hot');
  // Personalization (learned locally): rejection wins over preference.
  if (pz?.rejected) parts.push('rejected');
  else if (pz?.preferred) parts.push('✓you');
  if (pz?.slow) parts.push('slow');
  return parts.length ? ` [${parts.join('·')}]` : '';
}

/** The RAM tier a model id maps to (for the "suggested tier" header marker). */
function tierOfValue(value: string | undefined, backend: Backend): ModelTier | undefined {
  if (!value) return undefined;
  const list = backend === 'ollama' ? OLLAMA_MODELS
    : backend === 'hf' || backend === 'vllm' ? HF_MODELS
    : backend === 'llama_cpp' ? LLAMA_CPP_MODELS
    : MLX_MODELS;
  return list.find((m) => m.value === value)?.tier;
}
