# Takes the preview offline: closes the tunnel and stops the server started by scripts\preview.ps1.
# Anything you or your client entered stays in data\masjidpoint.json.

$ErrorActionPreference = 'SilentlyContinue'
$state = Join-Path $env:TEMP 'masjidpoint-preview.json'

if (Test-Path $state) {
  $info = Get-Content $state -Raw | ConvertFrom-Json
  foreach ($id in @($info.tunnelPid, $info.serverPid)) {
    if ($id) { Stop-Process -Id $id -Force }
  }
  Remove-Item $state -Force
}

# Belt and braces, in case the preview was started another way or the file was lost.
Get-Process cloudflared | Stop-Process -Force

Write-Host "The preview is offline." -ForegroundColor Green
Write-Host "Run 'npm start' to go back to using the site locally on http://localhost:4174"
