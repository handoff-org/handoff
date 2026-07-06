---
title: Getting started
nav_order: 2
---

# Getting started

## 1. Install

```sh
# macOS / Linux — installs the CLI, Ollama, mlx-lm, llama.cpp, and uv
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.ps1 | iex

# Any OS — CLI only (add a backend yourself)
npm install -g ownhandoff
```

## 2. Pull a model

handoff runs on [Ollama](https://ollama.com/download) by default. Pull a model:

```sh
ollama pull qwen3:8b
```

If you don't have one when handoff starts, the setup wizard offers to pull one for you.

## 3. Launch

```sh
handoff
```

The wizard asks for **backend → model → quantization**, then an optional personalization
opt-in. Choices are saved to `~/.handoff/config.json`. Change anything later with
`/model`, `/settings`, or `/profile`.

> Press **`~`** on an empty prompt to switch to off-work mode (plain assistant, no
> project context). Press `~` again to go back.

## 4. Create a project

```
/project new My Study
```

Scaffolds a workspace at `~/.handoff/projects/my-study/`:

```
literature/    reading notes & cached papers   (private)
experiments/   one uv project per experiment   (private)
runs/          experiment ledger + capsules     (private)
results/       tables & figures                (private)
paper/         LaTeX draft + refs.bib          (syncs to Overleaf)
```

Relative paths resolve into the active project — use `/project` to switch.

## 5. Just talk to it

```
Find three recent papers on retrieval-augmented generation and add them to my bib.
Write a Python experiment that trains a small MLP on MNIST and logs accuracy.
Start the paper — I'm submitting to NeurIPS.
```

File writes show a **diff box** instead of pasting the whole file back. Python
experiments run in an isolated [uv](https://docs.astral.sh/uv/) project and every run
is captured as a reproducible capsule under `runs/<id>/`.

## 6. Keep claims honest *(optional)*

As the paper grows, `/audit-paper` catalogs every numeric and comparison claim. Link
evidence with `/claim-link-run` and `/claim-link-paper`. Generate a shareable summary
with `/handoff`. See [Claims & handoff](claims-and-handoff.md).

## 7. Link Overleaf *(optional)*

Run `/overleaf`, paste your project URL and a Git token. handoff keeps `paper/` in sync
both ways — pulling before each turn, pushing after. See [Overleaf sync](overleaf.md).

## Next steps

- [Research workflow](research-workflow.md) — the full four-pillar lifecycle
- [Commands](commands.md) — every slash command and key
- [Choosing a model](models.md) — presets, doctor, benchmark
- [Configuration](configuration.md) — backends, themes, env vars

---

## Uninstall

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.sh | bash

# Windows (PowerShell)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.ps1)))

# npm only
npm uninstall -g ownhandoff
```

Add `--purge` to also remove `~/.handoff/` (config, projects, cache, skills):

```sh
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.sh | bash -s -- --purge
```
