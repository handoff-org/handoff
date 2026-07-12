---
title: Research workflow
nav_order: 3
---

# Research workflow

handoff organizes work into **projects** and supports the full research lifecycle:
read the literature, run experiments, report results, write the paper.

> ✅ available today · ⭐ on the roadmap

## Project workspace

```
~/.handoff/projects/<name>/
├── literature/    reading notes & cached papers   (private)
├── experiments/   one uv project per experiment   (private)
├── runs/          experiment ledger + capsules     (private)
├── results/       tables & figures                (private)
└── paper/         LaTeX draft + refs.bib          (syncs to Overleaf)
```

Only `paper/` ever leaves your machine (via Overleaf). Everything else is private.

## Pillar 1 — Read the literature

- ✅ **Fact-check** — `/research <claim>` queries OpenAlex and returns SUPPORTED /
  CONTESTED / REFUTED / UNCLEAR with citations.
- ✅ **Search & fetch** — `search_papers` / `get_paper` pull works live over HTTP
  (not bound by training cutoffs). `sort="date"` surfaces the newest work.
- ✅ **Latest preprints** — `search_arxiv` hits arXiv directly, indexed within a day of
  submission. Accepts plain phrases or arXiv syntax (`cat:cs.LG`, `au:Vaswani`).
- ✅ **Read PDFs** — `read_pdf` extracts text from a local file or URL
  (`brew install poppler` required). To read a paper's **LaTeX source** (equations and
  structure, not flattened text), `read_arxiv_source` fetches it straight from arXiv.
- ✅ **See figures** — on a multimodal model, `view_pdf_page` renders a PDF page to an
  image and `view_image` looks at any figure/plot (via PyMuPDF + [uv](https://docs.astral.sh/uv/);
  no poppler). See [Commands → Vision](commands.md#vision-multimodal-models).
- ✅ **Notes** — `/note <text>` and the `take_note` / `read_notebook` / `search_notes`
  tools keep a searchable lab notebook (`NOTEBOOK.md`) per project.
- ✅ **Reference manager** — link Zotero and let `/zotero-prep` read a paper and attach
  your commentary (notes + best-effort highlights). See [Zotero & OpenReview](integrations.md).
- ✅ **Cite** — `cite_paper <id>` adds a paper (OpenAlex `W…`, arXiv id, or DOI) to
  `paper/refs.bib` with a stable key and hands back the `\cite{key}` to drop in. Idempotent
  — citing the same paper twice never duplicates it — and it syncs to Overleaf with the paper.
- ⭐ Structured lit notes, citation-graph snowballing, lit-review synthesis.

## Pillar 2 — Run experiments

- ✅ **Isolated uv projects** — each Python experiment gets its own `uv init` → `uv add
  <deps>` → `uv run` project under `experiments/<name>/`, with a `pyproject.toml` +
  `uv.lock`. Missing imports are installed and the run retried automatically.
- ✅ **File tools** — `write_file`, `edit_file`, `make_dir`, `search_files`,
  `find_files`, `run_shell` let the model author and edit code without leaving the
  agent loop. See [Commands](commands.md) for the full list.
- ✅ **Reproducible capsules** — every run is saved to `runs/<id>/`: exact code, env
  snapshot, git diff, output hashes, parsed metrics, and a `repro.sh`. Record metrics
  via `results/metrics.json` or `METRIC name=value` stdout lines.
- ✅ **Run commands** — `/reproduce <id>`, `/rerun <id>`, `/compare-runs <a> <b>`,
  `/promote-run <id>`.
- ⭐ Metric/figure bindings (trace a number in the paper to the run that produced it).

## Pillar 3 — Report results

- ✅ **Export results** — `export_results` turns one or more runs' captured metrics into a
  paper-ready table (LaTeX booktabs + markdown), built straight from the capsule so numbers
  are never retyped. It also emits `\includegraphics` figure blocks and copies the figure
  files from `results/` into `paper/figures/` so they render on Overleaf, saves a durable
  copy under `results/tables/`, and hands back the LaTeX to drop into `main.tex` with
  `edit_file`. Pick runs by id, or `promoted` / `all` / `latest`.
- ✅ Ask handoff to summarize outputs, build LaTeX/markdown tables, save figures to
  `results/`.
- ⭐ Proper stats reporting (CIs, effect sizes), stale-number detection, terminal figure preview.

## Pillar 4 — Write the paper

- ✅ **Templates** — ask to start a paper and handoff offers Blank LaTeX, ACL, or
  NeurIPS (plus any template you add under `~/.handoff/templates/`). The whole folder
  is copied into `paper/` — `.sty`, `.bst`, bibliography — so it compiles out of the box.
- ✅ **Overleaf, two-way** — pulls before each turn, pushes after. A write guard keeps
  the paper a single compilable document. See [Overleaf sync](overleaf.md).
- ✅ **Frictionless edits** — `write_file` and `edit_file` both show a diff box; the
  model never pastes the full file back.
- ✅ **Writing hygiene** — `check_writing` flags weasel words, passive voice, dangling
  `\ref`s, and `\cite` keys missing from `refs.bib`; `scaffold_sections` drops in a
  standard section skeleton.
- ✅ **Citation insertion** — `cite_paper` pulls a cite key + BibTeX entry straight from
  the literature into `paper/refs.bib`; you then place the `\cite{key}` with `edit_file`.
- ⭐ Section co-writing, compile/fix loop.

## Address reviews

- ✅ **OpenReview** — `/openreview` fetches your submissions and their reviews, comments,
  meta-reviews, and decisions, summarizes each reviewer's points, and — on request — helps
  draft point-by-point responses grounded in your paper. Read-only; nothing is posted back.
  See [Zotero & OpenReview](integrations.md#openreview).

## Claims & transfer packets

- ✅ `/audit-paper` catalogs numeric and comparison claims; `/unsupported` shows what
  still needs evidence; `/claim-link-run` and `/claim-link-paper` attach it.
- ✅ **Provenance / stale-number check** — `/provenance` (and the `check_provenance` tool)
  verifies every run-linked claim: it compares the number written in the paper against the
  linked run's current captured metric and flags any mismatch as `outdated`
  ("paper says 0.92; run r3 now reports accuracy=0.89"). Re-run an experiment (`/rerun`),
  then `/provenance` to catch numbers the paper left behind; fixing the number clears it.
- ✅ `/handoff` generates a transfer packet for your future self, a PI, a reviewer, or
  an industry partner.
- See [Claims & handoff](claims-and-handoff.md).
- ⭐ Auto-linking an unlinked number to its run; comparison-claim verification.

## Privacy

Models run locally. The only outbound traffic: literature lookups you trigger, Overleaf
sync for `paper/`, the Zotero / OpenReview connectors you link, and — only if you
explicitly opt in — a cloud model via HuggingFace.
