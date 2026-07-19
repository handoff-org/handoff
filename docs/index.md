---
title: Home
layout: default
nav_order: 1
description: "handoff — a local-first AI research companion for reading papers, running experiments, writing LaTeX, and tracking claims from your terminal."
permalink: /
---

<h1 class="sr-only">handoff</h1>

<div class="hf-editorial-hero">
  <div class="hf-editorial-hero__grid">

    <div class="hf-editorial-hero__lead">
      <p class="hf-eyebrow hf-reveal">Local-first research companion</p>
      <h1 class="hf-editorial-hero__title hf-reveal">Research<br>you can prove.</h1>
      <p class="hf-editorial-hero__thesis hf-reveal">
        Read papers, run experiments, write LaTeX — all on your own machine.
        Every claim traced to its evidence. Nothing leaves unless you say so.
      </p>
      <div class="hf-hero-meta hf-reveal">
        <span><span class="hf-meta-dot"></span>Ollama · llama.cpp · MLX · vLLM</span>
        <span>TypeScript TUI</span>
        <span>ELv2 license</span>
      </div>
      <div class="hf-editorial-hero__actions hf-reveal">
        <a class="hf-btn hf-btn--primary" href="getting-started.html">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Get started
        </a>
        <a class="hf-btn hf-btn--outline" href="https://github.com/handoff-org/handoff" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.5 1.3a12 12 0 0 0-6.3 0C6.5 2.8 5.5 3.1 5.5 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>
          GitHub
        </a>
      </div>
    </div>

    <!-- Signature motif: provenance DAG — session → claims → evidence.
         Top-to-bottom flow. Green = verified chain. Amber = weak claim.
         Paths draw in on scroll via stroke-dasharray animation. -->
    <figure class="hf-motif-wrap hf-reveal"
            aria-label="Diagram: a research session (top) branches into claims (middle), each connecting to literature evidence (bottom). Green paths are verified; amber needs a citation.">
      <svg class="hf-motif-svg" viewBox="0 0 280 310" role="img">
        <g>
          <path class="hf-ml hf-ml--hot"  pathLength="1" d="M140 53  C140 96,  85 96,  85 138"/>
          <path class="hf-ml hf-ml--weak" pathLength="1" d="M140 53  C140 96,  195 96, 195 138"/>
          <path class="hf-ml hf-ml--hot"  pathLength="1" d="M85 157  C85 203, 44 203, 44 243"/>
          <path class="hf-ml hf-ml--hot"  pathLength="1" d="M85 157  C85 203, 130 203, 130 243"/>
          <path class="hf-ml"             pathLength="1" d="M195 157 C195 203, 130 203, 130 243"/>
          <path class="hf-ml hf-ml--weak" pathLength="1" d="M195 157 C195 212, 209 212, 209 243"/>
        </g>
        <rect class="hf-mn hf-mn--hot"  x="131" y="35"  width="18" height="18" rx="4"/>
        <rect class="hf-mn hf-mn--hot"  x="76"  y="138" width="18" height="18" rx="3"/>
        <rect class="hf-mn hf-mn--weak" x="186" y="138" width="18" height="18" rx="3"/>
        <circle class="hf-mn hf-mn--hot" cx="44"  cy="252" r="9"/>
        <circle class="hf-mn hf-mn--hot" cx="130" cy="252" r="9"/>
        <circle class="hf-mn"            cx="209" cy="252" r="9"/>
        <text font-family="monospace" font-size="7.5" fill="#484858" letter-spacing="0.08em" text-anchor="middle" x="140" y="72">SESSION</text>
        <text font-family="monospace" font-size="7.5" fill="#484858" letter-spacing="0.08em" text-anchor="middle" x="140" y="175">CLAIMS</text>
        <text font-family="monospace" font-size="7.5" fill="#484858" letter-spacing="0.08em" text-anchor="middle" x="140" y="278">EVIDENCE</text>
      </svg>
    </figure>

  </div>

  <div class="hf-editorial-hero__terminal hf-reveal">
    {% include terminal-card.html %}
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

