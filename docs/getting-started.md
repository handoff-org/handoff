---
title: Getting started
nav_order: 2
---

# Getting started

This walks you from a fresh install to your first research session.

## 1. Install

Pick one:

```sh
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.ps1 | iex

# Any OS, if you have Node.js 18+
npm install -g ownhandoff
```

The `install.sh` / `install.ps1` scripts set up **everything** — the `handoff` CLI,
the local model backends (Ollama, plus mlx-lm / llama.cpp where supported), and
[uv](https://docs.astral.sh/uv/) for the Python experiment runner. The plain
`npm install -g ownhandoff` path installs only the CLI; you'd add the backends and uv
yourself.

The package is **`ownhandoff`**; the command is **`handoff`**.

## 2. Get a local model

handoff defaults to [Ollama](https://ollama.com/download) so everything runs on your
machine. Install Ollama, then pull a model:

```sh
ollama pull qwen3:8b
```

If no model is present on first launch, handoff's setup wizard offers to pull one for
you. handoff bootstraps what it can automatically and always tells you what it did.

> Prefer a hosted model? Set `HANDOFF_BACKEND=hf` and `HF_TOKEN=...` to use the
> HuggingFace backend. Everything else in this guide is identical.

Ollama is the default and easiest path, but handoff also supports **llama.cpp** and
**MLX** (local), and self-hosted **vLLM** — pick your backend in the setup wizard or
with `/model`. See [Configuration](configuration.md#backends).

## 3. First launch

```sh
handoff
```

The setup wizard asks for **backend → model → quantization**, then a one-time
**personalization** opt-in ("Enable local personalization?"), writes your choices to
`~/.handoff/config.json`, and drops you into the chat. You can change any of these
later with `/model`, `/settings`, `/profile`, and `/mode`.

If you enable personalization, handoff keeps a small, local, editable profile of your
stated preferences and habits (`~/.handoff/profile.json`) so it adapts over time — view or
manage it anytime with `/profile`, and see [Personalization](configuration.md#personalization)
for exactly what it does and doesn't store.

Not working on a paper right now? Press **`~`** on an empty prompt to drop into
**off-work mode** — a plain general assistant with no project or Overleaf context. Press
`~` again (or open a project with `/project`) to go back on the books.

## 4. Your first project

Research in handoff is organized into **projects** — one per study. Create one:

```
/project new Memory and Attention
```

This scaffolds a workspace under `~/.handoff/projects/memory-and-attention/`:

```
literature/   notes and cached papers   (private)
experiments/  one uv project per experiment (private)
runs/         experiment ledger + capsules (private)
results/      tables + figures           (private)
paper/        the LaTeX draft + refs.bib (syncs to Overleaf)
```

The new project becomes **active** — relative file paths now resolve inside it, so
when you ask handoff to write `experiments/run.py` it lands in the right place.

Open the project menu anytime with `/project` to switch, create, or delete.

## 5. Work in plain language

Just talk to it. A few things to try:

- *"Summarize the layout of this project."*
- *"Find three recent papers on retrieval-augmented attention and add them to my bibliography."*
- *"Write a Python script in experiments/ that loads results/metrics.csv and plots accuracy."*

File writes inside the active project apply immediately and show a compact **diff
box** — additions in green, deletions in red — instead of pasting the whole file back.

When handoff runs a Python experiment (via `run_code`), it creates an isolated
[uv](https://docs.astral.sh/uv/) project under `experiments/<name>/` — declaring the
packages up front, running with `uv run`, and leaving a `pyproject.toml` + `uv.lock`
you can push to GitHub. Every run is also captured as a reproducible **capsule** under
`runs/<id>/`. See [Research workflow](research-workflow.md#pillar-2--prepare--run-experiments).

## 6. Start a paper from a template

Ask handoff to *"start the paper"* (or draft a section) and it first asks which template
you want:

- **Blank LaTeX** — a minimal `article` skeleton.
- **ACL 2025** or **NeurIPS 2025** — the venue's structure.

Templates live in `~/.handoff/templates/` (seeded on first run). handoff copies the whole
chosen template folder into `paper/` — **every file needed to render the PDF** comes along:
`main.tex`, the venue's `.sty`, any `.bst`, checklists, and a starter bibliography. Citations
you add later are picked up by the template's `\bibliography{…}` and, when you're linked to
Overleaf, show up online. It won't clobber an existing `main.tex`.

**Add your own template:** drop a folder into `~/.handoff/templates/<name>/` containing a
`main.tex` (put `TITLE_GOES_HERE` where the title goes) plus any `.sty`/`.bst`/`.bib` it needs.
It shows up automatically the next time you start a paper.

## 7. Keep your claims honest

As the paper grows, run `/audit-paper` to catalog every numeric and comparison claim,
then link runs or citations as evidence. `/handoff` turns the current state into a
shareable summary. See [Claims & handoff](claims-and-handoff.md).

## 8. Link your paper to Overleaf (optional)

If you write in Overleaf, run `/overleaf`, paste your project link and a Git token,
and handoff will keep `paper/` in sync both ways. See [Overleaf sync](overleaf.md).

## Next steps

- [Research workflow](research-workflow.md) — what handoff can do across the research lifecycle
- [Commands](commands.md) — every slash command and key binding
- [Configuration](configuration.md) — backends, themes, modes, env vars, faster local inference
- [Skills](skills.md) — capture and replay your own workflows
