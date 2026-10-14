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
  - **Critique.** J'avais annoncé « 7 / 7 » sans jamais regarder ce qu'affiche la ligne de résumé de forge. Un chiffre vrai mais présenté autrement que l'outil coûte de la crédibilité au moment précis où le juge vérifie. Règle : chaque chiffre du README doit se retrouver tel quel dans la sortie de la commande citée à côté, ou être accompagné de la conversion.