---

<div class="hf-ed-section hf-ed-section--tint">
  <p class="hf-eyebrow hf-reveal">Workflow</p>
  <h2 class="hf-ed-heading hf-reveal">From blank terminal to defended paper</h2>
  <p class="hf-ed-lead hf-reveal">Four commands cover the full research arc. Everything in between is handled by handoff — locally, reproducibly, with every step on record.</p>
  <ol class="hf-workflow">
    <li class="hf-workflow__step hf-reveal">
      <span class="hf-workflow__n">01</span>
      <span class="hf-workflow__cmd">/project new</span>
      <p class="hf-workflow__title">Scaffold</p>
      <p class="hf-workflow__desc">Create a private workspace with a Zotero library, experiment log, and LaTeX template — all local.</p>
    </li>
    <li class="hf-workflow__step hf-reveal">
      <span class="hf-workflow__n">02</span>
      <span class="hf-workflow__cmd">/research</span>
      <p class="hf-workflow__title">Verify</p>
      <p class="hf-workflow__desc">Fact-check claims against OpenAlex and arXiv. Confirmed citations go straight into the ledger.</p>
    </li>
    <li class="hf-workflow__step hf-reveal">
      <span class="hf-workflow__n">03</span>
      <span class="hf-workflow__cmd">/audit-paper</span>
      <p class="hf-workflow__title">Audit</p>
      <p class="hf-workflow__desc">Catalog every claim. Flag the ones without evidence before a reviewer does.</p>
    </li>
    <li class="hf-workflow__step hf-reveal">
      <span class="hf-workflow__n">04</span>
      <span class="hf-workflow__cmd">/handoff</span>
      <p class="hf-workflow__title">Transfer</p>
      <p class="hf-workflow__desc">Generate a grounded summary packet — claims, evidence, reproducible capsules — for your collaborators or future self.</p>
    </li>
  </ol>
</div>

---

