---
title: Home
layout: default
nav_order: 1
description: "handoff — a local-first AI research companion for reading papers, running experiments, writing LaTeX, and tracking claims."
permalink: /
---

![handoff]({{ '/assets/banner120.png' | relative_url }}){: style="width:100%; border-radius:8px; margin-bottom:1.5rem;"}

# handoff

**Private research you can prove.**
{: .fs-6 .fw-500 }

A local-first AI research companion that lives in your terminal — read papers, run
experiments, write LaTeX, track every claim to its evidence, and hand off clean research
context. The models run on *your* machine; nothing leaves your computer unless you say so.
{: .fs-5 .fw-300 }

[Get started](getting-started.md){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[Commands](commands.md){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 }
[GitHub](https://github.com/handoff-org/handoff){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Install

```bash
# macOS / Linux — installs the CLI, Ollama, mlx-lm, llama.cpp, and uv
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex

# Any OS — CLI only (add a model backend yourself)
npm install -g ownhandoff
```

Package **`ownhandoff`** · command **`handoff`**. Then run `handoff` and follow the setup
wizard. See [Getting started](getting-started.md).

## What handoff does

| | |
|---|---|
| 🔬 **Read** | Search OpenAlex & arXiv live, read PDFs and LaTeX source, build `.bib` files, and fact-check claims with `/research`. |
| 🧪 **Run** | Each Python experiment runs in an isolated [uv](https://docs.astral.sh/uv/) project and is captured as a reproducible capsule — code, env, metrics, `repro.sh`. |
| 📝 **Write** | Draft from ACL, NeurIPS, or a blank template, edit in place with a diff box, and sync two-way with Overleaf. |
| ✅ **Prove** | A claim ledger, `/audit-paper`, `/provenance`, and `/handoff` packets keep every number traceable to its evidence. |
| 🔗 **Integrate** | Annotate papers in Zotero, and fetch & answer reviews from OpenReview. |

## Why local-first

handoff runs against [Ollama](https://ollama.com), llama.cpp, MLX, or vLLM on your own
machine, so your literature, data, drafts, and conversations stay with you. A cloud model
(HuggingFace) is only ever used **after you explicitly opt in** — and even then, only the
context you send.

## Core workflows

```text
/project new Memory and Attention     # scaffold a private research workspace
/research transformers need positional encodings   # fact-check against the literature
# …ask it to run experiments and draft your paper…
/audit-paper                            # catalog every claim; flag the unsupported ones
/handoff --for-me                       # a grounded summary of where the work stands
```

## Next steps

| | |
|---|---|
| [Getting started](getting-started.md) | Install, first launch, first project. |
| [Research workflow](research-workflow.md) | Literature → experiments → results → paper. |
| [Commands](commands.md) | Every slash command and key binding. |
| [Claims & handoff](claims-and-handoff.md) | Claim ledger, `/audit-paper`, transfer packets. |
| [Overleaf sync](overleaf.md) | Two-way LaTeX sync, tokens, troubleshooting. |
| [Zotero & OpenReview](integrations.md) | Annotate papers, fetch & answer reviews. |
| [Configuration](configuration.md) | Config file, env vars, backends, themes. |
| [Choosing a model](models.md) | Fast local models, presets, doctor & benchmark. |
| [Skills](skills.md) | Save and replay your own workflows. |
| [Troubleshooting](troubleshooting.md) | Fixes for the common snags. |
| [Architecture](architecture.md) | Contributor's tour of the codebase. |
