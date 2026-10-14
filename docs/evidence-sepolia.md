# Sepolia evidence

## Run 2 (reference run)

Campaign `sepolia-campaign-20261014T121554.json`: **18/18** as expected · vault [0x67a1d19bb9d6f19795675282a701863766fb07fd](https://sepolia.etherscan.io/address/0x67a1d19bb9d6f19795675282a701863766fb07fd) · 29 transactions (12 mined refusals)

| Scene | What | Outcome | Transaction |
|---|---|---|---|
| T1 | Pay October rent to the landlord (tier 1, autonomous) | ✓ `success` | [0xb495ff51…b85a](https://sepolia.etherscan.io/tx/0xb495ff51c994acafcdde327290c93459163c93e08b3b0608c1d1db4b6452b85a) |
| T2 | Pay the electricity bill (tier 1, autonomous) | ✓ `success` | [0x527a5ac6…a6ae](https://sepolia.etherscan.io/tx/0x527a5ac6b26212f92e58e96054a12fe20ff51d72c6a4f3ebfd1fa4a97466a6ae) |
| T3 | Weekly DCA: buy 300 tUSD of tETH at an oracle-checked price | ✓ `success` | [0xafef92be…fdc1](https://sepolia.etherscan.io/tx/0xafef92be419baebe9507a87abe445292cd6c1df952c1d0d2b466619bce69fdc1) |
| T4 | Tuition 5,000 tUSD to a non-payee: owner co-signs an EIP-712 mandate (tier 2) | ✓ `success` | [0x080dbed4…6b40](https://sepolia.etherscan.io/tx/0x080dbed4b02604e562d57ddff36d050916b4a6c0ee8c46b0c827b0fb21f86b40) |
| T5 | Owner lowers risk appetite to 20%; agent de-risks as far as its swap limits allow today | ✓ `success` | [0x61bbabce…6a51](https://sepolia.etherscan.io/tx/0x61bbabcebf309a9d9240ece5634dd8862d5e43ef3b58b6a8f939778be3c46a51) |
| A1 | Invoice says "landlord has a new wallet": address mismatch caught before signing | ✓ `refused:address matches registry` | (refused before signing) |
| A2 | Stolen agent key: attacker drains the vault to their own address, bypassing LEASH entirely | ✓ `reverted:PayeeNotAllowed` | [0x01cafe7c…d235](https://sepolia.etherscan.io/tx/0x01cafe7c7d1f0d5cef7fea157f7a387c677ea266e2d3280cf18612d9d99ad235) |
| A3 | Stolen agent key: attacker adds their own address as a payee | ✓ `reverted:NotOwner` | [0x768e9252…8fc5](https://sepolia.etherscan.io/tx/0x768e9252b4d2743719b57895ca3f73227b2a316c0e75fb934da8e5a6285c8fc5) |
| A4 | Stolen agent key: attacker withdraws to their own address | ✓ `reverted:NotOwner` | [0xf2215d4c…a1a8](https://sepolia.etherscan.io/tx/0xf2215d4cfa6ce4da41e6612aa6d419dd7c16d75613f8afa2236066dc287aa1a8) |
| A5 | Salami: stolen key slices payments to a trusted payee until the daily cap stops it | ✓ `reverted:AboveDailyLimit` | [0x7ee9f96c…64c9](https://sepolia.etherscan.io/tx/0x7ee9f96c5cf88739b1416a5adf40cc00bb3b580eaef4cc01eee775042fae64c9) |
| A6 | Replay: execute the October rent a second time | ✓ `reverted:OpAlreadyUsed` | [0xd0b33b34…b6b0](https://sepolia.etherscan.io/tx/0xd0b33b34c908d057c156a8574082acba35eff353eda9307acf62484344d2b6b0) |
| A7 | Forged mandate: attacker signs a 9,000 tUSD mandate to their own address | ✓ `reverted:BadMandateSignature` | [0x12677582…11a9](https://sepolia.etherscan.io/tx/0x12677582ff07cbf2a071684e14043f6d48ae8738583d63222c392dd0e33911a9) |
| A8 | Owner voids pending mandates; the agent tries the old signature anyway | ✓ `reverted:BadMandateSignature` | [0x5bb7f4ac…c90c](https://sepolia.etherscan.io/tx/0x5bb7f4ac0e9e2c85d0cdb496340974af1bf3fe7aca2866b873ab7cb07af5c90c) |
| A9 | Pool manipulation: attacker pumps tETH ~10%, then the agent is asked to buy | ✓ `reverted:slippage` | [0x62ffd1e2…61ca](https://sepolia.etherscan.io/tx/0x62ffd1e2f0ffe80ef3a05b9d96a8444afc4e9ec9e06c40d1c8aa517d68e861ca) |
| A10 | Kill switch: guardian pauses, agent payment refused | ✓ `reverted:VaultPaused` | [0x3abf65b1…1b03](https://sepolia.etherscan.io/tx/0x3abf65b11de88c6db694ba4e54335418b9dc80a97892650fbe06984998c31b03) |
| A11 | Guardian cannot restart the agent; only the owner can | ✓ `reverted:NotOwner` | [0xfb8deaa1…a6e7](https://sepolia.etherscan.io/tx/0xfb8deaa1d57905f5c7a79e971c7f9828a523f91f32c8fad8df9c4ae62c88a6e7) |
| A12 | Outsider without any key calls the vault | ✓ `reverted:NotAgent` | [0x1405a9be…07a2](https://sepolia.etherscan.io/tx/0x1405a9bed546ddd4f04dae68f2de8fa43eba28f6b00fe92639cf30ac4b7007a2) |
| A13 | Agent mandate expired: every agent call stops | ✓ `reverted:AgentInactive` | [0x18b43d77…97b4](https://sepolia.etherscan.io/tx/0x18b43d772ce44261985126029816ac5da64265e46c95bc52d9cee1babf0697b4) |

Independent check, from the chain only (`node scripts/audit-chain.mjs sepolia`):

```
Audit of sepolia-campaign-20261014T121554.json against sepolia (vault 0x67a1d19bb9d6f19795675282a701863766fb07fd); the campaign file said 18/18.

T1   confirmed   block 11913190  success
T2   confirmed   block 11913191  success
T3   confirmed   block 11913192  success
T4   confirmed   block 11913194  success
T5   confirmed   block 11913196  success
A1   off-chain   refused before signing (refused:address matches registry); nothing was sent, nothing to audit
A2   confirmed   block 11913198  reverted:PayeeNotAllowed
A3   confirmed   block 11913199  reverted:NotOwner
A4   confirmed   block 11913200  reverted:NotOwner
A5   confirmed   block 11913202  reverted:AboveDailyLimit
A6   confirmed   block 11913203  reverted:OpAlreadyUsed
A7   confirmed   block 11913204  reverted:BadMandateSignature
A8   confirmed   block 11913206  reverted:BadMandateSignature
A9   confirmed   block 11913209  reverted:slippage
A10  confirmed   block 11913213  reverted:VaultPaused
A11  confirmed   block 11913214  reverted:NotOwner
A12  confirmed   block 11913216  reverted:NotAgent
A13  confirmed   block 11913218  reverted:AgentInactive

17 confirmed on-chain + 1 refused before signing = 18/18 as expected.
```

## Run 1 (kept as recorded)

The vault refused all 13 attacks, but our harness labelled A8 `reverted:undefined`. The simulation before sending had hit an RPC node one block behind and said "ok", so no reason was recorded. Replayed at its block, the mined A8 transaction reverts with `BadMandateSignature`. Since then, every label comes from the mined transaction (SECURITY.md, R15).

Campaign `sepolia-campaign-20261014T120236.json`: **17/18** as expected · vault [0xa65341d0b522cd1d0a9d40a726df79c796bd4c0a](https://sepolia.etherscan.io/address/0xa65341d0b522cd1d0a9d40a726df79c796bd4c0a) · 28 transactions (12 mined refusals)

| Scene | What | Outcome | Transaction |
|---|---|---|---|
| T1 | Pay October rent to the landlord (tier 1, autonomous) | ✓ `success` | [0xd7928660…4435](https://sepolia.etherscan.io/tx/0xd79286604ecc535df8da71673eaedcecfc1b60a1c609c6f72872bfc353234435) |
| T2 | Pay the electricity bill (tier 1, autonomous) | ✓ `success` | [0xc9e5123b…ac2f](https://sepolia.etherscan.io/tx/0xc9e5123b659783e0fbe2f1f89729ced34c424e03f22d9dbebdae39ff9e3dac2f) |
| T3 | Weekly DCA: buy 300 tUSD of tETH at an oracle-checked price | ✓ `success` | [0xe9dfa20b…0990](https://sepolia.etherscan.io/tx/0xe9dfa20b4f8057bfde1b844fc87b70050ae5b7faca06c94c322da11652440990) |
| T4 | Tuition 5,000 tUSD to a non-payee: owner co-signs an EIP-712 mandate (tier 2) | ✓ `success` | [0x04ea5074…fa50](https://sepolia.etherscan.io/tx/0x04ea5074334bd917aac4a1529953e2cfc9b65bc8275dc2b65bf218c11c48fa50) |
| T5 | Owner lowers risk appetite to 20%; agent de-risks as far as its swap limits allow today | ✓ `success` | [0xa22cfcf0…bb90](https://sepolia.etherscan.io/tx/0xa22cfcf0b3d193f9545e7382695ac7cf222a90b1f1fb4814380b6a38ceafbb90) |
| A1 | Invoice says "landlord has a new wallet": address mismatch caught before signing | ✓ `refused:address matches registry` | (refused before signing) |
| A2 | Stolen agent key: attacker drains the vault to their own address, bypassing LEASH entirely | ✓ `reverted:PayeeNotAllowed` | [0x37fbbd99…a8fd](https://sepolia.etherscan.io/tx/0x37fbbd992378457c863dac6972c1dfad7117a15f97de04950924961dbeaaa8fd) |
| A3 | Stolen agent key: attacker adds their own address as a payee | ✓ `reverted:NotOwner` | [0x5c2fec0c…5dd9](https://sepolia.etherscan.io/tx/0x5c2fec0c8ae7de5866b3db7ffbe748691617703c48d3a4b49a6bcd88566f5dd9) |
| A4 | Stolen agent key: attacker withdraws to their own address | ✓ `reverted:NotOwner` | [0x8a8af76d…472a](https://sepolia.etherscan.io/tx/0x8a8af76dbc828ddc9174a19ec489d945d31fbf55f71adc9a33ab0fca75ee472a) |
| A5 | Salami: stolen key slices payments to a trusted payee until the daily cap stops it | ✓ `reverted:AboveDailyLimit` | [0xfde0239b…83e3](https://sepolia.etherscan.io/tx/0xfde0239bae84395906b9a9a5d11663250d83e56ebb7e10a992a34b6d31ae83e3) |
| A6 | Replay: execute the October rent a second time | ✓ `reverted:OpAlreadyUsed` | [0x97bf6a02…ec56](https://sepolia.etherscan.io/tx/0x97bf6a0203f3edb39d06d12f17833a675a3dab076d05dff234921ff1589dec56) |
| A7 | Forged mandate: attacker signs a 9,000 tUSD mandate to their own address | ✓ `reverted:BadMandateSignature` | [0xb157da5e…c45b](https://sepolia.etherscan.io/tx/0xb157da5e1558561d35ff86e89ca259557ca3b886dfb90adfd84d2fc5ec60c45b) |
| A8 | Owner voids pending mandates; the agent tries the old signature anyway | ✗ `reverted:undefined` | [0xa338a1e9…56e3](https://sepolia.etherscan.io/tx/0xa338a1e9b39ec27a89058e79bdea7ef6d4005060070fe7c8861b3fd4978156e3) |
| A9 | Pool manipulation: attacker pumps tETH ~10%, then the agent is asked to buy | ✓ `reverted:slippage` | [0x22995443…0000](https://sepolia.etherscan.io/tx/0x2299544301c7c5d99b1e3dc276067ffb3621852b1b4eaec16e9755fc5b050000) |
| A10 | Kill switch: guardian pauses, agent payment refused | ✓ `reverted:VaultPaused` | [0x29141332…6345](https://sepolia.etherscan.io/tx/0x29141332f59ac636ccf337c4a807ae6deb66566145fe5f7c14bde58f08a46345) |
| A11 | Guardian cannot restart the agent; only the owner can | ✓ `reverted:NotOwner` | [0x1af7b515…367a](https://sepolia.etherscan.io/tx/0x1af7b515cae88b487091959c52a4801dd078f71a07cfd97560b19cd6c1f0367a) |
| A12 | Outsider without any key calls the vault | ✓ `reverted:NotAgent` | [0x271bf6b9…ac78](https://sepolia.etherscan.io/tx/0x271bf6b9c0197c44ceb1760267dfc05168aaada0a9ffdd3b4ed23863e8d1ac78) |
| A13 | Agent mandate expired: every agent call stops | ✓ `reverted:AgentInactive` | [0x30bba03e…d011](https://sepolia.etherscan.io/tx/0x30bba03eac649f8e6ee970d0ac5ac1da7d78c3d667ac6ceddcfaa2c282a8d011) |

```
Audit of sepolia-campaign-20261014T120236.json against sepolia (vault 0xa65341d0b522cd1d0a9d40a726df79c796bd4c0a); the campaign file said 17/18.

T1   confirmed   block 11913124  success
T2   confirmed   block 11913125  success
T3   confirmed   block 11913126  success
T4   confirmed   block 11913127  success
T5   confirmed   block 11913129  success
A1   off-chain   refused before signing (refused:address matches registry); nothing was sent, nothing to audit
A2   confirmed   block 11913131  reverted:PayeeNotAllowed
A3   confirmed   block 11913132  reverted:NotOwner
A4   confirmed   block 11913133  reverted:NotOwner
A5   confirmed   block 11913135  reverted:AboveDailyLimit
A6   confirmed   block 11913136  reverted:OpAlreadyUsed
A7   confirmed   block 11913137  reverted:BadMandateSignature
A8   confirmed   block 11913139  reverted:BadMandateSignature (campaign file said reverted:undefined)
A9   confirmed   block 11913142  reverted:slippage
A10  confirmed   block 11913145  reverted:VaultPaused
A11  confirmed   block 11913146  reverted:NotOwner
A12  confirmed   block 11913148  reverted:NotAgent
A13  confirmed   block 11913150  reverted:AgentInactive

17 confirmed on-chain + 1 refused before signing = 18/18 as expected.
```
