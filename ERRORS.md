# Known issues

Notes from a debugging session on 2026-07-06. Not all of these are fixed yet.

## 1. Banner logo animation causes visible screen flicker

**Status:** open, not fixed.

- Where: `ui/useLogoAnimation.ts:56` runs a 20fps timer (`fps: 20` set at `ui/app.tsx:1763`), used by the welcome banner (`ui/app.tsx:1759-1768`, `ui/Banner.tsx`).
- Cause: the animated `h>` logo sweeps a color gradient across ~25 rows of the banner at 20fps. Ink repaints by diffing the full output string and rewriting everything from the first changed line down (no partial/pixel buffering), so a near-full-height block changing every frame forces a near-full-screen repaint 20x/second. On terminals without fast/synchronized redraw (SSH sessions, tmux, some emulators) this reads as visible flicker/tearing.
- Workaround available today: toggle it off via the settings menu ("Toggle mascot", `ui/Overlays.tsx:83`), or set `HANDOFF_REDUCED_MOTION=1` in the environment.
- Proposed fix (not applied): lower `fps: 20` at `ui/app.tsx:1763` to ~8-10, and/or lengthen `periodMs` (default 4200 in `ui/useLogoAnimation.ts`), to cut the repaint rate while keeping the sweep visible.

## 2. "Model hit its output limit" truncation on reasoning models

**Status:** root cause fixed in code (uncommitted). One manual step and two optional follow-ups are still open.

- Symptom: `src/agent/loop.ts:124-126` raises "The model hit its output limit before answering — it spent the budget reasoning...", seen repeatedly even while already on the `deep` preset.
- Root cause: `src/agent/contextBudget.ts`'s prompt-budget ceiling (was a flat 60% of `numCtx`) and `src/agent/model.ts`'s guaranteed output floor (was a flat 8192 tokens, `model.ts:445`) were computed independently and could together exceed `numCtx`. Confirmed against the live config (`ollamaNumCtx: 16384`, `deep` preset, model `ornith:9b` — a Qwen3.5 thinking model system-prompted to always reason before acting): 9830 (prompt ceiling) + 8192 (output floor) = 18022 > 16384 — an overflow guaranteed by construction whenever the prompt was reasonably full and the model reasoned at length.
- Fix applied (uncommitted in the working tree): added `reasoningOutputReserve(numCtx)` in `src/agent/contextBudget.ts`, now shared by both the prompt-budget ceiling and the `model.ts:445` output floor, so the two can never again sum past `numCtx`. Updated `test/contextBudget.test.ts`, `test/preset.test.ts`, `test/model.test.ts`, and `docs/models.md` to match. `npm run typecheck` and `npm test` (347 tests) pass.
- Outstanding manual step: `~/.handoff/config.json` still has the stale `"maxPromptTokens": 9830` persisted from the old formula, and the app prefers that saved value over recomputing it (`ui/app.tsx:1130`). Re-run `/model deep` (or whichever preset is active) once to overwrite it with the corrected number.
- Optional follow-ups, not yet implemented:
  - The error message (`src/agent/loop.ts:124-126`) always suggests `/model balanced` or `/model deep`, even when already on `deep` — could mention `/model long_context` in that case instead.
  - No automatic retry: could retry once with `think: false` when this exact failure occurs, trading deliberate reasoning for an actual answer instead of surfacing an error.
