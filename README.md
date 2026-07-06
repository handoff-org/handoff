# handoff

**Own your research.** A local-first, [Claude Code](https://claude.com/claude-code)-style
research companion that lives in your terminal — it reads the literature, drafts and
cites your paper, and helps run your experiments, all powered by models running on
*your* machine through [Ollama](https://ollama.com), Llama.cpp, MLX, vLLM, or Hugging Face. Unpublished ideas, data, and drafts never leave your computer. **Privacy is the product, not a footnote.**


- 🔒 **Private by default** — runs against local models (Ollama, llama.cpp, MLX, or self-hosted vLLM); your work never leaves the machine. Cloud is only ever used after handoff asks you first.
- 🔬 **Reads the literature** — fact-check a claim or survey a topic against scholarly sources, queried live: OpenAlex (`/research`, `search_papers` with newest-first `sort=date`) plus `search_arxiv` for the freshest preprints, indexed within a day of submission.
- 🧪 **Runs experiments reproducibly** — `run_code` executes Python/R/Julia/shell, giving each Python experiment its own isolated **uv project** under `experiments/<name>/` (`uv init` → `uv add` → `uv run`, GitHub-ready with `pyproject.toml` + `uv.lock`), and captures each run as a **capsule** in `runs/<id>/`: exact code, environment, git state, output hashes, metrics, and a generated `repro.sh`. `/reproduce`, `/rerun`, `/compare-runs`, and `/promote-run` make results reproducible and comparable.
- 📁 **Research workspaces** — `/project` scaffolds a tidy `literature / experiments / runs / results / paper` layout and keeps everything scoped to the study you're working on.
- 📄 **Starts from a template** — ask it to start a paper and it offers Blank LaTeX, ACL, or NeurIPS (or your own, added under `~/.handoff/templates/`), copying the whole template folder — `main.tex`, the venue's `.sty`/`.bst`, and a starter bib — into `paper/`.
- 📝 **Overleaf, two-way** — `/overleaf` links your paper; handoff edits the real `.tex`, **auto-pulls web edits before each turn and auto-syncs your changes after** — go from Overleaf to the agent and back seamlessly.
- ✅ **Keeps you honest** — a claim ledger, `/audit-paper`, and `/handoff` transfer packets trace every number to its evidence and make handing work off painless.
- 🟩 **Frictionless edits** — file writes apply straight away and show a compact GitHub-style **diff box** (green additions, red deletions). No "shall I write this?", no walls of pasted text.
- 🙋 **Asks, doesn't guess** — when the model needs a decision it pops up selectable choices (`ask_user`) with an "type my own" escape hatch.
- 🧩 **Skills** — capture a reusable workflow in your editor with `/compose-skill`, run it with `/skill`.
- 🎨 **Polished TUI** — themed, scrollable transcript with syntax highlighting and a clean masthead.

---

## Install

The installer below is the recommended path — it sets up **everything** in one
command: the local model backends (Ollama, plus mlx-lm / llama.cpp where
supported), [uv](https://docs.astral.sh/uv/) for the Python experiment runner,
and the `handoff` CLI itself. No other steps.

### Linux & macOS

```sh
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/install.ps1 | iex
```

### Package only, with npm

If you just want the CLI and will install the model backends yourself:

```sh
npm install -g ownhandoff
```

This installs **only** the `handoff` command — **not** Ollama or any other
backend. (npm also blocks package install-scripts by default, so it can't set
up backends for you even if we wanted it to. Use the installer above for a
one-shot setup.) The npm package is named **`ownhandoff`**; the command it
installs is **`handoff`**. Then start it with `handoff`.

---

## Requirements

- **Node.js 18+** — the installer checks for this and points you to <https://nodejs.org> if it's missing.
- **[Ollama](https://ollama.com/download)** — the default local backend. After installing it, pull a model:

  ```sh
  ollama pull qwen3:8b
  ```

  On first run, handoff's setup wizard offers to pull a model for you if none is present. handoff bootstraps what it can automatically — and always tells you what it set up.
- **[uv](https://docs.astral.sh/uv/)** *(recommended, installed by the installer)* — powers the Python experiment runner: each experiment becomes an isolated, reproducible uv project. Without it, `run_code` falls back to a plain per-project `venv`.

> Ollama is the default so everything stays local. handoff also supports **llama.cpp**
> and **MLX** (local), self-hosted **vLLM**, and a cloud **HuggingFace** backend (needs
> an API token) — pick yours in the setup wizard or with `/model`. See
> [`docs/configuration.md`](docs/configuration.md#backends).

---

## Quickstart

```sh
handoff
```

The first launch walks you through a short setup wizard (backend → model → quantization), then drops you into the chat. A typical research session:

1. **Start a study.** `/project new Memory and Attention` scaffolds the workspace and makes it active.
2. **Link your paper (optional).** `/overleaf` opens a form — paste your Overleaf project link and a Git token. handoff clones it into `paper/` and from then on syncs both ways automatically.
3. **Work in plain language.** Ask handoff to:
   - *"Find recent work on retrieval-augmented attention and add the three most-cited to my bibliography."* → it searches the literature and writes the `.bib` **inside `paper/`** so Overleaf sees it.
   - *"Start the paper."* → it asks which template (Blank LaTeX / ACL / NeurIPS, or one you added under `~/.handoff/templates/`), then copies that whole template folder — `main.tex`, the venue's styles, and a starter bib — into `paper/`.
   - *"Draft a related-work paragraph and cite those."* → it edits your main `.tex` in place; you see a diff box, not a wall of LaTeX.
   - *"Write a script in `experiments/` to plot the results."* → it creates the file in your project, no permission prompts for in-project writes.
4. **Check a claim.** `/research transformers need positional encodings` returns a SUPPORTED / CONTESTED / REFUTED verdict with citations.
5. **Keep it honest.** `/audit-paper` catalogs every number and comparison in the paper; `/handoff` turns the current state into a shareable summary.

Scroll the transcript with the **arrow keys** or the **mouse wheel**; **Esc** interrupts the model mid-response; press **`~`** on an empty prompt to toggle off-work mode. Text selection / copy-paste work as usual.

---

## Commands

| Command | Description |
|---------|-------------|
| `/project` | open the project menu — switch, create, or delete (or `/project new <name>`) |
| `/research <claim>` | fact-check a claim or survey a topic against the scholarly literature |
| `/overleaf` | connect & sync your paper with Overleaf |
| `/audit-paper` | scan `paper/` for unsupported claims, numbers, and comparisons |
| `/claims`, `/unsupported` | review tracked claims and their evidence status |
| `/claim-add`, `/claim-status`, `/claim-link-run`, `/claim-link-paper` | manage claims and attach evidence |
| `/handoff [--for-me\|--for-pi\|--for-reviewer\|--for-industry-partner]` | generate a transfer packet summarizing where the work stands |
| `/compose-skill` | write a new skill in your `$EDITOR` |
| `/skill <name>` | run one of your skills |
| `/skills` | list your skills |
| `/model` | switch the active model; presets `/model cool·fast·balanced·deep`; diagnostics `/model doctor·benchmark` |
| `/settings` | set the inference preset, toggle personalization, change the theme, toggle the mascot, set the context window, or toggle flash attention / KV-cache |
| `/profile` | view or manage what handoff has learned about you (local, editable): `show`, `enable`/`disable`, `forget <key>`, `export`, `reset` |
| `/mode` | toggle hands-on (approve sensitive tools) / hands-off (auto) |
| `/resume` | restore the last session |
| `/clear` | reset the conversation |
| `/help` | show the command panel |
| `/quit` | exit handoff (`/exit` too) |

Press **`~`** on an empty prompt to toggle **off-work mode** (a general assistant with no
project/Overleaf context). Full reference: [`docs/commands.md`](docs/commands.md).

### Flags

| Flag | Effect |
|------|--------|
| `--resume`, `-r` | restore your last session on launch |

---

## Configuration

handoff reads `~/.handoff/config.json` (written by the setup wizard) and a few
environment variables. Env vars override the file for a single run:

| Variable | Meaning |
|----------|---------|
| `HANDOFF_BACKEND` | `ollama` (default), `llama_cpp`, `mlx`, `vllm`, or `hf` |
| `HANDOFF_MODEL` | model id, e.g. `qwen3:8b` |
| `HANDOFF_OLLAMA_NUM_CTX` | Ollama context window (`num_ctx`); also set in `/settings` |
| `HANDOFF_OLLAMA_KEEP_ALIVE` | how long Ollama keeps the model loaded (e.g. `30m`, `-1` to pin) |
| `HANDOFF_THEME` | `synthwave` (default), `aurora`, `sunset`, `matrix`, `ocean`, `mono`, `dracula`, `nord`, `gruvbox`, `rosepine`, `solarized`, `forest`, `coffee` |
| `HANDOFF_MODE` | `permissions` (hands-on) or `auto` (hands-off) |
| `HANDOFF_MAX_TOKENS` | cap on generated tokens |
| `HANDOFF_NO_ANIM` | set to disable the animated banner mascot for this run |
| `HANDOFF_REDUCED_MOTION` | set to hold the mascot still (respects reduced-motion) |
| `NO_COLOR` | render monochrome (the mascot still animates) |
| `HF_TOKEN` | HuggingFace API token (only for the `hf` backend) |

The Ollama endpoint (`ollamaBaseUrl`, default `http://localhost:11434`) is set in
`config.json`. handoff talks to Ollama over its native `/api/chat` endpoint so it can
keep the model loaded between turns and control the context window — see
[`docs/configuration.md`](docs/configuration.md#speeding-up-local-inference-ollama) for
the full reference and tips on faster local inference.

---

## Where things live

handoff keeps everything under `~/.handoff/`:

```
~/.handoff/
├── config.json              # backend, model, theme, mode
├── skills/                  # your custom skills (markdown + frontmatter)
├── research/papers/         # cached papers from /research
└── projects/<name>/         # one research workspace per study
    ├── literature/          #   notes + cached papers               (private)
    ├── experiments/         #   one uv project per experiment        (private)
    ├── runs/                #   experiment ledger + run capsules    (private)
    ├── results/             #   tables + figures                    (private)
    ├── claims/              #   claim ledger (claims.jsonl)         (private)
    └── paper/               #   main.tex + refs.bib — the ONLY folder that syncs to Overleaf
```

Only `paper/` is mirrored to Overleaf — your LaTeX draft **and** its `refs.bib` live
there together so citations sync online; everything else stays local and private.
Ollama stores its models separately (commonly `/usr/share/ollama/.ollama/models`
on a Linux systemd install, or `~/.ollama/models` for a manual `ollama serve`).

---

## Documentation

📖 **Full docs site:** <https://iparramartin.github.io/handoff/> (built from [`docs/`](docs/))

- [Getting started](docs/getting-started.md) — install, setup wizard, first session
- [Research workflow](docs/research-workflow.md) — the four pillars in practice
- [Commands](docs/commands.md) — every slash command and key binding
- [Claims & handoff](docs/claims-and-handoff.md) — the claim ledger, `/audit-paper`, transfer packets
- [Overleaf sync](docs/overleaf.md) — linking, tokens, two-way sync, troubleshooting
- [Configuration](docs/configuration.md) — config file, env vars, backends, faster local inference
- [Skills](docs/skills.md) — authoring and running reusable workflows
- [Architecture](docs/architecture.md) — for contributors

---

## Development

```sh
git clone https://github.com/handoff-org/handoff.git
cd handoff
npm install
npm run dev            # runs the TUI from source via tsx
npm run typecheck      # tsc --noEmit
npm test               # node:test suite (logic + render checks)
```

There's no build step — `handoff` runs the TypeScript source directly through
[tsx](https://github.com/privatenumber/tsx). See
[`docs/architecture.md`](docs/architecture.md) for a contributor's tour.

---

## Uninstall

### Linux & macOS

```sh
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.sh | bash
```

Add `--purge` to also delete your config, skills, projects, and cache (`~/.handoff/`):

```sh
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.sh | bash -s -- --purge
```

### Windows (PowerShell)

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/handoff-org/handoff/main/installers/uninstall.ps1))) -Purge
```

### Any OS, with npm

```sh
npm uninstall -g ownhandoff
rm -rf ~/.handoff      # optional: remove your config, skills, projects, and cache
```

---

## License

[MIT](./LICENSE) © 2026 Inigo Parra
