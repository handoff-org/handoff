# handoff uninstaller for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.ps1 | iex
#
# Removes the handoff CLI and llama.cpp, and reverts the Ollama env tweaks
# handoff set. Ollama itself and its models (%USERPROFILE%\.ollama) are KEPT -
# handoff often uses an Ollama you already had.
# Pass -Purge to also delete ~\.handoff\ (all config, skills, projects, cache)
# AND remove Ollama plus all its downloaded models.
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.ps1))) -Purge
param(
  [switch]$Purge
)

# Best-effort teardown: one failing step (a locked file, an already-removed
# package) must never abort the rest, so we do NOT use 'Stop' here.
$ErrorActionPreference = 'Continue'
$Pkg     = 'ownhandoff'
$DataDir = Join-Path $HOME '.handoff'

function Info($m) { Write-Host $m }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

Write-Host "Uninstalling handoff " -NoNewline
Write-Host "(package: $Pkg)" -ForegroundColor DarkGray

# 1. Remove the npm package.
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Warn "npm not found - skipping package removal (handoff may already be uninstalled)."
} else {
  Info "Removing $Pkg from npm global packages..."
  npm uninstall -g $Pkg
  if ($LASTEXITCODE -eq 0) {
    Ok "Package removed. The 'handoff' command is no longer available."
  } else {
    Warn "npm uninstall exited with an error - the package may already be removed."
  }
}

# 2. Ollama. handoff often uses a pre-existing Ollama (the installer skips it
# when already present), and %USERPROFILE%\.ollama can hold many GB of models
# the user cares about - so removing the binary and models is gated behind
# -Purge, symmetric with how ~\.handoff is treated. A plain uninstall leaves
# Ollama and its models untouched (handoff's own env tweaks are still reverted
# in step 2b).
Write-Host ""
$OllamaData = Join-Path $HOME '.ollama'
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Info "Ollama not found - skipping."
} elseif ($Purge) {
  # Stop any running ollama process before touching its files.
  Stop-Process -Name ollama -ErrorAction SilentlyContinue

  # %USERPROFILE%\.ollama holds all model blobs, manifests, and keys.
  if (Test-Path $OllamaData) {
    Info "Removing Ollama data and models ($OllamaData)..."
    Remove-Item -Recurse -Force $OllamaData -ErrorAction SilentlyContinue
    Ok "Ollama data removed."
  }

  # Uninstall the binary.
  Info "Uninstalling Ollama..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget uninstall Ollama.Ollama --silent 2>$null
    if ($LASTEXITCODE -eq 0) {
      Ok "Ollama uninstalled."
    } else {
      Warn "winget uninstall failed - remove Ollama manually via Add/Remove Programs."
    }
  } else {
    Warn "winget not available - remove Ollama manually via Add/Remove Programs."
  }
} else {
  Info "Keeping Ollama and your models ($OllamaData) - handoff often uses an Ollama you already had, so it's left in place."
  Info "  Remove Ollama and all its models too by re-running with -Purge."
}

# 2b. Remove the persistent Ollama speed-up env vars the installer set (User
# scope + current session). Safe even if they were never set.
[Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', $null, 'User')
Remove-Item Env:\OLLAMA_FLASH_ATTENTION -ErrorAction SilentlyContinue
Remove-Item Env:\OLLAMA_KV_CACHE_TYPE -ErrorAction SilentlyContinue
Remove-Item Env:\OLLAMA_NUM_PARALLEL -ErrorAction SilentlyContinue
Ok "Removed handoff's Ollama speed-up environment variables."

# 3. mlx-lm — not applicable on Windows.
Write-Host ""
Info "mlx-lm (MLX backend): Apple Silicon macOS only — skipping."

# 4. llama.cpp
Write-Host ""
if (Get-Command llama-server -ErrorAction SilentlyContinue) {
  Info "Uninstalling llama.cpp..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget uninstall llama.cpp --silent 2>$null
    if ($LASTEXITCODE -eq 0) {
      Ok "llama.cpp uninstalled."
    } else {
      Warn "winget uninstall failed - remove llama.cpp manually via Add/Remove Programs."
    }
  } else {
    Warn "winget not available - remove llama.cpp manually via Add/Remove Programs."
  }
} else {
  Info "llama.cpp not found - skipping."
}

# 5. Optionally remove handoff user data.
if ($Purge) {
  if (Test-Path $DataDir) {
    Info "Removing $DataDir (config, skills, projects, cache)..."
    Remove-Item -Recurse -Force $DataDir
    Ok "User data removed."
  } else {
    Info "$DataDir not found - nothing to remove."
  }
} else {
  # Report what was intentionally preserved. -Purge takes out handoff's data dir
  # *and* Ollama + its models.
  $keptData   = Test-Path $DataDir
  $keptOllama = [bool](Get-Command ollama -ErrorAction SilentlyContinue)
  if ($keptData -or $keptOllama) {
    Write-Host ""
    if ($keptData)   { Warn "Your data in $DataDir was kept." }
    if ($keptOllama) { Warn "Ollama and its models ($OllamaData) were kept." }
    Info "To remove everything handoff can (data + Ollama + models), re-run with -Purge:"
    Info "  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/uninstall.ps1))) -Purge"
    if ($keptData) { Info "Or delete just handoff's data manually: Remove-Item -Recurse -Force $DataDir" }
  }
}

Write-Host ""
Ok "Done."
