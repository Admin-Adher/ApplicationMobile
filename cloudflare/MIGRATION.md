# Migration vers les médias privés

La migration est progressive afin de ne pas casser une ancienne APK qui ne sait
pas résoudre `btmedia://`. Ne pas combiner les phases dans un déploiement sans
mesures et gate de version.

## Phase 1 — serveur et registre

1. Déployer l’API Next.js canonique avec `presign`, `complete`, `resolve`,
   `delete` et le garbage collector.
2. Appliquer les migrations d’autorité, d’intégrité tenant et de registre média.
3. Vérifier que le registre reste en mode compatibilité :

```sql
select public.server_get_private_media_storage_status();
```

Résultat attendu : `enabled=false`, buckets encore publics. Les migrations
backfillent les URL Supabase/R2 connues et les relient aux ressources métier,
mais ne coupent pas les lecteurs historiques.

## Phase 2 — clients compatibles

1. Diffuser l’OTA Expo et le site Next.js qui savent afficher `btmedia://`.
2. Vérifier les écrans photos, réserves, plans, visites, incidents, stock,
   messagerie et documents.
3. Tester ouverture/téléchargement de documents et génération PDF.
4. Mesurer les erreurs `/api/storage/resolve`, les objets sans tenant, les
   références sans registre et les uploads `ready` sans lien.
5. Forcer une version minimale compatible pour tous les clients natifs.

## Phase 3 — cutover privé

Après validation écrite des gates précédents :

```sql
select public.server_finalize_private_media_storage(
  p_minimum_client_version => 'VERSION_COMPATIBLE',
  p_confirm => true
);
```

Cette transaction :

- passe `photos` et `documents` en privé ;
- active la politique restrictive de lecture ;
- limite l’upload direct à une clé `pending` créée par le serveur pour le même
  utilisateur et le même tenant ;
- bloque les mises à jour et suppressions directes de fichiers.

Déployer ensuite [`r2-public-worker.js`](./r2-public-worker.js) sur l’ancien
Worker public. Une URL historique anonyme doit répondre `410`.

## Validation post-cutover

- utilisateur A ne voit aucun média ou objet du tenant B ;
- une URL Supabase `/object/public/...` ne restitue plus le fichier ;
- une URL Worker historique retourne `410` ;
- une URL signée expire après son TTL et est renouvelée à la demande ;
- les PDF publics de réserve ne signent que les médias liés à la réserve du
  token HMAC ;
- un objet sans dernier lien passe `delete_pending`, puis `deleted` après le
  cron ;
- la CI `Security gates` reste verte.

## Retour arrière d’urgence

Le retour arrière ne supprime ni ne déplace les objets. Dans une fenêtre
d’incident contrôlée, un administrateur base peut temporairement désactiver le
flag et republier les deux buckets :

```sql
begin;
update private.runtime_security_flags
set enabled = false,
    details = jsonb_build_object(
      'phase', 'emergency_rollback',
      'reason', 'INCIDENT_ID',
      'rolled_back_at', now()
    ),
    updated_at = now()
where flag = 'private_media_storage';

update storage.buckets
set public = true
where id in ('photos', 'documents');
commit;
```

Il faut également restaurer temporairement la dernière version publique du
Worker depuis l’historique de déploiement Cloudflare. Cette procédure rouvre
des données : elle est réservée à un incident confirmé, doit être journalisée,
limitée dans le temps et suivie d’un nouveau cutover.

## Suppression de l’historique

Ne vider aucun bucket pendant le rollout. Une fois le cutover stable :

1. vérifier que chaque URL historique appartenant à BuildTrack possède un
   `tenant_media_object` et au moins un lien actif ou une justification ;
2. vérifier par `HEAD` la présence de chaque objet ;
3. conserver une sauvegarde et un manifeste tenant-scoped ;
4. activer le garbage collector ;
5. supprimer uniquement les objets `delete_pending` réclamés par le serveur.

Les anciens scripts de réécriture massive d’URL ne doivent plus être utilisés
pour les nouvelles données : la référence canonique est `btmedia://<asset_id>`.
