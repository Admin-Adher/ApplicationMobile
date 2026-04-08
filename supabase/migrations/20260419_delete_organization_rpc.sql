-- ============================================================
-- Migration : RPC delete_organization(org_id)
-- Date : 2026-04-19
--
-- But :
--   Permettre au super_admin de supprimer une organisation et
--   toutes ses données associées en une seule transaction atomique.
--
-- Ce que la fonction supprime (dans l'ordre FK) :
--   messages → photos → time_entries → tasks → reserves
--   → site_plans → oprs → lots → visites → incidents
--   → regulatory_docs → documents → chantiers → channels
--   → companies → subscriptions → invitations
--   → profiles → auth.users (membres) → organizations
--
-- Ce que la fonction retourne :
--   {
--     "success": true,
--     "photo_urls": [...],    -- URLs des photos à supprimer du Storage
--     "document_urls": [...]  -- URLs des documents à supprimer du Storage
--   }
--   ou { "success": false, "error": "..." }
--
-- Sécurité :
--   SECURITY DEFINER (postgres) — accès total.
--   Seul un super_admin authentifié peut appeler cette fonction.
--   Idempotent : oui (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_organization(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller      uuid;
  v_caller_role text;
  v_user_ids    uuid[];
  v_photo_urls  text[];
  v_doc_urls    text[];
BEGIN
  v_caller := auth.uid();

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller;

  IF v_caller_role <> 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'organization_not_found');
  END IF;

  -- ── Collecte des URIs Storage (avant suppression des lignes) ──
  -- Photos n'ont pas de organization_id direct : passage via reserve → chantier
  SELECT ARRAY(
    SELECT p.uri FROM public.photos p
    JOIN public.reserves r ON r.id = p.reserve_id
    WHERE r.organization_id = p_org_id AND p.uri IS NOT NULL AND p.uri <> ''
  ) INTO v_photo_urls;

  SELECT ARRAY(
    SELECT uri FROM public.documents
    WHERE organization_id = p_org_id AND uri IS NOT NULL AND uri <> ''
  ) INTO v_doc_urls;

  -- ── Collecte des IDs auth des membres (avant suppression profiles) ──
  SELECT ARRAY(
    SELECT id FROM public.profiles
    WHERE organization_id = p_org_id
  ) INTO v_user_ids;

  -- ── Suppression des données dans l'ordre FK ──

  -- 1. Messages (dépend de channels)
  DELETE FROM public.messages        WHERE organization_id = p_org_id;

  -- 2. Photos (via reserve_id → reserve → organization_id, pas de colonne directe)
  DELETE FROM public.photos WHERE reserve_id IN (
    SELECT id FROM public.reserves WHERE organization_id = p_org_id
  );

  -- 3. Pointage
  DELETE FROM public.time_entries    WHERE organization_id = p_org_id;

  -- 4. Tâches (dépend de reserves, chantiers, lots)
  DELETE FROM public.tasks           WHERE organization_id = p_org_id;

  -- 5. Réserves (dépend de chantiers, lots)
  DELETE FROM public.reserves        WHERE organization_id = p_org_id;

  -- 6. Plans de masse / plans d'exécution
  DELETE FROM public.site_plans      WHERE organization_id = p_org_id;

  -- 7. OPRs (dépend de lots, chantiers)
  DELETE FROM public.oprs            WHERE organization_id = p_org_id;

  -- 8. Lots (dépend de chantiers)
  DELETE FROM public.lots            WHERE organization_id = p_org_id;

  -- 9. Visites (dépend de chantiers)
  DELETE FROM public.visites         WHERE organization_id = p_org_id;

  -- 10. Incidents
  DELETE FROM public.incidents       WHERE organization_id = p_org_id;

  -- 11. Documents réglementaires
  DELETE FROM public.regulatory_docs WHERE organization_id = p_org_id;

  -- 12. Documents (fichiers liés)
  DELETE FROM public.documents       WHERE organization_id = p_org_id;

  -- 13. Chantiers
  DELETE FROM public.chantiers       WHERE organization_id = p_org_id;

  -- 14. Channels de messagerie
  DELETE FROM public.channels        WHERE organization_id = p_org_id;

  -- 15. Entreprises/sous-traitants
  DELETE FROM public.companies       WHERE organization_id = p_org_id;

  -- 16. Abonnements
  DELETE FROM public.subscriptions   WHERE organization_id = p_org_id;

  -- 17. Invitations
  DELETE FROM public.invitations     WHERE organization_id = p_org_id;

  -- 18. Profils membres
  DELETE FROM public.profiles        WHERE organization_id = p_org_id;

  -- 19. Comptes auth des membres (exclut le super_admin appelant)
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    DELETE FROM auth.users
    WHERE id = ANY(v_user_ids)
      AND id <> v_caller;
  END IF;

  -- 20. Organisation elle-même
  DELETE FROM public.organizations WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'success',       true,
    'photo_urls',    to_jsonb(COALESCE(v_photo_urls,  '{}'::text[])),
    'document_urls', to_jsonb(COALESCE(v_doc_urls,    '{}'::text[]))
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_organization(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
