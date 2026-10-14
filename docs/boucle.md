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
| 13 | Compilateur de mandat en langage naturel (LLM → struct → rendu déterministe → signature) | aller-retour testé | |
| 14 | Docs : architecture, algorithme, sécurité, autoévaluation (paliers + risques connus) | relecture critique | |
| 15 | Audit REA de notre propre app (bundle JS, secrets) | rapport joint | |
| 16 | Deck < 10 min, vidéo < 5 min, README, instructions de déploiement, tests | relu | |
| 17 | Contre-audit final : je relis tout comme un juge hostile | liste corrigée | |

## Décisions
- 2026-10-14 01:41 — Réseau : Ethereum Sepolia. Gas à 0,001 gwei, oracle Chainlink ETH/USD actif (0x694A…5306). Base Sepolia est écartée : pas d'oracle vérifié, et c'est un faucet de plus.
- 2026-10-14 — Stack : Foundry pour les contrats (fuzz et invariants = crédibilité sécurité), Node 24 + viem pour l'agent. Pas de Hardhat : deux outils pour le même travail.

## Journal (une ligne par tour)
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
