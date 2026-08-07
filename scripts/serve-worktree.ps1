# serve-worktree.ps1
# Boots the dev server for an implementer worktree on its own port (5000 + issue)
# and opens a browser window with the frontend and the admin panel in two tabs.
#
# Usage (from the main checkout):
#   ./scripts/serve-worktree.ps1 -Issue 40        # start server on :5040 + open browser
#   ./scripts/serve-worktree.ps1 -Issue 40 -Stop  # stop the worktree server
#   ./scripts/serve-worktree.ps1 -Issue 40 -NoBrowser
#
# On first boot the worktree's .env and data.db are provisioned from the main
# checkout, so the admin account and all content carry over -- no admin re-setup
# per worktree, no port juggling.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$Issue,

  [switch]$Stop,

  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$main = Split-Path $PSScriptRoot -Parent          # main checkout (repo root)
$wtRoot = Join-Path (Split-Path $main -Parent) "kite-compass.worktrees"
$wt = Join-Path $wtRoot "kc-impl-$Issue"
$port = 5000 + $Issue

if (-not (Test-Path $wt)) {
  Write-Error "Worktree not found: $wt. Create it first, e.g.:
  git worktree add $wt -b feat/$Issue-<slug> origin/main
  npm ci --prefix $wt"
}

if ($Stop) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  Write-Host "Stopped server on port $port (if it was running)."
  exit 0
}

# --- .env: ensure it exists and points at this worktree's port + dev mode ---
if (-not (Test-Path "$wt\.env")) {
  if (Test-Path "$main\.env") {
    Copy-Item "$main\.env" "$wt\.env"
  } else {
    $secret = & node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"
    Set-Content "$wt\.env" "AUTH_SECRET=$secret`nPORT=$port`nNODE_ENV=development"
  }
}
$envLines = Get-Content "$wt\.env"
$envLines = $envLines -replace '^PORT=.*', "PORT=$port" -replace '^NODE_ENV=.*', 'NODE_ENV=development'
if (-not ($envLines -match '^PORT=')) { $envLines += "PORT=$port" }
if (-not ($envLines -match '^NODE_ENV=')) { $envLines += 'NODE_ENV=development' }
Set-Content "$wt\.env" $envLines

# --- data.db: copy the admin account + content from the main checkout once ---
if (-not (Test-Path "$wt\data.db")) {
  if (Test-Path "$main\data.db") {
    foreach ($f in @("data.db", "data.db-wal", "data.db-shm", "data.db-journal")) {
      if (Test-Path "$main\$f") { Copy-Item "$main\$f" "$wt\$f" }
    }
    Write-Host "Copied data.db from the main checkout (admin account + content carried over)."
  } else {
    Write-Host "Main checkout has no data.db; seeding the worktree..."
    Push-Location $wt
    try { & npm run seed } finally { Pop-Location }
  }
}

# --- start the server (detached) unless the port is already taken ---
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $first = $listening | Select-Object -First 1
  Write-Host "Port $port is already in use (pid $($first.OwningProcess)) - server assumed running."
} else {
  $log = Join-Path $wt "dev-server.log"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev > dev-server.log 2>&1" `
    -WorkingDirectory $wt -WindowStyle Hidden
  Write-Host "Started dev server for issue #$Issue on http://localhost:$port (log: $log)"
}

# --- open a browser window with frontend + admin in two tabs ---
if (-not $NoBrowser) {
  $front = "http://localhost:$port/"
  $admin = "http://localhost:$port/#/admin"
  $browser = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\Mozilla Firefox\firefox.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--new-window", $front, $admin
  } else {
    Start-Process $front
    Start-Process $admin
  }
  Write-Host "Opened browser: $front  |  $admin"
}
