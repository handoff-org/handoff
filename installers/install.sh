#!/bin/sh
# handoff installer for Linux & macOS.
#   curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.sh | bash
#
# Installs handoff and every local-model backend it supports:
#   Ollama · mlx-lm (Apple Silicon) · llama.cpp
#
# Every step is best-effort and non-fatal: one backend failing never stops the
# others, and a summary at the end shows exactly what was set up.
set -u

PKG="ownhandoff"
OS="$(uname -s)"
ARCH="$(uname -m)"

# Colors only when attached to a terminal.
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

info()  { printf '%s\n' "$*"; }
ok()    { printf '%s%s%s\n' "$GREEN" "$*" "$RESET"; }
warn()  { printf '%s%s%s\n' "$YELLOW" "$*" "$RESET"; }
fail()  { printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# TODO(peer-network): install_handoff_serve — re-enable when relay.handoff.sh is deployed.
# install_handoff_serve() {
#   hs_arch="$(uname -m)"
#   case "$hs_arch" in
#     x86_64|amd64) hs_arch="amd64" ;;
#     aarch64|arm64) hs_arch="arm64" ;;
#     *) return 1 ;;
#   esac
#   case "$OS" in
#     Darwin) hs_os="darwin" ;;
#     Linux)  hs_os="linux" ;;
#     *) return 1 ;;
#   esac
#   hs_dest="${HOME}/.handoff/bin/handoff-serve"
#   mkdir -p "${HOME}/.handoff/bin" || return 1
#   curl -fsSL "https://github.com/handoff-org/handoff-relay/releases/latest/download/handoff-serve-${hs_os}-${hs_arch}" \
#     -o "$hs_dest" || return 1
#   chmod +x "$hs_dest"
#   for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
#     [ -f "$prof" ] || continue
#     grep -q '.handoff/bin' "$prof" 2>/dev/null && continue
#     printf '\n# handoff local backends\nexport PATH="$HOME/.handoff/bin:$PATH"\n' >> "$prof"
#   done
#   export PATH="${HOME}/.handoff/bin:$PATH"
# }

# Best-effort install of LaTeX (pdflatex) for local paper compilation.
# macOS: basictex via Homebrew + the tlmgr packages the ACL/NeurIPS templates need.
# Linux: texlive-latex-extra + fonts via the distro package manager.
# Returns 0 on success.
install_latex_macos() {
  command -v brew >/dev/null 2>&1 || return 1
  info "  Downloading BasicTeX (~100 MB)..."
  HOMEBREW_NO_REQUIRE_TAP_TRUST=1 brew install --cask basictex 2>/dev/null || return 1
  # basictex lands in /Library/TeX/texbin — make it visible in the current session.
  export PATH="/Library/TeX/texbin:$PATH"
  command -v tlmgr >/dev/null 2>&1 || return 1
  info "  Updating tlmgr and installing template packages..."
  sudo tlmgr update --self --quiet 2>/dev/null || true
  sudo tlmgr install --quiet \
    latexmk collection-fontsrecommended inconsolata \
    microtype booktabs xcolor nicefrac hyperref natbib 2>/dev/null || true
  command -v pdflatex >/dev/null 2>&1
}

install_latex_linux() {
  _apt_pkgs="texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra latexmk"
  _dnf_pkgs="texlive-latex texlive-collection-latexextra texlive-collection-fontsrecommended texlive-collection-fontsextra latexmk"
  _pac_pkgs="texlive-core texlive-latexextra texlive-fontsextra"
  _zyp_pkgs="texlive texlive-latex-extra"
  _run() { [ "$(id -u)" = 0 ] && $@ 2>/dev/null || sudo $@ 2>/dev/null; }
  if   command -v apt-get >/dev/null 2>&1; then _run apt-get install -y $_apt_pkgs
  elif command -v dnf     >/dev/null 2>&1; then _run dnf     install -y $_dnf_pkgs
  elif command -v pacman  >/dev/null 2>&1; then _run pacman  -Sy --noconfirm $_pac_pkgs
  elif command -v zypper  >/dev/null 2>&1; then _run zypper  install -y $_zyp_pkgs
  else return 1; fi
  command -v pdflatex >/dev/null 2>&1
}

# Best-effort install of a prebuilt llama.cpp (llama-server) on Linux.
# Downloads the latest release binary, drops it in ~/.handoff/bin, and makes
# sure that dir is on PATH. Returns 0 on success, 1 on any failure.
install_llamacpp_linux() {
  command -v curl >/dev/null 2>&1 || return 1
  command -v tar >/dev/null 2>&1 || { warn "tar not found — needed for llama.cpp."; return 1; }

  la_arch="$(uname -m)"
  case "$la_arch" in
    x86_64|amd64) la_match="ubuntu-x64" ;;
    aarch64|arm64) la_match="ubuntu-arm64" ;;
    *) return 1 ;;
  esac

  # Find the matching asset in the latest release. Split the JSON on commas and
  # keep only real asset lines ("browser_download_url"): otherwise the greedy
  # [^"]* can run across the release-notes "body" (which contains no bare quotes,
  # only markdown) and capture a garbage URL — e.g. one with "[DISABLED]" in it,
  # which curl rejects as a "bad range". Assets ship as .tar.gz now (the project
  # no longer publishes .zip builds).
  la_url="$(curl -fsSL https://api.github.com/repos/ggml-org/llama.cpp/releases/latest 2>/dev/null \
    | tr ',' '\n' \
    | grep '"browser_download_url"' \
    | grep -o "https://[^\"]*bin-${la_match}\.tar\.gz" | head -n1)"
  [ -n "$la_url" ] || return 1

  la_tmp="$(mktemp -d)" || return 1
  if ! curl -fsSL "$la_url" -o "$la_tmp/llama.tar.gz"; then rm -rf "$la_tmp"; return 1; fi
  mkdir -p "$la_tmp/x"
  if ! tar -xzf "$la_tmp/llama.tar.gz" -C "$la_tmp/x"; then rm -rf "$la_tmp"; return 1; fi

  la_srv="$(find "$la_tmp/x" -type f -name llama-server 2>/dev/null | head -n1)"
  if [ -z "$la_srv" ]; then rm -rf "$la_tmp"; return 1; fi

  mkdir -p "$HOME/.handoff/bin"
  # Copy the whole bin dir so bundled shared libraries travel with the binary.
  la_srcdir="$(dirname "$la_srv")"
  cp "$la_srcdir"/* "$HOME/.handoff/bin/" 2>/dev/null || cp "$la_srv" "$HOME/.handoff/bin/"
  chmod +x "$HOME/.handoff/bin/llama-server" 2>/dev/null || true
  rm -rf "$la_tmp"

  # Put ~/.handoff/bin on PATH for future shells (idempotent).
  for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$prof" ] || continue
    grep -q '.handoff/bin' "$prof" 2>/dev/null && continue
    printf '\n# handoff local backends\nexport PATH="$HOME/.handoff/bin:$PATH"\n' >> "$prof"
  done
  export PATH="$HOME/.handoff/bin:$PATH"

  command -v llama-server >/dev/null 2>&1
}

# Enable Ollama's flash-attention + q8 KV-cache + single request slot by default,
# so every user gets faster, leaner local inference out of the box. These are read
# by the SERVER at startup, so we set them wherever the server might be launched
# from: the user's shell (a manual `ollama serve`, or the one handoff spawns,
# inherits it), the Linux systemd service (which does NOT read the shell), and the
# macOS launchd session (for the GUI app). Idempotent — safe to re-run.
#   OLLAMA_NUM_PARALLEL=1: Ollama sizes the KV cache as num_ctx × num_parallel; its
#   multi-slot default makes a single-user setup pay several times the KV-cache
#   memory for concurrency it never uses (~58% more resident memory, measured).
enable_ollama_perf() {
  perf_mark="# handoff: faster Ollama (flash attention + q8 KV cache + single slot)"

  # (a) Shell profiles — covers a shell-launched server and handoff-spawned ones.
  wrote=0
  for prof in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$prof" ] || continue
    if grep -q 'OLLAMA_FLASH_ATTENTION' "$prof" 2>/dev/null; then wrote=1; continue; fi
    printf '\n%s\nexport OLLAMA_FLASH_ATTENTION=1\nexport OLLAMA_KV_CACHE_TYPE=q8_0\nexport OLLAMA_NUM_PARALLEL=1\n' \
      "$perf_mark" >> "$prof" && wrote=1
  done
  if [ "$wrote" = 0 ]; then
    # No profile existed yet — create the shell-appropriate default.
    case "$OS" in Darwin) prof="$HOME/.zshrc" ;; *) prof="$HOME/.profile" ;; esac
    printf '\n%s\nexport OLLAMA_FLASH_ATTENTION=1\nexport OLLAMA_KV_CACHE_TYPE=q8_0\nexport OLLAMA_NUM_PARALLEL=1\n' \
      "$perf_mark" >> "$prof"
  fi
  export OLLAMA_FLASH_ATTENTION=1
  export OLLAMA_KV_CACHE_TYPE=q8_0
  export OLLAMA_NUM_PARALLEL=1
  STATUS_OLLAMA_PERF="on for new shells"

  # (b) Linux systemd service — auto-started as the `ollama` user; it ignores the
  # shell, so add a drop-in override carrying the same flags.
  if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 \
     && systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
    _dd="/etc/systemd/system/ollama.service.d"
    _conf="$_dd/10-handoff-perf.conf"
    _body='[Service]\nEnvironment="OLLAMA_FLASH_ATTENTION=1"\nEnvironment="OLLAMA_KV_CACHE_TYPE=q8_0"\nEnvironment="OLLAMA_NUM_PARALLEL=1"\n'
    if [ "$(id -u)" = 0 ]; then
      mkdir -p "$_dd" && printf '%b' "$_body" > "$_conf" \
        && systemctl daemon-reload 2>/dev/null && systemctl restart ollama 2>/dev/null \
        && STATUS_OLLAMA_PERF="on (systemd service + new shells)"
    elif command -v sudo >/dev/null 2>&1 \
      && sudo mkdir -p "$_dd" 2>/dev/null \
      && printf '%b' "$_body" | sudo tee "$_conf" >/dev/null 2>&1 \
      && sudo systemctl daemon-reload 2>/dev/null \
      && sudo systemctl restart ollama 2>/dev/null; then
      STATUS_OLLAMA_PERF="on (systemd service + new shells)"
    else
      STATUS_OLLAMA_PERF="on for new shells (systemd service needs root — see note)"
    fi
  fi

  # (c) macOS launchd — so a GUI Ollama.app inherits the flags too. Applies to
  # newly launched processes; the shell export is the durable path for the CLI.
  if [ "$OS" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl setenv OLLAMA_FLASH_ATTENTION 1 2>/dev/null || true
    launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0 2>/dev/null || true
    launchctl setenv OLLAMA_NUM_PARALLEL 1 2>/dev/null || true
    # launchctl setenv only affects processes started AFTER this point. If an
    # Ollama.app / server is already running, it keeps its old (untuned) env until
    # relaunched — and since it's up, handoff won't start its own tuned server.
    # Flag that so the summary can tell the user to restart Ollama.
    if curl -fsS "http://localhost:11434/api/tags" >/dev/null 2>&1; then
      STATUS_OLLAMA_PERF="on after you restart Ollama (a server is already running)"
    fi
  fi
}

# Per-component result, shown in the closing summary.
STATUS_CLI="not attempted"
# STATUS_SERVE="not attempted"  # TODO(peer-network)
STATUS_OLLAMA_PERF="not attempted"
STATUS_OLLAMA="not attempted"
STATUS_UV="not attempted"
STATUS_MLX="not attempted"
STATUS_LLAMACPP="not attempted"
STATUS_LATEX="not attempted"

printf '%s\n' "${BOLD}Installing handoff${RESET} ${DIM}(package: $PKG)${RESET}"

# 1. Node.js >= 18 (hard requirement — the CLI can't run without it).
if ! command -v node >/dev/null 2>&1; then
  fail "handoff needs Node.js 18 or newer.
  Install it from https://nodejs.org (or via nvm) and re-run this script."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Found Node $(node -v), but handoff needs Node 18 or newer.
  Upgrade from https://nodejs.org and re-run."
fi
ok "Node $(node -v) detected."

if ! command -v npm >/dev/null 2>&1; then
  fail "npm was not found — it normally ships with Node.js. Reinstall Node from https://nodejs.org"
fi

# 2. Install the handoff CLI.
# Prefer a local checkout when this script lives inside one (dev workflow);
# otherwise install the published package from the npm registry.
SELF="${0:-}"
case "$SELF" in
  */*) SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || echo '')" ;;
  *)   SELF_DIR="$(pwd)" ;;  # invoked as `sh install.sh` from its own directory
