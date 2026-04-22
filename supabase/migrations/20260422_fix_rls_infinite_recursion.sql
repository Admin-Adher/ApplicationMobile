-- ============================================================
-- FIX CRITIQUE : Récursion infinie dans les politiques RLS
-- Date : 2026-04-22
--
-- Problème :
--   TOUTES les politiques RLS de toutes les tables contiennent des
--   sous-requêtes du type :
--     exists (select 1 from public.profiles where id = auth.uid() and role = '...')
--
--   Ces sous-requêtes directes sur profiles déclenchent elles-mêmes
--   la politique RLS de profiles, qui contient la même sous-requête
--   → récursion infinie détectée par PostgreSQL → erreur sur TOUTES
--   les requêtes → 0 utilisateurs, 0 entreprises, 0 chantiers dans l'UI.
--
-- Solution :
--   Remplacer TOUS ces EXISTS par les fonctions SECURITY DEFINER
--   déjà existantes : auth_user_role() et auth_user_org().
--   Ces fonctions contournent RLS (SECURITY DEFINER) et lisent
--   profiles sans déclencher de récursion.
--
-- Tables corrigées :
--   plans, organizations, subscriptions, profiles,
--   chantiers, companies, reserves, tasks, documents, photos,
--   site_plans, time_entries, incidents, visites, lots, oprs, channels
-- ============================================================

-- ── S'assurer que les fonctions SECURITY DEFINER existent ──────────────

CREATE OR REPLACE FUNCTION public.auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ── TABLE : plans ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Plans modifiables par super_admin" ON public.plans;
CREATE POLICY "Plans modifiables par super_admin"
  ON public.plans FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ── TABLE : organizations ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Organizations lisibles par leurs membres" ON public.organizations;
