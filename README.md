# LEASH

**An AI wallet agent that can spend, but can't run away.**

FinTechathon 2026, Topic F: Autonomous On-chain Wallet.

An AI agent that pays your bills and manages a small portfolio needs a key. A key can be stolen, and a model can be talked into things: a fake "new bank details" invoice, a prompt injection hidden in an email. LEASH accepts that the agent will one day be wrong or compromised, and makes sure that **the worst it can do is bounded by a contract, not by the model's good behaviour.**

```
 owner instruction + inbox (untrusted)
              │
   ┌──────────▼──────────┐   proposes intents (JSON, strict schema, no tools, no keys)
   │   LLM planner        │
   └──────────┬──────────┘
   ┌──────────▼──────────┐   deterministic: registry, limits, oracle floor, exposure,
   │   policy engine      │   document scanner, replay check → execute | needs_owner | refuse
   └──────────┬──────────┘
   ┌──────────▼──────────┐   simulate → sign with the AGENT key → send
   │   agent signer       │
   └──────────┬──────────┘
   ┌──────────▼──────────┐   enforces the same mandate on-chain, whoever holds the key
   │   LeashVault.sol     │
   └─────────────────────┘
```

## Three permission tiers

| Tier | Who decides | Examples | Enforced by |
|---|---|---|---|
| **1. Autonomous** | the agent alone | rent to the registered landlord ≤ 900 tUSD; weekly DCA ≤ 500 tUSD at ≥ 99 % of the Chainlink price; daily total ≤ 1,500 | `LeashVault.pay` / `swap` |
| **2. Co-signed** | the owner signs an EIP-712 mandate for that exact payment | 5,000 tUSD tuition to a school that is not a payee | `LeashVault.payWithMandate` (to, amount, opId, deadline, epoch) |
| **3. Impossible** | nobody through the agent | add a payee, raise a limit, withdraw, unpause, pay a stranger | no agent code path exists; `onlyOwner` |

The guardian (a second key, e.g. a phone) can **pause** instantly but cannot unpause or move funds.

## Writing the leash in English

The owner does not type basis points. In the console's Mandate editor they write *"let the agent pay my landlord up to 850, never more than 1,200 a day, keep ETH under 35 %"*. The model fills a struct; **code** diffs it against the chain and marks every change that loosens the leash in red. Code also blocks inconsistent mandates. The owner then sends the transactions. The struct has no address field: when the owner text says *"my landlord has a new wallet, 0x5DF4…"*, the console lists the request as not enforceable on-chain. Details: [TECHNICAL.md §3.6](docs/TECHNICAL.md).

![Mandate editor: three loosening rows in red, blocked by an inconsistency](docs/screens/mandate-editor-loosen.png)

## What works today

