# Stale Code Audit — handoff

Companion to `REFACTOR_AUDIT.md`. Produced in **Phase 2** (2026-07-13).
**Nothing here is deleted yet** — this is the proof-of-safety ledger the refactor
brief requires before any removal (Phase 8 acts on it).

## Method

1. `npx knip` for a machine-generated candidate list (86 items).
2. Whole-repo `grep -w` for every candidate across `src/ ui/ config/ qa/ test/
   scripts/ bin/ docs/ package.json` — **including tests and dynamic/spawned
   paths that knip does not scan**.
3. Manual runtime-path check for each file-level candidate.

## Headline: knip is mostly false-positive here

knip has no config yet, so it misreads several intentional patterns. Documenting
these so nobody "cleans them up" by mistake:

| knip claim | Reality | Proof |
|---|---|---|
| `test/*.tsx` "unused files" (`model-menu`, `modelMenu`, `render`, `theme-preview`, `animated-mascot`) | Active tests | run by `node --test test/*.test.tsx`; 568 tests pass |
| `HFModel`, `LlamaCppModel`, `MlxModel` "unused exports" | Used via factory dispatch | `src/agent/model.ts:961-965` `createModel()` does `new LlamaCppModel(...)` etc. |
| `qa/chat-sim/runScenario.ts` "unused file" | Spawned as child process | `qa/chat-sim/runner.ts:12` `join(HERE, 'runScenario.ts')` |
| `ink-testing-library` "unused devDep" | Used by the `.tsx` tests knip skipped | import in `render.test.tsx` et al. |
| path/API exports used only in tests (`PROJECTS_DIR`, …) | Used | `PROJECTS_DIR` referenced in tests knip excluded |
| `ollama` / `uv` "unlisted binaries" | External CLIs invoked via spawn | not npm deps by design |

