# Refactor Audit — handoff

Living document for the professional-standards refactor. Baseline captured
**2026-07-13**. Each phase appends its results below; do not delete prior
sections — strike through superseded findings instead.

Reference standard: [openclaw/openclaw](https://github.com/openclaw/openclaw)
(benchmark for organization only — handoff's product identity as a local-first
research agent is preserved).

---

## 0. Baseline

### Environment

| Field | Value |
|---|---|
| Branch | `master` (clean working tree) |
| Last commit | `39af9ee` Add research pipeline: lit notes, snowballing, stats, bindings, … |
| Node | v22.22.3 |
| npm | 10.9.8 |
| Package manager | npm (`package-lock.json` present; no pnpm/yarn lock) |
| Package name | `ownhandoff` |
| CLI bin | `handoff` → `bin/handoff.js` |
| Module type | ESM (`"type": "module"`) |
| Engines | `node >=18` |

### Repo shape

```
Top-level files:  BUILD_SEQUENCE.txt, PRODUCT_PLAN.txt, TODO.md, ERRORS.md,
                  dev.sh, README.md, LICENSE, package.json, tsconfig.json,
                  eslint.config.js, .prettierrc, .prettierignore, .gitignore, .DS_Store
Source dirs:      src/{adapters,agent,personalization,research,skills,system,tools,util,workspace}
                  ui/{,ascii}
Support dirs:     bin, config, benchmarks, qa/chat-sim, scripts, installers,
                  templates/{acl,neurips}, skills/{apple-notes,apple-reminders,overleaf},
                  docs, assets, debug, tmp
Counts:           src 70 ts/tsx · ui 33 ts/tsx · test 67 files
```

Largest files (LOC):

| LOC | File | Note |
|---:|---|---|
| **2943** | `ui/app.tsx` | **Monolith** — rendering + commands + state + agent orchestration + model selection + research/workspace + sessions + Overleaf/Zotero/OpenReview + terminal lifecycle |
| 966 | `src/agent/model.ts` | |
| 796 | `src/workspace/report.ts` | |
| 714 | `src/research/tools.ts` | |
| 689 | `src/research/zotero.ts` | |
| **641** | `src/tools/builtin.ts` | Split candidate (moderate size) |
| 550 | `ui/Overlays.tsx` | |
| 541 | `ui/lines.tsx` | |

### Baseline command results

| Command | Status | Notes |
|---|---|---|
| `npm run typecheck` | ✅ PASS | clean |
| `npm test` | ✅ PASS | 568/568 pass, 0 fail |
| `npm run lint` | ⚠️ PASS w/ warnings | **0 errors, 15 warnings** (see below) |
| `npm run format:check` | ❌ FAIL | **17 files** need Prettier (all from the recent research-pipeline commit) |
| `npm run docs:check` | ❌ FAIL | `docs/research-workflow.md`: placeholder text `"TODO"` |
| `npm run qa:chat:smoke` | ✅ PASS | 22/22 scenarios |
| `npm run check` | ✅ PASS | = `typecheck && test` only — **does not gate lint/format/docs** |

There is no `npm run lint -- --max-warnings=0` gate and no dead-code tool
(`knip`/equivalent) configured.

#### Lint warnings (15)

Real correctness cleanups (unused — introduced by the last commit):
- `src/workspace/report.ts`: `metricsTableWithStats`, `readLitNotes`,
  `formatLitNotesSummary`, `removeBinding`, `formatBindingRow` imported but unused
- `src/workspace/statsReport.ts:102`: `places` assigned but unused

React hook dependency warnings (9): `ui/ModelMenu.tsx:251`, `ui/app.tsx` ×8
(`586, 620, 643, 667, 703, 1097, 1365, 1678`). Mostly intentional (mount-once
effects, stable callbacks) — to be triaged, not blindly "fixed".

#### format:check failures (17 files)

All 17 are files touched by the last commit (research pipeline). No pre-existing
formatting debt elsewhere:
`src/research/{litNotes,openalex,prose,snowball,tools}.ts`,
`src/tools/{builtin,vision}.ts`,
`src/workspace/{bindings,report,resultsTable,statsReport}.ts`,
`test/{bindings,litNotes,snowball,statsReport}.test.ts`,
`ui/{app.tsx,commands.ts}`.

#### docs:check failure (1)

`docs/research-workflow.md` — the `check-docs.ts` placeholder rule matches
`\b(TODO|FIXME|WIP|lorem)\b`. The doc describes the `draft_section` feature as
emitting "a LaTeX skeleton with `%TODO:` hints". The checker strips **fenced**
code blocks but not **inline** code spans, so the literal token trips it.
Regression from the last commit.

### CI (`.github/workflows/ci.yml`)

| Job | Blocking? | Steps |
|---|---|---|
| `test` | yes | `npm ci` → typecheck → test, matrix Node 18/20/22 |
| `qa-smoke` | yes | `npm ci` → `qa:chat:smoke`, uploads logs |
| `lint` | **advisory** (`continue-on-error: true`) | lint + format:check |

Gaps vs. target: no `docs:check` in CI; no dependency automation
(`dependabot.yml`); lint/format non-blocking; no pre-commit hooks.

### Repo hygiene inventory

| File | State |
|---|---|
| `README.md` | present (positions handoff as **research companion**) |
| `LICENSE` | present (MIT) |
| `.github/CONTRIBUTING.md` | present (scoped) |
| `.github/SECURITY.md` | present (scoped) |
| `.github/CODEOWNERS` | present |
| `.github/{ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE.md}` | present |
| root `CONTRIBUTING.md` | **missing** |
| root `SECURITY.md` | **missing** |
| `CHANGELOG.md` | **missing** |
| `AGENTS.md` | **missing** |
| `.env.example` | **missing** |
| `.editorconfig` | **missing** |
| `.gitattributes` | **missing** |
| pre-commit config | **missing** |
| `dependabot.yml` | **missing** |

### Product-positioning mismatch (confirmed)

- `README.md:1` — "A local-first **research companion**…" ✅ correct identity
- `package.json` `description` — "A local-first, **Claude Code-style TUI coding
  agent** powered by your own Ollama models." ❌ says coding agent
- `package.json` `keywords` — includes `"coding-agent"` ❌
- QA scenario names & docs consistently say research. → align metadata to README.

### Naming: `ownhandoff` vs `handoff` (not a bug — needs documenting)

npm package is `ownhandoff` (the plain `handoff` name is presumably taken); the
CLI bin is `handoff`. Referenced in: `README.md`, `package.json`,
`package-lock.json`, `docs/index.md`, `docs/getting-started.md`,
`.github/SECURITY.md`, `installers/{install,uninstall}.sh`,
`src/research/arxiv.ts` (User-Agent). All legitimate. Action: document the
distinction clearly (README + AGENTS.md), do not rename.

### Suspected-duplicate tests (investigated — NOT duplicates)

| Pair | Verdict |
|---|---|
| `test/model-menu.test.tsx` (81 L) vs `test/modelMenu.test.tsx` (66 L) | **Distinct.** Former tests the interactive `ModelMenu` component (favourites, sections); latter tests the `/model` command's hardware-aware suggestion line. Confusing names → rename for clarity, don't delete. |
| `test/systemPrompt.test.ts` (77 L) vs `test/systemPrompt2.test.ts` (201 L) | **Distinct.** Former: `buildSystem` basics + bib placement; latter: mode-specific & Overleaf context. `2` suffix is a smell → merge or rename by scope, don't delete. |

### Misplaced-but-not-stale (investigated)

| Path | Finding |
|---|---|
| `src/adapters/*` (core-bench, dabstep, ml-agent-bench, runner, types, BENCHMARKS.md) | Benchmark harness in production `src/`. **Used** by `bench:*` npm scripts. Misplaced, not stale → move to `benchmarks/`. |
| `src/skills/` (store.ts, tools.ts) vs `skills/` (apple-notes, apple-reminders, overleaf) | **Both legit.** `src/skills/` = runtime; `skills/` = skill content. Not duplication. |
| `src/mascotPreview.tsx` | Referenced by `npm run mascot`. Verify in Phase 2 before any decision. |
| `dev.sh`, `BUILD_SEQUENCE.txt`, `PRODUCT_PLAN.txt`, `TODO.md`, `ERRORS.md` | Root clutter. `ERRORS.md` likely overlaps `docs/troubleshooting.md`. Investigate in Phase 2. |
| `.DS_Store` | Should be git-ignored / removed. |

---

## Phase log

_(appended as phases complete)_

### Phase 1 — Fix correctness before architecture churn ✅ (2026-07-13)

All baseline failures fixed; every gate green.

| Gate | Before | After |
|---|---|---|
| `typecheck` | pass | pass |
| `test` | 568 pass | 568 pass |
| `lint` | 0 err / 15 warn | **0 err / 10 warn** |
| `format:check` | **17 files fail** | pass |
| `docs:check` | **1 error** | pass |
| `check` | typecheck+test only | **typecheck→lint→format→docs→test** |

Changes:
- **Formatting** — `prettier --write` on the 17 drifted files (all from the
  prior research-pipeline commit). No logic changes.
- **Unused imports/vars removed** — `src/workspace/report.ts` (5:
  `metricsTableWithStats`, `readLitNotes`, `formatLitNotesSummary`,
  `removeBinding`, `formatBindingRow`); `src/workspace/statsReport.ts` (`fmt`'s
  dead `places` param — no caller passed it).
- **docs:check regression** — `check-docs.ts` now strips inline code spans
  (`` `…` ``) before the placeholder scan, mirroring how it already strips
  fenced blocks. `docs/research-workflow.md`'s ``%TODO:`` (accurately describing
  the `draft_section` LaTeX markers) no longer trips it. Verified the checker
  still catches *unbackticked* prose placeholders.
- **Lint made useful** — `no-unused-vars` promoted `warn → error` (the class of
  bug the prior commit introduced); `test/**` un-ignored and now linted; fixed 2
  real test errors (`Function` type in `model.test.ts`, literal-spaces regex in
  `web.test.ts`), removed stale `eslint-disable` directives, and cleaned unused
  `home`/import bindings across 9 test files.
- **`npm run check`** now runs typecheck → lint → format:check → docs:check →
  test, and passes.

**Remaining 10 lint warnings (accepted, tracked):** 9 ×
`react-hooks/exhaustive-deps` (`ui/ModelMenu.tsx` ×1, `ui/app.tsx` ×8) + 1
`no-explicit-any` in `test/model.test.ts`. The hook-deps warnings are in code
slated for the Phase 3 `ui/app.tsx` split; they will be resolved there rather
than papered over with disable comments now. `--max-warnings=0` is therefore
**not** yet enforced in CI — revisit after Phase 3.

**Deferred to Phase 2 audit:** `metricsTableWithStats`
(`src/workspace/resultsTable.ts`) is exported, untested, and unwired — its
intended consumer (`export_results`, per the docs' "per-column CI rows" claim)
never called it. Decide keep-and-wire vs remove in `STALE_CODE_AUDIT.md`.

