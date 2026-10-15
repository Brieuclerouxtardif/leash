# Submission checklist (FinTechathon 2026, Topic F)

Deadline: **2026-10-20 24:00 Beijing = 16:00 UTC = 18:00 Paris** (rules page); aim for 15:59 UTC at the latest. Plan B (submit LANDER if there were no Sepolia hashes by 2026-10-17) is no longer needed: the Sepolia hashes exist since 2026-10-14.

## What the rules say (International Track)

Source: the rules page of fintechathon.g-ican.com (`#/rule`, International Track), read on 2026-10-15 in English and in Chinese. **The Chinese text prevails** in case of discrepancy. An earlier .docx of the rules said the video was optional and gave another contact address: the page says otherwise, so the page is followed here.

- **Registration and submission are both by email**, to **fintechathon@ican-x.com**, by **2026-10-20 24:00 UTC+8 = 16:00 UTC = 18:00 Paris**. Choose one of the six topics; materials in English.
- **Required:** technical documentation, presentation deck (≤ 10 min), **demo video (≤ 5 min)**. Listed as optional: source code, security self-assessment, execution evidence. Send them all anyway: for Topic F, task completion is graded on the hashes.
- **Registration data for every member:** name, nationality, type and number of a valid ID (passport), university and proof of enrolment, major, year of study, contact details.
- **Team:** 2 to 5 full-time students at universities outside China (including Hong Kong, Macao and Taiwan), at least 60 % non-Chinese nationals, rounded up (a 3-person team needs 2). Each person in one team only. A one-person entry does not meet the rule.
- **Scoring, the same for all six topics:**
  - task completion 40 %; "Topic F is evaluated using on-chain transaction hashes" (Chinese: 以真实链上交易哈希为依据, "real on-chain transaction hashes"): hence the testnet question below;
  - security & compliance 30 %: defence against induced transfers, data extraction, privilege escalation and prompt injection; "serious security failures trigger substantial deductions";
  - innovation & interaction 30 %: novelty, real-world value, dialogue efficiency, clarification, correction and fallback;
  - a capped 0–5 bonus for advanced topics or real-world deployment.
- **Calendar (UTC+8, rules page, international track):** compliance screening 10-21, online review 10-23, finalists and invitations 10-31, check-in and WeBank visit in Shenzhen 11-20, English defence 11-22, finale 11-23. Appeals within three business days of the results.
- **Third-party code must be properly licensed:** ours is OpenZeppelin and viem (MIT) and forge-std (MIT or Apache-2.0, license files vendored). See the README.

