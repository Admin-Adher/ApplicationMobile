# Contrat des sorties de `executeQueuedOperation`

Table de référence de la boucle de synchronisation (`context/NetworkContext.tsx`).
Chaque ligne décrit une sortie explicite : ce qui la déclenche, ce qu'elle laisse
derrière elle, quelle version de l'opération elle rend, et si la métadonnée de
transport atteint la politique de réessai.

Chaque sortie porte son identifiant dans le code : `syncExit('E01', …)`. Le type
`SyncExitId` fait échouer la compilation sur un identifiant inexistant, et
`tests/syncLoopExitContract.test.ts` vérifie que le code et cette table portent
exactement les mêmes, chacun une seule fois — **une sortie ajoutée sans ligne ici
fait échouer la CI**. Le verrou porte sur les identifiants, pas sur des
décomptes : un décompte reste vert si une sortie disparaît pendant qu'une autre
apparaît ailleurs. Il ne porte pas non plus sur les numéros de ligne, qui
deviennent faux au premier changement — c'est pourquoi cette table n'en contient
aucun.

## Décompte

| Issue | Nombre |
| --- | ---: |
| `fail(...)` — verdict rendu par la politique | 31 |
| `applied` | 14 |
| `terminalLocalOperation(...)` — refus établi localement | 11 |
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

**`terminalLocalOperation`** — refus définitif établi **sans le moindre appel
réseau**. L'opération est marquée `terminal`, poussée dans la file pour rester
visible dans le diagnostic et écartable par « rejets », privée de toute échéance
de réessai. **Aucun rollback de stock n'est déclenché** : seul un
`terminalOutcome` métier explicite, rendu par le serveur, autorise à annuler une
écriture optimiste.

## RPC

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | `op.rpc.fn` absent | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E02 | réserve sans `id` | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E03 | upload photos réserve partiel | cache photo mis à jour sur le progrès partiel | `partialRetryOp` (photos déjà distantes) | `fail` | politique | upload | n.a. |
| E04 | mouvement de stock au payload invalide | réconciliation du cache terminal | `op` | `fail` | terminal (`terminalOutcome`) | validation locale | n.a. |
| E05 | upload photo produit échoué | — | `op` | `fail` | politique | upload | n.a. |
| E06 | modification produit au payload invalide | — | `op` | `fail` | terminal (`terminalOutcome`) | validation locale | n.a. |
| E07 | upload photo produit échoué | — | `op` | `fail` | politique | upload | n.a. |
| E08 | révision de plan sans parent ou sans plan | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E09 | upload fichier plan échoué | — | `op` | `fail` | politique | upload | n.a. |
| E10 | remplacement de plan sans patch | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E11 | upload fichier plan échoué | — | `op` | `fail` | politique | upload | n.a. |
| E12 | événement de statut sans `reserve_id` ou `to_status` | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E13 | instantané ou `plan_id` manquant après le RPC | — | `retryRpcOp` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E14 | écriture des métadonnées de plan refusée | — | `retryRpcOp` | `fail` | politique | mutation | `metadataMeta` |
| E15 | repli mutation réserve refusé | — | `retryRpcOp` + `op.data` | `fail` | politique | mutation | `fallbackMeta` |
| E16 | repli mutation réserve accepté | — | `retryRpcOp` | `applied` | — | mutation | — |
| E17 | RPC indisponible, aucun repli possible | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E18 | toute autre erreur RPC | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E19 | verdict de statut réserve ≠ `ok` | — | `retryRpcOp` | `fail` | terminal si statut listé, sinon politique | RPC | `rpcMeta` |
| E20 | verdict de statut réserve `ok` | — | `retryRpcOp` | `applied` | — | RPC | — |
| E21 | création de réserve avec photos réussie | cache photos, invalidation, notification | `retryRpcOp` | `applied` | — | RPC | — |
| E22 | réponse de stock illisible | — | `retryRpcOp` | `fail` | politique | RPC | `rpcMeta` |
| E23 | refus de stock définitif | réconciliation du cache terminal | `retryRpcOp` | `fail` | terminal (`terminalOutcome`) | RPC | `rpcMeta` |
| E24 | mouvement ou modification de stock accepté | invalidation des requêtes de stock | `retryRpcOp` | `applied` | — | RPC | — |
| E25 | tout autre RPC sans erreur | — | `retryRpcOp` | `applied` | — | RPC | — |

## Détection de conflit de statut

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E26 | lecture de la réserve refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E27 | réserve absente côté serveur | — | `op` | `applied` | — | select | — |
| E28 | statut serveur divergent | conflit empilé pour l'interface | `op` | `conflict` + `provesServerReachable` | — | select | — |
| E29 | écriture du statut refusée | — | `op` | `fail` | politique | mutation | `applyMeta` |
| E30 | écriture du statut acceptée | — | `op` | `applied` | — | mutation | — |

## Fusion de commentaires

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E31 | lecture des commentaires refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E32 | ligne absente côté serveur | — | `op` | `applied` | — | select | — |
| E33 | patch de commentaire malformé | journalisation | `op` | `terminal` local | `invalid_payload` | validation locale | n.a. |
| E34 | écriture fusionnée refusée | — | `op` | `fail` | politique | mutation | `writeMeta` |
| E35 | écriture fusionnée acceptée | — | `op` | `applied` | — | mutation | — |

