# Outbox-first — `record_inventory_movement`

Table d'états **écrite avant l'implémentation**. Aucun code n'accompagne ce
document : il existe pour être contesté avant que quoi que ce soit ne soit
construit dessus.

Les quatre dernières corrections de `dispatchState` ont toutes eu la même
origine — un état introduit avant que la signification de chacune de ses
valeurs, et l'identité de qui les pose, ne soient écrites. `unknown` n'a pas été
une découverte tardive : c'était la conséquence mécanique de poser la table.
Elle est donc posée d'abord cette fois.

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

## 2. Ce que la table doit être : des axes, pas un enum

La table proposée en revue range `never_started`, `terminal`,
`awaiting_conflict_resolution`, `quarantined` et `purge_pending_reconciliation`
dans une colonne unique. Le code ne peut pas suivre : ces valeurs ne sont pas
exclusives.

Une entrée `started` **devient** `terminal` quand le serveur la refuse. Les
fondre en un seul état effacerait le fait qu'une requête est partie — c'est
précisément ce que la purge doit savoir. Elle pose deux questions indépendantes :

- « quelque chose est-il parti ? » → axe **envoi** ;
- « reste-t-il un effet local à défaire ? » → axe **effet local**.

Chaque axe garde donc son champ.

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
| `applied` | L'effet optimiste est durable et connu | après persistance du cache |
| `reconciled` | Le verdict autoritaire a remplacé l'effet optimiste ; plus rien à défaire | réconciliation, succès comme refus terminal |

### Axe 3 — Verdict serveur (`terminal`, `terminalStatus`, `terminalOutcome`) — existe

### Axe 4 — Suppression (`purgeState`) — existe

### Axes 5 et 6 — Conflit durable et quarantaine — **n'existent pas encore**

Ce sont les points 6 de l'ordre convenu. Cette PR ne doit ni les créer ni les
préempter. Un mouvement de stock ne produit pas de `version_conflict` : la ligne
`awaiting_conflict_resolution` de la table est hors périmètre ici et sera écrite
avec la réserve.

### Droits dérivés, pas déclarés

« Réseau autorisé » et « purge autorisée » ne sont pas des colonnes d'un état :
ce sont des **fonctions** des axes.

```text
réseau autorisé   ⟺  dispatchState === 'started'
                      ∧ localEffectState !== 'pending'
                      ∧ !terminal
                      ∧ purgeState === undefined

purge autorisée   ⟺  dispatchState === 'never_started'
                      ∧ !terminal
                      ∧ (localEffectState !== 'applied' ∨ un compensateur existe)
```

La condition `localEffectState !== 'pending'` avant tout réseau est le cœur du
point suivant.

---

## 3. Le plantage entre l'outbox et le cache optimiste

L'ordre outbox → cache est le bon : l'inverse perd l'écriture. Mais il crée le
cas à traiter explicitement :

```text
outbox durable
→ plantage avant la mise à jour du cache optimiste
```

