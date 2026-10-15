# Plan B: the campaign on Base mainnet

Topic F is judged on real on-chain transaction hashes. Sepolia hashes are real, but a judge may want a
mainnet. This branch can run the same campaign on Base, an Ethereum L2 where gas costs cents. It stays
off `main` until the team decides to spend real money.

## Rehearsed on a fork of Base (2026-10-15)

anvil forked Base at block 52,637,784 (chain id 31337, so no real funds), with the real Chainlink feed
(ETH / USD 2,366.07). `deploy.js basefork`, then `scenes.js basefork`: **18/18**, confirmed by
`audit-chain.mjs basefork` from the chain (17 mined, A1 refused before signing). Files:
`deployments/basefork.json`, `evidence/basefork-campaign-20261015T114917.json`.

## Cost (measured on 2026-10-15)

- Deploy plus the full campaign on the fork: 48 txs, **6,768,849 gas**. At Base's 0.006 gwei and ETH =
  $2,366: **$0.10**.
- The fork prices gas like Base. One new storage slot, from `eth_estimateGas` of the same contract
  creation (nothing sent): Base 22,176 gas, the fork 22,089, Sepolia 110,882. Sepolia charges new storage
  5 times more: the same 29 campaign txs used 1,725,110 gas on the fork and 3,095,545 on Sepolia (run 4).
- Base also charges an L1 data fee that `getGasPrice` does not show. Read from its GasPriceOracle with our
  bytecodes, the four deploys (the largest txs, 21 KB) cost $0.0002 in all: negligible.
- `deploy.js` asks the owner for 10 M gas at twice today's price plus three role top-ups of 0.0003 ETH,
  about 0.001 ETH: fund the owner with **0.002 ETH (~$5)**. What is left stays on the owner key.
- The tokens are the same test tokens (tUSD, tETH) minted by the deploy: no real dollar or ether moves
  through the vault, only the gas is real. The price comes from the real Chainlink ETH / USD feed on Base
  (`0x7104…Bb70`).

## The guard

`network('base')` throws unless `LEASH_REAL_FUNDS=8453`, and Base signs with `secrets/base-keys.json`, never
with the testnet keys. A test pins both (`app/test/core.test.js`); weakening the check to "any value" makes
it fail.

## Steps

```bash
node app/src/keys.js --base
```

Send 0.002 ETH on Base to the owner address it prints, then:

```powershell
$env:LEASH_REAL_FUNDS = '8453'
node app/src/deploy.js base
node app/src/scenes.js base
```

To rehearse again: `anvil --fork-url https://mainnet.base.org --chain-id 31337 --port 8546`, then
`node app/src/deploy.js basefork --fresh` and `node app/src/scenes.js basefork`.

## Not done

- The real run. A fork cannot show what only the live network does: a public RPC behind a load balancer
  (Sepolia's lagging nodes broke three of our runs), real block times, a gas spike.
- `scripts/audit-chain.mjs`, `scripts/verify.mjs` (Sourcify) and the evidence doc take `sepolia` as their
  default; pass `base` to the first two and check their output before quoting it. Blockscout cross-checks
  are wired for Sepolia only.
- The public RPC `mainnet.base.org` is rate-limited; set `LEASH_BASE_RPC` if the run stalls.
