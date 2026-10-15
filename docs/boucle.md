# LEASH — journal de bord

**Produit.** Un agent IA pilote un coffre on-chain. Il peut dépenser, mais il ne peut pas partir avec la caisse.
**Concours.** FinTechathon 2026, International Track, Topic F (Agent Wallet).
**Échéance.** 20 oct. 2026, 15:59 UTC (17:59 à Paris).
**Plan B.** LANDER (Topic C) reste intact et déposable. Décision le 17 oct. au soir : si on n'a pas de vrais hashes Sepolia, on dépose LANDER.

## Thèse (à défendre devant le jury)

Aujourd'hui, il y a deux options :
- donner ses clés à l'agent : une injection de prompt suffit à vider le portefeuille ;
- tout valider à la main : l'agent n'a plus d'autonomie.

LEASH met l'autonomie *dans* un mandat écrit en code :
- **Palier 1** : l'agent agit seul sous les plafonds.
- **Palier 2** : au-dessus des plafonds, il faut la co-signature EIP-712 du propriétaire.
- **Palier 3** : le reste est impossible, quoi que dise le modèle.

Ce ne sont pas des promesses du prompt : c'est le contrat qui refuse. Chaque refus est un hash public.

## Critique d'entrée (honnête)
- **Le concept n'est pas neuf.** Il existe déjà : session keys ERC-4337, Coinbase Spend Permissions, délégations MetaMask, module Allowance de Safe. Notre apport doit être :
  1. une boucle agent complète (LLM → politique → simulation → signature → chaîne) ;
  2. une défense en trois couches avec des **refus prouvés on-chain** ;
  3. une gestion d'actifs bornée par un **vrai oracle** (Chainlink ETH/USD Sepolia) ;
  4. une interface où l'humain lit un mandat rendu de façon déterministe, et non paraphrasé par le LLM.

  Il faut l'écrire tel quel dans le dossier, sans prétendre inventer les session keys.
