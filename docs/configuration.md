---
layout: doc
title: Configuration
---

# Configuration

Precedence: **env variable → `~/.handoff/config.json` → built-in default.**
The wizard and in-app commands write `config.json` for you — you rarely need to edit it by hand.

## Config fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `backend` | `ollama` \| `llama_cpp` \| `mlx` \| `vllm` \| `hf` | `ollama` | Model backend. |
| `modelId` | string | `qwen3:8b` | Active model. |
| `ollamaBaseUrl` | string | `http://localhost:11434` | Ollama endpoint. |
| `ollamaKeepAlive` | string \| number | `30m` | How long Ollama keeps the model resident. `-1` pins it for the session. |
| `ollamaNumCtx` | number | hardware-aware | Context window (`num_ctx`). Defaults to a safe value for your Mac (4096–16384). |
| `ollamaFlashAttention` | boolean | `true` | Flash attention. Applied at server startup. |
| `ollamaKvCacheType` | `f16` \| `q8_0` \| `q4_0` | `q8_0` | KV-cache type. Applied at server startup. |
| `modelPerformanceMode` | `cool` \| `balanced` \| `max` | `cool` | Advisor aggressiveness. |
| `inferencePreset` | `cool` \| `fast` \| `balanced` \| `deep` \| `long_context` \| `manual` | `manual` | Bundles context + output + keep-alive + prompt budget. |
| `maxPromptTokens` | number | — | Prompt-token budget. Unset = derived from preset. |
| `contextCompaction` | boolean | `true` | Trim sent history to the prompt budget each turn; dropped turns are replaced by a short digest (full history saved to disk). |
| `personalizationEnabled` | boolean | `false` | Local adaptive personalization. Opt-in on first run. |
| `personalizationIncludeInPrompt` | boolean | `true` | Include profile in the system prompt (local backends). |
| `personalizationAllowCloudPrompt` | boolean | `false` | Allow profile in prompts to cloud backends. |
| `personalizationLearnFromProjects` | boolean | `true` | Notice recurring templates and project patterns. |
| `personalizationLearnFromPerformance` | boolean | `true` | Remember which models ran well or hot. |
| `modelQuantizationPreference` | `q4_K_M` \| `q5_K_M` \| `q8_0` \| `fp16` \| `auto` | `auto` | Preferred quantization. |
| `llamaCppBaseUrl` | string | `http://localhost:8080` | llama.cpp endpoint. |
| `mlxBaseUrl` | string | `http://localhost:8080` | MLX endpoint. |
| `vllmBaseUrl` | string | `http://localhost:8000` | vLLM endpoint. |
| `hfToken` | string | — | HuggingFace API token. |
| `zoteroApiKey` | string | — | Zotero Web API key (enables the [Zotero connector](integrations.md#zotero)). |
| `zoteroUserId` | string | — | Zotero numeric user id (personal library). |
| `openreviewUsername` | string | — | OpenReview email or `~profile id` (enables the [OpenReview connector](integrations.md#openreview)). |
| `openreviewPassword` | string | — | OpenReview password. Stored locally, like `hfToken`. |
| `theme` | string | `synthwave` | Color theme. |
| `mode` | `permissions` \| `auto` | `permissions` | Tool-approval mode. |
| `focus` | `research` \| `general` | `research` | Research mode or off-work. Toggle with `~`. |
| `bannerAnimation` | boolean | `true` | Animate the welcome banner. |
| `maxNewTokens` | number | — | Cap on generated tokens per turn. |
| `routerEnabled` | boolean | `false` | Two-tier [model routing](#model-routing): auto-pick a fast vs. think model per turn. |
| `routerFastModelId` | string | `qwen3:4b` | Model used for the **fast** tier (conversational turns; no extended thinking, no tools). |
| `routerThinkModelId` | string | — | Model used for the **think** tier. Unset → falls back to `modelId`. |
| `routerNotes` | `off` \| `changes` \| `always` | `changes` | When to show the per-turn tier note. `changes` = only when the tier switches (or you force one). |
| `systemPrompt` | string | built-in | Base system prompt. handoff appends project context. |

## Environment variables

| Variable | Maps to |
|----------|---------|
| `HANDOFF_BACKEND` | `backend` |
| `HANDOFF_MODEL` | `modelId` |
| `HANDOFF_OLLAMA_KEEP_ALIVE` | `ollamaKeepAlive` |
| `HANDOFF_OLLAMA_NUM_CTX` | `ollamaNumCtx` |
| `HANDOFF_VLLM_URL` | `vllmBaseUrl` |
| `HANDOFF_LLAMACPP_URL` | `llamaCppBaseUrl` |
| `HANDOFF_MLX_URL` | `mlxBaseUrl` |
| `HANDOFF_THEME` | `theme` |
| `HANDOFF_MODE` | `mode` |
| `HANDOFF_MAX_TOKENS` | `maxNewTokens` |
| `HANDOFF_NO_ANIM` | sets `bannerAnimation` to `false` for this run |
| `HANDOFF_REDUCED_MOTION` | holds the mascot still, independent of config |
| `NO_COLOR` | monochrome output |
| `HF_TOKEN` | `hfToken` |
| `HANDOFF_ZOTERO_API_KEY` | `zoteroApiKey` |
| `HANDOFF_ZOTERO_USER_ID` | `zoteroUserId` |
| `HANDOFF_OPENREVIEW_USERNAME` | `openreviewUsername` |
| `HANDOFF_OPENREVIEW_PASSWORD` | `openreviewPassword` |

```sh
# Try a bigger model for one session without changing saved config:
HANDOFF_MODEL=qwen3:14b handoff
```

## Backends

| Backend | Value | Notes |
|---------|-------|-------|
| 🦙 **Ollama** | `ollama` | Default. Easiest local path. |
| 🐇 **llama.cpp** | `llama_cpp` | Fast GGUF via `llama-server`. |
| 🍎 **MLX** | `mlx` | Apple-Silicon optimized (`mlx_lm.server`). |
| ⚡ **vLLM** | `vllm` | High-throughput self-hosted server. |
| 🤗 **HuggingFace** | `hf` | Cloud. Requires `HF_TOKEN`. |

For server backends (llama.cpp / MLX / vLLM), start the server yourself and point
handoff at it with the matching `*BaseUrl` config or env var. On startup, handoff
probes the endpoint — if the server isn't reachable it shows a reminder in the chat
with the correct start command.

> For Ollama performance tuning, inference presets, and context compaction, see
> [Choosing a model](models.md).

## Themes

Thirteen built-in themes: **`synthwave`** (default), `aurora`, `sunset`, `matrix`,
`ocean`, `mono`, `dracula`, `nord`, `gruvbox`, `rosepine`, `solarized`, `forest`,
`coffee`. Switch live with `/settings → Change theme`.

Preview the banner in isolation: `npm run mascot` (try `HANDOFF_THEME=ocean npm run mascot`).

## Personalization

handoff keeps a local preference profile at `~/.handoff/profile.json` — opt-in only,
never sent off your machine, fully inspectable.

**What it learns:** stated preferences ("from now on, always use NeurIPS", "I prefer
short answers"), model performance (preferred / rejected models, slow/hot flags), and
light command habits.

**What it never stores:** secrets, tokens, raw transcripts, paper drafts, private file
contents, or anything over ~200 chars.

Manage it with `/profile`:

| Command | What it does |
|---------|--------------|
| `/profile` | Show everything learned, with confidence. |
| `/profile disable` / `enable` | Turn personalization off / on. |
| `/profile forget <key>` | Drop one preference. |
| `/profile why <key>` | Explain a preference (source, confidence). |
| `/profile export` | Write a timestamped copy. |
| `/profile reset` → `reset yes` | Clear everything (backs up first). |

The same toggles live under `/settings → Personalization`.

## Modes (approval)

- **`permissions` (hands-on)** — handoff asks before sensitive tools (shell commands,
  Overleaf push). Answer `y` (once), `a` (always → auto), or `n` (deny).
- **`auto` (hands-off)** — all tools run without asking.

In-project file writes are auto-approved in both modes. Toggle with `/mode`.

## Model routing

Reasoning models (Qwen3, etc.) spend 10–15 s "thinking" before every reply — great
for research and drafting, wasteful for "hi" or "make that shorter". With **model
routing** on, handoff picks a model per turn:

- **fast tier** (`routerFastModelId`, e.g. `qwen3:1.7b`/`qwen3:4b`) — short,
  conversational turns. Runs with extended thinking **off** and **no tools**, so a
  small model can't stall on hidden reasoning or misfire a tool on a greeting.
- **think tier** (`routerThinkModelId`, defaults to your main `modelId`) — research,
  paper, literature, long or analytical prompts. Full reasoning and tools.

The choice is rule-based (zero added latency): tool-chain follow-ups and slash
commands keep the current tier; research keywords, paper/literature project context,
and long prompts route to think; everything else routes to fast. Turn it on and set
the fast/think models under `/settings → Model routing`. Override a single turn with
`/model fast` or `/model think`.

The per-turn tier note is controlled by `routerNotes`: `changes` (default; only when
the tier switches or you force one), `always` (every turn — handy for debugging), or
`off`. When routing is enabled with the Ollama backend and handoff starts the server,
it sets `OLLAMA_MAX_LOADED_MODELS=2` so both tiers stay warm.

## Sessions

handoff saves your conversation so you can pick it back up. Restore the most recent one
with `/resume` or `handoff --resume`.

Every run is also **archived** under `~/.handoff/sessions/` as indented JSON:

- `last.json` — the latest state, used by `/resume`.
- `session-<timestamp>.json` — one file per run (named by the run's start time), kept so
  your past conversations aren't overwritten. Secret-looking tool arguments (e.g. an
  Overleaf token) are redacted before anything is written to disk.

## File layout

```
~/.handoff/
├── config.json
├── profile.json        # personalization profile
├── skills/
├── sessions/           # last.json (resume) + timestamped run archives
├── research/papers/
└── projects/<name>/
    ├── literature/
    ├── experiments/
    ├── runs/
    ├── results/
    ├── claims/
    └── paper/
```
