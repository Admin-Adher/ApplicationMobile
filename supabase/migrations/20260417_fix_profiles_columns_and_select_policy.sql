-- ============================================================
-- FIX: profiles table — colonnes manquantes + politique SELECT
-- Contexte : l'onglet "Utilisateurs" du panneau admin affiche
-- toujours 0 utilisateur car :
--   1. La colonne permissions_override (ajoutée par la migration
--      20260406) peut être absente si cette migration n'a pas été
--      appliquée à l'instance Supabase.  La requête
--      profiles.select('…,permissions_override') renvoie alors
--      { data: null, error: "column does not exist" }, erreur
--      avalée silencieusement → users = [].
--   2. La politique SELECT ("auth.role() = 'authenticated'")
--      n'existe que dans schema.sql, jamais dans aucune migration.
--      Si l'instance a été initialisée uniquement via les migrations,
--      aucune politique SELECT n'est en place → 0 lignes retournées.
-- ============================================================

-- ---- 1. Colonnes manquantes sur profiles ----
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permissions_override jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pinned_channels jsonb NOT NULL DEFAULT '[]';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_read_by_channel jsonb NOT NULL DEFAULT '{}';

-- ---- 2. Politique SELECT — visibilité dans la même organisation ----
-- On remplace la politique globale (auth.role() = 'authenticated')
-- par une politique par organisation, plus sécurisée :
--   • un membre voit tous les profils de son organisation
--   • un super_admin voit tous les profils
--   • chaque utilisateur voit toujours son propre profil
DROP POLICY IF EXISTS "Profiles visibles par tous les utilisateurs connectés" ON public.profiles;
CREATE POLICY "Profiles visibles par tous les utilisateurs connectés"
  ON public.profiles FOR SELECT USING (
    -- propre profil toujours visible
    auth.uid() = id
    -- même organisation
    OR (
      organization_id IS NOT NULL
      AND organization_id = (
        SELECT p.organization_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
        LIMIT 1
      )
    )
    -- super_admin voit tout
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- ---- 3. Politique UPDATE — admin peut modifier les profils de son org ----
DROP POLICY IF EXISTS "Profil modifiable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil modifiable par admin de la même organisation"
  ON public.profiles FOR UPDATE USING (
    -- propre profil toujours modifiable
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id = public.profiles.organization_id
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- ---- 4. Politique DELETE — admin peut supprimer des profils de son org ----
DROP POLICY IF EXISTS "Profil supprimable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil supprimable par admin de la même organisation"
  ON public.profiles FOR DELETE USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id = public.profiles.organization_id
        AND p.role IN ('admin', 'super_admin')
    )
  );
