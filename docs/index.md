---
title: Home
layout: default
nav_order: 1
description: "handoff — a local-first research companion that lives in your terminal."
permalink: /
---

# handoff
{: .fs-9 }

A local-first terminal agent for researchers — reads the literature, runs your
experiments, and helps write your paper, powered by models on *your* machine.
{: .fs-5 .fw-300 }

[Get started](getting-started.md){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[GitHub](https://github.com/handoff-org/handoff){: .btn .fs-5 .mb-4 .mb-md-0 }

---

**Everything stays local.** handoff runs against Ollama, llama.cpp, MLX, or vLLM on
your own machine. Cloud is only ever used after you explicitly opt in.

## What it does

| | |
|---|---|
| 🔬 **Literature** | Search OpenAlex & arXiv live, build `.bib` files, fact-check claims with `/research`. |
| 🧪 **Experiments** | Each Python run gets an isolated [uv](https://docs.astral.sh/uv/) project and a reproducible capsule — code, env, metrics, `repro.sh`. |
| 📝 **Paper** | Start from ACL, NeurIPS, or a blank template. Edit in place with a diff box. Two-way Overleaf sync. |
| ✅ **Provenance** | Claim ledger + `/audit-paper` + `/handoff` transfer packets keep your results traceable. |

## Install

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.ps1 | iex

# Any OS — CLI only
npm install -g ownhandoff
```

Package: **`ownhandoff`** · Command: **`handoff`**

## Docs

| | |
|---|---|
| [Getting started](getting-started.md) | Install, first launch, first project. |
| [Research workflow](research-workflow.md) | Literature → experiments → results → paper. |
| [Commands](commands.md) | Every slash command and key binding. |
| [Choosing a model](models.md) | Fast local models, presets, doctor & benchmark. |
| [Configuration](configuration.md) | Config file, env vars, backends, themes. |
| [Claims & handoff](claims-and-handoff.md) | Claim ledger, `/audit-paper`, transfer packets. |
| [Overleaf sync](overleaf.md) | Two-way sync, tokens, troubleshooting. |
| [Skills](skills.md) | Save and replay your own workflows. |
| [Architecture](architecture.md) | Contributor's tour of the codebase. |
