# Fresh local chain -> build -> deploy -> full campaign. Usage: powershell -File scripts/local-campaign.ps1
# Foundry comes from LEASH_FOUNDRY (a folder), else from anvil on the PATH. The chain listens on LEASH_ANVIL_PORT (default 8545).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$onPath = Get-Command anvil -ErrorAction SilentlyContinue
$foundry = if ($env:LEASH_FOUNDRY) { $env:LEASH_FOUNDRY } elseif ($onPath) { Split-Path $onPath.Source } else { "$env:USERPROFILE\tools\foundry-v1.8.5" }
$node = if ($env:LEASH_NODE) { $env:LEASH_NODE } else { 'node' }
$port = if ($env:LEASH_ANVIL_PORT) { $env:LEASH_ANVIL_PORT } else { '8545' }

# A fresh chain: an anvil already on this port (a previous run) is stopped. Anything else on the port is an error,
# and anvils on other ports are left alone.
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $owner = Get-Process -Id $busy.OwningProcess
  if ($owner.Name -ne 'anvil') { throw "port $port is used by $($owner.Name) (pid $($owner.Id)): stop it or set LEASH_ANVIL_PORT" }
  Stop-Process -Id $owner.Id -Force
  Start-Sleep -Seconds 1
}
$anvil = Start-Process -FilePath "$foundry\anvil.exe" -ArgumentList '--port', $port, '--chain-id', '31337', '--silent' -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$env:LEASH_LOCAL_RPC = "http://127.0.0.1:$port"

Push-Location "$root\contracts"; & "$foundry\forge.exe" build --quiet; Pop-Location
Push-Location $root
& $node app/src/deploy.js local --fresh
if ($LASTEXITCODE) { throw 'deploy failed' }
& $node app/src/scenes.js local
$code = $LASTEXITCODE
Pop-Location
Write-Host "anvil keeps running on port $port (pid $($anvil.Id)) for the web console. Stop it with: Stop-Process -Id $($anvil.Id)"
exit $code
