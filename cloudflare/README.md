# Cloudflare R2 — stockage de fichiers BuildTrack

Bascule **hybride** : les nouveaux uploads (photos, documents) partent sur R2
(10 Go gratuits, egress illimité) ; les anciens fichiers restent servis par
Supabase Storage (les URLs absolues en base continuent de fonctionner).
Si R2 n'est pas configuré, l'app retombe automatiquement sur Supabase —
le code est déployable avant la mise en place ci-dessous.

## Mise en route (~15 min, dashboard Cloudflare)

### 1. Créer le bucket
R2 Object Storage → **Create bucket**
- Nom : `buildtrack-files`
- Location : **Provide a location hint → Western Europe (WEUR)** (RGPD)
- Storage class : Standard

### 2. Règles CORS du bucket (pour l'upload navigateur)
Bucket → Settings → **CORS policy** :

```json
[
  {
    "AllowedOrigins": [
      "https://buildtrack-mobile.vercel.app",
      "http://localhost:3000",
      "http://localhost:5000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

### 3. Token API S3
R2 → **Manage R2 API Tokens** → Create API Token
- Permissions : **Object Read & Write**
- Specify bucket : `buildtrack-files`
- Noter : Access Key ID, Secret Access Key, et l'Account ID (visible dans
  l'URL du dashboard ou R2 → vue d'ensemble).

### 4. Worker public de lecture
Workers & Pages → Create → Worker (nom : `buildtrack-files`)
- Coller le contenu de [`r2-public-worker.js`](./r2-public-worker.js)
- Settings → **Bindings** → R2 bucket : nom de variable `FILES` → bucket `buildtrack-files`
- Deploy, puis noter l'URL `https://buildtrack-files.<compte>.workers.dev`
- Vérification rapide : `https://…workers.dev/nimporte-quoi` doit répondre 404.

### 5. Variables d'environnement Vercel
Project → Settings → Environment Variables (Production + Preview) :

| Variable | Valeur |
|---|---|
| `R2_ACCOUNT_ID` | id du compte Cloudflare |
| `R2_ACCESS_KEY_ID` | du token étape 3 |
| `R2_SECRET_ACCESS_KEY` | du token étape 3 |
| `R2_BUCKET` | `buildtrack-files` |
| `R2_PUBLIC_BASE_URL` | `https://buildtrack-files.<compte>.workers.dev` |

Redéployer le projet Vercel après ajout.

### 6. Vérifier
- Web : créer une réserve avec photo → l'URL de la photo doit commencer par
  `https://buildtrack-files.…workers.dev/photos/`.
- Générer un PDF avec cette réserve → la photo doit apparaître (allowlist
  SSRF mise à jour côté `generate-pdf`).
- Mobile : nécessite la mise à jour de l'app (les anciennes versions
  continuent d'uploader vers Supabase — c'est voulu, mode hybride).

## Architecture

```
Upload  : client ──POST /api/storage/presign (Bearer)──▶ Vercel
                  ◀── { uploadUrl (S3 présignée 10 min), publicUrl } ──
          client ──PUT fichier──▶ <account>.r2.cloudflarestorage.com
          → publicUrl stockée en base (photo_uri, photos[], uri…)

Lecture : <img src="https://buildtrack-files.<compte>.workers.dev/photos/…">
          Worker (lecture seule, CORS *, cache immutable) ──▶ binding R2

Suppression : client ──POST /api/storage/delete (Bearer, rôles gestion)──▶
          Vercel ──S3 DeleteObject──▶ R2 (les URLs Supabase sont ignorées
          par cette route et restent gérées par storage.remove côté client)
```

## Quotas plan gratuit (2026)

| | Supabase Storage | Cloudflare R2 |
|---|---|---|
| Stockage | 1 Go | **10 Go** |
| Egress | ~10 Go/mois (partagé avec la DB) | **Illimité, gratuit** |
| Taille max fichier | 50 Mo | 5 Go (PUT simple) |
| Lectures | — | 10 M/mois (Class B) + Worker 100 k req/jour |
| Écritures | — | 1 M/mois (Class A) |

## Migration de l'historique (optionnelle, plus tard)

Pour vider le bucket Supabase (vous êtes au-dessus du Go) :
1. `rclone` avec deux remotes S3 (Supabase expose un endpoint S3-compatible :
   Storage → Settings → S3 connection) → copie `photos/` et `documents/`
   vers `buildtrack-files` en préservant les chemins.
2. Script SQL de réécriture des URLs en base (`photo_uri`, `photos` jsonb,
   `documents.uri`, `site_plans.uri`…) : remplacer
   `https://<projet>.supabase.co/storage/v1/object/public/<bucket>/` par
   `https://buildtrack-files.<compte>.workers.dev/<bucket>/`.
3. Vérifier, puis vider les buckets Supabase.

Tant que cette migration n'est pas faite, les deux hôtes cohabitent sans
aucun impact utilisateur.