esac
# The installer may sit at the repo root or in a subfolder (e.g. installers/), so
# look for our package.json here and in the parent directories before giving up
# and installing from the registry.
CHECKOUT_ROOT=""
if [ -n "$SELF_DIR" ]; then
  for cand in "$SELF_DIR" "$SELF_DIR/.." "$SELF_DIR/../.."; do
    if [ -f "$cand/package.json" ] && grep -q '"ownhandoff"' "$cand/package.json" 2>/dev/null; then
      CHECKOUT_ROOT="$(cd "$cand" 2>/dev/null && pwd)"
      break
    fi
  done
fi
if [ -n "$CHECKOUT_ROOT" ]; then
  INSTALL_SRC="$CHECKOUT_ROOT"
  LOCAL_CHECKOUT=1
  info "Installing the handoff CLI from local checkout ($CHECKOUT_ROOT)..."
else
  INSTALL_SRC="$PKG"
  LOCAL_CHECKOUT=0
  info "Installing the handoff CLI globally with npm..."
fi

# `npm install -g <dir>` symlinks a local checkout into the global prefix, so
# handoff runs against THIS directory's node_modules at runtime. Make sure they
# exist and are built for the current OS/arch: a node_modules copied from
# another platform (e.g. a macOS checkout used on Linux) carries the wrong
# native binaries — esbuild/tsx — and crashes on launch with a cryptic
# "installed esbuild for another platform" error. `npm install` swaps in the
# right ones. The registry path installs its own deps, so scope this to local.
if [ "$LOCAL_CHECKOUT" = 1 ]; then
  info "Installing dependencies for this platform ($(uname -s)/$(uname -m))..."
  if ( cd "$INSTALL_SRC" && npm install ); then
    ok "Dependencies ready."
  else
    warn "Could not install checkout dependencies — run 'npm install' in $INSTALL_SRC, then re-run."
  fi
