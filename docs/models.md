---
title: Choosing a model
nav_order: 6
---

# Choosing a model

handoff runs local models on your Mac. The `/model` picker and its advisor are
built around one idea: **a smaller model that answers at a useful speed beats a
larger model that makes the app feel broken.**

## RAM is not speed

It is tempting to pick the biggest model that "fits" in unified memory. Don't.
Whether a model feels fast depends on far more than RAM:

- **Apple chip class and GPU tier** — an M2 base and an M3 Max with the same 16 GB
  behave very differently.
- **Quantization** — a Q4 build is roughly half the size and much faster than fp16.
- **Context window** — a large context inflates the KV cache and can push the model
  partly onto the CPU.
- **Thermals** — MacBooks throttle. A model that loads on a 64 GB MacBook can still
  run hot and slow.

If a model spills onto the CPU, throughput can collapse. handoff treats **"is this
model fully on the GPU?"** as a first-class question — see `/model doctor` below.

## Performance modes

Set these in `/settings → Performance mode` (it cycles cool → balanced → max):

| Mode | For | Prefers |
|------|-----|---------|
| **Cool & fast** *(default on MacBooks)* | Everyday use, laptops | 4B–8B models, Q4_K_M / MLX 4-bit, 4096–8192 context |
| **Balanced** | Desktops, Mac Studio, opt-in | 8B–14B (20B on Pro/Max), Q5, 8192–16384 context |
| **Max quality** | Explicit opt-in | 20B–30B+ local when reasonable; shows heat warnings; server/cloud with a privacy warning |

Changing the mode also re-derives a safe default context window.

## Inference presets

Performance mode is the advisor's *safety* knob. **Inference presets** are the
everyday knob: each one bundles the four settings that actually govern how a laptop
feels — context window, max output, keep-alive, and the prompt budget (below) — into
a single choice. Switch with `/model cool|fast|balanced|deep` (or `/settings →
Inference preset`):

| Preset | Feel | Context | Max output | Keep-alive (plugged/battery) |
|--------|------|---------|-----------|------------------------------|
| **cool** | lowest heat, battery-friendly | hardware default (≤8K on laptops) | 1024 | 5m / 3m |
| **fast** | lowest latency | 4096 | 1024 | 5m / 3m |
| **balanced** | the everyday default | hardware default | 2048 | 15m / 5m |
| **deep** | longer reasoning — prefer plugged in | larger (per mode) | 4096 | 30m / 10m |
| **long context** | ≥32K — costly prefill & heat, not on battery | ≥32768 | 4096 | 30m / 10m |
| **manual** | leave every knob exactly as you set it | — | — | — |

Presets are **battery-aware**: on battery, keep-alive is shortened and heavy presets
warn you. `long context` is never a default — it warns about prefill latency, memory,
and heat before it applies.

## Context compaction — why big context isn't the whole story

A large *context window* is not the same as a large *prompt*. Every turn, handoff
would otherwise re-send the entire conversation — including full tool outputs (a
10,000-line `run_code` log, a big file read) — and that re-sent prompt is what the
model has to re-read ("prefill") before it can answer. On a laptop, a prompt that
grows every turn means each reply gets slower and hotter.

handoff bounds this automatically. Each turn it trims the history *sent* to the model
to a **prompt budget** (cool ~5K tokens, balanced ~10K, deep ~20K — always capped at
60% of your context window, leaving room for the reply). The system prompt is kept
byte-identical (so backends can prefix-cache it), recent turns are kept verbatim, old
tool output is capped, and the oldest turns are dropped once the budget is hit. Your
**full** conversation is still saved to disk and restored by `/resume` — only what the
model re-reads each turn is trimmed. Turn it off with `contextCompaction: false`.

