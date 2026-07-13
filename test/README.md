# Tests

`node:test` + `node:assert/strict`, run through `tsx`. No build step.

```sh
npm test          # runs every test/**/*.test.ts(x) (recursive)
npm run check     # typecheck -> lint -> format -> docs -> test
```

## Conventions

- Isolate `$HOME` with `freshHome()` from `./helpers.js` **before** importing any
  module that reads `homedir()` at load (e.g. `src/workspace/project.ts`), then
  use a dynamic `import()`. See existing tests for the pattern.
- Ink/React components render via `ink-testing-library`; always `unmount()` to
  clear timers (see `app-render.test.tsx`).
- Name tests by the unit under test. When two files cover the same area from
  different angles, disambiguate with a `.scope` segment rather than a `2`
  suffix — e.g. `systemPrompt.test.ts` (core) + `systemPrompt.modes.test.ts`
  (mode/Overleaf context); `modelMenu.render.test.tsx` (component) +
  `modelMenu.command.test.tsx` (`/model` command).

## Taxonomy

The runner is recursive, so tests may live in subdirectories. The intended
buckets (populate incrementally — moving a file only requires fixing its
relative imports, and the full suite verifies the move):

| Bucket | What lives here |
|---|---|
| `unit/` | Pure logic, one module: parsing, math, formatting, schema, redaction, SSRF, search, stats, bibtex, jsonl, input editing, hardware/advisor scoring. |
| `integration/` | Multiple modules or the filesystem: project scaffolding, capsules/runner, claims, provenance, report, Overleaf, sessions, handoff packets, paper init. |
| `e2e/` | Rendered TUI (`ink-testing-library`) and the QA chat-sim smoke: `app-render`, `modelMenu.*`, `render`, `theme-preview`, `animated-mascot`. |
| `helpers/`, `fixtures/`, `mocks/` | Shared setup, sample data, and fakes (currently `helpers.ts` at the test root). |
