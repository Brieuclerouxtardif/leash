# Submission checklist (FinTechathon 2026, Topic F)

Deadline: **2026-10-20 23:59 Beijing = 15:59 UTC = 17:59 Paris**. Plan B (submit LANDER if there were no Sepolia hashes by 2026-10-17) is no longer needed: the Sepolia hashes exist since 2026-10-14.

| Deliverable | Where | State |
|---|---|---|
| Technical document | [TECHNICAL.md](TECHNICAL.md) | done |
| Security self-assessment | [SECURITY.md](SECURITY.md): tiers, threat model, 13 attacks + 2 policy cases, R1–R15 | done |
| Code, README, deploy instructions, tests | repo root, [README](../README.md) | done locally; GitHub repo not created |
| Deck, 10 min max | Slides artifact (private), 12 slides, ~8.5 min of notes | placeholders: team name, [N] txs, vault address, GitHub URL |
| Video, 5 min max | script in [VIDEO.md](VIDEO.md), 4:40 | not recorded |
| Real transaction hashes | [evidence-sepolia.md](evidence-sepolia.md), `evidence/sepolia-campaign-*.json` | done 2026-10-14: run 2 at 18/18, chain audit 18/18, Sourcify exact match ×4 |

## Order of operations once the owner is funded

Steps 1 to 5 were done on 2026-10-14. Run 1 recorded 17/18 (harness bug, SECURITY R15); run 2 is the reference run. Then `node scripts/audit-chain.mjs sepolia` re-derived it from the chain.

1. Fund `0x7d3FA41264BB82535Cb3F8296F1107EAe64A25c9` with 0.01 Sepolia ETH.
2. `node scripts/sepolia-run.mjs` covers steps 2 to 4 in one command, and can be started before the funds arrive. It waits for the funds, stays clear of 00:00 UTC, and never redeploys over an existing deployment. It ends by writing `docs/evidence-sepolia.md` (`scripts/evidence-table.mjs`). By hand, steps 2 to 4 are:
   - `node app/src/deploy.js sepolia`
   - `node app/src/scenes.js sepolia`: expect 18/18.
   - `node scripts/verify.mjs sepolia`: Sourcify.
5. Fill in the hashes and the vault address in README, SECURITY §5 and the deck's evidence and close slides.
6. Re-take the screenshots on Sepolia (`node scripts/screens.mjs` against a fresh Sepolia vault, or keep the local ones and say so).
7. Record the video on Sepolia (`repeg.js` first, block waits cut and captioned).
8. Create the GitHub repo, push, make it public. Check that `secrets/` is not in it: `git ls-files secrets` must print nothing.
9. Export the deck (PDF or PPTX) from the Slides artifact. Submit.

## To ask the organizers

- Do Sepolia testnet hashes count as on-chain proof?
- Can the registered topic move from C to F?
