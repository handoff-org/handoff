**Own your research.** A local-first research companion that lives in your terminal reads the literature, runs your experiments, and helps write your paper, powered by models on *your* machine. Nothing leaves your computer unless you say so.

| | |
|---|---|
| 🔒 **Private** | Runs against Ollama, llama.cpp, MLX, or vLLM locally. Cloud only after you opt in. |
| 🔬 **Literature** | `/research <claim>` fact-checks against OpenAlex & arXiv live. |
| 🧪 **Experiments** | Each Python run gets an isolated uv project and a reproducible capsule. |
| 📝 **Paper** | Start from ACL, NeurIPS, or blank. Two-way Overleaf sync. |
| ✅ **Provenance** | Claim ledger + `/audit-paper` + `/handoff` packets keep results traceable. |

---

## Install

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex

# Any OS — CLI only (model backends not included)
npm install -g ownhandoff
```

---

## Docs

📖 <https://handoff-org.github.io/handoff/>

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, setup wizard, first session |
| [Research workflow](docs/research-workflow.md) | Literature → experiments → paper |
| [Commands](docs/commands.md) | Every slash command and key binding |
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

[MIT](./LICENSE) 2026