If a turn is genuinely slow, handoff prints one short, actionable note (e.g. "this
model ran CPU/GPU mixed — try a smaller model or lower context") rather than a stream
of warnings.

**Truncation and reasoning models.** If the reply is cut off mid-sentence, the model
hit its output token cap (`maxNewTokens`) before it finished. handoff detects this and
prints an actionable note ("try `/model balanced` or `/model deep` for a larger output
budget"). For **reasoning models** (Qwen3, DeepSeek-R1, etc.) that use `<think>` blocks,
handoff floors `num_predict` at 8192 even when a small preset is active — without the
floor, the entire token budget can be consumed inside `<think>` and the model returns an
empty answer. The floor is a safety net, not a target: short answers still stop early.

## Quantization, in plain English

| Label | Quant | Trade-off |
|-------|-------|-----------|
| Cool / Fast | **Q4_K_M** (or MLX 4-bit) | ~50% size, fast, cool — the best MacBook starting point |
| Balanced | Q5_K_M | slightly larger, a little slower, higher quality |
| Quality | Q8_0 / 8-bit | near-full quality, noticeably slower and warmer |
| Max / Hot | fp16 / default | maximum quality, largest footprint |

For **Ollama**, quantization is chosen by the model *tag* — handoff prefers Q4 and
lets Ollama pick the concrete build. For **llama.cpp/MLX** it lives in the file/repo
name. For **vLLM/HF** it is server-selected.

## Suggested defaults by Mac

These are produced by the advisor, not hard-coded — your exact suggestion depends on
chip class, power state, and any local benchmark:

| Unified memory | Cool/Fast default | Advanced (hot, benchmark first) |
|----------------|-------------------|----------------------------------|
| 8 GB  | `qwen3:4b` (Q4), 4096 ctx | `qwen3:8b` |
| 16 GB | `qwen3:8b` (Q4), 8192 ctx · `ornith:9b` for coding | `gemma3:12b`, 14B class |
| 24 GB | `qwen3:8b`/`14b`, `ornith:9b`, 8192 ctx | 20B, 30B MoE |
| 32 GB Pro/Max | 14B/20B (Q4), 8192–16384 ctx | 30B/35B |
| 64 GB MacBook | 20B/30B (Q4) after benchmark | 70B/120B = server/workstation only |
| Mac Studio / Ultra | larger local models allowed | server frontier models |

**70B / 120B / frontier models are never the default local suggestion on a
MacBook.** Cloud/server models (GLM-5.2, DeepSeek V4, Kimi, gpt-oss-120b) are labeled
and require the HuggingFace backend plus explicit consent.

### A note on Ornith

Ornith is a first-class Ollama coding family. Prefer explicit tags:

```
ollama pull ornith:9b     # Fast/Cool coding agent — great on MacBooks
ollama pull ornith:35b    # Advanced/Hot — 32 GB+ Pro/Max, benchmark first
```

Avoid `ollama run ornith` without a tag: `:latest` can drift over time, so handoff
nudges you toward `ornith:9b` / `ornith:35b`.

## `/model doctor`

`/model doctor` prints a diagnostic panel:

```
handoff · model doctor
  Backend          ollama
  Model            qwen3-coder:30b
  Context          64000
  ...
  Hardware         Apple M2 Pro MacBook, 16 GB, on battery
  Processor        43%/57% CPU/GPU
  ⚠ Ollama reports this model is NOT fully on GPU (CPU spill).
  ➜ Suggested for your Mac: qwen3:8b, q4_K_M, 8192 context. Fast, cool, good tool use.
```

If the **PROCESSOR** column is anything other than 100% GPU, the model has spilled
onto the CPU — switch to a smaller model, a lower quantization, or a smaller context.

## `/model benchmark`

`/model benchmark` runs a short, **synthetic** benchmark (no project data ever leaves
your machine). It measures approximate tokens/sec, time to first token, whether a
basic tool call works, and — for Ollama — whether the model stayed fully on the GPU.
Results are cached in `~/.handoff/model-benchmarks.json` keyed by model, quant,
context, and a hardware fingerprint, and they **override the static recommendations**:
a model that benchmarks slow or spills to CPU is demoted for your machine.

Flags:

- `/model benchmark --quick` — skip the tool-call test for a faster throughput-only read.
- `/model benchmark --model <id>` — benchmark a model other than the active one
  (e.g. `--model qwen3:8b`) without switching to it.

Rough throughput tiers: 20+ tok/s excellent · 10–20 good · 5–10 usable · 2–5 slow ·
<2 or CPU spill bad.
