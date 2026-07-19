---
layout: doc
title: Claims & handoff
---

# Claims, provenance & handoff

handoff is named after its flagship idea: research should be **handed off cleanly** —
to your future self, a new student, a PI, or a reviewer — with every claim traceable to
evidence. Two features make that concrete: a **claim ledger** and **transfer packets**.

## The claim ledger

Every quantitative or comparative statement in your paper is a *claim* that should rest
on evidence (a logged run, or a cited work). handoff keeps an append-only ledger of them
at:

```
~/.handoff/projects/<slug>/claims/claims.jsonl
```

Each claim has a status:

| Status | Marker | Meaning |
|--------|:------:|---------|
| `supported` | `✓` | Backed by a linked run or citation. |
| `weakly_supported` | `~` | Some evidence, but thin. |
| `unsupported` | `✗` | No evidence linked yet. |

### Auditing the paper

```
/audit-paper
```

Scans every `.tex` file in `paper/`, extracts claims — numeric results, comparison
claims ("outperforms", "faster than"), and broad literature claims — dedups them against
the ledger, and records any new ones as **unsupported**. The report groups what it found
so you can see at a glance what still needs backing.

### Reviewing and adding claims

| Command | What it does |
|---------|--------------|
| `/claims` | All tracked claims with a status summary. |
| `/unsupported` | Just the claims with no (or thin) evidence — your to-do list. |
| `/claim-add <text>` | Record a claim by hand. |
| `/claim-status <id>` | Full detail for one claim, including its linked evidence. |

### Linking evidence

Move a claim from `✗` to `✓` by attaching evidence:

```
/claim-link-run   <claim_id> <run_id>          # a logged experiment run
/claim-link-paper <claim_id> <citation_key>    # a cited work in refs.bib
```

The goal: before you submit, `/unsupported` is empty and every number in the paper can
answer "where did this come from?"

## Transfer packets — `/handoff`

A transfer packet is a written summary of where the work stands, tailored to who's
receiving it. It draws on the project's notebook, run ledger, claim ledger, and risks —
so it's grounded in what actually happened, not a hand-typed status update.

```
/handoff                      # same as --for-me
/handoff --for-me             # pick-up notes for future you
/handoff --for-pi             # progress summary for an advisor
/handoff --for-reviewer       # framed for peer review (limitations foregrounded)
/handoff --for-industry-partner
```

Each audience gets a different framing:

- **`--for-me`** — recent progress, open risks, and the decisions you made, so you can
  resume without re-deriving context.
- **`--for-pi`** — a progress-first summary with open risks.
- **`--for-reviewer`** — foregrounds **limitations** and what the claims do and don't
  support.
- **`--for-industry-partner`** — the high-level state without internal risk detail.

The packet is printed into the transcript; copy it into an email, an issue, or a
`README`. It's the fastest honest answer to "so, where are we?"

## How it fits together

`/audit-paper` finds the claims → you link runs and citations as evidence → `/handoff`
rolls the current state (progress, supported vs. unsupported claims, open risks) into a
packet anyone can read. Local-first the whole way: none of this leaves your machine.
