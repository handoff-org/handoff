---
layout: doc
title: Commands
---

# Commands & keys

Type `/` at the prompt to open the autocomplete menu. `/help` shows the same list in-app.

## Projects & research

<dl class="hf-cmds">
<dt><code>/project</code></dt>
<dd>Open the project menu. Switch, create, or delete.</dd>

<dt><code>/project new &lt;name&gt;</code></dt>
<dd>Create a project and make it active in one step.</dd>

<dt><code>/research &lt;claim&gt;</code></dt>
<dd>Fact-check a claim (or survey a topic) against scholarly sources via OpenAlex. Returns a SUPPORTED / CONTESTED / REFUTED / UNCLEAR verdict with citations.</dd>

<dt><code>/note &lt;text&gt;</code></dt>
<dd>Jot a free-form note into the active project's lab notebook (<code>NOTEBOOK.md</code>).</dd>

<dt><code>/overleaf</code></dt>
<dd>Link the active project's <code>paper/</code> to an Overleaf project and sync both ways. Run again on a linked project to force a sync.</dd>

<dt><code>/zotero</code></dt>
<dd>Connect your Zotero library (Web API key and numeric user id). See <a href="integrations">Zotero &amp; OpenReview</a>.</dd>

<dt><code>/zotero-prep &lt;paper&gt;</code></dt>
<dd>Read a paper in your Zotero library and highlight its key sentences in the PDF, with a comment on each explaining why it matters.</dd>

<dt><code>/openreview</code></dt>
<dd>Fetch your OpenReview submissions and reviewer feedback and help draft responses. Read-only. Nothing is posted back.</dd>
</dl>

Beyond slash commands, handoff drives the literature through **tools** it calls for you: `search_papers` / `search_arxiv` to find work, `get_paper` / `fetch_arxiv` / `read_pdf` to read it, `read_arxiv_source` to read a paper's LaTeX source, and `cite_paper <id>` to add a paper to `paper/refs.bib`. It generates a stable BibTeX key, returns the `\cite{key}` for placement with `edit_file`, and is idempotent. Accepts an OpenAlex id (`W…`), an arXiv id (`2301.07041`), or a DOI. Requires an initialized paper. Note-taking tools (`take_note` / `read_notebook` / `search_notes`) and the writing linter (`check_writing`) round out the surface.

## Vision

On a model with vision (for example `gemma3:4b` or `gemma3:12b`), handoff can see images:

<dl class="hf-cmds">
<dt><code>view_image</code></dt>
<dd>Look at a local image or image URL (PNG/JPEG/GIF/WebP).</dd>

<dt><code>view_pdf_page</code></dt>
<dd>Render a PDF page to an image and view it. Captures figures, tables, and layout that flat text loses. PDF rendering uses PyMuPDF via <a href="https://docs.astral.sh/uv/">uv</a> (no poppler needed).</dd>
</dl>

`run_code` surfaces any figures it generates (`results/*.png`) so the agent can `view_image` them. On a non-vision model these tools return a note to switch models instead of an image.

## Experiments & reproducibility

