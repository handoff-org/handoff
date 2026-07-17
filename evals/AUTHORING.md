# Authoring scenarios

A scenario is one YAML file under `evals/scenarios/<category>/`, validated against
`schema/scenario.schema.json`. Quality over quantity: each canonical scenario should
test a distinct capability or failure mode.

## Add a scenario

1. Create `evals/scenarios/<category>/<name>.yaml`. Minimum required fields:
   `id`, `version`, `title`, `layer`, `category`, `difficulty`, `turns`, `expected`.
2. Give it a stable `id` matching `^[A-Z0-9]+(-[A-Z0-9]+)*-[0-9]{3}$`
   (e.g. `EVIDENCE-CONFLICT-003`). Bump `version` whenever you change scoring.
3. Script the model with `mockModel` steps (one consumed per agent-loop round) and
   tools with `mockTools`. Author **good behavior** so a healthy harness passes.
4. Add deterministic `expected.assertions` (and `requiredTools`/`forbiddenTools`).
5. `npm run eval:validate` then `npm run eval:scenario -- --id <ID>`.

```yaml
id: EVIDENCE-CONFLICT-003
version: 1
title: Resolve conflicting study results
detects: silently averaging incompatible findings
layer: agent
category: conflicting-evidence
difficulty: hard
seed: 42
environment: { network: mocked, cloudAllowed: false, corpusFixture: fixtures/papers/intervention-x.json }
mockTools:
  project_document_search: { result: "S1 benefit; S2 null." }
mockModel:
  - kind: tools
    calls: [{ name: project_document_search, args: { query: "X" } }]
  - kind: text
    text: "[S1] found a benefit but [S2] did not; the evidence is inconclusive."
turns:
  - user: "Does X reduce Y? Use only the supplied studies."
expected:
  requiredTools: [project_document_search]
  forbiddenTools: [cloud_search]
  assertions:
    - type: no_unknown_citation_ids
    - type: citation_stance_matches
    - type: acknowledges_conflict
groundTruth:
  validCitationIds: [S1, S2, S3]
  claims:
    - { id: c1, stance: mixed, supportingSources: [S1], contradictingSources: [S2] }
```

## Add a fixture

Put closed-world corpora under `fixtures/papers/`, project trees under
`fixtures/project-workspaces/`, conversations under `fixtures/conversations/`.
Reference them from `environment.*Fixture`. The loader fails validation if a
referenced fixture is missing.

## Define ground truth

For citation/evidence scenarios, enumerate `groundTruth.validCitationIds` (every id
the answer may cite) and `groundTruth.claims[]` with `stance` and
`supportingSources` / `contradictingSources`. This makes fabrication and
stance-mismatch deterministically detectable. For "should cite nothing," set
`validCitationIds: []`.

## Assertions

See `schema/types.ts` `AssertionType`. Deterministic ones are preferred. Mark
critical checks with `hardGate: true` (privacy, injection, network, fabrication
default to hard-gate). Behavioral heuristics
(`acknowledges_uncertainty|conflict`, `asks_clarification`) match hedging/limitation
language — use alongside a stronger deterministic check where possible.

## Negative / detector scenarios

To prove a scorer fires, author a bad-behavior scenario tagged `selftest` (see
`scenarios/_selftest/known-fabrication.yaml`). These are excluded from
smoke/core/extended but runnable via `--id`/`--category`, and are what the
`test/evals.test.ts` self-tests assert on.

## Seeded variants

`npm run eval:extended` expands canonical scenarios into deterministic variants via
`generators/generate.ts` + `mutations/`. Mutations are meaning-preserving (paraphrase,
distractor, typos, expertise, length) so the expected outcome is unchanged; a variant
that would change the correct answer must be a **new canonical scenario**. Each
mutation declares the capability it stresses.

## Turn a failure into a regression test

1. From a failure report (`failures/<fp>.md`), copy the repro command.
2. Reproduce with `npm run eval:replay -- --id <ID> --seed <N>` (verbose).
3. If the failure is a real product bug, keep the scenario as the regression; do not
   tune the prompt to a single instance (see the backlog's overfitting note). Bump the
   scenario `version` if you change its scoring.
