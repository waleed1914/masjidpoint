# Puts the platform online from this PC so someone elsewhere can look at it — a client, say.
#
#   powershell -ExecutionPolicy Bypass -File scripts\preview.ps1
#
# It starts the server with a password in front of everything (PREVIEW_PASSWORD), opens a
# Cloudflare tunnel, and prints the address and credentials to hand over. Close the window, or
# run scripts\preview-stop.ps1, and the site is offline again.
#
# The password matters: GET /api/state returns every record including password hashes, and
# PUT /api/collection/:key rewrites a whole collection without authenticating. Both are fine on a
# machine only you can reach, and neither is safe on the open internet. The gate is what makes
# the difference, so never start the tunnel against a server without PREVIEW_PASSWORD set.

param(
  [int]$Port = 4174,
  [string]$User = 'client',
  [string]$Password = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

if (-not (Test-Path $cloudflared)) {
  Write-Host "cloudflared is not installed at $cloudflared" -ForegroundColor Red
  Write-Host "Install it with:  winget install --id Cloudflare.cloudflared"
  exit 1
}

if (-not $Password) {
  $Password = -join ((48..57) + (97..122) | Get-Random -Count 10 | ForEach-Object { [char]$_ })
}

# Free the port, so a server started earlier without the password gate cannot be the one exposed.
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "Stopping the server already on port $Port..."
  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Milliseconds 800
}

$env:PORT = "$Port"
$env:PREVIEW_USER = $User
$env:PREVIEW_PASSWORD = $Password
Write-Host "Starting the server on port $Port..."
$server = Start-Process node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru

# Wait for it, and confirm the gate is actually on before anything is exposed.
$gated = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try { Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3 | Out-Null }
  catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { $gated = $true; break } }
}
if (-not $gated) {
  Write-Host "The server did not come up with the password gate on. Not opening a tunnel." -ForegroundColor Red
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  exit 1
}

$log = Join-Path $env:TEMP 'masjidpoint-tunnel.log'
if (Test-Path $log) { Remove-Item $log -Force }
Write-Host "Opening the tunnel..."
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList "tunnel --url http://127.0.0.1:$Port --logfile `"$log`"" -WindowStyle Hidden -PassThru

$publicUrl = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $publicUrl = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
      ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Select-Object -First 1
    if ($publicUrl) { break }
  }
}

if (-not $publicUrl) {
  Write-Host "The tunnel did not report an address. Last lines of $log :" -ForegroundColor Red
  Get-Content $log -Tail 10 -ErrorAction SilentlyContinue
  exit 1
}

# Written without a byte-order mark: PowerShell's utf8 encoding adds one, and JSON.parse in Node
# rejects it, so anything reading this back would fail on a stray character it cannot see.
$state = @{ url = $publicUrl; user = $User; password = $Password; serverPid = $server.Id; tunnelPid = $tunnel.Id } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $env:TEMP 'masjidpoint-preview.json'), $state, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "  The site is online." -ForegroundColor Green
Write-Host "  Address   $publicUrl"
Write-Host "  Username  $User"
Write-Host "  Password  $Password"
Write-Host ""
Write-Host "  Admin sign-in is at $publicUrl/admin-login"
Write-Host "  This PC must stay on and awake. Run scripts\preview-stop.ps1 to take it offline."
Write-Host "  The address changes each time you run this."
Write-Host ""
