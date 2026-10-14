# Submission checklist (FinTechathon 2026, Topic F)

Deadline: **2026-10-20 23:59 Beijing = 15:59 UTC = 17:59 Paris**. Plan B (submit LANDER if there were no Sepolia hashes by 2026-10-17) is no longer needed: the Sepolia hashes exist since 2026-10-14.

## What the rules say (International Track, fintechathon.g-ican.com)

- **Scoring, the same for all six topics:** task completion 40 %, security & compliance 30 %, innovation & interaction 30 %, plus a 0–5 point bonus for on-chain exploration.
- **Team:** 2 to 5 full-time students at universities outside China, at least 60 % non-Chinese nationals, each in one team only. A one-person entry does not meet the rule.
- **Registration closes with submission**, at the same deadline.
- **The video is optional** (5 min max). The deck, the technical document, the code, the security self-assessment and the hashes are not.
- **A submission can be updated until the deadline**; the latest version counts. Submit a complete version as soon as the repo is public, then update it, rather than everything on the last day.
- **Third-party code must be properly licensed:** ours is OpenZeppelin and viem (MIT) and forge-std (MIT or Apache-2.0, license files vendored). See the README.
- **Calendar:** online review in late October, finalists announced by 2026-10-31, final in Shenzhen 2026-11-21 to 23 (check-in on 11-20). At least one member must attend in person, or the team loses its award eligibility; travel and accommodation are covered for invited members.
- **Contact:** info@ican-x.com (for the questions below).

| Deliverable | Where | State |
|---|---|---|
| Technical document | [TECHNICAL.md](TECHNICAL.md) | done |
| Security self-assessment | [SECURITY.md](SECURITY.md): tiers, threat model, 13 attacks + 2 policy cases, R1–R15 | done |
| Code, README, deploy instructions, tests | repo root, [README](../README.md) | done locally; GitHub repo not created |
| Deck, 10 min max | Slides artifact (private), 12 slides, ~8.5 min of notes | Sepolia run 4 numbers and vault in (v13: Blockscout stated as 11 of 12; v15: tiers mapped to bank controls, no KYC or sanctions screening stated); checked against the README on 2026-10-15; placeholders left: team name, GitHub URL |
| Video, 5 min max, optional in the rules | script in [VIDEO.md](VIDEO.md), 3:30, rehearsed on 2026-10-14 on the local console and on two fresh Sepolia vaults (two console bugs found and fixed) | narrated take not recorded; since 2026-10-15 a person can narrate the recorded take without a new one (`scripts/record-voice.mjs`, step 7). Fallback cut done 2026-10-14 ([VIDEO.md](VIDEO.md#fallback-cut-if-nobody-can-narrate)): `work/demo-sepolia2/leash-demo-sepolia.mp4`, 3:00, recorded on Sepolia (vault `0xe30d…dd82`), synthetic voice, 8 block waits cut and labelled. 91 MB, close to GitHub's 100 MB file limit: upload it to the submission platform, do not commit it (`work/` is ignored) |
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
7. Record the video on Sepolia, on a fresh vault (`node app/src/deploy.js sepolia --fresh`, ~5 min), after `node scripts/preflight.mjs sepolia` prints "Ready to record". Cut the block waits and caption each cut. Without a new take, two ways, both re-rendered with `--repo <url>` once the repo exists (3 min each):
   - **Narrated (preferred):** read the 30 sentences over the recorded Sepolia take, about 15 min at a microphone ([VIDEO.md](VIDEO.md#a-persons-voice-on-the-recorded-take)): `node scripts/record-voice.mjs work/voice`, then `node scripts/compose-video.mjs work/demo-sepolia2 --voice-dir work/voice --repo <url>`.
   - **Synthetic voice:** the fallback cut above, `node scripts/compose-video.mjs work/demo-sepolia2 --voice --repo <url> --out work/demo-sepolia2/leash-demo-sepolia`.
8. Create the GitHub repo, push, make it public. Check that `secrets/` is not in it: `git ls-files secrets` must print nothing.
   - Checked on 2026-10-15. None of the 24 commits contains `secrets/`, a `.env` file or any of the 7 real keys. A fresh clone passes the whole README (forge, npm, campaign 18/18, console).
   - Two decisions before pushing:
     - **License.** The contracts already say `SPDX-License-Identifier: MIT`, but there is no LICENSE file, so the rest of the code has no license. If MIT is fine, add a root `LICENSE` file.
     - **Commit email.** The commits carry the author's personal email. GitHub shows it publicly. To hide it, rewrite the author to the GitHub noreply address before the first push. A rewrite gives every commit a new hash, and boucle.md cites three of them (54d833b, 04948f3, 9c382c2); they would have to be replaced with the new hashes, or the citations would point nowhere.
   - Then create an empty repo on github.com (no README, no license; `gh` is not installed here), and push:
     - `git remote add origin https://github.com/<user>/leash.git`
     - `git push -u origin main`
9. Export the deck (PDF or PPTX) from the Slides artifact.
10. `node scripts/presubmit.mjs --forge` (it sends nothing). It checks what is easy to get wrong on the last day:
    - nothing is left uncommitted or unpushed, the repo is public, and no secret file is tracked;
    - the newest video renders with a voice, under 5 minutes, and with this repo's URL on its closing card;
    - Blockscout still decodes as many refusals as the README claims, and the tests pass.

    It ends with what no script can check. Then submit.

## To ask the organizers

- Do Sepolia testnet hashes count as on-chain proof?
- Can the registered topic move from C to F?

Ready to paste, to info@ican-x.com (fill in the two brackets):

> Hello, we are registered for FinTechathon 2026 as [team name]. Two questions before we submit:
> 1. Our transaction hashes are on Ethereum Sepolia, a testnet. They can be checked on Etherscan and Blockscout, and the contracts are verified on Sourcify. Does a testnet count as on-chain proof, or do you require mainnet?
> 2. We registered under Topic C, but our project fits Topic F: an AI wallet agent bounded by a smart contract. Can we change topic, and how?
>
> Thank you, [name]
