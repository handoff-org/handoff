---
title: Home
layout: default
nav_order: 1
description: "handoff — a local-first research companion that lives in your terminal."
permalink: /
---

# handoff
{: .fs-9 }

**Own your research.** A local-first, [Claude Code](https://claude.com/claude-code)-style
research companion that lives in your terminal — it reads the literature, drafts and
cites your paper, and helps run your experiments, all powered by models running on
*your* machine through [Ollama](https://ollama.com).
{: .fs-6 .fw-300 }

[Get started](getting-started.md){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/handoff-org/handoff){: .btn .fs-5 .mb-4 .mb-md-0 }

---

Unpublished ideas, data, and drafts never leave your computer. **Privacy is the
product, not a footnote.** Cloud is only ever used after handoff asks you first.

## What it does

- 🔒 **Private by default** — runs against local models (Ollama, llama.cpp, MLX, or
  self-hosted vLLM). Your work stays on your machine.
- 🔬 **Reads the literature** — fact-check a claim or survey a topic against scholarly
  sources, live: OpenAlex (`/research`, newest-first with `sort=date`) and `search_arxiv`
  for the freshest preprints.
- 🧪 **Runs experiments reproducibly** — `run_code` gives each Python experiment its own
  isolated uv project under `experiments/<name>/` and captures every run as a
  reproducible capsule.
- 📁 **Research workspaces** — `/project` scaffolds a tidy
  `literature / experiments / runs / results / paper` layout, scoped to one study.
- 📝 **Overleaf, two-way** — `/overleaf` links your paper; handoff edits the real
  `.tex`, auto-pulls web edits before each turn and auto-syncs after.
- 📄 **Starts from a template** — ask it to start a paper and it offers Blank LaTeX,
  ACL, or NeurIPS (or your own, added under `~/.handoff/templates/`), copying the whole
  template folder into `paper/`.
- ✅ **Tracks your claims** — a claim ledger, `/audit-paper`, and `/handoff` transfer
  packets keep your paper honest and make handing work off painless.
- 🟩 **Frictionless edits** — file writes apply straight away and show a compact
  GitHub-style diff box. No "shall I write this?", no walls of pasted text.
- 🧩 **Skills** — capture a reusable workflow with `/compose-skill`, run it with `/skill`.

## Where to go next

| Guide | What's inside |
|-------|----------------|
| [Getting started](getting-started.md) | Install, the setup wizard, and your first session. |
| [Research workflow](research-workflow.md) | The four pillars — literature, experiments, results, paper. |
| [Commands](commands.md) | Every slash command and key binding, in one place. |
| [Claims & handoff](claims-and-handoff.md) | The claim ledger, `/audit-paper`, and transfer packets. |
| [Overleaf sync](overleaf.md) | Linking, tokens, two-way sync, troubleshooting. |
| [Choosing a model](models.md) | Picking a model that's fast on your machine; `/model doctor` & benchmark. |
| [Configuration](configuration.md) | Config file, env vars, backends, themes, and speeding up local inference. |
| [Skills](skills.md) | Authoring and running your own reusable workflows. |
| [Architecture](architecture.md) | A contributor's tour of the codebase. |

## Install

```sh
# Linux / macOS — sets up the local backends, uv, and the CLI in one go
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.ps1 | iex

# Any OS, CLI only (install a backend yourself)
npm install -g ownhandoff
```

The npm package is **`ownhandoff`**; the command it installs is **`handoff`**. Then just
run `handoff`.