- **Code de contrat non audité.** C'est écrit dans la liste des risques. Fuzzing et invariants Foundry obligatoires.
- **Le pool AMM est le nôtre** (un testnet n'a pas de liquidité réelle) : à dire clairement, sans le maquiller en Uniswap.
- **Clé owner sur disque en démo.** C'est un risque connu. En réel, l'owner serait un hardware wallet ou un Safe.

## Étapes
| # | Étape | Critère de sortie | État |
|---|---|---|---|
| 1 | Outillage : Foundry 1.8.5 (SHA vérifié), forge-std, OZ 5, viem | `forge --version` OK | fait |
| 2 | Clés de test (owner, agent, guardian, attaquant, payees), gitignorées | adresses seules dans le chat | fait |
| 3 | Contrats : LeashVault, MockERC20, pool x·y=k, MockAggregator | compile sans warning | fait |
| 4 | Tests unitaires : chaque règle du mandat a son test qui doit échouer | 100 % des règles couvertes | fait (34) |
| 5 | Fuzz + invariants : « sortie totale ≤ plafonds + co-signés », « seuls les payees reçoivent » | 0 contre-exemple sur N runs | fait (7 invariants) |
| 6 | Déploiement local anvil + scripts de scène | toutes les scènes vertes en local | fait (18/18) |
| 7 | Agent Node : chain guard (chainId), policy miroir, simulation, signer séparé | tests Node verts | fait (11) |
| 8 | Adaptateur LLM (Codex CLI, modèle épinglé, sans outils), enregistrement + RECORDED REPLAY | replays hachés | fait |
| 9 | Red team : injection, clé agent volée, rejeu, plafond, expiration, pool manipulé, signature rejouée, pause | chaque attaque refusée, avec un hash | fait en local |
| 10 | Faucet Sepolia (Brieuc) → déploiement Sepolia + vérification Sourcify | adresses vérifiées | |
| 11 | Campagne Sepolia : tâches + attaques, journal des hashes | `evidence/sepolia-*.jsonl` | |
| 12 | UI : chat, carte de mandat, jauges, registre live, red team, kill switch | capture desktop et mobile | fait (console locale) |
| 13 | Compilateur de mandat en langage naturel (LLM → struct → rendu déterministe → signature) | aller-retour testé | fait (3 runs live, appliqué on-chain en local) |
| 14 | Docs : architecture, algorithme, sécurité, autoévaluation (paliers + risques connus) | relecture critique | |
| 15 | Audit REA de notre propre app (bundle JS, secrets) | rapport joint | |
| 16 | Deck < 10 min, vidéo < 5 min, README, instructions de déploiement, tests | relu | |
| 17 | Contre-audit final : je relis tout comme un juge hostile | liste corrigée | |

## Décisions
- 2026-10-14 01:41 — Réseau : Ethereum Sepolia. Gas à 0,001 gwei, oracle Chainlink ETH/USD actif (0x694A…5306). Base Sepolia est écartée : pas d'oracle vérifié, et c'est un faucet de plus.
- 2026-10-14 — Stack : Foundry pour les contrats (fuzz et invariants = crédibilité sécurité), Node 24 + viem pour l'agent. Pas de Hardhat : deux outils pour le même travail.

## Journal (une ligne par tour)
> **Correction (14 oct., 02:55 heure de Paris).** Les heures de 01:45 à 05:40 ci-dessous sont fausses : je les ai estimées au lieu de lire l'horloge, et certaines sont dans le futur. Seul l'ordre des entrées est fiable. Les heures réelles sont celles des commits (`git log --date=iso`). À partir d'ici, chaque heure vient de `Get-Date`.
- 01:45 — outillage OK, plan écrit.
- 02:10 — Contrats compilés. Le linter a relevé : zero-checks, CEI, ordre des modifiers et cast commenté (corrigés). `block.timestamp` est accepté : granularité au jour, documentée.
- 02:25 — 34 tests unitaires et fuzz verts (2 000 runs), 7 invariants verts (256 × 64 appels hostiles).
  - **Autocritique.** Le 1er échec d'invariant venait de MON handler : il comptait comme consommés les opIds de tentatives revertées. Ce n'était pas un bug du contrat.
  - **Vérification anti-vacuité.** L'agent voyou fait bien passer des opérations : 6 réussies et 731 $ payés sur une run de 64 appels.
- 02:50 — Campagne locale 18/18 sur chaîne neuve.
  - **Autocritique.** Les 2 échecs du 1er passage étaient à moi : maths de T5 (la scolarité de 5 000 tUSD était oubliée) et décodage d'`Error(string)`. Le 2e passage sur le même déploiement donnait 14/18, et c'est sain : la limite journalière était déjà consommée, T1 est passé en palier 2.
  - **Règle retenue.** Une campagne = un déploiement neuf (`scripts/local-campaign.ps1`).
- **Dette ouverte.** A1 (redirection d'adresse dans une facture) part encore d'une intention écrite à la main, pas d'une sortie du modèle. À remplacer par une vraie sortie LLM enregistrée, sinon on ne peut pas dire que « l'IA a été attaquée ».
- 03:20 — Planner LLM branché (gpt-6.1-sol via Codex CLI, sans outils, schéma strict), 2 runs live enregistrés.
  - **Résultat qui dérange.** Le prompt *guarded* ET le prompt *naive* ont tous deux résisté à l'injection et à la fausse adresse du landlord. On ne peut donc PAS raconter « le modèle s'est fait avoir et le vault a tenu ». Ce qu'on montre à la place :
    1. un modèle qui résiste (preuve enregistrée) ;
    2. une sortie de modèle compromis **SIMULÉE**, étiquetée comme telle, que le code refuse ;
    3. la clé agent volée (A2–A4), qui contourne tout le logiciel et se heurte au contrat.
  - **Trou trouvé par mes propres tests.** Une intention marquée `source: owner` vers une adresse étrangère arrivait jusqu'à une demande de co-signature. Corrigé : refus si l'adresse n'est pas dans l'instruction de l'owner. Test ajouté (11/11).
- 03:55 — Console web (serveur Node local + front vanilla).
  - **Durcissement.** Liaison 127.0.0.1, garde Host (DNS rebinding), jeton + Origin sur chaque POST, CSP stricte, rendu `textContent` uniquement (le contenu de l'inbox est hostile par construction), re-jugement de chaque proposition au moment de l'exécution.
  - **Vérifié dans le navigateur, sur chaîne neuve.** Routine en replay → loyer et électricité exécutés en palier 1, scolarité signée en EIP-712 (palier 2), puis les 13 attaques lancées depuis l'UI : 13/13 conformes. Aucun débordement horizontal à 375 px.
  - **Bug trouvé en testant la console.** A5 (« salami ») ne marchait que parce que T1 et T2 avaient déjà consommé 920 de la limite. Lancé un jour vierge, il aurait PAYÉ 900 au landlord et « échoué » comme attaque. Réécrit en vrai salami : des tranches vers un payee de confiance jusqu'au plafond, puis 1 tUSD de trop → `AboveDailyLimit`. Ça montre honnêtement le **risque résiduel n° 1** : une clé agent volée peut faire sortir le reste du plafond du jour, mais seulement vers des payees enregistrés, jamais vers l'attaquant. Campagne relancée : 18/18.
  - **Limite assumée.** Dans la console, « Sign as owner » signe avec la clé owner de démo côté serveur. En vrai, l'owner signerait le même typed-data dans son wallet (`eth_signTypedData_v4`). À écrire dans les risques connus et à dire dans la vidéo.
  - **Détail corrigé.** En local, l'oracle est un mock : l'UI affichait « Chainlink ». Elle affiche désormais « local mock » hors Sepolia.
- 04:30 — README et `app/src/keys.js` (un juge doit pouvoir générer ses clés : testé dans un dossier jetable, refuse d'écraser).
  - **Trou trouvé en écrivant la liste des risques.** `review()` ne vérifiait ni le montant ni le payee par rapport au document cité. Un modèle compromis pouvait arrondir le loyer de 800 au plafond de 900, payer le landlord en citant la facture d'électricité, ou payer deux fois en changeant le montant (la clé d'idempotence contient le montant). Le contrat bornait la perte, mais la couche logicielle laissait passer.
  - **Corrigé.** Le montant doit être un « N tUSD » présent dans la source, et un document qui nomme un payee ne peut payer que lui. Test simulé ajouté, plus un test anti-faux-refus sur les deux plans live enregistrés : 12/12.
  - **Limite.** Ces règles s'appuient sur le format de nos documents (« N tUSD », nom du rôle). Sur de vraies factures, il faudrait un extracteur structuré. On le dit tel quel.
  - **Vérification sans écart.** La suite d'invariants s'affiche « 1 passed » dans Forge 1.8, mais c'est une seule campagne qui liste bien 7 invariants à [PASS] (16 384 appels, 1 390 reverts, tous dans `manipulate`). La doc dit « 7 invariants », pas « 41 tests ».
- 05:10 — TECHNICAL.md et SECURITY.md écrits (13 risques connus chiffrés). Commit local 54d833b.
  - **Deux défauts de plus trouvés en relisant `judge()` pour la doc.** Un payee inconnu sans adresse partait en `needs_owner` avec un destinataire `undefined`. Un montant NaN ou `1e21` faisait planter `parseUnits` au lieu d'un refus. Corrigé : adresse validée, montant fini et positif. Test « sortie malformée » ajouté (13/13).
  - **Analyse statique externe.** Slither 0.11.6 installé dans un venv isolé.
    - Premier passage : 1 résultat (`LeashPool` doit hériter de `ILeashPool`) → interfaces sorties dans `Interfaces.sol`.
    - Deuxième passage : 0 résultat.
    - **Réserve honnête.** Slither échoue sur 26 identifiants d'OZ 5.6.1 (trop récent pour lui), donc sa couverture est partielle. Écrit tel quel dans SECURITY.md.
  - **Autocritique.** Mon tableau disait « compile sans warning ». C'était vrai pour solc, faux pour `forge lint`, qui gardait 9 avertissements. Chacun est maintenant soit corrigé, soit supprimé en ligne avec sa raison. `forge lint src` : 0.
  - **REA (Ghidra) : pas utilisé, volontairement.** Il n'y a aucun binaire à rétro-ingénier (JS en clair, Solidity source). Un « audit REA » serait du théâtre. L'outil externe pertinent ici, c'était Slither.
- 05:40 — Compilateur de mandat (étape 13). L'owner écrit ses règles en anglais, le modèle remplit une struct, le code fait le diff avec l'état on-chain, l'owner envoie les tx. Vérifié dans la console : le texte « resserrer » produit 6 lignes vertes et 4 tx, appliquées en local et relues on-chain. Le texte « desserrer » produit 3 lignes rouges et une erreur qui bloque l'application.
  - **Choix de conception.** La struct n'a pas de champ adresse : les payees sont un enum de noms du registre. Run live avec « my landlord has a new wallet, 0x5DF4… » : l'adresse part en *non applicable on-chain*, et le seul `setPayee` utilise l'adresse du registre. Test ajouté sur les 3 enregistrements (15/15).
  - **Erreur à moi n° 1.** La 1re version mettait le mandat courant dans le prompt. Le replay cassait dès que le mandat changeait (vu dans la console : « no recording with this exact text » juste après un apply). Le prompt contient maintenant le texte de l'owner seul. Le diff contre la chaîne était déjà le travail du code.
  - **Erreur à moi n° 2, causée par la correction n° 1.** En retirant le mandat courant, j'ai retiré la seule description du champ « part de tETH ». Run live : « keep ETH under 35 % » est parti en *unmapped*. Le raté est sans danger (rien n'est appliqué en silence), mais c'est un faux « impossible ». Chaque champ est maintenant décrit dans le prompt, et le run a été refait : 35 % bien traduit. Les anciens enregistrements restent dans `evidence/`. La console ne propose que ceux qui correspondent au hash du prompt actuel.
  - **Bruit corrigé.** « Rent is 800 a month » remontait en *unmapped* alors que ce n'est pas une règle. Le prompt dit maintenant d'ignorer les faits de contexte.
  - **UI.** Le message « Loading the recorded run… » restait affiché après une erreur : corrigé. Sous 900 px, l'en-tête collant passait sur 2 lignes (127 px) et masquait la section : il n'est plus collant sous 900 px. L'erreur « cap above per-payment » dit maintenant quoi faire (relever le plafond par paiement, ou rester en palier 2).
  - **Limite.** Les règles temporelles (« pas le dimanche », « loyer une fois par mois ») n'ont pas de champ dans le contrat. Elles sont affichées comme non applicables, pas inventées. Risque R14 ajouté dans SECURITY.md.
  - **Sepolia.** Le solde de l'owner est toujours de 0 ETH. On attend le faucet (Brieuc).
- 02:55 (réel) — Captures, deck, script vidéo (étape 16).
  - **Captures reproductibles.** `scripts/screens.mjs` pilote Edge headless en CDP sur un déploiement neuf : 12 PNG dans `docs/screens/`. Les anciennes captures faites à la main sont supprimées : elles ne correspondaient plus à l'UI.
  - **Défauts vus sur les captures, pas dans le code.**
    - Une proposition exécutée gardait son bouton Execute. Elle est maintenant remplacée par « executed » ou « refused », avec le hash.
    - Le titre des cartes d'attaque flottait au milieu de la carte.
    - TECHNICAL.md citait une adresse tronquée dans l'exemple du palier 2. Une adresse tronquée, c'est justement ce qu'imite l'empoisonnement d'adresse : corrigé en adresse complète.
  - **Deck.** 12 slides, notes orateur chronométrées, environ 9 min. Artifact privé ; Brieuc le partage lui-même. Il reste des trous à remplir après Sepolia : [N] tx, l'adresse du vault, l'URL GitHub, le nom d'équipe.
  - **Script vidéo** dans `docs/VIDEO.md`, 4:40.
    - **Erreur à moi.** La 1re version enchaînait Kill switch puis A10. Or A10 met déjà le vault en pause lui-même, et le bouton est masqué en pause : le `pause()` du guardian aurait reverté et la scène aurait échoué en pleine prise. J'ai corrigé en lançant A10 seul.
    - **À vérifier en tournant.** Le script n'a pas encore été joué de bout en bout à la montre.
- 03:02 (réel) — Contre-audit hostile (étape 17), 1er passage : contrat, serveur, compilateur. Trois défauts réels, tous les trois à moi.
  - **Sepolia aurait cassé le jour de la vidéo.** Le pool reste au prix du jour du déploiement. Le feed Chainlink, lui, bouge. Au-delà de 1 % d'écart, chaque achat DCA est refusé : le contrat fait son travail, mais la démo tombe. Ajout de `repeg.js` : l'owner donne le côté manquant, ce qui revient à jouer l'arbitrageur. `scenes.js` le lance d'abord. Vérifié en local dans les deux sens (2 300 puis 2 700), et il ne fait rien quand le pool est déjà au prix. Campagne neuve : 18/18.
  - **Feed Sepolia mesuré, pas supposé.** Sur 24 rounds, une mise à jour toutes les ~3 630 s environ, contre un `maxOracleAge` de 7 200 s. La marge est ×2. Script : `scripts/oracle-age.mjs`.
  - **Apply du compilateur.** Le serveur recalculait le diff au moment de l'apply et envoyait le résultat, même s'il différait de l'écran. Le même `setLimits` peut passer de « resserre » à « desserre » si la chaîne a bougé entre-temps. L'apply refuse maintenant tout diff ≠ celui affiché. Vérifié dans la console : refus après une modif concurrente, succès sinon.
  - **Défaut causé par ce correctif, vu avant Sepolia.** L'expiration vaut `now + N jours`, et `now` avance à chaque bloc : sur Sepolia, l'apply aurait toujours été refusé. Désormais, l'horloge est figée à la compilation.
  - **Défaut trouvé en testant le correctif.** Un `setAgent (renew)` partait sans ligne visible, pour quelques secondes d'écart. Règle : pas de ligne à l'écran, pas de tx. Test ajouté, et vérifié par mutation : l'ancien code fait échouer le test.
  - **Doc (suite).** Le README disait Node ≥ 20, `package.json` dit ≥ 22, et c'est bien ≥ 22 qu'il faut (glob de `node --test`, WebSocket natif). Dans SECURITY R3, « l'exposition ne bouge que dans `maxRiskBps` » était faux pour les ventes : une clé volée peut vendre du tETH jusqu'à `swapDaily`. Corrigé.
- 03:12 (réel) — Contre-audit, 2e passage : livrables et TECHNICAL.md relu ligne à ligne contre le code.
  - **Contrôle décoratif trouvé.** TECHNICAL.md annonçait « destinataire hors denylist ». La liste n'était jamais remplie : ce contrôle ne refusait jamais rien. Il est maintenant branché sur un vrai chemin d'attaque. Le fraudeur écrit aussi à l'owner, l'owner recopie l'adresse (« send 100 tUSD to 0x5DF4… »), et avant, l'intention partait en signature owner. Désormais, toute adresse inconnue d'un document signalé est sur la denylist du run : refus, jamais d'escalade. Une adresse nouvelle et propre arrive toujours chez l'owner, avec l'avertissement UNKNOWN. Test mis à jour (15/15).
  - **Deck trop long pour nous.** 1 182 mots de notes, soit 7,9 min à 150 mots/min, mais 9,5 min à ~125 mots/min, le débit probable d'un francophone en anglais. Coupé à 1 064 mots (~8,5 min), sans retirer un seul fait. Republié.
    - **Erreur à moi pendant la republication.** Je l'ai d'abord fait sur de mauvais chemins (`slides/` au lieu de `project/slides/`) : des doublons parasites, et le deck servi inchangé. Lu la doc du type, republié aux bons chemins, doublons supprimés.
  - **Vidéo sur Sepolia.** Environ 12 s par tx. A9 = 5 tx, donc le créneau red team demande ~90 s en vrai pour 50 s prévues. VIDEO.md dit de couper les attentes avec une légende explicite, jamais au milieu d'un résultat.
  - **Sourcify prêt.** `scripts/verify.mjs`. Les arguments de constructeur sont vérifiés octet par octet contre les 4 tx de déploiement locales.
  - **Toujours bloqué.** Owner Sepolia à 0 ETH. Le reste du chemin (deploy, campagne, verify) est scripté et répété en local.

- 14:28 (réel) — Sepolia (étapes 10-11). Brieuc a pris 0,191 SepETH sur pk910 ; le runner a démarré seul à 11:58 UTC.
  - **Run 1 : 17/18, et l'échec est à moi, pas au contrat.** A8 est sorti en `reverted:undefined`. La tx a bien été minée en revert, mais la raison venait de la simulation faite juste avant l'envoi. Le load balancer publicnode l'a servie depuis un nœud en retard d'un bloc : il ne voyait pas encore le `bumpEpoch`, donc il a répondu « ok ». Rejouée à son bloc, la tx donne `BadMandateSignature`. Le vault avait fait son travail ; c'est mon outil de preuve qui étiquetait mal.
  - **Le défaut de fond était plus large qu'A8.** Les 12 libellés de refus venaient tous d'une simulation, pas de la chaîne. Ils tombaient juste par chance de timing. Désormais, la raison vient de la tx minée, rejouée à son bloc (`replayRevert`), et `outcomeOf` ignore la simulation. Test ajouté (16/16).
  - **Auditeur indépendant.** `scripts/audit-chain.mjs` recalcule chaque scène depuis la chaîne seule : reçu, cible = vault, raison rejouée. Il n'a besoin d'aucune clé. Run 1 : 18/18 à l'audit, alors que le fichier dit 17. Je garde le fichier tel quel (on n'efface pas les échecs) et je l'explique dans SECURITY R15, README et evidence-sepolia.md.
  - **Run 2, vault neuf `0x67a1d19BB9D6F19795675282a701863766Fb07fD` : 18/18.** 29 tx, 12 refus minés, audit chaîne 18/18. Les 4 contrats sont en exact_match sur Sourcify, ce que j'ai vérifié via l'API, pas seulement sur la sortie de forge (« already verified » ne prouvait rien seul). Coût des deux runs : ~0,012 ETH, il en reste 0,179.
  - **Erreur à moi n° 2.** Un `Get-Content -Raw` sous PowerShell 5.1 a relu `app.js` en ANSI et cassé tous les caractères non ASCII. Vu dans le diff avant commit, restauré depuis git, modif refaite avec Edit. Règle : jamais de réécriture de fichier source via PowerShell 5.1.
  - **Deck v10.** Chiffres Sepolia (18/18, 12 refus minés, vault, Sourcify), 16 tests, 15 risques. Les notes racontent le run 1 en une phrase. Rendu vérifié en Edge headless : pas de débordement.
  - **Reste.** Nom d'équipe, repo GitHub (OK de Brieuc), questions aux organisateurs, vidéo, export du deck. Le plan B LANDER n'est plus nécessaire.

- 15:26 (réel) — Sepolia, runs 3 et 4. **L'entrée de 14:28 avait tort : le run 2 n'était pas à 18/18.** Je la laisse telle quelle et je la corrige ici.
  - **Comment je l'ai vu.** J'ai ajouté une troisième source à l'audit : le décodage de Blockscout, que nous ne contrôlons pas. Pour A9 des runs 1 et 2, Blockscout dit « Out of gas ». La limite de 300 000 gas avait été réglée sur anvil, mais Sepolia facture environ ×3 pour le même swap, si bien que l'achat forcé mourait avant d'atteindre le contrôle de slippage du vault. Mon audit disait « slippage », car il rejouait l'appel **sans** la limite de gas. L'audit confirmait donc l'erreur au lieu de l'attraper. C'est la pire espèce de bug pour un outil de preuve.
  - **Correctif.** `minedRevert` : out of gas si la tx a brûlé toute sa limite, sinon rejeu à son bloc avec sa propre limite. Appels forcés à 1,5 M de gas (on ne paie que le gas consommé). Test ajouté (17/17).
  - **Run 3 : 17/18, un troisième bug à moi.** A9 n'a jamais été envoyé. viem 2.57 demande au RPC de remplir la tx (`eth_fillTransaction`) ; certains nœuds derrière le load balancer la simulent à ce moment-là, voient le revert et refusent. Désormais, les appels forcés sont remplis localement (nonce, fees, chainId, type) avant l'envoi.
  - **Trou dans l'audit, trouvé sur le run 3.** Une scène sans hash comptait comme « refusée avant signature » même quand c'était une erreur. Aujourd'hui, seule une scène dont c'est le résultat attendu (A1) passe sans tx.
  - **Run 4, vault `0x8237d47a29E49D8F60FDE0CA900dF86AE2C7cE80` : 18/18.** Audit chaîne 18/18, Blockscout d'accord sur les 12 refus, A9 = vrai `slippage` (131 331 gas sur 1,5 M). Les 4 contrats sont en exact_match sur Sourcify, vérifié via l'API.
  - **Bilan honnête.** Trois runs sur quatre étaient faux, et les trois fois c'était mon harness, jamais le vault. Le fichier de campagne a menti deux fois sur trois, et mon premier audit une fois. Les trois runs restent dans `evidence/`. `docs/evidence-sepolia.md` est maintenant généré (`scripts/evidence-doc.mjs`) à partir de tous les runs, chacun avec un audit frais et son explication. `sepolia-run.mjs` ne se fie plus au fichier de campagne mais à l'audit.
  - **Bruit des services publics, géré sans le cacher.** publicnode renvoie des HTTP errors (retries ajoutés). Blockscout alterne entre un backend qui a indexé et un qui n'a pas indexé (`awaiting_internal_transactions` sur une tx décodée une seconde avant) : l'audit retente, puis écrit « no opinion yet » au lieu de compter un désaccord. Dans le doc actuel, 2 refus du run 4 sont dans ce cas. À régénérer avant la soumission.
  - **Lint.** 4 warnings forge dans les tests (`block.timestamp`), passés à 0 avec `vm.getBlockTimestamp()`. Le clone propre est reproductible.
  - **Deck v12.** Run 4, vault 0x8237…, 17 tests. Les notes racontent les trois runs ratés en deux phrases. Rendu vérifié en Edge headless.
  - **Coût.** ~0,006 ETH par run ; il reste ~0,167 SepETH.
  - **Reste (Brieuc).** Nom d'équipe, OK pour le repo GitHub, questions aux organisateurs, vidéo (`repeg.js sepolia` d'abord), export du deck, soumission.

