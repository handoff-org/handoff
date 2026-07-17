# Handoff evaluation framework

A layered, reproducible evaluation system for the Handoff research companion. It
measures what the model can do reliably, localizes failures to a layer
(model / prompt / context / tools / relay / harness), and turns failures into
reproducible, engineering-ready reports.

It **extends** the existing seams rather than duplicating them: it drives the real
headless agent loop (`src/agent/loop.ts`) with the `ChatModel` interface, reuses
`buildSystem`, `redactSecrets`, and the `ToolRegistry`, and complements the existing
`qa/chat-sim` (product-path) and relay Go tests. See `BASELINE_AUDIT.md`.

## Layers

- **direct** — model capability with controlled prompts, no product plumbing.
- **agent** — tool selection/ordering/interpretation and recovery, with mocked tools.
- **product** — the full conversation path (history, multi-turn, artifacts). The
  proven `qa/chat-sim` harness is the deep product runner; product-layer scenarios
  here exercise the same `runAgentLoop` seam.
- **transport** — relay / provider behavior. Covered by the `handoff-relay` Go tests
  (`internal/relayserver/e2e_test.go`) and marked **skipped/unavailable** here when a
  relay process or Ollama backend is not running.

Every result records its layer, so a failure points at where to look.

## Commands

```
npm run eval:list                       # list scenarios (supports filters)
npm run eval:validate                   # schema + fixture + integrity validation
npm run eval:smoke                      # fast, mocked, no external services
npm run eval:core                       # all canonical scenarios (mocked)
npm run eval:extended                   # canonical + seeded variants (>=150 instances)
npm run eval:stress                     # long-context / performance (as authored)
npm run eval:coverage                   # regenerate COVERAGE.md

npm run eval:scenario -- --id CITATION-CONFLICT-001 --seed 3
npm run eval:category -- --category citation-integrity
npm run eval:replay   -- --id CITATION-FABRICATION-901        # verbose failure replay

npm run eval:report   -- --run <run-id>
npm run eval:baseline -- --run <run-id> --name core           # promote (never implicit)
npm run eval:compare  -- --baseline core --candidate <run-id>
```

Flags: `--id --category --tag --difficulty --layer --seed --repeat --model --verbose --fail-fast`.

The smoke/core/extended suites run fully offline with deterministic mocked models
and tools — **no Ollama, GPU, network, relay, or credentials required**. Live-model
and relay runs detect missing dependencies and are reported as *skipped*, never as
passed.

## What a run produces

`evals/reports/<run-id>/`:

```
summary.md summary.json results.jsonl results.csv junit.xml index.html
config.json environment.json
failures/<fingerprint>.md      # one per distinct failure, with repro command
FAILURE_BACKLOG.md             # failures grouped by remediation area
transcripts/                   # sanitized per-scenario transcript + tool trace
comparison/                    # written by eval:compare
```

All artifacts are passed through `redactSecrets`, so reports never contain
unredacted secrets. Reports are gitignored; **baselines are tracked**.

## Reproducibility

A failing scenario is reproducible from: scenario id + version + seed + commit +
model + system-prompt version + runner version (all recorded in `config.json` and
each failure report). Under the deterministic mock model, `(id, seed)` fully
determines the result.

## Scoring

- **Deterministic assertions** (preferred): citation validity/stance, secret leak,
  unapproved network, required/forbidden tools, numeric, file existence, LaTeX
  parse, cite-key preservation, streaming-duplication, JSON schema. Some behavioral
  checks (uncertainty/conflict/clarification acknowledgement) are documented
  heuristics.
- **Ground truth**: closed-world corpora declare valid citation ids and per-claim
  stance, so fabrication and stance errors are detectable.
- **Rubric / LLM judge**: optional and off by default; scenarios may declare anchored
  rubric dimensions for a future judge. A judge never overrides a deterministic
  privacy or citation failure.

## Failure taxonomy & severity

31 taxonomy codes (see `schema/types.ts`) separate model limitations from
application/prompt/context/tool/relay/harness bugs. Severity: critical / high /
medium / low. Critical & high failures surface in every summary regardless of the
aggregate pass rate.

See `AUTHORING.md` to add scenarios, fixtures, ground truth, and regression tests.
