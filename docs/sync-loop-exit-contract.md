# Contrat des sorties de `executeQueuedOperation`

Table de référence de la conversion des sorties de la boucle de synchronisation
(`context/NetworkContext.tsx`). Chaque ligne décrit une sortie explicite : ce qui
la déclenche, ce qu'elle laisse derrière elle, quelle version de l'opération elle
rend, et si la métadonnée de transport atteint la politique de réessai.

Le test `tests/syncLoopExitContract.test.ts` fige ce décompte. **Toute sortie
ajoutée ou retirée doit être reportée ici dans le même commit** — c'est le rôle
du verrou.

## Décompte

| Issue | Nombre |
| --- | ---: |
| `fail(...)` — verdict rendu par la politique | 40 |
| `applied` | 14 |
| `terminal` | 2 |
| `conflict` | 1 |
| `deferred` | 1 |
| **Total** | **58** |

Le premier comptage annonçait 37 sorties, lui-même plus précis que les 46
`continue` bruts. L'inventaire réel est de 58 : convertir un `continue` unique
placé après une cascade `if / else if` produit plusieurs sorties distinctes, une
par branche. C'est précisément l'ambiguïté que la conversion supprime — un seul
`continue` couvrait auparavant « refus », « succès » et « rien à faire ».

## Légende

**Version rendue** — quelle version de l'opération accompagne l'issue :
`op` (celle de la file), `retryRpcOp` / `retryOpForCatch` (enrichie par un upload
ou une préparation), ou une version construite sur place.

**Portée** — `politique` signifie que `computeRetryDecision` tranche à partir de
l'erreur : opération, backend ou authentification. Les autres valeurs sont
imposées par l'appelant.

**`meta`** — `n.a.` quand aucune requête REST n'a eu lieu (validation locale,
échec d'upload, exception).

## RPC

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E01 | 1524 | `op.rpc.fn` absent | — | `op` | `fail` | politique | validation locale | n.a. |
| E02 | 1537 | réserve sans `id` | — | `op` | `fail` | politique | validation locale | n.a. |
| E03 | 1594 | upload photos réserve partiel | cache photo mis à jour sur le progrès partiel | `partialRetryOp` (photos déjà distantes) | `fail` | politique | upload | n.a. |
| E04 | 1627 | mouvement de stock au payload invalide | réconciliation du cache terminal | `op` | `fail` | terminal (`terminalOutcome`) | validation locale | n.a. |
| E05 | 1634 | upload photo produit échoué | — | `op` | `fail` | politique | upload | n.a. |
| E06 | 1647 | modification produit au payload invalide | — | `op` | `fail` | terminal (`terminalOutcome`) | validation locale | n.a. |
| E07 | 1654 | upload photo produit échoué | — | `op` | `fail` | politique | upload | n.a. |
| E08 | 1668 | révision de plan sans parent ou sans plan | — | `op` | `fail` | politique | validation locale | n.a. |
| E09 | 1675 | upload fichier plan échoué | — | `op` | `fail` | politique | upload | n.a. |
| E10 | 1683 | remplacement de plan sans patch | — | `op` | `fail` | politique | validation locale | n.a. |
| E11 | 1690 | upload fichier plan échoué | — | `op` | `fail` | politique | upload | n.a. |
| E12 | 1699 | événement de statut sans `reserve_id` ou `to_status` | — | `op` | `fail` | politique | validation locale | n.a. |
| E13 | 1721 | instantané ou `plan_id` manquant après le RPC | — | `retryRpcOp` | `fail` | politique | validation locale | n.a. |
| E14 | 1730 | écriture des métadonnées de plan refusée | — | `retryRpcOp` | `fail` | politique | mutation | `metadataMeta` |
| E15 | 1742 | repli mutation réserve refusé | — | `retryRpcOp` + `op.data` | `fail` | politique | mutation | `fallbackMeta` |
| E16 | 1743 | repli mutation réserve accepté | — | `retryRpcOp` | `applied` | — | mutation | — |
| E17 | 1745 | RPC indisponible, aucun repli possible | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E18 | 1747 | toute autre erreur RPC | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E19 | 1752 | verdict de statut réserve ≠ `ok` | — | `retryRpcOp` | `fail` | terminal si statut listé, sinon politique | RPC | `rpcMeta` |
| E20 | 1758 | verdict de statut réserve `ok` | — | `retryRpcOp` | `applied` | — | RPC | — |
| E21 | 1765 | création de réserve avec photos réussie | cache photos, invalidation, notification | `retryRpcOp` | `applied` | — | RPC | — |
| E22 | 1777 | réponse de stock illisible | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E23 | 1791 | refus de stock définitif | réconciliation du cache terminal | `retryRpcOp` | `fail` | terminal (`terminalOutcome`) | RPC | `rpcMeta` |
| E24 | 1809 | mouvement ou modification de stock accepté | invalidation des requêtes de stock | `retryRpcOp` | `applied` | — | RPC | — |
| E25 | 1813 | tout autre RPC sans erreur | — | `retryRpcOp` | `applied` | — | RPC | — |

## Détection de conflit de statut

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E26 | 1826 | lecture de la réserve refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E27 | 1828 | réserve absente côté serveur | — | `op` | `applied` | — | select | — |
| E28 | 1843 | statut serveur divergent | conflit empilé pour l'interface | `op` | `conflict` | — | select | — |
| E29 | 1853 | écriture du statut refusée | — | `op` | `fail` | politique | mutation | `applyMeta` |
| E30 | 1854 | écriture du statut acceptée | — | `op` | `applied` | — | mutation | — |

