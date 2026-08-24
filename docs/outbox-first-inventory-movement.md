# Outbox-first — `record_inventory_movement`

Table d'états **écrite avant l'implémentation**. Aucun code n'accompagne ce
document : il existe pour être contesté avant que quoi que ce soit ne soit
construit dessus.

Les quatre dernières corrections de `dispatchState` ont toutes eu la même
origine — un état introduit avant que la signification de chacune de ses
valeurs, et l'identité de qui les pose, ne soient écrites. `unknown` n'a pas été
une découverte tardive : c'était la conséquence mécanique de poser la table.
Elle est donc posée d'abord cette fois.

**Révision 2** — intègre les quatre exigences bloquantes de la revue :
projection locale complète (§3), écritures de cache strictes (§4), rebase après
verdict autoritaire (§5), exclusion réelle de `pending` du moteur (§6). Les
arbitrages 5.1 à 5.3 sont arrêtés et reportés en §8.

---

## 1. Le chemin actuel et la fenêtre qu'il laisse

Dans [`hooks/queries/useInventory.ts`](../hooks/queries/useInventory.ts), la
séquence est aujourd'hui :

| Ligne | Étape |
|---|---|
| `:405` | `operationId = Crypto.randomUUID()` — en mémoire uniquement |
| `:472-480` | effet optimiste appliqué **et persisté** (`await persistCurrent()`) |
| `:553` | upload des photos produit |
| `:564` | `supabase.rpc('record_inventory_movement', …)` — appel direct |
| `:523` | `queueRpc(...)` — enfilement **uniquement en cas d'échec** |

`queueRpc` n'est atteint que par quatre branches : hors-ligne ou produit déjà en
file, upload raté, erreur RPC, réponse illisible. Le chemin nominal — succès —
n'écrit jamais dans la file.

D'où la fenêtre :

```text
:480  le stock optimiste est durable sur le disque
:564  le RPC part, le serveur committe
      plantage
      → aucune entrée de file, aucun operation_id sur le disque
      → au redémarrage : stock local avancé, et rien pour le réconcilier
```

