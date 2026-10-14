# Fresh local chain -> build -> deploy -> full campaign. Usage: powershell -File scripts/local-campaign.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$foundry = if ($env:LEASH_FOUNDRY) { $env:LEASH_FOUNDRY } else { "$env:USERPROFILE\tools\foundry-v1.8.5" }
$node = if ($env:LEASH_NODE) { $env:LEASH_NODE } else { 'node' }

Get-Process anvil -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath "$foundry\anvil.exe" -ArgumentList '--port', '8545', '--chain-id', '31337', '--silent' -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 2

Push-Location "$root\contracts"; & "$foundry\forge.exe" build --quiet; Pop-Location
Push-Location $root
& $node app/src/deploy.js local --fresh
if ($LASTEXITCODE) { throw 'deploy failed' }
& $node app/src/scenes.js local
$code = $LASTEXITCODE
Pop-Location
exit $code
