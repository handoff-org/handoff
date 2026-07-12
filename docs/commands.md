---
title: Commands
nav_order: 4
---

# Commands & keys

Everything you can type or press in handoff. Type `/` at the prompt to get an
autocomplete menu of the slash commands; `/help` shows the same list in-app.

## Projects & research

| Command | What it does |
|---------|--------------|
| `/project` | Open the project menu — switch, create, or delete. |
| `/project new <name>` | Create a project and make it active in one step. |
| `/research <claim>` | Fact-check a claim (or survey a topic) against scholarly sources via OpenAlex. Returns a SUPPORTED / CONTESTED / REFUTED / UNCLEAR verdict with citations. |
| `/note <text>` | Jot a free-form note into the active project's lab notebook (`NOTEBOOK.md`). |
| `/overleaf` | Link the active project's `paper/` to an Overleaf project and sync both ways. Run again on a linked project to force a sync. |
| `/zotero` | Connect your Zotero library (Web API key + numeric user id). See [Zotero & OpenReview](integrations.md). |
| `/zotero-prep <paper>` | Read a paper in your Zotero library and highlight its key sentences in the PDF, with a comment on each explaining why it matters. |
| `/openreview` | Fetch your OpenReview submissions and reviewer feedback, and help draft responses. Read-only — nothing is posted back. |

Beyond the slash commands, handoff drives the literature through **tools** it calls for you:
`search_papers` / `search_arxiv` to find work, `get_paper` / `fetch_arxiv` / `read_pdf` to read
it, `read_arxiv_source` to read a paper's LaTeX source (equations and structure, not flattened
text), and `cite_paper <id>` to add a paper to `paper/refs.bib` — it generates a stable BibTeX key,
returns the `\cite{key}` to place with `edit_file`, and is idempotent (citing the same paper
twice never duplicates the entry). Accepts an OpenAlex id (`W…`), an arXiv id (`2301.07041`), or a
DOI. Requires an initialized paper (ask handoff to start one first). Note-taking tools
(`take_note` / `read_notebook` / `search_notes`) and the writing linter (`check_writing`) round
out the reading/writing surface.

## Vision (multimodal models)

On a model with vision (e.g. `gemma3:4b` / `gemma3:12b` — pull one, then `/model`), handoff can
**see** images, not just read text:

| Tool | What it does |
|------|--------------|
| `view_image` | Look at a local image or an image URL (PNG/JPEG/GIF/WebP). |
| `view_pdf_page` | Render a PDF page to an image and view it — figures, tables, layout that flat text loses. |

