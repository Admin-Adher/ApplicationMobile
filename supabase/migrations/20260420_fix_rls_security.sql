-- ============================================================
-- Correctifs de sécurité RLS
-- 1. regulatory_docs : restreindre la lecture à l'organisation
-- 2. profiles         : restreindre la lecture aux membres de la même organisation
-- ============================================================

-- ----------------------------------------------------------------
-- 1. TABLE regulatory_docs
--    Ancienne policy : tout utilisateur connecté pouvait lire TOUS les docs
--    Nouvelle policy : lecture restreinte à l'organisation du lecteur
-- ----------------------------------------------------------------
drop policy if exists "Docs réglementaires lisibles par tous" on public.regulatory_docs;
create policy "Docs réglementaires visibles par organisation"
  on public.regulatory_docs for select
  using (organization_id = auth_user_org());

-- La policy d'écriture existante est conservée telle quelle (déjà correcte).

-- ----------------------------------------------------------------
-- 2. TABLE profiles
--    Ancienne policy : tout utilisateur connecté pouvait lister TOUS les profils
--    Nouvelle policy : visibilité limitée à :
--      - son propre profil
--      - les profils de la même organisation
--      - les super_admin voient tout
-- ----------------------------------------------------------------
drop policy if exists "Profiles visibles par tous les utilisateurs connectés" on public.profiles;
create policy "Profiles visibles par organisation"
  on public.profiles for select
  using (
    auth.uid() = id
    or organization_id = auth_user_org()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  );
