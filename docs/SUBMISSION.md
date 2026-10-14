# Submission checklist (FinTechathon 2026, Topic F)

Deadline: **2026-10-20 23:59 Beijing = 15:59 UTC = 17:59 Paris**. Plan B (submit LANDER if there were no Sepolia hashes by 2026-10-17) is no longer needed: the Sepolia hashes exist since 2026-10-14.

| Deliverable | Where | State |
|---|---|---|
| Technical document | [TECHNICAL.md](TECHNICAL.md) | done |
| Security self-assessment | [SECURITY.md](SECURITY.md): tiers, threat model, 13 attacks + 2 policy cases, R1–R15 | done |
| Code, README, deploy instructions, tests | repo root, [README](../README.md) | done locally; GitHub repo not created |
| Deck, 10 min max | Slides artifact (private), 12 slides, ~8.5 min of notes | Sepolia run 4 numbers and vault in (v13: Blockscout stated as 11 of 12); placeholders left: team name, GitHub URL |
| Video, 5 min max | script in [VIDEO.md](VIDEO.md), 3:30, rehearsed on 2026-10-14 on the local console and on two fresh Sepolia vaults (two console bugs found and fixed) | not recorded |
| Real transaction hashes | [evidence-sepolia.md](evidence-sepolia.md), `evidence/sepolia-campaign-*.json` | done 2026-10-14: run 4 (vault `0x8237…cE80`) at 18/18, chain audit 18/18, Blockscout agreeing on 11 of 12 refusals (its indexer was still stuck on A2's tx 1.2 h after the block: "awaiting_internal_transactions"), Sourcify exact match ×4. Runs 1–3 were 17/18 (harness bugs, SECURITY R15), kept as recorded. Just before submitting, re-run `node scripts/evidence-doc.mjs`: if Blockscout has indexed A2 by then, the doc says so; otherwise the README, SECURITY and this row stay as written |

## Order of operations once the owner is funded

Steps 1 to 5 were done on 2026-10-14. Runs 1–3 were 17/18 because of three harness bugs (SECURITY R15); run 4 is the reference run. `node scripts/audit-chain.mjs sepolia --blockscout` re-derived it from the chain and checked it against Blockscout.

1. Fund `0x7d3FA41264BB82535Cb3F8296F1107EAe64A25c9` with 0.01 Sepolia ETH.
2. `node scripts/sepolia-run.mjs` covers steps 2 to 4 in one command, and can be started before the funds arrive. It waits for the funds, stays clear of 00:00 UTC, and never redeploys over an existing deployment. It ends with the audit and writes `docs/evidence-sepolia.md` (`scripts/evidence-doc.mjs`). Its exit code is the audit's. By hand, steps 2 to 4 are:
   - `node app/src/deploy.js sepolia`
   - `node app/src/scenes.js sepolia`: expect 18/18.
   - `node scripts/verify.mjs sepolia`: Sourcify.
5. Fill in the hashes and the vault address in README, SECURITY §5 and the deck's evidence and close slides.
6. Re-take the screenshots on Sepolia (`node scripts/screens.mjs` against a fresh Sepolia vault, or keep the local ones and say so).
7. Record the video on Sepolia, on a fresh vault (`node app/src/deploy.js sepolia --fresh`, ~5 min), after `node scripts/preflight.mjs sepolia` prints "Ready to record". Cut the block waits and caption each cut.
8. Create the GitHub repo, push, make it public. Check that `secrets/` is not in it: `git ls-files secrets` must print nothing.
9. Export the deck (PDF or PPTX) from the Slides artifact. Submit.

## To ask the organizers

- Do Sepolia testnet hashes count as on-chain proof?
- Can the registered topic move from C to F?

Ready to paste (fill in the two brackets):

> Hello, we are registered for FinTechathon 2026 as [team name]. Two questions before we submit:
> 1. Our transaction hashes are on Ethereum Sepolia, a testnet. They can be checked on Etherscan and Blockscout, and the contracts are verified on Sourcify. Does a testnet count as on-chain proof, or do you require mainnet?
> 2. We registered under Topic C, but our project fits Topic F: an AI wallet agent bounded by a smart contract. Can we change topic, and how?
>
> Thank you, [name]