`run_code` also surfaces any figures it generates (`results/*.png`) so the agent can `view_image`
them. On a non-vision model these tools return a "switch to a vision model" note instead of an
image. PDF rendering uses PyMuPDF via [uv](https://docs.astral.sh/uv/) (no `poppler` needed).

## Experiments & reproducibility

`run_code` runs Python/R/Julia/shell. Each Python experiment gets its own isolated
[uv](https://docs.astral.sh/uv/) project under `experiments/<name>/` (`uv init` →
`uv add <deps>` → `uv run`), so it's a self-contained, GitHub-pushable project with a
`pyproject.toml` + `uv.lock`. Every `run_code` execution is captured as a **capsule**
under `runs/<id>/` — the exact code
(`run.<ext>`), the environment (allowlisted vars), git commit + uncommitted diff (when the code is in a
repo), hashes of the files it wrote under `results/`, parsed metrics, full `stdout.txt`/`stderr.txt`, and
an auto-generated `repro.sh` (which uses `uv run` for uv experiments). Record metrics by writing
`results/metrics.json` (a flat `{name: number}`
object) or printing `METRIC name=value` lines — they're parsed into the capsule and shown in comparisons.

| Command | What it does |
|---------|--------------|
| `/reproduce <run_id>` | Print the run's `repro.sh` (also saved at `runs/<id>/repro.sh`) — the script that re-creates it. |
| `/rerun <run_id>` | Re-execute a run's captured code as a new run, then show the metric diff vs the original. |
| `/compare-runs <a> <b>` | Diff two runs' metrics (with deltas), environment, and code. |
| `/promote-run <run_id>` | Mark a run canonical (recorded in `runs/promoted.json`). |

The **`export_results`** tool turns captured runs into paper-ready artifacts: a metrics table
(LaTeX booktabs + markdown) built from the capsule — never retyped — plus `\includegraphics`
figure blocks. It copies the figure files from the private `results/` dir into
`paper/figures/` so they render on Overleaf, saves a copy under `results/tables/`, and returns
the LaTeX to place in `main.tex` with `edit_file`. Choose runs by id or with
`promoted` / `all` / `latest` (default: promoted runs, else the latest).

## Paper claims & handoff

See [Claims & handoff](claims-and-handoff.md) for the full workflow.

| Command | What it does |
|---------|--------------|
| `/audit-paper` | Scan `paper/` for unsupported claims, numbers, and comparisons. |
| `/provenance` | Check that paper numbers still match their linked runs; flags mismatches as `outdated` (paper 0.92 → run reports 0.89). Run after `/rerun`. Also available to the model as the `check_provenance` tool. |
| `/claims` | Show all tracked claims with a status summary. |
| `/unsupported` | List claims with no linked evidence. |
| `/claim-add <text>` | Add a claim manually. |
| `/claim-status <id>` | Show full detail for one claim. |
| `/claim-link-run <id> <run_id>` | Link a run as evidence for a claim. |
| `/claim-link-paper <id> <citation_key>` | Link a citation as evidence for a claim. |
| `/handoff [--for-me \| --for-pi \| --for-reviewer \| --for-industry-partner]` | Generate a transfer packet summarizing where the work stands. Defaults to `--for-me`. |

## Skills

| Command | What it does |
|---------|--------------|
| `/skills` | List your skills. |
| `/skill <name>` | Run one of your skills. |
| `/compose-skill` | Write a new skill in your `$EDITOR`. |

## Setup & session

| Command | What it does |
|---------|--------------|
| `/model` | Switch the active model. The picker is hardware-aware — see [Choosing a model](models.md). Preset shortcuts: `/model cool\|fast\|balanced\|deep` (bundles context + output + keep-alive + prompt budget). Routing tier overrides (when [model routing](configuration.md#model-routing) is on): `/model fast` / `/model think` force the next turn's tier. Diagnostics: `/model doctor` (CPU-spill warning) and `/model benchmark` (synthetic speed + tool-call test; `--quick`, `--model <id>`). |
| `/settings` | Set the **inference preset** (cool / fast / balanced / deep), toggle **personalization**, change the color theme, toggle the banner mascot, set the **performance mode**, the **context window** (Ollama `num_ctx`), toggle **flash attention** / **KV-cache** type, or configure **model routing** (enable, fast/think model, routing-notes verbosity). |
| `/profile` | View or manage what handoff has learned about your preferences (local only). `show` (default), `enable` / `disable`, `forget <key>`, `why <key>`, `export`, `reset` → `reset yes`. See [Personalization](configuration.md#personalization). |
| `/mode` | Toggle hands-on (approve sensitive tools) / hands-off (auto). Also `/mode hands-on`, `/mode hands-off`. |
| `/resume` | Restore the last session for the active project. |
| `/clear` | Reset the conversation. |
| `/help` | Show the command panel. |
| `/quit` | Exit handoff (`/exit` also works). |

## Keys

| Key | Action |
|-----|--------|
| `Enter` | Send your message. |
| `Shift+Enter` | Insert a newline (multi-line prompt). |
| `Esc` | Interrupt the model mid-response. |
| `↑` / `↓`, `PgUp` / `PgDn`, mouse wheel | Scroll the transcript. |
| `←` / `→` | Move the caret. |
| `Ctrl+A` / `Ctrl+E` | Jump to start / end of the line. |
| `Ctrl+U` / `Ctrl+K` | Delete to start / end of the line. |
| `Ctrl+W` | Delete the previous word. |
| `Ctrl+P` / `Ctrl+N` | Recall previous / next submitted input (input history). |
| `Shift+Tab` | Toggle hands-on / hands-off mode. |
| `~` (on an empty prompt) | Toggle **off-work mode** — a plain general assistant with no project or Overleaf context. Press `~` again to go back on the books. |
| `/` | Open the slash-command autocomplete menu. |

> **Off-work mode** replaces the old `/general` command: just press `~` when the input
> box is empty. The status line shows `general` while it's on.

## Launch flags

| Flag | Effect |
|------|--------|
| `--resume`, `-r` | Restore your last session on launch. |