fi

GIT_SRC="git+https://github.com/handoff-org/handoff.git"

install_cli() {
  local src="$1"
  npm install -g "$src" 2>/dev/null && return 0
  npm install -g --force "$src" 2>/dev/null && return 0
  return 1
}

if install_cli "$INSTALL_SRC"; then
  ok "handoff CLI installed. The 'handoff' command is now on your PATH."
  STATUS_CLI="installed"
elif [ "$LOCAL_CHECKOUT" = 0 ] && install_cli "$GIT_SRC"; then
  # npm registry package not yet published — fall back to installing directly
  # from the GitHub repository.
  ok "handoff CLI installed from GitHub. The 'handoff' command is now on your PATH."
  STATUS_CLI="installed"
else
  warn "Global install failed (often an npm-prefix permissions issue)."
  info "  Fix perms: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
  info "  Or re-run with: sudo npm install -g $INSTALL_SRC"
  STATUS_CLI="FAILED"
fi

# TODO(peer-network): handoff-serve install — re-enable when relay.handoff.sh is deployed.
# 3. handoff-serve — skipped until peer network relay is live.

# 4. Ollama (default backend) — works on macOS and Linux.
printf '\n'
if command -v ollama >/dev/null 2>&1; then
  ok "Ollama already installed."
  STATUS_OLLAMA="already installed"
