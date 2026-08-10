# Cloudflare R2 — stockage privé BuildTrack

R2 est un backend d’objets privé. Le client n’enregistre jamais une URL R2 en
base : il conserve une référence `btmedia://<asset_id>`. L’API canonique
autorise chaque ressource, puis retourne une URL S3 GET signée de courte durée.

## Configuration du bucket

1. Créer un bucket privé `buildtrack-files` dans la région contractuelle.
2. Créer un token limité à ce bucket avec `Object Read & Write`.
3. Configurer la politique CORS suivante, en remplaçant les domaines de test
   par les domaines réellement utilisés :

```json
[
  {
    "AllowedOrigins": [
      "https://buildtrack-mobile.vercel.app",
      "http://localhost:3000",
      "http://localhost:5000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": [
      "etag",
      "content-length",
      "content-type",
      "accept-ranges",
      "content-range"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

## Variables Vercel

| Variable | Usage |
|---|---|
| `R2_ACCOUNT_ID` | Compte Cloudflare |
| `R2_ACCESS_KEY_ID` | Identifiant du token limité au bucket |
| `R2_SECRET_ACCESS_KEY` | Secret du token |
| `R2_BUCKET` | `buildtrack-files` |
| `R2_PUBLIC_BASE_URL` | Hôte Worker historique, uniquement pendant le dual-read |

Ces variables sont des secrets serveur, sauf le nom du bucket. Elles ne doivent
pas être exposées avec un préfixe `NEXT_PUBLIC_` ou `EXPO_PUBLIC_`.

## Flux

```text
Client -> POST /api/storage/presign (JWT)
API    -> server_begin_media_upload(user vérifié)
API    <- asset_id, object_key tenant-scoped, btmedia://asset_id
Client -> PUT signé directement vers R2
Client -> POST /api/storage/complete (JWT)
API    -> HEAD R2 + vérification taille/owner
Métier -> persiste btmedia://asset_id ; trigger crée tenant_media_links

Client -> POST /api/storage/resolve (JWT, refs[])
API    -> contrôle chaque ressource avec le JWT et sa RLS
API    <- URL S3 GET signée 5–10 minutes
```

Les nouvelles clés suivent `org/<organization_id>/...` via la valeur réellement
émise par le registre (`<organization_id>/<kind>/<asset_id>/<safe_name>`). Elles
ne sont jamais acceptées depuis un payload client.

## Worker historique

Le Worker public n’appartient plus à l’architecture cible. Il reste en ligne
uniquement pendant la phase `dual_read` pour les anciennes versions mobiles.
Après le cutover et la version minimale forcée, déployer
`r2-public-worker.js` : ce Worker de retrait répond `410 Gone` et empêche toute
lecture anonyme résiduelle.

Le détail des gates et du retour arrière se trouve dans
[`MIGRATION.md`](./MIGRATION.md).

## Cycle de vie

- `pending` : réservation émise, upload pas encore vérifié ;
- `ready` : objet vérifié, en attente ou déjà lié ;
- `legacy` : URL historique enregistrée dans le registre ;
- `delete_pending` : aucun lien actif, suppression physique à effectuer ;
- `deleted` : suppression physique confirmée.

Le cron `/api/cron/media-gc` récupère les suppressions en attente et les uploads
orphelins. Il exige `CRON_SECRET` et ne reçoit jamais une URL ou une clé fournie
par un utilisateur.
