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
  (`brew install poppler` required).
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

- ✅ Ask handoff to summarize outputs, build LaTeX/markdown tables, save figures to
  `results/`.
- ⭐ Structured results artifact, proper stats reporting, stale-number detection.

## Pillar 4 — Write the paper

- ✅ **Templates** — ask to start a paper and handoff offers Blank LaTeX, ACL, or
  NeurIPS (plus any template you add under `~/.handoff/templates/`). The whole folder
  is copied into `paper/` — `.sty`, `.bst`, bibliography — so it compiles out of the box.
- ✅ **Overleaf, two-way** — pulls before each turn, pushes after. A write guard keeps
  the paper a single compilable document. See [Overleaf sync](overleaf.md).
- ✅ **Frictionless edits** — `write_file` and `edit_file` both show a diff box; the
  model never pastes the full file back.
- ✅ **Citation insertion** — `cite_paper` pulls a cite key + BibTeX entry straight from
  the literature into `paper/refs.bib`; you then place the `\cite{key}` with `edit_file`.
- ⭐ Section co-writing, compile/fix loop.

## Claims & transfer packets

- ✅ `/audit-paper` catalogs numeric and comparison claims; `/unsupported` shows what
  still needs evidence; `/claim-link-run` and `/claim-link-paper` attach it.
- ✅ `/handoff` generates a transfer packet for your future self, a PI, a reviewer, or
  an industry partner.
- See [Claims & handoff](claims-and-handoff.md).
- ⭐ Metric/figure provenance, stale-number detection.

## Privacy

Models run locally. The only outbound traffic: literature lookups you trigger, Overleaf
sync for `paper/`, and — only if you explicitly opt in — a cloud model via HuggingFace.
