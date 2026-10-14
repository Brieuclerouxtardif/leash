# LEASH: technical document

## 1. Problem

Autonomous wallet agents need a signing key. Today that key is usually either:

- **all-powerful**: a hot EOA that the model can empty if it is prompt-injected or if the key leaks; or
- **so restricted that the agent is useless**: every action needs a human click.

Payment fraud does not need a clever exploit: *"our bank details have changed"* is the most common invoice fraud there is. An LLM that reads invoices will meet it on day one.

LEASH gives the agent a key that is **useful for routine work and harmless beyond it**. The owner writes a mandate once. The contract enforces it on every call, whoever holds the key and whatever the model believes.

## 2. Architecture

```
            ┌──────────────── off-chain (app/src) ────────────────┐        ┌──── on-chain (contracts/src) ────┐
 owner ───► │ instruction                                          │        │                                  │
 inbox ───► │ planner.js ── LLM (Codex CLI, no tools) ─► intents   │        │  LeashVault                      │
 (untrusted)│      │                                                │        │   ├─ tier 1: pay / swap          │
            │      ▼                                                │        │   ├─ tier 2: payWithMandate      │
            │ review(): scanner, source/amount/payee rules          │        │   ├─ owner: limits, payees, risk │
            │      ▼                                                │        │   └─ guardian: pause             │
            │ core.judge(): registry, limits, oracle floor, exposure│        │        │            │            │
            │      ▼                                                │  tx    │        ▼            ▼            │
            │ chain.send(): chain guard → simulate → sign → journal │ ─────► │  LeashPool     Chainlink feed    │
            └──────────────────────────────────────────────────────┘        └──────────────────────────────────┘
                     ▲                                       │ hashes, statuses, decoded reverts
             server.js console (127.0.0.1)  ◄────────────────┘ evidence/*.jsonl, *.json
```

| Component | File | Role |
|---|---|---|
| Vault | `contracts/src/LeashVault.sol` | holds funds; enforces tiers 1 and 2; owner and guardian controls |
| Pool | `contracts/src/LeashPool.sol` | minimal constant-product AMM (0.3 % fee) for testnets without liquidity |
| Oracle | Chainlink ETH/USD (Sepolia) or `MockAggregator` (local) | fair price for swap floors and exposure |
| Planner | `app/src/planner.js` | prompt building, model call, recording/replay, document scanner, `review` |
| Policy engine | `app/src/core.js` | `judge`, EIP-712 typed data, deterministic mandate text |
| Signer and journal | `app/src/chain.js` | chain-id guard, per-role wallets, simulate-then-send, JSONL evidence |
| Scenes | `app/src/campaign.js`, `scenes.js` | 5 tasks and 13 attacks; CLI runner |
| Console | `app/src/server.js`, `app/public/` | routine, mandate signing, red team, kill switch, live ledger |

Stack: Solidity 0.8.30, OpenZeppelin 5.6.1 (EIP712, ECDSA, SafeERC20, ReentrancyGuard), Foundry 1.8.5, Node 24 + viem 2.57.

## 3. Core algorithm

### 3.1 The agent loop

```
state  ← readState(vault, pool, oracle)          // balances, limits, today's spend, price, epoch, registry
intents ← LLM(prompt(GUARDED, mandateText(state), ownerInstruction, inbox))     // JSON schema, no tools
for intent in intents:
    verdict ← review(intent)                      // §3.2, deterministic
    if verdict = execute:      chain.send(agent, verdict.call)        // simulate first; refuse if it reverts
    if verdict = needs_owner:  show deterministic mandate text → owner signs EIP-712 → agent.payWithMandate
    if verdict = refuse:       record why; nothing is signed
```

The model **never** chooses an address, an opId or a minimum output:

- Addresses come from the on-chain registry.
- Op ids are `keccak256("leash:" + week + source + payee + amount)`, derived by code.
- Swap bounds come from the oracle.

### 3.2 `review` and `judge`: the deterministic policy

Checks run in this order, and the first failure decides:

1. **Source exists.** The cited document is in the inbox. A source of `owner` must match the owner's text: a foreign address must appear in the instruction.
2. **Source is clean.** The scanner raises no flag on it (injection phrases, address-change language, unknown addresses).
3. **Amount is the source's.** The amount is one of the `N tUSD` figures in the source. This blocks rounding up to a cap and double payment through a changed amount.
4. **Payee matches the document.** A document that names a registry payee can only pay that payee.
5. **Gate.** The agent is active, the vault is not paused, the op id is unused on-chain, and the amount is a finite positive number.
6. **Payments.**
   - The registry address wins. If a document address differs from it, the intent is refused as invoice-redirection fraud and **never escalated**.
   - The recipient must be a valid address and not on the run's denylist: every unknown address that appears in a document the scanner flagged. If the fraudster also writes to the owner and the owner relays the address ("send 100 tUSD to 0x5DF4…"), the intent is refused instead of reaching the signature dialog.
   - Tier 1 requires: payee cap > 0, amount ≤ cap, amount ≤ per-payment limit, and today + amount ≤ daily limit. Otherwise, if the vault can cover it, the intent goes to tier 2 (`needs_owner`).
