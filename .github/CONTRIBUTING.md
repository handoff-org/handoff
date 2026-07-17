# Contributing to handoff

Thanks for your interest in improving handoff! It's a **local-first research
companion** — the guiding principle behind every change is that a user's unpublished
ideas, data, and drafts stay on their machine unless they explicitly opt in.

## Development setup

handoff runs directly from TypeScript source — **there is no build step**. You need
**Node.js 18+**.

```sh
git clone https://github.com/handoff-org/handoff
cd handoff
npm install
npm run dev        # launches the TUI from source (tsx src/index.tsx)
```

To exercise a change against the real app, run `npm run dev` in a terminal (it needs a
TTY). For a global `handoff` command pointing at your checkout, run
`bash installers/install.sh` from the repo — it detects the local checkout and
`npm install -g`s it.

## Before you open a PR

```sh
npm run check       # typecheck -> lint -> format:check -> docs:check -> test
```

You can also run the pieces individually: `npm run typecheck`, `npm run lint`,
`npm run format` (auto-fix), `npm run docs:check`, `npm test`, and
`npm run qa:chat:smoke` (deterministic chat-simulation smoke test).

Both must pass. If your change is user-facing, also launch the app and verify it by hand
— many things (input handling, rendering) can't be fully covered by unit tests.

## Guidelines

- **Local-first, always.** No new network calls or cloud usage without an explicit,
  user-consented gate. Never send project content to a cloud backend silently.
- **No secrets in the repo.** Don't commit tokens, keys, or absolute personal paths;
  redact them from any logs or output you paste.
- **Match the existing style.** Prefer small, focused changes. Avoid adding npm
  dependencies unless it's been discussed in an issue first — the project deliberately
  keeps its dependency surface small.
- **Update the docs.** If you change behavior, a command, or config, update `docs/` and
  `README.md` in the same PR.
- **Add a test** when you fix a bug or add logic — put pure functions where they're easy
  to unit-test (see `ui/input.ts`, `src/util/`).

### Codebase gotchas

- **No JSX fragments** — the tsx config has no `jsxFragmentFactory`; use keyed arrays
  (`[<Text key=… />, …]`) instead of `<>…</>`.
- **`homedir()` runs at import** — path constants are computed when a module loads, so
  tests must set `HOME` **before** importing and use dynamic `import()` (see
  `test/helpers.ts`).
- **Backgrounds need color** — `ink-testing-library` strips color at level 0; assert on
  text, or set `FORCE_COLOR=3` when asserting on background color.

See [`docs/architecture.md`](docs/architecture.md) for a tour of how the pieces fit
together (agent loop, tools, workspace, runner/capsules, renderer).

## Pull requests

1. Branch off `main` and keep the PR focused on one thing.
2. Open the PR — the template will prompt you for a summary, testing notes, and the
   checklist above.
3. A maintainer (see [`CODEOWNERS`](.github/CODEOWNERS)) will review. Be patient — this
   is a small project.

## Reporting bugs & requesting features

Use the issue templates (New Issue → *Bug report* / *Feature request*). For anything
security-related, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.
