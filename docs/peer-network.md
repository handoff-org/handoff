---
layout: doc
title: Peer GPU network
---

# Handoff peer GPU network

## What it is

The peer network lets handoff users share idle GPU time with each other. When your
local Ollama is busy or unavailable, your inference request routes to another
community member's machine. Credits flow the other way — you earn them by sharing,
spend them by borrowing.

No account, no email, no payment method required to get started.
Every new user receives 50,000 free tokens.

---

## Installation

The peer network components are included in the standard handoff installer.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash
```

### Windows

```powershell
irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex
```

Both installers place the provider daemon (`handoff-serve`) at `~/.handoff/bin/` and
add it to your PATH.

---

## Getting started (using community GPUs)

1. Run `handoff` and open `/settings` → **Peer GPU network** → Enter.
2. Choose **Get started (free)**.
3. The app registers an anonymous account on the network and saves your token locally.

That's it. By default the peer network acts as a **fallback**: your local Ollama is
always tried first, and the peer network is only used when local inference is
unavailable. You can change this in settings.

Your token is the only credential for your account. Keep it safe — there is no
recovery mechanism, by design.

---

## Sharing your GPU (earning credits)

1. Open `/settings` → **Peer GPU network** → **Share my GPU when idle**.
2. The app installs a background service that starts automatically on login.
3. The service shares your GPU with the network only when it is not in active use.

To stop sharing, choose **GPU sharing · active** from the same menu, or run:

```bash
handoff-serve --uninstall-service
```

---

## Credits

| | |
|---|---|
| **Starting balance** | 50,000 tokens — free, no card required |
| **Earning** | Generate tokens for others → receive credits |
| **Spending** | Use others' GPUs → spend credits |
| **Unit** | 1 credit = 1 output token generated on your behalf |

Your current balance is visible in the Peer GPU network menu.

---

## Privacy

- **No identity required.** Registration takes no input — no email, no name, nothing.
- **Your token never leaves your machine in plaintext.** The network stores only a
  cryptographic hash; the token itself is kept only in your local config.
- **Providers and consumers are anonymous to each other.** Neither party knows the
  other's identity or IP address.

If you want full control, you can self-host the network infrastructure and run a
completely private GPU-sharing group. See the
[handoff-relay](https://github.com/handoff-org/handoff-relay) repository.

---

## Uninstalling

```bash
# Remove handoff and the peer network components, keep your Ollama models
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash

# Remove everything including config and Ollama
curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash -s -- --purge
```

The uninstaller stops and removes the background service, removes the `handoff-serve`
binary, and reverts any environment variable changes made by the installer.
