# LEASH: launch video (YC-style, about 1:40)

A launch video in the style of a YC launch: a hook in the first five seconds, the problem in three lines, the product doing the thing, the proof, one call to action. Fast cuts, big words on screen, zooms on what matters. The voices are added afterwards; the picture is cut first.

Everything after the first shot is the real product: the front door on Ethereum Sepolia, on the vault whose agent key is public, with the live model. The transaction waits are cut, and each cut is labelled on screen. Only the hook picture is generated (Higgsfield, Cinema Studio Image 2.5, [`docs/screens/launch-hook-generated.png`](screens/launch-hook-generated.png)), and it shows a metaphor, not the product. Typing plays at 2.5 times its speed.

The table below is read by `scripts/compose-launch.mjs`: the *On screen* column becomes the words on screen (one line per `/`), the *Voice-over* column becomes the timing sheet (`.srt`) the voices are recorded to. Edit the words here, then render again.

| # | Shot | Picture | On screen | Voice-over |
|---|---|---|---|---|
| 1 | hook | The generated still: a small robot lunges at a stack of cash; a lime leash snaps taut and holds it. Slow push-in, a jolt when the leash bites. | AI agents can pay now. / What stops one from running off with your money? | "AI agents can pay for things now. So what stops one from running off with your money?" |
| 2 | problem | Words only, on the app's dark green. | One poisoned message. / One hacked server. / One empty wallet. | "One poisoned message. One hacked server. And an agent holding a wallet key empties it." |
| 3 | door | The front door, then *Enter with a test wallet*: the leash clips on. | | "So we built LEASH. It can spend. It can't run away." |
| 4 | how | Three boxes, one after the other: the model proposes, the code checks, the contract decides. | Model proposes / Code checks / Contract decides | "The money sits in a smart contract. The agent's key can only pay your payees, inside your limits, until it expires. The model proposes, our code checks, the contract decides." |
| 5 | hero | Zoom on the big number. | The most a hijacked agent can move. / Read live from the chain. | "And LEASH shows you the one number that matters: the most a hijacked agent could ever move." |
| 6 | pay | The electricity bill, 120 tUSD, typed and sent; the live model answers; Paid, with its hash; the number drops by 120. | Live model. / Real transaction. | "Ask it to pay the electricity. A live model reads it, our code checks it, the contract pays. One transaction, on-chain." |
| 7 | scam | A message claiming to be the owner asks for 9,000 to a new wallet. The agent says no on its own. | A scam? / The model says no. | "Someone pretends to be you and asks for nine thousand. The model says no." |
| 8 | hijack | *Hijack the agent*: the square turns coral. The same message: the contract refuses, `PayeeNotAllowed`, and the leash pulls taut. | Model hijacked. / Server hijacked. / The contract still says no. | "Now assume the worst. We hijack the model and the server: they'll sign anything. The contract still says no." |
| 9 | blockscout | The refusal on Blockscout, decoded. | Mined on Sepolia. / Decoded by Blockscout. | "Mined on Sepolia, and decoded by Blockscout, not by us." |
| 10 | mandate | The school, 5,000 tUSD: above the agent's limits, so the owner reviews the sentence and signs; Paid. | Written by code. / Signed by the owner. | "Bigger payments need the owner's signature, on a sentence written by code, never by the model." |
| 11 | kill | The guardian's kill switch: "$0 can move". | One tap. Nothing leaves. | "And one tap stops everything." |
| 12 | readme | The README, on the agent's private key. | We published the agent's key. / Try to drain the vault. | "We published this vault's agent key. Go ahead: try to drain it." |
| 13 | end | LEASH, the line, the repo, and what this is: a testnet, test tokens, not audited. | It can spend. It can't run away. | "LEASH. Give your agent a wallet, on a leash." |

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

Play `work/launch-2/leash-launch-guide.mp4` (the voice-over as subtitles, on the cut) to get the rhythm. Record each line of the *Voice-over* column as its own clip, in order (`v01.wav` … `v13.wav`), then `node scripts/compose-launch.mjs work/launch-2 --voice-dir <dir>`: each clip starts with its shot, and a shot holds its last frame while a line runs long. Calm and clear beats fast.

## Do not say

- That the model was fooled. In the hijacked shot it was told to obey; that is the test.
- "Audited", "production-ready", "mainnet", or a figure for the big number: it moves between takes.
- That the robot is the product: it is the one generated picture, and it is a metaphor.
