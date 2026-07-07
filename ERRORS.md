# Known issues

Notes from a debugging session on 2026-07-06. Not all of these are fixed yet.

## 1. Banner logo animation causes visible screen flicker

**Status:** open, not fixed.

- Where: `ui/useLogoAnimation.ts:56` runs a 20fps timer (`fps: 20` set at `ui/app.tsx:1763`), used by the welcome banner (`ui/app.tsx:1759-1768`, `ui/Banner.tsx`).
- Cause: the animated `h>` logo sweeps a color gradient across ~25 rows of the banner at 20fps. Ink repaints by diffing the full output string and rewriting everything from the first changed line down (no partial/pixel buffering), so a near-full-height block changing every frame forces a near-full-screen repaint 20x/second. On terminals without fast/synchronized redraw (SSH sessions, tmux, some emulators) this reads as visible flicker/tearing.
- Workaround available today: toggle it off via the settings menu ("Toggle mascot", `ui/Overlays.tsx:83`), or set `HANDOFF_REDUCED_MOTION=1` in the environment.
- Proposed fix (not applied): lower `fps: 20` at `ui/app.tsx:1763` to ~8-10, and/or lengthen `periodMs` (default 4200 in `ui/useLogoAnimation.ts`), to cut the repaint rate while keeping the sweep visible.

## 2. "Model hit its output limit" truncation on reasoning models

**Status:** fixed.

- Symptom: `src/agent/loop.ts` raised "The model hit its output limit before answering — it spent the budget reasoning...", seen repeatedly even while already on the `deep` preset.
- Root cause (already fixed earlier): `src/agent/contextBudget.ts`'s prompt-budget ceiling and `src/agent/model.ts`'s guaranteed output floor were computed independently and could together exceed `numCtx`. Both now share `reasoningOutputReserve(numCtx)`, so prompt + output can never sum past `numCtx`.
- Fixes applied in this pass:
  - **Automatic retry without thinking.** When a turn hits the length cap with only hidden reasoning and no answer, the agent loop now retries the same turn once with `think: false` (`src/agent/loop.ts`, threaded via an optional `{ think }` arg on `ChatModel.chatStream` → `streamOllamaNative`). The model answers directly instead of surfacing an error. Only if that retry also fails does an error appear.
  - **Preset-aware error message.** The fallback no longer suggests the preset you're already on: `cool/fast/balanced` → `/model deep`; `deep` → `/model long_context` or a non-reasoning model; `long_context` → a non-reasoning/smaller model.
  - **Roomier, self-correcting budget.** `promptBudgetFor` now scales `deep`/`long_context`/`manual` to most of the context window (minus the reserve and a 0.85 margin) instead of fixed small caps, so long conversations retain far more history on a capable machine. The prompt budget is also derived fresh each turn (`ui/app.tsx`) and no longer persisted on named-preset apply — so the change takes effect immediately, with **no manual `/model` re-run needed** (the old stale-`maxPromptTokens` gotcha is gone).
  - Tests updated/added in `test/loop.test.ts`, `test/contextBudget.test.ts`, `test/preset.test.ts`, `test/model.test.ts`; `docs/models.md` updated. `npm run typecheck` and `npm test` (352 tests) pass.

## 3. Inference-optimization audit + `num_parallel` win

**Status:** fixed / added.

Empirically verified every Ollama optimization against a throwaway-server harness (qwen3:4b, Apple M4, 32 GB) so each is proven to help, not just wired in. Measured impact:

| Optimization | Measured impact |
|--------------|-----------------|
| `q8_0` KV cache + flash attention vs stock `f16`/off | **44.9% less** resident memory (6.70 → 3.69 GiB @ 16K ctx) |
| `keep_alive` (warm vs cold) | load **654 ms → 84 ms** |
| `num_ctx` scaling | 8× context = **+2.22 GiB** KV cache (why cool/fast cap it) |
| **`OLLAMA_NUM_PARALLEL=1`** (new) | **58% less** resident memory (4.87 → 3.08 GiB @ 8K ctx) |
| `q4_0` vs `q8_0` KV cache | a further **15.2%** smaller (opt-in for 8 GB machines) |

Changes applied in this pass:
- **New optimization — `OLLAMA_NUM_PARALLEL=1`.** Ollama sizes the KV cache as `num_ctx × num_parallel`; its multi-slot default made a single-user TUI pay several times the KV-cache memory for concurrency it never uses. Now pinned to 1 in `src/agent/ollama.ts` (`ollamaServeEnv` + `OllamaPerfOptions.numParallel`, honoring an explicit env/opt override), the installers (`install.sh` shell profile + systemd + launchd; `install.ps1` user env), and the uninstallers (symmetric cleanup).
- **Closed a perf-flag gap in `bin/handoff.js`.** Its `ensureOllamaServe()` auto-started `ollama serve` *before* the UI, with no explicit perf env — shadowing `OllamaPrepare`'s tuned `startOllamaServe`, so a fresh shell could get an untuned server. It now applies flash + q8 KV + `num_parallel=1` defaults without clobbering values already in the environment.
- Tests: +2 in `test/ollamaServeEnv.test.ts` (num_parallel default + override precedence). Request-body options (num_ctx/num_predict floor/keep_alive/think) were already locked in by `test/model.test.ts`. `docs/models.md` gains a "Server tuning" table with these numbers. `npm run typecheck` + `npm test` (356 tests) green.