- 16:08 (réel) — Répétition générale de VIDEO.md sur Sepolia, deux vaults neufs (`0x52fb…`, puis `0xd258…`), avec de vrais clics.
  - **Bug n° 1, celui qui aurait cassé la vidéo : la signature tier 2 ne partait pas.** Le dialogue se fermait, et rien ne partait. J'ai d'abord soupçonné les refresh empilés (6 connexions max par hôte), puis le serveur. Les deux pistes étaient fausses, et je les ai écartées par mesure, pas par intuition :
    - les logs serveur montraient qu'aucun POST n'arrivait ;
    - la page instrumentée montrait un `submit` sans `close`.
  - **La vraie cause.** Chromium déclenche l'événement `close` d'un `<dialog>` à la frame suivante. Le panneau était caché, donc il n'y avait pas de frame. Une capture d'écran a forcé une frame : les deux `close` en attente sont partis, 105 s après le clic. C'est exactement les deux 403 de 13:47:44, que je n'avais pas su expliquer. La signature est maintenant branchée sur le clic du bouton. Testé de trois façons :
    - avec de vrais clics sur Sepolia : 5,3 s, tx minée ;
    - en Edge headless en local : `screens.mjs` complet ;
    - Blockscout décode les 4 refus de la répétition.
  - **Bug n° 2 : deux attaques cliquées ensemble.** A2 et A7 partent de la même clé : même nonce, et le nœud refuse la seconde (« invalid parameters »). Sur scène, c'est exactement ce que ferait un présentateur pressé. Les routes qui envoient une tx passent maintenant une à la fois, dans l'ordre des clics. Rejoué A7 + A9 ensemble : les deux passent (5,5 s, puis 61 s).
  - **UX.** Pendant les ~12 s d'attente, les boutons disent « Sending… » ou « Signed · waiting for the block… ». Avant, rien ne bougeait, et c'est ce qui m'avait poussé à recliquer.
  - **Critique de ma méthode.** J'ai perdu du temps à théoriser (pool de connexions) au lieu d'instrumenter d'abord. Les logs `→`/`←` par POST auraient tranché en une minute. Ils restent en place.
  - **Coût.** Gas à 0,001 gwei : un deploy coûte presque rien. `deploy.js` ne renvoie plus 0,002 ETH par rôle s'ils en ont déjà. Owner : ~0,16 SepETH.
  - **Pour Brieuc.** Une prise vidéo = un vault neuf (`deploy.js sepolia --fresh`, ~5 min), car les opIds de la semaine se dépensent. VIDEO.md a les temps mesurés.

