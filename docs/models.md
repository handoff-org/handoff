---
title: Choosing a model
nav_order: 6
---

# Choosing a model

handoff runs local models on your Mac. The guiding rule: **a smaller model that answers
fast beats a larger model that makes the app feel broken.**

## Performance modes

Set in `/settings → Performance mode`:

| Mode | Best for | Prefers |
|------|----------|---------|
| **Cool & fast** *(default)* | Laptops, everyday use | 4B–8B, Q4_K_M, 4096–8192 ctx |
| **Balanced** | Desktops, Mac Studio | 8B–14B, Q5, 8192–16384 ctx |
| **Max quality** | Explicit opt-in | 20B–30B+ local; shows heat warnings |

## Inference presets

Each preset bundles context window, max output, keep-alive, and prompt budget into one
choice. Switch with `/model cool|fast|balanced|deep` or `/settings → Inference preset`:

| Preset | Context | Max output | Keep-alive |
|--------|---------|-----------|-----------|
| **cool** | hardware default (≤8K on laptops) | 1024 | 5m / 3m battery |
| **fast** | 4096 | 1024 | 5m / 3m battery |
| **balanced** | hardware default | 2048 | 15m / 5m battery |
| **deep** | larger (per mode) | 4096 | 30m / 10m battery |
| **long context** | ≥32768 | 4096 | 30m / 10m battery |
| **manual** | your settings, unchanged | — | — |

Presets are battery-aware: keep-alive shortens on battery; `long context` warns before
applying (prefill is slow and hot on a laptop).

## Context compaction

Every turn, handoff trims the history *sent* to the model to a **prompt budget**. The calm
presets stay tight (`cool` ~5K, `fast` ~4K, `balanced` ~10K tokens); the roomy presets
(`deep`, `long_context`, and `manual`) scale with your context window — using most of it,
minus the reasoning-output reserve and a safety margin — so a bigger window keeps long
conversations coherent instead of dropping old turns early. The system prompt stays
byte-identical (for backend prefix-caching), recent turns are kept verbatim, old tool output
is capped, and the oldest turns are dropped — replaced by a short factual digest (what you
asked, what the assistant did, which tools it ran) so the model keeps their gist rather than a
blank. Your full conversation is still saved to disk and restored by `/resume`. Turn off with
`contextCompaction: false`.

If a turn is slow, handoff prints one actionable note ("CPU spill — try a smaller model
or lower context") rather than a stream of warnings.

**Reasoning models (Qwen3, DeepSeek-R1, etc.):** handoff floors `num_predict` at up to
8192 (half of `numCtx`, whichever is smaller) even for small presets. Without the floor,
the entire token budget can be spent inside `<think>` and the model returns an empty
answer. Short answers still stop early — this is a safety net, not a target. The prompt
budget above reserves the same amount, so the two can never together overflow the
context window mid-turn. If a turn still spends its whole budget reasoning and returns
nothing, handoff **automatically retries it once with thinking disabled** so you get an
answer instead of an error. If even that fails, it points you at `/model deep` (more output),
`/model long_context` (more window), or a non-reasoning model — whichever you're not already
on.

## Quantization

| Label | Quant | Trade-off |
|-------|-------|-----------|
| Cool / Fast | **Q4_K_M** (or MLX 4-bit) | ~50% size, fast, cool |
| Balanced | Q5_K_M | slightly larger, a little slower |
| Quality | Q8_0 | near-full quality, noticeably slower |
| Max | fp16 | maximum quality, largest footprint |

For Ollama, quantization is set by the model tag. For llama.cpp / MLX it's in the
filename. For vLLM / HF it's server-selected.

## Suggested defaults by Mac

| RAM | Cool/Fast default | Advanced (benchmark first) |
|-----|-------------------|---------------------------|
| 8 GB | `qwen3:4b` Q4, 4096 ctx | `qwen3:8b` |
| 16 GB | `qwen3:8b` Q4, 8192 ctx · `ornith:9b` for coding | `gemma3:12b`, 14B class |
| 24 GB | `qwen3:8b`/`14b`, 8192 ctx | 20B, 30B MoE |
| 32 GB Pro/Max | 14B/20B Q4, 8192–16384 ctx | 30B/35B |
| 64 GB | 20B/30B Q4 after benchmark | 70B+ = server/workstation only |
| Mac Studio/Ultra | larger local models | server frontier models |

**70B+ and frontier cloud models are never the default local suggestion on a MacBook.**

### Ornith

Ornith is a first-class Ollama coding family. Use explicit tags:

```sh
ollama pull ornith:9b     # fast/cool — great on MacBooks
ollama pull ornith:35b    # advanced/hot — 32 GB+ Pro/Max
```

## `/model doctor`

Prints a diagnostic panel: backend, model, context, hardware, processor split.
If the PROCESSOR column isn't `100% GPU`, the model has spilled onto the CPU —
switch to a smaller model, lower quantization, or smaller context.

## `/model benchmark`

Short synthetic benchmark: tokens/sec, time-to-first-token, tool-call test, GPU
confirmation. Results cached in `~/.handoff/model-benchmarks.json` and used to
**override** static recommendations for your machine.

```sh
/model benchmark           # full benchmark
/model benchmark --quick   # throughput only, no tool-call test
/model benchmark --model qwen3:8b   # benchmark without switching
```

Rough tiers: **20+ tok/s** excellent · **10–20** good · **5–10** usable · **<5 or CPU
spill** slow.