else
  info "Installing Ollama (default local model backend)..."
  case "$OS" in
    Darwin)
      # Prefer Homebrew — it installs the CLI only and avoids the GUI-app launch
      # step in the official script (which can fail with "Unable to find application
      # named 'Ollama'" on some macOS setups, even when the CLI installed fine).
      if command -v brew >/dev/null 2>&1; then
        HOMEBREW_NO_REQUIRE_TAP_TRUST=1 brew install ollama || true
      else
        # No Homebrew: use the official script, but don't rely on its exit code —
        # it tries to open the .app after install and may fail even when the CLI
        # binary landed in /usr/local/bin correctly.
        curl -fsSL https://ollama.com/install.sh | sh || true
      fi
      if command -v ollama >/dev/null 2>&1; then
        ok "Ollama installed."
        STATUS_OLLAMA="installed"
      else
        warn "Ollama install failed — install manually from https://ollama.com/download"
        STATUS_OLLAMA="FAILED"
      fi
      ;;
    Linux)
      # The official script sets up a systemd service so the server auto-starts.
      # Same caveat: check the CLI, not the script's exit code.
      curl -fsSL https://ollama.com/install.sh | sh || true
      if command -v ollama >/dev/null 2>&1; then
        ok "Ollama installed."
        STATUS_OLLAMA="installed"
      else
        warn "Ollama install failed — install manually from https://ollama.com/download"
        STATUS_OLLAMA="FAILED"
      fi
      ;;
    *)
      warn "Unsupported OS ($OS). Install Ollama manually from https://ollama.com/download"
      STATUS_OLLAMA="unsupported OS"
      ;;
  esac
