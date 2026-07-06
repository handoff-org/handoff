# Security Policy

## Supported versions

handoff is pre-1.0 and released from `main`. Security fixes land on the latest published
version (`ownhandoff` on npm) — please make sure you're up to date before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.** Public issues are visible to
everyone and can tip off attackers before a fix ships.

Instead, report privately through GitHub:

1. Go to the repository's **Security** tab → **Report a vulnerability** (GitHub private
   vulnerability reporting). This opens a private advisory only you and the maintainer can
   see.
2. If that isn't available, open a regular issue that contains **no details** — just ask
   to be contacted privately — and the maintainer will follow up.

Please include, as far as you can:

- affected version (`handoff --version` if available) and OS,
- a clear description and steps to reproduce,
- the impact you think it has, and
- any proof-of-concept — with **secrets and personal paths redacted**.

This is a small, single-maintainer project, so responses are best-effort — but security
reports are taken seriously and prioritized. Please give a reasonable window to fix an
issue before disclosing it publicly.

## Scope & good to know

handoff is **local-first**: it runs models on your machine and keeps project files under
`~/.handoff/`. The most security-relevant areas are:

- **Credentials.** The Overleaf Git token and `HF_TOKEN` are the main secrets. The
  Overleaf token is masked in the UI, stored only in `paper/.git/config`, and redacted
  from any git output shown in the transcript. Reports about a token leaking into logs,
  the transcript, or saved sessions are in scope.
- **Untrusted content.** File contents, PDFs, web pages, and shell output are treated as
  **data, not instructions**. A way to make handoff follow embedded instructions to
  exfiltrate data or run unintended commands is in scope.
- **Network egress.** handoff's outbound traffic is limited to literature lookups
  (`/research`), Overleaf sync, and — only with explicit consent — a cloud model. The
  `web_fetch` tool guards against SSRF (link-local / metadata addresses); bypasses are in
  scope.

Out of scope: vulnerabilities in the local model backends themselves (Ollama, llama.cpp,
MLX, vLLM), your terminal, or Node.js — report those to the respective projects.
