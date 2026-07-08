# Known issues

Notes from a debugging session on 2026-07-06. Not all of these are fixed yet.

## 1. Banner logo animation causes visible screen flicker

**Status:** mitigated.

- Where: `ui/useLogoAnimation.ts` runs a fixed-timestep timer, used by the welcome banner (`ui/app.tsx`, `ui/Banner.tsx`).
- Cause: the animated `h>` logo sweeps a color gradient across ~25 rows of the banner. Ink repaints by diffing the full output string and rewriting everything from the first changed line down (no partial/pixel buffering), so a near-full-height block changing every frame forces a near-full-screen repaint many times/second. On terminals without fast/synchronized redraw (SSH sessions, tmux, some emulators) this reads as visible flicker/tearing.
- Mitigation applied: the mascot now runs at **12fps** (was 20), cutting the repaint + GC pressure ~40% while keeping the sweep smooth. The transcript body is separately memoized (`entryNodes` on `[entries, theme, width]`), so an animation frame never re-lays the conversation. The animation timer already goes fully idle while the banner is scrolled off-screen (`visible` ref).
- Still available: toggle it off via the settings menu ("Toggle mascot"), or set `HANDOFF_REDUCED_MOTION=1` (block glyphs also under `NO_COLOR`). A future improvement could lengthen `periodMs` or gate on synchronized-output support.

## 4. Security & performance hardening pass

**Status:** fixed / added.

A focused review pass (safety, TUI performance, routing UX, DX):

- **SSRF hardening** (`src/tools/ssrf.ts`, new). `web_fetch`/`read_pdf` previously blocked only `169.254.*` + GCP metadata. Now a pure, tested `checkFetchUrl` blocks loopback (`127/8`, `::1`, `0.0.0.0`), private IPv4 (`10/8`, `172.16/12`, `192.168/16`, `100.64/10` CGNAT), link-local (`169.254/16`, `fe80::/10`), unique-local (`fc00::/7`), IPv4-mapped IPv6, and obfuscated decimal/octal/hex IP encodings. DNS-rebinding (resolve-then-pin) is a noted follow-up.
- **read_pdf shell-injection + temp leak** (`src/tools/builtin.ts`). Replaced `execSync(` + "`pdftotext \"${path}\" -`" + `)` (shell string) with `execFileSync('pdftotext', [path, '-'])` (array args, no shell) and now `unlinkSync` the downloaded temp PDF in a `finally` (was leaking one file per URL fetch).
- **Wider secret redaction** (`src/util/redact.ts`): added OpenAI `sk-…`, GitHub `gh[posru]_…`, and AWS `AKIA…` patterns.
- **contextBudget small-window overflow** (`src/agent/contextBudget.ts`): the `promptBudgetFor` floor of 1024 could make `budget + reasoningOutputReserve > numCtx` at `numCtx ≤ 1024`; the ceiling is now clamped to the usable window so the invariant holds for all sizes (tested at 512/1024/2048/4096).
- **Single alt-screen owner** (`ui/terminalControl.ts`, new): the alternate screen (`?1049h/l`) is now owned solely by `src/index.tsx`; `ui/app.tsx` owns only input/scroll modes (`?1007`, `?2004`). Prevents double-restore and keeps the exit recap on the normal screen.
- **Streaming render batching** (`ui/streamThrottle.ts`, new): streaming deltas are coalesced to ≤1 React update per ~33ms (≈30fps) instead of one render + transcript re-layout per token.
- **Cell-width-aware wrapping** (`ui/width.ts`, new): `wrap`/`hardWrap` measure terminal cells (CJK = 2, combining marks = 0, ANSI = 0) instead of `String.length`, so wide/emoji/accented text no longer overflows or wraps early.
- **ToolRegistry built once** (`src/index.tsx`): was reconstructed + re-registered on every render.
- **Routing UX**: per-turn tier note is now gated by a `routerNotes` setting (`changes` default / `always` / `off`); `/settings` cycles it. Backing out of a model picker resets the router pick target.
- **DX**: `npm run check`, ESLint (advisory) + Prettier configs, and a GitHub Actions CI matrix (Node 18/20/22).
- Tests: new `test/{ssrf,terminalControl,streamThrottle,width,inputEditing}.test.ts`; extended `test/{tools,redact,contextBudget,router}.test.ts`. `npm run typecheck` + `npm test` green.

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
