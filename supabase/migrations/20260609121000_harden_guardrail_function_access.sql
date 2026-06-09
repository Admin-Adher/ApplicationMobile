-- Follow-up hardening for anti-loss guardrails.
-- Trigger functions are not meant to be callable through PostgREST RPC.

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_unsafe_reserve_hard_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_chantier_delete_with_reserves() FROM PUBLIC, anon, authenticated;

-- Public buckets do not need broad SELECT policies for public URL access.
-- Removing them prevents clients from listing every object in the bucket.
DROP POLICY IF EXISTS "Photos lecture publique" ON storage.objects;
DROP POLICY IF EXISTS "photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "public_read_photos" ON storage.objects;
DROP POLICY IF EXISTS "Documents lecture publique" ON storage.objects;
DROP POLICY IF EXISTS "documents_public_read" ON storage.objects;
DROP POLICY IF EXISTS "public_read_documents" ON storage.objects;

NOTIFY pgrst, 'reload schema';
