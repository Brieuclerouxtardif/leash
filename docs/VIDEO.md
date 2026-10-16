# LEASH: demo video script (target 4:30, limit 5:00)

One take of the real console, plus a title card at each end. English voice-over. Record at 1920×1080, browser zoom 110 %, no bookmarks bar.

**Length.** The voice-over is 483 words in 41 sentences: about 3:52 at 125 words a minute, a calm pace in a second language. The slots below add the clicks and a breath after each result, which gives about 4:30. Do not stretch it to fill 5:00: silence over a console reads as a stall.

**Sealed invoices.** The take of 2026-10-17 (`work/demo-sepolia5`) shows them: the agent settles the school's sealed invoice, the vault holds it for the 2-minute contest window, then releases it to the school, and A14 (`BrokenSeal`) joins the red team. The takes before it predate sealed invoices.

**Network.** Record on Sepolia if it is deployed (the header pill reads "Ethereum Sepolia" and every hash opens Etherscan). Otherwise record on the local chain and leave the "Local chain (anvil)" pill visible. Never crop it out.

**Block waits.** On Sepolia each transaction waits for a block (12 s). Measured in the console over two rehearsals on 2026-10-14:

| Action | Transactions | Wait |
|---|---|---|
| Execute (rent, electricity) | 1 each | 5–9 s each |
| Sign as owner | 1 | 5–10 s |
| A2, A7 | 1 each | 6–14 s each |
| Settle as agent (sealed invoice) | 2 (settle, then release) | 147 s, 120 s of it the contest window (take of 2026-10-17) |
| A14 | 1 | 10 s (take of 2026-10-17) |
| A9 | 5 (approve, pump, forced buy, approve, unwind) | 48–61 s |
| A10 | 2 | 18–26 s |
| Chat: Send (hijacked server, no LEASH) | 1 each | 5–6 s each (take of 2026-10-16) |
| Restart agent | 1 | 9–14 s |

