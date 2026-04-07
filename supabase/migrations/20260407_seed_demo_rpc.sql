-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : seed demo RPC + one-shot profile upsert
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PURPOSE
-- 1. Creates a public RPC `demo_profiles_seeded()` that the app calls anonymously
--    on cold start. If it returns TRUE the client skips seeding entirely
--    (zero signIn/signOut/race-condition window even on the very first launch).
--
-- 2. Provides a one-shot DO block that upserts demo profiles from existing
--    auth users (looked up by email). Run this in Supabase Studio > SQL Editor
--    AFTER creating the 6 demo accounts via Authentication > Users > Add User.
--
-- USAGE
-- a) Apply via `supabase db push` or paste into Supabase Studio > SQL Editor.
-- b) For the one-shot profile upsert (section 2), run it manually once after
--    the auth accounts have been created. It is safe to run multiple times
--    (idempotent via ON CONFLICT).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. RPC: check if demo profiles exist (callable anonymously) ───────────────

CREATE OR REPLACE FUNCTION public.demo_profiles_seeded()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*) >= 6
  FROM public.profiles
  WHERE email IN (
    'superadmin@buildtrack.fr',
    'admin@buildtrack.fr',
    'j.dupont@buildtrack.fr',
    'm.martin@buildtrack.fr',
    'p.lambert@buildtrack.fr',
    'st.martin@buildtrack.fr'
  );
$$;

GRANT EXECUTE ON FUNCTION public.demo_profiles_seeded() TO anon, authenticated;


-- ── 2. One-shot: upsert demo profiles from existing auth users ────────────────
--
-- Prerequisites: create the 6 auth accounts in Supabase dashboard first.
-- The organization with id '00000000-0000-0000-0000-000000000001' must exist.
--
-- Run this block manually once in Supabase Studio > SQL Editor.

DO $$
DECLARE
  v_id  uuid;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
BEGIN

  SELECT id INTO v_id FROM auth.users WHERE email = 'superadmin@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Super Admin BuildTrack', 'superadmin@buildtrack.fr',
            'super_admin', 'Super Administrateur', NULL)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = 'admin@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Admin Système', 'admin@buildtrack.fr',
            'admin', 'Administrateur', v_org)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = 'j.dupont@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Jean Dupont', 'j.dupont@buildtrack.fr',
            'conducteur', 'Conducteur de travaux', v_org)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = 'm.martin@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Marie Martin', 'm.martin@buildtrack.fr',
            'chef_equipe', 'Chef d''équipe', v_org)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = 'p.lambert@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Pierre Lambert', 'p.lambert@buildtrack.fr',
            'observateur', 'Observateur', v_org)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE email = 'st.martin@buildtrack.fr';
  IF v_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, name, email, role, role_label, organization_id)
    VALUES (v_id, 'Stéphane Martin (ST)', 'st.martin@buildtrack.fr',
            'sous_traitant', 'Sous-traitant', v_org)
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role, role_label = EXCLUDED.role_label,
          organization_id = EXCLUDED.organization_id;
  END IF;

END $$;