Most "unused exports (61)" are **over-exported internal helpers or deliberate
public API** (e.g. `capsuleDir`, `claimsDir`, `notebookPath`, `sha256File`,
`formatCapsule`, terminal-control escape constants). Per the brief ("do not
delete code just because it looks messy"), these are **kept**. At most they
could drop the `export` keyword — cosmetic, deferred, not tracked as stale.

---

## A. File-level items

| Path | References | Runtime path? | Decision | Reason | Safety |
|---|---|---|---|---|---|
| `dev.sh` | none in README/docs/pkg/CI | no | **delete** (fold into CONTRIBUTING) | 5-line `npm install && npm run dev && npm link`; unreferenced; has a latent bug (backticks around `handoff` in the echo = command substitution). Superseded by documented dev setup. | not imported anywhere; not in `package.json` `files` |
| `ERRORS.md` | none | no | **migrate → CHANGELOG.md, then remove** | Dated dev debugging log ("Notes from a debugging session on 2026-07-06… Not all fixed yet"). Not user-facing (that's `docs/troubleshooting.md`); reads as stale. Fixed items belong in CHANGELOG. | distinct from troubleshooting.md; not shipped (`files` excludes it) |
| `BUILD_SEQUENCE.txt` | none | no | **relocate → `docs/dev/` or remove** | Root-clutter planning artifact. | 0 refs; not shipped |
| `PRODUCT_PLAN.txt` | none | no | **relocate → `docs/dev/` or remove** | Root-clutter planning artifact. | 0 refs; not shipped |
| `TODO.md` | none | no | **relocate → `docs/dev/` or GitHub issues** | Root-clutter. | 0 refs; not shipped |
| `.DS_Store` | — | no | **delete + gitignore** | macOS cruft committed by accident. | — |
| `src/adapters/*` (core-bench, dabstep, ml-agent-bench, runner, types, BENCHMARKS.md) | `bench:*` scripts | yes (bench scripts) | **move → `benchmarks/`** | Benchmark harness misplaced in production `src/`. NOT stale. Ships in npm `files: ["src"]` today — moving it out also slims the package. | `package.json` `bench:core/ml-agent/dabstep` reference them |
| `src/mascotPreview.tsx` | `npm run mascot` | yes | **keep** (optionally move to `scripts/`) | Dev preview utility with a script entry. Not stale. | `package.json:26` |
| `qa/chat-sim/runScenario.ts` | spawned by runner | yes | **keep** | knip false positive (child-process path). | `runner.ts:12` |

## B. Suspected-duplicate tests (from brief) — NOT duplicates

| File | Decision | Reason |
|---|---|---|
| `test/model-menu.test.tsx` | **keep, rename** | Tests interactive `ModelMenu` component (favourites, sections). |
| `test/modelMenu.test.tsx` | **keep, merge or rename** | Tests `/model` command's hardware-aware suggestion line. Distinct scope; confusing name. |
| `test/systemPrompt.test.ts` | **keep** | `buildSystem` basics + bib placement. |
| `test/systemPrompt2.test.ts` | **keep, rename by scope** | Mode-specific + Overleaf context. `2` suffix is a smell, not a dup. |

→ Handled in Phase 5 (test reorg) via rename, not deletion. Coverage preserved.

## C. Export-level items worth a real decision

| Export | Refs | Decision | Reason | Safety |
|---|---|---|---|---|
| `metricsTableWithStats` (`src/workspace/resultsTable.ts`) | defn only | **wire up** (Phase 8) | Added last commit, never called. `docs/research-workflow.md` already claims `export_results` emits per-column CI rows — wiring it makes the doc honest and uses the tested stats layer. Alternative: remove + amend doc. | untested currently → **add test when wiring** |
| `getSystemRamGb`, `recommendModel` (`config/models.ts`) | defn only | **investigate** (Phase 8) | Appear once (defined, never called). Possible legacy model-reco path superseded by `src/agent/advisor.ts` scoring. Needs a deeper trace before any removal — `config/models.ts` itself is heavily used by 4 UI files. | do NOT remove without tracing advisor.ts overlap |
| `formatBindingRow` (`src/workspace/bindings.ts`) | defn only | **keep** | Sibling of `formatBindingsSummary`; small formatter, plausible near-term use by list views. Cosmetic over-export. | — |

## D. Minor hygiene (fix in Phase 6)

| Item | Fix |
|---|---|
| `@eslint/js` unlisted dependency | Add to `devDependencies` (imported in `eslint.config.js`). |
| knip has no config | Add `knip.json` declaring test globs + entry points so future runs are low-noise, and add a `knip`/`deadcode` npm script. |

## E. Precise knip findings (after `knip.json` config, Phase 6)

With `ignoreExportsUsedInFile: true` and proper entry/test globs, knip drops from
86 noisy candidates to **9 real items**. None are referenced in tests (verified).
Actioned in Phase 8:

| Symbol | File | Decision |
|---|---|---|
| `getSystemRamGb`, `recommendModel` | `config/models.ts` | investigate vs `advisor.ts` (legacy reco path) |
| `metricsTableWithStats` | `src/workspace/resultsTable.ts` | wire into `export_results` + test |
| `noWriteOutsideHome` | `qa/chat-sim/assertions.ts` | unused QA assertion — wire into a scenario or remove |
| `appendProfileEvent` | `src/personalization/store.ts` | unused — remove or wire |
| `_resetHardwareCache` | `src/system/hardware.ts` | test-only reset hook, never imported — keep (test seam) or remove |
| `formatCapsule` | `src/workspace/capsule.ts` | unused formatter — keep (API) or remove |
| `ProfileNote` (type) | `src/personalization/profile.ts` | unused type — remove |
| `EXIT_ALT` / `ALT_SCREEN_OFF` (duplicate export) | `ui/terminalControl.ts` | **real bug** — two names for one value; consolidate |

`npm run deadcode` (knip) exits non-zero while these remain, so it stays an
**advisory** tool (not part of the blocking `npm run check`) until Phase 8.

---

## Phase 8 outcome (2026-07-13)

**Removed (proven dead):**
- `dev.sh` — tracked, unreferenced, latent backtick bug; dev setup is in CONTRIBUTING.
- Legacy RAM-only recommender chain in `config/models.ts` — `getSystemRamGb`,
  `ramTierForGb`, `recommendModel` (+ the now-orphaned `totalmem` import).
  Self-documented as superseded by `src/agent/advisor.ts`; **zero** external or
  test callers (whole-repo grep confirmed the chain was self-contained).

**Untracked (kept locally):**
- `ERRORS.md` — was committed before being added to `.gitignore`. `git rm
  --cached` honors the ignore intent and declutters the GitHub root while
  leaving the author's local copy. (Not migrated into `CHANGELOG.md`: it's dev
  debug notes, a different audience than user-facing release notes.)

**Wired up (dead → live):**
- `metricsTableWithStats` — now used by `export_results` when ≥2 runs are
  exported (makes the docs' "per-column CI rows" claim true); added its contract
  (no stats block for <2 runs) + 3 tests (`test/resultsTable.test.ts`).

**Deferred (documented tradeoff):**
- `src/adapters/*` move → `benchmarks/`: only `runner.ts` imports from `src/`,
  but relocating drops all adapters out of tsconfig `include` (benchmarks/ isn't
  covered), risks surfacing latent errors in the currently-unchecked
  `compare-sota.ts`, and the maintainer's `.gitignore` comment shows they
  deliberately keep adapters tracked in `src/`. Value is low (small TS files,
  never imported by the CLI; only a packaging-purity concern). Given the
  internal-reorg-only scope, deferred as an optional follow-up.

**Kept (no-delete-just-because-unused):**
- `BUILD_SEQUENCE.txt`, `PRODUCT_PLAN.txt`, `TODO.md` — turned out to be
  gitignored + **never committed** = the author's local scratch, not repo
  clutter. Left untouched.
- `_resetHardwareCache` (test seam, `_`-prefixed), `noWriteOutsideHome` (QA
  safety assertion), `appendProfileEvent` (opt-in personalization),
  `formatCapsule` (plausible display API), `ProfileNote` (type) — low-priority
  unused exports; retained per the brief's caution. knip stays advisory.
- `EXIT_ALT` / `ALT_SCREEN_OFF` — **reclassified from "bug" to intentional**: a
  primitive (`EXIT_ALT`) + semantic alias (`ALT_SCREEN_OFF`, the one `index.tsx`
  uses) pair, mirroring `ENTER_ALT`/`ALT_SCREEN_ON`. Clear, tested; left as-is.

knip after Phase 8: 4 unused exports + 1 type + 1 (intentional) duplicate.
`npm run check` green (571 tests).

---

## Actionable summary (for Phase 8)

**Safe deletes:** `.DS_Store`, `dev.sh` (after CONTRIBUTING covers dev setup).
**Migrate then remove:** `ERRORS.md` → `CHANGELOG.md`.
**Relocate:** `BUILD_SEQUENCE.txt`, `PRODUCT_PLAN.txt`, `TODO.md` → `docs/dev/`;
`src/adapters/*` → `benchmarks/`.
**Wire up:** `metricsTableWithStats` (+ test).
**Investigate before touching:** `getSystemRamGb` / `recommendModel` vs `advisor.ts`.
**Keep (knip false positives):** everything in §Headline + most of "unused exports".
