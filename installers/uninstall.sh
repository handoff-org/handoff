#!/bin/sh
# handoff uninstaller for Linux & macOS.
#   curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash
#
# Removes the handoff CLI, mlx-lm, and llama.cpp, and reverts the tweaks handoff
# made to your shell/Ollama config. Ollama itself and its models (~/.ollama) are
# KEPT — handoff often uses an Ollama you already had.
# Pass --purge to also delete ~/.handoff/ (config, skills, projects, cache) AND
# remove Ollama plus all its downloaded models.
#   curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash -s -- --purge
#
# Best-effort like the installer: -u catches unset vars, but we deliberately do
# NOT set -e — one step failing (a missing binary, a permission-denied rm) must
# never abort the rest of the teardown and leave the system half-removed.
set -u

PKG="ownhandoff"
DATA_DIR="${HOME}/.handoff"
OS="$(uname -s)"
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
  esac
done

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

# Reverse what install.sh's enable_ollama_perf() set up: the shell-profile
# exports, the Linux systemd drop-in, and the macOS launchd session vars. Runs
# regardless of whether the ollama binary is still present, because the profile
# lines persist independently. Best-effort; never aborts under `set -e`.
disable_ollama_perf() {
  # (a) Shell profiles — strip the exact block the installer appended (guarded by
  # its marker so we don't touch a user's own unrelated OLLAMA_* exports).
  for prof in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$prof" ] || continue
    grep -q '# handoff: faster Ollama' "$prof" 2>/dev/null || continue
    tmp="$(mktemp)" || continue
    if grep -v -e '# handoff: faster Ollama' \
               -e 'export OLLAMA_FLASH_ATTENTION=1' \
               -e 'export OLLAMA_KV_CACHE_TYPE=q8_0' \
               -e 'export OLLAMA_NUM_PARALLEL=1' "$prof" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$prof" && DID_PERF=1
    else
      rm -f "$tmp"
    fi
  done

  # (b) Linux systemd drop-in.
  _conf="/etc/systemd/system/ollama.service.d/10-handoff-perf.conf"
  if [ "$OS" = "Linux" ] && [ -f "$_conf" ]; then
    if [ "$(id -u)" = 0 ]; then
      rm -f "$_conf" 2>/dev/null || true
      rmdir /etc/systemd/system/ollama.service.d 2>/dev/null || true
      command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload 2>/dev/null || true
      DID_PERF=1
    elif command -v sudo >/dev/null 2>&1; then
      sudo rm -f "$_conf" 2>/dev/null || true
      sudo rmdir /etc/systemd/system/ollama.service.d 2>/dev/null || true
      sudo systemctl daemon-reload 2>/dev/null || true
      DID_PERF=1
    else
      warn "Left $_conf (needs root). Remove with: sudo rm $_conf"
    fi
  fi

  # (c) macOS launchd session vars.
  if [ "$OS" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl unsetenv OLLAMA_FLASH_ATTENTION 2>/dev/null || true
    launchctl unsetenv OLLAMA_KV_CACHE_TYPE 2>/dev/null || true
    launchctl unsetenv OLLAMA_NUM_PARALLEL 2>/dev/null || true
  fi
  return 0
}

printf '%s\n' "${BOLD}Uninstalling handoff${RESET} ${DIM}(package: $PKG)${RESET}"

# 1. Remove the npm package.
if ! command -v npm >/dev/null 2>&1; then
  warn "npm not found — skipping package removal (handoff may already be uninstalled)."
else
  info "Removing $PKG from npm global packages..."
  if npm uninstall -g "$PKG"; then
    ok "Package removed. The 'handoff' command is no longer available."
  else
    warn "npm uninstall exited with an error — the package may already be removed."
  fi
fi

# 2. Ollama. handoff often uses a pre-existing Ollama (the installer skips it
# when already present), and ~/.ollama can hold many GB of models the user
# cares about — so removing the binary and models is gated behind --purge,
# symmetric with how ~/.handoff is treated. A plain uninstall leaves Ollama and
# its models untouched (handoff's own tweaks are still reverted in step 2b).
printf '\n'
if ! command -v ollama >/dev/null 2>&1; then
  info "${DIM}Ollama not found — skipping.${RESET}"
elif [ "$PURGE" -eq 1 ]; then
  # Kill all Ollama processes (GUI menu-bar app + serve subprocess) by app path.
  pkill -f "Ollama.app" 2>/dev/null || true
  pkill -f "ollama serve" 2>/dev/null || true
  sleep 1  # let processes exit before removing files

  # ~/.ollama holds all model blobs, manifests, and keys.
  if [ -d "${HOME}/.ollama" ]; then
    info "Removing Ollama data and models (~/.ollama)..."
    rm -rf "${HOME}/.ollama"
    ok "Ollama data removed."
  fi

  # Uninstall the binary / app.
  info "Uninstalling Ollama..."
  case "$OS" in
    Darwin)
      UNINSTALLED=0
      if command -v brew >/dev/null 2>&1; then
        if brew list ollama >/dev/null 2>&1; then
          brew uninstall ollama && UNINSTALLED=1 || warn "Homebrew uninstall failed."
        elif brew list --cask ollama >/dev/null 2>&1; then
          brew uninstall --cask ollama && UNINSTALLED=1 || warn "Homebrew cask uninstall failed."
        fi
      fi
      if [ "$UNINSTALLED" -eq 0 ]; then
        rm -rf /Applications/Ollama.app 2>/dev/null || true
        rm -f /usr/local/bin/ollama /usr/bin/ollama 2>/dev/null || true
      fi
      rm -rf "${HOME}/Library/Application Support/Ollama" 2>/dev/null || true
      ok "Ollama uninstalled."
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        systemctl stop ollama 2>/dev/null || true
        systemctl disable ollama 2>/dev/null || true
        rm -f /etc/systemd/system/ollama.service 2>/dev/null || true
        systemctl daemon-reload 2>/dev/null || true
      fi
      if rm -f /usr/local/bin/ollama 2>/dev/null; then
        ok "Ollama uninstalled."
      else
        warn "Could not remove /usr/local/bin/ollama — run with sudo to finish:"
        info "  sudo rm /usr/local/bin/ollama"
      fi
      rm -rf /usr/share/ollama 2>/dev/null || true
      ;;
    *)
      warn "Unsupported OS — remove Ollama manually."
      ;;
  esac
