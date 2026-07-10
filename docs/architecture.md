---
title: Architecture
nav_order: 10
---

# Architecture

A contributor's tour of how handoff is put together. It's a TypeScript app that runs
directly from source — there is **no build step**; [tsx](https://github.com/privatenumber/tsx)
executes the `.ts`/`.tsx` files, and the TUI is rendered with
[Ink](https://github.com/vadimdemedes/ink) (React for the terminal).

## Layout

```
bin/handoff.js        # launcher: execs `tsx src/index.tsx`
src/
  index.tsx           # entry: load config, seed templates, register tools, render <App>
  agent/
    model.ts          # ChatModel interface + Ollama / llama.cpp / MLX / vLLM / HuggingFace backends
    loop.ts           # runAgentLoop: the tool-calling event loop (async generator); compacts sent history to a budget
    systemPrompt.ts   # buildSystem(): base prompt + interaction/write directives + project context
    latex.ts          # escapeLatex / starterTex (shared, dependency-free)
    approval.ts       # writeTargetsProject(): is a write inside the active project?
    advisor.ts, doctor.ts, benchmark.ts, ollama.ts   # model selection + Ollama helpers
    presets.ts, contextBudget.ts, compaction.ts       # laptop inference presets + per-turn token budget + history compaction
  tools/
    registry.ts       # ToolRegistry: register/getSchemas/call + sensitivity
    builtin.ts        # read_file, write_file, edit_file, make_dir, list_dir, search_files, find_files, run_shell, web_fetch, web_search, read_pdf, ask_user
    search.ts         # bounded, dependency-free file walker: grep (search_files) + glob (find_files)
  workspace/
    project.ts        # research projects: scaffold, active project, resolveWorkspacePath
    runner.ts         # run_code / query_runs: execute code, capture a capsule
    ledger.ts         # runs/ledger.jsonl append-only run index
    capsule.ts        # per-run capsule (code, env, git, hashes, metrics, repro.sh) + promote
    claims.ts, auditor.ts   # claim ledger + deterministic claim extraction from paper/
    handoff.ts        # /handoff transfer packets
    templates.ts, templateStore.ts   # paper templates: blank generator + ~/.handoff/templates copy
    overleaf.ts       # the Overleaf git bridge: link, push, pull, auto-sync, write guard
    tools.ts          # workspace tools exposed to the model
  research/
    openalex.ts, arxiv.ts   # literature clients (source-agnostic Paper shape)
    corrections.ts    # the /research fact-check directive
    cache.ts          # local paper cache
    notebook.ts       # auto-kept per-project NOTEBOOK.md (+ read/search helpers)
    arxivSource.ts    # extract a paper's LaTeX source (gzip+tar via stdlib zlib)
    prose.ts          # local writing-quality checks (check_writing) + section scaffold
    tools.ts          # search_papers / search_arxiv / get_paper / fetch_arxiv / read_arxiv_source / cite_paper / take_note / read_notebook / search_notes
  skills/
    store.ts          # load/save skills (flat file or per-skill folder, frontmatter markdown)
    tools.ts          # skill tools
  personalization/    # local adaptive profile (~/.handoff/profile.json)
    profile.ts        # Zod schema + types + /profile show/why formatting
    store.ts          # load/save (atomic, corrupt→backup) / reset / export
    learn.ts          # explicit-preference detection + light habit counting
    prompt.ts         # compact, cloud/focus-gated "User preferences" block
    redaction.ts      # privacy gate (reuses util/redact.ts)
  util/               # git.ts (read-only git state), jsonl.ts, redact.ts
config/
  schema.ts           # Config shape + env-var loading (zod)
  store.ts            # read/write ~/.handoff/config.json
  sessions.ts         # per-project session save/restore
  catalog*.ts, models.ts   # model + quantization option lists
  theme.ts            # color themes (matte palette)
ui/                   # all Ink components and the line-windowing renderer
skills/               # built-in skills, one folder per skill (<name>/<name>.md)
templates/            # built-in paper templates (acl/, neurips/), seeded into ~/.handoff
installers/           # install.sh / install.ps1 / uninstall.* (curl|bash bootstrap)
test/                 # node:test suite (logic + render checks)
```

## The agent loop

`runAgentLoop` (`src/agent/loop.ts`) is an **async generator** that yields typed
`AgentEvent`s (`message_start`, `message_delta`, `tool_call`, `tool_result`, `error`,
`cancelled`, `done`). Each iteration:

1. streams a model turn (`model.chatStream`), accumulating text deltas and tool calls;
2. dedups identical tool calls within the turn;
3. records the assistant message **with its `tool_calls`** so the model sees it already
   acted (OpenAI protocol);
4. for each call: `ask_user` is routed to the UI; otherwise the call goes through the
   approval gate, then `registry.call(name, args)`. Each result is pushed back as a
   `tool` message keyed by `tool_call_id`.

It loops up to `MAX_ITERATIONS` (10), an `AbortSignal` lets the UI interrupt, and the
final `done` event carries the full message history for session saving.

### Inference presets and context compaction

`src/agent/presets.ts` defines six **inference presets** (`cool`, `fast`, `balanced`,
`deep`, `long_context`, `manual`) that bundle four Ollama knobs — context window,
max output tokens, keep-alive, and prompt budget — into one named choice. They are
battery-aware: keep-alive shortens on battery and `long_context` warns before applying.
`applyPreset(preset, hardwareProfile)` derives concrete values; the result is written to
`config.json` so the settings survive restart.

`src/agent/contextBudget.ts` converts preset + `num_ctx` into a `maxPromptTokens`
limit and, each turn, classifies the turn as `ok` / `warn` / `slow` based on prompt
size (used for the per-turn slow-turn hint the UI shows after a heavy turn).

`src/agent/compaction.ts` (`compactHistory`) runs every turn, **before** the message
list is sent to the model:

- The system message is passed byte-identical (so backends can prefix-cache it).
- Recent turns are kept verbatim; old tool outputs are capped to `toolCapChars` first.
- Oldest complete turns (always in protocol-safe `assistant + tool` pairs) are dropped
  until the estimated token count fits within `maxPromptTokens`.
- The full in-memory `messages` array is never mutated — only the slice sent is trimmed.

## Models

`ChatModel` (`src/agent/model.ts`) is the backend interface: a single `chatStream`
method yielding `StreamPart`s. Five implementations share it. Four OpenAI-compatible
backends — `HFModel` (HuggingFace router), `VLLMModel`, `LlamaCppModel`, and `MlxModel` —
stream Server-Sent Events through `streamOpenAICompat`. **`OllamaModel` uses Ollama's
native `/api/chat`** (newline-delimited JSON, via `streamOllamaNative`) instead of the
OpenAI-compatible endpoint, so it can pass `keep_alive` and `options.num_ctx` — the two
knobs the OpenAI endpoint ignores. All five speak the OpenAI tool protocol.
`parseInlineToolCalls` recovers tool calls that smaller models print as text (Qwen-style
`<tool_call>` tags or fenced JSON) instead of returning structured calls;
`nativeToolCallsToToolCalls` normalizes Ollama's object-valued `arguments` into the
string form the rest of the app expects.

## Tools

A `ToolRegistry` holds tool definitions (name, JSON-schema parameters, `sensitive`
flag, `execute`). `getSchemas()` produces the OpenAI `tools` array; `call()` dispatches
by name and catches errors. Built-ins live in `src/tools/builtin.ts`; the workspace,
research, and skills modules register their own. File tools resolve paths through
`resolveWorkspacePath` so relative writes land inside the active project.

**Built-in file tools** (`src/tools/builtin.ts`):

| Tool | What it does |
|------|--------------|
| `read_file` | Read a file by path. |
| `write_file` | Write / overwrite a file; `append="true"` appends. |
| `edit_file` | Surgical `old_string → new_string` replacement without rewriting the whole file. Ambiguity-checked (rejects if the string appears > 1 time unless `replace_all="true"`). |
| `make_dir` | Create a directory tree. |
| `list_dir` | List entries in a directory. |
| `search_files` | Regex search over file contents (`path:line: text`), optional glob filter, skips `node_modules`/`.git`/`.venv`/binaries. Backed by `src/tools/search.ts`. |
| `find_files` | Glob over project paths (`**/*.py`, `results/*.png`). Backed by `src/tools/search.ts`. |
| `run_shell` | Run a shell command inside the active project root. |
| `web_fetch` | Fetch a URL and return readable text (HTML stripped to prose via `tools/web.ts`; content-type aware; output capped by `max_chars`). SSRF-guarded by `tools/ssrf.ts` (rejects loopback, private/CGNAT/link-local/unique-local ranges, IPv4-mapped IPv6, and obfuscated decimal/octal/hex IP encodings; http(s) only) — redirects are followed manually and re-checked per hop. |
| `web_search` | Search the web (DuckDuckGo HTML endpoint, no API key) and return the top results as title/URL/snippet. Pair with `web_fetch` to read a result. Parsing lives in `tools/web.ts`. |
| `read_pdf` | Extract text from a local PDF or a direct PDF URL via `pdftotext` (poppler, invoked with array args — no shell; downloaded temp files are cleaned up). |
| `ask_user` | Present a multiple-choice question to the user; the agent loop routes it to the on-screen picker. |

`src/tools/search.ts` is a **dependency-free, bounded file walker** — no ripgrep
required. `walkFiles(root)` generates paths while skipping `node_modules`, `.git`,
`.venv`, etc. (max 4000 files). `globToRegExp(glob)` converts `**` (any depth) and `*`
(within a segment) to a `RegExp`. `grepFiles` and `globFiles` use these to back
`search_files` and `find_files`.

## Workspace & Overleaf

`src/workspace/project.ts` owns the `~/.handoff/projects/<slug>/` scaffold, the active
project pointer, and `resolveWorkspacePath`. `src/workspace/overleaf.ts` is a thin,
shell-free wrapper over `git` (args passed directly, tokens never interpolated into a
shell): `linkOverleaf` clones into `paper/`, `autoPullOverleaf`/`autoSyncOverleaf` run
before/after each turn, and `overleafWriteGuard` enforces the single-document rule and
keeps the bibliography inside `paper/`. See [overleaf.md](overleaf.md).

## Experiments, capsules & provenance

`src/workspace/runner.ts` runs code (`run_code`) for Python/R/Julia/shell. Each Python
experiment gets its own isolated uv project under `experiments/<name>/` (`uv init` →
`uv add <deps>` → `uv run`, so it carries a `pyproject.toml` + `uv.lock` and is
GitHub-pushable); a missing import is `uv add`-installed and the run retried, and if uv
isn't present it falls back to a plain per-project `venv`. Each run is captured two ways: a
compact append-only line in `runs/ledger.jsonl` (`ledger.ts`, read by `query_runs`) and a
full **capsule** under `runs/<id>/` (`capsule.ts`) holding the exact code, an allowlisted
env snapshot, git commit + uncommitted diff (via the read-only `util/git.ts`), sha256
hashes of the files the run wrote under `results/`, parsed metrics, full stdout/stderr, and
a generated `repro.sh` (which uses `uv run --project` for uv experiments). `executeRun` is
shared by the `run_code` tool and the `/rerun` command; `/reproduce`, `/compare-runs`, and
`/promote-run` are wired in `ui/app.tsx` on top of `capsule.ts` helpers.

Metrics come from a documented convention: a `results/metrics.json` object, or
`METRIC name=value` lines in stdout (`parseMetrics`). Capsules are the foundation the
next build cycles (metric/figure bindings, an artifact-trace graph) build on.

## Personalization

`src/personalization/` holds the local adaptive profile system. Everything is
**local-only** — the profile lives at `~/.handoff/profile.json` (a Zod-validated JSON
document, `AdaptiveProfileSchema` v1 in `profile.ts`) and is never sent off the machine
unless the user explicitly opts in for cloud-backend prompts.

- **`store.ts`** — `loadProfile()` / `saveProfile()` (atomic temp+rename), `resetProfile()`,
  `exportProfile()`. A corrupt file is moved to a timestamped `.bak` and replaced with a
  fresh default — it never blocks startup.
- **`learn.ts`** — `detectExplicitPreference(msg)` matches "from now on", "always", "I
  prefer", "never use X", etc. and maps them to structured profile fields. Model-rejection
  phrases ("don't use X, it overheats") are detected before the trigger gate — model-id
  specificity makes false positives unlikely. `applyExplicit` upserts at confidence 0.9.
  `recordEvent` bumps habit counters (model selected, command used, etc.); a threshold model
  (3+ observations → inferred at 0.55, contradictions decay) produces light inferences.
  Behavioral style is **explicit-only** — handoff never infers verbosity or tone from behavior.
- **`redaction.ts`** — privacy gate before any string is stored: rejects code fences,
  strings > 200 chars, token-bearing URLs, and secrets; strips emails. Uncertain or
  sensitive phrases are silently dropped rather than stored or surfaced.
- **`prompt.ts`** — `buildPersonalizationPrompt(profile, ctx)` renders a compact
  "User preferences" block (≤ ~300 tokens). Returns `''` when: disabled; a cloud backend
  unless `allowCloudPrompt`; focus=general and only project-specific lines would show.
  Only preferences at confidence ≥ 0.9 (explicit) or ≥ 0.6 (inferred) are included.

The profile feeds two downstream consumers: the system prompt (via `BuildOpts.personalization`
in `systemPrompt.ts`) and the model advisor (via `AdvisorInput.personalization` in
`advisor.ts`, which adds `+24` for preferred models, `−60` for rejected, and a small
penalty for large models when `prefersFastSmallModels`). The `/model` picker reflects these
signals as `✓you`, `rejected`, and `slow` badges.

## Claims, notebook & handoff

`src/workspace/claims.ts` keeps an append-only claim ledger (`claims/claims.jsonl`);
`auditor.ts` scans `paper/*.tex` and extracts numeric/comparison/literature claims
deterministically. `src/research/notebook.ts` auto-appends a timestamped `NOTEBOOK.md`
entry whenever a run finishes, a paper is fetched, or a section is drafted.
`src/workspace/handoff.ts` rolls the notebook, run ledger, and claim ledger into an
audience-specific transfer packet (`/handoff`). See [claims-and-handoff.md](claims-and-handoff.md).

## The renderer (line-windowing)

The TUI does **not** use scrollable containers. Instead, `ui/lines.tsx` converts each
transcript entry (`ChatEntry`, see `ui/types.ts`) into an exact list of single-row
`<Text>` elements (`entryLines`), `ui/app.tsx` concatenates the banner + all entries
into one flat array, and slices it to the viewport height with a scroll offset. This
gives precise control over what's on screen, pins the input box to the bottom, and lets
the mouse wheel (mapped to arrow keys via alternate-scroll mode) scroll the history.

Tool results displayed in the transcript are **truncated before rendering** (6 lines /
400 chars, configurable in `truncateResult`) so long `run_code` stdout or `read_file`
dumps don't flood the screen. This is display-only — the full result is in the message
history the model sees.

Notable UI pieces:

- `ui/app.tsx` — orchestrator: state, input handling, `runTurn`, layout/windowing,
  footer; personalization learning hook; inference-preset application; backend
  server-reachability reminder on mount.
- `ui/Overlays.tsx` — the modal pickers (model/quant/settings/theme/mode/project/
  overleaf/question/preset/personalization) and the context-window input.
- `ui/lines.tsx` — entry → rows, including the **diff box**, **help panel**, and
  `truncateResult` for tool outputs.
- `ui/diff.ts` — `summarizeDiff`: an LCS line diff computed UI-side (zero model tokens).
- `ui/highlight.ts` — a tiny single-pass syntax highlighter (fixed One Dark palette).
- `ui/Banner.tsx` — the masthead/welcome card.
- `ui/color.ts` — shared RGB/hex math used by the banner, themes, and palettes.

## Configuration & sessions

`config/schema.ts` defines `Config` (zod) and loads it with env-var overrides over the
JSON store; `config/sessions.ts` saves/restores the conversation per project.

## Gotchas for contributors

- **No JSX fragments.** The tsx config has no `jsxFragmentFactory`; use keyed arrays
  (`[<Text key=…/>, …]`) instead of `<>…</>`.
- **`homedir()` runs at import.** `PROJECTS_DIR` and friends are computed when the
  module loads, so tests must set `HOME` **before** importing and use dynamic `import()`
  (see `test/helpers.ts`).
- **Backgrounds need color.** `ink-testing-library` strips color at level 0; assert on
  text content, or set `FORCE_COLOR=3` when asserting on `backgroundColor`.

## Tests

`npm test` runs the `node:test` suite via tsx: pure-function tests
(`input`, `highlight`, `diff`, `redact`, `model`), workspace/agent tests with an
isolated `HOME` (`project`, `approval`, `systemPrompt`, `overleaf` — the last drives a
real local bare-git remote), the agent `loop` with a scripted fake model, and Ink
`render` checks for the help panel, diff box, note, and banner.
