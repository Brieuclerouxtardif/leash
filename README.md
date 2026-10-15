# LEASH

**An AI wallet agent that can spend, but can't run away.**

FinTechathon 2026, Topic F: Autonomous On-chain Wallet.

An AI agent that pays your bills and manages a small portfolio needs a key. A key can be stolen, and a model can be talked into things: a fake "new bank details" invoice, a prompt injection hidden in an email. LEASH accepts that the agent will one day be wrong or compromised, and makes sure that **the worst it can do is bounded by a contract, not by the model's good behaviour.**

![The LEASH console on the local chain: the vault, the mandate the contract enforces, today's limits, and the last full campaign with a hash for every payment and every refusal](docs/screens/console-top.png)

```
 owner instruction + inbox (untrusted)
              │
   ┌──────────▼──────────┐   proposes intents (JSON, strict schema, no tools, no keys)
   │   LLM planner       │
   └──────────┬──────────┘
   ┌──────────▼──────────┐   deterministic: registry, limits, oracle floor, exposure,
   │   policy engine     │   document scanner, replay check → execute | needs_owner | refuse
   └──────────┬──────────┘
   ┌──────────▼──────────┐   simulate → sign with the AGENT key → send
   │   agent signer      │
   └──────────┬──────────┘
   ┌──────────▼──────────┐   enforces the same mandate on-chain, whoever holds the key
   │   LeashVault.sol    │
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

## How the agent deals with the owner

| | What LEASH does |
|---|---|
| Few turns | one instruction from the owner, plus the inbox, gives the whole week's plan in one model call |
| Asking the owner | only when the contract requires it: a payment above the agent's limits becomes a signature request, with text written by code. A suspicious document is reported with the reason |
| Correcting | a mandate error says how to fix it ("raise max per payment too, or keep these payments owner-signed"). The owner edits the text and compiles again. Apply refuses if the chain changed since the diff was shown |
| Out of scope | what the contract cannot express ("double it", "pay this new address") is listed as *not enforceable on-chain*, in the owner's words. A payment the policy cannot justify is refused, never guessed. A stale oracle stops swaps |

What it does not do: hold a conversation. The agent never asks a question before planning, and the owner cannot answer a flag in the console; they change the mandate or sign.

## Measured on week 42

Week 42 is five documents: two bills, a tuition invoice and two hostile emails. Figures from the Sepolia reference run (run 4), the local campaign and the recorded model runs:

| Measure | Value | Source |
|---|---|---|
| Owner effort | one instruction and one signature for the week. 920 tUSD of bills paid by the agent key alone (T1, T2); 5,000 tUSD of tuition after one EIP-712 signature over text rendered by code (T4) | run 4 |
| Fraud stopped | 9,800 tUSD asked for by the two hostile documents (800 to a "new wallet", 9,000 by prompt injection): nothing moved, both reported with the reason | A1; recorded guarded run |
| Worst case, stolen agent key | 1,500 tUSD per UTC day (3,000 across a midnight, R2), only to the two registered payees, out of 12,000 tUSD and 1.2 tETH in the vault; swaps at most 1 % below the oracle price (R3) | A2–A5, A9 |
| Stopping it | one guardian transaction pauses everything (A10, 29,050 gas); one owner transaction voids every pending signature (A8, 29,152 gas) | run 4 |
| Planning time | 18.7 s for the week's plan (13,813 input tokens, 586 output); 5.5–9.5 s per mandate compilation | `evidence/model-runs/` |
| On-chain cost | a tier-1 payment uses 80–114k gas on anvil and 184–380k on Sepolia. The gap is storage creation: each new slot adds about 98k gas on Sepolia against 17k on anvil (T1 − T2, T2 − A5; an `approve` creating one slot: 46,376 vs 128,296). A payment creates up to three: its opId, the day's counter (first payment of the day), the payee's token balance (first payment ever). Writes to existing storage cost the same within 4 % | run 4 vs local campaign |

## What works today

| | Result | How to reproduce |
|---|---|---|
| Contract unit + fuzz tests | 34 / 34 (fuzz: 2,000 runs each) | `forge test` |
| Invariants (rogue-agent handler, 256 runs × 64 calls) | 7 / 7, 16,384 hostile calls (forge lists 7 `[PASS]` lines but counts one shared campaign as 1 test, so plain `forge test` reports 35) | `forge test --match-path test/Invariant.t.sol` |
| Off-chain policy + mandate compiler tests | 18 / 18 | `npm test` |
| Full local campaign (5 tasks + 13 attacks, fresh chain) | 18 / 18 | `powershell -ExecutionPolicy Bypass -File scripts/local-campaign.ps1` |
| Same 13 attacks launched from the web console | 13 / 13 | `npm run server`, Red team panel |
| Live LLM runs (gpt-6.1-sol via Codex CLI, no tools) | 2 routine plans + 3 mandate compilations, recorded and replayable | `evidence/model-runs/` |
| Ethereum Sepolia campaign (run 4), vault [`0x8237…cE80`](https://sepolia.etherscan.io/address/0x8237d47a29e49d8f60fde0ca900df86ae2c7ce80) | 18 / 18, 29 transactions, 12 mined refusals, re-derived from the chain by `audit-chain.mjs`; Blockscout decodes 11 of the 12 refusals identically and has not indexed the 12th (A2); 4 contracts verified on Sourcify (exact match). Runs 1–3 were 17/18 (see Honesty notes) | [docs/evidence-sepolia.md](docs/evidence-sepolia.md) |

Every attack is sent for real with a fixed gas limit, so the refusal is **mined as a reverted transaction**. Every refusal has a public hash. We call this *proof of refusal*.

### Check it in a minute, with nothing to install

These links point to the reference run on Ethereum Sepolia, in public block explorers:

| Claim | Where to look |
|---|---|
| The agent pays a registered bill alone (tier 1) | [800 tUSD rent](https://sepolia.etherscan.io/tx/0x74edd399285c281abae3d8dc400fed359b22ba2aeed5723227a224a6c55a7fe2) on Etherscan |
| A payment above the agent's limits goes through only with the owner's EIP-712 signature (tier 2) | [5,000 tUSD tuition](https://sepolia.etherscan.io/tx/0x119280a0ac4a7a1030dc16e66a4ae6db7cd94fd332b707ce47fa7a4f82899217) on Etherscan |
| A stolen agent key cannot forge the owner's signature | [A7, 9,000 tUSD to the attacker](https://eth-sepolia.blockscout.com/tx/0x44dc52039c20162febb93c766ddec4414c277f13a5300cab8bef659e2c8d9236): Blockscout decodes `BadMandateSignature()` |
| A pumped pool cannot make the agent overpay | [A9, forced buy](https://eth-sepolia.blockscout.com/tx/0xb1e06f38a5a1616e29068724f64e11c050c67bc966c07805273c1c91f54adb8b): the vault demands at least the oracle price minus 1 %, the pumped pool cannot pay it, and the swap reverts (`slippage`) |
| The guardian's kill switch stops the agent | [A10](https://eth-sepolia.blockscout.com/tx/0x8adf991aceed69e4dd4fc15f33dee7ce1f1cf7e694b3182606d893380d05088e): `VaultPaused()` |
| The source you read is the code deployed | [LeashVault source on Blockscout](https://eth-sepolia.blockscout.com/address/0x8237d47a29E49D8F60FDE0CA900dF86AE2C7cE80?tab=contract), [Sourcify: exact match](https://repo.sourcify.dev/11155111/0x8237d47a29E49D8F60FDE0CA900dF86AE2C7cE80) |

All 29 transactions of this run, and the three earlier runs that failed, are in [docs/evidence-sepolia.md](docs/evidence-sepolia.md).

## Where each required deliverable is

| The rules ask for | Here |
|---|---|
| Technical documentation: system architecture, core algorithm, security design | [TECHNICAL.md](docs/TECHNICAL.md) §2, §3, §4 |
| Source code with README, deployment instructions and test cases | this repository: [Run it locally](#run-it-locally), [Run it on Ethereum Sepolia](#run-it-on-ethereum-sepolia), `contracts/test/`, `app/test/` |
| Security self-assessment: permission tiers and known risks | [SECURITY.md](docs/SECURITY.md) §2 (tiers), §5 (13 attacks), §6 (known risks R1–R15), §7 (compliance controls, and what is not covered: KYC, AML, data protection) |
| Execution evidence: on-chain transaction hashes | [evidence-sepolia.md](docs/evidence-sepolia.md), `evidence/sepolia-campaign-*.json` |
| Topic F: asset management, transaction execution, risk control | a weekly tETH purchase under an exposure cap; bill payments; the vault's limits, oracle floor and kill switch |

Third-party code: OpenZeppelin Contracts 5.6.1 and viem 2.57.5 (MIT, installed by `npm ci`), forge-std (MIT or Apache-2.0, vendored in `contracts/lib/` with its license files).

## Repository

```
contracts/             Foundry project
  src/LeashVault.sol   the mandate: tiers, limits, oracle floor, exposure cap, epochs, kill switch
  src/LeashPool.sol    minimal x·y=k pool (testnets have no real liquidity; see SECURITY.md)
  src/Mocks.sol        test tokens and a local-only price feed
  test/                unit, fuzz and invariant tests
app/src/
  config.js            networks (local, sepolia) and the default mandate
  chain.js             chain-id guard, wallets, send-and-record (every tx goes to a JSONL journal)
  core.js              policy engine (judge), EIP-712 typed data, deterministic mandate text
  planner.js           LLM adapter, document scanner, review of model output
  routine.js, plan.js  the owner's weekly instruction; CLI: one routine, model live or replayed
  compiler.js          owner text → mandate struct → deterministic on-chain diff (CLI: compile.js)
  campaign.js          the 5 tasks and 13 attacks, shared by the CLI and the console
  scenes.js            CLI campaign runner → evidence/<net>-campaign-<run>.json
  server.js            local web console (127.0.0.1 only)
  deploy.js, keys.js   deployment and throwaway key generation
  repeg.js             keeps our testnet pool at the oracle price (the arbitrageur's job)
app/public/            console front-end (vanilla JS, no build step)
app/test/              Node tests: policy, swaps, scanner, compiler, recorded runs, revert labels
inbox/week42/          the documents the agent reads, two of them hostile
deployments/           deployed addresses; Sepolia runs, rehearsals and video takes kept by name
evidence/              campaign results, transaction journals, recorded model runs
scripts/               chain audit, Sourcify verification, evidence doc, screenshots, demo video, PDFs
docs/                  TECHNICAL, SECURITY, evidence-sepolia, VIDEO script, SUBMISSION checklist
  boucle.md            our self-critical build log (in French)
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

The campaign prints 18 lines and writes `evidence/local-campaign-<run>.json`. On Windows, `powershell -ExecutionPolicy Bypass -File scripts/local-campaign.ps1` does all of this on a fresh anvil (Windows's default execution policy refuses to run scripts without it). It finds Foundry on the PATH, or in `LEASH_FOUNDRY`. It listens on `LEASH_ANVIL_PORT` (default 8545) and only restarts an anvil that is already on that port.

If port 8545 is taken, start anvil with `--port 8546` and set `LEASH_LOCAL_RPC=http://127.0.0.1:8546`. `LEASH_SEPOLIA_RPC` overrides the Sepolia node, which defaults to publicnode.

These steps were replayed on 2026-10-15 from a fresh clone, with no prior build. Results: `npm ci`, then 34 + 7 forge tests, 17 Node tests (18 since a test added later that day) and 18/18 on the campaign.

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
  - In runs 1 and 2, A9's forced buy ran out of gas, because creating storage costs far more on Sepolia than on anvil (the vault's weekly swap, T3: 384,184 gas against 159,560) and our limit was tuned on anvil. It was still labelled as a refusal. Blockscout showed "Out of gas".
  - In run 3, an RPC node simulated A9 while filling the transaction, so it was never sent.

  Labels now come from the mined transaction, forced calls are fully filled with room to spare, and the audit checks every outcome against Blockscout. All three runs stay in `evidence/` as recorded (SECURITY.md, R15).
- **Unaudited code.** Testnet only. See [docs/SECURITY.md](docs/SECURITY.md) for the known-risk list.
