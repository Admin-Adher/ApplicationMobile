# Migration de l'historique des fichiers : Supabase Storage → Cloudflare R2

Copie les fichiers existants vers R2 puis réécrit les URLs en base, pour
pouvoir **vider les buckets Supabase** et repasser sous le quota gratuit.

> Prérequis : le setup R2 de [README.md](./README.md) doit être **terminé**
> (bucket `buildtrack-files`, Worker public, variables `R2_*` sur Vercel).
> Les nouveaux uploads partent déjà sur R2 ; ici on s'occupe de l'ancien.

## Principe de sûreté

On **copie** (jamais déplace), puis on réécrit les URLs **pendant que les
fichiers existent aux deux endroits**. On ne vide Supabase qu'à la toute fin,
après vérification. À chaque étape avant le vidage, le rollback est trivial.

```
1. COPIER      Supabase ──rclone──▶ R2   (rien ne change côté app)
2. VÉRIFIER    compter objets des 2 côtés
3. RÉÉCRIRE    URLs en base (script SQL 07)   ← fichiers présents aux 2 endroits
4. VÉRIFIER    script SQL 06 = 0 ligne + test visuel web/mobile/PDF
5. ATTENDRE    quelques jours de sécurité
6. VIDER       buckets Supabase   ← irréversible, en dernier
```

---

## Étape 1 — Copier les fichiers vers R2 (rclone)

[rclone](https://rclone.org/downloads/) lit l'endpoint S3 de Supabase et écrit
dans R2, en reprenant sur interruption et en vérifiant les checksums.

### 1a. Récupérer les credentials

- **Supabase S3** : Dashboard → Storage → Settings → **S3 Connection**.
  Notez l'**endpoint**, la **région**, et créez une paire de clés S3
  (*S3 Access Keys*).
- **R2** : la paire de clés créée à l'étape 3 du README (token Object Read & Write).

### 1b. Configurer rclone

`rclone config` (ou éditez `~/.config/rclone/rclone.conf`), deux remotes :

```ini
[supabase]
type = s3
provider = Other
access_key_id     = <SUPABASE_S3_ACCESS_KEY>
secret_access_key = <SUPABASE_S3_SECRET>
endpoint = https://jzeojdpgglbxjdasjgta.storage.supabase.co/storage/v1/s3
region   = <REGION affichée dans Storage Settings, ex. eu-west-3>

[r2]
type = s3
provider = Cloudflare
access_key_id     = <R2_ACCESS_KEY_ID>
secret_access_key = <R2_SECRET_ACCESS_KEY>
endpoint = https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
region   = auto
```

### 1c. Copier (en préservant les préfixes `photos/` et `documents/`)

```bash
rclone copy supabase:photos    r2:buildtrack-files/photos    --progress --transfers 16 --checksum
rclone copy supabase:documents r2:buildtrack-files/documents --progress --transfers 16 --checksum
```

> Important : la cible inclut bien `/photos` et `/documents`. Le Worker sert
> `buildtrack-files/photos/<fichier>` → URL `…workers.dev/photos/<fichier>`,
> ce qui correspond exactement à la réécriture SQL (le préfixe
> `…/object/public/` est remplacé, `photos/<fichier>` reste identique).

---

## Étape 2 — Vérifier la copie

```bash
rclone size  supabase:photos      && rclone size  r2:buildtrack-files/photos
rclone size  supabase:documents   && rclone size  r2:buildtrack-files/documents
rclone check supabase:photos      r2:buildtrack-files/photos    --one-way
rclone check supabase:documents   r2:buildtrack-files/documents --one-way
```

`check --one-way` doit signaler **0 différence** (tout Supabase est sur R2).
Testez aussi une URL au hasard dans le navigateur :
`https://buildtrack-files.<compte>.workers.dev/photos/<un_fichier_listé>`
→ doit afficher l'image.

---

## Étape 3 — Réécrire les URLs en base

Dans le **SQL Editor Supabase** :

1. (Optionnel mais conseillé) lancez [`06_r2_migration_detect.sql`](../supabase/manual_sql/06_r2_migration_detect.sql)
   → note le périmètre (tables/colonnes/nombre de lignes) qui sera migré.
2. Ouvrez [`07_r2_migration_rewrite.sql`](../supabase/manual_sql/07_r2_migration_rewrite.sql),
   renseignez `new_prefix` avec votre URL Worker **terminée par `/`**, exécutez.
   L'onglet *Messages* liste chaque colonne réécrite et le total.

---

## Étape 4 — Vérifier la réécriture

1. Relancez [`06_r2_migration_detect.sql`](../supabase/manual_sql/06_r2_migration_detect.sql)
   → **doit renvoyer 0 ligne**. S'il reste des lignes, c'est qu'une nouvelle
   donnée a été créée entre-temps (re-copiez via rclone puis ré-exécutez 07),
   ou qu'une colonne n'était pas encore copiée. Ne pas continuer tant que ≠ 0.
2. Test visuel :
   - **Web** : ouvrir une réserve ancienne avec photo → l'image s'affiche, son
     URL commence par `…workers.dev/`.
   - **Génération PDF** d'une réserve ancienne → les photos apparaissent.
   - **Mobile** : ouvrir une réserve ancienne (après refetch) → photos OK.

---

## Étape 5 — Période de sécurité

Laissez tourner **quelques jours** avec les fichiers encore présents sur
Supabase. Cela couvre les clients mobiles qui n'ont pas encore resynchronisé
et permet un rollback immédiat si un problème apparaît.

### Rollback (tant que Supabase n'est pas vidé)

Ré-exécuter le script 07 **en inversant** `old_prefix` et `new_prefix`
(Worker → Supabase) restaure les anciennes URLs. Réversible et idempotent.

---

## Étape 6 — Vider les buckets Supabase (irréversible)

**Seulement** après que l'étape 4 est verte et la période de sécurité écoulée.

```bash
# Vérification finale : plus aucune URL Supabase en base (script 06 = 0 ligne)
rclone delete supabase:photos    --rmdirs
rclone delete supabase:documents --rmdirs
```

Ou, plus prudent : déplacer dans un dossier d'archive Supabase au lieu de
supprimer, le temps d'être certain :

```bash
rclone move supabase:photos    supabase:photos/_archive_pre_r2    --exclude "_archive_pre_r2/**"
```

Après vidage, le quota storage Supabase doit retomber bien sous 1 Go.

---

## En cas de souci

- **Images cassées après réécriture mais avant vidage** → rollback étape 5.
  Les fichiers Supabase sont intacts, aucune perte.
- **Une image précise manque sur R2** → `rclone copy` ne l'a pas prise
  (créée après la copie). Re-lancez l'étape 1c puis 3.
- **Le PDF n'affiche pas les photos R2** → vérifiez que `R2_PUBLIC_BASE_URL`
  est bien défini sur Vercel (l'allowlist anti-SSRF de `generate-pdf` s'en
  sert pour autoriser l'hôte R2).