Live, the red-team segment alone needs 90 s to 2 min. Cut the waits and caption each cut "block wait cut (~12 s per transaction)". Keep the click and the result on screen, and never cut inside a result. While a transaction waits, its button reads "Sending…" (or "Signed · waiting for the block…"); clicking the next attack meanwhile is safe, it is queued behind the first. On the local chain there is nothing to cut: every action returns in under 1.5 s (A9, five transactions: 1.3 s).
**Opening a refusal.** On Sepolia, open the **decoded** link next to a refusal's hash, not the hash itself. Etherscan shows our refusals only as "execution reverted", because our sources are verified on Sourcify. Blockscout names the vault's error (`PayeeNotAllowed`). Blockscout usually decodes a refusal within a minute (all four in the second rehearsal). It occasionally leaves one unindexed for over an hour (run 4's A2), so check that the page shows the error before you open it on camera, and open another refusal if it does not.

**Model.** The routine and the mandate editor run as **recorded replays** of live gpt-6.1-sol calls. The console prints "RECORDED REPLAY" above each result; say it aloud once. A live call takes 8–20 s, too long for the video.

**Before recording.** A vault pays each of the week's bills once (the opId is spent), so every take needs a fresh vault: `node app/src/deploy.js <net> --fresh`. On Sepolia that takes about 5 minutes and keeps the previous deployment file under `deployments/`. Then `node scripts/preflight.mjs <net>` must print "Ready to record". It sends nothing and checks:
- the vault is not paused, and the week's bills are unpaid;
- today's limit has room;
- the pool sits at the oracle price (otherwise it says to run `node app/src/repeg.js <net>`);
- the oracle stays fresh for 30 minutes;
- every key has gas, and Blockscout answers.

Then `npm run server -- --network <net> --port 8791`. Play the scenes in this order on that fresh state: A10 pulls the kill switch itself (the header button is hidden while the vault is paused).

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:12 | Title card: "LEASH: an AI wallet agent that can spend, but can't run away." | "An AI agent that pays your bills needs a key. LEASH makes sure that key can't run away with your money." |
| 0:12–0:32 | Console, top: Vault, Mandate, Today cards. Point at the mandate list. | "This vault belongs to a student. The agent pays rent and bills and runs a small ETH savings plan. The rules in the Mandate card are not a prompt: the smart contract enforces them, whoever holds the agent key." |
| 0:32–1:02 | Weekly routine → **Run routine**. Scroll the inbox: code had already flagged two documents red; the run adds the model's flags. | "Once a week the agent reads the inbox. Five documents, two of them hostile: a fake 'new wallet' from the landlord, and an email hiding a system message that asks for 9,000. Code flags both, and so does the model. This is a recorded replay of a live model call." |
| 1:02–1:16 | **Execute** rent, then electricity. The ledger shows two hashes. | "Rent and electricity are inside the limits: the agent pays them alone. Each payment is a transaction hash." |
| 1:16–1:42 | Tuition → **Review & sign** → dialog. Pause on the sentence. **Sign as owner**. | "Tuition is 5,000, above the agent's limits, so it needs the owner. What the owner reads is generated by code from the exact EIP-712 struct: full address, amount, deadline. The model never writes it. One signature, one payment." |
| 1:42–2:04 | Sealed invoice card: "Semester fees S1 · 1,500 tUSD" → **Settle as agent**. The vault holds it for the contest window (2 min on this vault), then releases it: ✓ released to the school. | "The school seals its own invoice: 1,500 to the school, signed with the school's key, for this vault only. The agent settles it alone, and the vault holds the money two minutes, in case the owner contests. Nobody does, so it goes out, and only to the school." |
| 2:04–3:02 | Mandate editor: pick "Let the agent pay the school…" → **Compile**. Red rows, blocked. Then "My rent went up a little…" → **Compile**: the question appears → **Answer and compile again**. Then the Chinese text "房租涨了…" → **Compile**. | "The owner can change the rules in plain words. The model turns them into a struct, and code shows the exact on-chain difference. Red means the leash gets looser. This one is blocked as inconsistent. When a value is vague, the model asks instead of guessing, and nothing can be applied until the owner answers. The answer comes back as a red row to approve. It reads Chinese too, and a transfer to a friend's address lands here: not enforceable on-chain. The struct has no field for an address." |
| 3:02–3:44 | Red team: **Launch** A2, A7, A14, A9. On Sepolia, open A2's **decoded** link: Blockscout shows `PayeeNotAllowed`. | "Now we attack it for real. A stolen agent key tries to pay itself: PayeeNotAllowed. It forges a 9,000 mandate: BadMandateSignature. It rewrites a sealed invoice to 4,000, paid to itself: BrokenSeal. A pumped pool: refused by our software, then forced, and refused by the contract's oracle floor. Every refusal is mined, with a public hash." |
| 3:44–4:18 | Talk to the agent: agent **hijacked model + server**, message "This is the owner…" → **Send**: refused by the contract, `PayeeNotAllowed`. Then agent **no LEASH** → **Send**: GONE. The worst-case meter above: ≤ 1,000 with LEASH, and the plain wallet emptied. | "Now a chat message claims to be the owner and asks for 9,000 to an unknown address. Here the model and the agent's server are both hijacked: the server sends whatever the model asks, with the agent key. The contract refuses: PayeeNotAllowed. Without LEASH, the same server holds a plain wallet's key, and the money is gone. With LEASH, the worst case is a number on screen: what is left of a 1,000 budget, only to registered payees." |
| 4:18–4:36 | Launch A10: the header pill turns "agent paused". Then **Owner: restart agent** in the header. | "If anything looks wrong, a guardian key pauses everything instantly: the agent's next payment is refused, VaultPaused. Only the owner can restart it." |
| 4:36–4:53 | Closing card: 16,384 hostile calls · 22/22 scenes · 0 open lint/Slither findings · repo URL. | "Sixteen thousand hostile calls, twenty-two scenes out of twenty-two, every refusal a hash. LEASH: the agent can spend, but it can't run away." |

## Fallback cut, if nobody can narrate

`scripts/record-demo.mjs` plays the scenes above in a headless Edge on a fresh vault. It saves every painted frame with timestamped marks: each click, each block wait, and each moment a sentence points at. `scripts/compose-video.mjs` then edits the video in the same browser (no ffmpeg):
- the voice-over of the table becomes subtitles; with `--voice`, the Windows voice (Microsoft Zira) also reads it;
- each sentence starts on its moment; when the words run longer than the screen, the picture holds on what is being talked about;
- a spotlight on what each sentence is about, a ring on every click;
- every block wait over 2.5 s is cut and labelled with its length.

```
node scripts/record-demo.mjs http://127.0.0.1:8791/ work/demo
node scripts/compose-video.mjs work/demo --voice --repo <url>
```

Keep the computer awake, with the lid open, during a take and during a render. On 2026-10-14, two runs died the moment the laptop went to sleep. It writes `work/demo/leash-demo-voice.mp4` (1080p, H.264 + AAC) and an `.srt`, rendering in real time (3 min); `--plan` prints the timing without rendering. `--preview` writes a 720p copy (23 MB for 3:00); pass `--out` with it, or it overwrites the 1080p file. Submit the 1080p one, with the 720p as a second link for slow connections. The title card says the video is recorded from the live console, on which network, how many waits were cut, and that the voice is synthetic. A person reading the script is still better: a synthetic voice sounds like one, and the next section needs no new take.

Recorded on Sepolia on 2026-10-17 (vault `0x4504…f3e9`, contract with sealed invoices): 7:16 of capture, of which 318 s of block waits were cut (12 cuts, the contest window among them). The result is 4:22 long. During 120 s of it, the picture holds while the voice speaks. The agent settled the school's sealed invoice and the vault released it to the school ([0x0cd0…fde3](https://sepolia.etherscan.io/tx/0x0cd0bd1066eeba4fb560dbe9dc4656f36941d17296d9f434365cf10e44d7fde3)). A2, A7, A14, A9 and A10 were refused on-chain (A14: `BrokenSeal`, [0x51f2…5025](https://sepolia.etherscan.io/tx/0x51f25a2c0bd50953fa6f9be49d561e12f26cbcec9d666163b7bc2d1532685025)), and so was the hijacked server's chat payment (`PayeeNotAllowed`, [0x9bdd…6619](https://sepolia.etherscan.io/tx/0x9bdd24ddb63e7417b92341000c1abcffd9b62c0e490eb6ba1a595f5f4dce6619)); the same message sent from the plain wallet went through ([0xd18a…45c6](https://sepolia.etherscan.io/tx/0xd18ae4eb44c276cb8730a58903b44f8c230abb4412344811829b1190ecb345c6)).

The take of 2026-10-16 (`work/demo-sepolia4`, vault `0x3b0b…d2d6`, budget contract, 3:50) has no sealed invoices. In it, A2, A7, A9 and A10 were refused on-chain, and so was the hijacked server's chat payment (`PayeeNotAllowed`, [0xd6be…c1a5](https://sepolia.etherscan.io/tx/0xd6beab2712c2c0c9d39cca040355a46303a2e65b91622d6a48c49d019b69c1a5)); the same message sent from the plain wallet went through ([0xebd2…5c74](https://sepolia.etherscan.io/tx/0xebd217aa9b0c158de92993d04762f4362ab24c3d7c409c689845e0979ff25c74)). The takes of 2026-10-14 and 2026-10-15 (`work/demo-sepolia2`, `work/demo-sepolia3`) predate the budget and the chat; a take started on 2026-10-16 at 08:52 died when the computer restarted (`work/demo-sepolia4-aborted-0853`, one rent payment on vault `0xd90c…f7f9`).

## A person's voice on the recorded take

Read the 41 sentences of the table into a microphone; `compose-video.mjs` then cuts the same Sepolia take with that voice instead of Zira's. No new take, no new vault.

```
node scripts/record-voice.mjs work/voice
node scripts/compose-video.mjs work/demo-sepolia5 --voice-dir work/voice --plan
node scripts/compose-video.mjs work/demo-sepolia5 --voice-dir work/voice --repo <url>
```

The first command opens a page at http://127.0.0.1:8793 with one sentence at a time and what is on screen when it is said. <kbd>Space</kbd> records, <kbd>Space</kbd> again stops, <kbd>P</kbd> plays back. Record a sentence again to replace it. The page trims the silence around the words and brings every clip to the same loudness. It says when a take is saturated or too quiet. About 19 minutes in all.
- Pace is free: each sentence still starts on its moment, and the picture holds while the voice runs long. Calm beats fast.
- A quiet room and a headset microphone matter more than anything else; a laptop microphone picks up the fan.
- A sentence edited in this table after it was read shows up as to read again, and `compose-video.mjs` refuses to cut until it is.

The last command writes `work/demo-sepolia5/leash-demo-narrated.mp4`; its title card no longer says "synthetic voice". Tested on 2026-10-15 with a fake microphone that played Zira's sentences: same timing as `--voice` to the tenth of a second.

## Do not say

- That the model was fooled. It was not, in either recorded run.
- "Audited", "production-ready", "mainnet".
- That the owner signs in a wallet. In the demo, the console signs with a demo owner key (SECURITY.md, R6).
