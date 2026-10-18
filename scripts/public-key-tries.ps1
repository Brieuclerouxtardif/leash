# Tries the public-key vault with the published agent key and nothing of ours but `cast`: the same commands
# the README gives a juror. Each try is mined (forced gas); its label comes from replaying the call at the
# mined block, never from the simulation before sending. Writes evidence/sepolia-public-key-<date>.jsonl.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/public-key-tries.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$d = Get-Content "$root\deployments\sepolia-public-key.json" -Raw | ConvertFrom-Json
$roles = Get-Content "$root\secrets\testnet-keys.json" -Raw | ConvertFrom-Json
$RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
$V = $d.vault; $USD = $d.usd; $AGENT = $roles.agent.address; $AKEY = $roles.agent.privateKey
$ME = $roles.attacker.address
$LANDLORD = $roles.landlord.address; $UTILITY = $roles.utility.address
$GAS = 600000
$out = "$root\evidence\sepolia-public-key-$(Get-Date -Format yyyyMMdd).jsonl"
$bad = '0x' + ('11' * 65) # 65 bytes no key signed

$tries = @(
  @{ id = 'K1'; what = 'pay 9,000 tUSD to my own address'; sig = 'pay(address,uint256,bytes32)'; args = @($ME, '9000000000', 'op:K1') },
  @{ id = 'K2'; what = 'pay 5,000 tUSD to the landlord, above its cap'; sig = 'pay(address,uint256,bytes32)'; args = @($LANDLORD, '5000000000', 'op:K2') },
  @{ id = 'K3'; what = 'add my address as a payee'; sig = 'setPayee(address,uint256)'; args = @($ME, '1000000000000') },
  @{ id = 'K4'; what = 'withdraw all the tUSD to my address'; sig = 'withdraw(address,address,uint256)'; args = @($USD, $ME, '12000000000') },
  @{ id = 'K5'; what = 'pay 9,000 tUSD with a forged owner signature'; sig = 'payWithMandate(address,uint256,bytes32,uint64,bytes)'; args = @($ME, '9000000000', 'op:K5', '9999999999', $bad) },
  @{ id = 'K6'; what = 'settle a 9,000 tUSD invoice with a forged seal'; sig = 'settleInvoice(address,uint256,bytes32,bytes)'; args = @($ME, '9000000000', 'op:K6', $bad) },
  @{ id = 'K7'; what = 'swap 500 tUSD accepting any price'; sig = 'swap(bool,uint256,uint256,bytes32)'; args = @('true', '500000000', '0', 'op:K7') },
  @{ id = 'K8'; what = 'pay the 120 tUSD electricity bill (inside the mandate: the residual)'; sig = 'pay(address,uint256,bytes32)'; args = @($UTILITY, '120000000', 'op:K8') }
)

foreach ($t in $tries) {
  $tag = "public-key-$(Get-Date -Format yyyyMMddTHHmmss)-$($t.id)"
  $a = @($t.args | ForEach-Object { if ($_ -like 'op:*') { (cast keccak $tag).Trim() } else { $_ } })
  $r = cast send $V $t.sig @a --private-key $AKEY --rpc-url $RPC --gas-limit $GAS --json | ConvertFrom-Json
  $block = [Convert]::ToInt64($r.blockNumber.Substring(2), 16)
  $used = [Convert]::ToInt64($r.gasUsed.Substring(2), 16)
  $ok = $r.status -eq '0x1'
  $label = 'ok'
  if (-not $ok) {
    if ($used -ge $GAS) { $label = 'out of gas' }
    else {
      $ErrorActionPreference = 'Continue'
      $replay = (cast call $V $t.sig @a --from $AGENT --rpc-url $RPC --block ($block - 1) 2>&1 | Out-String) -replace '\s+', ' '
      $ErrorActionPreference = 'Stop'
      $label = if ($replay -match 'execution reverted: ([A-Za-z]+(\([^)]*\))?)') { $Matches[1] } else { 'reverted: ' + $replay.Trim().Substring(0, [Math]::Min(120, $replay.Trim().Length)) }
    }
  }
  $row = [ordered]@{ id = $t.id; what = $t.what; call = $t.sig; args = $a; from = $AGENT; vault = $V; hash = $r.transactionHash; block = $block; status = $(if ($ok) { 'success' } else { 'reverted' }); gasUsed = $used; gasLimit = $GAS; result = $label; at = (Get-Date).ToUniversalTime().ToString('o') }
  $line = $row | ConvertTo-Json -Compress -Depth 4
  [IO.File]::AppendAllText($out, $line + "`n", (New-Object Text.UTF8Encoding($false)))
  "{0} {1,-9} {2,-40} {3}" -f $t.id, $row.status, $label, $r.transactionHash
}
"saved $out"