CREATE POLICY "Organizations lisibles par leurs membres"
  ON public.organizations FOR SELECT
  USING (
    auth_user_org() = public.organizations.id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Organizations modifiables par super_admin" ON public.organizations;
CREATE POLICY "Organizations modifiables par super_admin"
  ON public.organizations FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ── TABLE : subscriptions ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Subscriptions visibles par membres et super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions visibles par membres et super_admin"
  ON public.subscriptions FOR SELECT
  USING (
    auth_user_org() = public.subscriptions.organization_id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions modifiables par super_admin"
  ON public.subscriptions FOR ALL
  USING (auth_user_role() = 'super_admin');

DROP POLICY IF EXISTS "Subscriptions auto-expiration par membres" ON public.subscriptions;
CREATE POLICY "Subscriptions auto-expiration par membres"
  ON public.subscriptions FOR UPDATE
  USING (auth_user_org() = public.subscriptions.organization_id)
  WITH CHECK (status = 'expired');

-- ── TABLE : profiles ──────────────────────────────────────────────────
-- SELECT : chaque utilisateur voit son propre profil + ceux de son org + super_admin voit tout
DROP POLICY IF EXISTS "Profiles visibles par tous les utilisateurs connectés" ON public.profiles;
DROP POLICY IF EXISTS "Profiles visibles par organisation" ON public.profiles;
CREATE POLICY "Profiles visibles par organisation"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

-- INSERT : chaque utilisateur crée son propre profil
DROP POLICY IF EXISTS "Profil créable par son propriétaire" ON public.profiles;
CREATE POLICY "Profil créable par son propriétaire"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- UPDATE : propre profil OU admin de la même org
DROP POLICY IF EXISTS "Profil modifiable par son propriétaire" ON public.profiles;
DROP POLICY IF EXISTS "Profil modifiable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil modifiable par admin ou propriétaire"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR (
      auth_user_role() IN ('admin', 'super_admin')
      AND (organization_id = auth_user_org() OR auth_user_role() = 'super_admin')
    )
  );

-- DELETE : propre profil OU admin de la même org
DROP POLICY IF EXISTS "Profil supprimable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil supprimable par admin ou propriétaire"
  ON public.profiles FOR DELETE
  USING (
    auth.uid() = id
    OR (
      auth_user_role() IN ('admin', 'super_admin')
      AND (organization_id = auth_user_org() OR auth_user_role() = 'super_admin')
    )
  );

-- ── TABLE : chantiers ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
CREATE POLICY "Chantiers visibles par organisation"
  ON public.chantiers FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur de la même org" ON public.chantiers;
CREATE POLICY "Chantiers modifiables par admin/conducteur de la même org"
  ON public.chantiers FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : companies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Entreprises visibles par organisation" ON public.companies;
DROP POLICY IF EXISTS "Entreprises lisibles par tous les authentifiés" ON public.companies;
CREATE POLICY "Entreprises visibles par organisation"
  ON public.companies FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Entreprises modifiables par admin/conducteur" ON public.companies;
DROP POLICY IF EXISTS "Entreprises modifiables par admin/conducteur de la même org" ON public.companies;
CREATE POLICY "Entreprises modifiables par admin/conducteur de la même org"
  ON public.companies FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : reserves ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Réserves lisibles par tous les authentifiés" ON public.reserves;
DROP POLICY IF EXISTS "Réserves visibles par organisation" ON public.reserves;
CREATE POLICY "Réserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Réserves modifiables" ON public.reserves;
DROP POLICY IF EXISTS "Réserves modifiables par org" ON public.reserves;
CREATE POLICY "Réserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : tasks ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tâches lisibles par tous les authentifiés" ON public.tasks;
DROP POLICY IF EXISTS "Tâches visibles par organisation" ON public.tasks;
CREATE POLICY "Tâches visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Tâches modifiables" ON public.tasks;
DROP POLICY IF EXISTS "Tâches modifiables par org" ON public.tasks;
CREATE POLICY "Tâches modifiables par org"
  ON public.tasks FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : documents ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Documents lisibles par tous les authentifiés" ON public.documents;
DROP POLICY IF EXISTS "Documents visibles par organisation" ON public.documents;
CREATE POLICY "Documents visibles par organisation"
  ON public.documents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Documents modifiables" ON public.documents;
DROP POLICY IF EXISTS "Documents modifiables par org" ON public.documents;
CREATE POLICY "Documents modifiables par org"
  ON public.documents FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : photos ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Photos lisibles par tous les authentifiés" ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND r.organization_id = auth_user_org()
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL
  USING (
    (
      auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
      AND (
        EXISTS (
          SELECT 1 FROM public.reserves r
          WHERE r.id = photos.reserve_id
            AND r.organization_id = auth_user_org()
        )
        OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
      )
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : site_plans ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Plans lisibles par tous les authentifiés" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse visibles par organisation" ON public.site_plans;
CREATE POLICY "Plans de masse visibles par organisation"
  ON public.site_plans FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Plans de masse modifiables" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse modifiables par org" ON public.site_plans;
CREATE POLICY "Plans de masse modifiables par org"
  ON public.site_plans FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : time_entries ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Pointage lisible par tous" ON public.time_entries;
DROP POLICY IF EXISTS "Pointage visible par organisation" ON public.time_entries;
CREATE POLICY "Pointage visible par organisation"
  ON public.time_entries FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Pointage modifiable" ON public.time_entries;
DROP POLICY IF EXISTS "Pointage modifiable par org" ON public.time_entries;
CREATE POLICY "Pointage modifiable par org"
  ON public.time_entries FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : incidents ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Incidents lisibles par tous" ON public.incidents;
DROP POLICY IF EXISTS "Incidents visibles par organisation" ON public.incidents;
CREATE POLICY "Incidents visibles par organisation"
  ON public.incidents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Incidents modifiables" ON public.incidents;
DROP POLICY IF EXISTS "Incidents modifiables par org" ON public.incidents;
CREATE POLICY "Incidents modifiables par org"
  ON public.incidents FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : visites ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Visites lisibles par tous les authentifiés" ON public.visites;
DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
CREATE POLICY "Visites visibles par organisation"
  ON public.visites FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Visites modifiables" ON public.visites;
DROP POLICY IF EXISTS "Visites modifiables par org" ON public.visites;
CREATE POLICY "Visites modifiables par org"
  ON public.visites FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : lots ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Lots lisibles par tous les authentifiés" ON public.lots;
DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
CREATE POLICY "Lots visibles par organisation"
  ON public.lots FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Lots modifiables" ON public.lots;
DROP POLICY IF EXISTS "Lots modifiables par org" ON public.lots;
CREATE POLICY "Lots modifiables par org"
  ON public.lots FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : oprs ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "OPRs lisibles par tous les authentifiés" ON public.oprs;
DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
CREATE POLICY "OPRs visibles par organisation"
  ON public.oprs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "OPRs modifiables" ON public.oprs;
DROP POLICY IF EXISTS "OPRs modifiables par org" ON public.oprs;
CREATE POLICY "OPRs modifiables par org"
  ON public.oprs FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : channels ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Channels lisibles par membres" ON public.channels;
DROP POLICY IF EXISTS "Super admin lit tous les canaux" ON public.channels;
CREATE POLICY "Channels lisibles par membres ou org"
  ON public.channels FOR SELECT
  USING (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(members) AS m
      WHERE m = auth_user_name()
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Channels créables par membres" ON public.channels;
CREATE POLICY "Channels créables par membres"
  ON public.channels FOR INSERT
  WITH CHECK (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Channels modifiables par admin" ON public.channels;
CREATE POLICY "Channels modifiables par admin"
  ON public.channels FOR UPDATE
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Channels supprimables par admin" ON public.channels;
CREATE POLICY "Channels supprimables par admin"
  ON public.channels FOR DELETE
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : messages ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Messages lisibles par membres du canal" ON public.messages;
DROP POLICY IF EXISTS "Super admin lit tous les messages" ON public.messages;
CREATE POLICY "Messages lisibles par membres du canal"
  ON public.messages FOR SELECT
  USING (
    auth_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND (
          (c.type IN ('general', 'building', 'company', 'custom') AND c.organization_id = auth_user_org())
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Messages envoyables par membres" ON public.messages;
CREATE POLICY "Messages envoyables par membres"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth_user_role() = 'super_admin'
    OR (
      sender = auth_user_name()
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND (
            (c.type IN ('general', 'building', 'company', 'custom') AND c.organization_id = auth_user_org())
            OR auth_user_name() = ANY(
              ARRAY(SELECT jsonb_array_elements_text(c.members))
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "Messages modifiables par expéditeur" ON public.messages;
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR UPDATE
  USING (
    sender = auth_user_name()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Messages supprimables par expéditeur ou admin" ON public.messages;
CREATE POLICY "Messages supprimables par expéditeur ou admin"
  ON public.messages FOR DELETE
  USING (
    sender = auth_user_name()
    OR auth_user_role() IN ('admin', 'super_admin')
  );

-- ── TABLE : regulatory_docs ───────────────────────────────────────────
DROP POLICY IF EXISTS "Docs réglementaires lisibles par tous" ON public.regulatory_docs;
DROP POLICY IF EXISTS "Docs réglementaires visibles par organisation" ON public.regulatory_docs;
CREATE POLICY "Docs réglementaires visibles par organisation"
  ON public.regulatory_docs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Docs réglementaires modifiables par admin" ON public.regulatory_docs;
CREATE POLICY "Docs réglementaires modifiables par admin"
  ON public.regulatory_docs FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'super_admin')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── TABLE : invitations ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Invitations visibles par admin" ON public.invitations;
DROP POLICY IF EXISTS "Utilisateur peut voir ses propres invitations" ON public.invitations;
CREATE POLICY "Invitations visibles par admin ou propriétaire"
  ON public.invitations FOR SELECT
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1))
    OR (auth_user_org() = public.invitations.organization_id AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Invitations créables par admin" ON public.invitations;
CREATE POLICY "Invitations créables par admin"
  ON public.invitations FOR INSERT
  WITH CHECK (
    (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Invitations modifiables par admin" ON public.invitations;
DROP POLICY IF EXISTS "Invité peut accepter sa propre invitation" ON public.invitations;
CREATE POLICY "Invitations modifiables par admin ou invité"
  ON public.invitations FOR UPDATE
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1))
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Invitations annulables par admin" ON public.invitations;
CREATE POLICY "Invitations annulables par admin"
  ON public.invitations FOR DELETE
  USING (
    (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ── RPC : get_org_users (SECURITY DEFINER — contourne RLS) ────────────
-- Retourne tous les profils de l'organisation de l'utilisateur courant
-- (ou tous les profils si super_admin), sans déclencher RLS récursif.
CREATE OR REPLACE FUNCTION public.get_org_users()
RETURNS TABLE (
  id uuid,
  name text,
  role text,
  role_label text,
  email text,
  organization_id uuid,
  company_id text,
  permissions_override jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
  v_org_id      uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN RETURN; END IF;

  SELECT p.role, p.organization_id
  INTO v_caller_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  IF v_caller_role = 'super_admin' THEN
    RETURN QUERY
      SELECT p.id, p.name, p.role, p.role_label, p.email,
             p.organization_id, p.company_id, p.permissions_override
      FROM public.profiles p;
  ELSIF v_org_id IS NOT NULL THEN
    RETURN QUERY
      SELECT p.id, p.name, p.role, p.role_label, p.email,
             p.organization_id, p.company_id, p.permissions_override
      FROM public.profiles p
      WHERE p.organization_id = v_org_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_users() TO authenticated;

-- ── Activer la publication Realtime pour les tables du panel admin ────
-- Nécessaire pour que les abonnements postgres_changes fonctionnent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chantiers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chantiers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'companies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
  END IF;
END $$;

-- ── Recharger le cache PostgREST ──────────────────────────────────────
NOTIFY pgrst, 'reload schema';