fi

# 4b. Turn on Ollama's flash attention + q8 KV cache by default (faster, leaner
# local inference). Only meaningful when Ollama is present.
if command -v ollama >/dev/null 2>&1; then
  enable_ollama_perf
  ok "Ollama speed-ups (flash attention + q8 KV cache): $STATUS_OLLAMA_PERF."
  case "$STATUS_OLLAMA_PERF" in
    *needs\ root*)
      info "  Enable it for the systemd service with:"
      info "    sudo systemctl edit ollama.service   # add, under [Service]:"
      info "      Environment=\"OLLAMA_FLASH_ATTENTION=1\""
      info "      Environment=\"OLLAMA_KV_CACHE_TYPE=q8_0\""
      info "  then: sudo systemctl restart ollama"
      ;;
    *restart\ Ollama*)
      warn "  Ollama is already running, so the speed-ups apply only after a restart."
      info "  Quit Ollama (menu-bar icon → Quit) and reopen it, or reboot. A fresh"
      info "  install where Ollama isn't running yet gets them automatically."
      ;;
  esac
fi

# 5. uv — Python project & environment manager used by handoff's experiment runner.
#    With uv, each project's experiments/ directory becomes a reproducible Python
#    project (pyproject.toml + uv.lock) that can be pushed to GitHub.
printf '\n'
if command -v uv >/dev/null 2>&1; then
  ok "uv already installed."
  STATUS_UV="already installed"
else
  info "Installing uv (Python environment manager for experiments)..."
  if curl -LsSf https://astral.sh/uv/install.sh | sh -s -- -y; then
    # Make uv available in this session without requiring a shell restart.
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if command -v uv >/dev/null 2>&1; then
      ok "uv installed."
      STATUS_UV="installed"
    else
      warn "uv installed — open a new shell (or add ~/.local/bin to PATH) to use it."
      STATUS_UV="installed (new shell needed)"
    fi
  else
    warn "uv install failed. Install manually: https://docs.astral.sh/uv/getting-started/installation/"
    STATUS_UV="FAILED"
  fi
fi

# 6. mlx-lm — Apple Silicon macOS only (MLX is Apple's framework; it genuinely
#    does not exist on Linux/Windows or Intel Macs).
printf '\n'
if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
  if python3 -c "import mlx_lm" >/dev/null 2>&1; then
    ok "mlx-lm already installed."
    STATUS_MLX="already installed"
  else
    # mlx-lm needs Python 3. Install it via Homebrew if it's missing.
    if ! command -v python3 >/dev/null 2>&1; then
      info "Python 3 not found — installing it for mlx-lm..."
      if command -v brew >/dev/null 2>&1; then
        HOMEBREW_NO_REQUIRE_TAP_TRUST=1 brew install python || warn "Could not install Python via Homebrew."
      else
        warn "Homebrew not found — install Python 3 from https://python.org, then: pip3 install mlx-lm"
      fi
    fi

    if command -v python3 >/dev/null 2>&1; then
      info "Installing mlx-lm (MLX backend for Apple Silicon)..."
      # Plain pip first; fall back to --break-system-packages for PEP 668 setups.
      if python3 -m pip install mlx-lm --quiet 2>/dev/null || \
         python3 -m pip install mlx-lm --quiet --break-system-packages 2>/dev/null; then
        ok "mlx-lm installed."
        STATUS_MLX="installed"
      else
        warn "Could not install mlx-lm automatically. Try: pip3 install mlx-lm"
        STATUS_MLX="FAILED"
      fi
    else
      STATUS_MLX="FAILED (no Python 3)"
    fi
  fi