`run_code` runs Python, R, Julia, or shell. Each Python experiment gets its own isolated [uv](https://docs.astral.sh/uv/) project under `experiments/<name>/` with a `pyproject.toml` and `uv.lock`. Every execution is captured as a **capsule** under `runs/<id>/` including the exact code, environment, git commit, hashes of output files, parsed metrics, stdout/stderr, and an auto-generated `repro.sh`. Record metrics by writing `results/metrics.json` or printing `METRIC name=value` lines.

<dl class="hf-cmds">
<dt><code>/reproduce &lt;run_id&gt;</code></dt>
<dd>Print the run's <code>repro.sh</code>, also saved at <code>runs/&lt;id&gt;/repro.sh</code>.</dd>

<dt><code>/rerun &lt;run_id&gt;</code></dt>
<dd>Re-execute a run's captured code as a new run, then show the metric diff vs the original.</dd>

<dt><code>/compare-runs &lt;a&gt; &lt;b&gt;</code></dt>
<dd>Diff two runs' metrics (with deltas), environment, and code.</dd>

<dt><code>/promote-run &lt;run_id&gt;</code></dt>
<dd>Mark a run canonical (recorded in <code>runs/promoted.json</code>).</dd>
</dl>

The `export_results` tool turns captured runs into paper-ready artifacts: a metrics table (LaTeX booktabs and markdown) plus `\includegraphics` figure blocks. It copies figure files from `results/` into `paper/figures/`, saves a copy under `results/tables/`, and returns the LaTeX to place in `main.tex`. Choose runs by id or with `promoted` / `all` / `latest`.

## Paper claims & handoff

See [Claims & handoff](claims-and-handoff) for the full workflow.

<dl class="hf-cmds">
<dt><code>/audit-paper</code></dt>
<dd>Scan <code>paper/</code> for unsupported claims, numbers, and comparisons.</dd>

<dt><code>/provenance</code></dt>
<dd>Check that paper numbers still match their linked runs. Flags mismatches as <code>outdated</code> when the paper value diverges from what the run reported. Run after <code>/rerun</code>. Also available to the model as the <code>check_provenance</code> tool.</dd>

<dt><code>/claims</code></dt>
<dd>Show all tracked claims with a status summary.</dd>

<dt><code>/unsupported</code></dt>
<dd>List claims with no linked evidence.</dd>

<dt><code>/claim-add &lt;text&gt;</code></dt>
<dd>Add a claim manually.</dd>

<dt><code>/claim-status &lt;id&gt;</code></dt>
<dd>Show full detail for one claim.</dd>

<dt><code>/claim-link-run &lt;id&gt; &lt;run_id&gt;</code></dt>
<dd>Link a run as evidence for a claim.</dd>

<dt><code>/claim-link-paper &lt;id&gt; &lt;citation_key&gt;</code></dt>
<dd>Link a citation as evidence for a claim.</dd>

<dt><code>/handoff [--for-me | --for-pi | --for-reviewer | --for-industry-partner]</code></dt>
<dd>Generate a transfer packet summarizing where the work stands. Defaults to <code>--for-me</code>.</dd>
</dl>

## Skills

<dl class="hf-cmds">
<dt><code>/skills</code></dt>
<dd>List your skills.</dd>

<dt><code>/skill &lt;name&gt;</code></dt>
<dd>Run one of your skills.</dd>

<dt><code>/compose-skill</code></dt>
<dd>Write a new skill in your <code>$EDITOR</code>.</dd>
</dl>

## Setup & session

<dl class="hf-cmds">
<dt><code>/model</code></dt>
<dd>Switch the active model. The picker is hardware-aware. Preset shortcuts: <code>/model cool</code>, <code>/model fast</code>, <code>/model balanced</code>, <code>/model deep</code>. Routing tier overrides (when model routing is on): <code>/model fast</code> or <code>/model think</code> force the next turn's tier. Diagnostics: <code>/model doctor</code> (CPU-spill warning) and <code>/model benchmark</code> (synthetic speed and tool-call test; flags: <code>--quick</code>, <code>--model &lt;id&gt;</code>).</dd>

<dt><code>/settings</code></dt>
<dd>Set the inference preset (cool / fast / balanced / deep), toggle personalization, change the color theme, toggle the banner mascot, set the performance mode, the context window (Ollama <code>num_ctx</code>), toggle flash attention and KV-cache type, or configure model routing (enable, fast/think model, routing-notes verbosity).</dd>

<dt><code>/profile</code></dt>
<dd>View or manage what handoff has learned about your preferences (local only). Subcommands: <code>show</code> (default), <code>enable</code>, <code>disable</code>, <code>forget &lt;key&gt;</code>, <code>why &lt;key&gt;</code>, <code>export</code>, <code>reset yes</code>.</dd>

<dt><code>/mode</code></dt>
<dd>Toggle hands-on (approve sensitive tools) or hands-off (auto). Also: <code>/mode hands-on</code>, <code>/mode hands-off</code>.</dd>

<dt><code>/resume</code></dt>
<dd>Restore the last session for the active project.</dd>

<dt><code>/clear</code></dt>
<dd>Reset the conversation.</dd>

<dt><code>/help</code></dt>
<dd>Show the command panel.</dd>

<dt><code>/quit</code></dt>
<dd>Exit handoff. <code>/exit</code> also works.</dd>
</dl>

## Keys

<dl class="hf-cmds">
<dt><code>Enter</code></dt>
<dd>Send your message.</dd>

<dt><code>Shift+Enter</code></dt>
<dd>Insert a newline for a multi-line prompt.</dd>

<dt><code>Esc</code></dt>
<dd>Interrupt the model mid-response.</dd>

<dt><code>↑ / ↓, PgUp / PgDn, mouse wheel</code></dt>
<dd>Scroll the transcript.</dd>

<dt><code>← / →</code></dt>
<dd>Move the caret.</dd>

<dt><code>Ctrl+A / Ctrl+E</code></dt>
<dd>Jump to start or end of the line.</dd>

<dt><code>Ctrl+U / Ctrl+K</code></dt>
<dd>Delete to start or end of the line.</dd>

<dt><code>Ctrl+W</code></dt>
<dd>Delete the previous word.</dd>

<dt><code>Ctrl+P / Ctrl+N</code></dt>
<dd>Recall previous or next submitted input.</dd>

<dt><code>Shift+Tab</code></dt>
<dd>Toggle hands-on or hands-off mode.</dd>

<dt><code>~ (on an empty prompt)</code></dt>
<dd>Toggle off-work mode: a plain general assistant with no project context. Press <code>~</code> again to return.</dd>

<dt><code>/</code></dt>
<dd>Open the slash-command autocomplete menu.</dd>
</dl>

## Launch flags

<dl class="hf-cmds">
<dt><code>--resume, -r</code></dt>
<dd>Restore your last session on launch.</dd>
</dl>
