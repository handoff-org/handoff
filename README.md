**Own your research.** A local-first research companion that lives in your terminal reads the literature, runs your experiments, and helps write your paper, powered by models on *your* machine. Nothing leaves your computer unless you say so.

| | |
|---|---|
| 🔒 **Private** | Runs against Ollama, llama.cpp, MLX, or vLLM locally. Cloud only after you opt in. |
| 🔬 **Literature** | `/research <claim>` fact-checks against OpenAlex & arXiv live. |
| 🧪 **Experiments** | Each Python run gets an isolated uv project and a reproducible capsule. |
| 📝 **Paper** | Start from ACL, NeurIPS, or blank. Two-way Overleaf sync. |
| 🔗 **Integrations** | Zotero (annotate papers with `/zotero-prep`) and OpenReview (fetch & answer reviews). |
| 👁 **Vision** | On a multimodal model, read figures & PDF pages with `view_image` / `view_pdf_page`. |
| ✅ **Provenance** | Claim ledger + `/audit-paper` + `/handoff` packets keep results traceable. |

---

## Install

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex
```

---

## Docs

📖 <https://handoff-org.github.io/handoff/>

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, setup wizard, first session |
| [Research workflow](docs/research-workflow.md) | Literature → experiments → paper |
| [Commands](docs/commands.md) | Every slash command and key binding |
| [Zotero & OpenReview](docs/integrations.md) | Annotate papers, fetch & answer reviews |
| [Configuration](docs/configuration.md) | Config, backends, inference presets |
| [Architecture](docs/architecture.md) | Contributor's tour |

---

## Development

```sh
git clone https://github.com/handoff-org/handoff.git
cd handoff && npm install
npm run dev        # TUI from source via tsx
npm run typecheck  # tsc --noEmit
npm test           # node:test suite
```

---

## Evaluation

A layered, reproducible eval harness lives in [`evals/`](evals/README.md). The
mocked suites run fully offline (no model, GPU, network, or credentials); add
`--live` (or use `eval:model` / `eval:matrix`) to run your real local models.

```sh
# offline, deterministic (mock model + mock tools)
npm run eval:validate                       # check every scenario is well-formed
npm run eval:list                           # list scenarios
npm run eval:smoke                          # fast sanity suite
npm run eval:core                           # all canonical scenarios
npm run eval:extended                       # canonical + seeded variants (150+ instances)

# run one scenario / category, or replay a failure
npm run eval:scenario -- --id CITATION-CONFLICT-001 --seed 3
npm run eval:category -- --category privacy
npm run eval:replay   -- --id CITATION-FABRICATION-901 --seed 901

# run REAL local models (uses your ~/.handoff backend; missing models are skipped)
npm run eval:model    -- --model qwen3:8b
npm run eval:model    -- --model qwen3:4b --category ambiguity --verbose
npm run eval:matrix   -- --models qwen3:8b,qwen3:4b,ornith:9b
npm run eval:core     -- --live --model qwen3:8b

# track over time
npm run eval:coverage                                        # regenerate evals/COVERAGE.md
npm run eval:baseline -- --run <run-id> --name qwen3-8b      # promote a run (never implicit)
npm run eval:compare  -- --baseline qwen3-8b --candidate <run-id>
```

Each run writes `evals/reports/<run-id>/` (`index.html`, `summary.md`,
`FAILURE_BACKLOG.md`, per-failure reports, sanitized transcripts). Flags:
`--id --category --tag --difficulty --layer --seed --repeat --model --live --verbose --fail-fast`.
Under `--live` the model is real but tools stay mocked, so a failure is the
model's, not the environment's. See [`evals/README.md`](evals/README.md) and
[`evals/AUTHORING.md`](evals/AUTHORING.md).

---

## Uninstall

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash
# add --purge to also remove ~/.handoff/ (config, projects, cache)
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash -s -- --purge

# Windows (PowerShell)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.ps1)))

# npm
npm uninstall -g ownhandoff
```

---

[Elastic License 2.0](./LICENSE) 2026
