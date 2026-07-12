# Walkthrough media

Short looping GIFs that show how to set up each API-requiring tool. They're generated
from the `.tape` scripts in this folder with [VHS](https://github.com/charmbracelet/vhs),
which drives the real handoff TUI and records it — so the GIFs stay accurate as the UI
changes (re-render instead of re-shooting a screencast).

| Tape | Renders | Embedded in |
|------|---------|-------------|
| `zotero.tape` | `zotero.gif` | [Zotero & OpenReview → Zotero](../integrations.md#zotero) |
| `openreview.tape` | `openreview.gif` | [Zotero & OpenReview → OpenReview](../integrations.md#openreview) |
| `overleaf.tape` | `overleaf.gif` | [Overleaf sync](../overleaf.md) |

## Render

```sh
# 1. Install VHS (https://github.com/charmbracelet/vhs)
brew install vhs            # macOS;  see the repo for Linux/Windows

# 2. Render one, or all of them:
vhs docs/media/zotero.tape
npm run media               # renders every docs/media/*.tape
```

The `.gif` files are written next to the tapes and are what the docs embed. Commit the
regenerated GIFs alongside any UI change that affects a flow.

## Prerequisites

- A **configured** handoff (a backend selected in the setup wizard) — the tapes launch
  `npm run dev` and expect it to boot straight to the chat view, not the wizard.
- The tapes type into the connector **forms**, which don't call a model, so no model
  needs to be running to record the setup flows.

## About the credentials in the tapes (they're safe)

The tapes type **placeholder** credentials. The key/token/password fields render as
`••••`, so nothing real is ever shown — you can record on camera safely.

Two caveats:

- **Zotero / OpenReview** tapes *submit* the form, which writes the placeholder
  credentials to `~/.handoff/config.json`. After recording, re-run `/zotero` /
  `/openreview` with your real credentials (or record against a scratch home:
  `HOME="$(mktemp -d)"` — but then handoff boots into the setup wizard first).
- The **Overleaf** tape presses `Esc` to cancel instead of submitting, so it never
  clones a project or needs a real token — no config is touched.

## Adding a new walkthrough

1. Copy an existing `.tape`, change `Output` and the typed commands.
2. `vhs docs/media/<name>.tape` to render.
3. Embed it in the relevant doc: `![…](media/<name>.gif)`.
4. If the tool has a link form, add its docs anchor to the form's "Watch setup" line
   (see `ui/ZoteroLink.tsx` for the pattern).
