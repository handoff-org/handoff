---
layout: doc
title: Troubleshooting
---

# Troubleshooting

Fixes for the snags you're most likely to hit. Each entry lists the **symptom**, the
**likely cause**, and the **fix**. For model speed and heat specifically, see also
[Choosing a model](models.md).

## Ollama isn't running

- **Symptom:** on launch, handoff shows a reminder that it can't reach the backend, or a
  turn fails with a connection error.
- **Cause:** the Ollama server isn't up, or it's on a different URL than handoff expects.
- **Fix:** start it — open the Ollama app, or run `ollama serve`. handoff probes the
  endpoint on startup and prints the exact start command when it's unreachable. If your
  server runs elsewhere, set `ollamaBaseUrl` (or `HANDOFF_OLLAMA_NUM_CTX` and friends) in
  [Configuration](configuration.md).

## Model not found

- **Symptom:** *"Model '…' is not installed in Ollama."*
- **Cause:** the model tag hasn't been pulled.
- **Fix:** pull it, then retry:

  ```bash
  ollama pull qwen3:8b
  ```

## Responses are slow

- **Symptom:** turns take a long time, or handoff prints *"CPU spill — try a smaller model
  or lower context."*
- **Cause:** the model has spilled off the GPU onto the CPU — usually the model or context
  window is too large for your machine's memory.
- **Fix:** run `/model doctor` — if the PROCESSOR column isn't `100% GPU`, switch to a
  smaller model, a lower quantization, or a smaller context window. `/model benchmark`
  measures tokens/sec on your machine. See [Choosing a model](models.md).

## The MacBook gets hot

- **Symptom:** fans spin up during long sessions.
- **Cause:** a large model or high context window is working the GPU hard.
- **Fix:** use the **Cool & fast** performance mode (the default) and a `cool` or `fast`
  inference preset in `/settings`. Prefer a 4B–8B model at Q4_K_M. `Max quality` is opt-in
  and shows heat warnings for a reason.

## The model "thinks" but never answers

- **Symptom:** a reasoning model (Qwen3, DeepSeek-R1) returns an empty or truncated reply.
- **Cause:** the whole output budget was spent inside its hidden `<think>` block.
- **Fix:** handoff automatically retries once with thinking disabled. If it still fails,
  switch preset with `/model deep` (more output) or `/model long_context` (more window), or
  use a non-reasoning model.

## Overleaf sync fails

- **Symptom:** linking or pushing to Overleaf errors out.
- **Cause:** most often a missing paid plan, a stale local copy, a real merge conflict, or
  `git` not installed.
- **Fix:** Overleaf's Git integration needs a **paid Overleaf plan**. Ask handoff to *pull
  the latest from Overleaf* before retrying; resolve genuine conflicts in the Overleaf web
  editor, then continue. Ensure `git` is installed. Full table in
  [Overleaf sync](overleaf.md#troubleshooting).

## Citations render as `[?]`

- **Symptom:** the compiled PDF shows `[?]` instead of citation numbers.
- **Cause:** the bibliography isn't wired up, or the document wasn't run through BibTeX.
- **Fix:** make sure the paper has `\usepackage{natbib}`, `\bibliographystyle{plainnat}`,
  and `\bibliography{refs}` before `\end{document}`, and that `paper/refs.bib` exists (never
  put it in `literature/`). Overleaf runs BibTeX automatically; locally, compile → BibTeX →
  compile twice. `cite_paper` keeps `refs.bib` in order for you.

## handoff keeps asking before running tools

- **Symptom:** a prompt appears before shell commands, code runs, or Overleaf pushes.
- **Cause:** you're in **hands-on** mode (the default), which asks before sensitive tools.
- **Fix:** answer `y` (once), `a` (always, for the session), or `n` (deny). To stop being
  asked, switch to **hands-off** with `/mode` or `⇧Tab`. In-project file writes are always
  auto-approved. See [Configuration → Modes](configuration.md#modes-approval).

## Colors or animation look wrong

- **Symptom:** the banner animation is distracting, or colors don't render in your terminal.
- **Cause:** terminal color support or a preference for reduced motion.
- **Fix:** set `NO_COLOR=1` for monochrome, `HANDOFF_REDUCED_MOTION=1` to hold the mascot
  still, or pick another theme in `/settings → Change theme`.

## Previewing this docs site locally

- **Symptom:** you want to check docs changes before pushing.
- **Cause:** GitHub Pages builds the site remotely from `/docs`; there's no build step in
  this repo.
- **Fix:** pushing to the default branch rebuilds the published site automatically. To
  preview locally, install Ruby + Bundler, add a `Gemfile` with `gem "github-pages"`, then
  run `bundle exec jekyll serve` from `docs/`.

---

Still stuck? Open an issue on [GitHub](https://github.com/handoff-org/handoff/issues) with
your OS, backend, model, and the exact message.
