# handoff installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/handoff-org/handoff/master/installers/install.ps1 | iex
#
# Detects Node 18+, installs the `ownhandoff` npm package globally (the command
# it provides is `handoff`), and points you at Ollama for local models.

$ErrorActionPreference = 'Stop'
$Pkg = 'ownhandoff'

function Info($m) { Write-Host $m }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host "Installing handoff " -NoNewline
Write-Host "(package: $Pkg)" -ForegroundColor DarkGray

# 1. Node.js >= 18
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail @"
handoff needs Node.js 18 or newer.
  Install it from https://nodejs.org and re-run this script.
"@
}
$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) {
  Fail "Found Node $(node -v), but handoff needs Node 18 or newer. Upgrade from https://nodejs.org"
}
Ok "Node $(node -v) detected."

# 2. npm (ships with Node)
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm was not found - it normally ships with Node.js. Reinstall Node from https://nodejs.org"
}

# 3. Install the handoff CLI.
# Prefer a local checkout when this script lives inside one (dev workflow);
# otherwise install the published package from the npm registry.
$InstallSrc = $Pkg
$LocalCheckout = $false
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
foreach ($cand in @($scriptDir, (Join-Path $scriptDir '..'), (Join-Path $scriptDir '..\..'))) {
  $pkgJson = Join-Path $cand 'package.json'
  if ((Test-Path $pkgJson) -and (Select-String -Path $pkgJson -Pattern '"ownhandoff"' -Quiet)) {
    $InstallSrc = (Resolve-Path $cand).Path
    $LocalCheckout = $true
    break
  }
}

if ($LocalCheckout) {
  Info "Installing the handoff CLI from local checkout ($InstallSrc)..."
  # Rebuild deps for THIS platform so bundled native binaries (esbuild/tsx) match;
  # a node_modules copied from another OS/arch crashes on launch.
  Info "Installing dependencies for this platform..."
  Push-Location $InstallSrc
  npm install
  Pop-Location
} else {
  Info "Installing $Pkg globally with npm..."
}

npm install -g $InstallSrc
if ($LASTEXITCODE -ne 0) {
  # A previous install can leave a stale 'handoff' bin that makes npm abort with
  # EEXIST; --force overwrites it, keeping re-runs of this installer idempotent.
  Warn "First attempt failed - retrying with --force (clears a stale 'handoff' bin)..."
  npm install -g --force $InstallSrc
}
if ($LASTEXITCODE -ne 0) {
  Fail @"
Global install failed.
  Try opening PowerShell as Administrator and re-running, or check your npm global prefix.
"@
}
Ok "Installed. The 'handoff' command is now available."

# 4. Ollama
Write-Host ""
if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Ok "Ollama already installed."
} else {
  Info "Installing Ollama (the default local model backend)..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      Warn "winget install failed. Download Ollama from https://ollama.com/download and re-run."
    } else {
      Ok "Ollama installed."
      # Refresh PATH so the ollama command is found without reopening the shell.
      $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                  [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    }
  } else {
    Warn "winget not available. Download Ollama from https://ollama.com/download and re-run."
  }
}

# 4b. Enable Ollama's flash attention + q8 KV cache by default (faster, leaner
# local inference). Set as persistent USER environment variables, which the
# Ollama server reads at startup, plus the current session.
[Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE', 'q8_0', 'User')
$env:OLLAMA_FLASH_ATTENTION = '1'
$env:OLLAMA_KV_CACHE_TYPE = 'q8_0'
Ok "Ollama speed-ups enabled: flash attention + q8 KV cache (restart Ollama to apply)."

# 5. uv — Python project & environment manager used by handoff's experiment runner.
#    With uv, each project's experiments/ directory becomes a reproducible Python
#    project (pyproject.toml + uv.lock) that can be pushed to GitHub.
Write-Host ""
if (Get-Command uv -ErrorAction SilentlyContinue) {
  Ok "uv already installed."
} else {
  Info "Installing uv (Python environment manager for experiments)..."
  $uvOk = $false
  # Try winget first (no UAC prompt, installs for the current user).
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install astral-sh.uv --silent --accept-package-agreements --accept-source-agreements 2>$null
    if ($LASTEXITCODE -eq 0) { $uvOk = $true }
  }
  # Fallback: official PowerShell installer.
  if (-not $uvOk) {
    try {
      irm https://astral.sh/uv/install.ps1 | iex
      $uvOk = $true
    } catch {
      Warn "uv install failed. Install manually: https://docs.astral.sh/uv/getting-started/installation/"
    }
  }
  if ($uvOk) {
    # Refresh PATH so uv is visible in the current session.
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (Get-Command uv -ErrorAction SilentlyContinue) {
      Ok "uv installed."
    } else {
      Warn "uv installed — open a new terminal to use it."
    }
  }
}

# 6. mlx-lm — not available on Windows (Apple Silicon macOS only)
Write-Host ""
Info "mlx-lm (MLX backend): Apple Silicon macOS only — not applicable on Windows."

# 7. LaTeX — local paper compilation (pdflatex / latexmk).
Write-Host ""
if (Get-Command pdflatex -ErrorAction SilentlyContinue) {
  Ok "LaTeX already installed."
} else {
  Info "Installing LaTeX / MiKTeX (needed to compile ACL / NeurIPS papers locally)..."
  $latexOk = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install MiKTeX.MiKTeX --silent --accept-package-agreements --accept-source-agreements 2>$null
    if ($LASTEXITCODE -eq 0) { $latexOk = $true }
  }
  if ($latexOk) {
    # Refresh PATH so miktex binaries are visible in this session.
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    Ok "MiKTeX installed. MiKTeX will auto-install missing packages on first compile."
  } else {
    Warn "LaTeX install failed. Download MiKTeX from https://miktex.org/download and install, then re-run."
  }
}

# 8. llama.cpp — llama-server
Write-Host ""
if (Get-Command llama-server -ErrorAction SilentlyContinue) {
  Ok "llama.cpp (llama-server) already installed."
} else {
  Info "Installing llama.cpp (llama-server backend)..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install llama.cpp --silent --accept-package-agreements --accept-source-agreements 2>$null
    if ($LASTEXITCODE -eq 0) {
      Ok "llama.cpp installed."
    } else {
      Warn "winget install failed. Download llama-server from https://github.com/ggerganov/llama.cpp/releases"
    }
  } else {
    Warn "winget not available. Download llama-server from https://github.com/ggerganov/llama.cpp/releases"
  }
}

# 9. Done
Write-Host ""
Ok "Done!"
Info "Start handoff by running: handoff"
