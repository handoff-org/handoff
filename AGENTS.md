# AGENTS.md — working on handoff

Instructions for coding agents (and humans) working in this repository. Read
this before making changes. For contribution mechanics see
[`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md); for the security model see
[`.github/SECURITY.md`](.github/SECURITY.md).

## What handoff is

A **local-first research companion** that runs in the terminal: it reads the
literature, runs experiments, writes LaTeX, and traces every claim to its
evidence — powered by models on the user's own machine (Ollama / llama.cpp /
MLX / vLLM), with cloud (HuggingFace) only after explicit opt-in. **Privacy is
the product.** Nothing about a user's unpublished ideas, data, or drafts leaves
their machine unless they say so.

Do **not** reposition this as a general "coding agent." It is a research tool.

### Package vs. command name

- **npm package:** `ownhandoff` (the bare `handoff` name was unavailable).
- **CLI command / bin:** `handoff` → `bin/handoff.js`.

Both are intentional. When editing metadata, keep `name: "ownhandoff"` and
`bin.handoff` consistent; don't "fix" one to match the other.

## Layout

```
bin/            CLI entry (handoff.js -> src/index.tsx via tsx)
src/
  agent/        model backends (Ollama/HF/llama.cpp/MLX), agent loop, router, systemPrompt, advisor
  research/     literature: openalex, arxiv, zotero, openreview, notebook, litNotes, snowball, prose, cache
  workspace/    projects, paper/overleaf, claims, provenance, capsules (runs), report, resultsTable, statsReport, bindings
  tools/        tool registry + builtin tools; security (ssrf.ts, path guards); vision; pymupdf
  personalization/  opt-in profile learning
  system/       hardware detection
  skills/       skill runtime (store, tools)   [skill *content* lives in top-level skills/]
  util/         shared helpers (jsonl, http, ...)
ui/             Ink (React) TUI — app.tsx (composition), overlays, components, hooks
config/         schema, model catalog, theme, sessions store
qa/chat-sim/    deterministic chat-simulation QA harness (mock model, isolated HOMEs)
benchmarks/     benchmark harnesses and data
skills/         skill definitions (apple-notes, apple-reminders, overleaf)
templates/      paper templates (acl, neurips, blank)
docs/           GitHub Pages site (Jekyll)
test/           node:test suite (unit/integration/e2e)
```

No build step: the app runs straight from TypeScript via `tsx`.

## How tools work

The LLM drives the app by calling **registered tools**. Each tool declares a
name, description, JSON-schema parameters, an `execute`, and (if it touches the
filesystem/network/shell) `sensitive: true` for approval gating. Tools are
registered by `registerXxxTools(registry)` functions and dispatched by the agent
loop. When adding a tool, keep its schema, validation, execution, and safety
metadata together, and add a test.

Slash commands (`ui/commands.ts` for the menu; dispatch in `ui/app.tsx`) either
run synchronously (pure display) or are model-directed via `runTurn`.

## Quality gates — run before every PR

```sh
npm run check      # typecheck -> lint -> format:check -> docs:check -> test
```

Individually: `npm run typecheck`, `npm run lint`, `npm run format`,
`npm run docs:check`, `npm test`, `npm run qa:chat:smoke`.

- **Formatting** is owned by Prettier — run `npm run format`, don't hand-format.
- **Lint:** `no-unused-vars` is an **error**. Prefix deliberately-unused names
  with `_`. A handful of `react-hooks/exhaustive-deps` warnings in `ui/app.tsx`
  and `ui/ModelMenu.tsx` are known and intentional (stable callbacks whose deps
  would force needless re-renders); keep them warnings, don't silence them.
- **Docs:** `docs/*.md` must pass `docs:check` (one H1, valid links, no
  placeholders). Literal `TODO`-like tokens must live inside `code spans`.
- **QA:** `qa:chat:smoke` runs 22 deterministic scenarios with a mock model and
  isolated temp HOMEs — no network, no Ollama.

## Conventions

- **Match surrounding code** — comment density, naming, idiom.
- **Tests:** `node:test` + `node:assert/strict`. Use `freshHome()` from
  `test/helpers.ts` to isolate `$HOME` before importing modules that read it.
- **Commit messages:** plain, imperative. **No** `[codingagent]` prefix. **No**
  `Co-Authored-By` or other attribution trailers.
- **Never delete code just because it looks unused** — prove it with the import
  graph, grep (including tests + dynamic/spawned paths), and runtime analysis.
  Run `npm run deadcode` (knip), but note it is noisy here (factory dispatch,
  child-process spawns, test-only usage), so confirm each finding by hand.

## Safety invariants (do not regress)

- File writes stay inside the active project workspace unless the user approves
  otherwise (`src/tools` path guards).
- Network fetches go through the SSRF guard (`src/tools/ssrf.ts`).
- Secrets (API keys, tokens) are redacted from logs/sessions.
- Remote/cloud models are **off by default**; enabling requires explicit consent.