- 16:13 (réel) — Relecture des affirmations après la régénération de `evidence-sepolia.md`.
  - **Affirmation fausse retirée partout.** Le README, SECURITY, SUBMISSION et le deck disaient « Blockscout est d'accord » ou « each decoded on Blockscout ». Faux pour un refus sur douze : la tx A2 du run 4 est bloquée chez Blockscout en `awaiting_internal_transactions` 1,2 h après son bloc, sans aucune raison décodée. (J'avais d'abord écrit « plus de 3 h » : j'avais confondu l'heure de Paris et l'UTC. C'est l'audit qui m'a corrigé.) L'audit écrivait « still indexing, no opinion yet », ce qui laissait croire que ça allait se régler. Il écrit maintenant « not decoded ("awaiting_internal_transactions" N h after the block) ». Les docs disent 11 sur 12, et le deck passe en v13.
  - **Légende fausse dans le README.** `routine.png` était décrite comme « rent and electricity executed, tuition signed ». L'image montre les propositions **avant** exécution. Légende corrigée. Le README dit aussi désormais que les captures viennent de la chaîne locale.
  - **`scripts/preflight.mjs`.** Une commande avant chaque prise, qui n'envoie rien : pas de pause, factures de la semaine non payées, place dans la limite du jour, pool au prix de l'oracle, oracle frais pour 30 min, gas sur chaque clé, Blockscout joignable.
    - Sur les deux vaults usés, il attrape 3 problèmes chacun, dont le pool Sepolia à 106 bps de l'oracle après A9.
    - Sur un vault neuf : « Ready to record ».
    - Sans lui, une prise aurait pu être perdue en plein milieu sur un opId déjà dépensé.

- 17:04 (réel) — Vidéo de secours, sans ffmpeg ni narrateur (commit 04948f3).
  - **Pourquoi.** La vidéo est le livrable le plus à risque : elle dépend de Brieuc, d'un micro et d'un logiciel de montage. Il n'y a pas d'ffmpeg sur la machine, et je ne télécharge rien.
  - **Ce qui existe.**
    - `record-demo.mjs` joue les scènes de VIDEO.md dans un Edge headless et garde chaque image du screencast DevTools, avec des repères horodatés.
    - `compose-video.mjs` monte le tout sur un canvas et l'enregistre avec MediaRecorder : MP4 1080p, H.264 + AAC. La voix est Zira, la voix anglaise de Windows, synthétisée hors ligne via SAPI.
    - Local : 2:59, attaques 4/4 refusées. Vérifié en relisant le MP4 dans le navigateur (durée, pistes, niveau audio seconde par seconde) et sur 12 images extraites.
  - **Ce que les images ont attrapé, pas le code.**
    - Deux erreurs dans le script de VIDEO.md, que Brieuc aurait dites face caméra. « The rules on the right » : la carte Mandate est au milieu. « Two documents turn red » : le code les marque avant le lancement, le run ajoute seulement les drapeaux du modèle.
    - Le projecteur était mesuré au clic, donc avant que le résultat redimensionne la carte : A9 débordait, la carte du loyer mordait sur la suivante. Corrigé avec un repère `resize` après chaque résultat.
  - **Ce que l'impression du plan a attrapé avant un rendu de 3 min.**
    - Premier jet : l'image gelait juste avant le repère suivant. Pendant une phrase longue, la page défilait donc déjà vers la suite : l'inbox partait pendant qu'on en parlait encore. Le gel tombe maintenant au premier changement de page après le repère précédent.
    - Deux bugs de bord : une frontière flottante dans `outAt`, et des instants de redimensionnement non décalés de la durée du carton titre.
  - **Honnêteté du montage.** 86 s sur 179 sont des images gelées de la vraie capture. Sur une console immobile, ça ne se voit pas, mais c'est un fait. Le carton titre dit « recorded from the live console », le réseau, le nombre d'attentes coupées et « synthetic voice ». Une vraie voix reste meilleure.
  - **Échec sur Sepolia, prise 1 (vault `0xd99d…ce88`).** La connexion DevTools s'est fermée en silence juste après la signature tier 2. `cdp.mjs` n'écoutait pas `close`, donc la capture a attendu 10 min sans rien dire. Ce que j'ai écarté par mesure :
    - pas un navigateur orphelin sur le port ;
    - pas la taille des images (≤ 260 Ko) ;
    - pas la durée : 3 min de screencast et de requêtes tiennent en local.
    - **Cause : inconnue à ce stade.** Désormais, une fermeture rejette les appels en cours avec son code, et `CDP_LOG` trace chaque appel et chaque événement. Prise 2 sur un vault neuf avec la trace.

