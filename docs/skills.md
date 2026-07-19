---
layout: doc
title: Skills
---

# Skills

Skills are reusable, named instructions you can invoke on demand. They're plain
markdown files with a small frontmatter header — capture a workflow once ("draft a
related-work section", "run my standard preprocessing"), then replay it with `/skill`.

## Commands

| Command | What it does |
|---------|--------------|
| `/skills` | list available skills |
| `/skill <name>` | run a skill — its instructions are handed to the agent |
| `/compose-skill` | open your `$EDITOR` on a starter template to write a new one |

## Authoring a skill

Run `/compose-skill`. handoff opens your editor (`$VISUAL`/`$EDITOR`, falling back to
`nano`) on a template:

```markdown
---
name: my-skill
description: One line — what this skill does and when the agent should use it.
---

# Instructions

## When to use this
Describe the situation this skill is for.

## Steps
1. First, ...
2. Then, ...
3. Finally, ...

## Notes
Constraints, examples, or things to avoid.
```

Edit it, **save, and close the editor**. handoff validates and saves it. Two rules the
validator enforces:

- `name:` must be set to something other than the placeholder `my-skill`.
- `description:` must be present — it's how the agent knows when the skill applies.

The `name` is slugified for the filename and for `/skill <name>`. Everything below the
frontmatter is the body that gets sent to the model when the skill runs.

## Where skills live

Skills load from two places — the ones shipped with handoff, and your own:

```
<repo>/skills/<name>/<name>.md      # shipped with handoff (one folder per skill)
~/.handoff/skills/<name>.md         # your skills (what /compose-skill writes)
~/.handoff/skills/<name>/<name>.md  # or a folder, if a skill needs extra files
```

Both flat files and per-skill folders are loaded from either location, so you can keep a
single-file skill or give one its own folder. **A user skill with the same slug overrides
the built-in one**, so you can customize a shipped skill by composing one with the same
name.

> Shipped skills may carry a small `metadata:` block in their frontmatter (an emoji, the
> platforms they run on, required CLIs). It's informational — only `name` and `description`
> affect how a skill is loaded and matched.

## Running a skill

```
/skill draft-related-work
```

handoff finds the skill (by slug), and runs a turn with its body as the instruction.
From there it behaves like any other request — it can read files, search the
literature, and write to your project, all within the active project's context.

## Tips

- Keep instructions **specific and step-by-step**; vague skills produce vague results.
- Reference your project layout (`literature/`, `paper/`, `results/`) so the skill puts
  files in the right place.
- A skill is just a prompt — it can call any tool the agent has, including `/research`
  workflows and Overleaf writes.
