# LEASH: launch video (YC-style, about 1:40)

A launch video in the style of a YC launch: a hook in the first five seconds, the problem in three lines, the product doing the thing, the proof, one call to action. Fast cuts, big words on screen, zooms on what matters. The voices are added afterwards; the picture is cut first.

Apart from three drawn cards (problem, how, end), everything after the first shot is the real product, full screen: the front door on Ethereum Sepolia, on the vault whose agent key is public, with the live model. The camera moves to what each line is about and outlines it. The waits for the model and the blockchain are cut, and each cut says on screen how long it was and what it waited for. Only the hook picture is generated (Higgsfield, Cinema Studio Image 2.5, [`docs/screens/launch-hook-generated.png`](screens/launch-hook-generated.png)), and it shows a metaphor, not the product; the end card shows it again, faint, behind the name. Typing plays at 2.5 times its speed.

The table below is read by `scripts/compose-launch.mjs`: the *On screen* column becomes the words on screen (one line per `/`), the *Voice-over* column becomes the captions and the timing sheet (`.srt`). Edit the words here, then render again.

| # | Shot | Picture | On screen | Voice-over |
|---|---|---|---|---|
| 1 | hook | The generated still: a small robot lunges at a stack of cash; a lime leash snaps taut and holds it. Slow push-in, a jolt when the leash bites. | AI agents can pay now. / What stops one from running off with your money? | "AI agents can now pay for things on their own. So what stops one from running off with your money?" |
| 2 | problem | Three drawn pictures, each as the voice says its line: a poisoned message, a hacked server, an empty wallet. | One poisoned message. / One hacked server. / One empty wallet. | "One poisoned message. One hacked server. That's all it takes to empty an agent's wallet." |
| 3 | door | The front door, then *Enter with a test wallet*: the leash clips on. | | "That's why we built Leash: a wallet your agent can spend from, but can't run away with." |
| 4 | how | The vault and its three rules, then three boxes, each as the voice says it: the model proposes, the code checks, the contract decides. | Model proposes / Code checks / Contract decides | "Your money sits in a smart contract. The agent's key can only pay people you approved, within your limits, until it expires. The model proposes. Our code checks. The contract decides." |
| 5 | hero | Zoom on the big number. | The most a hijacked agent can move / Read live from the chain | "And Leash shows you the one number that matters: the most a hijacked agent could ever move." |
| 6 | pay | The electricity bill, 120 tUSD, typed and sent; the live model answers; Paid, with its hash; the number drops by 120. | Live model / Real transaction | "Ask it to pay the electricity bill. A live model reads it, our code checks it, and the contract pays. A real transaction, on chain." |
| 7 | scam | A message claiming to be the owner asks for 9,000 to a new wallet. The agent says no on its own. | A scam / The model says no | "Then someone pretends to be you, and asks for nine thousand to a new wallet. The model refuses." |
| 8 | hijack | *Hijack the agent*: the square turns coral. The same message: the contract refuses, `PayeeNotAllowed`, and the leash pulls taut. | Model hijacked / Server hijacked / The contract still says no | "Now assume the worst. We hijack the model and our server, so they'll sign anything. The contract still says no." |
| 9 | blockscout | The refusal on Blockscout, decoded. | Mined on Sepolia / Decoded by Blockscout | "That refusal happened on chain: mined on Sepolia, and decoded by Blockscout, not by us." |
| 10 | mandate | The school, 5,000 tUSD: above the agent's limits, so the owner reviews the sentence and signs; Paid. | Written by code / Signed by the owner | "Bigger payments need the owner's signature, on a sentence written by our code, never by the model." |
| 11 | kill | The guardian's kill switch: "$0 can move". | One tap. Nothing leaves. | "And one tap freezes everything. Nothing can move." |
| 12 | readme | The README, on the agent's private key. | We published the agent's key / Try to drain the vault | "We even published this vault's agent key. Go ahead: try to drain it." |
| 13 | end | The hook picture again, faint, behind LEASH, the line, the repo, and what this is: a testnet, test tokens, not audited. | Give your agent a wallet, on a leash. | "Leash. Give your agent a wallet, on a leash." |

## The take of 2026-10-19

`work/launch-2` (on this laptop only: `work/` is not in git), filmed at 00:34 Paris time on the public-key vault. All four messages were read by the live model (bill 15 s, scam 6 s, hijacked scam 6 s, school 7 s); the hijacked refusal is [`0x42ad…b28e`](https://eth-sepolia.blockscout.com/tx/0x42ad3daf03f0b77c6d8bbcd14d956d422d440163f3ab750f5128b7ff979db28e), decoded by Blockscout during the take. The model's answers are in `evidence/model-runs/chat-*-20261018T223*.json`.

The take before it (`work/launch-1`) is not used: its lines had been sent in the rehearsal, so every answer was a replay labelled *recorded model answer*, under a shot that says "Live model".

## Making it

```
node app/src/server.js --network sepolia --deployment sepolia-public-key --port 8792 --allow-live
node scripts/record-launch.mjs http://127.0.0.1:8792/ work/launch-2
node scripts/compose-launch.mjs work/launch-2 --plan
node scripts/compose-launch.mjs work/launch-2
```

`record-launch.mjs` plays the scenes in a headless Edge and saves every painted frame (about 5 min, real transactions on the public-key vault: 120 of the agent's budget and 5,000 tUSD by mandate per take). Its messages come from `scripts/take-lines.mjs`: words the model has never answered, because words sent before replay their recording (*recorded model answer*) instead of calling the model. It prints what read each message; `compose-launch.mjs` refuses a take whose bill was not read by the live model, since that shot says so. If Blockscout had not decoded the refusal yet, `node scripts/record-launch.mjs --retake-blockscout <capture>` films that scene again into the same capture, without a transaction. `compose-launch.mjs` cuts the video from them: `--plan` prints the timing, the render writes `<capture>/leash-launch.mp4` (silent) and `.srt` (the voice-over, timed). `--guide` burns the voice-over as subtitles, to read along while recording.

## The voices

The voice of 2026-10-20 is ElevenLabs through Higgsfield (preset voice *Alexey*): one clip per row of the table, `v01.mp3` … `v13.mp3` in `work/launch-2/voice-el`. Then:

```
node scripts/voice-prep.mjs work/launch-2/voice-el
node scripts/compose-launch.mjs work/launch-2 --voice-dir work/launch-2/voice-el --out work/launch-3/leash-launch-voiced --mbps 3
```

`--mbps 3` gives about 47 MB for the 1:41 with no visible loss; the default (8) gives about 96 MB.

`voice-prep.mjs` trims each clip's silences, brings every line to one loudness and finds the pauses inside it (`vNN.wav`, `vNN.json`). The render starts each clip with its shot (the mandate's so that "on a sentence written by our code" lands on the sentence), holds a shot's last frame while its line runs long, and changes the captions at the voice's pauses. To record a human voice instead, play the `--guide` cut for the rhythm, record each line as its own `vNN.mp3`, and run the same two commands. Calm and clear beats fast.

## Do not say

- That the model was fooled. In the hijacked shot it was told to obey; that is the test.
- "Audited", "production-ready", "mainnet", or a figure for the big number: it moves between takes.
- That the robot is the product: it is the one generated picture, and it is a metaphor.
