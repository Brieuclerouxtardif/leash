# Plan B: the campaign on Base mainnet

Topic F is judged on real on-chain transaction hashes. Sepolia hashes are real, but a judge may want a
mainnet. This branch can run the same campaign on Base, an Ethereum L2 where gas costs cents. It stays
off `main` until the team decides to spend real money.

## Cost (read on 2026-10-15)

- Gas on Base: 0.006 gwei. Sepolia run 4 used 29 txs and 3.1 M gas; a deploy plus a full run is 12–15 M gas,
  so about **$0.20** at ETH = $2,370.
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

## Not done

- No rehearsal: `basefork` (anvil forking Base) is wired, but Windows application control blocks new
  `anvil.exe` launches on this PC. Run `anvil --fork-url https://mainnet.base.org --chain-id 31337 --port 8546`,
  then `deploy.js basefork` and `scenes.js basefork`, on a machine where it starts.
- `scripts/audit-chain.mjs`, `scripts/verify.mjs` (Sourcify) and the evidence doc take `sepolia` as their
  default; pass `base` to the first two and check their output before quoting it.
- The public RPC `mainnet.base.org` is rate-limited; set `LEASH_BASE_RPC` if the run stalls.