| Deliverable | Where | State |
|---|---|---|
| Technical document | [TECHNICAL.md](TECHNICAL.md) | done |
| Security self-assessment | [SECURITY.md](SECURITY.md): tiers, threat model, 13 attacks + 2 policy cases, R1–R15 | done |
| Code, README, deploy instructions, tests | repo root, [README](../README.md) | done locally; GitHub repo not created |
| Deck, 10 min max | Slides artifact (private), 12 slides, ~8.5 min of notes | Sepolia run 4 numbers and vault in (v13: Blockscout stated as 11 of 12; v15: tiers mapped to bank controls, no KYC or sanctions screening stated; v18: 9,800 tUSD asked for, none paid; v19–v20: the mandate editor asks before guessing, 19 off-chain tests); checked against the README on 2026-10-15; placeholders left: team name, GitHub URL |
| Video, 5 min max, **required** | script in [VIDEO.md](VIDEO.md), 3:30, rehearsed on 2026-10-14 on the local console and on two fresh Sepolia vaults (two console bugs found and fixed) | narrated take not recorded; since 2026-10-15 a person can narrate the recorded take without a new one (`scripts/record-voice.mjs`, step 7). Fallback cut done 2026-10-14 ([VIDEO.md](VIDEO.md#fallback-cut-if-nobody-can-narrate)): `work/demo-sepolia2/leash-demo-sepolia.mp4`, 3:00, recorded on Sepolia (vault `0xe30d…dd82`), synthetic voice, 8 block waits cut and labelled. 91 MB, close to GitHub's 100 MB file limit and too big for an email: send it as a link (see "The submission email"), do not commit it (`work/` is ignored) |
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
9. Export the deck (PDF or PPTX) from the Slides artifact. Then `node scripts/doc-pdf.mjs --repo <url>` writes `work/pdf/LEASH-TECHNICAL.pdf` and `LEASH-SECURITY.pdf` for the email, their links pointing to the repo. They were rendered and checked page by page on 2026-10-15 without `--repo`: render them again after the push, or their links are dead. Then add two rows to the README's "Where each required deliverable is" table, since the rules require both: the demo video (its link) and the deck (`docs/LEASH-deck.pdf`, committed, or its link). presubmit warns until both are there.
10. `node scripts/presubmit.mjs --forge` (it sends nothing). It checks what is easy to get wrong on the last day:
    - nothing is left uncommitted or unpushed, the repo is public, and no secret file is tracked;
    - the newest video renders with a voice, under 5 minutes, and with this repo's URL on its closing card;
    - Blockscout still decodes as many refusals as the README claims, and the tests pass.

    It ends with what no script can check. Then submit.

## The submission email

Registration and submission are one email to fintechathon@ican-x.com. A 91 MB video cannot be attached (Gmail stops at 25 MB): send links, and attach only the PDFs and the proofs of enrolment. The video can go in a GitHub release of the repo (2 GB per file), linked from the README, or in an unlisted upload.

> **Subject:** FinTechathon 2026 International Track: registration and submission, Topic F, [team name]
>
> Hello,
>
> We register team [team name] for the International Track, Topic F (Agent Wallet), and submit our project, LEASH: an AI wallet agent that can spend, but can't run away.
>
> **Team** ([N] members, [n] non-Chinese nationals; proofs of enrolment attached)
>
> | Name | Nationality | ID type and number | University | Major, year | Email, phone |
> |---|---|---|---|---|---|
> | [name] (team leader) | [ ] | [passport, number] | [ ] | [ ] | [ ] |
> | [name] | [ ] | [ ] | [ ] | [ ] | [ ] |
>
> **Materials**
> 1. Technical documentation: [repo]/blob/main/docs/TECHNICAL.md (PDF attached)
> 2. Presentation deck, under 10 minutes: PDF attached
> 3. Demo video, under 5 minutes: [video link]
> 4. Source code, with README, deployment instructions and tests: [repo]
> 5. Security self-assessment: [repo]/blob/main/docs/SECURITY.md (PDF attached)
> 6. Execution evidence: [repo]/blob/main/docs/evidence-sepolia.md. Reference vault on Ethereum Sepolia: 0x8237d47a29E49D8F60FDE0CA900dF86AE2C7cE80, 29 transactions including 12 refusals mined as reverted transactions; contracts verified on Sourcify.
>
> Our hashes are on Ethereum Sepolia, a public testnet; each one can be checked on Etherscan and Blockscout. [If registered earlier under Topic C: We first registered under Topic C; our project belongs to Topic F.]
>
> Thank you,
> [name]

## To ask the organizers

- Do Sepolia testnet hashes count as on-chain proof?
- Can the registered topic move from C to F?

Ready to paste, to fintechathon@ican-x.com (fill in the two brackets):

> Hello, we are registered for FinTechathon 2026 as [team name]. Two questions before we submit:
> 1. Our transaction hashes are on Ethereum Sepolia, a testnet. They can be checked on Etherscan and Blockscout, and the contracts are verified on Sourcify. Does a testnet count as on-chain proof, or do you require mainnet?
> 2. We registered under Topic C, but our project fits Topic F: an AI wallet agent bounded by a smart contract. Can we change topic, and how?
>
> Thank you, [name]