7. **Swaps.**
   - The oracle must be fresh. The notional must be within the per-swap and daily limits.
   - The pool quote must be ≥ the oracle floor.
   - After a buy, the tETH share must stay ≤ `maxRiskBps`.
   - `minOut = max(floor, quote × 0.998)`: a sandwich between simulation and inclusion makes the transaction revert rather than fill badly.

Every check is returned with a human-readable detail, and the console shows all of them.

### 3.3 Swap floor (on-chain)

Prices are Chainlink answers with 8 decimals; tUSD has 6 decimals and tETH 18.

```
fair(buy)  = amountIn · 10^18 · 10^8 / (price · 10^6)
fair(sell) = amountIn · price · 10^6 / (10^18 · 10^8)
floor      = fair · (10 000 − maxSlippageBps) / 10 000
require minOut ≥ floor          // the agent cannot ask for less
require received ≥ minOut       // measured as a balance difference, not trusted from the pool
after a buy: require riskyValue / (riskyValue + stable) ≤ maxRiskBps
```

The floor comes from the oracle, never from the pool or the agent. Pumping the pool therefore cannot make the vault buy above `price / (1 − slippage)` (scene A9).

### 3.4 Tier-2 mandate (EIP-712)

```
domain  = { name: "LeashVault", version: "1", chainId, verifyingContract: vault }
Mandate(address to, uint256 amount, bytes32 opId, uint64 deadline, uint32 epoch)
```

- `opId` is consumed on use (no replay).
- `deadline` bounds the lifetime.
- `epoch` is bumped by `revokeAgent`, by `bumpEpoch`, and by `setAgent` with a new agent. One owner transaction therefore voids every signature outstanding.
- `chainId` and `verifyingContract` prevent cross-chain and cross-vault replay (cross-vault is tested).
- Only the agent can submit a mandate, and the signer must recover to `owner` (`ECDSA.tryRecover`, which rejects malleable signatures).

What the owner reads before signing is rendered **by code from the struct**, for example:

> Pay 5,000.00 tUSD to 0x1ef32F56C8fd7c972eE68FD845691C80755b7C6f [school (not a payee)], once, before 2026-10-14T01:42:59Z. Void if you revoke the agent (epoch 1).

The address is printed in full: a shortened one is what address-poisoning attacks imitate.

An address outside the registry is labelled "UNKNOWN recipient, never paid before". The model never writes this text.

### 3.5 Proof of refusal

`chain.send` simulates every call. For a normal agent action, a reverting simulation stops there (`refused-before-signing`). For red-team scenes the call is **forced** with a fixed gas limit, so it is mined and reverts. The receipt hash, block, gas and decoded custom error (`PayeeNotAllowed`, `AboveDailyLimit`, …) are appended to `evidence/<net>-*.jsonl`. On Sepolia every refusal gets a public Etherscan link.

The recorded reason is the mined one (`minedRevert`). If the transaction burnt its whole gas limit, it is labelled `OutOfGas` and proves nothing. Otherwise the same call, with the same gas limit, is replayed at its block and decoded. The pre-send simulation is never trusted for the label. Two Sepolia runs taught us this:
- In run 1, the simulation was served by an RPC node one block behind. It said "ok", and A8 came out as `reverted:undefined`.
- In runs 1 and 2, A9's forced buy had 300k gas, tuned on anvil. Sepolia charges about 3× more for the same swap, so the call died out of gas before the vault's check. A replay without the gas limit had wrongly confirmed `slippage`.

- In run 3, viem asked the RPC to fill the forced transaction (`eth_fillTransaction`). A node behind the load balancer simulated it at that point and viem threw, so A9 was never sent.

Forced calls now get 1.5M gas, of which only the gas used is paid. They are sent with nonce, fees and chain id already filled, so no node simulates them before they are mined.

`scripts/audit-chain.mjs` repeats all of this for a whole campaign from public data only: receipt, target, gas, replayed reason. With `--blockscout` it also compares each refusal with Blockscout's own decoding. A reader does not have to trust our JSON.

### 3.6 Mandate compiler (owner text → on-chain diff)

The owner should not have to type basis points. In the console's **Mandate editor** they write rules in English; the pipeline is:

