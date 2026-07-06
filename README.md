# handoff

**Own your research.** A local-first research companion that lives in your terminal. It reads the literature, drafts and cites your paper, and helps run your experiments, all powered by models running on *your* machine through Ollama, Llama.cpp, MLX, vLLM, or Hugging Face. Unpublished ideas, data, and drafts never leave your computer.

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
TBD
```

### Windows (PowerShell)

```powershell
TBD
```

### Package only, with npm

If you just want the CLI and will install the model backends yourself:

```sh
TBD
```

This installs **only** the `handoff` command — **not** Ollama or any other backend. (npm also blocks package install-scripts by default, so it can't set up backends for you even if we wanted it to. Use the installer above for a one-shot setup.) The npm package is named **`ownhandoff`**; the command it installs is **`handoff`**. Then start it with `handoff`.

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
    ├── experiments/         #   one uv project per experiment       (private)
    ├── runs/                #   experiment ledger + run capsules    (private)
    ├── results/             #   tables + figures                    (private)
    ├── claims/              #   claim ledger (claims.jsonl)         (private)
    └── paper/               #   main.tex + refs.bib — the ONLY folder that syncs to Overleaf
```

Only `paper/` is mirrored to Overleaf — your LaTeX draft **and** its `refs.bib` live there together so citations sync online; everything else stays local and private. Ollama stores its models separately (commonly `/usr/share/ollama/.ollama/models` on a Linux systemd install, or `~/.ollama/models` for a manual `ollama serve`).

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

See [`docs/architecture.md`](docs/architecture.md) for a contributor's tour.

---

## Uninstall

### Linux & macOS

```sh
TBD
```

Add `--purge` to also delete your config, skills, projects, and cache (`~/.handoff/`):

```sh
TBD
```

### Windows (PowerShell)

```powershell
TBD
```

### Any OS, with npm

```sh
TBD
```

---

## License

[MIT](./LICENSE) 2026 Inigo Parra