`persistCurrent` écrit **deux clés** AsyncStorage —
[`useInventory.ts:307`](../hooks/queries/useInventory.ts#L307), produits et
mouvements, via `Promise.all`. Un plantage entre les deux laisse un effet à
moitié appliqué. `pending` doit donc signifier « le cache peut être dans
n'importe quel état », et non « le cache n'a pas été touché ».

### Pourquoi rejouer un delta ne marche pas

La charge utile enfilée porte `quantity` et `movement_type` — un **delta**.
Réappliquer un delta sur un cache dont on ignore s'il l'a déjà reçu double le
mouvement. C'est exactement la faute « absence de preuve traitée comme preuve
d'absence » sous une autre forme.

### La correction : l'entrée porte l'état attendu, en absolu

L'entrée outbox transporte l'**état post-attendu**, déjà calculé au moment de
l'intention (`after`, `movementId`) :

```ts
localEffect: {
  productId: string;
  movementId: string;
  /** Stock ABSOLU attendu après cette opération. Jamais un delta. */
  stockAfter: number;
}
```

La reprise à l'hydratation devient déterministe et idempotente :

```text
pour chaque entrée outbox de ce produit, dans l'ordre de la file :
  upsert du mouvement par movementId
  product.currentStock := entry.localEffect.stockAfter
puis localEffectState := 'applied'
```

Rejouer deux fois donne le même résultat. Deux mouvements enfilés sur le même
produit convergent vers le `stockAfter` du dernier, ce qui est correct. Le cas
« à moitié écrit » se résout sans avoir à le distinguer du cas « pas écrit ».

### Où cela mène, et pourquoi le dire maintenant

Une fois l'effet optimiste exprimé en absolu et porté par l'entrée, le cache
durable cesse d'être une source de vérité indépendante : il devient la
**projection** de « dernier état serveur connu » + « entrées outbox dans
l'ordre ». Ce modèle supprime une classe entière de problèmes — la purge n'a plus
besoin d'un compensateur par type d'opération, elle recalcule la projection sans
l'entrée retirée.

Ce n'est pas le périmètre de cette PR et je ne propose pas de l'y faire entrer.
Mais la forme absolue de `localEffect` est choisie pour que ce chemin reste
ouvert sans avoir à défaire ce qui sera écrit maintenant.

---

## 4. Séquence nominale et points de plantage

```text
intention utilisateur
 1. validation locale (stock suffisant, permissions)
 2. génération UNIQUE : operationId, movementId, productId, queueEntryId
 3. ÉCRITURE STRICTE de l'outbox   → never_started, localEffectState=pending
 4. application + persistance de l'effet optimiste
 5. ÉCRITURE STRICTE               → localEffectState=applied
 6. barrière stricte               → started
 7. RPC avec le même operation_id
```

| Plantage après | État sur disque | Reprise |
|---|---|---|
| 2 | rien | l'intention est perdue ; aucune écriture serveur n'a pu partir |
| 3 | outbox `never_started` / `pending` | l'hydratation réapplique l'effet absolu, passe à `applied` |
| 4 | outbox `pending`, cache partiel ou complet | idem — la réapplication absolue converge |
| 5 | outbox `never_started` / `applied` | l'entrée part normalement à la passe suivante |
| 6 | outbox `started` / `applied` | rejeu avec le **même** `operation_id` ; l'idempotence serveur tranche |
| 7 | outbox `started` / `applied` | idem |

Verdicts :

```text
succès explicite      → réconciliation autoritaire → localEffectState=reconciled
                      → SUPPRESSION STRICTE de l'outbox
refus terminal        → terminalOutcome persisté → réconciliation locale
                      → localEffectState=reconciled, entrée conservée pour acquittement
timeout / corps illisible / réponse perdue
                      → started conservé, même operation_id, retry planifié
annulation client     → aucune conclusion sur le serveur → started conservé
```

Aucun de ces chemins ne conclut à un refus depuis une absence de réponse.

---

## 5. Trois arbitrages que je ne tranche pas seul

### 5.1 Le hook garde-t-il un envoi en ligne ?

Le critère « le hook ne possède plus de chemin direct » admet deux lectures.

**(a) Le hook envoie lui-même, après l'outbox.** L'UX synchrone est conservée :
un refus serveur remonte encore par `throw new InventoryOperationError(...)`
([`useInventory.ts:600`](../hooks/queries/useInventory.ts#L600)). Coût : deux
émetteurs pour la même entrée. Un passe de synchronisation déclenchée en
parallèle peut envoyer la même opération — sans dommage métier, l'idempotence
serveur étant la garantie, mais avec deux réconciliations locales concurrentes.
Il faudrait un bail en mémoire, donc un cinquième axe non durable.

**(b) Le hook n'écrit que l'outbox ; le moteur envoie.** Un seul émetteur.
Environ 75 lignes de `useInventory.ts` — upload, parsing de verdict,
réconciliation, refus terminal — disparaissent au profit du chemin déjà testé de
`executeQueuedOperation`, qui les fait toutes. Coût : le refus serveur devient
asynchrone.

**(b′) Le hook n'écrit que l'outbox, et attend le verdict de *cette* entrée.**
Un seul émetteur, UX identique, au prix d'une promesse par entrée exposée par le
contexte.

Je recommande **(b′)**. À noter que le chemin asynchrone existe déjà et tourne :
hors-ligne, le refus passe aujourd'hui par la réconciliation terminale et
`rejectedInventorySignature`
([`useInventory.ts:319`](../hooks/queries/useInventory.ts#L319)). (b′) supprime
un doublon plutôt qu'une capacité.

### 5.2 `enqueueOperation` ne peut pas servir d'écriture d'outbox

Elle publie puis sauvegarde en best-effort. Les critères 2 et 3 — durable avant
tout RPC, zéro appel réseau si la persistance échoue — exigent une écriture
**stricte** qui rejette. Cela demande une nouvelle méthode de contexte, pas un
paramètre de plus sur l'existante ; et `enqueueOperation` doit rester en place
pour les 160 autres sites tant qu'ils ne sont pas convertis.

### 5.3 Le mode sans serveur est une exception à nommer

Quand `isSupabaseConfigured` est faux
([`useInventory.ts:540`](../hooks/queries/useInventory.ts#L540)), rien n'est
enfilé et `pendingSync` passe à `false`. Il n'y a pas de serveur, donc pas
d'écriture à rejouer et pas d'`operation_id` à protéger. Je propose de **ne pas**
écrire d'outbox dans ce mode, et d'inscrire l'exception dans le contrat plutôt
que de la laisser tacite.

---

## 6. Les douze critères, et comment chacun est prouvé

| # | Critère | Preuve |
|---|---|---|
| 1 | `operation_id` généré une seule fois | test : deux tentatives, même identifiant ; mutation : régénérer à chaque essai |
| 2 | Entrée strictement durable avant tout RPC | promesse contrôlée : le RPC n'est pas appelé tant que l'écriture n'a pas résolu |
| 3 | Échec de persistance ⇒ zéro appel réseau | écriture qui rejette ; l'espion RPC doit rester à zéro appel |
| 4 | Aucun chemin direct avant l'outbox | assertion comportementale sur l'ordre, pas sur la source |
| 5 | Timeout ⇒ même `operation_id` | rejeu après timeout, comparaison de l'argument |
| 6 | Redémarrage ⇒ identifiant conservé | hydratation depuis un disque simulé |
| 7 | Succès puis plantage avant suppression ⇒ rejeu, un seul mouvement | adaptateur serveur idempotent comptant les mouvements distincts |
| 8 | Refus terminal ⇒ stock optimiste annulé | réconciliation vérifiée sur le cache durable |
| 9 | Plantage entre outbox et cache repris proprement | reprise depuis `pending`, avec cache absent **et** cache à moitié écrit |
| 10 | 30 mouvements drainés en une passe | test d'adaptateur réel |
| 11 | Mouvements serveur = `operation_id` uniques | même test |
| 12 | Stock final local = stock serveur | même test |

Le test déterminant reste celui que vous avez formulé :

```text
outbox op-1 durable
serveur applique op-1
réponse perdue
redémarrage
rejeu op-1
→ un seul mouvement serveur
→ file vidée
→ stock cohérent
```

Il ne peut pas être écrit contre un `vi.fn()` : il exige un adaptateur serveur
qui tienne réellement `(organization_id, operation_id)` et rende le même verdict
au second appel. Cet adaptateur est aussi celui des critères 10 à 12 ; il est
donc construit en premier.

---

## 7. Ce que la première PR ne fera pas

- `update_inventory_product`, réserves, médias — points 2 à 4 de l'ordre convenu.
- Conflit durable et quarantaine — point 6.
- Le modèle par projection de la section 3.
- Les 160 autres appels d'`enqueueOperation`, qui gardent le chemin actuel.