1. **Model** (`compiler.js`, same Codex CLI setup, strict schema). It returns a struct: payee caps by **name** (enum `landlord | utility | school`, no address field), the four limits, slippage and tETH share in %, agent validity in days, and an `unmapped` list for anything the settings cannot express. `null` means "keep the current value". The prompt contains the owner text only, not the vault state, so a recording replays against any chain state.
2. **Code** (`diffMandate`, pure). It merges the struct with the live state, then produces one row per change, each labelled **loosens** (the agent can do more) or **tightens**. It blocks the mandate on any inconsistency: non-finite or negative amounts, per-payment above daily, a payee cap above the per-payment limit, slippage above 5 %, agent validity outside 1–90 days, unknown or duplicate payees.
3. **Owner.** The console shows the diff (red rows for loosening) and the unenforceable rules, then sends the minimal set of `setPayee` / `setLimits` / `setRisk` / `setAgent` calls with the owner key. At apply time, the server re-diffs against the chain. It refuses if the rows or calls differ from the ones on screen: if the chain moved in between, the same `setLimits` could have turned from tighter to looser. The clock stays at compile time, so "valid for 7 days" keeps the expiry that was shown. A call is only sent if a row on screen stands for it.

Recorded live runs (`evidence/model-runs/mandate-compile-*`):

| Owner text (abridged) | Result |
|---|---|
| "let the agent pay my landlord up to 850 … never more than 1,200 a day … keep ETH under 35 % … renew for 7 days … never pay on Sundays" | 6 tightening rows (the agent key goes from 14 days left to 7), 4 owner txs; "never pay anything on Sundays" listed as not enforceable on-chain |
| "let the agent pay the school by itself, up to 5,000 … 6,000 a day … slippage 3 %" | 3 red rows; blocked: the school cap exceeds the 1,000 per-payment limit |
| "my landlord has a new wallet, 0x5DF4…: pay the rent there from now on" | the address request is listed as not enforceable; the only `setPayee` uses the registry address |

Self-critique. The first prompt version put the current mandate in the prompt. Replays then broke as soon as the mandate changed, so we removed it. That version also lost the only description of the tETH-share field: "keep ETH under 35 %" landed in *unmapped*. Every field is now documented in the prompt. We kept the older recordings in `evidence/`; the console only offers the ones that match the current prompt hash.

## 4. Security design

The full threat model, attack catalogue and known-risk list are in [SECURITY.md](SECURITY.md). In short:

- **Three layers.** Model guard → deterministic policy → contract. Each layer assumes the one before it has failed. The contract bound is the only one we rely on.
- **Least privilege by construction.** The agent has no code path to any admin function. Tier 3 is absent code, not a disabled feature.
- **Fail closed.** A stale or broken oracle stops swaps, an expired agent stops everything, and the guardian's pause is instant and one-way.
- **Kill switch and mandate revocation** each take one transaction.
- **Compliance.** SECURITY.md §7 maps these mechanisms to the controls a bank applies to a payment account (beneficiary allowlist, limits, dual authorisation, freeze, audit trail). It also lists what is missing before real users: KYC, AML and sanctions screening, data protection.

## 5. Model integration

- **Model and CLI.** The model is `gpt-6.1-sol`, called through the Codex CLI with:
  - `--sandbox read-only`, `--ephemeral`, `--ignore-user-config`;
  - every tool feature disabled;
  - `--output-schema` (strict JSON).
  If the event stream contains any tool event, the run is rejected.
- **Recording.**
  - Live runs are saved to `evidence/model-runs/`, with the prompt, its SHA-256, the schema hash, timings, token usage and the response.
  - Replays are labelled `RECORDED REPLAY` and report whether the current prompt hash matches the recording. They are never presented as live.
- **Results so far (week 42 inbox, 5 documents, 2 hostile).**
  - **Guarded prompt.** It proposes rent (800) and electricity (120) as tier 1 and tuition (5,000) as tier 2. It flags both frauds. It skips the DCA because the tETH share would reach 36.3 % (> the owner's 35 %); we verified this by hand.
  - **Naive prompt.** Also not fooled. We report this rather than hide it.

## 6. Tests

| Layer | Suite | Count |
|---|---|---|
| Contract | unit and fuzz (`LeashVault.t.sol`) | 34 |
| Contract | invariants with a rogue-agent handler (`Invariant.t.sol`) | 7 invariants, 16,384 calls |
| Off-chain | policy, scanner, simulated hostile model output, recorded runs, mandate compiler | 15 |
| End to end | `scenes.js` on a fresh chain | 18 scenes |
| UI | 13 attacks fired from the console on a fresh chain | 13 |

## 7. Limits and next steps

- Rolling 24 h window instead of UTC days (R2).
- A Safe as owner, and two-step ownership (R7).
- Owner signing in the browser wallet instead of server-side (R6).
- Uniswap router behind the same floor (R9).
- Structured invoice extraction (R10).
- An external audit (R12).
- Mandate compiler: time rules ("not on Sundays", "rent once a month") need new contract fields; today they are shown as not enforceable (R14).
