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
| Security self-assessment | [SECURITY.md](SECURITY.md): tiers, threat model, 13 attacks + 2 policy cases, R1–R16 | done |
| Code, README, deploy instructions, tests | repo root, [README](../README.md) | done locally; GitHub repo not created |
| Deck, 10 min max | Slides artifact (private), 12 slides, ~8.5 min of notes | Sepolia run 4 numbers and vault in (v13: Blockscout stated as 11 of 12; v15: tiers mapped to bank controls, no KYC or sanctions screening stated; v18: 9,800 tUSD asked for, none paid; v19–v21: the mandate editor asks before guessing and reads Chinese, 20 off-chain tests; v22: the cover names the topic as the site does, "Agent Wallet"; v23: tier 3 checked on the deployed code, 21 off-chain tests, Blockscout's count stated as variable; v24: Blockscout agreeing on all 12); checked against the README on 2026-10-15; placeholders left: team name, GitHub URL |
| Video, 5 min max, **required** | script in [VIDEO.md](VIDEO.md), 3:50, rehearsed on 2026-10-14 on the local console and on two fresh Sepolia vaults (two console bugs found and fixed); new take on 2026-10-15 for the mandate editor's question and the Chinese text, rehearsed locally first | narrated take not recorded; a person can narrate the recorded take without a new one (`scripts/record-voice.mjs`, step 7). Fallback cut done 2026-10-15 ([VIDEO.md](VIDEO.md#fallback-cut-if-nobody-can-narrate)): `work/demo-sepolia3/leash-demo-sepolia.mp4`, 3:13, recorded on Sepolia (vault `0x52a9…f224`), synthetic voice, 8 block waits cut and labelled. 65 MB (H.264 capped at 3 Mb/s), too big for an email: send it as a link (see "The submission email"), do not commit it (`work/` is ignored) |
| Real transaction hashes | [evidence-sepolia.md](evidence-sepolia.md), `evidence/sepolia-campaign-*.json` | done 2026-10-16: run 5 (vault `0x8487…3e15`, the contract with the agent budget) at 18/18, chain audit 18/18, Blockscout agreeing on every refusal it has indexed (all 12 on 2026-10-16 at 06:39 UTC; its indexer drops some back to "awaiting_internal_transactions": run 4, 7 of 12 on 2026-10-15 at 12:00 UTC), Sourcify exact match ×4 (sent through Sourcify's API, `scripts/verify.mjs`), and `scripts/bytecode-check.mjs` finding no entry point outside the ABI in the deployed vault. Runs 1–3 were 17/18 (harness bugs, SECURITY R15), kept as recorded; run 4 was 18/18 on the previous contract. Just before submitting, re-run `node scripts/evidence-doc.mjs` so the doc shows Blockscout's state that day; the README gives the best count with its date, so it stays true either way |

## Order of operations once the owner is funded

Steps 1 to 5 were done on 2026-10-14. Runs 1–3 were 17/18 because of three harness bugs (SECURITY R15); run 4 passed on the previous contract; run 5 (2026-10-16, the contract with the agent budget) is the reference run. `node scripts/audit-chain.mjs sepolia --blockscout` re-derived it from the chain and checked it against Blockscout.

1. Fund `0x7d3FA41264BB82535Cb3F8296F1107EAe64A25c9` with 0.01 Sepolia ETH.
2. `node scripts/sepolia-run.mjs` covers steps 2 to 4 in one command, and can be started before the funds arrive. It waits for the funds, stays clear of 00:00 UTC, and never redeploys over an existing deployment. It ends with the audit and writes `docs/evidence-sepolia.md` (`scripts/evidence-doc.mjs`). Its exit code is the audit's. By hand, steps 2 to 4 are:
   - `node app/src/deploy.js sepolia`
   - `node app/src/scenes.js sepolia`: expect 18/18.
   - `node scripts/verify.mjs sepolia`: Sourcify.
5. Fill in the hashes and the vault address in README, SECURITY §5 and the deck's evidence and close slides.
6. Re-take the screenshots on Sepolia (`node scripts/screens.mjs` against a fresh Sepolia vault, or keep the local ones and say so).
7. Record the video on Sepolia, on a fresh vault (`node app/src/deploy.js sepolia --fresh`, ~5 min), after `node scripts/preflight.mjs sepolia` prints "Ready to record". Cut the block waits and caption each cut. Without a new take, two ways, both re-rendered with `--repo <url>` once the repo exists (3 min each):
   - **Narrated (preferred):** read the 32 sentences over the recorded Sepolia take, about 15 min at a microphone ([VIDEO.md](VIDEO.md#a-persons-voice-on-the-recorded-take)): `node scripts/record-voice.mjs work/voice`, then `node scripts/compose-video.mjs work/demo-sepolia3 --voice-dir work/voice --repo <url>`.
   - **Synthetic voice:** the fallback cut above, `node scripts/compose-video.mjs work/demo-sepolia3 --voice --repo <url> --out work/demo-sepolia3/leash-demo-sepolia`.
8. Create the GitHub repo, push, make it public. Check that `secrets/` is not in it: `git ls-files secrets` must print nothing.
   - Checked on 2026-10-15. None of the 24 commits contains `secrets/`, a `.env` file or any of the 7 real keys. A fresh clone passes the whole README (forge, npm, campaign 18/18, console).
   - Two decisions before pushing:
     - **License.** Decided on 2026-10-15: MIT, like the contracts' `SPDX-License-Identifier`. The root `LICENSE` file is in.
     - **Commit email.** Decided on 2026-10-15: hidden. The commits carry the author's personal email, and GitHub shows it publicly. `work/4-publier.cmd` (the owner's push script, outside the repo) rewrites every commit on both branches to the account's GitHub noreply address before the first push, with `work/masquer-email.mjs`. The files are unchanged, but every hash changes, so the script also replaces the commit hashes cited in the tracked docs, mostly the journal. It refuses to run once a remote exists. Tested on 2026-10-15 on a clone, pushed to a local bare repo: 70 commits rewritten, no personal address left in any author, committer, message or diff, every cited hash resolves to a pushed commit.
   - Then create an empty repo on github.com (Public, no README, no license; `gh` is not installed here), and run `work/4-publier.cmd`. It checks that no secret is tracked and nothing is uncommitted, hides the email, then pushes `main` and `base-mainnet`. Both branches go up because the journal cites two `base-mainnet` commits. Neither branch contains any of the 7 keys in `secrets/` (scanned on 2026-10-15).
9. Export the deck (PDF or PPTX) from the Slides artifact. Then `node scripts/doc-pdf.mjs --repo <url>` writes `work/pdf/LEASH-TECHNICAL.pdf` and `LEASH-SECURITY.pdf` for the email, their links pointing to the repo. They were rendered and checked page by page on 2026-10-15 without `--repo`: render them again after the push, or their links are dead. Then add two rows to the README's "Where each required deliverable is" table, since the rules require both: the demo video (its link) and the deck (`docs/LEASH-deck.pdf`, committed, or its link). presubmit warns until both are there, and fails if the video link does not serve the newest render from a public release.
   - `work/5-finir.cmd` (owner's script, outside the repo) does this step once the release and `work/LEASH-deck.pdf` exist. Until then it stops and says exactly what to do. It writes both rows, commits, pushes, then fills `work/MAIL-SOUMISSION.txt` from the template below with every link, leaving only the team to write. It ends with presubmit. Tested on 2026-10-15 on a clone pushed to a local bare repo, with a mock release list. The stops worked, the full run pushed one commit, and a second run changed nothing.
10. `node scripts/presubmit.mjs --forge` (it sends nothing). It checks what is easy to get wrong on the last day:
    - nothing is left uncommitted or unpushed, the repo is public, and no secret file is tracked;
    - the newest video renders with a voice, under 5 minutes, and with this repo's URL on its closing card;
    - Blockscout still decodes as many refusals as the README claims, and the tests pass.

    It ends with what no script can check. Then submit.

## The submission email

Registration and submission are one email to fintechathon@ican-x.com. The site opens on the domestic track, whose footer shows fintechathon@g-ican.com: that address is not ours. The international tab shows ican-x.com (checked on 2026-10-15 at 11:20). The 1080p video cannot be attached (65 MB; Gmail stops at 25 MB): send links, and attach only the PDFs and the proofs of enrolment. Put the video in a GitHub release of the repo (2 GB per file) and link it from the README. Not YouTube or Google Drive alone: both are blocked in mainland China, and the organizers are there. GitHub opens from China but can be slow, so the 720p copy (`--preview`, about 25 MB) is worth a second link in the same release.

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
> 6. Execution evidence: [repo]/blob/main/docs/evidence-sepolia.md. Reference vault on Ethereum Sepolia: 0x8487aa5d276387dd2BE76330d391f4643B893e15, 29 transactions including 12 refusals mined as reverted transactions; contracts verified on Sourcify.
>
> Our hashes are on Ethereum Sepolia, a public testnet; each one can be checked on Etherscan and Blockscout. [If registered earlier under Topic C: We first registered under Topic C; our project belongs to Topic F.]
>
> Thank you,
> [name]

## To ask the organizers

- Do Sepolia testnet hashes count as on-chain proof? If the answer is mainnet, or if no answer comes by
  the 18th, the branch `base-mainnet` reruns the campaign on Base (about $5 of gas to fund, $0.10 spent;
  steps in its `docs/BASE.md`). Real money: the team decides. Rehearsed on a fork of Base on 2026-10-15
  (18/18, audited), but never on the live network, so run it early.
- Can the registered topic move from C to F?

Ready to paste, to fintechathon@ican-x.com (fill in the two brackets):

> Hello, we are registered for FinTechathon 2026 as [team name]. Two questions before we submit:
> 1. Our transaction hashes are on Ethereum Sepolia, a testnet. They can be checked on Etherscan and Blockscout, and the contracts are verified on Sourcify. Does a testnet count as on-chain proof, or do you require mainnet?
> 2. We registered under Topic C, but our project fits Topic F: an AI wallet agent bounded by a smart contract. Can we change topic, and how?
>
> Thank you, [name]
