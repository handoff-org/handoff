# Changelog

All notable changes to handoff are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); handoff is pre-1.0 and
released from `master` as the `ownhandoff` npm package.

## [Unreleased]

### Added
- Research pipeline: structured literature notes (`/note-paper`, `/lit-notes`),
  citation snowballing (`/snowball`), lit-review synthesis (`/lit-review`),
  metric/figure bindings (`/bind`, `/list-bindings`, `/auto-link`), statistics
  reporting with CIs and effect sizes (`/stats`), section co-writing
  (`/draft-section`), compile/fix loop (`/fix-paper`), inline terminal figure
  preview (`/preview-figure`), and comparison-claim verification
  (`/verify-comparisons`).
- Repository standards: `AGENTS.md`, `CHANGELOG.md`, `.env.example`,
  `.editorconfig`, `.gitattributes`, Dependabot, and a `knip` dead-code config.

### Changed
- `npm run check` is now a full quality gate: typecheck → lint → format:check →
  docs:check → test.
- ESLint: `no-unused-vars` promoted to an error; `test/**` is now linted.

### Fixed
- `docs:check` no longer flags documented technical tokens (e.g. `` `%TODO:` ``)
  inside inline code spans, while still catching real prose placeholders.
- Removed unused imports and a dead parameter surfaced by the stricter lint.

### Internal
- Ongoing professional-standards refactor tracked in `REFACTOR_AUDIT.md` and
  `STALE_CODE_AUDIT.md`.
