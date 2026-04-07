-- ============================================================
-- FIX: Chantiers avec organization_id NULL invisibles
-- Date : 2026-04-07
--
-- Cause : quand un chantier est créé avec organization_id = NULL
-- (profil admin sans org_id au moment de la création, ou insertion
-- manuelle), la fonction chantier_visible_to_current_user() renvoie
-- false dès la 2e clause :
--   WHEN chantier_org_id::uuid IS DISTINCT FROM auth_user_org() THEN false
-- Un NULL ::uuid est toujours DISTINCT d'un uuid non-NULL → bloqué.
--
-- Ce script est idempotent (pas de DROP, seulement des UPDATE).
-- Coller et exécuter dans : Supabase → SQL Editor → Run
-- ============================================================

-- ── 1. Diagnostic : chantiers orphelins ───────────────────────────────────────
-- (commenté — à dé-commenter pour vérifier avant/après)
-- SELECT id, name, organization_id, created_by
-- FROM public.chantiers
-- WHERE organization_id IS NULL;

-- ── 2. Réparer les chantiers sans organization_id ─────────────────────────────
-- Stratégie A : on trouve l'org du créateur via son profil
UPDATE public.chantiers c
SET organization_id = p.organization_id
FROM public.profiles p
WHERE c.organization_id IS NULL
  AND c.created_by IS NOT NULL
  AND p.name = c.created_by
  AND p.organization_id IS NOT NULL;

-- Stratégie B (fallback) : si le créateur est introuvable mais que des réserves
-- avec organization_id existent pour ce chantier, on s'en sert
UPDATE public.chantiers c
SET organization_id = r.organization_id
FROM (
  SELECT DISTINCT ON (chantier_id) chantier_id, organization_id
  FROM public.reserves
  WHERE organization_id IS NOT NULL AND chantier_id IS NOT NULL
  ORDER BY chantier_id, created_at DESC
) r
WHERE c.organization_id IS NULL
  AND c.id = r.chantier_id;

-- ── 3. Propager l'org aux tables enfants (idempotent) ─────────────────────────
UPDATE public.reserves r
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE r.chantier_id = c.id
  AND r.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.tasks t
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE t.chantier_id = c.id
  AND t.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.visites v
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE v.chantier_id = c.id
  AND v.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.lots l
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE l.chantier_id = c.id
  AND l.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.oprs o
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE o.chantier_id = c.id
  AND o.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.site_plans sp
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE sp.chantier_id = c.id
  AND sp.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

-- ── 4. Vérification finale ────────────────────────────────────────────────────
-- (commenté — à dé-commenter pour confirmer le résultat)
-- SELECT id, name, organization_id FROM public.chantiers ORDER BY created_at;