## Upload avant rejeu générique

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E36 | fichier photo absent du disque | journalisation | `op` | `terminal` local | `local_file_missing` | upload | n.a. |
| E37 | upload d'un patch photo échoué | — | `op` + progrès partiel | `fail` | politique | upload | n.a. |
| E38 | upload de fichiers locaux échoué | — | `op` | `fail` | politique | upload | n.a. |
| E39 | exception pendant l'upload | — | `op` | `fail` | politique | exception locale | n.a. |

Le cas « réserve dont seules les photos échouent » ne sort pas ici : il dépouille
le payload de ses URI locales, poursuit le rejeu générique, et diffère un patch
photo distinct (`deferredPhotoPatch`).

## Patch photo de réserve

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E40 | lecture de la galerie refusée | — | `op` | `fail` | politique | select | `fetchMeta` |
| E41 | réserve supprimée entre-temps | — | `op` | `applied` | — | select | — |
| E42 | écriture de la galerie refusée | — | `op` + `nextPayload` | `fail` | politique | mutation | `writeMeta` |
| E43 | écriture de la galerie acceptée | — | `op` + `nextPayload` | `applied` | — | mutation | — |

## Rejeu générique — `update`

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E44 | filtre absent | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E45 | conflit de version rebasé | nouvelle entrée poussée dans `failedOps` | version rebasée (nouvel `id`, `baseVersion`) | `deferred` + `provesServerReachable` | opération | RPC | — |
| E46 | rebase impossible | — | `retryOpForCatch` | `fail` | terminal (`terminalStatus`) | RPC | — |
| E47 | verdict de patch réserve ≠ `ok` | — | `retryOpForCatch` | `fail` | terminal si statut listé, sinon politique | RPC | `rpcResult.meta` |
| E48 | 0 ligne affectée, ligne déjà absente | — | `retryOpForCatch` | `applied` | — | select de contrôle | — |
| E49 | 0 ligne affectée, ligne toujours présente | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |

## Rejeu générique — `delete`

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E50 | filtre absent | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E51 | lecture des réserves liées refusée | — | `op` | `fail` | politique | select | `linkedMeta` |
| E52 | chantier encore porteur de réserves | — | `op` | `fail` | politique | select | n.a. |
| E53 | 0 ligne supprimée, ligne déjà absente | — | `op` | `applied` | — | select de contrôle | — |
| E54 | 0 ligne supprimée, ligne toujours présente | — | `op` | `fail` | politique | mutation | `result.meta` |

## Sorties finales

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E55 | `op.op` inconnu | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E56 | rejeu générique refusé | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |
| E57 | rejeu générique accepté | notifications, patch photo différé empilé | `retryOpForCatch` | `applied` | — | mutation | — |
| E58 | exception non rattrapée | — | `retryOpForCatch` | `fail` | politique | exception locale | n.a. |

## Preuve que le backend répond

`provesServerReachable` — et non `reachedServer` — parce que la nuance est
piégeuse. Un `503` a bien été rendu par le serveur, mais il alimente
délibérément le compteur de pannes consécutives : remettre la série à zéro sur
« le serveur a répondu » empêcherait le disjoncteur de s'ouvrir sur une panne de
service prolongée.

Ce drapeau signifie donc précisément : *cette issue **non-échec** prouve que le
backend répond, et les compteurs n'ont été touchés par personne d'autre*.
`fail()` ne le pose jamais — le classificateur est déjà propriétaire des
compteurs pour les échecs.

Deux sorties le portent :

- **E28** — le `SELECT` a abouti et le serveur a renvoyé un statut divergent.
- **E45** — `rebase.kind === 'retry'` recouvre deux causes distinctes : une
  coupure réseau, et un `version_conflict` rendu par le serveur. Seule la
  seconde prouve que le backend répond, et le drapeau vient du transport
  (`rpc.meta.reachedServer`), pas du motif textuel.

## Deux poussées directes conservées

`failedOps.push(...)` subsiste en dehors de `fail()` :

- **E45** — l'entrée rebasée porte un nouvel `id` ; elle est à la fois l'issue de
  l'opération courante et l'entrée qui la remplace dans la file.
- **E57** — `deferredPhotoPatch` est une **nouvelle** entrée de file, pas l'issue
  de l'opération courante : la réserve a bien été écrite, ses photos partent
  séparément.
- `terminalLocalOperation` pousse également son opération refusée, pour la même
  raison de pont legacy.

Tant que la reconstruction de la file lit `failedOps`, ces poussées restent
nécessaires. Elles disparaîtront quand `runSyncPass` consommera les issues.

## Limite connue

**E46** ne transmet pas de `meta`. `rebaseReservePatchOnConflict` ne rend pas la
métadonnée de transport sur sa variante terminale, et le `terminalStatus` fourni
impose déjà la portée. La seule conséquence est un `lastHttpStatus` absent dans
le diagnostic pour ce cas précis.