else
  info "Keeping Ollama and your models (~/.ollama) — handoff often uses an"
  info "Ollama you already had, so it's left in place."
  info "${DIM}  Remove Ollama and all its models too by re-running with --purge.${RESET}"
fi

# 2b. Undo the Ollama speed-ups the installer configured (shell exports, systemd
# drop-in, launchd vars). Always attempt this — the profile lines outlive the binary.
DID_PERF=0
disable_ollama_perf
if [ "$DID_PERF" = 1 ]; then ok "Removed handoff's Ollama speed-up settings."; fi

# 3. mlx-lm
printf '\n'
if python3 -c "import mlx_lm" >/dev/null 2>&1; then
  info "Uninstalling mlx-lm..."
  if python3 -m pip uninstall mlx-lm -y 2>/dev/null || \
     python3 -m pip uninstall mlx-lm -y --break-system-packages 2>/dev/null; then
    ok "mlx-lm removed."
  else
    warn "Could not remove mlx-lm — try: pip3 uninstall mlx-lm -y"
  fi
else
  info "${DIM}mlx-lm not found — skipping.${RESET}"
fi

# 4. llama.cpp. Detect the binary directly (not just via PATH) because a
# `curl | bash` uninstall runs non-interactively and won't have ~/.handoff/bin
# sourced from the shell profile.
printf '\n'
LLAMA_BIN="$(command -v llama-server 2>/dev/null || true)"
if [ -z "$LLAMA_BIN" ] && [ -f "${HOME}/.handoff/bin/llama-server" ]; then
  LLAMA_BIN="${HOME}/.handoff/bin/llama-server"
fi
if [ -n "$LLAMA_BIN" ]; then
  info "Uninstalling llama.cpp..."
  case "$OS" in
    Darwin)
      if command -v brew >/dev/null 2>&1 && brew list llama.cpp >/dev/null 2>&1; then
        brew uninstall llama.cpp && ok "llama.cpp uninstalled." || warn "Homebrew uninstall failed."
      else
        warn "llama.cpp was not installed via Homebrew — remove it manually."
      fi
      ;;
    Linux)
      REMOVED=0
      # The installer unpacks the whole llama.cpp release into ~/.handoff/bin
      # (llama-server plus its bundled .so libraries and sibling binaries), so
      # remove the entire directory — deleting just the llama-server file would
      # strand the shared libs. This dir is created solely by handoff.
      if [ -d "${HOME}/.handoff/bin" ]; then
        rm -rf "${HOME}/.handoff/bin" 2>/dev/null && REMOVED=1 \
          || warn "Could not remove ${HOME}/.handoff/bin — remove it manually."
      fi
      # A manual/system install may also have dropped the binary on the PATH.
      for bin in /usr/local/bin/llama-server /usr/bin/llama-server; do
        if [ -f "$bin" ]; then
          rm -f "$bin" 2>/dev/null && REMOVED=1 || warn "Could not remove $bin — try: sudo rm $bin"
        fi
      done
      # Strip the PATH lines the installer added to shell profiles.
      for prof in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
        [ -f "$prof" ] || continue
        if grep -q '.handoff/bin' "$prof" 2>/dev/null; then
          tmp="$(mktemp)"
          if grep -v -e '# handoff local backends' -e '.handoff/bin' "$prof" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$prof"
          else
            rm -f "$tmp"
          fi
        fi
      done
      [ "$REMOVED" -eq 1 ] && ok "llama-server removed." || \
        warn "llama.cpp binary not found in standard locations — remove manually."
      ;;
    *)
      warn "Unsupported OS — remove llama.cpp manually."
      ;;
  esac
else
  info "${DIM}llama.cpp not found — skipping.${RESET}"
fi

# 5. Optionally remove handoff user data.
if [ "$PURGE" -eq 1 ]; then
  if [ -d "$DATA_DIR" ]; then
    info "Removing $DATA_DIR (config, skills, projects, cache)..."
    rm -rf "$DATA_DIR"
    ok "User data removed."
  else
    info "${DIM}$DATA_DIR not found — nothing to remove.${RESET}"
  fi
else
  # Plain uninstall: report what was intentionally preserved, and how to remove
  # it. --purge takes out handoff's data dir *and* Ollama + its models.
  kept_data=0; kept_ollama=0
  [ -d "$DATA_DIR" ] && kept_data=1
  command -v ollama >/dev/null 2>&1 && kept_ollama=1
  if [ "$kept_data" = 1 ] || [ "$kept_ollama" = 1 ]; then
    printf '\n'
    [ "$kept_data" = 1 ]   && warn "Your data in $DATA_DIR was kept."
    [ "$kept_ollama" = 1 ] && warn "Ollama and its models (~/.ollama) were kept."
    info "${DIM}To remove everything handoff can (data + Ollama + models), re-run with --purge:${RESET}"
    info "  curl -fsSL https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.sh | bash -s -- --purge"
    [ "$kept_data" = 1 ] && info "${DIM}Or delete just handoff's data manually:  rm -rf $DATA_DIR${RESET}"
  fi
fi

printf '\n'
ok "Done."
