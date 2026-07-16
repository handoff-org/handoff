---
title: Home
layout: default
nav_order: 1
description: "handoff — a local-first AI research companion for reading papers, running experiments, writing LaTeX, and tracking claims from your terminal."
permalink: /
---

<div class="hf-hero">
  <div class="hf-hero-grid">
    <div class="hf-hero-copy">
      <span class="hf-eyebrow">Local-first · Terminal-native · Private</span>
      <h1>handoff</h1>
      <p class="hf-tagline">
        Private research you can prove. Read papers, run experiments,
        write LaTeX, and trace every claim to its evidence — models on
        your machine, nothing leaves unless you say so.
      </p>
      <div class="hf-hero-ctas">
        <a href="getting-started.html" class="btn btn-primary fs-5">Get started</a>
        <a href="commands.html" class="btn fs-5">Commands</a>
        <a href="https://github.com/handoff-org/handoff" class="btn fs-5">GitHub</a>
      </div>
      <div class="hf-hero-meta">
        <span><span class="hf-meta-dot"></span>Runs locally on Ollama · llama.cpp · MLX</span>
        <span>ELv2 license</span>
        <span>TypeScript + Ink TUI</span>
      </div>
    </div>
    <div>
      {% include terminal-card.html %}
    </div>
  </div>
</div>

---

## Install

```bash
# macOS / Linux — installs the CLI, Ollama, mlx-lm, llama.cpp, and uv
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex
```

Then run `handoff` and follow the setup wizard.

## What handoff does

{% include feature-grid.html %}

## Why local-first

<div class="hf-privacy-strip">
  <span class="hf-badge">No cloud required</span>
  <span class="hf-badge">Data stays on your machine</span>
  <span class="hf-badge">Ollama · llama.cpp · MLX · vLLM</span>
  <span class="hf-badge">HuggingFace opt-in only</span>
  <span class="hf-badge">Source available · ELv2</span>
</div>

handoff runs against [Ollama](https://ollama.com), llama.cpp, MLX, or vLLM on your own
machine, so your literature, data, drafts, and conversations stay with you. A cloud model
(HuggingFace) is only ever used **after you explicitly opt in** — and even then, only the
context you send.

## Core workflow

```text
/project new Memory and Attention       # scaffold a private research workspace
/research transformers need positional encodings  # fact-check against the literature
# …ask it to run experiments and draft your paper…
/audit-paper                            # catalog every claim; flag the unsupported ones
/handoff --for-me                       # a grounded summary of where the work stands
```

<div class="hf-cta-strip">
  <div>
    <p class="hf-cta-text">Ready to get started?</p>
    <p class="hf-cta-sub">Install takes under a minute. First research session in five.</p>
  </div>
  <a href="getting-started.html" class="btn btn-primary">Get started →</a>
</div>

## Docs

<div class="hf-docs-grid">
  <a href="getting-started.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Getting started</p>
    <p class="hf-docs-card__desc">Install, first launch, first project.</p>
  </a>
  <a href="research-workflow.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Research workflow</p>
    <p class="hf-docs-card__desc">Literature → experiments → results → paper.</p>
  </a>
  <a href="commands.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Commands</p>
    <p class="hf-docs-card__desc">Every slash command and key binding.</p>
  </a>
  <a href="claims-and-handoff.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Claims &amp; handoff</p>
    <p class="hf-docs-card__desc">Claim ledger, audit, transfer packets.</p>
  </a>
  <a href="overleaf.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Overleaf sync</p>
    <p class="hf-docs-card__desc">Two-way LaTeX sync, tokens, troubleshooting.</p>
  </a>
  <a href="integrations.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Zotero &amp; OpenReview</p>
    <p class="hf-docs-card__desc">Annotate papers, fetch and answer reviews.</p>
  </a>
  <a href="configuration.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Configuration</p>
    <p class="hf-docs-card__desc">Config file, env vars, backends, themes.</p>
  </a>
  <a href="models.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Choosing a model</p>
    <p class="hf-docs-card__desc">Fast local models, presets, doctor &amp; benchmark.</p>
  </a>
  <a href="skills.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Skills</p>
    <p class="hf-docs-card__desc">Save and replay your own workflows.</p>
  </a>
  <a href="troubleshooting.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Troubleshooting</p>
    <p class="hf-docs-card__desc">Fixes for the common snags.</p>
  </a>
  <a href="architecture.html" class="hf-docs-card">
    <p class="hf-docs-card__title">Architecture</p>
    <p class="hf-docs-card__desc">Contributor's tour of the codebase.</p>
  </a>
</div>
