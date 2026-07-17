---
title: Architecture
nav_order: 12
---

# Architecture

A high-level map of how handoff is structured. It's a TypeScript app that runs directly
from source — there is **no build step**; [tsx](https://github.com/privatenumber/tsx)
executes `.ts`/`.tsx` files, and the terminal UI is built with
[Ink](https://github.com/vadimdemedes/ink) (React for the terminal).

## Top-level layout

```
bin/            CLI entry point
src/
  agent/        model backends, inference loop, presets
  tools/        tool registry and built-in tools
  workspace/    projects, experiments, claims, Overleaf sync
  research/     literature search and fact-checking
  skills/       user-defined skill loading and execution
  personalization/  local adaptive profile (never leaves the machine)
  util/         shared helpers
config/         config schema, storage, sessions, model catalog
ui/             all Ink components and the terminal renderer
skills/         built-in skills (one folder per skill)
templates/      paper templates (ACL, NeurIPS, blank)
installers/     install/uninstall scripts (macOS, Linux, Windows)
test/           test suite
```

## Subsystems

### Agent

The core inference loop in `src/agent/` drives all model interaction. It streams
responses, handles tool calls, manages conversation history, and coordinates the
approval gate for sensitive operations. Backend support covers Ollama, llama.cpp,
MLX, vLLM, and HuggingFace — all sharing a common interface.

Inference presets (`cool` / `fast` / `balanced` / `deep`) tune context window, output
length, and keep-alive as a single named choice. A context-management layer keeps
prompts within the configured budget across long sessions.

### Tools

`src/tools/` holds the tool registry and built-in tools: file read/write/edit,
directory operations, file search, shell execution, web fetch, web search, PDF reading,
and user prompts. Workspace, research, and skills modules register additional tools at
startup. All file writes resolve through the active project root.

### Workspace

`src/workspace/` handles everything project-scoped:

- **Projects** — scaffold, active-project pointer, path resolution
- **Experiments** — code execution in isolated environments, run capture
- **Capsules** — per-run reproducibility records (code, environment, metrics, outputs)
- **Claims** — append-only claim ledger and paper auditing
- **Overleaf** — two-way LaTeX sync over git
- **Handoff packets** — audience-specific transfer summaries

### Research

`src/research/` provides literature access: OpenAlex and arXiv search, paper fetching,
PDF reading, LaTeX source extraction, citation management, and a per-project notebook.
The `/research` command runs fact-checks against this layer.

### Personalization

`src/personalization/` is a fully local adaptive profile. It detects explicit
preferences from conversation, tracks lightweight usage habits, and injects a compact
preference block into the system prompt. Nothing is stored or sent without user opt-in.
A privacy gate screens all stored strings before write.

### UI

`ui/` contains all Ink components: the main app orchestrator, modal pickers (model,
settings, project, Overleaf, and more), the transcript renderer, syntax highlighting,
the diff display, and the banner. The renderer controls viewport layout precisely,
keeping the input box anchored to the bottom.

## Tests

`npm test` runs the suite via tsx. Tests cover core logic, workspace operations with
an isolated home directory, the agent loop against a scripted model, and Ink render
checks for key UI components.
