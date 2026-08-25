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
| `fail(...)` — verdict rendu par la politique | 32 |
| `applied` | 14 |
| `terminalLocalOperation(...)` — refus établi localement | 11 |
| `conflict` | 1 |
| `deferred` | 1 |
| **Total** | **59** |

Le premier comptage annonçait 37 sorties, lui-même plus précis que les 46
`continue` bruts. L'inventaire est de 59 : convertir un `continue` unique
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
de réessai, et son historique d'échec est effacé — conserver une `failureClass`
ou un `lastHttpStatus` périmés afficherait « refusée localement » à côté d'un
« HTTP 503 » et la regrouperait sous le mauvais alias.

**Rollback de stock.** La règle « aucun rollback pour un refus local » était trop
générale. Une erreur réseau est **ambiguë** — la requête a peut-être abouti, sa
réponse s'est perdue — et là il ne faut rien annuler. Une validation locale, au
contraire, prouve qu'**aucune requête n'a été émise** : le serveur ne peut pas
avoir appliqué l'écriture, et laisser le stock optimiste en place décale
durablement le cache. La règle exacte est donc :

> Aucun rollback sur un résultat réseau ambigu. Rollback autorisé sur un refus
> serveur explicite, ou sur une validation locale prouvant qu'aucune requête n'a
> été émise.

`isInventoryMovementOperation` décide de l'applicabilité. Elle ne peut pas se
limiter à `rpc.fn === 'record_inventory_movement'` : une opération dont la
fonction a disparu — le défaut même d'E01 — reste un mouvement, enfilé sous
`inventory_movements`. La table seule ne suffit pas non plus, une modification de
produit ne touchant aucun mouvement ; l'élargissement ne vaut donc que lorsque
**aucune** fonction n'est présente.

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
| E13 | instantané ou `plan_id` manquant après le RPC | — | `retryRpcOp` | `terminal` local + `provesServerReachable` | `invalid_local_operation` | validation locale, après un RPC réussi | n.a. |
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
| E33 | patch de commentaire malformé | journalisation de la FORME seule | `op` | `terminal` local + `provesServerReachable` | `invalid_payload` | validation locale, après un `SELECT` réussi | n.a. |
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

## Rejeu générique — `insert`

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E44 | doublon sans identifiant vérifiable | — | `retryOpForCatch` | `fail` | terminal `duplicate_insert_mismatch` | mutation | doublon `meta` |
| E45 | lecture de preuve du doublon refusée | — | `retryOpForCatch` | `fail` | politique | select | `existing.meta` |
| E46 | ligne derrière le doublon différente ou invisible | — | `retryOpForCatch` | `fail` | terminal `duplicate_insert_mismatch` | mutation | doublon `meta` |

## Rejeu générique — `update`

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E47 | filtre absent | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E48 | second appel du rebase échoué au transport | — | version rebasée (nouvel `id`, `baseVersion`) | `fail` | politique | RPC | `rebase.meta` |
| E49 | second `version_conflict` rendu par le serveur | nouvelle entrée poussée dans `failedOps` | version rebasée (nouvel `id`, `baseVersion`) | `deferred` + `provesServerReachable` | opération | RPC | — |
| E50 | rebase impossible | — | `retryOpForCatch` | `fail` | terminal (`terminalStatus`) | RPC | `rebase.meta` |
| E51 | verdict de patch réserve ≠ `ok` | — | `retryOpForCatch` | `fail` | terminal si statut listé, sinon politique | RPC | `rpcResult.meta` |
| E52 | 0 ligne affectée, ligne déjà absente | — | `retryOpForCatch` | `applied` | — | select de contrôle | — |
| E53 | 0 ligne affectée, ligne toujours présente | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |

## Rejeu générique — `delete`

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E54 | filtre absent | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E55 | lecture des réserves liées refusée | — | `op` | `fail` | politique | select | `linkedMeta` |
| E56 | chantier encore porteur de réserves | — | `op` | `fail` | politique | select | `linkedMeta` |
| E57 | 0 ligne supprimée, ligne déjà absente | — | `op` | `applied` | — | select de contrôle | — |
| E58 | 0 ligne supprimée, ligne toujours présente | — | `op` | `fail` | politique | mutation | `result.meta` |

## Sorties finales

| Id | Condition | Effets locaux | Version rendue | Issue | Portée | Source | `meta` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E59 | `op.op` inconnu | — | `op` | `terminal` local | `invalid_local_operation` | validation locale | n.a. |
| E60 | rejeu générique refusé | — | `retryOpForCatch` | `fail` | politique | mutation | `result.meta` |
| E61 | rejeu générique accepté | notifications, patch photo différé empilé | `retryOpForCatch` | `applied` | — | mutation | — |
| E62 | exception non rattrapée | — | `retryOpForCatch` | `fail` | politique | exception locale | n.a. |

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

Quatre sorties le portent :

- **E28** — le `SELECT` a abouti et le serveur a renvoyé un statut divergent.
- **E49** — le serveur a rendu un second `version_conflict` : il répond.
- **E13** — le RPC de remplacement de plan vient d'aboutir ; c'est l'instantané
  local qui manque ensuite.
- **E33** — le `SELECT` des commentaires a abouti ; c'est le patch local qui est
  illisible.

**E48 ne le porte plus, et c'est le correctif central.** `rebase.kind === 'retry'`
regroupait deux situations opposées : une erreur de transport du second appel, et
un `version_conflict` rendu par le serveur. L'issue construite à la main
contournait alors toute la politique P5 — pas de classe d'échec, pas d'échéance,
pas de portée backend ni authentification. Pire, un `401`, un `429` ou un `503`
porte `meta.reachedServer = true` : le drapeau valait donc `true` et **remettait
la série de pannes à zéro pour un `503`**, exactement ce que son nom devait
empêcher. Le message persisté annonçait de surcroît `version_conflict` alors que
la vraie cause était une coupure ou une limitation.

Le type distingue désormais `retry_transport` de `retry_conflict`. Le premier
passe par `fail()` avec sa métadonnée, donc par la politique. Il porte aussi
`serverAnsweredEarlier` : le rebase n'est atteint qu'**après** un premier
`version_conflict` rendu par le serveur, si bien que la série de pannes est déjà
rompue et que cet échec-ci en démarre une nouvelle — série finale `1`, et non
l'ancienne valeur conservée.

## Deux poussées directes conservées

`failedOps.push(...)` subsiste en dehors de `fail()` :

- **E48** — l'entrée rebasée porte un nouvel `id` ; elle est à la fois l'issue de
  l'opération courante et l'entrée qui la remplace dans la file.
- **E60** — `deferredPhotoPatch` est une **nouvelle** entrée de file, pas l'issue
  de l'opération courante : la réserve a bien été écrite, ses photos partent
  séparément.
- `terminalLocalOperation` pousse également son opération refusée, pour la même
  raison de pont legacy.

Tant que la reconstruction de la file lit `failedOps`, ces poussées restent
nécessaires. Elles disparaîtront quand `runSyncPass` consommera les issues.

## Limite connue

Aucune sortie construite sur une réponse serveur n'omet plus sa métadonnée.
`E50` — la variante terminale du rebase — transmet désormais `rebase.meta` : la
conséquence n'était pas seulement un `lastHttpStatus` absent, mais aussi une
série de pannes qui n'était pas rompue alors que le serveur avait répondu.