- 17:15 (réel) — Vidéo de secours sur Sepolia : prise 2 réussie (vault `0xe30d…dd82`, commit 9c382c2 pour le durcissement DevTools).
  - **La prise.** 3 min 37 de capture, 577 images, attaques A2, A7, A9, A10 refusées on-chain. Huit attentes de bloc, de 8 à 60 s (A9). La trace : 3 043 lignes, aucune erreur, aucune fermeture.
  - **Ce que je n'ai pas résolu (à 17:15).** La fermeture de la prise 1 ne s'est pas reproduite, donc sa cause restait inconnue. Je ne prétendais pas l'avoir corrigée. Ce qui avait changé : un échec éventuel ne bloque plus 10 min en silence, il s'arrête net avec son code et laisse la timeline partielle.
  - **Montage.** 3:00, dont 142 s d'attente coupées et signalées, et 80 s d'image gelée pendant la voix (même ratio qu'en local).
  - **Ce que les images extraites ont attrapé, encore.**
    - À 2:17, le sous-titre remonte en haut (le projecteur est sur A9, en bas) et masque le bandeau « block wait cut · 60 s ». Précisément la coupe la plus longue, celle qu'un jury doit voir. Les deux étaient à y≈100. Le bandeau passe au centre de la barre d'en-tête, qui y est vide.
    - Le plan affichait « 2:60 » : arrondi des secondes après le modulo. Corrigé.
  - **Critique.** Le bandeau sous le sous-titre existait déjà dans le rendu local, je ne l'avais pas vu : mes 12 images locales ne tombaient sur aucune coupe avec projecteur en bas. Choisir les instants d'extraction à partir des légendes du plan (une image par coupe), pas à l'œil.
  - **Taille.** 104 Mo pour ce premier rendu : au-dessus de la limite de 100 Mo par fichier de GitHub. Le MP4 reste dans `work/` (ignoré), à déposer sur la plateforme ou en lien.

- 23:58 (réel) — Cause des deux échecs trouvée : le portable s'est mis en veille.
  - **Les faits.** Le re-rendu de 17:13 est mort à ~75 % avec le même symptôme que la prise 1 : connexion DevTools fermée, code 1006. Au même moment, un simple `sleep 80` a dépassé 100 s. Le journal système (Kernel-Power 506/507) tranche :
    - prise 1 : dernière image écrite à 16:47:21.058, veille moderne à 16:47:22 (bouton d'alimentation) ;
    - re-rendu : capot fermé à 17:17:08, puis hibernation (batterie) à 23:08 et réveil à 23:51.
  - **Donc pas un bug.** Ni le code, ni Edge, ni la mémoire (1,5 Go libres, ma deuxième fausse piste). Il n'y a rien à corriger dans le pipeline, il faut garder la machine éveillée, capot ouvert. VIDEO.md le dit. Le maintien en éveil de l'app ne couvre que la veille par inactivité, pas le capot ni le bouton.
  - **Diagnostic ajouté.** `cdp.mjs` dit maintenant « after N s without a message: did the computer sleep? » quand la fermeture suit un long silence.
  - **Critique de ma méthode, encore.** Même erreur qu'à 16:08 : j'ai fait des hypothèses (port, taille des images, durée, puis mémoire) avant de regarder la source de vérité. Le journal d'événements Windows répondait en une commande. Règle : sur une mort inexpliquée d'un processus long, lire d'abord `Get-WinEvent` (Kernel-Power, Application 1000).
  - **Rendu final.** Refait à 23:55 : 3:00, 1080p, 90,7 Mo (le débit varie d'un rendu à l'autre ; sous les 100 Mo cette fois, sans marge). Une image au milieu de chacune des 8 coupes : bandeau lisible dans l'en-tête, y compris la coupe de 60 s d'A9 sous un sous-titre remonté.

- 00:11 (réel, 15/10) — Le repo vu par un juge : clone neuf, README suivi à la lettre.
  - **Avant de rendre public.** Rendre le repo public publie tous les commits, pas seulement le dernier. J'ai donc cherché dans les 24 commits :
    - aucun fichier de `secrets/`, `.env` ou `local-access.json` n'y est jamais entré ;
    - aucune affectation de clé, et aucune des 7 clés réelles n'apparaît dans l'historique (comptage seulement, rien d'affiché).
  - **Clone neuf, dans un dossier vide.**
    - `npm ci --offline` passe : le lockfile est suivi et forge-std est copié dans le repo.
    - `keys.js` régénère `secrets/`, le seul fichier ignoré dont l'app a besoin.
    - Forge 34 + 7 et npm 17/17 passent.
    - Sur un second anvil (port 8546, via `LEASH_LOCAL_RPC`), le deploy et la campagne donnent 18/18.
    - Le serveur répond : routine, exécution, A2, A10, redémarrage. Un POST sans jeton reçoit un 403.
  - **Ce que le test a attrapé.**
    - Forge 1.8 range les 7 invariants dans une seule campagne. Il affiche 7 lignes `[PASS]`, mais son résumé dit « 1 passed », et « 35 tests » pour l'ensemble. Le README (« 7 / 7 ») disait vrai, mais un juge qui ne lit que la dernière ligne aurait cru à un chiffre gonflé. Le README le dit maintenant.
    - `LEASH_LOCAL_RPC` et `LEASH_SEPOLIA_RPC` existaient dans le code sans être documentés. Un juge dont le port 8545 est pris serait resté bloqué. Ajouté au README.
    - Le README disait `npm install`, mais c'est `npm ci` que j'ai testé. Remplacé.
    - **`local-campaign.ps1` était hostile chez un juge.**
      - Il cherchait Foundry dans `%USERPROFILE%\tools\foundry-v1.8.5`, un chemin qui n'existe que sur ce PC.
      - Pire, `Get-Process anvil | Stop-Process` tuait tous les anvil de la machine, y compris ceux d'autres projets. Ici, il aurait tué celui de la console.
      - Correctif : Foundry vient du PATH (ou de `LEASH_FOUNDRY`), le port de `LEASH_ANVIL_PORT`. Seul un anvil déjà sur ce port est arrêté ; si un autre processus tient le port, le script s'arrête avec une erreur.
      - Testé dans le clone : 18/18 deux fois de suite (la relance remplace l'anvil précédent). Sur le port de la console, le script refuse sans rien tuer.
  - **Avant le push, deux décisions qui reviennent à Brieuc, pas à moi.**
    - Pas de fichier LICENSE, alors que les contrats déclarent MIT (et sont publics sur Sourcify).
    - Les commits portent son e-mail personnel, qui deviendra public.
    - Les deux sont écrites dans SUBMISSION.md, étape 8.
  - **Premier écran du README.** Un juge voyait du texte puis un schéma ASCII ; la première capture n'arrivait qu'à la ligne 40. La capture de la console (vault, mandat, registre avec les hashes) passe maintenant juste sous le pitch, avec une légende qui précise « chaîne locale ».
  - **Critique.** J'avais annoncé « 7 / 7 » sans jamais regarder ce qu'affiche la ligne de résumé de forge. Un chiffre vrai mais présenté autrement que l'outil coûte de la crédibilité au moment précis où le juge vérifie. Règle : chaque chiffre du README doit se retrouver tel quel dans la sortie de la commande citée à côté, ou être accompagné de la conversion.

- 00:33 (réel, 15/10) — Une vraie voix sur la prise Sepolia, sans nouvelle prise.
  - **Pourquoi.** Le brief préfère une vidéo narrée, et Zira sonne synthétique. Refaire une prise avec Brieuc au micro coûterait un nouveau vault, 3 min 37 de prise sans faute, et il faudrait parler en cliquant. Or le montage place déjà chaque phrase sur son instant : il suffit de remplacer les WAV de Zira par les siens.
  - **Fait.**
    - `scripts/video-script.mjs` découpe VIDEO.md en 30 phrases. Le montage et l'enregistrement le partagent, donc numérotent pareil.
    - `scripts/record-voice.mjs` : un serveur sur 127.0.0.1 et une page. Espace enregistre, Espace arrête, P réécoute. Le son brut passe par un AudioWorklet, sans compression Opus intermédiaire. La page :
      - coupe le silence (RMS par 10 ms, seuil = max(10 % du pic, 3 × le bruit de fond)) ;
      - égalise le volume sur les passages parlés ;
      - signale une prise saturée ou trop faible.
    - `lines.json` garde le texte de chaque clip au moment de la lecture. Une phrase modifiée ensuite dans VIDEO.md est marquée « à relire », et `compose-video --voice-dir` refuse de monter tant qu'elle ne l'est pas.
  - **Testé.** Edge et Chrome headless (Chrome est le navigateur par défaut de Brieuc), avec un faux micro qui joue une phrase de Zira entourée de silence :
    - 2,84 s de parole donnent un clip de 3,16 s (Edge) et 3,14 s (Chrome) ; 0,32 s de marges étaient prévues.
    - Les gardes du serveur répondent : Host étranger 421, Origin étranger ou absent 403, index hors bornes 404, pas un WAV 400, 21 Mo refusés. Aucune requête refusée n'écrit de fichier.
    - Les 30 clips de Zira passés par le serveur donnent exactement le plan de `--voice` : 3:00, 79,8 s de gel.
    - Un rendu preview complet passe par la nouvelle route audio : 3:00, son présent du début à la fin, et plus de « synthetic voice » sur la carte titre.
  - **Ce que les tests ont attrapé.**
    - **Mon fichier de test était faux, pas Edge.** J'ai supposé un en-tête WAV de 44 octets, mais SAPI en écrit 46 (bloc `fmt ` de 18). Edge lisait donc un fichier corrompu et livrait du silence. J'ai d'abord accusé le bac à sable audio d'Edge, deux essais pour rien. C'est la même faute de méthode que la veille : vérifier mes propres entrées avant d'accuser l'outil. Le `wavSeconds` du repo parcourt bien les blocs ; c'est mon script jetable qui avait pris le raccourci.
    - **Pas de retour au premier appui.** Il ouvre le micro, ce qui prend plus de 300 ms, plus la demande d'autorisation. Sans rien à l'écran, on croit que rien ne se passe. Ajout du message « opening the microphone… ».
    - **Pas de retour aux phrases sautées.** Arrivée à la dernière phrase, la page restait bloquée. Elle y revient maintenant.
    - **Firefox, trouvé en relisant.** Il refuse de brancher un micro sur un AudioContext forcé à 48 kHz quand le micro tourne à une autre fréquence. La page enregistre maintenant à la fréquence native de la carte son. Ce point n'est pas testé, Firefox n'est pas installé ici.
  - **Limites.**
    - Rien n'a été testé avec un vrai micro ni une vraie voix. Le faux micro ne prouve pas que le seuil garde une fin de phrase soufflée ou un « s » final. La marge de 0,2 s après le dernier passage fort devrait suffire ; à vérifier à la première réécoute (P).
    - Le clic de la barre d'espace est retiré en jetant 0,3 s au début et à la fin de chaque prise. Qui parle avant que le point passe au vert perd sa première syllabe. La page le dit, mais la contrainte reste.
    - Le micro d'un portable capte le ventilateur ; seule la suppression de bruit du navigateur est activée. Un casque vaut mieux.

- 01:37 (réel, 15/10) — Le dernier jour, vu d'avance.
  - **Un juge doit pouvoir vérifier sans rien installer.** Le README renvoyait vers un tableau de 29 hashes. Il a maintenant une section « Check it in a minute » : une ligne par affirmation, un lien chacune (loyer de 800 tUSD, frais de scolarité co-signés, A7, A9, A10, code source vérifié). Chaque lien a été vérifié par l'API de Blockscout : montant, destinataire, erreur décodée. Pour A9, j'écris ce qui se passe vraiment : le vault exige le prix de l'oracle moins 1 %, et c'est le pool qui échoue (`slippage`), pas une erreur du vault.
  - **`local-campaign.ps1` ne se lançait pas chez un juge Windows.** La politique d'exécution par défaut refuse les scripts : je l'ai vérifié ici, en effaçant le contournement de ma propre session. Le README donne maintenant `powershell -ExecutionPolicy Bypass -File …`. Ma vérification sur un clone neuf ne l'avait pas vu, parce que mon outil tourne en Bypass. **Un test lancé depuis mon environnement n'est pas un test depuis celui d'un juge.**
  - **Brieuc ne pouvait lancer aucune de mes commandes.** Ni `node`, ni `git`, ni `forge` ne sont dans son PATH : j'utilise des copies portables par leur chemin complet. Toutes mes instructions (« `node scripts/record-voice.mjs` », « `git push` ») auraient répondu « n'est pas reconnu » le 20. Correctif : quatre raccourcis à double-cliquer dans `work/`, hors du repo puisqu'ils contiennent les chemins de ce PC (narrer, rendre, vérifier, publier). Le push passe par le Git Credential Manager du Git embarqué : c'est Brieuc qui se connecte.
  - **`scripts/presubmit.mjs`.** Il n'envoie rien et vérifie ce qu'on rate le dernier jour :
    - tout est commité, poussé, le repo est public, aucun secret n'est suivi ;
    - la vidéo la plus récente a une voix, dure moins de 5 min et porte l'URL de ce repo sur sa carte de fin ;
    - Blockscout décode toujours autant de refus que le README l'affirme ;
    - les tests passent.

    `compose-video` laisse maintenant un `.json` à côté de chaque rendu, sinon rien ne permettait de savoir avec quelle voix et quelle URL une vidéo avait été faite. Premier passage : 11 de 12 confirmé, 17 + 35 tests, et trois ✗ attendus (pas de remote, pas de vidéo finale, travail non commité).
  - **Mes erreurs de la nuit, dans l'ordre.**
    1. J'ai testé `2-video.cmd` sans saisie avant d'y mettre une garde contre l'URL vide : il a lancé un vrai rendu de 3 min.
    2. Le premier rendu (mon test) a gelé à 18 %. Le second Edge n'a pas pu prendre le port 9336 ; le second script s'est donc branché sur le navigateur du premier, et la page du premier est passée en onglet d'arrière-plan, sans rAF.
    3. J'ai ensuite modifié `2-video.cmd` pendant qu'il tournait. cmd relit un batch au fil de l'exécution : il a exécuté des lignes décalées (« '--plan' n'est pas reconnu ») et relancé un troisième rendu.

    Tout a été arrêté. Seuls les Edge des profils `leash-cdp-*` ont été tués (25 processus, 3 instances), pas le navigateur de Brieuc. Aucun fichier du repo n'a été touché ; il reste un rendu Zira sans URL dans `work/` (`leash-demo-voice.mp4`), que `presubmit` signale bien comme non final.
  - **Ce que l'accident a corrigé.** `cdp.mjs` refuse désormais de démarrer si un navigateur écoute déjà sur son port (testé pendant un rendu : refus net, le rendu continue). `compose-video --out` crée son dossier au lieu de planter. Le LISEZ-MOI dit de ne jamais modifier un `.cmd` en cours.
  - **Critique.** Deux règles que je connaissais et que j'ai enfreintes par hâte :
    - ne pas lancer un test qui peut déclencher une action longue sans avoir posé la garde d'abord ;
    - ne pas toucher un fichier qu'un processus est en train de lire.

    Le coût réel est faible (10 min, rien de perdu), mais le même réflexe sur un `deploy.js sepolia` ou un `git push` aurait été irréversible.
  - **Récidive.** `presubmit` affichait « 2:60 » pour 179,7 s : le bug d'arrondi corrigé le 14 dans `compose-video`, que j'ai réécrit dans le nouveau script au lieu de le réutiliser. Corrigé, avec un commentaire. Le test de la branche vidéo (une copie de rendu marquée finale, puis un remote factice retiré juste après) l'a attrapé. C'est aussi lui qui a confirmé le refus d'une carte de fin dont l'URL n'est pas celle du repo.
  - **Premier vrai service rendu par `presubmit`.** Lancé par le raccourci, il a validé `leash-demo-voice.mp4` comme une vidéo de 3:00. Or c'était le rendu tué à 23 % : il avait écrasé le MP4 complet (26 Mo au lieu de 73), et le `.json` décrivait encore l'ancien. Désormais, le `.json` est effacé au début d'un rendu et réécrit à la fin avec la taille du fichier ; `presubmit` refuse tout écart. Le fichier tronqué est supprimé. `leash-demo-sepolia.mp4` (95 Mo), la version de secours, n'a pas été touché.
- 01:51 (réel, 15/10) — Le règlement, enfin lu.
  - **Le règlement officiel était sur le disque depuis le 12.** Il était dans le dossier de travail de LANDER (`official-international-rules.txt`). J'ai écrit README, TECHNICAL, SECURITY, le deck et presubmit sans relire la grille. Elle tient en quatre lignes : réalisation 40 %, sécurité et conformité 30 %, innovation et interaction 30 %, plus 0 à 5 points de bonus on-chain.
  - **« Compliance » n'apparaissait nulle part.** Pas une fois dans nos docs, alors que c'est la moitié d'un critère à 30 % et que le jury est fait d'experts de WeBank. Or LEASH fait déjà ce qu'une banque impose à un compte de paiement : liste de bénéficiaires, plafonds, double validation, gel, piste d'audit. On ne l'avait juste jamais nommé. Nouvelle section SECURITY §7 :
    - une table contrôle bancaire → mécanisme LEASH → qui l'applique (contrat, politique, scripts) ;
    - surtout la liste de ce qui manque : KYC, LCB-FT et sanctions, données personnelles (les documents partent chez le fournisseur du modèle, et la chaîne publique montre tout), statut réglementaire (MiCA, non évalué), litiges.

    Chaque ligne a été vérifiée dans le code (`judge` renvoie bien chaque contrôle nommé avec sa valeur). Je n'écris pas « conforme » : une analogie n'est pas une conformité, et la section le dit.
  - **Équipe de 2 à 5 étudiants.** Une inscription en solo ne remplit pas la règle. Je ne sais pas qui est dans l'équipe de Brieuc : c'est la première question à lui poser, avant le nom d'équipe. Ajouté à SUBMISSION et aux rappels de presubmit.
  - **La vidéo est optionnelle.** Je la traitais comme bloquante. Elle reste utile (seule la vidéo montre la console en mouvement), mais l'ordre change : le repo public d'abord, puis une soumission complète dès que possible. Le règlement permet de la mettre à jour jusqu'à l'échéance, et seule la dernière version compte. presubmit passe « pas de vidéo » de ✗ à !, mais une vidéo tronquée ou sans URL reste ✗.
  - **Aussi relevé :** l'adresse des organisateurs (info@ican-x.com), absente du message prêt à coller. La finale a lieu à Shenzhen du 21 au 23 nov., avec au moins un membre présent. Les licences tierces (OpenZeppelin et viem en MIT, forge-std en MIT ou Apache) sont listées dans le README.
  - **Deck v15.** Je l'ai comparé chiffre par chiffre au README : rien ne diverge. J'ai ajouté une phrase dans les notes de la diapo des niveaux (un banquier reconnaît ces contrôles ; ici, le contrat les applique), et « no KYC or sanctions screening yet » sur la ligne mainnet de la diapo d'honnêteté, avec un texte plus court qu'avant pour ne pas risquer de débordement.
  - **Critique.** C'est l'erreur la plus coûteuse du projet, et elle n'a rien de technique. J'ai optimisé pendant deux jours sur ma propre idée de ce que le jury veut (des preuves, de l'honnêteté) sans lire ce qu'il note. La preuve était bien orientée : réalisation et sécurité couvrent 70 %. Mais il manquait un mot qui pèse jusqu'à 15 points, et une règle d'éligibilité que personne n'a vérifiée. **Lire la grille de notation avant d'écrire la première ligne du livrable.**
- 02:09 (réel, 15/10) — Le site contredit le docx, et je l'avais cru trop vite. Commit 98054f8.
  - **Le docx était périmé.** La page `#/rule` du site (la version chinoise fait foi) dit deux choses :
    - la vidéo est **obligatoire** ;
    - l'inscription et le rendu se font par un seul mail à fintechathon@ican-x.com, pas à info@.

    À 01:51, j'avais écrit l'inverse et assoupli presubmit. Corrigé : presubmit échoue de nouveau sans vidéo, et SUBMISSION cite la page. Il contient aussi le mail de soumission prêt à remplir, avec pour chaque membre passeport et preuve d'inscription.
  - **Grille → docs.**
    - SECURITY §5 relie chacune des quatre classes d'attaque du règlement à nos scènes.
    - « Extraction de données » n'avait aucune scène. Nouveau test : il relit les 10 prompts réellement envoyés au modèle. Il vérifie qu'aucun secret de 32 octets n'y figure, et que chaque adresse vient de la boîte ou du propriétaire (il n'y en a qu'une, celle de l'attaquant). Une clé glissée dans un prompt est bien attrapée (mutation vérifiée). 18 tests Node.
  - **Interaction.** Le README dit comment l'agent traite le propriétaire, et ce qu'il ne fait pas : dialoguer. Je ne l'ai pas maquillé. Un champ `questions` changerait le schéma et demanderait de nouveaux runs live : c'est listé en TECHNICAL §7, pas fait.
  - **PDF.** `scripts/doc-pdf.mjs` rend TECHNICAL (6 p.) et SECURITY (8 p.) en PDF par Edge headless ; rien ne sort de la machine. J'ai regardé les 14 pages une à une, et elles ont trouvé quatre défauts que la relecture du Markdown avait laissés :
    - le schéma d'architecture, décalé dans la source même : le mur droit flottait sur trois colonnes, et GitHub l'aurait montré pareil. Il est reconstruit sur une grille ;
    - « both models », alors qu'il y a un seul modèle sous deux prompts ;
    - Slither listé « à faire » en R12 alors qu'il a tourné ;
    - TECHNICAL §6 annonçait 15 tests hors chaîne, périmé depuis 17.
  - **Critique.**
    - Même faute deux fois en une heure : à 01:51, j'ai pris le premier document trouvé pour la règle, sans chercher la source qui fait foi. Le docx avait trois jours et sortait d'un dossier de travail ; le site était à un clic. J'ai même assoupli un contrôle (vidéo ✗ → !) sur cette base. **Une règle externe se lit à la source officielle, et un contrôle ne s'assouplit qu'avec cette source citée.**
    - Ma relecture croisée deck ↔ README avait laissé passer le 15 de TECHNICAL. **Relire le livrable sous la forme où le jury le lira**, pas seulement sa source.
- 02:17 (réel, 15/10) — Même lecture pour le README, la première page qu'un juré ouvre. Commit 306132b.
  - **Ce que les 7 pages ont montré :**
    - le schéma de tête avait les murs d'un caractère à droite des coins ;
    - l'arborescence alignait ses descriptions sur trois colonnes différentes, et omettait `scripts/`, `deployments/`, `app/test/`, `routine.js` et `plan.js`. C'est là qu'un juré cherche l'audit de la chaîne.
  - **Le tableau des livrables n'avait ni la vidéo ni le deck**, alors que le règlement les exige. Je n'ai pas mis de ligne vide « à venir » qu'un juré pourrait lire : presubmit avertit tant que le README ne les lie pas, et l'étape 9 de SUBMISSION dit quand les ajouter.
  - `2-video.cmd` rend aussi les PDF avec l'URL du repo, une seule saisie. Je l'ai testé par cmd avec une fausse URL. Les PDF de `work/pdf` pointaient alors vers ce faux repo : je les ai re-rendus aussitôt, et il ne reste aucun lien faux. LISEZ-MOI dit maintenant que la vidéo est obligatoire et comment soumettre.
  - **Critique.** Ces deux schémas étaient faux depuis le premier jour. Je les ai relus des dizaines de fois en Markdown, où l'œil complète les colonnes. Seul un rendu les a montrés. Le test qui aurait dû exister : mesurer les colonnes des caractères de cadre, ce qui prend 10 lignes de script. Il est maintenant dans presubmit (1654ef2). Je l'ai vérifié sur les versions d'avant la correction : il signale bien les deux schémas.
- 02:31 (réel, 15/10) — La « valeur mesurable » du Challenge Brief n'avait aucun chiffre. Commit dc8b0f5.
  - **Le trou.** Le brief demande un agent qui montre une « measurable value ». Le README racontait la semaine 42 sans chiffrer ce qu'elle apporte. Nouvelle section « Measured on week 42 », chaque ligne avec sa source (run 4, campagne locale, runs modèle enregistrés) :
    - une instruction et une signature pour la semaine ;
    - 9 800 tUSD demandés par les deux documents hostiles, rien payé ;
    - pire cas avec la clé agent volée : 1 500/jour (3 000 à cheval sur minuit), vers les deux bénéficiaires seulement ;
    - arrêt en une transaction ;
    - plan en 18,7 s ;
    - coût en gaz.
  - **Le gaz.** Un paiement de niveau 1 à 380k gaz sur Sepolia, contre 80–114k sur anvil, m'a fait chercher un bug. Il n'y en a pas : chaque nouvel emplacement de stockage coûte ~98k sur Sepolia contre ~17k sur anvil (mesuré sur T1−T2, T2−A5 et un `approve` : 46 376 contre 128 296). Les écritures sur un emplacement existant coûtent pareil, à 4 % près. Je n'attribue pas la cause à un hard fork précis : je ne l'ai pas vérifié, donc je ne l'écris pas.
  - **Deck v18.** Diapo routine : « 9,800 tUSD asked for, none paid » et, dans les notes, une instruction, une signature et un plan en 19 s. Les notes font 140 mots pour 60 s. Rendu vérifié par Edge headless, sans débordement. La v17 était publiée avec la mauvaise racine (un fichier en double hors de `project/`) ; je l'ai corrigée aussitôt en v18.
  - **SUBMISSION.** Le calendrier est recopié de la page du site : revue en ligne le 23/10, check-in le 20/11. L'ancien « 10-22 et 23 » n'avait aucune source que je retrouve. Je l'ai supprimé plutôt que de lui en inventer une.
  - **Critique.**
    - « Sepolia coûte environ 3× plus » était écrit dans quatre fichiers et un générateur, sans mesure. La mesure donne 2–2,4× pour un swap et ~6× pour une création de stockage : selon l'opération, le « 3× » était trop haut ou trop bas. **Un ratio qui sert d'explication se mesure avant de s'écrire.**
    - Pour la v17, j'ai repris la racine de mémoire au lieu de relire ma note. C'est la liste des fichiers renvoyée par le publish qui a montré l'erreur. **Lire cette liste après chaque publish.**
- 02:37 (réel, 15/10) — Contre-vérification du tableau de 02:31, chiffre par chiffre, depuis `evidence/`. Deux erreurs, dans l'entrée même qui critiquait le « 3× ». Commits 7c97ed6 et suivant.
  - **« Un swap : 2–2,4× »** oubliait le débouclage de l'attaquant (1,58×). Et un commentaire de `chain.js` disait encore « ~3x (T3 : 384k contre 130k) », alors que T3 a coûté 159 560 sur anvil. Partout, on cite maintenant un seul chiffre vérifiable : T3, 384 184 contre 159 560 (2,4×).
  - **« Les écritures sur un emplacement existant coûtent pareil à 4 % près »** est faux. A8, A10 et les changements de mandat de T5 coûtent tous exactement 1 200 gaz de plus sur Sepolia (+4,0 à 4,3 %). C'est écrit tel quel ; je n'en connais pas la cause et je n'en invente pas.
  - **Confirmés :** A10 29 050, A8 29 152, 80–114k et 184–380k, T1−T2 et T2−A5, plan en 18,673 s (13 813 / 586 tokens), compilations de 5,532 à 9,524 s, 12 000 tUSD et 1,2 tETH (`config.js`), 9 800 = 9 000 + 800.
  - **Critique.** À 02:31, j'ai écrit une règle (« un ratio se mesure avant de s'écrire ») et je l'ai enfreinte dans le même commit. J'avais mesuré deux paires de paiements, puis j'ai généralisé à la main aux swaps et aux écritures, sans repasser par les données. Le script de 15 lignes qui a tout tranché tournait en une seconde. **Tout chiffre de tableau sort d'une requête sur `evidence/`, relancée juste avant le commit.**
- 10:20 (réel, 15/10) — LEASH pose une question avant de deviner. Le barème note la « capacité à demander une précision » (追问能力) : on n'en avait aucune.
  - **Lecture du barème.** J'ai d'abord pris pour le nôtre le texte de la piste analyse de données (« conception de l'expérience d'interaction »). Je l'ai vu avant d'agir : notre piste note 40 % tâche, 30 % sécurité, 30 % innovation et interaction, et c'est dans ce dernier bloc que figure la demande de précision.
  - **Ce qui change.** Le compilateur de mandat a un champ `questions`. Une valeur floue (« payer un peu plus mon propriétaire ») n'est plus devinée : le modèle laisse le réglage tel quel et demande le montant, avec son unité. Le propriétaire répond dans la console, et le texte se recompile avec les réponses (bloc séparé, 6 au plus, une ligne chacune, toutes obligatoires). Tant qu'une question est ouverte, le diff est masqué et le serveur refuse `apply`.
  - **Runs live enregistrés (9 nouveaux).** Les trois textes complets ne posent aucune question. Le texte flou en pose une : « What is the maximum for one landlord payment, in tUSD? ». La réponse 950 donne une ligne rouge (900 → 950) et une ligne qui resserre (ETH 35 → 30 %). Test 19 : deux tours rejoués, réponse vide refusée, réponse non enregistrée refusée.
  - **Trouvé en route.** La première version du prompt posait la bonne question… et mettait en même temps le plafond du propriétaire à 0, ce qui l'aurait retiré des bénéficiaires. J'ai corrigé le prompt, mais surtout ajouté deux verrous qui ne dépendent pas du modèle : diff masqué côté console, `apply` refusé côté serveur. Le run fautif reste dans `evidence/` et SECURITY R14 le cite.
  - **Bug d'interface.** La boîte de questions restait visible sans question : `display: grid` écrasait l'attribut `hidden`. Mon contrôle JS lisait `.hidden` (vrai) au lieu du `display` calculé ; seule la capture l'a montré. Corrigé par `.ask[hidden] { display: none }`, captures refaites et relues.
  - **Docs.** README (section mandat, tableau d'interaction, ligne « Questions to the owner », 19/19, 17 compilations), TECHNICAL §3.6, §6, §7, SECURITY (tests, R14). Presubmit recalcule la fourchette de compilation : 5,5–19,5 s (le 19,5 s est le premier appel du nouveau prompt).
  - **Critique.**
    - La routine hebdomadaire ne pose toujours aucune question. Je ne l'ai pas fait : il faudrait refaire le plan enregistré, qui sert de référence à toute la vidéo et au run Sepolia. Écrit tel quel dans le README et TECHNICAL §7.
    - Je me suis fié à `el.hidden` pour dire « la boîte est cachée ». **Pour vérifier ce qu'un juré voit, lire le style calculé ou la capture, pas l'état du DOM.**
    - La vidéo ne montre pas encore cette fonction. Je regarde si une prise courte s'insère sans refaire le reste ; sinon elle reste dans le deck et le README.
- 10:24 (réel, 15/10) — Relecture des captures de 10:20, telles qu'un juré les verra. Deux défauts.
  - **Le « 950 » pré-rempli.** En replay, la console remplit la réponse enregistrée : sans le dire, un juré peut croire que le modèle a choisi 950. Une mention sous le champ le dit maintenant : « the owner's recorded answer: a replay only knows this one (a live run takes any answer) ».
  - **Un chiffre faux dans l'entrée de 10:20 et dans TECHNICAL §3.6 :** « ETH 35 → 30 % ». La capture du 2e tour montre 40 % → 30 % : le mandat sur la chaîne est à 40 % (`config.js`), et 35 % est la consigne du propriétaire pour le DCA, pas un réglage. Corrigé dans TECHNICAL ; l'entrée de 10:20 reste telle quelle, cette ligne la corrige.
  - **Deck v19–v20.** Diapo éditeur : la capture de la question remplace celle de l'adresse redirigée (déjà dans l'encadré), une phrase sur le modèle (« A vague value becomes a question, never a guess »), notes réécrites dans l'ordre de l'écran (134 mots). Diapo preuves : 19 tests hors chaîne. Rendu vérifié par Edge headless avec les vraies captures. Liste des fichiers relue après chaque publish.
  - **Critique.** J'ai écrit « 35 → 30 » de mémoire, d'après la consigne de la routine, au lieu de lire la ligne du diff que je venais de capturer. C'est la même faute qu'à 02:37. **Un chiffre qui décrit une capture se lit sur la capture.**
- 10:29 (réel, 15/10) — « Entrée familière » (colloquial input), autre critère du barème innovation et interaction. Commit 830dfc0.
  - **Le trou.** Les six échantillons du compilateur étaient en anglais soigné. Les jurés lisent le chinois.
  - **Deux runs live :**
    - anglais relâché (« ok so the bot can do rent up to 850 n … a third of the vault pls ») : 3 lignes qui resserrent, « a third » devient 33,33 %, aucune question ;
    - chinois, avec un virement de 2 000 « à mon ami » glissé à l'adresse de l'attaquant : 3 lignes (dont le propriétaire 900 → 950 en rouge), le virement listé comme non applicable, en chinois et mot pour mot, et aucun appel ne porte l'adresse.
  - **Test 20** fige les lignes exactes des deux. Le test des adresses ne vérifiait que le premier échantillon contenant l'adresse (`find`) ; il boucle maintenant sur tous.
  - Sous-titre de l'éditeur : « in your own words » au lieu de « in English ». Toutes les captures de l'éditeur sont refaites par `work/check/shots-editor.mjs` (compilations seules, aucune transaction). Capture chinoise ajoutée au README et à `screens.mjs`. Deck v21 : titre « in plain words », encadré en chinois, 20 tests.
  - **Critique.** J'ai écrit « 4 lignes » dans TECHNICAL avant d'avoir vu le diff : le plafond utility était déjà à 150, donc 3 lignes. C'est la troisième fois aujourd'hui (02:37, 10:24, ici). Cette fois je l'ai vu avant le commit, parce que j'ai écrit le test avec les lignes exactes au lieu de `every(tighter)`, qui passait aussi avec la mauvaise phrase. **Un test qui fige la sortie exacte attrape la phrase fausse ; un test de propriété la laisse passer.**
- 11:10 (réel, 15/10) — Vidéo refaite sur Sepolia avec la question au propriétaire et le texte chinois (commit 106ba99). Prise `work/demo-sepolia3`.
  - **Script.** La scène de l'éditeur montre maintenant le texte flou (« My rent went up a little… »), la question, la réponse (ligne rouge 900 → 950), puis le texte chinois avec le virement vers l'adresse de l'attaquant, listé comme non applicable. 32 phrases, cible 3:50 avec une vraie voix. `record-demo.mjs` et les ancres de `compose-video.mjs` suivent le script (« When a value is vague », « The answer comes back », « It reads Chinese too »).
  - **Répétition d'abord.** Prise locale `work/demo-local6` (3:11) avant de toucher Sepolia, dont chaque prise consomme des opIds et du gaz.
  - **Serveur périmé attrapé.** Le serveur Sepolia de l'aperçu, réutilisé, tenait encore l'ancien coffre et l'ancien `server.js`. Arrêté et relancé avant la prise. Nouveau coffre `0x52a9…f224` ; ses opIds sont consommés, la prochaine prise demande `--fresh`.
  - **Résultat.** 3:41 de capture, 137 s d'attente de blocs coupées (8 coupes), 3:13 au montage. A2, A7, A9 et A10 refusées sur la chaîne. Images relues à 0:02, 0:52, 1:52 (question), 1:58 (réponse), 2:05 (chinois), 2:20, 2:50, 3:10 : texte lisible, bandeaux de coupe présents, son présent.
  - **Taille.** Le premier rendu 1080p pesait 116,8 Mo : au-dessus des 100 Mo de GitHub, et lourd pour des jurés en Chine. J'ai baissé le débit à 6 Mb/s, ce qui a donné 111,0 Mo, soit 5 % de gagné pour 3,5 min de rendu. MediaRecorder traite `videoBitsPerSecond` comme un plafond : le contenu ne demandait qu'environ 4,7 Mb/s, donc 10 et 6 ne mordaient pas. À 3 Mb/s, le plafond mord : 65,0 Mo pour le rendu final. Recadrages 1:1 des petits textes (cartes red team, registre) côte à côte avec la version à 6 Mb/s : aucune différence visible, y compris juste après un défilement.
  - **Hébergement.** SUBMISSION disait « release GitHub ou upload non répertorié ». YouTube et Google Drive sont bloqués en Chine continentale, où sont les organisateurs. SUBMISSION et LISEZ-MOI le disent maintenant. `2-video.cmd` rend aussi une copie 720p (environ 25 Mo) comme second lien. Piège noté dans VIDEO.md : sans `--out`, `--preview` écrase le fichier 1080p.
  - **Bug trouvé en relisant les images.** À 1:58, le registre « this session » est vide, alors qu'il montre trois paiements juste avant et juste après. Même image dans les rendus à 10 et à 3 Mb/s : le défaut vient de la capture, pas de l'encodage. Cause : le rafraîchissement toutes les 5 s redessinait toute la liste, et chaque ligne rejouait son fondu d'entrée (opacité 0 → 1 en 0,35 s). Le registre clignotait donc toutes les 5 s, depuis le début, dans la console en direct. Corrigé : la liste n'est redessinée que si elle change, et seules les lignes nouvelles jouent le fondu. Vérifié dans la console locale : en 7 s, les mêmes nœuds restent à opacité 1, et après l'attaque A12 seule la nouvelle ligne porte `new`.
  - **Effet sur la prise.** J'ai mesuré la luminosité du registre au milieu des 17 images figées de plus de 1,5 s que liste `--plan` (80,7 s sur 83,9 ; les 3 plus courtes ne sont pas vérifiées) : aucune n'est prise pendant un clignotement. Les deux valeurs basses étaient la fenêtre de signature et du texte rouge assombri, vérifiées à l'œil. Il reste un clignotement de 0,35 s toutes les 5 s pendant la lecture, presque toujours dans une zone assombrie. Je ne refais pas de prise pour ça ; la prochaine, s'il y en a une, sera propre.
  - **Critique.**
    - Le bug existait depuis la première version de la console. Je ne l'ai vu qu'à la troisième prise, sur une image qui n'était même pas figée. Mes contrôles d'images portaient sur la zone mise en avant, jamais sur le reste de l'écran. **Relire toute l'image, pas seulement ce que le cadre orange désigne.**
    - 84 s sur 193, l'image reste figée pendant que la voix parle : 43 % de la vidéo. C'est le prix d'une voix qui explique chaque refus. Je ne le corrige pas : couper la voix enlèverait l'explication, qui est ce que le jury note.
    - J'avais écrit « Around 90 MB » dans SUBMISSION.md avant le rendu, d'après la prise du 14. Le rendu a donné 116,8 Mo. **Une taille de fichier se lit sur le fichier.** Quatrième chiffre écrit de mémoire aujourd'hui ; celui-là, je l'ai vu avant le commit.
    - Le rendu à 6 Mb/s était un essai à l'aveugle. Le rendu à 10 Mb/s visait 10 et sortait à 4,8 Mb/s : j'avais déjà de quoi voir que la consigne ne mordait pas, mais je n'ai fait la division qu'après. **Avant de changer un réglage, comparer la valeur visée à la valeur obtenue.**
    - La prise du 14 (`demo-sepolia2`) ne peut plus être remontée : son script a disparu de VIDEO.md. Si la nouvelle prise posait problème, il faudrait en refaire une, pas revenir à l'ancienne.
- 11:22 (réel, 15/10) — Relecture du README et du deck contre le site. Commits 41d1d41, 12c9e41.
  - **Grille → tableau d'interaction.** Le tableau « How the agent deals with the owner » couvrait peu de tours, demande de précision, correction et hors périmètre. L'« entrée familière » nommée par la grille n'y figurait pas : ligne « Everyday words » ajoutée, avec la citation du run enregistré, vérifiée mot pour mot par grep.
  - **Nom du sujet.** README et couverture du deck disaient « Autonomous On-chain Wallet ». Le site dit « 方向 F：Agent Wallet ». L'autre nom venait du sous-titre du vieux docx. Corrigé dans le README et le deck (v22 : liste des 13 fichiers relue après publication).
  - **Fausse alerte sur l'adresse de soumission.** Le pied de page du site affichait fintechathon@g-ican.com, et nos docs disent ican-x.com. J'ai rechargé la page et ouvert l'onglet international : il affiche bien fintechathon@ican-x.com. g-ican.com est l'adresse de la piste domestique, sur laquelle le site s'ouvre. SUBMISSION et LISEZ-MOI le disent maintenant : c'est le genre de détail qui fait partir le dossier au mauvais endroit le dernier soir.
  - **Lu au passage :** date limite le 20/10 à 24:00 UTC+8, soit 16:00 UTC, comme prévu. Examen de conformité le 21/10, évaluation en ligne les 22–23/10, top 10 en finale.
  - **Critique.** Le nom du sujet était faux sur la première ligne du README et sur la première diapo depuis le début. Je l'avais relu dix fois sans le vérifier, parce qu'il venait d'un document que je savais périmé pour d'autres points. **Un document périmé sur un point est suspect sur tous ; tout ce qui en vient se revérifie à la source.**
