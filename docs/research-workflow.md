---
title: Research workflow
nav_order: 3
---

# Research workflow

handoff is built around the research lifecycle, not just chat. It organizes work into
**projects** and supports four pillars: read the literature, run experiments, report
results, and write the paper — all locally, so nothing leaves your machine unless you
explicitly opt a step up to a cloud model.

> Legend: ✅ available today · ⭐ on the near-term roadmap. Upcoming work is tracked on
> the [GitHub issues](https://github.com/handoff-org/handoff/issues).

## The project workspace

Everything hangs off a project created with `/project new <name>`:

```
~/.handoff/projects/<name>/
├── literature/   # notes and cached papers          (private)
├── experiments/  # one uv project per experiment       (private)
├── runs/         # experiment ledger + run capsules   (private)
├── results/      # tables + figures                 (private)
└── paper/        # the LaTeX draft + refs.bib — syncs to Overleaf
```

The **active project** scopes the agent: relative write paths resolve to its root, the
system prompt tells the model where each kind of file belongs, and sessions are saved
per project. Switch, create, or delete projects from the `/project` menu.

Only `paper/` is mirrored to Overleaf. `literature/`, `experiments/`, `runs/`, and
`results/` are your private workspace and never leave the machine.

## Pillar 1 — Read the literature

- ✅ **Fact-check a claim** — `/research <claim>` searches scholarly sources via
  OpenAlex and returns a verdict (SUPPORTED / CONTESTED / REFUTED / UNCLEAR) with
  citations.
- ✅ **Search & fetch** — the `search_papers` / `get_paper` tools let the model pull
  works into the conversation; results are cached under `~/.handoff/research/papers/`.
  Both query their sources **live over HTTP**, so retrieval isn't bound by any model
  training cutoff. `search_papers` takes `sort="date"` to surface the newest work
  (guarded against OpenAlex's future-dated junk records), not just the most cited.
- ✅ **Latest preprints** — `search_arxiv` searches arXiv directly, newest-first, for the
  freshest CS/ML/physics/math work — indexed within a day of submission, often weeks
  before OpenAlex ingests it. Accepts plain phrases or raw arXiv syntax (`cat:cs.LG`,
  `au:Vaswani`, `ti:transformer`, boolean groups); `fetch_arxiv` then pulls full
  metadata and LaTeX-source links for any id.
- ✅ **Read PDFs** — `read_pdf` extracts text from a local PDF file or a direct URL
  (requires `pdftotext` from poppler: `brew install poppler`). Useful for reading
  papers you've downloaded or fetching from a publisher link.
- ✅ **Build a bibliography** — ask it to add the papers it found to your `.bib`. The
  bibliography always lives at `paper/refs.bib`, next to `main.tex`, so it compiles and
  (when Overleaf-linked) syncs online.
- ⭐ Structured literature notes, citation-graph snowballing, and lit-review synthesis
  are on the roadmap.

## Pillar 2 — Prepare & run experiments

- ✅ **Author and run scripts** — a full set of file tools lets the model create, edit,
  and search code in `experiments/` without leaving the agent loop:
  - `write_file` — create or overwrite a file (or append with `append="true"`).
  - `edit_file` — surgical `old_string → new_string` replacement, without rewriting the
    whole file. Preferred for changing part of a large script; shows a compact diff.
  - `make_dir` — create directories.
  - `search_files` — regex search over file contents (`path:line: text`), with an
    optional glob filter (`"**/*.py"`). Far cheaper than reading whole files.
  - `find_files` — glob over file paths (`"results/*.png"`, `"**/*.py"`). Replaces
    repeated `list_dir` calls when you're looking for a file by pattern.
  - `run_shell` — run any shell command and capture its output.
  - In-project writes and directory creation are auto-approved in both modes.
- ✅ **First-class language runners** — `run_code` executes Python / R / Julia / shell with
  captured stdout/stderr/exit codes. Each Python experiment gets its own isolated
  [uv](https://docs.astral.sh/uv/) project under `experiments/<name>/`: handoff runs
  `uv init <name>` → `uv add <deps>` (the packages it declared up front) → `uv run`, so
  every experiment is a self-contained, GitHub-pushable project with its own
  `pyproject.toml` + `uv.lock`. If an import is still missing it's installed and the run
  retried — it never silently falls back to a bare shell. (Without uv installed, it falls
  back to a plain per-project `venv`.)
- ✅ **Experiment ledger** — every run is logged to `runs/ledger.jsonl` (id, language, exit
  code, duration, metrics); `query_runs` lists recent runs.
- ✅ **Reproducible capsules** — each run is captured under `runs/<id>/`: the exact code
  (`run.<ext>`), the environment, git commit + uncommitted diff (when the code lives in a
  repo), hashes of the files it produced under `results/`, parsed metrics, full output, and a
  generated `repro.sh`. Record metrics by writing `results/metrics.json` (`{name: number}`) or
  printing `METRIC name=value` lines. Then:
  - `/reproduce <id>` — print the `repro.sh` that re-creates a run.
  - `/rerun <id>` — re-run captured code and see the metric delta.
  - `/compare-runs <a> <b>` — diff two runs' metrics, env, and code.
  - `/promote-run <id>` — mark a run canonical.
- ⭐ Metric/figure **bindings** (numbers in the paper traced to the run that produced them)
  and a project-level reproducibility manifest are the next build.

## Pillar 3 — Report results clearly

- ✅ Ask handoff to summarize outputs, build markdown/LaTeX tables, and save figures
  into `results/`.
- ⭐ A structured **results artifact** (metrics + tables + figures + captions produced
  from a run rather than retyped), run-to-run comparison, and proper stats reporting
  are planned.

## Pillar 4 — Write the paper

- ✅ **Start from a template** — ask handoff to start a paper and it offers **Blank
  LaTeX**, **ACL**, or **NeurIPS** (plus any template you add under
  `~/.handoff/templates/`), then copies the whole template folder into `paper/` —
  `main.tex`, the venue's `.sty`/`.bst`, and a starter bibliography — so it compiles as-is
  (it won't overwrite an existing `main.tex`).
- ✅ **Overleaf, two-way** — `/overleaf` links an existing Overleaf project into
  `paper/`. handoff edits the single main `.tex` in place, **pulls web edits before
  each turn and pushes your changes after**, so you can move between Overleaf and the
  agent seamlessly. A write guard keeps the paper a single compilable document and
  keeps the bibliography inside `paper/`. See [overleaf.md](overleaf.md).
- ✅ **Frictionless editing** — every write (whether `write_file` or `edit_file`) shows
  a compact diff box; the model never pastes the full file back or asks "shall I write this?".
- ⭐ Section co-writing, citation insertion straight from the literature cache, and a
  compile/fix loop are on the roadmap.

## Keep it honest — claims & handoff

- ✅ **Claim ledger** — `/audit-paper` scans `paper/` and catalogs every numeric,
  comparison, and literature claim; `/claims` and `/unsupported` show what still needs
  backing; `/claim-link-run` / `/claim-link-paper` attach evidence.
- ✅ **Transfer packets** — `/handoff` rolls the current state into a summary for your
  future self, a PI, a reviewer, or an industry partner.
- See [Claims & handoff](claims-and-handoff.md) for the full workflow.
- ⭐ Metric/figure provenance (trace a number in the paper back to the run that produced
  it) and stale-number detection are the next major build.

## How handoff stays out of your way

- **Edits apply, then summarize.** A file write produces a one-line summary plus a
  diff box — not a wall of pasted text. This is deliberate: previews waste tokens and
  your attention.
- **It asks instead of guessing.** When a decision is needed, the model calls
  `ask_user` and you pick from on-screen options (or type your own).
- **Hands-on vs hands-off.** In `permissions` mode handoff asks before sensitive tools
  (shell, pushing to Overleaf); in `auto` mode it runs freely. In-project file writes
  are auto-approved either way. Toggle with `/mode`.

## Privacy model

Local-first is the whole point. Models run through Ollama on your machine; project
files stay under `~/.handoff/`. The only outbound traffic is: literature lookups you
trigger with `/research`, Overleaf sync for `paper/`, and — only if you explicitly opt
in — a cloud model via the HuggingFace backend. handoff never sends your data to the
cloud silently.