else
  info "${DIM}mlx-lm skipped — Apple Silicon macOS only (MLX is Apple-only).${RESET}"
  STATUS_MLX="n/a (needs Apple Silicon)"
fi

# 7. llama.cpp (llama-server)
printf '\n'
if command -v llama-server >/dev/null 2>&1; then
  ok "llama.cpp (llama-server) already installed."
  STATUS_LLAMACPP="already installed"
else
  info "Installing llama.cpp (llama-server backend)..."
  case "$OS" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        if HOMEBREW_NO_REQUIRE_TAP_TRUST=1 brew install llama.cpp; then
          ok "llama.cpp installed."
          STATUS_LLAMACPP="installed"
        else
          warn "Homebrew install failed — download from https://github.com/ggml-org/llama.cpp/releases"
          STATUS_LLAMACPP="FAILED"
        fi
      else
        warn "Homebrew not found. Install it (https://brew.sh) then run: brew install llama.cpp"
        STATUS_LLAMACPP="FAILED (needs Homebrew)"
      fi
      ;;
    Linux)
      # Try a prebuilt release binary; fall back to build-from-source guidance.
      if install_llamacpp_linux; then
        ok "llama.cpp installed to ~/.handoff/bin (added to PATH)."
        STATUS_LLAMACPP="installed"
      else
        warn "Could not auto-install a llama.cpp prebuilt binary."
        info "  Build from source: https://github.com/ggml-org/llama.cpp"
        STATUS_LLAMACPP="FAILED"
      fi
      ;;
    *)
      warn "Unsupported OS ($OS). Download from https://github.com/ggml-org/llama.cpp/releases"
      STATUS_LLAMACPP="unsupported OS"
      ;;
  esac
fi

# 8. LaTeX — local paper compilation (pdflatex / latexmk).
printf '\n'
if command -v pdflatex >/dev/null 2>&1; then
  ok "LaTeX already installed."
  STATUS_LATEX="already installed"
else
  info "Installing LaTeX (needed to compile ACL / NeurIPS papers locally)..."
  case "$OS" in
    Darwin)
      if install_latex_macos; then
        ok "LaTeX installed (BasicTeX + template packages)."
        STATUS_LATEX="installed"
      else
        warn "LaTeX install failed. Install manually: https://tug.org/mactex/ or brew install --cask mactex-no-gui"
        STATUS_LATEX="FAILED"
      fi
      ;;
    Linux)
      if install_latex_linux; then
        ok "LaTeX installed."
        STATUS_LATEX="installed"
      else
        warn "LaTeX install failed. Install manually: sudo apt-get install texlive-latex-extra texlive-fonts-extra latexmk"
        STATUS_LATEX="FAILED"
      fi
      ;;
    *)
      warn "Unsupported OS ($OS). Install LaTeX manually from https://tug.org/mactex/"
      STATUS_LATEX="unsupported OS"
      ;;
  esac
fi

# 9. Summary.
printf '\n'
printf '%s\n' "${BOLD}Setup summary${RESET}"
info "  handoff CLI  : $STATUS_CLI"
info "  Ollama       : $STATUS_OLLAMA"
info "  Ollama tuning: $STATUS_OLLAMA_PERF"
info "  uv           : $STATUS_UV"
info "  mlx-lm       : $STATUS_MLX"
info "  llama.cpp    : $STATUS_LLAMACPP"
info "  LaTeX        : $STATUS_LATEX"
printf '\n'
case "$STATUS_CLI" in
  installed) ok "Done! Start handoff by running: ${BOLD}handoff${RESET}" ;;
  *)         warn "handoff CLI did not install — see the note above before running 'handoff'." ;;
esac