## Fusion de commentaires

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E31 | 1873 | lecture des commentaires refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E32 | 1876 | ligne absente côté serveur | — | `op` | `applied` | — | select | — |
| E33 | 1900 | patch de commentaire malformé | journalisation | `op` | `terminal` | — | validation locale | n.a. |
| E34 | 1910 | écriture fusionnée refusée | — | `op` | `fail` | politique | mutation | `writeMeta` |
| E35 | 1911 | écriture fusionnée acceptée | — | `op` | `applied` | — | mutation | — |

## Upload avant rejeu générique

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E36 | 1956 | fichier photo absent du disque | journalisation | `op` | `terminal` | — | upload | n.a. |
| E37 | 1979 | upload d'un patch photo échoué | — | `op` + progrès partiel | `fail` | politique | upload | n.a. |
| E38 | 2047 | upload de fichiers locaux échoué | — | `op` | `fail` | politique | upload | n.a. |
| E39 | 2051 | exception pendant l'upload | — | `op` | `fail` | politique | exception locale | n.a. |

Le cas « réserve dont seules les photos échouent » ne sort pas ici : il dépouille
le payload de ses URI locales, poursuit le rejeu générique, et diffère un patch
photo distinct (`deferredPhotoPatch`).

## Patch photo de réserve

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E40 | 2066 | lecture de la galerie refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E41 | 2070 | réserve supprimée entre-temps | — | `op` | `applied` | — | select | — |
| E42 | 2112 | écriture de la galerie refusée | — | `op` + `nextPayload` | `fail` | politique | mutation | `writeMeta` |
| E43 | 2113 | écriture de la galerie acceptée | — | `op` + `nextPayload` | `applied` | — | mutation | — |

## Rejeu générique — `update`

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E44 | 2143 | filtre absent | — | `op` | `fail` | politique | validation locale | n.a. |
| E45 | 2187 | conflit de version rebasé | nouvelle entrée poussée dans `failedOps` | version rebasée (nouvel `id`, `baseVersion`) | `deferred` | opération | RPC | — |
| E46 | 2189 | rebase impossible | — | `retryOpForCatch` | `fail` | terminal (`terminalStatus`) | RPC | — |
| E47 | 2193 | verdict de patch réserve ≠ `ok` | — | `retryOpForCatch` | `fail` | terminal si statut listé, sinon politique | RPC | `rpcResult.meta` |
| E48 | 2214 | 0 ligne affectée, ligne déjà absente | — | `retryOpForCatch` | `applied` | — | select de contrôle | — |
| E49 | 2218 | 0 ligne affectée, ligne toujours présente | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |

## Rejeu générique — `delete`

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E50 | 2223 | filtre absent | — | `op` | `fail` | politique | validation locale | n.a. |
| E51 | 2239 | lecture des réserves liées refusée | — | `op` | `fail` | politique | select | `linkedMeta` |
| E52 | 2242 | chantier encore porteur de réserves | — | `op` | `fail` | politique | select | n.a. |
| E53 | 2266 | 0 ligne supprimée, ligne déjà absente | — | `op` | `applied` | — | select de contrôle | — |
| E54 | 2270 | 0 ligne supprimée, ligne toujours présente | — | `op` | `fail` | politique | mutation | `result.meta` |

## Sorties finales

| Id | Ligne | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| E55 | 2274 | `op.op` inconnu | — | `op` | `fail` | politique | validation locale | n.a. |
| E56 | 2277 | rejeu générique refusé | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |
| E57 | 2289 | rejeu générique accepté | notifications, patch photo différé empilé | `retryOpForCatch` | `applied` | — | mutation | — |
| E58 | 2291 | exception non rattrapée | — | `retryOpForCatch` | `fail` | politique | exception locale | n.a. |

## Deux poussées directes conservées

`failedOps.push(...)` subsiste en deux endroits, volontairement :

- **E45** — l'entrée rebasée porte un nouvel `id` ; elle est à la fois l'issue de
  l'opération courante et l'entrée qui la remplace dans la file.
- **E57** — `deferredPhotoPatch` est une **nouvelle** entrée de file, pas l'issue
  de l'opération courante : la réserve a bien été écrite, ses photos partent
  séparément.

Tant que la reconstruction de la file lit `failedOps`, ces poussées restent
nécessaires. Elles disparaîtront quand `runSyncPass` consommera les issues.

## Observation laissée ouverte

Sept sorties concernent des opérations **structurellement impossibles à
satisfaire** : E01, E02, E10, E12, E44, E50 et E55 — RPC sans fonction, payload
absent, filtre manquant, opération inconnue. Elles rendent aujourd'hui une erreur
sous forme de chaîne, que `classifySyncFailure` range en `unknown` : l'opération
est **différée indéfiniment** alors qu'aucune tentative ne la rendra valide.

`syncQueuePolicy` connaît pourtant déjà un code `MISSING_FILTER` traité comme
refus déterministe — il n'est simplement utilisé par aucun de ces appels.

Ce n'est pas une régression : la conversion n'a rien changé à ce comportement,
elle l'a rendu visible. Le corriger déplacerait ces opérations de « en attente »
vers « refusée », ce qui est **visible par l'utilisateur** — c'est une décision
produit, pas un détail d'implémentation. Elle est donc laissée ouverte.
