-- ============================================================
-- BuildTrack — Création des buckets Supabase Storage
-- À exécuter dans : Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Bucket "photos" — miniatures réserves, photos de chantier
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,                    -- public : les URL sont accessibles sans auth
  10485760,                -- 10 MB max par fichier
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Bucket "documents" — plans PDF, DXF, images de plan
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  true,                    -- public : les plans doivent être affichables dans l'app
  52428800,                -- 50 MB max par fichier (plans PDF peuvent être lourds)
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff',
        'application/octet-stream', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- Policies RLS pour le bucket "photos"
-- ============================================================

-- Lecture publique (photos affichées dans l'app sans auth)
CREATE POLICY "photos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'photos');

-- Upload autorisé pour les utilisateurs authentifiés
CREATE POLICY "photos_auth_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'photos');

-- Mise à jour/suppression pour les utilisateurs authentifiés
CREATE POLICY "photos_auth_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'photos');

CREATE POLICY "photos_auth_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'photos');

-- ============================================================
-- Policies RLS pour le bucket "documents"
-- ============================================================

CREATE POLICY "documents_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

CREATE POLICY "documents_auth_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "documents_auth_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'documents');

CREATE POLICY "documents_auth_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents');

-- ============================================================
-- Vérification finale (exécuter après les INSERT)
-- ============================================================
SELECT
  id,
  name,
  public,
  ROUND(file_size_limit / 1024.0 / 1024.0, 0) AS size_limit_mb,
  array_length(allowed_mime_types, 1) AS mime_count,
  created_at
FROM storage.buckets
WHERE id IN ('photos', 'documents')
ORDER BY id;