| | Result | How to reproduce |
|---|---|---|
| Contract unit + fuzz tests | 34 / 34 (fuzz: 2,000 runs each) | `forge test` |
| Invariants (rogue-agent handler, 256 runs × 64 calls) | 7 / 7, 16,384 hostile calls (forge lists 7 `[PASS]` lines but counts one shared campaign as 1 test, so plain `forge test` reports 35) | `forge test --match-path test/Invariant.t.sol` |
| Off-chain policy + mandate compiler tests | 17 / 17 | `npm test` |
| Full local campaign (5 tasks + 13 attacks, fresh chain) | 18 / 18 | `scripts/local-campaign.ps1` |
| Same 13 attacks launched from the web console | 13 / 13 | `npm run server`, Red team panel |
| Live LLM runs (gpt-6.1-sol via Codex CLI, no tools) | 2 routine plans + 3 mandate compilations, recorded and replayable | `evidence/model-runs/` |
| Ethereum Sepolia campaign (run 4), vault [`0x8237…cE80`](https://sepolia.etherscan.io/address/0x8237d47a29e49d8f60fde0ca900df86ae2c7ce80) | 18 / 18, 29 transactions, 12 mined refusals, re-derived from the chain by `audit-chain.mjs`; Blockscout decodes 11 of the 12 refusals identically and has not indexed the 12th (A2); 4 contracts verified on Sourcify (exact match). Runs 1–3 were 17/18 (see Honesty notes) | [docs/evidence-sepolia.md](docs/evidence-sepolia.md) |

Every attack is sent for real with a fixed gas limit, so the refusal is **mined as a reverted transaction**. Every refusal has a public hash. We call this *proof of refusal*.

## Repository

```
contracts/           Foundry project
  src/LeashVault.sol   the mandate: tiers, limits, oracle floor, exposure cap, epochs, kill switch
  src/LeashPool.sol    minimal x·y=k pool (testnets have no real liquidity; see SECURITY.md)
  src/Mocks.sol        test tokens and a local-only price feed
  test/                unit, fuzz and invariant tests
app/src/
  config.js           networks (local, sepolia) and the default mandate
  chain.js            chain-id guard, wallets, send-and-record (every tx goes to a JSONL journal)
  core.js             policy engine (judge), EIP-712 typed data, deterministic mandate text
  planner.js          LLM adapter, document scanner, review of model output
  compiler.js         owner text → mandate struct → deterministic on-chain diff (CLI: compile.js)
  campaign.js         the 5 tasks and 13 attacks, shared by the CLI and the console
  scenes.js           CLI campaign runner → evidence/<net>-campaign-<run>.json
  server.js           local web console (127.0.0.1 only)
  deploy.js, keys.js  deployment and throwaway key generation
  repeg.js            keeps our testnet pool at the oracle price (the arbitrageur's job)
app/public/          console front-end (vanilla JS, no build step)
inbox/week42/        the documents the agent reads, two of them hostile
evidence/            campaign results, transaction journals, recorded model runs
docs/                TECHNICAL.md, SECURITY.md, boucle.md (our self-critical build log)
```

## Run it locally

Prerequisites: Node.js ≥ 22 (the test glob and the screenshot script's built-in WebSocket need it), [Foundry](https://book.getfoundry.sh/) (`forge`, `anvil`). Optional: the Codex CLI for live model calls. Recorded runs work without it.

```bash
npm ci
node app/src/keys.js
cd contracts && forge build && forge test && cd ..
npm test
```

Then, in two terminals:

```bash
anvil --chain-id 31337
```

```bash
node app/src/deploy.js local --fresh
node app/src/scenes.js local
```

The campaign prints 18 lines and writes `evidence/local-campaign-<run>.json`. On Windows, `scripts/local-campaign.ps1` does all of this on a fresh anvil.

If port 8545 is taken, start anvil with `--port 8546` and set `LEASH_LOCAL_RPC=http://127.0.0.1:8546`. `LEASH_SEPOLIA_RPC` overrides the Sepolia node, which defaults to publicnode.

These steps were replayed on 2026-10-15 from a fresh clone, with no prior build. Results: `npm ci`, then 34 + 7 forge tests, 17 Node tests and 18/18 on the campaign.

### Web console

```bash
node app/src/deploy.js local --fresh
npm run server -- --network local --port 8791
```

Open http://127.0.0.1:8791. Then:

1. Run the weekly routine (recorded replay by default).
2. Execute the tier-1 proposals.
3. Review and sign the tier-2 tuition mandate.
4. Compile an owner text in the Mandate editor and read the diff.
5. Launch any of the 13 attacks.
6. Pull the kill switch.

Live model calls need `--allow-live` and a logged-in Codex CLI.

![The weekly routine: two hostile documents flagged by code and by the model; rent and electricity within the agent's limits, tuition waiting for the owner's signature](docs/screens/routine.png)

`node scripts/screens.mjs` re-takes every screenshot in `docs/screens/` by driving the console in a headless Edge or Chrome (`BROWSER=` path). Run it on a fresh deployment. The screenshots in `docs/screens/` were taken on the local chain.

`node scripts/preflight.mjs <local|sepolia>` says whether a deployment can still play the whole demo. It sends nothing. It checks that the week's bills are unpaid and the vault is not paused, that the pool is at the oracle price, and that every key has gas.

## Run it on Ethereum Sepolia

1. Fund the **owner** address printed by `node app/src/keys.js` with about 0.01 Sepolia ETH (gas is ~0.001 gwei; most of it is forwarded to the agent, guardian and attacker keys).
2. Deploy and run the campaign (contracts must be built, see above):

```bash
node app/src/deploy.js sepolia
node app/src/scenes.js sepolia
node scripts/verify.mjs sepolia
node scripts/audit-chain.mjs sepolia --blockscout
node scripts/evidence-doc.mjs
```

`verify.mjs` verifies the four contracts on Sourcify with `forge verify-contract`; no API key is needed. Its constructor arguments were checked byte for byte against the local deployment transactions.

`audit-chain.mjs` does not trust our JSON. For every scene it fetches the receipt and checks that the transaction went to the vault. It flags out-of-gas, and it replays each refusal at its block, with its own gas limit, to read the revert reason from the chain. `--blockscout` adds a third opinion: Blockscout's own decoding of each failed transaction. It needs no keys, only `forge build` for the ABI. Etherscan shows our refusals only as "execution reverted", because the sources are verified on Sourcify, not Etherscan. The evidence table therefore also links each refusal to Blockscout, where the vault's error is decoded. `evidence-doc.mjs` rewrites [docs/evidence-sepolia.md](docs/evidence-sepolia.md) from every Sepolia run in `evidence/`, failed ones included, each with a fresh audit.

`deploy.js` checks the owner balance against the current gas price before sending anything: about 0.006 ETH at 0.001 gwei. Like the local one, the campaign expects a fresh vault and a single UTC day. Do not start it within 15 minutes of 00:00 UTC. If a run fails halfway, redeploy with `--fresh` rather than re-running it.

Swaps use the real Chainlink ETH/USD feed on Sepolia (`0x694AA1769357215DE4FAC081bf1f309aDC325306`). Tokens and the pool are ours. Every hash in `evidence/sepolia-*.json` links to sepolia.etherscan.io.

Nobody arbitrages our pool, so it keeps the deploy-day price while the real feed moves. Once the gap exceeds the 1 % slippage mandate, the vault refuses every swap, as it should. `scenes.js` therefore re-pegs first: the owner donates the missing side until the pool sits at the oracle price. Run `node app/src/repeg.js sepolia` before using the console on a deployment more than a few hours old. `node scripts/oracle-age.mjs` prints the feed's update gaps: about 3,630 s when we measured, against a 7,200 s `maxOracleAge`.

## Honesty notes

- **Not new as a primitive.** Session keys, spend permissions and allowance modules exist (ERC-4337 plugins, Coinbase Spend Permissions, MetaMask delegations, Safe Allowance module). LEASH's contribution is the complete loop: LLM → deterministic policy → contract, with an oracle-bounded portfolio mandate, deterministic mandate rendering and on-chain proof of every refusal.
- **The model resisted.** In our recorded live runs, both the guarded prompt and a deliberately naive prompt refused the prompt injection. We therefore do not claim "the model was fooled and the vault held". We show the stolen-key case instead (A2–A4, A7), plus a clearly labelled *simulated* compromised model output in the tests.
- **Our first three Sepolia runs were 17/18, and our own tooling first hid that.** The vault never let anything through; the failures were all in how we sent and labelled the attacks:
  - Run 1 took A8's revert reason from a simulation served by a lagging RPC node.
  - In runs 1 and 2, A9's forced buy ran out of gas, because Sepolia costs about 3× anvil's gas and our limit was tuned on anvil. It was still labelled as a refusal. Blockscout showed "Out of gas".
  - In run 3, an RPC node simulated A9 while filling the transaction, so it was never sent.

  Labels now come from the mined transaction, forced calls are fully filled with room to spare, and the audit checks every outcome against Blockscout. All three runs stay in `evidence/` as recorded (SECURITY.md, R15).
- **Unaudited code.** Testnet only. See [docs/SECURITY.md](docs/SECURITY.md) for the known-risk list.
