# QA chat-simulation harness

An automated real-user simulation for handoff. It drives the **real** agent loop
(`src/agent/loop.ts`) and workspace/config/claims logic with a **deterministic
fake model**, records every turn to JSONL, asserts on the results, classifies
failures, and (for the named scenarios) runs each in its own isolated temp HOME.

It exists to catch what unit tests miss: broken TUI/app states, crashes, bad
command parsing, malformed/duplicate tool calls, bad file writes, path escapes,
corrupt-state recovery, poor error messages, hangs/timeouts, and unhandled
exceptions.

## Commands

```bash
npm run qa:chat          # all named scenarios
npm run qa:chat:smoke    # fast CI subset (no network / Ollama / cloud)
npm run qa:chat:fuzz     # one seeded random session (50 turns)

# targeted / reproducible
npx tsx qa/chat-sim/runner.ts --scenario paper-start --seed 1
npx tsx qa/chat-sim/runner.ts --fuzz --iterations 40 --seed 123 --keep-temp
```

Flags: `--all`, `--smoke`, `--scenario <id>`, `--fuzz`/`--random`, `--seed N`,
`--iterations N`, `--keep-temp`, `--real-model` (accepted; the default path is
always the mock model).

## Output

Written to `qa/logs/` (gitignored):

- `chat-sim-<ts>.jsonl` — every event: user messages, assistant text, tool calls,
  tool results, app events, warnings, errors, timeouts, assertions, file
  snapshots, metrics. Secrets are redacted (`src/util/redact.ts`).
- `chat-sim-<ts>.summary.json` — pass/fail counts + failures grouped by category.
- `chat-sim-<ts>.failures.md` — human-readable report with a reproduce command
  per failure.

## Isolation & determinism

- Each named scenario runs in its **own child process** with `HOME` pointed at
  `tmp/qa-home/<scenario-id>/`, so config, projects, sessions, and claims never
  touch your real `~/.handoff`. (Paths are module-level constants bound to
  `homedir()` at import, so a fresh process per scenario is what guarantees
  isolation.)
- The child env strips `HANDOFF_*` / `HF_TOKEN` so a developer's shell can't
  perturb the config the harness writes.
- No network, no Ollama, no cloud, no real model on the default path.

## Layout

| File | Role |
|---|---|
| `types.ts` | log schema, `MockStep`, `Scenario`, `CheckApi` |
| `logger.ts` | JSONL writer + secret redaction + bounded previews |
| `mockModel.ts` | deterministic `ChatModel` (text/tools/malformed/duplicate/slow/throw/overlong/truncated) |
| `commands.ts` | headless executor for module-backed slash commands |
| `assertions.ts` | assertion builders for scenario `check` hooks |
| `scenarios.ts` | 22 named scenarios + seeded fuzz generator |
| `harness.ts` | runs one scenario: drives the loop, timeouts, assertions, logging |
| `runScenario.ts` | child entry (one scenario, isolated HOME, crash handlers) |
| `runner.ts` | parent: flags, spawns children, aggregates, writes reports |
| `summarize.ts` | classify failures → summary JSON + failures Markdown |

Harness self-tests live in `test/qa-harness.test.ts`.

## Scope note

The command executor calls the same underlying modules the React app wires to
its menus (`createProject`, `initPaper`, `auditPaper`, `checkProvenance`, config
store, claims, handoff), so it exercises the real logic. It does not re-test the
React dispatch in `ui/app.tsx` itself — driving Ink needs a TTY (a `node-pty`
dependency the task avoids), so full TUI process-smoke is out of scope here.