<div class="hf-ed-section">
  <p class="hf-eyebrow hf-reveal">Capabilities</p>
  <h2 class="hf-ed-heading hf-reveal">Everything the research loop needs</h2>

  <div class="hf-feature-pairs">

    <div class="hf-fp hf-reveal">
      <div class="hf-fp__lead">
        <span class="hf-fp__num">Literature</span>
        <p class="hf-fp__title">Read and fact-check against live databases</p>
        <p class="hf-fp__desc"><code>/research &lt;claim&gt;</code> searches OpenAlex and arXiv in real time, finds matching papers, and marks the claim supported or weak in the ledger. Annotate PDFs with <code>/zotero-prep</code>. Read figures and PDF pages on multimodal models with <code>view_image</code>.</p>
      </div>
      <div class="hf-fp__demo hf-demo">
        <div class="hf-demo__bar">
          <span class="hf-demo__dot hf-demo__dot--r"></span>
          <span class="hf-demo__dot hf-demo__dot--y"></span>
          <span class="hf-demo__dot hf-demo__dot--g"></span>
        </div>
        <div class="hf-demo__body">
          <div class="hf-demo__line hf-demo__line--cmd">
            <span class="hf-demo__p">h&gt;</span>
            <span class="hf-demo__c">/research attention is all you need</span>
          </div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--dim"> searching OpenAlex + arXiv…</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> ✓ Vaswani et al. 2017 — direct match</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> ✓ 847 citing papers found</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--accent"> claim: supported · added to ledger</span></div>
        </div>
      </div>
    </div>

    <div class="hf-fp hf-fp--flip hf-reveal">
      <div class="hf-fp__lead">
        <span class="hf-fp__num">Experiments</span>
        <p class="hf-fp__title">Run Python in isolated, reproducible capsules</p>
        <p class="hf-fp__desc">Each experiment gets its own <code>uv</code> project — dependencies locked, stdout captured, a <code>repro.sh</code> generated automatically. Re-run any past experiment in one command, on any machine.</p>
      </div>
      <div class="hf-fp__demo hf-demo">
        <div class="hf-demo__bar">
          <span class="hf-demo__dot hf-demo__dot--r"></span>
          <span class="hf-demo__dot hf-demo__dot--y"></span>
          <span class="hf-demo__dot hf-demo__dot--g"></span>
        </div>
        <div class="hf-demo__body">
          <div class="hf-demo__line hf-demo__line--cmd">
            <span class="hf-demo__p">h&gt;</span>
            <span class="hf-demo__c">/run train.py --epochs 10</span>
          </div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--dim"> creating isolated uv env…</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> ✓ epoch 10/10 · loss 0.042</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--accent"> capsule saved · repro.sh written</span></div>
        </div>
      </div>
    </div>

    <div class="hf-fp hf-reveal">
      <div class="hf-fp__lead">
        <span class="hf-fp__num">Writing</span>
        <p class="hf-fp__title">Draft in LaTeX, sync two-way with Overleaf</p>
        <p class="hf-fp__desc">Start from ACL, NeurIPS, or a blank template. Edit in-place with a diff box. Two-way Overleaf sync lets you work from the terminal or the browser — your choice, always in sync.</p>
      </div>
      <div class="hf-fp__demo hf-demo">
        <div class="hf-demo__bar">
          <span class="hf-demo__dot hf-demo__dot--r"></span>
          <span class="hf-demo__dot hf-demo__dot--y"></span>
          <span class="hf-demo__dot hf-demo__dot--g"></span>
        </div>
        <div class="hf-demo__body">
          <div class="hf-demo__line hf-demo__line--cmd">
            <span class="hf-demo__p">h&gt;</span>
            <span class="hf-demo__c">/paper new --template acl</span>
          </div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> ✓ paper.tex scaffolded</span></div>
          <hr class="hf-demo__hr"/>
          <div class="hf-demo__line hf-demo__line--cmd">
            <span class="hf-demo__p">h&gt;</span>
            <span class="hf-demo__c">/overleaf sync</span>
          </div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> ✓ pushed 3 changes · in sync</span></div>
        </div>
      </div>
    </div>

    <div class="hf-fp hf-fp--flip hf-reveal">
      <div class="hf-fp__lead">
        <span class="hf-fp__num">Provenance</span>
        <p class="hf-fp__title">Every claim traced, every number reproducible</p>
        <p class="hf-fp__desc">The claim ledger records what you asserted and what supports it. <code>/audit-paper</code> sweeps your draft and flags anything without evidence. <code>/handoff</code> bundles the whole record into a portable packet — for co-authors, reviewers, or your future self.</p>
      </div>
      <div class="hf-fp__demo hf-demo">
        <div class="hf-demo__bar">
          <span class="hf-demo__dot hf-demo__dot--r"></span>
          <span class="hf-demo__dot hf-demo__dot--y"></span>
          <span class="hf-demo__dot hf-demo__dot--g"></span>
        </div>
        <div class="hf-demo__body">
          <div class="hf-demo__line hf-demo__line--cmd">
            <span class="hf-demo__p">h&gt;</span>
            <span class="hf-demo__c">/audit-paper</span>
          </div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--on"> supported  12 claims</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o hf-demo__o--amber"> weak       2 need citations</span></div>
          <div class="hf-demo__line"><span class="hf-demo__o"> model      qwen3:8b · local</span></div>
        </div>
      </div>
    </div>

  </div>
</div>

---

<div class="hf-privacy-strip hf-reveal">
  <span class="hf-badge">No cloud required</span>
  <span class="hf-badge">Data stays on your machine</span>
  <span class="hf-badge">Ollama · llama.cpp · MLX · vLLM</span>
  <span class="hf-badge">HuggingFace opt-in only</span>
  <span class="hf-badge">Source available · ELv2</span>
</div>

---

<div class="hf-cta-strip hf-reveal">
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
