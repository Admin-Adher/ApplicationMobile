-- ============================================================
-- FIX: Profil admin sans organization_id ou org manquante
-- Date : 2026-04-07
--
-- Symptôme : l'admin voit ses réserves mais pas le chantier.
-- Le chantier a organization_id = '00000000-0000-0000-0000-000000000001'
-- → le profil admin a soit organization_id = NULL soit un autre org_id.
--
-- Ce script est idempotent. Exécuter dans Supabase → SQL Editor.
-- ============================================================

-- ── ÉTAPE 1 : Diagnostic ─────────────────────────────────────────────────────
-- Décommenter et exécuter pour voir l'état réel :
--
-- SELECT id, name, role, organization_id FROM public.profiles WHERE name = 'Admin Système';
-- SELECT id, name FROM public.organizations WHERE id = '00000000-0000-0000-0000-000000000001';

-- ── ÉTAPE 2 : S'assurer que l'organisation demo existe ───────────────────────
INSERT INTO public.organizations (id, name, slug)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Organisation Demo',
  'organisation-demo'
)
ON CONFLICT (id) DO NOTHING;

-- ── ÉTAPE 3 : Mettre à jour le profil admin si organization_id est NULL ──────
-- On cible le profil dont le name = 'Admin Système' et organisation = NULL
UPDATE public.profiles
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE name = 'Admin Système'
  AND organization_id IS NULL;

-- ── ÉTAPE 4 : Même chose pour tous les profils demo sans org_id ──────────────
-- (conducteur, chef_equipe, observateur, sous_traitant)
UPDATE public.profiles
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE email IN (
  'admin@buildtrack.fr',
  'j.dupont@buildtrack.fr',
  'm.martin@buildtrack.fr',
  'p.lambert@buildtrack.fr',
  'st.martin@buildtrack.fr'
)
AND organization_id IS NULL;

-- ── ÉTAPE 5 : S'assurer que les chantiers demo ont le bon org_id ──────────────
UPDATE public.chantiers
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL
  AND created_by IN (
    'Admin Système', 'Jean Dupont', 'Marie Martin', 'Pierre Lambert'
  );

-- ── ÉTAPE 6 : Vérification finale (décommenter pour confirmer) ───────────────
-- SELECT id, name, role, organization_id FROM public.profiles ORDER BY name;
-- SELECT id, name, organization_id, created_by FROM public.chantiers;
