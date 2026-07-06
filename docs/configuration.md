---
title: Configuration
nav_order: 8
---

# Configuration

handoff is configured by a JSON file plus a handful of environment variables.
Precedence is: **environment variable → `config.json` → built-in default.**

## `~/.handoff/config.json`

Written by the setup wizard and updated by `/model`, `/settings`, and `/mode`. Fields:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `backend` | `ollama` \| `llama_cpp` \| `mlx` \| `vllm` \| `hf` | `ollama` | Which model backend to use (see [Backends](#backends)). |
| `modelId` | string | `qwen3:8b` | The model to run (e.g. `qwen3:8b`, or an HF repo id). |
| `ollamaBaseUrl` | string | `http://localhost:11434` | Ollama endpoint. |
| `ollamaKeepAlive` | string \| number | `30m` | How long Ollama keeps the model resident after a request. `-1` pins it for the whole session. |
| `ollamaNumCtx` | number | hardware-aware | Context window (`num_ctx`) for Ollama. Defaults to a safe value for your Mac (4096–16384), **not** a fixed 64000. Tuneable in `/settings`. |
| `ollamaFlashAttention` | boolean | `true` | Flash attention for the Ollama server. Toggle in `/settings`; applies when the server restarts. |
| `ollamaKvCacheType` | `f16` \| `q8_0` \| `q4_0` | `q8_0` | KV-cache type for the Ollama server. Set in `/settings`; applies when the server restarts. |
| `modelPerformanceMode` | `cool` \| `balanced` \| `max` | `cool` | How aggressively the advisor recommends. `cool` = fast & cool (default on MacBooks). Cycle in `/settings`. |
| `inferencePreset` | `cool` \| `fast` \| `balanced` \| `deep` \| `long_context` \| `manual` | `manual` | Laptop preset bundling context + max output + keep-alive + prompt budget. Set with `/model cool\|fast\|balanced\|deep` or `/settings`. |
| `maxPromptTokens` | number | — | Prompt-token budget for context compaction. Unset → derived from the preset and context window. |
| `contextCompaction` | boolean | `true` | Trim the history *sent* to the model each turn to the prompt budget (full history is still saved to disk). |
| `personalizationEnabled` | boolean | `false` | Local adaptive personalization. Opt-in on first run; toggle in `/settings` or `/profile`. |
| `personalizationIncludeInPrompt` | boolean | `true` | Add a compact "User preferences" block to the system prompt (local backends). |
| `personalizationAllowCloudPrompt` | boolean | `false` | Allow the profile in prompts to a **cloud** backend. Off by default. |
| `personalizationLearnFromProjects` | boolean | `true` | Notice recurring templates / project patterns. |
| `personalizationLearnFromPerformance` | boolean | `true` | Remember which models ran well or hot on this machine. |
| `modelQuantizationPreference` | `q4_K_M` \| `q5_K_M` \| `q8_0` \| `fp16` \| `default` \| `auto` | `auto` | Preferred quantization; `auto` lets the advisor pick per hardware/mode. |
| `llamaCppBaseUrl` | string | `http://localhost:8080` | llama.cpp (`llama-server`) endpoint. |
| `mlxBaseUrl` | string | `http://localhost:8080` | MLX (`mlx_lm.server`) endpoint. |
| `vllmBaseUrl` | string | `http://localhost:8000` | vLLM endpoint. |
| `hfToken` | string | — | HuggingFace API token (only for `hf`). |
| `theme` | string | `synthwave` | Color theme (see below). |
| `mode` | `permissions` \| `auto` | `permissions` | Approval mode (see below). |
| `focus` | `research` \| `general` | `research` | Research (loads the active project) or off-work. Toggle with `~`. |
| `bannerAnimation` | boolean | `true` | Animate the welcome-banner mascot. |
| `maxNewTokens` | number | — | Optional cap on generated tokens. Unset = no limit. |
| `favourites` | array | `[]` | Models you've starred in the `/model` picker. |
| `systemPrompt` | string | a concise default | Base system prompt; handoff appends environment + project context. |
| `toolDirs` | string[] | `[]` | Extra directories to load custom tools from. |

You normally don't edit this by hand — use the in-app commands — but it's plain JSON
if you want to.

## Environment variables

Set these to override the config file for a single run (handy for scripting or trying a
model without persisting it):

| Variable | Maps to |
|----------|---------|
| `HANDOFF_BACKEND` | `backend` (`ollama`, `llama_cpp`, `mlx`, `vllm`, or `hf`) |
| `HANDOFF_MODEL` | `modelId` |
| `HANDOFF_OLLAMA_KEEP_ALIVE` | `ollamaKeepAlive` |
| `HANDOFF_OLLAMA_NUM_CTX` | `ollamaNumCtx` |
| `HANDOFF_VLLM_URL` | `vllmBaseUrl` |
| `HANDOFF_LLAMACPP_URL` | `llamaCppBaseUrl` |
| `HANDOFF_MLX_URL` | `mlxBaseUrl` |
| `HANDOFF_THEME` | `theme` |
| `HANDOFF_MODE` | `mode` (`permissions` or `auto`) |
| `HANDOFF_MAX_TOKENS` | `maxNewTokens` |
| `HANDOFF_NO_ANIM` | sets `bannerAnimation` to `false` for this run |
| `HANDOFF_REDUCED_MOTION` | holds the mascot still (reduced motion), independent of config |
| `NO_COLOR` | renders monochrome; the mascot still animates |
| `HF_TOKEN` | `hfToken` |

```sh
# Try a bigger model for one session without changing your saved config:
HANDOFF_MODEL=qwen3:14b handoff
```

> The Ollama endpoint is only read from `config.json` (`ollamaBaseUrl`), not from an
> environment variable. The other backend URLs *do* have env overrides (above).

## Backends

handoff speaks to five backends. The first four are **local and free**; the last is cloud.

| Backend | Value | Notes |
|---------|-------|-------|
| 🦙 **Ollama** | `ollama` | Default. The easiest way to run models locally — pick one and go. |
| 🐇 **llama.cpp** | `llama_cpp` | Fast GGUF inference via `llama-server`. Great on modest hardware. |
| 🍎 **MLX** | `mlx` | Apple-Silicon–optimized (`mlx_lm.server`), tuned for M-series Macs. |
| ⚡ **vLLM** | `vllm` | High-throughput, self-hosted OpenAI-compatible server for bigger rigs. |
| 🤗 **HuggingFace** | `hf` | Cloud & paid. Runs on HuggingFace servers — needs `HF_TOKEN`. |

Pick a backend in the setup wizard or with `/model`. For the server backends
(llama.cpp / MLX / vLLM), start the server yourself and point handoff at it with the
matching `*BaseUrl` / env var. On startup, handoff probes the configured endpoint — if
the server isn't reachable it prints a reminder in the chat with the correct start
command (e.g. `mlx_lm.server --model … --port 8080`) so you don't have to remember it.

## Speeding up local inference (Ollama)

handoff talks to Ollama through its **native `/api/chat`** endpoint, which lets it
control two things the OpenAI-compatible endpoint can't:

- **`keep_alive` (`ollamaKeepAlive`, default `30m`).** Keeps the model resident between
  messages and tool rounds, so you don't pay a cold-reload each turn. Set it longer, or
  `-1`, to pin the model for the whole session.
- **`num_ctx` (`ollamaNumCtx`).** The context window. handoff now defaults it to a
  **hardware-aware** value for your Mac (4096–16384) instead of a fixed 64000 that would
  force CPU offload on most MacBooks. Bigger helps long, tool-heavy conversations — but it
  costs memory and can cause spill. Change it live in **`/settings` → Context window**, or
  via `HANDOFF_OLLAMA_NUM_CTX`. See [Choosing a model](models.html) for the tradeoffs.

**Flash attention + q8 KV-cache are enabled by default.** The installer sets
`OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` for the Ollama server
(faster attention, roughly half the KV-cache memory) wherever the server reads its
environment: your shell profile, the **systemd service** on Linux, and **launchd** on
macOS. handoff also passes them when it starts the server itself. The Ollama server
reads these at **startup**, so if it was already running when you installed, restart it
once — `pkill -f "ollama serve"` (or `sudo systemctl restart ollama` on a systemd
install), then relaunch.

If you installed Ollama some other way, set those two variables where your server picks
up its environment and restart it. Verify they took effect with `ollama ps` speed, or
check the server's startup log for `OLLAMA_FLASH_ATTENTION:true`.

**Toggling them in-app.** `/settings` has **Flash attention** (on/off) and **KV cache**
(`f16` / `q8_0` / `q4_0`) entries. These write to your config and apply the next time
**handoff** starts the Ollama server — unlike the context window (per-request, immediate),
they're read at server **startup**, so the confirmation note reminds you to restart
Ollama. The quickest way: `/quit`, `pkill -f "ollama serve"`, then relaunch `handoff`.

**If generation is slow, check for CPU offload:**

```sh
ollama ps
```

If the `PROCESSOR` column isn't `100% GPU`, part of the model spilled onto the CPU —
that's the usual cause of a 10–20× slowdown. Fixes, in order of impact: pick a smaller
model or a lower quantization (`q4_K_M` is the sweet spot), or **lower the context
window** in `/settings`.

## Themes

Thirteen built-in color themes: **`synthwave`** (default), `aurora`, `sunset`, `matrix`,
`ocean`, `mono`, `dracula`, `nord`, `gruvbox`, `rosepine`, `solarized`, `forest`, and
`coffee`. Preview and switch them live with `/settings → Change
theme`. Colors are muted to a matte palette for legibility; the syntax-highlight and
diff palettes are fixed (One Dark / GitHub-style) so code reads the same across every
theme.

Preview the banner mascot in isolation with `npm run mascot` (try
`HANDOFF_THEME=ocean npm run mascot` or `NO_COLOR=1 npm run mascot`). The mascot also
stays static automatically when stdout is not a TTY (piped or CI) or when the terminal
is too narrow for the two-column banner.

## Personalization

handoff can adapt to how *you* work by keeping a small, **local** preference profile at
`~/.handoff/profile.json`. It is opt-in (you're asked once on first run) and completely
inspectable — nothing is ever sent off your machine, and cloud-backend prompts exclude it
unless you explicitly turn that on.

**What it learns**
- **Stated preferences** — say "from now on, always use NeurIPS", "I prefer short answers",
  "use qwen3:8b by default", or "don't use ornith:35b, it overheats" and handoff records it
  (high confidence). You get a one-line confirmation; nothing else interrupts you.
- **Model performance** — which models you prefer or rejected, and which ran slow/hot here.
  These feed the `/model` picker (badges `✓you`, `rejected`, `slow`) and its recommendations.
- **Light habits** — a few clean signals (e.g. commands you lean on, hands-on vs hands-off)
  after several consistent observations. Behavioural *style* is only ever set by an explicit
  statement, never guessed.

**What it never stores:** secrets/tokens, raw transcripts, paper drafts, private file
contents, long quoted passages, or code. A privacy gate rejects anything secret-shaped, and
emails are stripped.

**Control it** with `/profile`:

| Command | What it does |
|---------|--------------|
| `/profile` (or `show`) | Print everything learned, with confidence. |
| `/profile disable` / `enable` | Turn personalization off / on. |
| `/profile forget <key>` | Drop one preference (keys are shown by `show`). |
| `/profile why <key>` | Explain a preference (source, confidence, evidence). |
| `/profile export` | Write a timestamped copy of the profile. |
| `/profile reset` → `reset yes` | Clear everything (backs up first). |

The same toggles live under `/settings → Personalization`, including whether to include the
profile in the prompt and whether cloud backends may see it (off by default). A corrupt
profile file is backed up and replaced automatically — it never blocks startup.

## Modes (approval)

- **`permissions` (hands-on)** — handoff asks before running *sensitive* tools (shell
  commands, pushing to Overleaf, etc.). You can answer `y` (allow once), `a` (allow all
  — switches to auto), or `n`/`Esc` (deny).
- **`auto` (hands-off)** — handoff runs every tool without asking.

In **both** modes, file writes and directory creation **inside the active project** are
auto-approved — the research loop edits files constantly, and gating every write would
be noise. Writes that escape the project still prompt in `permissions` mode.

Toggle with `/mode`, or set it directly: `/mode hands-off`, `/mode hands-on`.

## Sessions

handoff saves your conversation per project so you can pick up where you left off.
Restore the last session with `/resume`, or launch with `handoff --resume`.

## Where things live

```
~/.handoff/
├── config.json
├── skills/
├── research/papers/
└── projects/<name>/
    ├── literature/   # notes and cached papers      (private)
    ├── experiments/  # one uv project per experiment  (private)
    ├── runs/         # experiment ledger + run capsules  (private)
    ├── results/      # tables + figures               (private)
    ├── claims/        # claim ledger (claims.jsonl)   (private)
    └── paper/         # main.tex + refs.bib — syncs to Overleaf
```