Une seconde fenêtre, plus étroite, subsiste même quand `queueRpc` est atteint :
`enqueueOperation` publie en mémoire puis lance `void saveQueue(updated)`
([`context/NetworkContext.tsx:3101`](../context/NetworkContext.tsx#L3101)) — une
sauvegarde best-effort, ni attendue ni vérifiée. `unknown` empêche que cette
entrée soit supprimée par la purge ; il ne garantit pas qu'elle atteigne le
disque.

---

## 2. Des axes, pas un enum — et les combinaisons interdites

`never_started`, `terminal`, `awaiting_conflict_resolution`, `quarantined` et
`purge_pending_reconciliation` ne sont pas des valeurs exclusives. Une entrée
`started` **devient** `terminal` quand le serveur la refuse ; les fondre en une
colonne unique effacerait le fait qu'une requête est partie, ce que la purge doit
précisément savoir.

### Axe 1 — Envoi (`dispatchState`) — existe

| Valeur | Signification | Qui la pose |
|---|---|---|
| `never_started` | Preuve explicite qu'aucune requête n'est partie | `enqueueOperation` sur affirmation `proveNeverStarted` |
| `unknown` | Sort antérieur inconnu | défaut à l'entrée en file |
| `started` | Preuve **persistée avant** l'appel réseau | `prepareQueueForDispatch` uniquement |

### Axe 2 — Effet local (`localEffectState`) — **nouveau**

| Valeur | Signification | Qui la pose |
|---|---|---|
| `pending` | Outbox durable ; le cache optimiste peut être absent, partiel ou complet | écriture de l'outbox |
| `applied` | La projection locale est durable et connue | après le commit journalisé du cache |
| `reconciled` | Le verdict autoritaire a remplacé l'effet optimiste ; plus rien à défaire | réconciliation, succès comme refus terminal |

### Axe 3 — Verdict serveur (`terminal`, `terminalStatus`, `terminalOutcome`) — existe

### Axe 4 — Suppression (`purgeState`) — existe

### Axes 5 et 6 — Conflit durable et quarantaine — **n'existent pas encore**

Points 6 de l'ordre convenu. Cette PR ne doit ni les créer ni les préempter. Un
mouvement de stock ne produit pas de `version_conflict` : la ligne
`awaiting_conflict_resolution` sera écrite avec la réserve.

### Droits dérivés, pas déclarés

```text
réseau autorisé   ⟺  dispatchState === 'started'
                      ∧ localEffectState !== 'pending'
                      ∧ !terminal
                      ∧ purgeState === undefined

purge autorisée   ⟺  dispatchState === 'never_started'
                      ∧ !terminal
                      ∧ (localEffectState !== 'applied' ∨ un compensateur existe)
```

### Matrice d'invariants

Des axes indépendants créent des combinaisons qui n'ont aucun sens. Elles sont
interdites explicitement, et chacune est vérifiée :

| Invariant | Raison |
|---|---|
| `localEffectState === 'pending'` ⇒ `dispatchState !== 'started'` | aucun réseau avant que l'effet local soit durable |
| `dispatchState === 'started'` ⇒ `localEffectState ∈ {applied, reconciled}` | la barrière n'est franchissable qu'après §6 |
| `terminal === true` avec verdict serveur ⇒ `dispatchState === 'started'` | le serveur a nécessairement répondu |
| `purgeState === 'pending_reconciliation'` ⇒ aucun réseau | la suppression est déjà engagée |
| `localEffectState === 'reconciled' ∧ !terminal` ⇒ nettoyage seulement | un succès ne doit plus repartir |
| champ absent ou version inconnue ⇒ chemin legacy conservateur | aucune déduction depuis une file ancienne |

### Versionnement

```ts
/** Absent sur toute file persistée avant cette migration. */
outboxSchemaVersion?: 1;
```

Les files de production ne portent aucun de ces champs. Leur absence ne doit
**jamais** valoir « entrée outbox-first valide » : c'est la même faute que
déduire `never_started` de l'absence de compteurs. Une entrée sans
`outboxSchemaVersion` suit le chemin actuel — `unknown`, pas de `localEffect`,
pas de rebase, pas de reprise de projection.

---

## 3. La projection locale doit être complète, pas seulement le stock

La révision 1 proposait `{ productId, movementId, stockAfter }`. C'est
insuffisant, et la revue a raison de le bloquer : le mouvement optimiste porte
l'organisation, le chantier, le type, la quantité, `stockBefore`, la référence,
la désignation, le fournisseur, l'emplacement, le bâtiment, la zone,
l'entreprise, la personne, le commentaire, l'auteur et la date. Le produit peut
en outre être **créé intégralement**, et porte des totaux d'entrée/sortie, un
seuil, une version et `pendingSync`.

Reconstruire tout cela depuis trois champs est impossible. La charge est donc un
snapshot de projection complet et versionné :

```ts
interface InventoryMovementLocalEffectV1 {
  version: 1;
  kind: 'inventory_movement';
  /** Le produit tel que l'intention l'a rendu visible, en entier. */
  productAfter: InventoryProduct;
  /** Le mouvement tel que l'intention l'a rendu visible, en entier. */
  movementAfter: InventoryMovement;
}
```

Réutiliser les types de domaine plutôt que de les recopier évite qu'un champ
ajouté à `InventoryProduct` soit silencieusement absent de la projection : le
compilateur le réclame.

### Pourquoi un delta ne peut pas remplacer ce snapshot

La charge utile RPC porte `quantity` et `movement_type` — un delta. Réappliquer
un delta sur un cache dont on ignore s'il l'a déjà reçu double le mouvement.
C'est « absence de preuve traitée comme preuve d'absence » sous une autre forme.

### Reprise depuis `pending`

```text
pour chaque entrée outbox non terminale du produit, dans l'ordre de la file :
  upsert de movementAfter par son id
  remplacement de productAfter par son id
commit journalisé du couple de caches
puis localEffectState := 'applied'
```

Rejouer deux fois donne le même résultat. Le cas « à moitié écrit » se résout
sans avoir à le distinguer du cas « pas écrit ».

---

## 4. Le cache doit être écrit strictement

`persistCurrent` ([`useInventory.ts:303`](../hooks/queries/useInventory.ts#L303))
appelle deux `writeCache()` en parallèle. Or `writeCache`
([`lib/offlineCache.ts:285`](../lib/offlineCache.ts#L285)) **avale** l'erreur de
stockage :

```ts
try { await writeCacheStrict(key, data, userId); }
catch { /* Storage full or unavailable — silently ignore */ }
```

La séquence dangereuse est donc réelle :

```text
écriture produits échoue silencieusement
écriture mouvements réussit
persistCurrent résout
→ localEffectState passerait à applied
→ réseau autorisé
alors que la projection n'est pas durable
```

`localEffectState` reste `pending` tant que **les deux** snapshots n'ont pas été
écrits strictement.

Le dépôt possède déjà le bon outil :
[`commitCachePairWithJournalStrict`](../lib/offlineCache.ts#L331) — un journal
d'écriture anticipée qui rend récupérable une écriture sur deux clés, écrit le
journal, puis les deux cibles **séquentiellement**, puis supprime le journal ;
une reprise rejoue les cibles d'origine même si une seule des deux a abouti.

Ce n'est pas un mécanisme à construire : `reconcileTerminalInventoryOperationCache`
l'utilise déjà sur exactement ce couple de clés
([`NetworkContext.tsx:340`](../context/NetworkContext.tsx#L340)). L'écriture
optimiste passe par le même chemin.

---

## 5. Rebase après un verdict autoritaire

L'état absolu règle le plantage **avant** l'envoi. Il ne suffit pas quand le
serveur rend un stock différent de la prédiction locale :

```text
cache local 10 ; A +5 → 15 ; B +3 → 18
un autre appareil porte le serveur à 20
le serveur applique A : stock_before 20, stock_after 25
→ le stock local attendu n'est ni 18 ni 25, mais 28
```

### Ce que le code fait aujourd'hui — deux règles qui se contredisent

En vérifiant ce point j'ai trouvé une incohérence **déjà en production**, sans
rapport avec l'outbox :

- refus terminal —
  [`reconcileTerminalInventoryMovementCache`](../lib/inventoryMovementOutcome.ts#L341)
  inverse **uniquement le delta** du mouvement rejeté, avec le commentaire
  explicite qu'un `stock_before` absolu effacerait les mouvements suivants ;
- succès —
  [`reconcileInventoryMovementCache`](../lib/inventoryMovementOutcome.ts#L282)
  écrit `currentStock: outcome.stockAfter`, **en absolu**.

Le chemin succès efface donc déjà l'effet des mouvements encore en attente sur le
même produit. Avec 10 en local, A +5 et B +3, un succès de A ramène l'affichage à
15 alors que B reste enfilée. Le cache se répare quand B aboutit à son tour, mais
reste faux entre les deux — et durablement faux si B est différée. Le danger que
le chemin terminal documente est réel sur le chemin succès.

### La règle retenue

Un produit portant au moins une entrée outbox non terminale a un cache **dérivé**,
plus autoritaire :

```text
base   := dernier stock serveur connu pour ce produit
cache  := projection de base par les entrées outbox, dans l'ordre physique
```

Après chaque verdict autoritaire :

```text
base := outcome.stockAfter   en cas de succès
base := outcome.stockBefore  en cas de refus terminal
pour chaque mouvement suivant non terminal du même produit, dans l'ordre :
  stockBefore := base courant
  stockAfter  := base courant ± quantity selon movementType
  localEffect mis à jour avec ces valeurs absolues
persister, dans cet ordre :
  1. l'outbox rebasée (écriture stricte)
  2. le couple de caches projeté (commit journalisé)
```

L'ordre importe : un plantage entre 1 et 2 laisse une outbox correcte et un cache
périmé, que l'hydratation reprojette. L'ordre inverse laisserait un cache que
plus rien ne justifie.

Un produit sans aucune entrée outbox garde le comportement actuel. Les deux
règles ne coexistent donc pas sur le même produit — c'est la condition pour que
l'incohérence ci-dessus ne soit pas simplement déplacée.

### Test obligatoire

```text
stock local initial 10, serveur initial 20
deux commandes locales +5 puis +3
premier verdict autoritaire : stock_after 25
seconde encore en attente
→ stock local projeté = 28
→ localEffect de la seconde rebasé à stockBefore 25 / stockAfter 28
```

---

## 6. `pending` doit être réellement exclu du moteur

Le prédicat de §2 ne vaut que s'il est appliqué. La barrière marque aujourd'hui
`started` **toute** entrée rejouable qui ne l'est pas déjà
([`NetworkContext.tsx:1620`](../context/NetworkContext.tsx#L1620)) : elle ignore
`localEffectState`. Sans changement :

```text
outbox durable pending → cache pas encore réparé → barrière started → RPC
```

ce qui viole la séquence de §7.

Une entrée `pending` doit donc :

```text
ne pas être marquée started
ne pas entrer dans le snapshot de passe
déclencher la reprise de sa projection locale, puis redevenir éligible
```

Le point d'application est `isReplayableQueuedOperation`, qui alimente à la fois
`needsProof` et le filtre du snapshot : y ajouter `localEffectState !== 'pending'`
ferme les deux portes d'un seul prédicat, comme c'est déjà le cas pour
`purgeState` et `terminal`. La reprise elle-même appartient à l'hydratation, au
même titre que `resumePendingQueuePurge`.

**Conséquence à ne pas manquer** : une entrée `pending` dont la reprise échoue
n'est plus rejouable. Elle ne doit pas pour autant devenir supprimable — la
projection est incertaine, pas absente. Le prédicat de purge de §2 la conserve
déjà, puisqu'il exige `never_started` **et** un compensateur.

---

## 7. Séquence nominale et points de plantage

```text
intention utilisateur
 1. validation locale (stock suffisant, permissions)
 2. génération UNIQUE : operationId, movementId, productId, queueEntryId
 3. ÉCRITURE STRICTE de l'outbox   → never_started, pending, localEffect complet
 4. commit journalisé du couple de caches
 5. ÉCRITURE STRICTE               → applied
 6. barrière stricte               → started
 7. RPC avec le même operation_id
```

| Plantage après | État sur disque | Reprise |
|---|---|---|
| 2 | rien | l'intention est perdue ; aucune écriture serveur n'a pu partir |
| 3 | outbox `never_started` / `pending` | l'hydratation reprojette depuis `localEffect`, puis `applied` |
| 4 | outbox `pending`, cache complet ou journal ouvert | le journal rejoue ses cibles ; la reprojection converge |
| 5 | outbox `never_started` / `applied` | l'entrée part à la passe suivante |
| 6 | outbox `started` / `applied` | rejeu avec le **même** `operation_id` |
| 7 | outbox `started` / `applied` | idem — l'idempotence serveur tranche |

Verdicts :

```text
succès explicite      → réconciliation autoritaire → rebase des suivants (§5)
                      → reconciled → SUPPRESSION STRICTE de l'outbox
refus terminal        → terminalOutcome persisté → réconciliation → rebase
                      → reconciled, entrée conservée pour acquittement
timeout / corps illisible / réponse perdue
                      → started conservé, même operation_id, retry planifié
annulation client     → aucune conclusion sur le serveur → started conservé
```

Aucun de ces chemins ne conclut à un refus depuis une absence de réponse.

---

## 8. Arbitrages arrêtés

### 8.1 Un seul émetteur ; l'observateur ne porte aucune sûreté

Le moteur est le **seul émetteur réseau**. Le hook n'appelle plus
`record_inventory_movement`.

L'attente du premier résultat est une couche UX **optionnelle et bornée**, jamais
une garantie :

```ts
type InventoryFirstAttemptResult =
  | { kind: 'applied'; outcome: InventoryMovementOutcome }
  | { kind: 'terminal'; outcome: InventoryMovementOutcome }
  | { kind: 'deferred' }
  | { kind: 'cancelled' }
  | { kind: 'ownership_lost' };
```

Contrat : l'observateur se termine au **premier résultat de tentative**, pas à la
sortie de file. Indexé par `queueEntryId`, enregistré **avant** de programmer la
passe, annulé au changement de compte, borné dans le temps. Exclusivement en
mémoire : après un redémarrage, la garantie est l'outbox, jamais la promesse.

```text
en ligne + opération immédiatement admissible → attendre le premier résultat
hors-ligne, derrière une précédente du même produit, auth indisponible,
  ou délai dépassé                            → { queued: true } immédiat
succès                                        → retour autoritaire
refus terminal                                → InventoryOperationError
timeout / erreur réseau                       → { queued: true }, jamais d'attente indéfinie
```

### 8.2 Méthode stricte distincte, spécialisée d'abord

`enqueueOperation` publie puis sauvegarde en best-effort : incompatible avec
« échec de persistance ⇒ zéro RPC ». Une API métier plutôt qu'un outil générique
prématuré :

```ts
submitInventoryMovementOutboxStrict(command)
```

Elle enchaîne comme une seule procédure : création stricte de l'entrée → effet
local durable → passage strict à `applied` → programmation de la passe →
observateur éventuel. Les autres sites conservent `enqueueOperation`.

### 8.3 Mode sans serveur — aucune outbox

```text
isSupabaseConfigured === false
→ mutation purement locale, pendingSync=false, aucune outbox, aucun observateur
```

Test dédié, pour qu'une refactorisation future ne rende pas ce chemin dépendant
de la file.

---

## 9. Les médias sont déjà dans ce chemin

`recordMovement` téléverse aujourd'hui la photo produit avant son RPC
([`useInventory.ts:553`](../hooks/queries/useInventory.ts#L553)), et le produit
optimiste peut porter une URI locale. Reporter « les médias » sans trancher
laisserait le cas ouvert.

**Politique retenue : conserver l'upload dans l'exécuteur.**

L'exécuteur le fait déjà pour les rejeux
([`NetworkContext.tsx:2064`](../context/NetworkContext.tsx#L2064)), et le
registre serveur exclut délibérément `photo_url` de son hash
([migration `20260814102326`](../supabase/migrations/20260814102326_harden_inventory_operation_idempotency.sql#L77))
précisément pour qu'un rejeu puisse téléverser le même fichier vers une autre URL
sans produire de `duplicate_operation_mismatch`. Conditions :

- l'URL distante remplace **strictement** l'URI locale dans l'opération ;
- `localEffect.productAfter.photoUrl` est mis à jour dans la même écriture ;
- un plantage entre upload et RPC peut re-téléverser — le hash serveur le tolère.

**Je m'écarte ici de la recommandation de la revue**, qui préférait un RPC
indépendant de l'upload avec une opération média distincte. Cette voie exige
l'opération média, qui est le point 4 de l'ordre convenu : l'adopter maintenant
obligerait soit à la construire dans cette PR, soit à livrer un produit dont la
photo ne part jamais. À arbitrer en revue — c'est le seul point du document où je
propose autre chose que ce qui a été demandé.

---

## 10. L'adaptateur serveur existe déjà

La révision 1 disait « construire l'adaptateur en premier ». À corriger : la
logique de production ne doit pas être reconstruite côté client. La base tient
déjà la clé `(organization_id, operation_id)`, le hash de commande, le registre
durable des succès et refus, la restitution du même verdict au rejeu, et
`duplicate_operation_mismatch` quand le même identifiant porte une autre
commande.

Deux couches de preuve, sans qu'aucune ne devienne une seconde spécification :

```text
tests unitaires rapides → faux adaptateur à état reproduisant ce contrat
test SQL / Supabase     → supabase/tests/inventory_operation_idempotency.sql
```

Le faux adaptateur ne vaut que tant que le test SQL le contredit s'il dérive.

---

## 11. Les douze critères et leur preuve

| # | Critère | Preuve |
|---|---|---|
| 1 | `operation_id` généré une seule fois | deux tentatives, même identifiant ; mutation : régénérer à chaque essai |
| 2 | Entrée strictement durable avant tout RPC | promesse contrôlée : aucun RPC tant que l'écriture n'a pas résolu |
| 3 | Échec de persistance ⇒ zéro appel réseau | écriture qui rejette ; l'espion RPC reste à zéro |
| 4 | Aucun chemin direct avant l'outbox | assertion comportementale sur l'ordre, pas sur la source |
| 5 | Timeout ⇒ même `operation_id` | rejeu après timeout, comparaison de l'argument |
| 6 | Redémarrage ⇒ identifiant conservé | hydratation depuis un disque simulé |
| 7 | Succès puis plantage avant suppression ⇒ un seul mouvement | faux adaptateur idempotent + test SQL |
| 8 | Refus terminal ⇒ stock optimiste annulé | réconciliation vérifiée sur le cache durable |
| 9 | Plantage entre outbox et cache repris proprement | cache absent **et** cache à moitié écrit, journal ouvert |
| 10 | 30 mouvements drainés en une passe | test d'adaptateur réel |
| 11 | Mouvements serveur = `operation_id` uniques | même test |
| 12 | Stock final local = stock serveur | même test, avec le rebase de §5 |

Test déterminant :

```text
outbox op-1 durable ; le serveur applique op-1 ; réponse perdue ; redémarrage ;
rejeu op-1 → un seul mouvement serveur, file vidée, stock cohérent
```

---

## 12. Hors périmètre de la première PR

- `update_inventory_product`, réserves, opérations média — points 2 à 4.
- Conflit durable et quarantaine — point 6.
- Le modèle par projection généralisé : §5 l'applique aux produits sous outbox,
  et à eux seuls.
- Les autres appels d'`enqueueOperation`, qui gardent le chemin actuel.
